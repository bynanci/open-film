import type {
  MotionRequest,
  MotionGenerationReceipt,
  AudioGenerationReceipt,
} from "@openfilm/application";
import type {
  MediaAsset,
  OpenFilmProject,
  Story,
  Composition,
  Event,
  SimilarityGroup,
  Job,
  OpenFilmError,
  FilmSettings,
  ProjectContentLocale,
  TranscriptDocument,
  TranscriptSegment,
  WaveformData,
  SceneAnalysis,
  TimelineMarker,
  TranscriptRevision,
  TranscriptCommand,
  GlossaryEntry,
  GlossaryInput,
  TranscriptReviewSuggestion as ReviewSuggestion,
  ReviewBatch,
  SceneScriptReviewSuggestion,
  ProjectVersionDiff,
  ProjectVersionRecord,
  ExportProfile,
  FilmLook,
  StoryGraph,
  GraphViewState,
  StoryPlan,
  StoryPlanOptions,
  StoryPlanAcceptanceMapping,
  PipelineRecipe,
  PipelineRun,
} from "@openfilm/core";
import type {
  CaptionPublication,
  CaptionSnapshotPage,
  DirectionReviewPlan,
  DirectionReviewAcceptance,
  GraphicSceneAgentAcceptance,
  GraphicSceneAgentPlan,
  GraphicSceneAgentRequest,
  VisualQaReport,
  AudioQualityReport,
  ProjectVersionCreateInput,
  ProjectVersionRestoreInput,
  ProjectVersionRestoreResult,
  CollectMediaPlan,
  CollectPlanInput,
  CollectMediaCreateResult,
  CollectMediaVerifyResult,
  ProfileFramePreview,
  ProfileExportArtifact,
  AudioProfileExport,
} from "@openfilm/application";
export type {
  DirectionReviewPlan,
  DirectionReviewAcceptance,
  GraphicSceneAgentAcceptance,
  GraphicSceneAgentPlan,
  GraphicSceneAgentRequest,
  ProfileFramePreview,
  ProfileExportArtifact,
  AudioProfileExport,
} from "@openfilm/application";
export type { SceneDirectionOptions } from "@openfilm/solver";
import type { SceneDirectionOptions } from "@openfilm/solver";
import type { EditorDocument, TimelineCommand } from "@openfilm/solver";
import type {
  AnalysisRecoveryState,
  AnalysisRecoveryInput,
} from "@openfilm/application";
export type { AnalysisRecoveryInput } from "@openfilm/application";

/** Runtime controls belong to the connected server, not the portable job record. */
export interface AnalysisJobRecoveryState extends AnalysisRecoveryState {
  canCancel: boolean;
}
export interface JobsState {
  jobs: Job[];
  analysisRecovery?: Record<string, AnalysisJobRecoveryState>;
}

export interface VisualQaState {
  job: Job;
  /** The server has released this project's cancellation and job lock. */
  active: boolean;
  report?: VisualQaReport;
}

export interface EditorState extends EditorDocument {
  assets: MediaAsset[];
  revision: string;
  acknowledgedRevision?: string;
  canUndo: boolean;
  canRedo: boolean;
}

export interface ScenePlanOptions {
  title: string;
  groupBy: "category" | "chronology";
  targetDuration: number;
  maxDuration: number;
  brief?: string;
  assetIds?: string[];
  transition: "cut" | "crossfade";
}
export interface ScenePlan {
  story: Story;
  composition: Composition;
  sourceAssetIds: string[];
  sourceSignature: string;
  transition: "cut" | "crossfade";
  excludedAudioCount: number;
}

export interface ExportCompatibilityReport {
  format: string;
  warnings: string[];
  realNleVerified?: false;
  advancedEdits?: "metadata-only";
  metadataOnlyEdits?: { clipId: string; features: string[] }[];
}

export interface SourceStatus {
  assetId: string;
  status: "available" | "missing" | "inaccessible";
  message?: string;
}
export interface MediaStatus {
  assets: SourceStatus[];
  libraries: {
    id: string;
    name: string;
    status: "online" | "offline" | "partial";
    roots: string[];
  }[];
}
export interface RelinkCandidate {
  id: string;
  path: string;
  uri: string;
  fileSize: number;
  contentHash: string;
  match: "content-hash" | "relative-path" | "filename-size" | "manual";
  automatic: boolean;
  reason: string;
}
export interface RelinkMatch {
  assetId: string;
  candidates: RelinkCandidate[];
  suggestedId?: string;
  reason?: string;
}
export interface RelinkPlan {
  id: string;
  createdAt: string;
  matches: RelinkMatch[];
}

export class ApiError extends Error {
  readonly code: OpenFilmError["code"];
  readonly params?: OpenFilmError["params"];
  readonly detail: string;
  constructor(
    message: string,
    readonly status: number,
    info: Partial<OpenFilmError> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = info.code ?? "operation.failed";
    this.params = info.params;
    this.detail = info.detail ?? message;
  }
}

