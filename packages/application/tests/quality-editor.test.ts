import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MediaAsset, AudioAutomation } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import {
  OpenFilmApplication,
  TimelineEditor,
  type TimelineEditInput,
} from "../src/index.js";

const applications = new Set<OpenFilmApplication>();
const directories: string[] = [];
afterEach(async () => {
  for (const app of applications) app.close();
  applications.clear();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-quality-editor-"));
  directories.push(root);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Photo film",
  );
  applications.add(app);
  for (const [id, mediaType, duration] of [
    ["portrait", "image", undefined],
    ["second-photo", "image", undefined],
    ["music", "audio", 40],
    ["voice", "audio", 8],
  ] as const) {
    const asset: MediaAsset = {
      id,
      name: id,
      uri: `file:///originals/${id}`,
      mediaType,
      tags: [],
      state: {},
      metadata: {},
      ...(duration === undefined ? {} : { duration }),
    };
    app.catalog.upsertAsset(asset);
  }
  app.project.stories.push({
    id: "story",
    title: "Our story",
    beats: [{ id: "beat", title: "Together", candidateAssetIds: ["portrait"] }],
  });
  app.project.timelines.push({
    id: "film",
    storyId: "story",
    duration: 20,
    tracks: [
      {
        id: "visual",
        type: "video",
        clips: [
          {
            id: "photo",
            assetId: "portrait",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 20,
            sourceIn: 0,
            sourceOut: 20,
          },
        ],
      },
    ],
  });
  await app.save();
  return { app, editor: new TimelineEditor(app) };
}
const addMusic: TimelineCommand = {
  type: "audio.add",
  clipId: "soundtrack",
  assetId: "music",
  role: "music",
  timelineStart: 0,
  sourceIn: 1,
  sourceOut: 21,
  volume: 0.5,
};
const automation: AudioAutomation = {
  version: 1,
  role: "music",
  fadeIn: 1,
  fadeOut: 2,
  points: [
    { time: 0, gain: 1 },
    { time: 20, gain: 0.8 },
  ],
  ducking: [{ start: 4, end: 10, gain: 0.25, attack: 0.5, release: 1 }],
};

