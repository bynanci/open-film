import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../../apps/server/src/server.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
describe("loopback application boundary", () => {
  it("creates, reopens and reads a real SQLite project while rejecting cross-site requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-api-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const runtime = await startServer({ port: 0 });
    cleanup.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}`;
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    const blocked = await fetch(`${base}/api/project`, {
      headers: { Origin: "https://example.com" },
    });
    expect(blocked.status).toBe(403);
    const projectPath = join(root, "film.openfilm");
    const created = await fetch(`${base}/api/project/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, title: "Local story" }),
    });
    expect(created.status).toBe(200);
    expect((await created.json()).project.title).toBe("Local story");
    expect((await fetch(`${base}/api/assets?limit=0`)).status).toBe(400);
    expect(await (await fetch(`${base}/api/assets`)).json()).toEqual({
      assets: [],
      total: 0,
    });
    const opened = await fetch(`${base}/api/project/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath }),
    });
    expect(opened.status).toBe(200);
    expect((await opened.json()).project.title).toBe("Local story");
    expect(
      (
        await fetch(`${base}/api/project`, {
          headers: { "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
    ).toBe(403);
  });
  it("rejects form posts and malformed request bodies without creating projects", async () => {
    const runtime = await startServer({ port: 0 });
    cleanup.push(() => runtime.close());
    const url = `http://127.0.0.1:${runtime.port}/api/project/create`;
    expect((await fetch(url, { method: "POST", body: "title=x" })).status).toBe(
      415,
    );
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "[]",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(400);
  });
});

import { request } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";

async function populatedProject(root: string, duration = 2) {
  const source = join(root, "original.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=320x180",
    "-frames:v",
    "1",
    "-threads",
    "1",
    source,
  ]);
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(directory, "Review");
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.catalog.upsertAsset({
    id: "asset",
    uri: pathToFileURL(source).href,
    name: "Original",
    mediaType: "image",
    tags: [],
    state: {},
    metadata: {},
  });
  app.project.stories.push({
    id: "story",
    title: "Original",
    beats: [{ id: "beat", title: "Beat", selectedAssetIds: ["asset"] }],
  });
  app.project.timelines.push({
    id: "timeline",
    storyId: "story",
    duration,
    tracks: [
      {
        id: "video",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "asset",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: duration,
          },
        ],
      },
    ],
  });
  app.close();
  return directory;
}

describe("durable edits and cancellation", () => {
  it("keeps memory and disk unchanged after an edit breaks a timeline reference", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-edit-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = await populatedProject(root);
    const runtime = await startServer({ port: 0, project: directory });
    cleanup.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}`;
    const edited = await fetch(`${base}/api/stories/story`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        beats: [
          { id: "different", title: "Changed", selectedAssetIds: ["asset"] },
        ],
      }),
    });
    expect(edited.status).toBe(400);
    const current = await (await fetch(`${base}/api/project`)).json();
    expect(current.project.stories[0].beats[0].id).toBe("beat");
    expect(
      JSON.parse(await readFile(join(directory, "project.json"), "utf8"))
        .stories[0].beats[0].id,
    ).toBe("beat");
  });

  it("serializes a partially received edit before reopening the same project", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-concurrent-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = await populatedProject(root);
    const runtime = await startServer({ port: 0, project: directory });
    cleanup.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}`;
    const bytes = JSON.stringify({ title: "Edited" });
    let finish!: () => void;
    const pending = new Promise<number>((accept, reject) => {
      const partial = request(
        `${base}/api/stories/story`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(bytes),
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => accept(response.statusCode!));
        },
      );
      partial.on("error", reject);
      partial.write(bytes.slice(0, 1));
      finish = () => partial.end(bytes.slice(1));
    });
    await new Promise((accept) => setTimeout(accept, 30));
    const opening = fetch(`${base}/api/project/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: directory }),
    });
    finish();
    expect(await pending).toBe(200);
    expect((await opening).status).toBe(200);
    const current = await (await fetch(`${base}/api/project`)).json();
    expect(current.project.stories[0].title).toBe("Edited");
    expect(
      JSON.parse(await readFile(join(directory, "project.json"), "utf8"))
        .stories[0].title,
    ).toBe("Edited");
  });

  it("cancels an actual FFmpeg render and prevents switching its project", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-render-cancel-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = await populatedProject(root, 300);
    const runtime = await startServer({ port: 0, project: directory });
    cleanup.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}`;
    const post = (path: string, data: unknown) =>
      fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    const rendering = post("/api/render", { compositionId: "timeline" });
    let jobId: string | undefined;
    for (let attempt = 0; attempt < 100 && !jobId; attempt++) {
      const result = await (await fetch(`${base}/api/jobs`)).json();
      jobId = result.jobs.find(
        (job: { type: string; status: string }) =>
          job.type === "render" && ["running", "queued"].includes(job.status),
      )?.id;
      if (!jobId) await new Promise((accept) => setTimeout(accept, 10));
    }
    expect(jobId).toBeTruthy();
    expect((await post("/api/project/open", { path: directory })).status).toBe(
      409,
    );
    expect((await post(`/api/jobs/${jobId}/cancel`, {})).status).toBe(200);
    expect((await rendering).status).toBe(400);
    const result = await (await fetch(`${base}/api/jobs`)).json();
    expect(
      result.jobs.find((job: { id: string }) => job.id === jobId).status,
    ).toBe("cancelled");
  });
});
