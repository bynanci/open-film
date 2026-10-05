import type {
  MediaAsset,
  OpenFilmProject,
  Story,
  Composition,
  Event,
  SimilarityGroup,
  Job,
} from "@openfilm/core";
import type { EditorDocument, TimelineCommand } from "@openfilm/solver";

export interface EditorState extends EditorDocument {
  assets: MediaAsset[];
  revision: string;
  canUndo: boolean;
  canRedo: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
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
  } catch {
    throw new Error(
      "The local film workspace is unavailable. Start OpenFilm’s local service and try again.",
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "OpenFilm’s local workspace couldn’t be reached. Restart OpenFilm and try again.",
    );
  }
  if (!response.ok) {
    throw new ApiError(
      typeof body === "object" && body !== null && "error" in body
        ? String(body.error)
        : `Request failed (${response.status}).`,
      response.status,
    );
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
export const sourceUrl = (id: string): string =>
  `${prefix}/source/${encodeURIComponent(id)}`;
export const api = {
  project: () =>
    request<{ project: OpenFilmProject | null; path: string | null }>(
      "/project",
    ),
  assets: (params: URLSearchParams) =>
    request<{ assets: MediaAsset[]; total: number }>(`/assets?${params}`),
  jobs: () => request<{ jobs: Job[] }>("/jobs"),
  analyze: () =>
    post<{ events: Event[]; duplicates: SimilarityGroup[] }>("/analyze"),
  createStory: (body: unknown) => post<{ story: Story }>("/stories", body),
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
