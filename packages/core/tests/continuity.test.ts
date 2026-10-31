import { describe, expect, it } from "vitest";
import {
  ApplicationError,
  MAX_CONTINUITY_RECEIPTS,
  validateContinuityProposal,
  validateContinuityReceipt,
  type ContinuityProposal,
  type ContinuityReceipt,
} from "../src/index.js";

const digest = (char = "a") => char.repeat(64);

describe("Continuity Core Contract", () => {
  const validProposal: ContinuityProposal = {
    version: 1,
    id: digest("1"),
    storyId: "story-1",
    compositionId: "comp-1",
    baseRevision: digest("2"),
    contextSignature: digest("3"),
    diagnostics: [
      {
        id: digest("4"),
        code: "continuity.missingShotLanguage",
        severity: "manual-review",
        fromSceneId: "scene-1",
        toSceneId: "scene-2",
        fromBeatId: "beat-1",
        toBeatId: "beat-2",
        affectedClipIds: ["clip-1", "clip-2"],
        evidence: "Missing shot-scale and eyeline evidence across cut.",
        metrics: {
          missingEvidence: ["shot-scale", "eyeline", "screen-direction"],
        },
        status: "pending",
      },
    ],
    summary: {
      totalDiagnostics: 1,
      motionIssues: 0,
      durationIssues: 0,
      densityIssues: 0,
      manualReviewsRequired: 1,
    },
    createdAt: "2026-10-31T00:00:00Z",
  };

  const validReceipt: ContinuityReceipt = {
    version: 1,
    proposalId: digest("1"),
    requestId: "req-1",
    fingerprint: digest("f"),
    compositionId: "comp-1",
    storyId: "story-1",
    baseRevision: digest("2"),
    contextSignature: digest("3"),
    acceptedAt: "2026-10-31T00:00:00Z",
    acceptedRevision: digest("4"),
    overrides: [
      {
        diagnosticId: digest("4"),
        action: "override",
        userNote: "Intentional artistic jump cut.",
      },
    ],
    diagnosticsCount: 1,
  };

  it("validates a compliant ContinuityProposal", () => {
    const validated = validateContinuityProposal(validProposal);
    expect(validated.version).toBe(1);
    expect(validated.diagnostics).toHaveLength(1);
    expect(validated.diagnostics[0]!.severity).toBe("manual-review");
  });

  it("rejects invalid continuity proposal properties", () => {
    expect(() => validateContinuityProposal(null)).toThrow(ApplicationError);
    expect(() =>
      validateContinuityProposal({ ...validProposal, version: 2 }),
    ).toThrow(ApplicationError);
    expect(() =>
      validateContinuityProposal({ ...validProposal, id: "short-id" }),
    ).toThrow(ApplicationError);
    expect(() =>
      validateContinuityProposal({ ...validProposal, storyId: "" }),
    ).toThrow(ApplicationError);
    expect(() =>
      validateContinuityProposal({ ...validProposal, diagnostics: "invalid" }),
    ).toThrow(ApplicationError);
  });

  it("validates a compliant ContinuityReceipt", () => {
    const validated = validateContinuityReceipt(validReceipt);
    expect(validated.version).toBe(1);
    expect(validated.overrides).toHaveLength(1);
    expect(validated.overrides[0]!.action).toBe("override");
  });

  it("rejects invalid continuity receipt properties", () => {
    expect(() => validateContinuityReceipt(null)).toThrow(ApplicationError);
    expect(() =>
      validateContinuityReceipt({ ...validReceipt, version: 2 }),
    ).toThrow(ApplicationError);
    expect(() =>
      validateContinuityReceipt({ ...validReceipt, requestId: "" }),
    ).toThrow(ApplicationError);
    expect(() =>
      validateContinuityReceipt({ ...validReceipt, proposalId: "not-hex" }),
    ).toThrow(ApplicationError);
    expect(() =>
      validateContinuityReceipt({
        ...validReceipt,
        acceptedAt: "invalid-date",
      }),
    ).toThrow(ApplicationError);
  });

  it("enforces MAX_CONTINUITY_RECEIPTS constant", () => {
    expect(MAX_CONTINUITY_RECEIPTS).toBe(100);
  });
});
