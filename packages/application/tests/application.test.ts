import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSampleMedia } from "../../../fixtures/sample-media/generate.mjs";
import { hashFile, runProcess } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index";

let directory: string;
let sources: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "openfilm-application-"));
  sources = join(directory, "originals");
  await generateSampleMedia(sources);
  await writeFile(join(sources, "bad.mp4"), "corrupt movie");
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("offline application workflow", () => {
  it("isolates malformed files, resumes idempotently, renders, exports and reopens durable edits", async () => {
    const paths = [
      "01-photo.png",
      "02-photo-copy.png",
      "03-evening.png",
      "04-motion.mp4",
      "05-tone.wav",
    ];
    const hashes = await Promise.all(
      paths.map((path) => hashFile(join(sources, path))),
    );
    let app = await OpenFilmApplication.create(
      join(directory, "film.openfilm"),
      "Generated memories",
    );
    app.project.settings = { width: 320, height: 180, frameRate: 24 };
    const observations: string[] = [];
    const imported = await app.importFolder(sources, {
      onProgress: (job) => {
        observations.push(job.status);
        job.status = "failed";
      },
    });
    expect(imported.imported, JSON.stringify(imported.job.errors)).toBe(5);
    expect(imported.failed).toBe(1);
    expect(imported.job.status).toBe("completed");
    expect(imported.job.errors?.[0]?.stage).toBe("inspect");
    expect(observations).toContain("running");
    const image = app.catalog
      .listAssets()
      .find((asset) => asset.name === "01-photo.png")!;
    const video = app.catalog
      .listAssets()
      .find((asset) => asset.mediaType === "video")!;
    expect(image.uri).toContain("/originals/");
    expect(await readFile(fileURLToPath(image.thumbnailUri!))).not.toHaveLength(
      0,
    );
    expect(await readFile(fileURLToPath(video.proxyUri!))).not.toHaveLength(0);
    app.catalog.updateAsset(image.id, {
      rating: 5,
      state: { favorite: true, locked: true },
      tags: ["memory"],
    });
    const repeated = await app.importFolder(sources);
    expect(repeated.skipped).toBe(5);
    expect(repeated.imported).toBe(0);
    expect(repeated.failed).toBe(1);
    const analyzed = app.analyze();
    expect(analyzed.events.length).toBeGreaterThan(0);
    expect(
      analyzed.duplicates.some(
        (group) => group.kind === "exact" && group.assetIds.includes(image.id),
      ),
    ).toBe(true);
    const story = app.generateStory({
      title: "First chapter",
      targetDuration: 4,
      maxDuration: 4,
    });
    const composition = app.compose(story.id);
    expect(composition.duration).toBeLessThanOrEqual(4);
    const preview = await app.render(composition.id);
    const probe = await runProcess("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      preview,
    ]);
    const duration = Number(
      (JSON.parse(probe.stdout.toString()) as { format: { duration: string } })
        .format.duration,
    );
    expect(duration).toBeLessThanOrEqual(4.05);
    expect(duration).toBeCloseTo(composition.duration, 1);
    const exported = await app.export("otio", composition.id);
    expect(await readFile(exported, "utf8")).toContain("Timeline.1");
    expect(
      await Promise.all(paths.map((path) => hashFile(join(sources, path)))),
    ).toEqual(hashes);
    app.close();
    app = await OpenFilmApplication.open(join(directory, "film.openfilm"));
    expect(app.project.stories[0]?.title).toBe("First chapter");
    expect(app.project.timelines[0]?.id).toBe(composition.id);
    expect(app.catalog.getAsset(image.id)?.state.locked).toBe(true);
    expect(app.catalog.getAsset(image.id)?.rating).toBe(5);
    expect(
      app.catalog
        .listJobs()
        .some((job) => job.status === "completed" && job.type === "render"),
    ).toBe(true);
    app.close();
  }, 60000);

  it("persists cancellation and protects nonproject content", async () => {
    await expect(
      OpenFilmApplication.create(sources, "Overwrite"),
    ).rejects.toThrow("not empty");
    const app = await OpenFilmApplication.create(
      join(directory, "cancelled.openfilm"),
      "Cancelled import",
    );
    const controller = new AbortController();
    const cancelled = await app.importFolder(sources, {
      jobId: "known-job",
      signal: controller.signal,
      onProgress: (job) => {
        if (job.status === "running") controller.abort();
      },
    });
    expect(cancelled.job.status).toBe("cancelled");
    expect(app.catalog.countAssets()).toBe(0);
    expect(app.catalog.listJobs()[0]?.id).toBe("known-job");
    app.close();
    const reopened = await OpenFilmApplication.open(
      join(directory, "cancelled.openfilm"),
    );
    expect(reopened.catalog.listJobs()[0]?.status).toBe("cancelled");
    reopened.close();
  });

  it("cancels an import with work in flight and resumes completed cache stages", async () => {
    const app = await OpenFilmApplication.create(
      join(directory, "midway.openfilm"),
      "Midway",
    );
    const controller = new AbortController();
    const cancelled = await app.importFolder(sources, {
      signal: controller.signal,
      onProgress: (job) => {
        if (job.status === "running" && (job.progress ?? 0) > 0)
          controller.abort();
      },
    });
    expect(cancelled.job.status).toBe("cancelled");
    expect(cancelled.imported).toBeLessThan(5);
    const thumbnailFiles = await readdir(
      join(app.directory, "cache", "thumbnails"),
    );
    expect(thumbnailFiles.some((name) => name.includes("partial"))).toBe(false);
    const resumed = await app.importFolder(sources);
    expect(resumed.job.status).toBe("completed");
    expect(resumed.imported + resumed.skipped).toBe(5);
    expect(app.catalog.countAssets()).toBe(5);
    app.close();
  });

  it("reindexes externally changed media while preserving ratings and identity", async () => {
    const source = join(directory, "changing");
    await mkdir(source);
    const path = join(source, "photo.png");
    await copyFile(join(sources, "01-photo.png"), path);
    const app = await OpenFilmApplication.create(
      join(directory, "changing.openfilm"),
      "Changing",
    );
    await app.importFolder(source);
    const original = app.catalog.listAssets()[0]!;
    app.catalog.updateAsset(original.id, {
      rating: 4,
      state: { favorite: true },
      tags: ["retain"],
    });
    await copyFile(join(sources, "03-evening.png"), path);
    const hash = await hashFile(path);
    const imported = await app.importFolder(source);
    expect(imported.imported).toBe(1);
    const changed = app.catalog.getAsset(original.id)!;
    expect(changed.contentHash).toBe(hash);
    expect(changed.contentHash).not.toBe(original.contentHash);
    expect(changed.rating).toBe(4);
    expect(changed.state.favorite).toBe(true);
    expect(changed.tags).toEqual(["retain"]);
    expect(changed.thumbnailUri).not.toBe(original.thumbnailUri);
    expect(await hashFile(path)).toBe(hash);
    app.close();
  });
});
