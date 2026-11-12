// Modified by OpenFilm contributors on 2026-11-12. See LICENSE and NOTICE.
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import {
  validatePipelineRun,
  type MediaAsset,
  type PipelineRun,
  type Story,
} from "@openfilm/core";
import { createPipelineFixtureOwner } from "../fixtures/pipeline-fixture-owner.js";

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

it("drains a resumed real render after a sentinel failure before closing its catalog", async () => {
  const owner = createPipelineFixtureOwner();
  const projectDir = await mkdtemp(
    join(tmpdir(), "openfilm-pipeline-cleanup-"),
  );
  let app: OpenFilmApplication | undefined;
  let runId: string | undefined;
  let resumed: Promise<PipelineRun> | undefined;
  let outcome: PipelineRun | undefined;
  let settled = false;
  let settlementCount = 0;
  let closed = false;
  try {
    app = await OpenFilmApplication.create(
      projectDir,
      "Workbench Cleanup Film",
      {},
      {
        userDataDirectory: join(projectDir, "synthetic-user-data"),
      },
    );
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
    const voiceFile = join(mediaDir, "supplement_voice.wav");
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
    app.catalog.upsertAsset({
      id: "voice_supp_1",
      uri: pathToFileURL(voiceFile).href,
      mediaType: "audio",
      name: "Supplement Voice",
      tags: ["narration"],
      state: {},
      metadata: {},
      duration: 10,
    });
    expect(app.project.settings).toMatchObject({
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
    const run = await app.pipeline.createRun("guided-story-to-video", {
      compositionTarget: { version: 1, mode: "new-cut" },
      storyId: "story_wb_1",
      narration: { type: "voice-import", assetId: "voice_supp_1" },
    });
    runId = run.id;
    const application = app;
    const paused = await owner.ownAction(run.id, () =>
      application.pipeline.startRun(run.id),
    );
    expect(paused.status).toBe("waiting-review");
    expect(paused.stepAttempts[2]?.status).toBe("waiting-review");

    const sentinel = new Error(
      "sentinel: assertion failed during owned render",
    );
    let failure: unknown;
    try {
      resumed = owner.ownAction(run.id, () =>
        application.pipeline.submitReview(run.id, "step-3", "accepted"),
      );
      void resumed.then(
        (result) => {
          outcome = result;
          settled = true;
          settlementCount++;
        },
        () => {
          settled = true;
          settlementCount++;
        },
      );
      await expect
        .poll(
          () =>
            application.catalog
              .listJobs()
              .some(
                (job) =>
                  job.type === "render" &&
                  job.status === "running" &&
                  (job.progress ?? 0) > 0,
              ),
          { timeout: 30_000 },
        )
        .toBe(true);
      expect(settled).toBe(false);
      throw sentinel;
    } catch (error) {
      failure = error;
    } finally {
      await owner.cleanup(
        {
          pipeline: application.pipeline,
          catalog: {
            async close() {
              // Guard the real close boundary: RED must retain an open catalog for safe recovery.
              expect(owner.pendingCount).toBe(0);
              expect(settled).toBe(true);
              expect(outcome?.status).toBe("cancelled");
              const persisted: unknown = JSON.parse(
                await readFile(
                  join(projectDir, "cache", "pipeline-runs.json"),
                  "utf8",
                ),
              );
              expect(Array.isArray(persisted)).toBe(true);
              const runs = (persisted as unknown[]).map(validatePipelineRun);
              expect(runs.find((entry) => entry.id === run.id)?.status).toBe(
                "cancelled",
              );
              await access(projectDir);
              application.catalog.close();
              closed = true;
            },
          },
        },
        projectDir,
      );
    }
    expect(failure).toBe(sentinel);
    expect(owner.pendingCount).toBe(0);
    expect(settlementCount).toBe(1);
    await expect(access(projectDir)).rejects.toMatchObject({ code: "ENOENT" });
    await setImmediate();
    expect(settlementCount).toBe(1);
  } finally {
    // Independent public-API recovery also makes the legacy behavioral RED safe.
    // Never close/remove the real fixture until its owning action has settled.
    if (app && !closed) {
      if (runId) {
        await app.pipeline.cancelRun(runId);
        while (resumed && !settled) {
          await setImmediate();
          await app.pipeline.cancelRun(runId);
        }
      }
      if (resumed) await resumed;
      app.catalog.close();
    }
    await rm(projectDir, { recursive: true, force: true });
  }
});
