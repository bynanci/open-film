// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { ApplicationError } from "./errors.js";
import type { MediaAsset, Story } from "./models.js";

export type StoryGraphNodeType = "theme" | "beat" | "asset" | "idea";

export type IdeaSource = "user-memory" | "planned" | "wish" | "unknown";

export const IDEA_SOURCES: readonly IdeaSource[] = [
  "user-memory",
  "planned",
  "wish",
  "unknown",
] as const;

export interface StoryThemeNode {
  id: string;
  type: "theme";
  title: string;
  description?: string;
  color?: string;
}

export interface StoryBeatNode {
  id: string;
  type: "beat";
  storyId: string;
  beatId: string;
}

export interface StoryAssetNode {
  id: string;
  type: "asset";
  assetId: string;
  caption?: string;
}

export interface StoryIdeaNode {
  id: string;
  type: "idea";
  text: string;
  intent?: string;
  source: IdeaSource;
  assetReferences?: string[];
}

export type StoryGraphNode =
  StoryThemeNode | StoryBeatNode | StoryAssetNode | StoryIdeaNode;

export type StoryGraphEdgeType =
  "contains" | "supports" | "precedes" | "echoes" | "alternative";

export const STORY_GRAPH_EDGE_TYPES: readonly StoryGraphEdgeType[] = [
  "contains",
  "supports",
  "precedes",
  "echoes",
  "alternative",
] as const;

export interface StoryGraphEdge {
  id: string;
  from: string;
  to: string;
  type: StoryGraphEdgeType;
  metadata?: Record<string, unknown>;
}

export interface StoryGraph {
  version: 1;
  nodes: StoryGraphNode[];
  edges: StoryGraphEdge[];
}

export interface GraphNodeLayout {
  x: number;
  y: number;
  collapsed?: boolean;
}

export interface GraphViewState {
  version: 1;
  storyId: string;
  pan: { x: number; y: number };
  zoom: number;
  nodes: Record<string, GraphNodeLayout>;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
}

/**
 * Cycle detection for directed edge types like 'contains' and 'precedes'.
 * Returns the cycle path (node IDs) if a cycle is found, or null if acyclic.
 */
export function detectGraphCycle(
  nodes: StoryGraphNode[],
  edges: StoryGraphEdge[],
  targetType: "contains" | "precedes" = "precedes",
): string[] | null {
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(node.id, []);
  }
  for (const edge of edges) {
    if (edge.type === targetType && adj.has(edge.from) && adj.has(edge.to)) {
      adj.get(edge.from)!.push(edge.to);
    }
  }

  // 0: unvisited, 1: visiting (in stack), 2: visited
  const state = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const node of nodes) {
    state.set(node.id, 0);
  }

  function dfs(current: string): string[] | null {
    state.set(current, 1);
    const neighbors = adj.get(current) ?? [];
    for (const next of neighbors) {
      if (state.get(next) === 1) {
        // Cycle detected, reconstruct path
        const cycle: string[] = [next, current];
        let p = parent.get(current);
        while (p && p !== next) {
          cycle.push(p);
          p = parent.get(p);
        }
        cycle.push(next);
        return cycle.reverse();
      }
      if (state.get(next) === 0) {
        parent.set(next, current);
        const result = dfs(next);
        if (result) return result;
      }
    }
    state.set(current, 2);
    return null;
  }

  for (const node of nodes) {
    if (state.get(node.id) === 0) {
      parent.set(node.id, null);
      const cycle = dfs(node.id);
      if (cycle) return cycle;
    }
  }

  return null;
}

/**
 * Validates edge addition before inserting into graph.
 * Enforces cycle freedom for 'contains' and 'precedes'.
 * Ensures 'echoes' is never treated as an execution dependency.
 */
