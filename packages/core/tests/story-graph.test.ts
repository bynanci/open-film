// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { describe, expect, it } from "vitest";
import {
  createInitialStoryGraph,
  detectGraphCycle,
  validateEdgeAddition,
  validateGraphViewState,
  validateStoryGraph,
  type StoryGraph,
  type StoryGraphEdge,
  type StoryGraphNode,
} from "../src/story-graph.js";
import { validateProject, validateStory } from "../src/validation.js";
import type { MediaAsset, OpenFilmProject, Story } from "../src/models.js";

const sampleAssets: MediaAsset[] = [
  {
    id: "asset-1",
    uri: "file:///photos/sunset.jpg",
    mediaType: "image",
    name: "sunset.jpg",
    tags: ["golden-hour"],
    state: {},
    metadata: {},
  },
  {
    id: "asset-2",
    uri: "file:///videos/ceremony.mp4",
    mediaType: "video",
    name: "ceremony.mp4",
    duration: 12,
    tags: ["ceremony"],
    state: {},
    metadata: {},
  },
];

const sampleStory: Story = {
  id: "story-1",
  title: "Proposal Story",
  template: "proposal-film",
  targetDuration: 60,
  maxDuration: 90,
  beats: [
    {
      id: "beat-1",
      title: "Opening Scene",
      intent: "Set the mood",
      targetDuration: 15,
      selectedAssetIds: ["asset-1"],
    },
    {
      id: "beat-2",
      title: "The Moment",
      intent: "Emotional climax",
      targetDuration: 25,
      selectedAssetIds: ["asset-2"],
    },
  ],
};

