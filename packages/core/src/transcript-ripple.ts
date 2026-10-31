// SPDX-License-Identifier: Apache-2.0
import { ApplicationError } from "./errors.js";
import {
  type CaptionCue,
  type Clip,
  type Composition,
  type MediaAsset,
  type ProjectTimebaseV1,
} from "./models.js";
import { type GraphicScene } from "./graphic-scenes.js";
import {
  type TranscriptDocument,
  type TranscriptSegment,
} from "./intelligence.js";
import { resolveCompositionCoverageBindings } from "./coverage.js";
import { validateComposition } from "./validation.js";

const EPSILON = 1e-4;

export type TranscriptRippleMode = "delete" | "keep";

export interface TranscriptRippleInterval {
  start: number;
  end: number;
}

export interface TranscriptRippleProposal {
  version: 1;
  assetId: string;
  mode: TranscriptRippleMode;
  sourceIntervals: TranscriptRippleInterval[];
  timelineIntervals: TranscriptRippleInterval[];
  totalDurationReduced: number;
  verifiedSegmentIds: string[];
}

export interface CreateTranscriptRippleOptions {
  assetId: string;
  mode?: TranscriptRippleMode;
  segmentIds?: readonly string[];
  sourceRange?: TranscriptRippleInterval;
  assets?: readonly MediaAsset[];
}

function assertPlainObject(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new ApplicationError(
      "request.invalid",
      `${path} must be a plain JSON object.`,
    );
  }
  return value as Record<string, unknown>;
}

export function validateTranscriptRippleProposal(
  value: unknown,
): TranscriptRippleProposal {
  const data = assertPlainObject(value, "Transcript ripple proposal");
  if (data.version !== 1) {
    throw new ApplicationError(
      "request.invalid",
      "Expected transcript ripple proposal version 1.",
    );
  }
  if (typeof data.assetId !== "string" || !data.assetId.trim()) {
    throw new ApplicationError(
      "request.invalid",
      "assetId must be a non-empty string.",
    );
  }
  if (data.mode !== "delete" && data.mode !== "keep") {
    throw new ApplicationError(
      "request.invalid",
      "mode must be 'delete' or 'keep'.",
    );
  }
  if (
    !Array.isArray(data.sourceIntervals) ||
    !Array.isArray(data.timelineIntervals)
  ) {
    throw new ApplicationError(
      "request.invalid",
      "sourceIntervals and timelineIntervals must be arrays.",
    );
  }
  for (const interval of [...data.sourceIntervals, ...data.timelineIntervals]) {
    assertPlainObject(interval, "interval");
    if (
      typeof interval.start !== "number" ||
      !Number.isFinite(interval.start) ||
      interval.start < 0 ||
      typeof interval.end !== "number" ||
      !Number.isFinite(interval.end) ||
      interval.end <= interval.start
    ) {
      throw new ApplicationError(
        "request.invalid",
        "Interval start and end must be finite numbers with end > start >= 0.",
      );
    }
  }
  if (
    typeof data.totalDurationReduced !== "number" ||
    !Number.isFinite(data.totalDurationReduced) ||
    data.totalDurationReduced < 0
  ) {
    throw new ApplicationError(
      "request.invalid",
      "totalDurationReduced must be a non-negative finite number.",
    );
  }
  if (!Array.isArray(data.verifiedSegmentIds)) {
    throw new ApplicationError(
      "request.invalid",
      "verifiedSegmentIds must be an array.",
    );
  }
  return structuredClone(data) as unknown as TranscriptRippleProposal;
}

