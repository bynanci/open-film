import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MediaAsset, AudioAutomation, PhotoMotion } from "@openfilm/core";
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
const pullOut: PhotoMotion = {
  version: 1,
  preset: "pull-out",
  easing: "ease-in-out",
  from: { scale: 1.06, x: 0, y: 0 },
  to: { scale: 1, x: 0, y: 0 },
};

describe("durable quality editing", () => {
  it("saves original-layout photo pull-out without rewriting layout, text, timing or soundtrack and restores it through history and reopen", async () => {
    const { app, editor } = await fixture();
    const photo = app.project.timelines[0]!.tracks[0]!.clips[0]!;
    photo.title = "Together, one day at a time";
    photo.titleStyle = {
      version: 1,
      role: "subtitle",
      fadeOut: 1,
      bottomSafeMargin: 0.12,
    };
    photo.transform = { scale: 1.1, x: 4, y: -2, rotation: 3 };
    await app.save();
    const before = await editor.edit("film", {
      baseRevision: editor.get("film").revision,
      commands: [
        addMusic,
        { type: "audio.configure", clipId: "soundtrack", automation },
      ],
    });
    const input: TimelineEditInput = {
      baseRevision: before.revision,
      requestId: "original-photo-pull-out",
      commands: [{ type: "presentation", clipId: "photo", motion: pullOut }],
    };
    const expected = structuredClone(before.composition);
    expected.tracks[0]!.clips[0]!.motion = pullOut;
    expected.tracks[0]!.clips[0]!.userOverrides = {
      version: 1,
      isUserPinned: true,
      lockedAttributes: ["motionPreset", "timing"],
    };
    const saved = await editor.edit("film", input);
    expect(saved.composition).toEqual(expected);
    expect(saved.composition.tracks[0]!.clips[0]).not.toHaveProperty("layout");
    expect(saved.story).toEqual(before.story);
    expect(saved.assets).toEqual(before.assets);
    const retry = await editor.edit("film", structuredClone(input));
    expect(retry.revision).toBe(saved.revision);
    expect(retry.acknowledgedRevision).toBe(saved.revision);
    const undone = await editor.undo("film", saved.revision);
    expect(undone.composition).toEqual(before.composition);
    const redone = await editor.redo("film", undone.revision);
    expect(redone.composition).toEqual(expected);
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    const restored = new TimelineEditor(reopened).get("film");
    expect(restored.composition).toEqual(expected);
    expect(restored.story).toEqual(before.story);
    expect(restored.assets).toEqual(before.assets);
    expect(
      JSON.parse(await readFile(join(directory, "project.json"), "utf8"))
        .timelines[0],
    ).toEqual(expected);
  });

  it.each(["clip", "source", "paired source"])(
    "rejects pull-out changes protected by a %s lock without changing the saved cut or history",
    async (locked) => {
      const { app, editor } = await fixture();
      const photo = app.project.timelines[0]!.tracks[0]!.clips[0]!;
      if (locked === "clip") photo.locked = true;
      else {
        const assetId = locked === "source" ? "portrait" : "second-photo";
        if (locked === "paired source")
          photo.layout = {
            version: 1,
            preset: "diptych",
            secondary: { assetId },
          };
        const source = app.catalog.getAsset(assetId)!;
        app.catalog.upsertAsset({
          ...source,
          state: { ...source.state, locked: true },
        });
      }
      await app.save();
      const before = editor.get("film");
      const disk = await readFile(join(app.directory, "project.json"), "utf8");
      await expect(
        editor.edit("film", {
          baseRevision: before.revision,
          commands: [
            { type: "presentation", clipId: "photo", motion: pullOut },
          ],
        }),
      ).rejects.toThrow(/locked|unlocked/i);
      expect(editor.get("film")).toEqual(before);
      expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
        disk,
      );
    },
  );

  it.each(["video", "audio"] as const)(
    "rejects a still-photo pull-out on a %s source atomically",
    async (mediaType) => {
      const { app, editor } = await fixture();
      app.catalog.upsertAsset({
        id: "non-photo",
        name: "Non photo",
        uri: `file:///originals/non-photo.${mediaType === "video" ? "mp4" : "wav"}`,
        mediaType,
        duration: 20,
        tags: [],
        state: {},
        metadata: {},
      });
      app.project.timelines[0]!.tracks[0]!.clips[0]!.assetId = "non-photo";
      await app.save();
      const before = editor.get("film");
      const disk = await readFile(join(app.directory, "project.json"), "utf8");
      await expect(
        editor.edit("film", {
          baseRevision: before.revision,
          commands: [
            { type: "presentation", clipId: "photo", motion: pullOut },
          ],
        }),
      ).rejects.toThrow(/still|visual/i);
      expect(editor.get("film")).toEqual(before);
      expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
        disk,
      );
    },
  );

  it("saves explicit native text size, weight, fade and margin as one undo unit without changing the cut or audio and reopens all authored fields", async () => {
    const { app, editor } = await fixture();
    app.project.timelines[0]!.tracks.push({
      id: "existing-music",
      type: "music",
      timing: "overlay",
      clips: [
        {
          id: "soundtrack",
          assetId: "music",
          timelineStart: 0,
          timelineDuration: 20,
          sourceIn: 1,
          sourceOut: 21,
          transform: { volume: 0.5 },
          audioAutomation: structuredClone(automation),
        },
      ],
    });
    await app.save();
    const before = editor.get("film");
    const input: TimelineEditInput = {
      baseRevision: before.revision,
      requestId: "native-text-style",
      commands: [
        {
          type: "presentation",
          clipId: "photo",
          title: "我們一起走過的日子",
          titleStyle: {
            version: 1,
            role: "subtitle",
            position: "bottom",
            background: "scrim",
            fontSize: 64,
            fontWeight: 700,
            fadeOut: 1,
            bottomSafeMargin: 0.12,
          },
        },
      ],
    };
    const saved = await editor.edit("film", input);
    const expected = saved.composition.tracks[0]!.clips[0]!;
    expect(expected.titleStyle).toEqual({
      version: 1,
      role: "subtitle",
      position: "bottom",
      background: "scrim",
      fontSize: 64,
      fontWeight: 700,
      fadeOut: 1,
      bottomSafeMargin: 0.12,
    });
    expect(saved.story).toEqual(before.story);
    expect(saved.composition.duration).toBe(before.composition.duration);
    expect(saved.assets).toEqual(before.assets);
    const expectedComposition = structuredClone(before.composition);
    expectedComposition.tracks[0]!.clips[0]!.title = expected.title;
    expectedComposition.tracks[0]!.clips[0]!.titleStyle = expected.titleStyle;
    expectedComposition.tracks[0]!.clips[0]!.userOverrides = {
      version: 1,
      isUserPinned: true,
      lockedAttributes: ["timing"],
    };
    expect(saved.composition).toEqual(expectedComposition);
    const retry = await editor.edit("film", structuredClone(input));
    expect(retry.revision).toBe(saved.revision);
    expect(retry.acknowledgedRevision).toBe(saved.revision);
    await expect(
      editor.edit("film", {
        ...input,
        commands: [
          {
            type: "presentation",
            clipId: "photo",
            titleStyle: {
              version: 1,
              role: "subtitle",
              fadeOut: 0.5,
              bottomSafeMargin: 0.12,
            },
          },
        ],
      }),
    ).rejects.toThrow(/requestId/);
    expect(editor.get("film").composition).toEqual(saved.composition);
    const undone = await editor.undo("film", saved.revision);
    expect(undone.composition).toEqual(before.composition);
    expect(undone.canUndo).toBe(false);
    const redone = await editor.redo("film", undone.revision);
    expect(redone.composition).toEqual(saved.composition);
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    const reopenedEditor = new TimelineEditor(reopened);
    const restored = reopenedEditor.get("film");
    expect(restored.composition).toEqual(saved.composition);
    expect(restored.story).toEqual(saved.story);
    expect(restored.assets).toEqual(saved.assets);
    expect(
      JSON.parse(await readFile(join(directory, "project.json"), "utf8"))
        .timelines[0].tracks[0].clips[0],
    ).toEqual(expected);
    const roleDefault = { ...expected.titleStyle! };
    delete roleDefault.fontSize;
    const reset = await reopenedEditor.edit("film", {
      baseRevision: restored.revision,
      commands: [
        { type: "presentation", clipId: "photo", titleStyle: roleDefault },
      ],
    });
    expect(reset.composition.tracks[0]!.clips[0]!.titleStyle).toEqual({
      version: 1,
      role: "subtitle",
      position: "bottom",
      background: "scrim",
      fontWeight: 700,
      fadeOut: 1,
      bottomSafeMargin: 0.12,
    });
    const resetExpected = structuredClone(saved.composition);
    resetExpected.tracks[0]!.clips[0]!.titleStyle = roleDefault;
    expect(reset.composition).toEqual(resetExpected);
    const restoredSize = await reopenedEditor.undo("film", reset.revision);
    expect(restoredSize.composition).toEqual(saved.composition);
    expect(
      (await reopenedEditor.redo("film", restoredSize.revision)).composition,
    ).toEqual(resetExpected);
  });

  it.each(["clip", "source", "paired source"])(
    "rejects native text size, fade and safe-margin edits protected by a %s lock without modifying history or disk",
    async (locked) => {
      const { app, editor } = await fixture();
      const current = app.project.timelines[0]!.tracks[0]!.clips[0]!;
      current.title = "Original caption";
      current.titleStyle = {
        version: 1,
        role: "subtitle",
        fadeOut: 0,
        bottomSafeMargin: 0.08,
      };
      if (locked === "clip") current.locked = true;
      else {
        const assetId = locked === "source" ? "portrait" : "second-photo";
        if (locked === "paired source")
          current.layout = {
            version: 1,
            preset: "diptych",
            secondary: { assetId },
          };
        const source = app.catalog.getAsset(assetId)!;
        app.catalog.upsertAsset({
          ...source,
          state: { ...source.state, locked: true },
        });
      }
      await app.save();
      const before = editor.get("film");
      const disk = await readFile(join(app.directory, "project.json"), "utf8");
      await expect(
        editor.edit("film", {
          baseRevision: before.revision,
          commands: [
            {
              type: "presentation",
              clipId: "photo",
              titleStyle: {
                version: 1,
                role: "subtitle",
                fontSize: 64,
                fadeOut: 1,
                bottomSafeMargin: 0.15,
              },
            },
          ],
        }),
      ).rejects.toThrow(/locked|unlocked/i);
      expect(editor.get("film")).toEqual(before);
      expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
        disk,
      );
    },
  );

  it.each([
    { fadeOut: -0.01 },
    { fadeOut: 10.01 },
    { fadeOut: Infinity },
    { fadeOut: NaN },
    { fadeOut: "1" },
    { bottomSafeMargin: -0.01 },
    { bottomSafeMargin: 0.30001 },
    { bottomSafeMargin: Infinity },
    { bottomSafeMargin: NaN },
    { bottomSafeMargin: "0.08" },
  ])("rejects invalid native text controls atomically: %j", async (style) => {
    const { app, editor } = await fixture();
    const before = editor.get("film");
    const disk = await readFile(join(app.directory, "project.json"), "utf8");
    await expect(
      editor.edit("film", {
        baseRevision: before.revision,
        commands: [
          {
            type: "presentation",
            clipId: "photo",
            title: "Must not partially save",
          },
          {
            type: "presentation",
            clipId: "photo",
            titleStyle: { version: 1, role: "subtitle", ...style },
          },
        ],
      } as TimelineEditInput),
    ).rejects.toThrow();
    expect(editor.get("film")).toEqual(before);
    expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
      disk,
    );
  });

  it("accepts native text control limits and removes overrides without removing the text", async () => {
    const { editor } = await fixture();
    let state = editor.get("film");
    for (const [fadeOut, bottomSafeMargin] of [
      [0, 0],
      [10, 0.3],
    ] as const) {
      state = await editor.edit("film", {
        baseRevision: state.revision,
        commands: [
          {
            type: "presentation",
            clipId: "photo",
            title: "Keep this caption",
            titleStyle: {
              version: 1,
              role: "subtitle",
              fadeOut,
              bottomSafeMargin,
            },
          },
        ],
      });
      expect(state.composition.tracks[0]!.clips[0]!.titleStyle).toMatchObject({
        fadeOut,
        bottomSafeMargin,
      });
    }
    state = await editor.edit("film", {
      baseRevision: state.revision,
      commands: [{ type: "presentation", clipId: "photo", titleStyle: null }],
    });
    expect(state.composition.tracks[0]!.clips[0]!.title).toBe(
      "Keep this caption",
    );
    expect(state.composition.tracks[0]!.clips[0]!.titleStyle).toBeUndefined();
  });

  it("persists authored native text controls through retimed trim and split without clamping the saved fade", async () => {
    const { app, editor } = await fixture();
    app.catalog.upsertAsset({
      id: "caption-video",
      name: "Caption video",
      uri: "file:///originals/caption-video.mp4",
      mediaType: "video",
      duration: 20,
      tags: [],
      state: {},
      metadata: {},
    });
    app.project.timelines[0]!.tracks[0]!.clips[0]!.assetId = "caption-video";
    await app.save();
    const before = editor.get("film");
    const titleStyle = {
      version: 1,
      role: "subtitle",
      fontWeight: 700,
      fadeOut: 10,
      bottomSafeMargin: 0.2,
    } as const;
    const saved = await editor.edit("film", {
      baseRevision: before.revision,
      commands: [
        {
          type: "presentation",
          clipId: "photo",
          title: "Retain the full authored style",
          titleStyle,
        },
        { type: "speed", clipId: "photo", speed: 2 },
        { type: "trim", clipId: "photo", sourceIn: 2, sourceOut: 8 },
        { type: "clip.split", clipId: "photo", sourceTime: 4 },
      ],
    });
    expect(saved.composition.duration).toBe(3);
    expect(saved.story).toEqual(before.story);
    expect(saved.composition.tracks[0]!.clips).toMatchObject([
      {
        id: "photo",
        sourceIn: 2,
        sourceOut: 4,
        timelineDuration: 1,
        titleStyle,
      },
      {
        id: "photo-split-1",
        sourceIn: 4,
        sourceOut: 8,
        timelineDuration: 2,
        titleStyle,
      },
    ]);
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
  });

  it.each([
    ["portrait", "second-photo"],
    ["portrait", "title-video"],
    ["title-video", "second-photo"],
  ])(
    "preserves authored title design on %s to %s replacement, undo, redo and reopen",
    async (sourceId, replacementId) => {
      const { app, editor } = await fixture();
      app.catalog.upsertAsset({
        id: "title-video",
        name: "Title video",
        uri: "file:///originals/title-video.mp4",
        mediaType: "video",
        duration: 20,
        tags: [],
        state: {},
        metadata: {
          "openfilm.ffprobe": { streams: [{ codec_type: "video" }] },
        },
      });
      app.project.timelines[0]!.tracks[0]!.clips[0]!.assetId = sourceId;
      await app.save();
      const before = await editor.edit("film", {
        baseRevision: editor.get("film").revision,
        commands: [
          {
            type: "presentation",
            clipId: "photo",
            title: "下一段故事，也和你一起",
            titleStyle: {
              version: 1,
              role: "film-title",
              fontFamily: "Noto Serif CJK TC",
              fontSize: 58,
              fontWeight: 600,
              lineHeight: 1.4,
              tracking: 1,
              maxWidth: 900,
              align: "center",
              background: "none",
              position: "center",
              fadeOut: 1.25,
              bottomSafeMargin: 0.12,
            },
          },
        ],
      });
      const originalClip = before.composition.tracks[0]!.clips[0]!;
      const replaced = await editor.edit("film", {
        baseRevision: before.revision,
        commands: [
          { type: "replace", clipId: "photo", assetId: replacementId },
        ],
      });
      const replacement = replaced.composition.tracks[0]!.clips[0]!;
      expect(replacement.title).toBe(originalClip.title);
      expect(replacement.titleStyle).toEqual(originalClip.titleStyle);
      const undone = await editor.undo("film", replaced.revision);
      expect(undone.composition).toEqual(before.composition);
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

  it("rejects shortening a pinned soundtrack without changing the complete project, disk or history before explicit release", async () => {
    const { app, editor } = await fixture();
    const pinned = await editor.edit("film", {
      baseRevision: editor.get("film").revision,
      commands: [
        addMusic,
        { type: "audio.configure", clipId: "soundtrack", automation },
      ],
    });
    const project = structuredClone(app.project),
      file = join(app.directory, "project.json"),
      disk = await readFile(file);
    await expect(
      editor.edit("film", {
        baseRevision: pinned.revision,
        commands: [{ type: "duration", clipId: "photo", duration: 8 }],
      }),
    ).rejects.toMatchObject({ code: "timeline.pinConflict", status: 409 });
    expect(app.project).toEqual(project);
    expect(editor.get("film")).toEqual(pinned);
    expect(await readFile(file)).toEqual(disk);
    const released = await editor.edit("film", {
      baseRevision: pinned.revision,
      commands: [
        {
          type: "user-pin.set",
          target: { kind: "clip", clipId: "soundtrack" },
          pinned: false,
        },
      ],
    });
    const shortened = await editor.edit("film", {
      baseRevision: released.revision,
      commands: [{ type: "duration", clipId: "photo", duration: 8 }],
    });
    expect(shortened.composition.duration).toBe(8);
    expect(shortened.composition.tracks[1]!.clips[0]!.userOverrides).toEqual({
      version: 1,
      isUserPinned: false,
      lockedAttributes: [],
    });
    expect((await editor.undo("film", shortened.revision)).composition).toEqual(
      released.composition,
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
        {
          type: "user-pin.set",
          target: { kind: "clip", clipId: "soundtrack" },
          pinned: false,
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
