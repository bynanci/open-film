// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
import { createHash } from "node:crypto";
import { constants, lstatSync, readFileSync, createWriteStream } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import {
  ApplicationError,
  captionAssetState,
  graphicSceneAssetIds,
  migrateProject,
  resolveTitleStyle,
  validateProject,
  type MediaAsset,
  type OpenFilmProject,
  type TitleStyle,
  frameAlignedDuration,
} from "@openfilm/core";
import {
  CATALOG_SCHEMA_VERSION,
  createPortableCatalogSnapshot,
  inspectCatalogSnapshot,
} from "@openfilm/catalog";
import { checkAbort, hashFile, localPath, runProcess } from "@openfilm/media";
import { resolveTitleFont } from "@openfilm/render";
import { savedScriptProjectIdentity } from "./scene-script-review.js";
import {
  extractStoredZip,
  isNestedArchiveFile,
  writeStoredZip,
} from "./collect-archive.js";
import type { OpenFilmApplication } from "./index.js";

const MANIFEST_FILE = "collect-manifest.json";
const MANIFEST_FORMAT = "openfilm.collect-media" as const;
const MANIFEST_VERSION = 1 as const;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 0xffff_ffff;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_SOURCE_COUNT = 10_000;
const SHA_PATTERN = /^[a-f0-9]{64}$/u;
const SECRET_KEY = /(?:api.?key|secret|password|credential|access.?token)/iu;

export type CollectMediaScope = "current-film" | "entire-project";
export type CollectRightsBasis =
  "owned" | "licensed" | "cc0" | "public-domain" | "other";

export interface CollectRightsDeclaration {
  resourceId: string;
  basis: CollectRightsBasis;
  confirmed: true;
  licenseName?: string;
  attribution?: string;
}

export interface CollectPlanInput {
  scope: CollectMediaScope;
  /** Required for current-film; identifies an existing saved Composition. */
  compositionId?: string;
  rightsDeclarations?: CollectRightsDeclaration[];
}

export interface CollectMediaPlanItem {
  resourceId: string;
  kind: "media" | "font";
  displayName: string;
  mediaType?: MediaAsset["mediaType"] | "font";
  sha256?: string;
  size?: number;
  rightsDeclared: boolean;
  rightsBasis?: CollectRightsBasis;
  licenseName?: string;
  attribution?: string;
  status: "ready" | "blocked";
  issues: string[];
}

export interface CollectMediaPlan {
  id: string;
  projectId: string;
  revision: string;
  scope: CollectMediaScope;
  storyIds: string[];
  compositionIds: string[];
  items: CollectMediaPlanItem[];
  totalBytes: number;
  uniqueMediaBytes: number;
  complete: boolean;
  versionsIncluded: false;
  issues: { code: string; severity: "block" | "warning"; itemId?: string }[];
}

export interface CollectMediaCreateInput extends CollectPlanInput {
  planId: string;
  baseRevision: string;
  destination: string;
  format: "directory" | "zip";
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface CollectMediaCreateResult {
  format: "directory" | "zip";
  fileName: string;
  projectId: string;
  sourceCount: number;
  uniqueSourceCount: number;
  fontCount: number;
  packageBytes: number;
  manifestSha256: string;
  versionsIncluded: false;
}

export interface CollectMediaVerifyResult {
  verified: true;
  projectId: string;
  sourceCount: number;
  fontCount: number;
  compositionId: string;
  previewSha256: string;
  outputSha256: string;
  outputWidth: number;
  outputHeight: number;
  outputFrameRate: string;
  outputFrames: number;
  outputDurationSeconds: number;
  outputAudio?: { codec: string; sampleRate: number; channels: number };
  warnings: string[];
  versionsIncluded: false;
}

interface CapturedProject {
  project: OpenFilmProject;
  manifest: Buffer;
  catalog: Buffer;
  assets: MediaAsset[];
  revision: string;
}

interface PreparedSource {
  asset: MediaAsset;
  path: string;
  sha256: string;
  size: number;
  relativePath: string;
  uri: string;
}

interface PreparedFont {
  sha256: string;
  size: number;
  path: string;
  relativePath: string;
  family: string;
  postscriptName: string;
  bindings: { family: string; weight: number }[];
  warnings: string[];
}

interface CollectManifestFile {
  path: string;
  size: number;
  sha256: string;
}

interface CollectManifest {
  format: typeof MANIFEST_FORMAT;
  version: typeof MANIFEST_VERSION;
  projectId: string;
  projectRevision: string;
  createdAt: string;
  scope: CollectMediaScope;
  storyIds: string[];
  compositionIds: string[];
  files: CollectManifestFile[];
  assets: {
    id: string;
    name: string;
    mediaType: MediaAsset["mediaType"];
    sha256: string;
    size: number;
    path: string;
    originalUriDigest: string;
  }[];
  fonts: {
    sha256: string;
    size: number;
    path: string;
    family: string;
    postscriptName: string;
    bindings: { family: string; weight: number }[];
  }[];
  rights: Omit<CollectRightsDeclaration, "confirmed">[];
  versionsIncluded: false;
  pathPrivacy: "original-uri-sha256-only";
}

export class CollectMediaError extends ApplicationError {
  override name = "CollectMediaError";
}

function fail(
  code: ConstructorParameters<typeof ApplicationError>[0],
  message: string,
  status = 400,
  detail = message,
): never {
  throw new CollectMediaError(code, message, status, undefined, detail);
}

function digest(value: string | Buffer | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function plain(value: unknown, where: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail("request.invalid", `${where} must be a plain object.`);
  return value as Record<string, unknown>;
}

function safeIdentifier(value: unknown, where: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 512 ||
    /^(?:file:|[a-z]:[\\/]|\\\\|\/)/iu.test(value) ||
    [...value].some((character) => {
      const point = character.codePointAt(0)!;
      return (
        point < 32 || point === 127 || (point >= 0xd800 && point <= 0xdfff)
      );
    })
  )
    fail("request.invalid", `${where} must be a nonempty identifier.`);
  return value;
}

function safeMediaLibraryId(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 512 ||
    /^(?:file:|[a-z]:[\\/]|\\\\|\/)/iu.test(value) ||
    SECRET_KEY.test(value)
  )
    return undefined;
  return value;
}

function safeText(value: unknown, where: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    [...value].some((character) => {
      const point = character.codePointAt(0)!;
      return (
        point < 32 || point === 127 || (point >= 0xd800 && point <= 0xdfff)
      );
    }) ||
    /^(?:file:|[a-z]:[\\/]|\\\\|\/)/iu.test(value) ||
    /(?:file:\/\/|\b[a-z]:[\\/]|\\\\|(?<![\w:])\/(?!\/)(?:[^/\s]+\/){1,}[^\s"'<>)]*)/iu.test(
      value,
    ) ||
    SECRET_KEY.test(value)
  )
    fail(
      "request.invalid",
      `${where} must be safe text of at most ${maximum} characters.`,
    );
  return value.trim();
}

function validateRights(input: unknown): Map<string, CollectRightsDeclaration> {
  if (input === undefined) return new Map();
  if (!Array.isArray(input) || input.length > MAX_SOURCE_COUNT + 256)
    fail("request.invalid", "Rights declarations must be a bounded list.");
  const result = new Map<string, CollectRightsDeclaration>();
  for (const [index, raw] of input.entries()) {
    const item = plain(raw, `rightsDeclarations[${index}]`);
    const allowed = [
      "resourceId",
      "basis",
      "confirmed",
      "licenseName",
      "attribution",
    ];
    if (Object.keys(item).some((key) => !allowed.includes(key)))
      fail(
        "request.invalid",
        "A rights declaration contains an unknown field.",
      );
    const resourceId = safeText(item.resourceId, "resourceId", 300);
    if (
      item.confirmed !== true ||
      !["owned", "licensed", "cc0", "public-domain", "other"].includes(
        String(item.basis),
      ) ||
      result.has(resourceId)
    )
      fail("request.invalid", "Confirm each unique media rights declaration.");
    const basis = item.basis as CollectRightsBasis;
    const licenseName =
      item.licenseName === undefined
        ? undefined
        : safeText(item.licenseName, "licenseName", 120);
    const attribution =
      item.attribution === undefined
        ? undefined
        : safeText(item.attribution, "attribution", 512);
    if (basis !== "owned" && !licenseName)
      fail("request.invalid", "Name the license or rights basis.");
    result.set(resourceId, {
      resourceId,
      basis,
      confirmed: true,
      ...(licenseName ? { licenseName } : {}),
      ...(attribution ? { attribution } : {}),
    });
  }
  return result;
}

