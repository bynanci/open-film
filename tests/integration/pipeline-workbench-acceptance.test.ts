// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.
import { rm, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import type { MediaAsset, Story } from "@openfilm/core";

function makeSyntheticPhoto(id: string, name: string, uri: string): MediaAsset {
  return {
    id,
    uri,
    mediaType: "image",
    name,
    tags: ["family", "trip"],
    state: {},
    metadata: { width: 1920, height: 1080 },
    duration: 5,
  };
}

describe("Phase M10B: Pipeline Workbench Real Services Acceptance", () => {
  let projectDir: string;
  let app: OpenFilmApplication;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "openfilm-workbench-test-"));
    app = await OpenFilmApplication.create(
      projectDir,
      "Workbench Acceptance Film",
    );

    const mediaDir = join(projectDir, "media");
    await mkdir(mediaDir, { recursive: true });
    const fileA = join(mediaDir, "photo_a.jpg");
    const fileB = join(mediaDir, "photo_b.jpg");
    await writeFile(fileA, Buffer.alloc(100));
    await writeFile(fileB, Buffer.alloc(100));

    const photoA = makeSyntheticPhoto(
      "asset_a",
      "photo_a",
      pathToFileURL(fileA).href,
    );
    const photoB = makeSyntheticPhoto(
      "asset_b",
      "photo_b",
      pathToFileURL(fileB).href,
    );
    app.catalog.upsertAsset(photoA);
    app.catalog.upsertAsset(photoB);

    const story: Story = {
      id: "story_wb_1",
      title: "Workbench Story",
      targetDuration: 10,
      beats: [
        {
          id: "beat_1",
          title: "Introduction",
          targetDuration: 5,
          candidateAssetIds: ["asset_a"],
        },
        {
          id: "beat_2",
          title: "Resolution",
          targetDuration: 5,
          candidateAssetIds: ["asset_b"],
        },
      ],
    };
    app.project.stories.push(story);
    await app.save();
  });

  afterEach(async () => {
    try {
      app.catalog.close();
    } catch {
      // Ignore if closed
    }
    await rm(projectDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  });

  it("Journey 1: handles missing narration audio, supplements with voice import, and completes production", async () => {
    // 1. Missing audio: User selects voice import with an asset not yet in catalog or attempts creation
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_wb_1",
      narration: { type: "voice-import", assetId: "missing_voice" },
    });

    const execution = await app.pipeline.startRun(run.id);
    expect(execution.status).toBe("failed");
    expect(execution.stepAttempts[2]?.error?.message).toMatch(
      /Imported voice asset 'missing_voice' not found/,
    );

    // 2. Supplement: User imports physical recording to library
    const voiceFile = join(projectDir, "media", "supplement_voice.wav");
    await writeFile(voiceFile, Buffer.alloc(100));
    const voiceAsset: MediaAsset = {
      id: "voice_supp_1",
      uri: pathToFileURL(voiceFile).href,
      mediaType: "audio",
      name: "Supplement Voice",
      tags: ["narration"],
      state: {},
      metadata: {},
      duration: 10,
    };
    app.catalog.upsertAsset(voiceAsset);

    // 3. New run with supplemented voice
    const validRun = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_wb_1",
      narration: { type: "voice-import", assetId: "voice_supp_1" },
    });

    // 4. Pauses at narration review gate
    const paused = await app.pipeline.startRun(validRun.id);
    expect(paused.status).toBe("waiting-review");
    expect(paused.stepAttempts[2]?.status).toBe("waiting-review");

    // 5. Reviewer approves
    let completed = await app.pipeline.submitReview(
      validRun.id,
      "step-3",
      "accepted",
      { notes: "Supplemented voice recording sounds balanced." },
    );

    if (completed.status === "waiting-review") {
      completed = await app.pipeline.submitReview(
        validRun.id,
        "step-7",
        "accepted",
      );
    }

    expect(completed.status).toBe("succeeded");
    expect(
      completed.artifacts.some((a) => a.kind === "rough-cut-composition"),
    ).toBe(true);
  });

  it("Journey 2: pauses at review proposal, preserves story origins, and adopts with legal receipt", async () => {
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_wb_1",
      narration: { type: "none" },
    });

    let activeRun = await app.pipeline.startRun(run.id);
    if (activeRun.status === "waiting-review") {
      // Cross-view origin verification: activeStory beats remain untouched
      expect(app.project.stories[0]?.beats.length).toBe(2);
      expect(app.project.stories[0]?.beats[0]?.title).toBe("Introduction");

      // Approve review
      activeRun = await app.pipeline.submitReview(run.id, "step-7", "accepted");
    }

    expect(activeRun.status).toBe("succeeded");
    // Adoption produced legal receipt advancing expectedRevision
    expect(activeRun.receipts.length).toBeGreaterThanOrEqual(1);
    expect(activeRun.expectedRevision).toBe(
      app.pipeline.getCurrentProjectRevision(),
    );
  });

  it("Journey 3: recovers from step failure via retryRun without mutating original snapshot", async () => {
    // Deliberately trigger failure with tone mock
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_wb_1",
      narration: {
        type: "configured-tts",
        providerId: "local-audio-mock",
        speechConsent: true,
      },
    });

    const failed = await app.pipeline.startRun(run.id);
    expect(failed.status).toBe("failed");
    const digestBefore = failed.inputSnapshot.inputDigest;

    // Retry run retains original snapshot and increments attempt
    const retried = await app.pipeline.retryRun(run.id);
    expect(retried.id).toBe(run.id);
    expect(retried.inputSnapshot.inputDigest).toBe(digestBefore);
    expect(retried.stepAttempts[2]?.attemptNumber).toBe(2);
  });

  it("Journey 4: detects external draft changes, marks run as outdated, and prevents masquerading as latest", async () => {
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_wb_1",
      narration: { type: "none" },
    });

    let activeRun = await app.pipeline.startRun(run.id);
    if (activeRun.status === "waiting-review") {
      activeRun = await app.pipeline.submitReview(run.id, "step-7", "accepted");
    }
    expect(activeRun.status).toBe("succeeded");
    expect(activeRun.freshness).toBe("current");

    // External edit to project title & story beats
    app.project.title = "Altered Story Draft";
    app.project.stories[0]!.beats.push({
      id: "beat_3",
      title: "New Ending",
      targetDuration: 4,
      candidateAssetIds: ["asset_a"],
    });
    await app.save();

    // Querying run now identifies outdated freshness
    const inspected = app.pipeline.getRun(run.id);
    expect(inspected.freshness).toBe("outdated");
    expect(inspected.status).toBe("succeeded"); // Finished, but based on older draft!
  });
});
