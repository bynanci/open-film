// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.
import type { ReviewExecutionOwner } from "./models.js";

/** Whitelisted pipeline step types. Unsupported step types are rejected by schema validation. */
export const ALLOWED_PIPELINE_STEP_TYPES = [
  "story-plan-select",
  "scene-prepare",
  "narration",
  "timing-captions",
  "composition-adopt",
  "render",
  "visual-qa",
  "export",
] as const;

export type PipelineStepType = (typeof ALLOWED_PIPELINE_STEP_TYPES)[number];

export type PipelinePortType =
  | "story-reference"
  | "story-plan"
  | "asset-list"
  | "scene-prep-result"
  | "audio-source"
  | "timing-result"
  | "composition"
  | "render-artifact"
  | "qa-report"
  | "export-artifact";

export interface PipelinePortDefinition {
  name: string;
  type: PipelinePortType;
  required?: boolean;
}

export interface PipelineStepDefinition {
  id: string;
  type: PipelineStepType;
  name: string;
  description?: string;
  inputs: PipelinePortDefinition[];
  outputs: PipelinePortDefinition[];
  requiresReview?: boolean;
}

export interface PipelineRecipe {
  schemaVersion: "1.0.0";
  id: string;
  version: string;
  name: string;
  description?: string;
  steps: PipelineStepDefinition[];
}

export type PipelineRunStatus =
  "idle" | "running" | "waiting-review" | "succeeded" | "failed" | "cancelled";

export type PipelineStepStatus =
  | "pending"
  | "running"
  | "waiting-review"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export type PipelineRunFreshness = "current" | "outdated";

export interface NarrationOptionNone {
  type: "none";
}

export interface NarrationOptionVoiceImport {
  type: "voice-import";
  assetId: string;
}

export interface NarrationOptionConfiguredTts {
  type: "configured-tts";
  providerId: string;
  voice?: string;
  speechConsent?: boolean;
}

export type PipelineNarrationOption =
  | NarrationOptionNone
  | NarrationOptionVoiceImport
  | NarrationOptionConfiguredTts;

export type PipelineCompositionTarget =
  | { version: 1; mode: "new-cut" }
  | {
      version: 1;
      mode: "resolve";
      compositionId: string;
      baseRevision: string;
    };
export function validatePipelineCompositionTarget(
  value: unknown,
): PipelineCompositionTarget {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error("An explicit composition target is required.");
  const data = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(data)) {
    const descriptor = Object.getOwnPropertyDescriptor(data, key)!;
    if (
      typeof key !== "string" ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    )
      throw new Error("Invalid composition target JSON data.");
  }
  const allowed =
    data.mode === "new-cut"
      ? ["version", "mode"]
      : ["version", "mode", "compositionId", "baseRevision"];
  for (const key of Reflect.ownKeys(data)) {
    const d = Object.getOwnPropertyDescriptor(data, key)!;
    if (
      typeof key !== "string" ||
      !allowed.includes(key) ||
      !d.enumerable ||
      !("value" in d)
    )
      throw new Error("Invalid composition target field.");
  }
  if (
    data.version !== 1 ||
    (data.mode !== "new-cut" && data.mode !== "resolve")
  )
    throw new Error("Unsupported composition target version or mode.");
  if (
    data.mode === "resolve" &&
    (typeof data.compositionId !== "string" ||
      !data.compositionId.trim() ||
      data.compositionId.length > 256 ||
      typeof data.baseRevision !== "string" ||
      !/^[a-f0-9]{64}$/.test(data.baseRevision))
  )
    throw new Error(
      "Resolve target requires an exact composition identity and revision.",
    );
  return structuredClone(data) as PipelineCompositionTarget;
}

export interface PipelineInputSnapshot {
  compositionTarget?: PipelineCompositionTarget;
  projectRevision: string | number;
  storyId?: string;
  storyPlanId?: string;
  assetIds: string[];
  narration: PipelineNarrationOption;
  exportFormat?: "mp4" | "json" | "otio";
  exportProfileId?: string;
  customParams?: Record<string, unknown>;
  inputDigest: string;
}

export interface PipelineReviewRecord {
  stepId: string;
  decision: "accepted" | "rejected" | "skipped";
  reviewedAt: string;
  reviewedBy?: string;
  notes?: string;
  adjustedOutputs?: Record<string, unknown>;
}