function validatePlanInput(input: CollectPlanInput): {
  scope: CollectMediaScope;
  compositionId?: string;
  rights: Map<string, CollectRightsDeclaration>;
} {
  const data = plain(input, "Collect plan");
  if (
    Object.keys(data).some(
      (key) => !["scope", "compositionId", "rightsDeclarations"].includes(key),
    )
  )
    fail("request.invalid", "Collect plan contains an unknown field.");
  if (
    !(["current-film", "entire-project"] as const).includes(data.scope as never)
  )
    fail("request.invalid", "Choose current-film or entire-project scope.");
  const scope = data.scope as CollectMediaScope;
  const compositionId =
    data.compositionId === undefined
      ? undefined
      : safeIdentifier(data.compositionId, "Composition ID");
  if (scope === "current-film" && compositionId === undefined)
    fail(
      "request.invalid",
      "Choose a saved Composition for current-film scope.",
    );
  return {
    scope,
    ...(compositionId === undefined ? {} : { compositionId }),
    rights: validateRights(data.rightsDeclarations),
  };
}

function cleanDisplayName(value: string): string {
  const last = value.split(/[\\/]/u).at(-1) ?? "media";
  const clean = [...last]
    .filter((character) => {
      const point = character.codePointAt(0)!;
      return point >= 32 && point !== 127 && point !== 0;
    })
    .join("")
    .trim();
  return clean.slice(-256) || "media";
}

function noPrivateMetadata(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(
      /file:\/\/[^\s"'<>)]*|(?<![\w:])(?:[a-z]:[\\/]|\\\\|\/(?!\/))[^\s"'<>)]*/giu,
      (pathValue) => `openfilm-origin:${digest(pathValue)}`,
    );
  }
  if (Array.isArray(value)) return value.map(noPrivateMetadata);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, child]) => [key, noPrivateMetadata(child)]),
    );
  }
  return value;
}

function sourceExtension(
  name: string,
  mediaType: MediaAsset["mediaType"],
): string {
  const extension = extname(cleanDisplayName(name)).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/u.test(extension)) return extension;
  return mediaType === "audio"
    ? ".audio"
    : mediaType === "image"
      ? ".image"
      : ".video";
}

function packageSourcePath(sha256: string, extension: string): string {
  return `sources/${sha256.slice(0, 2)}/${sha256}${extension}`;
}

function packageAssetUri(assetId: string): string {
  return `openfilm-package://assets/${digest(assetId)}`;
}

function sourceOriginalUriDigest(asset: MediaAsset): string {
  const reference = asset.metadata["openfilm.reference"] as
    { originalUriDigest?: unknown } | undefined;
  return typeof reference?.originalUriDigest === "string" &&
    SHA_PATTERN.test(reference.originalUriDigest)
    ? reference.originalUriDigest
    : digest(asset.uri);
}

function packagedAsset(
  source: MediaAsset,
  sha256: string,
  size: number,
  relativePath: string,
): MediaAsset {
  const metadata = noPrivateMetadata(source.metadata) as Record<
    string,
    unknown
  >;
  const originalUriDigest = sourceOriginalUriDigest(source);
  metadata["openfilm.reference"] = {
    originalUri: `openfilm-origin:${originalUriDigest}`,
    originalUriDigest,
    contentHash: sha256,
    fileSize: size,
    filename: cleanDisplayName(source.name),
    mediaLibraryId:
      safeMediaLibraryId(
        (
          source.metadata["openfilm.reference"] as
            { mediaLibraryId?: unknown } | undefined
        )?.mediaLibraryId,
      ) ?? null,
    relativePath,
    rootUri: "openfilm-package://sources",
    volumeId: "collected-package",
  };
  metadata["openfilm.managedSource"] = {
    uri: packageAssetUri(source.id),
    relativePath,
  };
  const asset: MediaAsset = {
    ...structuredClone(source),
    name: cleanDisplayName(source.name),
    tags: source.tags.filter(
      (tag) => !/^(?:file:|[a-z]:[\\/]|\\\\|\/)/iu.test(tag),
    ),
    uri: packageAssetUri(source.id),
    contentHash: sha256,
    metadata,
  };
  delete asset.thumbnailUri;
  delete asset.proxyUri;
  return asset;
}

function fontBindingKey(family: string, weight: number): string {
  return `${family.toLowerCase().replace(/[\s_-]/gu, "")}:${weight}`;
}

export function packagedFontBindingKey(family: string, weight: number): string {
  return fontBindingKey(family, weight);
}

export function collectFontPathForStyle(
  bindings: ReadonlyMap<string, string>,
  style: TitleStyle | undefined,
  frame: { width: number; height: number },
): string | undefined {
  const resolved = resolveTitleStyle(style, frame);
  return bindings.get(fontBindingKey(resolved.fontFamily, resolved.fontWeight));
}

function collectStoryIds(
  project: OpenFilmProject,
  compositionIds: readonly string[],
  scope: CollectMediaScope,
): string[] {
  if (scope === "entire-project") return project.stories.map((item) => item.id);
  const selected = new Set(compositionIds);
  return project.timelines
    .filter((composition) => selected.has(composition.id))
    .map((composition) => composition.storyId);
}

function referencedAssetIds(
  project: OpenFilmProject,
  storyIds: readonly string[],
  compositionIds: readonly string[],
): string[] {
  const ids = new Set<string>();
  const add = (id: unknown) => {
    if (typeof id === "string" && id.length > 0) ids.add(id);
  };
  const selectedStories = new Set(storyIds);
  for (const story of project.stories) {
    if (!selectedStories.has(story.id)) continue;
    for (const beat of story.beats) {
      for (const id of beat.candidateAssetIds ?? []) add(id);
      for (const id of beat.selectedAssetIds ?? []) add(id);
      for (const constraint of beat.constraints ?? [])
        if ("assetIds" in constraint)
          for (const id of constraint.assetIds) add(id);
    }
  }
  const selectedCompositions = new Set(compositionIds);
  for (const composition of project.timelines) {
    if (!selectedCompositions.has(composition.id)) continue;
    for (const track of composition.tracks)
      for (const clip of track.clips) {
        add(clip.assetId);
        if (clip.layout?.secondary) add(clip.layout.secondary.assetId);
      }
    for (const id of graphicSceneAssetIds(composition.graphicScenes ?? []))
      add(id);
  }
  return [...ids].sort();
}

