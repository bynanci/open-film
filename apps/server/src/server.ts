// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { constants, createReadStream } from "node:fs";
import {
  copyFile,
  realpath,
  stat,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import {
  resolve,
  relative,
  isAbsolute,
  dirname,
  extname,
  basename,
  join,
} from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  OpenFilmApplication,
  TimelineEditor,
  TimelineEditorError,
  parseGpxTrack,
  MediaRelinker,
  MediaRelinkError as RelinkError,
  type TimelineEditInput,
  type CreateFilmOptions,
  resolveUserDataDirectory,
  createReviewOwner,
  resolveRenderQuality,
  type ReviewOptions,
  type ScenePlanAcceptance,
  type ScenePlanOptions,
  type DirectionReviewAcceptance,
  type GraphicSceneAgentAcceptance,
  type ProjectVersionCreateInput,
  type ProjectVersionRestoreInput,
  type CollectPlanInput,
  type CollectCoveragePlanInput,
  type CollectMediaCreateInput,
  type SourceSelectionInput,
} from "@openfilm/application";
import type {
  SourceBatchProgress,
  SourceBatchSealResult,
  SourceDiscoveryProgress,
  SourceDiscoverySummary,
  SourceAnalysisProgress,
  SourceAnalysisRunRecord,
} from "@openfilm/application";
import {
  validateProject,
  validateFilmLook,
  validateExportProfile,
  timebaseRate,
  migrateProject,
  validateStory,
  validateTranscriptSegmentId,
  ApplicationError,
  errorInfo,
  PROJECT_CONTENT_LOCALES,
  type ApplicationErrorCode,
  type Job,
  type FilmLook,
  type ExportProfile,
  type MediaAsset,
  type Story,
  type GlossaryInput,
  type ReviewSuggestion,
  type ProjectVersionDiff,
  type ProjectVersionRecord,
  type ProjectTimebaseV1,
  type TravelContextV1,
  type VisualSamplingV1,
  type ReviewDecisionOperation,
} from "@openfilm/core";
import { previewIssue, isSupportedMediaFile } from "@openfilm/media";
import { resolveFilmSettings, preserveUserBeatText } from "@openfilm/story";
import { proposalTemplate } from "@openfilm/template-proposal";
import {
  type TranscriptHistoryInput,
  type TranscriptMutationInput,
  CATALOG_SCHEMA_VERSION,
} from "@openfilm/catalog";
import type {
  LanguageProvider,
  TranscriptionProvider,
  VisionSampleProvider,
  RemoteProviderConsent,
} from "@openfilm/plugin-sdk";

type Body = Record<string, unknown>;
const DEFAULT_GRAPHIC_SCENE_AGENT_PROVIDER_TIMEOUT_MS = 60_000;
const httpErrorCodes: Partial<Record<number, ApplicationErrorCode>> = {
  400: "request.invalid",
  403: "request.forbidden",
  404: "request.notFound",
  409: "jobs.busy",
  413: "request.tooLarge",
  415: "request.unsupported",
  422: "media.unsupported",
  503: "workspace.closing",
};
class HttpError extends ApplicationError {
  constructor(
    status: number,
    message: string,
    code?: ApplicationErrorCode,
    params?: Record<string, string | number>,
  ) {
    super(
      code ?? httpErrorCodes[status] ?? "operation.failed",
      message,
      status,
      params,
    );
  }
}

function text(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim())
    throw new HttpError(400, `${key} is required.`);
  return value.trim();
}
function keys(data: Body, allowed: string[]): void {
  if (Object.keys(data).some((key) => !allowed.includes(key)))
    throw new HttpError(400, "Unsupported request field.");
}
function pageOptions(url: URL, maximum = 200) {
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > maximum
  )
    throw new HttpError(
      400,
      `Use a nonnegative offset and a limit between 1 and ${maximum}.`,
    );
  return { offset, limit };
}
function reviewOptions(
  data: Body,
): Pick<ReviewOptions, "batchSize" | "segmentIds"> {
  if (
    data.batchSize !== undefined &&
    (typeof data.batchSize !== "number" ||
      !Number.isInteger(data.batchSize) ||
      data.batchSize < 1 ||
      data.batchSize > 100)
  )
    throw new HttpError(400, "Review batch size must be between 1 and 100.");
  if (
    data.segmentIds !== undefined &&
    (!Array.isArray(data.segmentIds) ||
      data.segmentIds.length > 10000 ||
      !data.segmentIds.length ||
      new Set(data.segmentIds).size !== data.segmentIds.length)
  )
    throw new HttpError(400, "Choose unique transcript segment identifiers.");
  let segmentIds: string[] | undefined;
  if (Array.isArray(data.segmentIds)) {
    try {
      segmentIds = data.segmentIds.map((id) => validateTranscriptSegmentId(id));
    } catch {
      throw new HttpError(
        400,
        "Choose nonblank transcript segment identifiers.",
        "request.invalid",
      );
    }
  }
  return {
    batchSize: data.batchSize as number | undefined,
    segmentIds,
  };
}
function filePath(data: Body, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new HttpError(400, `${key} is required.`);
  return value;
}
function projectTimebase(value: unknown): ProjectTimebaseV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "timebase must be an object.");
  keys(value as Body, [
    "version",
    "rateNumerator",
    "rateDenominator",
    "dropFrame",
  ]);
  const timebase = value as ProjectTimebaseV1;
  try {
    timebaseRate(timebase);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Invalid timebase.",
    );
  }
  return {
    version: timebase.version,
    rateNumerator: timebase.rateNumerator,
    rateDenominator: timebase.rateDenominator,
    dropFrame: timebase.dropFrame,
  };
}

function filmOptions(data: Body): CreateFilmOptions {
  if (
    data.projectContentLocale !== undefined &&
    !PROJECT_CONTENT_LOCALES.includes(data.projectContentLocale as never)
  )
    throw new HttpError(400, "Choose a supported film language.");
  if (
    data.filmSettings !== undefined &&
    (!data.filmSettings ||
      typeof data.filmSettings !== "object" ||
      Array.isArray(data.filmSettings))
  )
    throw new HttpError(400, "Film settings must be an object.");
  return {
    ...(data.timebase === undefined
      ? {}
      : { timebase: projectTimebase(data.timebase) }),
    ...(data.projectContentLocale === undefined
      ? {}
      : {
          projectContentLocale:
            data.projectContentLocale as CreateFilmOptions["projectContentLocale"],
        }),
    ...(data.filmSettings === undefined
      ? {}
      : {
          filmSettings: data.filmSettings as CreateFilmOptions["filmSettings"],
        }),
  };
}
function paths(data: Body, key: string, maximum = 10000): string[] {
  const value = data[key];
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > maximum ||
    value.some(
      (path) => typeof path !== "string" || !path.trim() || path.includes("\0"),
    )
  )
    throw new HttpError(
      400,
      `${key} must contain between 1 and ${maximum} paths.`,
    );
  return [...new Set(value)] as string[];
}
function sourceSelectionInputs(data: Body): SourceSelectionInput[] {
  if (
    !Array.isArray(data.sources) ||
    !data.sources.length ||
    data.sources.length > 10_000
  )
    throw new HttpError(400, "Choose between 1 and 10,000 sources.");
  return data.sources.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new HttpError(400, "Each source must be an object.");
    const source = value as Record<string, unknown>;
    keys(source, [
      "kind",
      "displayName",
      "accessClass",
      "accessRef",
      "recursive",
    ]);
    if (
      typeof source.kind !== "string" ||
      typeof source.displayName !== "string" ||
      typeof source.accessClass !== "string" ||
      typeof source.accessRef !== "string" ||
      (source.recursive !== undefined && typeof source.recursive !== "boolean")
    )
      throw new HttpError(400, "A source descriptor has invalid fields.");
    return source as unknown as SourceSelectionInput;
  });
}