export interface WorkspaceInfo {
  systemLocale: string;
  defaultProjectRoot: string;
  defaults: FilmSettings & { projectContentLocale: ProjectContentLocale };
  templates: { id: string; targetDuration: number; maxDuration: number }[];
  maxUploadBytes: number;
}

export interface IntelligenceState {
  sourceHash: string;
  transcript?: TranscriptDocument;
  transcriptTotal: number;
  transcriptOffset: number;
  waveform?: WaveformData;
  scenes?: SceneAnalysis;
  markers: TimelineMarker[];
}
export interface IntelligenceProviders {
  transcription: {
    available: boolean;
    providerId: string;
    execution?: string;
    model?: string;
    detail?: string;
    capabilities?: {
      wordTimestamps: boolean;
      cpuFallback: boolean;
      languages: string[];
    };
  };
}
export interface TranscriptEditorState {
  document?: TranscriptDocument;
  revision?: string;
  revisionInfo?: TranscriptRevision;
  total: number;
  offset: number;
  limit: number;
  canUndo: boolean;
  canRedo: boolean;
  acknowledgedRevision?: string;
}
export interface TranscriptSearchState {
  revision: string;
  totalMatches: number;
  totalSegments: number;
  offset: number;
  limit: number;
  matches: {
    segmentId: string;
    position: number;
    start: number;
    end: number;
    text: string;
    ranges: { start: number; end: number }[];
  }[];
}
export interface ReviewProviderState {
  configured: boolean;
  available: boolean;
  provider?: {
    id: string;
    name?: string;
    execution: string;
    model?: string;
    endpoint?: string;
    dataKinds: string[];
  };
}
export interface ReviewRecoveryState {
  jobId: string;
  ownerState: "alive" | "dead" | "unknown";
  manualRecoveryAllowed: boolean;
  ownerToken?: string;
  updatedAt?: string;
}

export interface ReviewSuggestionsState {
  suggestions: ReviewSuggestion[];
  total: number;
  offset: number;
  limit: number;
}

export type ScriptReviewField = "narration" | "visualDirection";
export interface ScriptReviewSuggestionsState {
  suggestions: SceneScriptReviewSuggestion[];
  total: number;
  offset: number;
  limit: number;
  revision: string;
}

export interface CreateFilmInput {
  title: string;
  path?: string;
  root?: string;
  projectContentLocale?: ProjectContentLocale;
  filmSettings?: Partial<FilmSettings>;
}
export interface UploadProgress {
  completed: number;
  total: number;
  bytesUploaded: number;
  totalBytes: number;
}

function responseError(body: unknown, status: number): ApiError {
  const data =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  return new ApiError(
    typeof data.error === "string" ? data.error : `Request failed (${status}).`,
    status,
    {
      ...(typeof data.code === "string"
        ? { code: data.code as OpenFilmError["code"] }
        : {}),
      ...(data.params &&
      typeof data.params === "object" &&
      !Array.isArray(data.params)
        ? { params: data.params as OpenFilmError["params"] }
        : {}),
      ...(typeof data.detail === "string" ? { detail: data.detail } : {}),
    },
  );
}

let prefix = import.meta.env.DEV ? "/api" : "http://127.0.0.1:4310/api";
/** The native bridge supplies a private endpoint only after verified startup. */
export function configureNativeConnection(
  port: unknown,
  session: unknown,
): void {
  if (
    !Number.isInteger(port) ||
    Number(port) < 1 ||
    Number(port) > 65535 ||
    typeof session !== "string" ||
    !/^[a-f0-9]{64}$/u.test(session)
  )
    throw new Error("runtime.handshake");
  prefix = `http://127.0.0.1:${port}/native/${session}/api`;
}

export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${prefix}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw new ApiError(
      "The local film workspace is unavailable. Start OpenFilm’s local service and try again.",
      0,
      { code: "workspace.unavailable" },
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      "OpenFilm’s local workspace couldn’t be reached. Restart OpenFilm and try again.",
      response.status,
      { code: "workspace.invalidResponse" },
    );
  }
  if (!response.ok) {
    throw responseError(body, response.status);
  }
  return body as T;
}

export const post = <T>(
  path: string,
  body: unknown = {},
  signal?: AbortSignal,
): Promise<T> =>
  request<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
