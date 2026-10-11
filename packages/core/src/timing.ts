/**
 * End of the complete output frames in a composition, in seconds.
 *
 * Keep the renderer's existing one-nanosecond tolerance at frame boundaries.
 * A positive duration shorter than one frame returns zero; callers decide how
 * to report an empty output. This does not alter the editable composition.
 */
export function frameAlignedDuration(
  duration: number,
  frameRate: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("Composition duration must be positive and finite");
  if (!Number.isFinite(frameRate) || frameRate <= 0)
    throw new Error("Frame rate must be positive and finite");
  return Math.floor((duration + 1e-9) * frameRate) / frameRate;
}
