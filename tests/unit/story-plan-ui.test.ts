// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StoryPlan } from "@openfilm/core";
import { validateStoryPlan } from "@openfilm/core";

describe("Phase M9B: Storyboard Proposal & Review Modal UI Component", () => {
  it("verifies StoryPlanReviewModal SFC file structure and template contracts", () => {
    const sfcPath = resolve(
      "apps/desktop/src/components/StoryPlanReviewModal.vue",
    );
    const content = readFileSync(sfcPath, "utf8");

    // Must define dialog attributes and role="dialog"
    expect(content).toContain('role="dialog"');
    expect(content).toContain('aria-modal="true"');

    // Must handle all 5 storyboard proposal dimensions:
    // 1. whichImage
    expect(content).toContain("whichImage");
    expect(content).toContain("thumbnailUrl");
    // 2. whatExpressed (intent)
    expect(content).toContain("whatExpressed");
    expect(content).toContain("scene.intent");
    // 3. howPresented (visualDirection)
    expect(content).toContain("howPresented");
    expect(content).toContain("scene.visualDirection");
    // 4. howLong (targetDuration & estimatedNarration)
    expect(content).toContain("howLong");
    expect(content).toContain("targetDuration");
    expect(content).toContain("estimatedNarration");
    // 5. whyRationale (rationale)
    expect(content).toContain("whyRationale");
    expect(content).toContain("scene.rationale");

    // Source nature indicators
    expect(content).toContain("sourceNature");
    expect(content).toContain("source-badge");

    // PhotoDepth fallback indicator without fake depth mask
    expect(content).toContain("photoDepthFallback");
    expect(content).toContain("depth-fallback-pill");

    // Thematic echo badge
    expect(content).toContain("role-echo");
    expect(content).toContain("echoRole");

    // Diagnostics / Conflicts / Ambiguities
    expect(content).toContain("plan.path.cycleDetected");
    expect(content).toContain("plan.path.isAmbiguous");
    expect(content).toContain("plan.unsupportedIntents");

    // Accessibility & reduced motion
    expect(content).toContain("@media (prefers-reduced-motion: reduce)");
    expect(content).toContain("handleKeydown");
  });

  it("verifies StoryGraphView integration of 'Organize into Beats' (整理成段落) button and modal", () => {
    const sfcPath = resolve("apps/desktop/src/components/StoryGraphView.vue");
    const content = readFileSync(sfcPath, "utf8");

    // Import modal
    expect(content).toContain("StoryPlanReviewModal");

    // Toolbar button
    expect(content).toContain("plan-storyboard-btn");
    expect(content).toContain('t("app.storyPlan.button")');

    // Modal mounting
    expect(content).toContain("<StoryPlanReviewModal");
    expect(content).toContain(':show="planModalOpen"');
    expect(content).toContain('@adopted="handleAdopted"');
  });

  it("validates that sample StoryPlan contains all proposal dimensions and passes schema validation", () => {
    const mockPlan: StoryPlan = {
      version: 1,
      id: "plan-test-sample",
      storyId: "story-sample",
      title: "Sample Storyboard Proposal",
      targetDuration: 30,
      maxDuration: 30,
      inputRevision: "a".repeat(64),
      sourceSignature: "b".repeat(64),
      path: {
        nodeIds: ["node-1", "node-2"],
        isAmbiguous: false,
      },
      scenes: [
        {
          sceneId: "scene-1",
          title: "Sunrise at Trailhead",
          intent: "Establish serene setting",
          visualDirection:
            "Slow push in on mountain peak illuminated by dawn light",
          rationale: "Selected as opening anchor to establish quiet atmosphere",
          narration: "We arrived before the sun crested the ridge.",
          targetDuration: 15,
          estimatedDuration: 3.5,
          sourceNature: "user-memory",
          assets: [
            {
              assetId: "photo-1",
              name: "Sunrise.jpg",
              role: "hero",
              photoDepthSupported: false,
              photoDepthFallback: "standard-hold",
            },
          ],
        },
        {
          sceneId: "scene-2",
          title: "Looking Back from the Summit",
          intent: "Echo the morning trailhead with wide perspective",
          visualDirection: "Wide panoramic hold with gentle float",
          rationale:
            "Thematic echo revisiting trailhead imagery from elevated vantage",
          narration:
            "Looking back, our starting point was just a speck in the distance.",
          targetDuration: 15,
          estimatedDuration: 4.2,
          sourceNature: "planned",
          assets: [
            {
              assetId: "photo-1",
              name: "Sunrise.jpg",
              role: "echo",
              isEcho: true,
              photoDepthSupported: false,
              photoDepthFallback: "standard-hold",
            },
          ],
        },
      ],
      unsupportedIntents: [],
      conflicts: [],
      transition: "cut",
      createdAt: new Date().toISOString(),
    };

    const validated = validateStoryPlan(mockPlan);
    expect(validated.version).toBe(1);
    expect(validated.scenes[0]!.assets[0]!.role).toBe("hero");
    expect(validated.scenes[1]!.assets[0]!.role).toBe("echo");
    expect(validated.scenes[1]!.assets[0]!.isEcho).toBe(true);
  });
});
