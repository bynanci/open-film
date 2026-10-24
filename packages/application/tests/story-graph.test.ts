// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenFilmApplication } from "../src/index.js";
import type { MediaAsset, Story } from "@openfilm/core";

describe("StoryGraphService Application Integration", () => {
  let projectDir: string;
  let app: OpenFilmApplication;
  const asset1: MediaAsset = {
    id: "asset-sunset",
    uri: "file:///test/sunset.jpg",
    mediaType: "image",
    name: "sunset.jpg",
    tags: ["sunset"],
    state: {},
    metadata: {},
  };
  const asset2: MediaAsset = {
    id: "asset-ceremony",
    uri: "file:///test/ceremony.mp4",
    mediaType: "video",
    name: "ceremony.mp4",
    duration: 15,
    tags: ["ceremony"],
    state: {},
    metadata: {},
  };

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "openfilm-storygraph-test-"));
    app = await OpenFilmApplication.create(projectDir, "Story Graph Test Film");
    app.catalog.upsertAsset(asset1);
    app.catalog.upsertAsset(asset2);
  });

  afterEach(async () => {
    await app.close();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("generates an initial StoryGraph for an existing Story without showing an empty canvas", async () => {
    const story: Story = {
      id: "story-summer",
      title: "Summer Film",
      targetDuration: 60,
      maxDuration: 90,
      beats: [
        {
          id: "beat-1",
          title: "Opening",
          targetDuration: 15,
          selectedAssetIds: ["asset-sunset"],
        },
        {
          id: "beat-2",
          title: "Climax",
          targetDuration: 25,
          selectedAssetIds: ["asset-ceremony"],
        },
      ],
    };
    app.project.stories.push(story);
    await app.save();

    // Call getGraph
    const graph = app.storyGraph.getGraph(story.id);
    expect(graph.version).toBe(1);
    // 1 Theme + 2 Beats + 2 Assets = 5 nodes
    expect(graph.nodes.length).toBe(5);
    expect(graph.nodes.some((n) => n.type === "theme")).toBe(true);
    expect(
      graph.nodes.some((n) => n.type === "beat" && n.beatId === "beat-1"),
    ).toBe(true);
    expect(
      graph.nodes.some((n) => n.type === "beat" && n.beatId === "beat-2"),
    ).toBe(true);
    expect(
      graph.nodes.some(
        (n) => n.type === "asset" && n.assetId === "asset-sunset",
      ),
    ).toBe(true);
    expect(
      graph.nodes.some(
        (n) => n.type === "asset" && n.assetId === "asset-ceremony",
      ),
    ).toBe(true);
  });

  it("separates GraphViewState coordinates from video content revision (0 render/provider calls)", async () => {
    const story: Story = {
      id: "story-sep",
      title: "Separation Test",
      beats: [
        {
          id: "beat-1",
          title: "Beat 1",
          targetDuration: 10,
          selectedAssetIds: ["asset-sunset"],
        },
      ],
    };
    app.project.stories.push(story);
    await app.save();

    const originalUpdatedAt = app.project.updatedAt;

    // Spy on renderFilm to verify 0 calls
    const renderSpy = vi.spyOn(app, "renderFilm");

    // Fetch initial view state
    const viewState = app.storyGraph.getViewState(story.id);
    expect(viewState.zoom).toBe(1);

    // Move a node on canvas and update viewState
    const updatedState = app.storyGraph.updateViewState(story.id, {
      ...viewState,
      pan: { x: 150, y: -80 },
      zoom: 1.5,
      nodes: {
        ...viewState.nodes,
        "test-node": { x: 500, y: 300, collapsed: true },
      },
    });

    expect(updatedState.zoom).toBe(1.5);
    expect(updatedState.pan).toEqual({ x: 150, y: -80 });
    expect(updatedState.nodes["test-node"]?.collapsed).toBe(true);

    // Verify project.updatedAt did NOT change
    expect(app.project.updatedAt).toBe(originalUpdatedAt);

    // Verify render calls is strictly 0
    expect(renderSpy).not.toHaveBeenCalled();

    // Re-read viewState to prove persistence across calls
    const reloadedState = app.storyGraph.getViewState(story.id);
    expect(reloadedState.zoom).toBe(1.5);
    expect(reloadedState.pan).toEqual({ x: 150, y: -80 });
  });

  it("performs explicit reorder of beats without relying on canvas x/y", async () => {
    const story: Story = {
      id: "story-reorder",
      title: "Reorder Test",
      beats: [
        { id: "b0", title: "Beat 0", targetDuration: 10 },
        { id: "b1", title: "Beat 1", targetDuration: 10 },
        { id: "b2", title: "Beat 2", targetDuration: 10 },
      ],
    };
    app.project.stories.push(story);
    await app.save();

    // Explicitly reorder so b2 is next after b0 (b0, b2, b1)
    const result = await app.storyGraph.setNextBeat(story.id, "b0", "b2");
    expect(result.story.beats.map((b) => b.id)).toEqual(["b0", "b2", "b1"]);

    // StoryGraph precedes edges reflect the new sequential order
    const precedes = result.graph.edges.filter((e) => e.type === "precedes");
    expect(
      precedes.some(
        (e) => e.from === "beat-node-b0" && e.to === "beat-node-b2",
      ),
    ).toBe(true);
    expect(
      precedes.some(
        (e) => e.from === "beat-node-b2" && e.to === "beat-node-b1",
      ),
    ).toBe(true);
  });

  it("adds asset and creates echoes via quick actions without line dragging", async () => {
    const story: Story = {
      id: "story-quick",
      title: "Quick Action Story",
      beats: [
        { id: "b1", title: "Beat 1", targetDuration: 10, selectedAssetIds: [] },
      ],
    };
    app.project.stories.push(story);
    await app.save();

    const { story: updatedStory, graph: updatedGraph } =
      await app.storyGraph.addAssetToBeat(story.id, "b1", "asset-sunset");

    expect(updatedStory.beats[0]?.selectedAssetIds).toContain("asset-sunset");
    expect(
      updatedGraph.nodes.some(
        (n) => n.type === "asset" && n.assetId === "asset-sunset",
      ),
    ).toBe(true);

    // Create echo between beat 1 and asset
    const beatNode = updatedGraph.nodes.find((n) => n.type === "beat");
    const assetNode = updatedGraph.nodes.find((n) => n.type === "asset");
    expect(beatNode).toBeDefined();
    expect(assetNode).toBeDefined();

    const echoGraph = await app.storyGraph.createEcho(
      story.id,
      beatNode!.id,
      assetNode!.id,
    );
    expect(
      echoGraph.edges.some(
        (e) =>
          e.type === "echoes" &&
          e.from === beatNode!.id &&
          e.to === assetNode!.id,
      ),
    ).toBe(true);
  });

  it("connects dragged nodes through canonical story operations", async () => {
    const story: Story = {
      id: "story-connect",
      title: "Connection Test",
      beats: [
        { id: "b0", title: "Opening", targetDuration: 10 },
        { id: "b1", title: "Middle", targetDuration: 10 },
        { id: "b2", title: "Ending", targetDuration: 10 },
      ],
      graph: {
        version: 1,
        nodes: [
          {
            id: "beat-node-b0",
            type: "beat",
            storyId: "story-connect",
            beatId: "b0",
          },
          {
            id: "beat-node-b1",
            type: "beat",
            storyId: "story-connect",
            beatId: "b1",
          },
          {
            id: "beat-node-b2",
            type: "beat",
            storyId: "story-connect",
            beatId: "b2",
          },
          {
            id: "asset-node-asset-sunset",
            type: "asset",
            assetId: "asset-sunset",
          },
          {
            id: "remembered-sunset",
            type: "asset",
            assetId: "asset-sunset",
          },
          {
            id: "alternate-opening",
            type: "beat",
            storyId: "story-connect",
            beatId: "b0",
          },
          {
            id: "alternate-ending",
            type: "beat",
            storyId: "story-connect",
            beatId: "b2",
          },
        ],
        edges: [],
      },
    };
    app.project.stories.push(story);
    await app.save();

    const assetResult = await app.storyGraph.connectNodes(
      story.id,
      "beat-node-b0",
      "asset-node-asset-sunset",
      "supports",
    );
    expect(assetResult.story.beats[0]?.selectedAssetIds).toEqual([
      "asset-sunset",
    ]);
    expect(
      assetResult.graph.edges.filter(
        (edge) =>
          edge.from === "beat-node-b0" &&
          edge.to === "asset-node-asset-sunset" &&
          edge.type === "supports",
      ),
    ).toHaveLength(1);

    const aliasResult = await app.storyGraph.connectNodes(
      story.id,
      "beat-node-b1",
      "remembered-sunset",
      "supports",
    );
    expect(aliasResult.story.beats[1]?.selectedAssetIds).toEqual([
      "asset-sunset",
    ]);
    expect(
      aliasResult.graph.edges.some(
        (edge) =>
          edge.from === "beat-node-b1" &&
          edge.to === "remembered-sunset" &&
          edge.type === "supports",
      ),
    ).toBe(true);
    expect(
      aliasResult.graph.edges.some(
        (edge) =>
          edge.from === "beat-node-b1" &&
          edge.to === "asset-node-asset-sunset" &&
          edge.type === "supports",
      ),
    ).toBe(false);

    const orderResult = await app.storyGraph.connectNodes(
      story.id,
      "beat-node-b0",
      "beat-node-b2",
      "precedes",
    );
    expect(orderResult.story.beats.map((beat) => beat.id)).toEqual([
      "b0",
      "b2",
      "b1",
    ]);
    expect(
      orderResult.graph.edges.some(
        (edge) =>
          edge.from === "beat-node-b0" &&
          edge.to === "beat-node-b2" &&
          edge.type === "precedes",
      ),
    ).toBe(true);
    expect(
      orderResult.graph.edges.some(
        (edge) =>
          edge.from === "alternate-opening" &&
          edge.to === "alternate-ending" &&
          edge.type === "precedes",
      ),
    ).toBe(false);
  });

  it("restores the in-memory story when a connection save fails", async () => {
    const story: Story = {
      id: "story-save-rollback",
      title: "Connection rollback",
      beats: [{ id: "beat-1", title: "Opening", targetDuration: 10 }],
      graph: {
        version: 1,
        nodes: [
          {
            id: "beat-node-1",
            type: "beat",
            storyId: "story-save-rollback",
            beatId: "beat-1",
          },
          {
            id: "asset-node-1",
            type: "asset",
            assetId: "asset-sunset",
          },
        ],
        edges: [],
      },
    };
    app.project.stories.push(story);
    await app.save();
    const before = structuredClone(
      app.project.stories.find((item) => item.id === story.id),
    );
    const save = vi
      .spyOn(app, "save")
      .mockRejectedValueOnce(new Error("synthetic save failure"));

    await expect(
      app.storyGraph.connectNodes(
        story.id,
        "beat-node-1",
        "asset-node-1",
        "supports",
      ),
    ).rejects.toThrow("synthetic save failure");
    expect(app.project.stories.find((item) => item.id === story.id)).toEqual(
      before,
    );
    save.mockRestore();
  });

  it("removes graph node and edges without deleting original assets from catalog", async () => {
    const story: Story = {
      id: "story-del",
      title: "Delete Node Test",
      beats: [
        {
          id: "b1",
          title: "Beat 1",
          targetDuration: 10,
          selectedAssetIds: ["asset-sunset"],
        },
      ],
    };
    app.project.stories.push(story);
    await app.save();

    const graph = app.storyGraph.getGraph(story.id);
    const assetNode = graph.nodes.find(
      (n) => n.type === "asset" && n.assetId === "asset-sunset",
    );
    expect(assetNode).toBeDefined();

    // Remove node from graph
    const modifiedGraph = await app.storyGraph.removeNode(
      story.id,
      assetNode!.id,
    );
    expect(modifiedGraph.nodes.some((n) => n.id === assetNode!.id)).toBe(false);

    // Verify original asset still exists in catalog!
    const catalogAsset = app.catalog.getAsset("asset-sunset");
    expect(catalogAsset).toBeDefined();
    expect(catalogAsset?.id).toBe("asset-sunset");
  });
});
