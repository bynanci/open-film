// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.

import { describe, expect, it } from "vitest";
import {
  validateCreateVariantInput,
  validateCreativeVariant,
  compareCreativeVariants,
  type CreativeVariant,
  type Story,
  type Composition,
} from "../src/index.js";

describe("Creative Variants Core Domain", () => {
  it("validates create variant inputs with section and film scopes", () => {
    const validFilm = validateCreateVariantInput({
      name: "方案 A",
      intent: "整體節奏緊湊",
      scope: { type: "film" },
    });
    expect(validFilm.name).toBe("方案 A");
    expect(validFilm.scope.type).toBe("film");

    const validSection = validateCreateVariantInput({
      name: "方案 B",
      intent: "特寫結尾細節",
      scope: { type: "section", targetBeatId: "beat-3", sectionTitle: "結尾" },
    });
    expect(validSection.scope.type).toBe("section");
    if (validSection.scope.type === "section") {
      expect(validSection.scope.targetBeatId).toBe("beat-3");
    }

    expect(() =>
      validateCreateVariantInput({
        name: "",
        intent: "some intent",
        scope: { type: "film" },
      }),
    ).toThrow();

    expect(() =>
      validateCreateVariantInput({
        name: "test",
        intent: "some intent",
        scope: { type: "section", targetBeatId: "" },
      }),
    ).toThrow();
  });

  it("validates full creative variant records and rejects invalid status or schema", () => {
    const valid: CreativeVariant = {
      schemaVersion: "1.0.0",
      id: "a0000000-0000-4000-8000-000000000001",
      projectId: "proj-1",
      name: "方案 B",
      intent: "調整節奏",
      scope: { type: "film" },
      baselineStoryId: "story-base",
      baselineCompositionId: "comp-base",
      derivedStoryId: "story-var",
      derivedCompositionId: "comp-var",
      provenanceMapping: {
        beatMappings: [{ baselineBeatId: "b1", variantBeatId: "b1-v" }],
        clipMappings: [
          { baselineClipId: "c1", variantClipId: "c1-v", trackId: "t1" },
        ],
      },
      preservedSections: [{ sectionId: "b1", type: "beat", unchanged: true }],
      modifications: { durationMultiplier: 0.9 },
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(validateCreativeVariant(valid)).toEqual(valid);

    expect(() =>
      validateCreativeVariant({ ...valid, status: "unknown" }),
    ).toThrow();

    expect(() =>
      validateCreativeVariant({ ...valid, id: "invalid-uuid" }),
    ).toThrow();
  });

  it("compares variants and detects exact beat and clip differences", () => {
    const baseStory: Story = {
      id: "story-1",
      title: "主線故事",
      beats: [
        {
          id: "b1",
          title: "開頭",
          targetDuration: 5,
          script: { narration: "你好", visualDirection: "" },
        },
        {
          id: "b2",
          title: "結尾",
          targetDuration: 5,
          script: { narration: "再見", visualDirection: "" },
        },
      ],
    };

    const derStory: Story = {
      id: "story-2",
      title: "主線故事 (方案 B)",
      beats: [
        {
          id: "b1-v",
          title: "開頭",
          targetDuration: 5,
          script: { narration: "你好", visualDirection: "" },
        },
        {
          id: "b2-v",
          title: "結尾 - 加長",
          targetDuration: 8,
          script: { narration: "再會了朋友們", visualDirection: "" },
        },
      ],
    };

    const baseComp: Composition = {
      id: "comp-1",
      storyId: "story-1",
      duration: 10,
      tracks: [
        {
          id: "t1",
          type: "video",
          clips: [
            {
              id: "c1",
              assetId: "ast-1",
              timelineStart: 0,
              timelineDuration: 5,
              sourceIn: 0,
              sourceOut: 5,
            },
            {
              id: "c2",
              assetId: "ast-2",
              timelineStart: 5,
              timelineDuration: 5,
              sourceIn: 0,
              sourceOut: 5,
            },
          ],
        },
      ],
    };

    const derComp: Composition = {
      id: "comp-2",
      storyId: "story-2",
      duration: 13,
      tracks: [
        {
          id: "t1",
          type: "video",
          clips: [
            {
              id: "c1-v",
              assetId: "ast-1",
              timelineStart: 0,
              timelineDuration: 5,
              sourceIn: 0,
              sourceOut: 5,
            },
            {
              id: "c2-v",
              assetId: "ast-2",
              timelineStart: 5,
              timelineDuration: 8,
              sourceIn: 0,
              sourceOut: 8,
            },
          ],
        },
      ],
    };

    const baseVariant: CreativeVariant = {
      schemaVersion: "1.0.0",
      id: "a0000000-0000-4000-8000-000000000001",
      projectId: "p1",
      name: "基線方案",
      intent: "原版",
      scope: { type: "film" },
      baselineStoryId: "story-1",
      baselineCompositionId: "comp-1",
      derivedStoryId: "story-1",
      derivedCompositionId: "comp-1",
      provenanceMapping: {
        beatMappings: [
          { baselineBeatId: "b1", variantBeatId: "b1" },
          { baselineBeatId: "b2", variantBeatId: "b2" },
        ],
        clipMappings: [
          { baselineClipId: "c1", variantClipId: "c1", trackId: "t1" },
          { baselineClipId: "c2", variantClipId: "c2", trackId: "t1" },
        ],
      },
      preservedSections: [],
      modifications: {},
      status: "adopted",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const targetVariant: CreativeVariant = {
      schemaVersion: "1.0.0",
      id: "a0000000-0000-4000-8000-000000000002",
      projectId: "p1",
      name: "方案 B",
      intent: "加長結尾",
      scope: { type: "section", targetBeatId: "b2" },
      baselineStoryId: "story-1",
      baselineCompositionId: "comp-1",
      derivedStoryId: "story-2",
      derivedCompositionId: "comp-2",
      provenanceMapping: {
        beatMappings: [
          { baselineBeatId: "b1", variantBeatId: "b1-v" },
          { baselineBeatId: "b2", variantBeatId: "b2-v" },
        ],
        clipMappings: [
          { baselineClipId: "c1", variantClipId: "c1-v", trackId: "t1" },
          { baselineClipId: "c2", variantClipId: "c2-v", trackId: "t1" },
        ],
      },
      preservedSections: [{ sectionId: "b1", type: "beat", unchanged: true }],
      modifications: { targetBeatId: "b2", targetDuration: 8 },
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const diff = compareCreativeVariants(
      baseVariant,
      targetVariant,
      baseStory,
      derStory,
      baseComp,
      derComp,
    );

    expect(diff.deltaSeconds).toBe(3);
    expect(diff.summary.beatsTotal).toBe(2);
    expect(diff.summary.beatsChanged).toBe(1);
    expect(diff.beatDiffs[0]?.changed).toBe(false); // Section 1 completely unchanged
    expect(diff.beatDiffs[1]?.changed).toBe(true); // Section 2 changed
    expect(diff.clipDiffs[0]?.changed).toBe(false); // Clip 1 unchanged
    expect(diff.clipDiffs[1]?.changed).toBe(true); // Clip 2 changed
  });
});
