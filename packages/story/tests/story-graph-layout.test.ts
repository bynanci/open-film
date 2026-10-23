// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { describe, expect, it } from "vitest";
import type {
  Story,
  StoryBeat,
  StoryGraph,
  StoryGraphNode,
  StoryGraphEdge,
} from "@openfilm/core";
import { createInitialStoryGraph } from "@openfilm/core";
import {
  computeStoryGraphAutoLayout,
  addAssetToBeatInGraph,
  createEchoEdge,
  setAsNextBeat,
  removeGraphNode,
  removeGraphEdge,
} from "../src/story-graph-layout.js";

function generateSyntheticGraph(totalNodes: number): {
  story: Story;
  graph: StoryGraph;
} {
  const beatCount = Math.floor(totalNodes / 4);
  const assetsPerBeat = 2;
  const beats: StoryBeat[] = [];
  const nodes: StoryGraphNode[] = [];
  const edges: StoryGraphEdge[] = [];

  const themeId = "theme-synth";
  nodes.push({ id: themeId, type: "theme", title: "Synthetic Theme" });

  for (let b = 0; b < beatCount; b++) {
    const beatId = `beat-${b}`;
    const beatNodeId = `beat-node-${b}`;
    const selectedAssetIds: string[] = [];

    for (let a = 0; a < assetsPerBeat; a++) {
      const assetId = `asset-${b}-${a}`;
      selectedAssetIds.push(assetId);
      const assetNodeId = `asset-node-${b}-${a}`;
      nodes.push({ id: assetNodeId, type: "asset", assetId });
      edges.push({
        id: `edge-supports-${beatNodeId}-${assetNodeId}`,
        from: beatNodeId,
        to: assetNodeId,
        type: "supports",
      });
    }

    beats.push({
      id: beatId,
      title: `Synthetic Beat ${b}`,
      targetDuration: 10,
      selectedAssetIds,
    });

    nodes.push({
      id: beatNodeId,
      type: "beat",
      storyId: "story-synth",
      beatId,
    });

    edges.push({
      id: `edge-contains-${themeId}-${beatNodeId}`,
      from: themeId,
      to: beatNodeId,
      type: "contains",
    });

    if (b > 0) {
      edges.push({
        id: `edge-precedes-beat-${b - 1}-beat-${b}`,
        from: `beat-node-${b - 1}`,
        to: beatNodeId,
        type: "precedes",
      });
    }
  }

  // Fill remaining with ideas
  let ideaIndex = 0;
  while (nodes.length < totalNodes) {
    const ideaId = `idea-${ideaIndex}`;
    const targetBeatNodeId = `beat-node-${ideaIndex % beatCount}`;
    nodes.push({
      id: ideaId,
      type: "idea",
      text: `Idea note ${ideaIndex}`,
      source: ideaIndex % 2 === 0 ? "user-memory" : "planned",
    });
    edges.push({
      id: `edge-echoes-${targetBeatNodeId}-${ideaId}`,
      from: targetBeatNodeId,
      to: ideaId,
      type: "echoes",
    });
    ideaIndex++;
  }

  const story: Story = {
    id: "story-synth",
    title: "Synthetic Story",
    beats,
  };

  const graph: StoryGraph = {
    version: 1,
    nodes,
    edges,
  };

  return { story, graph };
}