function collectTitleStyles(
  project: OpenFilmProject,
  compositionIds: readonly string[],
): TitleStyle[] {
  const selected = new Set(compositionIds);
  const styles: TitleStyle[] = [];
  const addNodes = (nodes: readonly import("@openfilm/core").GraphicNode[]) => {
    for (const node of nodes) {
      if (node.type === "group") addNodes(node.children);
      else if (node.type === "text")
        styles.push({
          version: 1,
          role: "scene-statement",
          fontFamily: node.fontFamily,
          fontWeight: node.fontWeight,
          fontSize: node.fontSize,
        });
    }
  };
  for (const composition of project.timelines) {
    if (!selected.has(composition.id)) continue;
    for (const track of composition.tracks)
      for (const clip of track.clips)
        if (clip.title)
          styles.push(clip.titleStyle ?? { version: 1, role: "subtitle" });
    for (const track of composition.captionTracks ?? [])
      styles.push(track.style ?? { version: 1, role: "subtitle" });
    for (const scene of composition.graphicScenes ?? []) addNodes(scene.nodes);
  }
  const seen = new Set<string>();
  return styles.filter((style) => {
    const resolved = resolveTitleStyle(style, project.settings);
    const key = fontBindingKey(resolved.fontFamily, resolved.fontWeight);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function checkAbortAndStatus(signal?: AbortSignal): void {
  try {
    checkAbort(signal);
  } catch {
    fail("export.failed", "Package operation was cancelled.", 409);
  }
}

async function rejectSymlinkComponents(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let cursor = root;
  const parts = relative(root, absolute).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    cursor = join(cursor, parts[index]!);
    const info = await lstat(cursor);
    if (info.isSymbolicLink())
      fail("export.failed", "Source path contains a symbolic link.", 422);
    if (index < parts.length - 1 && !info.isDirectory())
      fail(
        "export.failed",
        "Source path contains a non-directory component.",
        422,
      );
  }
}

async function canonicalRegularFile(path: string): Promise<string> {
  const original = await lstat(path);
  if (!original.isFile() || original.isSymbolicLink())
    fail("export.failed", "Source is not a regular file.", 422);
  // Inspect the requested path before canonicalizing it. Checking only the
  // real path would erase evidence that the source was reached through a
  // symlinked parent directory.
  await rejectSymlinkComponents(resolve(path));
  const canonical = await realpath(path);
  await rejectSymlinkComponents(canonical);
  return canonical;
}

async function hashRegularFile(
  path: string,
  signal?: AbortSignal,
): Promise<{ sha256: string; size: number }> {
  checkAbortAndStatus(signal);
  const canonical = await canonicalRegularFile(path);
  const before = await lstat(canonical);
  if (!before.isFile() || before.isSymbolicLink())
    fail("export.failed", "Source is not a regular file.", 422);
  if (before.size <= 0 || before.size > MAX_SOURCE_BYTES)
    fail(
      "request.tooLarge",
      "Source exceeds the package file size limit.",
      413,
    );
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(canonical, constants.O_RDONLY | noFollow);
  const hash = createHash("sha256");
  let size = 0;
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      fail("export.failed", "Source changed while it was inspected.", 409);
    const stream = handle.createReadStream({ autoClose: false, signal });
    for await (const chunk of stream) {
      checkAbortAndStatus(signal);
      const bytes = chunk as Buffer;
      size += bytes.length;
      if (size > MAX_SOURCE_BYTES)
        fail(
          "request.tooLarge",
          "Source exceeds the package file size limit.",
          413,
        );
      hash.update(bytes);
    }
    const after = await handle.stat();
    if (
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      fail("source.changed", "Source changed while it was inspected.", 409);
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest("hex"), size };
}

async function copyRegularFile(
  sourcePath: string,
  targetPath: string,
  expected: { sha256: string; size: number },
  signal?: AbortSignal,
): Promise<void> {
  checkAbortAndStatus(signal);
  const canonicalSource = await canonicalRegularFile(sourcePath);
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  const before = await lstat(canonicalSource);
  if (!before.isFile() || before.isSymbolicLink())
    fail("export.failed", "Source is not a regular file.", 422);
  const source = await open(
    canonicalSource,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  const hash = createHash("sha256");
  let size = 0;
  const inspect = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > expected.size || size > MAX_SOURCE_BYTES) {
        callback(
          new CollectMediaError(
            "source.changed",
            "Source grew while it was collected.",
            409,
            undefined,
            "Source grew while it was collected.",
          ),
        );
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    const opened = await source.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      fail("source.changed", "Source changed while it was collected.", 409);
    await pipeline(
      source.createReadStream({ autoClose: false, signal }),
      inspect,
      createWriteStream(targetPath, { flags: "wx", mode: 0o600 }),
      { signal },
    );
    const after = await source.stat();
    if (
      size !== expected.size ||
      hash.digest("hex") !== expected.sha256 ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      fail("source.changed", "Source changed while it was collected.", 409);
  } catch (error) {
    await rm(targetPath, { force: true });
    if (error instanceof ApplicationError) throw error;
    checkAbortAndStatus(signal);
    fail("export.failed", "A source could not be copied safely.", 422);
  } finally {
    await source.close();
  }
}

async function safeOutputDestination(destination: string): Promise<{
  path: string;
  parent: string;
}> {
  if (
    typeof destination !== "string" ||
    !destination.trim() ||
    destination.includes("\0")
  )
    fail("request.invalid", "Choose a package destination.");
  const requestedPath = resolve(destination);
  const requestedParent = dirname(requestedPath);
  await rejectSymlinkComponents(requestedParent);
  const parent = await realpath(requestedParent);
  await rejectSymlinkComponents(parent);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
    fail(
      "project.destinationInvalid",
      "Package parent must be a local folder.",
    );
  const path = join(parent, basename(requestedPath));
  try {
    await lstat(path);
    fail(
      "project.destinationInvalid",
      "Package destination already exists.",
      409,
    );
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      fail(
        "project.destinationInvalid",
        "Package destination is unavailable.",
        422,
      );
  }
  return { path, parent };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const file = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

async function hashPackageTree(root: string): Promise<CollectManifestFile[]> {
  const files: CollectManifestFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink())
        fail("export.failed", "Package staging contains a symbolic link.", 422);
      if (info.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!info.isFile() || info.nlink !== 1)
        fail(
          "export.failed",
          "Package staging contains a non-regular file.",
          422,
        );
      const packagePath = relative(root, path).split(sep).join("/");
      const source = await hashRegularFile(path);
      files.push({
        path: packagePath,
        size: source.size,
        sha256: source.sha256,
      });
    }
  };
  await visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function listDirectoryPackage(
  root: string,
  signal?: AbortSignal,
): Promise<CollectManifestFile[]> {
  const files: CollectManifestFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    checkAbortAndStatus(signal);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      checkAbortAndStatus(signal);
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink())
        fail("export.failed", "Package cannot contain symbolic links.", 422);
      if (info.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!info.isFile() || info.nlink !== 1)
        fail("export.failed", "Package must contain regular files only.", 422);
      const packagePath = relative(root, path).split(sep).join("/");
      if (await isNestedArchiveFile(path))
        fail(
          "request.invalid",
          "Nested archives are not allowed in a package.",
        );
      const value = await hashRegularFile(path, signal);
      files.push({ path: packagePath, size: value.size, sha256: value.sha256 });
      if (files.length > MAX_SOURCE_COUNT + 300)
        fail("request.tooLarge", "Package has too many files.", 413);
    }
  };
  await visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function validateManifest(value: unknown): CollectManifest {
  const data = plain(value, "Collect Media manifest");
  const allowed = [
    "format",
    "version",
    "projectId",
    "projectRevision",
    "createdAt",
    "scope",
    "storyIds",
    "compositionIds",
    "files",
    "assets",
    "fonts",
    "rights",
    "versionsIncluded",
    "pathPrivacy",
  ];
  if (Object.keys(data).some((key) => !allowed.includes(key)))
    fail(
      "request.invalid",
      "Collect Media manifest contains an unknown field.",
    );
  if (
    data.format !== MANIFEST_FORMAT ||
    data.version !== MANIFEST_VERSION ||
    typeof data.projectId !== "string" ||
    !SHA_PATTERN.test(String(data.projectRevision)) ||
    !["current-film", "entire-project"].includes(String(data.scope)) ||
    data.versionsIncluded !== false ||
    data.pathPrivacy !== "original-uri-sha256-only" ||
    !Array.isArray(data.files) ||
    !Array.isArray(data.assets) ||
    !Array.isArray(data.fonts) ||
    !Array.isArray(data.storyIds) ||
    !Array.isArray(data.compositionIds) ||
    !Array.isArray(data.rights)
  )
    fail(
      "request.invalid",
      "Collect Media manifest has an unsupported format.",
    );
  const manifest = data as unknown as CollectManifest;
  safeIdentifier(manifest.projectId, "Project ID");
  if (
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !Array.isArray(manifest.storyIds) ||
    !Array.isArray(manifest.compositionIds) ||
    manifest.compositionIds.length === 0
  )
    fail(
      "request.invalid",
      "Collect Media manifest has an invalid snapshot identity.",
    );
  for (const id of [...manifest.storyIds, ...manifest.compositionIds])
    safeIdentifier(id, "Manifest project reference");
  if (
    manifest.files.length > MAX_SOURCE_COUNT + 300 ||
    manifest.assets.length > MAX_SOURCE_COUNT ||
    manifest.fonts.length > 256 ||
    manifest.storyIds.length > 10_000 ||
    manifest.compositionIds.length > 10_000
  )
    fail("request.tooLarge", "Collect Media manifest exceeds its limits.", 413);
  const paths = new Set<string>();
  let total = 0;
  for (const raw of manifest.files) {
    const file = plain(raw, "manifest file");
    if (
      Object.keys(file).some(
        (key) => !["path", "size", "sha256"].includes(key),
      ) ||
      typeof file.path !== "string" ||
      !Number.isSafeInteger(file.size) ||
      Number(file.size) <= 0 ||
      Number(file.size) > MAX_SOURCE_BYTES ||
      typeof file.sha256 !== "string" ||
      !SHA_PATTERN.test(file.sha256)
    )
      fail(
        "request.invalid",
        "Collect Media manifest contains an invalid file entry.",
      );
    validatePackageRelativePath(file.path);
    if (paths.has(file.path))
      fail(
        "request.invalid",
        "Collect Media manifest has duplicate file paths.",
      );
    paths.add(file.path);
    total += Number(file.size);
  }
  if (total > MAX_PACKAGE_BYTES)
    fail(
      "request.tooLarge",
      "Collect Media package exceeds its size limit.",
      413,
    );
  if (
    !paths.has("project.json") ||
    !paths.has("database.sqlite") ||
    paths.has(MANIFEST_FILE)
  )
    fail(
      "request.invalid",
      "Collect Media manifest is missing its project files.",
    );
  for (const asset of manifest.assets) {
    if (
      Object.keys(asset).some(
        (key) =>
          ![
            "id",
            "name",
            "mediaType",
            "sha256",
            "size",
            "path",
            "originalUriDigest",
          ].includes(key),
      ) ||
      typeof asset.id !== "string" ||
      typeof asset.name !== "string" ||
      typeof asset.mediaType !== "string" ||
      !SHA_PATTERN.test(asset.sha256) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      !paths.has(asset.path) ||
      !SHA_PATTERN.test(asset.originalUriDigest)
    )
      fail(
        "request.invalid",
        "Collect Media manifest contains an invalid media record.",
      );
    safeIdentifier(asset.id, "Manifest asset ID");
    safeIdentifier(asset.name, "Media display name");
    if (asset.name.length > 256 || asset.name !== cleanDisplayName(asset.name))
      fail("request.invalid", "Media display name must be a safe basename.");
    if (!(
      "image" === asset.mediaType ||
      "video" === asset.mediaType ||
      "360-video" === asset.mediaType ||
      "audio" === asset.mediaType
    ))
      fail(
        "request.invalid",
        "Collect Media manifest has an unsupported media type.",
      );
    validatePackageRelativePath(asset.path);
    if (
      !asset.path.startsWith("sources/") ||
      !new RegExp(
        `^sources/${asset.sha256.slice(0, 2)}/${asset.sha256}\\.[a-z0-9]{1,8}$`,
        "u",
      ).test(asset.path)
    )
      fail(
        "request.invalid",
        "Collected media must use the sources directory.",
      );
    const file = manifest.files.find((item) => item.path === asset.path);
    if (!file || file.sha256 !== asset.sha256 || file.size !== asset.size)
      fail(
        "request.invalid",
        "Collected media does not match its package file receipt.",
      );
  }
  for (const font of manifest.fonts) {
    if (
      Object.keys(font).some(
        (key) =>
          ![
            "sha256",
            "size",
            "path",
            "family",
            "postscriptName",
            "bindings",
          ].includes(key),
      ) ||
      !SHA_PATTERN.test(font.sha256) ||
      !Number.isSafeInteger(font.size) ||
      font.size <= 0 ||
      !paths.has(font.path) ||
      typeof font.family !== "string" ||
      typeof font.postscriptName !== "string" ||
      !Array.isArray(font.bindings)
    )
      fail(
        "request.invalid",
        "Collect Media manifest contains an invalid font record.",
      );
    safeText(font.family, "font family", 256);
    safeText(font.postscriptName, "font postscript name", 256);
    validatePackageRelativePath(font.path);
    if (!font.path.startsWith("fonts/"))
      fail("request.invalid", "Collected fonts must use the fonts directory.");
    if (
      !new RegExp(`^fonts/${font.sha256}\\.[a-z0-9]{1,8}$`, "u").test(font.path)
    )
      fail("request.invalid", "Collected font path does not match its hash.");
    const file = manifest.files.find((item) => item.path === font.path);
    if (!file || file.sha256 !== font.sha256 || file.size !== font.size)
      fail(
        "request.invalid",
        "Collected font does not match its package file receipt.",
      );
    for (const binding of font.bindings)
      if (
        Object.keys(binding).some(
          (key) => !["family", "weight"].includes(key),
        ) ||
        typeof binding.family !== "string" ||
        !Number.isInteger(binding.weight) ||
        binding.weight < 100 ||
        binding.weight > 900
      )
        fail(
          "request.invalid",
          "Collect Media manifest contains an invalid font binding.",
        );
  }
  const referencedPayloads = new Set([
    "project.json",
    "database.sqlite",
    ...manifest.assets.map((asset) => asset.path),
    ...manifest.fonts.map((font) => font.path),
  ]);
  if (
    paths.size !== referencedPayloads.size ||
    [...paths].some((path) => !referencedPayloads.has(path))
  )
    fail(
      "request.invalid",
      "Collect Media manifest contains an unreferenced package file.",
    );
  const rightsIds = new Set<string>();
  for (const raw of manifest.rights) {
    const right = plain(raw, "manifest rights declaration");
    if (
      Object.keys(right).some(
        (key) =>
          !["resourceId", "basis", "licenseName", "attribution"].includes(key),
      ) ||
      typeof right.resourceId !== "string" ||
      !["owned", "licensed", "cc0", "public-domain", "other"].includes(
        String(right.basis),
      ) ||
      rightsIds.has(right.resourceId)
    )
      fail(
        "request.invalid",
        "Collect Media manifest contains an invalid rights declaration.",
      );
    safeIdentifier(right.resourceId, "Rights resource ID");
    rightsIds.add(right.resourceId);
    if (right.licenseName !== undefined)
      safeText(right.licenseName, "license name", 120);
    if (right.basis !== "owned" && right.licenseName === undefined)
      fail("request.invalid", "Name the license or rights basis.");
    if (right.attribution !== undefined)
      safeText(right.attribution, "attribution", 512);
  }
  if (
    [...rightsIds].some(
      (id) =>
        !manifest.assets.some((asset) => `asset:${asset.id}` === id) &&
        !manifest.fonts.some((font) => `font:${font.sha256}` === id),
    )
  )
    fail(
      "request.invalid",
      "Collect Media rights refer to an unselected resource.",
    );
  const requiredRights = new Set([
    ...manifest.assets.map((asset) => `asset:${asset.id}`),
    ...manifest.fonts.map((font) => `font:${font.sha256}`),
  ]);
  if (
    rightsIds.size !== requiredRights.size ||
    [...requiredRights].some((id) => !rightsIds.has(id))
  )
    fail(
      "request.invalid",
      "Collect Media manifest is missing a rights declaration.",
    );
  return manifest;
}

