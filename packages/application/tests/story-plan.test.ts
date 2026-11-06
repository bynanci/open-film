// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "../src/index.js";
import type { MediaAsset, Story } from "@openfilm/core";

describe("StoryPlanService Application Integration", () => {
  let projectDir: string;
  let app: OpenFilmApplication;
  const photoA: MediaAsset = {
    id: "photo-a",
    uri: "file:///test/photo_a.jpg",
    mediaType: "image",
    name: "Campfire Dawn",
    tags: ["travel"],
    state: {},
    metadata: {},
    capturedAt: "2026-06-01T06:00:00Z",
  };
  const photoB: MediaAsset = {
    id: "photo-b",
    uri: "file:///test/photo_b.jpg",
    mediaType: "image",
    name: "Summit Ridge",
    tags: ["travel"],
    state: {},
    metadata: {},
    capturedAt: "2026-06-01T12:00:00Z",
  };

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "openfilm-storyplan-test-"));
    app = await OpenFilmApplication.create(projectDir, "Story Plan Test Film");
    app.catalog.upsertAsset(photoA);
    app.catalog.upsertAsset(photoB);
  });

  afterEach(async () => {
    await app.close();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("previewPlan generates a proposal and composition preview without mutating original story or timelines", async () => {
    const originalStory: Story = {
      id: "orig-story",
      title: "Original Cut",
      targetDuration: 12,
      maxDuration: 15,
      beats: [
        {
          id: "beat-1",
          title: "Dawn",
          selectedAssetIds: ["photo-a"],
          targetDuration: 6,
        },
        {
          id: "beat-2",
          title: "Summit",
          selectedAssetIds: ["photo-b"],
          targetDuration: 6,
        },
      ],
    };
    app.project = {
      ...app.project,
      stories: [originalStory],
    };

    const initialStoryCount = app.project.stories.length;
    const initialTimelineCount = app.project.timelines.length;

    // Generate preview
    const { plan, compositionPreview } =
      app.storyPlan.previewPlan("orig-story");

    expect(plan.version).toBe(1);
    expect(plan.storyId).toBe("orig-story");
    expect(plan.scenes).toHaveLength(2);
    expect(compositionPreview.duration).toBeGreaterThan(0);

    // CRITICAL: Preview MUST NOT mutate original story or add timelines to project
    expect(app.project.stories.length).toBe(initialStoryCount);
    expect(app.project.timelines.length).toBe(initialTimelineCount);
    expect(app.project.stories[0]?.title).toBe("Original Cut");
  });

  it("applies authored coverage and media-balance constraints in the Story Plan preview", async () => {
    const originalStory: Story = {
      id: "story-plan-constraints",
      title: "Constraint Preview",
      targetDuration: 6,
      maxDuration: 6,
      beats: [
        {
          id: "beat-constraint",
          title: "Gathering",
          selectedAssetIds: ["photo-a"],
          candidateAssetIds: ["photo-a", "photo-b"],
          targetDuration: 6,
          constraints: [
            {
              type: "coverage-group",
              version: 1,
              kind: "event",
              groupId: "event:gathering",
              label: "Gathering",
              assetIds: ["photo-a"],
              minimumCount: 1,
            },
            {
              type: "media-balance",
              version: 1,
              minImages: 1,
              maxImages: 1,
            },
          ],
        },
      ],
    };
    app.project = { ...app.project, stories: [originalStory] };

    const { compositionPreview } = app.storyPlan.previewPlan(originalStory.id);

    expect(
      compositionPreview.tracks
        .flatMap((track) => track.clips)
        .map((clip) => clip.assetId),
    ).toContain("photo-a");

    app.project.stories[0]!.beats[0]!.constraints![1] = {
      type: "media-balance",
      version: 1,
      maxImages: 0,
    };
    expect(() => app.storyPlan.previewPlan(originalStory.id)).toThrow(
      /selected image clips above its media maximum/i,
    );
  });

  it("carries source-beat constraints into the accepted rough cut", async () => {
    const sourceConstraints = [
      {
        type: "coverage-group" as const,
        version: 1 as const,
        kind: "person" as const,
        groupId: "person:host",
        label: "Host",
        assetIds: ["photo-a"],
        minimumCount: 1,
      },
      {
        type: "media-balance" as const,
        version: 1 as const,
        minImages: 1,
        maxImages: 1,
      },
    ];
    const originalStory: Story = {
      id: "story-plan-accept-constraints",
      title: "Constraint Acceptance",
      targetDuration: 6,
      maxDuration: 6,
      beats: [
        {
          id: "beat-constraint",
          title: "Gathering",
          selectedAssetIds: ["photo-a"],
          candidateAssetIds: ["photo-a"],
          targetDuration: 6,
          constraints: sourceConstraints,
        },
      ],
    };
    app.project = { ...app.project, stories: [originalStory] };

    const { plan } = app.storyPlan.previewPlan(originalStory.id);
    const accepted = app.storyPlan.acceptPlan(originalStory.id, plan);

    expect(accepted.story.beats[0]!.constraints).toEqual(sourceConstraints);
  });

  it("acceptPlan creates a new rough cut (新試剪) while preserving the original manual edit untouched", async () => {
    const originalStory: Story = {
      id: "orig-story-manual",
      title: "My Manual Cut",
      targetDuration: 12,
      maxDuration: 15,
      beats: [
        {
          id: "beat-1",
          title: "Dawn",
          selectedAssetIds: ["photo-a"],
          targetDuration: 6,
        },
        {
          id: "beat-2",
          title: "Summit",
          selectedAssetIds: ["photo-b"],
          targetDuration: 6,
        },
      ],
    };
    app.project = {
      ...app.project,
      stories: [originalStory],
    };

    const { plan } = app.storyPlan.previewPlan("orig-story-manual");

    // Adopt the plan
    const {
      story: newRoughCut,
      composition,
      acceptanceMapping,
    } = app.storyPlan.acceptPlan("orig-story-manual", plan);

    // Verifications:
    // 1. Original manual story is still intact in project
    const foundOriginal = app.project.stories.find(
      (s) => s.id === "orig-story-manual",
    );
    expect(foundOriginal).toBeDefined();
    expect(foundOriginal?.title).toBe("My Manual Cut");

    // 2. New rough cut exists
    expect(newRoughCut.id).not.toBe("orig-story-manual");
    expect(newRoughCut.title).toContain("(Story Plan Cut)");
    expect(composition.storyId).toBe(newRoughCut.id);
    expect(app.project.timelines.some((t) => t.id === composition.id)).toBe(
      true,
    );

    // 3. Acceptance mapping links scenes to new beats and clips
    expect(acceptanceMapping.storyId).toBe(newRoughCut.id);
    expect(acceptanceMapping.compositionId).toBe(composition.id);
    expect(Object.keys(acceptanceMapping.sceneToBeatId)).toHaveLength(2);
    expect(Object.keys(acceptanceMapping.sceneToClipIds)).toHaveLength(2);
  });

  it("rejects stale plan when underlying story or graph changes after preview was generated", async () => {
    const story: Story = {
      id: "stale-story",
      title: "Stale Test",
      beats: [{ id: "b1", title: "Beat 1", selectedAssetIds: ["photo-a"] }],
    };
    app.project = {
      ...app.project,
      stories: [story],
    };

    const { plan } = app.storyPlan.previewPlan("stale-story");

    // Mutate the story in project after preview
    app.project = {
      ...app.project,
      stories: [
        {
          ...story,
          beats: [
            ...story.beats,
            {
              id: "b2",
              title: "Beat 2 (Added after preview)",
              selectedAssetIds: ["photo-b"],
            },
          ],
        },
      ],
    };

    // Attempting to accept stale plan must throw 409 planStale
    expect(() => app.storyPlan.acceptPlan("stale-story", plan)).toThrowError(
      /changed after this plan was generated/,
    );
  });

  it("idempotently handles lost-response retry without duplicating timelines", async () => {
    const story: Story = {
      id: "retry-story",
      title: "Retry Test",
      beats: [{ id: "b1", title: "Beat 1", selectedAssetIds: ["photo-a"] }],
    };
    app.project = {
      ...app.project,
      stories: [story],
    };

    const { plan } = app.storyPlan.previewPlan("retry-story");

    // First acceptance
    const firstResult = app.storyPlan.acceptPlan("retry-story", plan);
    const timelineCountAfterFirst = app.project.timelines.length;

    // Retry acceptance with same plan (simulating lost response or user retry)
    const retryResult = app.storyPlan.acceptPlan("retry-story", plan);

    expect(retryResult.composition.id).toBe(firstResult.composition.id);
    expect(retryResult.story.id).toBe(firstResult.story.id);
    // MUST NOT create duplicate timeline!
    expect(app.project.timelines.length).toBe(timelineCountAfterFirst);
  });

  it("rejects acceptance if plan contains cyclic dependencies or unresolved alternatives", async () => {
    const story: Story = {
      id: "conflict-story",
      title: "Conflict Test",
      beats: [{ id: "b1", title: "Beat 1", selectedAssetIds: ["photo-a"] }],
    };
    app.project = {
      ...app.project,
      stories: [story],
    };

    const { plan } = app.storyPlan.previewPlan("conflict-story");

    // Invalidate plan with a detected cycle
    const cyclePlan = {
      ...plan,
      path: {
        ...plan.path,
        cycleDetected: ["node-1", "node-2", "node-1"],
      },
    };

    expect(() =>
      app.storyPlan.acceptPlan("conflict-story", cyclePlan),
    ).toThrowError(/cyclic narrative dependencies/);

    // Invalidate plan with unresolved alternatives
    const altPlan = {
      ...plan,
      path: {
        ...plan.path,
        unresolvedAlternatives: [
          { fromNodeId: "node-1", candidates: ["node-2", "node-3"] },
        ],
      },
    };

    expect(() =>
      app.storyPlan.acceptPlan("conflict-story", altPlan),
    ).toThrowError(/unresolved alternative paths/);
  });
});
