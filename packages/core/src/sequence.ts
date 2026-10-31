// Modified by OpenFilm contributors on 2026-10-26. See LICENSE/NOTICE.
import type {
  Clip,
  Composition,
  MediaAsset,
  ProjectTimebaseV1,
} from "./models.js";
import { sequenceFrameAt, sequenceTimeAt, timebaseRate } from "./timebase.js";

export interface ResolvedSequenceClip {
  trackId: string;
  trackIndex: number;
  clipIndex: number;
  clip: Clip;
  asset: MediaAsset;
  startFrame: number;
  /** Visual ranges include any outgoing crossfade tail. */
  endFrame: number;
  localTime: number;
  /** Abstract source position; a held tail may resolve to sourceOut. */
  sourceTime: number;
  opacity: number;
  visual: boolean;
  audible: boolean;
}

export interface ResolvedSequenceFrame {
  frame: number;
  time: number;
  primary?: ResolvedSequenceClip;
  visual: ResolvedSequenceClip[];
  audible: ResolvedSequenceClip[];
  transitionOverlay?: { color: "black" | "white"; opacity: number };
}

function finite(value: number, field: string, positive = false): void {
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0))
    throw new Error(
      `${field} must be ${positive ? "positive" : "nonnegative"} and finite`,
    );
}

/** Match the renderer's rounded start and half-open, ceiled duration. */
export function resolveClipFrameRange(
  clip: Clip,
  timebase: ProjectTimebaseV1,
): { startFrame: number; endFrame: number } {
  finite(clip.timelineStart, "Clip start");
  finite(clip.timelineDuration, "Clip duration", true);
  const startFrame = sequenceFrameAt(clip.timelineStart, timebase, "nearest");
  const endFrame =
    startFrame +
    Math.ceil((clip.timelineDuration - 1e-9) * timebaseRate(timebase));
  sequenceTimeAt(endFrame, timebase);
  return { startFrame, endFrame };
}

/** Preserve renderer trim defaults and its 50ms source-duration tolerance. */
export function resolveClipSourceRange(
  clip: Clip,
  asset: MediaAsset,
): { sourceIn: number; sourceOut: number; speed: number } {
  finite(clip.timelineDuration, "Clip duration", true);
  const sourceIn = clip.sourceIn ?? 0;
  const speed = clip.transform?.speed ?? 1;
  finite(sourceIn, "Source in");
  finite(speed, "Speed", true);
  if (asset.duration !== undefined)
    finite(asset.duration, "Source duration", true);
  const sourceOut =
    clip.sourceOut ??
    (asset.duration !== undefined
      ? Math.min(asset.duration, sourceIn + clip.timelineDuration * speed)
      : sourceIn + clip.timelineDuration * speed);
  finite(sourceOut, "Source out", true);
  if (sourceOut <= sourceIn)
    throw new Error(`Clip ${clip.id} has an empty source range`);
  if (asset.duration !== undefined && sourceOut > asset.duration + 0.05)
    throw new Error(`Clip ${clip.id} trim exceeds the source duration`);
  return { sourceIn, sourceOut, speed };
}

function primaryTrackIndex(composition: Composition): number {
  return composition.tracks.findIndex(
    (track) => track.type === "video" && track.timing !== "overlay",
  );
}

/** Editable primary boundaries do not include presentation-only fade tails. */
export function primaryEditFrames(
  composition: Composition,
  timebase: ProjectTimebaseV1,
): number[] {
  timebaseRate(timebase);
  const primary = composition.tracks[primaryTrackIndex(composition)];
  return [
    ...new Set(
      primary?.clips.flatMap((clip) => {
        const { startFrame, endFrame } = resolveClipFrameRange(clip, timebase);
        return [startFrame, endFrame];
      }) ?? [],
    ),
  ].sort((a, b) => a - b);
}

/** Evaluate saved media layers without retaining transport or seek state.
 * Native titles and GraphicScenes have separate Composition-time evaluators.
 */
