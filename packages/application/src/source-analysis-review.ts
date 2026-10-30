import { createHash } from "node:crypto";
import {
  ApplicationError,
  validateStoryGraph,
  type AnalysisEvidenceResult,
  type AnalysisRun,
  type ReviewDecision,
  type ReviewDecisionOperation,
  type Story,
  type StoryGraph,
} from "@openfilm/core";
import { fingerprintReviewResults } from "@openfilm/catalog";
import type { OpenFilmApplication } from "./index.js";
import type { SourceAnalysisEvidence } from "./source-analysis.js";

export interface SourceAnalysisReviewPreview {
  runId: string;
  manifestId: string;
  operation: ReviewDecisionOperation;
  targetIds: string[];
  beforeFingerprint: string;
  storyRevision?: string;
  outcome: "ready" | "conflicted";
  conflictReason?:
    | "results-changed"
    | "operation-changed"
    | "manifest-changed"
    | "story-changed"
    | "result-already-reviewed";
  operationFingerprint: string;
  affectedAssetIds: string[];
  review?: SourceAnalysisReviewAnnotations;
}

export interface SourceAnalysisReviewAnnotations {
  baseResultIds: string[];
  decisionIds: string[];
  corrections: Array<{
    decisionId: string;
    resultId: string;
    axis: string;
    value: string;
  }>;
  sourceRanges: Array<{ assetId: string; start: number; end: number }>;
}

export interface SourceAnalysisReviewItem extends AnalysisEvidenceResult<SourceAnalysisEvidence> {
  review?: SourceAnalysisReviewAnnotations;
  sourceBounds?: Array<{
    assetId: string;
    duration: number;
    mediaType: "video" | "audio";
  }>;
}

export interface SourceAnalysisReviewSearch {
  runId: string;
  query: string;
  offset: number;
  limit: number;
}

export class SourceAnalysisReviewService {
  constructor(private readonly app: OpenFilmApplication) {}

  search(input: SourceAnalysisReviewSearch): {
    items: SourceAnalysisReviewItem[];
    total: number;
    offset: number;
    limit: number;
  } {
    const query =
      input.query === ""
        ? ""
        : boundedText(input.query, "Search query", 256).toLocaleLowerCase();
    const { run, results } = this.requireRun(input.runId);
    const offset = boundedInteger(input.offset, 0, 50_000, "Search offset");
    const limit = boundedInteger(input.limit, 1, 100, "Search limit");
    const decisions = this.app.catalog.multiSource.listReviewDecisions(run.id);
    const groups = reviewedGroups(results, decisions);
    const byId = new Map(results.map((result) => [result.id, result]));
    const matches: SourceAnalysisReviewItem[] = [];
    for (const result of results) {
      const ids = groups.get(result.id)!;
      if (result.id !== ids[0]) continue;
      const members = ids.map((id) => byId.get(id)!);
      const review = reviewedAnnotations(ids, decisions);
      if (
        query &&
        !JSON.stringify({
          evidence: members.map(({ evidence }) => evidence),
          review,
        })
          .toLocaleLowerCase()
          .includes(query)
      )
        continue;
      const assetIds = [
        ...new Set(
          members.flatMap(({ evidence }) => evidenceAssetIds(evidence)),
        ),
      ];
      const sourceBounds = assetIds.flatMap((assetId) => {
        const asset = this.app.catalog.getAsset(assetId);
        return asset &&
          (asset.mediaType === "video" || asset.mediaType === "audio") &&
          typeof asset.duration === "number" &&
          Number.isFinite(asset.duration) &&
          asset.duration > 0
          ? [{ assetId, duration: asset.duration, mediaType: asset.mediaType }]
          : [];
      });
      matches.push({ ...result, review, sourceBounds });
    }
    return {
      items: structuredClone(matches.slice(offset, offset + limit)),
      total: matches.length,
      offset,
      limit,
    };
  }

  decisions(runId: string): ReviewDecision[] {
    this.requireRun(runId);
    return this.app.catalog.multiSource.listReviewDecisions(runId);
  }

