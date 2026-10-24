// Modified by OpenFilm contributors on 2026-10-24. See LICENSE and NOTICE.

export type WorkbenchStageKey =
  "materials" | "storyPlan" | "produceClips" | "previewQa" | "export";

export type WorkbenchStageStatus =
  | "idle"
  | "pending"
  | "running"
  | "waiting-review"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export interface WorkbenchStageDefinition {
  key: WorkbenchStageKey;
  stepIds: readonly string[];
}

/**
 * Product-facing gates over the canonical recipe. Step 1 contributes both the
 * source-selection and story-plan gates, while execution still has one owner.
 */
export const WORKBENCH_STAGES: readonly WorkbenchStageDefinition[] = [
  { key: "materials", stepIds: ["step-1"] },
  { key: "storyPlan", stepIds: ["step-1", "step-2"] },
  {
    key: "produceClips",
    stepIds: ["step-3", "step-4", "step-5"],
  },
  { key: "previewQa", stepIds: ["step-6", "step-7"] },
  { key: "export", stepIds: ["step-8"] },
] as const;

export function pipelineStageForStep(
  stepId: string,
): WorkbenchStageKey | undefined {
  return WORKBENCH_STAGES.find((stage) => stage.stepIds.includes(stepId))?.key;
}

export function adjacentWorkbenchStage(
  current: WorkbenchStageKey,
  direction: -1 | 1,
): WorkbenchStageKey {
  const index = WORKBENCH_STAGES.findIndex((stage) => stage.key === current);
  const nextIndex = Math.min(
    WORKBENCH_STAGES.length - 1,
    Math.max(0, (index < 0 ? 0 : index) + direction),
  );
  return WORKBENCH_STAGES[nextIndex]!.key;
}

export function summarizeWorkbenchProgress(
  statuses: Record<WorkbenchStageKey, WorkbenchStageStatus | string>,
): { completed: number; total: number; percent: number } {
  const total = WORKBENCH_STAGES.length;
  const completed = WORKBENCH_STAGES.filter(
    (stage) => statuses[stage.key] === "succeeded",
  ).length;
  return {
    completed,
    total,
    percent: Math.round((completed / total) * 100),
  };
}

export function resolveWorkbenchStageStatus(
  statuses: readonly WorkbenchStageStatus[],
): WorkbenchStageStatus {
  if (statuses.length === 0) return "idle";
  for (const status of [
    "failed",
    "waiting-review",
    "running",
    "cancelled",
  ] as const) {
    if (statuses.includes(status)) return status;
  }
  if (
    statuses.every((status) => status === "succeeded" || status === "skipped")
  )
    return statuses.some((status) => status === "succeeded")
      ? "succeeded"
      : "skipped";
  if (statuses.includes("pending")) return "pending";
  return "idle";
}
