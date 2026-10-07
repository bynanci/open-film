import { lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  ApplicationError,
  errorInfo,
  validateTranscriptDocument,
  type Job,
  type MediaAsset,
  type TimelineMarker,
} from "@openfilm/core";
import type { ProjectCatalog } from "@openfilm/catalog";
import { ProviderRegistry } from "@openfilm/analysis";
import type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "@openfilm/plugin-sdk";
import { LocalWhisperProvider } from "@openfilm/provider-whisper";
import { cancellableProviderResult } from "./cancellable-provider-result.js";
import {
  checkAbort,
  hashFile,
  localPath,
  generateWaveform,
  detectScenes,
  WAVEFORM_CACHE_IDENTITY,
  sceneCacheIdentity,
} from "@openfilm/media";

export interface IntelligenceOptions extends TranscriptionOptions {
  operation: "transcribe" | "waveform" | "scenes";
  jobId?: string;
  onJob?: (job: Job) => void;
}

type TranscriptionMetadata = Pick<
  TranscriptionResult,
  "execution" | "model" | "version" | "language" | "fallbackReason"
>;

/** Plugins are runtime boundaries; adapter validation cannot protect other providers. */
function transcriptionMetadata(value: unknown): TranscriptionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApplicationError(
      "media.transcriptionFailed",
      "The transcription provider returned an invalid result.",
    );
  const result = value as Record<string, unknown>;
  const metadata: TranscriptionMetadata = {};
  for (const field of [
    "model",
    "version",
    "language",
    "fallbackReason",
  ] as const) {
    const text = result[field];
    if (text === undefined) continue;
    if (typeof text !== "string" || !text.trim())
      throw new ApplicationError(
        "media.transcriptionFailed",
        `The transcription provider returned invalid ${field} metadata.`,
      );
    metadata[field] = text;
  }
  const execution = result.execution;
  if (execution !== undefined) {
    if (execution !== "cpu" && execution !== "gpu")
      throw new ApplicationError(
        "media.transcriptionFailed",
        "The transcription provider returned an invalid execution mode.",
      );
    metadata.execution = execution;
  }
  return metadata;
}

/** Concrete local orchestration; portable results and provider ports remain shared. */
export class MediaIntelligence {
  private registry = new ProviderRegistry();
  private provider: TranscriptionProvider = new LocalWhisperProvider();
  private readonly identities = new Map<
    string,
    { stamp: string; hash: string }
  >();

  constructor(private readonly catalog: ProjectCatalog) {
    this.registry.register(this.provider);
  }

  registerTranscriptionProvider(provider: TranscriptionProvider): void {
    // Validate before replacing the active registry. A failed plugin registration
    // must preserve the working provider; successful replacement requires fresh consent.
    const registry = new ProviderRegistry();
    registry.register(provider);
    if (provider.kind !== "transcription")
      throw new Error("A transcription provider must implement transcription.");
    this.registry = registry;
    this.provider = provider;
  }

  /** Read the active capability without probing model availability. */
  get supportsTranscriptionPromptHints(): boolean {
    return this.provider.capabilities?.supportsPromptHints === true;
  }

  async providers() {
    const provider = this.provider;
    const enabled = this.registry
      .list()
      .some((entry) => entry.id === provider.id && entry.enabled);
    const readiness = !enabled
      ? {
          available: false,
          detail:
            "Transcription requires a valid provider registration and any required explicit consent.",
        }
      : provider instanceof LocalWhisperProvider
        ? await provider.available()
        : { available: true };
    return {
      transcription: {
        providerId: provider.id,
        execution: provider.execution,
        capabilities: provider.capabilities,
        ...readiness,
      },
    };
  }

  private asset(assetId: string): MediaAsset {
    const asset = this.catalog.getAsset(assetId);
    if (!asset)
      throw new ApplicationError("media.notFound", "Media not found.", 404);
    return asset;
  }

