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
import type { MediaAsset } from "@openfilm/core";
import * as render from "@openfilm/render";
import {
  createConversationCard,
  createPhotoRelationship,
  createRouteStory,
} from "@openfilm/story";
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

  it("persists template provenance with its GraphicScene through undo, redo and reopen", async () => {
    const { app, editor } = await fixture();
    const initial = editor.get("composition");
    const { scene, record } = createConversationCard({
      sceneId: "conversation-card",
      duration: 6,
      frame: { width: 320, height: 180 },
      locale: "zh-TW",
      messages: [
        {
          id: "message-1",
          speaker: "合成說話者",
          text: "合成繁中訊息",
          start: 0.5,
          end: 5.5,
        },
      ],
    });
    const saved = await editor.edit("composition", {
      baseRevision: initial.revision,
      commands: [
        { type: "graphic.scene.upsert", scene, templateRecord: record },
      ],
    });
    expect(saved.composition.graphicSceneTemplates).toEqual([record]);
    const undo = await editor.undo("composition", saved.revision);
    expect(undo.composition.graphicScenes).toBeUndefined();
    expect(undo.composition.graphicSceneTemplates).toBeUndefined();
    const redo = await editor.redo("composition", undo.revision);
    expect(redo.composition.graphicSceneTemplates).toEqual([record]);
    const path = app.directory;
    app.close();
    apps.delete(app);
    const reopened = await OpenFilmApplication.open(path);
    apps.add(reopened);
    expect(
      new TimelineEditor(reopened).get("composition").composition
        .graphicSceneTemplates,
    ).toEqual([record]);
  });

  it("admits explicitly selected catalog photos outside the story candidate pool", async () => {
    const { app, editor } = await fixture();
    app.catalog.upsertAsset({
      id: "catalog-photo",
      uri: "file:///synthetic/catalog-photo.png",
      name: "Synthetic catalog photo",
      mediaType: "image",
      tags: [],
      state: {},
      metadata: {},
    });
    const before = editor.get("composition");
    expect(before.assets.some((asset) => asset.id === "catalog-photo")).toBe(
      false,
    );
    const { scene, record } = createPhotoRelationship({
      sceneId: "selected-catalog-photo",
      duration: 6,
      frame: { width: 320, height: 180 },
      locale: "en-US",
      relationship: "focus-reveal",
      photos: [{ assetId: "catalog-photo", focalPoint: { x: 0.5, y: 0.5 } }],
    });
    const saved = await editor.edit("composition", {
      baseRevision: before.revision,
      commands: [
        { type: "graphic.scene.upsert", scene, templateRecord: record },
      ],
    });
    expect(saved.composition.graphicSceneTemplates).toEqual([record]);
    expect(saved.assets.some((asset) => asset.id === "catalog-photo")).toBe(
      true,
    );
  });

  it("renders a synthetic 24-second three-template MP4 with verifiable timing and source hashes", async () => {
    const { app, editor } = await fixture();
    const sourcePath = join(app.directory, "synthetic-story.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x202020:s=320x180:r=12:d=24",
      "-t",
      "24",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "1",
      "-y",
      sourcePath,
    ]);
    const source = await inspectMedia({
      path: sourcePath,
      uri: pathToFileURL(sourcePath).href,
      name: "Synthetic background",
    });
    app.catalog.upsertAsset(source);
    app.project.settings = { width: 320, height: 180, frameRate: 12 };
    app.project.stories[0]!.beats[0]!.candidateAssetIds = [source.id];
    app.project.stories[0]!.beats[0]!.selectedAssetIds = [source.id];
    app.project.timelines[0]!.duration = 24;
    app.project.timelines[0]!.tracks[0]!.clips[0] = {
      id: "synthetic-24s",
      assetId: source.id,
      beatId: "beat",
      timelineStart: 0,
      timelineDuration: 24,
      sourceIn: 0,
      sourceOut: 24,
    };
    const photoAssets: MediaAsset[] = [];
    const photoHashes = new Map<string, string>();
    for (const [id, color] of [
      ["photo-red", "red"],
      ["photo-blue", "blue"],
    ] as const) {
      const path = join(app.directory, `${id}.png`);
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=64x64`,
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-y",
        path,
      ]);
      const photo = await inspectMedia({
        path,
        uri: pathToFileURL(path).href,
        name: `${id}.png`,
      });
      app.catalog.upsertAsset(photo);
      photoAssets.push(photo);
      photoHashes.set(photo.id, await hashFile(path));
    }
    app.project.stories[0]!.beats[0]!.candidateAssetIds = [
      source.id,
      ...photoAssets.map((photo) => photo.id),
    ];
    app.project.stories[0]!.beats[0]!.selectedAssetIds = [source.id];
    await app.save();
    const frame = { width: 320, height: 180 };
    const built = [
      createConversationCard({
        sceneId: "synthetic-conversation",
        start: 0,
        duration: 8,
        frame,
        locale: "zh-TW",
        messages: [
          ...Array.from({ length: 4 }, (_, index) => ({
            id: `msg-${index + 1}`,
            speaker: `合成說話者${index + 1}`,
            text: "長文字".repeat(12),
            start: 0.5,
            end: 7.5,
          })),
        ],
      }),
      createRouteStory({
        sceneId: "synthetic-route",
        start: 8,
        duration: 8,
        frame,
        locale: "zh-TW",
        route: {
          kind: "manual",
          points: [
            { latitude: 25, longitude: 121 },
            { latitude: 25.1, longitude: 121.1 },
          ],
          waypoints: [
            { label: "虛構站點", latitude: 25.05, longitude: 121.05 },
          ],
        },
      }),
      createPhotoRelationship({
        sceneId: "synthetic-photos",
        start: 16,
        duration: 8,
        frame,
        locale: "zh-TW",
        relationship: "compare",
        photos: photoAssets.map((photo) => ({
          assetId: photo.id,
          contentHash: photo.contentHash,
          focalPoint: { x: 0.5, y: 0.5 },
        })),
      }),
    ];
    let revision = editor.get("composition").revision;
    for (const item of built) {
      const result = await editor.edit("composition", {
        baseRevision: revision,
        commands: [
          {
            type: "graphic.scene.upsert",
            scene: item.scene,
            templateRecord: item.record,
          },
        ],
      });
      revision = result.revision;
    }
    const output = await app.exportMp4("composition", { quality: "standard" });
    const probe = await runProcess("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,nb_frames,avg_frame_rate",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      output.path,
    ]);
    const info = JSON.parse(probe.stdout.toString("utf8")) as {
      streams: {
        codec_name: string;
        width: number;
        height: number;
        nb_frames: string;
        avg_frame_rate: string;
      }[];
      format: { duration: string };
    };
    expect(info.streams[0]).toMatchObject({
      codec_name: "h264",
      width: 320,
      height: 180,
      nb_frames: "288",
      avg_frame_rate: "12/1",
    });
    expect(Number(info.format.duration)).toBeCloseTo(24, 1);
    const frameAt = async (seconds: number) =>
      runProcess("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(seconds),
        "-i",
        output.path,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]).then((result) => result.stdout);
    const samples = new Map<number, Buffer>();
    for (const seconds of [17.5, 1.5, 8.5, 17.5]) {
      const decoded = await frameAt(seconds);
      expect(decoded).toHaveLength(320 * 180 * 3);
      const prior = samples.get(seconds);
      if (prior) expect(decoded).toEqual(prior);
      else samples.set(seconds, decoded);
    }
    const pixel = (bytes: Buffer, x: number, y: number) => [
      ...bytes.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3),
    ];
    const dialogue = samples.get(1.5)!;
    expect(pixel(dialogue, 42, 42)).not.toEqual([32, 32, 32]);
    const routeFrame = samples.get(8.5)!;
    let routePixels = 0;
    for (let offset = 0; offset < routeFrame.length; offset += 3)
      if (
        routeFrame[offset + 1]! > routeFrame[offset]! + 45 &&
        routeFrame[offset + 1]! > 150 &&
        routeFrame[offset + 2]! > 140
      )
        routePixels++;
    expect(routePixels).toBeGreaterThan(100);
    const photoFrame = samples.get(17.5)!;
    expect(pixel(photoFrame, 80, 90)[0]).toBeGreaterThan(180);
    expect(pixel(photoFrame, 240, 90)[2]).toBeGreaterThan(180);
    const manifest = JSON.parse(
      await readFile(`${output.path}.manifest.json`, "utf8"),
    ) as {
      composition: { graphicSceneTemplates: unknown[] };
      sources: { assetId: string; sha256: string }[];
      warnings: string[];
    };
    expect(manifest.composition.graphicSceneTemplates).toEqual(
      built.map((item) => item.record),
    );
    expect(
      manifest.sources.find((item) => item.assetId === photoAssets[0]!.id)
        ?.sha256,
    ).toBe(photoHashes.get(photoAssets[0]!.id));
    expect(
      manifest.sources.find((item) => item.assetId === photoAssets[1]!.id)
        ?.sha256,
    ).toBe(photoHashes.get(photoAssets[1]!.id));
    expect(output.report.warnings).toEqual(manifest.warnings);
  }, 120_000);

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

  it("fits long Latin and Traditional Chinese card text to the actual title renderer", async () => {
    const samples = ["W".repeat(512), "繁體中文長訊息".repeat(64)];
    const outputDirectory = await mkdtemp(
      join(tmpdir(), "openfilm-long-text-fit-"),
    );
    roots.push(outputDirectory);
    for (const [sampleIndex, text] of samples.entries()) {
      const { scene } = createConversationCard({
        sceneId: `long-fit-${sampleIndex}`,
        duration: 8,
        frame: { width: 1920, height: 1080 },
        messages: Array.from({ length: 4 }, (_, index) => ({
          id: `message-${index + 1}`,
          speaker: `合成說話者 ${index + 1}`,
          text,
          start: 0,
          end: 8,
        })),
      });
      const nodes = scene.nodes.filter(
        (node) => node.type === "text" && node.id.endsWith(".text"),
      );
      expect(nodes).toHaveLength(4);
      for (const node of nodes) {
        if (node.type !== "text") continue;
        const width = Math.ceil(node.width);
        const height = Math.ceil(node.height);
        const overlay = await render.createTitleOverlay(
          node.text,
          {
            version: 1,
            role: "scene-statement",
            fontSize: node.fontSize,
            fontFamily: node.fontFamily,
            fontWeight: node.fontWeight,
            background: "none",
            position: "center",
            maxWidth: node.width,
            safeArea: { left: 0, right: 0, top: 0, bottom: 0 },
          },
          { width, height },
          join(outputDirectory, `${sampleIndex}-${node.id}.png`),
        );
        expect(
          overlay.layout.bounds.x + overlay.layout.bounds.width,
          `${text.slice(0, 8)} at ${node.fontSize}px`,
        ).toBeLessThanOrEqual(width);
        expect(
          overlay.layout.bounds.y + overlay.layout.bounds.height,
        ).toBeLessThanOrEqual(height);
        expect(
          (await readFile(overlay.path)).subarray(0, 8).toString("hex"),
        ).toBe("89504e470d0a1a0a");
      }
    }
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