function validatePackageRelativePath(path: string): string[] {
  const parts = path.split("/");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.endsWith(".") ||
        part.endsWith(" ") ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(part) ||
        [...part].some((character) => character.charCodeAt(0) < 32),
    )
  )
    fail("request.invalid", "Collect Media manifest contains an unsafe path.");
  return parts;
}

async function readManifest(root: string): Promise<CollectManifest> {
  const path = join(root, MANIFEST_FILE);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_MANIFEST_BYTES)
    fail("request.invalid", "Collect Media manifest is unsafe or too large.");
  try {
    return validateManifest(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    fail("request.invalid", "Collect Media manifest is corrupt.");
  }
}

async function verifyPackageFiles(
  root: string,
  manifest: CollectManifest,
  signal?: AbortSignal,
): Promise<void> {
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  const actual = await listDirectoryPackage(root, signal);
  if (actual.length !== expected.size + 1)
    fail("request.invalid", "Package contains unexpected or missing files.");
  for (const file of actual) {
    if (file.path === MANIFEST_FILE) continue;
    const recorded = expected.get(file.path);
    if (
      !recorded ||
      recorded.size !== file.size ||
      recorded.sha256 !== file.sha256
    )
      fail(
        "source.changed",
        "A collected package file failed its hash check.",
        422,
      );
  }
}

function manifestPath(root: string, relativePath: string): string {
  const parts = validatePackageRelativePath(relativePath);
  const path = resolve(root, ...parts);
  const fromRoot = relative(root, path);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  )
    fail("request.invalid", "Package path escapes its root.");
  return path;
}

async function copyDirectoryPackage(
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  const files = await listDirectoryPackage(source, signal);
  const total = files.reduce((sum, item) => sum + item.size, 0);
  if (total > MAX_PACKAGE_BYTES)
    fail("request.tooLarge", "Package exceeds the size limit.", 413);
  await mkdir(destination, { mode: 0o700 });
  for (const file of files) {
    checkAbortAndStatus(signal);
    const sourcePath = manifestPath(source, file.path);
    const output = manifestPath(destination, file.path);
    await copyRegularFile(sourcePath, output, file, signal);
  }
}

function mediaFontBindings(
  manifest: CollectManifest,
  root: string,
): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const font of manifest.fonts) {
    const path = manifestPath(root, font.path);
    for (const binding of font.bindings)
      bindings.set(fontBindingKey(binding.family, binding.weight), path);
  }
  return bindings;
}

/** Validate and load only hash-checked, package-relative font paths on reopen. */
export async function loadCollectedFontBindings(
  projectDirectory: string,
  project: OpenFilmProject,
): Promise<Map<string, string>> {
  const path = join(projectDirectory, MANIFEST_FILE);
  let foundManifest = false;
  try {
    const info = await lstat(path);
    foundManifest = true;
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.size > MAX_MANIFEST_BYTES
    )
      fail("request.invalid", "Collect Media manifest is unsafe or too large.");
    const manifest = validateManifest(JSON.parse(await readFile(path, "utf8")));
    for (const font of manifest.fonts) {
      const filePath = manifestPath(projectDirectory, font.path);
      await rejectSymlinkComponents(filePath);
      const fileInfo = await lstat(filePath);
      if (
        !fileInfo.isFile() ||
        fileInfo.isSymbolicLink() ||
        fileInfo.nlink !== 1 ||
        fileInfo.size !== font.size ||
        (await hashFile(filePath)) !== font.sha256
      )
        fail("source.changed", "A collected font failed its hash check.", 422);
    }
    const bindings = mediaFontBindings(manifest, projectDirectory);
    for (const style of collectTitleStyles(
      project,
      project.timelines.map((composition) => composition.id),
    ))
      if (!collectFontPathForStyle(bindings, style, project.settings))
        fail(
          "request.invalid",
          "Collected package is missing a required text font binding.",
          422,
        );
    return bindings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!foundManifest) return new Map();
      fail("request.invalid", "A required collected font file is missing.");
    }
    throw error;
  }
}

async function hashAllPackageFiles(
  root: string,
): Promise<CollectManifestFile[]> {
  const files = await hashPackageTree(root);
  let total = 0;
  for (const file of files) total += file.size;
  if (total > MAX_PACKAGE_BYTES)
    fail("request.tooLarge", "Package exceeds the ZIP32 size limit.", 413);
  return files;
}

/** Shared local-first collection service; Desktop, HTTP and CLI call this object. */
export class CollectMediaService {
  constructor(private readonly app: OpenFilmApplication) {}

