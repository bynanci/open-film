// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import {
  ApplicationError,
  canonicalPresetJson,
  DEFAULT_SILENCE_PADDING_SECONDS,
  validateJob,
  validateSilenceCutProposal,
  type Job,
  type SilenceAnalysisJobDataV1,
  type SilenceApplyReceiptV1,
  type SilenceCutProposal,
} from "@openfilm/core";
import { applyTimelineCommand } from "@openfilm/solver";
import type { RecordAudioPreviewDescriptor } from "./record-audio-preview.js";
import type { OpenFilmApplication } from "./index.js";
import { TimelineEditor, silenceApplyFingerprint } from "./editor.js";
import { createReviewOwner, ownsReviewOwner } from "./review-owner.js";
import { SilenceService, type SilenceReviewEnvelope } from "./silence.js";

export interface SilenceJobCreateInput {
  projectId: string;
  requestId: string;
  assetId: string;
  compositionId: string;
  options?: Partial<
    Pick<
      SilenceAnalysisJobDataV1["options"],
      "thresholdDb" | "minimumSilenceSeconds" | "paddingSeconds"
    >
  >;
}

export interface SilenceJobApplyInput {
  reviewId: string;
  proposal: SilenceCutProposal;
  requestId: string;
}

export interface SilenceJobReviseInput {
  requestId: string;
  reviewId: string;
  selectedCandidateIds: string[];
}

export type SilenceFreshness = "current" | "stale" | "unverified";
export interface SilenceJobCreateResult {
  job: Job;
  created: boolean;
}
export interface SilenceJobReviewResult {
  job: Job;
  freshness: SilenceFreshness;
  review: SilenceReviewEnvelope;
}
export interface SilenceJobApplyResult {
  job: Job;
  edit: Awaited<ReturnType<TimelineEditor["get"]>>;
}

const HASH = /^[a-f0-9]{64}$/u;

function invalid(message: string): never {
  throw new ApplicationError("request.invalid", message);
}

function object(
  value: unknown,
  allowed: readonly string[],
  name: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid(`${name} must be a plain object.`);
  const record = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)!;
    if (
      typeof key !== "string" ||
      !allowed.includes(key) ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    )
      invalid(`${name} contains an unsupported field.`);
  }
  return record;
}

function identifier(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    invalid(`${name} must be a nonblank identifier.`);
  return value;
}

function bounded(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const result = value === undefined ? fallback : value;
  if (
    typeof result !== "number" ||
    !Number.isFinite(result) ||
    result < minimum ||
    result > maximum
  )
    invalid(`${name} is outside the supported range.`);
  return result;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalPresetJson(value)).digest("hex");
}

function conflict(message: string): ApplicationError {
  return new ApplicationError("analysis.resultStale", message, 409);
}

function safeFailure(error: unknown): NonNullable<Job["errors"]>[number] {
  const typed = error instanceof ApplicationError ? error : undefined;
  return {
    uri: "local-media",
    stage: "silence-analysis",
    message:
      typed?.message ??
      "Silence analysis failed. Check the source and project storage, then retry.",
    ...(typed ? { code: typed.code } : { code: "operation.failed" }),
  };
}