describe("Story Graph Layout and Operations", () => {
  it("computes deterministic auto-layout coordinates for graph nodes", () => {
    const story: Story = {
      id: "story-layout",
      title: "Layout Test",
      beats: [
        {
          id: "b1",
          title: "Beat 1",
          targetDuration: 10,
          selectedAssetIds: ["a1"],
        },
        {
          id: "b2",
          title: "Beat 2",
          targetDuration: 10,
          selectedAssetIds: ["a2"],
        },
      ],
    };
    const graph = createInitialStoryGraph(story, [
      {
        id: "a1",
        uri: "file:///1.jpg",
        mediaType: "image",
        name: "1.jpg",
        tags: [],
        state: {},
        metadata: {},
      },
      {
        id: "a2",
        uri: "file:///2.jpg",
        mediaType: "image",
        name: "2.jpg",
        tags: [],
        state: {},
        metadata: {},
      },
    ]);

    const layout = computeStoryGraphAutoLayout(graph, story);

    expect(layout["theme-story-layout"]).toBeDefined();
    expect(layout["theme-story-layout"]?.y).toBe(60);

    const b1Layout = layout["beat-node-b1"];
    const b2Layout = layout["beat-node-b2"];
    expect(b1Layout).toBeDefined();
    expect(b2Layout).toBeDefined();
    // Beat row is below theme row
    expect(b1Layout!.y).toBeGreaterThan(layout["theme-story-layout"]!.y);
    expect(b2Layout!.y).toBe(b1Layout!.y);
    // Beat 2 is to the right of Beat 1
    expect(b2Layout!.x).toBeGreaterThan(b1Layout!.x);

    // Assets are positioned beneath beats
    const a1Layout = layout["asset-node-a1"];
    expect(a1Layout).toBeDefined();
    expect(a1Layout!.y).toBeGreaterThan(b1Layout!.y);
  });

  it("adds an asset reference to beat without drag-connecting lines", () => {
    const story: Story = {
      id: "story-add",
      title: "Add Asset Test",
      beats: [
        { id: "b1", title: "Beat 1", targetDuration: 10, selectedAssetIds: [] },
      ],
    };
    const graph = createInitialStoryGraph(story);

    const result = addAssetToBeatInGraph(story, graph, "b1", "asset-new");
    expect(result.story.beats[0]?.selectedAssetIds).toContain("asset-new");
    expect(
      result.graph.nodes.some(
        (n) => n.type === "asset" && n.assetId === "asset-new",
      ),
    ).toBe(true);
    expect(
      result.graph.edges.some(
        (e) =>
          e.type === "supports" &&
          e.from === "beat-node-b1" &&
          e.to === "asset-node-asset-new",
      ),
    ).toBe(true);
  });

  it("creates an echo relationship between nodes", () => {
    const graph: StoryGraph = {
      version: 1,
      nodes: [
        { id: "b1", type: "beat", storyId: "s1", beatId: "b1" },
        { id: "b2", type: "beat", storyId: "s1", beatId: "b2" },
      ],
      edges: [],
    };

    const updated = createEchoEdge(graph, "b1", "b2");
    expect(updated.edges).toHaveLength(1);
    expect(updated.edges[0]?.type).toBe("echoes");
    expect(updated.edges[0]?.from).toBe("b1");
    expect(updated.edges[0]?.to).toBe("b2");
  });

  it("explicitly reorders beats via setAsNextBeat without using canvas x/y", () => {
    const story: Story = {
      id: "story-reorder",
      title: "Reorder Test",
      beats: [
        { id: "b1", title: "Beat 1", targetDuration: 10 },
        { id: "b2", title: "Beat 2", targetDuration: 10 },
        { id: "b3", title: "Beat 3", targetDuration: 10 },
      ],
    };
    const graph = createInitialStoryGraph(story);

    // Make b3 the next beat after b1: order becomes b1, b3, b2
    const result = setAsNextBeat(story, graph, "b1", "b3");
    expect(result.story.beats.map((b) => b.id)).toEqual(["b1", "b3", "b2"]);

    // Check updated precedes edges
    const precedes = result.graph.edges.filter((e) => e.type === "precedes");
    expect(precedes).toHaveLength(2);
    expect(precedes[0]?.from).toBe("beat-node-b1");
    expect(precedes[0]?.to).toBe("beat-node-b3");
    expect(precedes[1]?.from).toBe("beat-node-b3");
    expect(precedes[1]?.to).toBe("beat-node-b2");
  });

  it("removes graph node and edges without deleting original assets", () => {
    const story: Story = {
      id: "story-del",
      title: "Delete Node Test",
      beats: [
        {
          id: "b1",
          title: "Beat 1",
          targetDuration: 10,
          selectedAssetIds: ["a1"],
        },
      ],
    };
    const graph = createInitialStoryGraph(story, [
      {
        id: "a1",
        uri: "file:///a1.jpg",
        mediaType: "image",
        name: "a1.jpg",
        tags: [],
        state: {},
        metadata: {},
      },
    ]);

    const updatedGraph = removeGraphNode(graph, "asset-node-a1");
    expect(updatedGraph.nodes.some((n) => n.id === "asset-node-a1")).toBe(
      false,
    );
    expect(updatedGraph.edges.some((e) => e.to === "asset-node-a1")).toBe(
      false,
    );

    // Canonical story beat still retains its selection unless explicitly modified
    expect(story.beats[0]?.selectedAssetIds).toContain("a1");
  });

  it("removes graph edge without deleting nodes", () => {
    const graph: StoryGraph = {
      version: 1,
      nodes: [
        { id: "b1", type: "beat", storyId: "s1", beatId: "b1" },
        { id: "b2", type: "beat", storyId: "s1", beatId: "b2" },
      ],
      edges: [{ id: "edge-1", from: "b1", to: "b2", type: "echoes" }],
    };

    const updated = removeGraphEdge(graph, "edge-1");
    expect(updated.edges).toHaveLength(0);
    expect(updated.nodes).toHaveLength(2);
  });

  describe("Performance Benchmarks (100 & 500 nodes synthetic data)", () => {
    it("measures layout and update costs for 100-node synthetic graph", () => {
      const { story, graph } = generateSyntheticGraph(100);
      expect(graph.nodes.length).toBe(100);

      const start = performance.now();
      const layout = computeStoryGraphAutoLayout(graph, story);
      const duration = performance.now() - start;

      expect(Object.keys(layout).length).toBe(100);
      // Ensure layout executes well within reasonable bounded time (< 100ms)
      expect(duration).toBeLessThan(100);

      // Measure quick action update cost
      const updateStart = performance.now();
      const updated = setAsNextBeat(story, graph, "beat-0", "beat-5");
      const updateDuration = performance.now() - updateStart;

      expect(updated.story.beats[1]?.id).toBe("beat-5");
      expect(updateDuration).toBeLessThan(50);
    });

    it("measures layout and update costs for 500-node synthetic graph without claiming infinite capacity", () => {
      const { story, graph } = generateSyntheticGraph(500);
      expect(graph.nodes.length).toBe(500);

      const start = performance.now();
      const layout = computeStoryGraphAutoLayout(graph, story);
      const duration = performance.now() - start;

      expect(Object.keys(layout).length).toBe(500);
      // Ensure 500-node layout calculates within bounded real-time limits (< 250ms)
      expect(duration).toBeLessThan(250);

      // Measure auto-layout deterministic consistency
      const secondLayout = computeStoryGraphAutoLayout(graph, story);
      expect(secondLayout).toEqual(layout);
    });
  });
});
