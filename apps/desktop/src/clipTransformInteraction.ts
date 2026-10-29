export type Point = { x: number; y: number };

export type ClipTransformDraft = {
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

function validateTransform(transform: ClipTransformDraft): ClipTransformDraft {
  finite(transform.x, "Transform x");
  finite(transform.y, "Transform y");
  finite(transform.scale, "Transform scale", true);
  finite(transform.rotation, "Transform rotation");
  return transform;
}

function validateGesture(
  initial: ClipTransformDraft,
  delta: Point,
  viewportScale: number,
) {
  validateTransform(initial);
  finite(delta.x, "Delta x");
  finite(delta.y, "Delta y");
  finite(viewportScale, "Viewport scale", true);
}

/** Pointer deltas are viewport CSS pixels; translations are frame pixels. */
export function moveClipTransform(
  initial: ClipTransformDraft,
  delta: Point,
  viewportScale: number,
): ClipTransformDraft {
  validateGesture(initial, delta, viewportScale);
  return validateTransform({
    ...initial,
    x: initial.x + delta.x / viewportScale,
    y: initial.y + delta.y / viewportScale,
  });
}

/**
 * Project a corner gesture onto the rotated media diagonal. Moving the centre
 * by half the diagonal change keeps the opposite corner anchored.
 */
export function resizeClipTransform(
  initial: ClipTransformDraft,
  delta: Point,
  corner: TransformCorner,
  media: { width: number; height: number },
  viewportScale: number,
): ClipTransformDraft {
  validateGesture(initial, delta, viewportScale);
  finite(media.width, "Media width", true);
  finite(media.height, "Media height", true);
  if (!(["nw", "ne", "se", "sw"] as const).includes(corner))
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
  const centreShift = (scale - initial.scale) / 2;

  return validateTransform({
    ...initial,
    scale,
    x: initial.x + (diagonal.x * centreShift) / viewportScale,
    y: initial.y + (diagonal.y * centreShift) / viewportScale,
  });
}
