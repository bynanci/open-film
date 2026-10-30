// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import * as media from "@openfilm/media";
import { hashFile, runProcess, WAVEFORM_CACHE_IDENTITY } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-wave-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const projects: { id: string; path: string; source: string; hash: string }[] =
    [];
  for (let index = 0; index < 2; index++) {
    const source = join(root, `synthetic-${index}.wav`);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${440 + index * 440}:sample_rate=8000:duration=0.5`,
      "-c:a",
      "pcm_s16le",
      source,
    ]);
    const hash = await hashFile(source);
    const path = join(root, `project-${index}.openfilm`);
    const app = await OpenFilmApplication.create(
      path,
      `Synthetic project ${index}`,
    );
    try {
      app.catalog.upsertAsset({
        id: "source",
        uri: pathToFileURL(source).href,
        name: "Synthetic tone",
        mediaType: "audio",
        duration: 0.5,
        contentHash: hash,
        tags: [],
        state: { locked: true },
        metadata: {},
      });
      app.catalog.intelligence.saveWaveform({
        assetId: "source",
        duration: 0.5,
        sampleRate: 8,
        peaks: [0, 1, 0.5, 0],
        provenance: {
          ...WAVEFORM_CACHE_IDENTITY,
          sourceHash: hash,
          createdAt: "2026-10-30T00:00:00Z",
        },
      });
      await app.save();
      projects.push({ id: app.project.id, path, source, hash });
    } finally {
      app.close();
    }
  }
  const server = await startServer({
    port: 0,
    project: projects[0]!.path,
    projectRoot: root,
  });
  cleanup.push(() => server.close());
  const post = (path: string, data: unknown, signal?: AbortSignal) =>
    fetch(`http://127.0.0.1:${server.port}/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal,
    });
  return { root, projects, post };
}
it("serves bounded path-free waveform evidence through the current project owner", async () => {
  const { projects, post } = await fixture();
  const first = projects[0]!;
  const before = await readFile(join(first.path, "project.json"));
  const response = await post("/intelligence/waveforms", {
    projectId: first.id,
    assetIds: ["source"],
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["entries", "projectId"]);
  expect(body.projectId).toBe(first.id);
  expect(body.entries[0]).toMatchObject({
    assetId: "source",
    status: "ready",
    sourceHash: first.hash,
    waveform: { peaks: [0, 1, 0.5, 0] },
  });
  expect(JSON.stringify(body)).not.toContain(first.path);
  expect(JSON.stringify(body)).not.toContain(first.source);
  expect(
    await post("/intelligence/waveforms", {
      projectId: first.id,
      assetIds: Array.from({ length: 9 }, (_, i) => `source-${i}`),
    }),
  ).toMatchObject({ status: 400 });
  expect(
    await post("/intelligence/waveforms", {
      projectId: first.id,
      assetIds: ["source"],
      path: first.source,
    }),
  ).toMatchObject({ status: 400 });
  expect(
    await post("/intelligence/waveforms", {
      projectId: projects[1]!.id,
      assetIds: ["source"],
    }),
  ).toMatchObject({ status: 409 });
  expect(await readFile(join(first.path, "project.json"))).toEqual(before);
  expect(await hashFile(first.source)).toBe(first.hash);
});
it("fences a delayed read and queued preparation when projects share the same asset ID", async () => {
  const { projects, post } = await fixture();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const original = media.hashFile;
  const spy = vi
    .spyOn(media, "hashFile")
    .mockImplementation(async (path, signal) => {
      if (path === projects[0]!.source) {
        entered();
        await new Promise<void>((resolve, reject) => {
          const abort = () =>
            reject(new DOMException("Source read cancelled", "AbortError"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
          void held.then(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
          });
        });
      }
      return original(path, signal);
    });
  const pending = post("/intelligence/waveforms", {
    projectId: projects[0]!.id,
    assetIds: ["source"],
  });
  try {
    await Promise.race([
      started,
      pending.then((response) => {
        throw new Error(
          `Read returned ${response.status} before reaching the ownership boundary.`,
        );
      }),
    ]);
    expect(
      (
        await post(
          "/project/open",
          { path: projects[1]!.path },
          AbortSignal.timeout(10_000),
        )
      ).status,
    ).toBe(200);
  } finally {
    release();
    await pending;
  }
  const stale = await pending;
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "project.unavailable" });
  spy.mockRestore();
  const current = await post("/intelligence/waveforms", {
    projectId: projects[1]!.id,
    assetIds: ["source"],
  });
  expect(current.status).toBe(200);
  expect((await current.json()).entries[0].sourceHash).toBe(projects[1]!.hash);
  const stalePrepare = await post("/assets/source/intelligence", {
    operation: "waveform",
    projectId: projects[0]!.id,
  });
  expect(stalePrepare.status).toBe(409);
  expect(await stalePrepare.json()).toMatchObject({
    code: "project.unavailable",
  });
  for (const project of projects)
    expect(await hashFile(project.source)).toBe(project.hash);
});

it("cancels disconnected source hashing and permits a fresh retry", async () => {
  const { projects, post } = await fixture();
  let entered!: () => void, cancelled!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const stopped = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let blocked = false;
  const original = media.hashFile;
  vi.spyOn(media, "hashFile").mockImplementation(async (path, signal) => {
    if (path === projects[0]!.source && !blocked) {
      blocked = true;
      entered();
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          cancelled();
          reject(new DOMException("Cancelled hash", "AbortError"));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
        void held.then(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        });
      });
    }
    return original(path, signal);
  });
  const client = new AbortController();
  const pending = post(
    "/intelligence/waveforms",
    { projectId: projects[0]!.id, assetIds: ["source"] },
    client.signal,
  ).catch((error: unknown) => error);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await started;
    client.abort();
    expect(await pending).toMatchObject({ name: "AbortError" });
    await Promise.race([
      stopped,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () =>
            reject(new Error("Disconnected waveform hashing did not stop.")),
          10_000,
        );
      }),
    ]);
    const retried = await Promise.all([
      post("/intelligence/waveforms", {
        projectId: projects[0]!.id,
        assetIds: ["source"],
      }),
      post("/intelligence/waveforms", {
        projectId: projects[0]!.id,
        assetIds: ["source"],
      }),
    ]);
    expect(retried.map((response) => response.status)).toEqual([200, 200]);
  } finally {
    release();
    if (deadline) clearTimeout(deadline);
    await pending;
  }
});
