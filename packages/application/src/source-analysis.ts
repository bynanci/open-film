import { createHash, randomUUID } from "node:crypto";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import {
  ApplicationError,
  type AnalysisEvidenceResult,
  type AnalysisRun,
  type Event,
  type Job,
  type JobAttempt,
  type SimilarityGroup,
  type TravelContextV1,
  type VisualSamplingV1,
  type VisualSampleEvidenceV1,
  validateVisualSampling,
} from "@openfilm/core";
import { clusterEvents, findDuplicates } from "@openfilm/events";
import { ProviderRegistry } from "@openfilm/analysis";
import { extractRepresentativeFrames } from "@openfilm/media";
import type {
  RemoteProviderConsent,
  VisionSampleProvider,
} from "@openfilm/plugin-sdk";
import type { ProjectCatalog } from "@openfilm/catalog";
import { validateTravelContext } from "@openfilm/core";
import {
  buildTravelObservations,
  type TravelObservationV1,
} from "./travel-evidence.js";
import { createReviewOwner, reviewOwnerState } from "./review-owner.js";

const ALGORITHM_VERSION = "common-events-duplicates-v1";
const TAXONOMY_VERSION = "common-evidence-v1";
const MAX_ANALYSIS_ASSETS = 10_000;
const MAX_ANALYSIS_BINDINGS = 50_000;
const VISUAL_ALGORITHM_VERSION = "representative-frames-v1" as const;

export type SourceAnalysisEvidence =
  | {
      type: "event";
      assetIds: string[];
      startAt?: string;
      endAt?: string;
      labels: string[];
      confidence?: number;
      location?: Event["location"];
    }
  | {
      type: "duplicate";
      assetIds: string[];
      matchKind: SimilarityGroup["kind"];
      confidence?: number;
    }
  | VisualSampleEvidenceV1
  | TravelObservationV1;
export type SourceAnalysisResult =
  AnalysisEvidenceResult<SourceAnalysisEvidence>;

export interface SourceAnalysisRunRecord {
  run: AnalysisRun;
  results: SourceAnalysisResult[];
  attempts: JobAttempt[];
}

export interface SourceAnalysisProgress {
  runId: string;
  attemptId?: string;
  stage: "queued" | "running" | "completed" | "failed" | "cancelled";
  completed: number;
  total: number;
}

export interface CreateSourceAnalysisInput {
  projectId: string;
  verifiedManifestId: string;
  scopeMode: "selected-sources" | "project-catalog";
  confirmProjectCatalog?: boolean;
  travelContext?: TravelContextV1;
  visualSampling?: VisualSamplingV1;
  requestId: string;
  signal?: AbortSignal;
  onProgress?: (progress: Readonly<SourceAnalysisProgress>) => void;
}

interface PreparedAnalysis {
  run: AnalysisRun;
  assets: ReturnType<ProjectCatalog["getAsset"]>[];
  memberBindings: Map<string, string[]>;
}

interface ActiveAttempt {
  controller: AbortController;
  attemptId: string;
  ownerToken: string;
  generation: number;
  promise: Promise<SourceAnalysisRunRecord>;
}