function draftMutation(data: Body): {
  projectId: string;
  baseRevision: number;
  requestId: string;
} {
  if (!Number.isSafeInteger(data.baseRevision) || Number(data.baseRevision) < 0)
    throw new HttpError(400, "baseRevision must be a nonnegative integer.");
  return {
    projectId: text(data, "projectId"),
    baseRevision: Number(data.baseRevision),
    requestId: text(data, "requestId"),
  };
}
function safeFilename(name: string): boolean {
  return (
    !!name.trim() &&
    ![...name].some((char) => char.charCodeAt(0) < 32) &&
    !/[\\/]/u.test(name) &&
    name !== "." &&
    name !== ".."
  );
}
function safeExportName(name: string): boolean {
  if (safeFilename(name)) return true;
  const parts = name.split("/");
  if (parts.length !== 2) return false;
  const [directory, filename] = parts;
  return (
    /^stems-[A-Za-z0-9][A-Za-z0-9_-]{7,95}$/u.test(directory!) &&
    (/^(narration|music|ambience|dialogue)\.wav$/u.test(filename!) ||
      filename === "manifest.json")
  );
}
function profileRenderSelection(data: Body): {
  lookOverride?: FilmLook | null;
  captionTrackId?: string | null;
} {
  const selection: {
    lookOverride?: FilmLook | null;
    captionTrackId?: string | null;
  } = {};
  if (Object.hasOwn(data, "lookOverride")) {
    try {
      selection.lookOverride =
        data.lookOverride === null ? null : validateFilmLook(data.lookOverride);
    } catch (error) {
      throw new ApplicationError(
        "request.invalid",
        "Choose a supported film look with strength between zero and one.",
        400,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  if (Object.hasOwn(data, "captionTrackId")) {
    if (data.captionTrackId !== null && typeof data.captionTrackId !== "string")
      throw new ApplicationError(
        "request.invalid",
        "A caption track selection must be a saved track ID or null.",
      );
    selection.captionTrackId = data.captionTrackId as string | null;
  }
  return selection;
}
function parseProfileForFormats(
  value: unknown,
  formats: readonly ExportProfile["format"][],
): ExportProfile {
  let profile: ExportProfile;
  try {
    profile = validateExportProfile(value);
  } catch (error) {
    throw new ApplicationError(
      "request.invalid",
      "Choose a supported versioned Export Profile.",
      400,
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!formats.includes(profile.format))
    throw new ApplicationError(
      "request.invalid",
      `This export operation supports ${formats.join(" or ")} profiles.`,
    );
  return profile;
}
function projectFolderTitle(title: string): string {
  const clean = [...title]
    .filter((char) => char.charCodeAt(0) >= 32)
    .join("")
    .replace(/[<>:"/\\|?*]/gu, "-");
  let prefix = "";
  for (const char of clean) {
    if (Buffer.byteLength(prefix + char, "utf8") > 180) break;
    prefix += char;
  }
  return prefix.replace(/[ .]+$/u, "") || "Film";
}
function systemLocale(): string {
  const value =
    process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG;
  try {
    if (value && value !== "C" && value !== "POSIX")
      return Intl.getCanonicalLocales(
        value.split(".")[0]!.replaceAll("_", "-").split("@")[0]!,
      )[0]!;
  } catch {
    /* Intl uses the platform locale when its environment value is unusable. */
  }
  return new Intl.DateTimeFormat().resolvedOptions().locale;
}

async function inspectCatalog(path: string): Promise<void> {
  // A normal read-only SQLite connection can create WAL sidecars. Recent
  // projects must remain untouched, including projects on read-only volumes.
  let temporary: string | undefined;
  let database: DatabaseSync | undefined;
  try {
    const walPath = `${path}-wal`;
    const wal = await lstat(walPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (wal && (!wal.isFile() || wal.isSymbolicLink()))
      throw new Error("Catalog WAL must be a regular file");
    if (wal?.size) {
      // Immutable connections ignore committed WAL pages. Inspect a disposable
      // copy when another instance or crash recovery has uncheckpointed data.
      temporary = await mkdtemp(join(tmpdir(), "openfilm-recent-catalog-"));
      const snapshot = join(temporary, "database.sqlite");
      await copyFile(path, snapshot, constants.COPYFILE_FICLONE);
      await copyFile(walPath, `${snapshot}-wal`, constants.COPYFILE_FICLONE);
      database = new DatabaseSync(snapshot, { readOnly: true });
    } else {
      const uri = pathToFileURL(path);
      uri.searchParams.set("mode", "ro");
      uri.searchParams.set("immutable", "1");
      database = new DatabaseSync(uri.href, { readOnly: true });
    }
    const version = Number(
      database.prepare("PRAGMA user_version").get()?.user_version ?? 0,
    );
    if (version > CATALOG_SCHEMA_VERSION)
      throw new Error("Unsupported future catalog schema");
    const integrity = database.prepare("PRAGMA quick_check(1)").get();
    if (integrity?.quick_check !== "ok")
      throw new Error("The project catalog is corrupt");
    database
      .prepare(
        "SELECT id, uri, name, media_type, captured_at, rating, favorite, rejected, locked, data FROM assets LIMIT 1",
      )
      .get();
    database.prepare("SELECT id, created_at, data FROM jobs LIMIT 1").get();
    if (version >= 2) {
      database
        .prepare(
          "SELECT revision,document_id,asset_id,source_hash,provider_id,provider_version,model,header,segment_count FROM intelligence_transcripts LIMIT 1",
        )
        .get();
      database
        .prepare(
          "SELECT revision,position,segment_id,start,end,text,data FROM intelligence_segments LIMIT 1",
        )
        .get();
      database
        .prepare(
          "SELECT updated_seq,kind,asset_id,source_hash,provider_id,provider_version,model,data FROM intelligence_cache LIMIT 1",
        )
        .get();
      database
        .prepare(
          "SELECT id,asset_id,source_hash,time,data FROM intelligence_markers LIMIT 1",
        )
        .get();
    }
    if (version >= 3) {
      for (const query of [
        "SELECT sequence,revision_id,asset_id,source_hash,data FROM transcript_revision_metadata LIMIT 1",
        "SELECT asset_id,source_hash,revision_id,undo,redo FROM transcript_editor_history LIMIT 1",
        "SELECT request_id,asset_id,source_hash,fingerprint,revision_id FROM transcript_edit_requests LIMIT 1",
        "SELECT id,source,data FROM project_glossary LIMIT 1",
        "SELECT id,asset_id,segment_id,source_revision_id,status,dedupe_key,created_at,data FROM review_suggestions LIMIT 1",
        "SELECT job_id,batch_index,asset_id,source_revision_id,data FROM review_batches LIMIT 1",
      ])
        database.prepare(query).get();
    }
    if (version >= 5)
      database
        .prepare(
          "SELECT id,story_id,beat_id,field,source_revision_id,status,dedupe_key,created_at,data FROM scene_script_suggestions LIMIT 1",
        )
        .get();
  } finally {
    database?.close();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
function number(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new HttpError(400, `${name} must be a positive number.`);
  return value;
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
async function body(
  request: IncomingMessage,
  maximumBytes = 1024 * 1024,
): Promise<Body> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "Use application/json.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes)
      throw new HttpError(
        413,
        `Request exceeds ${maximumBytes / (1024 * 1024)} MiB.`,
      );
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Body;
  } catch {
    throw new HttpError(400, "Request must contain a JSON object.");
  }
}

async function readBoundedBytes(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<Buffer> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    throw new HttpError(413, "GPX source exceeds the 5 MiB travel-v1 limit.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes)
      throw new HttpError(413, "GPX source exceeds the 5 MiB travel-v1 limit.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

async function streamFileContents(
  request: IncomingMessage,
  response: ServerResponse,
  file: string,
  root: string,
  mime: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const [actualFile, actualRoot] = await Promise.all([
    realpath(file),
    realpath(root),
  ]);
  signal.throwIfAborted();
  const within = relative(actualRoot, actualFile);
  if (within.startsWith("..") || isAbsolute(within))
    throw new HttpError(403, "Media cache path is outside this project.");
  const info = await stat(actualFile);
  signal.throwIfAborted();
  if (!info.isFile()) throw new HttpError(404, "Cached media is unavailable.");
  if (info.size === 0)
    throw new HttpError(
      404,
      "Media file is empty or unavailable. Rebuild its preview or relink the original source.",
    );
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      throw new HttpError(416, "Unsupported byte range.");
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= info.size
    )
      throw new HttpError(416, "Byte range exceeds the file.");
    status = 206;
  }
  response.writeHead(status, {
    "Content-Type": mime,
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ...(status === 206
      ? { "Content-Range": `bytes ${start}-${end}/${info.size}` }
      : {}),
  });
  await pipeline(createReadStream(actualFile, { start, end }), response, {
    signal,
  });
}

export interface ServerOptions {
  port?: number;
  /** Private packaged-shell capability; never accepted from HTTP. */
  nativeSession?: string;
  project?: string;
  projectRoot?: string;
  maxUploadBytes?: number;
  /** Trusted runtime dependency injection; never accepted from HTTP requests. */
  transcriptionProvider?: TranscriptionProvider;
  userDataDirectory?: string;
  languageProvider?: LanguageProvider;
  /** Trusted host registration only; an HTTP request can never install a provider. */
  visionSampleProviders?: VisionSampleProvider[];
  /** Trusted runtime dependency only; never accepted from HTTP or projects. */
  proxyGenerator?: typeof import("@openfilm/media").createProxy;
  /** Bounded lifetime for consented external GraphicScene proposals. */
  graphicSceneAgentProviderTimeoutMs?: number;
}
export async function startServer(options: ServerOptions = {}) {
  if (
    options.nativeSession !== undefined &&
    !/^[a-f0-9]{64}$/u.test(options.nativeSession)
  )
    throw new Error("Invalid native session");
  const graphicSceneAgentProviderTimeoutMs =
    number(
      options.graphicSceneAgentProviderTimeoutMs,
      "graphicSceneAgentProviderTimeoutMs",
    ) ?? DEFAULT_GRAPHIC_SCENE_AGENT_PROVIDER_TIMEOUT_MS;
  const runtimeOptions = {
    userDataDirectory: resolveUserDataDirectory(options.userDataDirectory),
    languageProvider: options.languageProvider,
    visionSampleProviders: options.visionSampleProviders,
    proxyGenerator: options.proxyGenerator,
  };
  const configure = (application: OpenFilmApplication) => {
    if (options.transcriptionProvider)
      application.intelligence.registerTranscriptionProvider(
        options.transcriptionProvider,
      );
    return application;
  };
  const projectRoot = resolve(
    options.projectRoot ??
      process.env.OPENFILM_PROJECTS_DIR ??
      join(homedir(), "Movies", "OpenFilm"),
  );
  const maxUploadBytes = options.maxUploadBytes ?? 8 * 1024 ** 3;
  const uploads = new Map<
    string,
    { project: OpenFilmApplication; path: string; directory: string }
  >();
  let app: OpenFilmApplication | undefined;
  if (options.project)
    app = configure(
      await OpenFilmApplication.open(resolve(options.project), runtimeOptions),
    );
  const active = new Map<string, AbortController>();
  const proxyOperations = new Map<
    string,
    { projectId: string; controller: AbortController }
  >();
  const proxyWorkers = new Map<
    string,
    {
      id: string;
      status: "running" | "completed" | "failed" | "cancelled";
      error?: { code: ApplicationErrorCode };
      result?: { completed: number; failed: number; cancelled: number };
    }
  >();
  const sourceDiscoveryControllers = new Set<AbortController>();
  const browserDiscoveryControllers = new Map<string, AbortController>();
  const browserDiscoveryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  const browserStageControllers = new Set<AbortController>();
  const sourceDiscoveryProgress = new Map<string, SourceDiscoveryProgress>();
  const sourceBatchControllers = new Map<string, AbortController>();
  const sourceAnalysisControllers = new Map<string, AbortController>();
  const sourceAnalysisProgress = new Map<
    string,
    {
      requestId: string;
      projectId: string;
      status: "running" | "completed" | "cancelled" | "failed";
      progress: SourceAnalysisProgress;
      result?: SourceAnalysisRunRecord;
    }
  >();
  const sourceBatchProgress = new Map<
    string,
    {
      requestId: string;
      projectId: string;
      status: "running" | "completed" | "cancelled" | "failed";
      progress: SourceBatchProgress;
      result?: SourceBatchSealResult;
    }
  >();
  const graphicSceneAgentPreviews = new Set<AbortController>();
  const hasActiveProjectWork = () =>
    active.size > 0 ||
    sourceDiscoveryControllers.size > 0 ||
    sourceBatchControllers.size > 0 ||
    sourceAnalysisControllers.size > 0 ||
    browserStageControllers.size > 0;
  const expireBrowserDiscovery = (requestId: string, projectId: string) => {
    const previous = browserDiscoveryTimers.get(requestId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(
      () => {
        const controller = browserDiscoveryControllers.get(requestId);
        if (!controller || app?.project.id !== projectId) return;
        app.sourceDiscovery.cancelBrowserScan({ projectId, requestId });
        sourceDiscoveryProgress.set(requestId, {
          requestId,
          projectId,
          status: "cancelled",
          summary: {
            ...(sourceDiscoveryProgress.get(requestId)?.summary ?? {
              projectId,
              draftRevision: app.sourceDraft.get().revision,
              sourcesRequested: 1,
              sourcesScanned: 0,
              discovered: 0,
              supported: 0,
              possibleDuplicates: 0,
              skipped: 0,
              failed: 0,
              failures: [],
            }),
            cancelled: true,
          },
        });
        browserDiscoveryControllers.delete(requestId);
        sourceDiscoveryControllers.delete(controller);
        browserDiscoveryTimers.delete(requestId);
      },
      10 * 60 * 1000,
    );
    timer.unref?.();
    browserDiscoveryTimers.set(requestId, timer);
  };
  const cancelGraphicSceneAgentPreviews = () => {
    for (const controller of graphicSceneAgentPreviews) controller.abort();
  };
  const tasks = new Set<Promise<unknown>>();
  const requireIdleProject = () => {
    if (hasActiveProjectWork() || proxyOperations.size || app?.hasActiveJobs)
      throw new HttpError(
        409,
        "Wait for running jobs and source scans before switching or closing this project.",
      );
  };
  const editors = new WeakMap<OpenFilmApplication, TimelineEditor>();
  const relinkers = new WeakMap<OpenFilmApplication, MediaRelinker>();
  const relinkerFor = (application: OpenFilmApplication) => {
    let relinker = relinkers.get(application);
    if (!relinker) {
      relinker = new MediaRelinker(application);
      relinkers.set(application, relinker);
    }
    return relinker;
  };
  const editorFor = (application: OpenFilmApplication) => {
    let editor = editors.get(application);
    if (!editor) {
      editor = new TimelineEditor(application);
      editors.set(application, editor);
    }
    return editor;
  };
  let mutationQueue = Promise.resolve();
  let closing = false;
  const mediaStreams = new Map<AbortController, Promise<void>>();
  const trackedMediaRead = (read: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    if (closing) controller.abort();
    const task = Promise.resolve()
      .then(() => read(controller.signal))
      .finally(() => mediaStreams.delete(controller));
    mediaStreams.set(controller, task);
    return task;
  };
  const cancelMediaReads = async () => {
    for (const controller of mediaStreams.keys()) controller.abort();
    await Promise.allSettled(mediaStreams.values());
  };
  const streamFile = (
    request: IncomingMessage,
    response: ServerResponse,
    file: string,
    root: string,
    mime: string,
  ) => {
    const controller = new AbortController();
    const abort = () => {
      response.destroy();
    };
    controller.signal.addEventListener("abort", abort, { once: true });
    if (closing) controller.abort();
    // Register before filesystem awaits. Only read-only file pipelines are
    // aborted; acquired mutation requests retain their graceful lifetime.
    const task = streamFileContents(
      request,
      response,
      file,
      root,
      mime,
      controller.signal,
    ).finally(() => {
      controller.signal.removeEventListener("abort", abort);
      mediaStreams.delete(controller);
    });
    mediaStreams.set(controller, task);
    return task;
  };
  const current = () => {
    if (!app)
      throw new HttpError(
        409,
        "Create or open a project first.",
        "project.required",
      );
    return app;
  };
  const discardUploads = async () => {
    for (const [id, upload] of uploads) {
      await rm(upload.directory, { recursive: true, force: true });
      uploads.delete(id);
    }
  };
  const origins = new Set([
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "http://tauri.localhost",
    "tauri://localhost",
  ]);
  let port = options.port ?? 4310;
  const server = createServer((request, response) => {
    void (async () => {
      let releaseMutation: (() => void) | undefined;
      let errorContext: ApplicationErrorCode = "operation.failed";
      try {
        if (closing) throw new HttpError(503, "The local service is closing.");
        const origin = request.headers.origin;
        const host = request.headers.host;
        if (
          !host ||
          !new Set([`localhost:${port}`, `127.0.0.1:${port}`]).has(host)
        )
          throw new HttpError(403, "Loopback host is required.");
        if (
          (origin && !origins.has(origin)) ||
          (!origin && request.headers["sec-fetch-site"] === "cross-site")
        )
          throw new HttpError(
            403,
            "This origin cannot access your local media.",
          );
        if (origin) {
          response.setHeader("Access-Control-Allow-Origin", origin);
          response.setHeader("Vary", "Origin");
        }
        if (
          options.nativeSession &&
          !(request.url ?? "").startsWith(
            `/native/${options.nativeSession}/api/`,
          )
        )
          throw new HttpError(403, "Native session is required.");
        if (request.method === "OPTIONS") {
          response.writeHead(204, {
            "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          response.end();
          return;
        }
        const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
        let route = url.pathname;
        if (options.nativeSession) {
          const prefix = `/native/${options.nativeSession}`;
          if (!route.startsWith(`${prefix}/api/`))
            throw new HttpError(403, "Native session is required.");
          route = route.slice(prefix.length);
        }
        const method = request.method;
        const cancellation =
          method === "POST" &&
          (/^\/api\/(?:jobs|analysis-runs)\/[^/]+\/cancel$/.test(route) ||
            route === "/api/proxy-cache/cancel");
        const nonMutatingGraphicAgentPreview =
          method === "POST" &&
          /^\/api\/compositions\/[^/]+\/graphic-agent\/preview$/.test(route);
        const nonMutatingExportPreview =
          method === "POST" && route === "/api/export/frame-preview";
        const acquireMutation = async () => {
          const previousMutation = mutationQueue;
          mutationQueue = new Promise<void>((accept) => {
            releaseMutation = accept;
          });
          await previousMutation;
          if (closing)
            throw new HttpError(503, "The local service is closing.");
        };
        // Serialize mutations across body reads and project replacement. Cancellation
        // remains available while a render is awaiting its child process.
        if (
          (method === "POST" || method === "PATCH" || method === "DELETE") &&
          !cancellation &&
          !nonMutatingGraphicAgentPreview &&
          route !== "/api/projects/availability"
        ) {
          if (
            (hasActiveProjectWork() ||
              proxyOperations.size ||
              app?.hasActiveJobs) &&
            [
              "/api/project/create",
              "/api/project/open",
              "/api/project/close",
              "/api/media/relink/plan",
              "/api/media/relink/apply",
            ].includes(route)
          )
            throw new HttpError(
              409,
              "Wait for running jobs before switching projects or relinking media.",
            );
          await acquireMutation();
        }
        const runProfileExport = async <T>(
          application: OpenFilmApplication,
          operation: (signal: AbortSignal) => Promise<T>,
        ): Promise<T> => {
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for the active project job before exporting.",
            );
          const controller = new AbortController();
          const jobId = randomUUID();
          const disconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once("close", disconnected);
          const job: Job = {
            id: jobId,
            type: "render",
            status: "queued",
            progress: 0,
            createdAt: new Date().toISOString(),
          };
          application.catalog.saveJob(job);
          active.set(jobId, controller);
          // A preview reserves project ownership through its body read and job
          // registration. Deliveries keep edits queued through publication.
          if (nonMutatingExportPreview) {
            releaseMutation?.();
            releaseMutation = undefined;
          }
          const running: Job = {
            ...job,
            status: "running",
            updatedAt: new Date().toISOString(),
          };
          application.catalog.saveJob(running);
          const operationPromise = Promise.resolve().then(() =>
            operation(controller.signal),
          );
          const handled = operationPromise
            .then((result) => {
              application.catalog.saveJob({
                ...running,
                status: "completed",
                progress: 1,
                updatedAt: new Date().toISOString(),
              });
              return result;
            })
            .catch((error: unknown) => {
              application.catalog.saveJob({
                ...running,
                status: controller.signal.aborted ? "cancelled" : "failed",
                updatedAt: new Date().toISOString(),
                errors: [
                  {
                    uri: "",
                    stage: "profile-export",
                    message:
                      error instanceof Error ? error.message : String(error),
                    ...errorInfo(error, "export.failed"),
                  },
                ],
              });
              throw error;
            })
            .finally(() => tasks.delete(handled));
          tasks.add(handled);
          try {
            return await handled;
          } finally {
            active.delete(jobId);
            response.off("close", disconnected);
          }
        };
        if (method === "GET" && route === "/api/health") {
          json(response, 200, { ok: true });
          return;
        }
        if (method === "GET" && route === "/api/workspace") {
          const defaults = resolveFilmSettings(
            { templateId: "proposal-film" },
            [proposalTemplate],
          );
          json(response, 200, {
            systemLocale: systemLocale(),
            defaultProjectRoot: projectRoot,
            defaults: { ...defaults, projectContentLocale: "en-US" },
            templates: [
              resolveFilmSettings({ templateId: "blank" }, [proposalTemplate]),
              defaults,
            ].map(({ templateId, ...settings }) => ({
              id: templateId,
              ...settings,
            })),
            maxUploadBytes,
          });
          return;
        }
        if (method === "POST" && route === "/api/projects/availability") {
          const data = await body(request);
          const requested =
            data.paths === undefined ||
            (Array.isArray(data.paths) && !data.paths.length)
              ? []
              : paths(data, "paths", 50);
          const projects = [];
          for (const path of requested) {
            let status = "available";
            try {
              const directory = await lstat(path);
              if (!directory.isDirectory() || directory.isSymbolicLink())
                status = "invalid";
              else {
                for (const name of ["project.json", "database.sqlite"]) {
                  const info = await lstat(join(path, name));
                  if (!info.isFile() || info.isSymbolicLink())
                    status = "invalid";
                }
                if (status === "available") {
                  const info = await stat(join(path, "project.json"));
                  if (info.size > 16 * 1024 * 1024) status = "invalid";
                  else {
                    migrateProject(
                      JSON.parse(
                        await readFile(join(path, "project.json"), "utf8"),
                      ),
                    );
                    await inspectCatalog(join(path, "database.sqlite"));
                  }
                }
              }
            } catch (error) {
              status =
                (error as NodeJS.ErrnoException).code === "ENOENT"
                  ? "missing"
                  : ["EACCES", "EPERM"].includes(
                        (error as NodeJS.ErrnoException).code ?? "",
                      )
                    ? "inaccessible"
                    : "invalid";
            }
            projects.push({ path, status });
          }
          json(response, 200, { projects });
          return;
        }
        if (method === "GET" && route === "/api/project") {
          json(response, 200, {
            project: app?.project ?? null,
            path: app?.directory ?? null,
          });
          return;
        }
        if (method === "POST" && route === "/api/project/close") {
          requireIdleProject();
          await discardUploads();
          await cancelMediaReads();
          // A caption GET can capture this project during upload cleanup.
          // Recheck immediately before close; do not await after this guard.
          requireIdleProject();
          cancelGraphicSceneAgentPreviews();
          app?.close();
          app = undefined;
          json(response, 200, { ok: true });
          return;
        }
        if (
          method === "POST" &&
          (route === "/api/project/create" || route === "/api/project/open")
        ) {
          requireIdleProject();
          const data = await body(request);
          requireIdleProject();
          const creating = route.endsWith("/create");
          errorContext = creating
            ? "project.destinationInvalid"
            : "project.unavailable";
          const title = creating ? text(data, "title") : undefined;
          const settings = creating ? filmOptions(data) : undefined;
          if (creating)
            settings!.filmSettings = resolveFilmSettings(
              settings!.filmSettings ?? { templateId: "proposal-film" },
              [proposalTemplate],
            );
          if (creating && settings!.projectContentLocale === undefined)
            settings!.projectContentLocale = "en-US";
          const root =
            data.root === undefined
              ? projectRoot
              : resolve(filePath(data, "root"));
          const folderName = title && projectFolderTitle(title);
          const directory =
            creating && data.path === undefined
              ? join(
                  root,
                  `${folderName || "Film"}-${randomUUID().slice(0, 8)}.openfilm`,
                )
              : resolve(filePath(data, "path"));
          const previousPath = app?.directory;
          await discardUploads();
          await cancelMediaReads();
          requireIdleProject();
          cancelGraphicSceneAgentPreviews();
          app?.close();
          app = undefined;
          let next: OpenFilmApplication;
          try {
            next = creating
              ? await OpenFilmApplication.create(
                  directory,
                  title!,
                  settings,
                  runtimeOptions,
                )
              : await OpenFilmApplication.open(directory, runtimeOptions);
          } catch (error) {
            if (previousPath)
              app = configure(
                await OpenFilmApplication.open(previousPath, runtimeOptions),
              );
            throw error;
          }
          app = configure(next);
          json(response, 200, { project: next.project, path: next.directory });
          return;
        }
        const application = current();
        if (route === "/api/proxy-cache" && method === "GET") {
          const health = await application.proxyCache.health({
            projectId: url.searchParams.get("projectId") ?? "",
            offset: url.searchParams.has("offset")
              ? Number(url.searchParams.get("offset"))
              : undefined,
            limit: url.searchParams.has("limit")
              ? Number(url.searchParams.get("limit"))
              : undefined,
          });
          json(response, 200, {
            health,
            worker: proxyWorkers.get(application.project.id),
          });
          return;
        }
        if (
          route.startsWith("/api/proxy-cache/") &&
          (method === "POST" || method === "PATCH")
        ) {
          const data = await body(request);
          const projectId = text(data, "projectId");
          if (projectId !== application.project.id || app !== application)
            throw new HttpError(
              409,
              "The preview request belongs to another project.",
              "proxy.stale",
            );
          type Cache = typeof application.proxyCache;
          if (method === "POST" && route === "/api/proxy-cache/cancel") {
            keys(data, ["projectId", "jobIds"]);
            const jobs = application.proxyCache.cancel({
              ...data,
              projectId,
              jobIds:
                data.jobIds === undefined ? undefined : paths(data, "jobIds"),
            });
            if (data.jobIds === undefined)
              for (const operation of proxyOperations.values())
                if (operation.projectId === projectId)
                  operation.controller.abort();
            json(response, 200, { jobs });
            return;
          }
          if (method === "POST" && route === "/api/proxy-cache/queue") {
            json(response, 202, {
              jobs: application.proxyCache.enqueue({
                ...data,
                projectId,
                requestId: text(data, "requestId"),
                assetIds: paths(data, "assetIds"),
              }),
            });
            return;
          }
          if (method === "POST" && route === "/api/proxy-cache/resume") {
            json(response, 202, {
              jobs: application.proxyCache.resume({
                ...data,
                projectId,
                requestId: text(data, "requestId"),
                jobIds: paths(data, "jobIds"),
              }),
            });
            return;
          }
          if (method === "POST" && route === "/api/proxy-cache/run") {
            keys(data, ["projectId"]);
            const previous = proxyWorkers.get(projectId);
            if (previous?.status === "running") {
              json(response, 202, { worker: previous, started: false });
              return;
            }
            if (
              hasActiveProjectWork() ||
              application.proxyCache.isRunning ||
              proxyOperations.size
            )
              throw new HttpError(
                409,
                "Wait for the current preview or import operation.",
              );
            const id = randomUUID();
            const controller = new AbortController();
            const worker: {
              id: string;
              status: "running" | "completed" | "failed" | "cancelled";
              error?: { code: ApplicationErrorCode };
              result?: { completed: number; failed: number; cancelled: number };
            } = { id, status: "running" };
            while (proxyWorkers.size >= 32)
              proxyWorkers.delete(proxyWorkers.keys().next().value!);
            proxyWorkers.set(projectId, worker);
            proxyOperations.set(id, { projectId, controller });
            const task = Promise.resolve()
              .then(() =>
                application.proxyCache.runPending({
                  projectId,
                  signal: controller.signal,
                }),
              )
              .then(
                (result) => {
                  worker.result = result;
                  worker.status = result.failed
                    ? "failed"
                    : result.cancelled || controller.signal.aborted
                      ? "cancelled"
                      : "completed";
                  if (result.failed)
                    worker.error = { code: "media.previewUnavailable" };
                },
                (error: unknown) => {
                  worker.status = controller.signal.aborted
                    ? "cancelled"
                    : "failed";
                  worker.error = {
                    code: errorInfo(error, "media.previewUnavailable").code,
                  };
                },
              )
              .finally(() => {
                proxyOperations.delete(id);
                tasks.delete(task);
              });
            tasks.add(task);
            json(response, 202, { worker, started: true });
            return;
          }
          if (
            hasActiveProjectWork() ||
            application.proxyCache.isRunning ||
            proxyOperations.size
          )
            throw new HttpError(
              409,
              "Wait for the current preview operation before maintaining its cache.",
            );
          if (method === "PATCH" && route === "/api/proxy-cache/policy") {
            json(response, 200, {
              policy: await application.proxyCache.setPolicy(
                data as Parameters<Cache["setPolicy"]>[0],
              ),
            });
            return;
          }
          if (method === "POST" && route === "/api/proxy-cache/recover") {
            json(response, 200, {
              recovered: application.proxyCache.recover(
                data as Parameters<Cache["recover"]>[0],
              ),
            });
            return;
          }
          const maintenance = new Map<string, () => Promise<unknown>>([
            [
              "/api/proxy-cache/verify",
              () =>
                application.proxyCache.verify({
                  ...data,
                  signal: controller.signal,
                } as Parameters<Cache["verify"]>[0]),
            ],
            [
              "/api/proxy-cache/cleanup/preview",
              () =>
                application.proxyCache.previewCleanup({
                  ...data,
                  signal: controller.signal,
                } as Parameters<Cache["previewCleanup"]>[0]),
            ],
            [
              "/api/proxy-cache/cleanup/accept",
              () =>
                application.proxyCache.acceptCleanup({
                  ...data,
                  signal: controller.signal,
                } as Parameters<Cache["acceptCleanup"]>[0]),
            ],
          ]);
          const operation =
            method === "POST" ? maintenance.get(route) : undefined;
          if (!operation)
            throw new HttpError(404, "Preview operation was not found.");
          if (Object.hasOwn(data, "signal"))
            throw new HttpError(
              400,
              "Request cancellation must use the cancel action.",
            );
          const id = randomUUID();
          const controller = new AbortController();
          const disconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once("close", disconnected);
          proxyOperations.set(id, { projectId, controller });
          releaseMutation?.();
          releaseMutation = undefined;
          const task = Promise.resolve().then(operation);
          tasks.add(task);
          try {
            json(response, 200, { result: await task });
          } finally {
            proxyOperations.delete(id);
            tasks.delete(task);
            response.off("close", disconnected);
          }
          return;
        }
        if (route === "/api/import-batches/progress" && method === "GET") {
          const requestId = url.searchParams.get("requestId") ?? "";
          const state = sourceBatchProgress.get(requestId);
          if (!state || state.projectId !== application.project.id)
            throw new HttpError(404, "Import batch progress was not found.");
          json(response, 200, { state });
          return;
        }
        if (route === "/api/import-batches" && method === "POST") {
          const data = await body(request);
          keys(data, [
            "projectId",
            "baseRevision",
            "requestId",
            "selectionIds",
            "partialPolicy",
          ]);
          if (
            typeof data.projectId !== "string" ||
            typeof data.baseRevision !== "number" ||
            typeof data.requestId !== "string" ||
            (data.selectionIds !== undefined &&
              (!Array.isArray(data.selectionIds) ||
                data.selectionIds.some((id) => typeof id !== "string"))) ||
            (data.partialPolicy !== undefined &&
              data.partialPolicy !== "require-all" &&
              data.partialPolicy !== "allow-readable")
          )
            throw new HttpError(
              400,
              "Project, revision, request ID, selections and partial policy are invalid.",
            );
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for other project jobs before sealing selected sources.",
            );
          const requestId = data.requestId;
          const controller = new AbortController();
          const abort = () => controller.abort();
          const abortDisconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          request.once("aborted", abort);
          response.once("close", abortDisconnected);
          sourceBatchControllers.set(requestId, controller);
          while (sourceBatchProgress.size >= 64)
            sourceBatchProgress.delete(
              sourceBatchProgress.keys().next().value!,
            );
          sourceBatchProgress.set(requestId, {
            requestId,
            projectId: data.projectId,
            status: "running",
            progress: {
              batchId: "",
              stage: "preparing",
              completed: 0,
              total: 0,
              failed: 0,
              cancelled: false,
            },
          });
          try {
            const result = await application.sourceBatches.createAndSeal({
              projectId: data.projectId,
              baseRevision: data.baseRevision,
              requestId,
              ...(Array.isArray(data.selectionIds)
                ? { selectionIds: data.selectionIds as string[] }
                : {}),
              ...(data.partialPolicy === "allow-readable" ||
              data.partialPolicy === "require-all"
                ? { partialPolicy: data.partialPolicy }
                : {}),
              signal: controller.signal,
              onProgress: (progress) => {
                sourceBatchProgress.set(requestId, {
                  requestId,
                  projectId: data.projectId as string,
                  status: "running",
                  progress,
                });
              },
            });
            sourceBatchProgress.set(requestId, {
              requestId,
              projectId: data.projectId,
              status: result.status === "cancelled" ? "cancelled" : "completed",
              progress: {
                batchId: result.batch.id,
                stage: "completed",
                completed: result.expected,
                total: result.expected,
                failed: result.failed,
                cancelled: result.status === "cancelled",
              },
              result,
            });
            json(response, 200, { result });
          } catch (error) {
            const currentProgress = sourceBatchProgress.get(requestId);
            if (currentProgress)
              sourceBatchProgress.set(requestId, {
                ...currentProgress,
                status: controller.signal.aborted ? "cancelled" : "failed",
                progress: {
                  ...currentProgress.progress,
                  cancelled: controller.signal.aborted,
                },
              });
            throw error;
          } finally {
            request.off("aborted", abort);
            response.off("close", abortDisconnected);
            sourceBatchControllers.delete(requestId);
          }
          return;
        }
        if (route === "/api/travel-gpx/parse" && method === "POST") {
          const trackId = url.searchParams.get("trackId") ?? "";
          if (!trackId || trackId.length > 256)
            throw new HttpError(400, "A bounded GPX track ID is required.");
          if (
            !["application/gpx+xml", "application/octet-stream"].includes(
              request.headers["content-type"]?.split(";")[0]?.toLowerCase() ??
                "",
            )
          )
            throw new HttpError(
              415,
              "Send an explicitly selected GPX source as application/gpx+xml.",
            );
          const bytes = await readBoundedBytes(request, 5 * 1024 * 1024);
          try {
            const track = parseGpxTrack(trackId, bytes);
            json(response, 200, { track });
          } catch {
            throw new HttpError(
              400,
              "The selected GPX track is invalid or exceeds travel-v1 bounds.",
            );
          }
          return;
        }
        if (
          route === "/api/analysis/vision-sample-providers" &&
          method === "GET"
        ) {
          json(response, 200, {
            providers: application.sourceAnalysis.listVisionSampleProviders(),
          });
          return;
        }
        const sampleProviderConsent =
          /^\/api\/analysis\/vision-sample-providers\/([^/]+)\/consent$/u.exec(
            route,
          );
        if (sampleProviderConsent && method === "POST") {
          const providerId = decodeURIComponent(sampleProviderConsent[1]!);
          const data = await body(request);
          keys(data, ["acknowledged"]);
          if (data.acknowledged !== true)
            throw new HttpError(
              400,
              "Explicit acknowledgment of bounded image and metadata disclosure is required.",
            );
          const consent: RemoteProviderConsent = {
            providerId,
            dataKinds: ["images", "metadata"],
            grantedAt: new Date().toISOString(),
          };
          application.sourceAnalysis.grantVisionSampleConsent(consent);
          json(response, 200, {
            providers: application.sourceAnalysis.listVisionSampleProviders(),
          });
          return;
        }
        if (sampleProviderConsent && method === "DELETE") {
          application.sourceAnalysis.revokeVisionSampleConsent(
            decodeURIComponent(sampleProviderConsent[1]!),
          );
          json(response, 200, {
            providers: application.sourceAnalysis.listVisionSampleProviders(),
          });
          return;
        }
        if (route === "/api/analysis-runs/progress" && method === "GET") {
          const requestId = url.searchParams.get("requestId") ?? "";
          const state = sourceAnalysisProgress.get(requestId);
          if (!state || state.projectId !== application.project.id)
            throw new HttpError(404, "Analysis progress was not found.");
          json(response, 200, { state });
          return;
        }
        const analysisReviewRoute =
          /^\/api\/analysis-runs\/([^/]+)\/review(?:\/(preview|accept))?$/u.exec(
            route,
          );
        if (
          analysisReviewRoute &&
          method === "GET" &&
          !analysisReviewRoute[2]
        ) {
          const runId = decodeURIComponent(analysisReviewRoute[1]!);
          const query = url.searchParams.get("query") ?? "";
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = Number(url.searchParams.get("limit") ?? 50);
          const result = application.sourceAnalysisReview.search({
            runId,
            query,
            offset,
            limit,
          });
          json(response, 200, {
            result,
            decisions: application.sourceAnalysisReview.decisions(runId),
          });
          return;
        }
        if (
          analysisReviewRoute &&
          method === "POST" &&
          analysisReviewRoute[2] === "preview"
        ) {
          const data = await body(request);
          keys(data, ["operation"]);
          if (
            !data.operation ||
            typeof data.operation !== "object" ||
            Array.isArray(data.operation)
          )
            throw new HttpError(
              400,
              "A typed source-analysis review operation is required.",
            );
          json(response, 200, {
            preview: application.sourceAnalysisReview.preview({
              runId: decodeURIComponent(analysisReviewRoute[1]!),
              operation: data.operation as ReviewDecisionOperation,
            }),
          });
          return;
        }
        if (
          analysisReviewRoute &&
          method === "POST" &&
          analysisReviewRoute[2] === "accept"
        ) {
          const data = await body(request);
          keys(data, [
            "projectId",
            "operation",
            "expectedManifestId",
            "expectedBeforeFingerprint",
            "expectedOperationFingerprint",
            "expectedStoryRevision",
            "requestId",
            "supersedesDecisionId",
          ]);
          if (
            typeof data.projectId !== "string" ||
            !data.operation ||
            typeof data.operation !== "object" ||
            Array.isArray(data.operation) ||
            typeof data.expectedManifestId !== "string" ||
            typeof data.expectedBeforeFingerprint !== "string" ||
            typeof data.expectedOperationFingerprint !== "string" ||
            typeof data.requestId !== "string"
          )
            throw new HttpError(
              400,
              "Review project, operation, preview fingerprints, manifest and request ID are required.",
            );
          const decision = await application.sourceAnalysisReview.accept({
            projectId: data.projectId,
            runId: decodeURIComponent(analysisReviewRoute[1]!),
            operation: data.operation as ReviewDecisionOperation,
            expectedManifestId: data.expectedManifestId,
            expectedBeforeFingerprint: data.expectedBeforeFingerprint,
            expectedOperationFingerprint: data.expectedOperationFingerprint,
            ...(typeof data.expectedStoryRevision === "string"
              ? { expectedStoryRevision: data.expectedStoryRevision }
              : {}),
            requestId: data.requestId,
            ...(typeof data.supersedesDecisionId === "string"
              ? { supersedesDecisionId: data.supersedesDecisionId }
              : {}),
          });
          json(response, 200, { decision });
          return;
        }
        if (route === "/api/analysis-runs" && method === "POST") {
          const data = await body(request, 12 * 1024 * 1024);
          keys(data, [
            "projectId",
            "verifiedManifestId",
            "scopeMode",
            "confirmProjectCatalog",
            "requestId",
            "travelContext",
            "visualSampling",
          ]);
          if (
            typeof data.projectId !== "string" ||
            typeof data.verifiedManifestId !== "string" ||
            (data.scopeMode !== "selected-sources" &&
              data.scopeMode !== "project-catalog") ||
            (data.confirmProjectCatalog !== undefined &&
              typeof data.confirmProjectCatalog !== "boolean") ||
            typeof data.requestId !== "string"
          )
            throw new HttpError(
              400,
              "Analysis project, verified manifest, scope and request ID are required.",
            );
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for other project operations before starting common analysis.",
            );
          const controller = new AbortController();
          const abort = () => controller.abort();
          const abortDisconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          const requestId = data.requestId;
          request.once("aborted", abort);
          response.once("close", abortDisconnected);
          sourceAnalysisControllers.set(requestId, controller);
          while (sourceAnalysisProgress.size >= 64)
            sourceAnalysisProgress.delete(
              sourceAnalysisProgress.keys().next().value!,
            );
          sourceAnalysisProgress.set(requestId, {
            requestId,
            projectId: data.projectId,
            status: "running",
            progress: { runId: "", stage: "queued", completed: 0, total: 0 },
          });
          try {
            const result = await application.sourceAnalysis.createRun({
              projectId: data.projectId,
              verifiedManifestId: data.verifiedManifestId,
              scopeMode: data.scopeMode,
              ...(data.confirmProjectCatalog === true
                ? { confirmProjectCatalog: true }
                : {}),
              ...(data.travelContext === undefined
                ? {}
                : { travelContext: data.travelContext as TravelContextV1 }),
              ...(data.visualSampling === undefined
                ? {}
                : { visualSampling: data.visualSampling as VisualSamplingV1 }),
              requestId,
              signal: controller.signal,
              onProgress: (progress) =>
                sourceAnalysisProgress.set(requestId, {
                  requestId,
                  projectId: data.projectId as string,
                  status:
                    progress.stage === "completed"
                      ? "completed"
                      : progress.stage === "cancelled"
                        ? "cancelled"
                        : progress.stage === "failed"
                          ? "failed"
                          : "running",
                  progress,
                }),
            });
            sourceAnalysisProgress.set(requestId, {
              requestId,
              projectId: data.projectId,
              status:
                result.run.status === "cancelled"
                  ? "cancelled"
                  : result.run.status === "failed"
                    ? "failed"
                    : "completed",
              progress: {
                runId: result.run.id,
                stage:
                  result.run.status === "completed"
                    ? "completed"
                    : result.run.status === "cancelled"
                      ? "cancelled"
                      : "failed",
                completed:
                  result.run.status === "completed" ? result.results.length : 0,
                total: result.results.length,
              },
              result,
            });
            json(response, 200, { result });
          } catch (error) {
            const currentProgress = sourceAnalysisProgress.get(requestId);
            if (currentProgress)
              sourceAnalysisProgress.set(requestId, {
                ...currentProgress,
                status: controller.signal.aborted ? "cancelled" : "failed",
              });
            throw error;
          } finally {
            request.off("aborted", abort);
            response.off("close", abortDisconnected);
            sourceAnalysisControllers.delete(requestId);
          }
          return;
        }
        const analysisRunAction =
          /^\/api\/analysis-runs\/([^/]+)(?:\/(cancel|retry))?$/u.exec(route);
        if (analysisRunAction && method === "GET" && !analysisRunAction[2]) {
          const result = application.sourceAnalysis.getRun(
            decodeURIComponent(analysisRunAction[1]!),
          );
          json(response, 200, { result });
          return;
        }
        if (
          analysisRunAction &&
          method === "POST" &&
          analysisRunAction[2] === "cancel"
        ) {
          const data = await body(request);
          keys(data, ["projectId"]);
          if (typeof data.projectId !== "string")
            throw new HttpError(400, "Project ID is required.");
          application.sourceAnalysis.cancelRun({
            projectId: data.projectId,
            runId: decodeURIComponent(analysisRunAction[1]!),
          });
          json(response, 200, { ok: true });
          return;
        }
        if (
          analysisRunAction &&
          method === "POST" &&
          analysisRunAction[2] === "retry"
        ) {
          const data = await body(request);
          keys(data, ["projectId", "requestId"]);
          if (
            typeof data.projectId !== "string" ||
            typeof data.requestId !== "string"
          )
            throw new HttpError(400, "Project ID and request ID are required.");
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for other project operations before retrying common analysis.",
            );
          const controller = new AbortController();
          const abort = () => controller.abort();
          const abortDisconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          const requestId = data.requestId;
          request.once("aborted", abort);
          response.once("close", abortDisconnected);
          sourceAnalysisControllers.set(requestId, controller);
          sourceAnalysisProgress.set(requestId, {
            requestId,
            projectId: data.projectId,
            status: "running",
            progress: {
              runId: decodeURIComponent(analysisRunAction[1]!),
              stage: "queued",
              completed: 0,
              total: 0,
            },
          });
          try {
            const result = await application.sourceAnalysis.retryRun({
              projectId: data.projectId,
              runId: decodeURIComponent(analysisRunAction[1]!),
              requestId,
              signal: controller.signal,
              onProgress: (progress) =>
                sourceAnalysisProgress.set(requestId, {
                  requestId,
                  projectId: data.projectId as string,
                  status:
                    progress.stage === "completed"
                      ? "completed"
                      : progress.stage === "cancelled"
                        ? "cancelled"
                        : progress.stage === "failed"
                          ? "failed"
                          : "running",
                  progress,
                }),
            });
            sourceAnalysisProgress.set(requestId, {
              requestId,
              projectId: data.projectId,
              status:
                result.run.status === "cancelled"
                  ? "cancelled"
                  : result.run.status === "failed"
                    ? "failed"
                    : "completed",
              progress: {
                runId: result.run.id,
                stage:
                  result.run.status === "completed"
                    ? "completed"
                    : result.run.status === "cancelled"
                      ? "cancelled"
                      : "failed",
                completed: result.results.length,
                total: result.results.length,
              },
              result,
            });
            json(response, 200, { result });
          } catch (error) {
            const currentProgress = sourceAnalysisProgress.get(requestId);
            if (currentProgress)
              sourceAnalysisProgress.set(requestId, {
                ...currentProgress,
                status: controller.signal.aborted ? "cancelled" : "failed",
              });
            throw error;
          } finally {
            request.off("aborted", abort);
            response.off("close", abortDisconnected);
            sourceAnalysisControllers.delete(requestId);
          }
          return;
        }
        const batchRoute = /^\/api\/import-batches\/([^/]+)$/u.exec(route);
        if (batchRoute && method === "GET") {
          const batch = application.catalog.multiSource.getImportBatch(
            decodeURIComponent(batchRoute[1]!),
          );
          if (!batch || batch.projectId !== application.project.id)
            throw new HttpError(404, "Import batch was not found.");
          const expectedManifest =
            application.catalog.multiSource.getExpectedManifest(
              batch.expectedManifestId,
            );
          const verifiedManifest =
            application.catalog.multiSource.getVerifiedManifestByExpectedId(
              batch.expectedManifestId,
            );
          json(response, 200, { batch, expectedManifest, verifiedManifest });
          return;
        }
        if (route === "/api/import-draft/scan-progress" && method === "GET") {
          const requestId = url.searchParams.get("requestId") ?? "";
          const progress = sourceDiscoveryProgress.get(requestId);
          if (!progress || progress.projectId !== application.project.id)
            throw new HttpError(404, "Source scan progress was not found.");
          json(response, 200, { progress });
          return;
        }
        if (route === "/api/import-draft/scan-readiness" && method === "GET") {
          json(response, 200, {
            summary: await application.sourceDiscovery.getReadiness(),
          });
          return;
        }
        if (
          route === "/api/import-draft/staged-occurrences" &&
          method === "GET"
        ) {
          const selectionId = url.searchParams.get("selectionId") ?? "";
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = Number(url.searchParams.get("limit") ?? 500);
          if (
            !selectionId ||
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > 500
          )
            throw new HttpError(
              400,
              "Choose a selection and a page limit between 1 and 500.",
            );
          const page =
            await application.sourceBatches.listBrowserStagedOccurrences(
              selectionId,
              offset,
              limit,
            );
          json(response, 200, { page });
          return;
        }
        if (route === "/api/import-draft/browser-scan" && method === "POST") {
          const data = await body(request, 1024 * 1024);
          keys(data, [
            "projectId",
            "baseRevision",
            "requestId",
            "selectionId",
            "phase",
            "scanRevision",
            "candidates",
          ]);
          if (
            typeof data.projectId !== "string" ||
            typeof data.baseRevision !== "number" ||
            typeof data.requestId !== "string" ||
            typeof data.selectionId !== "string" ||
            !["begin", "page", "finish", "cancel"].includes(String(data.phase))
          )
            throw new HttpError(
              400,
              "Project, revision, selection, request ID and browser scan phase are required.",
            );
          const phase = data.phase as "begin" | "page" | "finish" | "cancel";
          const requestId = data.requestId;
          const selectionId = data.selectionId;
          if (phase === "begin") {
            while (sourceDiscoveryProgress.size >= 64)
              sourceDiscoveryProgress.delete(
                sourceDiscoveryProgress.keys().next().value!,
              );
            const controller = new AbortController();
            try {
              const started =
                await application.sourceDiscovery.beginBrowserScan({
                  projectId: data.projectId,
                  baseRevision: data.baseRevision,
                  requestId,
                  selectionId,
                });
              sourceDiscoveryControllers.add(controller);
              browserDiscoveryControllers.set(requestId, controller);
              sourceDiscoveryProgress.set(requestId, {
                requestId,
                projectId: data.projectId,
                status: "running",
                summary: started.summary,
              });
              expireBrowserDiscovery(requestId, data.projectId);
              json(response, 200, started);
            } catch (error) {
              application.sourceDiscovery.cancelBrowserScan({
                projectId: data.projectId,
                requestId,
              });
              throw error;
            }
            return;
          }
          const controller = browserDiscoveryControllers.get(requestId);
          const progress = sourceDiscoveryProgress.get(requestId);
          if (!controller || !progress || progress.projectId !== data.projectId)
            throw new HttpError(
              409,
              "The browser source scan is no longer active.",
              "import.draftStale",
            );
          if (phase === "cancel") {
            application.sourceDiscovery.cancelBrowserScan({
              projectId: data.projectId,
              requestId,
            });
            sourceDiscoveryProgress.set(requestId, {
              ...progress,
              status: "cancelled",
              summary: { ...progress.summary, cancelled: true },
            });
            const timer = browserDiscoveryTimers.get(requestId);
            if (timer) clearTimeout(timer);
            browserDiscoveryTimers.delete(requestId);
            browserDiscoveryControllers.delete(requestId);
            sourceDiscoveryControllers.delete(controller);
            json(response, 200, {
              summary: { ...progress.summary, cancelled: true },
            });
            return;
          }
          try {
            if (phase === "page") {
              if (
                !Number.isSafeInteger(data.scanRevision) ||
                !Array.isArray(data.candidates)
              )
                throw new HttpError(
                  400,
                  "A browser scan page needs a scan revision and candidates.",
                );
              for (const candidate of data.candidates) {
                if (
                  !candidate ||
                  typeof candidate !== "object" ||
                  Array.isArray(candidate)
                )
                  throw new HttpError(
                    400,
                    "Browser scan candidates must be objects.",
                  );
                keys(candidate as Body, [
                  "relativePath",
                  "name",
                  "size",
                  "modifiedAt",
                ]);
                if (
                  typeof (candidate as Body).relativePath !== "string" ||
                  typeof (candidate as Body).name !== "string" ||
                  typeof (candidate as Body).size !== "number" ||
                  ((candidate as Body).modifiedAt !== undefined &&
                    typeof (candidate as Body).modifiedAt !== "string")
                )
                  throw new HttpError(
                    400,
                    "Browser scan candidate fields are invalid.",
                  );
              }
              const summary =
                await application.sourceDiscovery.appendBrowserScanPage({
                  projectId: data.projectId,
                  baseRevision: data.baseRevision,
                  requestId,
                  selectionId,
                  scanRevision: data.scanRevision as number,
                  candidates: data.candidates as Array<{
                    relativePath: string;
                    name: string;
                    size: number;
                    modifiedAt?: string;
                  }>,
                });
              sourceDiscoveryProgress.set(requestId, { ...progress, summary });
              expireBrowserDiscovery(requestId, data.projectId);
              json(response, 200, { summary });
            } else {
              const summary =
                await application.sourceDiscovery.finishBrowserScan({
                  projectId: data.projectId,
                  baseRevision: data.baseRevision,
                  requestId,
                  selectionId,
                  ...(Number.isSafeInteger(data.scanRevision)
                    ? { scanRevision: data.scanRevision as number }
                    : {}),
                });
              sourceDiscoveryProgress.set(requestId, {
                ...progress,
                status: "completed",
                summary,
              });
              const timer = browserDiscoveryTimers.get(requestId);
              if (timer) clearTimeout(timer);
              browserDiscoveryTimers.delete(requestId);
              browserDiscoveryControllers.delete(requestId);
              sourceDiscoveryControllers.delete(controller);
              json(response, 200, { summary });
            }
          } catch (error) {
            sourceDiscoveryProgress.set(requestId, {
              ...progress,
              status: "failed",
            });
            const timer = browserDiscoveryTimers.get(requestId);
            if (timer) clearTimeout(timer);
            browserDiscoveryTimers.delete(requestId);
            browserDiscoveryControllers.delete(requestId);
            sourceDiscoveryControllers.delete(controller);
            application.sourceDiscovery.cancelBrowserScan({
              projectId: data.projectId,
              requestId,
            });
            throw error;
          }
          return;
        }
        if (route === "/api/import-draft/scan" && method === "POST") {
          const data = await body(request);
          keys(data, [
            "projectId",
            "baseRevision",
            "requestId",
            "selectionIds",
          ]);
          if (
            data.selectionIds !== undefined &&
            (!Array.isArray(data.selectionIds) ||
              data.selectionIds.some((id) => typeof id !== "string"))
          )
            throw new HttpError(400, "selectionIds must be a list of IDs.");
          if (
            typeof data.projectId !== "string" ||
            typeof data.baseRevision !== "number" ||
            typeof data.requestId !== "string"
          )
            throw new HttpError(
              400,
              "Project, revision and request ID are required.",
            );
          const controller = new AbortController();
          const abort = () => controller.abort();
          const abortDisconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          request.once("aborted", abort);
          response.once("close", abortDisconnected);
          sourceDiscoveryControllers.add(controller);
          while (sourceDiscoveryProgress.size >= 64)
            sourceDiscoveryProgress.delete(
              sourceDiscoveryProgress.keys().next().value!,
            );
          const initialProgress: SourceDiscoverySummary = {
            projectId: data.projectId,
            draftRevision: data.baseRevision,
            sourcesRequested: Array.isArray(data.selectionIds)
              ? data.selectionIds.length
              : application.sourceDraft.get().selections.length,
            sourcesScanned: 0,
            discovered: 0,
            supported: 0,
            possibleDuplicates: 0,
            skipped: 0,
            failed: 0,
            cancelled: false,
            failures: [],
          };
          sourceDiscoveryProgress.set(data.requestId, {
            requestId: data.requestId,
            projectId: data.projectId,
            status: "running",
            summary: initialProgress,
          });
          try {
            const summary = await application.sourceDiscovery.scan({
              projectId: data.projectId,
              baseRevision: data.baseRevision,
              requestId: String(data.requestId ?? ""),
              ...(Array.isArray(data.selectionIds)
                ? { selectionIds: data.selectionIds as string[] }
                : {}),
              signal: controller.signal,
              onProgress: (latest) => {
                sourceDiscoveryProgress.set(data.requestId as string, {
                  requestId: data.requestId as string,
                  projectId: data.projectId as string,
                  status: latest.cancelled ? "cancelled" : "running",
                  summary: latest,
                });
              },
            });
            sourceDiscoveryProgress.set(data.requestId, {
              requestId: data.requestId,
              projectId: data.projectId,
              status: summary.cancelled ? "cancelled" : "completed",
              summary,
            });
            json(response, 200, { summary });
          } catch (error) {
            const currentProgress = sourceDiscoveryProgress.get(data.requestId);
            if (currentProgress)
              sourceDiscoveryProgress.set(data.requestId, {
                ...currentProgress,
                status: "failed",
              });
            throw error;
          } finally {
            request.off("aborted", abort);
            response.off("close", abortDisconnected);
            sourceDiscoveryControllers.delete(controller);
          }
          return;
        }
        const browserOccurrenceStageRoute =
          /^\/api\/import-draft\/occurrences\/([^/]+)\/stage$/u.exec(route);
        if (browserOccurrenceStageRoute && method === "POST") {
          errorContext = "import.failed";
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for running project work before staging browser media.",
              "jobs.busy",
            );
          const selectionId = url.searchParams.get("selectionId") ?? "";
          const baseRevision = Number(url.searchParams.get("baseRevision"));
          const occurrenceId = decodeURIComponent(
            browserOccurrenceStageRoute[1]!,
          );
          if (
            !selectionId ||
            !Number.isSafeInteger(baseRevision) ||
            baseRevision < 0
          )
            throw new HttpError(
              400,
              "A source selection and valid draft revision are required.",
            );
          if (
            !request.headers["content-type"]?.startsWith(
              "application/octet-stream",
            )
          )
            throw new HttpError(
              415,
              "Stage browser media using application/octet-stream.",
            );
          const declaredLength = Number(request.headers["content-length"]);
          if (
            Number.isFinite(declaredLength) &&
            declaredLength > maxUploadBytes
          )
            throw new HttpError(
              413,
              `Media exceeds the ${maxUploadBytes} byte staging limit.`,
            );
          const modifiedHeader =
            request.headers["x-openfilm-source-modified-at"];
          if (Array.isArray(modifiedHeader))
            throw new HttpError(
              400,
              "The browser source modification time is invalid.",
            );
          const controller = new AbortController();
          const abort = () => controller.abort();
          request.once("aborted", abort);
          response.once("close", abort);
          browserStageControllers.add(controller);
          try {
            const receipt =
              await application.sourceBatches.stageBrowserOccurrence({
                projectId: application.project.id,
                baseRevision,
                selectionId,
                occurrenceId,
                ...(typeof modifiedHeader === "string"
                  ? { modifiedAt: modifiedHeader }
                  : {}),
                chunks: request.iterator({ destroyOnReturn: false }),
                signal: controller.signal,
              });
            if (controller.signal.aborted)
              throw new HttpError(
                409,
                "Browser source staging was cancelled.",
                "jobs.notRunning",
              );
            json(response, 201, { receipt });
          } finally {
            request.off("aborted", abort);
            response.off("close", abort);
            browserStageControllers.delete(controller);
          }
          return;
        }
        if (route === "/api/import-draft/occurrences" && method === "GET") {
          const selectionId = url.searchParams.get("selectionId") ?? "";
          const offsetText = url.searchParams.get("offset");
          const limitText = url.searchParams.get("limit");
          const offset = offsetText === null ? 0 : Number(offsetText);
          const limit = limitText === null ? 100 : Number(limitText);
          if (!Number.isSafeInteger(offset) || offset < 0)
            throw new HttpError(400, "offset must be a nonnegative integer.");
          if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
            throw new HttpError(400, "limit must be between 1 and 500.");
          json(response, 200, {
            page: application.catalog.multiSource.listOccurrences(selectionId, {
              offset,
              limit,
            }),
          });
          return;
        }
        const occurrenceRoute =
          /^\/api\/import-draft\/occurrences\/([^/]+)$/u.exec(route);
        if (occurrenceRoute && method === "PATCH") {
          const data = await body(request);
          keys(data, [
            "projectId",
            "baseRevision",
            "requestId",
            "selectionId",
            "included",
          ]);
          if (
            typeof data.projectId !== "string" ||
            typeof data.baseRevision !== "number" ||
            typeof data.requestId !== "string" ||
            typeof data.selectionId !== "string" ||
            typeof data.included !== "boolean"
          )
            throw new HttpError(
              400,
              "Project, revision, request ID and inclusion state are required.",
            );
          const membership = application.sourceBatches.setIncluded({
            projectId: data.projectId,
            baseRevision: data.baseRevision,
            requestId: data.requestId,
            selectionId: data.selectionId,
            occurrenceId: decodeURIComponent(occurrenceRoute[1]!),
            included: data.included,
          });
          json(response, 200, { membership });
          return;
        }
        if (route === "/api/import-draft" && method === "GET") {
          json(response, 200, { draft: application.sourceDraft.get() });
          return;
        }
        if (route === "/api/import-draft/sources" && method === "POST") {
          const data = await body(request);
          keys(data, ["projectId", "baseRevision", "requestId", "sources"]);
          const draft = application.sourceDraft.add({
            ...draftMutation(data),
            sources: sourceSelectionInputs(data),
          });
          json(response, 200, { draft });
          return;
        }
        const sourceDraftRoute =
          /^\/api\/import-draft\/sources\/([^/]+)$/u.exec(route);
        if (sourceDraftRoute && method === "PATCH") {
          const data = await body(request);
          keys(data, ["projectId", "baseRevision", "requestId", "recursive"]);
          if (typeof data.recursive !== "boolean")
            throw new HttpError(400, "recursive must be true or false.");
          const draft = application.sourceDraft.update({
            ...draftMutation(data),
            selectionId: decodeURIComponent(sourceDraftRoute[1]!),
            recursive: data.recursive,
          });
          json(response, 200, { draft });
          return;
        }
        if (sourceDraftRoute && method === "DELETE") {
          const data = await body(request);
          keys(data, ["projectId", "baseRevision", "requestId"]);
          const draft = application.sourceDraft.remove({
            ...draftMutation(data),
            selectionId: decodeURIComponent(sourceDraftRoute[1]!),
          });
          json(response, 200, { draft });
          return;
        }
        if (route === "/api/versions/revision" && method === "GET") {
          json(response, 200, {
            projectId: application.project.id,
            revision: application.versions.currentRevision(),
          });
          return;
        }
        if (route === "/api/versions" && method === "GET") {
          json(response, 200, { versions: application.versions.list() });
          return;
        }
        if (route === "/api/versions" && method === "POST") {
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for project jobs to finish before capturing a version.",
            );
          const data = await body(request);
          keys(data, ["name", "description", "baseRevision", "requestId"]);
          if (
            data.description !== undefined &&
            typeof data.description !== "string"
          )
            throw new HttpError(400, "description must be text.");
          const version = await application.versions.create({
            name: text(data, "name"),
            ...(typeof data.description === "string"
              ? { description: data.description }
              : {}),
            baseRevision: text(data, "baseRevision"),
            requestId: text(data, "requestId"),
          } satisfies ProjectVersionCreateInput);
          json(response, 200, { version });
          return;
        }
        if (route === "/api/versions/diff" && method === "GET") {
          const before = url.searchParams.get("before") ?? "";
          const after = url.searchParams.get("after") ?? "";
          if (!before || !after)
            throw new HttpError(400, "Specify before and after version IDs.");
          const diff: ProjectVersionDiff = application.versions.diff(
            before,
            after,
          );
          json(response, 200, { diff });
          return;
        }
        const versionRoute = /^\/api\/versions\/([^/]+)(?:\/(restore))?$/u.exec(
          route,
        );
        if (versionRoute && method === "GET" && !versionRoute[2]) {
          json(
            response,
            200,
            application.versions.inspect(decodeURIComponent(versionRoute[1]!)),
          );
          return;
        }
        if (versionRoute && method === "DELETE" && !versionRoute[2]) {
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for project jobs to finish before deleting a version.",
            );
          const data = await body(request);
          keys(data, ["baseRevision", "confirmed"]);
          const result = application.versions.remove(
            decodeURIComponent(versionRoute[1]!),
            {
              baseRevision: text(data, "baseRevision"),
              confirmed: data.confirmed === true,
            },
          );
          json(response, 200, result);
          return;
        }
        if (versionRoute && method === "PATCH" && !versionRoute[2]) {
          const data = await body(request);
          keys(data, ["name", "description"]);
          if (
            data.description !== undefined &&
            data.description !== null &&
            typeof data.description !== "string"
          )
            throw new HttpError(400, "description must be text or null.");
          const version: ProjectVersionRecord = application.versions.rename(
            decodeURIComponent(versionRoute[1]!),
            {
              name: text(data, "name"),
              ...(data.description === undefined
                ? {}
                : { description: data.description as string | null }),
            },
          );
          json(response, 200, { version });
          return;
        }
        if (
          versionRoute &&
          method === "POST" &&
          versionRoute[2] === "restore"
        ) {
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for project jobs to finish before restoring a version.",
            );
          const data = await body(request);
          keys(data, ["baseRevision", "requestId", "confirmed"]);
          const input: ProjectVersionRestoreInput = {
            baseRevision: text(data, "baseRevision"),
            requestId: text(data, "requestId"),
            confirmed: data.confirmed === true,
          };
          const result = await application.versions.restore(
            decodeURIComponent(versionRoute[1]!),
            input,
          );
          editors.delete(application);
          json(response, 200, {
            ...result,
            project: application.project,
            generation: application.projectGeneration,
          });
          return;
        }
        if (
          method === "POST" &&
          (route === "/api/handoff/review" || route === "/api/handoff/export")
        ) {
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for running jobs before NLE handoff.",
            );
          const data = await body(request);
          keys(data, [
            "projectId",
            "compositionId",
            "revision",
            "mode",
            "bakeAudio",
            "captionTrackId",
          ]);
          if (data.projectId !== application.project.id)
            throw new HttpError(409, "The handoff project changed.");
          const compositionId = text(data, "compositionId");
          const options = {
            ...(data.mode !== undefined ? { mode: data.mode } : {}),
            ...(data.bakeAudio !== undefined
              ? { bakeAudio: data.bakeAudio }
              : {}),
            ...(data.captionTrackId !== undefined
              ? { captionTrackId: data.captionTrackId }
              : {}),
          } as import("@openfilm/exporters").HandoffOptions;
          if (route.endsWith("/review")) {
            json(
              response,
              200,
              application.reviewHandoff(compositionId, options),
            );
            return;
          }
          const controller = new AbortController(),
            requestId = `handoff:${randomUUID()}`;
          let done!: () => void;
          const completed = new Promise<void>((resolve) => {
            done = resolve;
          });
          active.set(requestId, controller);
          tasks.add(completed);
          const disconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once("close", disconnected);
          try {
            const result = await application.exportHandoff(
              {
                projectId: application.project.id,
                compositionId,
                revision: text(data, "revision"),
                ...options,
              },
              controller.signal,
            );
            json(response, 200, result);
          } finally {
            response.off("close", disconnected);
            active.delete(requestId);
            done();
            tasks.delete(completed);
          }
          return;
        }
        if (method === "GET" && route === "/api/handoff/file") {
          if (url.searchParams.get("projectId") !== application.project.id)
            throw new HttpError(409, "The handoff project changed.");
          const index = Number(url.searchParams.get("index"));
          const file = await application.handoff.file(
            url.searchParams.get("id") ?? "",
            index,
          );
          response.setHeader(
            "Content-Disposition",
            `attachment; filename="${basename(file)}"`,
          );
          await streamFile(
            request,
            response,
            file,
            join(application.directory, "cache", "nle-handoff-published"),
            "application/octet-stream",
          );
          return;
        }
        if (
          method === "POST" &&
          [
            "/api/collect/plan",
            "/api/collect/coverage",
            "/api/collect/create",
            "/api/collect/verify",
          ].includes(route)
        ) {
          const controller = new AbortController();
          const requestId = `collect:${randomUUID()}`;
          let completeRequest!: () => void;
          const completed = new Promise<void>((resolve) => {
            completeRequest = resolve;
          });
          active.set(requestId, controller);
          tasks.add(completed);
          const abortRequest = () => {
            request.destroy();
            response.destroy();
          };
          controller.signal.addEventListener("abort", abortRequest, {
            once: true,
          });
          const disconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once("close", disconnected);
          try {
            const data = await body(request);
            if (route === "/api/collect/coverage") {
              keys(data, [
                "projectId",
                "scope",
                "compositionId",
                "rightsDeclarations",
                "delivery",
                "expectedRevision",
              ]);
              const review = await application.collectMedia.coverage(
                data as unknown as CollectCoveragePlanInput,
                controller.signal,
              );
              json(response, 200, { review });
              return;
            }
            if (route === "/api/collect/plan") {
              keys(data, ["scope", "compositionId", "rightsDeclarations"]);
              const plan = await application.collectMedia.plan(
                data as unknown as CollectPlanInput,
                controller.signal,
              );
              json(response, 200, { plan });
              return;
            }
            if (route === "/api/collect/create") {
              keys(data, [
                "scope",
                "compositionId",
                "rightsDeclarations",
                "planId",
                "baseRevision",
                "format",
                "delivery",
                "coverageId",
                "projectId",
                "acceptDelivery",
              ]);
              const format =
                data.format === "zip"
                  ? "zip"
                  : data.format === "directory"
                    ? "directory"
                    : undefined;
              if (!format)
                throw new HttpError(
                  400,
                  "Choose a folder or ZIP package format.",
                );
              const extension = format === "zip" ? ".zip" : ".openfilm";
              const destination = join(
                application.directory,
                "exports",
                `openfilm-collect-${randomUUID()}${extension}`,
              );
              const result = await application.collectMedia.create({
                ...data,
                destination,
                signal: controller.signal,
              } as unknown as CollectMediaCreateInput);
              json(response, 200, { result });
              return;
            }
            keys(data, ["packageName"]);
            const packageName = text(data, "packageName");
            if (!safeFilename(packageName))
              throw new HttpError(
                400,
                "Choose a package name inside this film's exports folder.",
              );
            const packagePath = join(
              application.directory,
              "exports",
              packageName,
            );
            const result = await application.collectMedia.verify(
              packagePath,
              controller.signal,
            );
            json(response, 200, { result });
          } finally {
            response.removeListener("close", disconnected);
            controller.signal.removeEventListener("abort", abortRequest);
            active.delete(requestId);
            tasks.delete(completed);
            completeRequest();
          }
        }
        if (route.startsWith("/api/captions/")) {
          errorContext = "captions.failed";
          const controller = new AbortController();
          // These are request-scoped cancellation records, not catalog jobs.
          // Shutdown must cancel hashing and wait for staged-output cleanup
          // before closing the owning project's catalog.
          const requestId = `captions:${randomUUID()}`;
          let completeRequest!: () => void;
          const completed = new Promise<void>((resolve) => {
            completeRequest = resolve;
          });
          active.set(requestId, controller);
          tasks.add(completed);
          const abortRequest = () => {
            // Also interrupt an incomplete POST body. Its async iterator would
            // otherwise keep shutdown waiting even after the signal aborts.
            request.destroy();
            response.destroy();
          };
          controller.signal.addEventListener("abort", abortRequest, {
            once: true,
          });
          const disconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once("close", disconnected);
          try {
            const projectId = url.searchParams.get("projectId") ?? "";
            if (method === "GET" && route === "/api/captions/context") {
              if (projectId !== application.project.id)
                throw new ApplicationError(
                  "captions.stale",
                  "The active project changed. Reopen caption export.",
                  409,
                );
              const compositionId = url.searchParams.get("compositionId") ?? "";
              json(response, 200, {
                projectId,
                compositionId,
                revision: editorFor(application).get(compositionId).revision,
              });
              return;
            }
            if (method === "POST" && route === "/api/captions/prepare") {
              const data = await body(request);
              for (const key of Object.keys(data))
                if (
                  ![
                    "projectId",
                    "compositionId",
                    "trackId",
                    "baseRevision",
                  ].includes(key)
                )
                  throw new ApplicationError(
                    "captions.invalid",
                    `Unknown caption option: ${key}.`,
                  );
              json(
                response,
                200,
                await application.captions.prepare(
                  {
                    projectId: text(data, "projectId"),
                    compositionId: text(data, "compositionId"),
                    trackId: text(data, "trackId"),
                    baseRevision: text(data, "baseRevision"),
                  },
                  { signal: controller.signal },
                ),
              );
              return;
            }
            if (method === "POST" && route === "/api/captions/native-track") {
              const data = await body(request);
              keys(data, [
                "projectId",
                "snapshotId",
                "name",
                "language",
                "trackId",
                "requestId",
              ]);
              if (
                ["language", "trackId", "requestId"].some(
                  (key) =>
                    data[key] !== undefined && typeof data[key] !== "string",
                )
              )
                throw new HttpError(400, "Caption track options must be text.");
              json(
                response,
                200,
                await application.captions.addNativeTrack(
                  {
                    projectId: text(data, "projectId"),
                    snapshotId: text(data, "snapshotId"),
                    name: text(data, "name"),
                    ...(typeof data.language === "string"
                      ? { language: data.language }
                      : {}),
                    ...(typeof data.trackId === "string"
                      ? { trackId: data.trackId }
                      : {}),
                    ...(typeof data.requestId === "string"
                      ? { requestId: data.requestId }
                      : {}),
                  },
                  { signal: controller.signal, editor: editorFor(application) },
                ),
              );
              return;
            }
            if (method === "GET" && route === "/api/captions/snapshot") {
              const bounds: Record<string, number> = {};
              for (const key of [
                "offset",
                "limit",
                "issueOffset",
                "issueLimit",
                "sourceOffset",
                "sourceLimit",
                "clipOffset",
                "clipLimit",
              ])
                if (url.searchParams.has(key))
                  bounds[key] = Number(url.searchParams.get(key));
              json(
                response,
                200,
                await application.captions.get(
                  url.searchParams.get("id") ?? "",
                  {
                    projectId,
                    ...bounds,
                  },
                  { signal: controller.signal },
                ),
              );
              return;
            }
            if (method === "POST" && route === "/api/captions/export") {
              const data = await body(request);
              for (const key of Object.keys(data))
                if (!["projectId", "snapshotId", "format"].includes(key))
                  throw new ApplicationError(
                    "captions.invalid",
                    `Unknown caption option: ${key}.`,
                  );
              const format = text(data, "format");
              if (format !== "srt" && format !== "vtt")
                throw new ApplicationError(
                  "captions.invalid",
                  "Choose SRT or WebVTT.",
                );
              json(
                response,
                200,
                await application.captions.export(
                  text(data, "snapshotId"),
                  format,
                  {
                    projectId: text(data, "projectId"),
                    signal: controller.signal,
                  },
                ),
              );
              return;
            }
            if (method === "GET" && route === "/api/captions/file") {
              const kind = url.searchParams.get("kind") ?? "captions";
              if (kind !== "captions" && kind !== "manifest")
                throw new ApplicationError(
                  "captions.invalid",
                  "Choose the subtitle file or its receipt.",
                );
              const result = await application.captions.readOutput(
                url.searchParams.get("id") ?? "",
                { projectId, kind, signal: controller.signal },
              );
              response.setHeader(
                "Content-Disposition",
                `attachment; filename*=UTF-8''${encodeURIComponent(kind === "manifest" ? "captions.manifest.json" : result.publication.fileName)}`,
              );
              response.writeHead(200, {
                "Content-Type":
                  kind === "manifest"
                    ? "application/json; charset=utf-8"
                    : result.publication.mediaType,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
              });
              response.end(result.content);
              return;
            }
          } finally {
            response.removeListener("close", disconnected);
            controller.signal.removeEventListener("abort", abortRequest);
            active.delete(requestId);
            tasks.delete(completed);
            completeRequest();
          }
          throw new HttpError(404, "Caption endpoint not found.");
        }
        const startReview = async (
          job: Job,
          work: (options: ReviewOptions) => Promise<Job>,
          initialReservation = true,
        ) => {
          if (hasActiveProjectWork() || application.hasActiveJobs)
            throw new HttpError(
              409,
              "Wait for the current job before starting another review.",
            );
          const controller = new AbortController();
          let ownedJob: Job | undefined;
          if (initialReservation) {
            job = { ...job, reviewOwner: createReviewOwner() };
            application.catalog.saveJob(job);
            ownedJob = job;
          }
          active.set(job.id, controller);
          let acceptPrepared: ((job: Job) => void) | undefined;
          let rejectPreparation: ((error: unknown) => void) | undefined;
          const prepared = initialReservation
            ? undefined
            : new Promise<Job>((accept, reject) => {
                acceptPrepared = accept;
                rejectPreparation = reject;
              });
          const handled = Promise.resolve()
            .then(() =>
              work({
                jobId: job.id,
                signal: controller.signal,
                onJob: (observed) => {
                  ownedJob = observed;
                  if (observed.reviewOwner)
                    acceptPrepared?.(structuredClone(observed));
                },
              }),
            )
            .then(() => {
              if (!initialReservation && !ownedJob?.reviewOwner)
                throw new HttpError(
                  409,
                  "The review retry did not acquire its job. Refresh the review before retrying.",
                );
            })
            .catch((error) => {
              rejectPreparation?.(error);
              // A retry owns nothing until its atomic claim and preflight
              // succeed. Its rejection must not rewrite another execution.
              if (!ownedJob?.reviewOwner) return;
              const prior =
                application.catalog
                  .listJobs()
                  .find((item) => item.id === job.id) ?? ownedJob;
              if (!["queued", "running"].includes(prior.status)) return;
              application.catalog.knowledge.saveOwnedReviewJob({
                ...prior,
                reviewOwner: ownedJob.reviewOwner,
                status: controller.signal.aborted ? "cancelled" : "failed",
                updatedAt: new Date().toISOString(),
                errors: [
                  {
                    uri: "",
                    stage: "reviewing",
                    message: String(error),
                    ...errorInfo(error, "review.invalidOutput"),
                  },
                ],
              });
            })
            .finally(() => {
              active.delete(job.id);
              tasks.delete(handled);
            });
          tasks.add(handled);
          // A retry is accepted only after claim and preflight succeed. Provider
          // work stays in the background; preparation errors reach this request.
          json(response, 202, { job: prepared ? await prepared : job });
        };
        const transcriptSegmentBody =
          /^\/api\/assets\/([^/]+)\/transcript\/segment$/.exec(route);
        if (transcriptSegmentBody && method === "POST") {
          const data = await body(request);
          keys(data, ["segmentId"]);
          let segmentId: string;
          try {
            segmentId = validateTranscriptSegmentId(data.segmentId);
          } catch {
            throw new HttpError(
              400,
              "Choose a nonblank transcript segment identifier.",
              "request.invalid",
            );
          }
          json(
            response,
            200,
            await application.transcriptEditor.getSegment(
              decodeURIComponent(transcriptSegmentBody[1]!),
              segmentId,
            ),
          );
          return;
        }
        const transcriptSegment =
          /^\/api\/assets\/([^/]+)\/transcript\/segments\/([^/]+)$/.exec(route);
        if (transcriptSegment && method === "GET") {
          json(
            response,
            200,
            await application.transcriptEditor.getSegment(
              decodeURIComponent(transcriptSegment[1]!),
              decodeURIComponent(transcriptSegment[2]!),
            ),
          );
          return;
        }
        const transcript =
          /^\/api\/assets\/([^/]+)\/transcript(?:\/(edit|undo|redo|search|revisions|select))?$/.exec(
            route,
          );
        if (transcript) {
          const assetId = decodeURIComponent(transcript[1]!);
          const action = transcript[2];
          if (method === "GET" && !action) {
            const revisionId = url.searchParams.get("revisionId") ?? undefined;
            json(
              response,
              200,
              await application.transcriptEditor.get(assetId, {
                ...pageOptions(url),
                revisionId,
              }),
            );
            return;
          }
          if (method === "GET" && action === "search") {
            const sensitive = url.searchParams.get("caseSensitive");
            if (
              sensitive !== null &&
              sensitive !== "true" &&
              sensitive !== "false"
            )
              throw new HttpError(400, "caseSensitive must be true or false.");
            json(
              response,
              200,
              await application.transcriptEditor.search(assetId, {
                ...pageOptions(url),
                query: url.searchParams.get("query") ?? "",
                caseSensitive: sensitive === "true",
              }),
            );
            return;
          }
          if (method === "GET" && action === "revisions") {
            json(
              response,
              200,
              await application.transcriptEditor.revisions(
                assetId,
                pageOptions(url),
              ),
            );
            return;
          }
          if (
            method === "POST" &&
            action &&
            ["edit", "undo", "redo", "select"].includes(action)
          ) {
            const data = await body(request);
            const result =
              action === "edit"
                ? await application.transcriptEditor.edit(
                    assetId,
                    data as unknown as TranscriptMutationInput,
                  )
                : action === "select"
                  ? await application.transcriptEditor.selectRevision(
                      assetId,
                      data as unknown as TranscriptHistoryInput & {
                        revisionId: string;
                      },
                    )
                  : await application.transcriptEditor[
                      action as "undo" | "redo"
                    ](assetId, data as unknown as TranscriptHistoryInput);
            json(response, 200, result);
            return;
          }
        }
        if (route === "/api/glossary" && method === "GET") {
          const scope = url.searchParams.get("scope") ?? "effective";
          if (!["global", "project", "effective"].includes(scope))
            throw new HttpError(
              400,
              "Choose global, project or effective glossary scope.",
            );
          json(response, 200, {
            entries: application.knowledge.glossaryList(
              scope as "global" | "project" | "effective",
            ),
          });
          return;
        }
        if (route === "/api/glossary" && method === "POST") {
          const data = await body(request);
          keys(data, [
            "id",
            "scope",
            "source",
            "replacement",
            "enabled",
            "caseSensitive",
          ]);
          json(response, 200, {
            entry: application.knowledge.glossaryUpsert(
              data as unknown as GlossaryInput,
            ),
          });
          return;
        }
        const glossary = /^\/api\/glossary\/([^/]+)$/.exec(route);
        if (glossary && method === "DELETE") {
          const scope = url.searchParams.get("scope");
          if (scope !== "global" && scope !== "project")
            throw new HttpError(
              400,
              "Choose global or project glossary scope.",
            );
          json(response, 200, {
            ok: application.knowledge.glossaryDelete(
              decodeURIComponent(glossary[1]!),
              scope,
            ),
          });
          return;
        }
        if (
          method === "GET" &&
          ["/api/review/provider", "/api/review/providers"].includes(route)
        ) {
          const workflow = url.searchParams.get("workflow");
          if (
            workflow !== null &&
            workflow !== "scene-script" &&
            workflow !== "graphic-scene"
          )
            throw new HttpError(400, "Choose a supported review workflow.");
          json(
            response,
            200,
            application.knowledge.languageProvider(
              workflow === "scene-script" || workflow === "graphic-scene"
                ? ["text"]
                : undefined,
            ),
          );
          return;
        }
        if (method === "POST" && route === "/api/review/consent") {
          const data = await body(request);
          keys(data, [
            "allow",
            "providerId",
            "endpoint",
            "dataKinds",
            "workflow",
          ]);
          if (typeof data.allow !== "boolean")
            throw new HttpError(400, "allow must be a boolean.");
          if (
            data.workflow !== undefined &&
            data.workflow !== "scene-script" &&
            data.workflow !== "graphic-scene"
          )
            throw new HttpError(400, "Choose a supported review workflow.");
          const requiredKinds =
            data.workflow === "scene-script" ||
            data.workflow === "graphic-scene"
              ? (["text"] as const)
              : undefined;
          const provider = application.knowledge.languageProvider(
            requiredKinds === undefined ? undefined : [...requiredKinds],
          ).provider;
          if (!provider || provider.execution !== "remote")
            throw new HttpError(
              400,
              "No remote language provider is configured.",
              "review.providerUnavailable",
            );
          if (data.allow) {
            // Consent covers the descriptor the user actually saw, never a
            // newly configured destination or undisclosed additional data kind.
            const disclosedKinds = data.dataKinds;
            if (
              data.providerId !== provider.id ||
              data.endpoint !== provider.endpoint ||
              !Array.isArray(disclosedKinds) ||
              disclosedKinds.length !== provider.dataKinds.length ||
              new Set(disclosedKinds).size !== disclosedKinds.length ||
              provider.dataKinds.some((kind) => !disclosedKinds.includes(kind))
            )
              throw new HttpError(
                400,
                "Consent must match the displayed provider, destination, and all declared data kinds. Refresh the provider disclosure before granting consent.",
              );
            application.knowledge.grantConsent({
              providerId: provider.id,
              dataKinds: [...provider.dataKinds],
              grantedAt: new Date().toISOString(),
            });
            if (
              !application.knowledge.languageProvider(
                requiredKinds === undefined ? undefined : [...requiredKinds],
              ).available
            ) {
              application.knowledge.revokeConsent(provider.id);
              throw new HttpError(
                400,
                "The configured language provider changed or cannot perform this review. Configure it again before granting consent.",
                "review.providerUnavailable",
              );
            }
          } else application.knowledge.revokeConsent(provider.id);
          json(
            response,
            200,
            application.knowledge.languageProvider(
              requiredKinds === undefined ? undefined : [...requiredKinds],
            ),
          );
          return;
        }
        const scriptReview =
          /^\/api\/stories\/([^/]+)\/script-review(?:\/(suggestions))?$/.exec(
            route,
          );
        if (scriptReview && method === "GET" && scriptReview[2]) {
          const field = url.searchParams.get("field");
          const beatId = url.searchParams.get("beatId");
          const status = url.searchParams.get("status") ?? undefined;
          if (
            !beatId ||
            (field !== "narration" && field !== "visualDirection") ||
            (status !== undefined &&
              !["pending", "accepted", "skipped", "stale"].includes(status))
          )
            throw new HttpError(
              400,
              "Choose a scene, script field and valid review status.",
            );
          json(
            response,
            200,
            application.sceneScriptReview.list(
              decodeURIComponent(scriptReview[1]!),
              {
                beatId,
                field,
                ...pageOptions(url, 100),
                status: status as ReviewSuggestion["status"] | undefined,
              },
            ),
          );
          return;
        }
        if (scriptReview && method === "POST" && !scriptReview[2]) {
          errorContext = "review.invalidOutput";
          const data = await body(request);
          keys(data, ["beatId", "field"]);
          const storyId = decodeURIComponent(scriptReview[1]!);
          const story = application.project.stories.find(
            (item) => item.id === storyId,
          );
          if (!story)
            throw new HttpError(404, "Story not found.", "request.notFound");
          if (
            typeof data.beatId !== "string" ||
            !story.beats.some((beat) => beat.id === data.beatId) ||
            (data.field !== "narration" && data.field !== "visualDirection")
          )
            throw new HttpError(400, "Choose a saved scene and script field.");
          if (!application.knowledge.languageProvider(["text"]).available)
            throw new HttpError(
              400,
              "Configure and authorize a text language provider before reviewing scripts.",
              "review.providerUnavailable",
            );
          const beatId = data.beatId;
          const field = data.field;
          await startReview(
            {
              id: randomUUID(),
              type: "scene-script-review",
              storyId,
              beatId,
              scriptField: field,
              status: "queued",
              progress: 0,
              createdAt: new Date().toISOString(),
            },
            (options) =>
              application.runSceneScriptReview(storyId, {
                ...options,
                beatId,
                field,
              }),
          );
          return;
        }
        const scriptSuggestion =
          /^\/api\/script-review\/suggestions\/([^/]+)\/(accept|skip)$/.exec(
            route,
          );
        if (scriptSuggestion && method === "POST") {
          errorContext = "review.suggestionStale";
          const data = await body(request);
          const id = decodeURIComponent(scriptSuggestion[1]!);
          if (scriptSuggestion[2] === "accept") {
            keys(data, ["baseRevision", "requestId"]);
            if (
              typeof data.baseRevision !== "string" ||
              typeof data.requestId !== "string"
            )
              throw new HttpError(
                400,
                "Acceptance requires a source revision and request ID.",
              );
            json(response, 200, {
              story: application.sceneScriptReview.accept(id, {
                baseRevision: data.baseRevision,
                requestId: data.requestId,
              }),
            });
          } else {
            keys(data, []);
            json(response, 200, {
              suggestion: application.sceneScriptReview.skip(id),
            });
          }
          return;
        }
        const review =
          /^\/api\/assets\/([^/]+)\/review(?:\/(suggestions))?$/.exec(route);
        if (review && method === "GET") {
          const status = url.searchParams.get("status") ?? undefined;
          if (
            status !== undefined &&
            !["pending", "accepted", "skipped", "stale"].includes(status)
          )
            throw new HttpError(400, "Choose a valid suggestion status.");
          json(
            response,
            200,
            await application.knowledge.suggestionsList(
              decodeURIComponent(review[1]!),
              {
                ...pageOptions(url, 100),
                status: status as ReviewSuggestion["status"] | undefined,
              },
            ),
          );
          return;
        }
        if (review && method === "POST" && !review[2]) {
          const data = await body(request);
          keys(data, ["source", "segmentIds", "batchSize"]);
          if (data.source !== "glossary" && data.source !== "language")
            throw new HttpError(400, "Choose glossary or language review.");
          const settings = reviewOptions(data),
            assetId = decodeURIComponent(review[1]!);
          if (!application.catalog.getAsset(assetId))
            throw new HttpError(404, "Media not found.", "media.notFound");
          const source = data.source;
          await startReview(
            {
              id: randomUUID(),
              type:
                source === "glossary" ? "glossary-review" : "language-review",
              assetId,
              status: "queued",
              progress: 0,
              createdAt: new Date().toISOString(),
            },
            (options) =>
              application.runKnowledgeReview(assetId, {
                ...options,
                ...settings,
                source,
              }),
          );
          return;
        }
        const suggestion =
          /^\/api\/review\/suggestions\/([^/]+)\/(accept|skip)$/.exec(route);
        if (suggestion && method === "POST") {
          const data = await body(request),
            id = decodeURIComponent(suggestion[1]!);
          if (suggestion[2] === "accept") {
            keys(data, ["baseRevision", "requestId"]);
            json(
              response,
              200,
              await application.knowledge.acceptSuggestion(
                id,
                data as unknown as TranscriptHistoryInput,
              ),
            );
          } else {
            keys(data, []);
            json(response, 200, {
              suggestion: application.knowledge.skipSuggestion(id),
            });
          }
          return;
        }
        const reviewRecovery = /^\/api\/review\/jobs\/([^/]+)\/recovery$/.exec(
          route,
        );
        if (reviewRecovery && method === "GET") {
          json(
            response,
            200,
            application.knowledge.reviewRecoveryStatus(
              decodeURIComponent(reviewRecovery[1]!),
            ),
          );
          return;
        }
        if (reviewRecovery && method === "POST") {
          const data = await body(request);
          keys(data, ["confirmStopped", "ownerToken", "updatedAt"]);
          if (typeof data.confirmStopped !== "boolean")
            throw new HttpError(400, "confirmStopped must be a boolean.");
          if (
            data.ownerToken !== undefined &&
            typeof data.ownerToken !== "string"
          )
            throw new HttpError(400, "ownerToken must be a string.");
          if (
            data.updatedAt !== undefined &&
            typeof data.updatedAt !== "string"
          )
            throw new HttpError(400, "updatedAt must be a string.");
          const jobId = decodeURIComponent(reviewRecovery[1]!);
          if (active.has(jobId))
            throw new HttpError(
              409,
              "The review is still active in this application process.",
              "jobs.busy",
            );
          json(response, 200, {
            job: application.knowledge.manualRecoverReview(jobId, {
              confirmStopped: data.confirmStopped,
              ownerToken: data.ownerToken,
              updatedAt: data.updatedAt,
            }),
          });
          return;
        }
        const batch =
          /^\/api\/review\/jobs\/([^/]+)\/batches(?:\/(\d+)\/(retry|skip))?$/.exec(
            route,
          );
        if (batch && method === "GET" && !batch[2]) {
          json(response, 200, {
            batches: application.knowledge.batches(
              decodeURIComponent(batch[1]!),
            ),
          });
          return;
        }
        if (batch && method === "POST" && batch[2]) {
          const data = await body(request);
          keys(data, []);
          const jobId = decodeURIComponent(batch[1]!),
            index = Number(batch[2]);
          if (!Number.isSafeInteger(index))
            throw new HttpError(400, "Invalid review batch index.");
          if (hasActiveProjectWork() || application.hasActiveJobs)
            throw new HttpError(
              409,
              "Wait for the current job before changing review batches.",
            );
          const job = application.catalog
            .listJobs()
            .find((item) => item.id === jobId);
          if (
            !job ||
            !["language-review", "glossary-review"].includes(job.type)
          )
            throw new HttpError(404, "Review job not found.");
          const targetBatch = application.knowledge
            .batches(jobId)
            .find((item) => item.index === index);
          if (
            !targetBatch ||
            !["failed", "cancelled"].includes(targetBatch.status)
          )
            throw new HttpError(
              400,
              "Only failed or cancelled review batches can be retried or skipped.",
            );
          if (batch[3] === "skip") {
            const skipped = application.knowledge.skipBatch(jobId, index);
            json(response, 200, {
              batch: skipped,
              job: application.catalog
                .listJobs()
                .find((item) => item.id === jobId),
            });
          } else
            await startReview(
              { ...job, status: "queued" },
              (options) =>
                application.retryKnowledgeReview(jobId, index, options),
              false,
            );
          return;
        }
        if (method === "GET" && route === "/api/intelligence/providers") {
          json(response, 200, await application.intelligence.providers());
          return;
        }
        const analysisRecovery =
          /^\/api\/intelligence\/jobs\/([^/]+)\/(recovery|recover)$/.exec(
            route,
          );
        if (
          analysisRecovery &&
          method === "GET" &&
          analysisRecovery[2] === "recovery"
        ) {
          const jobId = decodeURIComponent(analysisRecovery[1]!);
          json(response, 200, {
            ...application.intelligence.analysisRecoveryStatus(jobId),
            canCancel: active.has(jobId),
          });
          return;
        }
        if (
          analysisRecovery &&
          method === "POST" &&
          analysisRecovery[2] === "recover"
        ) {
          const data = await body(request);
          keys(data, ["confirmStopped", "checkpoint", "ownerToken"]);
          if (typeof data.confirmStopped !== "boolean")
            throw new HttpError(400, "confirmStopped must be a boolean.");
          if (typeof data.checkpoint !== "string" || !data.checkpoint)
            throw new HttpError(
              400,
              "Include the observed analysis checkpoint.",
            );
          if (
            data.ownerToken !== undefined &&
            typeof data.ownerToken !== "string"
          )
            throw new HttpError(400, "ownerToken must be a string.");
          const jobId = decodeURIComponent(analysisRecovery[1]!);
          if (active.has(jobId))
            throw new HttpError(
              409,
              "This analysis is still active in this process.",
              "jobs.busy",
            );
          json(response, 200, {
            job: application.intelligence.manualRecoverAnalysis(jobId, {
              confirmStopped: data.confirmStopped,
              checkpoint: data.checkpoint,
              ownerToken: data.ownerToken,
            }),
          });
          return;
        }
        const intelligence = /^\/api\/assets\/([^/]+)\/intelligence$/.exec(
          route,
        );
        if (intelligence && method === "GET") {
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = Number(url.searchParams.get("limit") ?? 100);
          if (
            !Number.isInteger(offset) ||
            offset < 0 ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 200
          )
            throw new HttpError(
              400,
              "Read at most 200 transcript segments per page.",
            );
          json(
            response,
            200,
            await application.intelligence.read(
              decodeURIComponent(intelligence[1]!),
              { offset, limit },
            ),
          );
          return;
        }
        if (intelligence && method === "POST") {
          const data = await body(request);
          const operation = data.operation;
          if (
            operation !== "transcribe" &&
            operation !== "waveform" &&
            operation !== "scenes"
          )
            throw new HttpError(400, "Choose transcribe, waveform or scenes.");
          if (
            Object.keys(data).some(
              (key) => !["operation", "language", "execution"].includes(key),
            )
          )
            throw new HttpError(400, "Unsupported media analysis setting.");
          if (
            data.language !== undefined &&
            (typeof data.language !== "string" ||
              !["auto", "zh", "en", "ja"].includes(data.language))
          )
            throw new HttpError(
              400,
              "Choose Auto, Chinese, English or Japanese.",
            );
          if (
            data.execution !== undefined &&
            (typeof data.execution !== "string" ||
              !["auto", "cpu", "gpu"].includes(data.execution))
          )
            throw new HttpError(400, "Choose Auto, CPU or GPU execution.");
          const assetId = decodeURIComponent(intelligence[1]!);
          if (!application.catalog.getAsset(assetId))
            throw new HttpError(404, "Media not found.", "media.notFound");
          if (hasActiveProjectWork() || application.hasActiveJobs)
            throw new HttpError(
              409,
              "Wait for the current job before analyzing another source.",
            );
          const controller = new AbortController();
          // Reserve before returning 202. Other catalog connections see this
          // owner immediately, and only this exact queued reservation can run.
          const job = application.reserveIntelligenceJob(assetId, operation);
          active.set(job.id, controller);
          const task = application.analyzeIntelligence(assetId, {
            operation,
            reservation: job,
            signal: controller.signal,
            language: data.language as "auto" | "zh" | "en" | "ja" | undefined,
            execution: data.execution as "auto" | "cpu" | "gpu" | undefined,
          });
          const handled = task
            .catch((error) => {
              // Preparation can fail before run consumes the reservation. A
              // recovered or terminal job must never be resurrected here.
              application.catalog.intelligence.saveOwnedAnalysisJob({
                ...job,
                status: controller.signal.aborted ? "cancelled" : "failed",
                updatedAt: new Date().toISOString(),
                errors: [
                  {
                    uri: "",
                    stage: operation,
                    message: String(error),
                    ...errorInfo(
                      error,
                      operation === "transcribe"
                        ? "media.transcriptionFailed"
                        : operation === "waveform"
                          ? "media.waveformFailed"
                          : "media.sceneFailed",
                    ),
                  },
                ],
              });
            })
            .finally(() => {
              active.delete(job.id);
              tasks.delete(handled);
            });
          tasks.add(handled);
          json(response, 202, { job });
          return;
        }
        const markers = /^\/api\/assets\/([^/]+)\/markers(?:\/([^/]+))?$/.exec(
          route,
        );
        if (markers && method === "POST" && !markers[2]) {
          const data = await body(request);
          if (Object.keys(data).some((key) => !["time", "label"].includes(key)))
            throw new HttpError(400, "Unsupported marker field.");
          json(response, 201, {
            marker: await application.intelligence.addMarker(
              decodeURIComponent(markers[1]!),
              data.time as number,
              data.label as string | undefined,
            ),
          });
          return;
        }
        if (markers && method === "DELETE" && markers[2]) {
          await application.intelligence.removeMarker(
            decodeURIComponent(markers[1]!),
            decodeURIComponent(markers[2]),
          );
          json(response, 200, { ok: true });
          return;
        }
        if (method === "PATCH" && route === "/api/project/timebase") {
          const data = await body(request);
          keys(data, ["projectId", "baseRevision", "timebase"]);
          const project = application.updateProjectTimebase({
            projectId: text(data, "projectId"),
            baseRevision: text(data, "baseRevision"),
            timebase: projectTimebase(data.timebase),
          });
          json(response, 200, { project, path: application.directory });
          return;
        }
        if (method === "PATCH" && route === "/api/project") {
          const data = await body(request);
          if (
            Object.keys(data).some(
              (key) => !["projectContentLocale", "filmSettings"].includes(key),
            )
          )
            throw new HttpError(400, "Unsupported project edit.");
          const project = application.updateFilm(filmOptions(data));
          json(response, 200, { project, path: application.directory });
          return;
        }
        if (method === "GET" && route === "/api/assets") {
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = Number(url.searchParams.get("limit") ?? 60);
          if (
            !Number.isInteger(offset) ||
            offset < 0 ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 200
          )
            throw new HttpError(
              400,
              "Pagination requires offset >= 0 and limit 1–200.",
            );
          const ids = url.searchParams.get("ids")?.split(",").filter(Boolean);
          if (ids && ids.length > 200)
            throw new HttpError(400, "Select at most 200 IDs per request.");
          const mediaType = url.searchParams.get("mediaType");
          const state = url.searchParams.get("state");
          if (
            mediaType &&
            !["image", "video", "audio", "360-video"].includes(mediaType)
          )
            throw new HttpError(400, "Unknown media type.");
          if (state && !["favorite", "rejected", "locked"].includes(state))
            throw new HttpError(400, "Unknown media state.");
          const filter = {
            offset,
            limit,
            ...(ids ? { ids } : {}),
            ...(url.searchParams.get("search")
              ? { search: url.searchParams.get("search")! }
              : {}),
            ...(state ? { state: { [state]: true } } : {}),
            ...(mediaType
              ? { mediaType: mediaType as MediaAsset["mediaType"] }
              : {}),
          };
          const assets = ids
            ? ids.flatMap((id) => {
                const asset = application.catalog.getAsset(id);
                return asset ? [asset] : [];
              })
            : application.catalog.listAssets(filter);
          json(response, 200, {
            assets,
            total: application.catalog.countAssets(filter),
            summary: {
              total: application.catalog.countAssets(),
              images: application.catalog.countAssets({ mediaType: "image" }),
              videos:
                application.catalog.countAssets({ mediaType: "video" }) +
                application.catalog.countAssets({ mediaType: "360-video" }),
              audio: application.catalog.countAssets({ mediaType: "audio" }),
            },
          });
          return;
        }
        const assetMatch = /^\/api\/assets\/([^/]+)$/.exec(route);
        if (method === "PATCH" && assetMatch) {
          const id = decodeURIComponent(assetMatch[1]!);
          const data = await body(request);
          if (!application.catalog.getAsset(id))
            throw new HttpError(
              404,
              "Media asset not found.",
              "media.notFound",
            );
          if (
            Object.keys(data).some(
              (key) => !["rating", "state", "tags"].includes(key),
            )
          )
            throw new HttpError(
              400,
              "Only rating, state, and tags can be edited.",
            );
          if (
            data.rating !== undefined &&
            (typeof data.rating !== "number" ||
              data.rating < 0 ||
              data.rating > 5)
          )
            throw new HttpError(400, "Rating must be 0–5.");
          if (
            data.state !== undefined &&
            (!data.state ||
              typeof data.state !== "object" ||
              Array.isArray(data.state) ||
              Object.entries(data.state).some(
                ([key, value]) =>
                  !["favorite", "rejected", "locked"].includes(key) ||
                  typeof value !== "boolean",
              ))
          )
            throw new HttpError(400, "Invalid media state.");
          if (
            data.tags !== undefined &&
            (!Array.isArray(data.tags) ||
              data.tags.some((tag) => typeof tag !== "string"))
          )
            throw new HttpError(400, "Tags must be strings.");
          application.catalog.updateAsset(id, data as Partial<MediaAsset>);
          json(response, 200, { asset: application.catalog.getAsset(id) });
          return;
        }
        if (method === "GET" && route === "/api/media/status") {
          const assetIds = url.searchParams.has("assetIds")
            ? url.searchParams.get("assetIds")!.split(",")
            : undefined;
          json(response, 200, await relinkerFor(application).status(assetIds));
          return;
        }
        if (
          method === "POST" &&
          (route === "/api/media/relink/plan" ||
            route === "/api/media/relink/apply")
        ) {
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for import or rendering to finish before relinking media.",
            );
          const data = await body(request);
          const relinker = relinkerFor(application);
          const result = route.endsWith("/plan")
            ? await relinker.plan(data as Parameters<MediaRelinker["plan"]>[0])
            : await relinker.apply(
                data as unknown as Parameters<MediaRelinker["apply"]>[0],
              );
          json(response, 200, result);
          return;
        }
        const source = /^\/api\/source\/([^/]+)$/.exec(route);
        if (method === "GET" && source) {
          const asset = application.catalog.getAsset(
            decodeURIComponent(source[1]!),
          );
          if (!asset)
            throw new HttpError(
              404,
              "Source asset was not found in this project.",
              "media.notFound",
            );
          const issue = previewIssue(asset);
          if (issue)
            throw new HttpError(422, issue, "media.unsupported", {
              name: asset.name,
            });
          if (!asset.uri.startsWith("file:"))
            throw new HttpError(
              422,
              "Only imported local media can be previewed.",
            );
          const sourceExtension = extname(
            fileURLToPath(asset.uri),
          ).toLowerCase();
          const needsImagePreview =
            asset.mediaType === "image" &&
            (asset.hdr ||
              asset.codec === "hevc" ||
              ![".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"].includes(
                sourceExtension,
              ));
          if (needsImagePreview && !asset.thumbnailUri)
            throw new HttpError(
              422,
              "A compatible image preview is missing. Import this media again to rebuild its cached preview.",
              "media.previewUnavailable",
              { name: asset.name },
            );
          await trackedMediaRead(async (signal) => {
            const managed = ["video", "audio"].includes(asset.mediaType)
              ? await application.proxyCache
                  .acquirePreview(asset, signal)
                  .catch((error: unknown) => {
                    if (
                      !signal.aborted &&
                      ((error instanceof ApplicationError &&
                        error.status === 409 &&
                        [
                          "media.previewUnavailable",
                          "proxy.storageUnavailable",
                        ].includes(error.code)) ||
                        (error as NodeJS.ErrnoException).code === "ENOENT")
                    )
                      return undefined;
                    throw error;
                  })
              : undefined;
            try {
              const catalogProxy = asset.proxyUri;
              const catalogPreviewPath = catalogProxy
                ? catalogProxy.startsWith("file:")
                  ? fileURLToPath(catalogProxy)
                  : resolve(application.directory, catalogProxy)
                : undefined;
              const inManagedNamespace = (candidate: string) =>
                ["cache/proxies/managed", "cache/proxy-manager"].some(
                  (path) => {
                    const child = relative(
                      resolve(application.directory, path),
                      candidate,
                    );
                    return (
                      !child ||
                      (!isAbsolute(child) &&
                        child !== ".." &&
                        !child.startsWith(
                          `..${process.platform === "win32" ? "\\" : "/"}`,
                        ))
                    );
                  },
                );
              let managedNamespace =
                !!catalogPreviewPath && inManagedNamespace(catalogPreviewPath);
              if (
                !managed &&
                catalogPreviewPath &&
                !managedNamespace &&
                ["video", "audio"].includes(asset.mediaType)
              ) {
                try {
                  const info = await lstat(catalogPreviewPath);
                  // Legacy aliases must not bypass managed verification or read leases.
                  managedNamespace =
                    !info.isFile() ||
                    info.nlink !== 1 ||
                    inManagedNamespace(await realpath(catalogPreviewPath));
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                    throw error;
                }
              }
              const derivedUri = needsImagePreview
                ? asset.thumbnailUri
                : ["video", "audio"].includes(asset.mediaType)
                  ? (managed?.uri ??
                    (managedNamespace ? undefined : catalogProxy))
                  : undefined;
              const useProxy = !!derivedUri;
              const file = derivedUri
                ? derivedUri.startsWith("file:")
                  ? fileURLToPath(derivedUri)
                  : resolve(application.directory, derivedUri)
                : fileURLToPath(asset.uri);
              if (!useProxy && (asset.hdr || asset.codec === "hevc"))
                throw new HttpError(
                  422,
                  "A compatible preview proxy is required for this HDR/HEVC source. Import it again with proxies enabled.",
                  "media.previewUnavailable",
                  { name: asset.name },
                );
              const mime = (
                {
                  ".jpg": "image/jpeg",
                  ".jpeg": "image/jpeg",
                  ".png": "image/png",
                  ".webp": "image/webp",
                  ".gif": "image/gif",
                  ".bmp": "image/bmp",
                  ".mp4": "video/mp4",
                  ".m4v": "video/mp4",
                  ".mov": "video/quicktime",
                  ".webm": "video/webm",
                  ".mp3": "audio/mpeg",
                  ".wav": "audio/wav",
                  ".m4a": "audio/mp4",
                  ".ogg": "audio/ogg",
                  ".opus": "audio/ogg",
                  ".flac": "audio/flac",
                  ".aac": "audio/aac",
                } as Record<string, string>
              )[extname(file).toLowerCase()];
              if (!mime)
                throw new HttpError(
                  422,
                  "This source format needs a compatible preview. Import it again with proxies enabled, or add a JPEG, MP4 or MP3 copy.",
                );
              response.setHeader(
                "X-OpenFilm-Preview",
                managed ? "managed" : useProxy ? "legacy" : "original",
              );
              try {
                // The path comes exclusively from this project's catalog, never a request path.
                await streamFile(
                  request,
                  response,
                  file,
                  useProxy
                    ? resolve(application.directory, "cache")
                    : dirname(file),
                  mime,
                );
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT")
                  throw new HttpError(
                    404,
                    useProxy
                      ? "Preview proxy missing: import this media again to rebuild its cached preview."
                      : "Missing Media: reconnect the disk or relink this source.",
                    useProxy ? "media.previewUnavailable" : "media.missing",
                    { name: asset.name },
                  );
                throw error;
              }
            } finally {
              managed?.release();
            }
          });
          return;
        }
        const graphicPreview =
          /^\/api\/compositions\/([^/]+)\/graphics\.png$/.exec(route);
        if (method === "GET" && graphicPreview) {
          const frame = url.searchParams.get("frame") ?? "";
          if (!/^\d{1,10}$/u.test(frame))
            throw new HttpError(400, "Invalid graphic frame.");
          const controller = new AbortController();
          const abort = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once("close", abort);
          try {
            const png = await application.graphics.frame(
              decodeURIComponent(graphicPreview[1]!),
              {
                projectId: url.searchParams.get("projectId") ?? "",
                baseRevision: url.searchParams.get("revision") ?? "",
                frameIndex: Number(frame),
                signal: controller.signal,
              },
            );
            if (app !== application)
              throw new HttpError(409, "Graphic project changed.");
            response.writeHead(200, {
              "Content-Type": "image/png",
              "Content-Length": png.length,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            response.end(png);
          } finally {
            response.off("close", abort);
          }
          return;
        }
        if (method === "GET" && route === "/api/motion-generation/providers") {
          json(response, 200, application.motionGeneration.list());
          return;
        }
        const motionPreview =
          /^\/api\/compositions\/([^/]+)\/motion-generation$/.exec(route);
        if (method === "POST" && motionPreview) {
          const data = await body(request);
          keys(data, [
            "requestId",
            "projectId",
            "baseRevision",
            "clipId",
            "sceneId",
            "providerId",
            "count",
            "candidateAssetIds",
            "prompt",
            "negativeConstraints",
            "consent",
            "containsPeople",
          ]);
          const requestId = text(data, "requestId");
          if (
            hasActiveProjectWork() &&
            !application.motionGeneration.hasRequest(requestId)
          )
            throw new HttpError(409, "Wait for the active project job.");
          if (data.count !== undefined && typeof data.count !== "number")
            throw new HttpError(400, "Invalid motion candidate count.");
          if (
            data.candidateAssetIds !== undefined &&
            (!Array.isArray(data.candidateAssetIds) ||
              data.candidateAssetIds.length > 3 ||
              data.candidateAssetIds.some(
                (id) => typeof id !== "string" || !id || id.length > 256,
              ))
          )
            throw new HttpError(400, "Invalid local candidate selection.");
          if (
            typeof data.containsPeople !== "boolean" ||
            (data.sceneId !== undefined &&
              data.sceneId !== null &&
              (typeof data.sceneId !== "string" ||
                !data.sceneId ||
                data.sceneId.length > 256))
          )
            throw new HttpError(
              400,
              "Explicit subject and valid scene selection required.",
            );
          const input: import("@openfilm/application").MotionRequest = {
            projectId: text(data, "projectId"),
            requestId,
            compositionId: decodeURIComponent(motionPreview[1]!),
            baseRevision: text(data, "baseRevision"),
            clipId: text(data, "clipId"),
            providerId: text(data, "providerId"),
            ...(data.sceneId !== undefined
              ? { sceneId: data.sceneId as string | null }
              : {}),
            ...(data.count !== undefined
              ? { count: data.count as number }
              : {}),
            ...(data.candidateAssetIds !== undefined
              ? { candidateAssetIds: data.candidateAssetIds as string[] }
              : {}),
            prompt: text(data, "prompt"),
            negativeConstraints: text(data, "negativeConstraints"),
            consent: data.consent === true,
            containsPeople: data.containsPeople === true,
          };
          const controller = new AbortController(),
            jobId = `motion:${randomUUID()}`;
          let done!: () => void;
          const completed = new Promise<void>((resolve) => {
            done = resolve;
          });
          const disconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once("close", disconnected);
          if (response.destroyed || request.aborted) controller.abort();
          active.set(jobId, controller);
          tasks.add(completed);
          releaseMutation?.();
          releaseMutation = undefined;
          try {
            const receipts = await application.runMotionGeneration(
              input,
              controller.signal,
            );
            await acquireMutation();
            if (controller.signal.aborted || app !== application) {
              await application.motionGeneration.revoke(requestId);
              throw new HttpError(409, "Motion owner changed or cancelled.");
            }
            json(response, 200, receipts);
          } finally {
            response.off("close", disconnected);
            active.delete(jobId);
            done();
            tasks.delete(completed);
          }
          return;
        }
        if (method === "POST" && route === "/api/motion-generation/clear") {
          const data = await body(request);
          keys(data, ["projectId"]);
          if (text(data, "projectId") !== application.project.id)
            throw new HttpError(409, "Motion project changed.");
          await application.motionGeneration.clearPreviews();
          json(response, 200, { ok: true });
          return;
        }
        const motionRevoke =
          /^\/api\/motion-generation\/requests\/([a-f0-9-]{36})\/revoke$/.exec(
            route,
          );
        if (method === "POST" && motionRevoke) {
          const data = await body(request);
          keys(data, ["projectId"]);
          if (text(data, "projectId") !== application.project.id)
            throw new HttpError(409, "Motion project changed.");
          await application.motionGeneration.revoke(motionRevoke[1]!);
          json(response, 200, { ok: true });
          return;
        }
        const motionAction =
          /^\/api\/motion-generation\/([a-f0-9-]{36})\/(receipt|media|accept|import|restore)$/.exec(
            route,
          );
        if (motionAction) {
          const id = motionAction[1]!,
            action = motionAction[2]!;
          if (method === "GET" && ["receipt", "media"].includes(action)) {
            if (url.searchParams.get("projectId") !== application.project.id)
              throw new HttpError(409, "Motion project changed.");
            if (action === "receipt")
              json(
                response,
                200,
                await application.motionGeneration.receipt(id),
              );
            else
              await streamFile(
                request,
                response,
                await application.motionGeneration.media(id),
                join(application.directory, "cache"),
                "video/mp4",
              );
            return;
          }
          if (
            method === "POST" &&
            ["accept", "import", "restore"].includes(action)
          ) {
            const data = await body(request);
            keys(
              data,
              action === "accept" ? ["projectId", "reviewed"] : ["projectId"],
            );
            if (text(data, "projectId") !== application.project.id)
              throw new HttpError(409, "Motion project changed.");
            if (hasActiveProjectWork())
              throw new HttpError(409, "Wait for the active project job.");
            if (action === "accept")
              json(
                response,
                200,
                await application.motionGeneration.accept(
                  id,
                  data.reviewed === true,
                ),
              );
            else {
              const state =
                action === "import"
                  ? await application.motionGeneration.importCandidate(
                      id,
                      editorFor(application),
                    )
                  : await application.motionGeneration.restore(
                      id,
                      editorFor(application),
                    );
              json(response, 200, {
                revision: state.revision,
                receipt: await application.motionGeneration.receipt(id),
              });
            }
            return;
          }
        }
        if (method === "GET" && route === "/api/audio-generation/providers") {
          json(response, 200, application.audioGeneration.list());
          return;
        }
        const generationMatch =
          /^\/api\/compositions\/([^/]+)\/audio-generation$/.exec(route);
        if (method === "POST" && generationMatch) {
          if (hasActiveProjectWork())
            throw new HttpError(409, "Wait for the active project job.");
          const data = await body(request);
          keys(data, [
            "baseRevision",
            "providerId",
            "text",
            "consent",
            "acknowledgeUnknownCost",
          ]);
          const compositionId = decodeURIComponent(generationMatch[1]!);
          const revision = text(data, "baseRevision");
          const input = {
            compositionId,
            baseRevision: revision,
            providerId: text(data, "providerId"),
            text: text(data, "text"),
            consent: data.consent === true,
            acknowledgeUnknownCost: data.acknowledgeUnknownCost === true,
          };
          const controller = new AbortController();
          const jobId = randomUUID();
          const disconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once("close", disconnected);
          active.set(jobId, controller);
          releaseMutation?.();
          releaseMutation = undefined;
          try {
            const receipt = await application.runAudioGeneration(
              input,
              controller.signal,
            );
            await acquireMutation();
            if (
              controller.signal.aborted ||
              app !== application ||
              editorFor(application).get(compositionId).revision !== revision
            )
              throw new HttpError(
                409,
                "Generated audio is stale or cancelled.",
              );
            json(response, 200, receipt);
          } finally {
            active.delete(jobId);
            response.off("close", disconnected);
          }
          return;
        }
        const generationAction =
          /^\/api\/audio-generation\/([a-f0-9-]{36})\/(media|accept|import)$/.exec(
            route,
          );
        if (generationAction) {
          const id = generationAction[1]!;
          const action = generationAction[2]!;
          if (method === "GET" && action === "media") {
            if (url.searchParams.get("projectId") !== application.project.id)
              throw new HttpError(
                409,
                "Generated audio belongs to another project.",
              );
            const path = await application.audioGeneration.media(id);
            await streamFile(
              request,
              response,
              path,
              join(application.directory, "cache"),
              "audio/wav",
            );
            return;
          }
          if (method === "POST" && action !== "media") {
            const data = await body(request);
            keys(
              data,
              action === "import"
                ? ["projectId", "timelineStart"]
                : ["projectId"],
            );
            if (text(data, "projectId") !== application.project.id)
              throw new HttpError(
                409,
                "Generated audio belongs to another project.",
              );
            json(
              response,
              200,
              action === "accept"
                ? await application.audioGeneration.accept(id)
                : await application.audioGeneration.importTimeline(
                    id,
                    Number(data.timelineStart),
                    editorFor(application),
                  ),
            );
            return;
          }
        }
        const audioQualityMatch =
          /^\/api\/compositions\/([^/]+)\/audio-quality$/.exec(route);
        if (method === "POST" && audioQualityMatch) {
          if (hasActiveProjectWork())
            throw new HttpError(409, "Wait for the active project job.");
          const data = await body(request);
          keys(data, ["clipId", "baseRevision"]);
          const compositionId = decodeURIComponent(audioQualityMatch[1]!);
          const clipId = text(data, "clipId");
          const revision = text(data, "baseRevision");
          const controller = new AbortController();
          const jobId = randomUUID();
          active.set(jobId, controller);
          const disconnected = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once("close", disconnected);
          releaseMutation?.();
          releaseMutation = undefined;
          try {
            const report = await application.runAudioQuality(
              compositionId,
              clipId,
              revision,
              controller.signal,
            );
            await acquireMutation();
            if (
              controller.signal.aborted ||
              app !== application ||
              editorFor(application).get(compositionId).revision !== revision
            )
              throw new HttpError(409, "Audio review is stale or cancelled.");
            json(response, 200, report);
          } finally {
            active.delete(jobId);
            response.off("close", disconnected);
          }
          return;
        }
        const audioReviewMedia =
          /^\/api\/audio-quality\/([a-f0-9-]{36})\/(original|candidate)$/.exec(
            route,
          );
        if (method === "GET" && audioReviewMedia) {
          if (url.searchParams.get("projectId") !== application.project.id)
            throw new HttpError(
              409,
              "Audio review belongs to another project.",
            );
          const path = await application.audioQuality.media(
            audioReviewMedia[1]!,
            audioReviewMedia[2] as "original" | "candidate",
          );
          await streamFile(
            request,
            response,
            path,
            join(application.directory, "cache"),
            "video/mp4",
          );
          return;
        }
        const titlePreview =
          /^\/api\/compositions\/([^/]+)\/title\/([^/]+)\.png$/.exec(route);
        if (method === "GET" && titlePreview) {
          const compositionId = decodeURIComponent(titlePreview[1]!);
          const clipId = decodeURIComponent(titlePreview[2]!);
          if (url.searchParams.get("projectId") !== application.project.id)
            throw new HttpError(409, "This title belongs to another project.");
          const state = editorFor(application).get(compositionId);
          if (url.searchParams.get("revision") !== state.revision)
            throw new HttpError(
              409,
              "This title preview is stale. Wait for the current edit to save.",
            );
          const path = await application.titleOverlay(compositionId, clipId);
          await streamFile(
            request,
            response,
            path,
            join(application.directory, "cache"),
            "image/png",
          );
          return;
        }
        const editorMatch =
          /^\/api\/compositions\/([^/]+)\/(editor|edit|undo|redo)$/.exec(route);
        if (editorMatch) {
          const compositionId = decodeURIComponent(editorMatch[1]!);
          const action = editorMatch[2];
          const editor = editorFor(application);
          if (method === "GET" && action === "editor") {
            json(response, 200, editor.get(compositionId));
            return;
          }
          if (method === "POST" && action !== "editor") {
            const data = await body(request);
            const state =
              action === "edit"
                ? await editor.edit(
                    compositionId,
                    data as unknown as TimelineEditInput,
                  )
                : action === "undo"
                  ? await editor.undo(compositionId, text(data, "baseRevision"))
                  : await editor.redo(
                      compositionId,
                      text(data, "baseRevision"),
                    );
            json(response, 200, state);
            return;
          }
        }
        const directionMatch =
          /^\/api\/compositions\/([^/]+)\/direction\/(preview|accept)$/.exec(
            route,
          );
        if (method === "POST" && directionMatch) {
          errorContext = "story.invalid";
          const compositionId = decodeURIComponent(directionMatch[1]!);
          const data = await body(request);
          const editor = editorFor(application);
          json(
            response,
            200,
            directionMatch[2] === "preview"
              ? editor.previewDirection(
                  compositionId,
                  data as unknown as Parameters<
                    TimelineEditor["previewDirection"]
                  >[1],
                )
              : await editor.acceptDirection(
                  compositionId,
                  data as unknown as DirectionReviewAcceptance,
                ),
          );
          return;
        }
        const graphicAgentMatch =
          /^\/api\/compositions\/([^/]+)\/graphic-agent\/(preview|accept)$/.exec(
            route,
          );
        if (method === "POST" && graphicAgentMatch) {
          errorContext = "review.invalidOutput";
          const compositionId = decodeURIComponent(graphicAgentMatch[1]!);
          const data = await body(request);
          const editor = editorFor(application);
          if (graphicAgentMatch[2] === "preview") {
            const projectId = application.project.id;
            const controller = new AbortController();
            let timedOut = false;
            let timeout: ReturnType<typeof setTimeout> | undefined;
            const disconnected = () => {
              if (!response.writableEnded) controller.abort();
            };
            graphicSceneAgentPreviews.add(controller);
            response.once("close", disconnected);
            if (data.mode === "provider")
              timeout = setTimeout(() => {
                timedOut = true;
                controller.abort();
              }, graphicSceneAgentProviderTimeoutMs);
            try {
              const plan = await editor.previewGraphicSceneAgent(
                compositionId,
                data as unknown as Parameters<
                  TimelineEditor["previewGraphicSceneAgent"]
                >[1],
                controller.signal,
              );
              if (controller.signal.aborted) {
                if (timedOut)
                  throw new HttpError(
                    503,
                    "The language provider did not respond before the preview deadline.",
                    "review.providerUnavailable",
                  );
                throw new TimelineEditorError(
                  "GraphicScene preview was cancelled or its project changed.",
                  409,
                );
              }
              // Re-enter the short mutation critical section only after provider
              // work is done, so stale state is checked against every completed
              // edit without holding the queue during network I/O.
              await acquireMutation();
              if (controller.signal.aborted) {
                if (timedOut)
                  throw new HttpError(
                    503,
                    "The language provider did not respond before the preview deadline.",
                    "review.providerUnavailable",
                  );
                throw new TimelineEditorError(
                  "GraphicScene preview was cancelled or its project changed.",
                  409,
                );
              }
              if (closing)
                throw new HttpError(
                  503,
                  "The local service is closing.",
                  "workspace.closing",
                );
              if (app !== application || app?.project.id !== projectId)
                throw new TimelineEditorError(
                  "The active project changed while preparing this GraphicScene proposal.",
                  409,
                );
              if (editor.get(compositionId).revision !== plan.baseRevision)
                throw new TimelineEditorError(
                  "The Composition changed while preparing this GraphicScene proposal.",
                  409,
                );
              json(response, 200, plan);
            } catch (error) {
              if (timedOut)
                throw new HttpError(
                  503,
                  "The language provider did not respond before the preview deadline.",
                  "review.providerUnavailable",
                );
              if (controller.signal.aborted && !response.destroyed)
                throw new TimelineEditorError(
                  "GraphicScene preview was cancelled or its project changed.",
                  409,
                );
              throw error;
            } finally {
              if (timeout) clearTimeout(timeout);
              response.off("close", disconnected);
              graphicSceneAgentPreviews.delete(controller);
            }
          } else {
            json(
              response,
              200,
              await editor.acceptGraphicSceneAgent(
                compositionId,
                data as unknown as GraphicSceneAgentAcceptance,
              ),
            );
          }
          return;
        }
        const thumbnail = /^\/api\/thumbnail\/([^/]+)$/.exec(route);
        if (method === "GET" && thumbnail) {
          const asset = application.catalog.getAsset(
            decodeURIComponent(thumbnail[1]!),
          );
          if (!asset?.thumbnailUri)
            throw new HttpError(404, "Thumbnail is not available yet.");
          const file = asset.thumbnailUri.startsWith("file:")
            ? fileURLToPath(asset.thumbnailUri)
            : resolve(application.directory, asset.thumbnailUri);
          await streamFile(
            request,
            response,
            file,
            resolve(application.directory, "cache"),
            "image/jpeg",
          );
          return;
        }
        if (method === "GET" && route === "/api/jobs") {
          const jobs = application.catalog.listJobs();
          const analysisRecovery = Object.fromEntries(
            Object.entries(
              application.intelligence.analysisRecoveryStatuses(jobs),
            ).map(([jobId, recovery]) => [
              jobId,
              {
                ...recovery,
                // Liveness never implies this server owns the cancellation signal.
                canCancel: active.has(jobId),
              },
            ]),
          );
          json(response, 200, { jobs, analysisRecovery });
          return;
        }
        if (method === "POST" && route === "/api/import/upload") {
          errorContext = "import.failed";
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for running jobs before adding files.",
            );
          const name = url.searchParams.get("name") ?? "";
          if (!safeFilename(name))
            throw new HttpError(
              400,
              "Choose a file name without path components.",
            );
          if (!isSupportedMediaFile(name))
            throw new HttpError(
              415,
              `Unsupported media file: ${name}`,
              "media.unsupported",
              { name },
            );
          if (
            !request.headers["content-type"]?.startsWith(
              "application/octet-stream",
            )
          )
            throw new HttpError(
              415,
              "Upload media using application/octet-stream.",
            );
          const declared = Number(request.headers["content-length"]);
          if (Number.isFinite(declared) && declared > maxUploadBytes)
            throw new HttpError(
              413,
              `Media exceeds the ${maxUploadBytes} byte upload limit.`,
            );
          const uploadId = randomUUID();
          const sources = join(application.directory, "sources");
          await mkdir(sources, { recursive: true });
          const rootInfo = await lstat(sources);
          if (
            !rootInfo.isDirectory() ||
            rootInfo.isSymbolicLink() ||
            (await realpath(sources)) !== resolve(sources)
          )
            throw new HttpError(
              403,
              "Managed sources must be inside this project.",
            );
          const directory = join(sources, uploadId);
          await mkdir(directory);
          const temporary = join(directory, ".upload-partial");
          const destination = join(directory, name);
          const controller = new AbortController();
          active.set(uploadId, controller);
          const abort = () => request.destroy();
          controller.signal.addEventListener("abort", abort, { once: true });
          let size = 0;
          try {
            const file = await open(temporary, "wx", 0o600);
            try {
              for await (const chunk of request.iterator({
                destroyOnReturn: false,
              })) {
                const bytes = Buffer.isBuffer(chunk)
                  ? chunk
                  : Buffer.from(chunk);
                size += bytes.length;
                if (size > maxUploadBytes)
                  throw new HttpError(
                    413,
                    `Media exceeds the ${maxUploadBytes} byte upload limit.`,
                  );
                await file.writeFile(bytes);
              }
              if (!size)
                throw new HttpError(400, "The uploaded file is empty.");
              await file.sync();
            } finally {
              await file.close();
            }
            await rename(temporary, destination);
            uploads.set(uploadId, {
              project: application,
              path: destination,
              directory,
            });
            json(response, 201, { uploadId });
          } catch (error) {
            await rm(directory, { recursive: true, force: true });
            request.resume();
            throw error;
          } finally {
            controller.signal.removeEventListener("abort", abort);
            active.delete(uploadId);
          }
          return;
        }
        if (method === "POST" && route === "/api/import/uploads/discard") {
          const data = await body(request);
          const selected = paths(data, "uploads");
          for (const id of selected) {
            const upload = uploads.get(id);
            if (upload?.project === application) {
              await rm(upload.directory, { recursive: true, force: true });
              uploads.delete(id);
            }
          }
          json(response, 200, { ok: true });
          return;
        }
        if (method === "POST" && route === "/api/import") {
          errorContext = "import.failed";
          const data = await body(request);
          if (
            ["folder", "files", "uploads"].filter(
              (key) => data[key] !== undefined,
            ).length !== 1
          )
            throw new HttpError(
              400,
              "Choose a folder, selected files, or completed uploads.",
            );
          const folder =
            data.folder === undefined
              ? undefined
              : resolve(filePath(data, "folder"));
          const files =
            data.files === undefined ? undefined : paths(data, "files");
          const uploaded =
            data.uploads === undefined
              ? undefined
              : paths(data, "uploads").map((id) => {
                  const upload = uploads.get(id);
                  if (!upload || upload.project !== application)
                    throw new HttpError(
                      400,
                      "This upload no longer belongs to the current project.",
                    );
                  return { id, ...upload };
                });
          if (hasActiveProjectWork())
            throw new HttpError(409, "An import is already running.");
          const controller = new AbortController();
          const placeholderId = randomUUID();
          const initial: Job = {
            id: placeholderId,
            type: "import",
            status: "queued",
            progress: 0,
          };
          application.catalog.saveJob(initial);
          active.set(placeholderId, controller);
          const importOptions = {
            signal: controller.signal,
            jobId: placeholderId,
          };
          const task = uploaded
            ? application.importManagedSources(
                uploaded.map((upload) => upload.path),
                importOptions,
              )
            : files
              ? application.importFiles(files, importOptions)
              : application.importFolder(folder!, importOptions);
          for (const upload of uploaded ?? []) uploads.delete(upload.id);
          const handled = task
            .finally(async () => {
              // Receipts are consumed once, but their managed files remain this
              // job's responsibility until all import workers have settled.
              for (const upload of uploaded ?? []) {
                if (
                  !application.catalog.getAssetByUri(
                    pathToFileURL(upload.path).href,
                  )
                )
                  await rm(upload.directory, { recursive: true, force: true });
              }
            })
            .catch((error: unknown) => {
              application.catalog.saveJob({
                id: placeholderId,
                type: "import",
                status: controller.signal.aborted ? "cancelled" : "failed",
                errors: [
                  {
                    uri: folder ?? "Selected files",
                    stage: "discover",
                    message:
                      error instanceof Error ? error.message : String(error),
                    ...errorInfo(error, "import.failed"),
                  },
                ],
              });
            })
            .finally(() => {
              active.delete(placeholderId);
              tasks.delete(handled);
            });
          tasks.add(handled);
          json(response, 202, { jobId: placeholderId });
          return;
        }
        const cancel = /^\/api\/jobs\/([^/]+)\/cancel$/.exec(route);
        if (method === "POST" && cancel) {
          const controller = active.get(decodeURIComponent(cancel[1]!));
          if (!controller) {
            const job = application.catalog
              .listJobs()
              .find(({ id }) => id === decodeURIComponent(cancel[1]!));
            if (job?.type === "proxy") {
              application.proxyCache.cancel({
                projectId: application.project.id,
                jobIds: [job.id],
              });
              json(response, 200, { ok: true });
              return;
            }
            if (job?.attempt?.operationKind === "analysis-run") {
              application.sourceAnalysis.cancelRun({
                projectId: application.project.id,
                runId: job.attempt.operationId,
              });
              json(response, 200, { ok: true });
              return;
            }
            throw new HttpError(
              409,
              "This job is no longer running.",
              "jobs.notRunning",
            );
          }
          controller.abort();
          json(response, 200, { ok: true });
          return;
        }
        if (method === "POST" && route === "/api/visual-qa") {
          if (hasActiveProjectWork())
            throw new HttpError(
              409,
              "Wait for the active project job before starting Visual QA.",
            );
          const data = await body(request);
          keys(data, ["compositionId"]);
          if (
            data.compositionId !== undefined &&
            (typeof data.compositionId !== "string" ||
              !data.compositionId.trim())
          )
            throw new HttpError(400, "Choose a saved Composition.");
          const application = current();
          const jobId = randomUUID();
          const controller = new AbortController();
          application.catalog.saveJob({
            id: jobId,
            type: "visual-qa",
            status: "queued",
            progress: 0,
            createdAt: new Date().toISOString(),
          });
          active.set(jobId, controller);
          const operation = application.runVisualQa(
            data.compositionId as string | undefined,
            { jobId, signal: controller.signal },
          );
          const handled = operation
            .catch((error: unknown) => {
              const job = application.catalog
                .listJobs()
                .find((item) => item.id === jobId);
              if (job && (job.status === "queued" || job.status === "running"))
                application.catalog.saveJob({
                  ...job,
                  status: controller.signal.aborted ? "cancelled" : "failed",
                  updatedAt: new Date().toISOString(),
                  errors: [
                    {
                      uri: "",
                      stage: "visual-qa",
                      message:
                        "Visual QA could not complete. Retry this saved edit.",
                      ...errorInfo(error, "render.failed"),
                    },
                  ],
                });
            })
            .finally(() => {
              active.delete(jobId);
              tasks.delete(handled);
            });
          tasks.add(handled);
          json(response, 202, { jobId });
          return;
        }
        const visualQa =
          /^\/api\/visual-qa\/([a-f\d-]{36})(?:\/frames\/(\d+))?$/iu.exec(
            route,
          );
        if (method === "GET" && visualQa) {
          const application = current();
          const reportId = visualQa[1]!;
          const job = application.catalog
            .listJobs()
            .find((item) => item.id === reportId && item.type === "visual-qa");
          if (!job)
            throw new HttpError(404, "Visual QA report is unavailable.");
          if (visualQa[2] !== undefined) {
            const framePath = await application.visualQaFramePath(
              reportId,
              Number(visualQa[2]),
            );
            if (!framePath)
              throw new HttpError(404, "Visual QA frame is unavailable.");
            await streamFile(
              request,
              response,
              framePath,
              resolve(application.directory, "cache"),
              "image/png",
            );
            return;
          }
          json(response, 200, {
            job,
            active: active.has(reportId),
            report: await application.readVisualQaReport(reportId),
          });
          return;
        }
        if (method === "POST" && route === "/api/analyze") {
          json(response, 200, application.analyze());
          return;
        }
        if (method === "POST" && route === "/api/story-plans/preview") {
          errorContext = "story.invalid";
          const data = await body(request);
          json(response, 200, {
            plan: application.previewScenePlan(
              data as unknown as ScenePlanOptions,
            ),
          });
          return;
        }
        if (method === "POST" && route === "/api/story-plans/accept") {
          errorContext = "story.invalid";
          // Thirty authored scenes and 2000 candidates can exceed the ordinary
          // form cap even without the informational composition in the request.
          const data = await body(request, 16 * 1024 * 1024);
          json(
            response,
            201,
            application.acceptScenePlan(data.plan as ScenePlanAcceptance),
          );
          return;
        }
        if (method === "POST" && route === "/api/stories") {
          errorContext = "story.invalid";
          const data = await body(request);
          if (
            data.assetIds !== undefined &&
            (!Array.isArray(data.assetIds) ||
              data.assetIds.some((id) => typeof id !== "string"))
          )
            throw new HttpError(400, "Story scope must contain media IDs.");
          if (
            data.customOutline !== undefined &&
            (!Array.isArray(data.customOutline) ||
              data.customOutline.some((heading) => typeof heading !== "string"))
          )
            throw new HttpError(
              400,
              "A custom story outline must contain text headings.",
            );
          const story = application.generateStory({
            title: typeof data.title === "string" ? data.title : undefined,
            template:
              typeof data.template === "string" ? data.template : undefined,
            targetDuration: number(data.targetDuration, "targetDuration"),
            maxDuration: number(data.maxDuration, "maxDuration"),
            assetIds: data.assetIds as string[] | undefined,
            customOutline: data.customOutline as string[] | undefined,
          });
          json(response, 201, { story });
          return;
        }
        const storyMatch = /^\/api\/stories\/([^/]+)$/.exec(route);
        const storyGraphMatch = /^\/api\/stories\/([^/]+)\/graph$/.exec(route);
        if (storyGraphMatch) {
          const storyId = decodeURIComponent(storyGraphMatch[1]!);
          if (method === "GET") {
            const graph = application.storyGraph.getGraph(storyId);
            json(response, 200, { graph });
            return;
          }
          if (method === "PUT") {
            const data = await body(request, 16 * 1024 * 1024);
            const graph = await application.storyGraph.updateGraph(
              storyId,
              data,
            );
            json(response, 200, { graph });
            return;
          }
        }
        const storyGraphViewMatch =
          /^\/api\/stories\/([^/]+)\/graph-view$/.exec(route);
        if (storyGraphViewMatch) {
          const storyId = decodeURIComponent(storyGraphViewMatch[1]!);
          if (method === "GET") {
            const viewState = application.storyGraph.getViewState(storyId);
            json(response, 200, { viewState });
            return;
          }
          if (method === "PUT") {
            const data = await body(request, 16 * 1024 * 1024);
            const viewState = application.storyGraph.updateViewState(
              storyId,
              data,
            );
            json(response, 200, { viewState });
            return;
          }
        }
        const storyGraphQuickActionMatch =
          /^\/api\/stories\/([^/]+)\/graph\/quick-action$/.exec(route);
        if (method === "POST" && storyGraphQuickActionMatch) {
          const storyId = decodeURIComponent(storyGraphQuickActionMatch[1]!);
          const data = await body(request);
          const action = String(data.action);
          if (action === "add-asset") {
            const result = await application.storyGraph.addAssetToBeat(
              storyId,
              String(data.beatId),
              String(data.assetId),
            );
            json(response, 200, result);
            return;
          }
          if (action === "create-echo") {
            const graph = await application.storyGraph.createEcho(
              storyId,
              String(data.fromNodeId),
              String(data.toNodeId),
            );
            json(response, 200, { graph });
            return;
          }
          if (action === "set-next-beat") {
            const result = await application.storyGraph.setNextBeat(
              storyId,
              String(data.currentBeatId),
              String(data.targetBeatId),
            );
            json(response, 200, result);
            return;
          }
          if (action === "connect-nodes") {
            const result = await application.storyGraph.connectNodes(
              storyId,
              String(data.fromNodeId),
              String(data.toNodeId),
              String(data.type) as import("@openfilm/core").StoryGraphEdgeType,
            );
            json(response, 200, result);
            return;
          }
          if (action === "remove-node") {
            const graph = await application.storyGraph.removeNode(
              storyId,
              String(data.nodeId),
            );
            json(response, 200, { graph });
            return;
          }
          if (action === "remove-edge") {
            const graph = await application.storyGraph.removeEdge(
              storyId,
              String(data.edgeId),
            );
            json(response, 200, { graph });
            return;
          }
          throw new HttpError(
            400,
            `Unknown story graph quick action '${action}'.`,
          );
        }
        const storyPlanPreviewMatch =
          /^\/api\/stories\/([^/]+)\/plan\/preview$/.exec(route);
        if (method === "POST" && storyPlanPreviewMatch) {
          const storyId = decodeURIComponent(storyPlanPreviewMatch[1]!);
          const data = await body(request, 16 * 1024 * 1024);
          const result = application.storyPlan.previewPlan(
            storyId,
            data as Record<string, unknown>,
          );
          json(response, 200, result);
          return;
        }
        const storyPlanAcceptMatch =
          /^\/api\/stories\/([^/]+)\/plan\/accept$/.exec(route);
        if (method === "POST" && storyPlanAcceptMatch) {
          const storyId = decodeURIComponent(storyPlanAcceptMatch[1]!);
          const data = await body(request, 16 * 1024 * 1024);
          const result = application.storyPlan.acceptPlan(
            storyId,
            data as unknown as import("@openfilm/core").StoryPlan,
          );
          json(response, 200, result);
          return;
        }
        if (method === "GET" && route === "/api/pipelines/recipes") {
          json(response, 200, { recipes: application.pipeline.listRecipes() });
          return;
        }
        const recipeMatch = /^\/api\/pipelines\/recipes\/([^/]+)$/.exec(route);
        if (method === "GET" && recipeMatch) {
          const recipeId = decodeURIComponent(recipeMatch[1]!);
          json(response, 200, {
            recipe: application.pipeline.getRecipe(recipeId),
          });
          return;
        }
        if (method === "GET" && route === "/api/pipelines/runs") {
          json(response, 200, { runs: application.pipeline.listRuns() });
          return;
        }
        if (method === "POST" && route === "/api/pipelines/analyze-impact") {
          const data = (await body(request)) as {
            recipeId?: string;
            options?: import("@openfilm/application").CreatePipelineRunOptions & {
              baseRunId?: string;
            };
          };
          const recipeId = data.recipeId ?? "guided-story-to-video";
          const report = await application.pipeline.analyzeChangeImpact(
            recipeId,
            data.options ?? {},
          );
          json(response, 200, { report });
          return;
        }
        if (method === "POST" && route === "/api/pipelines/runs/incremental") {
          const data = (await body(request)) as {
            recipeId?: string;
            options?: import("@openfilm/application").CreatePipelineRunOptions & {
              baseRunId?: string;
              impactReport?: import("@openfilm/core").PipelineChangeImpactReport;
            };
          };
          const recipeId = data.recipeId ?? "guided-story-to-video";
          const run = await application.pipeline.createIncrementalRun(
            recipeId,
            data.options ?? {},
          );
          json(response, 201, { run });
          return;
        }
        if (method === "POST" && route === "/api/pipelines/runs") {
          const data = (await body(request)) as {
            recipeId?: string;
            options?: import("@openfilm/application").CreatePipelineRunOptions;
          };
          const recipeId = data.recipeId ?? "guided-story-to-video";
          const run = await application.pipeline.createRun(
            recipeId,
            data.options ?? {},
          );
          json(response, 201, { run });
          return;
        }
        const runMatch = /^\/api\/pipelines\/runs\/([^/]+)$/.exec(route);
        if (method === "GET" && runMatch) {
          const runId = decodeURIComponent(runMatch[1]!);
          json(response, 200, { run: application.pipeline.getRun(runId) });
          return;
        }
        const runActionMatch =
          /^\/api\/pipelines\/runs\/([^/]+)\/(start|cancel|review|retry)$/.exec(
            route,
          );
        if (method === "POST" && runActionMatch) {
          const runId = decodeURIComponent(runActionMatch[1]!);
          const action = runActionMatch[2]!;
          if (action === "start") {
            const run = await application.pipeline.startRun(runId);
            json(response, 200, { run });
            return;
          }
          if (action === "cancel") {
            const run = await application.pipeline.cancelRun(runId);
            json(response, 200, { run });
            return;
          }
          if (action === "retry") {
            const run = await application.pipeline.retryRun(runId);
            json(response, 200, { run });
            return;
          }
          if (action === "review") {
            const data = (await body(request)) as {
              stepId: string;
              decision: "accepted" | "rejected" | "skipped";
              notes?: string;
              adjustedOutputs?: Record<string, unknown>;
            };
            const run = await application.pipeline.submitReview(
              runId,
              data.stepId,
              data.decision,
              { notes: data.notes, adjustedOutputs: data.adjustedOutputs },
            );
            json(response, 200, { run });
            return;
          }
        }
        // Creative Variants
        if (method === "GET" && route === "/api/creative-variants") {
          json(response, 200, {
            variants: await application.creativeVariants.listVariants(),
          });
          return;
        }
        if (
          method === "POST" &&
          route === "/api/creative-variants/preview-impact"
        ) {
          const data = (await body(
            request,
          )) as unknown as import("@openfilm/core").CreateVariantInput;
          const report =
            application.creativeVariants.previewVariantImpact(data);
          json(response, 200, { report });
          return;
        }
        if (method === "POST" && route === "/api/creative-variants") {
          const data = (await body(
            request,
          )) as unknown as import("@openfilm/core").CreateVariantInput;
          const variant =
            await application.creativeVariants.createVariant(data);
          json(response, 201, { variant });
          return;
        }
        if (method === "GET" && route === "/api/creative-variants/compare") {
          const variantA = url.searchParams.get("variantA") ?? "";
          const variantB = url.searchParams.get("variantB") ?? "";
          const comparison = await application.creativeVariants.compareVariants(
            variantA,
            variantB,
          );
          json(response, 200, { comparison });
          return;
        }
        const variantActionMatch =
          /^\/api\/creative-variants\/([^/]+)\/(adopt|restore)$/.exec(route);
        if (method === "POST" && variantActionMatch) {
          const variantId = decodeURIComponent(variantActionMatch[1]!);
          const action = variantActionMatch[2]!;
          if (action === "adopt") {
            const data = (await body(request).catch(() => ({}))) as {
              expectedRevision?: string;
            };
            const result = await application.creativeVariants.adoptVariant(
              variantId,
              data,
            );
            json(response, 200, result);
            return;
          }
          if (action === "restore") {
            const data = (await body(request)) as {
              checkpointVersionId: string;
            };
            const result = await application.creativeVariants.restoreBaseline(
              variantId,
              data.checkpointVersionId,
            );
            json(response, 200, result);
            return;
          }
        }
        const variantMatch = /^\/api\/creative-variants\/([^/]+)$/.exec(route);
        if (method === "GET" && variantMatch) {
          const variantId = decodeURIComponent(variantMatch[1]!);
          const variant =
            await application.creativeVariants.getVariant(variantId);
          json(response, 200, { variant });
          return;
        }
        if (method === "DELETE" && variantMatch) {
          const variantId = decodeURIComponent(variantMatch[1]!);
          await application.creativeVariants.deleteVariant(variantId);
          json(response, 200, { ok: true });
          return;
        }
        const suggestions =
          /^\/api\/stories\/([^/]+)\/beats\/([^/]+)\/suggestions$/.exec(route);
        if (method === "POST" && suggestions) {
          await body(request);
          json(response, 200, {
            story: application.refreshSuggestions(
              decodeURIComponent(suggestions[1]!),
              decodeURIComponent(suggestions[2]!),
            ),
          });
          return;
        }
        if (method === "PATCH" && storyMatch) {
          // Story editing sends the complete beat collection. Match scene-plan
          // acceptance so a valid maximum-size authored script remains editable.
          const data = await body(request, 16 * 1024 * 1024);
          const index = application.project.stories.findIndex(
            (story) => story.id === decodeURIComponent(storyMatch[1]!),
          );
          const existing = application.project.stories[index];
          if (!existing) throw new HttpError(404, "Story not found.");
          if (
            Object.keys(data).some(
              (key) =>
                ![
                  "title",
                  "targetDuration",
                  "maxDuration",
                  "beats",
                  "graph",
                ].includes(key),
            )
          )
            throw new HttpError(400, "Unsupported story edit.");
          const normalized = {
            ...data,
            ...(Array.isArray(data.beats)
              ? {
                  beats: data.beats.map((value: unknown) => {
                    if (
                      !value ||
                      typeof value !== "object" ||
                      Array.isArray(value)
                    )
                      return value;
                    const beat = { ...value } as Record<string, unknown>;
                    if (typeof beat.intent === "string" && !beat.intent.trim())
                      delete beat.intent;
                    return beat;
                  }),
                }
              : {}),
          };
          const edited = validateStory({ ...existing, ...normalized }) as Story;
          edited.beats = edited.beats.map((beat) =>
            preserveUserBeatText(
              existing.beats.find((previous) => previous.id === beat.id),
              beat,
            ),
          );
          for (const beat of edited.beats)
            for (const id of [
              ...(beat.candidateAssetIds ?? []),
              ...(beat.selectedAssetIds ?? []),
            ])
              if (!application.catalog.getAsset(id))
                throw new HttpError(
                  400,
                  `Story references unknown media ${id}.`,
                );
          const previousProject = application.project;
          const stories = previousProject.stories.map((story, position) =>
            position === index ? edited : story,
          );
          const candidate = validateProject({ ...previousProject, stories });
          application.project = candidate;
          try {
            await application.save();
          } catch (error) {
            application.project = previousProject;
            throw error;
          }
          json(response, 200, { story: edited });
          return;
        }
        if (method === "POST" && route === "/api/compose") {
          const data = await body(request);
          const composition = application.compose(
            typeof data.storyId === "string" ? data.storyId : undefined,
          );
          json(response, 200, { composition });
          return;
        }
        if (method === "POST" && route === "/api/export/frame-preview") {
          errorContext = "export.failed";
          const data = await body(request);
          keys(data, [
            "compositionId",
            "profile",
            "time",
            "lookOverride",
            "captionTrackId",
          ]);
          if (
            data.compositionId !== undefined &&
            (typeof data.compositionId !== "string" ||
              !data.compositionId.trim())
          )
            throw new HttpError(400, "Choose a saved Composition.");
          const profile = parseProfileForFormats(data.profile, ["mp4", "png"]);
          if (typeof data.time !== "number" || !Number.isFinite(data.time))
            throw new HttpError(400, "Choose a finite export preview time.");
          const selection = profileRenderSelection(data);
          const result = await runProfileExport(application, (signal) =>
            application.previewExportFrame({
              compositionId: data.compositionId as string | undefined,
              profile,
              time: data.time as number,
              ...selection,
              signal,
            }),
          );
          json(response, 200, result);
          return;
        }
        if (method === "POST" && route === "/api/export/still") {
          errorContext = "export.failed";
          const data = await body(request);
          keys(data, [
            "compositionId",
            "profile",
            "time",
            "requestId",
            "confirmCrop",
            "cropPreviewToken",
            "lookOverride",
            "captionTrackId",
          ]);
          if (
            data.compositionId !== undefined &&
            (typeof data.compositionId !== "string" ||
              !data.compositionId.trim())
          )
            throw new HttpError(400, "Choose a saved Composition.");
          const profile = parseProfileForFormats(data.profile, ["png"]);
          if (typeof data.time !== "number" || !Number.isFinite(data.time))
            throw new HttpError(400, "Choose a finite still frame time.");
          if (
            data.confirmCrop !== undefined &&
            typeof data.confirmCrop !== "boolean"
          )
            throw new HttpError(400, "Crop confirmation must be boolean.");
          if (profile.framing === "crop" && data.confirmCrop !== true)
            throw new HttpError(
              400,
              "Confirm the center crop after reviewing its export frame.",
            );
          if (
            data.cropPreviewToken !== undefined &&
            typeof data.cropPreviewToken !== "string"
          )
            throw new HttpError(400, "Choose a reviewed crop preview token.");
          const selection = profileRenderSelection(data);
          const result = await runProfileExport(application, (signal) =>
            application.exportStill({
              compositionId: data.compositionId as string | undefined,
              profile,
              time: data.time as number,
              requestId: text(data, "requestId"),
              confirmCrop: data.confirmCrop as boolean | undefined,
              cropPreviewToken: data.cropPreviewToken as string | undefined,
              ...selection,
              signal,
            }),
          );
          json(response, 200, { ...result, filename: basename(result.path) });
          return;
        }
        if (method === "POST" && route === "/api/export/audio") {
          errorContext = "export.failed";
          const data = await body(request);
          keys(data, ["compositionId", "profile", "requestId"]);
          if (
            data.compositionId !== undefined &&
            (typeof data.compositionId !== "string" ||
              !data.compositionId.trim())
          )
            throw new HttpError(400, "Choose a saved Composition.");
          const profile = parseProfileForFormats(data.profile, [
            "wav",
            "audio-stems",
          ]);
          const result = await runProfileExport(application, (signal) =>
            application.exportProfileAudio({
              compositionId: data.compositionId as string | undefined,
              profile,
              requestId: text(data, "requestId"),
              signal,
            }),
          );
          json(response, 200, result);
          return;
        }
        if (
          method === "POST" &&
          (route === "/api/render" || route === "/api/export")
        ) {
          const data = await body(request);
          const exporting = route === "/api/export";
          errorContext = exporting ? "export.failed" : "render.failed";
          const hasQuality = Object.hasOwn(data, "quality");
          if (hasQuality && exporting && data.format !== "mp4")
            throw new ApplicationError(
              "request.invalid",
              "Compression quality applies to MP4 output only.",
            );
          const quality = hasQuality
            ? resolveRenderQuality(data.quality).quality
            : undefined;
          const hasExportProfile = Object.hasOwn(data, "exportProfile");
          let exportProfile:
            ReturnType<typeof validateExportProfile> | undefined;
          if (hasExportProfile) {
            if (!exporting || data.format !== "mp4")
              throw new ApplicationError(
                "request.invalid",
                "Delivery profiles apply to MP4 export only.",
              );
            try {
              exportProfile = validateExportProfile(data.exportProfile);
            } catch (error) {
              throw new ApplicationError(
                "request.invalid",
                "Choose a supported versioned Export Profile.",
                400,
                undefined,
                error instanceof Error ? error.message : String(error),
              );
            }
            if (exportProfile.format !== "mp4")
              throw new ApplicationError(
                "request.invalid",
                "MP4 export requires an MP4 Export Profile.",
              );
          }
          const hasCropConfirmation = Object.hasOwn(data, "confirmCrop");
          if (hasCropConfirmation && typeof data.confirmCrop !== "boolean")
            throw new ApplicationError(
              "request.invalid",
              "Crop confirmation must be boolean.",
            );
          if (hasCropConfirmation && !hasExportProfile)
            throw new ApplicationError(
              "request.invalid",
              "Crop confirmation requires an Export Profile.",
            );
          if (exportProfile?.framing === "crop" && data.confirmCrop !== true)
            throw new ApplicationError(
              "request.invalid",
              "Confirm the center crop after reviewing its export frame.",
            );
          if (
            data.cropPreviewToken !== undefined &&
            (typeof data.cropPreviewToken !== "string" || !exportProfile)
          )
            throw new ApplicationError(
              "request.invalid",
              "A reviewed crop preview token requires an Export Profile.",
            );
          const hasLookOverride = Object.hasOwn(data, "lookOverride");
          let lookOverride: FilmLook | null | undefined;
          if (hasLookOverride) {
            if (exporting && data.format !== "mp4")
              throw new ApplicationError(
                "request.invalid",
                "A temporary film look is available for MP4 output only; interchange retains saved looks as metadata.",
              );
            try {
              lookOverride =
                data.lookOverride === null
                  ? null
                  : validateFilmLook(data.lookOverride);
            } catch (error) {
              throw new ApplicationError(
                "request.invalid",
                "Choose a supported film look with strength between zero and one.",
                400,
                undefined,
                error instanceof Error ? error.message : String(error),
              );
            }
          }
          const hasCaptionTrackId = Object.hasOwn(data, "captionTrackId");
          if (hasCaptionTrackId && exporting && data.format !== "mp4")
            throw new ApplicationError(
              "request.invalid",
              "Caption burn-in is available for MP4 output only.",
            );
          if (
            hasCaptionTrackId &&
            data.captionTrackId !== null &&
            typeof data.captionTrackId !== "string"
          )
            throw new ApplicationError(
              "request.invalid",
              "A caption track selection must be a saved track ID or null.",
            );
          if (exporting && data.format !== "mp4") {
            if (
              !["json", "otio", "fcpxml", "edl"].includes(String(data.format))
            )
              throw new HttpError(
                400,
                "Choose MP4, JSON, OTIO, FCPXML, or EDL.",
              );
            const exported = await application.exportWithReport(
              data.format as "json" | "otio" | "fcpxml" | "edl",
              typeof data.compositionId === "string"
                ? data.compositionId
                : undefined,
            );
            json(response, 200, {
              ...exported,
              filename: basename(exported.path),
            });
            return;
          }
          if (hasActiveProjectWork())
            throw new HttpError(409, "Wait for running jobs before rendering.");
          const controller = new AbortController();
          const jobId = randomUUID();
          application.catalog.saveJob({
            id: jobId,
            type: "render",
            status: "queued",
            progress: 0,
          });
          active.set(jobId, controller);
          const compositionId =
            typeof data.compositionId === "string"
              ? data.compositionId
              : undefined;
          const renderOptions = {
            signal: controller.signal,
            jobId,
            lookOverride,
            quality,
            ...(exportProfile ? { exportProfile } : {}),
            ...(data.confirmCrop === true ? { confirmCrop: true } : {}),
            ...(typeof data.cropPreviewToken === "string"
              ? { cropPreviewToken: data.cropPreviewToken }
              : {}),
            ...(hasCaptionTrackId
              ? { captionTrackId: data.captionTrackId as string | null }
              : {}),
          };
          const task = exporting
            ? application.exportMp4(compositionId, renderOptions)
            : application
                .render(compositionId, renderOptions)
                .then((path) => ({ path }));
          const handled = task
            .catch((error: unknown) => {
              const job = application.catalog
                .listJobs()
                .find((item) => item.id === jobId);
              if (job && (job.status === "queued" || job.status === "running"))
                application.catalog.saveJob({
                  ...job,
                  status: controller.signal.aborted ? "cancelled" : "failed",
                  updatedAt: new Date().toISOString(),
                  errors: [
                    {
                      uri: "",
                      stage: "prepare-render",
                      message:
                        error instanceof Error ? error.message : String(error),
                      ...errorInfo(error, errorContext),
                    },
                  ],
                });
              throw error;
            })
            .finally(() => {
              active.delete(jobId);
              tasks.delete(handled);
            });
          tasks.add(handled);
          const result = await handled;
          json(response, 200, {
            ...result,
            ...(exporting ? { filename: basename(result.path) } : {}),
          });
          return;
        }
        if (method === "GET" && route === "/api/preview") {
          await streamFile(
            request,
            response,
            resolve(application.directory, "cache/preview.mp4"),
            resolve(application.directory, "cache"),
            "video/mp4",
          );
          return;
        }
        const exportFramePreview =
          /^\/api\/export\/frame-preview\/([a-f\d-]{36})$/iu.exec(route);
        if (method === "GET" && exportFramePreview) {
          const token = exportFramePreview[1]!.toLowerCase();
          const file = await application.exportProfiles.previewPath(token);
          await streamFile(
            request,
            response,
            file,
            resolve(application.directory, "cache/export-preview"),
            "image/png",
          );
          return;
        }
        if (method === "GET" && route === "/api/export/file") {
          const name = url.searchParams.get("name") ?? "";
          if (!safeExportName(name))
            throw new HttpError(400, "Choose an exported file name.");
          const root = join(application.directory, "exports");
          response.setHeader(
            "Content-Disposition",
            `attachment; filename*=UTF-8''${encodeURIComponent(basename(name))}`,
          );
          await streamFile(
            request,
            response,
            join(root, name),
            root,
            (
              {
                ".mp4": "video/mp4",
                ".png": "image/png",
                ".wav": "audio/wav",
                ".json": "application/json",
              } as Record<string, string>
            )[extname(name).toLowerCase()] ?? "application/octet-stream",
          );
          return;
        }
        throw new HttpError(404, "Endpoint not found.");
      } catch (error) {
        if (response.headersSent || response.destroyed) return;
        response.removeHeader("Content-Disposition");
        const status =
          error instanceof ApplicationError ||
          error instanceof TimelineEditorError ||
          error instanceof RelinkError
            ? error.status
            : 400;
        json(response, status, {
          error: error instanceof Error ? error.message : "Operation failed.",
          ...errorInfo(
            error,
            error instanceof TimelineEditorError
              ? error.status === 409
                ? "timeline.conflict"
                : error.status === 404
                  ? "timeline.notFound"
                  : "timeline.invalidEdit"
              : error instanceof RelinkError
                ? error.status === 409
                  ? "media.relinkConflict"
                  : "media.relinkFailed"
                : errorContext,
          ),
        });
      } finally {
        releaseMutation?.();
      }
    })();
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", accept);
  });
  const address = server.address();
  if (address && typeof address !== "string") port = address.port;
  const close = async () => {
    closing = true;
    cancelGraphicSceneAgentPreviews();
    for (const timer of browserDiscoveryTimers.values()) clearTimeout(timer);
    browserDiscoveryTimers.clear();
    for (const controller of sourceDiscoveryControllers) controller.abort();
    for (const controller of browserStageControllers) controller.abort();
    for (const controller of sourceBatchControllers.values())
      controller.abort();
    for (const controller of sourceAnalysisControllers.values())
      controller.abort();
    for (const controller of mediaStreams.keys()) controller.abort();
    const stopped = new Promise<void>((accept) => server.close(() => accept()));
    for (const controller of new Set(active.values())) controller.abort();
    for (const operation of proxyOperations.values())
      operation.controller.abort();
    await Promise.allSettled(tasks);
    await mutationQueue;
    await Promise.allSettled(mediaStreams.values());
    await stopped;
    await discardUploads();
    await app?.motionGeneration.dispose();
    app?.close({ requireSave: true });
  };
  return { server, port, close };
}
