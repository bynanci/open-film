// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.
import { describe, expect, it } from "vitest";
import {
  computeStepConsumedSignature,
  validateChangeImpactReport,
  isImpactReportStale,
  type PipelineChangeImpactReport,
} from "../src/pipeline.js";

describe("M11A Core: Change Impact & Step Consumed Signatures", () => {
  it("computes deterministic signature regardless of object key order", () => {
    const inputs1 = {
      storyId: "story_1",
      subtitleText: "Hello world",
      assetIds: ["a1", "a2"],
      settings: { width: 1920, height: 1080 },
    };
    const inputs2 = {
      settings: { height: 1080, width: 1920 },
      assetIds: ["a1", "a2"],
      subtitleText: "Hello world",
      storyId: "story_1",
    };

    const sig1 = computeStepConsumedSignature("timing-captions", inputs1);
    const sig2 = computeStepConsumedSignature("timing-captions", inputs2);

    expect(sig1).toHaveLength(64);
    expect(sig1).toBe(sig2);
  });

  it("produces distinct signatures when inputs change", () => {
    const base = {
      storyId: "story_1",
      subtitleText: "Original subtitle",
    };
    const modified = {
      storyId: "story_1",
      subtitleText: "Updated subtitle",
    };

    const sigBase = computeStepConsumedSignature("timing-captions", base);
    const sigMod = computeStepConsumedSignature("timing-captions", modified);

    expect(sigBase).not.toBe(sigMod);
  });

  it("validates valid PipelineChangeImpactReport schema", () => {
    const report: PipelineChangeImpactReport = {
      schemaVersion: "1.0.0",
      recipeId: "guided-story-to-video",
      baseRunId: "run_base123",
      projectRevision: "rev_100",
      steps: [
        {
          stepId: "step-1",
          stepType: "story-plan-select",
          stepName: "Select Story & Assets",
          status: "reuse",
          reason: "Inputs unchanged",
          inputsChanged: [],
          currentSignature: "a".repeat(64),
        },
        {
          stepId: "step-4",
          stepType: "timing-captions",
          stepName: "Timing & Captions",
          status: "rerun",
          reason: "Subtitle changed",
          inputsChanged: ["subtitleText"],
          currentSignature: "b".repeat(64),
        },
      ],
      summary: {
        totalSteps: 2,
        reusableSteps: 1,
        rerunSteps: 1,
        needsReviewSteps: 0,
        unavailableSteps: 0,
      },
      renderMode: "full-render-fallback",
      renderFallbackReason: "Subtitles changed; full rasterization required",
      createdAt: new Date().toISOString(),
    };

    const validated = validateChangeImpactReport(report);
    expect(validated.schemaVersion).toBe("1.0.0");
    expect(validated.renderMode).toBe("full-render-fallback");
  });

  it("detects stale impact reports when project revision advances", () => {
    const report: PipelineChangeImpactReport = {
      schemaVersion: "1.0.0",
      recipeId: "guided-story-to-video",
      projectRevision: "rev_100",
      steps: [],
      summary: {
        totalSteps: 0,
        reusableSteps: 0,
        rerunSteps: 0,
        needsReviewSteps: 0,
        unavailableSteps: 0,
      },
      renderMode: "incremental",
      createdAt: new Date().toISOString(),
    };

    expect(isImpactReportStale(report, "rev_100")).toBe(false);
    expect(isImpactReportStale(report, "rev_101")).toBe(true);
  });
});
