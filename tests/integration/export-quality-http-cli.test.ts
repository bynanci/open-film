// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";

const exec = promisify(execFile);
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-export-quality-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "清晰影片 # &.openfilm");
  const source = join(root, "原始照片 # &.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=12",
    "-frames:v",
    "1",
    "-threads",
    "1",
    source,
  ]);
  const app = await OpenFilmApplication.create(directory, "Original memories");
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    app.close();
  };
  cleanup.push(close);
  app.project.settings = { width: 160, height: 90, frameRate: 12 };
  app.catalog.upsertAsset({
    id: "photo",
    name: "Original photo",
    uri: pathToFileURL(source).href,
    mediaType: "image",
    dimensions: { width: 160, height: 90 },
    tags: [],
    state: {},
    metadata: {},
  });
  app.project.stories.push({ id: "story", title: "Story", beats: [] });
  app.project.timelines.push({
    id: "film",
    storyId: "story",
    duration: 0.5,
    defaultLook: { version: 1, preset: "natural", strength: 0.4 },
    tracks: [
      {
        id: "pictures",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "photo",
            timelineStart: 0,
            timelineDuration: 0.5,
          },
        ],
      },
    ],
  });
  await app.save();
  return { app, root, directory, source, close };
}
const manifest = async (path: string) =>
  JSON.parse(await readFile(`${path}.manifest.json`, "utf8"));
async function server(directory: string) {
  const runtime = await startServer({ port: 0, project: directory });
  cleanup.push(() => runtime.close());
  return `http://127.0.0.1:${runtime.port}`;
}
const post = (base: string, path: string, body: unknown) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

it("application validates compression quality before creating a job", async () => {
  const { app } = await fixture();
  await expect(
    app.render("film", {
      quality: "untrusted-filter-value",
    } as unknown as Parameters<OpenFilmApplication["render"]>[1]),
  ).rejects.toMatchObject({
    code: "request.invalid",
    status: 400,
  });
  expect(app.catalog.listJobs()).toEqual([]);
});

it("application captures the output quality before asynchronous render preparation", async () => {
  const { app } = await fixture();
  const before = structuredClone(app.project);
  const options: { quality: "standard" | "high-detail" } = {
    quality: "high-detail",
  };
  const rendering = app.exportMp4("film", options);
  options.quality = "standard";
  const output = await rendering;
  expect((await manifest(output.path)).encoding).toMatchObject({
    quality: "high-detail",
    crf: 18,
    preset: "medium",
  });
  expect(app.project).toEqual(before);
});

it("HTTP preview and MP4 export use the selected quality without changing the frame or saved film", async () => {
  const { app, directory, source, close } = await fixture();
  const original = structuredClone(app.project);
  const bytes = await readFile(source);
  close();
  const base = await server(directory);
  for (const path of ["/api/render", "/api/export"]) {
    const response = await post(base, path, {
      compositionId: "film",
      quality: "high-detail",
      ...(path === "/api/export" ? { format: "mp4" } : {}),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect((await manifest(result.path)).encoding).toMatchObject({
      quality: "high-detail",
      video: "libx264",
      crf: 18,
      preset: "medium",
    });
    expect((await manifest(result.path)).settings).toEqual(original.settings);
  }
  const project = (await (await fetch(base + "/api/project")).json()).project;
  expect(project.timelines).toEqual(original.timelines);
  expect(project.settings).toEqual(original.settings);
  expect(await readFile(source)).toEqual(bytes);
}, 30000);

it("HTTP rejects malformed and interchange quality before reserving jobs", async () => {
  const { directory, close } = await fixture();
  close();
  const base = await server(directory);
  const before = await (await fetch(base + "/api/jobs")).json();
  for (const quality of [null, false, 18, {}, [], "ultra", "HIGH-DETAIL"]) {
    const response = await post(base, "/api/render", {
      compositionId: "film",
      quality,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "request.invalid" });
  }
  const response = await post(base, "/api/export", {
    compositionId: "film",
    format: "json",
    quality: "high-detail",
  });
  expect(response.status).toBe(400);
  expect(await (await fetch(base + "/api/jobs")).json()).toEqual(before);
});

it("CLI renders selected quality on Unicode paths and rejects quality for editable exports", async () => {
  const { app, directory, root, close } = await fixture();
  const original = structuredClone(app.project);
  close();
  const cli = (args: string[]) =>
    exec(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        ...args,
        "--project",
        directory,
        "--user-data-dir",
        join(root, "user-data"),
      ],
      { timeout: 20000, maxBuffer: 1024 * 1024 },
    );
  const result = await cli([
    "export",
    "--format",
    "mp4",
    "--quality",
    "high-detail",
  ]);
  expect(
    (await manifest(JSON.parse(result.stdout).path)).encoding,
  ).toMatchObject({
    quality: "high-detail",
    crf: 18,
    preset: "medium",
  });
  await expect(
    cli(["export", "--format", "otio", "--quality", "standard"]),
  ).rejects.toThrow();
  await expect(cli(["render", "--quality", "ultra"])).rejects.toThrow();
  const saved = JSON.parse(
    await readFile(join(directory, "project.json"), "utf8"),
  );
  expect(saved.settings).toEqual(original.settings);
  expect(saved.timelines).toEqual(original.timelines);
}, 30000);
