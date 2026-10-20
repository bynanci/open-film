import { createProject } from "@openfilm/core";
import { graphicScene } from "./graphic-scene.js";

type Data = Record<string, unknown>;
export interface GraphicSchemaCase {
  name: string;
  scenes?: unknown;
  valid: boolean;
}
const base = {
  id: "node",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  opacity: 1,
  zIndex: 0,
  start: 0,
  end: 6,
};
const shape = (patch: Data = {}) => ({
  ...base,
  type: "shape",
  shape: "rect",
  fill: "#aAbBcC",
  ...patch,
});
const image = (patch: Data = {}) => ({
  ...base,
  type: "image",
  assetId: "photo",
  ...patch,
});
const text = (patch: Data = {}) => ({
  ...base,
  type: "text",
  text: "早安，世界 🌅\nGood morning\tOpenFilm",
  fontSize: 24,
  fontFamily: "Noto Sans CJK TC",
  fontWeight: 700,
  ...patch,
});
const group = (children: unknown[], patch: Data = {}) => ({
  ...base,
  type: "group",
  children,
  ...patch,
});
const scene = (patch: Data = {}) => ({ ...graphicScene(), ...patch });
const hash = "a".repeat(64);
const recipe = {
  version: 1,
  id: "depth",
  nodeId: "node",
  mode: "parallax",
  duration: 6,
  sourceAssetId: "photo",
  sourceSha256: hash,
  maskAssetId: "mask",
  maskSha256: hash,
  background: { kind: "source" },
  protectedRegion: { x: 0.2, y: 0.2, width: 0.4, height: 0.6 },
  foregroundDepth: 1.2,
  backgroundDepth: 0.2,
  amplitude: 0.5,
  camera: {
    from: { x: -0.05, y: 0, scale: 1 },
    to: { x: 0.05, y: 0, scale: 1.12 },
  },
  easing: "ease-in-out",
};
const depthScene = (patch: Data = {}) =>
  scene({ nodes: [image()], photoDepth: { ...recipe, ...patch } });
function without(value: Data, key: string): Data {
  const result = structuredClone(value);
  delete result[key];
  return result;
}
function nested(levels: number, leaf = true): unknown[] {
  let nodes: unknown[] = leaf ? [shape()] : [];
  for (let index = 0; index < levels; index++)
    nodes = [group(nodes, { id: `group-${index}` })];
  return nodes;
}

export function graphicSchemaProject(scenes?: unknown) {
  const project = createProject("Synthetic GraphicScene schema parity");
  project.createdAt = project.updatedAt = "2026-10-20T00:00:00.000Z";
  project.id = "schema-parity-project";
  project.stories = [{ id: "story", title: "Synthetic", beats: [] }];
  project.timelines = [
    {
      id: "composition",
      storyId: "story",
      duration: 30,
      tracks: [],
      ...(scenes === undefined ? {} : { graphicScenes: scenes as never }),
    },
  ];
  return project;
}

