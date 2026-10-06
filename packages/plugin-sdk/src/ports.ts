import type {
  Composition,
  Event,
  MediaAsset,
  MediaType,
  ProjectContentLocale,
  ProjectSettings,
  ScoreResult,
  SimilarityGroup,
  Story,
  StoryContext,
} from "@openfilm/core";

export type Awaitable<T> = T | Promise<T>;

/** Cooperative cancellation is portable across browser and local adapters. */
export interface OperationOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface SourceInput {
  uri: string;
  type?: "file" | "folder" | "volume" | "external";
  options?: Record<string, unknown>;
}

export interface MediaCandidate {
  id?: string;
  uri: string;
  name: string;
  mediaType?: MediaType;
  size?: number;
  modifiedAt?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

export type MediaMetadata = Partial<
  Omit<MediaAsset, "id" | "uri" | "name" | "tags" | "state">
>;

export interface MediaSourceAdapter {
  id: string;
  supports(input: SourceInput): boolean;
  scan(
    input: SourceInput,
    options?: OperationOptions,
  ): Promise<MediaCandidate[]>;
  extractMetadata(
    candidate: MediaCandidate,
    options?: OperationOptions,
  ): Promise<MediaMetadata>;
}

export interface TimestampResolution {
  timestamp?: string;
  source: string;
  confidence: number;
  timezone?: string;
  timezoneUncertain?: boolean;
  originalValue?: string;
}

export interface TimestampResolver {
  id: string;
  resolve(
    input: Record<string, unknown>,
    fallbackMtime?: string,
  ): Awaitable<TimestampResolution>;
}

export interface MetadataProvider {
  id: string;
  supports(candidate: MediaCandidate): boolean;
  extract(
    candidate: MediaCandidate,
    options?: OperationOptions,
  ): Promise<MediaMetadata>;
}

export interface SimilarityProvider {
  id: string;
  findDuplicates(
    assets: MediaAsset[],
    options?: OperationOptions,
  ): Awaitable<SimilarityGroup[]>;
}

export interface AnalysisResult {
  events?: Event[];
  duplicates?: SimilarityGroup[];
  /** Namespaced metadata additions keyed by asset ID; originals are untouched. */
  assetMetadata?: Record<string, Record<string, unknown>>;
}

export interface AnalysisProvider {
  id: string;
  analyze(
    assets: MediaAsset[],
    options?: OperationOptions,
  ): Awaitable<AnalysisResult>;
}

export interface StoryTemplateConfig {
  title?: string;
  targetDuration?: number;
  maxDuration?: number;
  assetIds?: string[];
  contentLocale?: ProjectContentLocale;
}

export interface TemplateBeatText {
  title: string;
  intent?: string;
}

export interface StoryTemplate {
  id: string;
  name: string;
  description: string;
  defaults?: { targetDuration: number; maxDuration: number };
  getBeatText?(
    key: string,
    locale: ProjectContentLocale,
  ): TemplateBeatText | undefined;
  create(config: StoryTemplateConfig): Story;
}

export interface AssetScorer {
  id: string;
  score(asset: MediaAsset, context: StoryContext): Awaitable<ScoreResult>;
}

export interface CompositionSolver {
  id: string;
  compose(
    story: Story,
    assets: MediaAsset[],
    options?: OperationOptions,
  ): Awaitable<Composition>;
}

export interface RenderResult {
  uri: string;
  duration: number;
}

export interface CompositionRenderer {
  id: string;
  render(
    composition: Composition,
    assets: MediaAsset[],
    settings: ProjectSettings,
    options?: OperationOptions,
  ): Promise<RenderResult>;
}

export interface ExportResult {
  extension: string;
  content: string;
}

export interface TimelineExporter {
  id: string;
  export(
    composition: Composition,
    assets?: MediaAsset[],
    settings?: ProjectSettings,
  ): Awaitable<ExportResult>;
}

export type ProviderDataKind =
  | "images"
  | "video"
  | "audio"
  | "metadata"
  | "gps"
  | "faces"
  | "transcripts"
  | "text";

export interface AIProviderDescriptor {
  id: string;
  name: string;
  execution: "local" | "remote";
  /** The data classes the provider may receive. Consent must cover all classes. */
  dataKinds: ProviderDataKind[];
  /** Declared for clear disclosure before a remote provider is enabled. */
  endpoint?: string;
}

export interface VisionResult {
  labels: { label: string; confidence: number }[];
  metadata?: Record<string, unknown>;
}

export interface VisionProvider extends AIProviderDescriptor {
  kind: "vision";
  analyze(asset: MediaAsset, options?: OperationOptions): Promise<VisionResult>;
}

export interface EmbeddingProvider extends AIProviderDescriptor {
  kind: "embedding";
  embed(asset: MediaAsset, options?: OperationOptions): Promise<number[]>;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  segments?: {
    id?: string;
    start: number;
    end: number;
    text: string;
    words?: { start: number; end: number; text: string; confidence?: number }[];
  }[];
  execution?: "cpu" | "gpu";
  model?: string;
  version?: string;
  fallbackReason?: string;
}

export type TranscriptionStage =
  | "extracting-audio"
  | "loading-model"
  | "transcribing"
  | "post-processing"
  | "indexing";
export interface TranscriptionOptions extends OperationOptions {
  language?: "auto" | "zh" | "en" | "ja";
  modelPath?: string;
  execution?: "auto" | "cpu" | "gpu";
  onStage?: (stage: TranscriptionStage) => void;
  /** Optional terminology context, never automatic transcript replacements. */
  promptHints?: string[];
}

export interface TranscriptionProvider extends AIProviderDescriptor {
  kind: "transcription";
  capabilities?: {
    wordTimestamps: boolean;
    languages: string[];
    cpuFallback: boolean;
    supportsPromptHints?: boolean;
  };
  transcribe(
    asset: MediaAsset,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult>;
}

export interface LanguageProvider extends AIProviderDescriptor {
  kind: "language";
  generate(prompt: string, options?: OperationOptions): Promise<string>;
}

export type AIProvider =
  VisionProvider | EmbeddingProvider | TranscriptionProvider | LanguageProvider;

/** Consent is scoped to a named provider and its disclosed data classes. */
export interface RemoteProviderConsent {
  providerId: string;
  dataKinds: ProviderDataKind[];
  grantedAt: string;
}
