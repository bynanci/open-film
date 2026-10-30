// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication } from "../src/index.js";
import { TimelineEditor } from "../src/editor.js";
import { PRIMARY_COLOR_IDENTITY } from "@openfilm/core";
const roots: string[] = [];
const apps: OpenFilmApplication[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) app.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("saves one history step, retries exactly, and reopens authored primary without source mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "primary-color-"));
  roots.push(root);
  const source = join(root, "source.png");
  await writeFile(source, "immutable source");
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(directory, "Color");
  apps.push(app);
  app.catalog.upsertAsset({
    id: "a",
    uri: pathToFileURL(source).href,
    name: "source",
    mediaType: "image",
    dimensions: { width: 96, height: 64 },
    tags: [],
    state: {},
    metadata: {},
  });
  app.project.stories.push({
    id: "s",
    title: "Film",
    beats: [{ id: "b", title: "Scene" }],
  });
  app.project.timelines.push({
    id: "f",
    storyId: "s",
    duration: 1,
    tracks: [
      {
        id: "v",
        type: "video",
        clips: [
          {
            id: "c",
            assetId: "a",
            beatId: "b",
            timelineStart: 0,
            timelineDuration: 1,
          },
        ],
      },
    ],
  });
  await app.save();
  const editor = new TimelineEditor(app);
  const before = editor.get("f");
  const correction = { ...PRIMARY_COLOR_IDENTITY, temperature: 0.4 };
  const input = {
    baseRevision: before.revision,
    requestId: "primary-once",
    commands: [
      { type: "primary-color" as const, scope: "film" as const, correction },
    ],
  };
  const saved = await editor.edit("f", input);
  expect(saved.composition.defaultPrimaryColor).toEqual(correction);
  expect(saved.canUndo).toBe(true);
  expect((await editor.edit("f", input)).acknowledgedRevision).toBe(
    saved.revision,
  );
  await expect(
    editor.edit("f", {
      ...input,
      commands: [{ ...input.commands[0]!, correction: PRIMARY_COLOR_IDENTITY }],
    }),
  ).rejects.toThrow(/requestId/);
  const undone = await editor.undo("f", saved.revision);
  expect(undone.composition).toEqual(before.composition);
  const redone = await editor.redo("f", undone.revision);
  expect(redone.composition.defaultPrimaryColor).toEqual(correction);
  await expect(
    editor.edit("f", {
      baseRevision: before.revision,
      commands: input.commands,
    }),
  ).rejects.toThrow(/changed/);
  const bytes = await readFile(join(directory, "project.json"));
  await expect(
    editor.edit("f", {
      baseRevision: redone.revision,
      commands: [
        { ...input.commands[0]!, correction: PRIMARY_COLOR_IDENTITY },
        { type: "primary-color", scope: "clip", clipId: "missing", correction },
      ],
    }),
  ).rejects.toThrow();
  expect(await readFile(join(directory, "project.json"))).toEqual(bytes);
  app.close();
  apps.splice(apps.indexOf(app), 1);
  const reopened = await OpenFilmApplication.open(directory);
  apps.push(reopened);
  expect(
    new TimelineEditor(reopened).get("f").composition.defaultPrimaryColor,
  ).toEqual(correction);
  expect(await readFile(source, "utf8")).toBe("immutable source");
});
