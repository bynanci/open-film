import { request as httpRequest } from "node:http";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
import type { Job, MediaAsset } from "@openfilm/core";
import { startServer } from "../../apps/server/src/server.js";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
let media: string;
beforeAll(async () => {
  media = await mkdtemp(join(tmpdir(), "openfilm-product-media-"));
  await generateSampleMedia(media);
});
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
afterAll(async () => {
  await rm(media, { recursive: true, force: true });
});

async function fixture(
  options: { maxUploadBytes?: number; project?: string } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-product-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "我的電影 # &");
  const server = await startServer({ port: 0, projectRoot, ...options });
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${server.port}/api`;
  const post = (path: string, data: unknown = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const create = async () => {
    const response = await post("/project/create", {
      title: "我們の映画 # &",
      projectContentLocale: "zh-TW",
      filmSettings: {
        templateId: "proposal-film",
        targetDuration: 3,
        maxDuration: 5,
      },
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<{
      path: string;
      project: { id: string };
    }>;
  };
  const job = async (id: string) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const { jobs } = (await (await fetch(`${base}/jobs`)).json()) as {
        jobs: Job[];
      };
      const found = jobs.find((item) => item.id === id);
      if (found && !["queued", "running"].includes(found.status)) return found;
      await new Promise((accept) => setTimeout(accept, 20));
    }
    throw new Error("Import did not finish");
  };
  return { root, projectRoot, server, base, post, create, job };
}

it("creates films without paths, preserves locale defaults, and inspects recent availability without opening projects", async () => {
  const test = await fixture();
  const workspace = await (await fetch(`${test.base}/workspace`)).json();
  expect(workspace.defaultProjectRoot).toBe(test.projectRoot);
  expect(workspace.systemLocale).toEqual(expect.any(String));
  expect(workspace.defaults).toMatchObject({
    templateId: "proposal-film",
    targetDuration: 270,
    maxDuration: 300,
  });
  const first = await test.create();
  expect(first.path.startsWith(`${test.projectRoot}/`)).toBe(true);
  expect(basename(first.path)).toContain("我們の映画 # &");
  const before = await readFile(join(first.path, "project.json"));
  const database = await readFile(join(first.path, "database.sqlite"));
  expect(JSON.parse(before.toString())).toMatchObject({
    projectContentLocale: "zh-TW",
    filmSettings: {
      templateId: "proposal-film",
      targetDuration: 3,
      maxDuration: 5,
    },
    stories: [],
  });
  const invalid = join(test.root, "invalid");
  await mkdir(invalid);
  await writeFile(join(invalid, "project.json"), "{}");
  await writeFile(join(invalid, "database.sqlite"), "untouched");
  const missing = join(test.root, "missing");
  const response = await test.post("/projects/availability", {
    paths: [first.path, missing, invalid],
  });
  expect(await response.json()).toEqual({
    projects: [
      { path: first.path, status: "available" },
      { path: missing, status: "missing" },
      { path: invalid, status: "invalid" },
    ],
  });
  expect((await (await fetch(`${test.base}/project`)).json()).project.id).toBe(
    first.project.id,
  );
  expect(await readFile(join(first.path, "project.json"))).toEqual(before);
  expect(await readFile(join(first.path, "database.sqlite"))).toEqual(database);
  const updated = await fetch(`${test.base}/project`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectContentLocale: "ja-JP" }),
  });
  expect(updated.status).toBe(200);
  await test.post("/project/open", { path: first.path });
  expect(
    (await (await fetch(`${test.base}/project`)).json()).project
      .projectContentLocale,
  ).toBe("ja-JP");
  const second = await test.create();
  expect(second.path).not.toBe(first.path);
  const explicit = join(test.root, "Advanced # &.openfilm");
  expect(
    (await test.post("/project/create", { title: "Explicit", path: explicit }))
      .status,
  ).toBe(200);
  expect((await (await fetch(`${test.base}/project`)).json()).path).toBe(
    explicit,
  );
  const longTitle = "旅🌸".repeat(100);
  const long = await test.post("/project/create", { title: longTitle });
  expect(long.status).toBe(200);
  const longFilm = await long.json();
  expect(longFilm.project.title).toBe(longTitle);
  expect(Buffer.byteLength(basename(longFilm.path))).toBeLessThan(255);
});

it("imports only selected native files and streams browser copies with Unicode names without changing originals", async () => {
  const test = await fixture();
  const film = await test.create();
  const originals = join(test.root, "原本 # &");
  await mkdir(originals);
  const selected = join(originals, "選んだ # &.png");
  const excluded = join(originals, "not-selected.png");
  await copyFile(join(media, "01-photo.png"), selected);
  await copyFile(join(media, "02-photo-copy.png"), excluded);
  const bytes = await readFile(selected);
  const imported = await test.post("/import", { files: [selected] });
  expect(imported.status).toBe(202);
  expect((await test.job((await imported.json()).jobId)).status).toBe(
    "completed",
  );
  const native = await (await fetch(`${test.base}/assets`)).json();
  expect(native.assets.map((asset: { name: string }) => asset.name)).toEqual([
    basename(selected),
  ]);
  expect(native.summary).toEqual({ total: 1, images: 1, videos: 0, audio: 0 });
  const upload = await fetch(
    `${test.base}/import/upload?${new URLSearchParams({ name: "複製の写真 # &.png" })}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    },
  );
  expect(upload.status).toBe(201);
  const { uploadId } = await upload.json();
  const queued = await test.post("/import", { uploads: [uploadId] });
  expect(queued.status).toBe(202);
  expect((await test.job((await queued.json()).jobId)).status).toBe(
    "completed",
  );
  const all = await (await fetch(`${test.base}/assets`)).json();
  expect(all.total).toBe(2);
  const managed = all.assets.find(
    (asset: { name: string }) => asset.name === "複製の写真 # &.png",
  );
  expect(
    fileURLToPath(managed.uri).startsWith(join(film.path, "sources")),
  ).toBe(true);
  expect(await readFile(fileURLToPath(managed.uri))).toEqual(bytes);
  expect(await readFile(selected)).toEqual(bytes);
  expect(await readFile(excluded)).toEqual(
    await readFile(join(media, "02-photo-copy.png")),
  );
  expect((await test.post("/import", { uploads: [uploadId] })).status).toBe(
    400,
  );
  const internal = await test.post("/import", {
    files: [fileURLToPath(managed.uri)],
  });
  expect((await test.job((await internal.json()).jobId)).status).toBe(
    "completed",
  );
  expect((await (await fetch(`${test.base}/assets`)).json()).total).toBe(2);
  await test.post("/project/close");
  const moved = join(test.root, "移動した映画 # &.openfilm");
  await rename(film.path, moved);
  expect((await test.post("/project/open", { path: moved })).status).toBe(200);
  const status = await (await fetch(`${test.base}/media/status`)).json();
  expect(
    status.assets.every(
      (asset: { status: string }) => asset.status === "available",
    ),
  ).toBe(true);
  const movedAssets = await (await fetch(`${test.base}/assets`)).json();
  const relocated = movedAssets.assets.find(
    (asset: { id: string }) => asset.id === managed.id,
  );
  expect(relocated.metadata["openfilm.reference"].originalUri).toBe(
    managed.metadata["openfilm.reference"].originalUri,
  );
  const story = await (
    await test.post("/stories", {
      template: "blank",
      targetDuration: 1,
      maxDuration: 2,
      assetIds: [managed.id],
    })
  ).json();
  const composition = await (
    await test.post("/compose", { storyId: story.story.id })
  ).json();
  const exported = await (
    await test.post("/export", {
      format: "json",
      compositionId: composition.composition.id,
    })
  ).json();
  expect(await readFile(exported.path, "utf8")).toContain(relocated.uri);
});