describe("durable quality editing", () => {
  it("deletes an empty soundtrack track and preserves that cleanup through undo, redo and reopen", async () => {
    const { app, editor } = await fixture();
    const initial = editor.get("film");
    const added = await editor.edit("film", {
      baseRevision: initial.revision,
      commands: [
        addMusic,
        { type: "audio.configure", clipId: "soundtrack", automation },
      ],
    });
    const deleted = await editor.edit("film", {
      baseRevision: added.revision,
      commands: [{ type: "delete", clipId: "soundtrack" }],
    });
    expect(deleted.composition).toEqual(initial.composition);
    const undone = await editor.undo("film", deleted.revision);
    expect(undone.composition).toEqual(added.composition);
    const redone = await editor.redo("film", undone.revision);
    expect(redone.composition).toEqual(initial.composition);
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    expect(new TimelineEditor(reopened).get("film").composition).toEqual(
      initial.composition,
    );
  });

  it.each(["portrait", "silent-video", "audible-next"])(
    "replaces an automated audible video with %s across undo, redo and reopen",
    async (replacementId) => {
      const { app, editor } = await fixture();
      for (const [id, duration, audible] of [
        ["audible-video", 20, true],
        ["silent-video", 20, false],
        ["audible-next", 12, true],
      ] as const) {
        app.catalog.upsertAsset({
          id,
          name: id,
          uri: `file:///originals/${id}.mp4`,
          mediaType: "video",
          duration,
          tags: [],
          state: {},
          metadata: {
            "openfilm.ffprobe": {
              streams: [
                { codec_type: "video" },
                ...(audible ? [{ codec_type: "audio" }] : []),
              ],
            },
          },
        });
      }
      app.project.timelines[0]!.tracks[0]!.clips[0]!.assetId = "audible-video";
      await app.save();
      const before = await editor.edit("film", {
        baseRevision: editor.get("film").revision,
        commands: [{ type: "audio.configure", clipId: "photo", automation }],
      });
      const replaced = await editor.edit("film", {
        baseRevision: before.revision,
        commands: [
          { type: "replace", clipId: "photo", assetId: replacementId },
        ],
      });
      const replacement = replaced.composition.tracks[0]!.clips[0]!;
      if (replacementId === "audible-next") {
        expect(replacement.audioAutomation).toMatchObject({
          role: "music",
          fadeIn: 1,
          fadeOut: 2,
        });
        expect(replacement.audioAutomation!.points!.at(-1)!.time).toBe(12);
      } else expect(replacement.audioAutomation).toBeUndefined();
      const undone = await editor.undo("film", replaced.revision);
      expect(undone.composition).toEqual(before.composition);
      expect(undone.composition.tracks[0]!.clips[0]!.audioAutomation).toEqual(
        automation,
      );
      const redone = await editor.redo("film", undone.revision);
      expect(redone.composition).toEqual(replaced.composition);
      const directory = app.directory;
      app.close();
      applications.delete(app);
      const reopened = await OpenFilmApplication.open(directory);
      applications.add(reopened);
      expect(new TimelineEditor(reopened).get("film").composition).toEqual(
        replaced.composition,
      );
    },
  );

  it("rejects silent-video automation without changing saved project or undo state", async () => {
    const { app, editor } = await fixture();
    app.catalog.upsertAsset({
      id: "silent-video",
      name: "Silent video",
      uri: "file:///originals/silent.mp4",
      mediaType: "video",
      duration: 20,
      tags: [],
      state: {},
      metadata: { "openfilm.ffprobe": { streams: [{ codec_type: "video" }] } },
    });
    app.project.timelines[0]!.tracks[0]!.clips[0]!.assetId = "silent-video";
    await app.save();
    const before = editor.get("film");
    const disk = await readFile(join(app.directory, "project.json"), "utf8");
    await expect(
      editor.edit("film", {
        baseRevision: before.revision,
        commands: [{ type: "audio.configure", clipId: "photo", automation }],
      }),
    ).rejects.toThrow(/audio/i);
    expect(editor.get("film")).toEqual(before);
    expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
      disk,
    );
  });

  it("adds soundtrack and narration as one undo unit, deduplicates retries and restores all fields after reopening", async () => {
    const { app, editor } = await fixture();
    const before = editor.get("film");
    expect(
      before.assets
        .filter((asset) => asset.mediaType === "audio")
        .map((asset) => asset.id)
        .sort(),
    ).toEqual(["music", "voice"]);
    const input: TimelineEditInput = {
      baseRevision: before.revision,
      requestId: "audio-batch",
      commands: [
        addMusic,
        {
          type: "audio.add",
          clipId: "narration",
          assetId: "voice",
          role: "narration",
          timelineStart: 4,
          sourceIn: 0,
          sourceOut: 6,
        },
        {
          type: "audio.configure",
          clipId: "soundtrack",
          automation: structuredClone(automation),
        },
      ],
    };
    const saved = await editor.edit("film", input);
    expect(saved.composition.duration).toBe(20);
    expect(saved.composition.tracks[0]).toEqual(before.composition.tracks[0]);
    expect(saved.story).toEqual(before.story);
    expect((await editor.edit("film", input)).composition).toEqual(
      saved.composition,
    );
    const undone = await editor.undo("film", saved.revision);
    expect(undone.composition).toEqual(before.composition);
    const redone = await editor.redo("film", undone.revision);
    expect(redone.composition).toEqual(saved.composition);
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    expect(new TimelineEditor(reopened).get("film").composition).toEqual(
      saved.composition,
    );
    expect(
      JSON.parse(await readFile(join(directory, "project.json"), "utf8"))
        .timelines[0],
    ).toEqual(saved.composition);
  });

  it("resolves secondary photos outside story candidates and persists editable presentation", async () => {
    const { app, editor } = await fixture();
    const before = editor.get("film");
    const saved = await editor.edit("film", {
      baseRevision: before.revision,
      commands: [
        {
          type: "presentation",
          clipId: "photo",
          layout: {
            version: 1,
            preset: "diptych",
            secondary: { assetId: "second-photo" },
          },
          motion: {
            version: 1,
            preset: "push-in",
            easing: "ease-in-out",
            from: { scale: 1, x: 0, y: 0 },
            to: { scale: 1.04, x: 0, y: 0 },
          },
          title: "我們一起走過的日子",
          titleStyle: { version: 1, role: "scene-statement", fontSize: 48 },
        },
      ],
    });
    expect(saved.assets.some((asset) => asset.id === "second-photo")).toBe(
      true,
    );
    expect(saved.composition.duration).toBe(20);
    const undone = await editor.undo("film", saved.revision);
    expect(undone.composition).toEqual(before.composition);
    await editor.redo("film", undone.revision);
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    expect(new TimelineEditor(reopened).get("film").composition).toEqual(
      saved.composition,
    );
  });

  it("saves and reopens a visually shortened film with bounded audio envelopes", async () => {
    const { app, editor } = await fixture();
    let state = await editor.edit("film", {
      baseRevision: editor.get("film").revision,
      commands: [
        addMusic,
        {
          type: "audio.configure",
          clipId: "soundtrack",
          automation: {
            version: 1,
            role: "music",
            fadeIn: 2,
            fadeOut: 18,
            points: [
              { time: 0, gain: 1 },
              { time: 20, gain: 0.5 },
            ],
            ducking: [
              { start: 4, end: 18, gain: 0.3, attack: 2, release: 6 },
              { start: 19, end: 20, gain: 0.4, attack: 0, release: 0 },
            ],
          },
        },
      ],
    });
    const original = state.composition;
    state = await editor.edit("film", {
      baseRevision: state.revision,
      commands: [{ type: "duration", clipId: "photo", duration: 8 }],
    });
    const music = state.composition.tracks[1]!.clips[0]!;
    expect(state.composition.duration).toBe(8);
    expect(music.audioAutomation).toMatchObject({
      fadeIn: 2,
      fadeOut: 8,
      points: [
        { time: 0, gain: 1 },
        { time: 8, gain: 0.8 },
      ],
      ducking: [{ start: 4, end: 8, gain: 0.3, attack: 2, release: 2 }],
    });
    const shortened = state.composition;
    state = await editor.undo("film", state.revision);
    expect(state.composition).toEqual(original);
    await editor.redo("film", state.revision);
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    expect(new TimelineEditor(reopened).get("film").composition).toEqual(
      shortened,
    );
  });

  it.each([
    { ...addMusic, unexpected: true },
    { ...addMusic, role: "other" },
    { ...addMusic, sourceOut: 41 },
    {
      type: "presentation",
      clipId: "photo",
      layout: { version: 2, preset: "contain" },
    },
    {
      type: "presentation",
      clipId: "photo",
      motion: { version: 1, preset: "hold", untrusted: true },
    },
    {
      type: "presentation",
      clipId: "photo",
      titleStyle: { version: 1, role: "subtitle", css: "external" },
    },
    {
      type: "audio.configure",
      clipId: "photo",
      automation: { version: 1, role: "music", points: [{ time: 0, gain: 5 }] },
    },
  ])(
    "rejects invalid or unknown command fields atomically: %j",
    async (command) => {
      const { app, editor } = await fixture();
      const before = editor.get("film");
      const disk = await readFile(join(app.directory, "project.json"), "utf8");
      await expect(
        editor.edit("film", {
          baseRevision: before.revision,
          commands: [command],
        } as TimelineEditInput),
      ).rejects.toThrow();
      expect(editor.get("film")).toEqual(before);
      expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
        disk,
      );
    },
  );
});
