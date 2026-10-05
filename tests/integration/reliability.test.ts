import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import type { Job, MediaAsset } from "@openfilm/core";
import { pathToFileURL } from "node:url";
import { hashFile, runProcess } from "@openfilm/media";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import { startServer } from "../../apps/server/src/server.js";
import { sourcePresentation } from "../../apps/desktop/src/sourcePresentation.js";

let samples: string;
const cleanup: Array<() => Promise<unknown>> = [];

beforeAll(async () => {
  samples = await mkdtemp(join(tmpdir(), "openfilm-reliability-samples-"));
  await generateSampleMedia(samples);
});
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
afterAll(async () => {
  await rm(samples, { recursive: true, force: true });
});

async function fixture(options: { overLimit?: boolean; raw?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-reliability-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const sources = join(root, "sources");
  await mkdir(sources);
  const source = join(sources, "motion.mp4");
  await copyFile(join(samples, "04-motion.mp4"), source);
  if (options.raw) await copyFile(source, join(sources, "original.insv"));
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(directory, "Source reliability");
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  const imported = await app.importFolder(sources);
  expect(imported.failed, JSON.stringify(imported.job.errors)).toBe(0);
  const assets = app.catalog.listAssets();
  const video = assets.find((asset) => asset.name === "motion.mp4")!;
  app.project.stories.push({
    id: "story",
    title: "Keep this edit",
    maxDuration: options.overLimit ? 1 : 4,
    beats: [{ id: "beat", title: "Motion", selectedAssetIds: [video.id] }],
  });
  app.project.timelines.push({
    id: "composition",
    storyId: "story",
    duration: 3,
    tracks: [
      {
        id: "track",
        type: "video",
        clips: [
          {
            id: "clip",
            beatId: "beat",
            assetId: video.id,
            timelineStart: 0,
            timelineDuration: 3,
            sourceIn: 0,
            sourceOut: 3,
          },
        ],
      },
    ],
  });
  app.close();
  const runtime = await startServer({ port: 0, project: directory });
  cleanup.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}`;
  const post = (path: string, data: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const renderJobs = async (): Promise<Job[]> => {
    const response = await fetch(`${base}/api/jobs`);
    const result = (await response.json()) as { jobs: Job[] };
    return result.jobs.filter((job) => job.type === "render");
  };
  return {
    root,
    source,
    sources,
    directory,
    assets,
    video,
    base,
    post,
    renderJobs,
  };
}

describe("source and job reliability", () => {
  it("finishes an over-limit render job as failed with its specific validation error", async () => {
    const { post, renderJobs } = await fixture({ overLimit: true });
    const response = await post("/api/render", {
      compositionId: "composition",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/maximum duration/i),
    });
    const jobs = await renderJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      status: "failed",
      errors: [
        expect.objectContaining({
          message: expect.stringMatching(/maximum duration/i),
        }),
      ],
    });
  });

  it("reports a missing preview proxy separately from an available original source", async () => {
    const { source, directory, video, base } = await fixture();
    expect(video.proxyUri).toBeTruthy();
    await rm(join(directory, video.proxyUri!));
    expect((await readFile(source)).length).toBeGreaterThan(0);
    const response = await fetch(`${base}/api/source/${video.id}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/preview proxy missing.*rebuild/i),
    });
    const status = await (
      await fetch(`${base}/api/media/status?assetIds=${video.id}`)
    ).json();
    expect(status.assets).toEqual([{ assetId: video.id, status: "available" }]);
  });

  it("refuses flat playback of a recognized raw 360 catalog source", async () => {
    const { assets, base } = await fixture({ raw: true });
    const raw = assets.find((asset) => asset.name === "original.insv")!;
    expect(raw.mediaType).toBe("360-video");
    expect(raw.metadata["openfilm.insta360"]).toMatchObject({
      level: 2,
      requiresReframedExport: true,
    });
    expect(raw.metadata["openfilm.preview"]).toMatchObject({
      supported: false,
    });
    expect(raw.proxyUri).toBeUndefined();
    const response = await fetch(`${base}/api/source/${raw.id}`);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/requires reframed export/i),
    });
  });

  it("rejects an empty cached preview without leaving the HTTP request open", async () => {
    const { directory, video, base } = await fixture();
    await writeFile(join(directory, video.proxyUri!), "");
    const response = await fetch(`${base}/api/source/${video.id}`, {
      signal: AbortSignal.timeout(2000),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/empty|unavailable/i),
    });
  });

  it("rejects a changed shorter source before rendering a stale three-second source range", async () => {
    const { source, video, post, renderJobs, directory } = await fixture();
    const project = await readFile(join(directory, "project.json"));
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-i",
      join(samples, "04-motion.mp4"),
      "-t",
      "0.5",
      "-c",
      "copy",
      "-y",
      source,
    ]);
    expect(await hashFile(source)).not.toBe(video.contentHash);
    const response = await post("/api/render", {
      compositionId: "composition",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(
        /source.*changed|changed.*source|re.?import/i,
      ),
    });
    expect((await renderJobs())[0]).toMatchObject({ status: "failed" });
    expect(await readFile(join(directory, "project.json"))).toEqual(project);
  });

  it("renders an identical relinked copy even when its filesystem timestamp changed", async () => {
    const { root, source, post, video, renderJobs } = await fixture();
    const movedFolder = join(root, "new-volume");
    await mkdir(movedFolder);
    const moved = join(movedFolder, "renamed-motion.mp4");
    await copyFile(source, moved);
    await utimes(
      moved,
      new Date("2001-01-01T00:00:00Z"),
      new Date("2001-01-01T00:00:00Z"),
    );
    await rm(source);
    const planned = await post("/api/media/relink/plan", {
      assetIds: [video.id],
      file: moved,
    });
    expect(planned.status).toBe(200);
    const plan = await planned.json();
    expect(plan.matches[0].candidates[0]).toMatchObject({
      automatic: true,
      contentHash: video.contentHash,
    });
    const applied = await post("/api/media/relink/apply", {
      planId: plan.id,
      selections: [
        { assetId: video.id, candidateId: plan.matches[0].suggestedId },
      ],
    });
    expect(applied.status).toBe(200);
    const response = await post("/api/render", {
      compositionId: "composition",
    });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect((await readFile(result.path)).length).toBeGreaterThan(0);
    expect((await renderJobs())[0]).toMatchObject({ status: "completed" });
    expect(await hashFile(moved)).toBe(video.contentHash);
  });

  it("allocates a separate identity when a relinked source's original path is reused", async () => {
    const { root, source, sources, video, base, post } = await fixture();
    const movedFolder = join(root, "moved-library");
    await mkdir(movedFolder);
    const moved = join(movedFolder, "motion.mp4");
    await copyFile(source, moved);
    await rm(source);
    const plan = await (
      await post("/api/media/relink/plan", {
        assetIds: [video.id],
        file: moved,
      })
    ).json();
    expect(
      (
        await post("/api/media/relink/apply", {
          planId: plan.id,
          selections: [
            { assetId: video.id, candidateId: plan.matches[0].suggestedId },
          ],
        })
      ).status,
    ).toBe(200);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-i",
      join(samples, "04-motion.mp4"),
      "-t",
      "0.5",
      "-c",
      "copy",
      "-y",
      source,
    ]);
    const reimport = async (): Promise<MediaAsset[]> => {
      const response = await post("/api/import", { folder: sources });
      expect(response.status).toBe(202);
      const { jobId } = await response.json();
      await expect
        .poll(
          async () => {
            const { jobs } = (await (
              await fetch(`${base}/api/jobs`)
            ).json()) as { jobs: Job[] };
            return jobs.find((job) => job.id === jobId)?.status;
          },
          { timeout: 20000 },
        )
        .toBe("completed");
      return (
        (await (await fetch(`${base}/api/assets`)).json()) as {
          assets: MediaAsset[];
        }
      ).assets;
    };
    const first = await reimport();
    expect(first).toHaveLength(2);
    expect(first.find((asset) => asset.id === video.id)).toMatchObject({
      uri: pathToFileURL(moved).href,
      contentHash: video.contentHash,
    });
    const replacement = first.find(
      (asset) => asset.uri === pathToFileURL(source).href,
    )!;
    expect(replacement.id).not.toBe(video.id);
    expect(replacement.contentHash).not.toBe(video.contentHash);
    const repeated = await reimport();
    expect(repeated).toEqual(first);
    const { project } = await (await fetch(`${base}/api/project`)).json();
    expect(project.timelines[0].tracks[0].clips[0]).toMatchObject({
      assetId: video.id,
      sourceOut: 3,
    });
    expect(
      (await post("/api/render", { compositionId: "composition" })).status,
    ).toBe(200);
  });

  it("refreshes stale spherical classification when a JPEG is replaced with a flat image", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-reclassified-source-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const sources = join(root, "sources");
    await mkdir(sources);
    const plain = join(root, "flat.jpg");
    const source = join(sources, "same-name.jpg");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-i",
      join(samples, "01-photo.png"),
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      plain,
    ]);
    await copyFile(plain, source);
    const require = createRequire(import.meta.url);
    const exiftool = join(
      dirname(require.resolve("exiftool-vendored.pl/package.json")),
      "bin",
      "exiftool",
    );
    await runProcess("perl", [
      exiftool,
      "-overwrite_original",
      "-Make=Insta360",
      "-Model=X4",
      "-XMP-GPano:ProjectionType=equirectangular",
      source,
    ]);
    const app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Refresh inspected source metadata",
    );
    cleanup.push(async () => app.close());
    expect((await app.importFolder(sources)).failed).toBe(0);
    const before = app.catalog.listAssets()[0]!;
    expect(sourcePresentation(before).previewSupported).toBe(false);
    app.catalog.updateAsset(before.id, {
      rating: 5,
      tags: ["preserve"],
      state: { favorite: true },
    });
    const annotated = app.catalog.getAsset(before.id)!;
    annotated.metadata["user.note"] = { text: "Keep my annotation" };
    app.catalog.upsertAsset(annotated);
    await copyFile(plain, source);
    const imported = await app.importFolder(sources);
    expect(imported.failed, JSON.stringify(imported.job.errors)).toBe(0);
    expect(imported.imported).toBe(1);
    const after = app.catalog.getAsset(before.id)!;
    expect(app.catalog.countAssets()).toBe(1);
    expect(after).toMatchObject({
      id: before.id,
      rating: 5,
      tags: ["preserve"],
      state: { favorite: true },
      metadata: { "user.note": { text: "Keep my annotation" } },
    });
    expect(after.metadata["openfilm.insta360"]).toBeUndefined();
    expect(after.thumbnailUri).toBeTruthy();
    expect(sourcePresentation(after)).toMatchObject({
      previewSupported: true,
      requiresReframedExport: false,
      adapter: "generic",
    });
    expect(after.contentHash).not.toBe(before.contentHash);
  });
});