  preview(input: {
    runId: string;
    operation: ReviewDecisionOperation;
  }): SourceAnalysisReviewPreview {
    const operation = validateOperation(input.operation);
    const { run, results, targetIds } = this.inspectOperation(
      input.runId,
      operation,
    );
    const selected = results.filter(({ id }) => targetIds.includes(id));
    const decisions = this.app.catalog.multiSource.listReviewDecisions(run.id);
    const beforeFingerprint = fingerprintReviewResults(
      run,
      results,
      targetIds,
      decisions,
    );
    const affectedAssetIds = [
      ...new Set(
        selected.flatMap(({ evidence }) =>
          evidenceAssetIds(evidence as SourceAnalysisEvidence),
        ),
      ),
    ].sort();
    const story =
      operation.kind === "adopt-story"
        ? this.requireStory(operation.storyId)
        : undefined;
    const revision = story ? storyRevision(story) : undefined;
    const conflictReason = selected.some(
      ({ reviewStatus }) =>
        reviewStatus !== "pending" &&
        !(operation.kind === "adopt-story" && reviewStatus === "accepted"),
    )
      ? ("result-already-reviewed" as const)
      : undefined;
    return {
      runId: run.id,
      manifestId: run.manifestId,
      operation: structuredClone(operation),
      operationFingerprint: digest(JSON.stringify(operation)),
      targetIds,
      beforeFingerprint,
      ...(revision ? { storyRevision: revision } : {}),
      outcome: conflictReason ? "conflicted" : "ready",
      ...(conflictReason ? { conflictReason } : {}),
      affectedAssetIds,
      review: reviewedAnnotations(targetIds, decisions),
    };
  }

