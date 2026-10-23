// Modified by OpenFilm contributors on 2026-10-23. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALLOWED_PIPELINE_STEP_TYPES,
  validatePipelineRecipe,
  type PipelineRecipe,
} from "@openfilm/core";

describe("Phase M10A: Pipeline Orchestration Modal UI Component", () => {
  it("verifies PipelineOrchestrationModal SFC file structure and template contracts", () => {
    const sfcPath = resolve(
      "apps/desktop/src/components/PipelineOrchestrationModal.vue",
    );
    const content = readFileSync(sfcPath, "utf8");

    // Must define dialog attributes and role="dialog"
    expect(content).toContain('role="dialog"');
    expect(content).toContain('aria-modal="true"');
    expect(content).toContain('aria-labelledby="pipeline-modal-title"');

    // Preflight controls & narration choices
    expect(content).toContain("narrationStrategy");
    expect(content).toContain("voice-import");
    expect(content).toContain("configured-tts");
    expect(content).toContain("selectedVoiceAssetId");

    // Stepper track & step badges
    expect(content).toContain("pipeline-steps-track");
    expect(content).toContain("pipeline-step-card");
    expect(content).toContain("pipeline-status-chip");
    expect(content).toContain("stepAttempts[idx]?.status");

    // Review decision actions (for waiting-review state)
    expect(content).toContain("pipeline-review-card");
    expect(content).toContain("reviewNotes");
    expect(content).toContain("handleReviewDecision('accepted')");
    expect(content).toContain("handleReviewDecision('rejected')");

    // Artifacts list
    expect(content).toContain("pipeline-artifacts-card");
    expect(content).toContain("art.kind");
    expect(content).toContain("art.path");

    // Outdated warning banner
    expect(content).toContain("pipeline-alert-warning");
    expect(content).toContain("currentRun.freshness === 'outdated'");

    // Accessibility, responsive styles, & reduced motion
    expect(content).toContain("@media (prefers-reduced-motion: reduce)");
    expect(content).toContain("@media (max-width: 1024px)");
    expect(content).toContain("@media (max-width: 768px)");
    expect(content).toContain("handleKeydown");
  });

  it("verifies App.vue integration of Pipeline trigger and modal", () => {
    const appPath = resolve("apps/desktop/src/App.vue");
    const content = readFileSync(appPath, "utf8");

    // Import modal
    expect(content).toContain("PipelineOrchestrationModal");

    // Header toggle button
    expect(content).toContain("pipeline-toggle");
    expect(content).toContain("pipelineModalOpen = true");

    // Story workspace action button
    expect(content).toContain("pipeline-action");

    // Modal mounting with props and events
    expect(content).toContain("<PipelineOrchestrationModal");
    expect(content).toContain(':open="pipelineModalOpen"');
    expect(content).toContain('@close="pipelineModalOpen = false"');
    expect(content).toContain('@rough-cut-adopted="handleRoughCutAdopted"');

    // Adoption handler switches to edit tab
    expect(content).toContain("async function handleRoughCutAdopted");
    expect(content).toContain('tab.value = "edit"');
  });

  it("validates that canonical recipe passes schema checks and contains all 8 whitelisted steps", () => {
    const canonicalSteps: (typeof ALLOWED_PIPELINE_STEP_TYPES)[number][] = [
      "story-plan-select",
      "scene-prepare",
      "narration",
      "timing-captions",
      "composition-adopt",
      "render",
      "visual-qa",
      "export",
    ];

    for (const stepType of canonicalSteps) {
      expect(ALLOWED_PIPELINE_STEP_TYPES).toContain(stepType);
    }

    const testRecipe: PipelineRecipe = {
      schemaVersion: "1.0.0",
      id: "guided-story-to-video",
      version: "1.0.0",
      name: "Guided Story-to-Video Production",
      description: "Fixed recipe production flow",
      steps: [
        {
          id: "step-1",
          type: "story-plan-select",
          name: "Select Story Plan",
          inputs: [],
          outputs: [{ name: "plan", type: "story-plan" }],
        },
        {
          id: "step-2",
          type: "scene-prepare",
          name: "Prepare Scenes",
          inputs: [{ name: "plan", type: "story-plan" }],
          outputs: [{ name: "scenes", type: "scene-prep-result" }],
        },
        {
          id: "step-3",
          type: "narration",
          name: "Narration Strategy",
          inputs: [{ name: "scenes", type: "scene-prep-result" }],
          outputs: [{ name: "audio", type: "audio-source" }],
        },
        {
          id: "step-4",
          type: "timing-captions",
          name: "Timing & Captions",
          inputs: [{ name: "audio", type: "audio-source" }],
          outputs: [{ name: "timing", type: "timing-result" }],
        },
        {
          id: "step-5",
          type: "composition-adopt",
          name: "Adopt Rough Cut",
          inputs: [{ name: "timing", type: "timing-result" }],
          outputs: [{ name: "composition", type: "composition" }],
        },
        {
          id: "step-6",
          type: "render",
          name: "Render Film",
          inputs: [{ name: "composition", type: "composition" }],
          outputs: [{ name: "render", type: "render-artifact" }],
        },
        {
          id: "step-7",
          type: "visual-qa",
          name: "Visual QA Inspection",
          inputs: [{ name: "render", type: "render-artifact" }],
          outputs: [{ name: "qa-report", type: "qa-report" }],
        },
        {
          id: "step-8",
          type: "export",
          name: "Export Final Film",
          inputs: [{ name: "qa-report", type: "qa-report" }],
          outputs: [{ name: "destination", type: "export-artifact" }],
        },
      ],
    };

    const validated = validatePipelineRecipe(testRecipe);
    expect(validated.id).toBe("guided-story-to-video");
    expect(validated.steps.length).toBe(8);
  });
});
