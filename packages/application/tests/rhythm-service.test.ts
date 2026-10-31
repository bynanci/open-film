// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Clip, type RhythmAnalysisEvidence } from "@openfilm/core";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";

const VALID_HASH_A = "a".repeat(64);
const VALID_HASH_B = "b".repeat(64);

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanups.splice(0).reverse()) await action();
});

describe("RhythmService", () => {
  let app: OpenFilmApplication;
  const compositionId = "comp-1";

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-rhythm-test-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    const projectDir = join(root, "RhythmTest.openfilm");
    app = await OpenFilmApplication.create(projectDir, "Rhythm Test Project", {
      projectContentLocale: "zh-TW",
    });
    cleanups.push(async () => {
      app.close();
    });

    // Seed assets into catalog
    app.catalog.upsertAsset({
      id: "asset-1",
      uri: "file:///media/a.mp4",
      mediaType: "video",
      name: "Asset A",
      duration: 10,
      tags: [],
      contentHash: VALID_HASH_A,
      state: { locked: false, favorite: false },
      metadata: {},
    });

    // Seed story
    app.project.stories.push({
      id: "story-1",
      title: "Story",
      beats: [{ id: "b1", title: "Scene 1", targetDuration: 8 }],
    });

    // Seed composition with clip
    app.project.timelines.push({
      id: compositionId,
      storyId: "story-1",
      duration: 8.0,
      tracks: [
        {
          id: "track-1",
          type: "video",
          clips: [
            {
              id: "c1",
              assetId: "asset-1",
              beatId: "b1",
              timelineStart: 0,
              timelineDuration: 8.0,
              sourceIn: 0,
              sourceOut: 8.0,
            } as Clip,
          ],
        },
      ],
    });
  });

  it("stores and retrieves rhythm analysis evidence bound to asset content hash", () => {
    const evidence: RhythmAnalysisEvidence = {
      version: 1,
      assetId: "asset-1",
      sourceHash: VALID_HASH_A,
      reliability: 0.95,
      landmarks: [
        { time: 2.0, kind: "onset", confidence: 0.8, strength: 0.7 },
        { time: 4.0, kind: "downbeat", confidence: 0.95, strength: 0.9 },
      ],
      analyzedAt: "2026-10-31T12:00:00Z",
    };

    app.rhythm.storeEvidence(evidence);
    const retrieved = app.rhythm.getEvidence("asset-1");
    expect(retrieved).toBeDefined();
    expect(retrieved?.landmarks.length).toBe(2);

    // Mismatched hash returns undefined
    const wrongHash = app.rhythm.getEvidence("asset-1", VALID_HASH_B);
    expect(wrongHash).toBeUndefined();

    // Clear cache
    app.rhythm.clearEvidence("asset-1");
    expect(app.rhythm.getEvidence("asset-1")).toBeUndefined();
  });

  it("projects clip rhythm landmarks correctly", () => {
    const evidence: RhythmAnalysisEvidence = {
      version: 1,
      assetId: "asset-1",
      sourceHash: VALID_HASH_A,
      reliability: 0.9,
      landmarks: [
        { time: 2.0, kind: "downbeat", confidence: 0.95, strength: 0.9 },
        { time: 6.0, kind: "phrase", confidence: 0.9, strength: 0.85 },
      ],
      analyzedAt: "2026-10-31T12:00:00Z",
    };
    app.rhythm.storeEvidence(evidence);

    const landmarks = app.rhythm.getLandmarksForClip("c1", { compositionId });
    expect(landmarks.length).toBe(2);
    expect(landmarks[0]?.timelineTime).toBeCloseTo(2.0);
    expect(landmarks[1]?.timelineTime).toBeCloseTo(6.0);
  });

  it("proposes snap and applies it through TimelineEditor with full undo/redo support", async () => {
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
    app.rhythm.storeEvidence(evidence);

    const editor = new TimelineEditor(app);

    // Propose snap near 3.0
    const proposal = app.rhythm.proposeSnap("c1", 3.05, {
      compositionId,
      targetEdge: "cut",
    });

    expect(proposal.snappedTime).toBeCloseTo(3.0);
    expect(proposal.delta).toBeCloseTo(-0.05);
    expect(proposal.targetLandmark?.kind).toBe("downbeat");

    // Apply snap using the same editor session
    await app.rhythm.applySnap(proposal.id, { compositionId, editor });

    const timeline = app.project.timelines.find((t) => t.id === compositionId)!;
    expect(timeline.tracks[0]?.clips.length).toBe(2);
    expect(timeline.tracks[0]?.clips[0]?.timelineDuration).toBeCloseTo(3.0);

    // Undo restores the single clip
    const stateAfterEdit = editor.get(compositionId);
    await editor.undo(compositionId, stateAfterEdit.revision);
    expect(timeline.tracks[0]?.clips.length).toBe(1);
    expect(timeline.tracks[0]?.clips[0]?.timelineDuration).toBeCloseTo(8.0);

    // Redo reapplies the split
    const stateAfterUndo = editor.get(compositionId);
    await editor.redo(compositionId, stateAfterUndo.revision);
    expect(timeline.tracks[0]?.clips.length).toBe(2);
    expect(timeline.tracks[0]?.clips[0]?.timelineDuration).toBeCloseTo(3.0);
  });

  it("bypasses snapping when bypass flag is specified", () => {
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
    app.rhythm.storeEvidence(evidence);

    const proposal = app.rhythm.proposeSnap("c1", 3.05, {
      compositionId,
      targetEdge: "cut",
      bypass: true,
    });

    expect(proposal.snappedTime).toBe(3.05);
    expect(proposal.delta).toBe(0);
    expect(proposal.bypassed).toBe(true);
    expect(proposal.targetLandmark).toBeUndefined();
  });
});
