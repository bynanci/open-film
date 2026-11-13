// Modified by OpenFilm contributors on 2026-11-13. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication } from "../src/index.js";
const clean: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "version-pair-"));
  clean.push(() => rm(root, { recursive: true, force: true }));
  const app = await OpenFilmApplication.create(
    join(root, "film"),
    "Comparison",
  );
  clean.push(async () => {
    app.close();
    await app.versionComparisonPreview.drain();
  });
  const input: import("../src/index.js").VersionComparisonPreviewInput = {
    projectId: app.project.id,
    requestId: randomUUID(),
    a: { versionId: randomUUID() },
    b: { versionId: randomUUID() },
  };
  return { app, input, root };
}
it("rejects malformed input without reserving an operational job", async () => {
  const { app, input } = await fixture();
  await expect(
    app.runVersionComparisonPreview({ ...input, requestId: "bad" }),
  ).rejects.toThrow();
  expect(app.catalog.listJobs()).toHaveLength(0);
});
it("never overwrites an unrelated request id", async () => {
  const { app, input } = await fixture();
  const job = {
    id: input.requestId,
    type: "render" as const,
    status: "completed" as const,
    progress: 1,
    createdAt: new Date().toISOString(),
  };
  app.catalog.saveJob(job);
  await expect(app.runVersionComparisonPreview(input)).rejects.toThrow(
    /request|already|conflict/i,
  );
  expect(app.catalog.getJob(input.requestId)).toEqual(job);
});
it("preserves live and unverifiable comparison jobs when another app opens", async () => {
  const { app, input } = await fixture();
  app.catalog.saveJob({
    id: input.requestId,
    type: "render",
    stage: "version-comparison-preview",
    status: "running",
    progress: 0,
    createdAt: new Date().toISOString(),
    reviewOwner: { host: "foreign-host", pid: 123, token: randomUUID() },
  });
  const other = await OpenFilmApplication.open(app.directory);
  try {
    expect(other.catalog.getJob(input.requestId)?.status).toBe("running");
  } finally {
    other.close();
  }
});

it("reuses captured source proofs across repeated MP4 media ranges", async () => {
  const { app, input } = await savedFixture();
  const snapshot = vi.spyOn(app.versions, "snapshotForPreview"),
    load = vi.spyOn(
      app.versions as unknown as { load: (id: string) => unknown },
      "load",
    );
  const pair = await app.runVersionComparisonPreview(input);
  const publicationChecks = snapshot.mock.calls.length;
  const payloadLoads = load.mock.calls.length;
  expect(publicationChecks).toBeGreaterThanOrEqual(4);
  await app.versionComparisonPreview.get(app.project.id, pair.id);
  await app.versionComparisonPreview.withMedia(
    app.project.id,
    pair.id,
    "a",
    async (file) => expect((await file.stat()).isFile()).toBe(true),
  );
  await app.versionComparisonPreview.withMedia(
    app.project.id,
    pair.id,
    "a",
    async (file) => expect((await file.stat()).isFile()).toBe(true),
  );
  expect(snapshot).toHaveBeenCalledTimes(publicationChecks);
  expect(load).toHaveBeenCalledTimes(payloadLoads);
  await app.versionComparisonPreview.discard(app.project.id, pair.id);
});

