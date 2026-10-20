export const FRAME_BOUNDARY_TOLERANCE_SECONDS = 1e-9;

/** Caption millisecond intervals are half-open, beginning at the next frame. */
export function captionFrameRange(
  startMs: number,
  endMs: number,
  frameRate: number,
): { startFrame: number; endFrame: number } {
  if (
    ![startMs, endMs].every(Number.isSafeInteger) ||
    startMs < 0 ||
    endMs <= startMs
  )
    throw new Error("Caption timing must be increasing integer milliseconds");
  if (!Number.isFinite(frameRate) || frameRate <= 0)
    throw new Error("Frame rate must be positive and finite");
  return {
    startFrame: Math.ceil((startMs * frameRate) / 1000 - 1e-9),
    endFrame: Math.ceil((endMs * frameRate) / 1000 - 1e-9),
  };
}

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
  return (
    Math.floor((duration + FRAME_BOUNDARY_TOLERANCE_SECONDS) * frameRate) /
    frameRate
  );
}