/** Durable coordinator over the existing SilenceService and TimelineEditor. */
function auditionInput(value: unknown) {
  const data = object(
    value,
    ["reviewId", "proposal", "requestId", "windowSeconds"],
    "silence audition",
  );
  const windowSeconds = data.windowSeconds ?? 0.5;
  if (
    typeof windowSeconds !== "number" ||
    !Number.isFinite(windowSeconds) ||
    windowSeconds < 0.1 ||
    windowSeconds > 3
  )
    invalid("windowSeconds must be between 0.1 and 3 seconds.");
  return {
    reviewId: identifier(data.reviewId, "reviewId"),
    requestId: identifier(data.requestId, "requestId"),
    proposal: validateSilenceCutProposal(data.proposal),
    windowSeconds,
  };
}
export interface SilenceAuditionResult {
  version: 1;
  reviewId: string;
  requestId: string;
  baseRevision: string;
  before: RecordAudioPreviewDescriptor;
  after: RecordAudioPreviewDescriptor;
  seams: {
    beforeStartSample: number;
    beforeEndSample: number;
    afterStartSample: number;
    afterEndSample: number;
    removedStartSample: number;
    removedEndSample: number;
  }[];
  removedSamples: number;
  parity: "renderer";
}
export class SilenceJobService {
  private readonly auditions = new Map<
    string,
    { fingerprint: string; result?: SilenceAuditionResult }
  >();
  private readonly editor: TimelineEditor;
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly application: OpenFilmApplication,
    private readonly silence: SilenceService,
    private readonly beginWork: () => void = () => undefined,
    private readonly endWork: () => void = () => undefined,
    editor: TimelineEditor = new TimelineEditor(application),
  ) {
    this.editor = editor;
  }

  async create(value: unknown): Promise<SilenceJobCreateResult> {
    const input = object(
      value,
      ["projectId", "requestId", "assetId", "compositionId", "options"],
      "silence job request",
    );
    const projectId = identifier(input.projectId, "projectId");
    const requestId = identifier(input.requestId, "requestId");
    const assetId = identifier(input.assetId, "assetId");
    const compositionId = identifier(input.compositionId, "compositionId");
    if (projectId !== this.application.project.id)
      throw conflict("The silence request belongs to another project.");
    const rawOptions =
      input.options === undefined
        ? {}
        : object(
            input.options,
            ["thresholdDb", "minimumSilenceSeconds", "paddingSeconds"],
            "silence job options",
          );
    const options = {
      thresholdDb: bounded(
        rawOptions.thresholdDb,
        -40,
        -80,
        -10,
        "thresholdDb",
      ),
      minimumSilenceSeconds: bounded(
        rawOptions.minimumSilenceSeconds,
        0.5,
        0.1,
        30,
        "minimumSilenceSeconds",
      ),
      paddingSeconds: bounded(
        rawOptions.paddingSeconds,
        DEFAULT_SILENCE_PADDING_SECONDS,
        0,
        2,
        "paddingSeconds",
      ),
    };
    const requestFingerprint = digest({
      version: 1,
      projectId,
      requestId,
      assetId,
      compositionId,
      options,
    });
    const prior =
      this.application.catalog.intelligence.getSilenceAnalysisByRequestId(
        requestId,
      );
    if (prior) {
      if (prior.silenceAnalysis?.requestFingerprint !== requestFingerprint)
        throw conflict(
          "This requestId is already bound to another silence request.",
        );
      return { job: prior, created: false };
    }
    if (this.application.hasActiveJobs)
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active project job before starting silence analysis.",
        409,
      );
    const generation = this.application.projectGeneration;
    const before = this.editor.get(compositionId);
    this.silence.validateSourceAsset(assetId);
    const sourceHash = await this.application.intelligence.sourceIdentity(
      assetId,
      { fresh: true },
    );
    if (
      generation !== this.application.projectGeneration ||
      projectId !== this.application.project.id ||
      this.editor.get(compositionId).revision !== before.revision
    )
      throw conflict(
        "The project changed while the silence request was reserved.",
      );
    const now = new Date().toISOString();
    const job: Job = {
      id: randomUUID(),
      type: "silence-analysis",
      status: "queued",
      progress: 0,
      stage: "queued",
      assetId,
      analysisOwner: createReviewOwner(),
      createdAt: now,
      updatedAt: now,
      silenceAnalysis: {
        version: 1,
        projectId,
        compositionId,
        baseRevision: before.revision,
        requestId,
        requestFingerprint,
        options,
        sourceHash,
        attempt: 1,
      },
    };
    return this.application.catalog.intelligence.reserveSilenceAnalysisJob(job);
  }

  get(jobId: string): Job {
    identifier(jobId, "jobId");
    const job = this.application.catalog.getJob(jobId);
    if (!job || job.type !== "silence-analysis")
      throw new ApplicationError(
        "request.notFound",
        "Silence Job not found.",
        404,
      );
    return validateJob(job);
  }

  async freshness(
    jobOrId: Job | string,
    signal?: AbortSignal,
  ): Promise<SilenceFreshness> {
    signal?.throwIfAborted();
    const job =
      typeof jobOrId === "string" ? this.get(jobOrId) : validateJob(jobOrId);
    const identity = job.silenceAnalysis;
    if (
      job.type !== "silence-analysis" ||
      !identity ||
      identity.projectId !== this.application.project.id
    )
      return "stale";
    const generation = this.application.projectGeneration;
    try {
      if (
        this.editor.get(identity.compositionId).revision !==
        identity.baseRevision
      )
        return "stale";
      const sourceHash = await this.application.intelligence.sourceIdentity(
        job.assetId!,
        { signal },
      );
      if (
        generation !== this.application.projectGeneration ||
        identity.projectId !== this.application.project.id ||
        this.editor.get(identity.compositionId).revision !==
          identity.baseRevision
      )
        return "stale";
      return sourceHash === identity.sourceHash ? "current" : "stale";
    } catch (error) {
      signal?.throwIfAborted();
      if (
        error instanceof ApplicationError &&
        [
          "source.changed",
          "media.missing",
          "media.notFound",
          "media.unsupported",
        ].includes(error.code)
      )
        return "stale";
      return "unverified";
    }
  }

  private readonly pendingAuditions = new Map<
    string,
    { fingerprint: string; task: Promise<SilenceAuditionResult> }
  >();
  hasPendingAudition(jobId: string, value: unknown): boolean {
    const data = auditionInput(value);
    const pending = this.pendingAuditions.get(data.requestId);
    return (
      !!pending &&
      pending.fingerprint === canonicalPresetJson({ jobId, ...data })
    );
  }
  async audition(
    jobId: string,
    value: unknown,
    signal?: AbortSignal,
  ): Promise<SilenceAuditionResult> {
    const data = auditionInput(value);
    signal?.throwIfAborted();
    const requestId = identifier(data.requestId, "requestId");
    const fingerprint = canonicalPresetJson({
      jobId,
      ...data,
      windowSeconds: data.windowSeconds ?? 0.5,
    });
    const pending = this.pendingAuditions.get(requestId);
    if (pending) {
      if (pending.fingerprint !== fingerprint)
        throw conflict("Audition requestId is bound to another request.");
      const result = await pending.task;
      signal?.throwIfAborted();
      return structuredClone(result);
    }
    const task = this.prepareAudition(jobId, value, signal);
    this.pendingAuditions.set(requestId, { fingerprint, task });
    try {
      return await task;
    } finally {
      this.pendingAuditions.delete(requestId);
    }
  }
  private async prepareAudition(
    jobId: string,
    value: unknown,
    signal?: AbortSignal,
  ): Promise<SilenceAuditionResult> {
    const { requestId, reviewId, proposal, windowSeconds } =
      auditionInput(value);
    const fingerprint = canonicalPresetJson({
      jobId,
      reviewId,
      proposal,
      windowSeconds,
    });
    const prior = this.auditions.get(requestId);
    if (prior && prior.fingerprint !== fingerprint)
      throw conflict("Audition requestId is bound to another request.");
    if (!prior) {
      if (this.auditions.size >= 64)
        throw new ApplicationError(
          "jobs.busy",
          "Audition request budget reached; reopen the project to prepare more.",
          409,
        );
      this.auditions.set(requestId, { fingerprint });
    }
    const review = await this.getReview(jobId, signal);
    if (
      review.job.status !== "waiting-review" ||
      review.freshness !== "current" ||
      review.review.reviewId !== reviewId
    )
      throw conflict("Silence audition requires the current waiting Review.");
    const assertReviewed = await this.silence.verifyReviewedProposal(
      reviewId,
      proposal,
      proposal.compositionId,
      proposal.baseRevision,
      signal,
    );
    // Hash on preparation; PCM reads use captured inode/size/mtime/ctime and
    // immutable Review guards, matching Record's bounded source read policy.
    const verify = async () => {
      const job = this.get(jobId);
      if (job.status !== "waiting-review")
        throw conflict("Silence Review is no longer waiting for acceptance.");
      this.assertReviewBound(job, { reviewId, proposal });
      assertReviewed();
    };
    await verify();
    if (prior?.result) {
      try {
        await this.application.recordAudioPreview.read(
          prior.result.before.id,
          0,
          1,
        );
        await this.application.recordAudioPreview.read(
          prior.result.after.id,
          0,
          1,
        );
        return structuredClone(prior.result);
      } catch (error) {
        if (
          !(error instanceof ApplicationError) ||
          error.code !== "request.notFound"
        )
          throw error;
        await this.application.recordAudioPreview.discard(
          prior.result.before.id,
        );
        await this.application.recordAudioPreview.discard(
          prior.result.after.id,
        );
        prior.result = undefined;
      }
    }
    const state = this.editor.get(proposal.compositionId);
    const derived = applyTimelineCommand(state, state.assets, {
      type: "silence.ripple",
      reviewId,
      proposal,
    });
    const before = await this.application.recordAudioPreview.prepare(
      proposal.compositionId,
      proposal.baseRevision,
      signal,
      {
        composition: state.composition,
        binding: requestId + fingerprint + "before",
        assertCurrent: verify,
      },
    );
    let after: RecordAudioPreviewDescriptor | undefined;
    try {
      after = await this.application.recordAudioPreview.prepare(
        proposal.compositionId,
        proposal.baseRevision,
        signal,
        {
          composition: derived.composition,
          binding: requestId + fingerprint + "after",
          assertCurrent: async () => {
            await verify();
            await this.application.recordAudioPreview.read(before.id, 0, 1);
          },
        },
      );
      await verify();
      signal?.throwIfAborted();
    } catch (error) {
      await this.application.recordAudioPreview.discard(before.id);
      if (after) await this.application.recordAudioPreview.discard(after.id);
      throw error;
    }
    let removedSeconds = 0;
    const pad = Math.round(windowSeconds * 48000);
    const seams = proposal.timelineIntervals.map((range) => {
      const start = Math.round(range.start * 48000),
        end = Math.round(range.end * 48000);
      const seam = Math.round((range.start - removedSeconds) * 48000);
      removedSeconds += range.end - range.start;
      return {
        beforeStartSample: Math.max(0, start - pad),
        beforeEndSample: Math.min(before.lengthSamples, end + pad),
        afterStartSample: Math.max(0, seam - pad),
        afterEndSample: Math.min(after.lengthSamples, seam + pad),
        removedStartSample: start,
        removedEndSample: end,
      };
    });
    const removedSamples = before.lengthSamples - after.lengthSamples;
    if (Math.abs(removedSamples - Math.round(removedSeconds * 48000)) > 1) {
      await this.application.recordAudioPreview.discard(before.id);
      await this.application.recordAudioPreview.discard(after.id);
      throw conflict(
        "The rendered audition sample duration does not match the reviewed ripple mapping.",
      );
    }
    const result: SilenceAuditionResult = {
      version: 1,
      reviewId,
      requestId,
      baseRevision: proposal.baseRevision,
      before,
      after,
      seams,
      removedSamples,
      parity: "renderer",
    };
    this.auditions.set(requestId, { fingerprint, result });
    return structuredClone(result);
  }

  async getReview(
    jobId: string,
    signal?: AbortSignal,
  ): Promise<SilenceJobReviewResult> {
    signal?.throwIfAborted();
    const job = this.get(jobId);
    const identity = job.silenceAnalysis!;
    if (
      !identity.reviewId ||
      (job.status !== "waiting-review" && job.status !== "completed")
    )
      throw new ApplicationError(
        "request.notFound",
        "This silence Job does not have a saved Review.",
        404,
      );
    const review = await this.silence.readProposal(identity.reviewId);
    this.assertReviewBound(job, review);
    return { job, freshness: await this.freshness(job, signal), review };
  }

  /** Reserve a new Job and immutable Review for an explicit candidate selection. */
  async revise(
    jobId: string,
    value: SilenceJobReviseInput,
  ): Promise<SilenceJobCreateResult> {
    identifier(jobId, "jobId");
    const input = object(
      value,
      ["requestId", "reviewId", "selectedCandidateIds"],
      "silence Review selection",
    );
    const requestId = identifier(input.requestId, "requestId");
    const reviewId = identifier(input.reviewId, "reviewId");
    if (
      !Array.isArray(input.selectedCandidateIds) ||
      input.selectedCandidateIds.length > 2000 ||
      input.selectedCandidateIds.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 128,
      ) ||
      new Set(input.selectedCandidateIds).size !==
        input.selectedCandidateIds.length
    )
      invalid("Choose unique silence candidate identifiers.");

    const parent = this.get(jobId);
    const identity = parent.silenceAnalysis!;
    if (parent.status !== "waiting-review" || identity.reviewId !== reviewId)
      throw conflict(
        "Only the current saved Review can create a new selection Review.",
      );
    const sourceReview = await this.silence.readProposal(reviewId);
    this.assertReviewBound(parent, sourceReview);
    const selected = new Set(input.selectedCandidateIds as string[]);
    if (
      [...selected].some(
        (id) =>
          !sourceReview.proposal.candidates.some(
            (candidate) => candidate.id === id,
          ),
      )
    )
      invalid("The selection contains a candidate outside this Review.");
    const selectedCandidateIds = sourceReview.proposal.candidates
      .filter((candidate) => selected.has(candidate.id))
      .map((candidate) => candidate.id);
    const fingerprint = digest({
      version: 1,
      parentJobId: parent.id,
      sourceReviewId: reviewId,
      requestId,
      projectId: identity.projectId,
      compositionId: identity.compositionId,
      baseRevision: identity.baseRevision,
      sourceHash: identity.sourceHash,
      options: identity.options,
      selectedCandidateIds,
    });
    const prior =
      this.application.catalog.intelligence.getSilenceAnalysisByRequestId(
        requestId,
      );
    if (prior) {
      if (prior.silenceAnalysis?.requestFingerprint !== fingerprint)
        throw conflict(
          "This requestId is already bound to another Review selection.",
        );
      return { job: prior, created: false };
    }
    if (this.application.hasActiveJobs)
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active project job before updating this Review.",
        409,
      );
    if ((await this.freshness(parent)) !== "current")
      throw conflict(
        "The source or Composition is stale; selection was refused.",
      );

    const now = new Date().toISOString();
    const child: Job = {
      id: randomUUID(),
      type: "silence-analysis",
      status: "queued",
      progress: 0,
      stage: "queued",
      assetId: parent.assetId,
      analysisOwner: createReviewOwner(),
      createdAt: now,
      updatedAt: now,
      silenceAnalysis: {
        version: 1,
        projectId: identity.projectId,
        compositionId: identity.compositionId,
        baseRevision: identity.baseRevision,
        requestId,
        requestFingerprint: fingerprint,
        options: { ...identity.options },
        sourceHash: identity.sourceHash,
        parentJobId: parent.id,
        sourceReviewId: reviewId,
        selectedCandidateIds,
        attempt: 1,
      },
    };
    return this.application.catalog.intelligence.reserveSilenceAnalysisJob(
      validateJob(child),
    );
  }

  async run(jobId: string, signal?: AbortSignal): Promise<Job> {
    const queued = this.get(jobId);
    if (queued.status !== "queued") return queued;
    if (!ownsReviewOwner(queued.analysisOwner))
      throw new ApplicationError(
        "jobs.busy",
        "This silence Job is owned by another process; recover it after that process stops.",
        409,
      );
    if (this.controllers.has(jobId))
      throw new ApplicationError(
        "jobs.busy",
        "This silence Job is already running.",
        409,
      );
    const local = new AbortController();
    this.controllers.set(jobId, local);
    const effectiveSignal = signal
      ? AbortSignal.any([local.signal, signal])
      : local.signal;
    this.beginWork();
    let running: Job | undefined;
    try {
      effectiveSignal.throwIfAborted();
      running = {
        ...queued,
        status: "running",
        progress: 0,
        stage: "analyzing",
        updatedAt: new Date().toISOString(),
      };
      if (
        !this.application.catalog.intelligence.claimAnalysisReservation(
          queued,
          running,
        )
      )
        return this.get(jobId);
      const jobData = running.silenceAnalysis!;
      const onProgress = (progress: number) => {
        if (effectiveSignal.aborted) return;
        const clamped = Math.max(
          running!.progress ?? 0,
          Math.min(1, Math.max(0, progress)),
        );
        if (clamped === running!.progress) return;
        const next = {
          ...running!,
          progress: clamped,
          stage: "analyzing",
          updatedAt: new Date().toISOString(),
        };
        if (!this.application.catalog.intelligence.saveOwnedAnalysisJob(next)) {
          local.abort();
          return;
        }
        running = next;
      };
      const review = jobData.sourceReviewId
        ? await this.silence.createDerivedProposal(
            jobData.sourceReviewId,
            {
              compositionId: jobData.compositionId,
              baseRevision: jobData.baseRevision,
              sourceHash: jobData.sourceHash,
            },
            jobData.selectedCandidateIds ?? [],
          )
        : await this.silence.createBoundProposal(
            jobData.compositionId,
            queued.assetId!,
            {
              baseRevision: jobData.baseRevision,
              sourceHash: jobData.sourceHash,
            },
            {
              ...jobData.options,
              signal: effectiveSignal,
              onProgress,
            },
          );
      effectiveSignal.throwIfAborted();
      const waiting: Job = {
        ...running,
        status: "waiting-review",
        progress: 1,
        stage: "waiting-review",
        updatedAt: new Date().toISOString(),
        silenceAnalysis: { ...jobData, reviewId: review.reviewId },
      };
      if (
        !this.application.catalog.intelligence.transitionOwnedSilenceJob(
          running,
          waiting,
        )
      )
        return this.get(jobId);
      return waiting;
    } catch (error) {
      const current = this.get(jobId);
      if (current.status === "queued" && effectiveSignal.aborted) {
        const cancelled: Job = {
          ...current,
          status: "cancelled",
          stage: "cancelled",
          updatedAt: new Date().toISOString(),
        };
        if (
          this.application.catalog.intelligence.transitionOwnedSilenceJob(
            current,
            cancelled,
          )
        )
          return cancelled;
        return this.get(jobId);
      }
      if (current.status !== "running") return current;
      const failed: Job = {
        ...current,
        status: effectiveSignal.aborted ? "cancelled" : "failed",
        stage: effectiveSignal.aborted ? "cancelled" : "failed",
        updatedAt: new Date().toISOString(),
        errors: [...(current.errors ?? []), safeFailure(error)],
      };
      if (
        this.application.catalog.intelligence.transitionOwnedSilenceJob(
          current,
          failed,
        )
      )
        return failed;
      return this.get(jobId);
    } finally {
      this.controllers.delete(jobId);
      this.endWork();
    }
  }

  async cancel(jobId: string): Promise<Job> {
    const job = this.get(jobId);
    const controller = this.controllers.get(jobId);
    if (job.status === "queued") {
      if (!ownsReviewOwner(job.analysisOwner))
        throw new ApplicationError(
          "jobs.busy",
          "Only the queued silence Job owner can cancel it.",
          409,
        );
      const cancelled = {
        ...job,
        status: "cancelled" as const,
        stage: "cancelled",
        updatedAt: new Date().toISOString(),
      };
      if (
        !this.application.catalog.intelligence.transitionOwnedSilenceJob(
          job,
          cancelled,
        )
      )
        return this.get(jobId);
      controller?.abort();
      return cancelled;
    }
    if (job.status === "running" && controller) {
      const cancelled = {
        ...job,
        status: "cancelled" as const,
        stage: "cancelled",
        updatedAt: new Date().toISOString(),
      };
      if (
        !this.application.catalog.intelligence.transitionOwnedSilenceJob(
          job,
          cancelled,
        )
      )
        return this.get(jobId);
      controller.abort();
      return cancelled;
    }
    if (job.status === "cancelled") return job;
    throw new ApplicationError(
      "jobs.notRunning",
      "This silence Job is no longer cancellable in this process.",
      409,
    );
  }

  async retry(
    jobId: string,
    requestIdValue: string,
  ): Promise<SilenceJobCreateResult> {
    const requestId = identifier(requestIdValue, "requestId");
    const observed = this.get(jobId);
    const identity = observed.silenceAnalysis!;
    if (requestId === identity.requestId)
      throw conflict("A retry must use a new requestId.");
    const fingerprint = digest({
      version: 1,
      jobId,
      requestId,
      requestFingerprint: identity.requestFingerprint,
    });
    const previous = (identity.retryRequests ?? []).find(
      (receipt) => receipt.requestId === requestId,
    );
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw conflict(
          "This retry requestId is already bound to another retry.",
        );
      return { job: observed, created: false };
    }
    if (observed.status !== "failed" && observed.status !== "cancelled")
      throw conflict("Only a failed or cancelled silence Job can be retried.");
    if ((await this.freshness(observed)) !== "current")
      throw conflict(
        "The captured source or Composition is stale; retry was refused.",
      );
    if ((identity.retryRequests ?? []).length >= 100)
      throw conflict("This silence Job has reached its retry request limit.");
    const nextIdentity: SilenceAnalysisJobDataV1 = {
      ...identity,
      attempt: identity.attempt + 1,
      retryRequests: [
        ...(identity.retryRequests ?? []),
        { requestId, fingerprint, attempt: identity.attempt + 1 },
      ],
    };
    const now = new Date().toISOString();
    const next: Job = {
      ...observed,
      status: "queued",
      stage: "queued",
      progress: 0,
      analysisOwner: createReviewOwner(),
      updatedAt: now,
      silenceAnalysis: nextIdentity,
    };
    return this.application.catalog.intelligence.retrySilenceAnalysisJob(
      observed,
      next,
      requestId,
    );
  }

  recover(
    jobId: string,
    input: {
      confirmStopped: boolean;
      checkpoint: string;
      ownerToken?: string;
    },
  ): Job {
    this.get(jobId);
    return this.application.intelligence.manualRecoverAnalysis(jobId, input);
  }

  async apply(jobId: string, value: unknown): Promise<SilenceJobApplyResult> {
    const input = object(
      value,
      ["reviewId", "proposal", "requestId"],
      "silence Apply",
    );
    const requestId = identifier(input.requestId, "requestId");
    const reviewId = input.reviewId;
    if (typeof reviewId !== "string" || !HASH.test(reviewId))
      invalid("reviewId must be a lowercase SHA-256 identifier.");
    const proposal = validateSilenceCutProposal(input.proposal);
    const job = this.get(jobId);
    const identity = job.silenceAnalysis!;
    const fingerprint = silenceApplyFingerprint({
      jobId,
      requestId,
      compositionId: identity.compositionId,
      reviewId,
      baseRevision: identity.baseRevision,
      proposal,
    });
    const durableReceipt = this.application.project.silenceApplyReceipts?.find(
      (receipt) => receipt.jobId === jobId,
    );
    if (durableReceipt) {
      this.assertApplyReceipt(
        durableReceipt,
        job,
        requestId,
        reviewId,
        fingerprint,
      );
      const completed = this.completeFromReceipt(job, durableReceipt);
      return {
        job: completed,
        edit: {
          ...this.editor.get(identity.compositionId),
          acknowledgedRevision: durableReceipt.appliedRevision,
        },
      };
    }
    if (job.status === "completed") {
      if (
        identity.applyRequestId !== requestId ||
        identity.applyFingerprint !== fingerprint
      )
        throw conflict(
          "The completed silence Job is bound to a different Apply request.",
        );
      throw conflict(
        "The completed silence Apply receipt is missing from the project.",
      );
    }
    if (job.status !== "waiting-review")
      throw conflict("Only a saved silence Review can be explicitly applied.");
    if (identity.reviewId !== reviewId)
      throw conflict(
        "The supplied reviewId does not belong to this silence Job.",
      );
    this.assertReviewBound(job, { reviewId, proposal });
    if ((await this.freshness(job)) !== "current")
      throw conflict(
        "The captured source or Composition is stale; Apply was refused.",
      );
    const review = await this.silence.readProposal(reviewId);
    if (canonicalPresetJson(review.proposal) !== canonicalPresetJson(proposal))
      throw conflict(
        "Apply requires the exact persisted proposal reviewed by the user.",
      );
    const edit = await this.silence.apply(review, {
      requestId,
      jobId,
      editor: this.editor,
    });
    const savedReceipt = this.application.project.silenceApplyReceipts?.find(
      (receipt) => receipt.jobId === jobId,
    );
    if (!savedReceipt)
      throw new ApplicationError(
        "operation.failed",
        "The accepted silence edit was saved without its durable Apply receipt.",
        500,
      );
    this.assertApplyReceipt(
      savedReceipt,
      job,
      requestId,
      reviewId,
      fingerprint,
    );
    const completed = this.completeFromReceipt(job, savedReceipt);
    return {
      job: completed,
      edit: { ...edit, acknowledgedRevision: savedReceipt.appliedRevision },
    };
  }

  private assertReviewBound(job: Job, review: SilenceReviewEnvelope): void {
    const identity = job.silenceAnalysis!;
    const proposal = review.proposal;
    if (
      (review.reviewId !== identity.reviewId &&
        identity.reviewId !== undefined) ||
      proposal.assetId !== job.assetId ||
      proposal.compositionId !== identity.compositionId ||
      proposal.baseRevision !== identity.baseRevision ||
      proposal.sourceHash !== identity.sourceHash
    )
      throw conflict(
        "The persisted Review does not match this Job's captured identities.",
      );
  }

  private assertApplyReceipt(
    receipt: SilenceApplyReceiptV1,
    job: Job,
    requestId: string,
    reviewId: string,
    fingerprint: string,
  ): void {
    const identity = job.silenceAnalysis!;
    if (
      receipt.jobId !== job.id ||
      receipt.requestId !== requestId ||
      receipt.fingerprint !== fingerprint ||
      receipt.compositionId !== identity.compositionId ||
      receipt.reviewId !== reviewId ||
      receipt.baseRevision !== identity.baseRevision
    )
      throw conflict(
        "This silence Job already has a different durable Apply receipt.",
      );
  }

  private completeFromReceipt(job: Job, receipt: SilenceApplyReceiptV1): Job {
    if (job.status === "completed") {
      const identity = job.silenceAnalysis!;
      if (
        identity.applyRequestId !== receipt.requestId ||
        identity.applyFingerprint !== receipt.fingerprint ||
        identity.appliedRevision !== receipt.appliedRevision
      )
        throw conflict("The completed Job and durable Apply receipt disagree.");
      return job;
    }
    if (job.status !== "waiting-review")
      throw conflict("Only a waiting Review can be acknowledged as applied.");
    const next: Job = {
      ...job,
      status: "completed",
      stage: "applied",
      progress: 1,
      updatedAt: new Date().toISOString(),
      silenceAnalysis: {
        ...job.silenceAnalysis!,
        applyRequestId: receipt.requestId,
        applyFingerprint: receipt.fingerprint,
        appliedRevision: receipt.appliedRevision,
      },
    };
    if (
      !this.application.catalog.intelligence.transitionOwnedSilenceJob(
        job,
        next,
      )
    ) {
      const current = this.get(job.id);
      if (current.status === "completed")
        return this.completeFromReceipt(current, receipt);
      throw conflict(
        "The silence Job changed while Apply was being acknowledged.",
      );
    }
    return next;
  }
}