import { readFile, writeFile, readdir, lstat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { hashFile, runProcess } from "@openfilm/media";
import { FFmpegRenderer, renderSourceAssetIds } from "@openfilm/render";
import { TimelineEditor, createReviewOwner } from "../src/index.js";
import {
  toneSource,
  decodePolicyAudio,
  spectralAmplitude,
} from "../../../tests/fixtures/audio-policy.js";
import { vi } from "vitest";
afterEach(() => vi.restoreAllMocks());
async function savedFixture() {
  const f = await fixture();
  const { app, root, input } = f;
  const toneA = await toneSource(root, "tone-a", 440, 1),
    toneB = await toneSource(root, "tone-b", 880, 1);
  for (const asset of [toneA, toneB]) app.catalog.upsertAsset(asset);
  for (const [id, color] of [
    ["red", "red"],
    ["blue", "blue"],
  ]) {
    const path = join(root, `${id}.png`);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=${color}:s=160x90`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      path,
    ]);
    app.catalog.upsertAsset({
      id: id!,
      name: id!,
      uri: pathToFileURL(path).href,
      mediaType: "image",
      tags: [],
      state: { locked: true },
      metadata: {},
      contentHash: await hashFile(path),
    });
  }
  app.project.stories = [{ id: "story", title: "Saved", beats: [] }];
  app.project.settings = { width: 160, height: 90, frameRate: 10 };
  app.project.timelines = [
    {
      id: "cut",
      storyId: "story",
      duration: 1,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "picture",
              assetId: "red",
              timelineStart: 0,
              timelineDuration: 1,
            },
          ],
        },
        {
          id: "sound",
          type: "audio",
          clips: [
            {
              id: "sound",
              assetId: toneA.id,
              timelineStart: 0,
              timelineDuration: 1,
              sourceIn: 0,
              sourceOut: 1,
            },
          ],
        },
      ],
      captionTracks: [
        {
          version: 1,
          id: "cc",
          name: "Caption",
          language: "en",
          style: {
            version: 1,
            role: "subtitle",
            fontSize: 16,
            background: "none",
          },
          cues: [
            {
              version: 1,
              id: "cue",
              startMs: 0,
              endMs: 900,
              text: "Saved A",
              source: { kind: "manual" },
              manualRevision: 0,
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  const a = await app.versions.create({
    name: "Red saved",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  app.project.settings = { width: 192, height: 108, frameRate: 12 };
  app.project.timelines[0]!.tracks[0]!.clips[0]!.assetId = "blue";
  app.project.timelines[0]!.tracks[1]!.clips[0]!.assetId = toneB.id;
  app.project.timelines[0]!.captionTracks![0]!.cues[0]!.text = "Saved B";
  await app.save();
  const b = await app.versions.create({
    name: "Blue saved",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  input.a.versionId = a.id;
  input.b.versionId = b.id;
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.project.timelines[0]!.captionTracks![0]!.cues[0]!.text = "Current";
  await app.save();
  return { ...f, a, b };
}
async function copyMedia(
  app: OpenFilmApplication,
  id: string,
  side: "a" | "b",
  path: string,
) {
  await app.versionComparisonPreview.withMedia(
    app.project.id,
    id,
    side,
    async (file, facts) => {
      const data = Buffer.alloc(facts.size);
      await file.read(data, 0, data.length, 0);
      await writeFile(path, data);
    },
  );
}
it("renders complete saved pictures, captions, settings and tones with no active cut/history/source writes", async () => {
  const { app, input, root, a, b } = await savedFixture();
  const revision = semantic(app),
    editor = new TimelineEditor(app);
  await editor.edit("cut", {
    baseRevision: editor.get("cut").revision,
    commands: [
      {
        type: "caption.cue.update",
        trackId: "cc",
        cueId: "cue",
        patch: { text: "Current edited" },
      },
    ],
  });
  const state = editor.get("cut");
  expect(state.canUndo).toBe(true);
  const manifestBefore = await readFile(join(app.directory, "project.json"));
  const payloads = await Promise.all(
    [a, b].flatMap((v) =>
      ["project.json", "database.sqlite", "record.json"].map((name) =>
        hashFile(join(app.directory, "versions", v.id, name)),
      ),
    ),
  );
  const sourceNames = ["red.png", "blue.png", "tone-a.wav", "tone-b.wav"],
    sources = await Promise.all(
      sourceNames.map((n) => hashFile(join(root, n))),
    );
  const result = await app.runVersionComparisonPreview(input);
  expect(result.a.frameRate).toBe(10);
  expect(result.b.frameRate).toBe(12);
  expect(result.a.hasAudio && result.b.hasAudio).toBe(true);
  expect(result.a.duration).toBe(1);
  expect(result.b.duration).toBe(1);
  expect(result.a.sha256).not.toBe(result.b.sha256);
  for (const [side, width, height, freq, other] of [
    ["a", 160, 90, 440, 880],
    ["b", 192, 108, 880, 440],
  ] as const) {
    const path = join(root, `${side}-delivered.mp4`);
    await copyMedia(app, result.id, side, path);
    const rgb = await runProcess(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        path,
        "-vf",
        "select='eq(n,0)+eq(n,5)+eq(n,9)'",
        "-vsync",
        "0",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
      { maxOutputBytes: 1024 * 1024 },
    );
    expect(rgb.stdout.length).toBe(width * height * 3 * 3);
    for (let frame = 0; frame < 3; frame++) {
      const pixel = frame * width * height * 3 + 3 * (width * 5 + 5);
      expect(rgb.stdout[pixel + (side === "a" ? 0 : 2)]).toBeGreaterThan(200);
      expect(rgb.stdout[pixel + (side === "a" ? 2 : 0)]).toBeLessThan(30);
    }
    const pcm = await decodePolicyAudio(path);
    const probe = JSON.parse(
      (
        await runProcess("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-of",
          "json",
          path,
        ])
      ).stdout.toString(),
    ) as {
      streams: Array<{
        codec_type: string;
        duration: string;
        nb_frames: string;
      }>;
    };
    console.info(
      "VERSION_COMPARISON_AV_EVIDENCE",
      JSON.stringify({
        side,
        width,
        height,
        frames: probe.streams.find((s) => s.codec_type === "video")?.nb_frames,
        videoDuration: probe.streams.find((s) => s.codec_type === "video")
          ?.duration,
        audioDuration: probe.streams.find((s) => s.codec_type === "audio")
          ?.duration,
        pcmFrames: pcm.samples.length / 2,
        selectedToneAmplitude: spectralAmplitude(pcm.samples, freq, 0.2),
        otherToneAmplitude: spectralAmplitude(pcm.samples, other, 0.2),
        sha256: result[side].sha256,
      }),
    );
    expect(spectralAmplitude(pcm.samples, freq, 0.2)).toBeGreaterThan(
      spectralAmplitude(pcm.samples, other, 0.2) * 20,
    );
  }
  expect(await app.runVersionComparisonPreview(input)).toEqual(result);
  expect(
    app.catalog
      .listJobs()
      .filter((j) => j.stage === "version-comparison-preview"),
  ).toHaveLength(1);
  expect(app.catalog.getJob(input.requestId)?.status).toBe("completed");
  expect(await readFile(join(app.directory, "project.json"))).toEqual(
    manifestBefore,
  );
  expect(semantic(app)).toBe(revision);
  expect(editor.get("cut")).toEqual(state);
  expect(
    await Promise.all(sourceNames.map((n) => hashFile(join(root, n)))),
  ).toEqual(sources);
  expect(
    await Promise.all(
      [a, b].flatMap((v) =>
        ["project.json", "database.sqlite", "record.json"].map((name) =>
          hashFile(join(app.directory, "versions", v.id, name)),
        ),
      ),
    ),
  ).toEqual(payloads);
  await app.versionComparisonPreview.discard(app.project.id, result.id);
  await expect(app.runVersionComparisonPreview(input)).rejects.toThrow(
    /request ID/i,
  );
});
it("publishes no partial pair when the second actual render fails", async () => {
  const { app, input } = await savedFixture();
  const render = FFmpegRenderer.prototype.render;
  let count = 0;
  vi.spyOn(FFmpegRenderer.prototype, "render").mockImplementation(function (
    this: FFmpegRenderer,
    ...args
  ) {
    if (++count === 2) throw new Error("private/source/path");
    return render.apply(this, args);
  });
  await expect(app.runVersionComparisonPreview(input)).rejects.toThrow(
    /unavailable/,
  );
  expect(app.catalog.getJob(input.requestId)?.status).toBe("failed");
  expect(
    await readdir(join(app.directory, "cache", "version-comparison")),
  ).toEqual([]);
});
it("drains an opened media lease before deletion and revokes its signal synchronously", async () => {
  const { app, input } = await savedFixture(),
    pair = await app.runVersionComparisonPreview(input);
  let entered!: () => void,
    finish!: () => void,
    leaseSignal: AbortSignal | undefined;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (finish = r));
  const read = app.versionComparisonPreview.withMedia(
    app.project.id,
    pair.id,
    "a",
    async (file, _facts, signal) => {
      leaseSignal = signal;
      entered();
      await gate;
      expect((await file.stat()).isFile()).toBe(true);
    },
  );
  await started;
  let discarded = false;
  const discard = app.versionComparisonPreview
    .discard(app.project.id, pair.id)
    .then(() => {
      discarded = true;
    });
  expect(leaseSignal?.aborted).toBe(true);
  await Promise.resolve();
  expect(discarded).toBe(false);
  expect(
    (
      await lstat(
        join(app.directory, "cache", "version-comparison", pair.id, "a.mp4"),
      )
    ).isFile(),
  ).toBe(true);
  finish();
  await read;
  await discard;
  await expect(
    lstat(join(app.directory, "cache", "version-comparison", pair.id)),
  ).rejects.toThrow();
});

import { DatabaseSync } from "node:sqlite";
function semantic(app: OpenFilmApplication) {
  const db = new DatabaseSync(join(app.directory, "database.sqlite"), {
    readOnly: true,
  });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'jobs' ORDER BY name",
      )
      .all();
    return createHash("sha256")
      .update(
        JSON.stringify(
          tables.map((r) => [
            r.name,
            db
              .prepare(
                `SELECT * FROM "${String(r.name).replaceAll('"', '""')}"`,
              )
              .all()
              .map((row) => JSON.stringify(row))
              .sort(),
          ]),
        ),
      )
      .digest("hex");
  } finally {
    db.close();
  }
}

