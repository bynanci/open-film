import { describe, expect, it } from "vitest";
import type { Clip, MediaAsset } from "@openfilm/core";
import {
  applyTimelineCommand,
  type EditorDocument,
  type TimelineCommand,
} from "../src/index.js";

const asset = (id: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id,
  name: id,
  uri: `file:///${id}`,
  mediaType: "video",
  duration: 30,
  tags: [],
  state: {},
  metadata: {},
  ...patch,
});

const assets = [
  asset("video-a", { duration: 20 }),
  asset("video-b", { duration: 20 }),
  asset("video-c", { duration: 20 }),
  asset("video-d", { duration: 20 }),
  asset("locked-asset", { duration: 20, state: { locked: true } }),
  asset("photo", { mediaType: "image" }),
];

function createTestDoc(): EditorDocument {
  return {
    story: {
      id: "test-story",
      title: "Test Story",
      targetDuration: 24,
      maxDuration: 30,
      beats: [
        { id: "beat-1", title: "Beat 1" },
        { id: "beat-2", title: "Beat 2" },
      ],
    },
    composition: {
      id: "test-comp",
      storyId: "test-story",
      duration: 24,
      tracks: [
        {
          id: "track-v1",
          type: "video",
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
      ],
    },
  };
}

const getClip = (doc: EditorDocument, id: string): Clip =>
  doc.composition.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;

const edit = (doc: EditorDocument, command: TimelineCommand): EditorDocument =>
  applyTimelineCommand(doc, assets, command);

describe("Professional Cut Desk Phase 2: Edit Semantics", () => {
  describe("Roll edit", () => {
    it("rolls adjacent boundary forward (extends outgoing, shortens incoming) preserving total duration", () => {
      const initial = createTestDoc();
      const updated = edit(initial, {
        type: "roll",
        clipIdA: "clip-a",
        clipIdB: "clip-b",
        delta: 2,
      });

      const clipA = getClip(updated, "clip-a");
      const clipB = getClip(updated, "clip-b");
      const clipC = getClip(updated, "clip-c");

      // Clip A: duration 6 -> 8, sourceOut 8 -> 10
      expect(clipA.timelineDuration).toBe(8);
      expect(clipA.sourceOut).toBe(10);
      expect(clipA.sourceIn).toBe(2);

      // Clip B: start 6 -> 8, duration 8 -> 6, sourceIn 5 -> 7, sourceOut 13
      expect(clipB.timelineStart).toBe(8);
      expect(clipB.timelineDuration).toBe(6);
      expect(clipB.sourceIn).toBe(7);
      expect(clipB.sourceOut).toBe(13);

      // Clip C and overall composition duration are unaffected
      expect(clipC.timelineStart).toBe(14);
      expect(clipC.timelineDuration).toBe(10);
      expect(updated.composition.duration).toBe(24);
    });

    it("rolls adjacent boundary backward (shortens outgoing, extends incoming)", () => {
      const initial = createTestDoc();
      const updated = edit(initial, {
        type: "roll",
        clipIdA: "clip-a",
        clipIdB: "clip-b",
        delta: -1.5,
      });

      const clipA = getClip(updated, "clip-a");
      const clipB = getClip(updated, "clip-b");

      // Clip A: duration 6 -> 4.5, sourceOut 8 -> 6.5
      expect(clipA.timelineDuration).toBe(4.5);
      expect(clipA.sourceOut).toBe(6.5);

      // Clip B: start 6 -> 4.5, duration 8 -> 9.5, sourceIn 5 -> 3.5
      expect(clipB.timelineStart).toBe(4.5);
      expect(clipB.timelineDuration).toBe(9.5);
      expect(clipB.sourceIn).toBe(3.5);

      expect(updated.composition.duration).toBe(24);
    });

    it("rejects roll edit if clips are not adjacent", () => {
      const initial = createTestDoc();
      expect(() =>
        edit(initial, {
          type: "roll",
          clipIdA: "clip-a",
          clipIdB: "clip-c",
          delta: 1,
        }),
      ).toThrow("Roll edit requires adjacent clips on the same track.");
    });

    it("rejects roll edit if either clip is locked", () => {
      const initial = createTestDoc();
      initial.composition.tracks[0]!.clips[0]!.locked = true;
      expect(() =>
        edit(initial, {
          type: "roll",
          clipIdA: "clip-a",
          clipIdB: "clip-b",
          delta: 1,
        }),
      ).toThrow('Cannot roll edit: clip "clip-a" is locked.');
    });

    it("rejects roll edit if media bounds would be exceeded", () => {
      const initial = createTestDoc();
      // Ensure clip-a has ample duration and keep adjacent
      const clipA = getClip(initial, "clip-a");
      clipA.timelineDuration = 10;
      clipA.sourceOut = 12;
      const clipB = getClip(initial, "clip-b");
      clipB.timelineStart = 10;
      const clipC = getClip(initial, "clip-c");
      clipC.timelineStart = 18;

      // clip-b has sourceIn = 5. Rolling backward by 6 would require sourceIn = -1.
      expect(() =>
        edit(initial, {
          type: "roll",
          clipIdA: "clip-a",
          clipIdB: "clip-b",
          delta: -6,
        }),
      ).toThrow('Roll edit exceeds start of source "video-b".');
    });

    it("rejects roll edit if clip duration would become zero or negative", () => {
      const initial = createTestDoc();
      // clip-a duration is 6. Rolling by -7 would result in negative duration.
      expect(() =>
        edit(initial, {
          type: "roll",
          clipIdA: "clip-a",
          clipIdB: "clip-b",
          delta: -7,
        }),
      ).toThrow(
        "Roll edit cannot shorten the outgoing clip to zero or negative duration.",
      );
    });
  });

  describe("Slip edit", () => {
    it("slips source in/out within media duration preserving timeline placement", () => {
      const initial = createTestDoc();
      const updated = edit(initial, {
        type: "slip",
        clipId: "clip-b",
        delta: 2,
      });

      const clipB = getClip(updated, "clip-b");
      // Original sourceIn: 5, sourceOut: 13 -> new sourceIn: 7, sourceOut: 15
      expect(clipB.sourceIn).toBe(7);
      expect(clipB.sourceOut).toBe(15);
      // Timeline start, duration and overall duration must be invariant
      expect(clipB.timelineStart).toBe(6);
      expect(clipB.timelineDuration).toBe(8);
      expect(updated.composition.duration).toBe(24);
    });

    it("slips source in/out backward", () => {
      const initial = createTestDoc();
      const updated = edit(initial, {
        type: "slip",
        clipId: "clip-b",
        delta: -3,
      });

      const clipB = getClip(updated, "clip-b");
      expect(clipB.sourceIn).toBe(2);
      expect(clipB.sourceOut).toBe(10);
      expect(clipB.timelineStart).toBe(6);
      expect(clipB.timelineDuration).toBe(8);
    });

    it("rejects slip edit if new source range extends before 0", () => {
      const initial = createTestDoc();
      // clip-b sourceIn is 5. delta of -6 would put sourceIn at -1.
      expect(() =>
        edit(initial, {
          type: "slip",
          clipId: "clip-b",
          delta: -6,
        }),
      ).toThrow('Cannot slip past the start of source "video-b".');
    });

    it("rejects slip edit if new source range extends past asset duration", () => {
      const initial = createTestDoc();
      // clip-b sourceOut is 13, asset duration is 20. delta of 8 would put sourceOut at 21.
      expect(() =>
        edit(initial, {
          type: "slip",
          clipId: "clip-b",
          delta: 8,
        }),
      ).toThrow('Cannot slip past the end of source "video-b".');
    });

    it("rejects slip edit on locked clip", () => {
      const initial = createTestDoc();
      initial.composition.tracks[0]!.clips[1]!.locked = true;
      expect(() =>
        edit(initial, {
          type: "slip",
          clipId: "clip-b",
          delta: 1,
        }),
      ).toThrow('Clip "clip-b" is locked. Unlock it before editing.');
    });
  });

  describe("Slide edit", () => {
    it("slides middle clip adjusting both adjacent neighbours without moving downstream clips", () => {
      const initial = createTestDoc();
      // Slide clip-b later by 1.5s
      const updated = edit(initial, {
        type: "slide",
        clipId: "clip-b",
        delta: 1.5,
      });

      const clipA = getClip(updated, "clip-a");
      const clipB = getClip(updated, "clip-b");
      const clipC = getClip(updated, "clip-c");

      // Clip A: extends duration 6 -> 7.5, sourceOut 8 -> 9.5
      expect(clipA.timelineDuration).toBe(7.5);
      expect(clipA.sourceOut).toBe(9.5);

      // Clip B: slides timelineStart 6 -> 7.5, duration remains 8, source range unchanged
      expect(clipB.timelineStart).toBe(7.5);
      expect(clipB.timelineDuration).toBe(8);
      expect(clipB.sourceIn).toBe(5);
      expect(clipB.sourceOut).toBe(13);

      // Clip C: timelineStart 14 -> 15.5, duration 10 -> 8.5, sourceIn 0 -> 1.5, end remains 24
      expect(clipC.timelineStart).toBe(15.5);
      expect(clipC.timelineDuration).toBe(8.5);
      expect(clipC.sourceIn).toBe(1.5);
      expect(clipC.sourceOut).toBe(10);

      // Overall composition duration is invariant
      expect(updated.composition.duration).toBe(24);
    });

    it("slides middle clip earlier adjusting both adjacent neighbours", () => {
      const initial = createTestDoc();
      const clipCInitial = getClip(initial, "clip-c");
      clipCInitial.sourceIn = 4;
      clipCInitial.sourceOut = 14;

      const updated = edit(initial, {
        type: "slide",
        clipId: "clip-b",
        delta: -2,
      });

      const clipA = getClip(updated, "clip-a");
      const clipB = getClip(updated, "clip-b");
      const clipC = getClip(updated, "clip-c");

      // Clip A: duration 6 -> 4, sourceOut 8 -> 6
      expect(clipA.timelineDuration).toBe(4);
      expect(clipA.sourceOut).toBe(6);

      // Clip B: timelineStart 6 -> 4, duration remains 8
      expect(clipB.timelineStart).toBe(4);
      expect(clipB.timelineDuration).toBe(8);

      // Clip C: timelineStart 14 -> 12, duration 10 -> 12, sourceIn 4 -> 2, sourceOut 14
      expect(clipC.timelineStart).toBe(12);
      expect(clipC.timelineDuration).toBe(12);
      expect(clipC.sourceIn).toBe(2);
      expect(clipC.sourceOut).toBe(14);
      expect(updated.composition.duration).toBe(24);
    });

    it("rejects slide edit if following clip source start is exceeded", () => {
      const initial = createTestDoc();
      // clip-c has sourceIn: 0. Sliding clip-b earlier (-1) would require clip-c sourceIn to be -1.
      expect(() =>
        edit(initial, {
          type: "slide",
          clipId: "clip-b",
          delta: -1,
        }),
      ).toThrow('Slide edit exceeds start of source "video-c".');
    });

    it("rejects slide edit if any involved neighbour is locked", () => {
      const initial = createTestDoc();
      initial.composition.tracks[0]!.clips[0]!.locked = true;
      expect(() =>
        edit(initial, {
          type: "slide",
          clipId: "clip-b",
          delta: 1,
        }),
      ).toThrow('Cannot slide edit: preceding clip "clip-a" is locked.');
    });
  });

  describe("Insert edit", () => {
    it("inserts media at an edit point, rippling downstream clips and expanding duration", () => {
      const initial = createTestDoc();
      const updated = edit(initial, {
        type: "insert",
        assetId: "video-d",
        timelineStart: 6,
        sourceIn: 0,
        sourceOut: 4,
      });

      const track = updated.composition.tracks[0]!;
      expect(track.clips.length).toBe(4);

      const clipA = getClip(updated, "clip-a");
      const clipB = getClip(updated, "clip-b");
      const clipC = getClip(updated, "clip-c");
      const inserted = track.clips.find((c) => c.assetId === "video-d")!;

      expect(clipA.timelineStart).toBe(0);
      expect(clipA.timelineDuration).toBe(6);

      expect(inserted.timelineStart).toBe(6);
      expect(inserted.timelineDuration).toBe(4);

      // Downstream clips rippled by +4s
      expect(clipB.timelineStart).toBe(10);
      expect(clipC.timelineStart).toBe(18);

      expect(updated.composition.duration).toBe(28);
    });

    it("inserts media inside an existing clip, splitting it and rippling downstream clips", () => {
      const initial = createTestDoc();
      // Insert at timelineStart 2 (inside clip-a [0..6])
      const updated = edit(initial, {
        type: "insert",
        assetId: "video-d",
        timelineStart: 2,
        sourceIn: 0,
        sourceOut: 3,
      });

      const track = updated.composition.tracks[0]!;
      // Original 3 clips + 1 insert + 1 split piece = 5 clips
      expect(track.clips.length).toBe(5);

      const clipA = getClip(updated, "clip-a");
      expect(clipA.timelineStart).toBe(0);
      expect(clipA.timelineDuration).toBe(2);
      expect(clipA.sourceOut).toBe(4); // original sourceIn 2 + 2 = 4

      const inserted = track.clips.find((c) => c.assetId === "video-d")!;
      expect(inserted.timelineStart).toBe(2);
      expect(inserted.timelineDuration).toBe(3);

      const splitPiece = track.clips.find((c) =>
        c.id.startsWith("clip-a-split-"),
      )!;
      expect(splitPiece.timelineStart).toBe(5); // 2 + 3
      expect(splitPiece.timelineDuration).toBe(4); // 6 - 2
      expect(splitPiece.sourceIn).toBe(4);
      expect(splitPiece.sourceOut).toBe(8);

      // Subsequent clips rippled by 3s
      const clipB = getClip(updated, "clip-b");
      expect(clipB.timelineStart).toBe(9); // 6 + 3
      expect(updated.composition.duration).toBe(27);
    });

    it("rejects insert edit if clip at insert point is locked", () => {
      const initial = createTestDoc();
      initial.composition.tracks[0]!.clips[0]!.locked = true;
      expect(() =>
        edit(initial, {
          type: "insert",
          assetId: "video-d",
          timelineStart: 2,
          sourceIn: 0,
          sourceOut: 3,
        }),
      ).toThrow('Cannot insert: clip "clip-a" at insert position is locked.');
    });
  });

  describe("Overwrite edit", () => {
    it("overwrites existing media without rippling downstream clips", () => {
      const initial = createTestDoc();
      // Overwrite [4..8] with video-d (duration 4)
      // clip-a is [0..6], clip-b is [6..14]
      // This overlaps clip-a from 4 to 6 (trims clip-a to [0..4])
      // and overlaps clip-b from 6 to 8 (trims clip-b start to 8)
      const updated = edit(initial, {
        type: "overwrite",
        assetId: "video-d",
        timelineStart: 4,
        sourceIn: 0,
        sourceOut: 4,
      });

      const clipA = getClip(updated, "clip-a");
      const clipB = getClip(updated, "clip-b");
      const clipC = getClip(updated, "clip-c");
      const overwritten = updated.composition.tracks[0]!.clips.find(
        (c) => c.assetId === "video-d",
      )!;

      // clip-a trimmed to 4s
      expect(clipA.timelineStart).toBe(0);
      expect(clipA.timelineDuration).toBe(4);
      expect(clipA.sourceOut).toBe(6);

      // overwritten clip placed at [4..8]
      expect(overwritten.timelineStart).toBe(4);
      expect(overwritten.timelineDuration).toBe(4);

      // clip-b trimmed from left: starts at 8, duration 8 - 2 = 6, sourceIn 5 + 2 = 7
      expect(clipB.timelineStart).toBe(8);
      expect(clipB.timelineDuration).toBe(6);
      expect(clipB.sourceIn).toBe(7);

      // clip-c is completely unmoved!
      expect(clipC.timelineStart).toBe(14);
      expect(clipC.timelineDuration).toBe(10);

      // Total sequence duration is unchanged!
      expect(updated.composition.duration).toBe(24);
    });

    it("punches an overwrite hole into the middle of a clip without rippling", () => {
      const initial = createTestDoc();
      // clip-c is [14..24] (duration 10). Overwrite [16..18] (duration 2).
      const updated = edit(initial, {
        type: "overwrite",
        assetId: "video-d",
        timelineStart: 16,
        sourceIn: 0,
        sourceOut: 2,
      });

      const track = updated.composition.tracks[0]!;
      expect(track.clips.length).toBe(5);

      const left = getClip(updated, "clip-c");
      expect(left.timelineStart).toBe(14);
      expect(left.timelineDuration).toBe(2);
      expect(left.sourceOut).toBe(2);

      const overwriteClip = track.clips.find((c) => c.assetId === "video-d")!;
      expect(overwriteClip.timelineStart).toBe(16);
      expect(overwriteClip.timelineDuration).toBe(2);

      const right = track.clips.find((c) => c.id.startsWith("clip-c-split-"))!;
      expect(right.timelineStart).toBe(18);
      expect(right.timelineDuration).toBe(6);
      expect(right.sourceIn).toBe(4);
      expect(right.sourceOut).toBe(10);

      expect(updated.composition.duration).toBe(24);
    });

    it("rejects overwrite edit if overlapping clip is locked", () => {
      const initial = createTestDoc();
      initial.composition.tracks[0]!.clips[1]!.locked = true;
      expect(() =>
        edit(initial, {
          type: "overwrite",
          assetId: "video-d",
          timelineStart: 7,
          sourceIn: 0,
          sourceOut: 2,
        }),
      ).toThrow(
        'Cannot overwrite: clip "clip-b" in the overwrite region is locked.',
      );
    });
  });

  describe("Lift edit", () => {
    it("lifts clip leaving a gap without rippling downstream clips", () => {
      const initial = createTestDoc();
      // Lift clip-b [6..14]
      const updated = edit(initial, {
        type: "lift",
        clipId: "clip-b",
      });

      const track = updated.composition.tracks[0]!;
      expect(track.clips.length).toBe(2);
      expect(track.clips.some((c) => c.id === "clip-b")).toBe(false);

      const clipA = getClip(updated, "clip-a");
      const clipC = getClip(updated, "clip-c");

      expect(clipA.timelineStart).toBe(0);
      expect(clipA.timelineDuration).toBe(6);

      // Downstream clip-c DOES NOT ripple! Retains gap [6..14]
      expect(clipC.timelineStart).toBe(14);
      expect(clipC.timelineDuration).toBe(10);

      // Duration remains 24
      expect(updated.composition.duration).toBe(24);
    });

    it("rejects lift edit on locked clip", () => {
      const initial = createTestDoc();
      initial.composition.tracks[0]!.clips[1]!.locked = true;
      expect(() =>
        edit(initial, {
          type: "lift",
          clipId: "clip-b",
        }),
      ).toThrow('Clip "clip-b" is locked. Unlock it before editing.');
    });
  });

  describe("Batch edit", () => {
    it("executes atomic batch of commands in order", () => {
      const initial = createTestDoc();
      const updated = edit(initial, {
        type: "batch",
        commands: [
          { type: "slip", clipId: "clip-a", delta: 1 },
          { type: "roll", clipIdA: "clip-a", clipIdB: "clip-b", delta: 1 },
        ],
        transactionId: "tx-test-batch",
      });

      const clipA = getClip(updated, "clip-a");
      const clipB = getClip(updated, "clip-b");

      // clip-a slipped by 1: sourceIn 2 -> 3, sourceOut 8 -> 9
      // then rolled by 1: duration 6 -> 7, sourceOut 9 -> 10
      expect(clipA.sourceIn).toBe(3);
      expect(clipA.sourceOut).toBe(10);
      expect(clipA.timelineDuration).toBe(7);

      // clip-b rolled by 1: start 6 -> 7, duration 8 -> 7, sourceIn 5 -> 6
      expect(clipB.timelineStart).toBe(7);
      expect(clipB.timelineDuration).toBe(7);
      expect(clipB.sourceIn).toBe(6);
    });

    it("aborts entire batch without mutation if any sub-command fails", () => {
      const initial = createTestDoc();
      expect(() =>
        edit(initial, {
          type: "batch",
          commands: [
            { type: "slip", clipId: "clip-a", delta: 1 },
            { type: "slip", clipId: "clip-b", delta: 100 }, // Fails!
          ],
        }),
      ).toThrow('Cannot slip past the end of source "video-b".');

      // Verify original is pristine
      const clipA = getClip(initial, "clip-a");
      expect(clipA.sourceIn).toBe(2);
      expect(clipA.sourceOut).toBe(8);
    });
  });
});