function fail(
  code: ConstructorParameters<typeof ApplicationError>[0],
  message: string,
  status = 400,
): never {
  throw new ApplicationError(code, message, status);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function notify(
  callback: CreateSourceAnalysisInput["onProgress"],
  progress: SourceAnalysisProgress,
): void {
  try {
    callback?.(structuredClone(progress));
  } catch {
    // A UI observer cannot abort or corrupt a durable analysis operation.
  }
}

function assetSnapshot(
  asset: NonNullable<ReturnType<ProjectCatalog["getAsset"]>>,
) {
  return {
    id: asset.id,
    contentHash: asset.contentHash ?? null,
    mediaType: asset.mediaType,
    capturedAt: asset.capturedAt ?? null,
    gps: asset.gps ?? null,
    perceptualHash: asset.perceptualHash ?? null,
  };
}

/**
 * Common deterministic analysis over one immutable VerifiedManifest. Run
 * evidence is semantic catalog data; attempts and owner tokens remain in the
 * local-operational jobs table and are removed from portable packages.
 */
export class SourceAnalysisService {
  private readonly active = new Map<string, ActiveAttempt>();
  private readonly visionProviders = new ProviderRegistry();

  constructor(
    private readonly projectId: string,
    private readonly catalog: ProjectCatalog,
    private readonly operationStarted: () => void = () => undefined,
    private readonly operationFinished: () => void = () => undefined,
    providers: readonly VisionSampleProvider[] = [],
  ) {
    for (const provider of providers) this.visionProviders.register(provider);
  }

  listVisionSampleProviders(): ReturnType<ProviderRegistry["list"]> {
    return this.visionProviders
      .list()
      .filter(({ kind }) => kind === "vision-sample");
  }

  grantVisionSampleConsent(consent: RemoteProviderConsent): void {
    const provider = this.listVisionSampleProviders().find(
      ({ id }) => id === consent.providerId,
    );
    if (!provider)
      fail(
        "request.invalid",
        "The requested bounded-sample provider is not registered.",
      );
    this.visionProviders.grantConsent(consent);
  }

  revokeVisionSampleConsent(providerId: string): void {
    this.visionProviders.revokeConsent(providerId);
  }

  async createRun(
    input: CreateSourceAnalysisInput,
  ): Promise<SourceAnalysisRunRecord> {
    this.validateRequest(input);
    const prepared = this.prepare(
      input.projectId,
      input.verifiedManifestId,
      input.scopeMode,
      input.confirmProjectCatalog,
      input.travelContext,
      input.visualSampling,
    );
    const existing = this.catalog.multiSource.getAnalysisRun(prepared.run.id);
    if (existing) {
      const active = this.active.get(existing.id);
      return active?.promise ?? this.getRun(existing.id);
    }
    this.catalog.multiSource.createAnalysisRun(prepared.run);
    return this.execute(
      prepared,
      input.requestId,
      input.signal,
      input.onProgress,
    );
  }

  async retryRun(input: {
    projectId: string;
    runId: string;
    requestId: string;
    signal?: AbortSignal;
    onProgress?: CreateSourceAnalysisInput["onProgress"];
  }): Promise<SourceAnalysisRunRecord> {
    if (input.projectId !== this.projectId)
      fail(
        "request.invalid",
        "Analysis retry belongs to another project.",
        409,
      );
    const run = this.catalog.multiSource.getAnalysisRun(input.runId);
    if (!run || run.projectId !== input.projectId)
      fail(
        "analysis.scopeStale",
        "The verified analysis run no longer exists.",
        409,
      );
    const inFlight = this.active.get(run.id);
    if (inFlight) {
      const key = hash(input.requestId);
      const job = this.catalog
        .listJobs()
        .find(({ id }) => id === inFlight.attemptId);
      if (job?.attempt?.requestFingerprint === key) return inFlight.promise;
      fail(
        "jobs.busy",
        "This analysis run already has an active attempt.",
        409,
      );
    }
    this.validateRequestId(input.requestId);
    const existingAttempt = this.catalog
      .listJobs()
      .find(
        (job) =>
          job.attempt?.operationId === run.id &&
          job.attempt.requestFingerprint === hash(input.requestId),
      );
    if (existingAttempt) return this.getRun(run.id);
    if (!["partial", "failed", "cancelled"].includes(run.status))
      fail(
        "jobs.notRunning",
        "Only a failed, partial or cancelled analysis can be retried.",
        409,
      );
    const prepared = this.prepare(
      run.projectId,
      run.manifestId,
      run.scopeMode,
      run.scopeMode === "project-catalog",
      run.travelContext,
      run.visualSampling,
    );
    if (prepared.run.inputFingerprint !== run.inputFingerprint)
      fail(
        "analysis.scopeStale",
        "The source content or project scope changed; start a new analysis run.",
        409,
      );
    this.catalog.multiSource.transitionAnalysisRun(run.id, "queued");
    prepared.run = { ...prepared.run, ...run, status: "queued" };
    return this.execute(
      prepared,
      input.requestId,
      input.signal,
      input.onProgress,
    );
  }

  cancelRun(input: { projectId: string; runId: string }): void {
    if (input.projectId !== this.projectId)
      fail(
        "request.invalid",
        "Analysis cancellation belongs to another project.",
        409,
      );
    const active = this.active.get(input.runId);
    if (!active)
      fail(
        "jobs.notRunning",
        "This analysis attempt is not running in this process.",
        409,
      );
    const job = this.catalog
      .listJobs()
      .find(({ id }) => id === active.attemptId);
    if (
      !job?.attempt ||
      job.attempt.ownerToken !== active.ownerToken ||
      job.attempt.status !== "running"
    )
      fail(
        "jobs.notRunning",
        "This analysis attempt is no longer owned by this process.",
        409,
      );
    this.catalog.saveJob({
      ...job,
      attempt: { ...job.attempt, cancelRequested: true },
      updatedAt: new Date().toISOString(),
    });
    active.controller.abort();
  }

  getRun(runId: string): SourceAnalysisRunRecord {
    const run = this.catalog.multiSource.getAnalysisRun(runId);
    if (!run || run.projectId !== this.projectId)
      fail(
        "analysis.scopeStale",
        "The requested analysis run was not found.",
        404,
      );
    const results = this.catalog.multiSource.getAnalysisResults(
      runId,
    ) as SourceAnalysisResult[];
    const attempts = this.catalog
      .listJobs()
      .flatMap(({ attempt }) =>
        attempt?.operationId === runId ? [structuredClone(attempt)] : [],
      )
      .sort((left, right) => left.generation - right.generation);
    return { run, results, attempts };
  }

  /** Running attempts belong to the process that owns their in-memory signal. */
  recoverInterruptedAttempts(): number {
    let recovered = 0;
    for (const job of this.catalog.listJobs()) {
      const attempt = job.attempt;
      if (
        !attempt ||
        attempt.operationKind !== "analysis-run" ||
        !["queued", "running"].includes(attempt.status)
      )
        continue;
      // A second status reader must not reclaim a live or unverifiable process.
      // Receipts predating process ownership retain their legacy recovery path.
      if (job.analysisOwner && reviewOwnerState(job.analysisOwner) !== "dead")
        continue;
      const run = this.catalog.multiSource.getAnalysisRun(attempt.operationId);
      if (run && ["queued", "running"].includes(run.status))
        this.catalog.multiSource.transitionAnalysisRun(
          run.id,
          run.status === "queued" ? "cancelled" : "failed",
        );
      this.catalog.saveJob({
        ...job,
        status: "failed",
        updatedAt: new Date().toISOString(),
        attempt: {
          ...attempt,
          status: "abandoned",
          stage: "interrupted",
          cancelRequested: true,
          finishedAt: new Date().toISOString(),
        },
      });
      recovered++;
    }
    return recovered;
  }

  private async execute(
    prepared: PreparedAnalysis,
    requestId: string,
    externalSignal?: AbortSignal,
    onProgress?: CreateSourceAnalysisInput["onProgress"],
  ): Promise<SourceAnalysisRunRecord> {
    const { run } = prepared;
    const controller = new AbortController();
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    if (externalSignal?.aborted) controller.abort();
    const job = this.startAttempt(run, requestId);
    const attempt = job.attempt!;
    const active: ActiveAttempt = {
      controller,
      attemptId: job.id,
      ownerToken: attempt.ownerToken,
      generation: attempt.generation,
      promise: Promise.resolve(undefined as unknown as SourceAnalysisRunRecord),
    };
    this.active.set(run.id, active);
    this.operationStarted();
    const operation = this.executeAttempt(
      prepared,
      job,
      active,
      onProgress,
    ).finally(() => {
      externalSignal?.removeEventListener("abort", abort);
      if (this.active.get(run.id) === active) this.active.delete(run.id);
      this.operationFinished();
    });
    active.promise = operation;
    return operation;
  }

  private async executeAttempt(
    prepared: PreparedAnalysis,
    initialJob: Job,
    active: ActiveAttempt,
    onProgress?: CreateSourceAnalysisInput["onProgress"],
  ): Promise<SourceAnalysisRunRecord> {
    const { run, assets } = prepared;
    const running = this.catalog.multiSource.transitionAnalysisRun(
      run.id,
      "running",
    );
    const job: Job = {
      ...initialJob,
      status: "running",
      progress: 0,
      updatedAt: new Date().toISOString(),
      attempt: { ...initialJob.attempt!, status: "running", stage: "analyze" },
    };
    this.catalog.saveJob(job);
    notify(onProgress, {
      runId: run.id,
      attemptId: job.id,
      stage: "running",
      completed: 0,
      total: assets.length,
    });
    await yieldEventLoop();
    try {
      this.assertOwner(run.id, active);
      if (active.controller.signal.aborted)
        throw Object.assign(new Error("Analysis cancelled"), {
          name: "AbortError",
        });
      const fresh = this.prepare(
        run.projectId,
        run.manifestId,
        run.scopeMode,
        run.scopeMode === "project-catalog",
        running.travelContext,
        running.visualSampling,
      );
      if (fresh.run.inputFingerprint !== running.inputFingerprint)
        fail(
          "analysis.scopeStale",
          "The input media changed while analysis was running.",
          409,
        );
      const events = clusterEvents(
        assets.filter(
          (asset): asset is NonNullable<typeof asset> => asset !== undefined,
        ),
      );
      const duplicates = findDuplicates(
        assets.filter(
          (asset): asset is NonNullable<typeof asset> => asset !== undefined,
        ),
      );
      if (active.controller.signal.aborted)
        throw Object.assign(new Error("Analysis cancelled"), {
          name: "AbortError",
        });
      this.assertOwner(run.id, active);
      const results = this.buildResults(
        run.id,
        events,
        duplicates,
        prepared.memberBindings,
      );
      if (run.travelContext)
        results.push(
          ...this.buildTravelResults(run, assets, prepared.memberBindings),
        );
      if (run.visualSampling)
        results.push(
          ...(await this.buildVisualResults(
            run,
            assets,
            prepared.memberBindings,
            active.controller.signal,
          )),
        );
      const assertPublication = () => {
        if (active.controller.signal.aborted)
          throw Object.assign(new Error("Analysis cancelled"), {
            name: "AbortError",
          });
        this.assertOwner(run.id, active);
        if (
          this.catalog.multiSource.getAnalysisRun(run.id)?.status !== "running"
        )
          fail(
            "analysis.resultStale",
            "Analysis run is no longer running.",
            409,
          );
        const latest = this.prepare(
          run.projectId,
          run.manifestId,
          run.scopeMode,
          run.scopeMode === "project-catalog",
          running.travelContext,
          running.visualSampling,
        );
        if (latest.run.inputFingerprint !== running.inputFingerprint)
          fail(
            "analysis.scopeStale",
            "The analysis input changed before publication.",
            409,
          );
      };
      if (results.length)
        this.catalog.multiSource.saveAnalysisResults(
          run.id,
          results,
          assertPublication,
        );
      else assertPublication();
      this.catalog.multiSource.transitionAnalysisRun(run.id, "completed");
      this.finishAttempt(job, active, "succeeded", "completed");
      notify(onProgress, {
        runId: run.id,
        attemptId: job.id,
        stage: "completed",
        completed: assets.length,
        total: assets.length,
      });
      return this.getRun(run.id);
    } catch (error) {
      // A displaced worker may not finalize another owner's run or attempt.
      this.assertOwner(run.id, active, false);
      const cancelled =
        active.controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError");
      const latest = this.catalog.multiSource.getAnalysisRun(run.id);
      if (latest && ["queued", "running"].includes(latest.status))
        this.catalog.multiSource.transitionAnalysisRun(
          run.id,
          cancelled ? "cancelled" : "failed",
        );
      this.finishAttempt(
        job,
        active,
        cancelled ? "cancelled" : "failed",
        cancelled ? "cancelled" : "failed",
        error,
      );
      notify(onProgress, {
        runId: run.id,
        attemptId: job.id,
        stage: cancelled ? "cancelled" : "failed",
        completed: 0,
        total: assets.length,
      });
      return this.getRun(run.id);
    }
  }

  private prepare(
    projectId: string,
    manifestId: string,
    scopeMode: AnalysisRun["scopeMode"],
    confirmProjectCatalog = false,
    rawTravelContext?: TravelContextV1,
    rawVisualSampling?: VisualSamplingV1,
  ): PreparedAnalysis {
    if (projectId !== this.projectId)
      fail("request.invalid", "Analysis belongs to another project.", 409);
    const manifest = this.catalog.multiSource.getVerifiedManifest(manifestId);
    const expected =
      manifest &&
      this.catalog.multiSource.getExpectedManifest(manifest.expectedManifestId);
    const batch =
      expected && this.catalog.multiSource.getImportBatch(expected.batchId);
    if (
      !manifest ||
      !expected ||
      !batch ||
      batch.projectId !== projectId ||
      !["sealed", "partial"].includes(batch.status)
    )
      fail(
        "analysis.scopeStale",
        "Analysis requires a sealed verified source manifest.",
        409,
      );
    if (!manifest.members.length)
      fail(
        "analysis.scopeStale",
        "The verified manifest has no readable media to analyze.",
        409,
      );
    if (manifest.members.length > MAX_ANALYSIS_BINDINGS)
      fail(
        "request.tooLarge",
        "Analysis is limited to 50,000 verified source bindings.",
        413,
      );
    if (scopeMode === "project-catalog" && !confirmProjectCatalog)
      fail(
        "analysis.scopeStale",
        "Confirm that analysis may include every asset in the current project catalog.",
        409,
      );
    const manifestBindings = manifest.members.map((member) => ({
      assetId: member.assetId,
      bindingId: member.bindingId,
      contentHash: member.contentHash,
      contextRevision: member.contextRevision,
    }));
    let selectedBindings = manifestBindings;
    let projectCatalogRevision: string | undefined;
    if (scopeMode === "project-catalog") {
      const assetCount = this.catalog.countAssets();
      if (!assetCount || assetCount > MAX_ANALYSIS_ASSETS)
        fail(
          "request.tooLarge",
          "Whole-project analysis requires between 1 and 10,000 catalog assets.",
          413,
        );
      const catalogAssets = this.catalog.listAssets({
        offset: 0,
        limit: MAX_ANALYSIS_ASSETS,
      });
      const covered = new Set(manifestBindings.map(({ assetId }) => assetId));
      if (
        catalogAssets.length !== assetCount ||
        catalogAssets.some((asset) => !covered.has(asset.id)) ||
        covered.size !== new Set(catalogAssets.map(({ id }) => id)).size
      )
        fail(
          "analysis.scopeStale",
          "The verified manifest must cover every current catalog asset for whole-project analysis.",
          409,
        );
      selectedBindings = manifestBindings;
      projectCatalogRevision = hash(
        JSON.stringify(
          catalogAssets
            .map(assetSnapshot)
            .sort((a, b) => a.id.localeCompare(b.id)),
        ),
      );
    }
    const inputBindingIds = [
      ...new Set(selectedBindings.map(({ bindingId }) => bindingId)),
    ].sort();
    const groupedBindings = new Map<string, string[]>();
    for (const binding of selectedBindings) {
      const group = groupedBindings.get(binding.assetId) ?? [];
      group.push(binding.bindingId);
      groupedBindings.set(binding.assetId, group);
    }
    const assets = [...groupedBindings.keys()].sort().map((assetId) => {
      const asset = this.catalog.getAsset(assetId);
      const bindings = selectedBindings.filter(
        (binding) => binding.assetId === assetId,
      );
      if (
        !asset ||
        !asset.contentHash ||
        bindings.some((binding) => binding.contentHash !== asset.contentHash)
      )
        fail(
          "analysis.scopeStale",
          "A verified source asset is missing or its content hash changed.",
          409,
        );
      return asset;
    });
    if (assets.length > MAX_ANALYSIS_ASSETS)
      fail(
        "request.tooLarge",
        "Common analysis is limited to 10,000 distinct assets per run.",
        413,
      );
    let travelContext: TravelContextV1 | undefined;
    if (rawTravelContext !== undefined) {
      try {
        travelContext = validateTravelContext(rawTravelContext);
      } catch (error) {
        fail(
          "request.invalid",
          `Travel context is invalid: ${error instanceof Error ? error.message : "bounded contract check failed"}`,
        );
      }
      const selectedAssetIds = new Set(assets.map(({ id }) => id));
      if (
        travelContext.clockMappings.some((mapping) =>
          mapping.assetIds.some((assetId) => !selectedAssetIds.has(assetId)),
        ) ||
        travelContext.assignments.some((assignment) =>
          assignment.assetIds.some((assetId) => !selectedAssetIds.has(assetId)),
        )
      )
        fail(
          "analysis.scopeStale",
          "Travel clock mappings and track assignments must stay within the verified analysis scope.",
          409,
        );
    }
    let visualSampling: VisualSamplingV1 | undefined;
    if (rawVisualSampling !== undefined) {
      try {
        visualSampling = validateVisualSampling(rawVisualSampling);
      } catch (error) {
        fail(
          "request.invalid",
          `Visual sampling configuration is invalid: ${error instanceof Error ? error.message : "bounded contract check failed"}`,
        );
      }
      if (visualSampling.providerId) {
        const provider = this.listVisionSampleProviders().find(
          ({ id }) => id === visualSampling!.providerId,
        );
        if (!provider)
          fail(
            "request.invalid",
            "The selected representative-frame provider is unavailable.",
            409,
          );
        if (!provider.enabled)
          fail(
            "request.invalid",
            "Explicit provider consent is required before representative-frame analysis.",
            409,
          );
      }
    }
    const snapshot = assets.map(assetSnapshot);
    const inputFingerprint = hash(
      JSON.stringify({
        projectId,
        manifestId,
        scopeMode,
        projectCatalogRevision: projectCatalogRevision ?? null,
        travelContext: travelContext ?? null,
        visualSampling: visualSampling ?? null,
        bindings: selectedBindings
          .map(({ assetId, bindingId, contentHash, contextRevision }) => ({
            assetId,
            bindingId,
            contentHash,
            contextRevision,
          }))
          .sort((a, b) => a.bindingId.localeCompare(b.bindingId)),
        assets: snapshot,
      }),
    );
    const configHash = hash(
      JSON.stringify({
        algorithm: ALGORITHM_VERSION,
        taxonomy: TAXONOMY_VERSION,
        travel: travelContext ?? null,
        visualSampling: visualSampling ?? null,
      }),
    );
    return {
      run: {
        id: `analysis:${hash(`${projectId}\0${manifestId}\0${scopeMode}\0${inputFingerprint}\0${configHash}`)}`,
        projectId,
        manifestId,
        scopeMode,
        algorithmVersion: ALGORITHM_VERSION,
        taxonomyVersion: TAXONOMY_VERSION,
        configHash,
        inputFingerprint,
        inputBindingIds,
        ...(travelContext ? { travelContext } : {}),
        ...(visualSampling ? { visualSampling } : {}),
        ...(projectCatalogRevision ? { projectCatalogRevision } : {}),
        status: "queued",
        createdAt: new Date().toISOString(),
      },
      assets,
      memberBindings: groupedBindings,
    };
  }

  private startAttempt(run: AnalysisRun, requestId: string): Job {
    const requestFingerprint = hash(requestId);
    const priorAttempt = this.catalog
      .listJobs()
      .filter((job) => job.attempt?.operationId === run.id)
      .map((job) => job.attempt!)
      .sort((a, b) => b.generation - a.generation)[0];
    const attempt: JobAttempt = {
      id: `attempt:${randomUUID()}`,
      operationId: run.id,
      operationKind: "analysis-run",
      generation: (priorAttempt?.generation ?? 0) + 1,
      ownerToken: randomUUID(),
      status: "running",
      stage: "prepare",
      cancelRequested: false,
      requestFingerprint,
      createdAt: new Date().toISOString(),
    };
    const job: Job = {
      id: attempt.id,
      type: "analysis-run",
      status: "queued",
      progress: 0,
      stage: attempt.stage,
      createdAt: attempt.createdAt,
      analysisOwner: createReviewOwner(),
      attempt,
    };
    this.catalog.saveJob(job);
    return job;
  }

  private finishAttempt(
    job: Job,
    active: ActiveAttempt,
    status: JobAttempt["status"],
    stage: string,
    error?: unknown,
  ): void {
    this.assertOwner(job.attempt!.operationId, active, false);
    const current = this.catalog.listJobs().find(({ id }) => id === job.id);
    if (!current?.attempt || current.attempt.ownerToken !== active.ownerToken)
      return;
    const updated: Job = {
      ...current,
      status:
        status === "succeeded"
          ? "completed"
          : status === "cancelled"
            ? "cancelled"
            : "failed",
      progress: status === "succeeded" ? 1 : current.progress,
      stage,
      updatedAt: new Date().toISOString(),
      attempt: {
        ...current.attempt,
        status,
        stage,
        finishedAt: new Date().toISOString(),
      },
      ...(error && status === "failed"
        ? {
            errors: [
              {
                uri: "",
                stage,
                message:
                  error instanceof Error ? error.message : "Analysis failed.",
                code:
                  error instanceof ApplicationError
                    ? error.code
                    : "analysis.scopeStale",
              },
            ],
          }
        : {}),
    };
    this.catalog.saveJob(updated);
  }

  private assertOwner(
    runId: string,
    active: ActiveAttempt,
    requireRunning = true,
  ): void {
    const current = this.active.get(runId);
    const job = this.catalog
      .listJobs()
      .find(({ id }) => id === active.attemptId);
    if (
      current !== active ||
      current.ownerToken !== active.ownerToken ||
      !job?.attempt ||
      job.attempt.ownerToken !== active.ownerToken ||
      job.attempt.generation !== active.generation ||
      (requireRunning &&
        (job.attempt.status !== "running" || job.attempt.cancelRequested))
    )
      fail(
        "analysis.resultStale",
        "A stale analysis worker cannot publish results.",
        409,
      );
  }

  private buildResults(
    runId: string,
    events: Event[],
    duplicates: SimilarityGroup[],
    memberBindings: Map<string, string[]>,
  ): SourceAnalysisResult[] {
    const records: Array<{
      kind: SourceAnalysisResult["kind"];
      source: Event | SimilarityGroup;
    }> = [
      ...events.map((source) => ({ kind: "event" as const, source })),
      ...duplicates.map((source) => ({ kind: "duplicate" as const, source })),
    ];
    return records.map(({ kind, source }) => {
      const assetIds = [...new Set(source.assetIds)].sort();
      const bindingIds = [
        ...new Set(
          assetIds.flatMap((assetId) => memberBindings.get(assetId) ?? []),
        ),
      ].sort();
      if (!bindingIds.length)
        fail(
          "analysis.resultStale",
          "Analysis evidence has no source binding.",
          409,
        );
      const normalized: SourceAnalysisEvidence =
        kind === "event"
          ? {
              type: "event",
              assetIds,
              ...("startAt" in source && source.startAt
                ? { startAt: source.startAt }
                : {}),
              ...("endAt" in source && source.endAt
                ? { endAt: source.endAt }
                : {}),
              labels: "labels" in source ? source.labels : [],
              ...(source.confidence === undefined
                ? {}
                : { confidence: source.confidence }),
              ...("location" in source && source.location
                ? { location: source.location }
                : {}),
            }
          : {
              type: "duplicate",
              assetIds,
              matchKind: "kind" in source ? source.kind : "exact",
              confidence: source.confidence,
            };
      return {
        id: `result:${hash(`${runId}\0${kind}\0${JSON.stringify(normalized)}`)}`,
        runId,
        kind,
        reviewStatus: "pending" as const,
        evidence: normalized,
        bindingIds,
      };
    });
  }

  private buildTravelResults(
    run: AnalysisRun,
    assets: ReturnType<ProjectCatalog["getAsset"]>[],
    memberBindings: Map<string, string[]>,
  ): SourceAnalysisResult[] {
    const observations = buildTravelObservations(
      run.travelContext!,
      assets.filter(
        (asset): asset is NonNullable<typeof asset> => asset !== undefined,
      ),
    );
    return observations.map((evidence) => {
      const bindingIds = [
        ...new Set(memberBindings.get(evidence.assetId) ?? []),
      ].sort();
      if (!bindingIds.length)
        fail(
          "analysis.resultStale",
          "Travel evidence has no verified source binding.",
          409,
        );
      return {
        id: `result:${hash(`${run.id}\\0travel\\0${JSON.stringify(evidence)}`)}`,
        runId: run.id,
        kind: "observation",
        reviewStatus: "pending",
        evidence,
        bindingIds,
      };
    });
  }

  private async buildVisualResults(
    run: AnalysisRun,
    assets: ReturnType<ProjectCatalog["getAsset"]>[],
    memberBindings: Map<string, string[]>,
    signal: AbortSignal,
  ): Promise<SourceAnalysisResult[]> {
    const config = run.visualSampling!;
    const provider = config.providerId
      ? this.visionProviders.list().find(({ id }) => id === config.providerId)
      : undefined;
    const providerConsent =
      config.providerId && provider?.execution === "remote"
        ? this.visionProviders.getConsent(config.providerId)
        : undefined;
    const output: SourceAnalysisResult[] = [];
    const visualAssets = assets.filter(
      (asset): asset is NonNullable<typeof asset> =>
        asset !== undefined &&
        (asset.mediaType === "image" || asset.mediaType === "video"),
    );
    for (const asset of visualAssets) {
      if (asset.mediaType !== "image" && asset.mediaType !== "video") continue;
      const bindingIds = [
        ...new Set(memberBindings.get(asset.id) ?? []),
      ].sort();
      if (!bindingIds.length || !asset.contentHash)
        fail(
          "analysis.resultStale",
          "Visual evidence has no verified source binding.",
          409,
        );
      const times = representativeSampleTimes(asset.mediaType, asset.duration);
      const unavailableReason = times.length
        ? undefined
        : ("source-duration-unavailable" as const);
      const samples = times.length ? times : [0];
      let frames: Awaited<ReturnType<typeof extractRepresentativeFrames>> = [];
      if (!unavailableReason) {
        try {
          frames = await extractRepresentativeFrames(asset, times, signal);
        } catch (error) {
          if (
            signal.aborted ||
            (error instanceof Error && error.name === "AbortError") ||
            (error instanceof ApplicationError &&
              error.code === "source.changed")
          )
            throw error;
        }
      }
      for (const [sampleIndex, time] of samples.entries()) {
        if (signal.aborted)
          throw Object.assign(new Error("Analysis cancelled"), {
            name: "AbortError",
          });
        const sourceTimeRange = {
          start: asset.mediaType === "image" ? 0 : Math.max(0, time - 0.02),
          end:
            asset.mediaType === "image"
              ? 0
              : Math.min(asset.duration ?? time, time + 0.02),
        };
        const sampleFingerprint = representativeSampleFingerprint(
          asset.contentHash,
          time,
        );
        const base: VisualSampleEvidenceV1 = {
          type: "visual-sample",
          algorithmVersion: VISUAL_ALGORITHM_VERSION,
          sampleId: `visual-sample:${sampleFingerprint}`,
          sampleFingerprint,
          assetId: asset.id,
          sourceHash: asset.contentHash,
          sourceTimeRange,
          status: "unknown",
          suggestedLabels: [],
          manualReviewRequired: true,
          ...(unavailableReason ? { reason: unavailableReason } : {}),
        };
        let evidence = base;
        if (!unavailableReason) {
          const frame = frames[sampleIndex];
          if (!frame) {
            evidence = { ...base, reason: "sample-unavailable" };
            output.push(this.visualResult(run.id, evidence, bindingIds));
            continue;
          }
          const frameHash = createHash("sha256")
            .update(frame.bytes)
            .digest("hex");
          if (!provider || !config.providerId) {
            evidence = {
              ...base,
              frameHash,
              reason: "provider-not-configured",
            };
          } else {
            const invokedAt = new Date().toISOString();
            const receipt = {
              providerId: provider.id,
              execution: provider.execution,
              invokedAt,
              ...(providerConsent
                ? { consentGrantedAt: providerConsent.grantedAt }
                : {}),
            } as const;
            try {
              const result = await this.visionProviders.analyzeVisionSample(
                provider.id,
                {
                  sampleId: base.sampleId,
                  assetId: asset.id,
                  sourceHash: asset.contentHash,
                  sourceTimeRange,
                  width: frame.width,
                  height: frame.height,
                  mimeType: frame.mimeType,
                  bytes: frame.bytes,
                },
                { signal },
              );
              const currentConsent =
                provider.execution === "remote"
                  ? this.visionProviders.getConsent(provider.id)
                  : undefined;
              if (
                provider.execution === "remote" &&
                currentConsent?.grantedAt !== providerConsent?.grantedAt
              ) {
                evidence = {
                  ...base,
                  frameHash,
                  reason: "consent-revoked",
                  providerReceipt: receipt,
                };
              } else {
                evidence = {
                  ...base,
                  frameHash,
                  status: result.labels.length ? "suggested" : "unknown",
                  suggestedLabels: result.labels,
                  ...(result.labels.length
                    ? {}
                    : { reason: "provider-no-labels" as const }),
                  providerReceipt: receipt,
                };
              }
            } catch (error) {
              if (
                signal.aborted ||
                (error instanceof Error && error.name === "AbortError")
              )
                throw error;
              evidence = {
                ...base,
                frameHash,
                reason: "provider-failed",
                providerReceipt: receipt,
              };
            }
          }
        }
        output.push(this.visualResult(run.id, evidence, bindingIds));
      }
    }
    return output;
  }

  private visualResult(
    runId: string,
    evidence: VisualSampleEvidenceV1,
    bindingIds: string[],
  ): SourceAnalysisResult {
    return {
      id: `result:${hash(`${runId}\0visual\0${evidence.sampleFingerprint}\0${evidence.providerReceipt?.invokedAt ?? "local"}`)}`,
      runId,
      kind: "observation",
      reviewStatus: "pending",
      evidence,
      bindingIds,
    };
  }

  private validateRequest(input: CreateSourceAnalysisInput): void {
    if (input.projectId !== this.projectId)
      fail("request.invalid", "Analysis belongs to another project.", 409);
    this.validateRequestId(input.requestId);
  }

  private validateRequestId(requestId: string): void {
    if (
      typeof requestId !== "string" ||
      !requestId.trim() ||
      requestId.length > 512 ||
      [...requestId].some((character) => character.charCodeAt(0) < 32)
    )
      fail("request.invalid", "Analysis request ID is invalid.");
  }
}

/** One image frame; videos get quarter, half and three-quarter source samples. */
export function representativeSampleTimes(
  mediaType: "image" | "video",
  duration?: number,
): number[] {
  if (mediaType === "image") return [0];
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0)
    return [];
  return [0.25, 0.5, 0.75].map((fraction) =>
    Number((duration * fraction).toFixed(3)),
  );
}

export function representativeSampleFingerprint(
  sourceHash: string,
  sourceTimeSeconds: number,
): string {
  if (
    !/^[a-f0-9]{64}$/u.test(sourceHash) ||
    !Number.isFinite(sourceTimeSeconds) ||
    sourceTimeSeconds < 0
  )
    throw new Error("Representative sample fingerprint inputs are invalid.");
  return hash(
    `${sourceHash}\0${VISUAL_ALGORITHM_VERSION}\0${sourceTimeSeconds.toFixed(3)}`,
  );
}