  private capture(): CapturedProject {
    if (this.app.hasActiveJobs)
      fail(
        "jobs.busy",
        "Wait for active import/render work before collecting media.",
        409,
      );
    return this.app.catalog.withConsistentSnapshot((catalog, schemaVersion) => {
      if (schemaVersion !== CATALOG_SCHEMA_VERSION)
        fail(
          "request.invalid",
          "This project catalog version cannot be collected.",
        );
      const path = join(this.app.directory, "project.json");
      const info = lstatSync(path);
      if (
        info.isSymbolicLink() ||
        !info.isFile() ||
        info.size > 16 * 1024 * 1024
      )
        fail(
          "request.invalid",
          "Saved project manifest is unsafe or too large.",
        );
      const manifest = readFileSync(path);
      let project: OpenFilmProject;
      try {
        project = validateProject(
          migrateProject(JSON.parse(manifest.toString("utf8"))),
        );
      } catch {
        fail("request.invalid", "Saved project manifest is invalid.");
      }
      if (
        project.id !== this.app.project.id ||
        savedScriptProjectIdentity(project) !==
          savedScriptProjectIdentity(this.app.project)
      )
        fail(
          "story.planConflict",
          "Project changed in another editor; reopen before collecting.",
          409,
        );
      const assets = inspectCatalogSnapshot(catalog, schemaVersion).assets;
      const revision = digest(
        `${savedScriptProjectIdentity(project)}:${inspectCatalogSnapshot(catalog, schemaVersion).logicalRevision}`,
      );
      return { project, manifest, catalog, assets, revision };
    });
  }

  private selected(
    captured: CapturedProject,
    input: ReturnType<typeof validatePlanInput>,
  ): {
    project: OpenFilmProject;
    storyIds: string[];
    compositionIds: string[];
    assetIds: string[];
  } {
    safeIdentifier(captured.project.id, "Project ID");
    const compositionIds =
      input.scope === "current-film"
        ? [input.compositionId!]
        : captured.project.timelines.map((item) => item.id);
    const compositionSet = new Set(compositionIds);
    const selectedCompositions = captured.project.timelines.filter((item) =>
      compositionSet.has(item.id),
    );
    if (selectedCompositions.length !== compositionIds.length)
      fail("timeline.notFound", "Selected Composition was not found.", 404);
    const storyIds = collectStoryIds(
      captured.project,
      compositionIds,
      input.scope,
    );
    const storySet = new Set(storyIds);
    const selectedStories = captured.project.stories.filter((item) =>
      storySet.has(item.id),
    );
    if (selectedStories.length !== storyIds.length)
      fail(
        "story.invalid",
        "A selected Composition references a missing Story.",
      );
    const assetIds = referencedAssetIds(
      captured.project,
      storyIds,
      compositionIds,
    );
    for (const id of [...storyIds, ...compositionIds, ...assetIds])
      safeIdentifier(id, "Project reference ID");
    if (assetIds.length > MAX_SOURCE_COUNT)
      fail(
        "request.tooLarge",
        "Project references more media than the collection limit.",
        413,
      );
    if (!selectedCompositions.length)
      fail(
        "render.failed",
        "A portable package needs at least one saved Composition.",
      );
    const known = new Set(captured.assets.map((asset) => asset.id));
    for (const id of assetIds)
      if (!known.has(id))
        fail(
          "media.notFound",
          "A selected Story or Composition references missing catalog media.",
        );
    const mediaLibraryIds = new Set(
      captured.assets
        .filter((asset) => assetIds.includes(asset.id))
        .map((asset) =>
          safeMediaLibraryId(
            (
              asset.metadata["openfilm.reference"] as
                { mediaLibraryId?: unknown } | undefined
            )?.mediaLibraryId,
          ),
        )
        .filter((id): id is string => typeof id === "string"),
    );
    const project: OpenFilmProject = {
      ...structuredClone(captured.project),
      stories: selectedStories,
      timelines: selectedCompositions,
      mediaLibraries: captured.project.mediaLibraries
        .filter((library) => mediaLibraryIds.has(library.id))
        .map((library) => ({
          ...library,
          name: cleanDisplayName(library.name),
          uri: "openfilm-package://sources",
        })),
      sceneScriptReviewReceipts: undefined,
      sceneDirectionReceipts: undefined,
    };
    return { project, storyIds, compositionIds, assetIds };
  }

  private async sourceInfo(
    asset: MediaAsset,
    rights: Map<string, CollectRightsDeclaration>,
    signal?: AbortSignal,
  ): Promise<{
    item: CollectMediaPlanItem;
    internal?: { path: string; sha256: string; size: number };
  }> {
    const resourceId = `asset:${asset.id}`;
    const declaration = rights.get(resourceId);
    const issues: string[] = [];
    let sourcePath: string;
    try {
      sourcePath = localPath(asset.uri);
    } catch {
      issues.push("source.unsupported-uri");
      return {
        item: {
          resourceId,
          kind: "media",
          mediaType: asset.mediaType,
          displayName: cleanDisplayName(asset.name),
          rightsDeclared: Boolean(declaration),
          ...(declaration?.basis ? { rightsBasis: declaration.basis } : {}),
          ...(declaration?.licenseName
            ? { licenseName: declaration.licenseName }
            : {}),
          ...(declaration?.attribution
            ? { attribution: declaration.attribution }
            : {}),
          status: "blocked",
          issues,
        },
      };
    }
    if (
      [".zip", ".tar", ".tgz", ".gz", ".7z", ".rar"].includes(
        extname(sourcePath).toLowerCase(),
      )
    )
      issues.push("source.nested-archive");
    let value: { sha256: string; size: number } | undefined;
    try {
      value = await hashRegularFile(sourcePath, signal);
      if (asset.contentHash && asset.contentHash.toLowerCase() !== value.sha256)
        issues.push("source.hash-mismatch");
      if (
        !issues.includes("source.nested-archive") &&
        (await isNestedArchiveFile(sourcePath))
      )
        issues.push("source.nested-archive");
    } catch (error) {
      checkAbortAndStatus(signal);
      const code = error instanceof CollectMediaError ? error.code : undefined;
      issues.push(
        code === "request.tooLarge"
          ? "source.too-large"
          : code === "source.changed"
            ? "source.changed"
            : code === "export.failed"
              ? "source.unsafe-or-missing"
              : "source.unavailable",
      );
    }
    if (!declaration) issues.push("rights.required");
    return {
      item: {
        resourceId,
        kind: "media",
        mediaType: asset.mediaType,
        displayName: cleanDisplayName(asset.name),
        ...(value ? { sha256: value.sha256, size: value.size } : {}),
        rightsDeclared: Boolean(declaration),
        ...(declaration?.basis ? { rightsBasis: declaration.basis } : {}),
        ...(declaration?.licenseName
          ? { licenseName: declaration.licenseName }
          : {}),
        ...(declaration?.attribution
          ? { attribution: declaration.attribution }
          : {}),
        status: issues.length ? "blocked" : "ready",
        issues,
      },
      ...(value ? { internal: { path: sourcePath, ...value } } : {}),
    };
  }