export function validateEdgeAddition(
  graph: StoryGraph,
  edge: StoryGraphEdge,
): { valid: boolean; error?: string } {
  const nodeMap = new Map<string, StoryGraphNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
  }

  if (!nodeMap.has(edge.from)) {
    return {
      valid: false,
      error: `Edge source node '${edge.from}' not found in graph.`,
    };
  }
  if (!nodeMap.has(edge.to)) {
    return {
      valid: false,
      error: `Edge target node '${edge.to}' not found in graph.`,
    };
  }
  if (edge.from === edge.to) {
    return { valid: false, error: "Self-referencing edges are not allowed." };
  }

  if (edge.type === "contains" || edge.type === "precedes") {
    const candidateEdges = [...graph.edges, edge];
    const cycle = detectGraphCycle(graph.nodes, candidateEdges, edge.type);
    if (cycle) {
      return {
        valid: false,
        error: `Cycle detected in '${edge.type}' relationship: ${cycle.join(" -> ")}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Creates an initial StoryGraph from an existing Story so an open project
 * never opens to an empty canvas.
 */
export function createInitialStoryGraph(
  story: Story,
  assets: MediaAsset[] = [],
): StoryGraph {
  const nodes: StoryGraphNode[] = [];
  const edges: StoryGraphEdge[] = [];
  const assetMap = new Map(assets.map((a) => [a.id, a]));

  // 1. Root Theme node representing the story
  const themeNodeId = `theme-${story.id}`;
  nodes.push({
    id: themeNodeId,
    type: "theme",
    title: story.title || "Story Theme",
    description: story.template ? `Template: ${story.template}` : undefined,
  });

  const beatNodeIds: string[] = [];

  // 2. Canonical beat reference nodes
  story.beats.forEach((beat, index) => {
    const beatNodeId = `beat-node-${beat.id}`;
    beatNodeIds.push(beatNodeId);
    nodes.push({
      id: beatNodeId,
      type: "beat",
      storyId: story.id,
      beatId: beat.id,
    });

    // Theme contains beats
    edges.push({
      id: `edge-theme-contains-${beat.id}`,
      from: themeNodeId,
      to: beatNodeId,
      type: "contains",
    });

    // Sequential precedes edge
    if (index > 0) {
      const prevBeatNodeId = beatNodeIds[index - 1]!;
      edges.push({
        id: `edge-precedes-${story.beats[index - 1]!.id}-${beat.id}`,
        from: prevBeatNodeId,
        to: beatNodeId,
        type: "precedes",
      });
    }

    // Asset reference nodes for selected assets
    const selected = beat.selectedAssetIds ?? [];
    selected.forEach((assetId) => {
      const assetNodeId = `asset-node-${assetId}`;
      if (!nodes.some((n) => n.id === assetNodeId)) {
        const asset = assetMap.get(assetId);
        nodes.push({
          id: assetNodeId,
          type: "asset",
          assetId,
          caption: asset?.name,
        });
      }
      edges.push({
        id: `edge-beat-asset-${beat.id}-${assetId}`,
        from: beatNodeId,
        to: assetNodeId,
        type: "supports",
      });
    });
  });

  return {
    version: 1,
    nodes,
    edges,
  };
}

/**
 * Validates a StoryGraph payload.
 */
export function validateStoryGraph(
  value: unknown,
  knownStoryBeatIds?: ReadonlySet<string>,
  _knownAssetIds?: ReadonlySet<string>,
): StoryGraph {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError(
      "story.invalid",
      "StoryGraph must be an object.",
    );
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new ApplicationError(
      "story.invalid",
      "StoryGraph version must be 1.",
    );
  }
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new ApplicationError(
      "story.invalid",
      "StoryGraph nodes and edges must be arrays.",
    );
  }

  const nodes: StoryGraphNode[] = [];
  const nodeIds = new Set<string>();

  for (let i = 0; i < raw.nodes.length; i++) {
    const item = raw.nodes[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApplicationError(
        "story.invalid",
        `Node at [${i}] must be an object.`,
      );
    }
    const n = item as Record<string, unknown>;
    if (typeof n.id !== "string" || !n.id.trim()) {
      throw new ApplicationError(
        "story.invalid",
        `Node at [${i}] has invalid id.`,
      );
    }
    if (nodeIds.has(n.id)) {
      throw new ApplicationError(
        "story.invalid",
        `Duplicate node id '${n.id}'.`,
      );
    }
    nodeIds.add(n.id);

    const type = n.type as string;
    if (!["theme", "beat", "asset", "idea"].includes(type)) {
      throw new ApplicationError(
        "story.invalid",
        `Unknown node type '${type}' at [${i}].`,
      );
    }

    if (type === "theme") {
      if (typeof n.title !== "string" || !n.title.trim()) {
        throw new ApplicationError(
          "story.invalid",
          `Theme node '${n.id}' requires title.`,
        );
      }
      nodes.push({
        id: n.id,
        type: "theme",
        title: n.title.trim(),
        description:
          typeof n.description === "string" ? n.description : undefined,
        color: typeof n.color === "string" ? n.color : undefined,
      });
    } else if (type === "beat") {
      if (typeof n.storyId !== "string" || typeof n.beatId !== "string") {
        throw new ApplicationError(
          "story.invalid",
          `Beat node '${n.id}' requires storyId and beatId.`,
        );
      }
      if (knownStoryBeatIds && !knownStoryBeatIds.has(n.beatId)) {
        throw new ApplicationError(
          "story.invalid",
          `Beat node '${n.id}' references unknown beatId '${n.beatId}'.`,
        );
      }
      nodes.push({
        id: n.id,
        type: "beat",
        storyId: n.storyId,
        beatId: n.beatId,
      });
    } else if (type === "asset") {
      if (typeof n.assetId !== "string" || !n.assetId.trim()) {
        throw new ApplicationError(
          "story.invalid",
          `Asset node '${n.id}' requires assetId.`,
        );
      }
      nodes.push({
        id: n.id,
        type: "asset",
        assetId: n.assetId,
        caption: typeof n.caption === "string" ? n.caption : undefined,
      });
    } else if (type === "idea") {
      if (typeof n.text !== "string") {
        throw new ApplicationError(
          "story.invalid",
          `Idea node '${n.id}' requires text.`,
        );
      }
      const source = (n.source as IdeaSource) ?? "unknown";
      if (!IDEA_SOURCES.includes(source)) {
        throw new ApplicationError(
          "story.invalid",
          `Invalid idea source '${String(n.source)}' on node '${n.id}'.`,
        );
      }
      nodes.push({
        id: n.id,
        type: "idea",
        text: n.text,
        intent: typeof n.intent === "string" ? n.intent : undefined,
        source,
        assetReferences: Array.isArray(n.assetReferences)
          ? (n.assetReferences.filter((r) => typeof r === "string") as string[])
          : undefined,
      });
    }
  }

  const edges: StoryGraphEdge[] = [];
  const edgeIds = new Set<string>();

  for (let i = 0; i < raw.edges.length; i++) {
    const item = raw.edges[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApplicationError(
        "story.invalid",
        `Edge at [${i}] must be an object.`,
      );
    }
    const e = item as Record<string, unknown>;
    if (typeof e.id !== "string" || !e.id.trim()) {
      throw new ApplicationError(
        "story.invalid",
        `Edge at [${i}] has invalid id.`,
      );
    }
    if (edgeIds.has(e.id)) {
      throw new ApplicationError(
        "story.invalid",
        `Duplicate edge id '${e.id}'.`,
      );
    }
    edgeIds.add(e.id);

    if (typeof e.from !== "string" || !nodeIds.has(e.from)) {
      throw new ApplicationError(
        "story.invalid",
        `Edge '${e.id}' references unknown source node '${String(e.from)}'.`,
      );
    }
    if (typeof e.to !== "string" || !nodeIds.has(e.to)) {
      throw new ApplicationError(
        "story.invalid",
        `Edge '${e.id}' references unknown target node '${String(e.to)}'.`,
      );
    }

    const type = e.type as StoryGraphEdgeType;
    if (!STORY_GRAPH_EDGE_TYPES.includes(type)) {
      throw new ApplicationError(
        "story.invalid",
        `Edge '${e.id}' has unknown type '${String(e.type)}'.`,
      );
    }

    edges.push({
      id: e.id,
      from: e.from,
      to: e.to,
      type,
      metadata:
        typeof e.metadata === "object" &&
        e.metadata !== null &&
        !Array.isArray(e.metadata)
          ? (e.metadata as Record<string, unknown>)
          : undefined,
    });
  }

  // Validate cycles
  const containsCycle = detectGraphCycle(nodes, edges, "contains");
  if (containsCycle) {
    throw new ApplicationError(
      "story.invalid",
      `Cycle detected in 'contains' hierarchy: ${containsCycle.join(" -> ")}`,
    );
  }

  const precedesCycle = detectGraphCycle(nodes, edges, "precedes");
  if (precedesCycle) {
    throw new ApplicationError(
      "story.invalid",
      `Cycle detected in 'precedes' order: ${precedesCycle.join(" -> ")}`,
    );
  }

  return {
    version: 1,
    nodes,
    edges,
  };
}

/**
 * Validates a GraphViewState payload.
 */
export function validateGraphViewState(value: unknown): GraphViewState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError(
      "request.invalid",
      "GraphViewState must be an object.",
    );
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new ApplicationError(
      "request.invalid",
      "GraphViewState version must be 1.",
    );
  }
  if (typeof raw.storyId !== "string" || !raw.storyId.trim()) {
    throw new ApplicationError(
      "request.invalid",
      "GraphViewState requires storyId.",
    );
  }

  const pan =
    typeof raw.pan === "object" && raw.pan !== null && !Array.isArray(raw.pan)
      ? (raw.pan as Record<string, unknown>)
      : { x: 0, y: 0 };
  const zoom =
    typeof raw.zoom === "number" && Number.isFinite(raw.zoom) ? raw.zoom : 1;

  const nodes: Record<string, GraphNodeLayout> = {};
  if (
    typeof raw.nodes === "object" &&
    raw.nodes !== null &&
    !Array.isArray(raw.nodes)
  ) {
    for (const [key, val] of Object.entries(
      raw.nodes as Record<string, unknown>,
    )) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        const layout = val as Record<string, unknown>;
        nodes[key] = {
          x:
            typeof layout.x === "number" && Number.isFinite(layout.x)
              ? layout.x
              : 0,
          y:
            typeof layout.y === "number" && Number.isFinite(layout.y)
              ? layout.y
              : 0,
          collapsed: Boolean(layout.collapsed),
        };
      }
    }
  }

  return {
    version: 1,
    storyId: raw.storyId.trim(),
    pan: {
      x: typeof pan.x === "number" && Number.isFinite(pan.x) ? pan.x : 0,
      y: typeof pan.y === "number" && Number.isFinite(pan.y) ? pan.y : 0,
    },
    zoom: Math.min(Math.max(zoom, 0.1), 5),
    nodes,
    selectedNodeId:
      typeof raw.selectedNodeId === "string" ? raw.selectedNodeId : null,
    selectedEdgeId:
      typeof raw.selectedEdgeId === "string" ? raw.selectedEdgeId : null,
  };
}
