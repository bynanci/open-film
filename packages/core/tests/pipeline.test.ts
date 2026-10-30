// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.
import { describe, expect, it } from "vitest";
import {
  validatePipelineRecipe,
  validatePipelineCompositionTarget,
  validatePipelineRun,
  computeInputSnapshotDigest,
  isRunOutdated,
  type PipelineRecipe,
  type PipelineRun,
} from "../src/pipeline.js";

describe("PipelineRecipe and PipelineRun Core Domain Models", () => {
  it("validates a well-formed canonical recipe", () => {
    const validRecipe: PipelineRecipe = {
      schemaVersion: "1.0.0",
      id: "guided-story-to-video",
      version: "1.0.0",
      name: "Guided Story to Video Production",
      description: "From assets to final QA and exported film.",
      steps: [
        {
          id: "step-1",
          type: "story-plan-select",
          name: "Select Story & Assets",
          inputs: [],
          outputs: [{ name: "story-plan", type: "story-plan" }],
        },
        {
          id: "step-2",
          type: "scene-prepare",
          name: "Prepare Scenes & Visuals",
          inputs: [{ name: "step-1.story-plan", type: "story-plan" }],
          outputs: [{ name: "scene-prep-result", type: "scene-prep-result" }],
        },
        {
          id: "step-3",
          type: "narration",
          name: "Voice Narration",
          inputs: [
            { name: "step-2.scene-prep-result", type: "scene-prep-result" },
          ],
          outputs: [{ name: "audio-source", type: "audio-source" }],
          requiresReview: true,
        },
        {
          id: "step-4",
          type: "timing-captions",
          name: "Timing & Captions Alignment",
          inputs: [{ name: "step-3.audio-source", type: "audio-source" }],
          outputs: [{ name: "timing-result", type: "timing-result" }],
        },
        {
          id: "step-5",
          type: "composition-adopt",
          name: "Adopt Rough Cut Composition",
          inputs: [{ name: "step-4.timing-result", type: "timing-result" }],
          outputs: [{ name: "composition", type: "composition" }],
        },
        {
          id: "step-6",
          type: "render",
          name: "Render Video",
          inputs: [{ name: "step-5.composition", type: "composition" }],
          outputs: [{ name: "render-artifact", type: "render-artifact" }],
        },
        {
          id: "step-7",
          type: "visual-qa",
          name: "Visual QA Inspection",
          inputs: [{ name: "step-6.render-artifact", type: "render-artifact" }],
          outputs: [{ name: "qa-report", type: "qa-report" }],
          requiresReview: true,
        },
        {
          id: "step-8",
          type: "export",
          name: "Final Export",
          inputs: [{ name: "step-7.qa-report", type: "qa-report" }],
          outputs: [{ name: "export-artifact", type: "export-artifact" }],
        },
      ],
    };

    const validated = validatePipelineRecipe(validRecipe);
    expect(validated.id).toBe("guided-story-to-video");
    expect(validated.steps.length).toBe(8);
  });

  it("rejects disallowed or unknown step types outside whitelist", () => {
    const invalidRecipe = {
      schemaVersion: "1.0.0",
      id: "malicious-recipe",
      version: "1.0.0",
      name: "Arbitrary Script Runner",
      steps: [
        {
          id: "evil-step",
          type: "arbitrary-script-execution",
          name: "Run Shell Command",
          inputs: [],
          outputs: [],
        },
      ],
    };

    expect(() => validatePipelineRecipe(invalidRecipe)).toThrow(
      /Disallowed or unknown step type 'arbitrary-script-execution'/,
    );
  });

  it("detects and rejects cyclic dependencies in recipe steps", () => {
    const cyclicRecipe = {
      schemaVersion: "1.0.0",
      id: "cyclic-recipe",
      version: "1.0.0",
      name: "Cyclic Test Recipe",
      steps: [
        {
          id: "step-a",
          type: "story-plan-select",
          name: "Step A",
          inputs: [{ name: "step-b.output", type: "story-plan" }],
          outputs: [{ name: "output", type: "story-plan" }],
        },
        {
          id: "step-b",
          type: "scene-prepare",
          name: "Step B",
          inputs: [{ name: "step-a.output", type: "story-plan" }],
          outputs: [{ name: "output", type: "story-plan" }],
        },
      ],
    };

    expect(() => validatePipelineRecipe(cyclicRecipe)).toThrow(
      /Cyclic dependency detected/,
    );
  });

  it("computes pure deterministic 64-character lowercase hex digest for input snapshots", () => {
    const snapshot1 = {
      projectRevision: 5,
      storyId: "story_123",
      assetIds: ["asset_b", "asset_a"],
      narration: { type: "none" as const },
      exportFormat: "mp4" as const,
    };
    const snapshot2 = {
      projectRevision: 5,
      storyId: "story_123",
      assetIds: ["asset_a", "asset_b"], // Order difference should normalize to identical digest
      narration: { type: "none" as const },
      exportFormat: "mp4" as const,
    };

    const digest1 = computeInputSnapshotDigest(snapshot1);
    const digest2 = computeInputSnapshotDigest(snapshot2);

    expect(digest1).toMatch(/^[a-f0-9]{64}$/);
    expect(digest1).toBe(digest2);

    const changedDigest = computeInputSnapshotDigest({
      ...snapshot1,
      projectRevision: 6,
    });
    expect(changedDigest).not.toBe(digest1);
  });

  it("evaluates outdated status correctly between expected revision and project changes", () => {
    const mockRun: PipelineRun = {
      schemaVersion: "1.0.0",
      id: "run_test_1",
      recipeId: "guided-story-to-video",
      recipeVersion: "1.0.0",
      projectId: "proj_1",
      inputSnapshot: {
        projectRevision: 10,
        assetIds: ["a1"],
        narration: { type: "none" },
        inputDigest:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
      expectedRevision: 10,
      status: "succeeded",
      freshness: "current",
      currentStepIndex: 8,
      stepAttempts: [],
      receipts: [],
      artifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // When project revision matches expected revision, it is NOT outdated
    expect(isRunOutdated(mockRun, 10)).toBe(false);

    // When project revision changes externally (e.g. to 11), it becomes outdated
    expect(isRunOutdated(mockRun, 11)).toBe(true);

    // If expectedRevision was legally bumped to 11 by an adoption receipt
    const adoptedRun: PipelineRun = {
      ...mockRun,
      expectedRevision: 11,
    };
    expect(isRunOutdated(adoptedRun, 11)).toBe(false);
  });

  it("validates a PipelineRun structure", () => {
    const run: PipelineRun = {
      schemaVersion: "1.0.0",
      id: "run_abc",
      recipeId: "test_recipe",
      recipeVersion: "1.0.0",
      projectId: "project_1",
      inputSnapshot: {
        projectRevision: 1,
        assetIds: [],
        narration: { type: "none" },
        inputDigest: "abc",
      },
      expectedRevision: 1,
      status: "idle",
      freshness: "current",
      currentStepIndex: 0,
      stepAttempts: [],
      receipts: [],
      artifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const validated = validatePipelineRun(run);
    expect(validated.id).toBe("run_abc");
  });
});

describe("pin-aware pipeline targets", () => {
  it("strictly validates closed versioned targets", () => {
    expect(
      validatePipelineCompositionTarget({ version: 1, mode: "new-cut" }),
    ).toEqual({ version: 1, mode: "new-cut" });
    for (const input of [
      { version: 2, mode: "new-cut" },
      { version: 1, mode: "new-cut", compositionId: "x" },
      { version: 1, mode: "resolve", compositionId: "x", baseRevision: "old" },
      {
        version: 1,
        mode: "resolve",
        compositionId: "x",
        baseRevision: "a".repeat(64),
        origin: "restore",
      },
    ])
      expect(() => validatePipelineCompositionTarget(input)).toThrow();
  });
  it("rejects target accessors without invoking them", () => {
    let reads = 0;
    const target = Object.defineProperty({ version: 1 }, "mode", {
      enumerable: true,
      get() {
        reads++;
        return "new-cut";
      },
    });
    expect(() => validatePipelineCompositionTarget(target)).toThrow();
    expect(reads).toBe(0);
  });
  it("composition targets participate in immutable input signatures", () => {
    const base = {
      projectRevision: "rev",
      assetIds: [],
      narration: { type: "none" as const },
    };
    expect(
      computeInputSnapshotDigest({
        ...base,
        compositionTarget: { version: 1, mode: "new-cut" },
      }),
    ).not.toBe(
      computeInputSnapshotDigest({
        ...base,
        compositionTarget: {
          version: 1,
          mode: "resolve",
          compositionId: "x",
          baseRevision: "a".repeat(64),
        },
      }),
    );
  });
});