  private async identity(
    asset: MediaAsset,
    signal?: AbortSignal,
    fresh = false,
  ): Promise<string> {
    checkAbort(signal);
    let info;
    try {
      info = await lstat(localPath(asset.uri));
    } catch (error) {
      throw new ApplicationError(
        "media.missing",
        `Reconnect or find ${asset.name} before analyzing it.`,
        400,
        { name: asset.name },
        String(error),
      );
    }
    if (!info.isFile() || info.isSymbolicLink())
      throw new ApplicationError(
        "media.missing",
        "Analysis requires a regular local source file.",
        400,
        { name: asset.name },
      );
    const stamp = `${asset.uri}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    const cached = this.identities.get(asset.id);
    const hash =
      !fresh && cached?.stamp === stamp
        ? cached.hash
        : await hashFile(localPath(asset.uri), signal);
    if (asset.contentHash && hash !== asset.contentHash)
      throw new ApplicationError(
        "source.changed",
        `Import ${asset.name} again before analyzing changed media.`,
        409,
        { name: asset.name },
      );
    this.identities.set(asset.id, { stamp, hash });
    return hash;
  }

  sourceIdentity(assetId: string): Promise<string> {
    return this.identity(this.asset(assetId));
  }

  async read(
    assetId: string,
    options: { offset?: number; limit?: number } = {},
  ) {
    const asset = this.asset(assetId);
    const sourceHash = await this.identity(asset);
    const page = this.catalog.intelligence.getTranscriptPage(
      assetId,
      sourceHash,
      options,
    );
    return {
      sourceHash,
      transcript: page.document,
      transcriptTotal: page.total,
      transcriptOffset: page.offset,
      waveform: this.catalog.intelligence.getWaveform(
        assetId,
        sourceHash,
        WAVEFORM_CACHE_IDENTITY,
      ),
      scenes: this.catalog.intelligence.getScenes(
        assetId,
        sourceHash,
        sceneCacheIdentity(),
      ),
      markers: this.catalog.intelligence.listMarkers(
        assetId,
        sourceHash,
        sceneCacheIdentity(),
      ),
    };
  }

  async addMarker(
    assetId: string,
    time: number,
    label?: string,
  ): Promise<TimelineMarker> {
    const asset = this.asset(assetId);
    if (asset.mediaType !== "video" && asset.mediaType !== "audio")
      throw new ApplicationError(
        "media.unsupported",
        "Markers require playable audio or video.",
      );
    if (
      !Number.isFinite(time) ||
      time < 0 ||
      !asset.duration ||
      time > asset.duration
    )
      throw new ApplicationError(
        "request.invalid",
        "Marker must be inside the source duration.",
      );
    if (
      label !== undefined &&
      (typeof label !== "string" || label.length > 500)
    )
      throw new ApplicationError(
        "request.invalid",
        "Marker label must be at most 500 characters.",
      );
    const hash = await this.identity(asset);
    const marker: TimelineMarker = {
      id: randomUUID(),
      assetId,
      time,
      type: "manual",
      ...(label === undefined ? {} : { label }),
    };
    this.catalog.intelligence.saveManualMarker(marker, hash);
    return marker;
  }

  async removeMarker(assetId: string, markerId: string): Promise<void> {
    const hash = await this.identity(this.asset(assetId));
    this.catalog.intelligence.removeMarker(assetId, markerId, hash);
  }

  async run(assetId: string, options: IntelligenceOptions): Promise<Job> {
    const asset = this.asset(assetId);
    const now = new Date().toISOString();
    const job: Job = {
      id: options.jobId ?? randomUUID(),
      assetId,
      type: options.operation,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    let lastProgressWrite = 0;
    const notify = (force = true) => {
      if (!force && Date.now() - lastProgressWrite < 150) return;
      lastProgressWrite = Date.now();
      job.updatedAt = new Date().toISOString();
      this.catalog.saveJob(job);
      try {
        options.onJob?.(structuredClone(job));
      } catch {
        /* A progress observer cannot cancel or corrupt durable work. */
      }
    };
    notify();
    try {
      checkAbort(options.signal);
      if (asset.mediaType !== "audio" && asset.mediaType !== "video")
        throw new ApplicationError(
          "media.unsupported",
          "Choose playable audio or video for media analysis.",
        );
      if (!(asset.duration && asset.duration > 0))
        throw new ApplicationError(
          "media.unsupported",
          "Import the source again to obtain its duration.",
        );
      job.status = "running";
      job.stage = "checking-source";
      notify();
      const sourceHash = await this.identity(asset, options.signal, true);
      if (options.operation === "transcribe") {
        const expectedRevision =
          this.catalog.transcripts.get(assetId, sourceHash).revision ?? null;
        const provider = this.provider;
        const stages = [
          "extracting-audio",
          "loading-model",
          "transcribing",
          "post-processing",
          "indexing",
        ];
        let acceptingProviderProgress = true;
        let providerStageError: ApplicationError | undefined;
        let result: TranscriptionResult;
        try {
          result = await cancellableProviderResult(
            this.registry.transcribe(provider.id, asset, {
              ...options,
              promptHints: provider.capabilities?.supportsPromptHints
                ? options.promptHints
                : undefined,
              onStage: (stage) => {
                if (
                  !acceptingProviderProgress ||
                  providerStageError ||
                  options.signal?.aborted ||
                  job.status !== "running"
                )
                  return;
                if (!stages.includes(stage)) {
                  providerStageError = new ApplicationError(
                    "media.transcriptionFailed",
                    "The transcription provider reported an invalid stage.",
                  );
                  return;
                }
                job.stage = stage;
                job.progress = Math.max(
                  job.progress ?? 0,
                  0.1 + stages.indexOf(stage) * 0.15,
                );
                notify();
              },
              onProgress: (progress) => {
                if (
                  !acceptingProviderProgress ||
                  providerStageError ||
                  options.signal?.aborted ||
                  job.status !== "running"
                )
                  return;
                if (Number.isFinite(progress)) {
                  job.progress = Math.max(
                    job.progress ?? 0,
                    Math.min(0.85, progress * 0.85),
                  );
                  notify(false);
                }
              },
            }),
            options.signal,
          );
        } finally {
          // A plugin may retain callbacks; they must not outlive its invocation.
          acceptingProviderProgress = false;
        }
        checkAbort(options.signal);
        if (providerStageError) throw providerStageError;
        const metadata = transcriptionMetadata(result);
        if (
          provider.capabilities?.wordTimestamps &&
          result.segments?.some((s) => s.text.trim() && !s.words?.length)
        )
          throw new ApplicationError(
            "media.transcriptionFailed",
            "This transcription provider returned speech without word timing.",
          );
        const document = validateTranscriptDocument(
          {
            id: randomUUID(),
            assetId,
            language: metadata.language,
            provenance: {
              providerId: provider.id,
              model: metadata.model,
              version: "1",
              providerVersion: metadata.version,
              sourceHash,
              createdAt: new Date().toISOString(),
            },
            segments: (result.segments ?? []).map((s, index) => ({
              ...s,
              id: s.id ?? `segment-${index}`,
            })),
          },
          { duration: asset.duration },
        );
        if (result.text.trim() && !document.segments.length)
          throw new ApplicationError(
            "media.transcriptionFailed",
            "The provider returned text without timed segments.",
          );
        await this.checkUnchanged(asset, sourceHash, options.signal);
        job.stage = "indexing";
        job.execution = metadata.execution;
        job.model = metadata.model;
        job.language = metadata.language;
        job.fallbackReason = metadata.fallbackReason;
        notify();
        checkAbort(options.signal);
        this.catalog.intelligence.replaceTranscript(document, {
          expectedRevision,
        });
      } else if (options.operation === "waveform") {
        job.stage = "generating-waveform";
        notify();
        const cached = this.catalog.intelligence.getWaveform(
          assetId,
          sourceHash,
          WAVEFORM_CACHE_IDENTITY,
        );
        const waveform =
          cached ??
          (await generateWaveform(asset, sourceHash, {
            signal: options.signal,
            onProgress: (progress) => {
              job.progress = Math.min(0.9, progress);
              notify(false);
            },
          }));
        await this.checkUnchanged(asset, sourceHash, options.signal);
        this.catalog.intelligence.saveWaveform(waveform);
      } else if (options.operation === "scenes") {
        if (asset.mediaType !== "video")
          throw new ApplicationError(
            "media.unsupported",
            "Scene detection requires a video source.",
          );
        job.stage = "detecting-scenes";
        notify();
        const cached = this.catalog.intelligence.getScenes(
          assetId,
          sourceHash,
          sceneCacheIdentity(),
        );
        const scenes =
          cached ??
          (await detectScenes(asset, sourceHash, {
            signal: options.signal,
            onProgress: (progress) => {
              job.progress = Math.min(0.9, progress);
              notify(false);
            },
          }));
        await this.checkUnchanged(asset, sourceHash, options.signal);
        this.catalog.intelligence.saveScenes(scenes);
      } else
        throw new ApplicationError(
          "request.invalid",
          "Unknown analysis operation.",
        );
      job.status = "completed";
      job.stage = "completed";
      job.progress = 1;
    } catch (error) {
      job.status =
        options.signal?.aborted || (error as Error)?.name === "AbortError"
          ? "cancelled"
          : "failed";
      const fallback =
        options.operation === "transcribe"
          ? "media.transcriptionFailed"
          : options.operation === "waveform"
            ? "media.waveformFailed"
            : "media.sceneFailed";
      job.errors = [
        {
          uri: asset.uri,
          stage: job.stage ?? options.operation,
          message: error instanceof Error ? error.message : String(error),
          ...errorInfo(error, fallback),
        },
      ];
    } finally {
      notify();
    }
    return structuredClone(job);
  }

  private async checkUnchanged(
    asset: MediaAsset,
    expectedHash: string,
    signal?: AbortSignal,
  ) {
    checkAbort(signal);
    const latest = this.asset(asset.id);
    if (
      latest.uri !== asset.uri ||
      (await this.identity(latest, signal, true)) !== expectedHash
    )
      throw new ApplicationError(
        "source.changed",
        `Source changed while analyzing ${asset.name}; import again and retry.`,
        409,
        { name: asset.name },
      );
    checkAbort(signal);
  }
}