  async accept(input: {
    projectId: string;
    runId: string;
    operation: ReviewDecisionOperation;
    expectedManifestId: string;
    expectedBeforeFingerprint: string;
    expectedOperationFingerprint: string;
    expectedStoryRevision?: string;
    requestId: string;
    supersedesDecisionId?: string;
  }): Promise<ReviewDecision> {
    const requestId = boundedText(input.requestId, "Review request ID", 512);
    const decisionId = `review:${digest(`${input.projectId}\0${requestId}`)}`;
    const prior = this.app.catalog.multiSource.getReviewDecision(decisionId);
    if (prior) {
      if (
        prior.projectId !== input.projectId ||
        prior.baseRunId !== input.runId ||
        JSON.stringify(prior.operation) !==
          JSON.stringify(validateOperation(input.operation)) ||
        prior.manifestId !== input.expectedManifestId ||
        prior.beforeFingerprint !== input.expectedBeforeFingerprint ||
        prior.operationFingerprint !== input.expectedOperationFingerprint ||
        prior.storyRevision !== input.expectedStoryRevision ||
        prior.supersedesDecisionId !== input.supersedesDecisionId
      )
        throw new ApplicationError(
          "request.invalid",
          "A review request ID cannot be reused for another decision.",
          409,
        );
      return prior;
    }
    if (input.projectId !== this.app.project.id)
      throw new ApplicationError(
        "request.invalid",
        "Review decision belongs to another project.",
        409,
      );
    if (input.supersedesDecisionId) {
      const superseded = this.app.catalog.multiSource.getReviewDecision(
        boundedText(input.supersedesDecisionId, "Superseded decision ID", 256),
      );
      if (
        !superseded ||
        superseded.baseRunId !== input.runId ||
        superseded.projectId !== input.projectId
      )
        throw new ApplicationError(
          "request.invalid",
          "A superseded decision must belong to the same project and source-analysis run.",
          409,
        );
    }
    const expectedManifestId = boundedText(
      input.expectedManifestId,
      "Expected manifest ID",
      256,
    );
    if (
      !/^[a-f0-9]{64}$/u.test(input.expectedBeforeFingerprint) ||
      !/^[a-f0-9]{64}$/u.test(input.expectedOperationFingerprint) ||
      (input.expectedStoryRevision !== undefined &&
        !/^[a-f0-9]{64}$/u.test(input.expectedStoryRevision))
    )
      throw new ApplicationError(
        "request.invalid",
        "Review preview preconditions are invalid.",
      );
    const preview = this.preview({
      runId: input.runId,
      operation: input.operation,
    });
    const manifestMatches = preview.manifestId === expectedManifestId;
    const resultsMatch =
      preview.beforeFingerprint === input.expectedBeforeFingerprint;
    const operationMatches =
      preview.operationFingerprint === input.expectedOperationFingerprint;
    let storyMatches = true;
    if (input.operation.kind === "adopt-story") {
      const alreadyAdopted = this.findAdoptedBeat(
        input.operation.storyId,
        decisionId,
      );
      storyMatches =
        !!alreadyAdopted ||
        (!!input.expectedStoryRevision &&
          preview.storyRevision === input.expectedStoryRevision);
    }
    const conflictReason =
      preview.conflictReason ??
      (!manifestMatches
        ? ("manifest-changed" as const)
        : !operationMatches
          ? ("operation-changed" as const)
          : !resultsMatch
            ? ("results-changed" as const)
            : !storyMatches
              ? ("story-changed" as const)
              : undefined);
    const outcome = conflictReason
      ? ("conflicted" as const)
      : ("applied" as const);
    const decision: ReviewDecision = {
      schemaVersion: 1,
      id: decisionId,
      projectId: input.projectId,
      baseRunId: preview.runId,
      baseResultIds: preview.targetIds,
      targetIds: preview.targetIds,
      operation: structuredClone(preview.operation),
      operationFingerprint: preview.operationFingerprint,
      beforeFingerprint: input.expectedBeforeFingerprint,
      manifestId: preview.manifestId,
      ...(input.expectedStoryRevision
        ? { storyRevision: input.expectedStoryRevision }
        : {}),
      ...(input.supersedesDecisionId
        ? {
            supersedesDecisionId: boundedText(
              input.supersedesDecisionId,
              "Superseded decision ID",
              256,
            ),
          }
        : {}),
      outcome,
      createdAt: new Date().toISOString(),
    };
    if (outcome === "conflicted")
      return this.app.catalog.multiSource.saveReviewDecision(decision);

    let previousProject: typeof this.app.project | undefined;
    if (input.operation.kind === "adopt-story") {
      previousProject = structuredClone(this.app.project);
      const existingBeat = this.findAdoptedBeat(
        input.operation.storyId,
        decision.id,
      );
      if (!existingBeat) {
        this.app.project = this.projectWithAdoptedBeat(
          input.operation.storyId,
          preview.affectedAssetIds,
          preview,
          decision.id,
        );
        try {
          await this.app.save();
        } catch (error) {
          this.app.project = previousProject;
          throw error;
        }
      }
    }
    try {
      return this.app.catalog.multiSource.saveReviewDecision(decision);
    } catch (error) {
      if (previousProject) {
        this.app.project = previousProject;
        try {
          await this.app.save();
        } catch {
          /* preserve the decision failure; app reports project recovery on next open */
        }
      }
      throw error;
    }
  }

