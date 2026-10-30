import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import type { Composition, MediaAsset, Story } from "@openfilm/core";
import { startServer } from "../../apps/server/src/server.js";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import { api } from "../../apps/desktop/src/api";

interface EditorState {
  composition: Composition;
  story: Story;
  assets: MediaAsset[];
  revision: string;
  acknowledgedRevision?: string;
  canUndo: boolean;
  canRedo: boolean;
}

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function openEditor(sourceLocked = false) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-editor-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await generateSampleMedia(root);
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(directory, "An editable film");
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  for (const [id, name, mediaType] of [
    ["photo-asset", "01-photo.png", "image"],
    ["motion-asset", "04-motion.mp4", "video"],
  ] as const) {
    app.catalog.upsertAsset({
      id,
      name,
      uri: pathToFileURL(join(root, name)).href,
      mediaType,
      ...(mediaType === "video" ? { duration: 3 } : {}),
      tags: [],
      state: { locked: sourceLocked },
      metadata: {},
    });
  }
  app.project.stories.push({
    id: "story",
    title: "A memory",
    targetDuration: 7,
    maxDuration: 10,
    beats: [
      {
        id: "beat",
        title: "The beginning",
        selectedAssetIds: ["photo-asset", "motion-asset"],
        candidateAssetIds: ["photo-asset", "motion-asset"],
      },
    ],
  });
  app.project.timelines.push({
    id: "composition",
    storyId: "story",
    duration: 7,
    tracks: [
      {
        id: "visuals",
        type: "video",
        clips: [
          {
            id: "photo",
            assetId: "photo-asset",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 4,
          },
          {
            id: "motion",
            assetId: "motion-asset",
            beatId: "beat",
            timelineStart: 4,
            timelineDuration: 3,
            sourceIn: 0,
            sourceOut: 3,
          },
        ],
      },
    ],
  });
  app.close();
  const runtime = await startServer({ port: 0, project: directory });
  cleanup.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}`;
  const post = (path: string, data: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const state = async (): Promise<EditorState> => {
    const response = await fetch(`${base}/api/compositions/composition/editor`);
    expect(response.status).toBe(200);
    return response.json();
  };
  return { root, directory, base, post, state };
}

describe("real timeline HTTP editing", () => {
  it("keeps source-locked primary clip edits available while split, presentation, replacement and pin release remain protected", async () => {
    const { root, directory, post, state } = await openEditor(true);
    const before = await state();
    const sources = await Promise.all(
      ["01-photo.png", "04-motion.mp4"].map((name) =>
        readFile(join(root, name)),
      ),
    );
    const input = {
      baseRevision: before.revision,
      requestId: "source-locked-primary-gesture",
      commands: [
        { type: "duration", clipId: "photo", duration: 3 },
        { type: "transform", clipId: "photo", rotation: 7 },
        {
          type: "transition",
          clipId: "photo",
          transition: "crossfade",
          duration: 0.25,
        },
        { type: "trim", clipId: "motion", sourceIn: 0.25, sourceOut: 2.75 },
        { type: "speed", clipId: "motion", speed: 1.25 },
        { type: "volume", clipId: "motion", volume: 0.75 },
      ],
    };
    const response = await post("/api/compositions/composition/edit", input);
    expect(response.status).toBe(200);
    const after = (await response.json()) as EditorState;
    expect(after.composition.duration).toBe(5);
    expect(after.composition.tracks[0]!.clips).toMatchObject([
      {
        id: "photo",
        assetId: "photo-asset",
        timelineDuration: 3,
        transform: { rotation: 7 },
        transition: { type: "crossfade", duration: 0.25 },
        userOverrides: { isUserPinned: true },
      },
      {
        id: "motion",
        assetId: "motion-asset",
        timelineStart: 3,
        timelineDuration: 2,
        sourceIn: 0.25,
        sourceOut: 2.75,
        transform: { speed: 1.25, volume: 0.75 },
        userOverrides: { isUserPinned: true },
      },
    ]);
    expect(after.assets).toEqual(before.assets);
    const replay = await post("/api/compositions/composition/edit", input);
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as EditorState).acknowledgedRevision).toBe(
      after.revision,
    );
    const current = await state();
    const disk = await readFile(join(directory, "project.json"));
    for (const command of [
      { type: "clip.split", clipId: "motion", sourceTime: 1 },
      { type: "presentation", clipId: "photo", title: "Protected source" },
      { type: "presentation", clipId: "photo", motion: null },
      {
        type: "presentation",
        clipId: "photo",
        layout: { version: 1, preset: "cover" },
      },
      { type: "replace", clipId: "photo", assetId: "motion-asset" },
      { type: "delete", clipId: "photo" },
      {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "photo" },
        pinned: false,
      },
      {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "motion" },
        pinned: true,
      },
      {
        type: "user-pin.resolve",
        targets: [{ kind: "clip", clipId: "photo" }],
        scope: { kind: "beat", beatId: "beat" },
        mode: "regenerate",
      },
    ]) {
      const rejected = await post("/api/compositions/composition/edit", {
        baseRevision: current.revision,
        commands: [command],
      });
      expect(rejected.status).toBe(400);
      expect(await state()).toEqual(current);
      expect(await readFile(join(directory, "project.json"))).toEqual(disk);
    }
    const undone = await post("/api/compositions/composition/undo", {
      baseRevision: current.revision,
    });
    expect(undone.status).toBe(200);
    const restored = (await undone.json()) as EditorState;
    expect(restored.composition).toEqual(before.composition);
    expect(restored.canUndo).toBe(false);
    expect(restored.assets).toEqual(before.assets);
    expect(
      await Promise.all(
        ["01-photo.png", "04-motion.mp4"].map((name) =>
          readFile(join(root, name)),
        ),
      ),
    ).toEqual(sources);
  });

  it("forwards edit cancellation and acknowledges a professional batch once without duplicating Undo", async () => {
    const { base, post, state } = await openEditor();
    const initial = await state();
    const nativeFetch = globalThis.fetch;
    const requests = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, options) =>
        nativeFetch(new URL(String(input), base), options),
      );
    const aborted = new AbortController();
    aborted.abort();
    const input = {
      baseRevision: initial.revision,
      requestId: "professional-http-gesture",
      commands: [
        { type: "duration" as const, clipId: "photo", duration: 6 },
        { type: "transform" as const, clipId: "photo", x: 0.4 },
      ],
    };
    await expect(
      api.edit("composition", input, aborted.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect((await state()).revision).toBe(initial.revision);
    const controller = new AbortController();
    const accepted = await api.edit("composition", input, controller.signal);
    expect(
      requests.mock.calls.some(
        ([, options]) => options?.signal === controller.signal,
      ),
    ).toBe(true);
    const receipt = await api.edit("composition", input);
    expect(receipt.acknowledgedRevision).toBe(accepted.revision);
    expect(receipt.composition.duration).toBe(9);
    expect(receipt.composition.tracks[0]?.clips[0]?.transform?.x).toBe(0.4);
    const undoneResponse = await post("/api/compositions/composition/undo", {
      baseRevision: receipt.revision,
    });
    expect(undoneResponse.status).toBe(200);
    const undone = (await undoneResponse.json()) as EditorState;
    expect(undone.composition).toEqual(initial.composition);
    expect(undone.canUndo).toBe(false);
  });

  it("rejects client mutation origin, clock and pin payload bypasses", async () => {
    const { post, state } = await openEditor();
    const before = await state();
    for (const payload of [
      {
        origin: "restore",
        commands: [{ type: "transform", clipId: "photo", x: 0.2 }],
      },
      {
        timebase: {
          version: 1,
          rateNumerator: 1,
          rateDenominator: 1,
          dropFrame: false,
        },
        commands: [{ type: "duration", clipId: "photo", duration: 2 }],
      },
      {
        commands: [
          {
            type: "user-pin.set",
            target: { kind: "clip", clipId: "photo" },
            pinned: true,
            userOverrides: { version: 1 },
          },
        ],
      },
    ]) {
      const response = await post("/api/compositions/composition/edit", {
        baseRevision: before.revision,
        ...payload,
      });
      expect(response.status).toBe(400);
    }
    expect((await state()).revision).toBe(before.revision);
  });

  it("persists a command batch once, rejects stale writes, and reopens undo/redo results", async () => {
    const { directory, base, post, state } = await openEditor();
    const initial = await state();
    expect(initial.canUndo).toBe(false);
    const input = {
      baseRevision: initial.revision,
      requestId: "one-user-edit",
      commands: [
        { type: "duration", clipId: "photo", duration: 5 },
        { type: "trim", clipId: "motion", sourceIn: 0.5, sourceOut: 2.5 },
        { type: "speed", clipId: "motion", speed: 2 },
        { type: "volume", clipId: "motion", volume: 0.35 },
        { type: "reorder", clipId: "photo", toIndex: 1 },
        {
          type: "transition",
          clipId: "photo",
          transition: "crossfade",
          duration: 0.25,
        },
        { type: "lock", clipId: "photo", locked: true },
      ],
    };
    const editedResponse = await post(
      "/api/compositions/composition/edit",
      input,
    );
    expect(editedResponse.status).toBe(200);
    const edited = (await editedResponse.json()) as EditorState;
    expect(edited.revision).not.toBe(initial.revision);
    expect(edited.composition.duration).toBe(6);
    expect(edited.composition.tracks[0]!.clips.map((clip) => clip.id)).toEqual([
      "motion",
      "photo",
    ]);
    expect(edited.composition.tracks[0]!.clips[0]).toMatchObject({
      sourceIn: 0.5,
      sourceOut: 2.5,
      timelineStart: 0,
      timelineDuration: 1,
      transform: { speed: 2, volume: 0.35 },
    });
    expect(edited.composition.tracks[0]!.clips[1]).toMatchObject({
      timelineStart: 1,
      timelineDuration: 5,
      locked: true,
      transition: { type: "crossfade", duration: 0.25 },
    });
    const disk = JSON.parse(
      await readFile(join(directory, "project.json"), "utf8"),
    );
    expect(disk.timelines[0]).toEqual(edited.composition);

    const duplicate = await post("/api/compositions/composition/edit", input);
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json()).revision).toBe(edited.revision);
    const stale = await post("/api/compositions/composition/edit", {
      baseRevision: initial.revision,
      commands: [{ type: "volume", clipId: "motion", volume: 0.9 }],
    });
    expect(stale.status).toBe(409);
    expect((await state()).composition).toEqual(edited.composition);

    const undoneResponse = await post("/api/compositions/composition/undo", {
      baseRevision: edited.revision,
    });
    expect(undoneResponse.status).toBe(200);
    const undone = (await undoneResponse.json()) as EditorState;
    expect(undone.composition).toEqual(initial.composition);
    expect(undone.canUndo).toBe(false);
    expect(undone.canRedo).toBe(true);
    const redoneResponse = await post("/api/compositions/composition/redo", {
      baseRevision: undone.revision,
    });
    expect(redoneResponse.status).toBe(200);
    expect((await redoneResponse.json()).composition).toEqual(
      edited.composition,
    );
    expect((await post("/api/project/open", { path: directory })).status).toBe(
      200,
    );
    const reopened = await state();
    expect(reopened.composition).toEqual(edited.composition);
    expect(reopened.canUndo).toBe(false);
    expect(reopened.canRedo).toBe(false);
    expect((await post("/api/project/close", {})).status).toBe(200);
    expect(await (await fetch(`${base}/api/project`)).json()).toEqual({
      project: null,
      path: null,
    });
    expect((await post("/api/project/open", { path: directory })).status).toBe(
      200,
    );
    expect((await state()).composition).toEqual(edited.composition);
  });

  it("rolls back a whole invalid batch and rejects malformed JSON commands", async () => {
    const { directory, post, state } = await openEditor();
    const initial = await state();
    const before = await readFile(join(directory, "project.json"));
    for (const commands of [
      [
        { type: "duration", clipId: "photo", duration: 9 },
        { type: "trim", clipId: "motion", sourceIn: 0, sourceOut: 99 },
      ],
      [{ type: "speed", clipId: "motion", speed: "2" }],
      [{ type: "volume", clipId: "motion", volume: 2 }],
      [{ type: "lock", clipId: "photo", locked: "false" }],
      [{ type: "surprise", clipId: "photo" }],
    ]) {
      const result = await post("/api/compositions/composition/edit", {
        baseRevision: initial.revision,
        commands,
      });
      expect(result.status).toBe(400);
      const current = await state();
      expect(current.composition).toEqual(initial.composition);
      expect(current.revision).toBe(initial.revision);
      expect(current.canUndo).toBe(false);
      expect(await readFile(join(directory, "project.json"))).toEqual(before);
    }
  });

  it("streams actual source bytes with range support and rejects cross-site source access", async () => {
    const { root, base } = await openEditor();
    const source = await readFile(join(root, "04-motion.mp4"));
    const ranged = await fetch(`${base}/api/source/motion-asset`, {
      headers: { Range: "bytes=8-127" },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-type")).toMatch(/^video\/mp4/);
    expect(ranged.headers.get("content-range")).toBe(
      `bytes 8-127/${source.length}`,
    );
    expect(Buffer.from(await ranged.arrayBuffer())).toEqual(
      source.subarray(8, 128),
    );
    expect(
      (
        await fetch(`${base}/api/source/motion-asset`, {
          headers: { Range: `bytes=${source.length + 1}-` },
        })
      ).status,
    ).toBe(416);
    expect(
      (
        await fetch(`${base}/api/source/motion-asset`, {
          headers: { Origin: "https://example.com" },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${base}/api/source/missing-asset`)).status).toBe(404);
    expect(await readFile(join(root, "04-motion.mp4"))).toEqual(source);
  });
});
