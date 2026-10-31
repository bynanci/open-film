// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { ApplicationError } from "./errors.js";
import { type Composition, type TransitionType } from "./models.js";

export const MICRO_PREVIEW_PRE_CUT_MAX = 2.0;
export const MICRO_PREVIEW_POST_CUT_MAX = 3.0;
export const MICRO_PREVIEW_MAX_DURATION = 5.0;

export interface SceneMicroPreviewProposal {
  version: 1;
  id: string; // 64-char hex
  storyId: string;
  compositionId: string;
  baseRevision: string; // 64-char hex
  targetClipId: string;
  transition: {
    type: TransitionType;
    duration: number;
  };
  cutTime: number;
  previewStart: number;
  previewEnd: number;
  previewDuration: number;
  ephemeralComposition: Composition;
  createdAt: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hex64(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

export function validateMicroPreviewProposal(
  value: unknown,
): SceneMicroPreviewProposal {
  if (!record(value)) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview proposal must be an object.",
    );
  }
  if (value.version !== 1) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview proposal version must be 1.",
    );
  }
  if (!hex64(value.id)) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview proposal id must be a 64-character hex digest.",
    );
  }
  if (typeof value.storyId !== "string" || !value.storyId.trim()) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview proposal storyId must be a non-empty string.",
    );
  }
  if (typeof value.compositionId !== "string" || !value.compositionId.trim()) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview proposal compositionId must be a non-empty string.",
    );
  }
  if (!hex64(value.baseRevision)) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview proposal baseRevision must be a 64-character hex digest.",
    );
  }
  if (typeof value.targetClipId !== "string" || !value.targetClipId.trim()) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview targetClipId must be a non-empty string.",
    );
  }
  if (!record(value.transition)) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview proposal transition must be an object.",
    );
  }
  const tType = value.transition.type;
  if (
    tType !== "crossfade" &&
    tType !== "dip-to-black" &&
    tType !== "dip-to-white"
  ) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview transition type must be crossfade, dip-to-black, or dip-to-white.",
    );
  }
  const tDuration = value.transition.duration;
  if (
    typeof tDuration !== "number" ||
    !Number.isFinite(tDuration) ||
    tDuration <= 0
  ) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview transition duration must be a positive finite number.",
    );
  }
  if (
    typeof value.cutTime !== "number" ||
    !Number.isFinite(value.cutTime) ||
    value.cutTime < 0
  ) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview cutTime must be a non-negative finite number.",
    );
  }
  if (
    typeof value.previewStart !== "number" ||
    !Number.isFinite(value.previewStart) ||
    value.previewStart < 0
  ) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview previewStart must be a non-negative finite number.",
    );
  }
  if (
    typeof value.previewEnd !== "number" ||
    !Number.isFinite(value.previewEnd) ||
    value.previewEnd < value.previewStart
  ) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview previewEnd must be >= previewStart.",
    );
  }
  const duration =
    (value.previewEnd as number) - (value.previewStart as number);
  if (duration > MICRO_PREVIEW_MAX_DURATION + 0.001) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      `Micro-preview duration (${duration}s) exceeds maximum allowed (${MICRO_PREVIEW_MAX_DURATION}s).`,
    );
  }
  if (!record(value.ephemeralComposition)) {
    throw new ApplicationError(
      "microPreview.invalidProposal",
      "Micro-preview proposal ephemeralComposition must be an object.",
    );
  }

  return value as unknown as SceneMicroPreviewProposal;
}
