// Modified by OpenFilm contributors on 2026-10-29. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import { syncPrivateDirectory } from "./directory-sync.js";
import type { Stats } from "node:fs";
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
} from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  ContentIdentity,
  ExpectedManifest,
  ExpectedManifestEntry,
  FileOccurrence,
  ImportBatch,
  ImportBatchStatus,
  MediaAsset,
  VerifiedManifest,
} from "@openfilm/core";
import { ApplicationError } from "@openfilm/core";
import type { ProjectCatalog } from "@openfilm/catalog";
import type { ImportOptions, ImportResult } from "./index.js";
import type { SourceDraftService } from "./source-draft.js";

const MAX_MANIFEST_ENTRIES = 100_000;
const OCCURRENCE_PAGE_SIZE = 1_000;
const ORPHAN_PARTIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ORPHAN_STAGED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BROWSER_STAGED_BYTES = 8 * 1024 ** 3;
const MAX_BROWSER_STAGE_RECORDS = 100_000;
const MAX_BROWSER_STAGE_INDEX_BYTES = 32 * 1024 * 1024;

export interface SourceBatchCreateInput {
  projectId: string;
  baseRevision: number;
  requestId: string;
  selectionIds?: string[];
  partialPolicy?: ExpectedManifest["partialPolicy"];
  signal?: AbortSignal;
  onProgress?: (progress: Readonly<SourceBatchProgress>) => void;
}

export interface SourceBatchProgress {
  batchId: string;
  stage: "preparing" | "staging" | "importing" | "publishing" | "completed";
  completed: number;
  total: number;
  failed: number;
  cancelled: boolean;
}

export interface SourceBatchSealResult {
  batch: ImportBatch;
  expectedManifest: ExpectedManifest;
  verifiedManifest: VerifiedManifest;
  status: ImportBatchStatus;
  expected: number;
  included: number;
  verified: number;
  failed: number;
  excluded: number;
}

interface PlannedEntry {
  expected: ExpectedManifestEntry;
  selectionId: string;
  occurrence: FileOccurrence;
}

interface StagedContent {
  path: string;
  hash: string;
  byteLength: number;
}

interface BrowserStageRecord {
  selectionId: string;
  occurrenceId: string;
  hash: string;
  byteLength: number;
  extension: string;
  stagedAt: string;
  discoveryFingerprint: string;
}

function fail(
  code: ConstructorParameters<typeof ApplicationError>[0],
  message: string,
  status = 400,
): never {
  throw new ApplicationError(code, message, status);
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function notify(
  callback: SourceBatchCreateInput["onProgress"],
  progress: SourceBatchProgress,
): void {
  try {
    callback?.(structuredClone(progress));
  } catch {
    // UI progress observers cannot interrupt an import transaction.
  }
}

function safeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/iu.test(normalized) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail("request.invalid", "A discovered source path is unsafe.");
  return normalized;
}

