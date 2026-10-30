// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import type { TimelineCommand } from "@openfilm/solver";

const roots: string[] = [];
const apps = new Set<OpenFilmApplication>();
afterEach(async () => {
  for (const app of apps) app.close();
  apps.clear();
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const runs = {
  version: 1 as const,
  splitAt: 4,
  primary: { fontSize: 32, tracking: 1 },
  secondary: { fontSize: 18, tracking: 2 },
  gap: 8,
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-title-editor-"));
  roots.push(root);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Titles",
  );
  apps.add(app);
  for (const id of ["photo", "paired", "replacement"])
    app.catalog.upsertAsset({
      id,
      name: id,
      uri: `file:///originals/${id}.png`,
      mediaType: "image",
      tags: [],
      state: {},
      metadata: {},
    });
  app.project.stories.push({
    id: "story",
    title: "Story",
    beats: [
      {
        id: "beat",
        title: "Beat",
        selectedAssetIds: ["photo"],
        constraints: [{ type: "must-include", assetIds: ["photo"] }],
      },
    ],
  });
  app.project.timelines.push({
    id: "film",
    storyId: "story",
    duration: 4,
    tracks: [
      {
        id: "video",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "photo",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 4,
            title: "繁體標題\nOur story",
            titleRuns: runs,
          },
        ],
      },
    ],
    captionTracks: [
      {
        version: 1,
        id: "captions",
        name: "Captions",
        style: { version: 1, role: "subtitle" },
        cues: [
          {
            version: 1,
            id: "cue",
            startMs: 500,
            endMs: 1500,
            text: "繁體標題\nOur story",
            textRuns: runs,
            source: { kind: "manual" },
            manualRevision: 0,
          },
        ],
      },
    ],
  });
  await app.save();
  return { app, editor: new TimelineEditor(app) };
}
const edit = (
  editor: TimelineEditor,
  commands: TimelineCommand[],
  requestId?: string,
) =>
  editor.edit("film", {
    baseRevision: editor.get("film").revision,
    commands,
    ...(requestId ? { requestId } : {}),
  });

it("rejects ambiguous canonical text edits atomically, including prior valid commands", async () => {
  const { app, editor } = await fixture();
  const before = editor.get("film");
  const disk = await readFile(join(app.directory, "project.json"), "utf8");
  await expect(
    edit(editor, [
      {
        type: "presentation",
        clipId: "clip",
        titleStyle: { version: 1, role: "film-title" },
      },
      {
        type: "presentation",
        clipId: "clip",
        title: "New primary\nNew translation",
      },
    ]),
  ).rejects.toMatchObject({ code: "timeline.titleRunsConflict" });
  expect(editor.get("film")).toEqual(before);
  expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
    disk,
  );
  await expect(
    edit(editor, [
      {
        type: "caption.cue.update",
        trackId: "captions",
        cueId: "cue",
        patch: { text: "Other\nTranslation" },
      },
    ]),
  ).rejects.toMatchObject({ code: "timeline.titleRunsConflict" });
  expect(editor.get("film")).toEqual(before);
});

it("saves run edits, exact retries, Undo/Redo and reopen with one history step", async () => {
  const { app, editor } = await fixture();
  const before = editor.get("film");
  const command: TimelineCommand = {
    type: "presentation",
    clipId: "clip",
    titleRuns: { ...runs, secondary: { fontSize: 22, tracking: 3 } },
    titleStyle: {
      version: 1,
      role: "subtitle",
      finishing: { version: 1, stroke: { color: "#000000", width: 2 } },
    },
  };
  const input = {
    baseRevision: before.revision,
    requestId: "bilingual-save",
    commands: [command],
  };
  const saved = await editor.edit("film", input);
  expect(
    saved.composition.tracks[0]!.clips[0]!.titleRuns?.secondary?.fontSize,
  ).toBe(22);
  expect((await editor.edit("film", input)).revision).toBe(saved.revision);
  await expect(
    editor.edit("film", {
      ...input,
      commands: [{ ...command, titleRuns: null }],
    }),
  ).rejects.toThrow(/requestId/);
  expect((await editor.undo("film", saved.revision)).composition).toEqual(
    before.composition,
  );
  const redone = await editor.redo("film", editor.get("film").revision);
  expect(redone.composition).toEqual(saved.composition);
  const directory = app.directory;
  app.close();
  apps.delete(app);
  const reopened = await OpenFilmApplication.open(directory);
  apps.add(reopened);
  expect(reopened.project.timelines[0]).toEqual(saved.composition);
});