function mergeIntervals(
  intervals: TranscriptRippleInterval[],
): TranscriptRippleInterval[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  const merged: TranscriptRippleInterval[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (current.start <= last.end + EPSILON) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function verifySegmentReliability(segment: TranscriptSegment): void {
  if (segment.timingSource === "estimated") {
    throw new ApplicationError(
      "transcript.unreliableTiming",
      `Transcript segment "${segment.id}" has estimated timing and cannot be automatically ripple-edited.`,
      422,
      { segmentId: segment.id },
    );
  }
  if (
    segment.alignmentState === "text-edited" &&
    segment.timingSource !== "playhead" &&
    segment.timingSource !== "word-boundary"
  ) {
    throw new ApplicationError(
      "transcript.unreliableTiming",
      `Transcript segment "${segment.id}" text was edited without realigned timing evidence.`,
      422,
      { segmentId: segment.id },
    );
  }
  if (
    typeof segment.start !== "number" ||
    !Number.isFinite(segment.start) ||
    typeof segment.end !== "number" ||
    !Number.isFinite(segment.end) ||
    segment.end <= segment.start
  ) {
    throw new ApplicationError(
      "transcript.unreliableTiming",
      `Transcript segment "${segment.id}" has invalid timestamps.`,
      422,
      { segmentId: segment.id },
    );
  }
}

export function createTranscriptRippleProposal(
  composition: Composition,
  transcript: TranscriptDocument,
  options: CreateTranscriptRippleOptions,
): TranscriptRippleProposal {
  if (!options || typeof options !== "object") {
    throw new ApplicationError("request.invalid", "Options are required.");
  }
  if (typeof options.assetId !== "string" || !options.assetId.trim()) {
    throw new ApplicationError(
      "request.invalid",
      "assetId must be a non-empty string.",
    );
  }
  const mode: TranscriptRippleMode = options.mode ?? "delete";
  if (mode !== "delete" && mode !== "keep") {
    throw new ApplicationError(
      "request.invalid",
      "mode must be 'delete' or 'keep'.",
    );
  }

  // Find all primary/film clips referencing this asset
  const targetClips: Clip[] = [];
  for (const track of composition.tracks) {
    if (track.timing === "overlay") continue;
    for (const clip of track.clips) {
      if (clip.assetId === options.assetId) {
        targetClips.push(clip);
      }
    }
  }

  if (!targetClips.length) {
    throw new ApplicationError(
      "timeline.notFound",
      `Media asset "${options.assetId}" is not present on the primary timeline.`,
      404,
      { assetId: options.assetId },
    );
  }

  // Determine target source intervals and verified segments
  const verifiedSegments: TranscriptSegment[] = [];
  const rawTargetIntervals: TranscriptRippleInterval[] = [];

  if (options.segmentIds && options.segmentIds.length > 0) {
    for (const segmentId of options.segmentIds) {
      const segment = transcript.segments.find((s) => s.id === segmentId);
      if (!segment) {
        throw new ApplicationError(
          "transcript.segmentNotFound",
          `Transcript segment "${segmentId}" was not found.`,
          404,
          { segmentId },
        );
      }
      verifySegmentReliability(segment);
      verifiedSegments.push(segment);
      rawTargetIntervals.push({ start: segment.start, end: segment.end });
    }
  } else if (options.sourceRange) {
    const { start, end } = options.sourceRange;
    if (
      typeof start !== "number" ||
      !Number.isFinite(start) ||
      start < 0 ||
      typeof end !== "number" ||
      !Number.isFinite(end) ||
      end <= start
    ) {
      throw new ApplicationError(
        "request.invalid",
        "sourceRange must have finite start and end with end > start >= 0.",
      );
    }
    const overlapping = transcript.segments.filter(
      (s) => s.end > start + EPSILON && s.start < end - EPSILON,
    );
    if (!overlapping.length) {
      throw new ApplicationError(
        "transcript.unreliableTiming",
        "No reliable transcript segments found overlapping the requested source range.",
        422,
      );
    }
    for (const segment of overlapping) {
      verifySegmentReliability(segment);
      verifiedSegments.push(segment);
    }
    rawTargetIntervals.push({ start, end });
  } else {
    throw new ApplicationError(
      "request.invalid",
      "Either segmentIds or sourceRange must be provided.",
    );
  }

  const mergedTargetIntervals = mergeIntervals(rawTargetIntervals);

  // Convert to source intervals to delete
  let sourceIntervalsToDelete: TranscriptRippleInterval[];
  if (mode === "delete") {
    sourceIntervalsToDelete = mergedTargetIntervals;
  } else {
    // Mode "keep": delete everything outside the keep intervals within the clip bounds
    const minSourceIn = Math.min(...targetClips.map((c) => c.sourceIn ?? 0));
    const maxSourceOut = Math.max(
      ...targetClips.map(
        (c) =>
          c.sourceOut ??
          (c.sourceIn ?? 0) + c.timelineDuration * (c.transform?.speed ?? 1),
      ),
    );

    sourceIntervalsToDelete = [];
    let currentCursor = minSourceIn;
    for (const keepInterval of mergedTargetIntervals) {
      if (keepInterval.start > currentCursor + EPSILON) {
        sourceIntervalsToDelete.push({
          start: currentCursor,
          end: Math.min(keepInterval.start, maxSourceOut),
        });
      }
      currentCursor = Math.max(currentCursor, keepInterval.end);
    }
    if (currentCursor < maxSourceOut - EPSILON) {
      sourceIntervalsToDelete.push({
        start: currentCursor,
        end: maxSourceOut,
      });
    }
  }

  // Map source intervals to timeline intervals
  const rawTimelineIntervals: TranscriptRippleInterval[] = [];
  for (const clip of targetClips) {
    const speed = clip.transform?.speed ?? 1;
    const clipSourceIn = clip.sourceIn ?? 0;
    const clipSourceOut =
      clip.sourceOut ?? clipSourceIn + clip.timelineDuration * speed;

    for (const cut of sourceIntervalsToDelete) {
      const overlapIn = Math.max(clipSourceIn, cut.start);
      const overlapOut = Math.min(clipSourceOut, cut.end);

      if (overlapOut > overlapIn + EPSILON) {
        const tStart = clip.timelineStart + (overlapIn - clipSourceIn) / speed;
        const tEnd = clip.timelineStart + (overlapOut - clipSourceIn) / speed;
        rawTimelineIntervals.push({ start: tStart, end: tEnd });
      }
    }
  }

  const timelineIntervals = mergeIntervals(rawTimelineIntervals);
  const totalDurationReduced = timelineIntervals.reduce(
    (sum, interval) => sum + (interval.end - interval.start),
    0,
  );

  // Check for locked clips and pin conflicts
  if (options.assets) {
    const targetAsset = options.assets.find((a) => a.id === options.assetId);
    if (targetAsset?.state?.locked) {
      throw new ApplicationError(
        "timeline.lockedClipConflict",
        `Source asset "${targetAsset.name}" is locked.`,
        409,
      );
    }
  }

  for (const track of composition.tracks) {
    for (const clip of track.clips) {
      if (clip.locked) {
        // If locked clip is affected by cut or subsequent shift
        for (const t of timelineIntervals) {
          if (clip.timelineStart + clip.timelineDuration > t.start - EPSILON) {
            throw new ApplicationError(
              "timeline.lockedClipConflict",
              `Cannot ripple edit because locked clip "${clip.id}" is in the affected range.`,
              409,
            );
          }
        }
      }
    }
  }

  return {
    version: 1,
    assetId: options.assetId,
    mode,
    sourceIntervals: sourceIntervalsToDelete,
    timelineIntervals,
    totalDurationReduced,
    verifiedSegmentIds: verifiedSegments.map((s) => s.id),
  };
}

/**
 * Applies a ripple delete of a single timeline interval [tStart, tEnd] to a composition.
 */
function applySingleRippleInterval(
  composition: Composition,
  tStart: number,
  tEnd: number,
): void {
  const delta = tEnd - tStart;
  if (delta <= EPSILON) return;

  let splitCounter = 1;

  // 1. Primary/visual tracks
  for (const track of composition.tracks) {
    if (track.timing === "overlay") continue;

    const newClips: Clip[] = [];
    for (const clip of track.clips) {
      const cStart = clip.timelineStart;
      const cEnd = clip.timelineStart + clip.timelineDuration;
      const speed = clip.transform?.speed ?? 1;
      const cSourceIn = clip.sourceIn ?? 0;

      if (cEnd <= tStart + EPSILON) {
        // Entirely before the cut
        newClips.push(clip);
      } else if (cStart >= tEnd - EPSILON) {
        // Entirely after the cut: shift left
        clip.timelineStart = Math.max(0, clip.timelineStart - delta);
        newClips.push(clip);
      } else if (cStart >= tStart - EPSILON && cEnd <= tEnd + EPSILON) {
        // Entirely inside the cut: delete
      } else if (cStart < tStart && cEnd > tEnd) {
        // Cut is strictly inside the clip: split into two halves
        const leftDuration = tStart - cStart;
        const leftSourceOut = cSourceIn + leftDuration * speed;

        const rightDuration = cEnd - tEnd;
        const rightSourceIn = cSourceIn + (tEnd - cStart) * speed;
        const rightSourceOut =
          clip.sourceOut ?? cSourceIn + clip.timelineDuration * speed;

        const leftClip: Clip = {
          ...clip,
          timelineDuration: leftDuration,
          sourceOut: leftSourceOut,
        };

        const rightClip: Clip = {
          ...structuredClone(clip),
          id: `${clip.id}-rip-${splitCounter++}`,
          timelineStart: tStart,
          timelineDuration: rightDuration,
          sourceIn: rightSourceIn,
          sourceOut: rightSourceOut,
        };
        delete rightClip.transition;

        newClips.push(leftClip, rightClip);
      } else if (cStart < tStart && cEnd > tStart) {
        // Overlaps the end of the clip: trim right
        const newDuration = tStart - cStart;
        clip.timelineDuration = newDuration;
        clip.sourceOut = cSourceIn + newDuration * speed;
        newClips.push(clip);
      } else if (cStart < tEnd && cEnd > tEnd) {
        // Overlaps the start of the clip: trim left and reposition
        const cutDuration = tEnd - cStart;
        clip.timelineStart = tStart;
        clip.timelineDuration = cEnd - tEnd;
        clip.sourceIn = cSourceIn + cutDuration * speed;
        newClips.push(clip);
      }
    }
    track.clips = newClips;
  }

  // 2. Overlay tracks (audio / B-roll)
  for (const track of composition.tracks) {
    if (track.timing !== "overlay") continue;

    const newClips: Clip[] = [];
    for (const clip of track.clips) {
      const oStart = clip.timelineStart;
      const oEnd = clip.timelineStart + clip.timelineDuration;

      if (oEnd <= tStart + EPSILON) {
        newClips.push(clip);
      } else if (oStart >= tEnd - EPSILON) {
        clip.timelineStart = Math.max(0, clip.timelineStart - delta);
        newClips.push(clip);
      } else if (oStart >= tStart - EPSILON && oEnd <= tEnd + EPSILON) {
        // Fully covered by cut: removed
      } else if (oStart < tStart && oEnd > tEnd) {
        clip.timelineDuration = Math.max(0.01, clip.timelineDuration - delta);
        if (clip.sourceOut !== undefined && clip.sourceIn !== undefined) {
          clip.sourceOut =
            clip.sourceIn +
            clip.timelineDuration * (clip.transform?.speed ?? 1);
        }
        newClips.push(clip);
      } else if (oStart < tStart && oEnd > tStart) {
        clip.timelineDuration = Math.max(0.01, tStart - oStart);
        if (clip.sourceOut !== undefined && clip.sourceIn !== undefined) {
          clip.sourceOut =
            clip.sourceIn +
            clip.timelineDuration * (clip.transform?.speed ?? 1);
        }
        newClips.push(clip);
      } else if (oStart < tEnd && oEnd > tEnd) {
        const cutDuration = tEnd - oStart;
        clip.timelineStart = tStart;
        clip.timelineDuration = Math.max(0.01, oEnd - tEnd);
        if (clip.sourceIn !== undefined) {
          clip.sourceIn += cutDuration * (clip.transform?.speed ?? 1);
        }
        newClips.push(clip);
      }
    }
    track.clips = newClips;
  }

  // Remove empty overlay tracks
  composition.tracks = composition.tracks.filter(
    (t) => t.timing !== "overlay" || t.clips.length > 0,
  );

  // 3. Caption tracks and cues
  if (composition.captionTracks) {
    const cutStartMs = Math.round(tStart * 1000);
    const cutEndMs = Math.round(tEnd * 1000);
    const deltaMs = cutEndMs - cutStartMs;

    for (const track of composition.captionTracks) {
      const newCues: CaptionCue[] = [];
      for (const cue of track.cues) {
        if (cue.endMs <= cutStartMs) {
          newCues.push(cue);
        } else if (cue.startMs >= cutEndMs) {
          cue.startMs = Math.max(0, cue.startMs - deltaMs);
          cue.endMs = Math.max(cue.startMs + 1, cue.endMs - deltaMs);
          newCues.push(cue);
        } else if (cue.startMs >= cutStartMs && cue.endMs <= cutEndMs) {
          // Inside cut: delete cue
        } else if (cue.startMs < cutStartMs && cue.endMs > cutEndMs) {
          cue.endMs = Math.max(cue.startMs + 1, cue.endMs - deltaMs);
          newCues.push(cue);
        } else if (cue.startMs < cutStartMs && cue.endMs > cutStartMs) {
          cue.endMs = cutStartMs;
          if (cue.endMs > cue.startMs) newCues.push(cue);
        } else if (cue.startMs < cutEndMs && cue.endMs > cutEndMs) {
          cue.startMs = cutStartMs;
          cue.endMs = Math.max(cue.startMs + 1, cue.endMs - deltaMs);
          newCues.push(cue);
        }
      }
      track.cues = newCues;
    }
  }

  // 4. Graphic scenes
  if (composition.graphicScenes) {
    const newScenes: GraphicScene[] = [];
    for (const scene of composition.graphicScenes) {
      const sStart = scene.start;
      const sEnd = scene.start + scene.duration;

      if (sEnd <= tStart + EPSILON) {
        newScenes.push(scene);
      } else if (sStart >= tEnd - EPSILON) {
        scene.start = Math.max(0, scene.start - delta);
        newScenes.push(scene);
      } else if (sStart >= tStart - EPSILON && sEnd <= tEnd + EPSILON) {
        // Fully within cut: delete
      } else if (sStart < tStart && sEnd > tEnd) {
        scene.duration = Math.max(0.1, scene.duration - delta);
        newScenes.push(scene);
      } else if (sStart < tStart && sEnd > tStart) {
        scene.duration = Math.max(0.1, tStart - sStart);
        newScenes.push(scene);
      } else if (sStart < tEnd && sEnd > tEnd) {
        scene.start = tStart;
        scene.duration = Math.max(0.1, sEnd - tEnd);
        newScenes.push(scene);
      }
    }
    composition.graphicScenes = newScenes.length ? newScenes : undefined;
  }

  // 5. Update composition duration
  composition.duration = Math.max(
    0,
    ...composition.tracks
      .flatMap((t) => t.clips)
      .map((c) => c.timelineStart + c.timelineDuration),
  );
}

/**
 * Applies a verified TranscriptRippleProposal to a Composition.
 */
export function applyTranscriptRipple(
  composition: Composition,
  proposal: TranscriptRippleProposal,
  timebase?: ProjectTimebaseV1,
): Composition {
  const result = structuredClone(composition);
  validateTranscriptRippleProposal(proposal);

  if (
    !proposal.timelineIntervals.length ||
    proposal.totalDurationReduced <= EPSILON
  ) {
    return result;
  }

  // Process intervals in descending order so earlier timestamps remain unchanged
  // while later intervals are processed.
  const descendingIntervals = [...proposal.timelineIntervals].sort(
    (a, b) => b.start - a.start,
  );

  for (const interval of descendingIntervals) {
    applySingleRippleInterval(result, interval.start, interval.end);
  }

  // Clean up stale coverage bindings and re-resolve
  if (result.coverageAudioBindings) {
    const clipIds = new Set(
      result.tracks.flatMap((t) => t.clips.map((c) => c.id)),
    );
    result.coverageAudioBindings = result.coverageAudioBindings.filter(
      (b) => clipIds.has(b.primaryClipId) && clipIds.has(b.secondaryClipId),
    );
    if (!result.coverageAudioBindings.length) {
      delete result.coverageAudioBindings;
    }
  }

  // If timebase is provided, re-derive coverage bindings deterministically
  if (timebase) {
    resolveCompositionCoverageBindings(result, timebase);
  }

  return validateComposition(result);
}
