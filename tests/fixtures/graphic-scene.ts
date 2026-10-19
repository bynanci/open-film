import type { GraphicScene, GraphicShapeNode } from "@openfilm/core";

export function graphicNode(
  patch: Partial<GraphicShapeNode> = {},
): GraphicShapeNode {
  return {
    id: "rectangle",
    type: "shape",
    shape: "rect",
    fill: "#ff0000",
    x: 0,
    y: 0,
    width: 60,
    height: 40,
    opacity: 1,
    zIndex: 0,
    start: 0,
    end: 6,
    ...patch,
  };
}

export function graphicScene(patch: Partial<GraphicScene> = {}): GraphicScene {
  return {
    version: 1,
    id: "graphic-scene",
    name: "合成動態場景",
    start: 0,
    duration: 6,
    zIndex: 0,
    nodes: [graphicNode()],
    ...patch,
  };
}
