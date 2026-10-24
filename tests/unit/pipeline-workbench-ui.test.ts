// Modified by OpenFilm contributors on 2026-10-23. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WORKBENCH_STAGES } from "../../apps/desktop/src/pipeline-workbench-model";

describe("Phase M10B: Pipeline Workbench UI/UX Component", () => {
  it("verifies PipelineWorkbench SFC file structure, three modes and 5-stage architecture", () => {
    const sfcPath = resolve(
      "apps/desktop/src/components/PipelineWorkbench.vue",
    );
    const content = readFileSync(sfcPath, "utf8");

    // Three modes supported: bar, drawer, modal
    expect(content).toContain("pipeline-status-bar");
    expect(content).toContain("is-drawer");
    expect(content).toContain("is-modal");
    expect(content).toContain("switchMode('bar')");
    expect(content).toContain("switchMode('drawer')");
    expect(content).toContain("switchMode('modal')");

    // Simplified 5 stages
    expect(content).toContain("materials");
    expect(content).toContain("storyPlan");
    expect(content).toContain("produceClips");
    expect(content).toContain("previewQa");
    expect(content).toContain("export");

    // 4 Questions answered per card
    expect(content).toContain("card.usedWhat");
    expect(content).toContain("card.producedWhat");
    expect(content).toContain("card.currentStatus");
    expect(content).toContain("card.nextAction");

    // Media preview protections
    expect(content).toContain("mini-asset-thumbnails");
    expect(content).toContain("thumbnailUrl");
    expect(content).toContain("audio-audition-card");
    expect(content).toContain("handleAuditionToggle");
    expect(content).toContain("video-poster-box");
    expect(content).toContain("activeVideoPlaying");

    // Disclosures & safety
    expect(content).toContain("disclosures.outdatedNotice");
    expect(content).toContain("disclosures.noM11aNotice");
    expect(content).toContain("disclosures.remoteConsentTitle");
    expect(content).toContain("disclosures.waitingUserPrompt");
    expect(content).toContain("indeterminate-bar");

    // Cross-view navigation triggers
    expect(content).toContain("navigateToStory('graph')");
    expect(content).toContain("navigateToStory('storyboard')");
    expect(content).toContain("navigateToTimeline");

    // Keyboard & IME protection
    expect(content).toContain('target.tagName === "INPUT"');
    expect(content).toContain('target.tagName === "TEXTAREA"');
    expect(content).toContain("target.isContentEditable");

    // M11A Change Impact and incremental execution
    expect(content).toContain("workbench-impact-panel");
    expect(content).toContain("handleAnalyzeImpact");
    expect(content).toContain("handleStartIncrementalRun");
    expect(content).toContain("impact.title");
    expect(content).toContain("impact.reusableSummary");
    expect(content).toContain("impact.fullRenderFallback");
    expect(content).toContain("impactStatus");
    expect(content).toContain("ctas.startIncrementalRun");
    expect(content).toContain("ctas.viewImpact");

    // Responsive 3-pane & reduced motion
    expect(content).toContain("workbench-pane-nav");
    expect(content).toContain("workbench-pane-card");
    expect(content).toContain("workbench-pane-inspector");
    expect(content).toContain("gate-summary");
    expect(content).toContain("canonical-task-list");
    expect(content).toContain(
      ':data-workspace-mode="preferences.workspaceMode"',
    );
    expect(content).toContain("@media (max-width: 1280px)");
    expect(content).toContain("@media (max-width: 1024px)");
    expect(content).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("verifies App.vue integration with PipelineWorkbench docked bar and drawer", () => {
    const appPath = resolve("apps/desktop/src/App.vue");
    const content = readFileSync(appPath, "utf8");

    // Import PipelineWorkbench
    expect(content).toContain("PipelineWorkbench");
    expect(content).toContain("type WorkbenchMode");

    // State declarations
    expect(content).toContain("pipelineWorkbenchOpen");
    expect(content).toContain("pipelineWorkbenchMode");
    expect(content).toContain("handleWorkbenchModeChange");
    expect(content).toContain("handleNavigateStoryFromPipeline");
    expect(content).toContain("handleNavigateTimelineFromPipeline");

    // Mounted above footer with mode switching
    expect(content).toContain("<PipelineWorkbench");
    expect(content).toContain(':initial-mode="pipelineWorkbenchMode"');
    expect(content).toContain('@mode-change="handleWorkbenchModeChange"');
    expect(content).toContain(
      '@navigate-story="handleNavigateStoryFromPipeline"',
    );
    expect(content).toContain(
      '@navigate-timeline="handleNavigateTimelineFromPipeline"',
    );
  });

  it("validates 5-stage mapping to canonical 8 pipeline steps", () => {
    // Stage 1: Materials -> step 1 assets
    // Stage 2: Story Plan -> step 1 plan, step 2 scene prep
    // Stage 3: Produce Clips -> step 3 narration, step 4 timing, step 5 composition adopt
    // Stage 4: Preview & QA -> step 6 render, step 7 visual qa
    // Stage 5: Export -> step 8 export
    expect(WORKBENCH_STAGES).toHaveLength(5);
    const allSteps = WORKBENCH_STAGES.flatMap((stage) => stage.stepIds);
    expect(allSteps).toContain("step-1");
    expect(allSteps).toContain("step-3");
    expect(allSteps).toContain("step-5");
    expect(allSteps).toContain("step-7");
    expect(allSteps).toContain("step-8");
  });
});
