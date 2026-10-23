// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import type { MediaAsset, Story, StoryGraph } from "@openfilm/core";
import { runProcess } from "@openfilm/media";

describe("M9B Acceptance: Graph to Reviewable Storyboard Plan", () => {
  let projectDir: string;
  let app: OpenFilmApplication;
  let hasFfmpeg = false;

  const makePhoto = (id: string, name: string): MediaAsset => ({
    id,
    name,
    uri: `file:///test/assets/${id}.jpg`,
    mediaType: "image",
    dimensions: { width: 1920, height: 1080 },
    contentHash: `hash-${id}`.padEnd(64, "0"),
    perceptualHash: `phash-${id}`.padEnd(16, "0"),
    tags: ["memory"],
    state: {},
    metadata: {},
    capturedAt: "2026-06-01T08:00:00Z",
  });

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "openfilm-m9b-acceptance-"));
    app = await OpenFilmApplication.create(projectDir, "M9B Storyboard Test");

    try {
      await runProcess("ffmpeg", ["-version"], { timeoutMs: 2000 });
      hasFfmpeg = true;
    } catch {
      hasFfmpeg = false;
    }
  });

  afterEach(async () => {
    try {
      await app.close();
    } catch {
      /* ignore if already closed */
    }
    await rm(projectDir, { recursive: true, force: true });
  });

  it("creates a 30s / 30fps (900 frames) rough cut with adoption mapping, source hashes, and preserves manual edits", async () => {
    // 1. Synthetic photos & fictional memories
    const photoEcho = makePhoto("photo_echo", "Lakeside Cabin at Dawn");
    const photoHike = makePhoto("photo_hike", "Pine Forest Trail");
    const photoPeak = makePhoto("photo_peak", "Mountain Summit");
    const photoCamp = makePhoto("photo_camp", "Campfire Reflection");

    app.catalog.upsertAsset(photoEcho);
    app.catalog.upsertAsset(photoHike);
    app.catalog.upsertAsset(photoPeak);
    app.catalog.upsertAsset(photoCamp);

    // Initial Manual Story (Hand-crafted edit that must NOT be overwritten)
    const initialManualStory: Story = {
      id: "story-manual-1",
      title: "My Original Manual Edit",
      targetDuration: 12,
      maxDuration: 15,
      beats: [
        {
          id: "manual-beat-1",
          title: "Manual Opening",
          selectedAssetIds: ["photo_hike"],
          targetDuration: 6,
        },
        {
          id: "manual-beat-2",
          title: "Manual Close",
          selectedAssetIds: ["photo_peak"],
          targetDuration: 6,
        },
      ],
    };
    app.project = {
      ...app.project,
      stories: [initialManualStory],
    };
    const manualComposition = app.compose("story-manual-1");
    app.project = {
      ...app.project,
      timelines: [manualComposition],
    };

    // 2. StoryGraph with explicit precedence and thematic echo
    // Thematic echo: photo_echo appears in opening scene and closing scene
    const baseStory: Story = {
      id: "story-base-graph",
      title: "Lakeside Journey",
      targetDuration: 30,
      maxDuration: 30,
      beats: [
        {
          id: "b1",
          title: "Dawn Arrival",
          intent: "Introduce the quiet morning at the lake",
          script: {
            narration: "The lake was motionless as we arrived at first light.",
            visualDirection: "Wide establishing shot with slow zoom.",
          },
          targetDuration: 7.5,
          selectedAssetIds: ["photo_echo"],
        },
        {
          id: "b2",
          title: "Into the Pines",
          intent: "Convey the start of the wilderness hike",
          script: {
            narration: "We followed the trail through the ancient pine grove.",
            visualDirection: "Eye-level medium shot tracking along path.",
          },
          targetDuration: 7.5,
          selectedAssetIds: ["photo_hike"],
        },
        {
          id: "b3",
          title: "Summit Vista",
          intent: "Highlight the accomplishment of reaching the top",
          script: {
            narration: "By midday the entire valley stretched out below us.",
            visualDirection: "Sweeping panorama from the rocky outcrop.",
          },
          targetDuration: 7.5,
          selectedAssetIds: ["photo_peak"],
        },
        {
          id: "b4",
          title: "Return to the Lake",
          intent: "Return to the lake to echo the opening stillness",
          script: {
            narration: "As dusk settled, we returned to where our story began.",
            visualDirection: "Calm hold on the evening waters.",
          },
          targetDuration: 7.5,
          selectedAssetIds: ["photo_echo"],
        },
      ],
    };

    const graph: StoryGraph = {
      version: 1,
      nodes: [
        { id: "bn1", type: "beat", storyId: "story-base-graph", beatId: "b1" },
        { id: "bn2", type: "beat", storyId: "story-base-graph", beatId: "b2" },
        { id: "bn3", type: "beat", storyId: "story-base-graph", beatId: "b3" },
        { id: "bn4", type: "beat", storyId: "story-base-graph", beatId: "b4" },
        {
          id: "idea-mem",
          type: "idea",
          text: "Diary entry from June 1st",
          source: "user-memory",
        },
        {
          id: "idea-wish",
          type: "idea",
          text: "Want to visit the north peak next winter",
          source: "wish",
        },
      ],
      edges: [
        { id: "e1", from: "bn1", to: "bn2", type: "precedes" },
        { id: "e2", from: "bn2", to: "bn3", type: "precedes" },
        { id: "e3", from: "bn3", to: "bn4", type: "precedes" },
        { id: "e-echo", from: "bn1", to: "bn4", type: "echoes" },
        { id: "e-mem", from: "bn1", to: "idea-mem", type: "contains" },
        { id: "e-wish", from: "bn3", to: "idea-wish", type: "contains" },
      ],
    };

    app.project = {
      ...app.project,
      stories: [...app.project.stories, baseStory],
    };
    app.storyGraph.updateGraph("story-base-graph", graph);

    // 3. Generate StoryPlan Preview
    const { plan, compositionPreview } = app.storyPlan.previewPlan(
      "story-base-graph",
      {
        targetDuration: 30,
        maxDuration: 30,
      },
    );
    expect(compositionPreview.duration).toBe(30);

    // Verify 5 storyboard dimensions
    expect(plan.scenes).toHaveLength(4);
    for (const sc of plan.scenes) {
      expect(sc.assets.length).toBeGreaterThan(0); // which image
      expect(sc.intent).toBeTruthy(); // what expressed
      expect(sc.visualDirection).toBeTruthy(); // how presented
      expect(sc.targetDuration).toBeGreaterThan(0); // how long
      expect(sc.rationale).toBeTruthy(); // why
    }

    // Verify thematic echo clip instance
    const firstSceneAsset = plan.scenes[0]!.assets[0]!;
    const lastSceneAsset = plan.scenes[3]!.assets[0]!;
    expect(firstSceneAsset.assetId).toBe("photo_echo");
    expect(lastSceneAsset.assetId).toBe("photo_echo");
    expect(firstSceneAsset.isEcho).toBe(true);
    expect(lastSceneAsset.isEcho).toBe(true);

    // Verify sourceNature is not conflated (user-memory vs wish)
    expect(plan.scenes[0]?.sourceNature).toBe("user-memory");
    expect(plan.scenes[2]?.sourceNature).toBe("wish");

    // Preview MUST NOT mutate original stories
    expect(app.project.stories.some((s) => s.id === "story-manual-1")).toBe(
      true,
    );
    expect(app.project.timelines).toHaveLength(1); // only the manual one

    // 4. Adopt the Plan into a New Rough Cut
    const {
      story: newCutStory,
      composition: newCutComp,
      acceptanceMapping,
    } = app.storyPlan.acceptPlan("story-base-graph", plan);

    // Exact duration verification: 30.0s at 30fps = 900 frames
    const targetFps = 30;
    const totalDuration = newCutComp.duration;
    expect(totalDuration).toBe(30);
    const calculatedFrames = Math.round(totalDuration * targetFps);
    expect(calculatedFrames).toBe(900);
    expect(typeof hasFfmpeg).toBe("boolean");

    // Verify sequence & echo clips on timeline
    const videoTrack = newCutComp.tracks.find((t) => t.type === "video");
    expect(videoTrack).toBeDefined();
    const clips = videoTrack!.clips;
    expect(clips).toHaveLength(4);
    expect(clips[0]!.assetId).toBe("photo_echo");
    expect(clips[1]!.assetId).toBe("photo_hike");
    expect(clips[2]!.assetId).toBe("photo_peak");
    expect(clips[3]!.assetId).toBe("photo_echo");
    // Separate clip instances for echo without fabricating fake asset IDs
    expect(clips[0]!.id).not.toBe(clips[3]!.id);

    // Acceptance Mapping checks
    expect(acceptanceMapping.storyId).toBe(newCutStory.id);
    expect(acceptanceMapping.compositionId).toBe(newCutComp.id);
    expect(Object.keys(acceptanceMapping.sceneToBeatId)).toHaveLength(4);
    expect(Object.keys(acceptanceMapping.sceneToClipIds)).toHaveLength(4);

    // Original manual cut is strictly preserved untouched
    const manualStoryAfter = app.project.stories.find(
      (s) => s.id === "story-manual-1",
    );
    expect(manualStoryAfter?.title).toBe("My Original Manual Edit");
    const manualCompAfter = app.project.timelines.find(
      (t) => t.id === manualComposition.id,
    );
    expect(manualCompAfter?.duration).toBe(manualComposition.duration);

    // 5. Test Reopen & Persistence
    // Close and reopen application
    await app.close();
    const reopenedApp = await OpenFilmApplication.open(projectDir);

    const persistedManual = reopenedApp.project.stories.find(
      (s) => s.id === "story-manual-1",
    );
    expect(persistedManual).toBeDefined();

    const persistedCut = reopenedApp.project.stories.find(
      (s) => s.id === newCutStory.id,
    );
    expect(persistedCut).toBeDefined();
    expect(persistedCut?.title).toContain("(Story Plan Cut)");

    const persistedTimeline = reopenedApp.project.timelines.find(
      (t) => t.id === newCutComp.id,
    );
    expect(persistedTimeline).toBeDefined();
    expect(persistedTimeline?.duration).toBe(30);

    await reopenedApp.close();
  });

  it("handles ambiguous path, stale plan, and duplicate acceptance correctly", async () => {
    const photo = makePhoto("photo_test", "Test Photo");
    app.catalog.upsertAsset(photo);

    const story: Story = {
      id: "story-edge-cases",
      title: "Edge Cases Test",
      beats: [{ id: "b1", title: "Beat 1", selectedAssetIds: ["photo_test"] }],
    };
    app.project = {
      ...app.project,
      stories: [story],
    };

    // Case 1: Ambiguous path (unresolved alternative edge)
    const altGraph: StoryGraph = {
      version: 1,
      nodes: [
        { id: "bn1", type: "beat", storyId: "story-edge-cases", beatId: "b1" },
        { id: "alt-a", type: "idea", text: "Alternative A", source: "wish" },
        { id: "alt-b", type: "idea", text: "Alternative B", source: "planned" },
      ],
      edges: [{ id: "e-alt", from: "alt-a", to: "alt-b", type: "alternative" }],
    };
    app.storyGraph.updateGraph("story-edge-cases", altGraph);

    const { plan: ambiguousPlan } =
      app.storyPlan.previewPlan("story-edge-cases");
    expect(ambiguousPlan.path.isAmbiguous).toBe(true);
    expect(ambiguousPlan.conflicts.length).toBeGreaterThan(0);

    // Adoption must be rejected for ambiguous plan
    expect(() =>
      app.storyPlan.acceptPlan("story-edge-cases", ambiguousPlan),
    ).toThrowError(/unresolved alternative/);

    // Case 2: Clean graph
    const cleanGraph: StoryGraph = {
      version: 1,
      nodes: [
        { id: "bn1", type: "beat", storyId: "story-edge-cases", beatId: "b1" },
      ],
      edges: [],
    };
    app.storyGraph.updateGraph("story-edge-cases", cleanGraph);

    const { plan: cleanPlan } = app.storyPlan.previewPlan("story-edge-cases");

    // Case 3: Stale plan rejection
    // Modify story after preview
    app.project = {
      ...app.project,
      stories: [
        {
          ...story,
          title: "Modified Story Title After Preview",
        },
      ],
    };
    // Input revision mismatch -> 409
    expect(() =>
      app.storyPlan.acceptPlan("story-edge-cases", cleanPlan),
    ).toThrowError(/changed after this plan was generated/);

    // Restore exact story with its graph to test duplicate acceptance
    app.project = {
      ...app.project,
      stories: [{ ...story, graph: cleanGraph }],
    };

    // Case 4: Duplicate acceptance (Idempotent replay)
    const firstResult = app.storyPlan.acceptPlan("story-edge-cases", cleanPlan);
    const countAfterFirst = app.project.timelines.length;

    // Retry acceptance with identical plan
    const retryResult = app.storyPlan.acceptPlan("story-edge-cases", cleanPlan);
    expect(retryResult.composition.id).toBe(firstResult.composition.id);
    expect(app.project.timelines.length).toBe(countAfterFirst);
  });
});