  private inspectOperation(
    runId: string,
    rawOperation: ReviewDecisionOperation,
  ): {
    run: AnalysisRun;
    results: AnalysisEvidenceResult<SourceAnalysisEvidence>[];
    targetIds: string[];
  } {
    const { run } = this.requireRun(runId);
    if (run.status !== "completed")
      throw new ApplicationError(
        "analysis.scopeStale",
        "Only completed source-analysis runs can be reviewed.",
        409,
      );
    const operation = validateOperation(rawOperation);
    const results = this.app.catalog.multiSource.getAnalysisResults(
      run.id,
    ) as AnalysisEvidenceResult<SourceAnalysisEvidence>[];
    let targetIds = operationResultIds(operation);
    if (operation.kind === "adopt-story") {
      const groups = reviewedGroups(
        results,
        this.app.catalog.multiSource.listReviewDecisions(run.id),
      );
      targetIds = [
        ...new Set(targetIds.flatMap((id) => groups.get(id) ?? [id])),
      ].sort();
    }
    if (
      targetIds.length < 1 ||
      targetIds.length > 100 ||
      new Set(targetIds).size !== targetIds.length
    )
      throw new ApplicationError(
        "request.invalid",
        "Review operations require 1–100 unique result IDs.",
      );
    const selected = results.filter(({ id }) => targetIds.includes(id));
    if (selected.length !== targetIds.length)
      throw new ApplicationError(
        "analysis.resultStale",
        "One or more review results no longer belong to this run.",
        409,
      );
    if (operation.kind === "merge-results" && targetIds.length < 2)
      throw new ApplicationError(
        "request.invalid",
        "Merge requires at least two source results.",
      );
    if (operation.kind === "split-result") {
      const manifest = this.app.catalog.multiSource.getVerifiedManifest(
        run.manifestId,
      );
      const assets = new Set(evidenceAssetIds(selected[0]!.evidence));
      const priorEnd = new Map<string, number>();
      if (
        [...operation.ranges]
          .sort(
            (left, right) =>
              left.assetId.localeCompare(right.assetId) ||
              left.start - right.start,
          )
          .some(({ assetId, start, end }) => {
            const asset = this.app.catalog.getAsset(assetId);
            const previous = priorEnd.get(assetId) ?? 0;
            priorEnd.set(assetId, end);
            return (
              !assets.has(assetId) ||
              !asset ||
              !manifest?.members.some(
                (member) =>
                  member.assetId === assetId &&
                  member.contentHash === asset.contentHash,
              ) ||
              !["video", "audio"].includes(asset.mediaType) ||
              !Number.isFinite(asset.duration) ||
              !Number.isFinite(start) ||
              !Number.isFinite(end) ||
              start < previous ||
              end <= start ||
              end > asset.duration!
            );
          })
      )
        throw new ApplicationError(
          "analysis.scopeStale",
          "Split ranges must be non-overlapping timed ranges of the reviewed sources inside their actual duration.",
          409,
        );
    }
    if (
      operation.kind === "set-observation" &&
      selected[0]?.kind !== "observation"
    )
      throw new ApplicationError(
        "request.invalid",
        "Only observation results can receive a typed correction.",
      );
    if (operation.kind === "adopt-story") {
      this.requireStory(operation.storyId);
      const manifestAssets = new Map(
        this.app.catalog.multiSource
          .getVerifiedManifest(run.manifestId)
          ?.members.map(
            ({ assetId, contentHash }) => [assetId, contentHash] as const,
          ) ?? [],
      );
      if (
        selected.some(({ evidence }) =>
          evidenceAssetIds(evidence).some(
            (id) =>
              !manifestAssets.has(id) ||
              this.app.catalog.getAsset(id)?.contentHash !==
                manifestAssets.get(id),
          ),
        )
      )
        throw new ApplicationError(
          "analysis.resultStale",
          "Story adoption cannot reference assets outside the verified manifest.",
          409,
        );
    }
    return { run, results, targetIds };
  }

  private requireRun(runId: string): {
    run: AnalysisRun;
    results: AnalysisEvidenceResult<SourceAnalysisEvidence>[];
  } {
    const record = this.app.sourceAnalysis.getRun(runId);
    return {
      run: record.run,
      results:
        record.results as AnalysisEvidenceResult<SourceAnalysisEvidence>[],
    };
  }

  private requireStory(storyId: string): Story {
    const story = this.app.project.stories.find(({ id }) => id === storyId);
    if (!story)
      throw new ApplicationError(
        "story.invalid",
        "The selected story does not exist.",
        404,
      );
    return story;
  }

  private findAdoptedBeat(storyId: string, decisionId: string) {
    const beatId = adoptedBeatId(decisionId);
    return this.app.project.stories
      .find(({ id }) => id === storyId)
      ?.beats.find(({ id }) => id === beatId);
  }

