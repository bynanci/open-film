// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import {
  ApplicationError,
  canonicalPresetJson,
  fnv1a64Mix,
  resolveClipSourceRange,
  RHYTHM_SNAP_DEFAULT_TOLERANCE,
  RHYTHM_SNAP_MAX_TOLERANCE,
  validateRhythmAnalysisEvidence,
  validateRhythmSnapProposal,
  type Clip,
  type Composition,
  type MediaAsset,
  type RhythmAnalysisEvidence,
  type RhythmLandmarkKind,
  type RhythmSnapProposal,
  type RhythmSnapTargetEdge,
  type TimelineRhythmLandmark,
} from "@openfilm/core";
import {
  applyTimelineCommand,
  findClip,
  type EditorDocument,
} from "./editing.js";

const KIND_PRIORITY: Record<RhythmLandmarkKind, number> = {
  phrase: 3,
  downbeat: 2,
  onset: 1,
};

/**
 * Projects rhythm landmarks from source media time to timeline sequence time,
 * taking into account sourceIn, sourceOut, speed, and timelineStart.
 *
 * Fails closed if the asset's contentHash does not match the evidence sourceHash,
 * preventing stale analysis from influencing edit decisions.
 */
export function projectClipRhythmLandmarks(
  clip: Clip,
  asset: MediaAsset,
  evidence: RhythmAnalysisEvidence,
): readonly TimelineRhythmLandmark[] {
  validateRhythmAnalysisEvidence(evidence);

  if (clip.assetId !== asset.id) {
    throw new ApplicationError(
      "rhythm.conflict",
      `Clip asset ID "${clip.assetId}" does not match provided asset ID "${asset.id}".`,
    );
  }
  if (evidence.assetId !== asset.id) {
    throw new ApplicationError(
      "rhythm.conflict",
      `Evidence asset ID "${evidence.assetId}" does not match asset ID "${asset.id}".`,
    );
  }
  if (
    asset.contentHash &&
    asset.contentHash.toLowerCase() !== evidence.sourceHash.toLowerCase()
  ) {
    throw new ApplicationError(
      "rhythm.sourceMismatch",
      `Source asset content hash "${asset.contentHash}" does not match rhythm analysis evidence source hash "${evidence.sourceHash}".`,
    );
  }
  if (asset.mediaType === "image") {
    return [];
  }

  const { sourceIn, sourceOut, speed } = resolveClipSourceRange(clip, asset);

  const mapped: TimelineRhythmLandmark[] = [];
  const epsilon = 1e-4;

  for (const landmark of evidence.landmarks) {
    if (
      landmark.time >= sourceIn - epsilon &&
      landmark.time <= sourceOut + epsilon
    ) {
      const timelineTime =
        clip.timelineStart + (landmark.time - sourceIn) / speed;
      mapped.push({
        ...landmark,
        timelineTime,
        clipId: clip.id,
        assetId: asset.id,
      });
    }
  }

  mapped.sort((a, b) => a.timelineTime - b.timelineTime);
  return Object.freeze(mapped);
}

export interface BuildRhythmSnapOptions {
  composition: Composition;
  clipId: string;
  asset: MediaAsset;
  evidence: RhythmAnalysisEvidence;
  targetEdge?: RhythmSnapTargetEdge;
  requestedTime: number;
  tolerance?: number;
  bypass?: boolean;
  baseRevision?: string;
}

/**
 * Builds a bounded rhythm snap proposal around a requested timeline position.
 * If bypass is true, or no landmark is within tolerance, the proposal keeps the requested time.
 */
