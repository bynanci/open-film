// Modified by OpenFilm contributors on 2026-10-24. See LICENSE and NOTICE.

import { describe, expect, it } from "vitest";
import {
  WORKBENCH_STAGES,
  adjacentWorkbenchStage,
  pipelineStageForStep,
  resolveWorkbenchStageStatus,
  summarizeWorkbenchProgress,
} from "../../apps/desktop/src/pipeline-workbench-model";

describe("pipeline workbench stage model", () => {
  it("maps the canonical eight tasks into five ordered review gates", () => {
    expect(WORKBENCH_STAGES.map((stage) => stage.key)).toEqual([
      "materials",
      "storyPlan",
      "produceClips",
      "previewQa",
      "export",
    ]);
    expect(WORKBENCH_STAGES.flatMap((stage) => stage.stepIds)).toEqual([
      "step-1",
      "step-1",
      "step-2",
      "step-3",
      "step-4",
      "step-5",
      "step-6",
      "step-7",
      "step-8",
    ]);
    expect(pipelineStageForStep("step-4")).toBe("produceClips");
    expect(pipelineStageForStep("step-8")).toBe("export");
  });

  it("moves one gate at a time and clamps at the fixed boundaries", () => {
    expect(adjacentWorkbenchStage("materials", -1)).toBe("materials");
    expect(adjacentWorkbenchStage("materials", 1)).toBe("storyPlan");
    expect(adjacentWorkbenchStage("previewQa", 1)).toBe("export");
    expect(adjacentWorkbenchStage("export", 1)).toBe("export");
  });

  it("reports accessible gate progress from the shared status model", () => {
    expect(
      summarizeWorkbenchProgress({
        materials: "succeeded",
        storyPlan: "succeeded",
        produceClips: "waiting-review",
        previewQa: "idle",
        export: "idle",
      }),
    ).toEqual({ completed: 2, total: 5, percent: 40 });
  });

  it("surfaces the highest-priority task state for a multi-task gate", () => {
    expect(
      resolveWorkbenchStageStatus(["succeeded", "running", "pending"]),
    ).toBe("running");
    expect(
      resolveWorkbenchStageStatus(["succeeded", "waiting-review", "failed"]),
    ).toBe("failed");
    expect(resolveWorkbenchStageStatus(["succeeded", "succeeded"])).toBe(
      "succeeded",
    );
  });
});