export interface PipelineStepAttempt {
  stepId: string;
  attemptNumber: number;
  status: PipelineStepStatus;
  jobId?: string;
  owner?: ReviewExecutionOwner;
  startedAt?: string;
  completedAt?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  inputSignature?: string;
  reuseSource?: {
    runId: string;
    stepId: string;
    reason: string;
  };
  error?: {
    message: string;
    code?: string;
    detail?: string;
  };
  reviewRecord?: PipelineReviewRecord;
}

export interface PipelineRunReceipt {
  stepId: string;
  action: string;
  sourceRevision: string | number;
  producedRevision: string | number;
  timestamp: string;
}

export interface PipelineArtifactRecord {
  id: string;
  stepId: string;
  kind:
    | "preview-video"
    | "qa-report"
    | "export-file"
    | "rough-cut-composition"
    | "audio-file"
    | "scene-prep"
    | "timing-result";
  path?: string;
  uri?: string;
  inputSignature?: string;
  outputHash?: string;
  sizeBytes?: number;
  adapterVersion?: string;
  verifiedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PipelineRun {
  schemaVersion: "1.0.0";
  id: string;
  recipeId: string;
  recipeVersion: string;
  projectId: string;
  inputSnapshot: PipelineInputSnapshot;
  expectedRevision: string | number;
  status: PipelineRunStatus;
  freshness: PipelineRunFreshness;
  currentStepIndex: number;
  stepAttempts: PipelineStepAttempt[];
  receipts: PipelineRunReceipt[];
  artifacts: PipelineArtifactRecord[];
  createdAt: string;
  updatedAt: string;
}

export type StepImpactStatus =
  "rerun" | "reuse" | "needs-review" | "unavailable";

export interface StepChangeImpact {
  stepId: string;
  stepType: PipelineStepType;
  stepName: string;
  status: StepImpactStatus;
  reason: string;
  reusableArtifactId?: string;
  reusableRunId?: string;
  inputsChanged: string[];
  currentSignature: string;
  baseSignature?: string;
}

export interface PipelineChangeImpactReport {
  schemaVersion: "1.0.0";
  recipeId: string;
  baseRunId?: string;
  projectRevision: string | number;
  steps: StepChangeImpact[];
  summary: {
    totalSteps: number;
    reusableSteps: number;
    rerunSteps: number;
    needsReviewSteps: number;
    unavailableSteps: number;
  };
  renderMode: "incremental" | "full-render-fallback";
  renderFallbackReason?: string;
  createdAt: string;
}

/** Pure deterministic FNV-1a mixer generating 64-char lowercase hex digest without Node crypto runtime. */
export function fnv1a64Mix(input: string): string {
  const seeds = [
    0x811c9dc5, 0x9e3779b9, 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c,
  ];
  const primes = [
    16777619, 16777643, 16777663, 16777681, 16777709, 16777727, 16777739,
    16777759,
  ];

  const hashes = seeds.slice();
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    for (let h = 0; h < 8; h++) {
      hashes[h] = Math.imul(hashes[h]! ^ code, primes[h]!) >>> 0;
    }
  }

  return hashes.map((h) => h.toString(16).padStart(8, "0")).join("");
}

function canonicalizeJson(val: unknown): unknown {
  if (val === null || typeof val !== "object") {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(canonicalizeJson);
  }
  const keys = Object.keys(val as Record<string, unknown>).sort();
  const res: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (val as Record<string, unknown>)[k];
    if (v !== undefined) {
      res[k] = canonicalizeJson(v);
    }
  }
  return res;
}

/** Compute deterministic consumed input signature for a single pipeline step. */
export function computeStepConsumedSignature(
  stepType: PipelineStepType,
  inputs: Record<string, unknown>,
): string {
  const canonical = JSON.stringify({
    stepType,
    inputs: canonicalizeJson(inputs),
  });
  return fnv1a64Mix(canonical);
}