export const patch = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const put = <T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> =>
  request<T>(path, {
    method: "PUT",
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
export const thumbnailUrl = (id: string): string =>
  `${prefix}/thumbnail/${encodeURIComponent(id)}`;
export const previewUrl = (version: number): string =>
  `${prefix}/preview?v=${version}`;
export const visualQaFrameUrl = (
  reportId: string,
  sampleIndex: number,
): string =>
  `${prefix}/visual-qa/${encodeURIComponent(reportId)}/frames/${encodeURIComponent(String(sampleIndex))}`;
export const sourceUrl = (id: string, version?: string | number): string =>
  `${prefix}/source/${encodeURIComponent(id)}${version === undefined ? "" : `?v=${encodeURIComponent(version)}`}`;
export const titlePreviewUrl = (
  compositionId: string,
  clipId: string,
  revision: string,
  projectId?: string,
): string =>
  `${prefix}/compositions/${encodeURIComponent(compositionId)}/title/${encodeURIComponent(clipId)}.png?${new URLSearchParams({ revision, ...(projectId ? { projectId } : {}) })}`;
export const captionDownloadUrl = (
  id: string,
  projectId: string,
  kind: "captions" | "manifest",
): string =>
  `${prefix}/captions/file?${new URLSearchParams({ id, projectId, kind })}`;
export const exportDownloadUrl = (filename: string): string =>
  `${prefix}/export/file?${new URLSearchParams({ name: filename })}`;
/** Fetch local artifacts with CORS Origin semantics, never a native navigation.
 * Callers own cancellation and publication of the resulting window-local blob.
 */
export async function fetchDownloadBlob(
  url: string,
  signal: AbortSignal,
): Promise<Blob> {
  const connection = prefix;
  if (!url.startsWith(`${connection}/`))
    throw new ApiError("The download belongs to another workspace.", 409, {
      code: "workspace.invalidResponse",
    });
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      redirect: "error",
      credentials: "omit",
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError("The local film workspace is unavailable.", 0, {
      code: "workspace.unavailable",
    });
  }
  if (!response.ok)
    throw responseError(
      await response.json().catch(() => null),
      response.status,
    );
  const blob = await response.blob();
  signal.throwIfAborted();
  if (prefix !== connection)
    throw new DOMException("The local connection changed.", "AbortError");
  return blob;
}
export const exportFramePreviewUrl = (token: string): string =>
  `${prefix}/export/frame-preview/${encodeURIComponent(token)}`;
export const previewExportFrame = (
  input: {
    compositionId?: string;
    profile: ExportProfile;
    time: number;
    lookOverride?: FilmLook | null;
    captionTrackId?: string | null;
  },
  signal?: AbortSignal,
): Promise<ProfileFramePreview> => post("/export/frame-preview", input, signal);
export const exportStill = (
  input: {
    compositionId?: string;
    profile: ExportProfile;
    time: number;
    requestId: string;
    confirmCrop?: boolean;
    cropPreviewToken?: string;
    lookOverride?: FilmLook | null;
    captionTrackId?: string | null;
  },
  signal?: AbortSignal,
): Promise<ProfileExportArtifact & { filename: string }> =>
  post("/export/still", input, signal);
export const exportProfileAudio = (
  input: {
    compositionId?: string;
    profile: ExportProfile;
    requestId: string;
  },
  signal?: AbortSignal,
): Promise<AudioProfileExport> => post("/export/audio", input, signal);
export const audioQualityMediaUrl = (
  reportId: string,
  variant: "original" | "candidate",
  projectId: string,
): string =>
  `${prefix}/audio-quality/${encodeURIComponent(reportId)}/${variant}?${new URLSearchParams({ projectId })}`;
export const generatedAudioMediaUrl = (id: string, projectId: string): string =>
  `${prefix}/audio-generation/${encodeURIComponent(id)}/media?${new URLSearchParams({ projectId })}`;

async function uploadFiles(
  files: File[],
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgress) => void;
  } = {},
): Promise<{ jobId: string }> {
  if (!files.length)
    throw new ApiError("Choose at least one media file.", 400, {
      code: "request.invalid",
    });
  const uploads: string[] = [];
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  let completedBytes = 0;
  try {
    for (const file of files) {
      options.signal?.throwIfAborted();
      const uploaded = await new Promise<{ uploadId: string }>(
        (accept, reject) => {
          const xhr = new XMLHttpRequest();
          const abort = () => xhr.abort();
          const cleanup = () =>
            options.signal?.removeEventListener("abort", abort);
          xhr.open(
            "POST",
            `${prefix}/import/upload?${new URLSearchParams({ name: file.name })}`,
          );
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.upload.onprogress = (event) =>
            options.onProgress?.({
              completed: uploads.length,
              total: files.length,
              bytesUploaded: completedBytes + Math.min(event.loaded, file.size),
              totalBytes,
            });
          xhr.onload = () => {
            cleanup();
            let data: unknown;
            try {
              data = JSON.parse(xhr.responseText);
            } catch {
              reject(
                new ApiError(
                  "The upload returned an invalid response.",
                  xhr.status,
                  { code: "workspace.invalidResponse" },
                ),
              );
              return;
            }
            if (xhr.status < 200 || xhr.status >= 300)
              reject(responseError(data, xhr.status));
            else if (
              data &&
              typeof data === "object" &&
              "uploadId" in data &&
              typeof data.uploadId === "string"
            )
              accept({ uploadId: data.uploadId });
            else
              reject(
                new ApiError("The upload receipt is missing.", xhr.status, {
                  code: "workspace.invalidResponse",
                }),
              );
          };
          xhr.onerror = () => {
            cleanup();
            reject(
              new ApiError("The local film workspace is unavailable.", 0, {
                code: "workspace.unavailable",
              }),
            );
          };
          xhr.onabort = () => {
            cleanup();
            reject(new DOMException("Upload cancelled", "AbortError"));
          };
          options.signal?.addEventListener("abort", abort, { once: true });
          xhr.send(file);
        },
      );
      uploads.push(uploaded.uploadId);
      completedBytes += file.size;
      options.onProgress?.({
        completed: uploads.length,
        total: files.length,
        bytesUploaded: completedBytes,
        totalBytes,
      });
    }
    options.signal?.throwIfAborted();
    return await post<{ jobId: string }>("/import", { uploads });
  } catch (error) {
    if (uploads.length) {
      try {
        await post("/import/uploads/discard", { uploads });
      } catch {
        /* Project close also discards pending receipts. */
      }
    }
    throw error;
  }
}
export const api = {
  projectVersionRevision: (signal?: AbortSignal) =>
    request<{ projectId: string; revision: string }>("/versions/revision", {
      signal,
    }),
  projectVersions: (signal?: AbortSignal) =>
    request<{ versions: ProjectVersionRecord[] }>("/versions", { signal }),
  createProjectVersion: (body: ProjectVersionCreateInput) =>
    post<{ version: ProjectVersionRecord }>("/versions", body),
  inspectProjectVersion: (id: string, signal?: AbortSignal) =>
    request<{
      record: ProjectVersionRecord;
      summary: {
        title: string;
        storyCount: number;
        compositionCount: number;
        captionTrackCount: number;
        graphicSceneCount: number;
      };
      catalogSchemaVersion: number;
    }>(`/versions/${encodeURIComponent(id)}`, { signal }),
  diffProjectVersions: (before: string, after: string, signal?: AbortSignal) =>
    request<{ diff: ProjectVersionDiff }>(
      `/versions/diff?${new URLSearchParams({ before, after })}`,
      { signal },
    ),
  renameProjectVersion: (
    id: string,
    body: { name: string; description?: string | null },
  ) =>
    patch<{ version: ProjectVersionRecord }>(
      `/versions/${encodeURIComponent(id)}`,
      body,
    ),
  deleteProjectVersion: (
    id: string,
    body: { baseRevision: string; confirmed: boolean },
  ) =>
    request<{ removedVersionId: string }>(
      `/versions/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
    ),
  restoreProjectVersion: (id: string, body: ProjectVersionRestoreInput) =>
    post<
      ProjectVersionRestoreResult & {
        project: OpenFilmProject;
        generation: number;
      }
    >(`/versions/${encodeURIComponent(id)}/restore`, body),
  collectMediaPlan: (body: CollectPlanInput, signal?: AbortSignal) =>
    post<{ plan: CollectMediaPlan }>("/collect/plan", body, signal),
  createCollectedMedia: (
    body: CollectPlanInput & {
      planId: string;
      baseRevision: string;
      format: "directory" | "zip";
    },
    signal?: AbortSignal,
  ) =>
    post<{ result: CollectMediaCreateResult }>("/collect/create", body, signal),
  verifyCollectedMedia: (packageName: string, signal?: AbortSignal) =>
    post<{ result: CollectMediaVerifyResult }>(
      "/collect/verify",
      { packageName },
      signal,
    ),
  captionContext: (
    projectId: string,
    compositionId: string,
    signal?: AbortSignal,
  ) =>
    request<{ projectId: string; compositionId: string; revision: string }>(
      `/captions/context?${new URLSearchParams({ projectId, compositionId })}`,
      { signal },
    ),
  prepareCaptions: (
    body: {
      projectId: string;
      compositionId: string;
      trackId: string;
      baseRevision: string;
    },
    signal?: AbortSignal,
  ) =>
    request<CaptionSnapshotPage>("/captions/prepare", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  addNativeCaptionTrack: (
    body: {
      projectId: string;
      snapshotId: string;
      name: string;
      language?: string;
      trackId: string;
      requestId: string;
    },
    signal?: AbortSignal,
  ) =>
    request<EditorState>("/captions/native-track", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  captionSnapshot: (
    id: string,
    params: {
      projectId: string;
      offset: number;
      limit: number;
      issueOffset: number;
      issueLimit: number;
    },
    signal?: AbortSignal,
  ) =>
    request<CaptionSnapshotPage>(
      `/captions/snapshot?${new URLSearchParams({ id, ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])) })}`,
      { signal },
    ),
  exportCaptions: (
    body: { projectId: string; snapshotId: string; format: "srt" | "vtt" },
    signal?: AbortSignal,
  ) =>
    request<CaptionPublication>("/captions/export", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  intelligence: (
    assetId: string,
    offset = 0,
    limit = 100,
    signal?: AbortSignal,
  ) =>
    request<IntelligenceState>(
      `/assets/${encodeURIComponent(assetId)}/intelligence?${new URLSearchParams({ offset: String(offset), limit: String(limit) })}`,
      { signal },
    ),
  intelligenceProviders: (signal?: AbortSignal) =>
    request<IntelligenceProviders>("/intelligence/providers", { signal }),
  analyzeIntelligence: (
    assetId: string,
    body: {
      operation: "transcribe" | "waveform" | "scenes";
      language?: "auto" | "zh" | "en" | "ja";
      execution?: "auto" | "cpu" | "gpu";
    },
  ) =>
    post<{ job: Job }>(
      `/assets/${encodeURIComponent(assetId)}/intelligence`,
      body,
    ),
  addMarker: (assetId: string, body: { time: number; label?: string }) =>
    post<{ marker: TimelineMarker }>(
      `/assets/${encodeURIComponent(assetId)}/markers`,
      body,
    ),
  removeMarker: (assetId: string, markerId: string) =>
    request<{ ok: true }>(
      `/assets/${encodeURIComponent(assetId)}/markers/${encodeURIComponent(markerId)}`,
      { method: "DELETE" },
    ),
  transcript: (assetId: string, offset = 0, limit = 100, revisionId?: string) =>
    request<TranscriptEditorState>(
      `/assets/${encodeURIComponent(assetId)}/transcript?${new URLSearchParams({ offset: String(offset), limit: String(limit), ...(revisionId ? { revisionId } : {}) })}`,
    ),
  transcriptSegment: (assetId: string, segmentId: string) =>
    post<{ segment: TranscriptSegment; position: number; revision: string }>(
      `/assets/${encodeURIComponent(assetId)}/transcript/segment`,
      { segmentId },
    ),
  editTranscript: (
    assetId: string,
    body: {
      baseRevision: string;
      requestId: string;
      commands: TranscriptCommand[];
    },
  ) =>
    post<TranscriptEditorState>(
      `/assets/${encodeURIComponent(assetId)}/transcript/edit`,
      body,
    ),
  transcriptHistory: (
    assetId: string,
    direction: "undo" | "redo",
    body: { baseRevision: string; requestId: string },
  ) =>
    post<TranscriptEditorState>(
      `/assets/${encodeURIComponent(assetId)}/transcript/${direction}`,
      body,
    ),
  transcriptSearch: (
    assetId: string,
    query: string,
    caseSensitive = false,
    offset = 0,
    limit = 100,
  ) =>
    request<TranscriptSearchState>(
      `/assets/${encodeURIComponent(assetId)}/transcript/search?${new URLSearchParams({ query, caseSensitive: String(caseSensitive), offset: String(offset), limit: String(limit) })}`,
    ),
  transcriptRevisions: (assetId: string, offset = 0, limit = 100) =>
    request<{
      revisions: TranscriptRevision[];
      total: number;
      offset: number;
      limit: number;
    }>(
      `/assets/${encodeURIComponent(assetId)}/transcript/revisions?${new URLSearchParams({ offset: String(offset), limit: String(limit) })}`,
    ),
  selectTranscriptRevision: (
    assetId: string,
    body: { baseRevision: string; requestId: string; revisionId: string },
  ) =>
    post<TranscriptEditorState>(
      `/assets/${encodeURIComponent(assetId)}/transcript/select`,
      body,
    ),
  glossary: (scope: "global" | "project" | "effective" = "project") =>
    request<{ entries: GlossaryEntry[] }>(
      `/glossary?${new URLSearchParams({ scope })}`,
    ),
  saveGlossary: (body: GlossaryInput) =>
    post<{ entry: GlossaryEntry }>("/glossary", body),
  deleteGlossary: (id: string, scope: "global" | "project") =>
    request<{ ok: true }>(
      `/glossary/${encodeURIComponent(id)}?${new URLSearchParams({ scope })}`,
      { method: "DELETE" },
    ),
  reviewProvider: (workflow?: "scene-script" | "graphic-scene") =>
    request<ReviewProviderState>(
      `/review/provider${workflow ? `?workflow=${workflow}` : ""}`,
    ),
  reviewConsent: (
    allow: boolean,
    disclosedProvider?: ReviewProviderState["provider"],
    workflow?: "scene-script" | "graphic-scene",
  ) =>
    post<ReviewProviderState>("/review/consent", {
      allow,
      ...(workflow ? { workflow } : {}),
      ...(allow && disclosedProvider
        ? {
            providerId: disclosedProvider.id,
            endpoint: disclosedProvider.endpoint,
            dataKinds: disclosedProvider.dataKinds,
          }
        : {}),
    }),
  reviewSuggestions: (
    assetId: string,
    status?: ReviewSuggestion["status"],
    offset = 0,
    limit = 100,
  ) =>
    request<ReviewSuggestionsState>(
      `/assets/${encodeURIComponent(assetId)}/review/suggestions?${new URLSearchParams({ offset: String(offset), limit: String(limit), ...(status ? { status } : {}) })}`,
    ),
  runReview: (
    assetId: string,
    body: {
      source: "glossary" | "language";
      segmentIds?: string[];
      batchSize?: number;
    },
  ) =>
    post<{ job: Job }>(`/assets/${encodeURIComponent(assetId)}/review`, body),
  acceptSuggestion: (
    id: string,
    body: { baseRevision: string; requestId: string },
  ) =>
    post<TranscriptEditorState>(
      `/review/suggestions/${encodeURIComponent(id)}/accept`,
      body,
    ),
  skipSuggestion: (id: string) =>
    post<{ suggestion: ReviewSuggestion }>(
      `/review/suggestions/${encodeURIComponent(id)}/skip`,
    ),
  reviewBatches: (jobId: string) =>
    request<{ batches: ReviewBatch[] }>(
      `/review/jobs/${encodeURIComponent(jobId)}/batches`,
    ),
  reviewRecovery: (jobId: string) =>
    request<ReviewRecoveryState>(
      `/review/jobs/${encodeURIComponent(jobId)}/recovery`,
    ),
  recoverReview: (
    jobId: string,
    body: {
      confirmStopped: true;
      ownerToken?: string;
      updatedAt?: string;
    },
  ) =>
    post<{ job: Job }>(
      `/review/jobs/${encodeURIComponent(jobId)}/recovery`,
      body,
    ),
  reviewBatchAction: (jobId: string, index: number, action: "retry" | "skip") =>
    post<{ job: Job }>(
      `/review/jobs/${encodeURIComponent(jobId)}/batches/${index}/${action}`,
    ),
  workspace: () => request<WorkspaceInfo>("/workspace"),
  projectAvailability: (paths: string[]) =>
    post<{
      projects: {
        path: string;
        status: "available" | "missing" | "invalid" | "inaccessible";
      }[];
    }>("/projects/availability", { paths }),
  createProject: (input: CreateFilmInput) =>
    post<{ project: OpenFilmProject; path: string }>("/project/create", input),
  updateProject: (input: {
    projectContentLocale?: ProjectContentLocale;
    filmSettings?: Partial<FilmSettings>;
  }) => patch<{ project: OpenFilmProject; path: string }>("/project", input),
  importFiles: (files: string[]) =>
    post<{ jobId: string }>("/import", { files }),
  uploadFiles,
  project: () =>
    request<{ project: OpenFilmProject | null; path: string | null }>(
      "/project",
    ),
  assets: (params: URLSearchParams) =>
    request<{
      assets: MediaAsset[];
      total: number;
      summary: { total: number; images: number; videos: number; audio: number };
    }>(`/assets?${params}`),
  jobs: () => request<JobsState>("/jobs"),
  clearMotion: (projectId: string) =>
    post<{ ok: boolean }>("/motion-generation/clear", { projectId }),
  motionProviders: () =>
    request<{ id: string; name: string; available: boolean }[]>(
      "/motion-generation/providers",
    ),
  previewMotion: (
    { compositionId, ...input }: MotionRequest,
    signal: AbortSignal,
  ) =>
    post<MotionGenerationReceipt[]>(
      `/compositions/${encodeURIComponent(compositionId)}/motion-generation`,
      input,
      signal,
    ),
  motionReceipt: (id: string, projectId: string) =>
    request<MotionGenerationReceipt>(
      `/motion-generation/${encodeURIComponent(id)}/receipt?${new URLSearchParams({ projectId })}`,
    ),
  acceptMotion: (id: string, projectId: string, reviewed: boolean) =>
    post<MotionGenerationReceipt>(
      `/motion-generation/${encodeURIComponent(id)}/accept`,
      { projectId, reviewed },
    ),
  applyMotion: (id: string, projectId: string, action: "import" | "restore") =>
    post<{ revision: string; receipt: MotionGenerationReceipt }>(
      `/motion-generation/${encodeURIComponent(id)}/${action}`,
      { projectId },
    ),
  revokeMotion: (id: string, projectId: string) =>
    post<{ ok: boolean }>(
      `/motion-generation/requests/${encodeURIComponent(id)}/revoke`,
      { projectId },
    ),
  audioGenerationProviders: () =>
    request<
      { id: string; name: string; execution: string; endpoint?: string }[]
    >("/audio-generation/providers"),
  generateAudio: (
    id: string,
    input: {
      baseRevision: string;
      providerId: string;
      text: string;
      consent: boolean;
      acknowledgeUnknownCost: boolean;
    },
    signal?: AbortSignal,
  ) =>
    post<AudioGenerationReceipt>(
      `/compositions/${encodeURIComponent(id)}/audio-generation`,
      input,
      signal,
    ),
  acceptGeneratedAudio: (id: string, projectId: string) =>
    post<AudioGenerationReceipt>(
      `/audio-generation/${encodeURIComponent(id)}/accept`,
      { projectId },
    ),
  importGeneratedAudio: (
    id: string,
    projectId: string,
    timelineStart: number,
  ) =>
    post<{
      baseRevision: string;
      command: TimelineCommand;
      assets: MediaAsset[];
    }>(`/audio-generation/${encodeURIComponent(id)}/import`, {
      projectId,
      timelineStart,
    }),
  audioQuality: (
    compositionId: string,
    clipId: string,
    baseRevision: string,
    signal?: AbortSignal,
  ) =>
    post<AudioQualityReport>(
      `/compositions/${encodeURIComponent(compositionId)}/audio-quality`,
      { clipId, baseRevision },
      signal,
    ),
  startVisualQa: (compositionId: string) =>
    post<{ jobId: string }>("/visual-qa", { compositionId }),
  visualQa: (jobId: string) =>
    request<VisualQaState>(`/visual-qa/${encodeURIComponent(jobId)}`),
  cancelJob: (jobId: string) =>
    post<{ ok: true }>(`/jobs/${encodeURIComponent(jobId)}/cancel`),
  analysisRecovery: (jobId: string) =>
    request<AnalysisJobRecoveryState>(
      `/intelligence/jobs/${encodeURIComponent(jobId)}/recovery`,
    ),
  recoverAnalysis: (jobId: string, body: AnalysisRecoveryInput) =>
    post<{ job: Job }>(
      `/intelligence/jobs/${encodeURIComponent(jobId)}/recover`,
      body,
    ),
  analyze: () =>
    post<{ events: Event[]; duplicates: SimilarityGroup[] }>("/analyze"),
  previewScenePlan: (options: ScenePlanOptions) =>
    post<{ plan: ScenePlan }>("/story-plans/preview", options),
  acceptScenePlan: (plan: ScenePlan) =>
    post<{ story: Story; composition: Composition }>("/story-plans/accept", {
      plan: {
        story: plan.story,
        sourceAssetIds: plan.sourceAssetIds,
        sourceSignature: plan.sourceSignature,
        transition: plan.transition,
      },
    }),
  createStory: (body: unknown) => post<{ story: Story }>("/stories", body),
  scriptReviewSuggestions: (
    storyId: string,
    input: {
      beatId: string;
      field: ScriptReviewField;
      status?: SceneScriptReviewSuggestion["status"];
      offset?: number;
      limit?: number;
    },
  ) =>
    request<ScriptReviewSuggestionsState>(
      `/stories/${encodeURIComponent(storyId)}/script-review/suggestions?${new URLSearchParams(
        {
          beatId: input.beatId,
          field: input.field,
          offset: String(input.offset ?? 0),
          limit: String(input.limit ?? 10),
          ...(input.status ? { status: input.status } : {}),
        },
      )}`,
    ),
  runScriptReview: (
    storyId: string,
    body: { beatId: string; field: ScriptReviewField },
  ) =>
    post<{ job: Job }>(
      `/stories/${encodeURIComponent(storyId)}/script-review`,
      body,
    ),
  acceptScriptSuggestion: (
    id: string,
    receipt: { baseRevision: string; requestId: string },
  ) =>
    post<{ story: Story }>(
      `/script-review/suggestions/${encodeURIComponent(id)}/accept`,
      receipt,
    ),
  skipScriptSuggestion: (id: string) =>
    post<{ suggestion: SceneScriptReviewSuggestion }>(
      `/script-review/suggestions/${encodeURIComponent(id)}/skip`,
      {},
    ),
  refreshSuggestions: (storyId: string, beatId: string) =>
    post<{ story: Story }>(
      `/stories/${encodeURIComponent(storyId)}/beats/${encodeURIComponent(beatId)}/suggestions`,
    ),
  storyGraph: (storyId: string, signal?: AbortSignal) =>
    request<{ graph: StoryGraph }>(
      `/stories/${encodeURIComponent(storyId)}/graph`,
      { signal },
    ),
  updateStoryGraph: (
    storyId: string,
    graph: StoryGraph,
    signal?: AbortSignal,
  ) =>
    put<{ graph: StoryGraph }>(
      `/stories/${encodeURIComponent(storyId)}/graph`,
      graph,
      signal,
    ),
  storyGraphView: (storyId: string, signal?: AbortSignal) =>
    request<{ viewState: GraphViewState }>(
      `/stories/${encodeURIComponent(storyId)}/graph-view`,
      { signal },
    ),
  updateStoryGraphView: (
    storyId: string,
    viewState: GraphViewState,
    signal?: AbortSignal,
  ) =>
    put<{ viewState: GraphViewState }>(
      `/stories/${encodeURIComponent(storyId)}/graph-view`,
      viewState,
      signal,
    ),
  storyGraphQuickAction: (
    storyId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) =>
    post<{ story?: Story; graph: StoryGraph }>(
      `/stories/${encodeURIComponent(storyId)}/graph/quick-action`,
      body,
      signal,
    ),
  storyPlanPreview: (
    storyId: string,
    options?: StoryPlanOptions,
    signal?: AbortSignal,
  ) =>
    post<{ plan: StoryPlan; compositionPreview: Composition }>(
      `/stories/${encodeURIComponent(storyId)}/plan/preview`,
      options ?? {},
      signal,
    ),
  storyPlanAccept: (storyId: string, plan: StoryPlan, signal?: AbortSignal) =>
    post<{
      story: Story;
      composition: Composition;
      acceptanceMapping: StoryPlanAcceptanceMapping;
    }>(`/stories/${encodeURIComponent(storyId)}/plan/accept`, plan, signal),
  pipelineListRecipes: (signal?: AbortSignal) =>
    request<{ recipes: PipelineRecipe[] }>("/pipelines/recipes", { signal }),
  pipelineGetRecipe: (id: string, signal?: AbortSignal) =>
    request<{ recipe: PipelineRecipe }>(
      `/pipelines/recipes/${encodeURIComponent(id)}`,
      { signal },
    ),
  pipelineListRuns: (signal?: AbortSignal) =>
    request<{ runs: PipelineRun[] }>("/pipelines/runs", { signal }),
  pipelineCreateRun: (
    recipeId: string,
    options?: Record<string, unknown>,
    signal?: AbortSignal,
  ) =>
    post<{ run: PipelineRun }>(
      "/pipelines/runs",
      { recipeId, options },
      signal,
    ),
  pipelineGetRun: (id: string, signal?: AbortSignal) =>
    request<{ run: PipelineRun }>(`/pipelines/runs/${encodeURIComponent(id)}`, {
      signal,
    }),
  pipelineStartRun: (id: string, signal?: AbortSignal) =>
    post<{ run: PipelineRun }>(
      `/pipelines/runs/${encodeURIComponent(id)}/start`,
      {},
      signal,
    ),
  pipelineCancelRun: (id: string, signal?: AbortSignal) =>
    post<{ run: PipelineRun }>(
      `/pipelines/runs/${encodeURIComponent(id)}/cancel`,
      {},
      signal,
    ),
  pipelineRetryRun: (id: string, signal?: AbortSignal) =>
    post<{ run: PipelineRun }>(
      `/pipelines/runs/${encodeURIComponent(id)}/retry`,
      {},
      signal,
    ),
  pipelineSubmitReview: (
    id: string,
    stepId: string,
    decision: "accepted" | "rejected" | "skipped",
    notes?: string,
    signal?: AbortSignal,
  ) =>
    post<{ run: PipelineRun }>(
      `/pipelines/runs/${encodeURIComponent(id)}/review`,
      { stepId, decision, notes },
      signal,
    ),
  compose: (storyId: string) =>
    post<{ composition: Composition }>("/compose", { storyId }),
  editor: (id: string) =>
    request<EditorState>(`/compositions/${encodeURIComponent(id)}/editor`),
  previewDirection: (id: string, body: SceneDirectionOptions) =>
    post<DirectionReviewPlan>(
      `/compositions/${encodeURIComponent(id)}/direction/preview`,
      body,
    ),
  acceptDirection: (id: string, body: DirectionReviewAcceptance) =>
    post<EditorState>(
      `/compositions/${encodeURIComponent(id)}/direction/accept`,
      body,
    ),
  previewGraphicSceneAgent: (
    id: string,
    body: GraphicSceneAgentRequest,
    signal?: AbortSignal,
  ) =>
    post<GraphicSceneAgentPlan>(
      `/compositions/${encodeURIComponent(id)}/graphic-agent/preview`,
      body,
      signal,
    ),
  acceptGraphicSceneAgent: (id: string, body: GraphicSceneAgentAcceptance) =>
    post<EditorState>(
      `/compositions/${encodeURIComponent(id)}/graphic-agent/accept`,
      body,
    ),
  edit: (
    id: string,
    body: {
      baseRevision: string;
      requestId: string;
      commands: TimelineCommand[];
    },
  ) => post<EditorState>(`/compositions/${encodeURIComponent(id)}/edit`, body),
  history: (id: string, direction: "undo" | "redo", baseRevision: string) =>
    post<EditorState>(`/compositions/${encodeURIComponent(id)}/${direction}`, {
      baseRevision,
    }),
  mediaStatus: (assetIds?: string[]) =>
    request<MediaStatus>(
      `/media/status${assetIds?.length ? `?${new URLSearchParams({ assetIds: assetIds.join(",") })}` : ""}`,
    ),
  relinkPlan: (body: {
    assetIds?: string[];
    libraryId?: string;
    folder?: string;
    file?: string;
  }) => post<RelinkPlan>("/media/relink/plan", body),
  relinkApply: (body: {
    planId: string;
    selections: { assetId: string; candidateId: string; confirm?: boolean }[];
  }) => post<{ assets: MediaAsset[] }>("/media/relink/apply", body),
};

export function duration(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const tenths = Math.max(0, Math.round(value * 10));
  const seconds = Math.floor(tenths / 10);
  const fraction = tenths % 10;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
}
export function dateLabel(value: string | undefined): string {
  if (!value) return "Capture date unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Capture date unknown"
    : new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
}

export async function graphicFrame(
  compositionId: string,
  projectId: string,
  revision: string,
  frameIndex: number,
  signal: AbortSignal,
): Promise<Blob> {
  const query = new URLSearchParams({
    projectId,
    revision,
    frame: String(frameIndex),
  });
  const response = await fetch(
    `${prefix}/compositions/${encodeURIComponent(compositionId)}/graphics.png?${query}`,
    { signal, cache: "no-store" },
  );
  if (!response.ok) throw responseError(await response.json(), response.status);
  if (response.headers.get("content-type") !== "image/png")
    throw new ApiError("Invalid graphic frame response.", response.status, {
      code: "workspace.invalidResponse",
    });
  return response.blob();
}

export function motionMediaUrl(id: string, projectId: string) {
  return `${prefix}/motion-generation/${encodeURIComponent(id)}/media?${new URLSearchParams({ projectId })}`;
}

export const handoffDownloadUrl = (
  projectId: string,
  id: string,
  index: number,
) =>
  `${prefix}/handoff/file?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}&index=${index}`;
