import { describe, expect, it } from "vitest";
import {
  createProject,
  validateProject,
  type Clip,
  type MediaAsset,
} from "@openfilm/core";
import { applyTimelineCommand, type EditorDocument } from "../src/index.js";

const source: MediaAsset = {
  id: "video",
  name: "A memory",
  uri: "file:///memory.mp4",
  mediaType: "video",
  duration: 20,
  tags: [],
  state: {},
  metadata: {},
};

function document(): EditorDocument {
  return {
    story: {
      id: "story",
      title: "Proposal",
      beats: [
        {
          id: "beat",
          title: "Memories",
          selectedAssetIds: ["video"],
          constraints: [{ type: "must-include", assetIds: ["video"] }],
        },
      ],
    },
    composition: {
      id: "film",
      storyId: "story",
      duration: 15,
      tracks: [
        {
          id: "visual",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: "video",
              beatId: "beat",
              sourceIn: 3,
              sourceOut: 15,
              timelineStart: 2,
              timelineDuration: 6,
              transform: {
                speed: 2,
                volume: 0.4,
                scale: 1.3,
                rotation: 90,
                x: 12,
              },
              transition: { type: "crossfade", duration: 0.5 },
              title: "Together",
            },
            {
              id: "next",
              assetId: "video",
              sourceIn: 1,
              sourceOut: 5,
              timelineStart: 10,
              timelineDuration: 4,
            },
          ],
        },
        {
          id: "audio",
          type: "audio",
          clips: [
            {
              id: "overlap",
              assetId: "video",
              sourceIn: 0,
              sourceOut: 10,
              timelineStart: 1,
              timelineDuration: 10,
              locked: true,
            },
          ],
        },
      ],
    },
  };
}

function split(before: EditorDocument, sourceTime = 7): EditorDocument {
  return applyTimelineCommand(before, [source], {
    type: "clip.split",
    clipId: "clip",
    sourceTime,
  });
}

