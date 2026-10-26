import type { FrameSize } from "@openfilm/core";

const shuttleTiers = [-4, -2, -1, 0, 1, 2, 4] as const;
export function nextShuttleTier(tier: number, direction: -1 | 1): number {
  const index = Math.max(
    0,
    shuttleTiers.indexOf(tier as (typeof shuttleTiers)[number]),
  );
  return shuttleTiers[
    Math.max(0, Math.min(shuttleTiers.length - 1, index + direction))
  ]!;
}

/** Check isolation before claiming or cancelling any Source shortcut. */
export function ownsSourceShortcut(event: KeyboardEvent): boolean {
  if (
    event.isComposing ||
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return false;
  const target = event.target as Element | null;
  return (
    !document.querySelector('[aria-modal="true"], dialog[open]') &&
    !target?.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .runtime-drafts, .pipeline-workbench-root, [data-shortcut-isolation]',
    )
  );
}

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

export function mapFramePixelOffsetToViewport(
  viewportOffset: number,
  frameScale: number,
): number {
  if (
    !Number.isFinite(viewportOffset) ||
    !Number.isFinite(frameScale) ||
    frameScale <= 0
  )
    return 0;
  return Math.round(viewportOffset / frameScale) * frameScale;
}

export function clampFrameStep(
  seconds: number,
  direction: -1 | 1,
  frameRate: number,
  minimum: number,
  maximum: number,
): number {
  const rate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const position = (Number.isFinite(seconds) ? seconds : minimum) * rate;
  const epsilon = 1e-6;
  const frame =
    direction > 0
      ? Math.floor(position + epsilon) + 1
      : Math.ceil(position - epsilon) - 1;
  return Math.max(minimum, Math.min(maximum, frame / rate));
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

export function restartTimeAtClipBoundary(input: {
  boundaryHandled: boolean;
  currentTime: number;
  sourceIn: number;
  sourceOut: number | undefined;
  frameRate: number;
}): number | undefined {
  if (
    !input.boundaryHandled ||
    input.sourceOut === undefined ||
    !Number.isFinite(input.sourceOut) ||
    !Number.isFinite(input.currentTime) ||
    !Number.isFinite(input.sourceIn)
  )
    return undefined;
  const rate =
    Number.isFinite(input.frameRate) && input.frameRate > 0
      ? input.frameRate
      : 30;
  return input.currentTime >= input.sourceOut - 0.5 / rate
    ? input.sourceIn
    : undefined;
}
