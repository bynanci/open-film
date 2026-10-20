// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
import applicationManifest from "../package.json" with { type: "json" };
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { lstat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { platform } from "node:os";
import { pathToFileURL } from "node:url";
import {
  ApplicationError,
  PROJECT_VERSION_LIMITS,
  diffProjectVersions,
  graphicSceneAssetIds,
  migrateProject,
  validateProject,
  validateProjectVersionRecord,
  type MediaAsset,
  type OpenFilmProject,
  type ProjectVersionDiff,
  type ProjectVersionRecord,
  type ProjectVersionSourceReference,
} from "@openfilm/core";
import {
  CATALOG_SCHEMA_VERSION,
  CATALOG_SNAPSHOT_MAX_BYTES,
  inspectCatalogSnapshot,
} from "@openfilm/catalog";
import { hashFile, localPath, referenceFor } from "@openfilm/media";
import { managedSourceUri } from "./path-safety.js";
import { portableCacheUri } from "./portable-cache.js";
import { savedScriptProjectIdentity } from "./scene-script-review.js";
import type { OpenFilmApplication } from "./index.js";

const STORE_FORMAT = 1 as const;
const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_PATTERN = /^[a-f0-9]{64}$/u;

export class ProjectVersionError extends ApplicationError {
  override name = "ProjectVersionError";
}

function fail(
  code: ConstructorParameters<typeof ApplicationError>[0],
  message: string,
  status = 400,
): never {
  throw new ProjectVersionError(code, message, status);
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function plain(value: unknown, where: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail("request.invalid", `${where} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    [...value].some((character) => {
      const point = character.codePointAt(0)!;
      return (
        point < 32 || point === 127 || (point >= 0xd800 && point <= 0xdfff)
      );
    })
  )
    fail(
      "request.invalid",
      `${where} must be valid text of at most ${maximum} characters.`,
    );
  return value;
}

function uuid(value: unknown, where: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value))
    fail("request.invalid", `${where} must be a UUID.`);
  return value.toLowerCase();
}

function revision(value: unknown, where: string): string {
  if (typeof value !== "string" || !SHA_PATTERN.test(value))
    fail("request.invalid", `${where} must be a SHA-256 revision.`);
  return value;
}

interface VersionIndexEntry {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  requestId: string;
  baseRevision: string;
  payloadBytes: number;
  recordHash: string;
}

interface VersionReceipt {
  requestId: string;
  fingerprint: string;
  kind: "create" | "restore";
  versionId: string;
  checkpointVersionId?: string;
}

interface VersionIndex {
  format: typeof STORE_FORMAT;
  projectId: string;
  entries: VersionIndexEntry[];
  receipts: VersionReceipt[];
}

interface Snapshot {
  manifest: Buffer;
  catalog: Buffer;
  project: OpenFilmProject;
  schemaVersion: number;
  projectHash: string;
  catalogHash: string;
  catalogRevision: string;
  revision: string;
}

interface LoadedVersion {
  entry: VersionIndexEntry;
  record: ProjectVersionRecord;
  manifest: Buffer;
  catalog: Buffer;
  project: OpenFilmProject;
  directory: string;
}

export interface ProjectVersionCreateInput {
  name: string;
  description?: string;
  baseRevision: string;
  requestId: string;
}

export interface ProjectVersionRestoreInput {
  baseRevision: string;
  requestId: string;
  confirmed: boolean;
}

export interface ProjectVersionRestoreResult {
  restoredVersionId: string;
  checkpointVersionId: string;
}

function defaultIndex(projectId: string): VersionIndex {
  return { format: STORE_FORMAT, projectId, entries: [], receipts: [] };
}

function validateIndex(value: unknown, projectId: string): VersionIndex {
  const data = plain(value, "Version index");
  if (
    data.format !== STORE_FORMAT ||
    data.projectId !== projectId ||
    !Array.isArray(data.entries) ||
    !Array.isArray(data.receipts) ||
    data.entries.length > PROJECT_VERSION_LIMITS.count ||
    data.receipts.length > 1000
  )
    fail("request.invalid", "The project version index is invalid.");
  const entries = data.entries.map((item) => {
    const entry = plain(item, "Version entry");
    const allowed = [
      "id",
      "name",
      "description",
      "createdAt",
      "requestId",
      "baseRevision",
      "payloadBytes",
      "recordHash",
    ];
    if (Object.keys(entry).some((key) => !allowed.includes(key)))
      fail(
        "request.invalid",
        "The project version index contains an unknown field.",
      );
    const id = uuid(entry.id, "version ID");
    const name = text(
      entry.name,
      "Version name",
      PROJECT_VERSION_LIMITS.nameCharacters,
    );
    const description =
      entry.description === undefined
        ? undefined
        : text(
            entry.description,
            "Version description",
            PROJECT_VERSION_LIMITS.descriptionCharacters,
          );
    if (
      typeof entry.createdAt !== "string" ||
      !Number.isFinite(Date.parse(entry.createdAt)) ||
      typeof entry.payloadBytes !== "number" ||
      !Number.isSafeInteger(entry.payloadBytes) ||
      entry.payloadBytes <= 0
    )
      fail(
        "request.invalid",
        "The project version index contains invalid metadata.",
      );
    return {
      id,
      name,
      ...(description === undefined ? {} : { description }),
      createdAt: entry.createdAt,
      requestId: uuid(entry.requestId, "version request ID"),
      baseRevision: revision(entry.baseRevision, "version base revision"),
      payloadBytes: entry.payloadBytes,
      recordHash: revision(entry.recordHash, "version record hash"),
    } satisfies VersionIndexEntry;
  });
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    fail(
      "request.invalid",
      "The project version index contains duplicate IDs.",
    );
  const receipts = data.receipts.map((item) => {
    const receipt = plain(item, "Version receipt");
    if (
      Object.keys(receipt).some(
        (key) =>
          ![
            "requestId",
            "fingerprint",
            "kind",
            "versionId",
            "checkpointVersionId",
          ].includes(key),
      ) ||
      (receipt.kind !== "create" && receipt.kind !== "restore")
    )
      fail(
        "request.invalid",
        "The project version index contains an invalid receipt.",
      );
    return {
      requestId: uuid(receipt.requestId, "receipt request ID"),
      fingerprint: revision(receipt.fingerprint, "receipt fingerprint"),
      kind: receipt.kind,
      versionId: uuid(receipt.versionId, "receipt version ID"),
      ...(receipt.checkpointVersionId === undefined
        ? {}
        : {
            checkpointVersionId: uuid(
              receipt.checkpointVersionId,
              "receipt checkpoint ID",
            ),
          }),
    } satisfies VersionReceipt;
  });
  if (
    new Set(receipts.map((receipt) => receipt.requestId)).size !==
    receipts.length
  )
    fail(
      "request.invalid",
      "The project version index contains duplicate request IDs.",
    );
  return { format: STORE_FORMAT, projectId, entries, receipts };
}

function writeFileDurably(path: string, content: Buffer | string): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function syncDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      !code ||
      !["EINVAL", "ENOTSUP", "EISDIR", "EBADF", "EPERM"].includes(code)
    )
      throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function atomicJson(
  path: string,
  value: unknown,
  beforePublish?: () => void,
  published?: () => void,
): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileDurably(temporary, `${JSON.stringify(value, null, 2)}\n`);
    beforePublish?.();
    renameSync(temporary, path);
    published?.();
    syncDirectory(dirname(path));
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
    throw error;
  }
}

function referencedAssetIds(project: OpenFilmProject): Set<string> {
  const ids = new Set<string>();
  for (const story of project.stories)
    for (const beat of story.beats) {
      for (const id of beat.candidateAssetIds ?? []) ids.add(id);
      for (const id of beat.selectedAssetIds ?? []) ids.add(id);
      for (const constraint of beat.constraints ?? [])
        if ("assetIds" in constraint)
          for (const id of constraint.assetIds) ids.add(id);
    }
  for (const composition of project.timelines) {
    for (const id of graphicSceneAssetIds(composition.graphicScenes ?? []))
      ids.add(id);
    for (const track of composition.tracks)
      for (const clip of track.clips) {
        ids.add(clip.assetId);
        if (clip.layout?.secondary) ids.add(clip.layout.secondary.assetId);
      }
  }
  return ids;
}

function snapshotAssets(image: Buffer): Map<string, MediaAsset> {
  return new Map(
    inspectCatalogSnapshot(image, CATALOG_SCHEMA_VERSION).assets.map(
      (asset) => [asset.id, asset],
    ),
  );
}

function validateCatalogImage(
  image: Buffer,
  expectedSchemaVersion: number,
): void {
  try {
    inspectCatalogSnapshot(image, expectedSchemaVersion);
  } catch {
    fail(
      "request.invalid",
      "The named version catalog failed integrity validation.",
    );
  }
}

function managedSource(projectDirectory: string, asset: MediaAsset): boolean {
  return managedSourceUri(projectDirectory, asset) !== undefined;
}

async function sourceReference(
  projectDirectory: string,
  asset: MediaAsset,
): Promise<ProjectVersionSourceReference> {
  let path: string;
  const managed = asset.metadata["openfilm.managedSource"] as
    { relativePath?: unknown; uri?: unknown } | undefined;
  const managedUri = managedSourceUri(projectDirectory, asset);
  if (managed?.uri === asset.uri && !managedUri)
    fail(
      "media.missing",
      `Managed source ${asset.id} resolves through an unsafe or invalid project path. Relink it before creating or restoring a version.`,
      409,
    );
  try {
    path = localPath(managedUri ?? asset.uri);
  } catch {
    fail(
      "media.missing",
      `Source ${asset.id} is not a local file. Relink it before creating or restoring a version.`,
      409,
    );
  }
  let info;
  try {
    info = await lstat(path);
  } catch {
    fail(
      "media.missing",
      `Source ${asset.id} is missing. Relink it before creating or restoring a version.`,
      409,
    );
  }
  if (!info.isFile() || info.isSymbolicLink())
    fail(
      "media.missing",
      `Source ${asset.id} is not a regular local file.`,
      409,
    );
  let sha256: string;
  try {
    sha256 = await hashFile(path);
  } catch {
    fail(
      "media.missing",
      `Source ${asset.id} could not be verified. Relink it and retry.`,
      409,
    );
  }
  const after = await lstat(path);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.size !== info.size ||
    after.mtimeMs !== info.mtimeMs
  )
    fail(
      "story.planConflict",
      `Source ${asset.id} changed while its version was captured.`,
      409,
    );
  return {
    assetId: asset.id,
    sha256,
    sizeBytes: info.size,
    mediaType: asset.mediaType,
    kind: managedSource(projectDirectory, asset) ? "managed" : "external",
  };
}

function projectSummary(project: OpenFilmProject) {
  return {
    title: project.title,
    storyCount: project.stories.length,
    compositionCount: project.timelines.length,
    captionTrackCount: project.timelines.reduce(
      (total, composition) => total + (composition.captionTracks?.length ?? 0),
      0,
    ),
    graphicSceneCount: project.timelines.reduce(
      (total, composition) => total + (composition.graphicScenes?.length ?? 0),
      0,
    ),
  };
}

function clipMap(project: OpenFilmProject) {
  const clips = new Map<string, unknown>();
  for (const composition of project.timelines)
    for (const track of composition.tracks)
      for (const clip of track.clips)
        clips.set(`${composition.id}\u0000${track.id}\u0000${clip.id}`, clip);
  return clips;
}

function canonicalJson(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, canonical(child)]),
      );
    return item;
  };
  return JSON.stringify(canonical(value));
}

/** Project-owned, bounded, path-private durable snapshots shared by every UI adapter. */
export class ProjectVersionService {
  private readonly root: string;
  private readonly indexPath: string;
  private readonly journalPath: string;

  constructor(private readonly app: OpenFilmApplication) {
    this.root = join(app.directory, "versions");
    this.indexPath = join(this.root, "index.json");
    this.journalPath = join(this.root, "restore-journal.json");
  }

  private ensureRoot(create: boolean): boolean {
    try {
      const info = lstatSync(this.root);
      if (info.isSymbolicLink() || !info.isDirectory())
        fail("request.invalid", "The project versions folder is unsafe.");
      if (platform() !== "win32" && info.mode & 0o077)
        fail(
          "request.invalid",
          "The project versions folder permissions are too broad.",
        );
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!create) return false;
      mkdirSync(this.root, { mode: 0o700 });
      return true;
    }
  }

  private readIndex(): VersionIndex {
    if (!this.ensureRoot(false)) return defaultIndex(this.app.project.id);
    if (!existsSync(this.indexPath)) return defaultIndex(this.app.project.id);
    const info = lstatSync(this.indexPath);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 8 * 1024 * 1024)
      fail(
        "request.invalid",
        "The project version index is unsafe or too large.",
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.indexPath, "utf8"));
    } catch {
      fail("request.invalid", "The project version index is corrupt.");
    }
    return validateIndex(parsed, this.app.project.id);
  }

  private capture(): Snapshot {
    if (this.app.hasActiveJobs)
      fail(
        "jobs.busy",
        "Wait for project jobs to finish before capturing a version.",
        409,
      );
    return this.app.catalog.withConsistentSnapshot((catalog, schemaVersion) => {
      const projectPath = join(this.app.directory, "project.json");
      const projectInfo = lstatSync(projectPath);
      if (
        projectInfo.isSymbolicLink() ||
        !projectInfo.isFile() ||
        projectInfo.size > MAX_PROJECT_BYTES
      )
        fail(
          "request.invalid",
          "The saved project manifest is unsafe or too large.",
        );
      const manifest = readFileSync(projectPath);
      let project: OpenFilmProject;
      try {
        project = validateProject(
          migrateProject(JSON.parse(manifest.toString("utf8"))),
        );
      } catch (error) {
        fail(
          "request.invalid",
          `The saved project manifest is invalid: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (
        project.id !== this.app.project.id ||
        savedScriptProjectIdentity(project) !==
          savedScriptProjectIdentity(this.app.project)
      )
        fail(
          "story.planConflict",
          "The saved project changed in another editor. Reopen it before working with versions.",
          409,
        );
      const projectHash = digest(manifest);
      const catalogHash = digest(catalog);
      const catalogRevision = inspectCatalogSnapshot(
        catalog,
        schemaVersion,
      ).logicalRevision;
      return {
        manifest,
        catalog,
        project,
        schemaVersion,
        projectHash,
        catalogHash,
        catalogRevision,
        revision: digest(
          `${savedScriptProjectIdentity(project)}:${catalogRevision}`,
        ),
      };
    });
  }

  currentRevision(): string {
    return this.capture().revision;
  }

  private receipt(
    index: VersionIndex,
    requestId: string,
  ): VersionReceipt | undefined {
    return index.receipts.find((receipt) => receipt.requestId === requestId);
  }

  private assertReceipt(
    receipt: VersionReceipt | undefined,
    fingerprint: string,
    kind: VersionReceipt["kind"],
  ): VersionReceipt | undefined {
    if (!receipt) return undefined;
    if (receipt.kind !== kind || receipt.fingerprint !== fingerprint)
      fail(
        "story.planConflict",
        "This request ID was already used for a different version operation.",
        409,
      );
    return receipt;
  }

  private packagePath(id: string): string {
    const clean = uuid(id, "version ID");
    const path = join(this.root, clean);
    if (dirname(path) !== this.root || basename(path) !== clean)
      fail("request.invalid", "Invalid version path.");
    return path;
  }

  private metadataRecord(
    entry: VersionIndexEntry,
    record: ProjectVersionRecord,
  ): ProjectVersionRecord {
    return validateProjectVersionRecord({
      ...record,
      name: entry.name,
      ...(entry.description === undefined
        ? { description: undefined }
        : { description: entry.description }),
    });
  }

  private recordFor(entry: VersionIndexEntry): ProjectVersionRecord {
    const directory = this.packagePath(entry.id);
    const dirInfo = lstatSync(directory);
    if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory())
      fail("request.invalid", "The named version folder is unsafe.");
    const path = join(directory, "record.json");
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 8 * 1024 * 1024)
      fail("request.invalid", "The named version record is unsafe.");
    const bytes = readFileSync(path);
    if (digest(bytes) !== entry.recordHash)
      fail(
        "request.invalid",
        "The named version record failed its integrity check.",
      );
    const record = validateProjectVersionRecord(
      JSON.parse(bytes.toString("utf8")),
    );
    if (record.projectId !== this.app.project.id || record.id !== entry.id)
      fail("request.invalid", "The named version belongs to another project.");
    return this.metadataRecord(entry, record);
  }

  private load(id: string): LoadedVersion {
    const index = this.readIndex();
    const entry = index.entries.find((item) => item.id === id);
    if (!entry) fail("request.notFound", "Named version was not found.", 404);
    const directory = this.packagePath(entry.id);
    const dirInfo = lstatSync(directory);
    if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory())
      fail("request.invalid", "The named version folder is unsafe.");
    const file = (name: string, maximum: number) => {
      const path = join(directory, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink() || !info.isFile() || info.size > maximum)
        fail("request.invalid", `The saved version ${name} file is invalid.`);
      return readFileSync(path);
    };
    const manifest = file("project.json", MAX_PROJECT_BYTES);
    const catalog = file("database.sqlite", CATALOG_SNAPSHOT_MAX_BYTES);
    const recordBytes = file("record.json", 8 * 1024 * 1024);
    if (
      manifest.length + catalog.length + recordBytes.length !==
      entry.payloadBytes
    )
      fail(
        "request.invalid",
        "The named version payload size does not match its index.",
      );
    if (digest(recordBytes) !== entry.recordHash)
      fail(
        "request.invalid",
        "The named version record failed its integrity check.",
      );
    const decoded = validateProjectVersionRecord(
      JSON.parse(recordBytes.toString("utf8")),
    );
    if (
      decoded.projectId !== this.app.project.id ||
      decoded.id !== entry.id ||
      digest(manifest) !== decoded.projectHash ||
      digest(catalog) !== decoded.catalogHash
    )
      fail(
        "request.invalid",
        "The named version payload failed its integrity check.",
      );
    validateCatalogImage(catalog, decoded.catalogSchemaVersion);
    let project: OpenFilmProject;
    try {
      project = validateProject(
        migrateProject(JSON.parse(manifest.toString("utf8"))),
      );
    } catch {
      fail("request.invalid", "The named version manifest is invalid.");
    }
    if (project.id !== this.app.project.id)
      fail("request.invalid", "The named version belongs to another project.");
    return {
      entry,
      record: this.metadataRecord(entry, decoded),
      manifest,
      catalog,
      project,
      directory,
    };
  }

  private rebaseTarget(target: LoadedVersion): {
    project: OpenFilmProject;
    assets: Map<string, MediaAsset>;
    changedAssets: MediaAsset[];
  } {
    const assets = snapshotAssets(target.catalog);
    const changedAssets: MediaAsset[] = [];
    const libraryIds = new Set<string>();
    const managedRoot = join(this.app.directory, "sources");
    const rootUri = pathToFileURL(managedRoot).href;
    for (const [id, asset] of assets) {
      const uri = managedSourceUri(this.app.directory, asset);
      if (!uri || uri === asset.uri) continue;
      const managed = asset.metadata["openfilm.managedSource"] as Record<
        string,
        unknown
      >;
      const reference = referenceFor(asset, target.project.mediaLibraries);
      const relativePath = relative(managedRoot, localPath(uri))
        .split(sep)
        .join("/");
      libraryIds.add(reference.mediaLibraryId);
      const thumbnailUri =
        asset.thumbnailUri &&
        portableCacheUri(asset, asset.thumbnailUri, "thumbnails");
      const proxyUri =
        asset.proxyUri && portableCacheUri(asset, asset.proxyUri, "proxies");
      const rebased: MediaAsset = {
        ...asset,
        uri,
        metadata: {
          ...asset.metadata,
          "openfilm.managedSource": { ...managed, uri },
          "openfilm.reference": { ...reference, rootUri, relativePath },
        },
        ...(thumbnailUri ? { thumbnailUri } : {}),
        ...(proxyUri ? { proxyUri } : {}),
      };
      assets.set(id, rebased);
      changedAssets.push(rebased);
    }
    const project =
      libraryIds.size === 0
        ? target.project
        : {
            ...target.project,
            mediaLibraries: target.project.mediaLibraries.map((library) =>
              libraryIds.has(library.id)
                ? { ...library, uri: rootUri }
                : library,
            ),
          };
    return { project, assets, changedAssets };
  }

  private async referencesFor(
    project: OpenFilmProject,
    catalog: Buffer,
  ): Promise<ProjectVersionSourceReference[]> {
    const assets = snapshotAssets(catalog);
    const ids = [...referencedAssetIds(project)].sort();
    if (ids.length > PROJECT_VERSION_LIMITS.sourceReferences)
      fail(
        "request.tooLarge",
        "This project references too many source assets to version.",
        413,
      );
    const refs: ProjectVersionSourceReference[] = [];
    for (const id of ids) {
      const asset = assets.get(id);
      if (!asset)
        fail(
          "media.missing",
          `Referenced source ${id} is missing from the project catalog.`,
          409,
        );
      refs.push(await sourceReference(this.app.directory, asset));
    }
    return refs;
  }

  private publicRecord(entry: VersionIndexEntry): ProjectVersionRecord {
    return this.recordFor(entry);
  }

  async create(
    input: ProjectVersionCreateInput,
  ): Promise<ProjectVersionRecord> {
    const data = plain(input, "Create version input");
    if (
      Object.keys(data).some(
        (key) =>
          !["name", "description", "baseRevision", "requestId"].includes(key),
      )
    )
      fail("request.invalid", "Unsupported create-version field.");
    const name = text(
      data.name,
      "Version name",
      PROJECT_VERSION_LIMITS.nameCharacters,
    );
    const description =
      data.description === undefined
        ? undefined
        : text(
            data.description,
            "Version description",
            PROJECT_VERSION_LIMITS.descriptionCharacters,
          );
    const baseRevision = revision(data.baseRevision, "baseRevision");
    const requestId = uuid(data.requestId, "requestId");
    const fingerprint = digest(
      JSON.stringify({ kind: "create", name, description, baseRevision }),
    );
    const before = this.readIndex();
    const prior = this.assertReceipt(
      this.receipt(before, requestId),
      fingerprint,
      "create",
    );
    if (prior) {
      const entry = before.entries.find((item) => item.id === prior.versionId);
      if (!entry)
        fail(
          "request.notFound",
          "This named version was explicitly deleted.",
          404,
        );
      return this.publicRecord(entry);
    }
    const snapshot = this.capture();
    if (snapshot.revision !== baseRevision)
      fail(
        "story.planConflict",
        "The project changed. Refresh its revision and retry creating the version.",
        409,
      );
    const sourceReferences = await this.referencesFor(
      snapshot.project,
      snapshot.catalog,
    );
    if (this.currentRevision() !== snapshot.revision)
      fail(
        "story.planConflict",
        "The project changed while sources were being verified. Refresh and retry.",
        409,
      );
    const now = new Date().toISOString();
    const id = randomUUID();
    const currentIndex = this.readIndex();
    const parentVersionId = currentIndex.entries.at(-1)?.id;
    const record = validateProjectVersionRecord({
      version: 1,
      id,
      projectId: snapshot.project.id,
      name,
      ...(description === undefined ? {} : { description }),
      createdAt: now,
      ...(parentVersionId ? { parentVersionId } : {}),
      requestId,
      projectRevision: snapshot.revision,
      projectHash: snapshot.projectHash,
      catalogHash: snapshot.catalogHash,
      catalogSchemaVersion: snapshot.schemaVersion,
      softwareVersion: applicationManifest.version,
      sourceReferences,
    });
    const recordBytes = Buffer.from(
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );
    const payloadBytes =
      snapshot.manifest.length + snapshot.catalog.length + recordBytes.length;
    const index = this.readIndex();
    if (index.entries.length >= PROJECT_VERSION_LIMITS.count)
      fail(
        "request.tooLarge",
        `The project already has ${PROJECT_VERSION_LIMITS.count} named versions. Remove or archive a version explicitly before creating another.`,
        413,
      );
    if (
      index.entries.reduce(
        (total, entry) => total + entry.payloadBytes,
        payloadBytes,
      ) > PROJECT_VERSION_LIMITS.totalBytes
    )
      fail(
        "request.tooLarge",
        "Named versions reached their project storage limit. Archive project versions before retrying.",
        413,
      );
    if (payloadBytes > PROJECT_VERSION_LIMITS.totalBytes)
      fail(
        "request.tooLarge",
        "This version exceeds the project storage limit.",
        413,
      );

    this.ensureRoot(true);
    const staging = join(this.root, `.stage-${randomUUID()}`);
    const destination = this.packagePath(id);
    mkdirSync(staging, { mode: 0o700 });
    let published = false;
    let resolvedId: string = id;
    try {
      writeFileDurably(join(staging, "project.json"), snapshot.manifest);
      writeFileDurably(join(staging, "database.sqlite"), snapshot.catalog);
      writeFileDurably(join(staging, "record.json"), recordBytes);
      syncDirectory(staging);
      if (
        digest(readFileSync(join(staging, "project.json"))) !==
          record.projectHash ||
        digest(readFileSync(join(staging, "database.sqlite"))) !==
          record.catalogHash
      )
        fail(
          "request.invalid",
          "The staged named version failed its integrity check.",
        );
      // A second source pass fences edits that occur while the package is staged.
      const afterRefs = await this.referencesFor(
        snapshot.project,
        snapshot.catalog,
      );
      if (
        JSON.stringify(afterRefs) !== JSON.stringify(sourceReferences) ||
        this.currentRevision() !== snapshot.revision
      )
        fail(
          "story.planConflict",
          "Project sources or saved state changed while the version was being published.",
          409,
        );
      const entry: VersionIndexEntry = {
        id,
        name,
        ...(description === undefined ? {} : { description }),
        createdAt: now,
        requestId,
        baseRevision,
        payloadBytes,
        recordHash: digest(recordBytes),
      };
      this.app.catalog.withProjectWrite(() => {
        const latest = this.readIndex();
        const existing = this.assertReceipt(
          this.receipt(latest, requestId),
          fingerprint,
          "create",
        );
        if (existing) {
          if (!latest.entries.some((item) => item.id === existing.versionId))
            fail(
              "request.notFound",
              "This named version was explicitly deleted.",
              404,
            );
          resolvedId = existing.versionId;
          return;
        }
        if (
          latest.entries.length >= PROJECT_VERSION_LIMITS.count ||
          latest.entries.reduce(
            (total, item) => total + item.payloadBytes,
            payloadBytes,
          ) > PROJECT_VERSION_LIMITS.totalBytes
        )
          fail(
            "request.tooLarge",
            "Named version storage filled while the snapshot was prepared. Retry after freeing project space.",
            413,
          );
        renameSync(staging, destination);
        published = true;
        const receipt: VersionReceipt = {
          requestId,
          fingerprint,
          kind: "create",
          versionId: id,
        };
        const next: VersionIndex = {
          ...latest,
          entries: [...latest.entries, entry],
          receipts: [...latest.receipts, receipt].slice(-1000),
        };
        atomicJson(this.indexPath, next);
      });
      if (existsSync(staging))
        rmSync(staging, { recursive: true, force: true });
      return this.publicRecord(
        this.readIndex().entries.find((item) => item.id === resolvedId)!,
      );
    } catch (error) {
      if (published) {
        try {
          if (!this.readIndex().entries.some((entry) => entry.id === id))
            rmSync(destination, { recursive: true, force: true });
        } catch {
          // Keep an uncertain package rather than deleting an indexed version.
        }
      }
      if (existsSync(staging))
        rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }

  /** Explicit deletion frees capacity without changing the saved project or media. */
  remove(
    id: string,
    input: { baseRevision: string; confirmed: boolean },
  ): { removedVersionId: string } {
    const versionId = uuid(id, "version ID");
    const data = plain(input, "Delete version input");
    if (
      Object.keys(data).some(
        (field) => !["baseRevision", "confirmed"].includes(field),
      )
    )
      fail("request.invalid", "Unsupported delete-version field.");
    if (data.confirmed !== true)
      fail(
        "request.invalid",
        "Deleting a named version requires explicit confirmation.",
      );
    const baseRevision = revision(data.baseRevision, "baseRevision");
    const before = this.capture();
    if (before.revision !== baseRevision)
      fail(
        "story.planConflict",
        "The project changed. Refresh before deleting a version.",
        409,
      );
    this.app.catalog.withProjectWrite(() => {
      this.assertRestoreBaseline(before, () => {});
      if (existsSync(this.journalPath))
        fail(
          "jobs.busy",
          "Finish restore recovery before deleting a version.",
          409,
        );
      const index = this.readIndex();
      const directory = this.packagePath(versionId);
      if (!existsSync(directory)) {
        if (index.entries.some((entry) => entry.id === versionId))
          fail("request.invalid", "The named version folder is missing.");
        return;
      }
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        fail("request.invalid", "The named version folder is unsafe.");
      // Publish the index first: interrupted cleanup cannot leave a live entry
      // pointing at a partially removed snapshot. Request receipts remain tombstones.
      atomicJson(this.indexPath, {
        ...index,
        entries: index.entries.filter((entry) => entry.id !== versionId),
      });
      rmSync(directory, { recursive: true, force: true });
      syncDirectory(this.root);
    });
    return { removedVersionId: versionId };
  }

  list(): ProjectVersionRecord[] {
    return this.readIndex().entries.map((entry) => this.publicRecord(entry));
  }

  inspect(id: string) {
    const loaded = this.load(id);
    return {
      record: loaded.record,
      summary: projectSummary(loaded.project),
      catalogSchemaVersion: loaded.record.catalogSchemaVersion,
    };
  }

  diff(beforeId: string, afterId: string): ProjectVersionDiff {
    const before = this.load(beforeId);
    const after = this.load(afterId);
    return diffProjectVersions(
      {
        versionId: before.entry.id,
        project: before.project,
        sourceReferences: before.record.sourceReferences,
      },
      {
        versionId: after.entry.id,
        project: after.project,
        sourceReferences: after.record.sourceReferences,
      },
    );
  }

  rename(
    id: string,
    input: { name: string; description?: string | null },
  ): ProjectVersionRecord {
    const versionId = uuid(id, "version ID");
    const data = plain(input, "Rename version input");
    if (Object.keys(data).some((key) => !["name", "description"].includes(key)))
      fail("request.invalid", "Unsupported rename-version field.");
    const name = text(
      data.name,
      "Version name",
      PROJECT_VERSION_LIMITS.nameCharacters,
    );
    const description =
      data.description === undefined
        ? undefined
        : data.description === null
          ? null
          : text(
              data.description,
              "Version description",
              PROJECT_VERSION_LIMITS.descriptionCharacters,
            );
    let updated: VersionIndexEntry | undefined;
    this.app.catalog.withProjectWrite(() => {
      const index = this.readIndex();
      const entry = index.entries.find((item) => item.id === versionId);
      if (!entry) fail("request.notFound", "Named version was not found.", 404);
      updated = { ...entry, name };
      if (description === null) delete updated.description;
      else if (description !== undefined) updated.description = description;
      const entries = index.entries.map((item) =>
        item.id === versionId ? updated! : item,
      );
      atomicJson(this.indexPath, { ...index, entries });
    });
    return this.publicRecord(updated!);
  }

  private async assertNoLockConflicts(
    current: OpenFilmProject,
    target: LoadedVersion,
    targetAssets: Map<string, MediaAsset>,
  ): Promise<void> {
    const currentLockedIds = new Set(
      [...this.app.catalog.iterateAssetSummaries()]
        .filter((asset) => asset.state.locked)
        .map((asset) => asset.id),
    );
    const protectedIds = new Set(currentLockedIds);
    for (const [id, asset] of targetAssets)
      if (asset.state.locked) protectedIds.add(id);
    for (const id of protectedIds) {
      const currentAsset = this.app.catalog.getAsset(id);
      const targetAsset = targetAssets.get(id);
      if (
        !currentAsset ||
        !targetAsset ||
        !currentLockedIds.has(id) ||
        !targetAsset.state.locked ||
        canonicalJson(currentAsset) !== canonicalJson(targetAsset)
      )
        fail(
          "timeline.conflict",
          `Restore would remove or change locked source ${id}. Unlock it before restoring this version.`,
          409,
        );
      const [currentIdentity, targetIdentity] = await Promise.all([
        sourceReference(this.app.directory, currentAsset),
        sourceReference(this.app.directory, targetAsset),
      ]);
      if (
        currentIdentity.sha256 !== targetIdentity.sha256 ||
        currentIdentity.sizeBytes !== targetIdentity.sizeBytes
      )
        fail(
          "timeline.conflict",
          `Restore would change locked source ${id}. Unlock it before restoring this version.`,
          409,
        );
    }
    const currentClips = clipMap(current);
    const targetClips = clipMap(target.project);
    for (const [key, clip] of currentClips) {
      if (!(clip as { locked?: boolean }).locked) continue;
      if (canonicalJson(clip) !== canonicalJson(targetClips.get(key)))
        fail(
          "timeline.conflict",
          "Restore would change or remove a locked clip. Unlock it before restoring this version.",
          409,
        );
    }
  }

  private async verifySources(
    version: LoadedVersion,
    assets: Map<string, MediaAsset>,
  ): Promise<void> {
    for (const source of version.record.sourceReferences) {
      const asset = assets.get(source.assetId);
      if (!asset || asset.mediaType !== source.mediaType)
        fail(
          "media.missing",
          `Source ${source.assetId} is missing from the saved version catalog. Relink media before restoring.`,
          409,
        );
      const actual = await sourceReference(this.app.directory, asset);
      if (
        actual.sha256 !== source.sha256 ||
        actual.sizeBytes !== source.sizeBytes
      )
        fail(
          "media.missing",
          `Source ${source.assetId} is missing or changed. Relink the original media before restoring this version.`,
          409,
        );
    }
  }

  private readSavedProject(): OpenFilmProject | undefined {
    try {
      const path = join(this.app.directory, "project.json");
      const info = lstatSync(path);
      if (
        info.isSymbolicLink() ||
        !info.isFile() ||
        info.size > MAX_PROJECT_BYTES
      )
        return undefined;
      const project = validateProject(
        migrateProject(JSON.parse(readFileSync(path, "utf8"))),
      );
      return project.id === this.app.project.id ? project : undefined;
    } catch {
      return undefined;
    }
  }

  private assertRestoreBaseline(before: Snapshot, conflict: () => void): void {
    const project = this.readSavedProject();
    if (
      !project ||
      digest(
        `${savedScriptProjectIdentity(project)}:${this.app.catalog.logicalRevision()}`,
      ) !== before.revision
    ) {
      conflict();
      fail(
        "story.planConflict",
        "The project changed while the restore was being checked. Refresh and retry.",
        409,
      );
    }
  }

  private assertRestoreManifest(before: Snapshot, conflict: () => void): void {
    const project = this.readSavedProject();
    if (
      !project ||
      savedScriptProjectIdentity(project) !==
        savedScriptProjectIdentity(before.project)
    ) {
      conflict();
      fail(
        "story.planConflict",
        "The saved project changed before restore publication. Refresh and retry.",
        409,
      );
    }
  }

  async restore(
    id: string,
    input: ProjectVersionRestoreInput,
  ): Promise<ProjectVersionRestoreResult> {
    const versionId = uuid(id, "version ID");
    const data = plain(input, "Restore version input");
    if (
      Object.keys(data).some(
        (key) => !["baseRevision", "requestId", "confirmed"].includes(key),
      )
    )
      fail("request.invalid", "Unsupported restore-version field.");
    if (data.confirmed !== true)
      fail(
        "request.invalid",
        "Restoring a named version requires explicit confirmation.",
      );
    const baseRevision = revision(data.baseRevision, "baseRevision");
    const requestId = uuid(data.requestId, "requestId");
    const fingerprint = digest(
      JSON.stringify({ kind: "restore", versionId, baseRevision }),
    );
    const initialIndex = this.readIndex();
    const prior = this.assertReceipt(
      this.receipt(initialIndex, requestId),
      fingerprint,
      "restore",
    );
    if (prior?.checkpointVersionId)
      return {
        restoredVersionId: prior.versionId,
        checkpointVersionId: prior.checkpointVersionId,
      };
    if (this.app.hasActiveJobs)
      fail(
        "jobs.busy",
        "Wait for project jobs to finish before restoring a version.",
        409,
      );
    const before = this.capture();
    if (before.revision !== baseRevision)
      fail(
        "story.planConflict",
        "The project changed. Refresh before confirming this restore.",
        409,
      );
    const target = this.load(versionId);
    const rebasedTarget = this.rebaseTarget(target);
    await this.verifySources(target, rebasedTarget.assets);
    await this.assertNoLockConflicts(
      before.project,
      target,
      rebasedTarget.assets,
    );
    if (this.currentRevision() !== before.revision)
      fail(
        "story.planConflict",
        "The project changed while the restore was being checked. Refresh and retry.",
        409,
      );

    const checkpointName = `Before restore: ${target.entry.name}`.slice(
      0,
      PROJECT_VERSION_LIMITS.nameCharacters,
    );
    const checkpoint = await this.create({
      name: checkpointName,
      description: `Automatic recovery checkpoint before restoring ${target.entry.name}.`,
      baseRevision,
      requestId: randomUUID(),
    });
    // Checkpoint capture can hash a different set of assets for a long time.
    // Recheck target-only dependencies before any destructive publication.
    await this.verifySources(target, rebasedTarget.assets);
    const checkpointId = checkpoint.id;
    const receipt: VersionReceipt = {
      requestId,
      fingerprint,
      kind: "restore",
      versionId,
      checkpointVersionId: checkpointId,
    };
    // Deletion shares this lock. Either it finishes first and aborts restore,
    // or the published journal protects the live recovery checkpoint from removal.
    this.app.catalog.withProjectWrite(() => {
      this.assertRestoreBaseline(before, () => {});
      const recovery = this.load(checkpointId);
      if (recovery.record.projectRevision !== before.revision)
        fail(
          "story.planConflict",
          "The recovery checkpoint no longer matches the current project.",
          409,
        );
      this.writeJournal({
        version: 1,
        targetVersionId: versionId,
        checkpointVersionId: checkpointId,
        requestId,
        fingerprint,
        stage: "applying",
      });
    });
    let staleDuringRestore = false;
    let restoreManifestPublished = false;
    const markStale = () => {
      staleDuringRestore = true;
    };
    try {
      this.app.catalog.restoreFromSnapshot(
        join(target.directory, "database.sqlite"),
        () => {
          this.assertRestoreManifest(before, markStale);
          for (const asset of rebasedTarget.changedAssets)
            this.app.catalog.upsertAsset(asset);
          atomicJson(
            join(this.app.directory, "project.json"),
            rebasedTarget.project,
            () => this.assertRestoreManifest(before, markStale),
            () => {
              restoreManifestPublished = true;
            },
          );
        },
        () => this.assertRestoreBaseline(before, markStale),
      );
      this.app.acceptRestoredProject(rebasedTarget.project);
      this.app.catalog.withProjectWrite(() => {
        const index = this.readIndex();
        const existing = this.assertReceipt(
          this.receipt(index, requestId),
          fingerprint,
          "restore",
        );
        if (existing) return;
        atomicJson(this.indexPath, {
          ...index,
          receipts: [...index.receipts, receipt].slice(-1000),
        });
      });
      this.writeJournal({
        version: 1,
        targetVersionId: versionId,
        checkpointVersionId: checkpointId,
        requestId,
        fingerprint,
        stage: "published",
      });
      this.removeJournal();
      return {
        restoredVersionId: versionId,
        checkpointVersionId: checkpointId,
      };
    } catch (error) {
      if (staleDuringRestore || !restoreManifestPublished) {
        this.removeJournal();
        throw error;
      }
      try {
        this.recoverInterruptedRestore();
      } catch (recoveryError) {
        throw new ProjectVersionError(
          "operation.failed",
          `Restore failed and its recovery journal was retained: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
          500,
        );
      }
      throw error;
    }
  }

  private writeJournal(value: unknown): void {
    this.ensureRoot(true);
    atomicJson(this.journalPath, value);
  }

  private removeJournal(): void {
    if (existsSync(this.journalPath)) {
      const info = lstatSync(this.journalPath);
      if (info.isSymbolicLink() || !info.isFile())
        fail("request.invalid", "The project restore journal is unsafe.");
      rmSync(this.journalPath, { force: true });
      syncDirectory(this.root);
    }
  }

  /** Roll back a process interrupted between SQLite and manifest publication. */
  recoverInterruptedRestore(): void {
    if (!this.ensureRoot(false) || !existsSync(this.journalPath)) return;
    const info = lstatSync(this.journalPath);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 16 * 1024)
      fail("request.invalid", "The project restore journal is unsafe.");
    const journal = plain(
      JSON.parse(readFileSync(this.journalPath, "utf8")),
      "Restore journal",
    );
    if (
      Object.keys(journal).some(
        (key) =>
          ![
            "version",
            "targetVersionId",
            "checkpointVersionId",
            "requestId",
            "fingerprint",
            "stage",
          ].includes(key),
      ) ||
      journal.version !== 1 ||
      (journal.stage !== "applying" && journal.stage !== "published")
    )
      fail("request.invalid", "The project restore journal is invalid.");
    const requestId = uuid(journal.requestId, "restore request ID");
    const fingerprint = revision(journal.fingerprint, "restore fingerprint");
    const checkpointId = uuid(
      journal.checkpointVersionId,
      "checkpoint version ID",
    );
    const targetId = uuid(journal.targetVersionId, "target version ID");
    const receipt = this.receipt(this.readIndex(), requestId);
    if (
      (receipt &&
        (receipt.kind !== "restore" ||
          receipt.fingerprint !== fingerprint ||
          receipt.versionId !== targetId ||
          receipt.checkpointVersionId !== checkpointId)) ||
      (journal.stage === "published" && !receipt)
    )
      fail(
        "request.invalid",
        "The project restore journal does not match its saved receipt.",
      );
    if (journal.stage === "published" || receipt) {
      this.removeJournal();
      return;
    }
    const checkpoint = this.load(checkpointId);
    this.app.catalog.restoreFromSnapshot(
      join(checkpoint.directory, "database.sqlite"),
      () =>
        atomicJson(
          join(this.app.directory, "project.json"),
          JSON.parse(checkpoint.manifest.toString("utf8")),
        ),
    );
    this.app.acceptRestoredProject(checkpoint.project);
    this.removeJournal();
  }
}