export const graphicSchemaCases: GraphicSchemaCase[] = [
  { name: "legacy project without graphics", valid: true },
  { name: "empty scene collection", scenes: [], valid: true },
  { name: "existing shape fixture", scenes: [graphicScene()], valid: true },
  { name: "empty scene", scenes: [scene({ nodes: [] })], valid: true },
  {
    name: "optional layer state and rotation",
    scenes: [
      scene({
        nodes: [
          shape({
            shape: "ellipse",
            hidden: true,
            locked: false,
            rotation: -3600,
          }),
        ],
      }),
    ],
    valid: true,
  },
  {
    name: "literal multilingual text",
    scenes: [scene({ nodes: [text()] })],
    valid: true,
  },
  {
    name: "image identity",
    scenes: [scene({ nodes: [image()] })],
    valid: true,
  },
  {
    name: "all primitives in nested groups",
    scenes: [
      scene({
        nodes: [
          group([
            shape({ id: "rect" }),
            image({ id: "image" }),
            text({ id: "text" }),
          ]),
        ],
      }),
    ],
    valid: true,
  },
  {
    name: "four levels with a leaf",
    scenes: [scene({ nodes: nested(3) })],
    valid: true,
  },
  {
    name: "empty group at depth four",
    scenes: [scene({ nodes: nested(4, false) })],
    valid: true,
  },
  {
    name: "explicit bounded enter and exit values",
    scenes: [
      scene({
        nodes: [
          shape({
            animation: {
              enter: {
                duration: 1,
                easing: "ease-in",
                from: {
                  x: -8192,
                  y: 8192,
                  width: 1,
                  height: 1,
                  opacity: 0,
                  rotation: -3600,
                },
              },
              exit: {
                duration: 1,
                easing: "ease-out",
                to: {
                  x: 8192,
                  y: -8192,
                  width: 4096,
                  height: 1,
                  opacity: 1,
                  rotation: 3600,
                },
              },
            },
          }),
        ],
      }),
    ],
    valid: true,
  },
  {
    name: "maximum scene collection",
    scenes: Array.from({ length: 8 }, (_, i) => scene({ id: `scene-${i}` })),
    valid: true,
  },
  {
    name: "maximum node collection",
    scenes: [
      scene({
        nodes: Array.from({ length: 64 }, (_, i) => shape({ id: `node-${i}` })),
      }),
    ],
    valid: true,
  },
  {
    name: "maximum text and eight lines",
    scenes: [
      scene({ nodes: [text({ text: "a".repeat(505) + "\n".repeat(7) })] }),
    ],
    valid: true,
  },
  { name: "PhotoDepth source background", scenes: [depthScene()], valid: true },
  {
    name: "PhotoDepth asset background",
    scenes: [
      depthScene({
        background: { kind: "asset", assetId: "background", sha256: hash },
      }),
    ],
    valid: true,
  },
  ...[
    "mask-not-available",
    "mask-unreliable",
    "background-not-available",
    "protected-subject-overlap",
  ].map((fallbackReason) => ({
    name: `PhotoDepth fallback ${fallbackReason}`,
    scenes: [
      scene({
        nodes: [image()],
        photoDepth: {
          version: 1,
          id: "depth",
          nodeId: "node",
          mode: "fallback",
          duration: 6,
          sourceAssetId: "photo",
          sourceSha256: hash,
          fallbackReason,
        },
      }),
    ],
    valid: true,
  })),
  { name: "empty object", scenes: [{}], valid: false },
  ...["version", "id", "name", "start", "duration", "zIndex", "nodes"].map(
    (key) => ({
      name: `missing scene ${key}`,
      scenes: [without(scene(), key)],
      valid: false,
    }),
  ),
  ...[
    "id",
    "type",
    "x",
    "y",
    "width",
    "height",
    "opacity",
    "zIndex",
    "start",
    "end",
  ].map((key) => ({
    name: `missing node ${key}`,
    scenes: [scene({ nodes: [without(shape(), key)] })],
    valid: false,
  })),
  ...[
    [image(), "assetId"],
    [text(), "text"],
    [text(), "fontSize"],
    [shape(), "shape"],
    [shape(), "fill"],
    [group([]), "children"],
  ].map(([value, key]) => ({
    name: `missing primitive ${key}`,
    scenes: [scene({ nodes: [without(value as Data, key as string)] })],
    valid: false,
  })),
  ...[
    { version: 2 },
    { version: "1" },
    { id: "../scene" },
    { name: "  " },
    { name: "bad\u0000name" },
    { name: "x".repeat(129) },
    { start: -1 },
    { duration: 0 },
    { duration: 31 },
    { zIndex: 0.5 },
    { zIndex: 1001 },
    { nodes: {} },
    { html: "<script>alert(1)</script>" },
    { src: "https://example.invalid/photo" },
  ].map((patch, i) => ({
    name: `invalid scene field ${i}`,
    scenes: [scene(patch)],
    valid: false,
  })),
  ...[
    { type: "html" },
    { id: "file:///node" },
    { x: 8193 },
    { y: -8193 },
    { width: 0 },
    { width: 4097 },
    { height: 0.5 },
    { opacity: 1.1 },
    { zIndex: -1001 },
    { zIndex: 0.5 },
    { start: -1 },
    { end: 31 },
    { hidden: "yes" },
    { locked: 1 },
    { rotation: 3601 },
    { x: "Math.random()" },
    { fill: "url(https://example.invalid/image)" },
    { fill: "#fff" },
    { shape: "path" },
    { html: "<svg/>" },
    { assetId: "photo" },
    { animation: {} },
    { animation: { enter: { duration: 0, easing: "linear", from: { x: 0 } } } },
    {
      animation: { enter: { duration: 31, easing: "linear", from: { x: 0 } } },
    },
    {
      animation: { enter: { duration: 1, easing: "random()", from: { x: 0 } } },
    },
    { animation: { enter: { duration: 1, easing: "linear", from: {} } } },
    {
      animation: {
        enter: {
          duration: 1,
          easing: "linear",
          from: { src: "https://example.invalid" },
        },
      },
    },
    {
      animation: {
        exit: { duration: 1, easing: "linear", from: { opacity: 0 } },
      },
    },
  ].map((patch, i) => ({
    name: `invalid node field ${i}`,
    scenes: [scene({ nodes: [shape(patch)] })],
    valid: false,
  })),
  ...[
    image({ assetId: "https://example.invalid/photo" }),
    image({ fill: "#ffffff" }),
    text({ text: "x".repeat(513) }),
    text({ text: "\n".repeat(8) + "x" }),
    text({ text: "bad\u000btext" }),
    text({ text: "\ud800" }),
    text({ fontSize: 5 }),
    text({ fontWeight: 500 }),
    text({ fontFamily: "bad\tfont" }),
    text({ children: [] }),
    group([{}]),
    group([], { assetId: "photo" }),
  ].map((node, i) => ({
    name: `invalid primitive ${i}`,
    scenes: [scene({ nodes: [node] })],
    valid: false,
  })),
  {
    name: "nine scenes",
    scenes: Array.from({ length: 9 }, (_, i) => scene({ id: `scene-${i}` })),
    valid: false,
  },
  {
    name: "sixty-five nodes",
    scenes: [
      scene({
        nodes: Array.from({ length: 65 }, (_, i) => shape({ id: `node-${i}` })),
      }),
    ],
    valid: false,
  },
  {
    name: "fifth nested level",
    scenes: [scene({ nodes: nested(4) })],
    valid: false,
  },
  ...[
    { id: "../depth" },
    { nodeId: "javascript:alert(1)" },
    { sourceAssetId: "file:///photo" },
    { maskAssetId: "https://example.invalid/mask" },
    { sourceSha256: "A".repeat(64) },
    { duration: 2 },
    { duration: 7 },
    { fallbackReason: "mask-unreliable" },
    { background: { kind: "source", assetId: "ignored" } },
    { background: { kind: "asset", assetId: "../background", sha256: hash } },
    {
      camera: {
        from: { x: 0, y: 0, scale: 1 },
        to: { x: 0.051, y: 0, scale: 1 },
      },
    },
    { protectedRegion: { x: 0, y: 0, width: 0, height: 1 } },
  ].map((patch, i) => ({
    name: `invalid PhotoDepth field ${i}`,
    scenes: [depthScene(patch)],
    valid: false,
  })),
];

