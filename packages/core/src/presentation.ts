import type { FrameSize } from "./geometry.js";
import type {
  AudioAutomation,
  Clip,
  PhotoLayout,
  PhotoMotionTransform,
  PhotoProtectedRegion,
  MediaAsset,
  PhotoEasing,
} from "./models.js";
import { evaluatePhotoEasing } from "./photo-easing.js";
import {
  validateAudioAutomation,
  validatePhotoLayout,
  validatePhotoMotion,
} from "./validation.js";

export interface PhotoLayer {
  assetId: string;
  /** Full decoded image rectangle in composition pixels; clipped by the frame. */
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PhotoPlan {
  layers: PhotoLayer[];
  motion: {
    from: PhotoMotionTransform;
    to: PhotoMotionTransform;
    easing: PhotoEasing;
  };
  warnings: string[];
  ambient?: PhotoAmbientPlan;
}
export interface PhotoAmbientLayer {
  assetId: string;
  cell: { x: number; y: number; width: number; height: number };
  cover: PhotoLayer;
}
export interface PhotoAmbientPlan {
  version: 1;
  layers: PhotoAmbientLayer[];
  sigma: number;
  dim: number;
}
type PresentationClip = Pick<
  Clip,
  "assetId" | "layout" | "motion" | "timelineDuration" | "transform"
>;
const identity = (): PhotoMotionTransform => ({ scale: 1, x: 0, y: 0 });
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Browser-safe dimensions after source pixel aspect and display orientation. */
export function assetDisplayDimensions(
  asset: Pick<MediaAsset, "dimensions" | "metadata">,
): FrameSize | undefined {
  const display = record(asset.metadata["openfilm.display"]);
  if (
    display?.version === 1 &&
    typeof display.width === "number" &&
    typeof display.height === "number" &&
    Number.isFinite(display.width) &&
    Number.isFinite(display.height) &&
    display.width > 0 &&
    display.height > 0
  )
    return { width: display.width, height: display.height };
  const raw = asset.dimensions;
  if (
    !raw ||
    !Number.isFinite(raw.width) ||
    !Number.isFinite(raw.height) ||
    raw.width <= 0 ||
    raw.height <= 0
  )
    return undefined;
  const probe = record(asset.metadata["openfilm.ffprobe"]);
  const streams = Array.isArray(probe?.streams)
    ? probe.streams
        .map(record)
        .filter((value): value is Record<string, unknown> => !!value)
    : [];
  const stream =
    streams.find((value) => value.codec_type === "video") ?? streams[0];
  const frames = Array.isArray(probe?.frames)
    ? probe.frames
        .map(record)
        .filter((value): value is Record<string, unknown> => !!value)
    : [];
  const firstFrame = frames[0];
  const aspect = String(
    stream?.sample_aspect_ratio ?? firstFrame?.sample_aspect_ratio ?? "1:1",
  )
    .split(":")
    .map(Number);
  const sar =
    aspect.length === 2 &&
    Number.isFinite(aspect[0]) &&
    Number.isFinite(aspect[1]) &&
    aspect[0]! > 0 &&
    aspect[1]! > 0
      ? aspect[0]! / aspect[1]!
      : 1;
  let width = raw.width * sar;
  let height = raw.height;
  const exif = record(asset.metadata["openfilm.exif"]);
  const orientation = Number(
    exif?.Orientation ?? record(firstFrame?.tags)?.Orientation,
  );
  let swap =
    Number.isInteger(orientation) && orientation >= 5 && orientation <= 8;
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) {
    const sideData = [
      ...(Array.isArray(firstFrame?.side_data_list)
        ? firstFrame.side_data_list
        : []),
      ...(Array.isArray(stream?.side_data_list) ? stream.side_data_list : []),
    ];
    const rotationValue =
      sideData.map(record).find((value) => typeof value?.rotation === "number")
        ?.rotation ?? record(stream?.tags)?.rotate;
    const rotation = Number(rotationValue);
    swap =
      Number.isFinite(rotation) &&
      Math.abs((((rotation % 180) + 180) % 180) - 90) < 1e-6;
  }
  if (swap) [width, height] = [height, width];
  return Number.isFinite(width) && Number.isFinite(height)
    ? { width, height }
    : undefined;
}