/** Pure deterministic FNV-1a mixer generating 64-char lowercase hex digest without Node crypto runtime. */
export function computeInputSnapshotDigest(
  snapshot: Omit<PipelineInputSnapshot, "inputDigest">,
): string {
  const normalized = JSON.stringify({
    ...(snapshot.compositionTarget
      ? {
          compositionTarget: validatePipelineCompositionTarget(
            snapshot.compositionTarget,
          ),
        }
      : {}),
    projectRevision: snapshot.projectRevision,
    storyId: snapshot.storyId ?? null,
    storyPlanId: snapshot.storyPlanId ?? null,
    assetIds: [...snapshot.assetIds].sort(),
    narration: snapshot.narration,
    exportFormat: snapshot.exportFormat ?? "mp4",
    exportProfileId: snapshot.exportProfileId ?? null,
    customParams: snapshot.customParams ?? {},
  });

  return fnv1a64Mix(normalized);
}

/** Validates that a recipe is non-cyclic and its step types are strictly whitelisted. */
export function validatePipelineRecipe(raw: unknown): PipelineRecipe {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("PipelineRecipe must be a non-null object.");
  }
  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion !== "1.0.0") {
    throw new Error(
      `Unsupported recipe schemaVersion: expected '1.0.0', got '${String(obj.schemaVersion)}'.`,
    );
  }
  if (typeof obj.id !== "string" || !obj.id.trim()) {
    throw new Error("PipelineRecipe.id must be a non-empty string.");
  }
  if (typeof obj.version !== "string" || !obj.version.trim()) {
    throw new Error("PipelineRecipe.version must be a non-empty string.");
  }
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    throw new Error("PipelineRecipe.name must be a non-empty string.");
  }
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new Error("PipelineRecipe.steps must be a non-empty array.");
  }

  const stepIds = new Set<string>();
  const steps: PipelineStepDefinition[] = [];

  for (let i = 0; i < obj.steps.length; i++) {
    const rawStep = obj.steps[i];
    if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) {
      throw new Error(`PipelineRecipe.steps[${i}] must be an object.`);
    }
    const s = rawStep as Record<string, unknown>;
    if (typeof s.id !== "string" || !s.id.trim()) {
      throw new Error(
        `PipelineRecipe.steps[${i}].id must be a non-empty string.`,
      );
    }
    if (stepIds.has(s.id)) {
      throw new Error(`Duplicate step id in recipe: '${s.id}'.`);
    }
    stepIds.add(s.id);

    if (
      typeof s.type !== "string" ||
      !ALLOWED_PIPELINE_STEP_TYPES.includes(s.type as PipelineStepType)
    ) {
      throw new Error(
        `Disallowed or unknown step type '${String(s.type)}' at step '${s.id}'.`,
      );
    }

    if (typeof s.name !== "string" || !s.name.trim()) {
      throw new Error(
        `PipelineRecipe.steps[${i}].name must be a non-empty string.`,
      );
    }

    if (!Array.isArray(s.inputs) || !Array.isArray(s.outputs)) {
      throw new Error(
        `PipelineRecipe.steps[${i}].inputs and outputs must be arrays.`,
      );
    }

    steps.push({
      id: s.id,
      type: s.type as PipelineStepType,
      name: s.name,
      description:
        typeof s.description === "string" ? s.description : undefined,
      inputs: s.inputs as PipelinePortDefinition[],
      outputs: s.outputs as PipelinePortDefinition[],
      requiresReview: Boolean(s.requiresReview),
    });
  }

  const recipe: PipelineRecipe = {
    schemaVersion: "1.0.0",
    id: obj.id,
    version: obj.version,
    name: obj.name,
    description:
      typeof obj.description === "string" ? obj.description : undefined,
    steps,
  };

  // Check DAG acyclicity and port connectivity
  checkRecipeAcyclic(recipe);

  return recipe;
}

/** Check that the recipe has no circular dependencies among its step definitions. */
export function checkRecipeAcyclic(recipe: PipelineRecipe): void {
  // Build adjacency based on step sequence / port flow
  const stepIndices = new Map<string, number>();
  recipe.steps.forEach((s, idx) => stepIndices.set(s.id, idx));

  // In sequential linear recipes, step i cannot depend on step j where j >= i.
  // We can also build a full dependency graph from port bindings if steps explicitly specify step dependencies.
  // Here each step's index represents the execution order; backward edges indicate cycles.
  for (let i = 0; i < recipe.steps.length; i++) {
    const step = recipe.steps[i]!;
    for (const input of step.inputs) {
      // If an input is prefixed with stepId (e.g. 'step1.outputName')
      if (input.name.includes(".")) {
        const sourceStepId = input.name.split(".")[0]!;
        const sourceIdx = stepIndices.get(sourceStepId);
        if (sourceIdx === undefined) {
          throw new Error(
            `Step '${step.id}' input '${input.name}' references unknown step '${sourceStepId}'.`,
          );
        }
        if (sourceIdx >= i) {
          throw new Error(
            `Cyclic dependency detected: Step '${step.id}' depends on forward step '${sourceStepId}'.`,
          );
        }
      }
    }
  }
}

