import { describe, expect, it } from "vitest";
import {
  audioTimingFromHandles,
  buildAudioMixPlan,
  resolveAudioInterval,
  resolveClipAudioRange,
  resolveClipFrameRange,
  type Clip,
  type Composition,
  type MediaAsset,
  type AudioMixContext,
  type CoverageAudioBindingV1,
} from "../src/index.js";
const asset: MediaAsset = {
  id: "a",
  name: "Audio",
  uri: "file:///audio.wav",
  mediaType: "audio",
  duration: 30,
  tags: [],
  state: {},
  metadata: {},
};
const primary: Clip = {
  id: "p",
  assetId: "a",
  timelineStart: 0.017,
  timelineDuration: 10,
  sourceIn: 2,
  sourceOut: 12,
  audioAutomation: { version: 1, role: "dialogue", fadeIn: 2 },
};
const secondary: Clip = {
  id: "s",
  assetId: "a",
  timelineStart: 0,
  timelineDuration: 10,
  sourceIn: 0,
  sourceOut: 10,
  transform: { volume: 0.2 },
};
const timebase: AudioMixContext["timebase"] = {
  version: 1,
  rateNumerator: 30000,
  rateDenominator: 1001,
  dropFrame: false,
};
const composition = (...clips: Clip[]): Composition => ({
  id: "c",
  storyId: "story",
  duration: 12,
  tracks: [{ id: "v", type: "video", clips }],
});
function binding(
  mode:
    "keep-primary" | "mix-secondary" | "replace-primary" = "replace-primary",
  overrides: Partial<CoverageAudioBindingV1> = {},
): CoverageAudioBindingV1 {
  return {
    version: 1,
    bindingId: "b",
    compositionId: "c",
    primaryClipId: "p",
    secondaryClipId: "s",
    startSample: 192000,
    endSample: 288000,
    policy:
      mode === "keep-primary"
        ? { version: 1, mode }
        : { version: 1, mode, role: "ambience", gain: 0.5 },
    ...overrides,
  };
}
const plan = (
  coverage: CoverageAudioBindingV1[],
  clips = [primary, secondary],
) => buildAudioMixPlan(composition(...clips), [asset], { timebase, coverage });

