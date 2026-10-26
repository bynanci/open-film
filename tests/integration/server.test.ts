// Modified by OpenFilm contributors on 2026-10-18. Current license: Apache-2.0.
// Historical Apache-2.0 and GPL-3.0-only grants remain; see LICENSE and NOTICE.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../../apps/server/src/server.js";
import {
  api as desktopApi,
  configureNativeConnection,
  request as desktopRequest,
} from "../../apps/desktop/src/api.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
describe("loopback application boundary", () => {
  it("passes typed Desktop timebase edits and suppresses aborted or replaced connection results", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-timebase-desktop-api-"),
    );
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const session = "a".repeat(64);
    const runtime = await startServer({ port: 0, nativeSession: session });
    cleanup.push(() => runtime.close());
    configureNativeConnection(runtime.port, session);
    const directory = join(root, "film.openfilm");
    const timebase = {
      version: 1,
      rateNumerator: 30000,
      rateDenominator: 1001,
      dropFrame: false,
    } as const;
    const { project } = await desktopApi.createProject({
      path: directory,
      title: "Desktop timebase",
      timebase,
    });
    expect(project.settings).toMatchObject({
      timebase,
      frameRate: 30000 / 1001,
    });
    const { revision } = await desktopRequest<{ revision: string }>(
      "/versions/revision",
    );
    const input = {
      projectId: project.id,
      baseRevision: revision,
      timebase: { ...timebase, dropFrame: true },
    };
    const before = await readFile(join(directory, "project.json"), "utf8");
    const controller = new AbortController();
    controller.abort();
    await expect(
      desktopApi.updateProjectTimebase(input, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readFile(join(directory, "project.json"), "utf8")).toBe(
      before,
    );
    const updated = await desktopApi.updateProjectTimebase(input);
    expect(updated.project.settings.timebase?.dropFrame).toBe(true);
    const current = await desktopRequest<{ revision: string }>(
      "/versions/revision",
    );
    const pending = desktopApi.updateProjectTimebase({
      ...input,
      baseRevision: current.revision,
      timebase,
    });
    configureNativeConnection(runtime.port, "b".repeat(64));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    configureNativeConnection(runtime.port, session);
    expect(
      (await desktopRequest<{ project: { id: string } }>("/project")).project
        .id,
    ).toBe(project.id);
  });

  it("persists strict timebase creation and fences dedicated updates with revision digests", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-timebase-api-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const runtime = await startServer({ port: 0 });
    cleanup.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}`;
    const send = (path: string, value: unknown, method = "PATCH") =>
      fetch(`${base}/api${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
    const timebase = {
      version: 1,
      rateNumerator: 30000,
      rateDenominator: 1001,
      dropFrame: false,
    };
    const directory = join(root, "film.openfilm");
    const created = await send(
      "/project/create",
      { path: directory, title: "Timebase", timebase },
      "POST",
    );
    expect(created.status).toBe(200);
    let { project } = await created.json();
    expect(project.settings).toMatchObject({
      timebase,
      frameRate: 30000 / 1001,
    });
    const projectPath = join(directory, "project.json");
    expect(JSON.parse(await readFile(projectPath, "utf8")).settings).toEqual(
      project.settings,
    );
    const revision = async () =>
      (await (await fetch(`${base}/api/versions/revision`)).json()).revision;
    const baseRevision = await revision();
    const input = {
      projectId: project.id,
      baseRevision,
      timebase: { ...timebase, dropFrame: true },
    };
    const before = await readFile(projectPath, "utf8");
    for (const value of [
      { ...input, projectId: "foreign-project" },
      { ...input, baseRevision: "0".repeat(64) },
    ]) {
      const response = await send("/project/timebase", value);
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("project.timebaseConflict");
      expect(await readFile(projectPath, "utf8")).toBe(before);
    }
    for (const value of [
      { ...input, extra: true },
      { ...input, timebase: { ...timebase, extra: true } },
      { ...input, timebase: { ...timebase, version: 2 } },
      { ...input, timebase: { ...timebase, rateNumerator: 0 } },
      { ...input, timebase: { ...timebase, rateDenominator: 1.5 } },
      { ...input, timebase: { ...timebase, dropFrame: "yes" } },
      {
        ...input,
        timebase: {
          ...timebase,
          rateNumerator: 24,
          rateDenominator: 1,
          dropFrame: true,
        },
      },
      { ...input, timebase: null },
      { ...input, baseRevision: 123 },
      { ...input, baseRevision: "yesterday" },
    ]) {
      expect((await send("/project/timebase", value)).status).toBe(400);
      expect(await readFile(projectPath, "utf8")).toBe(before);
    }
    expect((await send("/project", { timebase })).status).toBe(400);
    const updated = await send("/project/timebase", input);
    expect(updated.status).toBe(200);
    project = (await updated.json()).project;
    expect(project.settings.timebase.dropFrame).toBe(true);
    expect(JSON.parse(await readFile(projectPath, "utf8")).settings).toEqual(
      project.settings,
    );
    const rational = {
      version: 1,
      rateNumerator: 24,
      rateDenominator: 1,
      dropFrame: false,
    };
    expect(
      (
        await send("/project/timebase", {
          projectId: project.id,
          baseRevision: await revision(),
          timebase: rational,
        })
      ).status,
    ).toBe(200);
    expect(
      JSON.parse(await readFile(projectPath, "utf8")).settings,
    ).toMatchObject({ timebase: rational, frameRate: 24 });
    const staleBytes = await readFile(projectPath, "utf8");
    expect((await send("/project/timebase", input)).status).toBe(409);
    expect(await readFile(projectPath, "utf8")).toBe(staleBytes);
  });

  it("rejects extra or malformed timebase creation fields before writing a project", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-timebase-invalid-api-"),
    );
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const runtime = await startServer({ port: 0 });
    cleanup.push(() => runtime.close());
    for (const timebase of [
      {
        version: 1,
        rateNumerator: 24,
        rateDenominator: 1,
        dropFrame: false,
        extra: true,
      },
      { version: 1, rateNumerator: 24, rateDenominator: 0, dropFrame: false },
    ]) {
      const response = await fetch(
        `http://127.0.0.1:${runtime.port}/api/project/create`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: join(root, "invalid.openfilm"),
            title: "Invalid",
            timebase,
          }),
        },
      );
      expect(response.status).toBe(400);
      await expect(
        readFile(join(root, "invalid.openfilm", "project.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("rejects HTTP rate conform for a populated project with byte-identical saved state", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-timebase-populated-api-"),
    );
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "film.openfilm");
    const app = await OpenFilmApplication.create(
      directory,
      "Populated timebase",
      {
        timebase: {
          version: 1,
          rateNumerator: 30000,
          rateDenominator: 1001,
          dropFrame: false,
        },
      },
    );
    app.project.stories.push({
      id: "story",
      title: "Story",
      targetDuration: 6,
      maxDuration: 8,
      beats: [],
    });
    app.project.timelines.push({
      id: "timed",
      storyId: "story",
      duration: 6,
      tracks: [],
    });
    app.close({ requireSave: true });
    const runtime = await startServer({ port: 0 });
    cleanup.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}/api`;
    const opened = await fetch(`${base}/project/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: directory }),
    });
    expect(opened.status).toBe(200);
    const { project } = await opened.json();
    const { revision } = await (
      await fetch(`${base}/versions/revision`)
    ).json();
    const before = await readFile(join(directory, "project.json"), "utf8");
    const response = await fetch(`${base}/project/timebase`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        baseRevision: revision,
        timebase: {
          version: 1,
          rateNumerator: 24,
          rateDenominator: 1,
          dropFrame: false,
        },
      }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("project.timebaseConflict");
    expect(await readFile(join(directory, "project.json"), "utf8")).toBe(
      before,
    );
    expect((await (await fetch(`${base}/project`)).json()).project).toEqual(
      project,
    );
    const df = await fetch(`${base}/project/timebase`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        baseRevision: revision,
        timebase: {
          version: 1,
          rateNumerator: 30000,
          rateDenominator: 1001,
          dropFrame: true,
        },
      }),
    });
    expect(df.status).toBe(200);
    expect((await df.json()).project.settings.timebase.dropFrame).toBe(true);
  });

  async function healthRequest(port: number, headers: Record<string, string>) {
    return new Promise<{ status: number; allowedOrigin: string }>(
      (accept, reject) => {
        const outgoing = request(
          `http://127.0.0.1:${port}/api/health`,
          { headers },
          (response) => {
            response.resume();
            response.on("error", reject);
            response.on("end", () =>
              accept({
                status: response.statusCode!,
                allowedOrigin: String(
                  response.headers["access-control-allow-origin"] ?? "",
                ),
              }),
            );
          },
        );
        outgoing.on("error", reject);
        outgoing.end();
      },
    );
  }

  it("requires an exact loopback Host even when forwarding headers claim a trusted host", async () => {
    const runtime = await startServer({ port: 0 });
    cleanup.push(() => runtime.close());
    const trustedHost = `127.0.0.1:${runtime.port}`;
    const rebindingHost = `attacker.example:${runtime.port}`;
    const rejected: Record<string, string>[] = [
      { Host: rebindingHost },
      { Host: `localhost.attacker.example:${runtime.port}` },
      { Host: `127.0.0.1.attacker.example:${runtime.port}` },
      { Host: "127.0.0.1" },
      { Host: rebindingHost, "X-Forwarded-Host": trustedHost },
      { Host: rebindingHost, Forwarded: `host="${trustedHost}"` },
    ];
    for (const headers of rejected) {
      const response = await healthRequest(runtime.port, {
        ...headers,
        Origin: "http://127.0.0.1:1420",
      });
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(response.allowedOrigin).toBe("");
    }
  });

  it("rejects null origins before handling requests or CORS preflights", async () => {
    const runtime = await startServer({ port: 0 });
    cleanup.push(() => runtime.close());
    for (const method of ["GET", "POST", "OPTIONS"]) {
      const response = await fetch(
        `http://127.0.0.1:${runtime.port}/api/health`,
        { method, headers: { Origin: "null" } },
      );
      expect(response.status, method).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(await response.json()).toMatchObject({
        code: "request.forbidden",
      });
    }
  });

  it("accepts both exact loopback hosts and the configured desktop origins", async () => {
    const runtime = await startServer({ port: 0 });
    cleanup.push(() => runtime.close());
    for (const host of ["localhost", "127.0.0.1"]) {
      for (const origin of [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://tauri.localhost",
        "tauri://localhost",
      ]) {
        const response = await healthRequest(runtime.port, {
          Host: `${host}:${runtime.port}`,
          Origin: origin,
          "Sec-Fetch-Site": "cross-site",
        });
        expect(response.status, `${host} ${origin}`).toBe(200);
        expect(response.allowedOrigin).toBe(origin);
      }
    }
  });

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
      summary: { total: 0, images: 0, videos: 0, audio: 0 },
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
