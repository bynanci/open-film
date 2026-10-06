import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type { Job, MediaAsset } from "@openfilm/core";
import { startServer } from "../../apps/server/src/server.js";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";

const cleanup: Array<() => Promise<unknown>> = [];
let media: string;
beforeAll(async () => {
  media = await mkdtemp(join(tmpdir(), "openfilm-upload-originals-"));
  await generateSampleMedia(media);
});
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
afterAll(async () => {
  await rm(media, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-upload-cleanup-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const server = await startServer({ port: 0, projectRoot: root });
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${server.port}/api`;
  const post = (path: string, data: unknown = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const created = await post("/project/create", { title: "Upload cleanup" });
  expect(created.status).toBe(200);
  const { path: project } = (await created.json()) as { path: string };
  const upload = async (name: string, bytes: Buffer) => {
    const response = await fetch(
      `${base}/import/upload?${new URLSearchParams({ name })}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(bytes),
      },
    );
    expect(response.status).toBe(201);
    const { uploadId } = (await response.json()) as { uploadId: string };
    return {
      id: uploadId,
      path: join(project, "sources", uploadId, name),
      bytes,
    };
  };
  const assets = async () =>
    ((await (await fetch(`${base}/assets`)).json()) as { assets: MediaAsset[] })
      .assets;
  const job = async (id: string) =>
    ((await (await fetch(`${base}/jobs`)).json()) as { jobs: Job[] }).jobs.find(
      (job) => job.id === id,
    );
  const settled = async (id: string) => {
    await expect
      .poll(async () => (await job(id))?.status, { timeout: 20_000 })
      .toMatch(/^(completed|failed|cancelled)$/);
    return (await job(id))!;
  };
  return { project, upload, assets, post, settled };
}

it("removes consumed uploads that fail decoding and retains indexed copies and external originals", async () => {
  const test = await fixture();
  const original = join(media, "01-photo.png");
  const bytes = await readFile(original);
  const native = await test.post("/import", { files: [original] });
  expect(native.status).toBe(202);
  await test.settled((await native.json()).jobId);
  const valid = await test.upload("写真 # &.png", bytes);
  const invalid = await test.upload("broken.mp4", Buffer.from("not media"));
  const queued = await test.post("/import", {
    uploads: [invalid.id, valid.id],
  });
  expect(queued.status).toBe(202);
  const result = await test.settled((await queued.json()).jobId);
  expect(result.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ uri: expect.stringContaining("broken.mp4") }),
    ]),
  );
  await expect
    .poll(() => readdir(join(test.project, "sources")))
    .toEqual([valid.id]);
  const indexed = await test.assets();
  expect(indexed).toHaveLength(2);
  expect(indexed.map((asset) => fileURLToPath(asset.uri))).toEqual(
    expect.arrayContaining([original, valid.path]),
  );
  expect(await readFile(valid.path)).toEqual(bytes);
  expect(await readFile(original)).toEqual(bytes);
  expect((await test.post("/import", { uploads: [invalid.id] })).status).toBe(
    400,
  );
});

it("cleans unindexed uploads after cancellation while keeping files already indexed by that job", async () => {
  const test = await fixture();
  const original = join(media, "04-motion.mp4");
  const video = await readFile(original);
  const uploaded = [
    await test.upload("first.png", await readFile(join(media, "01-photo.png"))),
  ];
  // More than one worker batch keeps the real import cancellable after its
  // first asset has been committed, without replacing the decoding pipeline.
  for (let index = 0; index < 12; index++)
    uploaded.push(await test.upload(`movie-${index}.mp4`, video));
  const queued = await test.post("/import", {
    uploads: uploaded.map((upload) => upload.id),
  });
  expect(queued.status).toBe(202);
  const { jobId } = await queued.json();
  await expect
    .poll(async () => (await test.assets()).length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  expect((await test.post(`/jobs/${jobId}/cancel`)).status).toBe(200);
  expect((await test.settled(jobId)).status).toBe("cancelled");
  const indexed = await test.assets();
  expect(indexed.length).toBeGreaterThan(0);
  expect(indexed.length).toBeLessThan(uploaded.length);
  const indexedPaths = new Set(
    indexed.map((asset) => fileURLToPath(asset.uri)),
  );
  const retained = uploaded.filter((upload) => indexedPaths.has(upload.path));
  await expect
    .poll(async () => (await readdir(join(test.project, "sources"))).sort())
    .toEqual(retained.map((upload) => upload.id).sort());
  for (const upload of retained)
    expect(await readFile(upload.path)).toEqual(upload.bytes);
  expect(await readFile(original)).toEqual(video);
});
