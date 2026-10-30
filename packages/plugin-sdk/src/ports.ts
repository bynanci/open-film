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
  onSkipped?: (notice: {
    reason: "symlink" | "unsupported" | "outside-root";
    relativePath?: string;
  }) => void;
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
  /** Portable path relative to the selected logical root; never an absolute locator. */
  relativePath?: string;
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

/**
 * Additive streaming contract. Existing v1 adapters keep their `scan` API;
 * adapters with large roots should implement this interface so consumers can
 * apply backpressure without materializing the full candidate list.
 */
export interface MediaSourceAdapterV2 {
  id: string;
  supports(input: SourceInput): boolean;
  discover(
    input: SourceInput,
    options?: OperationOptions,
  ): AsyncIterable<MediaCandidate>;
  extractMetadata(
    candidate: MediaCandidate,
    options?: OperationOptions,
  ): Promise<MediaMetadata>;
}

export type CompatibleMediaSourceAdapter =
  MediaSourceAdapter | MediaSourceAdapterV2;

function checkDiscoveryAbort(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw Object.assign(new Error("Operation cancelled"), {
      name: "AbortError",
    });
}

function validMediaCandidate(value: unknown): value is MediaCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<MediaCandidate>;
  return (
    typeof candidate.uri === "string" &&
    candidate.uri.length > 0 &&
    candidate.uri.length <= 16_384 &&
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    candidate.name.length <= 1024 &&
    (candidate.relativePath === undefined ||
      (typeof candidate.relativePath === "string" &&
        candidate.relativePath.length <= 16_384 &&
        !candidate.relativePath.startsWith("/") &&
        !candidate.relativePath.split(/[\\/]/u).includes("..")))
  );
}

/**
 * Present v1 and v2 adapters through one async interface. The v1 compatibility
 * branch necessarily receives the adapter's array, while v2 remains lazy and
 * stops requesting items as soon as the consumer applies backpressure.
 */
export async function* iterateMediaCandidates(
  adapter: CompatibleMediaSourceAdapter,
  input: SourceInput,
  options: OperationOptions = {},
): AsyncGenerator<MediaCandidate> {
  if (!adapter.supports(input))
    throw new Error(`Source adapter ${adapter.id} does not support this input`);
  checkDiscoveryAbort(options.signal);
  const candidates =
    "discover" in adapter
      ? adapter.discover(input, options)
      : await adapter.scan(input, options);
  if (
    !candidates ||
    typeof (candidates as AsyncIterable<unknown>)[Symbol.asyncIterator] !==
      "function"
  ) {
    if (!Array.isArray(candidates))
      throw new Error(
        `Source adapter ${adapter.id} returned invalid discovery data`,
      );
  }
  for await (const candidate of candidates as
    Iterable<unknown> | AsyncIterable<unknown>) {
    checkDiscoveryAbort(options.signal);
    if (!validMediaCandidate(candidate))
      throw new Error(
        `Source adapter ${adapter.id} returned an invalid media candidate`,
      );
    yield candidate;
  }
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

/** A bounded representative frame. This contract intentionally has no media URI or whole asset. */
export interface VisionSampleInput {
  sampleId: string;
  assetId: string;
  sourceHash: string;
  sourceTimeRange: { start: number; end: number };
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
}

export interface VisionSampleResult {
  labels: { label: string; confidence: number }[];
}

/** Separate provider capability: unrestricted VisionProvider is not sample-safe. */
export interface VisionSampleProvider extends AIProviderDescriptor {
  kind: "vision-sample";
  analyzeSample(
    input: VisionSampleInput,
    options?: OperationOptions,
  ): Promise<VisionSampleResult>;
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

export interface AudioGenerationResult {
  bytes: Uint8Array;
  model: string;
  mock: boolean;
}
export interface AudioGenerationProvider extends AIProviderDescriptor {
  kind: "audio-generation";
  generateAudio(
    text: string,
    options?: OperationOptions,
  ): Promise<AudioGenerationResult>;
}

/** Trusted adapter port. Bytes only: output URLs and project-authored code are never accepted. */
export interface MotionGenerationInput {
  image?: Uint8Array;
  video?: Uint8Array;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  variant: number;
  prompt: string;
  negativeConstraints: string;
}
export interface MotionGenerationResult {
  bytes: Uint8Array;
  model: string;
  mock: boolean;
}
export interface MotionGenerationProvider extends AIProviderDescriptor {
  kind: "motion-generation";
  generateMotion(
    input: MotionGenerationInput,
    options?: OperationOptions,
  ): Promise<MotionGenerationResult>;
}

export type AIProvider =
  | VisionProvider
  | VisionSampleProvider
  | EmbeddingProvider
  | TranscriptionProvider
  | LanguageProvider
  | AudioGenerationProvider
  | MotionGenerationProvider;

/** Consent is scoped to a named provider and its disclosed data classes. */
export interface RemoteProviderConsent {
  providerId: string;
  dataKinds: ProviderDataKind[];
  grantedAt: string;
}