describe("Story Graph Data Contract", () => {
  it("creates an initial StoryGraph from an existing Story without an empty canvas", () => {
    const graph = createInitialStoryGraph(sampleStory, sampleAssets);
    expect(graph.version).toBe(1);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(4); // Theme + 2 Beats + 2 Assets = 5

    // Theme node
    const theme = graph.nodes.find((n) => n.type === "theme");
    expect(theme).toBeDefined();
    expect(theme?.id).toBe("theme-story-1");

    // Beat nodes
    const beatNodes = graph.nodes.filter((n) => n.type === "beat");
    expect(beatNodes).toHaveLength(2);
    expect(beatNodes[0]?.beatId).toBe("beat-1");
    expect(beatNodes[1]?.beatId).toBe("beat-2");

    // Asset nodes
    const assetNodes = graph.nodes.filter((n) => n.type === "asset");
    expect(assetNodes).toHaveLength(2);

    // Precedes relationship between beat 1 and beat 2
    const precedesEdge = graph.edges.find((e) => e.type === "precedes");
    expect(precedesEdge).toBeDefined();
    expect(precedesEdge?.from).toBe("beat-node-beat-1");
    expect(precedesEdge?.to).toBe("beat-node-beat-2");

    // Theme contains beats
    const containsEdges = graph.edges.filter((e) => e.type === "contains");
    expect(containsEdges).toHaveLength(2);

    // Beat supports assets
    const supportsEdges = graph.edges.filter((e) => e.type === "supports");
    expect(supportsEdges).toHaveLength(2);
  });

  it("validates all 4 node types and idea sources", () => {
    const nodes: StoryGraphNode[] = [
      {
        id: "theme-1",
        type: "theme",
        title: "Love Story",
        description: "Romance",
      },
      { id: "beat-node-1", type: "beat", storyId: "story-1", beatId: "beat-1" },
      { id: "asset-node-1", type: "asset", assetId: "asset-1" },
      {
        id: "idea-1",
        type: "idea",
        text: "Add music swell here",
        intent: "climax",
        source: "user-memory",
        assetReferences: ["asset-1"],
      },
      {
        id: "idea-2",
        type: "idea",
        text: "Wish we had drone shot",
        source: "wish",
      },
      {
        id: "idea-3",
        type: "idea",
        text: "Planned VO",
        source: "planned",
      },
      {
        id: "idea-4",
        type: "idea",
        text: "Unknown source note",
        source: "unknown",
      },
    ];

    const edges: StoryGraphEdge[] = [
      { id: "e1", from: "theme-1", to: "beat-node-1", type: "contains" },
      { id: "e2", from: "beat-node-1", to: "asset-node-1", type: "supports" },
      { id: "e3", from: "beat-node-1", to: "idea-1", type: "echoes" },
      { id: "e4", from: "idea-1", to: "idea-2", type: "alternative" },
    ];

    const validated = validateStoryGraph(
      { version: 1, nodes, edges },
      new Set(["beat-1"]),
      new Set(["asset-1"]),
    );

    expect(validated.nodes).toHaveLength(7);
    expect(validated.edges).toHaveLength(4);
  });

  it("rejects invalid idea sources", () => {
    const invalid = {
      version: 1,
      nodes: [
        {
          id: "idea-x",
          type: "idea",
          text: "Bad source",
          source: "invalid-source",
        },
      ],
      edges: [],
    };

    expect(() => validateStoryGraph(invalid)).toThrowError(
      /Invalid idea source 'invalid-source'/,
    );
  });

  it("detects and rejects cycles in 'contains' relationships", () => {
    const nodes: StoryGraphNode[] = [
      { id: "t1", type: "theme", title: "Theme 1" },
      { id: "t2", type: "theme", title: "Theme 2" },
      { id: "t3", type: "theme", title: "Theme 3" },
    ];
    const edges: StoryGraphEdge[] = [
      { id: "e1", from: "t1", to: "t2", type: "contains" },
      { id: "e2", from: "t2", to: "t3", type: "contains" },
      { id: "e3", from: "t3", to: "t1", type: "contains" }, // cycle!
    ];

    expect(detectGraphCycle(nodes, edges, "contains")).toEqual([
      "t1",
      "t2",
      "t3",
      "t1",
    ]);

    expect(() => validateStoryGraph({ version: 1, nodes, edges })).toThrowError(
      /Cycle detected in 'contains' hierarchy/,
    );
  });

  it("detects and rejects cycles in 'precedes' relationships", () => {
    const nodes: StoryGraphNode[] = [
      { id: "b1", type: "beat", storyId: "story-1", beatId: "beat-1" },
      { id: "b2", type: "beat", storyId: "story-1", beatId: "beat-2" },
    ];
    const edges: StoryGraphEdge[] = [
      { id: "e1", from: "b1", to: "b2", type: "precedes" },
      { id: "e2", from: "b2", to: "b1", type: "precedes" }, // cycle!
    ];

    expect(detectGraphCycle(nodes, edges, "precedes")).toEqual([
      "b1",
      "b2",
      "b1",
    ]);

    expect(() =>
      validateStoryGraph(
        { version: 1, nodes, edges },
        new Set(["beat-1", "beat-2"]),
      ),
    ).toThrowError(/Cycle detected in 'precedes' order/);
  });

  it("allows non-cycle relationships and allows 'echoes' in both directions without cycle error", () => {
    const nodes: StoryGraphNode[] = [
      { id: "b1", type: "beat", storyId: "story-1", beatId: "beat-1" },
      { id: "b2", type: "beat", storyId: "story-1", beatId: "beat-2" },
    ];
    // Echoes is thematic recurrence and NOT an execution dependency
    const edges: StoryGraphEdge[] = [
      { id: "e1", from: "b1", to: "b2", type: "echoes" },
      { id: "e2", from: "b2", to: "b1", type: "echoes" },
    ];

    const result = validateStoryGraph(
      { version: 1, nodes, edges },
      new Set(["beat-1", "beat-2"]),
    );
    expect(result.edges).toHaveLength(2);
  });

  it("validates edge addition incrementally with validateEdgeAddition", () => {
    const graph: StoryGraph = {
      version: 1,
      nodes: [
        { id: "b1", type: "beat", storyId: "story-1", beatId: "beat-1" },
        { id: "b2", type: "beat", storyId: "story-1", beatId: "beat-2" },
      ],
      edges: [{ id: "e1", from: "b1", to: "b2", type: "precedes" }],
    };

    // Legal edge: echoes
    const legal = validateEdgeAddition(graph, {
      id: "e2",
      from: "b2",
      to: "b1",
      type: "echoes",
    });
    expect(legal.valid).toBe(true);

    // Illegal cycle: b2 precedes b1
    const illegal = validateEdgeAddition(graph, {
      id: "e3",
      from: "b2",
      to: "b1",
      type: "precedes",
    });
    expect(illegal.valid).toBe(false);
    expect(illegal.error).toMatch(/Cycle detected in 'precedes'/);

    // Self referencing
    const selfRef = validateEdgeAddition(graph, {
      id: "e4",
      from: "b1",
      to: "b1",
      type: "supports",
    });
    expect(selfRef.valid).toBe(false);
    expect(selfRef.error).toMatch(/Self-referencing/);
  });

  it("validates GraphViewState coordinates, zoom, and collapse state", () => {
    const viewState = validateGraphViewState({
      version: 1,
      storyId: "story-1",
      pan: { x: 120, y: -45 },
      zoom: 1.25,
      nodes: {
        "beat-node-1": { x: 200, y: 150, collapsed: false },
        "asset-node-1": { x: 200, y: 320, collapsed: true },
      },
      selectedNodeId: "beat-node-1",
    });

    expect(viewState.zoom).toBe(1.25);
    expect(viewState.pan).toEqual({ x: 120, y: -45 });
    expect(viewState.nodes["asset-node-1"]?.collapsed).toBe(true);
    expect(viewState.selectedNodeId).toBe("beat-node-1");
  });

  it("integrates with validateStory and validateProject seamlessly", () => {
    const storyWithGraph: Story = {
      ...sampleStory,
      graph: createInitialStoryGraph(sampleStory, sampleAssets),
    };

    const validatedStory = validateStory(storyWithGraph, {
      assetIds: sampleAssets.map((a) => a.id),
    });
    expect(validatedStory.graph).toBeDefined();
    expect(validatedStory.graph?.nodes.length).toBeGreaterThan(0);

    const project: OpenFilmProject = {
      schemaVersion: "1.0.0",
      id: "proj-1",
      title: "Test Film",
      createdAt: "2026-10-22T00:00:00.000Z",
      updatedAt: "2026-10-22T00:00:00.000Z",
      mediaLibraries: [{ id: "lib-1", uri: "file:///media", name: "Media" }],
      stories: [storyWithGraph],
      timelines: [
        {
          id: "comp-1",
          storyId: "story-1",
          duration: 40,
          tracks: [
            {
              id: "track-1",
              type: "video",
              clips: [
                {
                  id: "clip-1",
                  assetId: "asset-1",
                  beatId: "beat-1",
                  timelineStart: 0,
                  timelineDuration: 15,
                },
              ],
            },
          ],
        },
      ],
      settings: { width: 1920, height: 1080, frameRate: 30 },
    };

    const validatedProj = validateProject(project, {
      assetIds: sampleAssets.map((a) => a.id),
    });
    expect(validatedProj.stories[0]?.graph).toBeDefined();
  });

  it("preserves backwards compatibility when project lacks graph field", () => {
    const projectWithoutGraph: OpenFilmProject = {
      schemaVersion: "1.0.0",
      id: "proj-old",
      title: "Old Project",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
      mediaLibraries: [{ id: "lib-1", uri: "file:///media", name: "Media" }],
      stories: [sampleStory], // no graph field
      timelines: [
        {
          id: "comp-1",
          storyId: "story-1",
          duration: 40,
          tracks: [],
        },
      ],
      settings: { width: 1920, height: 1080, frameRate: 30 },
    };

    const validated = validateProject(projectWithoutGraph);
    expect(validated.stories[0]?.graph).toBeUndefined();
  });
});
