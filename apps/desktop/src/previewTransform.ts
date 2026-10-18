export type Point = { x: number; y: number };

export type PreviewTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

export type TransformCorner = "nw" | "ne" | "se" | "sw";

function finite(value: number, label: string, positive = false): number {
  if (!Number.isFinite(value) || (positive && value <= 0))
    throw new Error(
      `${label} must be ${positive ? "positive and " : ""}finite`,
    );
  return value;
}

function validateTransform(transform: PreviewTransform): PreviewTransform {
  finite(transform.x, "Transform x");
  finite(transform.y, "Transform y");
  finite(transform.scale, "Transform scale", true);
  finite(transform.rotation, "Transform rotation");
  return transform;
}

function validateGesture(
  initial: PreviewTransform,
  delta: Point,
  viewportScale: number,
) {
  validateTransform(initial);
  finite(delta.x, "Delta x");
  finite(delta.y, "Delta y");
  finite(viewportScale, "Viewport scale", true);
}

/** Pointer deltas are viewport CSS pixels; stored translation is composition pixels. */
export function movePreviewTransform(
  initial: PreviewTransform,
  delta: Point,
  viewportScale: number,
): PreviewTransform {
  validateGesture(initial, delta, viewportScale);
  return validateTransform({
    ...initial,
    x: initial.x + delta.x / viewportScale,
    y: initial.y + delta.y / viewportScale,
  });
}

/**
 * Contain-fitted media dimensions are viewport CSS pixels before user scale.
 * Project the gesture onto the rotated media diagonal for proportional scaling,
 * then shift its center by half the diagonal change to anchor the opposite corner.
 */
export function resizePreviewTransform(
  initial: PreviewTransform,
  delta: Point,
  corner: TransformCorner,
  media: { width: number; height: number },
  viewportScale: number,
): PreviewTransform {
  validateGesture(initial, delta, viewportScale);
  finite(media.width, "Media width", true);
  finite(media.height, "Media height", true);
  if (!["nw", "ne", "se", "sw"].includes(corner))
    throw new Error("Transform corner must be nw, ne, se, or sw");

  const radians = ((initial.rotation % 360) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = (corner.endsWith("w") ? -1 : 1) * media.width;
  const y = (corner.startsWith("n") ? -1 : 1) * media.height;
  const diagonal = { x: x * cosine - y * sine, y: x * sine + y * cosine };
  const squaredLength = finite(x * x + y * y, "Media diagonal", true);
  const scale = Math.max(
    0.01,
    initial.scale +
      (delta.x * diagonal.x + delta.y * diagonal.y) / squaredLength,
  );
  const centerShift = (scale - initial.scale) / 2;

  return validateTransform({
    ...initial,
    scale,
    x: initial.x + (diagonal.x * centerShift) / viewportScale,
    y: initial.y + (diagonal.y * centerShift) / viewportScale,
  });
}