export function resolveCompositionFrame(
  composition: Composition,
  assets: readonly MediaAsset[],
  frame: number,
  timebase: ProjectTimebaseV1,
): ResolvedSequenceFrame {
  const time = sequenceTimeAt(frame, timebase);
  finite(composition.duration, "Composition duration", true);
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const primaryIndex = primaryTrackIndex(composition);
  const visual: ResolvedSequenceClip[] = [];
  const audible: ResolvedSequenceClip[] = [];
  let primary: ResolvedSequenceClip | undefined;
  let transitionOverlay:
    { color: "black" | "white"; opacity: number } | undefined;

  const primaryTrack = composition.tracks[primaryIndex];
  if (primaryTrack) {
    for (const clip of primaryTrack.clips) {
      if (
        clip.transition &&
        (clip.transition.type === "dip-to-black" ||
          clip.transition.type === "dip-to-white")
      ) {
        const T = clip.timelineStart;
        const D = clip.transition.duration;
        if (time >= T && time < T + D) {
          const delta = time - T;
          const half = D / 2;
          const rawAlpha =
            half > 0 ? (delta < half ? delta / half : (D - delta) / half) : 0;
          const clamped = Math.max(0, Math.min(1, rawAlpha));
          const opacity =
            Math.abs(clamped - 1.0) < 1e-6
              ? 1.0
              : Math.abs(clamped) < 1e-6
                ? 0.0
                : clamped;
          transitionOverlay = {
            color: clip.transition.type === "dip-to-black" ? "black" : "white",
            opacity,
          };
          break;
        }
      }
    }
  }

  for (const [trackIndex, track] of composition.tracks.entries()) {
    if (track.type === "titles") continue;
    // The renderer finds fade successors chronologically. Output layers still
    // retain their saved track and clip order, including unsorted clips.
    const chronological = track.clips
      .map((clip, index) => ({ clip, index }))
      .sort((a, b) => a.clip.timelineStart - b.clip.timelineStart);
    const nextClips = new Map(
      chronological.map(({ index }, position) => [
        index,
        chronological[position + 1]?.clip,
      ]),
    );
    for (const [clipIndex, clip] of track.clips.entries()) {
      const range = resolveClipFrameRange(clip, timebase);
      if (
        clip.timelineStart + clip.timelineDuration >
        composition.duration + 0.00001
      )
        throw new Error(`Clip ${clip.id} exceeds the composition duration`);
      if (
        clip.transition &&
        ((clip.transition.type !== "crossfade" &&
          clip.transition.type !== "dip-to-black" &&
          clip.transition.type !== "dip-to-white") ||
          !Number.isFinite(clip.transition.duration) ||
          clip.transition.duration < 0 ||
          clip.transition.duration > clip.timelineDuration)
      )
        throw new Error("Transition must fit within the clip duration");
      const asset = assetMap.get(clip.assetId);
      if (!asset)
        throw new Error(
          `Clip ${clip.id} references missing asset ${clip.assetId}`,
        );
      const { sourceIn, sourceOut, speed } = resolveClipSourceRange(
        clip,
        asset,
      );
      const isVisual =
        track.type !== "audio" &&
        track.type !== "music" &&
        asset.mediaType !== "audio";
      const next = nextClips.get(clipIndex);
      const isContiguous =
        next &&
        Math.abs(
          next.timelineStart - clip.timelineStart - clip.timelineDuration,
        ) < 0.05;
      let tailDuration = 0;
      if (isVisual && isContiguous && next?.transition) {
        if (next.transition.type === "crossfade") {
          tailDuration = next.transition.duration;
        } else if (
          next.transition.type === "dip-to-black" ||
          next.transition.type === "dip-to-white"
        ) {
          tailDuration = next.transition.duration / 2;
        }
      }
      const tail =
        tailDuration > 0
          ? Math.min(
              tailDuration,
              composition.duration - clip.timelineStart - clip.timelineDuration,
            )
          : 0;
      const displayed =
        tail > 0
          ? resolveClipFrameRange(
              { ...clip, timelineDuration: clip.timelineDuration + tail },
              timebase,
            )
          : range;
      const active = frame >= range.startFrame && frame < range.endFrame;
      const visualActive =
        isVisual && frame >= displayed.startFrame && frame < displayed.endFrame;
      const probe = asset.metadata["openfilm.ffprobe"] as
        { streams?: { codec_type?: string }[] } | undefined;
      const volume = clip.transform?.volume ?? 1;
      finite(volume, "Volume");
      const audibleActive =
        active &&
        volume > 0 &&
        (asset.mediaType === "audio" ||
          Boolean(
            probe?.streams?.some((stream) => stream.codec_type === "audio"),
          ));
      if (!visualActive && !audibleActive) continue;
      const localTime = sequenceTimeAt(frame - range.startFrame, timebase);
      const fade = clip.transition?.duration ?? 0;
      const opacity =
        clip.transition?.type === "crossfade" && fade > 0
          ? Math.min(1, localTime / fade)
          : 1;
      const resolved: ResolvedSequenceClip = {
        trackId: track.id,
        trackIndex,
        clipIndex,
        clip,
        asset,
        startFrame: range.startFrame,
        endFrame: displayed.endFrame,
        localTime,
        sourceTime:
          localTime >= clip.timelineDuration
            ? sourceOut
            : Math.min(sourceOut, sourceIn + localTime * speed),
        opacity,
        visual: visualActive,
        audible: audibleActive,
      };
      if (visualActive) visual.push(resolved);
      if (audibleActive) audible.push(resolved);
      if (trackIndex === primaryIndex && visualActive) {
        if (
          next?.transition &&
          (next.transition.type === "dip-to-black" ||
            next.transition.type === "dip-to-white")
        ) {
          const delta = time - next.timelineStart;
          if (delta < next.transition.duration / 2) {
            primary = resolved;
          }
        } else if (
          clip.transition &&
          (clip.transition.type === "dip-to-black" ||
            clip.transition.type === "dip-to-white")
        ) {
          const delta = time - clip.timelineStart;
          if (delta >= clip.transition.duration / 2 && active) {
            primary = resolved;
          }
        } else if (active) {
          primary = resolved;
        }
      }
    }
  }
  return { frame, time, primary, visual, audible, transitionOverlay };
}
