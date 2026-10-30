import type { MediaAsset } from "@openfilm/core";
export * from "./snapping.js";
import {
  assertProviderConsent,
  RemoteProviderConsentError,
  validateProviderDescriptor,
  validateRemoteProviderConsent,
  type AIProvider,
  type AudioGenerationProvider,
  type AudioGenerationResult,
  type MotionGenerationProvider,
  type MotionGenerationInput,
  type MotionGenerationResult,
  type EmbeddingProvider,
  type LanguageProvider,
  type OperationOptions,
  type ProviderDataKind,
  type RemoteProviderConsent,
  type TranscriptionProvider,
  type TranscriptionOptions,
  type TranscriptionResult,
  type VisionProvider,
  type VisionResult,
  type VisionSampleInput,
  type VisionSampleProvider,
  type VisionSampleResult,
} from "@openfilm/plugin-sdk";

export function dataKindsForAsset(asset: MediaAsset): ProviderDataKind[] {
  const kinds: ProviderDataKind[] = ["metadata"];
  if (asset.mediaType === "image") kinds.push("images");
  else if (asset.mediaType === "audio") kinds.push("audio");
  else kinds.push("video");
  if (asset.gps) kinds.push("gps");
  if (
    Object.keys(asset.metadata).some((key) => /(?:^|\.)faces(?:\.|$)/.test(key))
  )
    kinds.push("faces");
  if (
    Object.keys(asset.metadata).some((key) =>
      /(?:^|\.)(?:transcript|transcripts)(?:\.|$)/.test(key),
    )
  )
    kinds.push("transcripts");
  return kinds;
}

