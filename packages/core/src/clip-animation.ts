// SPDX-License-Identifier: Apache-2.0
import type {
  Clip,
  ClipAnimationEasing,
  ClipAnimationKeyV1,
  ClipAnimationProperty,
  ClipAnimationTrackV1,
  ClipAnimationV1,
  ClipTransform,
  OpenFilmProject,
} from "./models.js";
import { resolveClipFrameRange } from "./sequence.js";
import type { ProjectTimebaseV1 } from "./models.js";

export const CLIP_ANIMATION_PROJECT_SCHEMA_VERSION = "1.4.0" as const;
export const MAX_CLIP_ANIMATION_TRACKS = 5;
export const MAX_CLIP_ANIMATION_KEYS_PER_TRACK = 128;
export const MAX_CLIP_ANIMATION_KEYS = 256;
const MAX_UNBOUNDED_POSITION = 1_000_000;

export interface ClipVisualStateV1 {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new Error(`${path} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string")
      throw new Error(`${path} symbol fields are unsupported`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !("value" in descriptor))
      throw new Error(`${path}.${key} must be own JSON data`);
  }
  return value as Record<string, unknown>;
}

function dataArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new Error(`${path} must be a plain array`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^(0|[1-9]\d*)$/.test(key) ||
      Number(key) >= value.length
    )
      throw new Error(`${path} contains an unsupported array field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !("value" in descriptor))
      throw new Error(`${path}[${key}] must be own JSON data`);
  }
  for (let index = 0; index < value.length; index++)
    if (!Object.hasOwn(value, index))
      throw new Error(`${path}[${index}] is missing`);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`${path}.${key} is unsupported`);
  for (const key of required)
    if (!Object.hasOwn(value, key))
      throw new Error(`${path}.${key} is required`);
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${path} must be finite`);
  return value;
}

function bezier(value: unknown, path: string): ClipAnimationEasing {
  if (value === "hold" || value === "linear") return value;
  const curve = plainObject(value, path);
  exactKeys(
    curve,
    path,
    ["kind", "x1", "y1", "x2", "y2"],
    ["kind", "x1", "y1", "x2", "y2"],
  );
  if (curve.kind !== "cubic-bezier")
    throw new Error(`${path}.kind must be cubic-bezier`);
  const x1 = finite(curve.x1, `${path}.x1`);
  const y1 = finite(curve.y1, `${path}.y1`);
  const x2 = finite(curve.x2, `${path}.x2`);
  const y2 = finite(curve.y2, `${path}.y2`);
  if ([x1, y1, x2, y2].some((coordinate) => coordinate < 0 || coordinate > 1))
    throw new Error(`${path} coordinates must be within 0..1`);
  if (x1 > x2 || y1 > y2)
    throw new Error(`${path} control points must be ordered on both axes`);
  return { kind: "cubic-bezier", x1, y1, x2, y2 };
}

function validateAnimation(
  value: unknown,
  options: { maxFrame?: number; maxPosition?: number } = {},
  copy = true,
): ClipAnimationV1 {
  const root = plainObject(value, "clip.animation");
  exactKeys(
    root,
    "clip.animation",
    ["version", "visualTracks"],
    ["version", "visualTracks"],
  );
  if (root.version !== 1) throw new Error("clip.animation.version must be 1");
  const visualTracks = dataArray(
    root.visualTracks,
    "clip.animation.visualTracks",
  );
  if (
    visualTracks.length < 1 ||
    visualTracks.length > MAX_CLIP_ANIMATION_TRACKS
  )
    throw new Error(
      `clip.animation supports 1..${MAX_CLIP_ANIMATION_TRACKS} visual tracks`,
    );
  const seen = new Set<string>();
  const validatedTracks = copy ? ([] as ClipAnimationTrackV1[]) : undefined;
  let totalKeys = 0;
  visualTracks.forEach((entry, index) => {
    const path = `clip.animation.visualTracks[${index}]`;
    const track = plainObject(entry, path);
    exactKeys(track, path, ["property", "keys"], ["property", "keys"]);
    if (
      !(<string[]>["x", "y", "scale", "rotation", "opacity"]).includes(
        String(track.property),
      )
    )
      throw new Error(`${path}.property is unsupported`);
    const property = track.property as ClipAnimationProperty;
    if (seen.has(property))
      throw new Error(`${path}.property duplicates ${property}`);
    seen.add(property);
    const keys = dataArray(track.keys, `${path}.keys`);
    if (keys.length < 1 || keys.length > MAX_CLIP_ANIMATION_KEYS_PER_TRACK)
      throw new Error(
        `${path}.keys must contain 1..${MAX_CLIP_ANIMATION_KEYS_PER_TRACK} keys`,
      );
    totalKeys += keys.length;
    const validatedKeys = copy ? ([] as ClipAnimationKeyV1[]) : undefined;
    let previous = -1;
    keys.forEach((entryKey, keyIndex) => {
      const keyPath = `${path}.keys[${keyIndex}]`;
      const key = plainObject(entryKey, keyPath);
      exactKeys(
        key,
        keyPath,
        ["frame", "value", "interpolation"],
        ["frame", "value"],
      );
      if (!Number.isSafeInteger(key.frame) || Number(key.frame) < 0)
        throw new Error(`${keyPath}.frame must be a nonnegative safe integer`);
      const frame = Number(key.frame);
      if (frame <= previous)
        throw new Error(`${path}.keys must be strictly ordered`);
      if (options.maxFrame !== undefined && frame > options.maxFrame)
        throw new Error(
          `${keyPath}.frame is outside the visible clip frame range`,
        );
      previous = frame;
      const valueAtKey = finite(key.value, `${keyPath}.value`);
      const maxPosition = options.maxPosition ?? MAX_UNBOUNDED_POSITION;
      const bounds: Record<ClipAnimationProperty, [number, number]> = {
        x: [-maxPosition, maxPosition],
        y: [-maxPosition, maxPosition],
        scale: [0.01, 10],
        rotation: [-3600, 3600],
        opacity: [0, 1],
      };
      const [minimum, maximum] = bounds[property];
      if (valueAtKey < minimum || valueAtKey > maximum)
        throw new Error(`${keyPath}.value is outside the ${property} range`);
      const interpolation =
        key.interpolation === undefined
          ? undefined
          : bezier(key.interpolation, `${keyPath}.interpolation`);
      validatedKeys?.push({
        frame,
        value: valueAtKey,
        ...(interpolation === undefined ? {} : { interpolation }),
      });
    });
    validatedTracks?.push({ property, keys: validatedKeys! });
  });
  if (totalKeys > MAX_CLIP_ANIMATION_KEYS)
    throw new Error(
      `clip.animation supports at most ${MAX_CLIP_ANIMATION_KEYS} keys total`,
    );
  return copy
    ? { version: 1, visualTracks: validatedTracks! }
    : (value as ClipAnimationV1);
}

export function validateClipAnimation(
  value: unknown,
  options: { maxFrame?: number; maxPosition?: number } = {},
): ClipAnimationV1 {
  return validateAnimation(value, options);
}

function cubic(value: number, p1: number, p2: number): number {
  const inverse = 1 - value;
  return (
    3 * inverse * inverse * value * p1 +
    3 * inverse * value * value * p2 +
    value * value * value
  );
}

function solveCubicX(
  curve: Extract<ClipAnimationEasing, { kind: "cubic-bezier" }>,
  x: number,
): number {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2;
    if (cubic(middle, curve.x1, curve.x2) < x) low = middle;
    else high = middle;
  }
  return cubic((low + high) / 2, curve.y1, curve.y2);
}

function evaluateKeys(
  keys: readonly ClipAnimationKeyV1[],
  frame: number,
): number {
  if (frame <= keys[0]!.frame) return keys[0]!.value;
  let low = 1;
  let high = keys.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frame < keys[middle]!.frame) high = middle;
    else low = middle + 1;
  }
  if (frame >= keys[low]!.frame) return keys[low]!.value;

  const from = keys[low - 1]!;
  const to = keys[low]!;
  const easing = from.interpolation ?? "linear";
  if (easing === "hold") return from.value;
  const progress = (frame - from.frame) / (to.frame - from.frame);
  const eased =
    typeof easing === "string" ? progress : solveCubicX(easing, progress);
  return from.value + (to.value - from.value) * eased;
}

/**
 * Capture a validated, immutable track evaluator for renderer frame sampling.
 * The returned function reads only the requested local frame, like the normal
 * sequence resolver, without revalidating the whole project for every sample.
 */
export function createClipAnimationPropertyEvaluator(
  animation: ClipAnimationV1 | undefined,
  property: ClipAnimationProperty,
): ((localFrame: number) => number) | undefined {
  if (!animation) return undefined;
  const validated = validateAnimation(animation);
  const track = validated.visualTracks!.find(
    (candidate) => candidate.property === property,
  );
  if (!track) return undefined;
  return (localFrame: number) => {
    if (!Number.isSafeInteger(localFrame) || localFrame < 0)
      throw new Error(
        "clip-local animation frame must be a nonnegative safe integer",
      );
    return evaluateKeys(track.keys, localFrame);
  };
}

function decimal(value: number): string {
  if (Object.is(value, -0)) return "0";
  return value.toString();
}

function ffmpegCubicY(
  curve: Extract<ClipAnimationEasing, { kind: "cubic-bezier" }>,
  progress: string,
): string {
  const polynomial = (at: string, first: number, second: number) =>
    `3*pow(1-(${at}),2)*(${at})*${decimal(first)}+3*(1-(${at}))*pow((${at}),2)*${decimal(second)}+pow((${at}),3)`;
  const steps: string[] = ["st(0,0)", "0*st(1,1)"];
  for (let index = 0; index < 24; index++) {
    steps.push("0*st(2,(ld(0)+ld(1))/2)");
    steps.push(
      `0*if(lt(${polynomial("ld(2)", curve.x1, curve.x2)},${progress}),st(0,ld(2)),st(1,ld(2)))`,
    );
  }
  return `(${steps.join("+")}+${polynomial("(ld(0)+ld(1))/2", curve.y1, curve.y2)})`;
}

/** Build the renderer's frame expression from validated keys; no FFmpeg code is evaluated by the project. */
export function clipAnimationFfmpegExpression(
  animation: ClipAnimationV1 | undefined,
  property: ClipAnimationProperty,
  baseValue: number,
  frameExpression = "n",
): string {
  if (!Number.isFinite(baseValue)) throw new Error("base value must be finite");
  if (!animation) return decimal(baseValue);
  const track = validateAnimation(animation).visualTracks!.find(
    (candidate) => candidate.property === property,
  );
  if (!track) return decimal(baseValue);
  const keys = track.keys;
  let expression = decimal(keys.at(-1)!.value);
  for (let index = keys.length - 2; index >= 0; index--) {
    const from = keys[index]!;
    const to = keys[index + 1]!;
    const interpolation = from.interpolation ?? "linear";
    const progress = `((${frameExpression}-${from.frame})/${to.frame - from.frame})`;
    const eased =
      interpolation === "hold"
        ? "0"
        : interpolation === "linear"
          ? progress
          : ffmpegCubicY(interpolation, progress);
    const value =
      interpolation === "hold"
        ? decimal(from.value)
        : `(${decimal(from.value)}+(${decimal(to.value - from.value)})*(${eased}))`;
    expression = `if(lt(${frameExpression},${to.frame}),${value},${expression})`;
  }
  return `if(lt(${frameExpression},${keys[0]!.frame}),${decimal(keys[0]!.value)},${expression})`;
}

export function evaluateClipVisualAnimation(
  animation: ClipAnimationV1 | undefined,
  localFrame: number,
  base: Partial<Pick<ClipTransform, "x" | "y" | "scale" | "rotation">> = {},
): ClipVisualStateV1 {
  if (!Number.isSafeInteger(localFrame) || localFrame < 0)
    throw new Error(
      "clip-local animation frame must be a nonnegative safe integer",
    );
  const baseState: ClipVisualStateV1 = {
    x: base.x ?? 0,
    y: base.y ?? 0,
    scale: base.scale ?? 1,
    rotation: base.rotation ?? 0,
    opacity: 1,
  };
  if (!animation) return baseState;
  const valid = validateAnimation(animation, {}, false);
  for (const track of valid.visualTracks ?? [])
    baseState[track.property] = evaluateKeys(track.keys, localFrame);
  return baseState;
}

function splitBezier(
  easing: ClipAnimationEasing | undefined,
  progress: number,
): { left?: ClipAnimationEasing; right?: ClipAnimationEasing } {
  if (typeof easing !== "object" || easing === null) return {};
  const curve = easing;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2;
    if (cubic(middle, curve.x1, curve.x2) < progress) low = middle;
    else high = middle;
  }
  const t = (low + high) / 2;
  const p0 = { x: 0, y: 0 };
  const p1 = { x: curve.x1, y: curve.y1 };
  const p2 = { x: curve.x2, y: curve.y2 };
  const p3 = { x: 1, y: 1 };
  const mix = (a: typeof p0, b: typeof p0, at: number) => ({
    x: a.x + (b.x - a.x) * at,
    y: a.y + (b.y - a.y) * at,
  });
  const a = mix(p0, p1, t),
    b = mix(p1, p2, t),
    c = mix(p2, p3, t);
  const d = mix(a, b, t),
    e = mix(b, c, t),
    middle = mix(d, e, t);
  const normalize = (point: typeof p0, start: typeof p0, end: typeof p0) => ({
    x1: (point.x - start.x) / (end.x - start.x),
    y1: (point.y - start.y) / (end.y - start.y),
  });
  const left1 = normalize(a, p0, middle),
    left2 = normalize(d, p0, middle);
  const right1 = normalize(e, middle, p3),
    right2 = normalize(c, middle, p3);
  const safe = (value: number) => Math.max(0, Math.min(1, value));
  return {
    left: {
      kind: "cubic-bezier",
      x1: safe(left1.x1),
      y1: safe(left1.y1),
      x2: safe(left2.x1),
      y2: safe(left2.y1),
    },
    right: {
      kind: "cubic-bezier",
      x1: safe(right1.x1),
      y1: safe(right1.y1),
      x2: safe(right2.x1),
      y2: safe(right2.y1),
    },
  };
}

function prefixKeys(
  keys: readonly ClipAnimationKeyV1[],
  endFrame: number,
): ClipAnimationKeyV1[] {
  const exact = keys.find((key) => key.frame === endFrame);
  const before = [...keys].reverse().find((key) => key.frame < endFrame);
  const after = keys.find((key) => key.frame > endFrame);
  const result = keys
    .filter((key) => key.frame < endFrame)
    .map((key) => ({ ...key }));
  if (exact) return [...result, { ...exact }];
  const value = evaluateKeys(keys, endFrame);
  let interpolation: ClipAnimationEasing = "hold";
  if (before && after) {
    const original = before.interpolation ?? "linear";
    if (typeof original === "object") {
      const progress = (endFrame - before.frame) / (after.frame - before.frame);
      interpolation = splitBezier(original, progress).left ?? "linear";
    } else interpolation = original;
  }
  if (result.at(-1)?.frame === endFrame)
    result[result.length - 1] = { frame: endFrame, value, interpolation };
  else result.push({ frame: endFrame, value, interpolation });
  if (!result.length) result.push({ frame: 0, value });
  return result;
}

function suffixKeys(
  keys: readonly ClipAnimationKeyV1[],
  startFrame: number,
): ClipAnimationKeyV1[] {
  const exact = keys.find((key) => key.frame === startFrame);
  if (exact)
    return keys
      .filter((key) => key.frame >= startFrame)
      .map((key) => ({ ...key, frame: key.frame - startFrame }));
  const before = [...keys].reverse().find((key) => key.frame < startFrame);
  const after = keys.find((key) => key.frame > startFrame);
  const value = evaluateKeys(keys, startFrame);
  const original = before ? (before.interpolation ?? "linear") : "hold";
  let interpolation = original;
  if (before && after && typeof original === "object") {
    const progress = (startFrame - before.frame) / (after.frame - before.frame);
    interpolation = splitBezier(original, progress).right ?? "linear";
  }
  const rest = keys
    .filter((key) => key.frame > startFrame)
    .map((key) => ({ ...key, frame: key.frame - startFrame }));
  return [{ frame: 0, value, interpolation }, ...rest];
}

export function splitClipAnimationAtFrame(
  animation: ClipAnimationV1 | undefined,
  splitFrame: number,
  totalFrames: number,
): { left?: ClipAnimationV1; right?: ClipAnimationV1 } {
  if (!animation) return {};
  if (
    !Number.isSafeInteger(splitFrame) ||
    splitFrame <= 0 ||
    splitFrame >= totalFrames
  )
    throw new Error("split frame must create two nonempty visible clip ranges");
  const valid = validateAnimation(animation, { maxFrame: totalFrames - 1 });
  const split = (side: "left" | "right") => ({
    version: 1 as const,
    visualTracks: valid.visualTracks!.map((track) => ({
      property: track.property,
      keys:
        side === "left"
          ? prefixKeys(track.keys, splitFrame - 1)
          : suffixKeys(track.keys, splitFrame),
    })),
  });
  return {
    left: validateAnimation(split("left"), { maxFrame: splitFrame - 1 }),
    right: validateAnimation(split("right"), {
      maxFrame: totalFrames - splitFrame - 1,
    }),
  };
}

export function trimClipAnimationToFrameCount(
  animation: ClipAnimationV1 | undefined,
  frameCount: number,
): ClipAnimationV1 | undefined {
  if (!animation) return undefined;
  if (!Number.isSafeInteger(frameCount) || frameCount < 1)
    throw new Error("trimmed clip must retain at least one output frame");
  const valid = validateAnimation(animation);
  return validateAnimation(
    {
      version: 1,
      visualTracks: valid.visualTracks!.map((track) => ({
        property: track.property,
        keys: prefixKeys(track.keys, frameCount - 1),
      })),
    },
    { maxFrame: frameCount - 1 },
  );
}

export function promoteClipAnimationProject(
  project: OpenFilmProject,
): OpenFilmProject {
  const next = structuredClone(project);
  const hasAnimation = next.timelines.some((composition) =>
    composition.tracks.some((track) =>
      track.clips.some((clip) => clip.animation),
    ),
  );
  if (hasAnimation) {
    const current = next.schemaVersion.split(".").map(Number);
    const target = CLIP_ANIMATION_PROJECT_SCHEMA_VERSION.split(".").map(Number);
    const older = current.some(
      (part, index) =>
        part < target[index]! &&
        current
          .slice(0, index)
          .every((prefix, prefixIndex) => prefix === target[prefixIndex]),
    );
    if (older) next.schemaVersion = CLIP_ANIMATION_PROJECT_SCHEMA_VERSION;
  }
  return next;
}

export function clipAnimationMaxFrame(
  clip: Clip,
  timebase: ProjectTimebaseV1,
): number {
  const range = resolveClipFrameRange(clip, timebase);
  return range.endFrame - range.startFrame - 1;
}