describe("non-destructive source-time split command", () => {
  it("preserves exact source coverage, speed, later gaps/overlaps, required selections and composition length", () => {
    const before = document();
    const next = split(before);
    const [left, right, later] = next.composition.tracks[0]!.clips;
    expect(left).toMatchObject({
      id: "clip",
      sourceIn: 3,
      sourceOut: 7,
      timelineStart: 2,
      timelineDuration: 2,
      transition: { type: "crossfade", duration: 0.5 },
    });
    expect(right).toMatchObject({
      id: "clip-split-1",
      sourceIn: 7,
      sourceOut: 15,
      timelineStart: 4,
      timelineDuration: 4,
      assetId: "video",
      beatId: "beat",
      title: "Together",
      transform: before.composition.tracks[0]!.clips[0]!.transform,
    });
    expect(right).not.toHaveProperty("transition");
    expect(later).toEqual(before.composition.tracks[0]!.clips[1]);
    expect(next.composition.tracks[1]).toEqual(before.composition.tracks[1]);
    expect(next.composition.duration).toBe(15);
    expect(next.story).toEqual(before.story);
    expect(left!.timelineDuration + right!.timelineDuration).toBe(6);
    expect(before).toEqual(document());
    expect(split(before)).toEqual(next);
  });

  it("remains project-valid after serialization and keeps independent detached history snapshots", () => {
    const before = document();
    const after = split(before);
    const manifest = {
      ...createProject("Proposal"),
      stories: [after.story],
      timelines: [after.composition],
    };
    const reopened = validateProject(JSON.parse(JSON.stringify(manifest)), {
      assetIds: ["video"],
    });
    expect(reopened.timelines[0]).toEqual(after.composition);
    const undo = structuredClone(before);
    const redo = structuredClone(after);
    redo.composition.tracks[0]!.clips[1]!.transform!.volume = 0;
    expect(before).toEqual(undo);
    expect(after.composition.tracks[0]!.clips[1]!.transform!.volume).toBe(0.4);
  });

  it("keeps audio splits on their existing track and retains only the original incoming fade", () => {
    const before = document();
    before.composition.tracks[0]!.type = "audio";
    const audio = { ...source, mediaType: "audio" as const };
    const after = applyTimelineCommand(before, [audio], {
      type: "clip.split",
      clipId: "clip",
      sourceTime: 7,
    });
    expect(after.composition.tracks[0]!.type).toBe("audio");
    expect(after.composition.tracks[0]!.clips[0]!.transition!.duration).toBe(
      0.5,
    );
    expect(after.composition.tracks[0]!.clips[1]).not.toHaveProperty(
      "transition",
    );
  });

  it("rejects splits inside an incoming crossfade rather than silently changing the fade", () => {
    const before = document();
    expect(() => split(before, 3.2)).toThrow("after the incoming crossfade");
    expect(before).toEqual(document());
    const cut = applyTimelineCommand(before, [source], {
      type: "transition",
      clipId: "clip",
      transition: "cut",
    });
    expect(
      split(cut, 3.2).composition.tracks[0]!.clips[0]!.timelineDuration,
    ).toBeCloseTo(0.1);
  });

  it("derives missing source bounds and avoids duplicate split IDs across tracks", () => {
    const before = document();
    const clip = before.composition.tracks[0]!.clips[0]!;
    delete clip.sourceIn;
    delete clip.sourceOut;
    before.composition.tracks[1]!.clips[0]!.id = "clip-split-1";
    const next = split(before, 4);
    expect(next.composition.tracks[0]!.clips[0]).toMatchObject({
      sourceIn: 0,
      sourceOut: 4,
      timelineDuration: 2,
    });
    expect(next.composition.tracks[0]!.clips[1]).toMatchObject({
      id: "clip-split-2",
      sourceIn: 4,
      sourceOut: 12,
      timelineDuration: 4,
    });
  });

  it.each([3, 15, 20, -1, NaN, Infinity])(
    "rejects split outside the selected range: %s",
    (sourceTime) => {
      expect(() => split(document(), sourceTime)).toThrow();
    },
  );

  it("rejects locked, image/360, stale source bounds and inconsistent source timing", () => {
    const locked = document();
    locked.composition.tracks[0]!.clips[0]!.locked = true;
    expect(() => split(locked)).toThrow("locked");
    expect(() =>
      applyTimelineCommand(
        document(),
        [{ ...source, state: { locked: true } }],
        { type: "clip.split", clipId: "clip", sourceTime: 7 },
      ),
    ).toThrow("locked");
    for (const mediaType of ["image", "360-video"] as const)
      expect(() =>
        applyTimelineCommand(document(), [{ ...source, mediaType }], {
          type: "clip.split",
          clipId: "clip",
          sourceTime: 7,
        }),
      ).toThrow("flat video or audio");
    const stale = { ...source, duration: 10 };
    expect(() =>
      applyTimelineCommand(document(), [stale], {
        type: "clip.split",
        clipId: "clip",
        sourceTime: 7,
      }),
    ).toThrow("actual duration");
    const inconsistent = document();
    inconsistent.composition.tracks[0]!.clips[0]!.timelineDuration = 4;
    expect(() => split(inconsistent)).toThrow("disagree");
    const badSpeed = document();
    badSpeed.composition.tracks[0]!.clips[0]!.transform!.speed = 0;
    expect(() => split(badSpeed)).toThrow("Speed");
  });

  it("can split the resulting right half again without source duplication or duration change", () => {
    const first = split(document());
    const second = applyTimelineCommand(first, [source], {
      type: "clip.split",
      clipId: "clip-split-1",
      sourceTime: 11,
    });
    const pieces = second.composition.tracks[0]!.clips.filter(
      (clip) => clip.id !== "next",
    );
    expect(
      pieces.map(({ sourceIn, sourceOut }) => [sourceIn, sourceOut]),
    ).toEqual([
      [3, 7],
      [7, 11],
      [11, 15],
    ]);
    expect(pieces.map((clip: Clip) => clip.timelineStart)).toEqual([2, 4, 6]);
    expect(second.composition.duration).toBe(15);
  });
});
