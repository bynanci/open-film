import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";

const applications = new Set<OpenFilmApplication>();
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of applications) app.close();
  applications.clear();
  for (const dir of directories.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-pro-cut-"));
  directories.push(root);
  const directory = join(root, "project.openfilm");
  const app = await OpenFilmApplication.create(directory, "Cut Desk Phase 2/3");
  applications.add(app);

  app.project.settings = { width: 1920, height: 1080, frameRate: 24 };

  const assets: MediaAsset[] = [
    {
      id: "video-a",
      name: "video-a.mp4",
      uri: pathToFileURL(join(root, "video-a.mp4")).href,
      mediaType: "video",
      duration: 20,
      tags: [],
      state: {},
      metadata: {},
    },
    {
      id: "video-b",
      name: "video-b.mp4",
      uri: pathToFileURL(join(root, "video-b.mp4")).href,
      mediaType: "video",
      duration: 20,
      tags: [],
      state: {},
      metadata: {},
    },
    {
      id: "video-c",
      name: "video-c.mp4",
      uri: pathToFileURL(join(root, "video-c.mp4")).href,
      mediaType: "video",
      duration: 20,
      tags: [],
      state: {},
      metadata: {},
    },
    {
      id: "video-d",
      name: "video-d.mp4",
      uri: pathToFileURL(join(root, "video-d.mp4")).href,
      mediaType: "video",
      duration: 20,
      tags: [],
      state: {},
      metadata: {},
    },
    {
      id: "external-catalog-asset",
      name: "external.mp4",
      uri: pathToFileURL(join(root, "external.mp4")).href,
      mediaType: "video",
      duration: 15,
      tags: [],
      state: {},
      metadata: {},
    },
  ];

  for (const asset of assets) {
    app.catalog.upsertAsset(asset);
  }

  app.project.stories.push({
    id: "story-1",
    title: "Test Story",
    targetDuration: 24,
    maxDuration: 30,
    beats: [
      {
        id: "beat-1",
        title: "Beat 1",
        selectedAssetIds: ["video-a", "video-b"],
        candidateAssetIds: ["video-a", "video-b", "video-c", "video-d"],
      },
      {
        id: "beat-2",
        title: "Beat 2",
        selectedAssetIds: ["video-c"],
        candidateAssetIds: ["video-a", "video-b", "video-c", "video-d"],
      },
    ],
  });

  app.project.timelines.push({
    id: "comp-1",
    storyId: "story-1",
    duration: 24,
    tracks: [
      {
        id: "track-v1",
        type: "video",
        target: true,
        locked: false,
        visible: true,
        clips: [
          {
            id: "clip-a",
            assetId: "video-a",
            beatId: "beat-1",
            sourceIn: 2,
            sourceOut: 8,
            timelineStart: 0,
            timelineDuration: 6,
          },
          {
            id: "clip-b",
            assetId: "video-b",
            beatId: "beat-1",
            sourceIn: 5,
            sourceOut: 13,
            timelineStart: 6,
            timelineDuration: 8,
          },
          {
            id: "clip-c",
            assetId: "video-c",
            beatId: "beat-2",
            sourceIn: 0,
            sourceOut: 10,
            timelineStart: 14,
            timelineDuration: 10,
          },
        ],
      },
      {
        id: "track-v2",
        type: "video",
        target: false,
        locked: false,
        visible: true,
        clips: [],
      },
    ],
  });

  await app.save();
  const editor = new TimelineEditor(app);
  return { app, editor, directory };
}