// These require comparisons, aggregate budgets or catalog resolution. They stay
// authoritative in core admission; standard JSON Schema has no data references.
export const graphicSchemaSemanticCases = [
  { name: "duplicate scene IDs", scenes: [scene(), scene()] },
  {
    name: "duplicate nested node IDs",
    scenes: [scene({ nodes: [group([shape()])] })],
  },
  { name: "scene beyond Composition", scenes: [scene({ start: 29 })] },
  {
    name: "node interval beyond scene",
    scenes: [scene({ nodes: [shape({ end: 7 })] })],
  },
  {
    name: "reversed node interval",
    scenes: [scene({ nodes: [shape({ start: 2, end: 1 })] })],
  },
  {
    name: "animation overlap",
    scenes: [
      scene({
        nodes: [
          shape({
            animation: {
              enter: { duration: 4, easing: "linear", from: { opacity: 0 } },
              exit: { duration: 4, easing: "linear", to: { opacity: 0 } },
            },
          }),
        ],
      }),
    ],
  },
  {
    name: "box pixel budget",
    scenes: [scene({ nodes: [shape({ width: 4096, height: 4096 })] })],
  },
  {
    name: "aggregate node count",
    scenes: [
      scene({
        id: "first",
        nodes: Array.from({ length: 32 }, (_, i) => shape({ id: `node-${i}` })),
      }),
      scene({
        id: "second",
        nodes: Array.from({ length: 33 }, (_, i) => shape({ id: `node-${i}` })),
      }),
    ],
  },
  {
    name: "aggregate text count",
    scenes: [
      scene({
        nodes: Array.from({ length: 9 }, (_, i) =>
          text({ id: `text-${i}`, text: "x".repeat(512) }),
        ),
      }),
    ],
  },
  {
    name: "PhotoDepth missing root image binding",
    scenes: [depthScene({ nodeId: "missing" })],
  },
  {
    name: "PhotoDepth duration differs from image",
    scenes: [depthScene({ duration: 3 })],
  },
  {
    name: "PhotoDepth source differs from image",
    scenes: [depthScene({ sourceAssetId: "another-photo" })],
  },
  {
    name: "PhotoDepth mask equals source",
    scenes: [depthScene({ maskAssetId: "photo" })],
  },
  {
    name: "PhotoDepth region exceeds image",
    scenes: [
      depthScene({
        protectedRegion: { x: 0.9, y: 0.9, width: 0.2, height: 0.2 },
      }),
    ],
  },
];
