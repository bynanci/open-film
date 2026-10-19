import {
  mkdtemp,
  readFile,
  rm,
  readdir,
  mkdir,
  symlink,
} from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runProcess, inspectMedia, hashFile } from "@openfilm/media";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as render from "@openfilm/render";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import { graphicScene } from "../../../tests/fixtures/graphic-scene.js";

const apps = new Set<OpenFilmApplication>();
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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

  it("returns exact-frame PNGs and refuses stale/project-mismatched preview requests", async () => {
    const { app, editor } = await fixture();
    app.project.settings = { width: 320, height: 180, frameRate: 30 };
    const initial = editor.get("composition");
    const state = await editor.edit("composition", {
      baseRevision: initial.revision,
      commands: [{ type: "graphic.scene.upsert", scene: graphicScene() }],
    });
    const input = {
      projectId: app.project.id,
      baseRevision: state.revision,
      frameIndex: 90,
    };
    const png = await app.graphics.frame("composition", input);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    await app.graphics.frame("composition", { ...input, frameIndex: 0 });
    expect(await app.graphics.frame("composition", input)).toEqual(png);
    await expect(
      app.graphics.frame("composition", { ...input, projectId: "other" }),
    ).rejects.toMatchObject({ code: "graphics.stale" });
    await expect(
      app.graphics.frame("composition", { ...input, baseRevision: "old" }),
    ).rejects.toMatchObject({ code: "graphics.stale" });
    await expect(
      app.graphics.frame("composition", { ...input, frameIndex: 180 }),
    ).rejects.toMatchObject({ code: "graphics.invalid" });
  });

  it("withholds a frame when the revision changes during raster preparation", async () => {
    const { app, editor } = await fixture();
    app.project.settings = { width: 320, height: 180, frameRate: 30 };
    const initial = editor.get("composition");
    const state = await editor.edit("composition", {
      baseRevision: initial.revision,
      commands: [{ type: "graphic.scene.upsert", scene: graphicScene() }],
    });
    const actual = render.prepareGraphicScenes;
    vi.spyOn(render, "prepareGraphicScenes").mockImplementation(
      async (...args) => {
        const prepared = await actual(...args);
        app.project.timelines[0]!.graphicScenes![0]!.nodes[0]!.x = 42;
        return prepared;
      },
    );
    await expect(
      app.graphics.frame("composition", {
        projectId: app.project.id,
        baseRevision: state.revision,
        frameIndex: 0,
      }),
    ).rejects.toMatchObject({ code: "graphics.stale" });
    expect(await readdir(join(app.directory, "cache", "graphics"))).toEqual([]);
  });

  it("bounds concurrent work, honors cancellation and removes private textures", async () => {
    const { app, editor } = await fixture();
    const initial = editor.get("composition");
    const state = await editor.edit("composition", {
      baseRevision: initial.revision,
      commands: [{ type: "graphic.scene.upsert", scene: graphicScene() }],
    });
    const controller = new AbortController();
    const input = {
      projectId: app.project.id,
      baseRevision: state.revision,
      frameIndex: 0,
    };
    const pending = app.graphics.frame("composition", {
      ...input,
      signal: controller.signal,
    });
    await expect(
      app.graphics.frame("composition", input),
    ).rejects.toMatchObject({ code: "graphics.busy" });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const retried = await app.graphics.frame("composition", input);
    expect(retried.subarray(1, 4).toString()).toBe("PNG");
    expect(await readdir(join(app.directory, "cache", "graphics"))).toEqual([]);
  });

  it("withholds source changes during the final post-cleanup revision check", async () => {
    const { app, editor } = await fixture();
    const source = join(app.directory, "synthetic.png");
    const replacement = join(app.directory, "replacement.png");
    for (const [path, color] of [
      [source, "green"],
      [replacement, "red"],
    ])
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=32x24`,
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-y",
        path!,
      ]);
    const bytes = await readFile(replacement);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "synthetic.png",
    });
    app.catalog.upsertAsset(asset);
    app.project.stories[0]!.beats[0]!.candidateAssetIds!.push(asset.id);
    const initial = editor.get("composition");
    const scene = graphicScene({
      nodes: [
        {
          id: "image",
          type: "image",
          assetId: asset.id,
          x: 0,
          y: 0,
          width: 40,
          height: 30,
          opacity: 1,
          zIndex: 0,
          start: 0,
          end: 6,
        },
      ],
    });
    const state = await editor.edit("composition", {
      baseRevision: initial.revision,
      commands: [{ type: "graphic.scene.upsert", scene }],
    });
    const runtime = app.graphics as unknown as { revision(id: string): string };
    const actual = runtime.revision.bind(runtime);
    let calls = 0;
    vi.spyOn(runtime, "revision").mockImplementation((id) => {
      const revision = actual(id);
      if (++calls === 3) writeFileSync(source, bytes);
      return revision;
    });
    await expect(
      app.graphics.frame("composition", {
        projectId: app.project.id,
        baseRevision: state.revision,
        frameIndex: 0,
      }),
    ).rejects.toMatchObject({ code: "graphics.unavailable" });
    expect(await hashFile(source)).not.toBe(asset.contentHash);
    expect(await readdir(join(app.directory, "cache", "graphics"))).toEqual([]);
  });

  it("refuses a symlinked private graphic cache", async () => {
    const { app, editor } = await fixture();
    const initial = editor.get("composition");
    const state = await editor.edit("composition", {
      baseRevision: initial.revision,
      commands: [{ type: "graphic.scene.upsert", scene: graphicScene() }],
    });
    const outside = await mkdtemp(join(tmpdir(), "openfilm-graphic-outside-"));
    roots.push(outside);
    await mkdir(join(app.directory, "cache"), { recursive: true });
    await symlink(outside, join(app.directory, "cache", "graphics"));
    await expect(
      app.graphics.frame("composition", {
        projectId: app.project.id,
        baseRevision: state.revision,
        frameIndex: 0,
      }),
    ).rejects.toThrow(/symlink|directory/i);
    expect(await readdir(outside)).toEqual([]);
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