it.each(["project", "extra", "version", "composition", "identical"])(
  "rejects invalid %s targets",
  async (kind) => {
    const { app, input } = await savedFixture();
    if (kind === "project") input.projectId = "other";
    if (kind === "extra") Object.assign(input.a, { path: "/private/source" });
    if (kind === "version") input.a.versionId = "bad";
    if (kind === "composition") input.a.compositionId = " ";
    if (kind === "identical") input.b = { ...input.a };
    await expect(app.runVersionComparisonPreview(input)).rejects.toThrow();
    expect(app.catalog.getJob(input.requestId)?.status).not.toBe("completed");
  },
);
it("reservation persistence failure releases the active-job counter", async () => {
  const { app, input } = await fixture();
  const save = vi.spyOn(app.catalog, "saveJob").mockImplementationOnce(() => {
    throw new Error("disk full /private/location");
  });
  await expect(app.runVersionComparisonPreview(input)).rejects.toThrow();
  save.mockRestore();
  // close is called by fixture cleanup and must no longer report an active job.
  await expect(
    app.runVersionComparisonPreview({ ...input, requestId: randomUUID() }),
  ).rejects.toThrow(/unavailable/);
});
it("completion persistence failure revokes both MP4s and retains failed status", async () => {
  const { app, input } = await savedFixture();
  const save = app.catalog.saveJob.bind(app.catalog);
  vi.spyOn(app.catalog, "saveJob").mockImplementation((job) => {
    if (job.status === "completed") throw new Error("persist failed");
    save(job);
  });
  await expect(app.runVersionComparisonPreview(input)).rejects.toThrow();
  expect(app.catalog.getJob(input.requestId)?.status).toBe("failed");
  expect(
    await readdir(join(app.directory, "cache", "version-comparison")),
  ).toEqual([]);
});
it("does not overwrite a replacement owner on progress or failure", async () => {
  const { app, input } = await savedFixture(),
    render = FFmpegRenderer.prototype.render,
    replacement = createReviewOwner();
  vi.spyOn(FFmpegRenderer.prototype, "render").mockImplementation(
    async function (this: FFmpegRenderer, ...args) {
      const row = app.catalog.getJob(input.requestId)!;
      app.catalog.saveJob({
        ...row,
        reviewOwner: replacement,
        progress: 0.123,
      });
      return render.apply(this, args);
    },
  );
  await expect(app.runVersionComparisonPreview(input)).rejects.toThrow();
  expect(app.catalog.getJob(input.requestId)).toMatchObject({
    status: "running",
    progress: 0.123,
    reviewOwner: replacement,
  });
});
it("keeps another live app's ready cache locked and job untouched", async () => {
  const { app, input } = await savedFixture(),
    pair = await app.runVersionComparisonPreview(input);
  const other = await OpenFilmApplication.open(app.directory);
  try {
    expect(other.catalog.getJob(input.requestId)?.status).toBe("completed");
    await expect(
      other.runVersionComparisonPreview({ ...input, requestId: randomUUID() }),
    ).rejects.toThrow();
    expect(
      await app.versionComparisonPreview.get(app.project.id, pair.id),
    ).toEqual(pair);
  } finally {
    other.close();
  }
  await app.versionComparisonPreview.discard(app.project.id, pair.id);
});
it("refuses changed and missing saved sources without rendering", async () => {
  const { app, input, root } = await savedFixture(),
    render = vi.spyOn(FFmpegRenderer.prototype, "render");
  await writeFile(join(root, "red.png"), "changed");
  await expect(app.runVersionComparisonPreview(input)).rejects.toThrow();
  expect(render).not.toHaveBeenCalled();
  await rm(join(root, "red.png"));
  await expect(
    app.runVersionComparisonPreview({ ...input, requestId: randomUUID() }),
  ).rejects.toThrow();
  expect(render).not.toHaveBeenCalled();
});
it.each(["tamper", "source", "version", "expiry", "restore"])(
  "revokes a ready pair on %s",
  async (kind) => {
    const { app, input, root, a } = await savedFixture(),
      pair = await app.runVersionComparisonPreview(input);
    if (kind === "tamper")
      await writeFile(
        join(app.directory, "cache", "version-comparison", pair.id, "a.mp4"),
        "changed",
      );
    if (kind === "source") await writeFile(join(root, "red.png"), "changed");
    if (kind === "version")
      app.versions.remove(a.id, {
        baseRevision: app.versions.currentRevision(),
        confirmed: true,
      });
    if (kind === "expiry")
      vi.spyOn(Date, "now").mockReturnValue(Date.parse(pair.expiresAt) + 1);
    if (kind === "restore") app.project.id = "replacement-project";
    await expect(
      app.versionComparisonPreview.get(input.projectId, pair.id),
    ).rejects.toThrow();
    if (kind === "restore") app.project.id = input.projectId;
    else {
      await app.versionComparisonPreview.drain();
      await expect(
        lstat(join(app.directory, "cache", "version-comparison", pair.id)),
      ).rejects.toThrow();
    }
  },
);
it("request cancellation aborts real renderer work, drains it, and leaves no ready files", async () => {
  const { app, input } = await savedFixture(),
    render = FFmpegRenderer.prototype.render;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  vi.spyOn(FFmpegRenderer.prototype, "render").mockImplementation(function (
    this: FFmpegRenderer,
    ...args
  ) {
    const task = render.apply(this, args);
    entered();
    return task;
  });
  const work = app.runVersionComparisonPreview(input);
  const rejected = expect(work).rejects.toMatchObject({ name: "AbortError" });
  await started;
  await new Promise<void>((resolve) => setTimeout(resolve, 75));
  expect(() => app.close()).toThrow(/active jobs/);
  await app.versionComparisonPreview.discardRequest(
    app.project.id,
    input.requestId,
  );
  await rejected;
  expect(app.catalog.getJob(input.requestId)?.status).toBe("cancelled");
  expect(
    await readdir(join(app.directory, "cache", "version-comparison")),
  ).toEqual([]);
});
it("fails safely with a foreign owner marker and keeps its cache bytes", async () => {
  const { app, input } = await savedFixture(),
    id = randomUUID(),
    path = join(app.directory, "cache", "version-comparison", id);
  await mkdir(path, { recursive: true });
  const marker = JSON.stringify({
    version: 1,
    id,
    projectId: app.project.id,
    owner: { host: "foreign", pid: 123, token: randomUUID() },
  });
  await writeFile(join(path, "owner.json"), marker);
  await expect(app.runVersionComparisonPreview(input)).rejects.toThrow();
  expect(await readFile(join(path, "owner.json"), "utf8")).toBe(marker);
});
it("recovers only a confirmed dead comparison owner", async () => {
  const { app, input } = await fixture(),
    owner = { ...createReviewOwner(), pid: 2147483647 };
  app.catalog.saveJob({
    id: input.requestId,
    type: "render",
    stage: "version-comparison-preview",
    status: "running",
    progress: 0,
    createdAt: new Date().toISOString(),
    reviewOwner: owner,
  });
  const other = await OpenFilmApplication.open(app.directory);
  try {
    expect(other.catalog.getJob(input.requestId)).toMatchObject({
      status: "failed",
      reviewOwner: owner,
    });
  } finally {
    other.close();
  }
});
it("full-render source evidence includes muted/hidden/secondary dependencies", () => {
  expect([
    ...renderSourceAssetIds({
      id: "c",
      storyId: "s",
      duration: 1,
      tracks: [
        {
          id: "hidden",
          type: "video",
          visible: false,
          muted: true,
          clips: [
            {
              id: "a",
              assetId: "a",
              timelineStart: 0,
              timelineDuration: 1,
              layout: {
                kind: "split",
                secondary: { assetId: "secondary" },
              } as never,
            },
          ],
        },
        {
          id: "titles",
          type: "titles",
          clips: [
            {
              id: "t",
              assetId: "not-a-source",
              timelineStart: 0,
              timelineDuration: 1,
            },
          ],
        },
        {
          id: "sound",
          type: "audio",
          muted: true,
          clips: [
            {
              id: "audio",
              assetId: "audio",
              timelineStart: 0,
              timelineDuration: 1,
            },
          ],
        },
      ],
    }),
  ]).toEqual(["a", "secondary", "audio"]);
});

