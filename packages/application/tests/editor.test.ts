import {
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import {
  OpenFilmApplication,
  TimelineEditor,
  type TimelineEditInput,
} from "../src/index.js";

const applications = new Set<OpenFilmApplication>();
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of applications) app.close();
  applications.clear();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-editor-"));
  directories.push(directory);
  const app = await OpenFilmApplication.create(
    join(directory, "film.openfilm"),
    "Editing session",
  );
  applications.add(app);
  const assets: MediaAsset[] = [
    {
      id: "video",
      uri: "file:///originals/video.mp4",
      mediaType: "video",
      name: "Video",
      duration: 20,
      tags: ["retain"],
      rating: 4,
      state: {},
      metadata: { "test.original": "retained" },
    },
    {
      id: "photo",
      uri: "file:///originals/photo.jpg",
      mediaType: "image",
      name: "Photo",
      tags: [],
      state: {},
      metadata: {},
    },
    {
      id: "spare",
      uri: "file:///originals/spare.jpg",
      mediaType: "image",
      name: "Spare",
      tags: [],
      state: {},
      metadata: {},
    },
    {
      id: "outside",
      uri: "file:///originals/outside.jpg",
      mediaType: "image",
      name: "Outside",
      tags: [],
      state: {},
      metadata: {},
    },
  ];
  for (const asset of assets) app.catalog.upsertAsset(asset);
  app.project.mediaLibraries.push({
    id: "library",
    name: "Originals",
    uri: "file:///originals",
  });
  app.project.stories.push(
    {
      id: "story",
      title: "Selected story",
      targetDuration: 12,
      maxDuration: 20,
      beats: [
        {
          id: "beat",
          title: "Opening",
          candidateAssetIds: ["video", "photo", "spare"],
        },
      ],
    },
    {
      id: "other-story",
      title: "Other story",
      beats: [
        { id: "other-beat", title: "Unchanged", candidateAssetIds: ["spare"] },
      ],
    },
  );
  app.project.timelines.push(
    {
      id: "timeline",
      storyId: "story",
      duration: 12,
      tracks: [
        {
          id: "track",
          type: "video",
          clips: [
            {
              id: "video-clip",
              assetId: "video",
              beatId: "beat",
              sourceIn: 1,
              sourceOut: 9,
              timelineStart: 0,
              timelineDuration: 8,
              title: "Keep title",
              transform: { x: 0.2 },
            },
            {
              id: "photo-clip",
              assetId: "photo",
              beatId: "beat",
              sourceIn: 0,
              sourceOut: 4,
              timelineStart: 8,
              timelineDuration: 4,
            },
          ],
        },
      ],
    },
    {
      id: "other-timeline",
      storyId: "other-story",
      duration: 4,
      tracks: [
        {
          id: "other-track",
          type: "video",
          clips: [
            {
              id: "other-clip",
              assetId: "spare",
              beatId: "other-beat",
              timelineStart: 0,
              timelineDuration: 4,
            },
          ],
        },
      ],
    },
  );
  await app.save();
  const editor = new TimelineEditor(app);
  return { app, editor, path: join(app.directory, "project.json") };
}

