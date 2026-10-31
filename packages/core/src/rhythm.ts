// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { ApplicationError } from "./errors.js";

export type RhythmLandmarkKind = "onset" | "downbeat" | "phrase";

export const RHYTHM_LANDMARK_KINDS: readonly RhythmLandmarkKind[] = [
  "onset",
  "downbeat",
  "phrase",
];

export const RHYTHM_SNAP_DEFAULT_TOLERANCE = 0.25;
export const RHYTHM_SNAP_MAX_TOLERANCE = 0.5;

export interface RhythmLandmark {
  time: number;
  kind: RhythmLandmarkKind;
  confidence: number;
  strength: number;
}

export interface RhythmAnalysisEvidence {
  version: 1;
  assetId: string;
  sourceHash: string; // 64-char hex
  tempoBpm?: number;
  meterNumerator?: number;
  meterDenominator?: number;
  reliability: number;
  landmarks: readonly RhythmLandmark[];
  analyzedAt: string;
}

export interface TimelineRhythmLandmark extends RhythmLandmark {
  timelineTime: number;
  clipId: string;
  assetId: string;
}

export type RhythmSnapTargetEdge = "in" | "out" | "cut";

export interface RhythmSnapProposal {
  version: 1;
  id: string; // 64-char hex
  compositionId: string;
  clipId: string;
  baseRevision: string; // 64-char hex
  targetEdge: RhythmSnapTargetEdge;
  requestedTime: number;
  snappedTime: number;
  delta: number;
  targetLandmark?: TimelineRhythmLandmark;
  tolerance: number;
  bypassed: boolean;
  createdAt: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hex64(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function unitInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export function validateRhythmLandmark(value: unknown): RhythmLandmark {
  if (!record(value)) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm landmark must be an object.",
    );
  }
  if (!finiteNonNegative(value.time)) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm landmark time must be a non-negative finite number.",
    );
  }
  if (
    typeof value.kind !== "string" ||
    !RHYTHM_LANDMARK_KINDS.includes(value.kind as RhythmLandmarkKind)
  ) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      `Rhythm landmark kind must be one of: ${RHYTHM_LANDMARK_KINDS.join(", ")}.`,
    );
  }
  if (!unitInterval(value.confidence)) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm landmark confidence must be between 0 and 1.",
    );
  }
  if (!unitInterval(value.strength)) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm landmark strength must be between 0 and 1.",
    );
  }
  return {
    time: Number(value.time),
    kind: value.kind as RhythmLandmarkKind,
    confidence: Number(value.confidence),
    strength: Number(value.strength),
  };
}

export function validateRhythmAnalysisEvidence(
  value: unknown,
): RhythmAnalysisEvidence {
  if (!record(value)) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm analysis evidence must be an object.",
    );
  }
  if (value.version !== 1) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm analysis evidence version must be 1.",
    );
  }
  if (typeof value.assetId !== "string" || !value.assetId.trim()) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm analysis evidence assetId must be a non-empty string.",
    );
  }
  if (!hex64(value.sourceHash)) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm analysis evidence sourceHash must be a 64-character hex digest.",
    );
  }
  if (
    value.tempoBpm !== undefined &&
    (!Number.isFinite(value.tempoBpm) || Number(value.tempoBpm) <= 0)
  ) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm analysis evidence tempoBpm must be a positive number.",
    );
  }
  if (
    value.meterNumerator !== undefined &&
    (!Number.isInteger(value.meterNumerator) ||
      Number(value.meterNumerator) <= 0)
  ) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm analysis evidence meterNumerator must be a positive integer.",
    );
  }
  if (
    value.meterDenominator !== undefined &&
    (!Number.isInteger(value.meterDenominator) ||
      Number(value.meterDenominator) <= 0)
  ) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm analysis evidence meterDenominator must be a positive integer.",
    );
  }
  if (!unitInterval(value.reliability)) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm analysis evidence reliability must be between 0 and 1.",
    );
  }
  if (!Array.isArray(value.landmarks)) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm analysis evidence landmarks must be an array.",
    );
  }
  if (
    typeof value.analyzedAt !== "string" ||
    Number.isNaN(Date.parse(value.analyzedAt))
  ) {
    throw new ApplicationError(
      "rhythm.invalidEvidence",
      "Rhythm analysis evidence analyzedAt must be a valid ISO timestamp.",
    );
  }

  const validatedLandmarks: RhythmLandmark[] = [];
  let prevTime = -1;
  for (const item of value.landmarks) {
    const landmark = validateRhythmLandmark(item);
    if (landmark.time < prevTime) {
      throw new ApplicationError(
        "rhythm.invalidEvidence",
        "Rhythm analysis evidence landmarks must be sorted ascending by time.",
      );
    }
    prevTime = landmark.time;
    validatedLandmarks.push(landmark);
  }

  return {
    version: 1,
    assetId: value.assetId.trim(),
    sourceHash: value.sourceHash.toLowerCase(),
    tempoBpm: value.tempoBpm !== undefined ? Number(value.tempoBpm) : undefined,
    meterNumerator:
      value.meterNumerator !== undefined
        ? Number(value.meterNumerator)
        : undefined,
    meterDenominator:
      value.meterDenominator !== undefined
        ? Number(value.meterDenominator)
        : undefined,
    reliability: Number(value.reliability),
    landmarks: Object.freeze(validatedLandmarks),
    analyzedAt: value.analyzedAt,
  };
}