export function validatePipelineRun(raw: unknown): PipelineRun {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("PipelineRun must be a non-null object.");
  }
  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion !== "1.0.0") {
    throw new Error(
      `Unsupported PipelineRun schemaVersion: '${String(obj.schemaVersion)}'.`,
    );
  }
  if (typeof obj.id !== "string" || !obj.id.trim()) {
    throw new Error("PipelineRun.id must be a non-empty string.");
  }
  if (typeof obj.recipeId !== "string" || !obj.recipeId.trim()) {
    throw new Error("PipelineRun.recipeId must be a non-empty string.");
  }
  if (typeof obj.projectId !== "string" || !obj.projectId.trim()) {
    throw new Error("PipelineRun.projectId must be a non-empty string.");
  }
  if (!obj.inputSnapshot || typeof obj.inputSnapshot !== "object") {
    throw new Error("PipelineRun.inputSnapshot must be an object.");
  }
  if (
    typeof obj.expectedRevision !== "number" &&
    typeof obj.expectedRevision !== "string"
  ) {
    throw new Error("PipelineRun.expectedRevision must be a number or string.");
  }
  if (!Array.isArray(obj.stepAttempts)) {
    throw new Error("PipelineRun.stepAttempts must be an array.");
  }
  if (!Array.isArray(obj.receipts)) {
    throw new Error("PipelineRun.receipts must be an array.");
  }
  if (!Array.isArray(obj.artifacts)) {
    throw new Error("PipelineRun.artifacts must be an array.");
  }

  if (Object.hasOwn(obj.inputSnapshot, "compositionTarget"))
    validatePipelineCompositionTarget(
      (obj.inputSnapshot as Record<string, unknown>).compositionTarget,
    );
  return raw as PipelineRun;
}

/** Check if a PipelineRun has become outdated due to external project modification or source change. */
export function isRunOutdated(
  run: PipelineRun,
  currentProjectRevision: string | number,
  currentInputDigest?: string,
): boolean {
  if (String(currentProjectRevision) !== String(run.expectedRevision)) {
    return true;
  }
  if (
    currentInputDigest !== undefined &&
    currentInputDigest !== run.inputSnapshot.inputDigest
  ) {
    return true;
  }
  return false;
}

/** Check if a Change Impact Report is stale relative to the active project revision. */
export function isImpactReportStale(
  report: PipelineChangeImpactReport,
  currentProjectRevision: string | number,
): boolean {
  return String(report.projectRevision) !== String(currentProjectRevision);
}

/** Validate schema of a PipelineChangeImpactReport. */
export function validateChangeImpactReport(
  raw: unknown,
): PipelineChangeImpactReport {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("PipelineChangeImpactReport must be an object.");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== "1.0.0") {
    throw new Error(
      `Unsupported PipelineChangeImpactReport schemaVersion: '${String(obj.schemaVersion)}'.`,
    );
  }
  if (typeof obj.recipeId !== "string" || !obj.recipeId.trim()) {
    throw new Error(
      "PipelineChangeImpactReport.recipeId must be a non-empty string.",
    );
  }
  if (!Array.isArray(obj.steps)) {
    throw new Error("PipelineChangeImpactReport.steps must be an array.");
  }
  if (!obj.summary || typeof obj.summary !== "object") {
    throw new Error("PipelineChangeImpactReport.summary must be an object.");
  }
  if (
    obj.renderMode !== "incremental" &&
    obj.renderMode !== "full-render-fallback"
  ) {
    throw new Error(
      `Invalid renderMode: expected 'incremental' or 'full-render-fallback', got '${String(obj.renderMode)}'.`,
    );
  }
  return raw as PipelineChangeImpactReport;
}