describe("Cut Desk Phase 2 & 3: Application & Persistence Integration", () => {
  describe("Roll edit", () => {
    it("persists roll edit, updates user pins, supports undo/redo and restores on reopen", async () => {
      const { app, editor, directory } = await fixture();
      const initialRev = editor.get("comp-1").revision;

      const updated = await editor.edit("comp-1", {
        baseRevision: initialRev,
        commands: [
          {
            type: "roll",
            clipIdA: "clip-a",
            clipIdB: "clip-b",
            delta: 2,
          },
        ],
      });

      const track = updated.composition.tracks[0]!;
      const clipA = track.clips.find((c) => c.id === "clip-a")!;
      const clipB = track.clips.find((c) => c.id === "clip-b")!;

      expect(clipA.timelineDuration).toBe(8);
      expect(clipA.sourceOut).toBe(10);
      expect(clipB.timelineStart).toBe(8);
      expect(clipB.timelineDuration).toBe(6);
      expect(clipB.sourceIn).toBe(7);
      expect(clipA.userOverrides?.isUserPinned).toBe(true);
      expect(clipB.userOverrides?.isUserPinned).toBe(true);

      // Verify Undo restores original timeline
      const undone = await editor.undo("comp-1", updated.revision);
      const undoneTrack = undone.composition.tracks[0]!;
      expect(
        undoneTrack.clips.find((c) => c.id === "clip-a")!.timelineDuration,
      ).toBe(6);
      expect(
        undoneTrack.clips.find((c) => c.id === "clip-b")!.timelineStart,
      ).toBe(6);

      // Verify Redo reapplies roll
      const redone = await editor.redo("comp-1", undone.revision);
      const redoneTrack = redone.composition.tracks[0]!;
      expect(
        redoneTrack.clips.find((c) => c.id === "clip-a")!.timelineDuration,
      ).toBe(8);

      // Verify persistence across project reopen
      app.close();
      applications.delete(app);

      const reopened = await OpenFilmApplication.open(directory);
      applications.add(reopened);
      const reopenedEditor = new TimelineEditor(reopened);
      const reopenedState = reopenedEditor.get("comp-1");
      const reopenedTrack = reopenedState.composition.tracks[0]!;
      expect(
        reopenedTrack.clips.find((c) => c.id === "clip-a")!.timelineDuration,
      ).toBe(8);
      expect(
        reopenedTrack.clips.find((c) => c.id === "clip-b")!.timelineStart,
      ).toBe(8);
    });

    it("rejects roll edit when clipIdA equals clipIdB", async () => {
      const { editor } = await fixture();
      await expect(
        editor.edit("comp-1", {
          baseRevision: editor.get("comp-1").revision,
          commands: [
            {
              type: "roll",
              clipIdA: "clip-a",
              clipIdB: "clip-a",
              delta: 1,
            },
          ],
        }),
      ).rejects.toThrow(/clipIdA and clipIdB must be different/);
    });
  });

  describe("Slip edit", () => {
    it("persists slip edit preserving timeline duration and restores on reopen", async () => {
      const { app, editor, directory } = await fixture();
      const updated = await editor.edit("comp-1", {
        baseRevision: editor.get("comp-1").revision,
        commands: [{ type: "slip", clipId: "clip-b", delta: 2 }],
      });

      const clipB = updated.composition.tracks[0]!.clips.find(
        (c) => c.id === "clip-b",
      )!;
      expect(clipB.sourceIn).toBe(7);
      expect(clipB.sourceOut).toBe(15);
      expect(clipB.timelineStart).toBe(6);
      expect(clipB.timelineDuration).toBe(8);
      expect(clipB.userOverrides?.isUserPinned).toBe(true);

      app.close();
      applications.delete(app);
      const reopened = await OpenFilmApplication.open(directory);
      applications.add(reopened);
      const reopenedEditor = new TimelineEditor(reopened);
      const reopenedClipB = reopenedEditor
        .get("comp-1")
        .composition.tracks[0]!.clips.find((c) => c.id === "clip-b")!;
      expect(reopenedClipB.sourceIn).toBe(7);
      expect(reopenedClipB.sourceOut).toBe(15);
    });

    it("rejects slip past end of media", async () => {
      const { editor } = await fixture();
      await expect(
        editor.edit("comp-1", {
          baseRevision: editor.get("comp-1").revision,
          commands: [{ type: "slip", clipId: "clip-b", delta: 100 }],
        }),
      ).rejects.toThrow(/Cannot slip past the end of source/);
    });
  });

  describe("Slide edit", () => {
    it("persists slide edit adjusting adjacent clips and restores on reopen", async () => {
      const { app, editor, directory } = await fixture();
      const updated = await editor.edit("comp-1", {
        baseRevision: editor.get("comp-1").revision,
        commands: [{ type: "slide", clipId: "clip-b", delta: 1.5 }],
      });

      const track = updated.composition.tracks[0]!;
      const clipA = track.clips.find((c) => c.id === "clip-a")!;
      const clipB = track.clips.find((c) => c.id === "clip-b")!;
      const clipC = track.clips.find((c) => c.id === "clip-c")!;

      expect(clipA.timelineDuration).toBe(7.5);
      expect(clipA.sourceOut).toBe(9.5);
      expect(clipB.timelineStart).toBe(7.5);
      expect(clipB.timelineDuration).toBe(8);
      expect(clipC.timelineStart).toBe(15.5);
      expect(clipC.timelineDuration).toBe(8.5);
      expect(clipC.sourceIn).toBe(1.5);
      expect(clipB.userOverrides?.isUserPinned).toBe(true);

      app.close();
      applications.delete(app);
      const reopened = await OpenFilmApplication.open(directory);
      applications.add(reopened);
      const reopenedEditor = new TimelineEditor(reopened);
      const reopenedTrack = reopenedEditor.get("comp-1").composition.tracks[0]!;
      expect(
        reopenedTrack.clips.find((c) => c.id === "clip-b")!.timelineStart,
      ).toBe(7.5);
    });

    it("rejects slide edit if preceding neighbor clip is user-pinned", async () => {
      const { editor } = await fixture();
      // First, directly pin clip-a
      await editor.edit("comp-1", {
        baseRevision: editor.get("comp-1").revision,
        commands: [
          {
            type: "user-pin.set",
            target: { kind: "clip", clipId: "clip-a" },
            pinned: true,
          },
        ],
      });

      // Now slide clip-b: this should fail because clip-a is pinned!
      await expect(
        editor.edit("comp-1", {
          baseRevision: editor.get("comp-1").revision,
          commands: [{ type: "slide", clipId: "clip-b", delta: 1 }],
        }),
      ).rejects.toThrow(/preceding clip "clip-a" is user-pinned/);
    });
  });

  describe("Insert edit", () => {
    it("loads unreferenced catalog asset automatically and splits existing clip at insert point", async () => {
      const { app, editor, directory } = await fixture();
      const updated = await editor.edit("comp-1", {
        baseRevision: editor.get("comp-1").revision,
        commands: [
          {
            type: "insert",
            assetId: "external-catalog-asset",
            timelineStart: 2,
            sourceIn: 0,
            sourceOut: 3,
          },
        ],
      });

      const track = updated.composition.tracks[0]!;
      expect(track.clips.length).toBe(5);

      const clipA = track.clips.find((c) => c.id === "clip-a")!;
      expect(clipA.timelineStart).toBe(0);
      expect(clipA.timelineDuration).toBe(2);

      const inserted = track.clips.find(
        (c) => c.assetId === "external-catalog-asset",
      )!;
      expect(inserted.timelineStart).toBe(2);
      expect(inserted.timelineDuration).toBe(3);
      expect(inserted.userOverrides?.isUserPinned).toBe(true);

      const split = track.clips.find((c) => c.id.startsWith("clip-a-split-"))!;
      expect(split.timelineStart).toBe(5);
      expect(split.timelineDuration).toBe(4);

      const clipB = track.clips.find((c) => c.id === "clip-b")!;
      expect(clipB.timelineStart).toBe(9); // 6 + 3 ripple

      app.close();
      applications.delete(app);
      const reopened = await OpenFilmApplication.open(directory);
      applications.add(reopened);
      const reopenedEditor = new TimelineEditor(reopened);
      expect(
        reopenedEditor.get("comp-1").composition.tracks[0]!.clips.length,
      ).toBe(5);
    });

    it("rejects insert edit if clip at insert point is user-pinned", async () => {
      const { editor } = await fixture();
      await editor.edit("comp-1", {
        baseRevision: editor.get("comp-1").revision,
        commands: [
          {
            type: "user-pin.set",
            target: { kind: "clip", clipId: "clip-a" },
            pinned: true,
          },
        ],
      });

      await expect(
        editor.edit("comp-1", {
          baseRevision: editor.get("comp-1").revision,
          commands: [
            {
              type: "insert",
              assetId: "video-d",
              timelineStart: 2,
              sourceIn: 0,
              sourceOut: 2,
            },
          ],
        }),
      ).rejects.toThrow(/at insert position is user-pinned/);
    });
  });

  describe("Overwrite edit", () => {
    it("overwrites media without rippling downstream clips and restores on reopen", async () => {
      const { app, editor, directory } = await fixture();
      const updated = await editor.edit("comp-1", {
        baseRevision: editor.get("comp-1").revision,
        commands: [
          {
            type: "overwrite",
            assetId: "external-catalog-asset",
            timelineStart: 4,
            sourceIn: 0,
            sourceOut: 4,
          },
        ],
      });

      const track = updated.composition.tracks[0]!;
      const clipA = track.clips.find((c) => c.id === "clip-a")!;
      const clipB = track.clips.find((c) => c.id === "clip-b")!;
      const clipC = track.clips.find((c) => c.id === "clip-c")!;
      const overwritten = track.clips.find(
        (c) => c.assetId === "external-catalog-asset",
      )!;

      expect(clipA.timelineDuration).toBe(4);
      expect(overwritten.timelineStart).toBe(4);
      expect(overwritten.timelineDuration).toBe(4);
      expect(clipB.timelineStart).toBe(8);
      expect(clipB.timelineDuration).toBe(6);
      expect(clipC.timelineStart).toBe(14); // Downstream clip untouched!
      expect(overwritten.userOverrides?.isUserPinned).toBe(true);

      app.close();
      applications.delete(app);
      const reopened = await OpenFilmApplication.open(directory);
      applications.add(reopened);
      const reopenedEditor = new TimelineEditor(reopened);
      const reopenedTrack = reopenedEditor.get("comp-1").composition.tracks[0]!;
      expect(
        reopenedTrack.clips.find((c) => c.assetId === "external-catalog-asset")!
          .timelineStart,
      ).toBe(4);
    });

    it("rejects overwrite edit if overlapping clip is user-pinned", async () => {
      const { editor } = await fixture();
      await editor.edit("comp-1", {
        baseRevision: editor.get("comp-1").revision,
        commands: [
          {
            type: "user-pin.set",
            target: { kind: "clip", clipId: "clip-b" },
            pinned: true,
          },
        ],
      });

      await expect(
        editor.edit("comp-1", {
          baseRevision: editor.get("comp-1").revision,
          commands: [
            {
              type: "overwrite",
              assetId: "video-d",
              timelineStart: 5,
              sourceIn: 0,
              sourceOut: 3,
            },
          ],
        }),
      ).rejects.toThrow(/in the overwrite region is user-pinned/);
    });
  });

  describe("Lift edit", () => {
    it("lifts clip leaving a gap without rippling and restores on reopen", async () => {
      const { app, editor, directory } = await fixture();
      const updated = await editor.edit("comp-1", {
        baseRevision: editor.get("comp-1").revision,
        commands: [{ type: "lift", clipId: "clip-b" }],
      });

      const track = updated.composition.tracks[0]!;
      expect(track.clips.length).toBe(2);
      expect(track.clips.some((c) => c.id === "clip-b")).toBe(false);

      const clipA = track.clips.find((c) => c.id === "clip-a")!;
      const clipC = track.clips.find((c) => c.id === "clip-c")!;
      expect(clipA.timelineStart).toBe(0);
      expect(clipC.timelineStart).toBe(14); // Gap [6..14] preserved!

      app.close();
      applications.delete(app);
      const reopened = await OpenFilmApplication.open(directory);
      applications.add(reopened);
      const reopenedEditor = new TimelineEditor(reopened);
      expect(
        reopenedEditor.get("comp-1").composition.tracks[0]!.clips.length,
      ).toBe(2);
    });
  });

  describe("Batch edit", () => {
    it("executes multi-command batch atomically and rolls back on single sub-command failure", async () => {
      const { editor } = await fixture();
      const initialRev = editor.get("comp-1").revision;

      // Successful batch
      const updated = await editor.edit("comp-1", {
        baseRevision: initialRev,
        commands: [
          {
            type: "batch",
            transactionId: "tx-batch-1",
            commands: [
              { type: "slip", clipId: "clip-a", delta: 1 },
              { type: "roll", clipIdA: "clip-a", clipIdB: "clip-b", delta: 1 },
            ],
          },
        ],
      });

      const track = updated.composition.tracks[0]!;
      const clipA = track.clips.find((c) => c.id === "clip-a")!;
      expect(clipA.sourceIn).toBe(3);
      expect(clipA.sourceOut).toBe(10);
      expect(clipA.timelineDuration).toBe(7);

      // Single undo reverts the entire batch
      const undone = await editor.undo("comp-1", updated.revision);
      const undoneClipA = undone.composition.tracks[0]!.clips.find(
        (c) => c.id === "clip-a",
      )!;
      expect(undoneClipA.sourceIn).toBe(2);
      expect(undoneClipA.sourceOut).toBe(8);

      // Failing batch aborts atomically
      await expect(
        editor.edit("comp-1", {
          baseRevision: undone.revision,
          commands: [
            {
              type: "batch",
              commands: [
                { type: "slip", clipId: "clip-a", delta: 1 },
                { type: "slip", clipId: "clip-b", delta: 100 }, // Fails!
              ],
            },
          ],
        }),
      ).rejects.toThrow(/Cannot slip past the end of source/);

      // State remains pristine
      const current = editor.get("comp-1");
      expect(current.revision).toBe(undone.revision);
    });

    it("rejects nested batch commands", async () => {
      const { editor } = await fixture();
      await expect(
        editor.edit("comp-1", {
          baseRevision: editor.get("comp-1").revision,
          commands: [
            {
              type: "batch",
              commands: [
                {
                  type: "batch",
                  commands: [{ type: "lift", clipId: "clip-b" }],
                } as unknown as TimelineCommand,
              ],
            },
          ],
        }),
      ).rejects.toThrow(/nested batch commands are not allowed/);
    });
  });

  describe("Track controls (track.update)", () => {
    it("updates track lock, target, muted, solo, and visible states and enforces locking", async () => {
      const { app, editor, directory } = await fixture();

      const updated = await editor.edit("comp-1", {
        baseRevision: editor.get("comp-1").revision,
        commands: [
          {
            type: "track.update",
            trackId: "track-v1",
            patch: { locked: true, visible: false },
          },
          {
            type: "track.update",
            trackId: "track-v2",
            patch: { target: true },
          },
        ],
      });

      const track1 = updated.composition.tracks.find(
        (t) => t.id === "track-v1",
      )!;
      const track2 = updated.composition.tracks.find(
        (t) => t.id === "track-v2",
      )!;
      expect(track1.locked).toBe(true);
      expect(track1.visible).toBe(false);
      expect(track2.target).toBe(true);

      // Edits on locked track must be rejected
      await expect(
        editor.edit("comp-1", {
          baseRevision: updated.revision,
          commands: [{ type: "lift", clipId: "clip-a" }],
        }),
      ).rejects.toThrow(/locked/);

      // Persistence across reopen
      app.close();
      applications.delete(app);
      const reopened = await OpenFilmApplication.open(directory);
      applications.add(reopened);
      const reopenedEditor = new TimelineEditor(reopened);
      const reopenedTrack1 = reopenedEditor
        .get("comp-1")
        .composition.tracks.find((t) => t.id === "track-v1")!;
      expect(reopenedTrack1.locked).toBe(true);
      expect(reopenedTrack1.visible).toBe(false);
    });

    it("rejects track.update with empty patch or non-existent trackId", async () => {
      const { editor } = await fixture();
      await expect(
        editor.edit("comp-1", {
          baseRevision: editor.get("comp-1").revision,
          commands: [
            {
              type: "track.update",
              trackId: "track-v1",
              patch: {},
            },
          ],
        }),
      ).rejects.toThrow(/provide at least one track patch field/);

      await expect(
        editor.edit("comp-1", {
          baseRevision: editor.get("comp-1").revision,
          commands: [
            {
              type: "track.update",
              trackId: "non-existent",
              patch: { locked: true },
            },
          ],
        }),
      ).rejects.toThrow(/Track "non-existent" was not found/);
    });
  });

  describe("Stale revision guards", () => {
    it("rejects edit when baseRevision does not match current state", async () => {
      const { editor } = await fixture();
      await expect(
        editor.edit("comp-1", {
          baseRevision: "stale-revision-xyz",
          commands: [{ type: "lift", clipId: "clip-b" }],
        }),
      ).rejects.toThrow(/Timeline changed since this edit began/);
    });
  });

  describe("Batch sub-commands review validation and pin policy", () => {
    it("rejects a batched user-pin.resolve exactly like the direct command and writes nothing", async () => {
      const { app, directory, editor } = await fixture();
      const base = editor.get("comp-1");
      const resolve: TimelineCommand = {
        type: "user-pin.resolve",
        targets: [{ kind: "clip", clipId: "clip-a" }],
        scope: { kind: "beat", beatId: "no-such-beat" },
        mode: "regenerate",
      };
      await expect(
        editor.edit("comp-1", {
          baseRevision: base.revision,
          commands: [resolve],
        }),
      ).rejects.toThrow();
      await expect(
        editor.edit("comp-1", {
          baseRevision: base.revision,
          commands: [{ type: "batch", commands: [resolve] }],
        }),
      ).rejects.toThrow();
      expect(editor.get("comp-1").revision).toBe(base.revision);
      app.close();
      applications.delete(app);
      const reopened = await OpenFilmApplication.open(directory);
      applications.add(reopened);
      expect(new TimelineEditor(reopened).get("comp-1").revision).toBe(
        base.revision,
      );
    });

    it("rejects a batched user-pin.set false on a locked clip exactly like the direct command", async () => {
      const { editor } = await fixture();
      let state = await editor.edit("comp-1", {
        baseRevision: editor.get("comp-1").revision,
        commands: [
          {
            type: "user-pin.set",
            target: { kind: "clip", clipId: "clip-a" },
            pinned: true,
          },
        ],
      });
      state = await editor.edit("comp-1", {
        baseRevision: state.revision,
        commands: [{ type: "lock", clipId: "clip-a", locked: true }],
      });
      const unpin: TimelineCommand = {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "clip-a" },
        pinned: false,
      };
      await expect(
        editor.edit("comp-1", {
          baseRevision: state.revision,
          commands: [unpin],
        }),
      ).rejects.toThrow(/locked/);
      await expect(
        editor.edit("comp-1", {
          baseRevision: state.revision,
          commands: [{ type: "batch", commands: [unpin] }],
        }),
      ).rejects.toThrow(/locked/);
      const after = editor.get("comp-1");
      expect(after.revision).toBe(state.revision);
      expect(
        after.composition.tracks
          .flatMap((t) => t.clips)
          .find((c) => c.id === "clip-a")?.userOverrides?.isUserPinned,
      ).toBe(true);
    });

    it("rejects batch with reviewed volume when audioReviewId is non-existent", async () => {
      const { editor } = await fixture();
      const current = editor.get("comp-1");
      await expect(
        editor.edit("comp-1", {
          baseRevision: current.revision,
          commands: [
            {
              type: "batch",
              commands: [
                {
                  type: "volume",
                  clipId: "clip-a",
                  volume: 0.25,
                  audioReviewId: "nonexistent-review-id",
                },
              ],
            },
          ],
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("creates userOverrides pin when insert is wrapped in batch and persists across reopen", async () => {
      const { app, directory, editor } = await fixture();
      const current = editor.get("comp-1");
      const updated = await editor.edit("comp-1", {
        baseRevision: current.revision,
        commands: [
          {
            type: "batch",
            commands: [
              {
                type: "insert",
                assetId: "video-d",
                timelineStart: 4,
                sourceIn: 0,
                sourceOut: 2,
              },
            ],
          },
        ],
      });
      const inserted = updated.composition.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.assetId === "video-d")!;
      expect(inserted.userOverrides?.isUserPinned).toBe(true);

      // Verify persistence across reopen
      app.close();
      applications.delete(app);
      const reopened = await OpenFilmApplication.open(directory);
      applications.add(reopened);
      const reopenedEditor = new TimelineEditor(reopened);
      const reopenedClip = reopenedEditor
        .get("comp-1")
        .composition.tracks.flatMap((t) => t.clips)
        .find((c) => c.assetId === "video-d")!;
      expect(reopenedClip.userOverrides?.isUserPinned).toBe(true);
    });

    it("unpins clip when user-pin.set to false is wrapped in batch and persists across reopen", async () => {
      const { app, directory, editor } = await fixture();
      // First pin clip-a
      let state = await editor.edit("comp-1", {
        baseRevision: editor.get("comp-1").revision,
        commands: [
          {
            type: "user-pin.set",
            target: { kind: "clip", clipId: "clip-a" },
            pinned: true,
          },
        ],
      });
      let clipA = state.composition.tracks[0]!.clips.find(
        (c) => c.id === "clip-a",
      )!;
      expect(clipA.userOverrides?.isUserPinned).toBe(true);

      // Now unpin inside a batch
      state = await editor.edit("comp-1", {
        baseRevision: state.revision,
        commands: [
          {
            type: "batch",
            commands: [
              {
                type: "user-pin.set",
                target: { kind: "clip", clipId: "clip-a" },
                pinned: false,
              },
            ],
          },
        ],
      });
      clipA = state.composition.tracks[0]!.clips.find(
        (c) => c.id === "clip-a",
      )!;
      expect(clipA.userOverrides?.isUserPinned).toBe(false);

      // Reopen and check
      app.close();
      applications.delete(app);
      const reopened = await OpenFilmApplication.open(directory);
      applications.add(reopened);
      const reopenedEditor = new TimelineEditor(reopened);
      const reopenedClipA = reopenedEditor
        .get("comp-1")
        .composition.tracks[0]!.clips.find((c) => c.id === "clip-a")!;
      expect(reopenedClipA.userOverrides?.isUserPinned).toBe(false);
    });
  });
});