  private projectWithAdoptedBeat(
    storyId: string,
    assetIds: string[],
    preview: SourceAnalysisReviewPreview,
    decisionId: string,
  ): typeof this.app.project {
    if (!assetIds.length)
      throw new ApplicationError(
        "analysis.resultStale",
        "Selected results contain no media asset to adopt.",
        409,
      );
    const story = this.requireStory(storyId);
    const assets = new Set(this.app.catalog.listAssets().map(({ id }) => id));
    if (assetIds.some((id) => !assets.has(id)))
      throw new ApplicationError(
        "analysis.resultStale",
        "A selected source asset is unavailable.",
        409,
      );
    const beatId = adoptedBeatId(decisionId);
    const beatNodeId = `review-beat-node-${beatId}`;
    const beat = {
      id: beatId,
      title:
        preview.review?.corrections.findLast(({ axis }) => axis === "label")
          ?.value ?? "Reviewed selection",
      intent:
        preview.review?.corrections.findLast(
          ({ axis }) => axis === "narrative-note",
        )?.value ?? `Accepted source analysis ${preview.runId}`,
      candidateAssetIds: assetIds,
      selectedAssetIds: assetIds,
    };
    const baseGraph = story.graph ?? this.app.storyGraph.getGraph(storyId);
    const nodes = [
      ...baseGraph.nodes,
      { id: beatNodeId, type: "beat" as const, storyId, beatId },
    ];
    const edges = [...baseGraph.edges];
    for (const assetId of assetIds) {
      const existingNode = nodes.find(
        (node) => node.type === "asset" && node.assetId === assetId,
      );
      const assetNodeId = existingNode?.id ?? `asset-node-${assetId}`;
      if (!existingNode)
        nodes.push({ id: assetNodeId, type: "asset", assetId });
      if (
        !edges.some(
          (edge) =>
            edge.from === beatNodeId &&
            edge.to === assetNodeId &&
            edge.type === "supports",
        )
      )
        edges.push({
          id: `review-support-${digest(`${beatNodeId}\0${assetNodeId}`).slice(0, 24)}`,
          from: beatNodeId,
          to: assetNodeId,
          type: "supports",
        });
    }
    const nextStory = {
      ...story,
      beats: [...story.beats, beat],
      graph: validateStoryGraph(
        { ...baseGraph, nodes, edges } satisfies StoryGraph,
        new Set([...story.beats.map(({ id }) => id), beatId]),
        assets,
      ),
    };
    return {
      ...this.app.project,
      stories: this.app.project.stories.map((item) =>
        item.id === storyId ? nextStory : item,
      ),
    };
  }
}

/** Deterministic read projection; stored source evidence and decisions stay immutable. */
function reviewedGroups(
  results: readonly AnalysisEvidenceResult<SourceAnalysisEvidence>[],
  decisions: readonly ReviewDecision[],
): Map<string, string[]> {
  const groups = new Map(results.map(({ id }) => [id, [id]]));
  for (const decision of effectiveDecisions(decisions)) {
    if (decision.operation.kind !== "merge-results") continue;
    const ids = [
      ...new Set(
        decision.operation.resultIds.flatMap((id) => groups.get(id) ?? []),
      ),
    ].sort();
    for (const id of ids) groups.set(id, ids);
  }
  return groups;
}

function effectiveDecisions(
  decisions: readonly ReviewDecision[],
): ReviewDecision[] {
  const superseded = new Set(
    decisions
      .filter(({ outcome }) => outcome === "applied")
      .map(({ supersedesDecisionId }) => supersedesDecisionId),
  );
  return decisions
    .filter(({ id, outcome }) => outcome === "applied" && !superseded.has(id))
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}

function reviewedAnnotations(
  ids: string[],
  decisions: readonly ReviewDecision[],
): SourceAnalysisReviewAnnotations {
  const applied = effectiveDecisions(decisions).filter(({ targetIds }) =>
    targetIds.some((id) => ids.includes(id)),
  );
  return {
    baseResultIds: [...ids].sort(),
    decisionIds: applied.map(({ id }) => id),
    corrections: applied.flatMap(({ id, operation }) =>
      operation.kind === "set-observation"
        ? [
            {
              decisionId: id,
              resultId: operation.resultId,
              axis: operation.axis,
              value: operation.value,
            },
          ]
        : [],
    ),
    sourceRanges: applied.flatMap(({ operation }) =>
      operation.kind === "split-result" ? operation.ranges : [],
    ),
  };
}