  async plan(
    input: CollectPlanInput,
    signal?: AbortSignal,
  ): Promise<CollectMediaPlan> {
    const normalized = validatePlanInput(input);
    const captured = this.capture();
    const selected = this.selected(captured, normalized);
    const assetMap = new Map(captured.assets.map((asset) => [asset.id, asset]));
    const items: CollectMediaPlanItem[] = [];
    const internalSources = new Map<
      string,
      { asset: MediaAsset; path: string; sha256: string; size: number }
    >();
    for (const id of selected.assetIds) {
      checkAbortAndStatus(signal);
      const asset = assetMap.get(id)!;
      const result = await this.sourceInfo(asset, normalized.rights, signal);
      items.push(result.item);
      if (result.internal)
        internalSources.set(id, { asset, ...result.internal });
    }

    const fonts = new Map<string, PreparedFont>();
    const fontIssues: string[] = [];
    for (const style of collectTitleStyles(
      selected.project,
      selected.compositionIds,
    )) {
      checkAbortAndStatus(signal);
      try {
        const resolved = resolveTitleStyle(style, selected.project.settings);
        const identity = await resolveTitleFont(style);
        const source = await hashRegularFile(identity.font.path, signal);
        if (source.sha256 !== identity.font.sha256)
          fail(
            "source.changed",
            "A required font changed during planning.",
            409,
          );
        const existing = fonts.get(identity.font.sha256);
        const binding = {
          family: resolved.fontFamily,
          weight: resolved.fontWeight,
        };
        if (existing) {
          if (
            !existing.bindings.some(
              (item) =>
                fontBindingKey(item.family, item.weight) ===
                fontBindingKey(binding.family, binding.weight),
            )
          )
            existing.bindings.push(binding);
          existing.warnings.push(...identity.warnings);
        } else {
          fonts.set(identity.font.sha256, {
            sha256: identity.font.sha256,
            size: source.size,
            path: identity.font.path,
            relativePath: `fonts/${identity.font.sha256}${sourceExtension(identity.font.path, "image")}`,
            family: identity.font.family,
            postscriptName: identity.font.postscriptName,
            bindings: [binding],
            warnings: [...identity.warnings],
          });
        }
      } catch {
        checkAbortAndStatus(signal);
        fontIssues.push("font.unavailable");
      }
    }
    for (const font of fonts.values()) {
      const resourceId = `font:${font.sha256}`;
      const declaration = normalized.rights.get(resourceId);
      const issues = [
        ...(!declaration ? ["rights.required"] : []),
        ...(font.warnings.length ? ["font.fallback"] : []),
      ];
      items.push({
        resourceId,
        kind: "font",
        mediaType: "font",
        displayName: `${font.family} (${extname(font.path).toLowerCase() || "font"})`,
        sha256: font.sha256,
        size: font.size,
        rightsDeclared: Boolean(declaration),
        ...(declaration?.basis ? { rightsBasis: declaration.basis } : {}),
        ...(declaration?.licenseName
          ? { licenseName: declaration.licenseName }
          : {}),
        ...(declaration?.attribution
          ? { attribution: declaration.attribution }
          : {}),
        status: issues.some((issue) => issue !== "font.fallback")
          ? "blocked"
          : "ready",
        issues,
      });
    }
    const uniqueSourceBytes = new Map<string, number>();
    for (const source of internalSources.values())
      uniqueSourceBytes.set(source.sha256, source.size);
    const uniqueFontBytes = new Map(
      [...fonts.values()].map((font) => [font.sha256, font.size]),
    );
    const uniquePaths = new Map<string, string>();
    const packageAssets = selected.assetIds.flatMap((assetId) => {
      const source = internalSources.get(assetId);
      if (!source) return [];
      let path = uniquePaths.get(source.sha256);
      if (!path) {
        path = packageSourcePath(
          source.sha256,
          sourceExtension(source.asset.name, source.asset.mediaType),
        );
        uniquePaths.set(source.sha256, path);
      }
      return [packagedAsset(source.asset, source.sha256, source.size, path)];
    });
    const projectBytes = Buffer.byteLength(
      `${JSON.stringify(validateProject(selected.project), null, 2)}\n`,
    );
    const catalogBytes = createPortableCatalogSnapshot(
      captured.catalog,
      CATALOG_SCHEMA_VERSION,
      packageAssets,
    );
    const fontRecords = [...fonts.values()].map((font) => ({
      sha256: font.sha256,
      size: font.size,
      path: font.relativePath,
      family: font.family,
      postscriptName: font.postscriptName,
      bindings: font.bindings,
    }));
    const fileRecords = [
      {
        path: "project.json",
        size: projectBytes,
        sha256: "0".repeat(64),
      },
      {
        path: "database.sqlite",
        size: catalogBytes.length,
        sha256: "0".repeat(64),
      },
      ...[...uniquePaths].map(([sha256, path]) => ({
        path,
        size: uniqueSourceBytes.get(sha256)!,
        sha256,
      })),
      ...fontRecords.map((font) => ({
        path: font.path,
        size: font.size,
        sha256: font.sha256,
      })),
    ].sort((first, second) => first.path.localeCompare(second.path));
    const assetRecords = packageAssets.map((asset) => {
      const source = internalSources.get(asset.id)!;
      return {
        id: asset.id,
        name: cleanDisplayName(asset.name),
        mediaType: asset.mediaType,
        sha256: source.sha256,
        size: source.size,
        path: uniquePaths.get(source.sha256)!,
        originalUriDigest: sourceOriginalUriDigest(source.asset),
      };
    });
    const manifestEstimate: CollectManifest = {
      format: MANIFEST_FORMAT,
      version: MANIFEST_VERSION,
      projectId: captured.project.id,
      projectRevision: captured.revision,
      createdAt: new Date().toISOString(),
      scope: normalized.scope,
      storyIds: selected.storyIds,
      compositionIds: selected.compositionIds,
      files: fileRecords,
      assets: assetRecords,
      fonts: fontRecords,
      rights: [...normalized.rights.values()].map(
        ({ confirmed: _confirmed, ...right }) => right,
      ),
      versionsIncluded: false,
      pathPrivacy: "original-uri-sha256-only",
    };
    const manifestBytes = Buffer.byteLength(
      `${JSON.stringify(manifestEstimate, null, 2)}\n`,
    );
    const totalBytes =
      projectBytes +
      catalogBytes.length +
      [...uniqueSourceBytes.values()].reduce((a, b) => a + b, 0) +
      [...uniqueFontBytes.values()].reduce((a, b) => a + b, 0) +
      manifestBytes;
    const issues: CollectMediaPlan["issues"] = [];
    for (const item of items)
      for (const code of item.issues)
        issues.push({
          code,
          severity: code === "font.fallback" ? "warning" : "block",
          itemId: item.resourceId,
        });
    for (const code of fontIssues) issues.push({ code, severity: "block" });
    if (totalBytes > MAX_PACKAGE_BYTES)
      issues.push({ code: "package.too-large", severity: "block" });
    const sourceCount = selected.assetIds.length;
    if (sourceCount === 0)
      issues.push({ code: "scope.no-media", severity: "block" });
    const selectedResourceIds = new Set(items.map((item) => item.resourceId));
    for (const resourceId of normalized.rights.keys())
      if (!selectedResourceIds.has(resourceId))
        fail(
          "request.invalid",
          "Rights declaration does not match selected package media.",
        );
    const id = digest(
      JSON.stringify({
        projectId: captured.project.id,
        revision: captured.revision,
        scope: normalized.scope,
        storyIds: selected.storyIds,
        compositionIds: selected.compositionIds,
        items: items.map(
          ({
            resourceId,
            sha256,
            size,
            rightsDeclared,
            rightsBasis,
            licenseName,
          }) => ({
            resourceId,
            sha256,
            size,
            rightsDeclared,
            rightsBasis,
            licenseName,
            attribution: normalized.rights.get(resourceId)?.attribution,
          }),
        ),
      }),
    );
    return {
      id,
      projectId: captured.project.id,
      revision: captured.revision,
      scope: normalized.scope,
      storyIds: selected.storyIds,
      compositionIds: selected.compositionIds,
      items,
      totalBytes,
      uniqueMediaBytes: [...uniqueSourceBytes.values()].reduce(
        (a, b) => a + b,
        0,
      ),
      complete: issues.every((issue) => issue.severity !== "block"),
      versionsIncluded: false,
      issues,
    };
  }

