// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.
import { rm, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
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

  it("new_run_requires_explicit_target", async () => {
    await expect(
      app.pipeline.createRun("guided-story-to-video"),
    ).rejects.toThrow(/target/iu);
  });
  it("resolve_requires_exact_target_revision", async () => {
    const cut = app.compose("story_pipeline_1");
    await expect(
      app.pipeline.createRun("guided-story-to-video", {
        storyId: "story_pipeline_1",
        compositionTarget: {
          version: 1,
          mode: "resolve",
          compositionId: cut.id,
          baseRevision: "stale",
        },
      }),
    ).rejects.toThrow(/revision|changed/iu);
  });
  it("subtitle_and_composition_publish_once", async () => {
    app.pipeline.registerRecipe({
      schemaVersion: "1.0.0",
      id: "adopt-only",
      version: "1.0.0",
      name: "Adopt",
      steps: [
        {
          id: "adopt",
          type: "composition-adopt",
          name: "Adopt",
          inputs: [],
          outputs: [{ name: "compositionId", type: "composition" }],
        },
      ],
    });
    const run = await app.pipeline.createRun("adopt-only", {
      storyId: "story_pipeline_1",
      compositionTarget: { version: 1, mode: "new-cut" },
      customParams: { subtitleText: "Saved together" },
    });
    const before = app.project.timelines.length;
    const save = vi.spyOn(app, "save");
    const result = await app.pipeline.startRun(run.id);
    expect(result.status).toBe("succeeded");
    expect(app.project.timelines.length).toBe(before + 1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      app.project.timelines.at(-1)?.captionTracks?.[0]?.cues[0]?.text,
    ).toBe("Saved together");
    expect(result.artifacts[0]?.metadata).toMatchObject({
      targetMode: "new-cut",
      compositionId: app.project.timelines.at(-1)?.id,
    });
    save.mockRestore();
  });
  it("pin_after_async_prepare_invalidates_adoption", async () => {
    app.pipeline.registerRecipe({
      schemaVersion: "1.0.0",
      id: "adopt-stale",
      version: "1.0.0",
      name: "Adopt",
      steps: [
        {
          id: "adopt",
          type: "composition-adopt",
          name: "Adopt",
          inputs: [],
          outputs: [{ name: "compositionId", type: "composition" }],
        },
      ],
    });
    const run = await app.pipeline.createRun("adopt-stale", {
      storyId: "story_pipeline_1",
      compositionTarget: { version: 1, mode: "new-cut" },
    });
    app.project.title = "Changed after prepare";
    await app.save();
    const result = await app.pipeline.startRun(run.id);
    expect(result.status).toBe("failed");
    expect(result.artifacts).toEqual([]);
    expect(app.project.timelines).toHaveLength(0);
  });

  it("same_story_multiple_cuts_never_guess", async () => {
    const selected = app.compose("story_pipeline_1"),
      other = app.compose("story_pipeline_1");
    const before = structuredClone(other);
    const revision = new TimelineEditor(app).get(selected.id).revision;
    app.pipeline.registerRecipe({
      schemaVersion: "1.0.0",
      id: "resolve-only",
      version: "1.0.0",
      name: "Resolve",
      steps: [
        {
          id: "adopt",
          type: "composition-adopt",
          name: "Adopt",
          inputs: [],
          outputs: [{ name: "compositionId", type: "composition" }],
        },
      ],
    });
    const run = await app.pipeline.createRun("resolve-only", {
      storyId: "story_pipeline_1",
      compositionTarget: {
        version: 1,
        mode: "resolve",
        compositionId: selected.id,
        baseRevision: revision,
      },
    });
    const result = await app.pipeline.startRun(run.id);
    expect(result.status).toBe("succeeded");
    expect(app.project.timelines).toHaveLength(2);
    expect(app.project.timelines.find((c) => c.id === other.id)).toEqual(
      before,
    );
    expect(result.artifacts[0]?.metadata?.compositionId).toBe(selected.id);
  });
  it("retry_after_ambiguous_commit_does_not_duplicate_or_erase_later_pins", async () => {
    const recipe = {
      schemaVersion: "1.0.0" as const,
      id: "retry-adopt",
      version: "1.0.0",
      name: "Adopt",
      steps: [
        {
          id: "adopt",
          type: "composition-adopt" as const,
          name: "Adopt",
          inputs: [],
          outputs: [{ name: "compositionId", type: "composition" as const }],
        },
      ],
    };
    app.pipeline.registerRecipe(recipe);
    const run = await app.pipeline.createRun(recipe.id, {
      storyId: "story_pipeline_1",
      compositionTarget: { version: 1, mode: "new-cut" },
    });
    const failure = vi
      .spyOn(app.catalog, "withProjectWrite")
      .mockImplementationOnce((operation) => {
        operation();
        throw new Error("ambiguous publication after manifest write");
      });
    expect((await app.pipeline.startRun(run.id)).status).toBe("failed");
    failure.mockRestore();
    app.close({ requireSave: false });
    app = await OpenFilmApplication.open(projectDir);
    app.pipeline.registerRecipe(recipe);
    const accepted = app.project.timelines[0]!;
    const editor = new TimelineEditor(app),
      state = editor.get(accepted.id);
    await editor.edit(accepted.id, {
      baseRevision: state.revision,
      commands: [
        {
          type: "user-pin.set",
          target: { kind: "clip", clipId: accepted.tracks[0]!.clips[0]!.id },
          pinned: true,
        },
      ],
    });
    const pinned = structuredClone(app.project.timelines[0]);
    const result = await app.pipeline.retryRun(run.id);
    expect(result.status).toBe("succeeded");
    expect(app.project.timelines).toHaveLength(1);
    expect(app.project.timelines[0]).toEqual(pinned);
  });
  it("legacy_run_remains_new_cut", async () => {
    const recipe = {
      schemaVersion: "1.0.0" as const,
      id: "legacy-adopt",
      version: "1.0.0",
      name: "Adopt",
      steps: [
        {
          id: "adopt",
          type: "composition-adopt" as const,
          name: "Adopt",
          inputs: [],
          outputs: [{ name: "compositionId", type: "composition" as const }],
        },
      ],
    };
    app.pipeline.registerRecipe(recipe);
    const run = await app.pipeline.createRun(recipe.id, {
      storyId: "story_pipeline_1",
      compositionTarget: { version: 1, mode: "new-cut" },
    });
    const file = join(projectDir, "cache", "pipeline-runs.json");
    const records = JSON.parse(await readFile(file, "utf8"));
    delete records[0].inputSnapshot.compositionTarget;
    await writeFile(file, JSON.stringify(records));
    await app.pipeline.init();
    expect((await app.pipeline.startRun(run.id)).status).toBe("succeeded");
    expect(app.project.timelines).toHaveLength(1);
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
      compositionTarget: { version: 1, mode: "new-cut" },
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
      compositionTarget: { version: 1, mode: "new-cut" },
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
      compositionTarget: { version: 1, mode: "new-cut" },
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
      compositionTarget: { version: 1, mode: "new-cut" },
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
      compositionTarget: { version: 1, mode: "new-cut" },
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
      compositionTarget: { version: 1, mode: "new-cut" },
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
      compositionTarget: { version: 1, mode: "new-cut" },
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
      compositionTarget: { version: 1, mode: "new-cut" },
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
      compositionTarget: { version: 1, mode: "new-cut" },
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
