/** All timeline and source durations use seconds. Source files remain immutable. */
export type MediaType = "image" | "video" | "audio" | "360-video";

export interface MediaReference {
  id: string;
  uri: string;
  type: "file" | "volume" | "external";
  relativePath?: string;
  contentHash?: string;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeoRegion extends GeoPoint {
  radiusKm?: number;
  name?: string;
}

export interface MediaAsset {
  id: string;
  uri: string;
  mediaType: MediaType;
  name: string;
  source?: { device?: string; manufacturer?: string; application?: string };
  capturedAt?: string;
  capturedAtConfidence?: number;
  capturedAtSource?: string;
  timezone?: string;
  duration?: number;
  dimensions?: { width: number; height: number };
  frameRate?: number;
  codec?: string;
  colorSpace?: string;
  hdr?: boolean;
  contentHash?: string;
  perceptualHash?: string;
  tags: string[];
  rating?: number;
  state: { favorite?: boolean; rejected?: boolean; locked?: boolean };
  /** Extension keys should be namespaced, e.g. openfilm.audio.transcript. */
  metadata: Record<string, unknown>;
  thumbnailUri?: string;
  proxyUri?: string;
  gps?: GeoPoint;
}

export interface MediaLibrary {
  id: string;
  uri: string;
  name: string;
}

export interface ProjectSettings {
  width: number;
  height: number;
  frameRate: number;
}

/** Film content is independent of the desktop interface language. */
export const PROJECT_CONTENT_LOCALES = ["en-US", "zh-TW", "ja-JP"] as const;
export type ProjectContentLocale = (typeof PROJECT_CONTENT_LOCALES)[number];
export type TextSource = "template" | "user";

/** Persisted creation defaults; templates remain external to the core model. */
export interface FilmSettings {
  templateId: string;
  targetDuration: number;
  maxDuration: number;
}

export type StoryConstraint =
  | { type: "must-include" | "must-exclude"; assetIds: string[] }
  | { type: "chronological"; enabled?: boolean }
  | { type: "asset-order"; assetIds: string[] };

export interface StoryBeat {
  id: string;
  title: string;
  intent?: string;
  /** Stable content identity; never derive this from the displayed title. */
  templateBeatKey?: string;
  /** Absent provenance is legacy/user content and must remain unchanged. */
  titleSource?: TextSource;
  intentSource?: TextSource;
  targetDuration?: number;
  minDuration?: number;
  maxDuration?: number;
  candidateAssetIds?: string[];
  selectedAssetIds?: string[];
  constraints?: StoryConstraint[];
}

export interface Story {
  id: string;
  title: string;
  template?: string;
  targetDuration?: number;
  maxDuration?: number;
  beats: StoryBeat[];
}

export interface ClipTransform {
  /**
   * Visual geometry follows the shared OpenFilm geometry contract:
   * contain-fit source -> scale -> clockwise rotation -> frame-pixel x/y -> clip.
   */
  scale?: number;
  rotation?: number;
  x?: number;
  y?: number;
  speed?: number;
  volume?: number;
}

export interface Clip {
  id: string;
  assetId: string;
  beatId?: string;
  sourceIn?: number;
  sourceOut?: number;
  timelineStart: number;
  timelineDuration: number;
  transform?: ClipTransform;
  title?: string;
  /** Protect source selection and edits; ripple timeline positioning remains allowed. */
  locked?: boolean;
  transition?: { type: "crossfade"; duration: number };
}

export interface Track {
  id: string;
  type: "video" | "audio" | "music" | "titles" | "overlay";
  clips: Clip[];
}

export interface Composition {
  id: string;
  storyId: string;
  duration: number;
  tracks: Track[];
}

export const PROJECT_SCHEMA_VERSION = "1.0.0" as const;

export interface OpenFilmProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  mediaLibraries: MediaLibrary[];
  stories: Story[];
  timelines: Composition[];
  settings: ProjectSettings;
  /** Legacy projects without this field use en-US for newly generated text. */
  projectContentLocale?: ProjectContentLocale;
  filmSettings?: FilmSettings;
}

export interface Event {
  id: string;
  startAt?: string;
  endAt?: string;
  assetIds: string[];
  labels: string[];
  confidence?: number;
  location?: GeoRegion;
}

export interface SimilarityGroup {
  id: string;
  kind: "exact" | "perceptual";
  assetIds: string[];
  confidence: number;
}

export type JobStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";

/** Local review execution identity; unknown or foreign owners are never assumed dead. */
export interface ReviewExecutionOwner {
  host: string;
  pid: number;
  token: string;
}

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  progress?: number;
  /** Source-scoped analysis jobs share the same durable Activity model. */
  assetId?: string;
  stage?: string;
  execution?: "cpu" | "gpu";
  model?: string;
  language?: string;
  fallbackReason?: string;
  reviewOwner?: ReviewExecutionOwner;
  /** Local execution identity for transcription, waveform and scene analysis. */
  analysisOwner?: ReviewExecutionOwner;
  errors?: {
    uri: string;
    stage: string;
    message: string;
    code?: string;
    params?: Record<string, string | number>;
    detail?: string;
  }[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ScoreResult {
  score: number;
  factors: { id: string; score: number; reason?: string }[];
}

export interface StoryContext {
  assets?: MediaAsset[];
  preferredTags?: string[];
  eventAssetIds?: string[];
  weights?: Record<string, number>;
}

/** Browser-safe ID generation; adapters may supply their own IDs. */
export function createId(prefix = ""): string {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return prefix ? `${prefix}-${id}` : id;
}

export function createProject(title: string): OpenFilmProject {
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("Project title must be a non-empty string.");
  }
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId("project"),
    title: title.trim(),
    createdAt: now,
    updatedAt: now,
    mediaLibraries: [],
    stories: [],
    timelines: [],
    settings: { width: 1920, height: 1080, frameRate: 30 },
  };
}