it("rejects unsafe upload names, oversized streams, unsupported formats, and foreign receipts with structured errors", async () => {
  const test = await fixture({ maxUploadBytes: 8 });
  const film = await test.create();
  for (const [name, data, expected] of [
    ["../escape.png", "x", 400],
    ["file.exe", "x", 415],
    ["big.png", "123456789", 413],
  ] as const) {
    const response = await fetch(
      `${test.base}/import/upload?${new URLSearchParams({ name })}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: data,
      },
    );
    expect(response.status).toBe(expected);
    expect(await response.json()).toMatchObject({
      error: expect.any(String),
      code: expect.any(String),
      detail: expect.any(String),
    });
  }
  const chunked = await new Promise<{ status: number; body: unknown }>(
    (accept, reject) => {
      const request = httpRequest(
        `${test.base}/import/upload?name=chunked.png`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            accept({
              status: response.statusCode!,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            }),
          );
        },
      );
      request.on("error", reject);
      request.write("1234");
      request.end("56789");
    },
  );
  expect(chunked).toMatchObject({
    status: 413,
    body: { code: "request.tooLarge" },
  });
  expect(await readdir(join(film.path, "sources"))).toEqual([]);
  const uploaded = await fetch(`${test.base}/import/upload?name=ok.png`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: "ok",
  });
  const receipt = await uploaded.json();
  await test.create();
  expect(
    (await test.post("/import", { uploads: [receipt.uploadId] })).status,
  ).toBe(400);
  expect(await readdir(join(film.path, "sources"))).toEqual([]);
  await test.post("/project/close");
  const required = await fetch(`${test.base}/assets`);
  expect(await required.json()).toMatchObject({
    code: "project.required",
    error: expect.any(String),
  });
});

it("ignores persisted managed-source paths that escape the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-managed-traversal-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "film.openfilm");
  const asset = {
    id: "original",
    uri: pathToFileURL(join(media, "01-photo.png")).href,
    name: "Photo",
    mediaType: "image" as const,
    tags: [],
    state: {},
    metadata: {
      "openfilm.managedSource": {
        relativePath: "sources/../../outside.png",
        uri: pathToFileURL(join(media, "01-photo.png")).href,
      },
    },
  };
  const app = await OpenFilmApplication.create(
    project,
    "Managed path validation",
  );
  app.catalog.upsertAsset(asset);
  const relinked = {
    ...asset,
    id: "relinked-external",
    uri: pathToFileURL(join(media, "02-photo-copy.png")).href,
    metadata: {
      "openfilm.managedSource": {
        relativePath: "sources/old/photo.png",
        uri: pathToFileURL(join(project, "sources/old/photo.png")).href,
      },
    },
  };
  app.catalog.upsertAsset(relinked);
  app.close();
  const reopened = await OpenFilmApplication.open(project);
  try {
    expect(reopened.catalog.getAsset(asset.id)).toEqual(asset);
    expect(reopened.catalog.getAsset(relinked.id)).toEqual(relinked);
  } finally {
    reopened.close();
  }
});

it("cancels a streamed upload, blocks project replacement while it runs, and removes partial bytes", async () => {
  const test = await fixture();
  const film = await test.create();
  const request = httpRequest(`${test.base}/import/upload?name=partial.png`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
  });
  request.on("error", () => {});
  request.write("partial bytes");
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await readdir(join(film.path, "sources")).catch(() => [])).length)
      break;
    await new Promise((accept) => setTimeout(accept, 10));
  }
  expect((await test.post("/project/close")).status).toBe(409);
  request.destroy();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await readdir(join(film.path, "sources"))).length) break;
    await new Promise((accept) => setTimeout(accept, 10));
  }
  expect(await readdir(join(film.path, "sources"))).toEqual([]);
  expect((await test.post("/project/close")).status).toBe(200);
});

it("finishes a real MP4 and downloads its bytes from the current project", async () => {
  const test = await fixture();
  await test.create();
  const imported = await test.post("/import", {
    files: [join(media, "01-photo.png")],
  });
  await test.job((await imported.json()).jobId);
  const story = await test.post("/stories", {
    template: "blank",
    targetDuration: 1,
    maxDuration: 2,
  });
  const { composition } = await (
    await test.post("/compose", { storyId: (await story.json()).story.id })
  ).json();
  const response = await test.post("/export", {
    format: "mp4",
    compositionId: composition.id,
  });
  expect(response.status).toBe(200);
  const exported = await response.json();
  expect(exported.report).toEqual({ format: "mp4", warnings: [] });
  expect(exported.path).toContain("/exports/");
  const probe = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    exported.path,
  ]);
  expect(
    Number(JSON.parse(probe.stdout.toString()).format.duration),
  ).toBeGreaterThan(0.9);
  const download = await fetch(
    `${test.base}/export/file?${new URLSearchParams({ name: exported.filename })}`,
  );
  expect(download.status).toBe(200);
  expect(download.headers.get("content-disposition")).toContain("attachment");
  expect(Buffer.from(await download.arrayBuffer())).toEqual(
    await readFile(exported.path),
  );
  const traversal = await fetch(
    `${test.base}/export/file?name=..%2Fproject.json`,
  );
  expect(traversal.status).toBe(400);
});

it("cancels an MP4 export job without publishing a partial movie", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-export-cancel-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(project, "Long film");
  app.catalog.upsertAsset({
    id: "photo",
    uri: pathToFileURL(join(media, "01-photo.png")).href,
    name: "Photo",
    mediaType: "image",
    tags: [],
    state: {},
    metadata: {},
  });
  app.project.stories.push({
    id: "story",
    title: "Long",
    beats: [{ id: "beat", title: "Long" }],
  });
  app.project.timelines.push({
    id: "timeline",
    storyId: "story",
    duration: 300,
    tracks: [
      {
        id: "visual",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "photo",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 300,
          },
        ],
      },
    ],
  });
  app.close();
  const test = await fixture({ project });
  const rendering = test.post("/export", {
    format: "mp4",
    compositionId: "timeline",
  });
  let jobId: string | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    const { jobs } = (await (await fetch(`${test.base}/jobs`)).json()) as {
      jobs: Job[];
    };
    jobId = jobs.find(
      (job) =>
        job.type === "render" && ["running", "queued"].includes(job.status),
    )?.id;
    if (jobId) break;
    await new Promise((accept) => setTimeout(accept, 10));
  }
  expect(jobId).toBeDefined();
  expect((await test.post(`/jobs/${jobId}/cancel`)).status).toBe(200);
  expect((await rendering).status).toBe(400);
  expect((await test.job(jobId!)).status).toBe("cancelled");
  expect(await readdir(join(project, "exports"))).toEqual([]);
});

it("refreshes one beat from current preferences without replacing selected memories or manual text", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-suggestions-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(project, "Suggestion refresh");
  const candidates = [
    "a",
    "b",
    "selected",
    "locked",
    "required",
    "rejected",
    "unsupported",
  ];
  for (const id of candidates) {
    const asset: MediaAsset = {
      id,
      uri: pathToFileURL(join(root, `${id}.png`)).href,
      name: id,
      mediaType: "image",
      tags: [],
      rating: id === "b" ? 5 : 0,
      state: {
        favorite: id === "b",
        rejected: ["selected", "locked", "rejected"].includes(id),
        locked: id === "locked",
      },
      metadata: ["required", "unsupported"].includes(id)
        ? {
            "openfilm.preview": { supported: false, reason: "Requires export" },
          }
        : {},
    };
    app.catalog.upsertAsset(asset);
  }
  app.project.stories.push({
    id: "story",
    title: "Authored story",
    beats: [
      {
        id: "beat",
        title: "私たちの手書き",
        titleSource: "user",
        intent: "Keep this intent",
        intentSource: "user",
        templateBeatKey: "story.opening",
        targetDuration: 4,
        candidateAssetIds: candidates,
        selectedAssetIds: ["selected"],
        constraints: [{ type: "must-include", assetIds: ["required"] }],
      },
      { id: "other", title: "Unchanged", candidateAssetIds: ["a"] },
    ],
  });
  app.project.timelines.push({
    id: "timeline",
    storyId: "story",
    duration: 1,
    tracks: [
      {
        id: "track",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "selected",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 1,
            locked: true,
          },
        ],
      },
    ],
  });
  const before = structuredClone(app.project);
  app.close();
  const test = await fixture({ project });
  const refresh = await test.post("/stories/story/beats/beat/suggestions");
  expect(refresh.status).toBe(200);
  const { story } = await refresh.json();
  expect(story.beats[0].candidateAssetIds).toEqual([
    "b",
    "a",
    "required",
    "locked",
    "selected",
  ]);
  expect(story).toEqual({
    ...before.stories[0],
    beats: [
      {
        ...before.stories[0]!.beats[0],
        candidateAssetIds: story.beats[0].candidateAssetIds,
      },
      before.stories[0]!.beats[1],
    ],
  });
  expect(
    (await (await fetch(`${test.base}/project`)).json()).project.timelines,
  ).toEqual(before.timelines);
});

it("rebuilds a known managed video's missing proxy without importing arbitrary project files or changing its identity", async () => {
  const test = await fixture();
  const film = await test.create();
  const bytes = await readFile(join(media, "04-motion.mp4"));
  const uploaded = await fetch(
    `${test.base}/import/upload?${new URLSearchParams({ name: "記憶 # &.mp4" })}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    },
  );
  const { uploadId } = await uploaded.json();
  const queued = await test.post("/import", { uploads: [uploadId] });
  expect((await test.job((await queued.json()).jobId)).status).toBe(
    "completed",
  );
  const before = (await (await fetch(`${test.base}/assets`)).json())
    .assets[0] as MediaAsset;
  await rm(join(film.path, before.proxyUri!));
  expect((await fetch(`${test.base}/source/${before.id}`)).status).toBe(404);
  const arbitrary = join(film.path, "do-not-import.png");
  await copyFile(join(media, "01-photo.png"), arbitrary);
  const rebuild = await test.post("/import", {
    files: [fileURLToPath(before.uri), arbitrary],
  });
  expect((await test.job((await rebuild.json()).jobId)).status).toBe(
    "completed",
  );
  const after = await (await fetch(`${test.base}/assets`)).json();
  expect(after.total).toBe(1);
  expect(after.assets[0].id).toBe(before.id);
  expect(after.assets[0].uri).toBe(before.uri);
  expect((await fetch(`${test.base}/source/${before.id}`)).status).toBe(200);
  expect(await readFile(fileURLToPath(before.uri))).toEqual(bytes);
});
