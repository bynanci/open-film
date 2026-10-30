import type { PhotoEasing } from "./models.js";
import { validatePhotoEasing } from "./validation.js";

export const PHOTO_BEZIER_BISECTION_STEPS = 24;

/** Fixed endpoints and ordered bounded handles keep protected endpoint checks valid. */
export function evaluatePhotoEasing(
  easing: PhotoEasing,
  progress: number,
): number {
  if (!Number.isFinite(progress))
    throw new Error("Photo progress must be finite");
  const value = validatePhotoEasing(easing);
  const p = Math.max(0, Math.min(1, progress));
  if (p === 0 || p === 1 || value === "linear") return p;
  if (value === "ease-in-out") return p * p * (3 - 2 * p);
  const bezier = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let lower = 0;
  let upper = 1;
  for (let step = 0; step < PHOTO_BEZIER_BISECTION_STEPS; step++) {
    const middle = (lower + upper) / 2;
    if (bezier(middle, value.x1, value.x2) < p) lower = middle;
    else upper = middle;
  }
  return bezier((lower + upper) / 2, value.y1, value.y2);
}
