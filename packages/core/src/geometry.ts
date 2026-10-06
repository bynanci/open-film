import type { ClipTransform } from "./models.js";

/**
 * Stable visual-geometry contract shared by interactive previews and renderers.
 *
 * Coordinates live in composition-frame pixels with the origin at frame center:
 * +x moves right and +y moves down. Source media is first fit with "contain",
 * then user scale and clockwise rotation are applied about the media center,
 * then x/y translation is applied. The composed result is clipped by the frame.
 */
export const CLIP_GEOMETRY_CONTRACT_VERSION = "1.0.0" as const;

export interface FrameSize {
  width: number;
  height: number;
}

export interface ResolvedClipGeometry {
  scale: number;
  rotation: number;
  x: number;
  y: number;
}

export interface FittedFrame {
  scale: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

function finite(value: number, label: string, positive = false): number {
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0))
    throw new Error(
      `${label} must be ${positive ? "positive" : "nonnegative"} and finite`,
    );
  return value;
}

function dimension(value: number, label: string): number {
  return finite(value, label, true);
}

export function resolveClipGeometry(
  transform?: Pick<ClipTransform, "scale" | "rotation" | "x" | "y">,
): ResolvedClipGeometry {
  const scale = transform?.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("Geometry scale must be positive and finite");
  const rotation = transform?.rotation ?? 0;
  const x = transform?.x ?? 0;
  const y = transform?.y ?? 0;
  for (const [label, value] of [
    ["rotation", rotation],
    ["x", x],
    ["y", y],
  ] as const)
    if (!Number.isFinite(value))
      throw new Error(`Geometry ${label} must be finite`);
  return { scale, rotation, x, y };
}

export function fitFrameToViewport(
  frame: FrameSize,
  viewport: FrameSize,
): FittedFrame {
  const frameWidth = dimension(frame.width, "Frame width");
  const frameHeight = dimension(frame.height, "Frame height");
  const viewportWidth = dimension(viewport.width, "Viewport width");
  const viewportHeight = dimension(viewport.height, "Viewport height");
  const scale = Math.min(
    viewportWidth / frameWidth,
    viewportHeight / frameHeight,
  );
  const width = frameWidth * scale;
  const height = frameHeight * scale;
  return {
    scale,
    width,
    height,
    offsetX: (viewportWidth - width) / 2,
    offsetY: (viewportHeight - height) / 2,
  };
}

/** Convert frame-space x/y offsets into the fitted preview viewport. */
export function geometryTranslationForViewport(
  transform: Pick<ClipTransform, "scale" | "rotation" | "x" | "y"> | undefined,
  frame: FrameSize,
  viewport: FrameSize,
): { x: number; y: number; frame: FittedFrame } {
  const geometry = resolveClipGeometry(transform);
  const fitted = fitFrameToViewport(frame, viewport);
  return {
    x: geometry.x * fitted.scale,
    y: geometry.y * fitted.scale,
    frame: fitted,
  };
}
