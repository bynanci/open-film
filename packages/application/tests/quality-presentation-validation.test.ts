import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_TITLE_LENGTH, resolvePhotoPlan } from "@openfilm/core";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";

const applications = new Set<OpenFilmApplication>();
const directories: string[] = [];
afterEach(async () => {
  for (const app of applications) app.close();
  applications.clear();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(
    join(tmpdir(), "openfilm-presentation-validation-"),
  );
  directories.push(directory);
  const app = await OpenFilmApplication.create(
    join(directory, "film.openfilm"),
    "Presentation validation",
  );
  applications.add(app);
  app.project.settings.width = 640;
  app.project.settings.height = 360;
  for (const id of ["photo", "other-photo"])
    app.catalog.upsertAsset({
      id,
      name: id,
      uri: `file:///originals/${id}.jpg`,
      mediaType: "image",
      dimensions: { width: 640, height: 360 },
      tags: [],
      state: {},
      metadata: {},
    });
  app.project.stories.push({
    id: "story",
    title: "Our story",
    beats: [{ id: "beat", title: "Together", candidateAssetIds: ["photo"] }],
  });
  app.project.timelines.push({
    id: "film",
    storyId: "story",
    duration: 8,
    tracks: [
      {
        id: "visual",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "photo",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 8,
            sourceIn: 0,
            sourceOut: 8,
          },
        ],
      },
    ],
  });
  await app.save();
  return { app, editor: new TimelineEditor(app) };
}

async function stateWithRedo(editor: TimelineEditor) {
  const state = await editor.edit("film", {
    baseRevision: editor.get("film").revision,
    commands: [{ type: "volume", clipId: "clip", volume: 0.3 }],
  });
  return editor.undo("film", state.revision);
}