function validateOperation(
  value: ReviewDecisionOperation,
): ReviewDecisionOperation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApplicationError(
      "request.invalid",
      "Review operation must be a typed object.",
    );
  const operation = value as ReviewDecisionOperation;
  if (
    operation.kind === "merge-results" ||
    operation.kind === "reject-results"
  ) {
    const allowed = ["kind", "resultIds"];
    if (
      Object.keys(value).some((key) => !allowed.includes(key)) ||
      !Array.isArray(operation.resultIds)
    )
      throw new ApplicationError(
        "request.invalid",
        "Review result selection is invalid.",
      );
    return {
      kind: operation.kind,
      resultIds: operation.resultIds.map((id) =>
        boundedText(id, "Result ID", 256),
      ),
    };
  }
  if (operation.kind === "split-result") {
    if (
      Object.keys(value).some(
        (key) => !["kind", "resultId", "ranges"].includes(key),
      ) ||
      !Array.isArray(operation.ranges) ||
      operation.ranges.length < 2 ||
      operation.ranges.length > 100
    )
      throw new ApplicationError(
        "request.invalid",
        "Split review operation is invalid.",
      );
    return {
      kind: "split-result",
      resultId: boundedText(operation.resultId, "Result ID", 256),
      ranges: operation.ranges.map((range) => {
        if (
          !range ||
          typeof range !== "object" ||
          Array.isArray(range) ||
          Object.keys(range).some(
            (key) => !["assetId", "start", "end"].includes(key),
          )
        )
          throw new ApplicationError(
            "request.invalid",
            "Split source range fields are invalid.",
          );
        const { assetId, start, end } = range;
        if (
          typeof start !== "number" ||
          typeof end !== "number" ||
          !Number.isFinite(start) ||
          !Number.isFinite(end)
        )
          throw new ApplicationError(
            "request.invalid",
            "Split source range times must be finite numbers.",
          );
        return { assetId: boundedText(assetId, "Asset ID", 256), start, end };
      }),
    };
  }
  if (operation.kind === "set-observation") {
    if (
      Object.keys(value).some(
        (key) => !["kind", "resultId", "axis", "value"].includes(key),
      )
    )
      throw new ApplicationError(
        "request.invalid",
        "Observation correction fields are invalid.",
      );
    return {
      kind: "set-observation",
      resultId: boundedText(operation.resultId, "Result ID", 256),
      axis: boundedEnum(
        operation.axis,
        ["label", "capture-time", "location", "narrative-note"] as const,
        "Correction axis",
      ),
      value: boundedText(operation.value, "Correction value", 1024),
    };
  }
  if (operation.kind === "adopt-story") {
    if (
      Object.keys(value).some(
        (key) => !["kind", "storyId", "resultIds"].includes(key),
      ) ||
      !Array.isArray(operation.resultIds)
    )
      throw new ApplicationError(
        "request.invalid",
        "Story adoption request is invalid.",
      );
    return {
      kind: "adopt-story",
      storyId: boundedText(operation.storyId, "Story ID", 256),
      resultIds: operation.resultIds.map((id) =>
        boundedText(id, "Result ID", 256),
      ),
    };
  }
  throw new ApplicationError(
    "request.invalid",
    "Unsupported review operation.",
  );
}

function operationResultIds(operation: ReviewDecisionOperation): string[] {
  if (
    operation.kind === "merge-results" ||
    operation.kind === "reject-results" ||
    operation.kind === "adopt-story"
  )
    return [...operation.resultIds].sort();
  return [operation.resultId];
}

function evidenceAssetIds(evidence: SourceAnalysisEvidence): string[] {
  if (
    evidence.type === "travel-observation" ||
    evidence.type === "visual-sample"
  )
    return [evidence.assetId];
  return evidence.assetIds;
}

function adoptedBeatId(decisionId: string): string {
  return `review-${digest(decisionId).slice(0, 32)}`;
}
function storyRevision(story: Story): string {
  return digest(JSON.stringify(story));
}
function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedText(value: unknown, name: string, limit: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > limit ||
    hasControlCharacters(value)
  )
    throw new ApplicationError("request.invalid", `${name} is invalid.`);
  return value;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 32 || codePoint === 127) return true;
  }
  return false;
}

function boundedInteger(
  value: number,
  min: number,
  max: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new ApplicationError("request.invalid", `${name} is out of bounds.`);
  return value;
}

function boundedEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new ApplicationError("request.invalid", `${name} is invalid.`);
  return value as T;
}
