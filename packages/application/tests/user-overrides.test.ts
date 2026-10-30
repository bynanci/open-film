import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OpenFilmApplication,
  TimelineEditor,
  promotePinnedProject,
} from "../src/index.js";
import { createProject, type MediaAsset } from "@openfilm/core";
const clean: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const action of clean.splice(0).reverse()) await action();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-pins-"));
  clean.push(() => rm(root, { recursive: true, force: true }));
  const app = await OpenFilmApplication.create(
    join(root, "project.openfilm"),
    "Pins",
  );
  clean.push(() => app.close());
  for (const id of ["a", "b", "c"])
    app.catalog.upsertAsset({
      id,
      name: id,
      uri: `file:///${id}.png`,
      mediaType: "image",
      state: {},
      tags: [],
      metadata: {},
    } satisfies MediaAsset);
  app.project.stories = [
    {
      id: "story",
      title: "Story",
      beats: [
        { id: "beat", title: "Beat", candidateAssetIds: ["a", "b", "c"] },
      ],
    },
  ];
  app.project.timelines = [
    {
      id: "cut",
      storyId: "story",
      duration: 6,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "a",
              assetId: "a",
              beatId: "beat",
              timelineStart: 0,
              timelineDuration: 3,
            },
            {
              id: "b",
              assetId: "b",
              beatId: "beat",
              timelineStart: 3,
              timelineDuration: 3,
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  return {
    app,
    editor: new TimelineEditor(app),
    file: join(app.directory, "project.json"),
  };
}
describe("transactional user pins", () => {
  it("promotion is detached and legacy defaults stay absent", () => {
    const legacy = createProject("Legacy");
    expect(promotePinnedProject(legacy)).toEqual(legacy);
    expect(promotePinnedProject(legacy)).not.toBe(legacy);
  });
  it("first direct edit promotes atomically and save/reopen retains pins", async () => {
    const { app, editor, file } = await fixture();
    const before = editor.get("cut");
    const after = await editor.edit("cut", {
      baseRevision: before.revision,
      commands: [{ type: "duration", clipId: "a", duration: 2 }],
    });
    expect(app.project.schemaVersion).toBe("1.1.0");
    expect(
      after.composition.tracks[0]!.clips[0]!.userOverrides?.isUserPinned,
    ).toBe(true);
    const disk = JSON.parse(await readFile(file, "utf8"));
    expect(disk.schemaVersion).toBe("1.1.0");
    expect(disk.timelines[0]).toEqual(after.composition);
    const reopen = await OpenFilmApplication.open(app.directory);
    clean.push(() => reopen.close());
    expect(new TimelineEditor(reopen).get("cut").composition).toEqual(
      after.composition,
    );
  });
  it("pin unpin undo redo are single history entries and never downgrade", async () => {
    const { app, editor } = await fixture();
    const before = editor.get("cut");
    const pinned = await editor.edit("cut", {
      baseRevision: before.revision,
      commands: [
        {
          type: "user-pin.set",
          target: { kind: "clip", clipId: "a" },
          pinned: true,
        },
      ],
    });
    const unpinned = await editor.edit("cut", {
      baseRevision: pinned.revision,
      commands: [
        {
          type: "user-pin.set",
          target: { kind: "clip", clipId: "a" },
          pinned: false,
        },
      ],
    });
    expect(
      unpinned.composition.tracks[0]!.clips[0]!.userOverrides?.isUserPinned,
    ).toBe(false);
    const undo = await editor.undo("cut", unpinned.revision);
    expect(undo.composition).toEqual(pinned.composition);
    const redo = await editor.redo("cut", undo.revision);
    expect(redo.composition).toEqual(unpinned.composition);
    expect(app.project.schemaVersion).toBe("1.1.0");
  });
  it("unlock and re-solve failure rolls back pin and disk and revision", async () => {
    const { app, editor, file } = await fixture();
    const s = editor.get("cut");
    const pinned = await editor.edit("cut", {
      baseRevision: s.revision,
      commands: [
        {
          type: "user-pin.set",
          target: { kind: "clip", clipId: "a" },
          pinned: true,
        },
      ],
    });
    app.project.stories[0]!.beats[0]!.minDuration = 20;
    await app.save();
    const current = editor.get("cut"),
      disk = await readFile(file, "utf8");
    await expect(
      editor.edit("cut", {
        baseRevision: current.revision,
        commands: [
          {
            type: "user-pin.resolve",
            targets: [{ kind: "clip", clipId: "a" }],
            scope: { kind: "composition" },
            mode: "regenerate",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "timeline.pinConflict" });
    expect(editor.get("cut").revision).toBe(current.revision);
    expect(await readFile(file, "utf8")).toBe(disk);
    expect(editor.get("cut").composition).toEqual(pinned.composition);
  });
  it("unlock and re-solve succeeds in one undo entry", async () => {
    const { editor } = await fixture();
    const before = editor.get("cut");
    const pinned = await editor.edit("cut", {
      baseRevision: before.revision,
      commands: [
        {
          type: "user-pin.set",
          target: { kind: "clip", clipId: "a" },
          pinned: true,
        },
      ],
    });
    const after = await editor.edit("cut", {
      baseRevision: pinned.revision,
      commands: [
        {
          type: "user-pin.resolve",
          targets: [{ kind: "clip", clipId: "a" }],
          scope: { kind: "composition" },
          mode: "regenerate",
        },
      ],
    });
    expect(after.canUndo).toBe(true);
    expect((await editor.undo("cut", after.revision)).composition).toEqual(
      pinned.composition,
    );
  });
  it("queued stale edit fails after preceding pin publication", async () => {
    const { editor } = await fixture();
    const current = editor.get("cut");
    const first = editor.edit("cut", {
      baseRevision: current.revision,
      commands: [{ type: "duration", clipId: "a", duration: 2 }],
    });
    const stale = editor.edit("cut", {
      baseRevision: current.revision,
      commands: [{ type: "duration", clipId: "b", duration: 2 }],
    });
    await first;
    await expect(stale).rejects.toMatchObject({ status: 409 });
  });
  it("client origin and timebase injection are rejected before mutation", async () => {
    const { editor } = await fixture();
    const current = editor.get("cut");
    for (const field of ["origin", "timebase", "userOverrides"]) {
      await expect(
        editor.edit("cut", {
          baseRevision: current.revision,
          commands: [{ type: "duration", clipId: "a", duration: 2 }],
          [field]: "restore",
        } as never),
      ).rejects.toThrow("unknown field");
    }
    expect(editor.get("cut").revision).toBe(current.revision);
  });
  it("explicit resolve uses the same revision fence", async () => {
    const { editor } = await fixture();
    await expect(
      editor.resolve("cut", {
        baseRevision: "stale",
        scope: { kind: "composition" },
        mode: "regenerate",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
