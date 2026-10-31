import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import { automaticTimelineEdit } from "../src/editor-internal.js";
import { hashFile } from "@openfilm/media";
const clean: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of clean.splice(0).reverse()) await f();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-audio-timing-"));
  clean.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "tone.wav"),
    pcm = Buffer.alloc(48000 * 2 * 2),
    header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(96000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  await writeFile(source, Buffer.concat([header, pcm]));
  const app = await OpenFilmApplication.create(
    join(root, "p.openfilm"),
    "Sound",
  );
  clean.push(() => app.close());
  app.catalog.upsertAsset({
    id: "a",
    name: "Tone",
    uri: pathToFileURL(source).href,
    mediaType: "audio",
    duration: 10,
    contentHash: await hashFile(source),
    tags: [],
    state: {},
    metadata: {},
  });
  app.project.stories = [{ id: "s", title: "Story", beats: [] }];
  app.project.timelines = [
    {
      id: "c",
      storyId: "s",
      duration: 4,
      tracks: [
        {
          id: "audio",
          type: "audio",
          clips: [
            {
              id: "a",
              assetId: "a",
              sourceIn: 0,
              sourceOut: 2,
              timelineStart: 0,
              timelineDuration: 4,
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  const editor = new TimelineEditor(app),
    file = join(app.directory, "project.json");
  return { app, editor, source, file };
}
const timing = {
  version: 1 as const,
  sampleRate: 48000 as const,
  timelineStartSample: 24000,
  sourceInSample: 0,
  sourceOutSample: 48000,
};
describe("audio timing transactions", () => {
  it("promotes atomically, retries once, undoes/redoes one batch and reopens exact objects", async () => {
    const { app, editor, file } = await fixture(),
      before = editor.get("c");
    const input = {
      baseRevision: before.revision,
      requestId: "sound-1",
      commands: [
        { type: "audio.timing" as const, clipId: "a", timing },
        {
          type: "audio.configure" as const,
          clipId: "a",
          automation: {
            version: 1 as const,
            role: "dialogue" as const,
            fadeIn: 0.2,
          },
        },
      ],
    };
    const saved = await editor.edit("c", input);
    expect(app.project.schemaVersion).toBe("1.2.0");
    expect(saved.composition.tracks[0]!.clips[0]!.audioTiming).toEqual(timing);
    expect((await editor.edit("c", input)).acknowledgedRevision).toBe(
      saved.revision,
    );
    const undone = await editor.undo("c", saved.revision);
    expect(undone.composition).toEqual(before.composition);
    expect(app.project.schemaVersion).toBe("1.2.0");
    expect(undone.canUndo).toBe(false);
    const redone = await editor.redo("c", undone.revision);
    expect(redone.composition).toEqual(saved.composition);
    const opened = await OpenFilmApplication.open(app.directory);
    clean.push(() => opened.close());
    expect(opened.project.timelines[0]).toEqual(saved.composition);
    expect(JSON.parse(await readFile(file, "utf8")).schemaVersion).toBe(
      "1.2.0",
    );
  });
  it("rejects parser injection and actual decoded source exhaustion without writes", async () => {
    const { editor, file } = await fixture(),
      before = editor.get("c"),
      disk = await readFile(file, "utf8");
    for (const command of [
      { type: "audio.timing", clipId: "a", timing, origin: "history" },
      {
        type: "audio.timing",
        clipId: "a",
        timing: { ...timing, sourceOutSample: 144000 },
      },
      {
        type: "audio.timing",
        clipId: "a",
        timing: { ...timing, sampleRate: 44100 },
      },
    ])
      await expect(
        editor.edit("c", {
          baseRevision: before.revision,
          commands: [command] as never,
        }),
      ).rejects.toThrow();
    expect(editor.get("c").revision).toBe(before.revision);
    expect(await readFile(file, "utf8")).toBe(disk);
    expect(editor.get("c").canUndo).toBe(false);
  });
  it("rejects changed source bytes during validation and preserves failed-save history", async () => {
    const { app, editor, source, file } = await fixture(),
      before = editor.get("c"),
      disk = await readFile(file, "utf8"),
      original = app.save.bind(app);
    vi.spyOn(app, "save").mockImplementationOnce(
      async (...args: Parameters<typeof app.save>) => {
        await writeFile(source, Buffer.from("changed source"));
        await original(...args);
      },
    );
    await expect(
      editor.edit("c", {
        baseRevision: before.revision,
        commands: [{ type: "audio.timing", clipId: "a", timing }],
      }),
    ).rejects.toThrow(/source|changed/i);
    expect(await readFile(file, "utf8")).toBe(disk);
    expect(editor.get("c").revision).toBe(before.revision);
    expect(editor.get("c").canUndo).toBe(false);
  });
  it("rolls back schema, catalog, document and history after a failed save", async () => {
    const { app, editor, file } = await fixture(),
      before = editor.get("c"),
      disk = await readFile(file, "utf8"),
      asset = app.catalog.getAsset("a");
    vi.spyOn(app, "save").mockRejectedValueOnce(new Error("disk failure"));
    await expect(
      editor.edit("c", {
        baseRevision: before.revision,
        commands: [{ type: "audio.timing", clipId: "a", timing }],
      }),
    ).rejects.toThrow("disk failure");
    expect(app.project.schemaVersion).toBe("1.0.0");
    expect(app.catalog.getAsset("a")).toEqual(asset);
    expect(editor.get("c").revision).toBe(before.revision);
    expect(await readFile(file, "utf8")).toBe(disk);
  });
  it("requires direct intent before discarding imported independent sound", async () => {
    const { app, editor, file } = await fixture(),
      composition = app.project.timelines[0]!;
    app.project.schemaVersion = "1.2.0";
    composition.duration = 8;
    composition.tracks[0]!.clips[0]!.audioTiming = structuredClone(timing);
    const kept = {
      ...structuredClone(composition.tracks[0]!.clips[0]!),
      id: "keep",
      timelineStart: 4,
    };
    delete kept.audioTiming;
    composition.tracks[0]!.clips.push(kept);
    await app.save();
    const before = editor.get("c"),
      disk = await readFile(file, "utf8"),
      input = {
        baseRevision: before.revision,
        commands: [{ type: "delete" as const, clipId: "a" }],
      };
    await expect(
      editor[automaticTimelineEdit]("c", input),
    ).rejects.toMatchObject({
      code: "timeline.audioTimingConflict",
      status: 409,
    });
    expect(await readFile(file, "utf8")).toBe(disk);
    expect(editor.get("c").revision).toBe(before.revision);
    expect(editor.get("c").canUndo).toBe(false);
    const direct = await editor.edit("c", input);
    expect(direct.composition.tracks[0]!.clips.map((c) => c.id)).toEqual([
      "keep",
    ]);
    expect((await editor.undo("c", direct.revision)).composition).toEqual(
      before.composition,
    );
  });
});

it("checks actual audio handles for a new occurrence in the same batch", async () => {
  const { editor, file } = await fixture(),
    before = editor.get("c"),
    disk = await readFile(file, "utf8");
  await expect(
    editor.edit("c", {
      baseRevision: before.revision,
      commands: [
        {
          type: "audio.add",
          clipId: "new",
          assetId: "a",
          role: "music",
          timelineStart: 0,
          sourceIn: 0,
          sourceOut: 1,
        },
        {
          type: "audio.timing",
          clipId: "new",
          timing: {
            ...timing,
            timelineStartSample: 0,
            sourceOutSample: 144000,
          },
        },
      ],
    }),
  ).rejects.toThrow(/source|handle/i);
  expect(await readFile(file, "utf8")).toBe(disk);
});