import { truncate, rename, symlink } from "node:fs/promises";
it("refuses oversized orphan inventories and never deletes an unbounded tree", async () => {
  const { app, input } = await savedFixture(),
    id = randomUUID(),
    path = join(app.directory, "cache", "version-comparison", id);
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, "owner.json"),
    JSON.stringify({
      version: 1,
      id,
      projectId: app.project.id,
      owner: { ...createReviewOwner(), pid: 2147483647 },
    }),
  );
  await writeFile(join(path, "a.mp4"), "");
  await truncate(join(path, "a.mp4"), 2 * 1024 ** 3);
  await expect(app.runVersionComparisonPreview(input)).rejects.toThrow();
  expect((await lstat(join(path, "a.mp4"))).size).toBe(2 * 1024 ** 3);
});
it("removes a bounded confirmed-dead orphan under the new lifetime lock", async () => {
  const { app, input } = await savedFixture(),
    id = randomUUID(),
    path = join(app.directory, "cache", "version-comparison", id);
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, "owner.json"),
    JSON.stringify({
      version: 1,
      id,
      projectId: app.project.id,
      owner: { ...createReviewOwner(), pid: 2147483647 },
    }),
  );
  await writeFile(join(path, "a.mp4"), "interrupted");
  const pair = await app.runVersionComparisonPreview(input);
  await expect(lstat(path)).rejects.toThrow();
  expect(pair.a.bytes).toBeGreaterThan(0);
});
it.each(["short", "silent"])(
  "rejects parseable but %s output even when its receipt hash matches",
  async (kind) => {
    const { app, input } = await savedFixture(),
      render = FFmpegRenderer.prototype.render;
    vi.spyOn(FFmpegRenderer.prototype, "render").mockImplementation(
      async function (this: FFmpegRenderer, ...args) {
        const path = await render.apply(this, args),
          temp = `${path}.replacement.mp4`;
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          path,
          ...(kind === "short" ? ["-t", "0.2"] : ["-an"]),
          "-c",
          "copy",
          temp,
        ]);
        await rename(temp, path);
        const receipt = JSON.parse(
          await readFile(`${path}.manifest.json`, "utf8"),
        );
        receipt.outputSha256 = await hashFile(path);
        await writeFile(`${path}.manifest.json`, JSON.stringify(receipt));
        return path;
      },
    );
    await expect(app.runVersionComparisonPreview(input)).rejects.toThrow();
    expect(app.catalog.getJob(input.requestId)?.status).toBe("failed");
  },
);
it("never follows an output symlink and closes successful leased file handles", async () => {
  const { app, input, root } = await savedFixture(),
    pair = await app.runVersionComparisonPreview(input);
  let handle: import("node:fs/promises").FileHandle | undefined;
  await app.versionComparisonPreview.withMedia(
    app.project.id,
    pair.id,
    "a",
    async (file) => {
      handle = file;
      expect(file.fd).toBeGreaterThanOrEqual(0);
    },
  );
  expect(handle?.fd).toBe(-1);
  const path = join(
    app.directory,
    "cache",
    "version-comparison",
    pair.id,
    "a.mp4",
  );
  await rm(path);
  await symlink(join(root, "tone-a.wav"), path);
  const consumer = vi.fn();
  await expect(
    app.versionComparisonPreview.withMedia(
      app.project.id,
      pair.id,
      "a",
      consumer,
    ),
  ).rejects.toThrow();
  expect(consumer).not.toHaveBeenCalled();
  await app.versionComparisonPreview.drain();
  expect(await hashFile(join(root, "tone-a.wav"))).toMatch(/^[a-f\d]{64}$/);
});
it("preserves a live owner's in-flight Job on a second app open", async () => {
  const { app, input } = await fixture(),
    owner = createReviewOwner();
  const job = {
    id: input.requestId,
    type: "render" as const,
    stage: "version-comparison-preview",
    status: "running" as const,
    progress: 0.4,
    createdAt: new Date().toISOString(),
    reviewOwner: owner,
  };
  app.catalog.saveJob(job);
  const other = await OpenFilmApplication.open(app.directory);
  try {
    expect(other.catalog.getJob(input.requestId)).toEqual(job);
  } finally {
    other.close();
  }
});
it("never changes a recovered owner replaced between observation and the transaction", async () => {
  const { app, input } = await fixture(),
    owner = { ...createReviewOwner(), pid: 2147483647 },
    replacement = createReviewOwner();
  app.catalog.saveJob({
    id: input.requestId,
    type: "render",
    stage: "version-comparison-preview",
    status: "running",
    progress: 0,
    createdAt: new Date().toISOString(),
    reviewOwner: owner,
  });
  const { ProjectCatalog: Catalog } = await import("@openfilm/catalog"),
    original = Catalog.prototype.withProjectWrite;
  let replaced = false;
  vi.spyOn(Catalog.prototype, "withProjectWrite").mockImplementation(function <
    T,
  >(this: InstanceType<typeof Catalog>, fn: () => T): T {
    const row = this.getJob(input.requestId);
    if (!replaced && row?.reviewOwner?.token === owner.token) {
      replaced = true;
      this.saveJob({ ...row, reviewOwner: replacement });
    }
    return original.call(this, fn) as T;
  });
  const other = await OpenFilmApplication.open(app.directory);
  try {
    expect(other.catalog.getJob(input.requestId)).toMatchObject({
      status: "running",
      reviewOwner: replacement,
    });
  } finally {
    other.close();
  }
});
it("rejects a saved story over its maximum before spawning renderer work", async () => {
  const { app, input } = await savedFixture();
  app.project.stories[0]!.maxDuration = 0.5;
  await app.save();
  const invalid = await app.versions.create({
    name: "Too long",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  input.a.versionId = invalid.id;
  const render = vi.spyOn(FFmpegRenderer.prototype, "render");
  await expect(app.runVersionComparisonPreview(input)).rejects.toThrow();
  expect(render).not.toHaveBeenCalled();
});

it("compares two different saved Compositions in one version with actual silent-track facts", async () => {
  const { app, input } = await savedFixture();
  const first = app.project.timelines[0]!;
  first.tracks = first.tracks.filter((t) => t.type !== "audio");
  const second = structuredClone(first);
  second.id = "second-cut";
  second.tracks[0]!.clips[0]!.assetId = "red";
  app.project.timelines.push(second);
  await app.save();
  const version = await app.versions.create({
    name: "Two cuts",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  input.a = { versionId: version.id, compositionId: "cut" };
  input.b = { versionId: version.id, compositionId: "second-cut" };
  const pair = await app.runVersionComparisonPreview(input);
  expect(pair.a.versionId).toBe(pair.b.versionId);
  expect(pair.a.compositionId).not.toBe(pair.b.compositionId);
  expect(pair.a.hasAudio && pair.b.hasAudio).toBe(true); // Existing renderer's actual silent AAC stream.
  app.versions.rename(version.id, { name: "Renamed without changing media" });
  expect(
    (await app.versionComparisonPreview.get(app.project.id, pair.id)).id,
  ).toBe(pair.id);
  const receiptA = JSON.parse(
    await readFile(
      join(
        app.directory,
        "cache",
        "version-comparison",
        pair.id,
        "a.mp4.manifest.json",
      ),
      "utf8",
    ),
  );
  expect(receiptA.sources.map((s: { assetId: string }) => s.assetId)).toEqual([
    "blue",
  ]);
});
it("a failed progress write aborts renderer work and terminalizes only its own job", async () => {
  const { app, input } = await savedFixture(),
    save = app.catalog.saveJob.bind(app.catalog);
  let failed = false;
  vi.spyOn(app.catalog, "saveJob").mockImplementation((row) => {
    if (!failed && row.status === "running" && (row.progress ?? 0) > 0) {
      failed = true;
      throw new Error("disk full /private");
    }
    save(row);
  });
  await expect(app.runVersionComparisonPreview(input)).rejects.toThrow(
    /could not be saved/,
  );
  expect(failed).toBe(true);
  expect(app.catalog.getJob(input.requestId)?.status).toBe("failed");
  expect(
    await readdir(join(app.directory, "cache", "version-comparison")),
  ).toEqual([]);
});
it("a consumer range rejection closes the lease without revoking a valid pair", async () => {
  const { app, input } = await savedFixture(),
    pair = await app.runVersionComparisonPreview(input),
    rejection = new Error("range rejected");
  await expect(
    app.versionComparisonPreview.withMedia(
      app.project.id,
      pair.id,
      "a",
      async () => {
        throw rejection;
      },
    ),
  ).rejects.toBe(rejection);
  expect(
    (await app.versionComparisonPreview.get(app.project.id, pair.id)).id,
  ).toBe(pair.id);
});
