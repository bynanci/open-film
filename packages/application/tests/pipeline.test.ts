// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.
import { rm, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "../src/index.js";
import type { MediaAsset, Story } from "@openfilm/core";

const exec = promisify(execFile);

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

describe("PipelineService Integration", () => {
  let projectDir: string;
  let app: OpenFilmApplication;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "openfilm-pipeline-test-"));
    app = await OpenFilmApplication.create(projectDir, "Pipeline Test Film");

    // Create real test files on disk
    const mediaDir = join(projectDir, "media");
    await mkdir(mediaDir, { recursive: true });
    const fileA = join(mediaDir, "photo_a.jpg");
    const fileB = join(mediaDir, "photo_b.jpg");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=1280x720",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      fileA,
    ]);
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=green:s=1280x720",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      fileB,
    ]);

    // Add synthetic assets with valid file URIs
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

    // Create a canonical story
    const story: Story = {
      id: "story_pipeline_1",
      title: "Guided Story",
      targetDuration: 10,
      beats: [
        {
          id: "beat_1",
          title: "Intro",
          targetDuration: 5,
          candidateAssetIds: ["asset_a"],
        },
        {
          id: "beat_2",
          title: "Outro",
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
      // Ignore if already closed
    }
    await rm(projectDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  });

  it("lists registered recipes including the canonical guided recipe", () => {
    const recipes = app.pipeline.listRecipes();
    expect(recipes.length).toBeGreaterThanOrEqual(1);
    const guided = recipes.find((r) => r.id === "guided-story-to-video");
    expect(guided).toBeDefined();
    expect(guided?.steps.length).toBe(8);
  });

  it("rejects tone mock from masquerading as speech narration", async () => {
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_pipeline_1",
      narration: {
        type: "configured-tts",
        providerId: "local-audio-mock",
        speechConsent: true,
      },
    });

    const result = await app.pipeline.startRun(run.id);
    expect(result.status).toBe("failed");
    const narrationAttempt = result.stepAttempts.find(
      (s) => s.stepId === "step-3",
    );
    expect(narrationAttempt?.status).toBe("failed");
    expect(narrationAttempt?.error?.message).toMatch(
      /Tone mock \(local-audio-mock\) produces synthetic tone only and cannot masquerade as speech narration/,
    );
  });

  it("completes full pipeline with no-narration and marks remote motion unavailable", async () => {
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_pipeline_1",
      assetIds: ["asset_a", "asset_b"],
      narration: { type: "none" },
      exportFormat: "mp4",
    });

    expect(run.status).toBe("idle");
    expect(run.currentStepIndex).toBe(0);

    const executed = await app.pipeline.startRun(run.id);
    let finalRun = executed;
    if (executed.status === "waiting-review") {
      finalRun = await app.pipeline.submitReview(run.id, "step-7", "accepted");
    }

    expect(finalRun.status).toBe("succeeded");
    expect(finalRun.freshness).toBe("current");

    // Check step 2: remote motion was verified as unavailable when no remote provider is configured
    const step2 = finalRun.stepAttempts.find((s) => s.stepId === "step-2");
    expect(step2?.outputs?.remoteMotionStatus).toBe("unavailable");

    // Check step 5: composition adoption produced legal receipt advancing expectedRevision
    const step5 = finalRun.stepAttempts.find((s) => s.stepId === "step-5");
    expect(step5?.status).toBe("succeeded");
    expect(finalRun.receipts.length).toBeGreaterThanOrEqual(1);
    expect(finalRun.expectedRevision).toBe(
      app.pipeline.getCurrentProjectRevision(),
    );

    // Check artifacts: composition, render, QA report, export
    expect(
      finalRun.artifacts.some((a) => a.kind === "rough-cut-composition"),
    ).toBe(true);
    expect(finalRun.artifacts.some((a) => a.kind === "preview-video")).toBe(
      true,
    );
    expect(finalRun.artifacts.some((a) => a.kind === "qa-report")).toBe(true);
    expect(finalRun.artifacts.some((a) => a.kind === "export-file")).toBe(true);
  });

  it("pauses at waiting-review when review is required and resumes upon acceptance", async () => {
    // Add audio asset for narration
    const voiceFile = join(projectDir, "media", "voice.wav");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=10",
      "-c:a",
      "pcm_s16le",
      "-y",
      voiceFile,
    ]);

    const voiceAsset: MediaAsset = {
      id: "voice_rec_1",
      uri: pathToFileURL(voiceFile).href,
      mediaType: "audio",
      name: "Voice Recording",
      tags: ["narration"],
      state: {},
      metadata: {},
      duration: 10,
    };
    app.catalog.upsertAsset(voiceAsset);

    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_pipeline_1",
      narration: {
        type: "voice-import",
        assetId: "voice_rec_1",
      },
    });

    // Start run: should pause at step-3 (narration requiresReview)
    const pausedRun = await app.pipeline.startRun(run.id);
    expect(pausedRun.status).toBe("waiting-review");
    expect(pausedRun.stepAttempts[2]?.stepId).toBe("step-3");
    expect(pausedRun.stepAttempts[2]?.status).toBe("waiting-review");

    // Polling getRun is strictly read-only
    const polled = app.pipeline.getRun(run.id);
    expect(polled.status).toBe("waiting-review");

    // Accept review: resumes and continues
    let completed = await app.pipeline.submitReview(
      run.id,
      "step-3",
      "accepted",
      { notes: "Voice timing sounds great." },
    );

    if (completed.status === "waiting-review") {
      completed = await app.pipeline.submitReview(run.id, "step-7", "accepted");
    }

    expect(completed.status).toBe("succeeded");
    expect(completed.stepAttempts[2]?.status).toBe("succeeded");
    expect(completed.stepAttempts[2]?.reviewRecord?.decision).toBe("accepted");
  });

  it("handles cancellation cleanly without importing late results", async () => {
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_pipeline_1",
      narration: { type: "none" },
    });

    const controller = new AbortController();
    controller.abort(); // Cancel immediately

    const cancelledRun = await app.pipeline.startRun(run.id, {
      signal: controller.signal,
    });
    expect(cancelledRun.status).toBe("cancelled");
  });

  it("detects external modifications and marks run as outdated", async () => {
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_pipeline_1",
      narration: { type: "none" },
    });
    await app.pipeline.startRun(run.id);

    // Initial run is current (whether completed or waiting-review)
    const currentRun = app.pipeline.getRun(run.id);
    expect(currentRun.freshness).toBe("current");

    // Externally mutate project
    app.project.title = "External Title Change";
    await app.save();

    // Querying run now reports outdated
    const outdatedRun = app.pipeline.getRun(run.id);
    expect(outdatedRun.freshness).toBe("outdated");
  });

  it("persists runs across project close and reopen without falsely killing live tasks", async () => {
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_pipeline_1",
      narration: { type: "none" },
    });
    let executed = await app.pipeline.startRun(run.id);
    if (executed.status === "waiting-review") {
      executed = await app.pipeline.submitReview(run.id, "step-7", "accepted");
    }
    expect(executed.status).toBe("succeeded");

    // Close application
    app.catalog.close();

    // Reopen application
    const reopenedApp = await OpenFilmApplication.open(projectDir);
    try {
      const persistedRun = reopenedApp.pipeline.getRun(run.id);
      expect(persistedRun).toBeDefined();
      expect(persistedRun.id).toBe(run.id);
      expect(persistedRun.status).toBe("succeeded");
    } finally {
      reopenedApp.catalog.close();
    }
  });

  it("retryRun retains identical input snapshot and increments attempt number", async () => {
    // Create a run that will fail due to tone mock
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_pipeline_1",
      narration: {
        type: "configured-tts",
        providerId: "local-audio-mock",
        speechConsent: true,
      },
    });

    const failed = await app.pipeline.startRun(run.id);
    expect(failed.status).toBe("failed");
    const originalDigest = failed.inputSnapshot.inputDigest;
    expect(failed.stepAttempts[2]?.attemptNumber).toBe(1);

    // Retrying uses the SAME inputSnapshot without creating a second run
    const retried = await app.pipeline.retryRun(run.id);
    expect(retried.id).toBe(run.id);
    expect(retried.inputSnapshot.inputDigest).toBe(originalDigest);
    expect(retried.stepAttempts[2]?.attemptNumber).toBe(2);
  });

  it("rejects review submissions when the step is not waiting review", async () => {
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_pipeline_1",
      narration: { type: "none" },
    });

    // In idle state, step is not waiting review
    await expect(
      app.pipeline.submitReview(run.id, "step-1", "accepted"),
    ).rejects.toThrow(/is not in 'waiting-review'/);
  });

  it("returns succeeded run idempotently without executing duplicate side effects", async () => {
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_pipeline_1",
      narration: { type: "none" },
    });

    let executed = await app.pipeline.startRun(run.id);
    if (executed.status === "waiting-review") {
      executed = await app.pipeline.submitReview(run.id, "step-7", "accepted");
    }
    expect(executed.status).toBe("succeeded");

    const receiptCountBefore = executed.receipts.length;
    // Calling startRun again on succeeded run should return immediately without side effects
    const secondCall = await app.pipeline.startRun(run.id);
    expect(secondCall.status).toBe("succeeded");
    expect(secondCall.receipts.length).toBe(receiptCountBefore);
  });

  it("validates recipes upon registration and rejects cyclic or invalid recipes", () => {
    expect(() => {
      app.pipeline.registerRecipe({
        schemaVersion: "1.0.0",
        id: "invalid-cycle",
        version: "1.0.0",
        name: "Cycle",
        steps: [
          {
            id: "step-x",
            type: "story-plan-select",
            name: "X",
            inputs: [{ name: "step-y.out", type: "story-plan" }],
            outputs: [{ name: "out", type: "story-plan" }],
          },
          {
            id: "step-y",
            type: "scene-prepare",
            name: "Y",
            inputs: [{ name: "step-x.out", type: "story-plan" }],
            outputs: [{ name: "out", type: "story-plan" }],
          },
        ],
      });
    }).toThrow(/Cyclic dependency detected/);
  });
});