/**
 * Registration never enables a remote provider. Each invocation checks the
 * provider's declared destination and the user's scoped consent before calling it.
 * No default cloud provider, credentials, HTTP client, or network call is included.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();
  private readonly originals = new Map<string, AIProvider>();
  private readonly consents = new Map<string, RemoteProviderConsent>();

  register(provider: AIProvider): void {
    validateProviderDescriptor(provider);
    if (this.providers.has(provider.id))
      throw new Error(
        `Provider ${provider.id} is already registered. Unregister it before replacing its destination or capabilities.`,
      );
    const methods = {
      vision: "analyze",
      "vision-sample": "analyzeSample",
      embedding: "embed",
      transcription: "transcribe",
      language: "generate",
      "audio-generation": "generateAudio",
      "motion-generation": "generateMotion",
    } as const;
    const method = methods[provider.kind];
    if (
      !method ||
      typeof (provider as unknown as Record<string, unknown>)[method] !==
        "function"
    )
      throw new Error("Provider kind must match its implemented operation.");
    // Snapshot the declared destination and capabilities to prevent later mutation.
    const dataKinds = [...provider.dataKinds];
    Object.freeze(dataKinds);
    const snapshot = Object.freeze({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      execution: provider.execution,
      dataKinds,
      ...(provider.endpoint === undefined
        ? {}
        : { endpoint: provider.endpoint }),
      [method]: (
        (provider as unknown as Record<string, unknown>)[method] as (
          ...args: unknown[]
        ) => unknown
      ).bind(provider),
    }) as AIProvider;
    this.providers.set(provider.id, snapshot);
    this.originals.set(provider.id, provider);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
    this.originals.delete(providerId);
    this.consents.delete(providerId);
  }

  list(): {
    id: string;
    name: string;
    kind: AIProvider["kind"];
    execution: AIProvider["execution"];
    endpoint?: string;
    dataKinds: ProviderDataKind[];
    enabled: boolean;
  }[] {
    return [...this.providers.values()].map((provider) => {
      let enabled = false;
      try {
        // Readiness shares the invocation gate, including descriptor integrity
        // and consent invalidation, without invoking the provider or sending data.
        this.authorized(provider.id, provider.kind, []);
        enabled = true;
      } catch {
        /* An ineligible registration remains visible but cannot be invoked. */
      }
      return {
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        execution: provider.execution,
        ...(provider.endpoint === undefined
          ? {}
          : { endpoint: provider.endpoint }),
        dataKinds: [...provider.dataKinds],
        enabled,
      };
    });
  }

  grantConsent(value: RemoteProviderConsent): void {
    const consent = validateRemoteProviderConsent(value);
    const provider = this.providers.get(consent.providerId);
    if (!provider) throw new Error(`Unknown provider ${consent.providerId}.`);
    if (provider.execution !== "remote")
      throw new RemoteProviderConsentError(
        "Local providers do not require remote consent.",
      );
    assertProviderConsent(provider, consent);
    this.consents.set(provider.id, consent);
  }

  revokeConsent(providerId: string): void {
    this.consents.delete(providerId);
  }

  getConsent(providerId: string): RemoteProviderConsent | undefined {
    const consent = this.consents.get(providerId);
    return consent
      ? { ...consent, dataKinds: [...consent.dataKinds] }
      : undefined;
  }

  async analyzeVision(
    providerId: string,
    asset: MediaAsset,
    options?: OperationOptions,
  ): Promise<VisionResult> {
    const provider = this.authorized(
      providerId,
      "vision",
      dataKindsForAsset(asset),
    ) as VisionProvider;
    return provider.analyze(asset, options);
  }

  async analyzeVisionSample(
    providerId: string,
    input: VisionSampleInput,
    options?: OperationOptions,
  ): Promise<VisionSampleResult> {
    const sample = validateVisionSampleInput(input);
    const provider = this.authorized(providerId, "vision-sample", [
      "images",
      "metadata",
    ]) as VisionSampleProvider;
    if (options?.signal?.aborted)
      throw Object.assign(new Error("Vision sample analysis cancelled."), {
        name: "AbortError",
      });
    const result = await provider.analyzeSample(sample, options);
    if (options?.signal?.aborted)
      throw Object.assign(new Error("Vision sample analysis cancelled."), {
        name: "AbortError",
      });
    return validateVisionSampleResult(result);
  }

  async embed(
    providerId: string,
    asset: MediaAsset,
    options?: OperationOptions,
  ): Promise<number[]> {
    const provider = this.authorized(
      providerId,
      "embedding",
      dataKindsForAsset(asset),
    ) as EmbeddingProvider;
    return provider.embed(asset, options);
  }

  async transcribe(
    providerId: string,
    asset: MediaAsset,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    const dataKinds = dataKindsForAsset(asset);
    if (options?.promptHints?.length) dataKinds.push("text");
    const provider = this.authorized(providerId, "transcription", [
      ...new Set(dataKinds),
    ]) as TranscriptionProvider;
    return provider.transcribe(asset, options);
  }

  async generate(
    providerId: string,
    prompt: string,
    options?: OperationOptions,
    dataKinds: ProviderDataKind[] = ["text"],
  ): Promise<string> {
    const provider = this.authorized(providerId, "language", [
      ...new Set<ProviderDataKind>(["text", ...dataKinds]),
    ]) as LanguageProvider;
    return provider.generate(prompt, options);
  }

  async generateAudio(
    providerId: string,
    text: string,
    options?: OperationOptions,
  ): Promise<AudioGenerationResult> {
    const provider = this.authorized(providerId, "audio-generation", [
      "text",
    ]) as AudioGenerationProvider;
    return provider.generateAudio(text, options);
  }

  async generateMotion(
    providerId: string,
    input: MotionGenerationInput,
    options?: OperationOptions,
  ): Promise<MotionGenerationResult> {
    const kinds: ProviderDataKind[] = ["text"];
    if (input.image) kinds.push("images");
    if (input.video) kinds.push("video");
    const provider = this.authorized(
      providerId,
      "motion-generation",
      kinds,
    ) as MotionGenerationProvider;
    return provider.generateMotion(input, options);
  }

  private authorized(
    providerId: string,
    kind: AIProvider["kind"],
    dataKinds: ProviderDataKind[],
  ): AIProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown provider ${providerId}.`);
    const original = this.originals.get(providerId);
    if (
      !original ||
      original.id !== provider.id ||
      original.kind !== provider.kind ||
      original.execution !== provider.execution ||
      original.endpoint !== provider.endpoint ||
      JSON.stringify(original.dataKinds) !== JSON.stringify(provider.dataKinds)
    ) {
      this.consents.delete(providerId);
      throw new RemoteProviderConsentError(
        `Provider ${providerId} changed its destination or capabilities. Register it again and obtain new consent.`,
      );
    }
    if (provider.kind !== kind)
      throw new Error(
        `Provider ${providerId} supports ${provider.kind}, not ${kind}.`,
      );
    assertProviderConsent(provider, this.consents.get(providerId), dataKinds);
    return provider;
  }
}

export const VISION_SAMPLE_LIMITS = Object.freeze({
  bytes: 512 * 1024,
  dimension: 2048,
  pixels: 2_097_152,
  labels: 100,
});

function validateVisionSampleInput(
  value: VisionSampleInput,
): VisionSampleInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Vision sample input must be an object.");
  const allowed = new Set([
    "sampleId",
    "assetId",
    "sourceHash",
    "sourceTimeRange",
    "width",
    "height",
    "mimeType",
    "bytes",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error(
      "Vision providers accept sample fields only; whole-media and URI fields are forbidden.",
    );
  for (const [name, text] of [
    ["sample ID", value.sampleId],
    ["asset ID", value.assetId],
  ] as const)
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 256 ||
      hasControlCharacters(text)
    )
      throw new Error(`Vision ${name} is invalid.`);
  if (!/^[a-f0-9]{64}$/u.test(value.sourceHash))
    throw new Error("Vision sample source hash is invalid.");
  if (
    !value.sourceTimeRange ||
    !Number.isFinite(value.sourceTimeRange.start) ||
    !Number.isFinite(value.sourceTimeRange.end) ||
    value.sourceTimeRange.start < 0 ||
    value.sourceTimeRange.end < value.sourceTimeRange.start ||
    value.sourceTimeRange.end - value.sourceTimeRange.start > 1
  )
    throw new Error("Vision sample source time range is invalid.");
  if (
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    value.width < 1 ||
    value.height < 1 ||
    value.width > VISION_SAMPLE_LIMITS.dimension ||
    value.height > VISION_SAMPLE_LIMITS.dimension ||
    value.width * value.height > VISION_SAMPLE_LIMITS.pixels
  )
    throw new Error("Vision sample dimensions exceed the bounded image limit.");
  if (
    !(value.bytes instanceof Uint8Array) ||
    value.bytes.byteLength < 4 ||
    value.bytes.byteLength > VISION_SAMPLE_LIMITS.bytes
  )
    throw new Error(
      "Vision sample image bytes are invalid or exceed the 512 KiB limit.",
    );
  const bytes = value.bytes;
  const signatureOk =
    value.mimeType === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : value.mimeType === "image/png"
        ? bytes[0] === 0x89 &&
          bytes[1] === 0x50 &&
          bytes[2] === 0x4e &&
          bytes[3] === 0x47
        : value.mimeType === "image/webp"
          ? String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
            String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
          : false;
  if (!signatureOk)
    throw new Error("Vision sample MIME type does not match its image bytes.");
  return {
    ...value,
    sourceTimeRange: { ...value.sourceTimeRange },
    bytes: bytes.slice(),
  };
}

function validateVisionSampleResult(value: unknown): VisionSampleResult {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "labels")
  )
    throw new Error("Vision provider returned an invalid sample result.");
  const labels = (value as { labels?: unknown }).labels;
  if (!Array.isArray(labels) || labels.length > VISION_SAMPLE_LIMITS.labels)
    throw new Error("Vision provider returned too many labels.");
  return {
    labels: labels.map((candidate) => {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate) ||
        Object.keys(candidate).some(
          (key) => key !== "label" && key !== "confidence",
        )
      )
        throw new Error("Vision provider returned an invalid label.");
      const item = candidate as { label?: unknown; confidence?: unknown };
      if (
        typeof item.label !== "string" ||
        !item.label.trim() ||
        item.label.length > 128 ||
        hasControlCharacters(item.label) ||
        typeof item.confidence !== "number" ||
        !Number.isFinite(item.confidence) ||
        item.confidence < 0 ||
        item.confidence > 1
      )
        throw new Error("Vision provider label fields are invalid.");
      return { label: item.label, confidence: item.confidence };
    }),
  };
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 32 || codePoint === 127) return true;
  }
  return false;
}
