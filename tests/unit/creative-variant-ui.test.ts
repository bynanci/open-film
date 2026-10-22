// Modified by OpenFilm contributors on 2026-10-23. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateCreateVariantInput,
  validateCreativeVariant,
  compareCreativeVariants,
  type CreativeVariant,
  type Story,
  type Composition,
} from "@openfilm/core";

describe("Phase M11B: Creative Variants & A/B Review UI/UX Component", () => {
  it("verifies CreativeVariantComparisonModal SFC file structure and template contracts", () => {
    const sfcPath = resolve(
      "apps/desktop/src/components/CreativeVariantComparisonModal.vue",
    );
    const content = readFileSync(sfcPath, "utf8");

    // Modal accessibility & attributes
    expect(content).toContain('role="dialog"');
    expect(content).toContain('aria-modal="true"');
    expect(content).toContain('data-testid="creative-variant-modal"');

    // 3 tabs / views: list, create, compare
    expect(content).toContain("currentView = 'list'");
    expect(content).toContain("currentView = 'create'");
    expect(content).toContain("currentView = 'compare'");

    // Single-audio rule: only one variant channel plays audio at any time
    expect(content).toContain("activeAudioChannel");
    expect(content).toContain("selectAudio('A')");
    expect(content).toContain("selectAudio('B')");
    expect(content).toContain("audio-rule-notice");

    // Section alignment navigation (never falsely claim differing runtimes align by timestamp)
    expect(content).toContain("section-navigation-bar");
    expect(content).toContain("beats-track");
    expect(content).toContain("beat-nav-item");
    expect(content).toContain("selectedBeatIndex");

    // Live Change Impact Preview
    expect(content).toContain("handlePreviewImpact");
    expect(content).toContain("impactReport");
    expect(content).toContain("plannedChanges");
    expect(content).toContain("preservedSections");
    expect(content).toContain("unsupportedBrief");
    expect(content).toContain("locked-warning");

    // Automatic checkpoint notice before adoption
    expect(content).toContain("checkpoint-notice");
    expect(content).toContain("handleAdopt");

    // Keyboard & IME protection
    expect(content).toContain('target.tagName === "INPUT"');
    expect(content).toContain('target.tagName === "TEXTAREA"');
    expect(content).toContain("handleKeydown");

    // Responsive design & reduced motion
    expect(content).toContain("@media (max-width: 1280px)");
    expect(content).toContain("@media (max-width: 1024px)");
    expect(content).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("verifies App.vue integration of Creative Variants button and modal handler", () => {
    const sfcPath = resolve("apps/desktop/src/App.vue");
    const content = readFileSync(sfcPath, "utf8");

    // Import modal
    expect(content).toContain("CreativeVariantComparisonModal");

    // Toolbar button with icon
    expect(content).toContain('data-testid="creative-variants-btn"');
    expect(content).toContain("variantsModalOpen = true");

    // Mount modal & handle adopted event
    expect(content).toContain("<CreativeVariantComparisonModal");
    expect(content).toContain('@adopted="handleVariantAdopted"');
    expect(content).toContain("handleVariantAdopted");
  });

  it("validates core domain variant comparison and diffing contracts", () => {
    const baseVariant: CreativeVariant = {
      schemaVersion: "1.0.0",
      id: "a0000000-0000-4000-8000-000000000001",
      projectId: "proj-1",
      name: "Baseline Cut",
      intent: "Original story structure",
      scope: { type: "film" },
      baselineStoryId: "story-1",
      baselineCompositionId: "comp-1",
      derivedStoryId: "story-1",
      derivedCompositionId: "comp-1",
      provenanceMapping: {
        beatMappings: [{ baselineBeatId: "beat-1", variantBeatId: "beat-1" }],
        clipMappings: [
          {
            baselineClipId: "clip-1",
            variantClipId: "clip-1",
            trackId: "track-1",
          },
        ],
      },
      preservedSections: [],
      modifications: {},
      status: "draft",
      createdAt: "2026-10-23T00:00:00.000Z",
      updatedAt: "2026-10-23T00:00:00.000Z",
    };

    const variantB: CreativeVariant = {
      ...baseVariant,
      id: "b0000000-0000-4000-8000-000000000002",
      name: "Variant B - Faster Pacing",
      intent: "Tighten beat-1",
      scope: { type: "section", targetBeatId: "beat-1" },
      derivedStoryId: "story-b",
      derivedCompositionId: "comp-b",
      provenanceMapping: {
        beatMappings: [{ baselineBeatId: "beat-1", variantBeatId: "beat-1-b" }],
        clipMappings: [
          {
            baselineClipId: "clip-1",
            variantClipId: "clip-1-b",
            trackId: "track-1",
          },
        ],
      },
    };

    const validatedInput = validateCreateVariantInput({
      name: "Variant B - Faster Pacing",
      intent: "Tighten beat-1",
      scope: { type: "section", targetBeatId: "beat-1" },
    });
    expect(validatedInput.name).toBe("Variant B - Faster Pacing");

    expect(validateCreativeVariant(baseVariant)).toBeDefined();
    expect(validateCreativeVariant(variantB)).toBeDefined();

    const diff = compareCreativeVariants(
      baseVariant,
      variantB,
      {
        id: "story-1",
        title: "Test",
        beats: [{ id: "beat-1", title: "Intro", targetDuration: 5 }],
      } as unknown as Story,
      {
        id: "story-b",
        title: "Test",
        beats: [{ id: "beat-1-b", title: "Intro", targetDuration: 3 }],
      } as unknown as Story,
      {
        id: "comp-1",
        duration: 5,
        tracks: [
          {
            id: "track-1",
            clips: [
              {
                id: "clip-1",
                assetId: "photo-1",
                timelineStart: 0,
                timelineDuration: 5,
                sourceIn: 0,
                sourceOut: 5,
              },
            ],
          },
        ],
      } as unknown as Composition,
      {
        id: "comp-b",
        duration: 3,
        tracks: [
          {
            id: "track-1",
            clips: [
              {
                id: "clip-1-b",
                assetId: "photo-1",
                timelineStart: 0,
                timelineDuration: 3,
                sourceIn: 0,
                sourceOut: 3,
              },
            ],
          },
        ],
      } as unknown as Composition,
    );

    expect(diff.deltaSeconds).toBe(-2);
    expect(diff.beatDiffs.length).toBe(1);
    expect(diff.beatDiffs[0]?.changed).toBe(true);
    expect(diff.clipDiffs.length).toBe(1);
    expect(diff.clipDiffs[0]?.changed).toBe(true);
  });
});
