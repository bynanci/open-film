import { describe, expect, it } from "vitest";
import {
  applyTimelineCommand,
  applyOverridePolicy,
  type EditorDocument,
} from "../src/index.js";
import { resolveProjectTimebase, type MediaAsset } from "@openfilm/core";
const timebase = resolveProjectTimebase({
  width: 1920,
  height: 1080,
  frameRate: 30,
});
const context = { timebase, origin: "direct" as const };
const assets: MediaAsset[] = [
  {
    id: "video",
    name: "Video",
    uri: "file:///video.mp4",
    mediaType: "video",
    duration: 20,
    state: {},
    tags: [],
    metadata: {},
  },
  {
    id: "photo",
    name: "Photo",
    uri: "file:///photo.png",
    mediaType: "image",
    state: {},
    tags: [],
    metadata: {},
  },
];
function doc(): EditorDocument {
  return {
    story: {
      id: "story",
      title: "Story",
      beats: [
        { id: "beat", title: "Beat", candidateAssetIds: ["video", "photo"] },
      ],
    },
    composition: {
      id: "cut",
      storyId: "story",
      duration: 6,
      tracks: [
        {
          id: "track",
          type: "video",
          clips: [
            {
              id: "a",
              assetId: "video",
              beatId: "beat",
              timelineStart: 0,
              timelineDuration: 3,
              sourceIn: 1,
              sourceOut: 4,
            },
            {
              id: "b",
              assetId: "video",
              beatId: "beat",
              timelineStart: 3,
              timelineDuration: 3,
              sourceIn: 4,
              sourceOut: 7,
            },
          ],
        },
      ],
    },
  };
}
const clip = (d: EditorDocument, id = "a") =>
  d.composition.tracks[0]!.clips.find((c) => c.id === id)!;