export function validateRhythmSnapProposal(value: unknown): RhythmSnapProposal {
  if (!record(value)) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal must be an object.",
    );
  }
  if (value.version !== 1) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal version must be 1.",
    );
  }
  if (!hex64(value.id)) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal id must be a 64-character hex digest.",
    );
  }
  if (typeof value.compositionId !== "string" || !value.compositionId.trim()) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal compositionId must be a non-empty string.",
    );
  }
  if (typeof value.clipId !== "string" || !value.clipId.trim()) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal clipId must be a non-empty string.",
    );
  }
  if (!hex64(value.baseRevision)) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal baseRevision must be a 64-character hex digest.",
    );
  }
  if (
    typeof value.targetEdge !== "string" ||
    !["in", "out", "cut"].includes(value.targetEdge)
  ) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal targetEdge must be 'in', 'out', or 'cut'.",
    );
  }
  if (!finiteNonNegative(value.requestedTime)) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal requestedTime must be a non-negative finite number.",
    );
  }
  if (!finiteNonNegative(value.snappedTime)) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal snappedTime must be a non-negative finite number.",
    );
  }
  if (!Number.isFinite(value.delta)) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal delta must be a finite number.",
    );
  }
  if (
    !Number.isFinite(value.tolerance) ||
    Number(value.tolerance) <= 0 ||
    Number(value.tolerance) > RHYTHM_SNAP_MAX_TOLERANCE
  ) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      `Rhythm snap proposal tolerance must be positive and at most ${RHYTHM_SNAP_MAX_TOLERANCE} seconds.`,
    );
  }
  if (typeof value.bypassed !== "boolean") {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal bypassed must be a boolean.",
    );
  }
  if (
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt))
  ) {
    throw new ApplicationError(
      "rhythm.invalidProposal",
      "Rhythm snap proposal createdAt must be a valid ISO timestamp.",
    );
  }

  let validatedLandmark: TimelineRhythmLandmark | undefined;
  if (value.targetLandmark !== undefined) {
    if (!record(value.targetLandmark)) {
      throw new ApplicationError(
        "rhythm.invalidProposal",
        "Rhythm snap proposal targetLandmark must be an object when provided.",
      );
    }
    const baseLandmark = validateRhythmLandmark(value.targetLandmark);
    if (!finiteNonNegative(value.targetLandmark.timelineTime)) {
      throw new ApplicationError(
        "rhythm.invalidProposal",
        "Rhythm snap proposal targetLandmark timelineTime must be a non-negative finite number.",
      );
    }
    if (
      typeof value.targetLandmark.clipId !== "string" ||
      !value.targetLandmark.clipId.trim()
    ) {
      throw new ApplicationError(
        "rhythm.invalidProposal",
        "Rhythm snap proposal targetLandmark clipId must be a non-empty string.",
      );
    }
    if (
      typeof value.targetLandmark.assetId !== "string" ||
      !value.targetLandmark.assetId.trim()
    ) {
      throw new ApplicationError(
        "rhythm.invalidProposal",
        "Rhythm snap proposal targetLandmark assetId must be a non-empty string.",
      );
    }
    validatedLandmark = {
      ...baseLandmark,
      timelineTime: Number(value.targetLandmark.timelineTime),
      clipId: value.targetLandmark.clipId.trim(),
      assetId: value.targetLandmark.assetId.trim(),
    };
  }

  return {
    version: 1,
    id: value.id.toLowerCase(),
    compositionId: value.compositionId.trim(),
    clipId: value.clipId.trim(),
    baseRevision: value.baseRevision.toLowerCase(),
    targetEdge: value.targetEdge as RhythmSnapTargetEdge,
    requestedTime: Number(value.requestedTime),
    snappedTime: Number(value.snappedTime),
    delta: Number(value.delta),
    targetLandmark: validatedLandmark,
    tolerance: Number(value.tolerance),
    bypassed: Boolean(value.bypassed),
    createdAt: value.createdAt,
  };
}
