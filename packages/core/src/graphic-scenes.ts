import { ApplicationError } from "./errors.js";

export const GRAPHIC_SCENE_LIMITS = Object.freeze({
  scenes: 8,
  nodes: 64,
  depth: 4,
  duration: 30,
  text: 512,
  totalText: 4096,
  coordinate: 8192,
  dimension: 4096,
  pixels: 8_294_400,
  frames: 1800,
  framePixels: 2_000_000_000,
  sourceBytes: 64 * 1024 * 1024,
  sourcePixels: 32_000_000,
  texturePixels: 33_177_600,
  textureBytes: 64 * 1024 * 1024,
  sequenceBytes: 256 * 1024 * 1024,
});

export type GraphicEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export interface GraphicValues {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}
export interface GraphicAnimation {
  enter?: {
    duration: number;
    easing: GraphicEasing;
    from: Partial<GraphicValues>;
  };
  exit?: {
    duration: number;
    easing: GraphicEasing;
    to: Partial<GraphicValues>;
  };
}
interface GraphicNodeBase extends GraphicValues {
  id: string;
  zIndex: number;
  /** Scene-local, half-open seconds. */
  start: number;
  end: number;
  animation?: GraphicAnimation;
}
export interface GraphicImageNode extends GraphicNodeBase {
  type: "image";
  assetId: string;
}
export interface GraphicTextNode extends GraphicNodeBase {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: 400 | 700;
}
export interface GraphicShapeNode extends GraphicNodeBase {
  type: "shape";
  shape: "rect" | "ellipse";
  fill: string;
}
export interface GraphicGroupNode extends GraphicNodeBase {
  type: "group";
  children: GraphicNode[];
}
export type GraphicNode =
  GraphicImageNode | GraphicTextNode | GraphicShapeNode | GraphicGroupNode;
export interface GraphicScene {
  version: 1;
  id: string;
  name: string;
  /** Composition seconds; this scene never owns another timeline. */
  start: number;
  duration: number;
  zIndex: number;
  nodes: GraphicNode[];
}
export interface EvaluatedGraphicNode extends GraphicValues {
  id: string;
  type: GraphicNode["type"];
  zIndex: number;
  baseWidth: number;
  baseHeight: number;
  shape?: GraphicShapeNode["shape"];
  fill?: string;
  children?: EvaluatedGraphicNode[];
}
export interface EvaluatedGraphicScene {
  id: string;
  nodes: EvaluatedGraphicNode[];
}

type Data = Record<string, unknown>;
const fields = [
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
  "animation",
];
const valueFields = ["x", "y", "width", "height", "opacity"] as const;
function bad(path: string, message: string): never {
  throw new ApplicationError("graphics.invalid", `${path}: ${message}`, 400);
}
function record(
  value: unknown,
  path: string,
  allowed: readonly string[],
): Data {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length
  )
    bad(path, "expected a plain JSON object");
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!allowed.includes(key)) bad(`${path}.${key}`, "unknown field");
    if (!("value" in descriptor) || !descriptor.enumerable)
      bad(`${path}.${key}`, "expected JSON data, not an accessor");
  }
  return value as Data;
}
function list(value: unknown, path: string, maximum: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum
  )
    bad(path, `expected an array with at most ${maximum} items`);
  if (
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)),
    )
  )
    bad(path, "expected undecorated JSON array data");
  for (let i = 0; i < value.length; i++)
    if (
      !Object.hasOwn(value, i) ||
      !Object.hasOwn(
        Object.getOwnPropertyDescriptor(value, String(i)) ?? {},
        "value",
      )
    )
      bad(path, "expected dense JSON array data");
  return value;
}
function numeric(
  value: unknown,
  path: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    bad(
      path,
      `expected ${integer ? "integer" : "finite number"} in ${min}..${max}`,
    );
  return value;
}
function text(
  value: unknown,
  path: string,
  maximum: number,
  multiline = false,
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return (
        (code < 32 && !(multiline && (code === 9 || code === 10))) ||
        code === 127 ||
        (code >= 0xd800 && code <= 0xdfff)
      );
    })
  )
    bad(path, `expected bounded literal text of at most ${maximum} characters`);
  return value;
}
function identifier(value: unknown, path: string): string {
  const result = text(value, path, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/u.test(result))
    bad(path, "expected an identifier, not a path or URL");
  return result;
}
function values(data: Data, path: string, partial = false): void {
  for (const field of valueFields) {
    if (partial && !Object.hasOwn(data, field)) continue;
    numeric(
      data[field],
      `${path}.${field}`,
      field === "opacity" ? 0 : field === "x" || field === "y" ? -8192 : 1,
      field === "opacity" ? 1 : field === "x" || field === "y" ? 8192 : 4096,
    );
  }
  if (
    typeof data.width === "number" &&
    typeof data.height === "number" &&
    data.width * data.height > GRAPHIC_SCENE_LIMITS.pixels
  )
    bad(path, "node box pixel limit exceeded");
}
function animation(value: unknown, path: string, length: number): void {
  const data = record(value, path, ["enter", "exit"]);
  if (!Object.keys(data).length)
    bad(path, "expected an enter or exit animation");
  let total = 0;
  for (const phase of ["enter", "exit"] as const) {
    if (!Object.hasOwn(data, phase)) continue;
    const endpoint = phase === "enter" ? "from" : "to";
    const itemPath = `${path}.${phase}`;
    const item = record(data[phase], itemPath, [
      "duration",
      "easing",
      endpoint,
    ]);
    total += numeric(
      item.duration,
      `${itemPath}.duration`,
      Number.MIN_VALUE,
      length,
    );
    if (
      typeof item.easing !== "string" ||
      !["linear", "ease-in", "ease-out", "ease-in-out"].includes(item.easing)
    )
      bad(`${itemPath}.easing`, "unknown easing");
    const point = record(
      item[endpoint],
      `${itemPath}.${endpoint}`,
      valueFields,
    );
    if (!Object.keys(point).length)
      bad(itemPath, "animation requires an explicit endpoint");
    values(point, `${itemPath}.${endpoint}`, true);
  }
  if (total > length + 1e-9) bad(path, "enter and exit durations overlap");
}