describe("user pin mutation policy", () => {
  it("trim and further direct speed retain independent occurrence pins", () => {
    const before = doc();
    const after = applyTimelineCommand(
      before,
      assets,
      { type: "trim", clipId: "a", sourceIn: 1, sourceOut: 3 },
      context,
    );
    expect(clip(after).userOverrides).toEqual({
      version: 1,
      isUserPinned: true,
      lockedAttributes: ["inOutRange", "timing"],
    });
    expect(clip(after, "b").userOverrides).toBeUndefined();
    expect(clip(before).userOverrides).toBeUndefined();
    expect(
      clip(
        applyTimelineCommand(
          after,
          assets,
          { type: "speed", clipId: "a", speed: 2 },
          context,
        ),
      ).sourceOut,
    ).toBe(3);
  });
  it("explicit pin includes an already present source range category", () => {
    const after = applyTimelineCommand(
      doc(),
      assets,
      {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "a" },
        pinned: true,
      },
      context,
    );
    expect(clip(after).userOverrides?.lockedAttributes).toEqual([
      "inOutRange",
      "timing",
    ]);
  });
  it("split pins both ranges and retains the left identity", () => {
    const after = applyTimelineCommand(
      doc(),
      assets,
      { type: "clip.split", clipId: "a", sourceTime: 2 },
      context,
    );
    expect(clip(after).sourceOut).toBe(2);
    const right = clip(after, "a-split-1");
    expect(right.sourceIn).toBe(2);
    expect(right.userOverrides).toEqual(clip(after).userOverrides);
  });
  it("explicit motion removal pins authored absence", () => {
    const d = doc();
    clip(d).assetId = "photo";
    delete clip(d).sourceIn;
    delete clip(d).sourceOut;
    const after = applyTimelineCommand(
      d,
      assets,
      { type: "presentation", clipId: "a", motion: null },
      context,
    );
    expect(clip(after).motion).toBeUndefined();
    expect(clip(after).userOverrides?.lockedAttributes).toEqual([
      "motionPreset",
      "timing",
    ]);
    expect(() =>
      applyTimelineCommand(after, assets, {
        type: "transform",
        clipId: "a",
        x: 1,
      }),
    ).toThrow(/pin/iu);
  });
  it("automatic metadata removal fails and same asset ids stay independent", () => {
    const d = applyTimelineCommand(
      doc(),
      assets,
      {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "b" },
        pinned: true,
      },
      context,
    );
    const candidate = structuredClone(d);
    delete clip(candidate, "b").userOverrides;
    expect(() =>
      applyOverridePolicy(d, candidate, [], { timebase, origin: "automatic" }),
    ).toThrow(/pin/iu);
    expect(() =>
      applyTimelineCommand(d, assets, { type: "transform", clipId: "a", x: 1 }),
    ).not.toThrow();
  });
  it("parent look effective change conflicts", () => {
    const d = applyTimelineCommand(
      doc(),
      assets,
      {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "b" },
        pinned: true,
      },
      context,
    );
    expect(() =>
      applyTimelineCommand(
        d,
        assets,
        {
          type: "look",
          scope: "film",
          look: { version: 1, preset: "retro", strength: 1 },
        },
        context,
      ),
    ).toThrow(/pin/iu);
  });
  it("explicit delete and replacement can supersede their own pin", () => {
    const d = applyTimelineCommand(
      doc(),
      assets,
      {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "a" },
        pinned: true,
      },
      context,
    );
    expect(
      clip(
        applyTimelineCommand(
          d,
          assets,
          { type: "replace", clipId: "a", assetId: "photo" },
          context,
        ),
      ).userOverrides?.isUserPinned,
    ).toBe(true);
    expect(
      applyTimelineCommand(
        d,
        assets,
        { type: "delete", clipId: "a" },
        context,
      ).composition.tracks[0]!.clips.map((c) => c.id),
    ).not.toContain("a");
  });
  it("source and clip locks still win and pin writes require a clock", () => {
    const d = doc();
    clip(d).locked = true;
    expect(() =>
      applyTimelineCommand(
        d,
        assets,
        {
          type: "user-pin.set",
          target: { kind: "clip", clipId: "a" },
          pinned: false,
        },
        context,
      ),
    ).toThrow(/locked/iu);
    expect(() =>
      applyTimelineCommand(doc(), assets, {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "a" },
        pinned: true,
      }),
    ).toThrow(/clock|timebase/iu);
    const locked = structuredClone(assets);
    locked[0]!.state.locked = true;
    expect(() =>
      applyTimelineCommand(
        doc(),
        locked,
        { type: "trim", clipId: "a", sourceIn: 1, sourceOut: 2 },
        context,
      ),
    ).toThrow(/locked/iu);
  });
  it("direct audio insertion pins its new owner", () => {
    const audio = { ...assets[0]!, id: "audio", mediaType: "audio" as const };
    const after = applyTimelineCommand(
      doc(),
      [...assets, audio],
      {
        type: "audio.add",
        clipId: "audio-new",
        assetId: "audio",
        role: "music",
        timelineStart: 0,
        sourceIn: 0,
        sourceOut: 2,
      },
      context,
    );
    expect(
      after.composition.tracks.at(-1)!.clips[0]!.userOverrides?.isUserPinned,
    ).toBe(true);
  });
  it("explicit clip lock toggles preserve their own pin without pinning unrelated legacy locks", () => {
    const d = applyTimelineCommand(
      doc(),
      assets,
      {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "a" },
        pinned: true,
      },
      context,
    );
    const locked = applyTimelineCommand(
      d,
      assets,
      { type: "lock", clipId: "a", locked: true },
      context,
    );
    expect(clip(locked).locked).toBe(true);
    expect(clip(locked).userOverrides).toEqual(clip(d).userOverrides);
    const unlocked = applyTimelineCommand(
      locked,
      assets,
      { type: "lock", clipId: "a", locked: false },
      context,
    );
    expect(clip(unlocked).locked).toBe(false);
    expect(clip(unlocked).userOverrides).toEqual(clip(d).userOverrides);
    expect(
      clip(
        applyTimelineCommand(
          doc(),
          assets,
          { type: "lock", clipId: "a", locked: true },
          context,
        ),
      ).userOverrides,
    ).toBeUndefined();
  });
  it("scene upsert rejects injected metadata", () => {
    const scene = {
      version: 1 as const,
      id: "scene",
      name: "Scene",
      start: 0,
      duration: 2,
      zIndex: 0,
      nodes: [],
      userOverrides: {
        version: 1 as const,
        isUserPinned: true,
        lockedAttributes: ["timing" as const],
      },
    };
    expect(() =>
      applyTimelineCommand(
        doc(),
        assets,
        { type: "graphic.scene.upsert", scene },
        context,
      ),
    ).toThrow(/pin|metadata/iu);
  });
});