function dimensions(value: FrameSize | undefined, label: string): FrameSize {
  if (
    !value ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height) ||
    value.width <= 0 ||
    value.height <= 0
  )
    throw new Error(`${label} requires positive finite display dimensions`);
  return value;
}

function placePhoto(
  assetId: string,
  source: FrameSize,
  cell: PhotoLayer,
  layout: Pick<PhotoLayout, "preset" | "focalPoint" | "protectedRegion">,
  warnings: string[],
): PhotoLayer {
  const contain = () => {
    const scale = Math.min(
      cell.width / source.width,
      cell.height / source.height,
    );
    const width = source.width * scale;
    const height = source.height * scale;
    return {
      assetId,
      width,
      height,
      x: cell.x + (cell.width - width) / 2,
      y: cell.y + (cell.height - height) / 2,
    };
  };
  if (layout.preset !== "hero") return contain();
  const scale = Math.max(
    cell.width / source.width,
    cell.height / source.height,
  );
  const width = source.width * scale;
  const height = source.height * scale;
  const region = layout.protectedRegion;
  if (
    region &&
    (region.width * width > cell.width + 1e-7 ||
      region.height * height > cell.height + 1e-7)
  ) {
    warnings.push("PHOTO_PROTECTED_REGION_CONTAIN_FALLBACK");
    return contain();
  }
  const focal = layout.focalPoint ?? { x: 0.5, y: 0.5 };
  const minX = Math.max(
    cell.width - width,
    region ? -region.x * width : -Infinity,
  );
  const maxX = Math.min(
    0,
    region ? cell.width - (region.x + region.width) * width : Infinity,
  );
  const minY = Math.max(
    cell.height - height,
    region ? -region.y * height : -Infinity,
  );
  const maxY = Math.min(
    0,
    region ? cell.height - (region.y + region.height) * height : Infinity,
  );
  return {
    assetId,
    width,
    height,
    x: cell.x + clamp(cell.width / 2 - focal.x * width, minX, maxX),
    y: cell.y + clamp(cell.height / 2 - focal.y * height, minY, maxY),
  };
}

