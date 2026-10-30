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
  it("promotion never downgrades a future validated project version", () => {
    const project = {
      ...createProject("Future"),
      schemaVersion: "1.2.0",
      stories: [{ id: "s", title: "Story", beats: [] }],
      timelines: [
        {
          id: "c",
          storyId: "s",
          duration: 1,
          tracks: [
            {
              id: "v",
              type: "video",
              clips: [
                {
                  id: "a",
                  assetId: "a",
                  timelineStart: 0,
                  timelineDuration: 1,
                  userOverrides: {
                    version: 1,
                    isUserPinned: true,
                    lockedAttributes: ["timing"],
                  },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as ReturnType<typeof createProject>;
    expect(promotePinnedProject(project).schemaVersion).toBe("1.2.0");
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
  it("a named presentation edit cannot authorize automatic removal of its existing pin", async () => {
    const { app, editor } = await fixture();
    const initial = editor.get("cut");
    const pinned = await editor.edit("cut", {
      baseRevision: initial.revision,
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
        { type: "volume", clipId: "a", volume: 0.5 },
        { type: "regenerate-beat", beatId: "beat", mode: "regenerate" },
      ],
    });
    expect(
      after.composition.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === "a"),
    ).toMatchObject({
      id: "a",
      assetId: "a",
      timelineStart: 0,
      timelineDuration: 3,
      transform: { volume: 0.5 },
      userOverrides: { isUserPinned: true },
    });
    expect(app.project.schemaVersion).toBe("1.1.0");
  });
  it("manual offset records only the latest explicit move inside an atomic gesture", async () => {
    const { editor } = await fixture();
    const before = editor.get("cut");
    const after = await editor.edit("cut", {
      baseRevision: before.revision,
      commands: [
        { type: "reorder", clipId: "a", toIndex: 1 },
        { type: "reorder", clipId: "a", toIndex: 0 },
      ],
    });
    const owner = after.composition.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === "a")!;
    expect(owner.timelineStart).toBe(0);
    expect(owner.userOverrides?.manualOffset).toBe(-90);
  });
  it("release targets are unique by owner regardless of JSON key order", async () => {
    const { editor } = await fixture();
    const before = editor.get("cut");
    await expect(
      editor.edit("cut", {
        baseRevision: before.revision,
        commands: [
          {
            type: "user-pin.resolve",
            targets: [
              { kind: "clip", clipId: "a" },
              { clipId: "a", kind: "clip" },
            ],
            scope: { kind: "composition" },
            mode: "regenerate",
          },
        ],
      }),
    ).rejects.toThrow("duplicate target");
    expect(editor.get("cut").revision).toBe(before.revision);
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

it("protects complete current photo/title/color/local-preset and scene payloads from automatic substitution", async () => {
  const { app, editor, file } = await fixture();
  const { createPresetSnapshot } = await import("../src/index.js");
  const { validatePresetPackage, resolveProjectTimebase } =
    await import("@openfilm/core");
  const { applyOverridePolicy } = await import("@openfilm/solver");
  const { presetPackage } =
    await import("../../../tests/fixtures/local-presets/package.js");
  const pkg = validatePresetPackage(presetPackage());
  const entry = pkg.entries.find((entry) => entry.kind === "film-look")!;
  const before = editor.get("cut");
  const pinned = await editor.edit("cut", {
    baseRevision: before.revision,
    commands: [
      {
        type: "presentation",
        clipId: "a",
        layout: {
          version: 2,
          preset: "diptych",
          secondary: { assetId: "b" },
          gap: 8,
          fill: { version: 1, kind: "ambient", blurSigma: 0.03, dim: 0.4 },
        },
        motion: {
          version: 2,
          preset: "pan",
          easing: {
            version: 1,
            kind: "cubic-bezier",
            x1: 0.2,
            y1: 0.1,
            x2: 0.8,
            y2: 0.9,
          },
          from: { scale: 1, x: 0, y: 0 },
          to: { scale: 1, x: 2, y: 0 },
        },
        title: "記憶\nMemories",
        titleRuns: { version: 1, splitAt: 2, gap: 8 },
        titleStyle: {
          version: 1,
          role: "film-title",
          finishing: { version: 1, stroke: { color: "#000000", width: 1 } },
        },
      },
      {
        type: "look",
        scope: "clip",
        clipId: "a",
        look: {
          version: 2,
          preset: "local",
          strength: 0.8,
          snapshot: createPresetSnapshot<"film-look">(pkg, entry),
        },
      },
      {
        type: "primary-color",
        scope: "clip",
        clipId: "a",
        correction: {
          version: 1,
          temperature: 0.2,
          exposureEv: 0.4,
          contrast: 0.9,
        },
      },
      {
        type: "graphic.scene.upsert",
        scene: {
          version: 1,
          id: "scene",
          name: "Authored",
          start: 0,
          duration: 1,
          zIndex: 0,
          nodes: [],
        },
      },
    ],
  });
  const baseline = { composition: pinned.composition, story: pinned.story };
  const unchanged = structuredClone(baseline),
    disk = await readFile(file);
  const mutations: ((candidate: typeof baseline) => void)[] = [
    (d) => {
      const layout = d.composition.tracks[0]!.clips[0]!.layout!;
      if (layout.version === 2) layout.fill.dim = 0.5;
    },
    (d) => {
      const motion = d.composition.tracks[0]!.clips[0]!.motion!;
      if (motion.version === 2) motion.easing.x1 = 0.3;
    },
    (d) => {
      d.composition.tracks[0]!.clips[0]!.titleRuns!.gap = 12;
    },
    (d) => {
      d.composition.tracks[0]!.clips[0]!.titleStyle!.finishing!.stroke!.width = 2;
    },
    (d) => {
      const look = d.composition.tracks[0]!.clips[0]!.look!;
      if (look.version === 2)
        look.snapshot.provenance.source = "Different authored provenance";
    },
    (d) => {
      d.composition.tracks[0]!.clips[0]!.primaryColor!.exposureEv = 0.6;
    },
    (d) => {
      delete d.composition.tracks[0]!.clips[0]!.primaryColor;
    },
    (d) => {
      d.composition.graphicScenes![0]!.duration = 0.9;
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(baseline);
    mutate(candidate);
    expect(() =>
      applyOverridePolicy(baseline, candidate, [], {
        origin: "automatic",
        timebase: resolveProjectTimebase(app.project.settings),
      }),
    ).toThrow(/pin/iu);
    expect(baseline).toEqual(unchanged);
  }
  expect(editor.get("cut")).toEqual(pinned);
  expect(await readFile(file)).toEqual(disk);
  const paired = app.catalog.getAsset("b")!;
  app.catalog.upsertAsset({
    ...paired,
    state: { ...paired.state, locked: true },
  });
  const current = editor.get("cut");
  await expect(
    editor.edit("cut", {
      baseRevision: current.revision,
      commands: [
        { type: "primary-color", scope: "clip", clipId: "a", correction: null },
      ],
    }),
  ).rejects.toThrow(/locked/iu);
  expect(await readFile(file)).toEqual(disk);
});
