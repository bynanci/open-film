import { describe, expect, it } from "vitest";
import {
  evaluateClipVisualAnimation,
  type MediaAsset,
  type ProjectTimebaseV1,
} from "@openfilm/core";
import { applyTimelineCommand, type EditorDocument } from "../src/index.js";

const timebase: ProjectTimebaseV1 = {
  version: 1,
  rateNumerator: 10,
  rateDenominator: 1,
  dropFrame: false,
};
const source: MediaAsset = {
  id: "source",
  name: "Synthetic source",
  uri: "file:///synthetic-source.mp4",
  mediaType: "video",
  duration: 10,
  tags: [],
  state: {},
  metadata: {},
};
function document(): EditorDocument {
  return {
    story: { id: "story", title: "Story", beats: [] },
    composition: {
      id: "composition",
      storyId: "story",
      duration: 2,
      tracks: [
        {
          id: "video-track",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: source.id,
              sourceIn: 0,
              sourceOut: 1,
              timelineStart: 0,
              timelineDuration: 1,
            },
          ],
        },
      ],
    },
  };
}
const animation = {
  version: 1 as const,
  visualTracks: [
    {
      property: "x" as const,
      keys: [
        { frame: 0, value: -20 },
        { frame: 9, value: 70 },
      ],
    },
    {
      property: "opacity" as const,
      keys: [
        { frame: 0, value: 0.4, interpolation: "hold" as const },
        { frame: 7, value: 1 },
      ],
    },
  ],
};

describe("typed clip animation edits", () => {
  it("saves a validated keyframe edit through the pin-aware command path", () => {
    const result = applyTimelineCommand(
      document(),
      [source],
      { type: "clip.animation.set", clipId: "clip", animation },
      {
        origin: "direct",
        timebase,
        frameSize: { width: 1920, height: 1080 },
      },
    );
    const clip = result.composition.tracks[0]!.clips[0]!;
    expect(clip.animation).toEqual(animation);
    expect(clip.userOverrides?.isUserPinned).toBe(true);
    expect(clip.userOverrides?.lockedAttributes).toContain("timing");
  });

  it("rejects keyframes outside the saved half-open output range and locked owners", () => {
    expect(() =>
      applyTimelineCommand(
        document(),
        [source],
        {
          type: "clip.animation.set",
          clipId: "clip",
          animation: {
            version: 1,
            visualTracks: [{ property: "x", keys: [{ frame: 10, value: 0 }] }],
          },
        },
        {
          origin: "direct",
          timebase,
          frameSize: { width: 1920, height: 1080 },
        },
      ),
    ).toThrow(/visible clip frame range/);
    const locked = document();
    locked.composition.tracks[0]!.locked = true;
    expect(() =>
      applyTimelineCommand(
        locked,
        [source],
        { type: "clip.animation.set", clipId: "clip", animation },
        {
          origin: "direct",
          timebase,
          frameSize: { width: 1920, height: 1080 },
        },
      ),
    ).toThrow(/locked/);
  });

  it("preserves keyed samples at an exact-frame split and trims only the removed tail", () => {
    const original = applyTimelineCommand(
      document(),
      [source],
      { type: "clip.animation.set", clipId: "clip", animation },
      { origin: "direct", timebase, frameSize: { width: 1920, height: 1080 } },
    );
    const split = applyTimelineCommand(
      original,
      [source],
      { type: "clip.split", clipId: "clip", sourceTime: 0.4 },
      { origin: "direct", timebase, frameSize: { width: 1920, height: 1080 } },
    );
    const [left, right] = split.composition.tracks[0]!.clips;
    expect(right).toBeDefined();
    for (let frame = 0; frame < 10; frame++) {
      const before = evaluateClipVisualAnimation(animation, frame);
      const after =
        frame < 4
          ? evaluateClipVisualAnimation(left!.animation, frame)
          : evaluateClipVisualAnimation(right!.animation, frame - 4);
      expect(after.x).toBeCloseTo(before.x, 8);
      expect(after.opacity).toBe(before.opacity);
    }

    const trimmed = applyTimelineCommand(
      original,
      [source],
      { type: "trim", clipId: "clip", sourceIn: 0, sourceOut: 0.4 },
      { origin: "direct", timebase, frameSize: { width: 1920, height: 1080 } },
    );
    const shortened = trimmed.composition.tracks[0]!.clips[0]!;
    expect(shortened.timelineDuration).toBeCloseTo(0.4);
    expect(shortened.animation?.visualTracks?.[0]?.keys.at(-1)).toMatchObject({
      frame: 3,
      value: 10,
    });
  });
});