describe("canonical sound timing", () => {
  it("preserves exact legacy floating trim and millisecond delay", () => {
    const clip = {
      ...primary,
      timelineStart: 0.0174321,
      sourceIn: 2.000013,
      sourceOut: 12.000019,
    };
    expect(resolveAudioInterval(clip, asset, 12)).toMatchObject({
      clock: "legacy",
      startSample: 816,
      legacyRange: resolveClipAudioRange(clip, asset),
      automationDurationSeconds: 10,
    });
    expect(
      buildAudioMixPlan(composition(clip), [asset], { timebase, coverage: [] })
        .legacyOnly,
    ).toBe(true);
    expect(Object.hasOwn(clip, "audioTiming")).toBe(false);
  });
  it.each([24, 25, 30, 30000 / 1001])(
    "uses 48 samples/ms without moving rational pictures at %s fps",
    (rate) => {
      const clock = {
        ...timebase,
        rateNumerator: rate === 30000 / 1001 ? 30000 : rate,
        rateDenominator: rate === 30000 / 1001 ? 1001 : 1,
      };
      const before = resolveClipFrameRange(primary, clock);
      const audioTiming = audioTimingFromHandles(primary, asset, {
        startOffsetMs: 0,
        endOffsetMs: 250,
      });
      expect(audioTiming).toEqual({
        version: 1,
        sampleRate: 48000,
        timelineStartSample: 816,
        sourceInSample: 96000,
        sourceOutSample: 588000,
      });
      expect(resolveClipFrameRange({ ...primary, audioTiming }, clock)).toEqual(
        before,
      );
    },
  );
  it.each([0.5, 1, 2])("derives independent duration at speed %s", (speed) => {
    const clip = {
      ...primary,
      transform: { speed },
      audioTiming: {
        version: 1 as const,
        sampleRate: 48000 as const,
        timelineStartSample: 1001,
        sourceInSample: 48000,
        sourceOutSample: 144000,
      },
    };
    const interval = resolveAudioInterval(clip, asset, 12);
    expect(interval.startSample).toBe(1001);
    expect(interval.endSample).toBe(1001 + 96000 / speed);
    expect(interval.automationDurationSeconds).toBe(2 / speed);
    const moved = audioTimingFromHandles(clip, asset, {
      startOffsetMs: -1,
      endOffsetMs: 1,
    });
    expect(moved.timelineStartSample).toBe(953);
    expect(moved.sourceInSample).toBe(48000 - 48 * speed);
    expect(moved.sourceOutSample).toBe(144000 + 48 * speed);
  });
  it("supports a one-sample range and rejects unsafe, exhausted, absent or unknown sources", () => {
    const clip: Clip = {
      ...primary,
      audioTiming: {
        version: 1,
        sampleRate: 48000,
        timelineStartSample: 0,
        sourceInSample: 0,
        sourceOutSample: 1,
      },
    };
    expect(resolveAudioInterval(clip, asset, 12).endSample).toBe(1);
    for (const changed of [
      { ...asset, duration: undefined },
      { ...asset, duration: 0 },
      { ...asset, duration: 1 / 96000 },
      { ...asset, mediaType: "image" as const },
      { ...asset, mediaType: "video" as const },
    ])
      expect(() => resolveAudioInterval(clip, changed, 12)).toThrow();
    expect(() =>
      audioTimingFromHandles(primary, asset, {
        startOffsetMs: -18,
        endOffsetMs: 0,
      }),
    ).toThrow();
    expect(() =>
      audioTimingFromHandles(primary, asset, {
        startOffsetMs: 0,
        endOffsetMs: 60001,
      }),
    ).toThrow();
    expect(() =>
      audioTimingFromHandles(primary, asset, {
        startOffsetMs: 0.5,
        endOffsetMs: 0,
      }),
    ).toThrow();
    expect(() =>
      resolveAudioInterval(
        {
          ...clip,
          audioTiming: {
            ...clip.audioTiming!,
            timelineStartSample: Number.MAX_SAFE_INTEGER,
          },
        },
        asset,
        12,
      ),
    ).toThrow();
  });
});
describe("bounded occurrence audio policy", () => {
  it("admits secondary only through bindings and replaces its base gain once", () => {
    const result = plan([binding("mix-secondary")]);
    expect(
      result.segments.map((s) => [
        s.clipId,
        s.startSample,
        s.endSample,
        s.role,
        s.baseGain,
      ]),
    ).toEqual([
      ["s", 192000, 288000, "ambience", 0.5],
      ["p", 816, 480816, "dialogue", 1],
    ]);
    expect(result.masks).toContainEqual({
      clipId: "s",
      startSample: 0,
      endSample: 192000,
      reason: "excluded-secondary",
    });
    expect(result.masks).toContainEqual({
      clipId: "s",
      startSample: 288000,
      endSample: 480000,
      reason: "excluded-secondary",
    });
  });
  it("keep-primary excludes secondary even without a stream", () => {
    expect(
      plan([binding("keep-primary")]).segments.map((s) => s.clipId),
    ).toEqual(["p"]);
    const silent: MediaAsset = {
      ...asset,
      id: "silent",
      mediaType: "video",
      metadata: {},
    };
    expect(
      buildAudioMixPlan(
        composition(primary, { ...secondary, assetId: "silent" }),
        [asset, silent],
        { timebase, coverage: [binding("keep-primary")] },
      ).segments.map((s) => s.clipId),
    ).toEqual(["p"]);
    expect(() =>
      buildAudioMixPlan(
        composition(primary, { ...secondary, assetId: "silent" }),
        [asset, silent],
        { timebase, coverage: [binding()] },
      ),
    ).toThrow();
  });
  it("replacement_precedes_stem_role_selection and fragment_keeps_original_automation_origin", () => {
    const result = plan([
      binding(),
      binding("replace-primary", {
        bindingId: "b2",
        startSample: 384000,
        endSample: 432000,
      }),
    ]);
    const dialogue = result.segments.filter((s) => s.role === "dialogue");
    expect(dialogue.map((s) => [s.startSample, s.endSample])).toEqual([
      [816, 192000],
      [288000, 384000],
      [432000, 480816],
    ]);
    expect(
      dialogue.every(
        (s) =>
          s.automationStartSample === 816 &&
          s.sourceInSeconds === 2 &&
          s.automationDurationSeconds === 10,
      ),
    ).toBe(true);
    expect(
      result.masks
        .filter((m) => m.reason === "replaced-primary")
        .map((m) => m.clipId),
    ).toEqual(["p", "p"]);
    expect(new Set(result.segments.map((s) => s.key)).size).toBe(
      result.segments.length,
    );
  });
  it("same_asset_distinct_occurrences and stable saved ordering", () => {
    const unrelated = { ...secondary, id: "unrelated" };
    expect(
      plan(
        [binding("keep-primary")],
        [primary, secondary, unrelated],
      ).segments.map((s) => s.clipId),
    ).toEqual(["unrelated", "p"]);
  });
  it("rejects overlapping ownership, recursive roles, foreign identities and over-budget inputs", () => {
    for (const coverage of [
      [binding(), binding("mix-secondary", { bindingId: "b2" })],
      [
        binding(),
        binding("replace-primary", { bindingId: "b2", secondaryClipId: "u" }),
      ],
      [
        binding(),
        binding("mix-secondary", {
          bindingId: "b2",
          primaryClipId: "s",
          secondaryClipId: "u",
        }),
      ],
      [binding("mix-secondary", { compositionId: "foreign" })],
      [binding("mix-secondary", { primaryClipId: "missing" })],
      [binding("mix-secondary", { startSample: 0 })],
      Array.from({ length: 1001 }, (_, i) =>
        binding("keep-primary", { bindingId: `b${i}` }),
      ),
    ])
      expect(() =>
        plan(coverage, [primary, secondary, { ...secondary, id: "u" }]),
      ).toThrow();
    const clips = Array.from({ length: 10001 }, (_, i) => ({
      ...secondary,
      id: `c${i}`,
    }));
    expect(() => plan([], clips)).toThrow(/budget/);
  });
});
