// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
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

export interface ProjectTimebaseV1 {
  version: 1;
  rateNumerator: number;
  rateDenominator: number;
  dropFrame: boolean;
}

export interface ProjectSettings {
  width: number;
  height: number;
  frameRate: number;
  /** Absent in legacy schema-1 projects; derive without persisting on read. */
  timebase?: ProjectTimebaseV1;
}

/** Render-only output intent; never persisted in project settings or edit history. */
export interface ExportProfile {
  version: 1;
  ratio: "16:9" | "9:16" | "1:1";
  width: number;
  height: number;
  frameRate: number;
  framing: "contain" | "crop";
  /** Crop explicitly requests human review because captions may leave the safe area. */
  subtitleStrategy: "preserve" | "review-crop";
  format: "mp4" | "png" | "wav" | "audio-stems";
  quality: "standard" | "high-detail";
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

/** Saved with the script itself so a retry can reconcile catalog commit ambiguity. */
export interface SceneScriptReviewReceipt {
  suggestionId: string;
  requestId: string;
  evidenceHash: string;
  acceptedRevisionId: string;
  acceptedAt: string;
}

export type StoryConstraint =
  | { type: "must-include" | "must-exclude"; assetIds: string[] }
  | { type: "chronological"; enabled?: boolean }
  | { type: "asset-order"; assetIds: string[] };

export interface StoryBeat {
  id: string;
  title: string;
  intent?: string;
  /** Editable planning text; never a claim that narration or motion was rendered. */
  script?: { narration: string; visualDirection: string };
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
  /** Optional Story Graph perspective content. */
  graph?: import("./story-graph.js").StoryGraph;
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

/** Coordinates are normalized against the decoded display-oriented source. */
export interface PhotoFocalPoint {
  x: number;
  y: number;
}
export interface PhotoProtectedRegion extends PhotoFocalPoint {
  width: number;
  height: number;
}
export interface PhotoLayout {
  version: 1;
  preset: "contain" | "hero" | "diptych";
  focalPoint?: PhotoFocalPoint;
  protectedRegion?: PhotoProtectedRegion;
  secondary?: {
    assetId: string;
    focalPoint?: PhotoFocalPoint;
    protectedRegion?: PhotoProtectedRegion;
  };
  /** Space between diptych cells, in composition pixels. */
  gap?: number;
}
export interface PhotoMotionTransform {
  /** Supported zoom range is 1–10, matching the deterministic renderer adapter. */
  scale: number;
  /** Composition-frame pixels, applied around the frame center. */
  x: number;
  y: number;
}
export interface PhotoMotion {
  version: 1;
  preset: "hold" | "push-in" | "pull-out" | "pan";
  easing: "linear" | "ease-in-out";
  from: PhotoMotionTransform;
  to: PhotoMotionTransform;
}

/** Accepted direction evidence is retained in a bounded project history. */
export const MAX_SCENE_DIRECTION_RECEIPTS = 100;

interface SceneDirectionReceiptActionBase {
  id: string;
  clipId: string;
  evidence: string;
}

/** Each action stores one presentation change and its exact before/after evidence. */
export type SceneDirectionReceiptAction = SceneDirectionReceiptActionBase &
  (
    | {
        kind: "layout";
        reason: "contain" | "hero";
        before: PhotoLayout | null;
        after: PhotoLayout;
        command: {
          type: "presentation";
          clipId: string;
          layout: PhotoLayout;
          motion?: never;
        };
      }
    | {
        kind: "motion";
        reason: "hold" | "push-in" | "pan";
        before: PhotoMotion | null;
        after: PhotoMotion;
        command: {
          type: "presentation";
          clipId: string;
          layout?: never;
          motion: PhotoMotion;
        };
      }
  );

/** A durable acceptance receipt also reconciles retries after ambiguous catalog writes. */
export interface SceneDirectionReceipt {
  version: 1;
  /** A deterministic preview may be accepted again through a new request after Undo. */
  planId: string;
  requestId: string;
  fingerprint: string;
  compositionId: string;
  storyId: string;
  beatId: string;
  baseRevision: string;
  contextSignature: string;
  acceptedAt: string;
  acceptedRevision: string;
  sourceText: string;
  actions: SceneDirectionReceiptAction[];
}

export interface TitleStyle {
  version: 1;
  role: "film-title" | "scene-statement" | "subtitle";
  fontFamily?: string;
  /** Font dimensions, tracking and maximum width use composition pixels. */
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  tracking?: number;
  maxWidth?: number;
  align?: "left" | "center" | "right";
  background?: "none" | "scrim";
  position?: "center" | "bottom";
  /** Fade the title and its scrim over the final local timeline seconds; 0..10. */
  fadeOut?: number;
  /** Visible title/scrim distance above the frame bottom as a fraction; 0..0.3. */
  bottomSafeMargin?: number;
  /** Optional fractional safe-frame margins; absent values retain title defaults. */
  safeArea?: { left?: number; right?: number; top?: number; bottom?: number };
  finishing?: import("./title-runs.js").TitleFinishing;
}

export type CaptionCueSource =
  | { kind: "manual" }
  | {
      kind: "transcript";
      assetId: string;
      transcriptId: string;
      transcriptRevisionId: string;
      segmentId: string;
      clipId: string;
      /** Transcript-derived timing remains segment-aligned, never word-inferred. */
      alignment: "segment";
      sourceIn: number;
      sourceOut: number;
    };
export type CaptionCueWarning = "timing-estimated" | "alignment-stale";

export interface CaptionCue {
  version: 1;
  /** Stable identity survives text/time/style edits and transcript refreshes. */
  id: string;
  /** Composition time in integer milliseconds. */
  startMs: number;
  endMs: number;
  text: string;
  textRuns?: import("./title-runs.js").TitleTextRuns;
  source: CaptionCueSource;
  /** Explicit manual-review reasons inherited from transcript mapping. */
  warnings?: CaptionCueWarning[];
  /** Incremented for each manual text or timing revision. */
  manualRevision: number;
}

export interface CaptionTrack {
  version: 1;
  id: string;
  name: string;
  language?: string;
  style: TitleStyle;
  cues: CaptionCue[];
}
export interface AudioAutomation {
  version: 1;
  role: "music" | "narration" | "ambience" | "dialogue";
  /** Times use local timeline seconds; all gains are linear values from 0 to 1. */
  fadeIn?: number;
  fadeOut?: number;
  points?: { time: number; gain: number }[];
  /** Attack and release are included inside each ducking region. */
  ducking?: {
    start: number;
    end: number;
    gain: number;
    attack: number;
    release: number;
  }[];
}

/** Stable creative recipes; names shown in the product are translated separately. */
export const FILM_LOOK_PRESET_IDS = [
  "none",
  "soft-film",
  "americana",
  "clean-camera",
  "retro",
  "natural",
  "sport",
] as const;
export interface FilmLook {
  version: 1;
  preset: (typeof FILM_LOOK_PRESET_IDS)[number];
  /** Recipe-strength interpolation on decoded, encoded-SDR RGB, not linear-light color management. */
  strength: number;
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
  titleRuns?: import("./title-runs.js").TitleTextRuns;
  layout?: PhotoLayout;
  motion?: PhotoMotion;
  titleStyle?: TitleStyle;
  audioAutomation?: AudioAutomation;
  /** Absent inherits the scene/film look; explicit `none` preserves original color. */
  look?: FilmLook;
  /** Protect source selection and edits; ripple timeline positioning remains allowed. */
  locked?: boolean;
  transition?: { type: "crossfade"; duration: number };
}

export interface Track {
  id: string;
  type: "video" | "audio" | "music" | "titles" | "overlay";
  /** Overlay tracks never ripple the visual story when their clips change. */
  timing?: "overlay";
  clips: Clip[];
}

export interface Composition {
  id: string;
  storyId: string;
  duration: number;
  tracks: Track[];
  defaultLook?: FilmLook;
  /** Stable scene IDs keep localized or user-authored titles out of lookup state. */
  beatLooks?: { beatId: string; look: FilmLook }[];
  /** Composition-time captions are optional so legacy schema-1 projects stay valid. */
  captionTracks?: CaptionTrack[];
  /** Declarative Composition-time graphics; absent in legacy schema-1 projects. */
  graphicScenes?: import("./graphic-scenes.js").GraphicScene[];
  /** Optional provenance bindings for editable GraphicScene story templates. */
  graphicSceneTemplates?: import("./graphic-scene-templates.js").GraphicSceneTemplateRecord[];
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
  sceneScriptReviewReceipts?: SceneScriptReviewReceipt[];
  sceneDirectionReceipts?: SceneDirectionReceipt[];
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
  storyId?: string;
  beatId?: string;
  scriptField?: "narration" | "visualDirection";
  stage?: string;
  execution?: "cpu" | "gpu";
  model?: string;
  language?: string;
  fallbackReason?: string;
  reviewOwner?: ReviewExecutionOwner;
  /** Local execution identity for transcription, waveform and scene analysis. */
  analysisOwner?: ReviewExecutionOwner;
  /** Durable, project-local attempt state; removed from portable project packages. */
  attempt?: import("./multi-source.js").JobAttempt;
  /** Project-private preview preparation; excluded from portable catalogs. */
  proxyCache?: import("./proxy-cache.js").ProxyCacheTask;
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
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      timebase: {
        version: 1,
        rateNumerator: 30,
        rateDenominator: 1,
        dropFrame: false,
      },
    },
  };
}
