import type { FrameSize } from "@openfilm/core";

export function nextStableWorkspaceHeight(
  previous: number | undefined,
  next: number,
  threshold = 2,
): number {
  if (!Number.isFinite(next)) return previous ?? 1;
  if (previous === undefined || Math.abs(next - previous) >= threshold)
    return Math.round(next);
  return previous;
}

export function roundFrameDimensions(size: FrameSize): FrameSize {
  return {
    width: Number.isFinite(size.width)
      ? Math.max(1, Math.round(size.width))
      : 1,
    height: Number.isFinite(size.height)
      ? Math.max(1, Math.round(size.height))
      : 1,
  };
}

export function clampFrameStep(
  seconds: number,
  direction: -1 | 1,
  frameRate: number,
  minimum: number,
  maximum: number,
): number {
  const rate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const frame = Math.round(
    (Number.isFinite(seconds) ? seconds : minimum) * rate,
  );
  return Math.max(minimum, Math.min(maximum, (frame + direction) / rate));
}

export function formatTimecode(seconds: number, frameRate: number): string {
  const rate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  let wholeSeconds = Math.floor(time);
  let frame = Math.round((time - wholeSeconds) * rate);
  if (frame >= Math.round(rate)) {
    wholeSeconds++;
    frame = 0;
  }
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;
  return [hours, minutes, secs, frame]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function frameGuideRect(
  viewportWidth: number,
  viewportHeight: number,
  aspectRatio: number,
): FrameSize {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const ratio =
    Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;
  return roundFrameDimensions({
    width: Math.min(width, height * ratio),
    height: Math.min(height, width / ratio),
  });
}

export function shouldSeekHover(
  previous: number | undefined,
  next: number,
  frameRate: number,
): boolean {
  if (previous === undefined || !Number.isFinite(next)) return true;
  const rate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  return Math.abs(next - previous) >= 0.5 / rate;
}

export function playbackBoundaryAction(input: {
  playing: boolean;
  seeking: boolean;
  currentTime: number;
  sourceOut: number | undefined;
  frameRate: number;
  handled: boolean;
  loop: boolean;
}): "ignore" | "continue" | "loop" | "stop" {
  if (
    !input.playing ||
    input.seeking ||
    input.sourceOut === undefined ||
    !Number.isFinite(input.sourceOut) ||
    !Number.isFinite(input.currentTime)
  )
    return "ignore";
  const rate =
    Number.isFinite(input.frameRate) && input.frameRate > 0
      ? input.frameRate
      : 30;
  if (input.currentTime < input.sourceOut - 0.5 / rate) return "continue";
  if (input.handled) return "ignore";
  return input.loop ? "loop" : "stop";
}
