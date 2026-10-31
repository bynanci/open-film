// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { ApplicationError } from "./errors.js";

export type ContinuitySeverity =
  "info" | "advisory" | "warning" | "manual-review";

export type ContinuityDiagnosticCode =
  | "continuity.motionClash"
  | "continuity.durationMismatch"
  | "continuity.densitySpike"
  | "continuity.missingShotLanguage";

export interface ContinuityMotionMetric {
  fromPreset?: string;
  toPreset?: string;
  clashReason?: string;
  deltaScore: number;
}

export interface ContinuityDurationMetric {
  fromDuration: number;
  toDuration: number;
  ratio: number;
  pacingMismatch: boolean;
}

export interface ContinuityDensityMetric {
  fromDensity: number;
  toDensity: number;
  ratio: number;
  spike: boolean;
}

export interface ContinuityMetric {
  motionDelta?: ContinuityMotionMetric;
  durationDelta?: ContinuityDurationMetric;
  densityDelta?: ContinuityDensityMetric;
  missingEvidence?: string[];
}

export interface ContinuityAdvisory {
  emotionalShift?: string;
  suggestion?: string;
  suggestedDirection?: "contain" | "hero" | "hold" | "push-in" | "pan";
  suggestedAction?: {
    clipId: string;
    kind: "layout" | "motion";
    value: string;
  };
}

export interface ContinuityDiagnostic {
  id: string;
  code: ContinuityDiagnosticCode;
  severity: ContinuitySeverity;
  fromSceneId: string;
  toSceneId: string;
  fromBeatId?: string;
  toBeatId?: string;
  affectedClipIds: string[];
  evidence: string;
  metrics: ContinuityMetric;
  advisoryGuidance?: ContinuityAdvisory;
  status: "pending" | "overridden" | "accepted" | "dismissed";
  userNote?: string;
}

export interface ContinuityProposalSummary {
  totalDiagnostics: number;
  motionIssues: number;
  durationIssues: number;
  densityIssues: number;
  manualReviewsRequired: number;
}

export interface ContinuityProposal {
  version: 1;
  id: string;
  storyId: string;
  compositionId: string;
  baseRevision: string;
  contextSignature: string;
  diagnostics: ContinuityDiagnostic[];
  summary: ContinuityProposalSummary;
  createdAt: string;
}

export interface ContinuityOverride {
  diagnosticId: string;
  action: "override" | "dismiss" | "accept-direction";
  userNote?: string;
  suggestedDirection?: "contain" | "hero" | "hold" | "push-in" | "pan";
}

export const MAX_CONTINUITY_RECEIPTS = 100;

export interface ContinuityReceipt {
  version: 1;
  proposalId: string;
  requestId: string;
  fingerprint: string;
  compositionId: string;
  storyId: string;
  baseRevision: string;
  contextSignature: string;
  acceptedAt: string;
  acceptedRevision: string;
  overrides: ContinuityOverride[];
  diagnosticsCount: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hex64(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

export function validateContinuityProposal(value: unknown): ContinuityProposal {
  if (!record(value)) {
    throw new ApplicationError(
      "continuity.invalidProposal",
      "Continuity proposal must be an object.",
    );
  }
  if (value.version !== 1) {
    throw new ApplicationError(
      "continuity.invalidProposal",
      "Continuity proposal version must be 1.",
    );
  }
  if (!hex64(value.id)) {
    throw new ApplicationError(
      "continuity.invalidProposal",
      "Continuity proposal id must be a 64-character hex digest.",
    );
  }
  if (typeof value.storyId !== "string" || !value.storyId.trim()) {
    throw new ApplicationError(
      "continuity.invalidProposal",
      "Continuity proposal storyId must be a non-empty string.",
    );
  }
  if (typeof value.compositionId !== "string" || !value.compositionId.trim()) {
    throw new ApplicationError(
      "continuity.invalidProposal",
      "Continuity proposal compositionId must be a non-empty string.",
    );
  }
  if (!hex64(value.baseRevision) || !hex64(value.contextSignature)) {
    throw new ApplicationError(
      "continuity.invalidProposal",
      "Continuity proposal baseRevision and contextSignature must be 64-character hex digests.",
    );
  }
  if (!Array.isArray(value.diagnostics)) {
    throw new ApplicationError(
      "continuity.invalidProposal",
      "Continuity proposal diagnostics must be an array.",
    );
  }
  for (const diag of value.diagnostics) {
    if (!record(diag) || typeof diag.id !== "string" || !diag.id.trim()) {
      throw new ApplicationError(
        "continuity.invalidProposal",
        "Each diagnostic must have a valid non-empty id.",
      );
    }
    if (
      !["info", "advisory", "warning", "manual-review"].includes(
        diag.severity as string,
      )
    ) {
      throw new ApplicationError(
        "continuity.invalidProposal",
        `Invalid diagnostic severity '${String(diag.severity)}'.`,
      );
    }
    if (typeof diag.evidence !== "string") {
      throw new ApplicationError(
        "continuity.invalidProposal",
        "Diagnostic evidence must be a string.",
      );
    }
    if (!Array.isArray(diag.affectedClipIds)) {
      throw new ApplicationError(
        "continuity.invalidProposal",
        "Diagnostic affectedClipIds must be an array.",
      );
    }
  }
  if (!record(value.summary)) {
    throw new ApplicationError(
      "continuity.invalidProposal",
      "Continuity proposal summary must be an object.",
    );
  }
  return value as unknown as ContinuityProposal;
}

export function validateContinuityReceipt(value: unknown): ContinuityReceipt {
  if (!record(value)) {
    throw new ApplicationError(
      "request.invalid",
      "Continuity receipt must be an object.",
    );
  }
  if (value.version !== 1) {
    throw new ApplicationError(
      "request.invalid",
      "Continuity receipt version must be 1.",
    );
  }
  for (const key of [
    "proposalId",
    "fingerprint",
    "baseRevision",
    "contextSignature",
    "acceptedRevision",
  ]) {
    if (!hex64(value[key])) {
      throw new ApplicationError(
        "request.invalid",
        `Continuity receipt ${key} must be a 64-character hex digest.`,
      );
    }
  }
  if (typeof value.requestId !== "string" || !value.requestId.trim()) {
    throw new ApplicationError(
      "request.invalid",
      "Continuity receipt requestId must be a non-empty string.",
    );
  }
  if (
    typeof value.compositionId !== "string" ||
    !value.compositionId.trim() ||
    typeof value.storyId !== "string" ||
    !value.storyId.trim()
  ) {
    throw new ApplicationError(
      "request.invalid",
      "Continuity receipt compositionId and storyId must be non-empty strings.",
    );
  }
  if (
    typeof value.acceptedAt !== "string" ||
    !Number.isFinite(Date.parse(value.acceptedAt))
  ) {
    throw new ApplicationError(
      "request.invalid",
      "Continuity receipt acceptedAt must be a valid ISO timestamp.",
    );
  }
  if (!Array.isArray(value.overrides)) {
    throw new ApplicationError(
      "request.invalid",
      "Continuity receipt overrides must be an array.",
    );
  }
  return value as unknown as ContinuityReceipt;
}
