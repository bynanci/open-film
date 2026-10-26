import { describe, expect, it } from "vitest";
import type {
  Clip,
  Composition,
  MediaAsset,
  ProjectTimebaseV1,
} from "../src/models.js";
import {
  primaryEditFrames,
  resolveClipFrameRange,
  resolveClipSourceRange,
  resolveCompositionFrame,
} from "../src/sequence.js";

const timebase: ProjectTimebaseV1 = {
  version: 1,
  rateNumerator: 20,
  rateDenominator: 1,
  dropFrame: false,
};
const video: MediaAsset = {
  id: "video",
  uri: "file:///video.mp4",
  name: "Video",
  mediaType: "video",
  duration: 10,
  tags: [],
  state: {},
  metadata: { "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] } },
};
const image: MediaAsset = {
  ...video,
  id: "image",
  uri: "file:///image.png",
  mediaType: "image",
  duration: undefined,
  metadata: {},
};
const audio: MediaAsset = {
  ...video,
  id: "audio",
  mediaType: "audio",
  metadata: {},
};
const clip = (overrides: Partial<Clip> = {}): Clip => ({
  id: "clip",
  assetId: video.id,
  timelineStart: 0,
  timelineDuration: 1,
  ...overrides,
});
const composition = (clips: Clip[]): Composition => ({
  id: "composition",
  storyId: "story",
  duration: 4,
  tracks: [{ id: "primary", type: "video", clips }],
});

describe("sequence frame ranges", () => {
  it.each([
    [0.01, 0.1, 0, 2],
    [0.03, 0.1, 1, 3],
    [0.03, 0.1000000001, 1, 3],
    [0.03, 0.100001, 1, 4],
  ])("rounds start %s and ceils duration %s", (start, duration, first, end) => {
    expect(
      resolveClipFrameRange(
        clip({ timelineStart: start, timelineDuration: duration }),
        timebase,
      ),
    ).toEqual({ startFrame: first, endFrame: end });
  });

  it("uses the exact rational timebase at a fractional-rate boundary", () => {
    expect(
      resolveClipFrameRange(
        clip({ timelineStart: 1001, timelineDuration: 1001 / 30000 }),
        { ...timebase, rateNumerator: 30000, rateDenominator: 1001 },
      ),
    ).toEqual({ startFrame: 30000, endFrame: 30001 });
  });

  it.each([
    { timelineStart: -1 },
    { timelineStart: NaN },
    { timelineDuration: 0 },
    { timelineDuration: -1 },
    { timelineDuration: Infinity },
  ])("rejects invalid clip timing %j", (overrides) => {
    expect(() => resolveClipFrameRange(clip(overrides), timebase)).toThrow();
  });

  it("rejects invalid rates and unsafe frame ranges", () => {
    expect(() =>
      resolveClipFrameRange(clip(), { ...timebase, rateDenominator: 0 }),
    ).toThrow();
    expect(() =>
      resolveClipFrameRange(
        clip({ timelineStart: Number.MAX_VALUE }),
        timebase,
      ),
    ).toThrow();
  });
});

describe("shared clip source ranges", () => {
  it("maps speed and caps an implicit range at the known source duration", () => {
    expect(
      resolveClipSourceRange(
        clip({ sourceIn: 9, transform: { speed: 2 } }),
        video,
      ),
    ).toEqual({ sourceIn: 9, sourceOut: 10, speed: 2 });
  });

  it("preserves explicit and derived ranges when asset duration is absent", () => {
    const unknownDuration = { ...video, duration: undefined };
    expect(
      resolveClipSourceRange(
        clip({ sourceIn: 2, transform: { speed: 2 } }),
        unknownDuration,
      ),
    ).toEqual({ sourceIn: 2, sourceOut: 4, speed: 2 });
    expect(
      resolveClipSourceRange(
        clip({ sourceIn: 2, sourceOut: 3 }),
        unknownDuration,
      ),
    ).toEqual({ sourceIn: 2, sourceOut: 3, speed: 1 });
    expect(resolveClipSourceRange(clip({ assetId: image.id }), image)).toEqual({
      sourceIn: 0,
      sourceOut: 1,
      speed: 1,
    });
  });

  it("preserves the renderer's 50ms source trim tolerance", () => {
    expect(resolveClipSourceRange(clip({ sourceOut: 10.05 }), video)).toEqual({
      sourceIn: 0,
      sourceOut: 10.05,
      speed: 1,
    });
    expect(() =>
      resolveClipSourceRange(clip({ sourceOut: 10.050001 }), video),
    ).toThrow(/source duration/i);
  });

  it.each([
    { sourceIn: -1 },
    { sourceIn: NaN },
    { sourceOut: Infinity },
    { sourceOut: 0 },
    { sourceIn: 2, sourceOut: 2 },
    { sourceIn: 2, sourceOut: 1 },
    { sourceIn: 11 },
    { transform: { speed: 0 } },
    { transform: { speed: -1 } },
    { transform: { speed: NaN } },
    { timelineDuration: 0 },
    { timelineDuration: Infinity },
  ])("rejects impossible source mapping %j", (overrides) => {
    expect(() => resolveClipSourceRange(clip(overrides), video)).toThrow();
  });

  it.each([0, -1, NaN, Infinity])(
    "rejects present invalid asset duration %s",
    (duration) => {
      expect(() =>
        resolveClipSourceRange(clip(), { ...video, duration }),
      ).toThrow();
    },
  );
});

describe("pure composition frame resolution", () => {
  it("resolves rounded first/last ticks, source speed, and half-open gaps", () => {
    const saved = composition([
      clip({
        timelineStart: 0.03,
        timelineDuration: 0.1,
        sourceIn: 2,
        transform: { speed: 2 },
      }),
      clip({ id: "later", timelineStart: 1 }),
    ]);
    expect(resolveCompositionFrame(saved, [video], 0, timebase)).toEqual({
      frame: 0,
      time: 0,
      primary: undefined,
      visual: [],
      audible: [],
    });
    const first = resolveCompositionFrame(saved, [video], 1, timebase);
    expect(first.time).toBe(0.05);
    expect(first.primary).toMatchObject({
      trackId: "primary",
      trackIndex: 0,
      clipIndex: 0,
      clip: saved.tracks[0]!.clips[0],
      asset: video,
      startFrame: 1,
      endFrame: 3,
      localTime: 0,
      sourceTime: 2,
      opacity: 1,
      visual: true,
      audible: true,
    });
    expect(first.visual).toEqual([first.primary]);
    expect(first.audible).toEqual([first.primary]);
    expect(
      resolveCompositionFrame(saved, [video], 2, timebase).primary,
    ).toMatchObject({
      localTime: 0.05,
      sourceTime: 2.1,
    });
    for (const frame of [3, 10, 19, 40, 80]) {
      const resolved = resolveCompositionFrame(saved, [video], frame, timebase);
      expect(resolved.primary).toBeUndefined();
      expect(resolved.visual).toEqual([]);
      expect(resolved.audible).toEqual([]);
    }
    expect(
      resolveCompositionFrame(saved, [video], 20, timebase).primary?.clip.id,
    ).toBe("later");
    expect(
      resolveCompositionFrame(saved, [video], 39, timebase).primary?.clip.id,
    ).toBe("later");
  });

  it("keeps saved layer/index order and uses only the first non-overlay video track as primary", () => {
    const saved = composition([clip({ id: "primary" })]);
    saved.tracks.unshift(
      {
        id: "overlay-video",
        type: "video",
        timing: "overlay",
        clips: [clip({ id: "overlay-video", assetId: image.id })],
      },
      {
        id: "music",
        type: "music",
        clips: [clip({ id: "music", assetId: audio.id })],
      },
      {
        id: "titles",
        type: "titles",
        clips: [clip({ id: "title", assetId: "", title: "Native title" })],
      },
    );
    saved.tracks.push(
      {
        id: "overlay",
        type: "overlay",
        clips: [
          clip({ id: "saved-first", timelineStart: 0.2, assetId: image.id }),
          clip({ id: "saved-second", assetId: image.id }),
        ],
      },
      {
        id: "second-video",
        type: "video",
        clips: [
          clip({ id: "second-video", assetId: image.id, timelineDuration: 2 }),
        ],
      },
    );
    const resolved = resolveCompositionFrame(
      saved,
      [video, image, audio],
      10,
      timebase,
    );
    expect(resolved.primary?.clip.id).toBe("primary");
    expect(
      resolved.visual.map((layer) => [
        layer.trackIndex,
        layer.clipIndex,
        layer.clip.id,
      ]),
    ).toEqual([
      [0, 0, "overlay-video"],
      [3, 0, "primary"],
      [4, 0, "saved-first"],
      [4, 1, "saved-second"],
      [5, 0, "second-video"],
    ]);
    expect(resolved.audible.map((layer) => layer.clip.id)).toEqual([
      "music",
      "primary",
    ]);
    expect(
      resolveCompositionFrame(saved, [video, image, audio], 25, timebase)
        .primary,
    ).toBeUndefined();
  });

  it("does not promote overlay/audio tracks when there is no primary video track", () => {
    const saved: Composition = {
      ...composition([]),
      tracks: [
        {
          id: "overlay",
          type: "overlay",
          clips: [clip({ assetId: image.id })],
        },
        { id: "audio", type: "audio", clips: [clip({ assetId: audio.id })] },
      ],
    };
    const resolved = resolveCompositionFrame(
      saved,
      [image, audio],
      0,
      timebase,
    );
    expect(resolved.primary).toBeUndefined();
    expect(resolved.visual).toHaveLength(1);
    expect(resolved.audible).toHaveLength(1);
    expect(primaryEditFrames(saved, timebase)).toEqual([]);
  });

  it("honors stream metadata and silent clips for audible resolution", () => {
    const saved = composition([
      clip({ id: "silent", transform: { volume: 0 } }),
      clip({ id: "picture-only", assetId: "silent-video" }),
      clip({ id: "sound", assetId: audio.id }),
    ]);
    const resolved = resolveCompositionFrame(
      saved,
      [video, audio, { ...video, id: "silent-video", metadata: {} }],
      0,
      timebase,
    );
    expect(resolved.visual.map((layer) => layer.clip.id)).toEqual([
      "silent",
      "picture-only",
    ]);
    expect(resolved.audible.map((layer) => layer.clip.id)).toEqual(["sound"]);
  });

  it("holds short source ranges instead of seeking past sourceOut", () => {
    const resolved = resolveCompositionFrame(
      composition([
        clip({ sourceIn: 1, sourceOut: 1.2, transform: { speed: 2 } }),
      ]),
      [video],
      15,
      timebase,
    );
    expect(resolved.primary?.sourceTime).toBe(1.2);
  });

  it("keeps outgoing crossfade tails opaque and fades the incoming clip at exact ticks", () => {
    // Saved order differs from chronological order to exercise stable layer order
    // while finding the same next chronological clip as the renderer.
    const saved = composition([
      clip({
        id: "incoming",
        timelineStart: 1,
        sourceIn: 3,
        transition: { type: "crossfade", duration: 0.3 },
      }),
      clip({ id: "outgoing", sourceIn: 1, sourceOut: 2 }),
    ]);
    for (const [frame, opacity] of [
      [20, 0],
      [23, 0.5],
      [26, 1],
    ] as const) {
      const resolved = resolveCompositionFrame(saved, [video], frame, timebase);
      expect(resolved.primary?.clip.id).toBe("incoming");
      expect(resolved.primary?.opacity).toBeCloseTo(opacity, 12);
      if (frame < 26) {
        expect(resolved.visual.map((layer) => layer.clip.id)).toEqual([
          "incoming",
          "outgoing",
        ]);
        expect(resolved.visual[1]).toMatchObject({
          opacity: 1,
          sourceTime: 2,
          audible: false,
        });
      } else
        expect(resolved.visual.map((layer) => layer.clip.id)).toEqual([
          "incoming",
        ]);
      expect(resolved.audible.map((layer) => layer.clip.id)).toEqual([
        "incoming",
      ]);
    }
    expect(
      resolveCompositionFrame(saved, [video], 19, timebase).primary?.clip.id,
    ).toBe("outgoing");
  });

  it("does not extend a tail through a gap and clips tails to composition bounds", () => {
    const gap = composition([
      clip(),
      clip({
        id: "next",
        timelineStart: 1.1,
        transition: { type: "crossfade", duration: 0.3 },
      }),
    ]);
    expect(resolveCompositionFrame(gap, [video], 20, timebase).visual).toEqual(
      [],
    );
    const bounded = {
      ...composition([
        clip(),
        clip({
          id: "next",
          timelineStart: 1,
          timelineDuration: 0.2,
          transition: { type: "crossfade", duration: 0.2 },
        }),
      ]),
      duration: 1.2,
    };
    expect(
      resolveCompositionFrame(bounded, [video], 23, timebase).visual,
    ).toHaveLength(2);
    expect(
      resolveCompositionFrame(bounded, [video], 24, timebase).visual,
    ).toEqual([]);
  });

  it("deduplicates sorted editable primary boundaries, excluding tails and other tracks", () => {
    const saved = composition([
      clip({ timelineStart: 2 }),
      clip(),
      clip({
        timelineStart: 1,
        transition: { type: "crossfade", duration: 0.3 },
      }),
    ]);
    saved.tracks.unshift({
      id: "overlay",
      type: "video",
      timing: "overlay",
      clips: [clip({ timelineStart: 0.25 })],
    });
    saved.tracks.push({
      id: "second",
      type: "video",
      clips: [clip({ timelineStart: 0.75 })],
    });
    expect(primaryEditFrames(saved, timebase)).toEqual([0, 20, 40, 60]);
  });

  it("is deeply equal by frame for forward, reverse and seeded random seeks without mutating saved inputs", () => {
    const saved = composition([
      clip({ id: "first", sourceIn: 2, transform: { speed: 2 } }),
      clip({
        id: "second",
        timelineStart: 1,
        sourceOut: 2,
        transition: { type: "crossfade", duration: 0.3 },
      }),
      clip({ id: "after-gap", timelineStart: 2.5, assetId: image.id }),
    ]);
    saved.tracks.push(
      {
        id: "overlay",
        type: "overlay",
        clips: [clip({ timelineStart: 0.4, assetId: image.id })],
      },
      {
        id: "music",
        type: "music",
        clips: [clip({ assetId: audio.id, timelineDuration: 4 })],
      },
    );
    const assets = [video, image, audio];
    const before = structuredClone({ saved, assets });
    const frames = Array.from({ length: 81 }, (_, frame) => frame);
    const expected = new Map(
      frames.map((frame) => [
        frame,
        resolveCompositionFrame(saved, assets, frame, timebase),
      ]),
    );
    const random = [...frames];
    let seed = 0x5eed;
    for (let index = random.length - 1; index > 0; index--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const other = seed % (index + 1);
      [random[index], random[other]] = [random[other]!, random[index]!];
    }
    for (const order of [frames, [...frames].reverse(), random])
      for (const frame of order)
        expect(resolveCompositionFrame(saved, assets, frame, timebase)).toEqual(
          expected.get(frame),
        );
    expect({ saved, assets }).toEqual(before);
  });

  it("fails explicitly for a missing source rather than synthesizing a clip", () => {
    expect(() =>
      resolveCompositionFrame(composition([clip()]), [], 0, timebase),
    ).toThrow(/missing asset video/i);
    expect(() =>
      resolveCompositionFrame(
        composition([clip({ sourceOut: 11 })]),
        [video],
        0,
        timebase,
      ),
    ).toThrow(/source duration/i);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid sequence frame %s",
    (frame) => {
      expect(() =>
        resolveCompositionFrame(composition([]), [], frame, timebase),
      ).toThrow();
    },
  );

  it.each([
    { type: "crossfade" as const, duration: -1 },
    { type: "crossfade" as const, duration: 2 },
    { type: "crossfade" as const, duration: NaN },
  ])("rejects invalid transition %j", (transition) => {
    expect(() =>
      resolveCompositionFrame(
        composition([clip({ transition })]),
        [video],
        0,
        timebase,
      ),
    ).toThrow();
  });
});
