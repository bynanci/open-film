// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { FilmLook } from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";

const applications = new Set<OpenFilmApplication>();
const directories: string[] = [];
afterEach(async () => {
  for (const app of applications) app.close();
  applications.clear();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const retro: FilmLook = { version: 1, preset: "retro", strength: 0.8 };
const natural: FilmLook = { version: 1, preset: "natural", strength: 0.5 };
const original: FilmLook = { version: 1, preset: "none", strength: 1 };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-looks-"));
  directories.push(root);
  const source = join(root, "source # & 記憶.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x52708a:s=96x64",
    "-frames:v",
    "1",
    "-threads",
    "1",
    source,
  ]);
  const directory = join(root, "Film # & 記憶.openfilm");
  const app = await OpenFilmApplication.create(directory, "Our memories");
  applications.add(app);
  app.project.settings = { width: 96, height: 64, frameRate: 12 };
  for (const id of ["photo-one", "photo-two"]) {
    const assetSource = id === "photo-one" ? source : join(root, "second.png");
    if (assetSource !== source)
      await writeFile(assetSource, await readFile(source));
    app.catalog.upsertAsset({
      id,
      uri: pathToFileURL(assetSource).href,
      name: id,
      mediaType: "image",
      dimensions: { width: 96, height: 64 },
      tags: [],
      state: {},
      metadata: {},
    });
  }
  app.project.stories.push({
    id: "story",
    title: "Our memories",
    maxDuration: 10,
    beats: [
      { id: "beat / 記憶", title: "Together" },
      { id: "second-beat", title: "Our future" },
    ],
  });
  app.project.timelines.push({
    id: "film",
    storyId: "story",
    duration: 1,
    tracks: [
      {
        id: "pictures",
        type: "video",
        clips: [
          {
            id: "one",
            assetId: "photo-one",
            beatId: "beat / 記憶",
            timelineStart: 0,
            timelineDuration: 0.5,
          },
          {
            id: "two",
            assetId: "photo-two",
            beatId: "second-beat",
            timelineStart: 0.5,
            timelineDuration: 0.5,
          },
        ],
      },
    ],
  });
  await app.save();
  return { app, directory, source, editor: new TimelineEditor(app) };
}

