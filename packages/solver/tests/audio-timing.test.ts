import { describe, expect, it } from "vitest";
import {
  applyTimelineCommand,
  applyTimelineCommandInBatch,
  validateAudioEdit,
  type EditorDocument,
  type TimelineCommand,
} from "../src/index.js";
import {
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