/** Strict data admission, bounded before recursive traversal or cloning. */
export function validateGraphicScenes(
  value: unknown,
  compositionDuration: number,
): GraphicScene[] {
  const entries = list(value, "graphicScenes", GRAPHIC_SCENE_LIMITS.scenes);
  const sceneIds = new Set<string>();
  let count = 0;
  let characters = 0;
  for (const [index, entry] of entries.entries()) {
    const path = `graphicScenes[${index}]`;
    const scene = record(entry, path, [
      "version",
      "id",
      "name",
      "start",
      "duration",
      "zIndex",
      "nodes",
    ]);
    if (scene.version !== 1)
      bad(`${path}.version`, "unsupported graphic scene version");
    const id = identifier(scene.id, `${path}.id`);
    if (sceneIds.has(id)) bad(path, "duplicate scene ID");
    sceneIds.add(id);
    text(scene.name, `${path}.name`, 128);
    const start = numeric(scene.start, `${path}.start`, 0, compositionDuration);
    const duration = numeric(
      scene.duration,
      `${path}.duration`,
      Number.MIN_VALUE,
      GRAPHIC_SCENE_LIMITS.duration,
    );
    if (start + duration > compositionDuration + 1e-9)
      bad(path, "scene exceeds Composition duration");
    numeric(scene.zIndex, `${path}.zIndex`, -1000, 1000, true);
    const nodeIds = new Set<string>();
    const visit = (nodes: unknown, nodePath: string, depth: number): void => {
      for (const [i, raw] of list(
        nodes,
        nodePath,
        GRAPHIC_SCENE_LIMITS.nodes,
      ).entries()) {
        if (depth > GRAPHIC_SCENE_LIMITS.depth)
          bad(nodePath, "nesting depth limit exceeded");
        if (++count > GRAPHIC_SCENE_LIMITS.nodes)
          bad(nodePath, "64 node limit exceeded");
        const p = `${nodePath}[${i}]`;
        // Check descriptors before reading the discriminator.
        const item = record(raw, p, [
          ...fields,
          "assetId",
          "text",
          "fontSize",
          "fontFamily",
          "fontWeight",
          "shape",
          "fill",
          "children",
        ]);
        const additions =
          item.type === "image"
            ? ["assetId"]
            : item.type === "text"
              ? ["text", "fontSize", "fontFamily", "fontWeight"]
              : item.type === "shape"
                ? ["shape", "fill"]
                : item.type === "group"
                  ? ["children"]
                  : bad(`${p}.type`, "unknown graphic primitive");
        record(item, p, [...fields, ...additions]);
        const nodeId = identifier(item.id, `${p}.id`);
        if (nodeIds.has(nodeId)) bad(p, "duplicate node ID");
        nodeIds.add(nodeId);
        values(item, p);
        numeric(item.zIndex, `${p}.zIndex`, -1000, 1000, true);
        const from = numeric(item.start, `${p}.start`, 0, duration);
        const end = numeric(item.end, `${p}.end`, Number.MIN_VALUE, duration);
        if (end <= from) bad(p, "end must follow start");
        if (Object.hasOwn(item, "animation"))
          animation(item.animation, `${p}.animation`, end - from);
        if (item.type === "image") identifier(item.assetId, `${p}.assetId`);
        if (item.type === "shape") {
          if (item.shape !== "rect" && item.shape !== "ellipse")
            bad(`${p}.shape`, "unknown shape");
          if (
            typeof item.fill !== "string" ||
            !/^#[0-9a-f]{6}$/iu.test(item.fill)
          )
            bad(`${p}.fill`, "expected literal six-digit hex color");
        }
        if (item.type === "text") {
          const literal = text(
            item.text,
            `${p}.text`,
            GRAPHIC_SCENE_LIMITS.text,
            true,
          );
          if (literal.split("\n").length > 8)
            bad(`${p}.text`, "at most eight lines");
          characters += literal.length;
          if (characters > GRAPHIC_SCENE_LIMITS.totalText)
            bad(p, "total text limit exceeded");
          numeric(item.fontSize, `${p}.fontSize`, 6, 256);
          if (Object.hasOwn(item, "fontFamily"))
            text(item.fontFamily, `${p}.fontFamily`, 128);
          if (
            Object.hasOwn(item, "fontWeight") &&
            item.fontWeight !== 400 &&
            item.fontWeight !== 700
          )
            bad(`${p}.fontWeight`, "expected 400 or 700");
        }
        if (item.type === "group")
          visit(item.children, `${p}.children`, depth + 1);
      }
    };
    visit(scene.nodes, `${path}.nodes`, 1);
  }
  return structuredClone(entries) as GraphicScene[];
}

