// Modified by OpenFilm contributors on 2026-10-24. See LICENSE and NOTICE.

import { describe, expect, it } from "vitest";
import type { StoryGraph, StoryGraphNode } from "@openfilm/core";
import {
  connectStoryGraphNodes,
  inferStoryGraphEdgeType,
} from "../src/story-graph-connections.js";

const theme: StoryGraphNode = {
  id: "theme-1",
  type: "theme",
  title: "A remembered summer",
};
const beatA: StoryGraphNode = {
  id: "beat-a",
  type: "beat",
  storyId: "story-1",
  beatId: "a",
};
const beatB: StoryGraphNode = {
  id: "beat-b",
  type: "beat",
  storyId: "story-1",
  beatId: "b",
};
const asset: StoryGraphNode = {
  id: "asset-1",
  type: "asset",
  assetId: "photo-1",
};
const idea: StoryGraphNode = {
  id: "idea-1",
  type: "idea",
  text: "Return to the opening image",
  source: "planned",
};

const graph = (edges: StoryGraph["edges"] = []): StoryGraph => ({
  version: 1,
  nodes: [theme, beatA, beatB, asset, idea],
  edges,
});

describe("story graph drag connections", () => {
  it("infers a relationship that preserves the meaning of common node pairs", () => {
    expect(inferStoryGraphEdgeType(theme, beatA)).toBe("contains");
    expect(inferStoryGraphEdgeType(beatA, asset)).toBe("supports");
    expect(inferStoryGraphEdgeType(beatA, beatB)).toBe("precedes");
    expect(inferStoryGraphEdgeType(idea, beatA)).toBe("echoes");
  });

  it("adds one deterministic typed edge without mutating the source graph", () => {
    const source = graph();
    const connected = connectStoryGraphNodes(
      source,
      "theme-1",
      "idea-1",
      "contains",
    );

    expect(source.edges).toHaveLength(0);
    expect(connected.edges).toEqual([
      {
        id: "edge-contains-theme-1-idea-1",
        from: "theme-1",
        to: "idea-1",
        type: "contains",
      },
    ]);
  });

  it("rejects duplicate and self connections without returning a changed graph", () => {
    const connected = graph([
      {
        id: "existing",
        from: "beat-a",
        to: "asset-1",
        type: "supports",
      },
    ]);

    expect(() =>
      connectStoryGraphNodes(connected, "beat-a", "asset-1", "supports"),
    ).toThrow(/already exists/i);
    expect(() =>
      connectStoryGraphNodes(connected, "beat-a", "beat-a", "precedes"),
    ).toThrow(/self-referencing/i);
    expect(connected.edges).toHaveLength(1);
  });

  it("rejects a cyclic beat dependency and a dependency between non-beat nodes", () => {
    const ordered = graph([
      {
        id: "a-before-b",
        from: "beat-a",
        to: "beat-b",
        type: "precedes",
      },
    ]);

    expect(() =>
      connectStoryGraphNodes(ordered, "beat-b", "beat-a", "precedes"),
    ).toThrow(/cycle detected/i);
    expect(() =>
      connectStoryGraphNodes(ordered, "idea-1", "asset-1", "precedes"),
    ).toThrow(/beat nodes/i);
  });
});
