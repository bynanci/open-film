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
} from "@openfilm/core";
import type { EditorDocument, TimelineCommand } from "@openfilm/solver";

export interface EditorState extends EditorDocument {
  assets: MediaAsset[];
  revision: string;
  acknowledgedRevision?: string;
  canUndo: boolean;
  canRedo: boolean;
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

const prefix = import.meta.env.DEV ? "/api" : "http://127.0.0.1:4310/api";

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

export const post = <T>(path: string, body: unknown = {}): Promise<T> =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const thumbnailUrl = (id: string): string =>
  `${prefix}/thumbnail/${encodeURIComponent(id)}`;
export const previewUrl = (version: number): string =>
  `${prefix}/preview?v=${version}`;
export const sourceUrl = (id: string, version?: string | number): string =>
  `${prefix}/source/${encodeURIComponent(id)}${version === undefined ? "" : `?v=${encodeURIComponent(version)}`}`;
export const exportDownloadUrl = (filename: string): string =>
  `${prefix}/export/file?${new URLSearchParams({ name: filename })}`;

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
  reviewProvider: () => request<ReviewProviderState>("/review/provider"),
  reviewConsent: (
    allow: boolean,
    disclosedProvider?: ReviewProviderState["provider"],
  ) =>
    post<ReviewProviderState>("/review/consent", {
      allow,
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
  jobs: () => request<{ jobs: Job[] }>("/jobs"),
  analyze: () =>
    post<{ events: Event[]; duplicates: SimilarityGroup[] }>("/analyze"),
  createStory: (body: unknown) => post<{ story: Story }>("/stories", body),
  refreshSuggestions: (storyId: string, beatId: string) =>
    post<{ story: Story }>(
      `/stories/${encodeURIComponent(storyId)}/beats/${encodeURIComponent(beatId)}/suggestions`,
    ),
  compose: (storyId: string) =>
    post<{ composition: Composition }>("/compose", { storyId }),
  editor: (id: string) =>
    request<EditorState>(`/compositions/${encodeURIComponent(id)}/editor`),
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
