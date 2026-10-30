import { createHash, randomUUID } from "node:crypto";
import { syncPrivateDirectory } from "./directory-sync.js";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ApplicationError,
  SOURCE_DISCOVERY_LIMITS,
  type CatalogSourceSelection,
  type FileOccurrence,
} from "@openfilm/core";
import type {
  CatalogOccurrenceMembership,
  ProjectCatalog,
} from "@openfilm/catalog";
import { FilesystemSource } from "@openfilm/media";
import {
  iterateMediaCandidates,
  type MediaCandidate,
  type MediaSourceAdapterV2,
  type SourceInput,
} from "@openfilm/plugin-sdk";
import type { SourceDraftService } from "./source-draft.js";

export type {
  CatalogOccurrenceMembership,
  CatalogOccurrencePage,
} from "@openfilm/catalog";

export { SOURCE_DISCOVERY_LIMITS } from "@openfilm/core";

export interface BrowserMediaCandidateInput {
  relativePath: string;
  name: string;
  size: number;
  modifiedAt?: string;
}

export interface BrowserScanInput {
  projectId: string;
  baseRevision: number;
  requestId: string;
  selectionId: string;
  scanRevision?: number;
  candidates?: BrowserMediaCandidateInput[];
}

interface BrowserScanSession {
  projectId: string;
  baseRevision: number;
  requestId: string;
  selectionId: string;
  kind: "file" | "folder";
  recursive: boolean;
  logicalRootId: string;
  scanRevision: number;
  summary: SourceDiscoverySummary;
  seenPaths: Set<string>;
  duplicateKeys: Set<string>;
  candidateCount: number;
}

interface CompletedScanReceipt {
  selectionId: string;
  draftRevision: number;
  scanRevision: number;
  summary: Pick<
    SourceDiscoverySummary,
    "discovered" | "supported" | "possibleDuplicates" | "skipped"
  >;
}

interface StoredScanReceipts {
  version: 1;
  records: CompletedScanReceipt[];
}

export interface SourceDiscoveryInput {
  projectId: string;
  baseRevision: number;
  requestId: string;
  selectionIds?: string[];
  pageSize?: number;
  maximumCandidates?: number;
  signal?: AbortSignal;
  onPage?: (page: readonly CatalogOccurrenceMembership[]) => void;
  onProgress?: (summary: Readonly<SourceDiscoverySummary>) => void;
}

export interface SourceDiscoveryFailure {
  selectionId: string;
  code: "import.sourceUnavailable" | "request.invalid";
}

export interface SourceDiscoverySummary {
  projectId: string;
  draftRevision: number;
  sourcesRequested: number;
  sourcesScanned: number;
  discovered: number;
  supported: number;
  possibleDuplicates: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
  failures: SourceDiscoveryFailure[];
}

export interface SourceDiscoveryProgress {
  requestId: string;
  projectId: string;
  status: "running" | "completed" | "cancelled" | "failed";
  summary: SourceDiscoverySummary;
}

function fail(
  code:
    | "import.draftStale"
    | "import.sourceUnavailable"
    | "request.invalid"
    | "jobs.busy"
    | "request.tooLarge",
  message: string,
  status = 400,
): never {
  throw new ApplicationError(code, message, status);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function relativePathFor(candidate: MediaCandidate): string {
  const value = candidate.relativePath ?? basename(candidate.name);
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new ApplicationError(
      "request.invalid",
      "Source adapter returned an unsafe relative path.",
    );
  return normalized;
}

function kindOf(candidate: MediaCandidate): FileOccurrence["fileKind"] {
  switch (candidate.mediaType) {
    case "image":
      return "image";
    case "video":
    case "360-video":
      return "video";
    case "audio":
      return "audio";
    default: {
      const extension = candidate.name.split(".").at(-1)?.toLowerCase();
      if (
        [
          "jpg",
          "jpeg",
          "png",
          "webp",
          "gif",
          "bmp",
          "tif",
          "tiff",
          "heic",
          "avif",
          "dng",
          "insp",
        ].includes(extension ?? "")
      )
        return "image";
      if (
        [
          "mp4",
          "mov",
          "m4v",
          "mkv",
          "avi",
          "webm",
          "mts",
          "m2ts",
          "insv",
          "360",
        ].includes(extension ?? "")
      )
        return "video";
      if (
        ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"].includes(
          extension ?? "",
        )
      )
        return "audio";
      return "unsupported";
    }
  }
}

