import { hashFile } from "@openfilm/media";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  open,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  OpenFilmApplication,
  TimelineEditor,
  RecordAudioPreviewService,
  inspectRecordAudioWav,
} from "../src/index.js";
import { FFmpegRenderer } from "@openfilm/render";
import { createExportProfile } from "@openfilm/core";
import {
  toneSource,
  decodePolicyAudio,
} from "../../../tests/fixtures/audio-policy.js";
const readGate = vi.hoisted(() => ({
  path: "",
  entered: undefined as (() => void) | undefined,
  release: undefined as Promise<void> | undefined,
  unblock: undefined as (() => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      if (String(args[0]) !== readGate.path) return file;
      return new Proxy(file, {
        get(target, key) {
          if (key === "read")
            return async (...readArgs: unknown[]) => {
              readGate.entered?.();
              await readGate.release;
              return Reflect.apply(target.read, target, readArgs);
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});
const clean: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  readGate.unblock?.();
  readGate.path = "";
  readGate.entered = undefined;
  readGate.release = undefined;
  readGate.unblock = undefined;
  vi.restoreAllMocks();
  for (const f of clean.splice(0).reverse()) await f();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-record-pcm-"));
  clean.push(() => rm(root, { recursive: true, force: true }));
  const asset = await toneSource(root, "source", 440, 2),
    app = await OpenFilmApplication.create(
      join(root, "p.openfilm"),
      "Record sound",
    );
  clean.push(() => app.close());
  app.catalog.upsertAsset(asset);
  app.project.settings = { width: 160, height: 90, frameRate: 30 };
  app.project.schemaVersion = "1.2.0";
  app.project.stories = [{ id: "s", title: "Story", beats: [] }];
  app.project.timelines = [
    {
      id: "c",
      storyId: "s",
      duration: 4,
      tracks: [
        {
          id: "a",
          type: "audio",
          clips: [
            {
              id: "a",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 2,
              sourceIn: 0,
              sourceOut: 2,
              audioTiming: {
                version: 1,
                sampleRate: 48000,
                timelineStartSample: 817,
                sourceInSample: 0,
                sourceOutSample: 48000,
              },
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  const editor = new TimelineEditor(app);
  return { root, app, asset, editor, revision: editor.get("c").revision };
}
function wavHeader(frames: number) {
  const b = Buffer.alloc(44),
    bytes = frames * 6;
  b.write("RIFF");
  b.writeUInt32LE(bytes + 36, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(288000, 28);
  b.writeUInt16LE(6, 32);
  b.writeUInt16LE(24, 34);
  b.write("data", 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}
it("prepares an opaque exact full-mix PCM descriptor, reuses only the exact key and returns bounded raw ranges", async () => {
  const { app, root, asset, revision } = await fixture(),
    disk = await readFile(join(app.directory, "project.json"), "utf8"),
    source = await readFile(new URL(asset.uri));
  const descriptor = await app.recordAudioPreview.prepare("c", revision);
  expect(descriptor).toEqual({
    version: 1,
    id: expect.stringMatching(/^[a-f0-9-]{36}$/),
    revision,
    sourceKeyDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    sampleRate: 48000,
    channels: 2,
    format: "pcm_s24le",
    lengthSamples: 192000,
  });
  expect(await app.recordAudioPreview.prepare("c", revision)).toEqual(
    descriptor,
  );
  const bytes = await app.recordAudioPreview.read(descriptor.id, 0, 192000);
  expect(bytes.length).toBe(192000 * 6);
  const expectedPath = join(root, "reference.wav");
  await new FFmpegRenderer().render(
    app.project.timelines[0]!,
    [asset],
    expectedPath,
    app.project.settings,
    {
      audioOnly: true,
      exportProfile: createExportProfile({
        ratio: "16:9",
        width: 160,
        height: 90,
        frameRate: 30,
        format: "wav",
      }),
    },
  );
  const expected = (await decodePolicyAudio(expectedPath)).samples;
  let error = 0;
  const data = Buffer.from(bytes);
  for (let i = 0; i < data.length / 3; i++)
    error = Math.max(
      error,
      Math.abs(data.readIntLE(i * 3, 3) / 8388608 - expected[i]!),
    );
  expect(error).toBeLessThanOrEqual(2 / 2 ** 23);
  for (const [start, count] of [
    [-1, 1],
    [0, 0],
    [0, 192001],
    [192000, 1],
    [0.5, 1],
    [0, Infinity],
    [NaN, 1],
  ])
    await expect(
      app.recordAudioPreview.read(descriptor.id, start!, count!),
    ).rejects.toThrow();
  expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
    disk,
  );
  expect(await readFile(new URL(asset.uri))).toEqual(source);
});
it("revokes stale revisions, changed source bytes and corrupt cache files", async () => {
  const { app, asset, editor, revision } = await fixture();
  const first = await app.recordAudioPreview.prepare("c", revision);
  const saved = await editor.edit("c", {
    baseRevision: revision,
    commands: [{ type: "volume", clipId: "a", volume: 0.5 }],
  });
  await expect(app.recordAudioPreview.read(first.id, 0, 1)).rejects.toThrow(
    /stale|changed/i,
  );
  const second = await app.recordAudioPreview.prepare("c", saved.revision),
    paths = await readdir(
      join(app.directory, "cache", "record-audio", "ready"),
    );
  const cache = paths.find(
    (p) => p.startsWith(second.id) && p.endsWith(".wav"),
  )!;
  await writeFile(
    join(app.directory, "cache", "record-audio", "ready", cache),
    Buffer.from("corrupt"),
  );
  await expect(app.recordAudioPreview.read(second.id, 0, 1)).rejects.toThrow(
    /cache|corrupt|changed/i,
  );
  const third = await app.recordAudioPreview.prepare("c", saved.revision);
  const source = Buffer.from(await readFile(new URL(asset.uri)));
  source[100] = source[100]! ^ 1;
  await writeFile(new URL(asset.uri), source);
  await expect(app.recordAudioPreview.read(third.id, 0, 1)).rejects.toThrow(
    /source|changed/i,
  );
});
it("rejects a previous preview after Undo returns to the identical document revision", async () => {
  const { app, editor, revision } = await fixture();
  const descriptor = await app.recordAudioPreview.prepare("c", revision);
  const edited = await editor.edit("c", {
    baseRevision: revision,
    commands: [{ type: "volume", clipId: "a", volume: 0.5 }],
  });
  const undone = await editor.undo("c", edited.revision);
  expect(undone.revision).toBe(revision);
  await expect(
    app.recordAudioPreview.read(descriptor.id, 0, 1),
  ).rejects.toMatchObject({ code: "timeline.conflict" });
  const fresh = await app.recordAudioPreview.prepare("c", undone.revision);
  expect(fresh.id).not.toBe(descriptor.id);
  expect((await app.recordAudioPreview.read(fresh.id, 0, 1)).byteLength).toBe(
    6,
  );
});
it("rejects stale work after actual render and never publishes a ready descriptor", async () => {
  const { app, editor, revision } = await fixture(),
    original = FFmpegRenderer.prototype.render;
  vi.spyOn(FFmpegRenderer.prototype, "render").mockImplementationOnce(
    async function (this: FFmpegRenderer, ...args) {
      const result = await original.apply(this, args);
      await editor.edit("c", {
        baseRevision: revision,
        commands: [{ type: "volume", clipId: "a", volume: 0.5 }],
      });
      return result;
    },
  );
  await expect(app.recordAudioPreview.prepare("c", revision)).rejects.toThrow(
    /stale|changed/i,
  );
  const ready = join(app.directory, "cache", "record-audio", "ready");
  expect(
    (await readdir(ready).catch(() => [])).filter((p) => p.endsWith(".wav")),
  ).toEqual([]);
});
it("allows one active project preparation, cancels pending work, and enforces one hour before rendering", async () => {
  const { app, revision } = await fixture();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const service = new RecordAudioPreviewService(
    app,
    async (_composition, _path, options) => {
      entered();
      await new Promise((_resolve, reject) =>
        options.signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        ),
      );
      return _path;
    },
  );
  const controller = new AbortController(),
    preparing = service.prepare("c", revision, controller.signal);
  await started;
  await expect(service.prepare("c", revision)).rejects.toThrow(
    /active|prepar|running/i,
  );
  controller.abort();
  await expect(preparing).rejects.toMatchObject({ name: "AbortError" });
  app.project.timelines[0]!.duration = 3600.001;
  await app.save();
  await expect(
    service.prepare("c", new TimelineEditor(app).get("c").revision),
  ).rejects.toThrow(/3600|hour/i);
  service.dispose();
});
it("rejects truncated or unsupported WAV chunks and the 1 GiB file cap", async () => {
  const { root } = await fixture(),
    path = join(root, "shape.wav"),
    header = wavHeader(10);
  await writeFile(path, Buffer.concat([header, Buffer.alloc(60)]));
  expect(await inspectRecordAudioWav(path, 10)).toMatchObject({
    dataOffset: 44,
    dataBytes: 60,
    lengthSamples: 10,
  });
  for (const mutate of [
    (b: Buffer) => b.writeUInt32LE(120, 40),
    (b: Buffer) => b.writeUInt16LE(16, 34),
    (b: Buffer) => b.writeUInt32LE(44100, 24),
    (b: Buffer) => b.write("RF64", 0),
    (b: Buffer) => b.writeUInt16LE(3, 20),
  ]) {
    const altered = Buffer.from(header);
    mutate(altered);
    await writeFile(path, Buffer.concat([altered, Buffer.alloc(60)]));
    await expect(inspectRecordAudioWav(path, 10)).rejects.toThrow();
  }
  const frames = Math.ceil(1024 ** 3 / 6),
    handle = await open(path, "w");
  try {
    await handle.write(wavHeader(frames));
    await handle.truncate(frames * 6 + 44);
  } finally {
    await handle.close();
  }
  await expect(inspectRecordAudioWav(path, frames)).rejects.toThrow(
    /bound|GiB|large/i,
  );
});
it("enforces the 2 GiB completed cache by evicting the oldest generation", async () => {
  const { app, asset } = await fixture();
  app.project.timelines[0]!.duration = 3600;
  await app.save();
  const service = new RecordAudioPreviewService(
    app,
    async (_composition, path) => {
      const frames = 172800000,
        handle = await open(path, "w");
      try {
        await handle.write(wavHeader(frames));
        await handle.truncate(frames * 6 + 44);
      } finally {
        await handle.close();
      }
      await writeFile(
        `${path}.manifest.json`,
        JSON.stringify({
          sources: [{ assetId: asset.id, sha256: asset.contentHash }],
          outputSha256: await hashFile(path),
        }),
      );
      return path;
    },
  );
  const original = structuredClone(app.project.timelines[0]!);
  app.project.timelines = [
    ...Array.from({ length: 3 }, (_, i) => ({
      ...structuredClone(original),
      id: `c${i}`,
    })),
  ];
  await app.save();
  const ids: string[] = [];
  for (const id of ["c0", "c1"])
    ids.push(
      (await service.prepare(id, new TimelineEditor(app).get(id).revision)).id,
    );
  readGate.path = join(
    app.directory,
    "cache",
    "record-audio",
    "ready",
    `${ids[0]}.wav`,
  );
  const entered = new Promise<void>((resolve) => {
    readGate.entered = resolve;
  });
  readGate.release = new Promise<void>((resolve) => {
    readGate.unblock = resolve;
  });
  const reading = service.read(ids[0]!, 0, 48000);
  await entered;
  try {
    ids.push(
      (await service.prepare("c2", new TimelineEditor(app).get("c2").revision))
        .id,
    );
    const files = (
      await readdir(join(app.directory, "cache", "record-audio", "ready"))
    ).filter((p) => p.endsWith(".wav"));
    expect(files).toHaveLength(2);
    expect(files.some((p) => p.startsWith(ids[0]!))).toBe(true);
    expect(files.some((p) => p.startsWith(ids[1]!))).toBe(false);
  } finally {
    readGate.unblock?.();
    expect((await reading).byteLength).toBe(48000 * 6);
  }
  service.dispose();
});

it("rejects staged PCM bytes that do not match the renderer manifest", async () => {
  const { app, revision } = await fixture(),
    original = FFmpegRenderer.prototype.render;
  vi.spyOn(FFmpegRenderer.prototype, "render").mockImplementationOnce(
    async function (this: FFmpegRenderer, ...args) {
      const path = await original.apply(this, args),
        file = await open(path, "r+");
      try {
        await file.write(
          Buffer.from([127]),
          0,
          1,
          (await file.stat()).size - 1,
        );
      } finally {
        await file.close();
      }
      return path;
    },
  );
  await expect(app.recordAudioPreview.prepare("c", revision)).rejects.toThrow(
    /hash|corrupt|bytes/i,
  );
});

it("does not acknowledge a cached silent preview after cancellation during its disk check", async () => {
  const { app } = await fixture();
  app.project.timelines[0]!.tracks[0]!.clips[0]!.transform = { volume: 0 };
  await app.save();
  const revision = new TimelineEditor(app).get("c").revision;
  await app.recordAudioPreview.prepare("c", revision);
  const controller = new AbortController(),
    pending = app.recordAudioPreview.prepare("c", revision, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
