// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { describe, expect, it } from "vitest";
import { ApplicationError } from "../src/errors.js";
import {
  RHYTHM_SNAP_DEFAULT_TOLERANCE,
  RHYTHM_SNAP_MAX_TOLERANCE,
  validateRhythmAnalysisEvidence,
  validateRhythmLandmark,
  validateRhythmSnapProposal,
} from "../src/rhythm.js";

const VALID_HEX_64_A = "a".repeat(64);
const VALID_HEX_64_B = "b".repeat(64);

describe("rhythm core models & validation", () => {
  it("validates rhythm landmark correctly", () => {
    const valid = validateRhythmLandmark({
      time: 1.5,
      kind: "downbeat",
      confidence: 0.95,
      strength: 0.8,
    });
    expect(valid).toEqual({
      time: 1.5,
      kind: "downbeat",
      confidence: 0.95,
      strength: 0.8,
    });

    try {
      validateRhythmLandmark({
        time: -0.1,
        kind: "downbeat",
        confidence: 0.9,
        strength: 0.8,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationError);
      expect((err as ApplicationError).code).toBe("rhythm.invalidEvidence");
    }

    try {
      validateRhythmLandmark({
        time: 1.0,
        kind: "invalid-kind",
        confidence: 0.9,
        strength: 0.8,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationError);
      expect((err as ApplicationError).code).toBe("rhythm.invalidEvidence");
    }

    try {
      validateRhythmLandmark({
        time: 1.0,
        kind: "onset",
        confidence: 1.5,
        strength: 0.8,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationError);
      expect((err as ApplicationError).code).toBe("rhythm.invalidEvidence");
    }
  });

  it("validates rhythm analysis evidence", () => {
    const valid = validateRhythmAnalysisEvidence({
      version: 1,
      assetId: "asset-1",
      sourceHash: VALID_HEX_64_A,
      tempoBpm: 128,
      meterNumerator: 4,
      meterDenominator: 4,
      reliability: 0.92,
      landmarks: [
        { time: 0.5, kind: "onset", confidence: 0.8, strength: 0.7 },
        { time: 1.0, kind: "downbeat", confidence: 0.95, strength: 0.9 },
        { time: 4.0, kind: "phrase", confidence: 0.9, strength: 0.85 },
      ],
      analyzedAt: "2026-10-31T12:00:00Z",
    });

    expect(valid.version).toBe(1);
    expect(valid.assetId).toBe("asset-1");
    expect(valid.sourceHash).toBe(VALID_HEX_64_A);
    expect(valid.landmarks.length).toBe(3);
    expect(valid.tempoBpm).toBe(128);

    // Rejects unsorted landmarks
    try {
      validateRhythmAnalysisEvidence({
        version: 1,
        assetId: "asset-1",
        sourceHash: VALID_HEX_64_A,
        reliability: 0.9,
        landmarks: [
          { time: 2.0, kind: "downbeat", confidence: 0.9, strength: 0.8 },
          { time: 1.0, kind: "onset", confidence: 0.8, strength: 0.7 },
        ],
        analyzedAt: "2026-10-31T12:00:00Z",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationError);
      expect((err as ApplicationError).code).toBe("rhythm.invalidEvidence");
      expect((err as Error).message).toMatch(/sorted ascending by time/i);
    }

    // Rejects invalid source hash
    try {
      validateRhythmAnalysisEvidence({
        version: 1,
        assetId: "asset-1",
        sourceHash: "not-a-64-hex",
        reliability: 0.9,
        landmarks: [],
        analyzedAt: "2026-10-31T12:00:00Z",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationError);
      expect((err as ApplicationError).code).toBe("rhythm.invalidEvidence");
    }
  });

  it("validates rhythm snap proposal", () => {
    const proposal = validateRhythmSnapProposal({
      version: 1,
      id: VALID_HEX_64_A,
      compositionId: "comp-1",
      clipId: "clip-1",
      baseRevision: VALID_HEX_64_B,
      targetEdge: "cut",
      requestedTime: 1.95,
      snappedTime: 2.0,
      delta: 0.05,
      targetLandmark: {
        time: 1.0,
        kind: "downbeat",
        confidence: 0.9,
        strength: 0.8,
        timelineTime: 2.0,
        clipId: "clip-1",
        assetId: "asset-1",
      },
      tolerance: RHYTHM_SNAP_DEFAULT_TOLERANCE,
      bypassed: false,
      createdAt: "2026-10-31T12:00:00Z",
    });

    expect(proposal.id).toBe(VALID_HEX_64_A);
    expect(proposal.targetEdge).toBe("cut");
    expect(proposal.delta).toBeCloseTo(0.05);
    expect(proposal.bypassed).toBe(false);

    // Rejects tolerance exceeding max
    expect(() =>
      validateRhythmSnapProposal({
        ...proposal,
        tolerance: RHYTHM_SNAP_MAX_TOLERANCE + 0.1,
      }),
    ).toThrow(/tolerance must be positive and at most/i);

    // Rejects invalid targetEdge
    expect(() =>
      validateRhythmSnapProposal({
        ...proposal,
        targetEdge: "unknown-edge",
      }),
    ).toThrow(/targetEdge must be 'in', 'out', or 'cut'/i);
  });
});