function notify<T>(callback: ((value: T) => void) | undefined, value: T): void {
  try {
    callback?.(structuredClone(value));
  } catch {
    // Observers cannot corrupt the scan or prevent durable discovery writes.
  }
}

/** Shared application discovery logic used by Desktop, HTTP and CLI boundaries. */
export class SourceDiscoveryService {
  private readonly adapter: MediaSourceAdapterV2;
  private readonly receiptPath: string;
  private readonly browserScans = new Map<string, BrowserScanSession>();

  constructor(
    private readonly sourceDraft: SourceDraftService,
    private readonly catalog: ProjectCatalog,
    adapter: MediaSourceAdapterV2 = new FilesystemSource(),
  ) {
    this.adapter = adapter;
    this.receiptPath = join(
      sourceDraft.operationalDirectory,
      "analysis",
      "source-scan-receipts.json",
    );
  }

  async scan(input: SourceDiscoveryInput): Promise<SourceDiscoverySummary> {
    const draft = this.sourceDraft.get();
    if (input.projectId !== draft.projectId)
      fail(
        "request.invalid",
        "Source discovery belongs to a different project.",
        409,
      );
    if (input.baseRevision !== draft.revision)
      fail(
        "import.draftStale",
        "The source draft changed; refresh before scanning.",
        409,
      );
    if (
      !Number.isSafeInteger(input.baseRevision) ||
      input.baseRevision < 0 ||
      !input.projectId.trim() ||
      typeof input.requestId !== "string" ||
      !input.requestId.trim() ||
      input.requestId.length > 512 ||
      [...input.requestId].some((character) => character.charCodeAt(0) < 32)
    )
      fail(
        "request.invalid",
        "Source discovery project, revision and request ID are required.",
      );

    const ids = input.selectionIds ?? draft.selections.map(({ id }) => id);
    if (
      !Array.isArray(ids) ||
      ids.length > SOURCE_DISCOVERY_LIMITS.maximumSelectionsPerRequest ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || !id)
    )
      fail("request.invalid", "Source discovery selection IDs are invalid.");
    const selectionMap = new Map(
      draft.selections.map((selection) => [selection.id, selection]),
    );
    const selections = ids.map((id) => {
      const selection = selectionMap.get(id);
      if (!selection)
        fail(
          "import.sourceUnavailable",
          "A selected source is no longer available.",
          409,
        );
      return selection;
    });
    const pageSize = input.pageSize ?? SOURCE_DISCOVERY_LIMITS.pageSize;
    const maximumCandidates =
      input.maximumCandidates ??
      SOURCE_DISCOVERY_LIMITS.maximumCandidatesPerRequest;
    if (
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > SOURCE_DISCOVERY_LIMITS.maximumPageSize ||
      !Number.isSafeInteger(maximumCandidates) ||
      maximumCandidates < 1 ||
      maximumCandidates > SOURCE_DISCOVERY_LIMITS.maximumCandidatesPerRequest
    )
      fail("request.invalid", "Source discovery bounds are invalid.");

    const summary: SourceDiscoverySummary = {
      projectId: input.projectId,
      draftRevision: draft.revision,
      sourcesRequested: selections.length,
      sourcesScanned: 0,
      discovered: 0,
      supported: 0,
      possibleDuplicates: 0,
      skipped: 0,
      failed: 0,
      cancelled: false,
      failures: [],
    };
    const possibleDuplicateKeys = new Set<string>();
    let stopped = false;

