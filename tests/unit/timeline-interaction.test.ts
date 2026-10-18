import { describe, expect, it } from "vitest";
import type { Clip, Composition, MediaAsset } from "@openfilm/core";
import { applyTimelineCommand } from "@openfilm/solver";
import {
  clipTimeLayout,
  previewTimelineResize,
  resizeTimelineClip,
  timelineRuler,
  timelineSecondsFromPixels,
} from "../../apps/desktop/src/timelineInteraction";

const asset: MediaAsset = {
  id: "source",
  uri: "file:///motion.mp4",
  name: "Motion",
  mediaType: "video",
  duration: 20,
  tags: [],
  state: {},
  metadata: {},
};
const clip: Clip = {
  id: "clip",
  assetId: asset.id,
  sourceIn: 2,
  sourceOut: 10,
  timelineStart: 3,
  timelineDuration: 4,
  transform: { speed: 2 },
};

describe("time track geometry", () => {
  it("uses one scale for positions, widths and pointer deltas without card clamps", () => {
    expect(clipTimeLayout(clip, 48)).toEqual({ left: 144, width: 192 });
    expect(
      clipTimeLayout({ ...clip, timelineDuration: 0.1 }, 48).width,
    ).toBeCloseTo(4.8);
    expect(timelineSecondsFromPixels(96, 48)).toBe(2);
    expect(timelineSecondsFromPixels(-24, 24)).toBe(-1);
  });

  it("uses readable ruler ticks and bounds tick count for long timelines", () => {
    const ruler = timelineRuler(1500, 24);
    expect(ruler.step * 24).toBeGreaterThanOrEqual(64);
    expect(ruler.ticks[0]).toBe(0);
    expect(ruler.ticks.at(-1)).toBeGreaterThanOrEqual(1500);
    expect(ruler.ticks.length).toBeLessThanOrEqual(1001);
  });
});

describe("timeline edge resizing", () => {
  it("converts timeline seconds into source seconds at the clip playback speed", () => {
    const draft = resizeTimelineClip(clip, asset, "end", 1.5, 30)!;
    expect(draft.command).toEqual({
      type: "trim",
      clipId: "clip",
      sourceIn: 2,
      sourceOut: 13,
    });
    expect(draft.duration).toBe(5.5);
  });

  it("trims the source start while preserving the clip timeline anchor", () => {
    const draft = resizeTimelineClip(clip, asset, "start", 1, 30)!;
    expect(draft.command).toEqual({
      type: "trim",
      clipId: "clip",
      sourceIn: 4,
      sourceOut: 10,
    });
    expect(draft.duration).toBe(3);
  });

  it("stops at source boundaries and keeps at least one output frame", () => {
    expect(resizeTimelineClip(clip, asset, "start", -10, 30)!.sourceIn).toBe(0);
    expect(resizeTimelineClip(clip, asset, "end", 100, 30)!.sourceOut).toBe(20);
    for (const [edge, delta] of [
      ["start", 100],
      ["end", -100],
    ] as const) {
      const draft = resizeTimelineClip(clip, asset, edge, delta, 30)!;
      expect(draft.duration).toBeCloseTo(1 / 30);
      expect(draft.bounded).toBe(true);
    }
  });

  it("snaps small pointer movements to the output frame rate", () => {
    expect(resizeTimelineClip(clip, asset, "end", 0.001, 24)).toBeNull();
    expect(
      resizeTimelineClip(clip, asset, "end", 0.04, 24)!.duration,
    ).toBeCloseTo(4 + 1 / 24);
  });

  it("keeps a click or a drag returned to its origin free of accidental repair commands", () => {
    const legacy = { ...clip, sourceOut: 11 };
    expect(resizeTimelineClip(legacy, asset, "end", 0, 24)).toBeNull();
    expect(resizeTimelineClip(legacy, asset, "start", 0.001, 24)).toBeNull();
  });

  it("refuses impossible edge ranges rather than emitting a clip shorter than a frame", () => {
    const tiny = {
      ...clip,
      sourceIn: 19.99,
      sourceOut: 20,
      timelineDuration: 0.005,
    };
    expect(resizeTimelineClip(tiny, asset, "end", 1, 24)).toBeNull();
  });

  it("uses the correct inherited source bounds when legacy source fields are absent", () => {
    const legacy = { ...clip, sourceIn: undefined, sourceOut: undefined };
    expect(resizeTimelineClip(legacy, asset, "end", 1, 30)!.command).toEqual({
      type: "trim",
      clipId: "clip",
      sourceIn: 0,
      sourceOut: 10,
    });
  });

  it("adjusts photo duration from either edge without inventing a source trim", () => {
    const photo = {
      ...asset,
      mediaType: "image" as const,
      duration: undefined,
    };
    expect(resizeTimelineClip(clip, photo, "start", -2, 30)!.command).toEqual({
      type: "duration",
      clipId: "clip",
      duration: 6,
    });
    expect(
      resizeTimelineClip(clip, photo, "end", -100, 24)!.duration,
    ).toBeCloseTo(1 / 24);
  });

  it("protects locked, unavailable, unsupported or malformed media", () => {
    expect(
      resizeTimelineClip({ ...clip, locked: true }, asset, "end", 1, 30),
    ).toBeNull();
    expect(resizeTimelineClip(clip, undefined, "end", 1, 30)).toBeNull();
    expect(
      resizeTimelineClip(clip, { ...asset, duration: undefined }, "end", 1, 30),
    ).toBeNull();
    expect(
      resizeTimelineClip(
        clip,
        { ...asset, mediaType: "360-video" },
        "end",
        1,
        30,
      ),
    ).toBeNull();
    expect(
      resizeTimelineClip(
        { ...clip, transform: { speed: 0 } },
        asset,
        "end",
        1,
        30,
      ),
    ).toBeNull();
    expect(resizeTimelineClip(clip, asset, "end", Infinity, 30)).toBeNull();
  });

  it("keeps source selection locks separate from clip editing locks", () => {
    expect(
      resizeTimelineClip(
        clip,
        { ...asset, state: { locked: true } },
        "end",
        1,
        30,
      )?.duration,
    ).toBe(5);
  });

  it("previews the exact solver ripple across tracks, retaining overlaps, gaps and the original input", () => {
    const composition: Composition = {
      id: "cut",
      storyId: "story",
      duration: 12,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [clip, { ...clip, id: "next", timelineStart: 8 }],
        },
        {
          id: "audio",
          type: "audio",
          clips: [
            { ...clip, id: "overlap", timelineStart: 6 },
            { ...clip, id: "after", timelineStart: 7 },
          ],
        },
      ],
    };
    const before = structuredClone(composition);
    const draft = resizeTimelineClip(clip, asset, "end", 1, 30)!;
    const preview = previewTimelineResize(composition, clip.id, draft);
    const actual = applyTimelineCommand(
      { composition, story: { id: "story", title: "Story", beats: [] } },
      [asset],
      draft.command,
    );
    expect(preview).toEqual(actual.composition);
    expect(preview.tracks[0]!.clips[0]!.timelineStart).toBe(3);
    expect(preview.tracks[1]!.clips[0]!.timelineStart).toBe(6);
    expect(preview.tracks[1]!.clips[1]!.timelineStart).toBe(8);
    expect(composition).toEqual(before);
  });
});
