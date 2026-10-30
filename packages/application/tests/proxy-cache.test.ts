import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProxy, hashFile, runProcess } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";
import { ProxyCacheService } from "../src/proxy-cache.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
    relocate: async (destination: string) => {
      const directory = app.directory;
      app.close();
      await rename(directory, destination);
      app = await OpenFilmApplication.open(destination);
    },
  };
}

describe("managed proxy queue", () => {
  it("accepts a durable cancellation request from another application instance", async () => {
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
        await new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    );
    const [job] = service.enqueue(f.input);
    const run = service.runPending({ projectId: f.app.project.id });
    try {
      await ready;
      const peer = await OpenFilmApplication.open(f.app.directory);
      try {
        const [requested] = peer.proxyCache.cancel({
          projectId: peer.project.id,
          jobIds: [job!.id],
        });
        expect(requested?.status).toBe("running");
        expect(requested?.proxyCache?.cancelRequestedAt).toEqual(
          expect.any(String),
        );
      } finally {
        peer.close();
      }
      expect((await run).cancelled).toBe(1);
      expect(f.app.catalog.getJob(job!.id)?.status).toBe("cancelled");
    } finally {
      service.cancel({ projectId: f.app.project.id, jobIds: [job!.id] });
      await run;
    }
  });
  it("retains a verified managed preview after project and managed-source relocation", async () => {
    const f = await fixture();
    const owned = join(f.app.directory, "sources/synthetic.mp4");
    await mkdir(join(f.app.directory, "sources"));
    await copyFile(f.source, owned);
    expect((await f.app.importManagedSources([owned])).imported).toBe(1);
    const asset = f.app.catalog.getAssetByUri(pathToFileURL(owned).href)!;
    const receipt = f.app.proxyCache.readyReceipt(asset)!;
    await f.relocate(join(f.root, "relocated.openfilm"));
    const moved = f.app.catalog.getAsset(asset.id)!;
    expect(moved.uri).not.toBe(asset.uri);
    expect(f.app.proxyCache.readyReceipt(moved)?.artifactId).toBe(
      receipt.artifactId,
    );
    expect(await hashFile(join(f.app.directory, receipt.output.uri))).toBe(
      receipt.output.hash,
    );
  });
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

async function prepared() {
  const f = await fixture();
  f.app.proxyCache.enqueue(f.input);
  expect(
    (await f.app.proxyCache.runPending({ projectId: f.app.project.id }))
      .completed,
  ).toBe(1);
  const asset = f.app.catalog.getAsset("synthetic-video")!;
  const receipt = f.app.proxyCache.readyReceipt(asset)!;
  return { ...f, receipt, path: join(f.app.directory, receipt.output.uri) };
}

describe("managed proxy storage policy and cleanup", () => {
  it.each([false, true])(
    "recovers only stopped temporary work without an original reference (protected=%s)",
    async (referenced) => {
      const f = await fixture();
      const [job] = f.app.proxyCache.enqueue(f.input);
      const owner = {
        ...job!.proxyCache!.owner,
        host: "foreign-unknown-owner",
      };
      f.app.catalog.saveJob({
        ...job!,
        status: "running",
        proxyCache: { ...job!.proxyCache!, owner },
      });
      f.app.proxyCache.store.ensure();
      const work = join(f.app.proxyCache.store.work, `${job!.id}-ABCDEF`);
      await mkdir(work);
      const temporary = join(work, "preview.mp4");
      await writeFile(temporary, "synthetic abandoned working bytes");
      await writeFile(
        join(work, "owner.json"),
        JSON.stringify({
          version: 1,
          projectId: f.app.project.id,
          jobId: job!.id,
          generation: job!.proxyCache!.generation,
          owner,
        }),
      );
      if (referenced)
        f.app.catalog.upsertAsset({
          ...f.app.catalog.getAsset("synthetic-video")!,
          id: "explicit-original-reference",
          uri: pathToFileURL(temporary).href,
        });
      const recovery = (
        await f.app.proxyCache.health({ projectId: f.app.project.id })
      ).recovery!;
      f.app.proxyCache.recover({
        projectId: f.app.project.id,
        fingerprint: recovery.fingerprint,
        confirmedStopped: true,
      });
      if (referenced)
        expect(await readFile(temporary, "utf8")).toBe(
          "synthetic abandoned working bytes",
        );
      else
        await expect(readFile(temporary)).rejects.toMatchObject({
          code: "ENOENT",
        });
      expect(await hashFile(f.source)).toBe(f.sourceHash);
    },
  );
  it("reports actual released bytes when preference cleanup fails after file removal", async () => {
    const f = await prepared();
    f.app.catalog.updateAsset("synthetic-video", { state: { locked: false } });
    const preview = await f.app.proxyCache.previewCleanup({
      projectId: f.app.project.id,
    });
    const failure = vi
      .spyOn(f.app.proxyCache.store, "clearPreferred")
      .mockImplementation(() => {
        throw new Error("synthetic preference persistence failure");
      });
    const result = await f.app.proxyCache.acceptCleanup({
      projectId: f.app.project.id,
      previewId: preview.previewId,
      fingerprint: preview.fingerprint,
      confirmed: true,
    });
    failure.mockRestore();
    expect(result.failedArtifactIds).toEqual([f.receipt.artifactId]);
    expect(result.removedBytes).toBeGreaterThanOrEqual(
      f.receipt.output.byteLength,
    );
    await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await hashFile(f.source)).toBe(f.sourceHash);
  });
  it("imports original media with a visible pending-preview warning when quota is full", async () => {
    const f = await fixture();
    await f.app.proxyCache.setPolicy({
      projectId: f.app.project.id,
      baseRevision: 0,
      quotaBytes: 1024 ** 2,
    });
    await writeFile(
      join(f.app.proxyCache.store.managed, "unowned-fixture.bin"),
      Buffer.alloc(2 * 1024 ** 2),
    );
    const source = join(f.root, "new-source.mp4");
    await copyFile(f.source, source);
    const result = await f.app.importFiles([source]);
    expect(result).toMatchObject({ imported: 1, failed: 0 });
    expect(
      result.job.errors?.some((error) => error.code === "proxy.quotaExceeded"),
    ).toBe(true);
    const asset = f.app.catalog.getAssetByUri(pathToFileURL(source).href)!;
    expect(asset.contentHash).toBe(f.sourceHash);
    expect(asset.proxyUri).toBeUndefined();
    expect(await hashFile(source)).toBe(f.sourceHash);
  });

  it("produces a real decoded MP3 with source hash and duration evidence", async () => {
    const f = await fixture();
    const source = join(f.root, "synthetic-audio.wav");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000",
      "-t",
      "2",
      source,
    ]);
    const sourceHash = await hashFile(source);
    f.app.catalog.upsertAsset({
      id: "synthetic-audio",
      name: "合成聲音",
      uri: pathToFileURL(source).href,
      mediaType: "audio",
      contentHash: sourceHash,
      duration: 2,
      codec: "pcm_s16le",
      tags: [],
      state: {},
      metadata: {},
    });
    f.app.proxyCache.enqueue({
      projectId: f.app.project.id,
      requestId: "audio-proxy",
      assetIds: ["synthetic-audio"],
    });
    expect(
      (await f.app.proxyCache.runPending({ projectId: f.app.project.id }))
        .completed,
    ).toBe(1);
    const receipt = f.app.proxyCache.readyReceipt(
      f.app.catalog.getAsset("synthetic-audio")!,
    )!;
    expect(receipt.output.uri).toMatch(/\.mp3$/u);
    expect(Math.abs(receipt.output.duration - 2)).toBeLessThan(0.1);
    const path = join(f.app.directory, receipt.output.uri);
    const pcm = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        path,
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "s16le",
        "pipe:1",
      ])
    ).stdout;
    let peak = 0;
    for (let i = 0; i + 1 < pcm.length; i += 2)
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    expect(peak).toBeGreaterThan(2000);
    expect(pcm.length / 2 / 48000).toBeCloseTo(2, 1);
    expect(await hashFile(path)).toBe(receipt.output.hash);
    expect(await hashFile(source)).toBe(sourceHash);
  });

  it("renders identical original picture, audio and timing after preview-cache removal", async () => {
    const f = await prepared();
    f.app.project.settings = { width: 320, height: 180, frameRate: 12 };
    const story = f.app.generateStory({
      title: "Original-render proof",
      template: "blank",
      assetIds: ["synthetic-video"],
    });
    story.targetDuration = 2;
    story.maxDuration = 3;
    story.graph = undefined;
    story.beats = [
      {
        id: "baseline",
        title: "",
        candidateAssetIds: ["synthetic-video"],
        selectedAssetIds: ["synthetic-video"],
        targetDuration: 2,
        minDuration: 1,
        maxDuration: 3,
      },
    ];
    const composition = f.app.compose(story.id);
    const beforeProject = structuredClone(f.app.project);
    const beforeAsset = f.app.catalog.getAsset("synthetic-video");
    const decode = async (path: string) => {
      const video = (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          path,
          "-map",
          "0:v:0",
          "-vf",
          "scale=80:45",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "pipe:1",
        ])
      ).stdout;
      const audio = (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          path,
          "-map",
          "0:a:0",
          "-ac",
          "1",
          "-ar",
          "48000",
          "-f",
          "s16le",
          "pipe:1",
        ])
      ).stdout;
      const probe = JSON.parse(
        (
          await runProcess("ffprobe", [
            "-v",
            "error",
            "-show_format",
            "-of",
            "json",
            path,
          ])
        ).stdout.toString(),
      );
      return {
        video: createHash("sha256").update(video).digest("hex"),
        audio: createHash("sha256").update(audio).digest("hex"),
        duration: Number(probe.format.duration),
      };
    };
    const before = await decode(await f.app.render(composition.id));
    await rm(f.path);
    const after = await decode(await f.app.render(composition.id));
    expect(after).toEqual(before);
    expect(after.duration).toBeCloseTo(composition.duration, 1);
    expect(f.app.project).toEqual(beforeProject);
    expect(f.app.catalog.getAsset("synthetic-video")).toEqual(beforeAsset);
    expect(await hashFile(f.source)).toBe(f.sourceHash);
  });
  it("requires the exact unknown-owner receipt for explicit recovery", async () => {
    const f = await fixture();
    const [job] = f.app.proxyCache.enqueue(f.input);
    f.app.catalog.saveJob({
      ...job!,
      status: "running",
      proxyCache: {
        ...job!.proxyCache!,
        owner: { ...job!.proxyCache!.owner, host: "unknown-foreign-boot" },
      },
    });
    const recovery = (
      await f.app.proxyCache.health({ projectId: f.app.project.id })
    ).recovery;
    expect(recovery?.ownerState).toBe("unknown");
    expect(() =>
      f.app.proxyCache.recover({
        projectId: f.app.project.id,
        fingerprint: "0".repeat(64),
        confirmedStopped: true,
      }),
    ).toThrow();
    expect(f.app.catalog.getJob(job!.id)?.status).toBe("running");
    expect(
      f.app.proxyCache.recover({
        projectId: f.app.project.id,
        fingerprint: recovery!.fingerprint,
        confirmedStopped: true,
      }).recovered,
    ).toBe(1);
    expect(f.app.catalog.getJob(job!.id)?.status).toBe("failed");
  });

  it("fences a displaced worker before it can claim another queued task", async () => {
    const f = await fixture();
    const otherPath = join(f.root, "other.mp4");
    await copyFile(f.source, otherPath);
    f.app.catalog.upsertAsset({
      ...f.app.catalog.getAsset("synthetic-video")!,
      id: "other-video",
      uri: pathToFileURL(otherPath).href,
    });
    let started!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new ProxyCacheService(
      {
        directory: f.app.directory,
        project: f.app.project,
        catalog: f.app.catalog,
        beginProxyWork() {},
        endProxyWork() {},
      },
      async () => {
        started();
        await held;
      },
    );
    const jobs = service.enqueue({
      ...f.input,
      assetIds: ["synthetic-video", "other-video"],
    });
    const run = service.runPending({ projectId: f.app.project.id });
    try {
      await ready;
      const first = jobs.find(
        (job) => f.app.catalog.getJob(job.id)?.status === "running",
      )!;
      const other = jobs.find((job) => job.id !== first.id)!;
      const before = f.app.catalog.getJob(other.id);
      const current = f.app.catalog.getJob(first.id)!;
      const lock = join(service.store.operational, "worker.lock");
      const owner = JSON.parse(await readFile(lock, "utf8"));
      await writeFile(
        lock,
        JSON.stringify({
          ...owner,
          owner: {
            ...owner.owner,
            token: randomUUID(),
            host: "unknown-new-owner",
          },
        }),
      );
      f.app.catalog.saveJob({
        ...current,
        status: "queued",
        proxyCache: {
          ...current.proxyCache!,
          generation: current.proxyCache!.generation + 1,
        },
      });
      release();
      await expect(run).rejects.toMatchObject({ code: "proxy.stale" });
      expect(f.app.catalog.getJob(other.id)).toEqual(before);
    } finally {
      release();
      await run.catch(() => undefined);
    }
  });
  it("persists a revision-bound quota and rejects a stale policy update", async () => {
    const f = await fixture();
    const policy = await f.app.proxyCache.setPolicy({
      projectId: f.app.project.id,
      baseRevision: 0,
      quotaBytes: 1024 ** 2,
    });
    expect(policy).toEqual({ version: 1, revision: 1, quotaBytes: 1024 ** 2 });
    await expect(
      f.app.proxyCache.setPolicy({
        projectId: f.app.project.id,
        baseRevision: 0,
        quotaBytes: 2 * 1024 ** 2,
      }),
    ).rejects.toMatchObject({ code: "proxy.stale" });
    await f.reopen();
    expect(
      (await f.app.proxyCache.health({ projectId: f.app.project.id })).policy,
    ).toEqual(policy);
  });

  it("protects locked, currently referenced, in-use and offline previews", async () => {
    const f = await prepared();
    const input = { projectId: f.app.project.id };
    expect((await f.app.proxyCache.previewCleanup(input)).entries).toEqual([]);
    f.app.catalog.updateAsset("synthetic-video", { state: { locked: false } });
    const release = f.app.proxyCache.store.reader(f.receipt.artifactId);
    try {
      expect((await f.app.proxyCache.previewCleanup(input)).entries).toEqual(
        [],
      );
    } finally {
      release();
    }
    const story = f.app.generateStory({
      title: "Protected synthetic source",
      template: "blank",
      assetIds: ["synthetic-video"],
    });
    f.app.compose(story.id);
    expect((await f.app.proxyCache.previewCleanup(input)).entries).toEqual([]);
    f.app.project.timelines = [];
    await f.app.save();
    await rm(f.source);
    expect((await f.app.proxyCache.previewCleanup(input)).entries).toEqual([]);
    expect(await hashFile(f.path)).toBe(f.receipt.output.hash);
  });

  it("protects a Composition saved by another workspace after cleanup preview", async () => {
    const f = await prepared();
    f.app.catalog.updateAsset("synthetic-video", { state: { locked: false } });
    const preview = await f.app.proxyCache.previewCleanup({
      projectId: f.app.project.id,
    });
    expect(preview.entries).toHaveLength(1);
    const writer = await OpenFilmApplication.open(f.app.directory);
    try {
      const story = writer.generateStory({
        title: "Other workspace protects source",
        template: "blank",
        assetIds: ["synthetic-video"],
      });
      writer.compose(story.id);
      await writer.save();
    } finally {
      writer.close();
    }
    await expect(
      f.app.proxyCache.acceptCleanup({
        projectId: f.app.project.id,
        previewId: preview.previewId,
        fingerprint: preview.fingerprint,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "proxy.stale" });
    expect(await hashFile(f.path)).toBe(f.receipt.output.hash);
  });

  it("previews and explicitly accepts only provenance-owned rebuildable files", async () => {
    const f = await prepared();
    f.app.catalog.updateAsset("synthetic-video", { state: { locked: false } });
    const before = f.app.catalog.getAsset("synthetic-video");
    const preview = await f.app.proxyCache.previewCleanup({
      projectId: f.app.project.id,
    });
    expect(preview.entries.map((entry) => entry.artifactId)).toEqual([
      f.receipt.artifactId,
    ]);
    expect(await hashFile(f.path)).toBe(f.receipt.output.hash);
    const result = await f.app.proxyCache.acceptCleanup({
      projectId: f.app.project.id,
      previewId: preview.previewId,
      fingerprint: preview.fingerprint,
      confirmed: true,
    });
    expect(result.removedArtifactIds).toEqual([f.receipt.artifactId]);
    expect(result.removedBytes).toBeGreaterThanOrEqual(
      f.receipt.output.byteLength,
    );
    await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.app.catalog.getAsset("synthetic-video")).toEqual(before);
    expect(await hashFile(f.source)).toBe(f.sourceHash);
  });

  it("revalidates a saved cleanup review after reopening without accepting a changed selection", async () => {
    const f = await prepared();
    f.app.catalog.updateAsset("synthetic-video", { state: { locked: false } });
    const preview = await f.app.proxyCache.previewCleanup({
      projectId: f.app.project.id,
    });
    const reader = await OpenFilmApplication.openForExport(f.app.directory);
    try {
      await expect(
        reader.proxyCache.acceptSavedCleanup({
          projectId: reader.project.id,
          preview: { ...preview, bytes: preview.bytes + 1 },
          confirmed: true,
        }),
      ).rejects.toMatchObject({ code: "proxy.stale" });
      expect(await hashFile(f.path)).toBe(f.receipt.output.hash);
      const result = await reader.proxyCache.acceptSavedCleanup({
        projectId: reader.project.id,
        preview,
        confirmed: true,
      });
      expect(result.removedArtifactIds).toEqual([f.receipt.artifactId]);
      await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      reader.close();
    }
  });

  it.each(["locks", "bytes", "policy"])(
    "rejects an obsolete cleanup preview after %s changes",
    async (change) => {
      const f = await prepared();
      f.app.catalog.updateAsset("synthetic-video", {
        state: { locked: false },
      });
      const preview = await f.app.proxyCache.previewCleanup({
        projectId: f.app.project.id,
      });
      expect(preview.entries).toHaveLength(1);
      if (change === "locks")
        f.app.catalog.updateAsset("synthetic-video", {
          state: { locked: true },
        });
      if (change === "bytes") {
        const bytes = await readFile(f.path);
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
        await writeFile(f.path, bytes);
      }
      if (change === "policy")
        await f.app.proxyCache.setPolicy({
          projectId: f.app.project.id,
          baseRevision: 0,
          quotaBytes: 1024 ** 2,
        });
      await expect(
        f.app.proxyCache.acceptCleanup({
          projectId: f.app.project.id,
          previewId: preview.previewId,
          fingerprint: preview.fingerprint,
          confirmed: true,
        }),
      ).rejects.toMatchObject({ code: "proxy.stale" });
      expect((await readFile(f.path)).length).toBe(f.receipt.output.byteLength);
      expect(await hashFile(f.source)).toBe(f.sourceHash);
    },
  );

  it("detects same-size corruption through explicit verification", async () => {
    const f = await prepared();
    await writeFile(f.path, Buffer.alloc(f.receipt.output.byteLength));
    const result = await f.app.proxyCache.verify({
      projectId: f.app.project.id,
      assetIds: ["synthetic-video"],
    });
    expect(result.results[0]).toMatchObject({
      assetId: "synthetic-video",
      status: "stale",
    });
    expect(
      f.app.proxyCache.readyReceipt(f.app.catalog.getAsset("synthetic-video")!),
    ).toBeUndefined();
    expect(
      (await f.app.proxyCache.health({ projectId: f.app.project.id }))
        .entries[0]?.status,
    ).toBe("stale");
    expect(await hashFile(f.source)).toBe(f.sourceHash);
  });

  it("refuses unknown receipt versions and symlink inventories without deleting anything", async () => {
    const f = await prepared();
    f.app.catalog.updateAsset("synthetic-video", { state: { locked: false } });
    const receiptPath = join(
      f.app.directory,
      "cache/proxies/managed",
      `${f.receipt.artifactId}.json`,
    );
    await writeFile(receiptPath, JSON.stringify({ ...f.receipt, version: 99 }));
    await expect(
      f.app.proxyCache.previewCleanup({ projectId: f.app.project.id }),
    ).rejects.toThrow();
    await writeFile(receiptPath, JSON.stringify(f.receipt));
    await symlink(
      f.source,
      join(f.app.directory, "cache/proxies/managed/unsafe.mp4"),
    );
    await expect(
      f.app.proxyCache.previewCleanup({ projectId: f.app.project.id }),
    ).rejects.toMatchObject({ code: "proxy.storageUnavailable" });
    expect(await hashFile(f.path)).toBe(f.receipt.output.hash);
    expect(await hashFile(f.source)).toBe(f.sourceHash);
  });

  it("evicts only an eligible owned artifact when a reduced quota needs space", async () => {
    const f = await fixture();
    f.app.catalog.updateAsset("synthetic-video", { state: { locked: false } });
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
        await appendFile(output, Buffer.alloc(2 * 1024 ** 2));
      },
    );
    service.enqueue(f.input);
    expect(
      (await service.runPending({ projectId: f.app.project.id })).completed,
    ).toBe(1);
    const old = service.readyReceipt(
      f.app.catalog.getAsset("synthetic-video")!,
    )!;
    await f.app.proxyCache.setPolicy({
      projectId: f.app.project.id,
      baseRevision: 0,
      quotaBytes: 1024 ** 2,
    });
    const otherPath = join(f.root, "second-synthetic.mp4");
    await copyFile(f.source, otherPath);
    f.app.catalog.upsertAsset({
      ...f.app.catalog.getAsset("synthetic-video")!,
      id: "second-video",
      uri: pathToFileURL(otherPath).href,
    });
    f.app.proxyCache.enqueue({
      ...f.input,
      requestId: "after-quota-reduction",
      assetIds: ["second-video"],
    });
    expect(
      (await f.app.proxyCache.runPending({ projectId: f.app.project.id }))
        .completed,
    ).toBe(1);
    await expect(
      readFile(join(f.app.directory, old.output.uri)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await f.app.proxyCache.health({ projectId: f.app.project.id }))
        .managedBytes,
    ).toBeLessThanOrEqual(1024 ** 2);
    expect(await hashFile(f.source)).toBe(f.sourceHash);
  });
});