describe("durable timeline editor", () => {
  it("saves all manual fields in the selected story and timeline and reopens a real SQLite project", async () => {
    const { app, editor, path } = await fixture();
    const initial = editor.get("timeline");
    const otherStory = structuredClone(app.project.stories[1]);
    const otherTimeline = structuredClone(app.project.timelines[1]);
    const saved = await editor.edit("timeline", {
      baseRevision: initial.revision,
      commands: [
        { type: "trim", clipId: "video-clip", sourceIn: 2, sourceOut: 10 },
        { type: "speed", clipId: "video-clip", speed: 2 },
        { type: "volume", clipId: "video-clip", volume: 0.35 },
        {
          type: "transform",
          clipId: "video-clip",
          scale: 1.2,
          rotation: 12,
          x: 0.1,
          y: -0.2,
        },
        {
          type: "transition",
          clipId: "video-clip",
          transition: "crossfade",
          duration: 0.5,
        },
        { type: "duration", clipId: "photo-clip", duration: 6 },
        { type: "reorder", clipId: "photo-clip", toIndex: 0 },
        { type: "lock", clipId: "video-clip", locked: true },
        {
          type: "beat",
          beatId: "beat",
          patch: {
            title: "New opening",
            intent: "Two lines\nof intent",
            minDuration: 3,
            targetDuration: 10,
            maxDuration: 15,
          },
        },
      ],
    });
    expect(saved.revision).not.toBe(initial.revision);
    expect(saved.canUndo).toBe(true);
    expect(saved.canRedo).toBe(false);
    expect(saved.composition.tracks[0]!.clips.map((clip) => clip.id)).toEqual([
      "photo-clip",
      "video-clip",
    ]);
    expect(saved.composition.tracks[0]!.clips[1]).toMatchObject({
      sourceIn: 2,
      sourceOut: 10,
      timelineStart: 6,
      timelineDuration: 4,
      title: "Keep title",
      locked: true,
      transform: {
        speed: 2,
        volume: 0.35,
        scale: 1.2,
        rotation: 12,
        x: 0.1,
        y: -0.2,
      },
      transition: { type: "crossfade", duration: 0.5 },
    });
    expect(app.project.stories[1]).toEqual(otherStory);
    expect(app.project.timelines[1]).toEqual(otherTimeline);
    const disk = JSON.parse(await readFile(path, "utf8"));
    expect(disk.timelines[0]).toEqual(saved.composition);
    expect(disk.stories[0]).toEqual(saved.story);
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(app.directory);
    applications.add(reopened);
    const reopenedState = new TimelineEditor(reopened).get("timeline");
    expect(reopenedState).toEqual({ ...saved, canUndo: false });
    expect(reopened.catalog.getAsset("video")).toEqual(
      initial.assets.find((asset) => asset.id === "video"),
    );
    expect(reopened.project.mediaLibraries).toEqual(app.project.mediaLibraries);
  });

  it("persists clearing optional beat intent while requiring a nonempty title", async () => {
    const { app, editor, path } = await fixture();
    const withIntent = await editor.edit("timeline", {
      baseRevision: editor.get("timeline").revision,
      commands: [
        { type: "beat", beatId: "beat", patch: { intent: "A quiet opening" } },
      ],
    });
    const cleared = await editor.edit("timeline", {
      baseRevision: withIntent.revision,
      commands: [{ type: "beat", beatId: "beat", patch: { intent: "" } }],
    });
    expect(cleared.story.beats[0]!.intent).toBeUndefined();
    expect(
      JSON.parse(await readFile(path, "utf8")).stories[0].beats[0].intent,
    ).toBeUndefined();
    const bytes = await readFile(path);
    await expect(
      editor.edit("timeline", {
        baseRevision: cleared.revision,
        commands: [{ type: "beat", beatId: "beat", patch: { title: "  " } }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(editor.get("timeline")).toEqual(cleared);
    expect(await readFile(path)).toEqual(bytes);
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(app.directory);
    applications.add(reopened);
    expect(
      new TimelineEditor(reopened).get("timeline").story.beats[0]!.intent,
    ).toBeUndefined();
  });

  it("rejects malformed runtime JSON and invalid command batches without changing disk or state", async () => {
    const { app, editor, path } = await fixture();
    const initial = editor.get("timeline");
    const bytes = await readFile(path);
    const project = app.project;
    const invalidInputs: unknown[] = [
      null,
      [],
      {},
      { baseRevision: initial.revision, commands: [] },
      { baseRevision: initial.revision, commands: "trim" },
      {
        baseRevision: initial.revision,
        commands: [{ type: "delete", clipId: "photo-clip", unexpected: true }],
      },
      {
        baseRevision: initial.revision,
        requestId: {},
        commands: [{ type: "delete", clipId: "photo-clip" }],
      },
      ...[
        null,
        { type: "missing", clipId: "video-clip" },
        { type: "volume", clipId: "video-clip", volume: "0.5" },
        { type: "volume", clipId: "video-clip", volume: 1.1 },
        { type: "speed", clipId: "video-clip", speed: Infinity },
        { type: "speed", clipId: "video-clip", speed: 0 },
        { type: "duration", clipId: "photo-clip", duration: NaN },
        { type: "lock", clipId: "video-clip", locked: "true" },
        { type: "trim", clipId: "video-clip", sourceIn: 2, sourceOut: 99 },
        { type: "transform", clipId: "video-clip", scale: -1 },
        { type: "transform", clipId: "video-clip" },
        { type: "reorder", clipId: "video-clip", toIndex: 0.5 },
        { type: "transition", clipId: "video-clip", transition: "dissolve" },
        {
          type: "beat",
          beatId: "beat",
          patch: { candidateAssetIds: ["outside"] },
        },
        {
          type: "beat",
          beatId: "beat",
          patch: { minDuration: 10, maxDuration: 4 },
        },
        { type: "regenerate-beat", beatId: "beat", mode: "random" },
        { type: "duration", clipId: "other-clip", duration: 2 },
        { type: "beat", beatId: "other-beat", patch: { title: "No" } },
      ].map((item) => ({ baseRevision: initial.revision, commands: [item] })),
      {
        baseRevision: initial.revision,
        commands: [
          { type: "duration", clipId: "photo-clip", duration: 3 },
          { type: "trim", clipId: "video-clip", sourceIn: 2, sourceOut: 99 },
        ],
      },
    ];
    for (const input of invalidInputs) {
      await expect(
        editor.edit("timeline", input as TimelineEditInput),
      ).rejects.toMatchObject({ status: 400 });
      expect(editor.get("timeline")).toEqual(initial);
      expect(app.project).toBe(project);
      expect(await readFile(path)).toEqual(bytes);
    }
  });

  it("rejects stale concurrent writes and exact missing IDs without changing the acknowledged result", async () => {
    const { editor, path } = await fixture();
    const initial = editor.get("timeline");
    const first = editor.edit("timeline", {
      baseRevision: initial.revision,
      commands: [{ type: "duration", clipId: "photo-clip", duration: 5 }],
    });
    const second = editor.edit("timeline", {
      baseRevision: initial.revision,
      commands: [{ type: "volume", clipId: "video-clip", volume: 0.5 }],
    });
    const saved = await first;
    await expect(second).rejects.toMatchObject({ status: 409 });
    const bytes = await readFile(path);
    await expect(
      editor.undo("timeline", initial.revision),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      editor.redo("timeline", initial.revision),
    ).rejects.toMatchObject({ status: 409 });
    expect(() => editor.get("unknown")).toThrow("Timeline not found");
    await expect(
      editor.edit("unknown", {
        baseRevision: saved.revision,
        commands: [{ type: "delete", clipId: "photo-clip" }],
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(editor.get("timeline")).toEqual(saved);
    expect(await readFile(path)).toEqual(bytes);
  });

  it("undoes and redoes persisted snapshots and discards redo after a new edit", async () => {
    const { editor, path } = await fixture();
    const initial = editor.get("timeline");
    const first = await editor.edit("timeline", {
      baseRevision: initial.revision,
      commands: [{ type: "duration", clipId: "photo-clip", duration: 7 }],
    });
    const undone = await editor.undo("timeline", first.revision);
    expect(undone).toEqual({ ...initial, canRedo: true });
    expect(JSON.parse(await readFile(path, "utf8")).timelines[0]).toEqual(
      initial.composition,
    );
    const redone = await editor.redo("timeline", undone.revision);
    expect(redone).toEqual(first);
    const secondUndo = await editor.undo("timeline", redone.revision);
    const replacement = await editor.edit("timeline", {
      baseRevision: secondUndo.revision,
      commands: [{ type: "volume", clipId: "video-clip", volume: 0.1 }],
    });
    expect(replacement.canRedo).toBe(false);
    await expect(
      editor.redo("timeline", replacement.revision),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("deduplicates retries, rejects request ID reuse and keeps later acknowledged edits", async () => {
    const { editor, path } = await fixture();
    const initial = editor.get("timeline");
    const input: TimelineEditInput = {
      baseRevision: initial.revision,
      requestId: "retry-1",
      commands: [{ type: "duration", clipId: "photo-clip", duration: 5 }],
    };
    const first = await editor.edit("timeline", input);
    const firstBytes = await readFile(path);
    const replayed = await editor.edit("timeline", input);
    expect(replayed).toMatchObject(first);
    expect(replayed.acknowledgedRevision).toBe(first.revision);
    expect(await readFile(path)).toEqual(firstBytes);
    const second = await editor.edit("timeline", {
      baseRevision: first.revision,
      commands: [{ type: "volume", clipId: "video-clip", volume: 0.7 }],
    });
    const replayedAfterLaterEdit = await editor.edit("timeline", {
      commands: [{ duration: 5, clipId: "photo-clip", type: "duration" }],
      requestId: "retry-1",
      baseRevision: initial.revision,
    });
    expect(replayedAfterLaterEdit).toMatchObject(second);
    expect(replayedAfterLaterEdit.acknowledgedRevision).toBe(first.revision);
    await expect(
      editor.edit("timeline", {
        ...input,
        commands: [{ type: "duration", clipId: "photo-clip", duration: 6 }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await editor.undo("timeline", second.revision)).composition,
    ).toEqual(first.composition);
  });

  it("protects locked clips, allows explicit unlocking, and persists manual over-limit cuts", async () => {
    const { editor, path } = await fixture();
    let state = await editor.edit("timeline", {
      baseRevision: editor.get("timeline").revision,
      commands: [{ type: "lock", clipId: "video-clip", locked: true }],
    });
    const bytes = await readFile(path);
    const blocked: TimelineCommand[] = [
      { type: "delete", clipId: "video-clip" },
      { type: "replace", clipId: "video-clip", assetId: "spare" },
      { type: "trim", clipId: "video-clip", sourceIn: 2, sourceOut: 8 },
      { type: "volume", clipId: "video-clip", volume: 0.4 },
    ];
    for (const command of blocked)
      await expect(
        editor.edit("timeline", {
          baseRevision: state.revision,
          commands: [command],
        }),
      ).rejects.toThrow(/lock/i);
    expect(await readFile(path)).toEqual(bytes);
    state = await editor.edit("timeline", {
      baseRevision: state.revision,
      commands: [
        { type: "lock", clipId: "video-clip", locked: false },
        { type: "volume", clipId: "video-clip", volume: 0.4 },
        { type: "duration", clipId: "photo-clip", duration: 30 },
      ],
    });
    expect(state.composition.duration).toBeGreaterThan(
      state.story.maxDuration!,
    );
    expect(JSON.parse(await readFile(path, "utf8")).timelines[0]).toEqual(
      state.composition,
    );
  });

  it("rolls back memory, history and retry records when the atomic writer rejects storage", async () => {
    const { app, editor, path } = await fixture();
    const initial = editor.get("timeline");
    const saved = await editor.edit("timeline", {
      baseRevision: initial.revision,
      commands: [{ type: "duration", clipId: "photo-clip", duration: 6 }],
    });
    const previousProject = app.project;
    const bytes = await readFile(path);
    const input: TimelineEditInput = {
      baseRevision: saved.revision,
      requestId: "retry-after-disk-error",
      commands: [{ type: "volume", clipId: "video-clip", volume: 0.2 }],
    };
    const backup = `${path}.backup`;
    await rename(path, backup);
    await symlink(backup, path);
    try {
      await expect(editor.edit("timeline", input)).rejects.toThrow(
        "Project file must be regular",
      );
      expect(app.project).toBe(previousProject);
      expect(editor.get("timeline")).toEqual(saved);
      expect(await readFile(path)).toEqual(bytes);
      await expect(editor.undo("timeline", saved.revision)).rejects.toThrow(
        "Project file must be regular",
      );
      expect(editor.get("timeline")).toEqual(saved);
      expect(app.project).toBe(previousProject);
    } finally {
      await unlink(path);
      await rename(backup, path);
    }
    const retried = await editor.edit("timeline", input);
    expect(retried.composition.tracks[0]!.clips[0]!.transform?.volume).toBe(
      0.2,
    );
    expect(
      (await editor.undo("timeline", retried.revision)).composition,
    ).toEqual(saved.composition);
  });

  it("rolls back redo history on a failed save and allows the same redo after recovery", async () => {
    const { app, editor, path } = await fixture();
    const initial = editor.get("timeline");
    const saved = await editor.edit("timeline", {
      baseRevision: initial.revision,
      commands: [{ type: "duration", clipId: "photo-clip", duration: 6 }],
    });
    const undone = await editor.undo("timeline", saved.revision);
    const bytes = await readFile(path);
    const failing = vi
      .spyOn(app, "save")
      .mockRejectedValueOnce(new Error("Disk unavailable"));
    await expect(editor.redo("timeline", undone.revision)).rejects.toThrow(
      "Disk unavailable",
    );
    expect(editor.get("timeline")).toEqual(undone);
    expect(await readFile(path)).toEqual(bytes);
    failing.mockRestore();
    expect(await editor.redo("timeline", undone.revision)).toEqual(saved);
  });

  it("detects source catalog changes and prevents old history from replacing external changes", async () => {
    const { app, editor } = await fixture();
    const initial = editor.get("timeline");
    const saved = await editor.edit("timeline", {
      baseRevision: initial.revision,
      commands: [{ type: "duration", clipId: "photo-clip", duration: 6 }],
    });
    app.catalog.updateAsset("video", { state: { locked: true } });
    const changed = editor.get("timeline");
    expect(changed.revision).not.toBe(saved.revision);
    expect(changed.canUndo).toBe(false);
    await expect(editor.undo("timeline", saved.revision)).rejects.toMatchObject(
      { status: 409 },
    );
    await expect(
      editor.undo("timeline", changed.revision),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("returns isolated state copies and supports replacements outside the original story pool", async () => {
    const { editor } = await fixture();
    const initial = editor.get("timeline");
    const changed = editor.get("timeline");
    changed.story.title = "Mutated";
    changed.composition.tracks[0]!.clips[0]!.sourceIn = 99;
    changed.assets[0]!.state.locked = true;
    expect(editor.get("timeline")).toEqual(initial);
    const saved = await editor.edit("timeline", {
      baseRevision: initial.revision,
      commands: [{ type: "replace", clipId: "photo-clip", assetId: "outside" }],
    });
    expect(saved.composition.tracks[0]!.clips[1]!.assetId).toBe("outside");
    expect(saved.assets.some((asset) => asset.id === "outside")).toBe(true);
  });

  it("bounds undo history to the latest 100 edits", async () => {
    const { editor } = await fixture();
    let state = editor.get("timeline");
    for (let i = 1; i <= 102; i++)
      state = await editor.edit("timeline", {
        baseRevision: state.revision,
        commands: [{ type: "volume", clipId: "video-clip", volume: i / 103 }],
      });
    for (let i = 0; i < 100; i++)
      state = await editor.undo("timeline", state.revision);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(true);
    expect(state.composition.tracks[0]!.clips[0]!.transform?.volume).toBe(
      2 / 103,
    );
    await expect(editor.undo("timeline", state.revision)).rejects.toMatchObject(
      { status: 409 },
    );
  });
});
