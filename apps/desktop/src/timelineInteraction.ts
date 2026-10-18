import type { Clip, Composition, MediaAsset } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";

export type TimelineResizeEdge = "start" | "end";
export interface TimelineResizeDraft {
  command: TimelineCommand;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  bounded: boolean;
}

const EPSILON = 1e-7;

export function timelineSecondsFromPixels(
  pixels: number,
  pixelsPerSecond: number,
): number {
  return pixels / pixelsPerSecond;
}

/** All lane positions and dimensions share the ruler's scale, including short clips. */
export function clipTimeLayout(clip: Clip, pixelsPerSecond: number) {
  return {
    left: clip.timelineStart * pixelsPerSecond,
    width: clip.timelineDuration * pixelsPerSecond,
  };
}

export function timelineRuler(duration: number, pixelsPerSecond: number) {
  const minimum = Math.max(64 / pixelsPerSecond, duration / 1000);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(minimum, 0.001)));
  const step =
    ([1, 2, 5, 10].find((value) => value * magnitude >= minimum) ?? 10) *
    magnitude;
  const count = Math.ceil(Math.max(0, duration) / step);
  return {
    step,
    ticks: Array.from({ length: count + 1 }, (_, index) => index * step),
  };
}

export function canResizeTimelineClip(
  clip: Clip,
  asset: MediaAsset | undefined,
): boolean {
  const speed = clip.transform?.speed ?? 1;
  if (
    !asset ||
    clip.locked ||
    asset.mediaType === "360-video" ||
    (asset.metadata["openfilm.preview"] as { supported?: boolean } | undefined)
      ?.supported === false ||
    !Number.isFinite(clip.timelineDuration) ||
    clip.timelineDuration <= 0 ||
    !Number.isFinite(speed) ||
    speed <= 0
  )
    return false;
  if (asset.mediaType === "image") return true;
  const sourceIn = clip.sourceIn ?? 0;
  const sourceOut = clip.sourceOut ?? sourceIn + clip.timelineDuration * speed;
  return (
    Number.isFinite(asset.duration) &&
    (asset.duration ?? 0) > 0 &&
    Number.isFinite(sourceIn) &&
    sourceIn >= 0 &&
    Number.isFinite(sourceOut) &&
    sourceOut > sourceIn &&
    sourceOut <= asset.duration!
  );
}

/** Resize changes source selection/duration; the timeline start remains anchored. */
export function resizeTimelineClip(
  clip: Clip,
  asset: MediaAsset | undefined,
  edge: TimelineResizeEdge,
  deltaSeconds: number,
  frameRate: number,
): TimelineResizeDraft | null {
  if (!canResizeTimelineClip(clip, asset) || !Number.isFinite(deltaSeconds))
    return null;
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const delta = Math.round(deltaSeconds * fps) / fps;
  if (delta === 0) return null;
  const minimum = 1 / fps;
  const speed = clip.transform?.speed ?? 1;
  let sourceIn = clip.sourceIn ?? 0;
  let sourceOut = clip.sourceOut ?? sourceIn + clip.timelineDuration * speed;
  let duration: number;
  let bounded: boolean;
  let command: TimelineCommand;
  if (asset!.mediaType === "image") {
    const requested =
      clip.timelineDuration + (edge === "start" ? -delta : delta);
    if (!Number.isFinite(requested)) return null;
    duration = Math.max(minimum, requested);
    bounded = Math.abs(duration - requested) > EPSILON;
    sourceOut = sourceIn + duration * speed;
    command = { type: "duration", clipId: clip.id, duration };
  } else {
    const sourceMinimum = minimum * speed;
    // A source shorter than an output frame cannot satisfy this interaction's minimum.
    if (asset!.duration! < sourceMinimum) return null;
    if (edge === "start") {
      const requested = sourceIn + delta * speed;
      sourceIn = Math.max(0, Math.min(sourceOut - sourceMinimum, requested));
      bounded = Math.abs(sourceIn - requested) > EPSILON;
    } else {
      const requested = sourceOut + delta * speed;
      sourceOut = Math.min(
        asset!.duration!,
        Math.max(sourceIn + sourceMinimum, requested),
      );
      bounded = Math.abs(sourceOut - requested) > EPSILON;
    }
    duration = (sourceOut - sourceIn) / speed;
    if (duration < minimum - EPSILON) return null;
    command = { type: "trim", clipId: clip.id, sourceIn, sourceOut };
  }
  if (
    Math.abs(duration - clip.timelineDuration) < EPSILON &&
    (asset!.mediaType === "image" ||
      (Math.abs(sourceIn - (clip.sourceIn ?? 0)) < EPSILON &&
        Math.abs(
          sourceOut -
            (clip.sourceOut ??
              (clip.sourceIn ?? 0) + clip.timelineDuration * speed),
        ) < EPSILON))
  )
    return null;
  return { command, duration, sourceIn, sourceOut, bounded };
}

/** Match the solver's ripple preview without submitting intermediate commands. */
export function previewTimelineResize(
  composition: Composition,
  clipId: string,
  draft: TimelineResizeDraft,
): Composition {
  const selected = composition.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === clipId);
  if (!selected) return composition;
  const oldEnd = selected.timelineStart + selected.timelineDuration;
  const delta = draft.duration - selected.timelineDuration;
  const tracks = composition.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) =>
      clip.id === clipId
        ? {
            ...clip,
            sourceIn:
              draft.command.type === "duration"
                ? clip.sourceIn
                : draft.sourceIn,
            sourceOut: draft.sourceOut,
            timelineDuration: draft.duration,
            ...(clip.transition
              ? {
                  transition: {
                    ...clip.transition,
                    duration: Math.min(
                      clip.transition.duration,
                      draft.duration,
                    ),
                  },
                }
              : {}),
          }
        : clip.timelineStart >= oldEnd - EPSILON
          ? { ...clip, timelineStart: Math.max(0, clip.timelineStart + delta) }
          : clip,
    ),
  }));
  return {
    ...composition,
    tracks,
    duration: Math.max(
      0,
      ...tracks.flatMap((track) =>
        track.clips.map((clip) => clip.timelineStart + clip.timelineDuration),
      ),
    ),
  };
}
