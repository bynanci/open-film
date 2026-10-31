// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { describe, expect, it } from "vitest";
import {
  ApplicationError,
  type Clip,
  type Composition,
  type MediaAsset,
  type RhythmAnalysisEvidence,
} from "@openfilm/core";
import {
  applyRhythmSnap,
  buildRhythmSnapProposal,
  projectClipRhythmLandmarks,
} from "../src/index.js";

const VALID_HASH_A = "a".repeat(64);
const VALID_HASH_B = "b".repeat(64);

function createMockAsset(id: string, hash: string, duration = 10): MediaAsset {
  return {
    id,
    name: `Asset ${id}`,
    uri: `file:///media/${id}.mp4`,
    mediaType: "video",
    duration,
    tags: [],
    metadata: {},
    contentHash: hash,
    state: {
      locked: false,
      favorite: false,
    },
  };
}

function createMockComposition(clip: Clip): Composition {
  return {
    id: "comp-1",
    storyId: "story-default",
    duration: 10,
    tracks: [
      {
        id: "v1",
        type: "video",
        clips: [clip],
      },
    ],
  };
}

describe("solver rhythm snapping and landmark projection", () => {
  it("projects rhythm landmarks into timeline sequence time with trim and speed scaling", () => {
    const asset = createMockAsset("asset-1", VALID_HASH_A, 10);
    const clip: Clip = {
      id: "clip-1",
      assetId: "asset-1",
      timelineStart: 5.0,
      timelineDuration: 4.0,
      sourceIn: 1.0,
      sourceOut: 9.0,
      transform: { speed: 2.0 },
    };

    const evidence: RhythmAnalysisEvidence = {
      version: 1,
      assetId: "asset-1",
      sourceHash: VALID_HASH_A,
      reliability: 0.9,
      landmarks: [
        { time: 0.5, kind: "onset", confidence: 0.8, strength: 0.7 }, // outside [1, 9]
        { time: 3.0, kind: "downbeat", confidence: 0.95, strength: 0.9 }, // 5 + (3 - 1)/2 = 6.0
        { time: 5.0, kind: "phrase", confidence: 0.9, strength: 0.85 }, // 5 + (5 - 1)/2 = 7.0
        { time: 9.5, kind: "onset", confidence: 0.7, strength: 0.6 }, // outside [1, 9]
      ],
      analyzedAt: "2026-10-31T12:00:00Z",
    };

    const projected = projectClipRhythmLandmarks(clip, asset, evidence);
    expect(projected.length).toBe(2);
    expect(projected[0]?.timelineTime).toBeCloseTo(6.0);
    expect(projected[0]?.kind).toBe("downbeat");
    expect(projected[1]?.timelineTime).toBeCloseTo(7.0);
    expect(projected[1]?.kind).toBe("phrase");
  });

  it("fails closed when asset contentHash does not match evidence sourceHash", () => {
    const asset = createMockAsset("asset-1", VALID_HASH_B, 10);
    const clip: Clip = {
      id: "clip-1",
      assetId: "asset-1",
      timelineStart: 0,
      timelineDuration: 5,
      sourceIn: 0,
      sourceOut: 5,
    };

    const evidence: RhythmAnalysisEvidence = {
      version: 1,
      assetId: "asset-1",
      sourceHash: VALID_HASH_A,
      reliability: 0.9,
      landmarks: [
        { time: 2.0, kind: "downbeat", confidence: 0.9, strength: 0.8 },
      ],
      analyzedAt: "2026-10-31T12:00:00Z",
    };

    try {
      projectClipRhythmLandmarks(clip, asset, evidence);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationError);
      expect((err as ApplicationError).code).toBe("rhythm.sourceMismatch");
    }
  });

  it("builds a bounded rhythm snap proposal with nearest landmark selection and tiebreakers", () => {
    const asset = createMockAsset("asset-1", VALID_HASH_A, 10);
    const clip: Clip = {
      id: "clip-1",
      assetId: "asset-1",
      timelineStart: 0,
      timelineDuration: 10,
      sourceIn: 0,
      sourceOut: 10,
    };
    const composition = createMockComposition(clip);

    const evidence: RhythmAnalysisEvidence = {
      version: 1,
      assetId: "asset-1",
      sourceHash: VALID_HASH_A,
      reliability: 0.95,
      landmarks: [
        { time: 2.0, kind: "onset", confidence: 0.9, strength: 0.8 },
        { time: 4.0, kind: "phrase", confidence: 0.9, strength: 0.8 },
        { time: 4.0, kind: "downbeat", confidence: 0.9, strength: 0.8 },
      ],
      analyzedAt: "2026-10-31T12:00:00Z",
    };

    // Requested time 2.08 is within 0.25 tolerance of 2.0
    const proposal = buildRhythmSnapProposal({
      composition,
      clipId: "clip-1",
      asset,
      evidence,
      targetEdge: "cut",
      requestedTime: 2.08,
    });

    expect(proposal.snappedTime).toBeCloseTo(2.0);
    expect(proposal.delta).toBeCloseTo(-0.08);
    expect(proposal.targetLandmark?.kind).toBe("onset");
    expect(proposal.bypassed).toBe(false);

    // Bypass flag retains requested time
    const bypassed = buildRhythmSnapProposal({
      composition,
      clipId: "clip-1",
      asset,
      evidence,
      targetEdge: "cut",
      requestedTime: 2.08,
      bypass: true,
    });
    expect(bypassed.snappedTime).toBe(2.08);
    expect(bypassed.delta).toBe(0);
    expect(bypassed.bypassed).toBe(true);

    // Beyond tolerance keeps requested time without snapping
    const noSnap = buildRhythmSnapProposal({
      composition,
      clipId: "clip-1",
      asset,
      evidence,
      targetEdge: "cut",
      requestedTime: 2.8,
      tolerance: 0.2,
    });
    expect(noSnap.snappedTime).toBe(2.8);
    expect(noSnap.targetLandmark).toBeUndefined();

    // Tiebreaker: at 4.0, phrase beats downbeat
    const tiebreaker = buildRhythmSnapProposal({
      composition,
      clipId: "clip-1",
      asset,
      evidence,
      targetEdge: "cut",
      requestedTime: 4.05,
    });
    expect(tiebreaker.targetLandmark?.kind).toBe("phrase");
  });

  it("applies rhythm snap cut to composition as an atomic undoable operation", () => {
    const asset = createMockAsset("asset-1", VALID_HASH_A, 10);
    const clip: Clip = {
      id: "clip-1",
      assetId: "asset-1",
      timelineStart: 0,
      timelineDuration: 8,
      sourceIn: 0,
      sourceOut: 8,
    };
    const composition = createMockComposition(clip);

    const evidence: RhythmAnalysisEvidence = {
      version: 1,
      assetId: "asset-1",
      sourceHash: VALID_HASH_A,
      reliability: 0.95,
      landmarks: [
        { time: 3.0, kind: "downbeat", confidence: 0.95, strength: 0.9 },
      ],
      analyzedAt: "2026-10-31T12:00:00Z",
    };

    const proposal = buildRhythmSnapProposal({
      composition,
      clipId: "clip-1",
      asset,
      evidence,
      targetEdge: "cut",
      requestedTime: 2.95,
    });

    const updated = applyRhythmSnap(composition, proposal, [asset]);
    const track = updated.tracks[0]!;
    expect(track.clips.length).toBe(2);
    expect(track.clips[0]?.timelineDuration).toBeCloseTo(3.0);
    expect(track.clips[1]?.timelineStart).toBeCloseTo(3.0);
    expect(track.clips[1]?.timelineDuration).toBeCloseTo(5.0);
    expect(
      track.clips[0]!.timelineDuration + track.clips[1]!.timelineDuration,
    ).toBeCloseTo(8.0);
  });

  it("applies rhythm snap out-trim and rejects stale proposal when revision changes", () => {
    const asset = createMockAsset("asset-1", VALID_HASH_A, 10);
    const clip: Clip = {
      id: "clip-1",
      assetId: "asset-1",
      timelineStart: 0,
      timelineDuration: 8,
      sourceIn: 0,
      sourceOut: 8,
    };
    const composition = createMockComposition(clip);

    const evidence: RhythmAnalysisEvidence = {
      version: 1,
      assetId: "asset-1",
      sourceHash: VALID_HASH_A,
      reliability: 0.95,
      landmarks: [
        { time: 6.0, kind: "downbeat", confidence: 0.95, strength: 0.9 },
      ],
      analyzedAt: "2026-10-31T12:00:00Z",
    };

    const proposal = buildRhythmSnapProposal({
      composition,
      clipId: "clip-1",
      asset,
      evidence,
      targetEdge: "out",
      requestedTime: 5.9,
    });

    const updated = applyRhythmSnap(composition, proposal, [asset]);
    const track = updated.tracks[0]!;
    expect(track.clips.length).toBe(1);
    expect(track.clips[0]?.timelineDuration).toBeCloseTo(6.0);

    // Stale proposal rejection
    const staleProposal = {
      ...proposal,
      baseRevision: "f".repeat(64),
    };
    try {
      applyRhythmSnap(composition, staleProposal, [asset]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationError);
      expect((err as ApplicationError).code).toBe("rhythm.staleProposal");
    }
  });
});
