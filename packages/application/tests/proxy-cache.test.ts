import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProxy, hashFile, runProcess } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";
import { ProxyCacheService } from "../src/proxy-cache.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-proxy-cache-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "synthetic.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=320x180:r=12",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    source,
  ]);
  let app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Synthetic proxy storage",
  );
  cleanup.push(() => app.close());
  const sourceHash = await hashFile(source);
  app.catalog.upsertAsset({
    id: "synthetic-video",
    name: "合成影片",
    uri: pathToFileURL(source).href,
    mediaType: "video",
    contentHash: sourceHash,
    duration: 2,
    dimensions: { width: 320, height: 180 },
    frameRate: 12,
    codec: "h264",
    tags: ["preserve"],
    state: { locked: true },
    metadata: {},
  });
  const projectId = app.project.id;
  const input = {
    projectId,
    requestId: "prepare-synthetic",
    assetIds: ["synthetic-video"],
  };
  return {
    root,
    source,
    sourceHash,
    input,
    get app() {
      return app;
    },
    reopen: async () => {
      const directory = app.directory;
      app.close();
      app = await OpenFilmApplication.open(directory);
    },
  };
}

describe("managed proxy queue", () => {
  it("enqueues idempotently, rejects changed requests and keeps creative state intact", async () => {
    const f = await fixture();
    const before = structuredClone(f.app.project);
    const asset = f.app.catalog.getAsset("synthetic-video");
    const jobs = f.app.proxyCache.enqueue(f.input);
    expect(jobs).toHaveLength(1);
    expect(f.app.proxyCache.enqueue(f.input)).toEqual(jobs);
    expect(() =>
      f.app.proxyCache.enqueue({ ...f.input, assetIds: [] }),
    ).toThrow();
    f.app.catalog.upsertAsset({
      ...asset!,
      id: "another-video",
      uri: pathToFileURL(join(f.root, "another.mp4")).href,
    });
    expect(() =>
      f.app.proxyCache.enqueue({ ...f.input, assetIds: ["another-video"] }),
    ).toThrow();
    expect(() =>
      f.app.proxyCache.enqueue({ ...f.input, projectId: "foreign" }),
    ).toThrow();
    expect(f.app.catalog.getAsset("synthetic-video")).toEqual(asset);
    expect(f.app.project).toEqual(before);
    const health = await f.app.proxyCache.health({
      projectId: f.app.project.id,
    });
    expect(health.queued).toBe(1);
    expect(
      health.entries.find((entry) => entry.assetId === "synthetic-video"),
    ).toMatchObject({ status: "queued", protected: true });
  });

  it("reopens a queued task without starting work and explicitly builds a real verified MP4", async () => {
    const f = await fixture();
    const originalAsset = f.app.catalog.getAsset("synthetic-video");
    f.app.proxyCache.enqueue(f.input);
    await f.reopen();
    expect(f.app.catalog.getAsset("synthetic-video")?.proxyUri).toBeUndefined();
    const result = await f.app.proxyCache.runPending({
      projectId: f.app.project.id,
    });
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    const asset = f.app.catalog.getAsset("synthetic-video")!;
    expect(asset).toEqual(originalAsset);
    const receipt = f.app.proxyCache.readyReceipt(asset)!;
    expect(receipt.output.uri).toMatch(
      /^cache\/proxies\/managed\/[a-f0-9]{64}\.mp4$/u,
    );
    expect(asset.state.locked).toBe(true);
    expect(asset.tags).toEqual(["preserve"]);
    expect(await hashFile(f.source)).toBe(f.sourceHash);
    const path = join(f.app.directory, receipt.output.uri);
    const probe = JSON.parse(
      (
        await runProcess("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          path,
        ])
      ).stdout.toString(),
    );
    expect(Math.abs(Number(probe.format.duration) - 2)).toBeLessThan(0.1);
    expect(
      probe.streams.some(
        (s: { codec_type: string }) => s.codec_type === "audio",
      ),
    ).toBe(true);
    const frame = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-ss",
        "0.5",
        "-i",
        path,
        "-vf",
        "scale=1:1",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ])
    ).stdout;
    expect(frame[0]).toBeGreaterThan(220);
    expect(frame[1]).toBeLessThan(30);
    expect(frame[2]).toBeLessThan(30);
    const job = f.app.catalog.listJobs().find((job) => job.type === "proxy")!;
    expect(job.status).toBe("completed");
    expect(job.proxyCache?.output?.hash).toBe(await hashFile(path));
    const receipts = (
      await readdir(join(f.app.directory, "cache/proxies/managed"))
    ).filter((name) => name.endsWith(".json"));
    expect(receipts).toHaveLength(1);
    const persistedReceipt = JSON.parse(
      await readFile(
        join(f.app.directory, "cache/proxies/managed", receipts[0]!),
        "utf8",
      ),
    );
    expect(persistedReceipt.sourceHash).toBe(f.sourceHash);
    expect(persistedReceipt.output.hash).toBe(await hashFile(path));
  });

  it("cancels queued work durably and requires an explicit new request to resume", async () => {
    const f = await fixture();
    const [job] = f.app.proxyCache.enqueue(f.input);
    f.app.proxyCache.cancel({ projectId: f.app.project.id, jobIds: [job!.id] });
    await f.reopen();
    expect(
      (await f.app.proxyCache.runPending({ projectId: f.app.project.id }))
        .completed,
    ).toBe(0);
    const resumed = f.app.proxyCache.resume({
      projectId: f.app.project.id,
      requestId: "resume-synthetic",
      jobIds: [job!.id],
    });
    expect(resumed[0]!.id).not.toBe(job!.id);
    expect(resumed[0]!.proxyCache?.retryOf).toBe(job!.id);
    expect(
      (await f.app.proxyCache.runPending({ projectId: f.app.project.id }))
        .completed,
    ).toBe(1);
  });

  it("rejects changed source bytes without attaching a stale preview", async () => {
    const f = await fixture();
    f.app.proxyCache.enqueue(f.input);
    await writeFile(f.source, "different synthetic source bytes");
    const result = await f.app.proxyCache.runPending({
      projectId: f.app.project.id,
    });
    expect(result.failed).toBe(1);
    expect(f.app.catalog.getAsset("synthetic-video")?.proxyUri).toBeUndefined();
    expect(
      f.app.catalog.listJobs().find((job) => job.type === "proxy")?.errors?.[0]
        ?.code,
    ).toBe("source.changed");
  });

  it("bounds active work at 128 instead of silently dropping the tail", async () => {
    const f = await fixture();
    const asset = f.app.catalog.getAsset("synthetic-video")!;
    const ids = Array.from({ length: 129 }, (_, index) => `asset-${index}`);
    for (const id of ids)
      f.app.catalog.upsertAsset({
        ...asset,
        id,
        uri: pathToFileURL(join(f.root, `${id}.mp4`)).href,
      });
    expect(() =>
      f.app.proxyCache.enqueue({ ...f.input, assetIds: ids }),
    ).toThrow();
    expect(
      f.app.proxyCache.enqueue({ ...f.input, assetIds: ids.slice(0, 128) }),
    ).toHaveLength(128);
    expect(() =>
      f.app.proxyCache.enqueue({
        ...f.input,
        requestId: "over-bound",
        assetIds: [ids[128]!],
      }),
    ).toThrow();
    expect(
      f.app.catalog.listJobs().filter((job) => job.type === "proxy"),
    ).toHaveLength(128);
  });

  it("keeps future import preparation managed and reuses its completed preview on repeat", async () => {
    const f = await fixture();
    const imported = await f.app.importFiles([f.source]);
    expect(imported.imported).toBe(1);
    expect(imported.failed).toBe(0);
    expect(f.app.catalog.getAsset("synthetic-video")?.proxyUri).toMatch(
      /^cache\/proxies\/managed\//u,
    );
    expect((await f.app.importFiles([f.source])).skipped).toBe(1);
    expect(f.app.catalog.listJobs({ type: "proxy", limit: 10 })).toHaveLength(
      1,
    );
    expect(await hashFile(f.source)).toBe(f.sourceHash);
  });

  it("preserves a live worker through a second workspace reader and cancels promptly", async () => {
    const f = await fixture();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const service = new ProxyCacheService(
      {
        directory: f.app.directory,
        project: f.app.project,
        catalog: f.app.catalog,
        beginProxyWork() {},
        endProxyWork() {},
      },
      async (_asset, _output, signal) => {
        started();
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else
            signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
    const [job] = service.enqueue(f.input);
    const run = service.runPending({ projectId: f.app.project.id });
    try {
      await ready;
      const reader = await OpenFilmApplication.open(f.app.directory);
      try {
        expect(reader.catalog.getJob(job!.id)?.status).toBe("running");
      } finally {
        reader.close();
      }
      service.cancel({ projectId: f.app.project.id, jobIds: [job!.id] });
      expect((await run).cancelled).toBe(1);
      expect(
        f.app.catalog.getAsset("synthetic-video")?.proxyUri,
      ).toBeUndefined();
    } finally {
      service.cancel({ projectId: f.app.project.id, jobIds: [job!.id] });
      await run;
    }
  });

  it("rejects a source edited after encoding even though the private snapshot was valid", async () => {
    const f = await fixture();
    const service = new ProxyCacheService(
      {
        directory: f.app.directory,
        project: f.app.project,
        catalog: f.app.catalog,
        beginProxyWork() {},
        endProxyWork() {},
      },
      async (asset, output, signal, options) => {
        await createProxy(asset, output, signal, options);
        await writeFile(f.source, "changed after the snapshot was encoded");
      },
    );
    const [job] = service.enqueue(f.input);
    expect(
      (await service.runPending({ projectId: f.app.project.id })).failed,
    ).toBe(1);
    expect(f.app.catalog.getAsset("synthetic-video")?.proxyUri).toBeUndefined();
    expect(f.app.catalog.getJob(job!.id)?.errors?.[0]?.code).toBe(
      "source.changed",
    );
  });

  it("retains independent artifact provenance when Named Version restore rewinds jobs", async () => {
    const f = await fixture();
    await f.app.save();
    const version = await f.app.versions.create({
      name: "Before proxy",
      baseRevision: f.app.versions.currentRevision(),
      requestId: randomUUID(),
    });
    f.app.proxyCache.enqueue(f.input);
    expect(
      (await f.app.proxyCache.runPending({ projectId: f.app.project.id }))
        .completed,
    ).toBe(1);
    const uri = f.app.proxyCache.readyReceipt(
      f.app.catalog.getAsset("synthetic-video")!,
    )!.output.uri;
    const id = f.app.proxyCache.store.artifactId(uri)!;
    const receipt = f.app.proxyCache.store.receipt(id)!.receipt;
    await f.app.versions.restore(version.id, {
      baseRevision: f.app.versions.currentRevision(),
      requestId: randomUUID(),
      confirmed: true,
    });
    expect(f.app.catalog.listJobs({ type: "proxy", limit: 10 })).toEqual([]);
    expect(f.app.proxyCache.store.receipt(id)?.receipt).toEqual(receipt);
    expect(await hashFile(join(f.app.directory, uri))).toBe(
      receipt.output.hash,
    );
    expect(
      (await f.app.proxyCache.health({ projectId: f.app.project.id }))
        .managedBytes,
    ).toBeGreaterThan(0);
  });
});
