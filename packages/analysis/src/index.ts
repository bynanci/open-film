import type { MediaAsset } from "@openfilm/core";
export * from "./snapping.js";
import {
  assertProviderConsent,
  RemoteProviderConsentError,
  validateProviderDescriptor,
  validateRemoteProviderConsent,
  type AIProvider,
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
      embedding: "embed",
      transcription: "transcribe",
      language: "generate",
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
    return [...this.providers.values()].map((provider) => ({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      execution: provider.execution,
      ...(provider.endpoint === undefined
        ? {}
        : { endpoint: provider.endpoint }),
      dataKinds: [...provider.dataKinds],
      enabled: provider.execution === "local" || this.consents.has(provider.id),
    }));
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
    const provider = this.authorized(
      providerId,
      "transcription",
      dataKindsForAsset(asset),
    ) as TranscriptionProvider;
    return provider.transcribe(asset, options);
  }

  async generate(
    providerId: string,
    prompt: string,
    options?: OperationOptions,
  ): Promise<string> {
    const provider = this.authorized(providerId, "language", [
      "text",
    ]) as LanguageProvider;
    return provider.generate(prompt, options);
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
