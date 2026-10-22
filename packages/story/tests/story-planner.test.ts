// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { describe, expect, it } from "vitest";
import type { MediaAsset, Story, StoryGraph } from "@openfilm/core";
import {
  estimateNarrationDuration,
  generateStoryPlanFromGraph,
} from "../src/index.js";

const makeAsset = (
  id: string,
  patch: Partial<MediaAsset> = {},
): MediaAsset => ({
  id,
  name: `Asset ${id}`,
  uri: `file:///${id}.jpg`,
  mediaType: "image",
  tags: ["travel"],
  state: {},
  metadata: {},
  capturedAt: "2026-05-01T10:00:00Z",
  ...patch,
});

describe("story-planner", () => {
  it("calculates estimated narration duration without fake microsecond word timings", () => {
    // Empty text falls back to minimum 3.0s
    expect(estimateNarrationDuration("")).toBe(3.0);
    // CJK text (~3.5 chars/sec)
    const cjk = "這是一段測試旁白，用來估計朗讀的秒數。"; // 17 chars -> ~4.9s
    expect(estimateNarrationDuration(cjk)).toBeCloseTo(4.9, 1);
    // English text (~2.5 words/sec)
    const en =
      "The road stretched into the quiet sunset as we started our journey."; // 12 words -> ~4.8s
    expect(estimateNarrationDuration(en)).toBeCloseTo(4.8, 1);
  });

  it("generates a valid StoryPlan proposal with 5 storyboard dimensions (who, what, how, how long, why)", () => {
    const assets: MediaAsset[] = [
      makeAsset("p1", { name: "Morning Coffee" }),
      makeAsset("p2", { name: "Mountain Trail" }),
    ];
    const story: Story = {
      id: "s1",
      title: "Morning Hike",
      targetDuration: 10,
      maxDuration: 15,
      beats: [
        {
          id: "b1",
          title: "Starting Out",
          intent: "Set a peaceful mood",
          script: {
            narration: "We met at dawn with hot coffee.",
            visualDirection: "Slow zoom on steaming cup",
          },
          selectedAssetIds: ["p1"],
        },
        {
          id: "b2",
          title: "The Climb",
          intent: "Show physical exertion",
          script: {
            narration: "The trail climbed sharply toward the ridge.",
            visualDirection: "Wider framing following the path upwards",
          },
          selectedAssetIds: ["p2"],
        },
      ],
    };
    const graph: StoryGraph = {
      version: 1,
      nodes: [
        { id: "bn1", type: "beat", storyId: "s1", beatId: "b1" },
        { id: "bn2", type: "beat", storyId: "s1", beatId: "b2" },
        { id: "an1", type: "asset", assetId: "p1" },
        { id: "an2", type: "asset", assetId: "p2" },
      ],
      edges: [
        { id: "e1", from: "bn1", to: "bn2", type: "precedes" },
        { id: "e2", from: "bn1", to: "an1", type: "supports" },
        { id: "e3", from: "bn2", to: "an2", type: "supports" },
      ],
    };

    const plan = generateStoryPlanFromGraph(story, graph, assets);
    expect(plan.version).toBe(1);
    expect(plan.storyId).toBe("s1");
    expect(plan.path.isAmbiguous).toBe(false);
    expect(plan.path.nodeIds).toEqual(["bn1", "bn2"]);
    expect(plan.scenes).toHaveLength(2);

    const scene1 = plan.scenes[0]!;
    // 5 Storyboard attributes:
    // 1. Which image: assets
    expect(scene1.assets[0]?.assetId).toBe("p1");
    expect(scene1.assets[0]?.name).toBe("Morning Coffee");
    // 2. What is expressed: intent
    expect(scene1.intent).toBe("Set a peaceful mood");
    // 3. How to present: visualDirection
    expect(scene1.visualDirection).toBe("Slow zoom on steaming cup");
    // 4. How long: targetDuration & estimatedDuration
    expect(scene1.targetDuration).toBeGreaterThanOrEqual(3.0);
    expect(scene1.estimatedDuration).toBeGreaterThanOrEqual(3.0);
    // 5. Why: rationale
    expect(scene1.rationale).toBeDefined();

    // Narrative protection: photo depth fallback without fake depth mask
    expect(scene1.assets[0]?.photoDepthSupported).toBe(false);
    expect(scene1.assets[0]?.photoDepthFallback).toBe("standard-hold");
  });

  it("detects and flags unresolved alternative branches as ambiguous with actionable conflict messages", () => {
    const assets = [makeAsset("p1")];
    const story: Story = {
      id: "s1",
      title: "Alternative Path Test",
      beats: [{ id: "b1", title: "Beat 1" }],
    };
    const graph: StoryGraph = {
      version: 1,
      nodes: [
        { id: "idea-a", type: "idea", text: "Sunset Camp", source: "wish" },
        { id: "idea-b", type: "idea", text: "Night Trek", source: "planned" },
      ],
      edges: [
        { id: "alt-1", from: "idea-a", to: "idea-b", type: "alternative" },
      ],
    };

    const plan = generateStoryPlanFromGraph(story, graph, assets);
    expect(plan.path.isAmbiguous).toBe(true);
    expect(plan.path.unresolvedAlternatives).toHaveLength(1);
    expect(
      plan.conflicts.some((c) => c.includes("Unresolved alternative branch")),
    ).toBe(true);
  });

  it("detects and flags cyclic precedes relationships", () => {
    const assets = [makeAsset("p1")];
    const story: Story = {
      id: "s1",
      title: "Cycle Test",
      beats: [{ id: "b1", title: "Beat 1" }],
    };
    const graph: StoryGraph = {
      version: 1,
      nodes: [
        { id: "n1", type: "beat", storyId: "s1", beatId: "b1" },
        { id: "n2", type: "idea", text: "Middle", source: "user-memory" },
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2", type: "precedes" },
        { id: "e2", from: "n2", to: "n1", type: "precedes" },
      ],
    };

    const plan = generateStoryPlanFromGraph(story, graph, assets);
    expect(plan.path.cycleDetected).toBeDefined();
    expect(
      plan.conflicts.some((c) => c.includes("Cyclic narrative dependency")),
    ).toBe(true);
  });

  it("preserves source nature (user-memory, planned, wish, unknown) without conflating wish into fact", () => {
    const assets = [makeAsset("p1")];
    const story: Story = {
      id: "s1",
      title: "Memory vs Wish",
      beats: [],
    };
    const graph: StoryGraph = {
      version: 1,
      nodes: [
        {
          id: "mem1",
          type: "idea",
          text: "Chat log from 2024",
          source: "user-memory",
        },
        {
          id: "wish1",
          type: "idea",
          text: "Trip to Iceland next year",
          source: "wish",
        },
      ],
      edges: [{ id: "e1", from: "mem1", to: "wish1", type: "precedes" }],
    };

    const plan = generateStoryPlanFromGraph(story, graph, assets);
    expect(plan.scenes[0]?.sourceNature).toBe("user-memory");
    expect(plan.scenes[1]?.sourceNature).toBe("wish");
    expect(plan.scenes[1]?.rationale).toContain("wish");
  });

  it("identifies thematic echoes and marks distinct echo clip references without fabricating fake assets", () => {
    const photoEcho = makeAsset("photo-intro-outro", { name: "Campfire" });
    const photoMid = makeAsset("photo-mid", { name: "Trail" });
    const assets = [photoEcho, photoMid];

    const story: Story = {
      id: "s-echo",
      title: "Echo Story",
      beats: [
        {
          id: "b-intro",
          title: "Intro",
          selectedAssetIds: ["photo-intro-outro"],
        },
        { id: "b-mid", title: "Mid", selectedAssetIds: ["photo-mid"] },
        {
          id: "b-outro",
          title: "Outro",
          selectedAssetIds: ["photo-intro-outro"],
        },
      ],
    };
    const graph: StoryGraph = {
      version: 1,
      nodes: [
        { id: "bn-intro", type: "beat", storyId: "s-echo", beatId: "b-intro" },
        { id: "bn-mid", type: "beat", storyId: "s-echo", beatId: "b-mid" },
        { id: "bn-outro", type: "beat", storyId: "s-echo", beatId: "b-outro" },
      ],
      edges: [
        { id: "e1", from: "bn-intro", to: "bn-mid", type: "precedes" },
        { id: "e2", from: "bn-mid", to: "bn-outro", type: "precedes" },
        { id: "e-echo", from: "bn-intro", to: "bn-outro", type: "echoes" },
      ],
    };

    const plan = generateStoryPlanFromGraph(story, graph, assets);
    expect(plan.scenes).toHaveLength(3);
    const introAsset = plan.scenes[0]!.assets[0]!;
    const outroAsset = plan.scenes[2]!.assets[0]!;

    expect(introAsset.assetId).toBe("photo-intro-outro");
    expect(outroAsset.assetId).toBe("photo-intro-outro");
    // Marked as echo
    expect(introAsset.role).toBe("echo");
    expect(outroAsset.role).toBe("echo");
    expect(introAsset.isEcho).toBe(true);
    expect(outroAsset.isEcho).toBe(true);
  });

  it("detects and documents unsupported freeform text intents explicitly without silent alterations", () => {
    const assets = [makeAsset("p1")];
    const story: Story = {
      id: "s1",
      title: "Unsupported Intent Test",
      beats: [
        {
          id: "b1",
          title: "Beat 1",
          script: {
            narration: "",
            visualDirection: "Render a dramatic drone-shot and 3d-hologram",
          },
        },
      ],
    };
    const graph: StoryGraph = {
      version: 1,
      nodes: [{ id: "bn1", type: "beat", storyId: "s1", beatId: "b1" }],
      edges: [],
    };

    const plan = generateStoryPlanFromGraph(story, graph, assets);
    expect(plan.unsupportedIntents).toHaveLength(2);
    expect(plan.unsupportedIntents[0]).toContain("drone-shot");
    expect(plan.unsupportedIntents[1]).toContain("3d-hologram");
  });

  it("tracks missing assets as actionable gaps without crashing", () => {
    const assets: MediaAsset[] = []; // empty catalog
    const story: Story = {
      id: "s1",
      title: "Missing Asset Test",
      beats: [
        { id: "b1", title: "Beat 1", selectedAssetIds: ["missing-asset-123"] },
      ],
    };
    const graph: StoryGraph = {
      version: 1,
      nodes: [{ id: "bn1", type: "beat", storyId: "s1", beatId: "b1" }],
      edges: [],
    };

    const plan = generateStoryPlanFromGraph(story, graph, assets);
    expect(plan.scenes[0]?.gaps?.missingAssets).toContain("missing-asset-123");
  });
});
