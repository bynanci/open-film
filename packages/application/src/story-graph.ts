// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ApplicationError,
  createInitialStoryGraph,
  validateGraphViewState,
  validateStoryGraph,
  type GraphViewState,
  type Story,
  type StoryGraph,
} from "@openfilm/core";
import {
  addAssetToBeatInGraph,
  connectStoryGraphNodes,
  computeStoryGraphAutoLayout,
  createEchoEdge,
  removeGraphEdge,
  removeGraphNode,
  setAsNextBeat,
} from "@openfilm/story";
import type { OpenFilmApplication } from "./index.js";

export class StoryGraphService {
  private readonly viewStateCache = new Map<string, GraphViewState>();
  private readonly cacheFilePath: string;

  constructor(
    private readonly app: OpenFilmApplication,
    private readonly directory: string,
  ) {
    this.cacheFilePath = join(
      this.directory,
      "cache",
      "story-graph-views.json",
    );
    this.loadCachedViewStates();
  }

  private loadCachedViewStates(): void {
    try {
      if (existsSync(this.cacheFilePath)) {
        const raw = JSON.parse(readFileSync(this.cacheFilePath, "utf8"));
        if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
          for (const [storyId, val] of Object.entries(
            raw as Record<string, unknown>,
          )) {
            try {
              this.viewStateCache.set(storyId, validateGraphViewState(val));
            } catch {
              /* ignore corrupted cache entry */
            }
          }
        }
      }
    } catch {
      /* non-fatal if cache reading fails */
    }
  }

  private persistCachedViewStates(): void {
    try {
      const cacheDir = join(this.directory, "cache");
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true });
      }
      const serializable: Record<string, GraphViewState> = {};
      for (const [storyId, state] of this.viewStateCache.entries()) {
        serializable[storyId] = state;
      }
      writeFileSync(
        this.cacheFilePath,
        JSON.stringify(serializable, null, 2),
        "utf8",
      );
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Retrieves the StoryGraph for the specified story.
   * If the story doesn't have a graph yet or has an empty node list,
   * creates and stores the initial StoryGraph from existing beats and assets
   * so an existing project never opens to an empty canvas.
   */
  getGraph(storyId: string): StoryGraph {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
      );
    }

    if (story.graph && story.graph.nodes.length > 0) {
      return story.graph;
    }

    const assets = this.app.catalog.listAssets();
    const initialGraph = createInitialStoryGraph(story, assets);
    story.graph = initialGraph;
    return initialGraph;
  }

  /**
   * Updates the semantic StoryGraph.
   * Validates structure, node existence, and cycle freedom.
   */
  async updateGraph(storyId: string, graphInput: unknown): Promise<StoryGraph> {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
      );
    }

    const beatIds = new Set(story.beats.map((b) => b.id));
    const assetIds = new Set(this.app.catalog.listAssets().map((a) => a.id));

    const validated = validateStoryGraph(graphInput, beatIds, assetIds);
    story.graph = validated;
    await this.app.save();
    return validated;
  }

  /**
   * Gets the GraphViewState (pan, zoom, node coordinates, collapsed states).
   * Separated from video content revision.
   */
  getViewState(storyId: string): GraphViewState {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
      );
    }

    const cached = this.viewStateCache.get(storyId);
    if (cached) {
      return cached;
    }

    const graph = this.getGraph(storyId);
    const layout = computeStoryGraphAutoLayout(graph, story);

    const initialState: GraphViewState = {
      version: 1,
      storyId,
      pan: { x: 0, y: 0 },
      zoom: 1,
      nodes: layout,
      selectedNodeId: null,
      selectedEdgeId: null,
    };

    this.viewStateCache.set(storyId, initialState);
    this.persistCachedViewStates();
    return initialState;
  }

  /**
   * Updates GraphViewState coordinates, zoom, and collapse state.
   * CRITICAL: Does NOT touch project.updatedAt, project.json, or video revision.
   * Render and provider calls must be 0.
   */
  updateViewState(storyId: string, viewStateInput: unknown): GraphViewState {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
      );
    }

    const validated = validateGraphViewState(viewStateInput);
    if (validated.storyId !== storyId) {
      throw new ApplicationError(
        "request.invalid",
        "storyId mismatch in viewState.",
      );
    }

    this.viewStateCache.set(storyId, validated);
    this.persistCachedViewStates();
    return validated;
  }

  /**
   * Quick Action: Add asset reference to a beat.
   */
  async addAssetToBeat(
    storyId: string,
    beatId: string,
    assetId: string,
  ): Promise<{ story: Story; graph: StoryGraph }> {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
      );
    }

    const graph = this.getGraph(storyId);
    const result = addAssetToBeatInGraph(story, graph, beatId, assetId);

    const storyIndex = this.app.project.stories.findIndex(
      (s) => s.id === storyId,
    );
    this.app.project.stories[storyIndex] = {
      ...result.story,
      graph: result.graph,
    };

    await this.app.save();
    return {
      story: this.app.project.stories[storyIndex]!,
      graph: result.graph,
    };
  }

  /**
   * Quick Action: Create echo relationship edge.
   */
  async createEcho(
    storyId: string,
    fromNodeId: string,
    toNodeId: string,
  ): Promise<StoryGraph> {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
      );
    }

    const graph = this.getGraph(storyId);
    const updatedGraph = createEchoEdge(graph, fromNodeId, toNodeId);
    story.graph = updatedGraph;

    await this.app.save();
    return updatedGraph;
  }

  /**
   * Connects two graph nodes through one typed operation. Connections that
   * carry canonical story meaning update the Story and graph together.
   */
  async connectNodes(
    storyId: string,
    fromNodeId: string,
    toNodeId: string,
    type: import("@openfilm/core").StoryGraphEdgeType,
  ): Promise<{ story: Story; graph: StoryGraph }> {
    const story = this.app.project.stories.find((item) => item.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
      );
    }

    const graph = this.getGraph(storyId);
    const source = graph.nodes.find((node) => node.id === fromNodeId);
    const target = graph.nodes.find((node) => node.id === toNodeId);
    const validatedGraph = connectStoryGraphNodes(
      graph,
      fromNodeId,
      toNodeId,
      type,
    );

    let result: { story: Story; graph: StoryGraph };
    if (
      type === "supports" &&
      source?.type === "beat" &&
      target?.type === "asset"
    ) {
      result = addAssetToBeatInGraph(
        story,
        graph,
        source.beatId,
        target.assetId,
      );
    } else if (
      type === "precedes" &&
      source?.type === "beat" &&
      target?.type === "beat"
    ) {
      result = setAsNextBeat(story, graph, source.beatId, target.beatId);
    } else {
      result = { story, graph: validatedGraph };
    }

    const storyIndex = this.app.project.stories.findIndex(
      (item) => item.id === storyId,
    );
    this.app.project.stories[storyIndex] = {
      ...result.story,
      graph: result.graph,
    };
    await this.app.save();

    return {
      story: this.app.project.stories[storyIndex]!,
      graph: result.graph,
    };
  }

  /**
   * Quick Action: Set as next beat (explicit reordering of story.beats).
   * Playback order is strictly through explicit reorder operations, not canvas x/y.
   */
  async setNextBeat(
    storyId: string,
    currentBeatId: string,
    targetBeatId: string,
  ): Promise<{ story: Story; graph: StoryGraph }> {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
      );
    }

    const graph = this.getGraph(storyId);
    const result = setAsNextBeat(story, graph, currentBeatId, targetBeatId);

    const storyIndex = this.app.project.stories.findIndex(
      (s) => s.id === storyId,
    );
    this.app.project.stories[storyIndex] = {
      ...result.story,
      graph: result.graph,
    };

    await this.app.save();
    return {
      story: this.app.project.stories[storyIndex]!,
      graph: result.graph,
    };
  }

  /**
   * Removes a node from the story graph.
   * Removing graph link does NOT delete the original asset from catalog or StoryBeat.
   */
  async removeNode(storyId: string, nodeId: string): Promise<StoryGraph> {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
      );
    }

    const graph = this.getGraph(storyId);
    const updatedGraph = removeGraphNode(graph, nodeId);
    story.graph = updatedGraph;

    await this.app.save();
    return updatedGraph;
  }

  /**
   * Removes an edge from the story graph.
   */
  async removeEdge(storyId: string, edgeId: string): Promise<StoryGraph> {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
      );
    }

    const graph = this.getGraph(storyId);
    const updatedGraph = removeGraphEdge(graph, edgeId);
    story.graph = updatedGraph;

    await this.app.save();
    return updatedGraph;
  }
}