it.each(["clip", "source", "paired"])(
  "honors %s locks without resetting runs or changing pins",
  async (locked) => {
    const { app, editor } = await fixture();
    const clip = app.project.timelines[0]!.tracks[0]!.clips[0]!;
    if (locked === "clip") clip.locked = true;
    else if (locked === "source")
      app.catalog.upsertAsset({
        ...app.catalog.getAsset("photo")!,
        state: { locked: true },
      });
    else {
      clip.layout = {
        version: 1,
        preset: "diptych",
        secondary: { assetId: "paired" },
      };
      app.catalog.upsertAsset({
        ...app.catalog.getAsset("paired")!,
        state: { locked: true },
      });
    }
    await app.save();
    const before = editor.get("film");
    await expect(
      edit(editor, [{ type: "presentation", clipId: "clip", titleRuns: null }]),
    ).rejects.toThrow(/lock/iu);
    expect(editor.get("film")).toEqual(before);
    // Composition captions keep their existing independent source-lock semantics.
    const captions = await edit(editor, [
      {
        type: "caption.cue.update",
        trackId: "captions",
        cueId: "cue",
        patch: { textRuns: null },
      },
    ]);
    expect(
      captions.composition.captionTracks![0]!.cues[0]!.textRuns,
    ).toBeUndefined();
    expect(captions.story).toEqual(before.story);
  },
);

it("clears runs without dropping literal translation and preserves them through split/replace", async () => {
  const { app, editor } = await fixture();
  app.catalog.upsertAsset({
    ...app.catalog.getAsset("photo")!,
    mediaType: "video",
    duration: 4,
  });
  app.project.stories[0]!.beats[0]!.selectedAssetIds = [];
  app.project.stories[0]!.beats[0]!.constraints = [];
  await app.save();
  const split = await edit(editor, [
    { type: "clip.split", clipId: "clip", sourceTime: 2 },
  ]);
  expect(
    split.composition.tracks[0]!.clips.map((clip) => clip.titleRuns),
  ).toEqual([runs, runs]);
  const half = split.composition.tracks[0]!.clips[1]!;
  const changed = await edit(editor, [
    { type: "replace", clipId: half.id, assetId: "replacement" },
  ]);
  expect(changed.composition.tracks[0]!.clips[1]!.titleRuns).toEqual(runs);
  const cleared = await edit(editor, [
    { type: "presentation", clipId: half.id, titleRuns: null },
  ]);
  expect(cleared.composition.tracks[0]!.clips[1]!.title).toBe(
    "繁體標題\nOur story",
  );
  expect(cleared.composition.tracks[0]!.clips[1]!.titleRuns).toBeUndefined();
  const removed = await edit(editor, [
    { type: "presentation", clipId: half.id, title: null },
  ]);
  expect(removed.composition.tracks[0]!.clips[1]!.titleRuns).toBeUndefined();
});

it("rejects unknown nested schema and ineffective inherited tracking without saved/history changes", async () => {
  const { app, editor } = await fixture();
  const before = editor.get("film");
  for (const titleRuns of [
    { ...runs, version: 2 },
    { ...runs, html: "<p>" },
    { ...runs, secondary: { fontSize: 10, tracking: 20 } },
    { version: 1, splitAt: 4, secondary: { tracking: 100 } },
  ])
    await expect(
      edit(editor, [
        { type: "presentation", clipId: "clip", titleRuns } as never,
      ]),
    ).rejects.toThrow();
  expect(editor.get("film")).toEqual(before);
  expect(app.project.timelines[0]).toEqual(before.composition);
  const caption = await edit(editor, [
    {
      type: "caption.cue.update",
      trackId: "captions",
      cueId: "cue",
      patch: { text: "另一標題\nDifferent story", textRuns: runs },
    },
  ]);
  expect(caption.composition.captionTracks![0]!.cues[0]).toMatchObject({
    manualRevision: 1,
    source: { kind: "manual" },
    startMs: 500,
    endMs: 1500,
  });
});