export function buildRhythmSnapProposal(
  options: BuildRhythmSnapOptions,
): RhythmSnapProposal {
  const {
    composition,
    clipId,
    asset,
    evidence,
    targetEdge = "cut",
    requestedTime,
    bypass = false,
  } = options;

  let targetClip: Clip | undefined;
  for (const track of composition.tracks) {
    const found = track.clips.find((c) => c.id === clipId);
    if (found) {
      targetClip = found;
      break;
    }
  }

  if (!targetClip) {
    throw new ApplicationError(
      "rhythm.conflict",
      `Clip "${clipId}" was not found in composition "${composition.id}".`,
    );
  }

  const tolerance = Math.min(
    RHYTHM_SNAP_MAX_TOLERANCE,
    Math.max(0.01, options.tolerance ?? RHYTHM_SNAP_DEFAULT_TOLERANCE),
  );

  const baseRevision =
    options.baseRevision ?? fnv1a64Mix(canonicalPresetJson({ composition }));

  if (bypass) {
    const proposalId = fnv1a64Mix(
      `rhythmSnap:${composition.id}:${clipId}:${targetEdge}:${requestedTime}:${requestedTime}:${baseRevision}:bypassed`,
    );
    return validateRhythmSnapProposal({
      version: 1,
      id: proposalId,
      compositionId: composition.id,
      clipId,
      baseRevision,
      targetEdge,
      requestedTime,
      snappedTime: requestedTime,
      delta: 0,
      tolerance,
      bypassed: true,
      createdAt: new Date().toISOString(),
    });
  }

  const landmarks = projectClipRhythmLandmarks(targetClip, asset, evidence);
  const candidates = landmarks.filter(
    (l) => Math.abs(l.timelineTime - requestedTime) <= tolerance + 1e-5,
  );

  if (candidates.length === 0) {
    const proposalId = fnv1a64Mix(
      `rhythmSnap:${composition.id}:${clipId}:${targetEdge}:${requestedTime}:${requestedTime}:${baseRevision}:nosnap`,
    );
    return validateRhythmSnapProposal({
      version: 1,
      id: proposalId,
      compositionId: composition.id,
      clipId,
      baseRevision,
      targetEdge,
      requestedTime,
      snappedTime: requestedTime,
      delta: 0,
      tolerance,
      bypassed: false,
      createdAt: new Date().toISOString(),
    });
  }

  candidates.sort((a, b) => {
    const distA = Math.abs(a.timelineTime - requestedTime);
    const distB = Math.abs(b.timelineTime - requestedTime);
    if (Math.abs(distA - distB) > 1e-4) {
      return distA - distB;
    }
    const prioDiff = KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind];
    if (prioDiff !== 0) return prioDiff;
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 1e-4) return confDiff;
    const strDiff = b.strength - a.strength;
    if (Math.abs(strDiff) > 1e-4) return strDiff;
    return a.timelineTime - b.timelineTime;
  });

  const best = candidates[0]!;
  const snappedTime = best.timelineTime;
  const delta = snappedTime - requestedTime;

  const proposalId = fnv1a64Mix(
    `rhythmSnap:${composition.id}:${clipId}:${targetEdge}:${requestedTime}:${snappedTime}:${baseRevision}`,
  );

  return validateRhythmSnapProposal({
    version: 1,
    id: proposalId,
    compositionId: composition.id,
    clipId,
    baseRevision,
    targetEdge,
    requestedTime,
    snappedTime,
    delta,
    targetLandmark: best,
    tolerance,
    bypassed: false,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Applies a verified RhythmSnapProposal to an EditorDocument, maintaining
 * transaction atomicity and single-timeline invariants.
 */
export function applyRhythmSnapProposalToDocument(
  document: EditorDocument,
  proposal: RhythmSnapProposal,
  assets: MediaAsset[],
): EditorDocument {
  const validatedProposal = validateRhythmSnapProposal(proposal);

  if (validatedProposal.compositionId !== document.composition.id) {
    throw new ApplicationError(
      "rhythm.conflict",
      "Rhythm snap proposal composition ID does not match active document composition.",
    );
  }

  const currentRevision = fnv1a64Mix(
    canonicalPresetJson({ composition: document.composition }),
  );
  if (validatedProposal.baseRevision !== currentRevision) {
    throw new ApplicationError(
      "rhythm.staleProposal",
      "Rhythm snap proposal base revision does not match current composition revision.",
    );
  }

  const { clip } = findClip(document, validatedProposal.clipId);
  const speed = clip.transform?.speed ?? 1;
  const sourceIn = clip.sourceIn ?? 0;

  if (validatedProposal.targetEdge === "cut") {
    const sourceTime =
      sourceIn + (validatedProposal.snappedTime - clip.timelineStart) * speed;
    return applyTimelineCommand(document, assets, {
      type: "clip.split",
      clipId: clip.id,
      sourceTime,
    });
  }

  if (validatedProposal.targetEdge === "out") {
    const newDuration = validatedProposal.snappedTime - clip.timelineStart;
    const sourceOut = sourceIn + newDuration * speed;
    return applyTimelineCommand(document, assets, {
      type: "trim",
      clipId: clip.id,
      sourceIn,
      sourceOut,
    });
  }

  if (validatedProposal.targetEdge === "in") {
    const sourceOut =
      clip.sourceOut ?? sourceIn + clip.timelineDuration * speed;
    const shift = validatedProposal.snappedTime - clip.timelineStart;
    const newSourceIn = sourceIn + shift * speed;
    return applyTimelineCommand(document, assets, {
      type: "trim",
      clipId: clip.id,
      sourceIn: newSourceIn,
      sourceOut,
    });
  }

  throw new ApplicationError(
    "rhythm.invalidProposal",
    `Unsupported targetEdge: "${validatedProposal.targetEdge}".`,
  );
}

/**
 * Applies a rhythm snap proposal directly to a composition and asset list.
 */
export function applyRhythmSnap(
  composition: Composition,
  proposal: RhythmSnapProposal,
  assets: MediaAsset[],
): Composition {
  const dummyStory = {
    id: "story-default",
    title: "Default Story",
    beats: [],
  };
  const doc: EditorDocument = {
    story: dummyStory,
    composition: structuredClone(composition),
  };
  const updatedDoc = applyRhythmSnapProposalToDocument(doc, proposal, assets);
  return updatedDoc.composition;
}