function sameStat(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function mediaKind(
  occurrence: FileOccurrence,
): ContentIdentity["mediaKind"] | undefined {
  if (["image", "video", "audio", "track"].includes(occurrence.fileKind))
    return occurrence.fileKind as ContentIdentity["mediaKind"];
  return undefined;
}

function assetContext(asset: MediaAsset): Record<string, unknown> {
  return {
    mediaType: asset.mediaType,
    capturedAt: asset.capturedAt ?? null,
    duration: asset.duration ?? null,
    dimensions: asset.dimensions ?? null,
    frameRate: asset.frameRate ?? null,
    codec: asset.codec ?? null,
    colorSpace: asset.colorSpace ?? null,
    hdr: asset.hdr ?? null,
  };
}

function contentExtension(relativePath: string): string {
  const extension = extname(relativePath).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/u.test(extension) ? extension : ".media";
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return (
    value !== "" &&
    value !== ".." &&
    !value.startsWith(`..${sep}`) &&
    !isAbsolute(value)
  );
}

/**
 * Turns a discovery snapshot into private, immutable managed content and a
 * durable verified manifest. The original selected source is never written.
 */
export class SourceBatchService {
  private readonly stageRoot: string;
  private readonly browserStageIndexPath: string;
  private readonly activePartials = new Set<string>();
  private readonly activeBrowserStages = new Set<string>();
  private browserStageRecords?: Map<string, BrowserStageRecord>;
  private sealing = false;

  constructor(
    private readonly directory: string,
    private readonly projectId: string,
    private readonly sourceDraft: SourceDraftService,
    private readonly catalog: ProjectCatalog,
    private readonly importManagedSources: (
      files: string[],
      options?: ImportOptions,
    ) => Promise<ImportResult>,
    private readonly operationStarted: () => void = () => undefined,
    private readonly operationFinished: () => void = () => undefined,
  ) {
    this.stageRoot = join(directory, "sources", "collected");
    this.browserStageIndexPath = join(
      directory,
      "analysis",
      "browser-staging.json",
    );
    this.catalog.multiSource.recoverInterruptedImportBatches(
      new Date(Date.now() - ORPHAN_PARTIAL_MAX_AGE_MS).toISOString(),
    );
  }

  async createAndSeal(
    input: SourceBatchCreateInput,
  ): Promise<SourceBatchSealResult> {
    this.assertInput(input);
    if (this.sealing || this.activeBrowserStages.size)
      fail(
        "jobs.busy",
        "Another source batch is already sealing in this project.",
        409,
      );
    this.sealing = true;
    this.operationStarted();
    let activeBatchId: string | undefined;
    try {
      await this.ensureStageRoot();
      await this.recoverOrphanPartials();
      await this.recoverOrphanStaging();
      const draft = this.sourceDraft.get();
      const selectionIds =
        input.selectionIds ?? draft.selections.map(({ id }) => id);
      if (
        !selectionIds.length ||
        selectionIds.length > 10_000 ||
        new Set(selectionIds).size !== selectionIds.length
      )
        fail(
          "request.invalid",
          "Choose a bounded, non-empty set of source selections.",
        );
      const selected = new Map(
        draft.selections.map((selection) => [selection.id, selection]),
      );
      const selections = selectionIds.map((id) => {
        const selection = selected.get(id);
        if (!selection)
          fail(
            "import.sourceUnavailable",
            "A selected source is unavailable.",
            409,
          );
        return selection;
      });
      if (
        selections.some(({ accessClass }) => accessClass === "staged-content")
      )
        fail(
          "import.sourceUnavailable",
          "A staged-content selection must be relinked to its original source.",
          409,
        );
      const planned = this.collectExpectedEntries(
        selections.map(({ id }) => id),
      );
      if (!planned.length)
        fail(
          "import.sourceUnavailable",
          "Scan at least one source file before sealing.",
          409,
        );
      if (planned.length > MAX_MANIFEST_ENTRIES)
        fail(
          "request.tooLarge",
          "The expected source manifest exceeds its limit.",
          413,
        );
      this.assertCurrent(input);

      const batchId = randomUUID();
      const expectedId = randomUUID();
      const createdAt = new Date().toISOString();
      const expected: ExpectedManifest = {
        id: expectedId,
        batchId,
        revision: input.baseRevision,
        selectionHash: digest(
          JSON.stringify({
            projectId: input.projectId,
            draftRevision: input.baseRevision,
            selections: selections.map((selection) => ({
              id: selection.id,
              kind: selection.kind,
              displayName: selection.displayName,
              recursive: selection.recursive,
              selectionRevision: selection.selectionRevision,
            })),
            entries: planned.map(({ expected: entry, selectionId }) => ({
              selectionId,
              occurrenceId: entry.occurrenceId,
              relativePath: entry.relativePath,
              included: entry.included,
              expectedByteLength: entry.expectedByteLength ?? null,
              expectedModifiedAt: entry.expectedModifiedAt ?? null,
            })),
          }),
        ),
        entries: planned.map(({ expected: entry }) => entry),
        partialPolicy: input.partialPolicy ?? "require-all",
        createdAt,
      };
      const batch: ImportBatch = {
        id: batchId,
        projectId: input.projectId,
        draftRevision: input.baseRevision,
        scopeMode: "selected-sources",
        status: "sealing",
        expectedManifestId: expectedId,
        createdAt,
      };
      this.catalog.multiSource.createImportBatch(batch, expected);
      activeBatchId = batch.id;

      const progress: SourceBatchProgress = {
        batchId,
        stage: "staging",
        completed: 0,
        total: planned.length,
        failed: 0,
        cancelled: false,
      };
      notify(input.onProgress, progress);
      const statuses: Array<
        | { occurrenceId: string; status: "excluded" }
        | { occurrenceId: string; status: "failed"; code: string }
        | {
            occurrenceId: string;
            status: "verified";
            bindingId: string;
            assetId: string;
            contentHash: string;
            contextRevision: string;
          }
      > = [];

      for (const item of planned) {
        const { expected: entry, selectionId } = item;
        if (!entry.included) {
          statuses.push({
            occurrenceId: entry.occurrenceId,
            status: "excluded",
          });
          progress.completed++;
          notify(input.onProgress, progress);
          continue;
        }
        if (input.signal?.aborted) {
          progress.cancelled = true;
          statuses.push({
            occurrenceId: entry.occurrenceId,
            status: "failed",
            code: "source.cancelled",
          });
          progress.failed++;
          progress.completed++;
          notify(input.onProgress, progress);
          continue;
        }

        try {
          const selection = selected.get(selectionId)!;
          const occurrence = item.occurrence;
          const kind = mediaKind(occurrence);
          if (!kind || kind === "track") {
            statuses.push({
              occurrenceId: entry.occurrenceId,
              status: "failed",
              code: "source.unsupportedKind",
            });
            progress.failed++;
            continue;
          }
          const staged = await this.stageOccurrence(
            selection,
            entry,
            occurrence,
            input.signal,
          );
          progress.stage = "importing";
          notify(input.onProgress, progress);
          let asset = this.catalog.getAssetByUri(
            pathToFileURL(staged.path).href,
          );
          if (!asset) {
            const imported = await this.importManagedSources([staged.path], {
              signal: input.signal,
              proxies: false,
            });
            if (imported.failed || !imported.imported)
              throw new ApplicationError(
                "import.failed",
                "Managed source import failed.",
              );
            asset = this.catalog.getAssetByUri(pathToFileURL(staged.path).href);
          }
          if (!asset || asset.contentHash !== staged.hash)
            throw new ApplicationError(
              "source.changed",
              "Imported asset does not match staged content.",
            );
          const identity = this.catalog.multiSource.saveContentIdentity({
            id: `sha256:${staged.hash}:${staged.byteLength}`,
            hashAlgorithm: "sha256",
            fullHash: staged.hash,
            byteLength: staged.byteLength,
            mediaKind: kind,
          });
          const contextRevision = digest(JSON.stringify(assetContext(asset)));
          const binding = this.catalog.multiSource.saveAssetContentVersion({
            id: `binding:${digest(`${asset.id}\0${entry.occurrenceId}\0${identity.id}\0${contextRevision}`)}`,
            assetId: asset.id,
            occurrenceId: entry.occurrenceId,
            contentId: identity.id,
            contextRevision,
            descriptorSnapshotId: `descriptor:${contextRevision}`,
          });
          statuses.push({
            occurrenceId: entry.occurrenceId,
            status: "verified",
            bindingId: binding.id,
            assetId: asset.id,
            contentHash: staged.hash,
            contextRevision,
          });
        } catch (error) {
          const cancelled =
            input.signal?.aborted ||
            (error instanceof Error && error.name === "AbortError");
          const systemCode =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
              ? error.code
              : undefined;
          const code = cancelled
            ? "source.cancelled"
            : error instanceof ApplicationError
              ? error.code
              : systemCode === "ENOENT" ||
                  systemCode === "ENOTDIR" ||
                  systemCode === "ELOOP"
                ? "source.changed"
                : "source.unreadable";
          statuses.push({
            occurrenceId: entry.occurrenceId,
            status: "failed",
            code,
          });
          progress.failed++;
          progress.cancelled ||= cancelled;
        } finally {
          progress.completed++;
          notify(input.onProgress, progress);
        }
      }

      if (statuses.length !== planned.length)
        throw new Error(
          "Source sealing did not account for every expected member.",
        );
      progress.stage = "publishing";
      notify(input.onProgress, progress);
      const verifiedEntries = statuses.map((item) =>
        item.status === "verified"
          ? { ...item, status: "verified" as const }
          : item.status === "failed"
            ? { ...item, status: "failed" as const }
            : item,
      );
      const status = this.resolveStatus(expected, statuses, progress.cancelled);
      const verifiedManifestId = randomUUID();
      this.catalog.multiSource.createVerifiedManifest(
        {
          id: verifiedManifestId,
          expectedManifestId: expected.id,
          createdAt: new Date().toISOString(),
        },
        verifiedEntries,
      );
      this.catalog.multiSource.finishImportBatch(batch.id, status);
      const verifiedManifest =
        this.catalog.multiSource.getVerifiedManifest(verifiedManifestId);
      if (!verifiedManifest)
        throw new Error(
          "Verified source manifest was not readable after publication.",
        );
      progress.stage = "completed";
      notify(input.onProgress, progress);
      const verified = statuses.filter(
        ({ status: value }) => value === "verified",
      ).length;
      const failed = statuses.filter(
        ({ status: value }) => value === "failed",
      ).length;
      const excluded = statuses.filter(
        ({ status: value }) => value === "excluded",
      ).length;
      return {
        batch: this.catalog.multiSource.getImportBatch(batch.id)!,
        expectedManifest: this.catalog.multiSource.getExpectedManifest(
          expected.id,
        )!,
        verifiedManifest,
        status,
        expected: planned.length,
        included: planned.length - excluded,
        verified,
        failed,
        excluded,
      };
    } catch (error) {
      if (activeBatchId) {
        const batch = this.catalog.multiSource.getImportBatch(activeBatchId);
        if (batch?.status === "sealing") {
          try {
            this.catalog.multiSource.finishImportBatch(
              activeBatchId,
              input.signal?.aborted ? "cancelled" : "failed",
            );
          } catch {
            // Preserve the original failure; startup recovery will terminalize
            // an interrupted seal if the catalog itself could not be updated.
          }
        }
      }
      throw error;
    } finally {
      this.sealing = false;
      this.operationFinished();
    }
  }

  private assertInput(input: SourceBatchCreateInput): void {
    if (
      input.projectId !== this.projectId ||
      !Number.isSafeInteger(input.baseRevision) ||
      input.baseRevision < 0 ||
      typeof input.requestId !== "string" ||
      !input.requestId.trim() ||
      input.requestId.length > 512
    )
      fail(
        "request.invalid",
        "Source batch project, revision and request ID are invalid.",
      );
    this.assertCurrent(input);
  }

  private assertCurrent(input: SourceBatchCreateInput): void {
    const draft = this.sourceDraft.get();
    if (
      draft.projectId !== input.projectId ||
      draft.revision !== input.baseRevision
    )
      fail(
        "import.draftStale",
        "The selected sources changed; scan and review them again.",
        409,
      );
  }

  private collectExpectedEntries(selectionIds: string[]): PlannedEntry[] {
    const result: PlannedEntry[] = [];
    for (const selectionId of selectionIds) {
      for (let offset = 0; ; offset += OCCURRENCE_PAGE_SIZE) {
        const page = this.catalog.multiSource.listOccurrences(selectionId, {
          offset,
          limit: OCCURRENCE_PAGE_SIZE,
        });
        for (const { occurrence, included } of page.items) {
          const safePath = safeRelativePath(occurrence.relativePath);
          result.push({
            selectionId,
            expected: {
              occurrenceId: occurrence.id,
              relativePath: safePath,
              included,
              ...(occurrence.byteLength === undefined
                ? {}
                : { expectedByteLength: occurrence.byteLength }),
              ...(occurrence.modifiedAt === undefined
                ? {}
                : { expectedModifiedAt: occurrence.modifiedAt }),
            },
            occurrence,
          });
          if (result.length > MAX_MANIFEST_ENTRIES)
            fail(
              "request.tooLarge",
              "The expected source manifest exceeds its limit.",
              413,
            );
        }
        if (!page.hasMore) break;
      }
    }
    return result;
  }

  setIncluded(input: {
    projectId: string;
    baseRevision: number;
    requestId: string;
    selectionId: string;
    occurrenceId: string;
    included: boolean;
  }): {
    selectionId: string;
    occurrenceId: string;
    included: boolean;
    revision: number;
  } {
    this.assertCurrent(input);
    if (
      typeof input.requestId !== "string" ||
      !input.requestId.trim() ||
      !input.selectionId ||
      !input.occurrenceId ||
      typeof input.included !== "boolean"
    )
      fail("request.invalid", "Source membership fields are invalid.");
    const draft = this.sourceDraft.get();
    if (!draft.selections.some(({ id }) => id === input.selectionId))
      fail(
        "import.sourceUnavailable",
        "The selected source is unavailable.",
        409,
      );
    this.catalog.multiSource.setIncluded(
      input.selectionId,
      input.occurrenceId,
      input.included,
    );
    return {
      selectionId: input.selectionId,
      occurrenceId: input.occurrenceId,
      included: input.included,
      revision: input.baseRevision,
    };
  }

  async stageBrowserOccurrence(input: {
    projectId: string;
    baseRevision: number;
    selectionId: string;
    occurrenceId: string;
    modifiedAt?: string;
    chunks: AsyncIterable<Uint8Array>;
    signal?: AbortSignal;
  }): Promise<{
    occurrenceId: string;
    contentHash: string;
    byteLength: number;
  }> {
    this.assertCurrent({
      projectId: input.projectId,
      baseRevision: input.baseRevision,
      requestId: "browser-source-stage",
    });
    const draft = this.sourceDraft.get();
    const selection = draft.selections.find(
      ({ id }) => id === input.selectionId,
    );
    if (
      !selection ||
      selection.accessClass === "native-path" ||
      selection.accessClass === "staged-content"
    )
      fail(
        "import.sourceUnavailable",
        "This occurrence is not attached to an available browser source.",
        409,
      );
    if (!input.occurrenceId || input.occurrenceId.length > 256)
      fail("request.invalid", "A scanned browser occurrence is required.");
    const membership = this.catalog.multiSource.getOccurrence(
      input.selectionId,
      input.occurrenceId,
    );
    if (
      !membership ||
      membership.occurrence.availability !== "available" ||
      !membership.included
    )
      fail(
        "import.sourceUnavailable",
        "Only an included, currently available occurrence can be staged.",
        409,
      );
    const occurrence = membership.occurrence;
    const discoveryFingerprint = this.browserDiscoveryFingerprint(
      input.selectionId,
      occurrence,
    );
    const assertDiscoveryCurrent = () => {
      const current = this.catalog.multiSource.getOccurrence(
        input.selectionId,
        input.occurrenceId,
      );
      if (
        this.sourceDraft.get().revision !== input.baseRevision ||
        !current?.included ||
        current.occurrence.availability !== "available" ||
        this.browserDiscoveryFingerprint(
          input.selectionId,
          current.occurrence,
        ) !== discoveryFingerprint
      )
        fail(
          "source.changed",
          "The browser discovery changed while its bytes were being staged.",
          409,
        );
    };
    if (
      occurrence.fileKind === "unsupported" ||
      occurrence.fileKind === "track"
    )
      fail(
        "media.unsupported",
        "This browser source is not an importable media file.",
        415,
      );
    if (
      occurrence.modifiedAt !== undefined &&
      input.modifiedAt !== occurrence.modifiedAt
    )
      fail(
        "source.changed",
        "The browser source changed after discovery.",
        409,
      );
    if (
      input.modifiedAt !== undefined &&
      (!Number.isFinite(Date.parse(input.modifiedAt)) ||
        input.modifiedAt.length > 128)
    )
      fail(
        "request.invalid",
        "The browser source modification time is invalid.",
      );
    if (this.sealing)
      fail(
        "jobs.busy",
        "A source batch is already sealing in this project.",
        409,
      );
    const stageKey = `${input.selectionId}\0${input.occurrenceId}`;
    if (this.activeBrowserStages.has(stageKey))
      fail("jobs.busy", "This browser source is already being staged.", 409);
    this.activeBrowserStages.add(stageKey);
    this.operationStarted();
    let temporaryPath: string | undefined;
    let temporaryName: string | undefined;
    try {
      await this.ensureStageRoot();
      if (input.signal?.aborted)
        throw Object.assign(new Error("Operation cancelled"), {
          name: "AbortError",
        });
      temporaryName = `.partial-${randomUUID()}`;
      temporaryPath = join(this.stageRoot, temporaryName);
      this.activePartials.add(temporaryName);
      const hash = createHash("sha256");
      let byteLength = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteLength += chunk.length;
          if (byteLength > MAX_BROWSER_STAGED_BYTES) {
            callback(
              new ApplicationError(
                "request.tooLarge",
                "The browser source exceeds the 8 GiB staging limit.",
                413,
              ),
            );
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        input.chunks,
        meter,
        createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
        { signal: input.signal },
      );
      if (
        !byteLength ||
        (occurrence.byteLength !== undefined &&
          byteLength !== occurrence.byteLength)
      )
        fail(
          "source.changed",
          "The browser file size changed after discovery.",
          409,
        );
      const output = await open(temporaryPath, "r+");
      try {
        await output.sync();
      } finally {
        await output.close();
      }
      const fullHash = hash.digest("hex");
      const extension = contentExtension(occurrence.relativePath);
      const destination = join(
        this.stageRoot,
        `${fullHash}-${byteLength}${extension}`,
      );
      try {
        await link(temporaryPath, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await lstat(destination);
        if (
          !existing.isFile() ||
          existing.isSymbolicLink() ||
          existing.size !== byteLength ||
          (await this.hashFile(destination)) !== fullHash
        )
          fail(
            "import.failed",
            "Existing staged content failed integrity verification.",
            409,
          );
      }
      await unlink(temporaryPath);
      temporaryPath = undefined;
      await syncPrivateDirectory(this.stageRoot);
      const records = await this.loadBrowserStageRecords();
      assertDiscoveryCurrent();
      records.set(stageKey, {
        selectionId: input.selectionId,
        occurrenceId: input.occurrenceId,
        hash: fullHash,
        byteLength,
        extension,
        stagedAt: new Date().toISOString(),
        discoveryFingerprint,
      });
      if (records.size > MAX_BROWSER_STAGE_RECORDS)
        fail(
          "request.tooLarge",
          "The private browser staging receipt index is full.",
          413,
        );
      await this.persistBrowserStageRecords(records);
      assertDiscoveryCurrent();
      return {
        occurrenceId: input.occurrenceId,
        contentHash: fullHash,
        byteLength,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        fail(
          "source.changed",
          "The browser source disappeared while it was being staged.",
          409,
        );
      throw error;
    } finally {
      if (temporaryPath) await rm(temporaryPath, { force: true });
      if (temporaryName) this.activePartials.delete(temporaryName);
      this.activeBrowserStages.delete(stageKey);
      this.operationFinished();
    }
  }

  async listBrowserStagedOccurrences(
    selectionId: string,
    offset = 0,
    limit = 500,
  ): Promise<{
    occurrenceIds: string[];
    offset: number;
    limit: number;
    hasMore: boolean;
  }> {
    if (
      !selectionId ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500
    )
      fail("request.invalid", "Browser staging page bounds are invalid.");
    const source = this.sourceDraft
      .get()
      .selections.find(({ id }) => id === selectionId);
    if (
      !source ||
      !["persistent-browser-handle", "ephemeral-browser-file"].includes(
        source.accessClass,
      )
    )
      fail(
        "import.sourceUnavailable",
        "Browser staging belongs to a source in the current draft.",
        409,
      );
    const staged = [...(await this.loadBrowserStageRecords()).values()]
      .filter(
        (record) =>
          record.selectionId === selectionId &&
          this.currentBrowserStage(record),
      )
      .sort((left, right) =>
        left.occurrenceId.localeCompare(right.occurrenceId),
      );
    const page = staged.slice(offset, offset + limit);
    const validIds: string[] = [];
    for (const record of page) {
      const info = await lstat(this.browserStagePath(record)).catch(
        () => undefined,
      );
      if (
        !info?.isFile() ||
        info.isSymbolicLink() ||
        info.size !== record.byteLength ||
        !this.currentBrowserStage(record)
      )
        continue;
      validIds.push(record.occurrenceId);
    }
    return {
      occurrenceIds: validIds,
      offset,
      limit,
      hasMore: offset + limit < staged.length,
    };
  }

  private async ensureStageRoot(): Promise<void> {
    for (const directory of [
      this.directory,
      join(this.directory, "sources"),
      this.stageRoot,
    ]) {
      try {
        await mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        fail("import.failed", "The managed staging directory is unsafe.", 409);
    }
  }

  private async recoverOrphanPartials(): Promise<void> {
    const cutoff = Date.now() - ORPHAN_PARTIAL_MAX_AGE_MS;
    for (const name of await readdir(this.stageRoot)) {
      if (!name.startsWith(".partial-") || this.activePartials.has(name))
        continue;
      const path = join(this.stageRoot, name);
      const info = await lstat(path);
      if (info.isFile() && !info.isSymbolicLink() && info.mtimeMs < cutoff)
        await rm(path, { force: true });
    }
  }

  private async recoverOrphanStaging(): Promise<void> {
    try {
      await this.ensureStageRoot();
    } catch {
      return;
    }
    const cutoff = Date.now() - ORPHAN_STAGED_MAX_AGE_MS;
    const stageRecords = await this.loadBrowserStageRecords();
    let indexChanged = false;
    for (const [key, record] of stageRecords) {
      if (Date.parse(record.stagedAt) < cutoff) {
        stageRecords.delete(key);
        indexChanged = true;
      }
    }
    if (indexChanged) await this.persistBrowserStageRecords(stageRecords);
    const browserPaths = new Set(
      [...stageRecords.values()].map((record) => this.browserStagePath(record)),
    );
    for (const name of await readdir(this.stageRoot)) {
      if (this.activePartials.has(name)) continue;
      const path = join(this.stageRoot, name);
      const info = await lstat(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.mtimeMs >= cutoff ||
        !/^[a-f0-9]{64}-\d+\.[a-z0-9]{1,12}$/u.test(name) ||
        this.catalog.getAssetByUri(pathToFileURL(path).href) ||
        browserPaths.has(path)
      )
        continue;
      await rm(path, { force: true });
    }
  }

  private async sourcePathFor(
    selection: ReturnType<SourceDraftService["get"]>["selections"][number],
    relativePath: string,
  ): Promise<string> {
    const selectedPath = selection.accessRef.startsWith("file:")
      ? fileURLToPath(selection.accessRef)
      : selection.accessRef;
    const root = await realpath(selectedPath);
    const rootInfo = await lstat(selectedPath);
    if (
      rootInfo.isSymbolicLink() ||
      (selection.kind === "folder" && !rootInfo.isDirectory()) ||
      (selection.kind === "file" && !rootInfo.isFile())
    )
      fail(
        "source.changed",
        "The selected source root changed after discovery.",
      );
    const sourcePath =
      selection.kind === "file"
        ? root
        : resolve(root, ...safeRelativePath(relativePath).split("/"));
    if (selection.kind === "folder" && !isWithin(root, sourcePath))
      fail(
        "source.changed",
        "The discovered path escaped its selected folder.",
      );
    const sourceInfo = await lstat(sourcePath);
    if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile())
      fail(
        "source.changed",
        "The discovered file is no longer a regular file.",
      );
    const canonical = await realpath(sourcePath);
    if (
      canonical !== sourcePath ||
      (selection.kind === "folder" && !isWithin(root, canonical))
    )
      fail(
        "source.changed",
        "The discovered file changed location after scanning.",
      );
    return sourcePath;
  }

  private async stageOccurrence(
    selection: ReturnType<SourceDraftService["get"]>["selections"][number],
    expected: ExpectedManifestEntry,
    occurrence: FileOccurrence,
    signal?: AbortSignal,
  ): Promise<StagedContent> {
    if (signal?.aborted)
      throw Object.assign(new Error("Operation cancelled"), {
        name: "AbortError",
      });
    if (selection.accessClass !== "native-path")
      return this.stagedBrowserOccurrence(selection.id, occurrence);
    const sourcePath = await this.sourcePathFor(
      selection,
      expected.relativePath,
    );
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    const handle = await open(sourcePath, flags);
    let temporaryPath: string | undefined;
    let temporaryName: string | undefined;
    try {
      const before = await handle.stat();
      if (
        !before.isFile() ||
        (expected.expectedByteLength !== undefined &&
          before.size !== expected.expectedByteLength) ||
        (expected.expectedModifiedAt !== undefined &&
          before.mtime.toISOString() !== expected.expectedModifiedAt)
      )
        fail("source.changed", "The selected file changed after discovery.");
      temporaryName = `.partial-${randomUUID()}`;
      temporaryPath = join(this.stageRoot, temporaryName);
      this.activePartials.add(temporaryName);
      const hash = createHash("sha256");
      let byteLength = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteLength += chunk.length;
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        handle.createReadStream({ autoClose: false }),
        meter,
        createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
        { signal },
      );
      const output = await open(temporaryPath, "r+");
      try {
        await output.sync();
      } finally {
        await output.close();
      }
      const after = await handle.stat();
      const pathAfter = await lstat(sourcePath);
      if (
        !sameStat(before, after) ||
        pathAfter.isSymbolicLink() ||
        pathAfter.dev !== before.dev ||
        pathAfter.ino !== before.ino ||
        byteLength !== before.size ||
        (expected.expectedByteLength !== undefined &&
          byteLength !== expected.expectedByteLength)
      )
        fail(
          "source.changed",
          "The selected file changed while it was being staged.",
        );
      const contentHash = hash.digest("hex");
      const extension = contentExtension(expected.relativePath);
      const destination = join(
        this.stageRoot,
        `${contentHash}-${byteLength}${extension}`,
      );
      try {
        await link(temporaryPath, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await lstat(destination);
        if (
          !existing.isFile() ||
          existing.isSymbolicLink() ||
          (await this.hashFile(destination)) !== contentHash
        )
          fail(
            "import.failed",
            "Existing staged content failed integrity verification.",
            409,
          );
      }
      await unlink(temporaryPath);
      temporaryPath = undefined;
      await syncPrivateDirectory(this.stageRoot);
      return { path: destination, hash: contentHash, byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        fail(
          "source.changed",
          "The selected file disappeared after discovery.",
        );
      throw error;
    } finally {
      await handle.close();
      if (temporaryPath) await rm(temporaryPath, { force: true });
      if (temporaryName) this.activePartials.delete(temporaryName);
    }
  }

  private async stagedBrowserOccurrence(
    selectionId: string,
    occurrence: FileOccurrence,
  ): Promise<StagedContent> {
    const record = (await this.loadBrowserStageRecords()).get(
      `${selectionId}\0${occurrence.id}`,
    );
    if (
      !record ||
      (occurrence.byteLength !== undefined &&
        occurrence.byteLength !== record.byteLength) ||
      record.discoveryFingerprint !==
        this.browserDiscoveryFingerprint(selectionId, occurrence) ||
      !this.currentBrowserStage(record)
    )
      fail(
        "import.sourceUnavailable",
        "The browser source must be staged again before sealing.",
        409,
      );
    const path = this.browserStagePath(record);
    const info = await lstat(path).catch(() => undefined);
    if (
      !info?.isFile() ||
      info.isSymbolicLink() ||
      info.size !== record.byteLength ||
      (await this.hashFile(path)) !== record.hash ||
      !this.currentBrowserStage(record)
    )
      fail(
        "source.changed",
        "The privately staged browser source failed integrity verification.",
        409,
      );
    return { path, hash: record.hash, byteLength: record.byteLength };
  }

  private browserStagePath(record: BrowserStageRecord): string {
    return join(
      this.stageRoot,
      `${record.hash}-${record.byteLength}${record.extension}`,
    );
  }

  private browserDiscoveryFingerprint(
    selectionId: string,
    occurrence: FileOccurrence,
  ): string {
    const selection = this.sourceDraft
      .get()
      .selections.find(({ id }) => id === selectionId);
    return digest(
      JSON.stringify({
        selectionId,
        selectionRevision: selection?.selectionRevision ?? null,
        occurrenceId: occurrence.id,
        logicalRootId: occurrence.logicalRootId,
        relativePath: occurrence.relativePath,
        fileKind: occurrence.fileKind,
        byteLength: occurrence.byteLength ?? null,
        modifiedAt: occurrence.modifiedAt ?? null,
        scanRevision: occurrence.scanRevision,
      }),
    );
  }

  private currentBrowserStage(record: BrowserStageRecord): boolean {
    const current = this.catalog.multiSource.getOccurrence(
      record.selectionId,
      record.occurrenceId,
    );
    return Boolean(
      current?.included &&
      current.occurrence.availability === "available" &&
      this.browserDiscoveryFingerprint(
        record.selectionId,
        current.occurrence,
      ) === record.discoveryFingerprint,
    );
  }

  private async loadBrowserStageRecords(): Promise<
    Map<string, BrowserStageRecord>
  > {
    if (this.browserStageRecords) return this.browserStageRecords;
    let encoded: string;
    try {
      const info = await lstat(this.browserStageIndexPath);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > MAX_BROWSER_STAGE_INDEX_BYTES
      )
        fail(
          "import.sourceUnavailable",
          "Private browser staging metadata is unsafe.",
          409,
        );
      encoded = await readFile(this.browserStageIndexPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.browserStageRecords = new Map();
        return this.browserStageRecords;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(encoded);
    } catch {
      fail(
        "import.sourceUnavailable",
        "Private browser staging metadata is invalid.",
        409,
      );
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Array.isArray((parsed as { records?: unknown }).records) ||
      (parsed as { records: unknown[] }).records.length >
        MAX_BROWSER_STAGE_RECORDS
    )
      fail(
        "import.sourceUnavailable",
        "Private browser staging metadata is invalid.",
        409,
      );
    const records = new Map<string, BrowserStageRecord>();
    for (const item of (parsed as { records: unknown[] }).records) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        fail(
          "import.sourceUnavailable",
          "Private browser staging metadata is invalid.",
          409,
        );
      const record = item as Partial<BrowserStageRecord>;
      // Legacy receipts cannot prove which scan supplied the bytes; restage them.
      if (record.discoveryFingerprint === undefined) continue;
      if (
        typeof record.selectionId !== "string" ||
        !record.selectionId ||
        typeof record.occurrenceId !== "string" ||
        !record.occurrenceId ||
        typeof record.hash !== "string" ||
        !/^[a-f0-9]{64}$/u.test(record.hash) ||
        !Number.isSafeInteger(record.byteLength) ||
        record.byteLength! < 1 ||
        typeof record.extension !== "string" ||
        !/^\.[a-z0-9]{1,12}$/u.test(record.extension) ||
        typeof record.stagedAt !== "string" ||
        !Number.isFinite(Date.parse(record.stagedAt)) ||
        typeof record.discoveryFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/u.test(record.discoveryFingerprint)
      )
        fail(
          "import.sourceUnavailable",
          "Private browser staging metadata is invalid.",
          409,
        );
      const safe = record as BrowserStageRecord;
      const key = `${safe.selectionId}\0${safe.occurrenceId}`;
      if (records.has(key))
        fail(
          "import.sourceUnavailable",
          "Private browser staging metadata contains duplicate entries.",
          409,
        );
      records.set(key, safe);
    }
    this.browserStageRecords = records;
    return records;
  }

  private async persistBrowserStageRecords(
    records: Map<string, BrowserStageRecord>,
  ): Promise<void> {
    const parent = join(this.directory, "analysis");
    await mkdir(parent, { mode: 0o700, recursive: true });
    const parentInfo = await lstat(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
      fail("import.failed", "Private browser staging storage is unsafe.", 409);
    const temporary = `${this.browserStageIndexPath}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify({ version: 1, records: [...records.values()] })}\n`,
        "utf8",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.browserStageIndexPath);
    await syncPrivateDirectory(parent);
    this.browserStageRecords = records;
  }

  private async hashFile(path: string): Promise<string> {
    const hash = createHash("sha256");
    await pipeline(
      createReadStream(path),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      }),
      new Transform({
        transform(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
    return hash.digest("hex");
  }

  private resolveStatus(
    expected: ExpectedManifest,
    entries: readonly { status: "verified" | "failed" | "excluded" }[],
    cancelled: boolean,
  ): ImportBatchStatus {
    if (cancelled) return "cancelled";
    const failures = entries.filter(({ status }) => status === "failed").length;
    const verified = entries.filter(
      ({ status }) => status === "verified",
    ).length;
    if (!failures) return "sealed";
    if (expected.partialPolicy === "allow-readable" && verified > 0)
      return "partial";
    return "failed";
  }
}