describe("durable film look application", () => {
  it("preserves structured protected-look errors through the application without saving a partial edit", async () => {
    const { app, editor } = await fixture();
    const source = app.catalog.getAsset("photo-two")!;
    app.catalog.upsertAsset({
      ...source,
      state: { ...source.state, locked: true },
    });
    const before = editor.get("film");
    await expect(
      editor.edit("film", {
        baseRevision: before.revision,
        commands: [{ type: "look", scope: "film", look: retro }],
      }),
    ).rejects.toMatchObject({
      code: "timeline.lookLocked",
      status: 409,
      params: { count: 1 },
    });
    expect(editor.get("film").composition).toEqual(before.composition);
    expect(editor.get("film").canUndo).toBe(false);
  });

  it("saves a film/scene/clip look batch as one undo unit and restores it after reopening", async () => {
    const { app, directory, source, editor } = await fixture();
    const before = editor.get("film");
    const sourceBytes = await readFile(source);
    const input = {
      baseRevision: before.revision,
      requestId: "looks-one-batch",
      commands: [
        { type: "look", scope: "film", look: retro },
        { type: "look", scope: "beat", beatId: "beat / 記憶", look: natural },
        { type: "look", scope: "clip", clipId: "one", look: original },
      ],
    } as Parameters<TimelineEditor["edit"]>[1];
    const saved = await editor.edit("film", input);
    expect(saved.composition.defaultLook).toEqual(retro);
    expect(saved.composition.beatLooks).toEqual([
      { beatId: "beat / 記憶", look: natural },
    ]);
    expect(saved.composition.tracks[0]!.clips[0]!.look).toEqual(original);
    expect(saved.story).toEqual(before.story);
    expect(saved.composition.duration).toBe(before.composition.duration);
    const undone = await editor.undo("film", saved.revision);
    expect(undone.composition).toEqual(before.composition);
    const redone = await editor.redo("film", undone.revision);
    expect(redone.composition).toEqual(saved.composition);
    const retried = await editor.edit("film", input);
    expect(retried.composition).toEqual(saved.composition);
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    expect(new TimelineEditor(reopened).get("film").composition).toEqual(
      saved.composition,
    );
    expect(await readFile(source)).toEqual(sourceBytes);
  });

  it("rejects invalid scope, unknown fields and stale look requests without changing the saved film", async () => {
    const { app, editor } = await fixture();
    const before = editor.get("film");
    for (const command of [
      { type: "look", scope: "all", look: retro },
      { type: "look", scope: "film", clipId: "one", look: retro },
      {
        type: "look",
        scope: "clip",
        clipId: "one",
        look: { ...retro, strength: 1.01 },
      },
      { type: "look", scope: "beat", beatId: "missing", look: retro },
      {
        type: "look",
        scope: "film",
        look: { ...retro, preset: "downloaded-lut" },
      },
    ]) {
      await expect(
        editor.edit("film", {
          baseRevision: before.revision,
          commands: [command],
        } as Parameters<TimelineEditor["edit"]>[1]),
      ).rejects.toThrow();
      expect(editor.get("film").composition).toEqual(before.composition);
    }
    await editor.edit("film", {
      baseRevision: before.revision,
      commands: [{ type: "look", scope: "film", look: retro }],
    });
    await expect(
      editor.edit("film", {
        baseRevision: before.revision,
        commands: [{ type: "look", scope: "film", look: natural }],
      }),
    ).rejects.toThrow();
    expect(app.project.timelines[0]!.defaultLook).toEqual(retro);
  });

  it("snapshots an export-only look before asynchronous source checks and never saves that override", async () => {
    const { app, source } = await fixture();
    app.project.timelines[0]!.defaultLook = retro;
    app.project.timelines[0]!.tracks[0]!.clips[0]!.look = original;
    await app.save();
    const before = JSON.stringify(app.project);
    const sourceBytes = await readFile(source);
    const override: FilmLook = { version: 1, preset: "natural", strength: 0.6 };
    const rendering = app.exportMp4("film", {
      lookOverride: override,
    } as Parameters<OpenFilmApplication["exportMp4"]>[1]);
    override.preset = "sport";
    override.strength = 0.1;
    const exported = await rendering;
    const manifest = JSON.parse(
      await readFile(exported.path + ".manifest.json", "utf8"),
    );
    expect(manifest.looks.override).toEqual({
      version: 1,
      preset: "natural",
      strength: 0.6,
    });
    expect(manifest.looks.clips).toHaveLength(2);
    expect(
      manifest.looks.clips.every(
        (clip: { source: string; preset: string }) =>
          clip.source === "export" && clip.preset === "natural",
      ),
    ).toBe(true);
    expect(JSON.stringify(app.project)).toBe(before);
    expect(await readFile(source)).toEqual(sourceBytes);
    const preview = await app.render("film");
    const savedManifest = JSON.parse(
      await readFile(preview + ".manifest.json", "utf8"),
    );
    expect(savedManifest.looks.override).toBeNull();
    expect(savedManifest.looks.clips[0].preset).toBe("none");
    expect(savedManifest.looks.clips[1].preset).toBe("retro");
  }, 30000);

  it("rejects invalid render overrides before creating jobs or changing preview evidence", async () => {
    const { app } = await fixture();
    const before = JSON.stringify(app.project);
    for (const lookOverride of [
      { ...retro, strength: NaN },
      { ...retro, version: 2 },
      { ...retro, preset: "unknown" },
    ]) {
      await expect(
        app.render("film", { lookOverride } as Parameters<
          OpenFilmApplication["render"]
        >[1]),
      ).rejects.toThrow();
    }
    expect(app.catalog.listJobs()).toHaveLength(0);
    expect(JSON.stringify(app.project)).toBe(before);
  });
});
