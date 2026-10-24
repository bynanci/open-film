// Modified by OpenFilm contributors on 2026-10-24. See LICENSE and NOTICE.

import {
  STORY_GRAPH_EDGE_TYPES,
  validateEdgeAddition,
  type StoryGraph,
  type StoryGraphEdge,
  type StoryGraphEdgeType,
  type StoryGraphNode,
} from "@openfilm/core";

export function inferStoryGraphEdgeType(
  source: StoryGraphNode,
  target: StoryGraphNode,
): StoryGraphEdgeType {
  if (source.type === "theme") return "contains";
  if (source.type === "beat" && target.type === "asset") return "supports";
  if (source.type === "beat" && target.type === "beat") return "precedes";
  return "echoes";
}

export function connectStoryGraphNodes(
  graph: StoryGraph,
  fromNodeId: string,
  toNodeId: string,
  type: StoryGraphEdgeType,
): StoryGraph {
  if (!STORY_GRAPH_EDGE_TYPES.includes(type)) {
    throw new Error(`Unknown story relationship '${String(type)}'.`);
  }

  const source = graph.nodes.find((node) => node.id === fromNodeId);
  const target = graph.nodes.find((node) => node.id === toNodeId);
  if (
    type === "precedes" &&
    (source?.type !== "beat" || target?.type !== "beat")
  ) {
    throw new Error("A precedes relationship can only connect beat nodes.");
  }

  if (
    graph.edges.some(
      (edge) =>
        edge.from === fromNodeId && edge.to === toNodeId && edge.type === type,
    )
  ) {
    throw new Error("This story relationship already exists.");
  }

  const edge: StoryGraphEdge = {
    id: `edge-${type}-${fromNodeId}-${toNodeId}`,
    from: fromNodeId,
    to: toNodeId,
    type,
  };
  const validation = validateEdgeAddition(graph, edge);
  if (!validation.valid) {
    throw new Error(validation.error ?? "The story relationship is invalid.");
  }

  return { ...graph, edges: [...graph.edges, edge] };
}