    for (const selection of selections) {
      if (input.signal?.aborted) {
        summary.cancelled = true;
        break;
      }
      const beforeSelection = {
        discovered: summary.discovered,
        supported: summary.supported,
        possibleDuplicates: summary.possibleDuplicates,
        skipped: summary.skipped,
      };
      if (selection.accessClass !== "native-path") {
        summary.failed++;
        summary.failures.push({
          selectionId: selection.id,
          code: "import.sourceUnavailable",
        });
        continue;
      }

      const pending: CatalogOccurrenceMembership[] = [];
      let scanRevision: number;
      const flush = () => {
        if (!pending.length) return;
        this.catalog.multiSource.upsertOccurrences(selection.id, pending);
        notify(input.onPage, pending);
        pending.length = 0;
      };

      try {
        const localPath = selection.accessRef.startsWith("file:")
          ? fileURLToPath(selection.accessRef)
          : selection.accessRef;
        const info = await lstat(localPath);
        if (
          info.isSymbolicLink() ||
          (selection.kind === "folder" && !info.isDirectory()) ||
          (selection.kind === "file" && !info.isFile())
        )
          throw new Error("Source is unavailable or unsafe.");
        await realpath(localPath);
        const logicalRootId = `root:${selection.id}`;
        const persistedSelection: CatalogSourceSelection = {
          id: selection.id,
          projectId: selection.projectId,
          kind: selection.kind,
          displayName: selection.displayName,
          logicalRootId,
          recursive: selection.recursive,
          selectionRevision: selection.selectionRevision,
        };
        this.catalog.multiSource.saveSelection(persistedSelection);
        await this.removeScanReceipt(selection.id);
        scanRevision = this.catalog.multiSource.nextScanRevision(selection.id);

        const sourceInput: SourceInput = {
          uri: pathToFileURL(localPath).href,
          type: selection.kind,
          options: { recursive: selection.recursive },
        };
        summary.sourcesScanned++;
        const skipped = () => {
          summary.skipped++;
        };
        for await (const candidate of iterateMediaCandidates(
          this.adapter,
          sourceInput,
          { signal: input.signal, onSkipped: skipped },
        )) {
          if (input.signal?.aborted) {
            summary.cancelled = true;
            stopped = true;
            break;
          }
          if (summary.discovered >= maximumCandidates)
            throw new ApplicationError(
              "request.tooLarge",
              "Source discovery reached its bounded candidate limit.",
              413,
            );
          const relativePath = relativePathFor(candidate);
          const fileKind = kindOf(candidate);
          const duplicateKey = `${fileKind}\0${candidate.name.toLocaleLowerCase()}\0${candidate.size ?? "?"}`;
          if (possibleDuplicateKeys.has(duplicateKey))
            summary.possibleDuplicates++;
          else possibleDuplicateKeys.add(duplicateKey);
          summary.discovered++;
          if (fileKind === "unsupported") summary.skipped++;
          else summary.supported++;
          const occurrence: FileOccurrence = {
            id: `occ:${digest(`${logicalRootId}\0${relativePath}`)}`,
            logicalRootId,
            displayName: basename(relativePath),
            relativePath,
            fileKind,
            ...(candidate.size === undefined
              ? {}
              : { byteLength: candidate.size }),
            ...(candidate.modifiedAt === undefined
              ? {}
              : { modifiedAt: candidate.modifiedAt }),
            availability: "available",
            scanRevision,
          };
          pending.push({ occurrence, included: true });
          if (pending.length >= pageSize) {
            flush();
            notify(input.onProgress, summary);
          }
        }
        if (input.signal?.aborted) {
          summary.cancelled = true;
          stopped = true;
        }
        flush();
        if (!summary.cancelled)
          this.catalog.multiSource.markUnseenOccurrencesMissing(
            selection.id,
            scanRevision,
          );
        if (!summary.cancelled)
          await this.saveScanReceipt({
            selectionId: selection.id,
            draftRevision: input.baseRevision,
            scanRevision,
            summary: {
              discovered: summary.discovered - beforeSelection.discovered,
              supported: summary.supported - beforeSelection.supported,
              possibleDuplicates:
                summary.possibleDuplicates - beforeSelection.possibleDuplicates,
              skipped: summary.skipped - beforeSelection.skipped,
            },
          });
        notify(input.onProgress, summary);
      } catch (error) {
        flush();
        if (
          error instanceof ApplicationError &&
          error.code === "request.tooLarge"
        )
          throw error;
        if (
          input.signal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          summary.cancelled = true;
          break;
        }
        summary.failed++;
        summary.failures.push({
          selectionId: selection.id,
          code:
            error instanceof ApplicationError &&
            error.code === "request.invalid"
              ? "request.invalid"
              : "import.sourceUnavailable",
        });
        notify(input.onProgress, summary);
      }
      if (stopped) break;
    }
    return structuredClone(summary);
  }

  async getReadiness(): Promise<SourceDiscoverySummary | undefined> {
    const draft = this.sourceDraft.get();
    if (!draft.selections.length) return undefined;
    const receipts = await this.readScanReceipts();
    const selected: CompletedScanReceipt[] = [];
    for (const source of draft.selections) {
      if (
        ![
          "native-path",
          "persistent-browser-handle",
          "ephemeral-browser-file",
        ].includes(source.accessClass)
      )
        return undefined;
      const receipt = receipts.get(source.id);
      if (!receipt || receipt.draftRevision !== draft.revision)
        return undefined;
      selected.push(receipt);
    }
    return {
      projectId: draft.projectId,
      draftRevision: draft.revision,
      sourcesRequested: draft.selections.length,
      sourcesScanned: selected.length,
      discovered: selected.reduce(
        (sum, receipt) => sum + receipt.summary.discovered,
        0,
      ),
      supported: selected.reduce(
        (sum, receipt) => sum + receipt.summary.supported,
        0,
      ),
      possibleDuplicates: selected.reduce(
        (sum, receipt) => sum + receipt.summary.possibleDuplicates,
        0,
      ),
      skipped: selected.reduce(
        (sum, receipt) => sum + receipt.summary.skipped,
        0,
      ),
      failed: 0,
      cancelled: false,
      failures: [],
    };
  }

  async beginBrowserScan(
    input: Omit<BrowserScanInput, "scanRevision" | "candidates">,
  ): Promise<{ scanRevision: number; summary: SourceDiscoverySummary }> {
    this.assertBrowserScanIdentity(input);
    const sessionKey = this.browserSessionKey(input.projectId, input.requestId);
    if (this.browserScans.has(sessionKey))
      fail(
        "request.invalid",
        "This browser source scan is already active.",
        409,
      );
    if (this.browserScans.size >= SOURCE_DISCOVERY_LIMITS.maximumBrowserScans)
      fail("jobs.busy", "Too many browser source scans are active.", 409);
    const draft = this.sourceDraft.get();
    const selection = draft.selections.find(
      ({ id }) => id === input.selectionId,
    );
    if (
      !selection ||
      selection.projectId !== input.projectId ||
      !["persistent-browser-handle", "ephemeral-browser-file"].includes(
        selection.accessClass,
      )
    )
      fail(
        "import.sourceUnavailable",
        "Choose a browser source from the current project.",
        409,
      );
    await this.removeScanReceipt(selection.id);
    const logicalRootId = `root:${selection.id}`;
    this.catalog.multiSource.saveSelection({
      id: selection.id,
      projectId: selection.projectId,
      kind: selection.kind,
      displayName: selection.displayName,
      logicalRootId,
      recursive: selection.recursive,
      selectionRevision: selection.selectionRevision,
    });
    const scanRevision = this.catalog.multiSource.nextScanRevision(
      selection.id,
    );
    const summary: SourceDiscoverySummary = {
      projectId: input.projectId,
      draftRevision: input.baseRevision,
      sourcesRequested: 1,
      sourcesScanned: 1,
      discovered: 0,
      supported: 0,
      possibleDuplicates: 0,
      skipped: 0,
      failed: 0,
      cancelled: false,
      failures: [],
    };
    this.browserScans.set(sessionKey, {
      ...input,
      kind: selection.kind,
      recursive: selection.recursive,
      logicalRootId,
      scanRevision,
      summary,
      seenPaths: new Set(),
      duplicateKeys: new Set(),
      candidateCount: 0,
    });
    return { scanRevision, summary: structuredClone(summary) };
  }

  async appendBrowserScanPage(
    input: BrowserScanInput,
  ): Promise<SourceDiscoverySummary> {
    const session = this.getBrowserSession(input);
    if (
      !Array.isArray(input.candidates) ||
      input.candidates.length < 1 ||
      input.candidates.length > SOURCE_DISCOVERY_LIMITS.browserPageSize
    )
      fail(
        "request.invalid",
        "A browser scan page must contain 1–128 candidates.",
      );
    if (
      session.candidateCount + input.candidates.length >
      SOURCE_DISCOVERY_LIMITS.maximumCandidatesPerRequest
    )
      fail(
        "request.tooLarge",
        "Browser discovery reached its bounded candidate limit.",
        413,
      );

    const candidates = input.candidates.map((candidate) => {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      )
        fail("request.invalid", "A browser candidate is invalid.");
      if (
        typeof candidate.name !== "string" ||
        typeof candidate.relativePath !== "string"
      )
        fail(
          "request.invalid",
          "A browser candidate name and path are required.",
        );
      const relativePath = relativePathFor({
        name: candidate.name,
        relativePath: candidate.relativePath,
      } as MediaCandidate);
      if (
        [...relativePath].length > 4096 ||
        [...candidate.name].length > 512 ||
        basename(relativePath) !== candidate.name
      )
        fail("request.invalid", "A browser candidate name or path is invalid.");
      if (
        (session.kind === "file" || !session.recursive) &&
        relativePath.includes("/")
      )
        fail(
          "request.invalid",
          "A browser candidate violates the selected source recursion policy.",
        );
      if (!Number.isSafeInteger(candidate.size) || candidate.size < 0)
        fail("request.invalid", "A browser candidate size is invalid.");
      if (
        candidate.modifiedAt !== undefined &&
        (!Number.isFinite(Date.parse(candidate.modifiedAt)) ||
          [...candidate.modifiedAt].length > 128)
      )
        fail(
          "request.invalid",
          "A browser candidate modification time is invalid.",
        );
      if (session.seenPaths.has(relativePath))
        fail(
          "request.invalid",
          "A browser scan cannot repeat a relative path.",
        );
      const fileKind = kindOf({
        name: candidate.name,
        relativePath,
      } as MediaCandidate);
      const duplicateKey = `${fileKind}\0${candidate.name.toLocaleLowerCase()}\0${candidate.size}`;
      return { candidate, relativePath, fileKind, duplicateKey };
    });
    session.candidateCount += candidates.length;
    for (const { relativePath } of candidates)
      session.seenPaths.add(relativePath);
    const pending: CatalogOccurrenceMembership[] = [];
    for (const {
      candidate,
      relativePath,
      fileKind,
      duplicateKey,
    } of candidates) {
      if (fileKind === "unsupported") {
        session.summary.skipped++;
        continue;
      }
      if (session.duplicateKeys.has(duplicateKey))
        session.summary.possibleDuplicates++;
      else session.duplicateKeys.add(duplicateKey);
      session.summary.discovered++;
      session.summary.supported++;
      const occurrence: FileOccurrence = {
        id: `occ:${digest(`${session.logicalRootId}\0${relativePath}`)}`,
        logicalRootId: session.logicalRootId,
        displayName: candidate.name,
        relativePath,
        fileKind,
        byteLength: candidate.size,
        ...(candidate.modifiedAt === undefined
          ? {}
          : { modifiedAt: candidate.modifiedAt }),
        availability: "available",
        scanRevision: session.scanRevision,
      };
      pending.push({ occurrence, included: true });
    }
    if (pending.length)
      this.catalog.multiSource.upsertOccurrences(session.selectionId, pending);
    return structuredClone(session.summary);
  }

  async finishBrowserScan(
    input: Omit<BrowserScanInput, "candidates"> & { cancelled?: boolean },
  ): Promise<SourceDiscoverySummary> {
    const session = this.getBrowserSession(input);
    const cancelled = input.cancelled === true;
    session.summary.cancelled = cancelled;
    if (!cancelled) {
      this.catalog.multiSource.markUnseenOccurrencesMissing(
        session.selectionId,
        session.scanRevision,
      );
      await this.saveScanReceipt({
        selectionId: session.selectionId,
        draftRevision: session.baseRevision,
        scanRevision: session.scanRevision,
        summary: {
          discovered: session.summary.discovered,
          supported: session.summary.supported,
          possibleDuplicates: session.summary.possibleDuplicates,
          skipped: session.summary.skipped,
        },
      });
    }
    this.browserScans.delete(
      this.browserSessionKey(input.projectId, input.requestId),
    );
    return structuredClone(session.summary);
  }

  cancelBrowserScan(
    input: Pick<BrowserScanInput, "projectId" | "requestId">,
  ): boolean {
    const key = this.browserSessionKey(input.projectId, input.requestId);
    const session = this.browserScans.get(key);
    if (!session) return false;
    session.summary.cancelled = true;
    this.browserScans.delete(key);
    return true;
  }

  private browserSessionKey(projectId: string, requestId: string): string {
    return `${projectId}\0${requestId}`;
  }

  private assertBrowserScanIdentity(
    input: Pick<
      BrowserScanInput,
      "projectId" | "baseRevision" | "requestId" | "selectionId"
    >,
  ): void {
    if (
      !input.projectId.trim() ||
      !input.selectionId.trim() ||
      !Number.isSafeInteger(input.baseRevision) ||
      input.baseRevision < 0 ||
      !input.requestId.trim() ||
      input.requestId.length > 512
    )
      fail(
        "request.invalid",
        "Browser scan project, selection, revision and request ID are required.",
      );
    const draft = this.sourceDraft.get();
    if (draft.projectId !== input.projectId)
      fail("request.invalid", "Browser scan belongs to another project.", 409);
    if (draft.revision !== input.baseRevision)
      fail(
        "import.draftStale",
        "The source draft changed; refresh before scanning.",
        409,
      );
  }

  private getBrowserSession(input: BrowserScanInput): BrowserScanSession {
    this.assertBrowserScanIdentity(input);
    const session = this.browserScans.get(
      this.browserSessionKey(input.projectId, input.requestId),
    );
    if (
      !session ||
      session.selectionId !== input.selectionId ||
      session.baseRevision !== input.baseRevision ||
      session.scanRevision !== input.scanRevision
    )
      fail(
        "import.draftStale",
        "The browser source scan has expired or changed.",
        409,
      );
    return session;
  }

  private async readScanReceipts(): Promise<Map<string, CompletedScanReceipt>> {
    let encoded: string;
    try {
      const info = await lstat(this.receiptPath);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 4 * 1024 * 1024
      )
        return new Map();
      encoded = await readFile(this.receiptPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
      return new Map();
    }
    let value: unknown;
    try {
      value = JSON.parse(encoded);
    } catch {
      return new Map();
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      (value as { version?: unknown }).version !== 1 ||
      !Array.isArray((value as { records?: unknown }).records) ||
      (value as { records: unknown[] }).records.length > 10_000
    )
      return new Map();
    const records = new Map<string, CompletedScanReceipt>();
    for (const candidate of (value as { records: unknown[] }).records) {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      )
        return new Map();
      const record = candidate as Partial<CompletedScanReceipt>;
      const summary = record.summary as
        Partial<CompletedScanReceipt["summary"]> | undefined;
      if (
        typeof record.selectionId !== "string" ||
        !record.selectionId ||
        !Number.isSafeInteger(record.draftRevision) ||
        record.draftRevision! < 0 ||
        !Number.isSafeInteger(record.scanRevision) ||
        record.scanRevision! < 1 ||
        !summary ||
        [
          summary.discovered,
          summary.supported,
          summary.possibleDuplicates,
          summary.skipped,
        ].some(
          (count) =>
            !Number.isSafeInteger(count) ||
            count! < 0 ||
            count! > SOURCE_DISCOVERY_LIMITS.maximumCandidatesPerRequest,
        )
      )
        return new Map();
      records.set(record.selectionId, {
        selectionId: record.selectionId,
        draftRevision: record.draftRevision!,
        scanRevision: record.scanRevision!,
        summary: {
          discovered: summary.discovered!,
          supported: summary.supported!,
          possibleDuplicates: summary.possibleDuplicates!,
          skipped: summary.skipped!,
        },
      });
    }
    return records;
  }

  private async saveScanReceipt(receipt: CompletedScanReceipt): Promise<void> {
    const records = await this.readScanReceipts();
    const liveIds = new Set(
      this.sourceDraft.get().selections.map(({ id }) => id),
    );
    for (const selectionId of records.keys())
      if (!liveIds.has(selectionId)) records.delete(selectionId);
    records.set(receipt.selectionId, structuredClone(receipt));
    if (records.size > 10_000)
      fail("request.tooLarge", "The private scan receipt index is full.", 413);
    const directory = join(this.sourceDraft.operationalDirectory, "analysis");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      fail(
        "import.sourceUnavailable",
        "Private scan receipt storage is unsafe.",
        409,
      );
    const temporaryPath = join(directory, `.source-scan-${randomUUID()}.tmp`);
    const target = await open(temporaryPath, "wx", 0o600);
    try {
      const body = JSON.stringify({
        version: 1,
        records: [...records.values()],
      } satisfies StoredScanReceipts);
      await target.writeFile(`${body}\n`, "utf8");
      await target.sync();
    } finally {
      await target.close();
    }
    await rename(temporaryPath, this.receiptPath);
    await syncPrivateDirectory(directory);
  }

  private async removeScanReceipt(selectionId: string): Promise<void> {
    const records = await this.readScanReceipts();
    if (!records.delete(selectionId)) return;
    const directory = join(this.sourceDraft.operationalDirectory, "analysis");
    const temporaryPath = join(directory, `.source-scan-${randomUUID()}.tmp`);
    const target = await open(temporaryPath, "wx", 0o600);
    try {
      await target.writeFile(
        `${JSON.stringify({ version: 1, records: [...records.values()] } satisfies StoredScanReceipts)}\n`,
        "utf8",
      );
      await target.sync();
    } finally {
      await target.close();
    }
    await rename(temporaryPath, this.receiptPath);
    await syncPrivateDirectory(directory);
  }
}
