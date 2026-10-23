import { describe, expect, it } from "vitest";
import { validateStoryPlan, type StoryPlan } from "../src/story-plan.js";

describe("StoryPlan Core Contract", () => {
  const validPlan: StoryPlan = {
    version: 1,
    id: "plan-1",
    storyId: "story-1",
    title: "Mountain Journey Plan",
    targetDuration: 30,
    maxDuration: 45,
    inputRevision: "rev-abc",
    sourceSignature: "sig-123",
    path: {
      nodeIds: ["theme-1", "beat-1", "beat-2"],
      isAmbiguous: false,
    },
    scenes: [
      {
        sceneId: "scene-1",
        beatId: "beat-1",
        title: "The Ascent",
        intent: "Establish mountain scale",
        visualDirection: "Wide panoramic tracking shot",
        rationale: "Selected because it anchors the narrative journey.",
        narration: "Our climb begins at dawn.",
        targetDuration: 15,
        estimatedDuration: 14.8,
        sourceNature: "user-memory",
        assets: [
          {
            assetId: "asset-1",
            name: "Hike.mp4",
            role: "hero",
            photoDepthSupported: true,
          },
        ],
      },
      {
        sceneId: "scene-2",
        beatId: "beat-2",
        title: "Summit Echo",
        intent: "Echo the beginning at sunset",
        visualDirection: "Slow zoom on golden light",
        rationale: "Echoes the ascent scene with warm reflective closing.",
        targetDuration: 15,
        estimatedDuration: 15,
        sourceNature: "planned",
        assets: [
          {
            assetId: "asset-1",
            name: "Hike.mp4",
            role: "echo",
            isEcho: true,
          },
        ],
      },
    ],
    unsupportedIntents: ["3D volumetric wormhole"],
    conflicts: [],
    transition: "crossfade",
    createdAt: "2026-10-22T00:00:00.000Z",
  };

  it("validates a compliant StoryPlan payload", () => {
    const validated = validateStoryPlan(validPlan);
    expect(validated.id).toBe("plan-1");
    expect(validated.scenes.length).toBe(2);
    expect(validated.scenes[0]!.sourceNature).toBe("user-memory");
    expect(validated.scenes[1]!.assets[0]!.isEcho).toBe(true);
    expect(validated.unsupportedIntents).toContain("3D volumetric wormhole");
  });

  it("rejects invalid versions or non-objects", () => {
    expect(() => validateStoryPlan(null)).toThrow(/must be an object/i);
    expect(() => validateStoryPlan({ ...validPlan, version: 2 })).toThrow(
      /version must be 1/i,
    );
  });

  it("rejects invalid duration boundaries", () => {
    expect(() =>
      validateStoryPlan({ ...validPlan, targetDuration: -5 }),
    ).toThrow(/targetDuration/i);
    expect(() =>
      validateStoryPlan({ ...validPlan, maxDuration: 10, targetDuration: 30 }),
    ).toThrow(/maxDuration must be >= targetDuration/i);
  });

  it("rejects empty scenes or invalid source natures", () => {
    expect(() => validateStoryPlan({ ...validPlan, scenes: [] })).toThrow(
      /at least one scene/i,
    );
    expect(() =>
      validateStoryPlan({
        ...validPlan,
        scenes: [
          {
            ...validPlan.scenes[0]!,
            sourceNature:
              "hallucinated" as unknown as (typeof validPlan.scenes)[0]["sourceNature"],
          },
        ],
      }),
    ).toThrow(/invalid scene sourceNature/i);
  });

  it("rejects invalid transition modes", () => {
    expect(() =>
      validateStoryPlan({
        ...validPlan,
        transition: "wipe" as unknown as (typeof validPlan)["transition"],
      }),
    ).toThrow(/transition must be/i);
  });
});
