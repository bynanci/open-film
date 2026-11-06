import { describe, expect, it } from "vitest";
import {
  applyTimelineCommand,
  applyTimelineCommandInBatch,
  validateAudioEdit,
  type EditorDocument,
  type TimelineCommand,
} from "../src/index.js";
import {
  evaluateAudioGain,
  buildAudioMixPlan,
  resolveProjectTimebase,
  type MediaAsset,
  type AudioTimingV1,
} from "@openfilm/core";
const context = {
  origin: "direct" as const,
  timebase: resolveProjectTimebase({ width: 640, height: 360, frameRate: 30 }),
};
const assets: MediaAsset[] = [
  {
    id: "v",
    name: "V",
    uri: "file:///v.mp4",
    mediaType: "video",
    duration: 20,
    tags: [],
    state: {},
    metadata: { "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] } },
  },
];
const timing: AudioTimingV1 = {
  version: 1,
  sampleRate: 48000,
  timelineStartSample: 0,
  sourceInSample: 48000,
  sourceOutSample: 192000,
};
function doc(): EditorDocument {
  return {
    story: {
      id: "s",
      title: "Story",
      beats: [{ id: "b", title: "Beat", candidateAssetIds: ["v"] }],
    },
    composition: {
      id: "c",
      storyId: "s",
      duration: 8,
      tracks: [
        {
          id: "v",
          type: "video",
          clips: [
            {
              id: "a",
              assetId: "v",
              beatId: "b",
              timelineStart: 0,
              timelineDuration: 4,
              sourceIn: 1,
              sourceOut: 5,
            },
            {
              id: "b",
              assetId: "v",
              beatId: "b",
              timelineStart: 4,
              timelineDuration: 4,
              sourceIn: 5,
              sourceOut: 9,
            },
          ],
        },
      ],
    },
  };
}
const clip = (d: EditorDocument, index = 0) =>
  d.composition.tracks[0]!.clips[index]!;
function explicit() {
  const d = doc();
  clip(d).audioTiming = structuredClone(timing);
  clip(d, 1).audioTiming = {
    ...timing,
    timelineStartSample: 192000,
    sourceInSample: 240000,
    sourceOutSample: 432000,
  };
  return d;
}
function caption(d: EditorDocument) {
  d.composition.captionTracks = [
    {
      version: 1,
      id: "ct",
      name: "English",
      style: { version: 1, role: "subtitle" },
      cues: [
        {
          version: 1,
          id: "cue",
          startMs: 1000,
          endMs: 2000,
          text: "Speech",
          manualRevision: 0,
          source: {
            kind: "transcript",
            assetId: "v",
            transcriptId: "t",
            transcriptRevisionId: "r",
            segmentId: "seg",
            clipId: "a",
            alignment: "segment",
            sourceIn: 2,
            sourceOut: 3,
          },
        },
      ],
    },
  ];
}

describe("independent sound edit policy", () => {
  it("sets and resets one existing occurrence, preserving pins and input objects", () => {
    const before = doc(),
      frozen = structuredClone(before);
    const after = applyTimelineCommand(
      before,
      assets,
      { type: "audio.timing", clipId: "a", timing },
      context,
    );
    expect(clip(after).audioTiming).toEqual(timing);
    expect(clip(after).userOverrides?.isUserPinned).toBe(true);
    expect(before).toEqual(frozen);
    const reset = applyTimelineCommand(
      after,
      assets,
      { type: "audio.timing", clipId: "a", timing: null },
      context,
    );
    expect(clip(reset).audioTiming).toBeUndefined();
    expect(clip(reset).userOverrides).toEqual(clip(after).userOverrides);
  });
  it("keeps target sound through trim and translates ripple peers by actual saved sample delta", () => {
    const before = explicit();
    const after = applyTimelineCommand(
      before,
      assets,
      { type: "trim", clipId: "a", sourceIn: 2, sourceOut: 5 },
      context,
    );
    expect(clip(after).audioTiming).toEqual(timing);
    expect(clip(after, 1).timelineStart).toBe(3);
    expect(clip(after, 1).audioTiming).toEqual({
      ...clip(before, 1).audioTiming,
      timelineStartSample: 144000,
    });
  });
  it("retains sound source bounds and start on speed edits", () => {
    const before = explicit();
    clip(before).audioTiming!.sourceOutSample = 144000;
    const after = applyTimelineCommand(
      before,
      assets,
      { type: "speed", clipId: "a", speed: 2 },
      context,
    );
    expect(clip(after).audioTiming).toEqual(clip(before).audioTiming);
    expect(clip(after, 1).audioTiming!.timelineStartSample).toBe(96000);
  });
  it("keeps repeated rational-frame moves on one saved sample clock", () => {
    const before = explicit(),
      rationalContext = {
        ...context,
        timebase: resolveProjectTimebase({
          width: 640,
          height: 360,
          frameRate: 30000 / 1001,
        }),
      },
      frameDuration = 1001 / 30000;
    const overlay = clip(before, 1);
    before.composition.tracks[0]!.clips.pop();
    clip(before).timelineDuration = 8;
    clip(before).sourceOut = 9;
    overlay.timelineStart = 1;
    overlay.timelineDuration = 1;
    overlay.sourceOut = 6;
    overlay.audioTiming = {
      ...overlay.audioTiming!,
      // A saved non-frame-aligned offset must survive both editing paths.
      timelineStartSample: 48017,
      sourceOutSample: 288000,
    };
    before.composition.tracks.push({
      id: "sound",
      type: "audio",
      timing: "overlay",
      clips: [overlay],
    });
    let repeated = before;
    for (let frame = 1; frame <= 10; frame++)
      repeated = applyTimelineCommand(
        repeated,
        assets,
        {
          type: "audio.move",
          clipId: "b",
          timelineStart: 1 + frame * frameDuration,
        },
        rationalContext,
      );
    const single = applyTimelineCommand(
      before,
      assets,
      {
        type: "audio.move",
        clipId: "b",
        timelineStart: 1 + 10 * frameDuration,
      },
      rationalContext,
    );
    const moved = repeated.composition.tracks[1]!.clips[0]!,
      once = single.composition.tracks[1]!.clips[0]!;
    expect(moved.timelineStart).toBe(once.timelineStart);
    expect(moved.audioTiming).toEqual(once.audioTiming);
    expect(moved.audioTiming!.timelineStartSample).toBe(64033);
  });
  it.each([
    { type: "clip.split", clipId: "a", sourceTime: 2 },
    { type: "replace", clipId: "a", assetId: "v" },
  ] as TimelineCommand[])(
    "fails closed on %s until explicit reset",
    (command) => {
      const before = explicit();
      expect(() =>
        applyTimelineCommand(before, assets, command, context),
      ).toThrow(/relink|reset/i);
      expect(clip(before).audioTiming).toEqual(timing);
    },
  );
  it("splits automation by exact clip-local clock while preserving source locks and timing", () => {
    const before = doc(),
      original = clip(before);
    original.transform = { speed: 2 };
    original.sourceOut = 9;
    original.audioAutomation = {
      version: 1,
      role: "dialogue",
      fadeIn: 1,
      fadeOut: 2,
      points: [
        { time: 0, gain: 0.2 },
        { time: 2, gain: 0.8 },
        { time: 4, gain: 0.4 },
      ],
      ducking: [{ start: 0.5, end: 3.5, gain: 0.5, attack: 0.5, release: 1 }],
    };
    const originalAutomation = structuredClone(original.audioAutomation),
      after = applyTimelineCommand(
        before,
        assets,
        { type: "clip.split", clipId: "a", sourceTime: 3 },
        context,
      ),
      [left, right] = after.composition.tracks[0]!.clips;

    expect(left).toMatchObject({
      timelineDuration: 1,
      sourceIn: 1,
      sourceOut: 3,
    });
    expect(right).toMatchObject({
      id: "a-split-1",
      timelineStart: 1,
      timelineDuration: 3,
      sourceIn: 3,
      sourceOut: 9,
    });
    expect(left!.audioAutomation).toMatchObject({
      version: 2,
      timeMap: { continuityId: "a", offsetSamples: 0, durationSamples: 192000 },
    });
    expect(right!.audioAutomation).toMatchObject({
      version: 2,
      timeMap: {
        continuityId: "a",
        offsetSamples: 48000,
        durationSamples: 192000,
      },
    });
    for (const [fragment, offsetSamples, count] of [
      [left!, 0, 48000],
      [right!, 48000, 144000],
    ] as const)
      for (let sample = 0; sample < count; sample++)
        expect(
          evaluateAudioGain(
            fragment.audioAutomation,
            sample / 48000,
            fragment.timelineDuration,
          ),
        ).toBe(
          evaluateAudioGain(
            originalAutomation,
            (offsetSamples + sample) / 48000,
            4,
          ),
        );
    expect(before.composition.tracks[0]!.clips[0]!.audioAutomation).toEqual(
      originalAutomation,
    );
  });
  it.each([1, 1.25, 2])(
    "retains one sample clock through repeated right-fragment splits at %sx speed",
    (speed) => {
      const before = doc(),
        original = clip(before);
      original.transform = { speed };
      original.sourceOut = 1 + 4 * speed;
      original.audioAutomation = {
        version: 1,
        role: "dialogue",
        fadeIn: 1,
        fadeOut: 2,
        points: [
          { time: 0, gain: 0.2 },
          { time: 2, gain: 0.8 },
          { time: 4, gain: 0.4 },
        ],
        ducking: [{ start: 0.5, end: 3.5, gain: 0.5, attack: 0.5, release: 1 }],
      };
      const snapshot = structuredClone(before);
      let after = before;
      for (const time of [1, 2.5, 3.25]) {
        const target = after.composition.tracks[0]!.clips.find(
          (item) =>
            item.timelineStart < time &&
            item.timelineStart + item.timelineDuration > time,
        )!;
        after = applyTimelineCommand(
          after,
          assets,
          {
            type: "clip.split",
            clipId: target.id,
            sourceTime: 1 + time * speed,
          },
          context,
        );
      }
      const fragments = after.composition.tracks[0]!.clips.filter(
        (item) => item.timelineStart < 4,
      );
      expect(fragments).toHaveLength(4);
      for (const [index, fragment] of fragments.entries()) {
        const start = [0, 1, 2.5, 3.25][index]!,
          duration = [1, 1.5, 0.75, 0.75][index]!;
        expect(fragment).toMatchObject({
          timelineStart: start,
          timelineDuration: duration,
          sourceIn: 1 + start * speed,
          sourceOut: 1 + (start + duration) * speed,
          audioAutomation: {
            version: 2,
            timeMap: {
              continuityId: "a",
              offsetSamples: start * 48000,
              durationSamples: 192000,
              speed,
            },
          },
        });
        for (const local of [0, duration / 2, duration - 1 / 48000])
          expect(
            evaluateAudioGain(fragment.audioAutomation, local, duration),
          ).toBe(evaluateAudioGain(original.audioAutomation, start + local, 4));
      }
      expect(before).toEqual(snapshot);
    },
  );
  it("keeps absolute placement and source clocks through fractional repeated splits", () => {
    const before = doc(),
      original = clip(before),
      sourceIn = 0.1234567,
      start = 0.00137;
    Object.assign(original, {
      timelineStart: start,
      timelineDuration: 2,
      sourceIn,
      sourceOut: sourceIn + 2.5,
      transform: { speed: 1.25 },
      audioAutomation: { version: 1, role: "dialogue", fadeIn: 0.4 },
    });
    let after = before;
    for (const local of [0.10001, 0.20002, 0.30003, 0.40004]) {
      const target = after.composition.tracks[0]!.clips.find(
        (item) =>
          item.timelineStart < start + local &&
          item.timelineStart + item.timelineDuration > start + local,
      )!;
      after = applyTimelineCommand(
        after,
        assets,
        {
          type: "clip.split",
          clipId: target.id,
          sourceTime: sourceIn + local * 1.25,
        },
        context,
      );
    }
    const fragments = after.composition.tracks[0]!.clips.filter((item) =>
        item.id.startsWith("a"),
      ),
      segments = buildAudioMixPlan(after.composition, assets, {
        timebase: context.timebase,
        coverage: [],
      }).segments.filter((segment) => segment.clipId.startsWith("a"));
    expect(
      fragments.map((fragment) =>
        fragment.audioAutomation?.version === 2
          ? fragment.audioAutomation.timeMap.offsetSamples
          : undefined,
      ),
    ).toEqual([0, 4800, 9601, 14401, 19202]);
    expect(segments.map((segment) => segment.startSample)).toEqual([
      48, 4848, 9649, 14449, 19250,
    ]);
    expect(segments.map((segment) => segment.endSample)).toEqual([
      4848, 9649, 14449, 19250, 96048,
    ]);
  });
  it("rejects independent timing on a mapped fragment until an explicit automation reset", () => {
    const before = doc();
    clip(before).audioAutomation = { version: 1, role: "dialogue", fadeIn: 1 };
    const split = applyTimelineCommand(
        before,
        assets,
        { type: "clip.split", clipId: "a", sourceTime: 2 },
        context,
      ),
      snapshot = structuredClone(split);
    expect(() =>
      applyTimelineCommand(
        split,
        assets,
        { type: "audio.timing", clipId: "a", timing },
        context,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "timeline.audioAutomationConflict" }),
    );
    expect(split).toEqual(snapshot);
    const reset = applyTimelineCommand(
      split,
      assets,
      {
        type: "audio.configure",
        clipId: "a",
        automation: { version: 1, role: "dialogue" },
      },
      context,
    );
    expect(() =>
      applyTimelineCommand(
        reset,
        assets,
        { type: "audio.timing", clipId: "a", timing },
        context,
      ),
    ).not.toThrow();
  });
  it("rejects locks, source exhaustion, missing stream and film truncation without clamping effects", () => {
    const before = explicit();
    for (const changed of [
      { ...assets[0]!, state: { locked: true } },
      { ...assets[0]!, metadata: {} },
      { ...assets[0]!, duration: 1 },
    ])
      expect(() =>
        applyTimelineCommand(
          before,
          [changed],
          { type: "audio.timing", clipId: "a", timing },
          context,
        ),
      ).toThrow();
    clip(before).audioAutomation = { version: 1, role: "dialogue", fadeOut: 2 };
    expect(() =>
      applyTimelineCommand(
        before,
        assets,
        { type: "speed", clipId: "a", speed: 2 },
        context,
      ),
    ).toThrow();
    expect(clip(before).audioAutomation!.fadeOut).toBe(2);
    const long = explicit();
    clip(long).audioTiming!.sourceOutSample = 384000;
    expect(() =>
      applyTimelineCommand(
        long,
        assets,
        { type: "delete", clipId: "b" },
        context,
      ),
    ).toThrow(/sound|audio/i);
  });
  it("does not move a pinned neighbor during an independent ripple", () => {
    const before = explicit();
    clip(before, 1).userOverrides = {
      version: 1,
      isUserPinned: true,
      lockedAttributes: ["timing"],
    };
    const after = applyTimelineCommand(
      before,
      assets,
      { type: "trim", clipId: "a", sourceIn: 2, sourceOut: 5 },
      context,
    );
    expect(clip(after, 1)).toEqual(clip(before, 1));
    expect(() =>
      applyTimelineCommand(
        before,
        assets,
        { type: "trim", clipId: "a", sourceIn: 1, sourceOut: 6 },
        context,
      ),
    ).toThrow(/pin/i);
  });
  it("linked captions reject arbitrary desync, speed changes and excluded source windows", () => {
    const before = explicit();
    caption(before);
    expect(() =>
      applyTimelineCommand(
        before,
        assets,
        {
          type: "audio.timing",
          clipId: "a",
          timing: { ...timing, timelineStartSample: 48 },
        },
        context,
      ),
    ).toThrow(/caption/i);
    expect(() =>
      applyTimelineCommand(
        before,
        assets,
        { type: "speed", clipId: "a", speed: 2 },
        context,
      ),
    ).toThrow(/caption/i);
  });
  it.each([false, true])(
    "validates final batch captions and automation independent of order %s",
    (reversed) => {
      const before = explicit();
      caption(before);
      clip(before).audioAutomation = {
        version: 1,
        role: "dialogue",
        fadeIn: 3,
      };
      const commands: TimelineCommand[] = [
        {
          type: "audio.timing",
          clipId: "a",
          timing: { ...timing, sourceOutSample: 96000 },
        },
        { type: "caption.cue.delete", trackId: "ct", cueId: "cue" },
        {
          type: "audio.configure",
          clipId: "a",
          automation: { version: 1, role: "dialogue", fadeIn: 0.5 },
        },
      ];
      if (reversed) commands.reverse();
      let after = before;
      for (const command of commands)
        after = applyTimelineCommandInBatch(after, assets, command, context);
      expect(() =>
        validateAudioEdit(before, after, assets, commands, context),
      ).not.toThrow();
      expect(clip(after).audioAutomation!.fadeIn).toBe(0.5);
    },
  );
});

it.each([
  { type: "lock", clipId: "b", locked: false },
  { type: "beat", beatId: "b", patch: { title: "Edited" } },
  {
    type: "audio.add",
    clipId: "new",
    assetId: "v",
    role: "music",
    sourceIn: 0,
    sourceOut: 1,
    timelineStart: 0,
  },
] as TimelineCommand[])(
  "preserves source-linked captions across early-return batch commands %s",
  (command) => {
    const before = explicit();
    caption(before);
    const sources =
      command.type === "audio.add"
        ? [{ ...assets[0]!, mediaType: "audio" as const }]
        : assets;
    const after = applyTimelineCommandInBatch(
      before,
      sources,
      command,
      context,
    );
    expect(after.composition.captionTracks).toEqual(
      before.composition.captionTracks,
    );
  },
);
