// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import {
  type Clip,
  type Composition,
  type MediaAsset,
  type ProjectTimebaseV1,
  type ResolvedSequenceFrame,
  type TransitionType,
  type SceneMicroPreviewProposal,
  MICRO_PREVIEW_PRE_CUT_MAX,
  MICRO_PREVIEW_POST_CUT_MAX,
  MICRO_PREVIEW_MAX_DURATION,
  fnv1a64Mix,
  resolveCompositionFrame,
  sequenceFrameAt,
  validateMicroPreviewProposal,
} from "@openfilm/core";
import { TimelineEditingError, type EditorDocument } from "./editing.js";

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalStringify(
            (value as Record<string, unknown>)[k],
          )}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface BuildMicroPreviewOptions {
  targetClipId: string;
  transition: {
    type: TransitionType;
    duration: number;
  };
}

export function buildMicroPreviewProposal(
  document: EditorDocument,
  options: BuildMicroPreviewOptions,
): SceneMicroPreviewProposal {
  const { targetClipId, transition } = options;
  if (!targetClipId) {
    throw new TimelineEditingError(
      "Target clip ID is required for micro-preview.",
    );
  }
  if (
    !transition ||
    !transition.type ||
    typeof transition.duration !== "number"
  ) {
    throw new TimelineEditingError(
      "Valid transition options are required for micro-preview.",
    );
  }

  let foundClip: Clip | undefined;
  let foundTrackIndex = -1;

  for (let t = 0; t < document.composition.tracks.length; t++) {
    const track = document.composition.tracks[t]!;
    const c = track.clips.find((item) => item.id === targetClipId);
    if (c) {
      foundClip = c;
      foundTrackIndex = t;
      break;
    }
  }

  if (!foundClip || foundTrackIndex === -1) {
    throw new TimelineEditingError(
      `Target clip "${targetClipId}" not found in composition.`,
    );
  }

  if (transition.duration > foundClip.timelineDuration) {
    throw new TimelineEditingError(
      `Transition duration (${transition.duration}s) cannot exceed clip duration (${foundClip.timelineDuration}s).`,
    );
  }

  const cutTime = foundClip.timelineStart;
  const previewStart = Math.max(0, cutTime - MICRO_PREVIEW_PRE_CUT_MAX);
  const previewEnd = Math.min(
    document.composition.duration,
    cutTime + MICRO_PREVIEW_POST_CUT_MAX,
  );
  const previewDuration = Math.min(
    previewEnd - previewStart,
    MICRO_PREVIEW_MAX_DURATION,
  );

  // Deep clone composition and apply candidate transition on target clip
  const ephemeralComposition = JSON.parse(
    JSON.stringify(document.composition),
  ) as Composition;
  const ephemeralTrack = ephemeralComposition.tracks[foundTrackIndex]!;
  const ephemeralClip = ephemeralTrack.clips.find(
    (item) => item.id === targetClipId,
  )!;
  ephemeralClip.transition = {
    type: transition.type,
    duration: transition.duration,
  };

  const baseRevision = fnv1a64Mix(
    canonicalStringify({
      story: document.story,
      composition: document.composition,
    }),
  );

  const proposalId = fnv1a64Mix(
    `microPreview:${document.story.id}:${document.composition.id}:${targetClipId}:${transition.type}:${transition.duration}:${baseRevision}`,
  );

  const proposal: SceneMicroPreviewProposal = {
    version: 1,
    id: proposalId,
    storyId: document.story.id,
    compositionId: document.composition.id,
    baseRevision,
    targetClipId,
    transition,
    cutTime,
    previewStart,
    previewEnd,
    previewDuration,
    ephemeralComposition,
    createdAt: new Date().toISOString(),
  };

  return validateMicroPreviewProposal(proposal);
}

export function sampleMicroPreviewFrame(
  proposal: SceneMicroPreviewProposal,
  assets: readonly MediaAsset[],
  offsetSeconds: number,
  timebase: ProjectTimebaseV1,
): ResolvedSequenceFrame {
  validateMicroPreviewProposal(proposal);

  const clampedOffset = Math.max(
    0,
    Math.min(proposal.previewDuration, offsetSeconds),
  );
  const absoluteTime = proposal.previewStart + clampedOffset;
  const frameNumber = sequenceFrameAt(absoluteTime, timebase, "nearest");

  return resolveCompositionFrame(
    proposal.ephemeralComposition,
    assets,
    frameNumber,
    timebase,
  );
}