  async create(
    input: CollectMediaCreateInput,
  ): Promise<CollectMediaCreateResult> {
    const planInput: CollectPlanInput = {
      scope: input.scope,
      ...(input.compositionId ? { compositionId: input.compositionId } : {}),
      ...(input.rightsDeclarations
        ? { rightsDeclarations: input.rightsDeclarations }
        : {}),
    };
    const normalized = validatePlanInput(planInput);
    if (
      typeof input.planId !== "string" ||
      !SHA_PATTERN.test(input.planId) ||
      typeof input.baseRevision !== "string" ||
      !SHA_PATTERN.test(input.baseRevision) ||
      !["directory", "zip"].includes(input.format)
    )
      fail("request.invalid", "Collect Media request is invalid.");
    const destination = await safeOutputDestination(input.destination);
    const plan = await this.plan(planInput, input.signal);
    if (plan.revision !== input.baseRevision || plan.id !== input.planId)
      fail(
        "story.planStale",
        "Project or source files changed after preview; create a new plan.",
        409,
      );
    if (!plan.complete)
      fail(
        "export.failed",
        "Resolve missing media, fonts and rights declarations before collecting.",
        422,
      );
    const captured = this.capture();
    if (captured.revision !== plan.revision)
      fail(
        "story.planStale",
        "Project changed before collection started.",
        409,
      );
    const selected = this.selected(captured, normalized);
    const assetMap = new Map(captured.assets.map((asset) => [asset.id, asset]));
    const sourcePlans = new Map<string, PreparedSource>();
    const uniqueSourcePaths = new Map<string, string>();
    const fonts = new Map<string, PreparedFont>();
    const fontItems = new Map(
      plan.items
        .filter((item) => item.kind === "font")
        .map((item) => [item.sha256!, item]),
    );
    const rights = normalized.rights;
    const temp = await mkdtemp(join(destination.parent, ".openfilm-collect-"));
    const stage = join(temp, "package");
    const zipStage = join(temp, "package.zip");
    const outputLock = `${destination.path}.openfilm-lock`;
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    try {
      lock = await open(
        outputLock,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
    } catch {
      await rm(temp, { recursive: true, force: true });
      fail(
        "project.destinationInvalid",
        "Another package operation owns this destination.",
        409,
      );
    }
    try {
      await lock.writeFile(
        JSON.stringify({ projectId: captured.project.id, planId: plan.id }),
      );
      await lock.sync();
      const current = await this.plan(planInput, input.signal);
      if (current.id !== plan.id || current.revision !== plan.revision)
        fail(
          "story.planStale",
          "Project or source changed before collection started.",
          409,
        );
      await mkdir(join(stage, "sources"), { recursive: true, mode: 0o700 });
      await mkdir(join(stage, "fonts"), { recursive: true, mode: 0o700 });
      for (const id of selected.assetIds) {
        checkAbortAndStatus(input.signal);
        const asset = assetMap.get(id)!;
        const planItem = plan.items.find(
          (item) => item.resourceId === `asset:${id}`,
        )!;
        const extension = sourceExtension(asset.name, asset.mediaType);
        const relativePath = packageSourcePath(planItem.sha256!, extension);
        const sourcePath = localPath(asset.uri);
        if (!uniqueSourcePaths.has(planItem.sha256!)) {
          await copyRegularFile(
            sourcePath,
            manifestPath(stage, relativePath),
            { sha256: planItem.sha256!, size: planItem.size! },
            input.signal,
          );
          uniqueSourcePaths.set(planItem.sha256!, relativePath);
        }
        const packageRelativePath = uniqueSourcePaths.get(planItem.sha256!)!;
        const uri = packageAssetUri(asset.id);
        sourcePlans.set(id, {
          asset,
          path: sourcePath,
          sha256: planItem.sha256!,
          size: planItem.size!,
          relativePath: packageRelativePath,
          uri,
        });
        try {
          input.onProgress?.(
            (sourcePlans.size / Math.max(1, selected.assetIds.length)) * 0.6,
          );
        } catch {
          // Progress callbacks cannot alter a package operation.
        }
      }
      checkAbortAndStatus(input.signal);
      for (const style of collectTitleStyles(
        selected.project,
        selected.compositionIds,
      )) {
        checkAbortAndStatus(input.signal);
        const resolved = resolveTitleStyle(style, selected.project.settings);
        const identity = await resolveTitleFont(style);
        if (fonts.has(identity.font.sha256)) {
          const item = fonts.get(identity.font.sha256)!;
          const binding = {
            family: resolved.fontFamily,
            weight: resolved.fontWeight,
          };
          if (
            !item.bindings.some(
              (entry) =>
                fontBindingKey(entry.family, entry.weight) ===
                fontBindingKey(binding.family, binding.weight),
            )
          )
            item.bindings.push(binding);
          continue;
        }
        const planItem = fontItems.get(identity.font.sha256);
        if (!planItem)
          fail("story.planStale", "Required fonts changed after preview.", 409);
        const file = await hashRegularFile(identity.font.path, input.signal);
        if (file.sha256 !== identity.font.sha256 || file.size !== planItem.size)
          fail("source.changed", "A required font changed after preview.", 409);
        const relativePath = `fonts/${file.sha256}${sourceExtension(identity.font.path, "image")}`;
        await copyRegularFile(
          identity.font.path,
          manifestPath(stage, relativePath),
          file,
          input.signal,
        );
        fonts.set(identity.font.sha256, {
          sha256: identity.font.sha256,
          size: file.size,
          path: identity.font.path,
          relativePath,
          family: identity.font.family,
          postscriptName: identity.font.postscriptName,
          bindings: [
            { family: resolved.fontFamily, weight: resolved.fontWeight },
          ],
          warnings: [...identity.warnings],
        });
      }
      const packageAssets = selected.assetIds.map((id) => {
        const source = sourcePlans.get(id)!;
        return packagedAsset(
          source.asset,
          source.sha256,
          source.size,
          source.relativePath,
        );
      });
      const packagedProject = validateProject(selected.project);
      const catalog = createPortableCatalogSnapshot(
        captured.catalog,
        CATALOG_SCHEMA_VERSION,
        packageAssets,
      );
      await writeJson(join(stage, "project.json"), packagedProject);
      const catalogFile = await open(
        join(stage, "database.sqlite"),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      try {
        await catalogFile.writeFile(catalog);
        await catalogFile.sync();
      } finally {
        await catalogFile.close();
      }
      const files = await hashAllPackageFiles(stage);
      const manifest: CollectManifest = {
        format: MANIFEST_FORMAT,
        version: MANIFEST_VERSION,
        projectId: captured.project.id,
        projectRevision: captured.revision,
        createdAt: new Date().toISOString(),
        scope: normalized.scope,
        storyIds: selected.storyIds,
        compositionIds: selected.compositionIds,
        files,
        assets: packageAssets.map((asset) => {
          const source = sourcePlans.get(asset.id)!;
          return {
            id: asset.id,
            name: cleanDisplayName(asset.name),
            mediaType: asset.mediaType,
            sha256: source.sha256,
            size: source.size,
            path: source.relativePath,
            originalUriDigest: sourceOriginalUriDigest(source.asset),
          };
        }),
        fonts: [...fonts.values()].map((font) => ({
          sha256: font.sha256,
          size: font.size,
          path: font.relativePath,
          family: font.family,
          postscriptName: font.postscriptName,
          bindings: font.bindings,
        })),
        rights: [...rights.values()].map(
          ({ confirmed: _confirmed, ...right }) => right,
        ),
        versionsIncluded: false,
        pathPrivacy: "original-uri-sha256-only",
      };
      await writeJson(join(stage, MANIFEST_FILE), manifest);
      const manifestBytes = await readFile(join(stage, MANIFEST_FILE));
      const manifestSha256 = digest(manifestBytes);
      let packageBytes = [
        ...files,
        { path: MANIFEST_FILE, size: manifestBytes.length },
      ].reduce((sum, file) => sum + file.size, 0);
      if (packageBytes > MAX_PACKAGE_BYTES)
        fail("request.tooLarge", "Package exceeds the ZIP32 size limit.", 413);
      if (this.capture().revision !== captured.revision) {
        fail(
          "story.planStale",
          "Project changed while sources were being collected.",
          409,
        );
      }
      checkAbortAndStatus(input.signal);
      if (input.format === "zip") {
        await writeStoredZip(stage, zipStage, input.signal);
        try {
          await link(zipStage, destination.path);
          await rm(zipStage, { force: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST")
            fail(
              "project.destinationInvalid",
              "Package destination appeared during collection.",
              409,
            );
          throw error;
        }
        packageBytes = (await lstat(destination.path)).size;
      } else {
        try {
          await lstat(destination.path);
          fail(
            "project.destinationInvalid",
            "Package destination appeared during collection.",
            409,
          );
        } catch (error) {
          if (error instanceof ApplicationError) throw error;
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rename(stage, destination.path);
      }
      try {
        input.onProgress?.(1);
      } catch {
        // Package publication has completed; observer failure cannot roll it back.
      }
      return {
        format: input.format,
        fileName: basename(destination.path),
        projectId: captured.project.id,
        sourceCount: packageAssets.length,
        uniqueSourceCount: uniqueSourcePaths.size,
        fontCount: fonts.size,
        packageBytes,
        manifestSha256,
        versionsIncluded: false,
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      checkAbortAndStatus(input.signal);
      return fail(
        "export.failed",
        "Collect Media could not publish the package safely.",
        422,
      );
    } finally {
      await lock?.close();
      await rm(outputLock, { force: true });
      await rm(temp, { recursive: true, force: true });
    }
  }

  async verify(
    packagePath: string,
    signal?: AbortSignal,
  ): Promise<CollectMediaVerifyResult> {
    if (
      typeof packagePath !== "string" ||
      !packagePath.trim() ||
      packagePath.includes("\0")
    )
      fail("request.invalid", "Choose a collected package to verify.");
    const requestedSource = resolve(packagePath);
    const initialInfo = await lstat(requestedSource);
    if (initialInfo.isSymbolicLink())
      fail("request.invalid", "Package root cannot be a symbolic link.");
    await rejectSymlinkComponents(requestedSource);
    const source = await realpath(requestedSource);
    await rejectSymlinkComponents(source);
    const info = await lstat(source);
    const temporaryPath = await mkdtemp(
      join(tmpdir(), "openfilm-collect-verify-"),
    );
    const temp = await realpath(temporaryPath);
    const isolated = join(temp, "film.openfilm");
    let application: OpenFilmApplication | undefined;
    try {
      if (info.isDirectory()) {
        await copyDirectoryPackage(source, isolated, signal);
      } else if (info.isFile()) {
        await mkdir(isolated, { mode: 0o700 });
        await extractStoredZip(source, isolated, signal);
      } else {
        fail("request.invalid", "Package must be a directory or ZIP file.");
      }
      checkAbortAndStatus(signal);
      const manifest = await readManifest(isolated);
      await verifyPackageFiles(isolated, manifest, signal);
      const projectInfo = await lstat(join(isolated, "project.json"));
      if (projectInfo.size > 16 * 1024 * 1024 || projectInfo.isSymbolicLink())
        fail("request.invalid", "Packaged project manifest is unsafe.");
      const projectData = migrateProject(
        JSON.parse(await readFile(join(isolated, "project.json"), "utf8")),
      );
      const catalogInfo = await lstat(join(isolated, "database.sqlite"));
      if (
        catalogInfo.isSymbolicLink() ||
        !catalogInfo.isFile() ||
        catalogInfo.size <= 0 ||
        catalogInfo.size > 256 * 1024 * 1024
      )
        fail("request.invalid", "Packaged catalog is unsafe or too large.");
      const catalog = await readFile(join(isolated, "database.sqlite"));
      const catalogSnapshot = inspectCatalogSnapshot(
        catalog,
        CATALOG_SCHEMA_VERSION,
      );
      const expectedIds = manifest.assets.map((asset) => asset.id).sort();
      const actualIds = catalogSnapshot.assets.map((asset) => asset.id).sort();
      const project = validateProject(projectData, { assetIds: actualIds });
      if (project.id !== manifest.projectId)
        fail(
          "request.invalid",
          "Project identity does not match its package manifest.",
        );
      if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds))
        fail(
          "request.invalid",
          "Packaged catalog does not match its media manifest.",
        );
      for (const asset of catalogSnapshot.assets) {
        const receipt = manifest.assets.find((item) => item.id === asset.id);
        const managed = asset.metadata["openfilm.managedSource"] as
          { uri?: unknown; relativePath?: unknown } | undefined;
        const reference = asset.metadata["openfilm.reference"] as
          Record<string, unknown> | undefined;
        const digestValue = receipt?.originalUriDigest;
        const expectedUri = receipt ? packageAssetUri(asset.id) : "";
        if (
          !receipt ||
          asset.uri !== expectedUri ||
          asset.contentHash?.toLowerCase() !== receipt.sha256 ||
          asset.mediaType !== receipt.mediaType ||
          managed?.uri !== expectedUri ||
          managed.relativePath !== receipt.path ||
          reference?.originalUri !== `openfilm-origin:${digestValue}` ||
          reference.originalUriDigest !== digestValue ||
          reference.contentHash !== receipt.sha256 ||
          reference.fileSize !== receipt.size ||
          reference.relativePath !== receipt.path ||
          reference.rootUri !== "openfilm-package://sources"
        )
          fail(
            "request.invalid",
            "Packaged media uses an uncontrolled source URI.",
          );
      }
      for (const item of manifest.assets) {
        const file = manifestPath(isolated, item.path);
        const actual = await hashRegularFile(file, signal);
        if (actual.sha256 !== item.sha256 || actual.size !== item.size)
          fail(
            "source.changed",
            "Collected media failed its source hash check.",
            422,
          );
      }
      for (const font of manifest.fonts) {
        const actual = await hashRegularFile(
          manifestPath(isolated, font.path),
          signal,
        );
        if (actual.sha256 !== font.sha256 || actual.size !== font.size)
          fail(
            "source.changed",
            "Collected font failed its source hash check.",
            422,
          );
      }
      const storyIds = new Set(manifest.storyIds);
      const compositionIds = new Set(manifest.compositionIds);
      if (
        project.stories.length !== storyIds.size ||
        project.timelines.length !== compositionIds.size ||
        project.stories.some((story) => !storyIds.has(story.id)) ||
        project.timelines.some(
          (composition) => !compositionIds.has(composition.id),
        )
      )
        fail(
          "request.invalid",
          "Package contains an unselected Story or Composition.",
        );
      application = await (
        await import("./index.js")
      ).OpenFilmApplication.open(isolated);
      const firstComposition = application.project.timelines[0];
      if (!firstComposition)
        fail(
          "render.failed",
          "Package has no Composition to preview or render.",
        );
      checkAbortAndStatus(signal);
      const previewPath = await application.render(firstComposition.id, {
        signal,
      });
      const previewSha256 = await hashFile(previewPath, signal);
      const exported = await application.exportMp4(firstComposition.id, {
        signal,
      });
      const outputSha256 = await hashFile(exported.path, signal);
      const renderReceiptPath = `${exported.path}.manifest.json`;
      const renderReceiptInfo = await lstat(renderReceiptPath);
      if (
        renderReceiptInfo.isSymbolicLink() ||
        !renderReceiptInfo.isFile() ||
        renderReceiptInfo.size > MAX_MANIFEST_BYTES
      )
        fail(
          "render.failed",
          "Collected MP4 render receipt is unsafe or missing.",
        );
      const renderReceipt = JSON.parse(
        await readFile(renderReceiptPath, "utf8"),
      ) as {
        outputSha256?: unknown;
        sources?: {
          assetId?: unknown;
          sha256?: unknown;
          size?: unknown;
          uri?: unknown;
        }[];
        warnings?: unknown;
      };
      const expectedSourceReceipts = new Map(
        manifest.assets.map((asset) => [asset.id, asset]),
      );
      if (
        renderReceipt.outputSha256 !== outputSha256 ||
        !Array.isArray(renderReceipt.sources) ||
        !Array.isArray(renderReceipt.warnings) ||
        renderReceipt.warnings.some((warning) => typeof warning !== "string") ||
        JSON.stringify(renderReceipt.warnings) !==
          JSON.stringify(exported.report.warnings)
      )
        fail(
          "render.failed",
          "Collected MP4 receipt does not match the output.",
        );
      for (const renderedSource of renderReceipt.sources) {
        const expectedSource = expectedSourceReceipts.get(
          String(renderedSource.assetId),
        );
        if (
          !expectedSource ||
          renderedSource.sha256 !== expectedSource.sha256 ||
          renderedSource.size !== expectedSource.size ||
          typeof renderedSource.uri !== "string"
        )
          fail(
            "source.changed",
            "Collected MP4 used a source outside its package receipt.",
            422,
          );
        const renderedPath = resolve(localPath(renderedSource.uri));
        const sourceRelative = relative(
          join(isolated, "sources"),
          renderedPath,
        );
        if (
          !sourceRelative ||
          sourceRelative === ".." ||
          sourceRelative.startsWith(`..${sep}`) ||
          isAbsolute(sourceRelative)
        )
          fail(
            "source.changed",
            "Collected MP4 read a source outside its isolated package.",
            422,
          );
      }
      await runProcess(
        "ffmpeg",
        [
          "-v",
          "error",
          "-i",
          exported.path,
          "-map",
          "0:v:0",
          "-map",
          "0:a?",
          "-f",
          "null",
          "-",
        ],
        { signal, timeoutMs: 60_000, maxOutputBytes: 2 * 1024 * 1024 },
      );
      const probe = await runProcess(
        "ffprobe",
        [
          "-v",
          "error",
          "-count_frames",
          "-show_entries",
          "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames,nb_read_frames,sample_rate,channels",
          "-of",
          "json",
          exported.path,
        ],
        { signal, timeoutMs: 30_000, maxOutputBytes: 2 * 1024 * 1024 },
      );
      const parsed = JSON.parse(probe.stdout.toString("utf8")) as {
        streams?: {
          codec_type?: string;
          codec_name?: string;
          width?: number;
          height?: number;
          avg_frame_rate?: string;
          nb_frames?: string;
          nb_read_frames?: string;
          sample_rate?: string;
          channels?: number;
        }[];
        format?: { duration?: string };
      };
      const video = parsed.streams?.find((item) => item.codec_type === "video");
      const outputFrames = Number(video?.nb_read_frames ?? video?.nb_frames);
      const duration = Number(parsed.format?.duration);
      const outputAudioStream = parsed.streams?.find(
        (item) => item.codec_type === "audio",
      );
      const sourceAssets = new Map(
        catalogSnapshot.assets.map((asset) => [asset.id, asset]),
      );
      const expectsAudio = firstComposition.tracks.some((track) =>
        track.clips.some((clip) => {
          const asset = clip.assetId
            ? sourceAssets.get(clip.assetId)
            : undefined;
          return asset !== undefined && captionAssetState(asset).hasAudio;
        }),
      );
      const alignedDuration = frameAlignedDuration(
        firstComposition.duration,
        application.project.settings.frameRate,
      );
      const expectedFrames = Math.round(
        alignedDuration * application.project.settings.frameRate,
      );
      if (
        video?.width !== application.project.settings.width ||
        video.height !== application.project.settings.height ||
        !video.avg_frame_rate ||
        video.codec_name !== "h264" ||
        !Number.isSafeInteger(outputFrames) ||
        outputFrames !== expectedFrames ||
        !Number.isFinite(duration) ||
        Math.abs(
          duration - outputFrames / application.project.settings.frameRate,
        ) >
          1 / application.project.settings.frameRate ||
        (expectsAudio &&
          (!outputAudioStream?.codec_name ||
            !Number(outputAudioStream.sample_rate) ||
            !outputAudioStream.channels))
      )
        fail(
          "render.failed",
          "Collected MP4 failed its decoded stream inspection.",
        );
      const packageWarnings = [...exported.report.warnings];
      return {
        verified: true,
        projectId: application.project.id,
        sourceCount: manifest.assets.length,
        fontCount: manifest.fonts.length,
        compositionId: firstComposition.id,
        previewSha256,
        outputSha256,
        outputWidth: video.width,
        outputHeight: video.height,
        outputFrameRate: video.avg_frame_rate,
        outputFrames,
        outputDurationSeconds: duration,
        ...(outputAudioStream?.codec_name &&
        Number(outputAudioStream.sample_rate) > 0 &&
        outputAudioStream.channels
          ? {
              outputAudio: {
                codec: outputAudioStream.codec_name,
                sampleRate: Number(outputAudioStream.sample_rate),
                channels: outputAudioStream.channels,
              },
            }
          : {}),
        warnings: packageWarnings,
        versionsIncluded: false,
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      checkAbortAndStatus(signal);
      return fail(
        "export.failed",
        "Package verification failed in the isolated workspace.",
        422,
      );
    } finally {
      application?.close({ requireSave: false });
      await rm(temporaryPath, { recursive: true, force: true });
    }
  }
}