export function graphicSceneAssetIds(
  scenes: readonly GraphicScene[],
): string[] {
  const ids = new Set<string>();
  let count = 0;
  const visit = (nodes: readonly GraphicNode[]): void => {
    for (const node of nodes) {
      if (++count > GRAPHIC_SCENE_LIMITS.nodes)
        bad("graphicScenes", "node limit exceeded");
      if (node.type === "image") ids.add(node.assetId);
      if (node.type === "group") visit(node.children);
    }
  };
  for (const scene of scenes) visit(scene.nodes);
  return [...ids];
}

export function graphicEasing(easing: GraphicEasing, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  if (easing === "ease-in") return t * t;
  if (easing === "ease-out") return 1 - (1 - t) * (1 - t);
  if (easing === "ease-in-out")
    return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
  return t;
}

/** Pure frame(t) over admitted data: no clock, accumulated state or platform IO. */
export function evaluateGraphicSceneAtTime(
  scene: GraphicScene,
  time: number,
): EvaluatedGraphicScene {
  numeric(time, "time", 0, Number.MAX_VALUE);
  const local = time - scene.start;
  const evaluate = (nodes: readonly GraphicNode[]): EvaluatedGraphicNode[] =>
    [...nodes]
      .sort((a, b) => a.zIndex - b.zIndex)
      .flatMap((node) => {
        if (local < node.start || local >= node.end) return [];
        const result: EvaluatedGraphicNode = {
          id: node.id,
          type: node.type,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          opacity: node.opacity,
          zIndex: node.zIndex,
          baseWidth: node.width,
          baseHeight: node.height,
        };
        const enter = node.animation?.enter;
        const exit = node.animation?.exit;
        const elapsed = local - node.start;
        if (enter && elapsed < enter.duration) {
          const progress = graphicEasing(
            enter.easing,
            elapsed / enter.duration,
          );
          for (const key of valueFields) {
            const from = enter.from[key] ?? node[key];
            result[key] = from + (node[key] - from) * progress;
          }
        } else if (exit && local >= node.end - exit.duration) {
          const progress = graphicEasing(
            exit.easing,
            (local - node.end + exit.duration) / exit.duration,
          );
          for (const key of valueFields)
            result[key] =
              node[key] + ((exit.to[key] ?? node[key]) - node[key]) * progress;
        }
        if (node.type === "shape") {
          result.shape = node.shape;
          result.fill = node.fill;
        }
        if (node.type === "group") result.children = evaluate(node.children);
        return [result];
      });
  return {
    id: scene.id,
    nodes: local < 0 || local >= scene.duration ? [] : evaluate(scene.nodes),
  };
}