/** Resolve once for both browser and renderer; unsupported source data fails explicitly. */
export function resolvePhotoPlan(
  clip: PresentationClip,
  sources: Record<string, FrameSize>,
  frame: FrameSize,
): PhotoPlan {
  dimensions(frame, "Composition frame");
  const source = dimensions(sources[clip.assetId], `Photo ${clip.assetId}`);
  const layout = clip.layout ? validatePhotoLayout(clip.layout) : undefined;
  const warnings: string[] = [];
  const whole = { assetId: clip.assetId, x: 0, y: 0, ...frame };
  const layers: PhotoLayer[] = [];
  const cells: PhotoLayer[] = [];
  const regions: (PhotoProtectedRegion | undefined)[] = [];
  if (layout?.preset === "diptych") {
    const gap = layout.gap ?? 32;
    if (gap >= frame.width)
      throw new Error(
        "Photo diptych gap must be smaller than the composition width",
      );
    const width = (frame.width - gap) / 2;
    const secondary = layout.secondary!;
    cells.push(
      { ...whole, width },
      { ...whole, assetId: secondary.assetId, x: width + gap, width },
    );
    layers.push(
      placePhoto(
        clip.assetId,
        source,
        { ...whole, width },
        { ...layout, preset: "contain" },
        warnings,
      ),
    );
    layers.push(
      placePhoto(
        secondary.assetId,
        dimensions(sources[secondary.assetId], `Photo ${secondary.assetId}`),
        { ...whole, assetId: secondary.assetId, x: width + gap, width },
        { preset: "contain", ...secondary },
        warnings,
      ),
    );
    regions.push(layout.protectedRegion, secondary.protectedRegion);
  } else {
    cells.push(whole);
    layers.push(
      placePhoto(
        clip.assetId,
        source,
        whole,
        layout ?? { preset: "contain" },
        warnings,
      ),
    );
    regions.push(layout?.protectedRegion);
  }
  const recipe = clip.motion ? validatePhotoMotion(clip.motion) : undefined;
  let motion: PhotoPlan["motion"] = recipe
    ? {
        from: { ...recipe.from },
        to: { ...(recipe.preset === "hold" ? recipe.from : recipe.to) },
        easing: recipe.easing,
      }
    : { from: identity(), to: identity(), easing: "linear" };
  // Keep the camera within the zoomed canvas in both adapters. Resolve this
  // before either adapter sees the recipe so unsupported framing is explicit.
  const outOfBounds = [motion.from, motion.to].some(
    (transform) =>
      Math.abs(transform.x) >
        (frame.width * (transform.scale - 1)) / 2 + 1e-7 ||
      Math.abs(transform.y) > (frame.height * (transform.scale - 1)) / 2 + 1e-7,
  );
  if (outOfBounds) {
    motion = { from: identity(), to: identity(), easing: "linear" };
    warnings.push("PHOTO_MOTION_BOUNDS_HOLD");
  }
  const map = (
    point: number,
    midpoint: number,
    scale: number,
    offset: number,
  ) => midpoint + (point - midpoint) * scale + offset;
  // Positive scale and monotonic interpolation make endpoint bounds sufficient:
  // every intermediate protected corner is a convex combination of endpoints.
  const unsafe = [motion.from, motion.to].some((transform) =>
    layers.some((layer, index) => {
      const region = regions[index];
      const left = map(
        layer.x + (region?.x ?? 0) * layer.width,
        frame.width / 2,
        transform.scale,
        transform.x,
      );
      const right = map(
        layer.x + ((region?.x ?? 0) + (region?.width ?? 1)) * layer.width,
        frame.width / 2,
        transform.scale,
        transform.x,
      );
      const top = map(
        layer.y + (region?.y ?? 0) * layer.height,
        frame.height / 2,
        transform.scale,
        transform.y,
      );
      const bottom = map(
        layer.y + ((region?.y ?? 0) + (region?.height ?? 1)) * layer.height,
        frame.height / 2,
        transform.scale,
        transform.y,
      );
      return region
        ? left < -1e-7 ||
            top < -1e-7 ||
            right > frame.width + 1e-7 ||
            bottom > frame.height + 1e-7
        : right <= 0 ||
            bottom <= 0 ||
            left >= frame.width ||
            top >= frame.height;
    }),
  );
  if (unsafe) {
    motion = { from: identity(), to: identity(), easing: "linear" };
    warnings.push(
      regions.some(Boolean)
        ? "PHOTO_MOTION_PROTECTED_REGION_HOLD"
        : "PHOTO_MOTION_OUT_OF_FRAME_HOLD",
    );
  }
  const legacy = clip.transform;
  if (legacy && regions.some(Boolean)) {
    const scale = legacy.scale ?? 1;
    const rotation = ((legacy.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const outside = [motion.from, motion.to].some((transform) =>
      layers.some((layer, index) => {
        const region = regions[index];
        if (!region) return false;
        return [region.x, region.x + region.width].some((x) =>
          [region.y, region.y + region.height].some((y) => {
            const motionX =
              map(
                layer.x + x * layer.width,
                frame.width / 2,
                transform.scale,
                transform.x,
              ) -
              frame.width / 2;
            const motionY =
              map(
                layer.y + y * layer.height,
                frame.height / 2,
                transform.scale,
                transform.y,
              ) -
              frame.height / 2;
            const outputX =
              frame.width / 2 +
              (motionX * cos - motionY * sin) * scale +
              (legacy.x ?? 0);
            const outputY =
              frame.height / 2 +
              (motionX * sin + motionY * cos) * scale +
              (legacy.y ?? 0);
            return (
              outputX < -1e-7 ||
              outputY < -1e-7 ||
              outputX > frame.width + 1e-7 ||
              outputY > frame.height + 1e-7
            );
          }),
        );
      }),
    );
    if (outside) warnings.push("PHOTO_STATIC_TRANSFORM_PROTECTED_REGION");
  }
  const ambient: PhotoAmbientPlan | undefined =
    layout?.version === 2
      ? {
          version: 1,
          sigma: layout.fill.blurSigma * Math.min(frame.width, frame.height),
          dim: layout.fill.dim,
          layers: cells.map((cell) => {
            if (
              !Number.isInteger(frame.width) ||
              !Number.isInteger(frame.height)
            )
              throw new Error(
                "Photo ambient frame requires integer pixel dimensions",
              );
            const x = Math.round(cell.x),
              y = Math.round(cell.y);
            const width = Math.round(cell.x + cell.width) - x;
            const height = Math.round(cell.y + cell.height) - y;
            if (width < 1 || height < 1)
              throw new Error(
                "Photo ambient cells require at least one output pixel",
              );
            const bounds = { x, y, width, height };
            return {
              assetId: cell.assetId,
              cell: bounds,
              cover: placePhoto(
                cell.assetId,
                dimensions(sources[cell.assetId], `Photo ${cell.assetId}`),
                { assetId: cell.assetId, ...bounds },
                { preset: "hero" },
                [],
              ),
            };
          }),
        }
      : undefined;
  return { layers, motion, warnings, ...(ambient ? { ambient } : {}) };
}

/** Time is local timeline seconds; source trim/speed never changes the motion clock. */
export function evaluateClipAtTime(
  clip: PresentationClip,
  localTime: number,
  sources: Record<string, FrameSize>,
  frame: FrameSize,
): PhotoPlan & { transform: PhotoMotionTransform } {
  if (!Number.isFinite(localTime))
    throw new Error("Photo sample time must be finite");
  if (!Number.isFinite(clip.timelineDuration) || clip.timelineDuration <= 0)
    throw new Error("Photo duration must be positive and finite");
  const plan = resolvePhotoPlan(clip, sources, frame);
  const progress = clamp(localTime / clip.timelineDuration, 0, 1);
  const eased = evaluatePhotoEasing(plan.motion.easing, progress);
  const interpolate = (key: keyof PhotoMotionTransform) =>
    plan.motion.from[key] +
    (plan.motion.to[key] - plan.motion.from[key]) * eased;
  return {
    ...plan,
    transform: {
      scale: interpolate("scale"),
      x: interpolate("x"),
      y: interpolate("y"),
    },
  };
}

/** Linear clip-local gain automation, shared by sound preview and final rendering. */
export function evaluateAudioGain(
  automation: AudioAutomation | undefined,
  time: number,
  duration: number,
): number {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0)
    throw new Error("Audio sample time and positive duration must be finite");
  if (!automation) return 1;
  const value = validateAudioAutomation(automation, duration);
  const local = clamp(time, 0, duration);
  const points = value.points ?? [];
  let gain = 1;
  if (points.length) {
    gain = points[0]!.gain;
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1]!;
      const next = points[index]!;
      if (local < next.time) {
        gain =
          previous.gain +
          (next.gain - previous.gain) *
            clamp((local - previous.time) / (next.time - previous.time), 0, 1);
        break;
      }
      gain = next.gain;
    }
  }
  if (value.fadeIn) gain *= clamp(local / value.fadeIn, 0, 1);
  if (value.fadeOut) gain *= clamp((duration - local) / value.fadeOut, 0, 1);
  for (const duck of value.ducking ?? []) {
    if (local < duck.start || local >= duck.end) continue;
    let amount = duck.gain;
    if (duck.attack && local < duck.start + duck.attack)
      amount = 1 + (duck.gain - 1) * ((local - duck.start) / duck.attack);
    else if (duck.release && local > duck.end - duck.release)
      amount =
        duck.gain +
        (1 - duck.gain) * ((local - (duck.end - duck.release)) / duck.release);
    gain *= amount;
  }
  return clamp(gain, 0, 1);
}
