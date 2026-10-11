import { lstat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
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
  createReviewOwner as createAnalysisOwner,
  ownsReviewOwner as ownsAnalysisOwner,
  reviewOwnerState as analysisOwnerState,
} from "./review-owner.js";
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
  /** Only a locally owned, exact queued reservation can be consumed. */
  reservation?: Job;
  onJob?: (job: Job) => void;
}

export interface AnalysisRecoveryState {
  jobId: string;
  ownerState: "alive" | "dead" | "unknown";
  manualRecoveryAllowed: boolean;
  ownerToken?: string;
  checkpoint: string;
  updatedAt?: string;
}
export interface AnalysisRecoveryInput {
  confirmStopped: boolean;
  checkpoint: string;
  ownerToken?: string;
}

const ANALYSIS_OPERATIONS = ["transcribe", "waveform", "scenes"] as const;
function activeAnalysis(job: Job): boolean {
  return (
    ANALYSIS_OPERATIONS.some((operation) => operation === job.type) &&
    (job.status === "queued" || job.status === "running")
  );
}
function analysisCheckpoint(job: Job): string {
  return createHash("sha256").update(JSON.stringify(job)).digest("hex");
}
function analysisOwnerToken(job: Job): string | undefined {
  // Historical JSON can contain a malformed owner. Its complete evidence stays
  // in the checkpoint; API token fields must remain string-or-absent.
  return typeof job.analysisOwner?.token === "string"
    ? job.analysisOwner.token
    : undefined;
}
function executionChanged(): ApplicationError {
  return new ApplicationError(
    "request.invalid",
    "The analysis execution changed. Refresh its current status before retrying.",
    409,
  );
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

  /** A durable project-wide slot is reserved before a server response or provider work. */
  reserve(
    assetId: string,
    operation: IntelligenceOptions["operation"],
    jobId: string = randomUUID(),
  ): Job {
    this.asset(assetId);
    if (!ANALYSIS_OPERATIONS.includes(operation))
      throw new ApplicationError(
        "request.invalid",
        "Unknown analysis operation.",
      );
    if (
      typeof jobId !== "string" ||
      !jobId.trim() ||
      jobId.length > 256 ||
      [...jobId].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new ApplicationError(
        "request.invalid",
        "Analysis job IDs must be nonblank strings of at most 256 characters without control characters.",
      );
    const jobs = this.catalog.listJobs();
    // An explicitly reused ID is never a recovery or retry command. Reject it
    // before automatic dead-owner recovery can change its existing checkpoint.
    if (jobs.some((job) => job.id === jobId)) throw executionChanged();
    this.recoverInterruptedJobs(jobs);
    const now = new Date().toISOString();
    const job: Job = {
      id: jobId,
      assetId,
      type: operation,
      status: "queued",
      progress: 0,
      analysisOwner: createAnalysisOwner(),
      createdAt: now,
      updatedAt: now,
    };
    this.catalog.intelligence.reserveAnalysisJob(job);
    return structuredClone(job);
  }

  analysisRecoveryStatus(jobId: string): AnalysisRecoveryState {
    return this.recoveryState(this.analysisJob(jobId));
  }

  /** Activity can inspect one jobs snapshot without a catalog query per row. */
  analysisRecoveryStatuses(
    jobs: readonly Job[] = this.catalog.listJobs(),
  ): Record<string, AnalysisRecoveryState> {
    return Object.fromEntries(
      jobs
        .filter(activeAnalysis)
        .map((job) => [job.id, this.recoveryState(job)]),
    );
  }

  private recoveryState(job: Job): AnalysisRecoveryState {
    const ownerState = analysisOwnerState(job.analysisOwner);
    return {
      jobId: job.id,
      ownerState,
      manualRecoveryAllowed: ownerState !== "alive" && activeAnalysis(job),
      ownerToken: analysisOwnerToken(job),
      checkpoint: analysisCheckpoint(job),
      updatedAt: job.updatedAt,
    };
  }

  manualRecoverAnalysis(jobId: string, input: AnalysisRecoveryInput): Job {
    if (input.confirmStopped !== true)
      throw new ApplicationError(
        "request.invalid",
        "Confirm that the previous analysis process has stopped before recovering it.",
      );
    const job = this.analysisJob(jobId);
    if (
      input.checkpoint !== analysisCheckpoint(job) ||
      input.ownerToken !== analysisOwnerToken(job)
    )
      throw executionChanged();
    if (analysisOwnerState(job.analysisOwner) === "alive")
      throw new ApplicationError(
        "jobs.busy",
        "The analysis owner is still alive. Stop it before manual recovery.",
        409,
      );
    if (!activeAnalysis(job)) throw executionChanged();
    const recovered = this.interrupted(job, true);
    if (!this.catalog.intelligence.recoverAnalysisJob(job, recovered))
      throw executionChanged();
    return structuredClone(recovered);
  }

  recoverInterruptedJobs(jobs: readonly Job[] = this.catalog.listJobs()): void {
    for (const job of jobs) {
      if (
        !activeAnalysis(job) ||
        analysisOwnerState(job.analysisOwner) !== "dead"
      )
        continue;
      // An owner may publish or a retry may win after the liveness probe.
      // Recover only this exact durable checkpoint; never rewrite that winner.
      this.catalog.intelligence.recoverAnalysisJob(job, this.interrupted(job));
    }
  }

  private analysisJob(jobId: string): Job {
    const job = this.catalog.listJobs().find((item) => item.id === jobId);
    if (
      !job ||
      !ANALYSIS_OPERATIONS.some((operation) => operation === job.type)
    )
      throw new ApplicationError(
        "request.notFound",
        "Analysis job not found.",
        404,
      );
    return job;
  }

  private interrupted(job: Job, manual = false): Job {
    return {
      ...job,
      analysisOwner: createAnalysisOwner(),
      status: "failed",
      stage: "interrupted",
      updatedAt: new Date().toISOString(),
      errors: [
        ...(job.errors ?? []),
        {
          uri: "",
          stage: "interrupted",
          message: manual
            ? "The user confirmed the previous analysis process stopped. Retry this task; previously saved analysis remains available."
            : "The previous analysis process stopped. Retry this task; previously saved analysis remains available.",
        },
      ],
    };
  }

  async run(assetId: string, options: IntelligenceOptions): Promise<Job> {
    const asset = this.asset(assetId);
    const reserved = options.reservation
      ? structuredClone(options.reservation)
      : this.reserve(assetId, options.operation, options.jobId);
    if (
      reserved.assetId !== assetId ||
      reserved.type !== options.operation ||
      reserved.status !== "queued" ||
      (options.jobId !== undefined && options.jobId !== reserved.id) ||
      !ownsAnalysisOwner(reserved.analysisOwner)
    )
      throw executionChanged();
    const job: Job = {
      ...reserved,
      status: "running",
      stage: "checking-source",
      updatedAt: new Date().toISOString(),
    };
    const observe = (observed = job) => {
      try {
        options.onJob?.(structuredClone(observed));
      } catch {
        /* A progress observer cannot cancel or corrupt durable work. */
      }
    };
    // Keep the existing queued Activity notification without rewriting its
    // durable reservation. The following exact CAS remains authoritative.
    observe(reserved);
    // Consuming once fences both a recovered queued reservation and two callers
    // attempting to run the same server reservation in the same process.
    if (!this.catalog.intelligence.claimAnalysisReservation(reserved, job))
      throw executionChanged();
    let ownershipLost = false;
    let completed = false;
    let lastProgressWrite = 0;
    const notify = (force = true): boolean => {
      if (ownershipLost) return false;
      if (!force && Date.now() - lastProgressWrite < 150) return true;
      lastProgressWrite = Date.now();
      job.updatedAt = new Date().toISOString();
      if (!this.catalog.intelligence.saveOwnedAnalysisJob(job)) {
        ownershipLost = true;
        return false;
      }
      observe();
      return true;
    };
    const requireOwnership = () => {
      if (!notify()) throw executionChanged();
    };
    const completion = (): Job => ({
      ...job,
      status: "completed",
      stage: "completed",
      progress: 1,
      updatedAt: new Date().toISOString(),
    });
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
      requireOwnership();
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
              // Execution ownership and application callbacks are not provider data.
              signal: options.signal,
              language: options.language,
              modelPath: options.modelPath,
              execution: options.execution,
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
        if (ownershipLost) throw executionChanged();
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
        requireOwnership();
        checkAbort(options.signal);
        const terminal = completion();
        this.catalog.intelligence.replaceTranscript(document, {
          expectedRevision,
          ownedCompletion: terminal,
        });
        Object.assign(job, terminal);
        completed = true;
      } else if (options.operation === "waveform") {
        job.stage = "generating-waveform";
        requireOwnership();
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
        const terminal = completion();
        this.catalog.intelligence.saveWaveform(waveform, {
          ownedCompletion: terminal,
        });
        Object.assign(job, terminal);
        completed = true;
      } else if (options.operation === "scenes") {
        if (asset.mediaType !== "video")
          throw new ApplicationError(
            "media.unsupported",
            "Scene detection requires a video source.",
          );
        job.stage = "detecting-scenes";
        requireOwnership();
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
        const terminal = completion();
        this.catalog.intelligence.saveScenes(scenes, {
          ownedCompletion: terminal,
        });
        Object.assign(job, terminal);
        completed = true;
      } else
        throw new ApplicationError(
          "request.invalid",
          "Unknown analysis operation.",
        );
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
      if (completed) observe();
      else notify();
    }
    // A recovered/successor checkpoint wins even when the old provider returns
    // after its token was revoked. Never describe a discarded local result as saved.
    return structuredClone(ownershipLost ? this.analysisJob(job.id) : job);
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
