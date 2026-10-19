import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import { graphicScene } from "../../../tests/fixtures/graphic-scene.js";

const apps = new Set<OpenFilmApplication>();
const roots: string[] = [];
afterEach(async () => {
  for (const app of apps) app.close();
  apps.clear();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-graphic-history-"));
  roots.push(root);
  const app = await OpenFilmApplication.create(
    join(root, "synthetic.openfilm"),
    "Synthetic graphic film",
  );
  apps.add(app);
  app.catalog.upsertAsset({
    id: "source",
    uri: "file:///synthetic/source.mp4",
    name: "Synthetic source",
    mediaType: "video",
    duration: 12,
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
        title: "Scene",
        candidateAssetIds: ["source"],
        selectedAssetIds: ["source"],
      },
    ],
  });
  app.project.timelines.push({
    id: "composition",
    storyId: "story",
    duration: 6,
    tracks: [
      {
        id: "video",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "source",
            beatId: "beat",
            sourceIn: 0,
            sourceOut: 6,
            timelineStart: 0,
            timelineDuration: 6,
          },
        ],
      },
    ],
  });
  await app.save();
  return { app, editor: new TimelineEditor(app) };
}

describe("durable GraphicScene editing", () => {
  it("saves stable scene/node IDs through update, Undo/Redo, retry and reopen", async () => {
    const { app, editor } = await fixture();
    const before = editor.get("composition");
    const scene = graphicScene();
    const input = {
      baseRevision: before.revision,
      requestId: "add-graphic-scene",
      commands: [{ type: "graphic.scene.upsert" as const, scene }],
    };
    const added = await editor.edit("composition", input);
    expect(added.composition.graphicScenes).toEqual([scene]);
    expect((await editor.edit("composition", input)).revision).toBe(
      added.revision,
    );
    const undo = await editor.undo("composition", added.revision);
    expect(undo.composition.graphicScenes).toBeUndefined();
    const redo = await editor.redo("composition", undo.revision);
    expect(redo.composition.graphicScenes).toEqual([scene]);
    scene.nodes[0]!.x = 42;
    const updated = await editor.edit("composition", {
      baseRevision: redo.revision,
      commands: [{ type: "graphic.scene.upsert", scene }],
    });
    expect(updated.composition.graphicScenes?.[0]?.nodes[0]).toMatchObject({
      id: "rectangle",
      x: 42,
    });
    const path = app.directory;
    app.close();
    apps.delete(app);
    const reopened = await OpenFilmApplication.open(path);
    apps.add(reopened);
    expect(
      new TimelineEditor(reopened).get("composition").composition.graphicScenes,
    ).toEqual([scene]);
  });

  it("rejects unsafe/stale edits and shortening without changing project bytes or revision", async () => {
    const { app, editor } = await fixture();
    const initial = editor.get("composition");
    const saved = await editor.edit("composition", {
      baseRevision: initial.revision,
      commands: [{ type: "graphic.scene.upsert", scene: graphicScene() }],
    });
    const bytes = await readFile(join(app.directory, "project.json"));
    await expect(
      editor.edit("composition", {
        baseRevision: initial.revision,
        commands: [{ type: "graphic.scene.remove", sceneId: "graphic-scene" }],
      }),
    ).rejects.toThrow(/changed|revision|conflict/i);
    await expect(
      editor.edit("composition", {
        baseRevision: saved.revision,
        commands: [
          {
            type: "graphic.scene.upsert",
            scene: { ...graphicScene(), js: "throw 1" },
          },
        ],
      } as never),
    ).rejects.toThrow();
    await expect(
      editor.edit("composition", {
        baseRevision: saved.revision,
        commands: [{ type: "trim", clipId: "clip", sourceIn: 0, sourceOut: 3 }],
      }),
    ).rejects.toMatchObject({ code: "timeline.graphicRangeConflict" });
    expect(await readFile(join(app.directory, "project.json"))).toEqual(bytes);
    expect(editor.get("composition").revision).toBe(saved.revision);
  });
});
