import {
  resolveClipGeometry,
  type Clip,
  type FrameSize,
  type PhotoFocalPoint,
  type PhotoLayer,
  type PhotoMotionTransform,
} from "@openfilm/core";

export interface PhotoFocalGeometry {
  sourceToViewport: readonly [number, number, number, number, number, number];
  rect: { left: number; top: number; width: number; height: number };
}
export function resolvePhotoFocalGeometry(
  layer: PhotoLayer,
  motion: PhotoMotionTransform,
  transform: Clip["transform"],
  frame: FrameSize,
  rect: PhotoFocalGeometry["rect"],
): PhotoFocalGeometry {
  const geometry = resolveClipGeometry(transform);
  const angle = (geometry.rotation * Math.PI) / 180;
  const c = Math.cos(angle) * geometry.scale,
    s = Math.sin(angle) * geometry.scale;
  const sx = rect.width / frame.width,
    sy = rect.height / frame.height;
  const x =
    frame.width / 2 + (layer.x - frame.width / 2) * motion.scale + motion.x;
  const y =
    frame.height / 2 + (layer.y - frame.height / 2) * motion.scale + motion.y;
  return {
    rect: { ...rect },
    sourceToViewport: [
      c * layer.width * motion.scale * sx,
      s * layer.width * motion.scale * sy,
      -s * layer.height * motion.scale * sx,
      c * layer.height * motion.scale * sy,
      rect.left +
        (frame.width / 2 +
          c * (x - frame.width / 2) -
          s * (y - frame.height / 2) +
          Math.round(geometry.x)) *
          sx,
      rect.top +
        (frame.height / 2 +
          s * (x - frame.width / 2) +
          c * (y - frame.height / 2) +
          Math.round(geometry.y)) *
          sy,
    ],
  };
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
function inverse(
  point: PhotoFocalPoint,
  geometry: PhotoFocalGeometry,
  delta: boolean,
): PhotoFocalPoint | null {
  const [a, b, c, d, e, f] = geometry.sourceToViewport;
  const determinant = a * d - b * c;
  if (
    ![point.x, point.y, a, b, c, d, e, f, determinant].every(Number.isFinite) ||
    Math.abs(determinant) < 1e-12
  )
    return null;
  const x = point.x - (delta ? 0 : e),
    y = point.y - (delta ? 0 : f);
  return { x: (d * x - c * y) / determinant, y: (a * y - b * x) / determinant };
}
export function photoFocalPointAtViewport(
  point: PhotoFocalPoint,
  geometry: PhotoFocalGeometry,
): PhotoFocalPoint | null {
  const result = inverse(point, geometry, false);
  return result ? { x: clamp(result.x), y: clamp(result.y) } : null;
}
export function photoFocalPointFromDelta(
  initial: PhotoFocalPoint,
  delta: PhotoFocalPoint,
  geometry: PhotoFocalGeometry,
): PhotoFocalPoint | null {
  const result = inverse(delta, geometry, true);
  if (!result || !Number.isFinite(initial.x) || !Number.isFinite(initial.y))
    return null;
  return { x: clamp(initial.x + result.x), y: clamp(initial.y + result.y) };
}
