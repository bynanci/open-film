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
  photoMaskPixels: 8_294_400,
});

export type GraphicEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export interface GraphicValues {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation?: number;
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
  /** Hidden nodes remain editable but are omitted from Monitor and output. */
  hidden?: boolean;
  /** Locked nodes are immutable through typed scene-upsert commands. */
  locked?: boolean;
  animation?: GraphicAnimation;
}
export interface GraphicImageNode extends GraphicNodeBase {
  type: "image";
  assetId: string;
}
export interface PhotoDepthCamera {
  /** Normalized composition-space camera offset, bounded to +/- 5%. */
  x: number;
  y: number;
  /** Camera zoom; 1 is neutral and the maximum is 1.12. */
  scale: number;
}
export interface PhotoDepthRegion {
  /** Normalized coordinates in the original photo. */
  x: number;
  y: number;
  width: number;
  height: number;
}
interface PhotoDepthBase {
  version: 1;
  id: string;
  nodeId: string;
  /** Must equal the linked image node's existing scene-local duration. */
  duration: number;
  sourceAssetId: string;
  sourceSha256: string;
}
export interface PhotoDepthParallaxRecipe extends PhotoDepthBase {
  mode: "parallax";
  maskAssetId: string;
  maskSha256: string;
  background:
    { kind: "source" } | { kind: "asset"; assetId: string; sha256: string };
  protectedRegion: PhotoDepthRegion;
  foregroundDepth: number;
  backgroundDepth: number;
  amplitude: number;
  camera: { from: PhotoDepthCamera; to: PhotoDepthCamera };
  easing: GraphicEasing;
  fallbackReason?: never;
}
export interface PhotoDepthFallbackRecipe extends PhotoDepthBase {
  mode: "fallback";
  fallbackReason:
    | "mask-not-available"
    | "mask-unreliable"
    | "background-not-available"
    | "protected-subject-overlap";
}
export type PhotoDepthRecipe =
  PhotoDepthParallaxRecipe | PhotoDepthFallbackRecipe;
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
  /** Optional M8A extension. Omitted legacy scenes retain their v1 behavior. */
  photoDepth?: PhotoDepthRecipe;
}
export interface EvaluatedGraphicNode extends GraphicValues {
  id: string;
  type: GraphicNode["type"];
  zIndex: number;
  locked?: boolean;
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
  "rotation",
  "hidden",
  "locked",
];
const valueFields = [
  "x",
  "y",
  "width",
  "height",
  "opacity",
  "rotation",
] as const;
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
    if (!partial && field === "rotation" && !Object.hasOwn(data, field))
      continue;
    numeric(
      data[field],
      `${path}.${field}`,
      field === "opacity"
        ? 0
        : field === "x" || field === "y"
          ? -8192
          : field === "rotation"
            ? -3600
            : 1,
      field === "opacity"
        ? 1
        : field === "x" || field === "y"
          ? 8192
          : field === "rotation"
            ? 3600
            : 4096,
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

function photoDepth(
  value: unknown,
  path: string,
  scene: Data,
): PhotoDepthRecipe {
  const data = record(value, path, [
    "version",
    "id",
    "nodeId",
    "mode",
    "duration",
    "sourceAssetId",
    "sourceSha256",
    "maskAssetId",
    "maskSha256",
    "background",
    "protectedRegion",
    "foregroundDepth",
    "backgroundDepth",
    "amplitude",
    "camera",
    "easing",
    "fallbackReason",
  ]);
  if (data.version !== 1)
    bad(`${path}.version`, "unsupported PhotoDepth version");
  identifier(data.id, `${path}.id`);
  const nodeId = identifier(data.nodeId, `${path}.nodeId`);
  const duration = numeric(data.duration, `${path}.duration`, 3, 6);
  const node = (scene.nodes as GraphicNode[]).find(
    (item) => item.id === nodeId && item.type === "image",
  ) as GraphicImageNode | undefined;
  if (!node) bad(path, "PhotoDepth must reference an image node in this scene");
  if (Math.abs(node.end - node.start - duration) > 1e-7)
    bad(`${path}.duration`, "must match the linked image node duration");
  const sourceAssetId = identifier(data.sourceAssetId, `${path}.sourceAssetId`);
  if (sourceAssetId !== node.assetId)
    bad(`${path}.sourceAssetId`, "must match the linked image node source");
  const hash = (input: unknown, hashPath: string) => {
    if (typeof input !== "string" || !/^[a-f0-9]{64}$/u.test(input))
      bad(hashPath, "expected a lowercase SHA-256 digest");
    return input;
  };
  const sourceSha256 = hash(data.sourceSha256, `${path}.sourceSha256`);
  if (data.mode === "fallback") {
    if (
      data.fallbackReason !== "mask-not-available" &&
      data.fallbackReason !== "mask-unreliable" &&
      data.fallbackReason !== "background-not-available" &&
      data.fallbackReason !== "protected-subject-overlap"
    )
      bad(`${path}.fallbackReason`, "expected a supported fallback reason");
    return {
      version: 1,
      id: data.id as string,
      nodeId,
      mode: "fallback",
      duration,
      sourceAssetId,
      sourceSha256,
      fallbackReason: data.fallbackReason,
    };
  }
  if (data.mode !== "parallax") bad(`${path}.mode`, "unknown PhotoDepth mode");
  if (node.rotation && Math.abs(node.rotation) > 1e-9)
    bad(path, "PhotoDepth image nodes cannot be rotated in v1");
  if (node.animation)
    bad(
      path,
      "PhotoDepth camera motion cannot be combined with image-node animation in v1",
    );
  if (Object.hasOwn(data, "fallbackReason"))
    bad(
      `${path}.fallbackReason`,
      "parallax recipes cannot carry a fallback reason",
    );
  const maskAssetId = identifier(data.maskAssetId, `${path}.maskAssetId`);
  if (maskAssetId === sourceAssetId)
    bad(`${path}.maskAssetId`, "mask must be a separate local asset");
  const maskSha256 = hash(data.maskSha256, `${path}.maskSha256`);
  const backgroundData = record(data.background, `${path}.background`, [
    "kind",
    "assetId",
    "sha256",
  ]);
  let background: PhotoDepthParallaxRecipe["background"];
  if (backgroundData.kind === "source") {
    if (Object.keys(backgroundData).some((key) => key !== "kind"))
      bad(`${path}.background`, "source background accepts only its kind");
    background = { kind: "source" };
  } else if (backgroundData.kind === "asset") {
    const assetId = identifier(
      backgroundData.assetId,
      `${path}.background.assetId`,
    );
    if (assetId === maskAssetId)
      bad(
        `${path}.background.assetId`,
        "background and mask must be separate assets",
      );
    background = {
      kind: "asset",
      assetId,
      sha256: hash(backgroundData.sha256, `${path}.background.sha256`),
    };
  } else bad(`${path}.background.kind`, "expected source or asset");
  const regionData = record(data.protectedRegion, `${path}.protectedRegion`, [
    "x",
    "y",
    "width",
    "height",
  ]);
  const region = {
    x: numeric(regionData.x, `${path}.protectedRegion.x`, 0, 1),
    y: numeric(regionData.y, `${path}.protectedRegion.y`, 0, 1),
    width: numeric(
      regionData.width,
      `${path}.protectedRegion.width`,
      Number.MIN_VALUE,
      1,
    ),
    height: numeric(
      regionData.height,
      `${path}.protectedRegion.height`,
      Number.MIN_VALUE,
      1,
    ),
  };
  if (region.x + region.width > 1 + 1e-9 || region.y + region.height > 1 + 1e-9)
    bad(`${path}.protectedRegion`, "region exceeds the original photo bounds");
  const foregroundDepth = numeric(
    data.foregroundDepth,
    `${path}.foregroundDepth`,
    1,
    1.35,
  );
  const backgroundDepth = numeric(
    data.backgroundDepth,
    `${path}.backgroundDepth`,
    0,
    0.65,
  );
  if (foregroundDepth <= backgroundDepth)
    bad(`${path}.foregroundDepth`, "foreground must be nearer than background");
  const amplitude = numeric(data.amplitude, `${path}.amplitude`, 0, 1);
  if (
    !["linear", "ease-in", "ease-out", "ease-in-out"].includes(
      String(data.easing),
    )
  )
    bad(`${path}.easing`, "unknown easing");
  const cameraData = record(data.camera, `${path}.camera`, ["from", "to"]);
  const cameraPoint = (input: unknown, pointPath: string): PhotoDepthCamera => {
    const point = record(input, pointPath, ["x", "y", "scale"]);
    return {
      x: numeric(point.x, `${pointPath}.x`, -0.05, 0.05),
      y: numeric(point.y, `${pointPath}.y`, -0.05, 0.05),
      scale: numeric(point.scale, `${pointPath}.scale`, 1, 1.12),
    };
  };
  return {
    version: 1,
    id: data.id as string,
    nodeId,
    mode: "parallax",
    duration,
    sourceAssetId,
    sourceSha256,
    maskAssetId,
    maskSha256,
    background,
    protectedRegion: region,
    foregroundDepth,
    backgroundDepth,
    amplitude,
    camera: {
      from: cameraPoint(cameraData.from, `${path}.camera.from`),
      to: cameraPoint(cameraData.to, `${path}.camera.to`),
    },
    easing: data.easing as GraphicEasing,
  };
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
      "photoDepth",
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
        if (Object.hasOwn(item, "hidden") && typeof item.hidden !== "boolean")
          bad(`${p}.hidden`, "expected a boolean");
        if (Object.hasOwn(item, "locked") && typeof item.locked !== "boolean")
          bad(`${p}.locked`, "expected a boolean");
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
    if (Object.hasOwn(scene, "photoDepth"))
      scene.photoDepth = photoDepth(
        scene.photoDepth,
        `${path}.photoDepth`,
        scene,
      );
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
  for (const scene of scenes) {
    visit(scene.nodes);
    if (scene.photoDepth?.mode === "parallax") {
      ids.add(scene.photoDepth.maskAssetId!);
      if (scene.photoDepth.background?.kind === "asset")
        ids.add(scene.photoDepth.background.assetId);
    }
  }
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

export interface EvaluatedPhotoDepth {
  progress: number;
  camera: PhotoDepthCamera;
  foreground: { x: number; y: number; scale: number };
  background: { x: number; y: number; scale: number };
}

/** Pure frame(t) camera interpolation tied to the image node's existing time range. */
export function evaluatePhotoDepthAtTime(
  scene: GraphicScene,
  time: number,
): EvaluatedPhotoDepth | null {
  const recipe = scene.photoDepth;
  if (!recipe || recipe.mode !== "parallax") return null;
  const find = (
    nodes: readonly GraphicNode[],
  ): GraphicImageNode | undefined => {
    for (const node of nodes) {
      if (node.id === recipe.nodeId && node.type === "image") return node;
      if (node.type === "group") {
        const child = find(node.children);
        if (child) return child;
      }
    }
    return undefined;
  };
  const node = find(scene.nodes);
  if (!node) return null;
  numeric(time, "time", 0, Number.MAX_VALUE);
  const elapsed = time - scene.start - node.start;
  if (elapsed < 0 || elapsed >= recipe.duration) return null;
  const progress = graphicEasing(recipe.easing!, elapsed / recipe.duration);
  const interpolate = (from: number, to: number) =>
    (from + (to - from) * progress) * recipe.amplitude!;
  const camera = {
    x: interpolate(recipe.camera!.from.x, recipe.camera!.to.x),
    y: interpolate(recipe.camera!.from.y, recipe.camera!.to.y),
    scale:
      1 +
      interpolate(recipe.camera!.from.scale - 1, recipe.camera!.to.scale - 1),
  };
  const layer = (depth: number) => ({
    x: camera.x * depth,
    y: camera.y * depth,
    scale: 1 + (camera.scale - 1) * depth,
  });
  return {
    progress,
    camera,
    foreground: layer(recipe.foregroundDepth!),
    background: layer(recipe.backgroundDepth!),
  };
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
        if (node.hidden) return [];
        const result: EvaluatedGraphicNode = {
          id: node.id,
          type: node.type,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          opacity: node.opacity,
          rotation: node.rotation ?? 0,
          zIndex: node.zIndex,
          ...(node.locked === undefined ? {} : { locked: node.locked }),
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
            const base = node[key] ?? (key === "rotation" ? 0 : undefined);
            const from = enter.from[key] ?? base;
            if (base !== undefined && from !== undefined)
              result[key] = from + (base - from) * progress;
          }
        } else if (exit && local >= node.end - exit.duration) {
          const progress = graphicEasing(
            exit.easing,
            (local - node.end + exit.duration) / exit.duration,
          );
          for (const key of valueFields) {
            const base = node[key] ?? (key === "rotation" ? 0 : undefined);
            if (base !== undefined)
              result[key] = base + ((exit.to[key] ?? base) - base) * progress;
          }
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
