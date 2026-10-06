import type { TimelineMarker, TranscriptDocument } from "@openfilm/core";

/** Source-time candidates are independent of view zoom and timeline speed. */
export interface SnapCandidate {
  time: number;
  type: string;
  priority: number;
  id?: string;
  label?: string;
}

export interface SnapOptions {
  /** Maximum distance in source seconds. Convert pixel tolerances in the view. */
  threshold: number;
  /** An empty list disables snapping; omitted enables every candidate type. */
  enabledTypes?: readonly string[];
  min?: number;
  max?: number;
}

export interface SnapResult {
  time: number;
  snapped: boolean;
  candidate?: SnapCandidate & { distance: number };
}

const PRIORITY: Record<string, number> = {
  manual: 100,
  "clip-edge": 90,
  "scene-cut": 80,
  chapter: 70,
  beat: 60,
  speech: 50,
  "transcript-segment": 50,
  word: 40,
};
const TIME_EPSILON = 1e-9;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Nearest wins. Equal distances prefer priority, then earlier time and stable ID. */
export function snapTime(
  time: number,
  candidates: readonly SnapCandidate[],
  options: SnapOptions,
): SnapResult {
  const minimum = options.min ?? 0;
  const maximum = options.max ?? Infinity;
  if (
    !Number.isFinite(time) ||
    time < 0 ||
    !Number.isFinite(options.threshold) ||
    options.threshold < 0 ||
    !Number.isFinite(minimum) ||
    minimum < 0 ||
    !(Number.isFinite(maximum) || maximum === Infinity) ||
    maximum < minimum
  )
    throw new RangeError(
      "Snap time, bounds and threshold must be valid source seconds.",
    );
  const bounded = Math.min(maximum, Math.max(minimum, time));
  const enabled =
    options.enabledTypes === undefined
      ? undefined
      : new Set(options.enabledTypes);
  let chosen: (SnapCandidate & { distance: number }) | undefined;
  for (const candidate of candidates) {
    if (
      !Number.isFinite(candidate.time) ||
      candidate.time < minimum ||
      candidate.time > maximum ||
      !Number.isFinite(candidate.priority) ||
      typeof candidate.type !== "string" ||
      !candidate.type ||
      (enabled && !enabled.has(candidate.type))
    )
      continue;
    const distance = Math.abs(candidate.time - bounded);
    if (distance > options.threshold + TIME_EPSILON) continue;
    const next = { ...candidate, distance };
    const tied = chosen && Math.abs(distance - chosen.distance) <= TIME_EPSILON;
    if (
      !chosen ||
      distance < chosen.distance - TIME_EPSILON ||
      (tied &&
        (candidate.priority > chosen.priority ||
          (candidate.priority === chosen.priority &&
            (candidate.time < chosen.time ||
              (candidate.time === chosen.time &&
                (compareText(candidate.type, chosen.type) < 0 ||
                  (candidate.type === chosen.type &&
                    compareText(candidate.id ?? "", chosen.id ?? "") < 0)))))))
    )
      chosen = next;
  }
  return chosen
    ? { time: chosen.time, snapped: true, candidate: chosen }
    : { time: bounded, snapped: false };
}

/** Includes both ends of timed speech/words; silence between segments remains free. */
export function candidatesFromIntelligence(
  markers: readonly TimelineMarker[],
  transcript?: TranscriptDocument,
  clipEdges: readonly number[] = [],
): SnapCandidate[] {
  const candidates: SnapCandidate[] = markers.map((marker) => ({
    id: marker.id,
    time: marker.time,
    type: marker.type,
    priority: PRIORITY[marker.type] ?? 0,
    ...(marker.label === undefined ? {} : { label: marker.label }),
  }));
  for (const segment of transcript?.segments ?? []) {
    for (const edge of ["start", "end"] as const)
      candidates.push({
        id: `${segment.id}:${edge}`,
        time: segment[edge],
        type: "transcript-segment",
        priority: PRIORITY["transcript-segment"]!,
        label: segment.text,
      });
    // Words remain historical evidence after correction. Segment timing still supports
    // seeking, but text-edited words must never be advertised as aligned snap targets.
    for (const [index, word] of (segment.alignmentState === "text-edited"
      ? []
      : (segment.words ?? [])
    ).entries())
      for (const edge of ["start", "end"] as const)
        candidates.push({
          id: `${segment.id}:word:${index}:${edge}`,
          time: word[edge],
          type: "word",
          priority: PRIORITY.word!,
          label: word.text,
        });
  }
  for (const [index, time] of clipEdges.entries())
    candidates.push({
      id: `clip-edge:${index}`,
      time,
      type: "clip-edge",
      priority: PRIORITY["clip-edge"]!,
    });
  return candidates;
}
