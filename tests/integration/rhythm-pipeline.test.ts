// Modified by OpenFilm contributors on 2026-11-01. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import type {
  Composition,
  MediaAsset,
  RhythmAnalysisEvidence,
  RhythmSnapProposal,
  Story,
} from "@openfilm/core";
import { hashFile, runProcess } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";

interface EditorState {
  composition: Composition;
  story: Story;
  assets: MediaAsset[];
  revision: string;
  acknowledgedRevision?: string;
  canUndo: boolean;
  canRedo: boolean;
}

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function generateBeatsAudio(
  targetPath: string,
  durationSec = 4,
): Promise<void> {
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=exprs=sin(2*PI*440*t)*gt(mod(t\\,0.5)\\,0.45):s=8000:d=${durationSec}`,
    "-c:a",
    "pcm_s16le",
    "-ac",
    "1",
    "-ar",
    "8000",
    "-threads",
    "1",
    "-y",
    targetPath,
  ]);
}

describe("D3A2 rhythm analysis producer, durability, snap proposal, and HTTP lifecycle", () => {
  it("extracts real rhythm evidence, persists across reopen, projects landmarks, and executes snap cut", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-rhythm-test-"));
    cleanup.push(() =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
    );

    const audioPath = join(root, "beats-120bpm.wav");
    await generateBeatsAudio(audioPath, 4);
    const audioHash = await hashFile(audioPath);

    const directory = join(root, "film.openfilm");
    const app = await OpenFilmApplication.create(
      directory,
      "Rhythm Producer Pipeline",
    );
    cleanup.push(async () => {
      try {
        app.close();
      } catch {
        // ignore already closed
      }
    });
    app.project.settings = { width: 320, height: 180, frameRate: 24 };

    const asset: MediaAsset = {
      id: "rhythm-audio-asset",
      name: "beats-120bpm.wav",
      uri: pathToFileURL(audioPath).href,
      mediaType: "audio",
      duration: 4,
      contentHash: audioHash,
      tags: [],
      state: {},
      metadata: {},
    };
    app.catalog.upsertAsset(asset);

    app.project.stories.push({
      id: "story-1",
      title: "Rhythm Story",
      targetDuration: 4,
      maxDuration: 10,
      beats: [
        {
          id: "beat-1",
          title: "Intro beat",
          selectedAssetIds: [asset.id],
          candidateAssetIds: [asset.id],
        },
      ],
    });

    const compositionId = "main-timeline";
    const clipId = "clip-audio-1";
    const composition: Composition = {
      id: compositionId,
      storyId: "story-1",
      duration: 4,
      tracks: [
        {
          id: "audio-track-1",
          type: "audio",
          clips: [
            {
              id: clipId,
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 4,
              sourceIn: 0,
              sourceOut: 4,
            },
          ],
        },
      ],
    };

    app.project.timelines = [composition];
    await app.save();

    // 1. Analyze asset rhythm using RhythmService on live application
    const evidence = await app.rhythm.analyzeAsset(asset.id, { bpmHint: 120 });
    expect(evidence.version).toBe(1);
    expect(evidence.assetId).toBe(asset.id);
    expect(evidence.sourceHash).toBe(asset.contentHash!.toLowerCase());
    expect(evidence.tempoBpm).toBeGreaterThan(0);
    expect(evidence.landmarks.length).toBeGreaterThan(0);
    expect(evidence.reliability).toBeGreaterThanOrEqual(0.5);

    // 2. Durable persistence verification on disk
    const evidenceDiskPath = join(
      directory,
      "analysis",
      "rhythm-evidence.json",
    );
    expect(existsSync(evidenceDiskPath)).toBe(true);
    const diskContent = JSON.parse(await readFile(evidenceDiskPath, "utf8"));
    expect(Array.isArray(diskContent)).toBe(true);
    expect(diskContent).toHaveLength(1);
    expect(diskContent[0].assetId).toBe(asset.id);

    // Close initial application before opening second instance
    app.close();

    // 3. Re-open project and verify cached evidence is immediately restored
    const reloadedApp = await OpenFilmApplication.open(directory);
    try {
      const restoredEvidence = reloadedApp.rhythm.getEvidence(
        asset.id,
        asset.contentHash,
      );
      expect(restoredEvidence).toBeDefined();
      expect(restoredEvidence?.landmarks).toHaveLength(
        evidence.landmarks.length,
      );

      // 4. Project timeline landmarks for clip
      const projected = reloadedApp.rhythm.getLandmarksForClip(clipId, {
        compositionId,
      });
      expect(projected.length).toBe(evidence.landmarks.length);
      expect(projected[0]?.clipId).toBe(clipId);
      expect(projected[0]?.assetId).toBe(asset.id);
      expect(projected[0]?.timelineTime).toBeCloseTo(
        evidence.landmarks[0]!.time,
        2,
      );

      // 5. Propose rhythm snap
      const nearestTime = evidence.landmarks[1]?.time ?? 0.5;
      const proposal = reloadedApp.rhythm.proposeSnap(
        clipId,
        nearestTime - 0.03,
        {
          compositionId,
          targetEdge: "cut",
          tolerance: 0.25,
        },
      );
      expect(proposal.version).toBe(1);
      expect(proposal.snappedTime).toBeCloseTo(nearestTime, 2);
      expect(proposal.bypassed).toBe(false);

      // 6. Accept snap cut via RhythmService
      const applied = await reloadedApp.rhythm.applySnap(proposal);
      expect(applied.id).toBe(proposal.id);

      const compAfterSnap = reloadedApp.project.timelines.find(
        (t) => t.id === compositionId,
      );
      expect(compAfterSnap?.tracks[0]?.clips.length).toBe(2);
    } finally {
      reloadedApp.close();
    }

    // 7. Verify HTTP API routes using server runtime
    const runtime = await startServer({ port: 0, project: directory });
    cleanup.push(() => runtime.close());
    const baseUrl = `http://127.0.0.1:${runtime.port}`;

    const analyzeRes = await fetch(
      `${baseUrl}/api/assets/${encodeURIComponent(asset.id)}/rhythm/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bpmHint: 120 }),
      },
    );
    expect(analyzeRes.status).toBe(200);
    const httpEvidence = (await analyzeRes.json()) as RhythmAnalysisEvidence;
    expect(httpEvidence.assetId).toBe(asset.id);

    // The clip was split into two: check first clip
    const firstClipId = clipId;
    const landmarksRes = await fetch(
      `${baseUrl}/api/compositions/${encodeURIComponent(compositionId)}/rhythm/landmarks?clipId=${encodeURIComponent(firstClipId)}`,
    );
    expect(landmarksRes.status).toBe(200);
    const httpLandmarks = (await landmarksRes.json()) as {
      landmarks: RhythmAnalysisEvidence["landmarks"];
    };
    expect(httpLandmarks.landmarks.length).toBeGreaterThan(0);

    const nearestHttpTime = evidence.landmarks[0]?.time ?? 0.5;
    const snapProposeRes = await fetch(
      `${baseUrl}/api/compositions/${encodeURIComponent(compositionId)}/rhythm/propose-snap`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId: firstClipId,
          requestedTime: nearestHttpTime - 0.02,
          targetEdge: "cut",
          tolerance: 0.25,
        }),
      },
    );
    expect(snapProposeRes.status).toBe(200);
    const httpProposal = (await snapProposeRes.json()) as RhythmSnapProposal;
    expect(httpProposal.snappedTime).toBeCloseTo(nearestHttpTime, 2);

    const snapAcceptRes = await fetch(
      `${baseUrl}/api/compositions/${encodeURIComponent(compositionId)}/rhythm/accept-snap`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal: httpProposal }),
      },
    );
    expect(snapAcceptRes.status).toBe(200);
    const acceptData = (await snapAcceptRes.json()) as {
      proposal: RhythmSnapProposal;
      state: EditorState;
    };
    expect(acceptData.proposal.id).toBe(httpProposal.id);
    expect(acceptData.state.canUndo).toBe(true);
  });
});