describe("presentation validation before mutation", () => {
  it("rejects excessive title text at the request boundary before revision resolution", async () => {
    const { editor } = await fixture();
    await expect(
      editor.edit("film", {
        baseRevision: "stale-revision",
        commands: [
          {
            type: "presentation",
            clipId: "clip",
            title: "字".repeat(MAX_TITLE_LENGTH + 1),
          },
        ],
      }),
    ).rejects.toThrow(/8000/u);
  });
  it.each([MAX_TITLE_LENGTH + 1, 10_000])(
    "rejects a new %i-unit title without changing project, disk or history",
    async (length) => {
      const { app, editor } = await fixture();
      const before = await stateWithRedo(editor);
      const project = structuredClone(app.project);
      const disk = await readFile(join(app.directory, "project.json"), "utf8");
      await expect(
        editor.edit("film", {
          baseRevision: before.revision,
          commands: [
            {
              type: "presentation",
              clipId: "clip",
              title: "字".repeat(length),
            },
          ],
        }),
      ).rejects.toThrow(/8000/u);
      expect(editor.get("film")).toEqual(before);
      expect(app.project).toEqual(project);
      expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
        disk,
      );
      expect((await editor.redo("film", before.revision)).canUndo).toBe(true);
    },
  );

  it("accepts the shared title boundary and preserves undo/redo and reopen", async () => {
    const { app, editor } = await fixture();
    const before = editor.get("film");
    const saved = await editor.edit("film", {
      baseRevision: before.revision,
      commands: [
        {
          type: "presentation",
          clipId: "clip",
          title: "字".repeat(MAX_TITLE_LENGTH),
        },
      ],
    });
    expect(saved.composition.tracks[0]!.clips[0]!.title).toHaveLength(
      MAX_TITLE_LENGTH,
    );
    const undone = await editor.undo("film", saved.revision);
    expect(undone.composition).toEqual(before.composition);
    await editor.redo("film", undone.revision);
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    expect(
      new TimelineEditor(reopened).get("film").composition.tracks[0]!.clips[0]!
        .title,
    ).toHaveLength(MAX_TITLE_LENGTH);
  });

  it("keeps legacy long titles readable so users can shorten or remove them", async () => {
    const { app } = await fixture();
    app.project.timelines[0]!.tracks[0]!.clips[0]!.title = "字".repeat(
      MAX_TITLE_LENGTH + 1,
    );
    await app.save();
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    const editor = new TimelineEditor(reopened);
    const before = editor.get("film");
    expect(before.composition.tracks[0]!.clips[0]!.title).toHaveLength(
      MAX_TITLE_LENGTH + 1,
    );
    const saved = await editor.edit("film", {
      baseRevision: before.revision,
      commands: [{ type: "presentation", clipId: "clip", title: "Our story" }],
    });
    expect(saved.composition.tracks[0]!.clips[0]!.title).toBe("Our story");
  });

  it.each([640, 641, 1_000])(
    "rejects gap %i against the real frame without changing data or redo",
    async (gap) => {
      const { app, editor } = await fixture();
      const before = await stateWithRedo(editor);
      const project = structuredClone(app.project);
      const disk = await readFile(join(app.directory, "project.json"), "utf8");
      await expect(
        editor.edit("film", {
          baseRevision: before.revision,
          commands: [
            { type: "duration", clipId: "clip", duration: 4 },
            {
              type: "presentation",
              clipId: "clip",
              layout: {
                version: 1,
                preset: "diptych",
                gap,
                secondary: { assetId: "other-photo" },
              },
            },
          ],
        }),
      ).rejects.toThrow(/gap.*smaller.*width/iu);
      expect(editor.get("film")).toEqual(before);
      expect(app.project).toEqual(project);
      expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
        disk,
      );
      expect((await editor.redo("film", before.revision)).canUndo).toBe(true);
    },
  );

  it("rejects a first invalid gap without creating history or changing saved data", async () => {
    const { app, editor } = await fixture();
    const before = editor.get("film");
    const project = structuredClone(app.project);
    const disk = await readFile(join(app.directory, "project.json"), "utf8");
    await expect(
      editor.edit("film", {
        baseRevision: before.revision,
        commands: [
          {
            type: "presentation",
            clipId: "clip",
            layout: {
              version: 1,
              preset: "diptych",
              gap: 640,
              secondary: { assetId: "other-photo" },
            },
          },
        ],
      }),
    ).rejects.toThrow(/gap.*smaller.*width/iu);
    expect(editor.get("film")).toEqual(before);
    expect(editor.get("film").canUndo).toBe(false);
    expect(editor.get("film").canRedo).toBe(false);
    expect(app.project).toEqual(project);
    expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
      disk,
    );
  });

  it("accepts a normal gap and resolves the saved layout on the same frame", async () => {
    const { app, editor } = await fixture();
    const saved = await editor.edit("film", {
      baseRevision: editor.get("film").revision,
      commands: [
        {
          type: "presentation",
          clipId: "clip",
          layout: {
            version: 1,
            preset: "diptych",
            gap: 32,
            secondary: { assetId: "other-photo" },
          },
        },
      ],
    });
    const clip = saved.composition.tracks[0]!.clips[0]!;
    expect(() =>
      resolvePhotoPlan(
        clip,
        {
          photo: { width: 640, height: 360 },
          "other-photo": { width: 640, height: 360 },
        },
        app.project.settings,
      ),
    ).not.toThrow();
    expect(clip.layout?.gap).toBe(32);
  });

  it("validates the default diptych gap on narrow but otherwise valid project frames", async () => {
    const { app, editor } = await fixture();
    app.project.settings.width = 32;
    await app.save();
    const before = editor.get("film");
    await expect(
      editor.edit("film", {
        baseRevision: before.revision,
        commands: [
          {
            type: "presentation",
            clipId: "clip",
            layout: {
              version: 1,
              preset: "diptych",
              secondary: { assetId: "other-photo" },
            },
          },
        ],
      }),
    ).rejects.toThrow(/gap.*smaller.*width/iu);
    expect(editor.get("film")).toEqual(before);
  });
});
