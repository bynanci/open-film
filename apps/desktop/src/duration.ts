import type { Composition } from "@openfilm/core";

/** Time covered by a beat; simultaneous image/video/audio clips count once. */
export function beatTimelineDuration(
  composition: Composition | null | undefined,
  beatId: string,
): number {
  const spans = (composition?.tracks.flatMap((track) => track.clips) ?? [])
    .filter(
      (clip) =>
        clip.beatId === beatId &&
        Number.isFinite(clip.timelineStart) &&
        Number.isFinite(clip.timelineDuration) &&
        clip.timelineDuration > 0,
    )
    .map(
      (clip) =>
        [
          clip.timelineStart,
          clip.timelineStart + clip.timelineDuration,
        ] as const,
    )
    .sort((a, b) => a[0] - b[0]);
  let duration = 0;
  let end = -Infinity;
  for (const [start, nextEnd] of spans) {
    if (nextEnd > end) duration += nextEnd - Math.max(start, end);
    end = Math.max(end, nextEnd);
  }
  return duration;
}

export type DurationStatus =
  "ideal" | "near-target" | "near-maximum" | "over-maximum";

/** The final quarter of target-to-maximum headroom is the near-maximum zone. */
export function durationStatus(
  current: number,
  target?: number,
  maximum?: number,
): DurationStatus {
  const valid = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value) && value >= 0;
  const limit = valid(maximum) ? maximum : valid(target) ? target : Infinity;
  const goal = valid(target) ? Math.min(target, limit) : limit;
  if (current > limit + 0.001) return "over-maximum";
  if (current <= goal + 0.001 || !Number.isFinite(current)) return "ideal";
  return current >= goal + (limit - goal) * 0.75
    ? "near-maximum"
    : "near-target";
}
