import type { TitleStyle } from "./models.js";

type FadeStyle = Pick<TitleStyle, "fadeIn" | "fadeOut"> | undefined;

/** Integer fade lengths shared by native rendering and timeline preview. */
export function resolveTitleFadeFrames(
  style: FadeStyle,
  duration: number,
  frameRate: number,
): { fadeInFrames: number; fadeOutFrames: number; frameCount: number } {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("Title duration must be positive and finite.");
  if (!Number.isFinite(frameRate) || frameRate <= 0)
    throw new Error("Title frame rate must be positive and finite.");
  const requested = (seconds: number | undefined): number => {
    const value = seconds ?? 0;
    if (!Number.isFinite(value) || value < 0 || value > 10)
      throw new Error("Title fades must be between zero and ten seconds.");
    const frames = Math.round(value * frameRate);
    if (!Number.isSafeInteger(frames))
      throw new Error("Title fade frame count is too large.");
    return frames;
  };
  let fadeInFrames = requested(style?.fadeIn);
  let fadeOutFrames = requested(style?.fadeOut);
  // Match the renderer's one-nanosecond tolerance at the final output tick.
  const frameCount = Math.max(1, Math.ceil((duration - 1e-9) * frameRate));
  if (!Number.isSafeInteger(frameCount))
    throw new Error("Title frame count is too large.");
  const available = frameCount - 1;
  if (fadeInFrames + fadeOutFrames > available) {
    // One peak frame remains fully visible. Round the incoming share first;
    // the outgoing share receives the remainder, including two-frame clips.
    fadeInFrames = Math.round(
      (fadeInFrames / (fadeInFrames + fadeOutFrames)) * available,
    );
    fadeOutFrames = available - fadeInFrames;
  }
  return { fadeInFrames, fadeOutFrames, frameCount };
}

/** Evaluate local timeline time, never unadjusted source trim/speed time. */
export function titleOpacityAtTime(
  style: FadeStyle,
  localTimelineTime: number,
  duration: number,
  frameRate: number,
): number {
  const { fadeInFrames, fadeOutFrames, frameCount } = resolveTitleFadeFrames(
    style,
    duration,
    frameRate,
  );
  if (
    !Number.isFinite(localTimelineTime) ||
    localTimelineTime < 0 ||
    localTimelineTime >= duration
  )
    return 0;
  const frame = Math.min(
    frameCount - 1,
    Math.floor((localTimelineTime + 1e-9) * frameRate),
  );
  const incoming = fadeInFrames ? Math.min(1, frame / fadeInFrames) : 1;
  const outgoing = fadeOutFrames
    ? Math.min(1, (frameCount - 1 - frame) / fadeOutFrames)
    : 1;
  return Math.min(incoming, outgoing);
}
