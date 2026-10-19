import { describe, expect, it } from "vitest";
import type { CaptionCue, CaptionTrack, MediaAsset } from "@openfilm/core";
import {
  applyTimelineCommand,
  type EditorDocument,
  type TimelineCommand,
} from "../src/index.js";

const cue: CaptionCue = {
  version: 1,
  id: "cue-stable-1",
  startMs: 1_000,
  endMs: 2_500,
  text: "你好，世界",
  source: { kind: "manual" },
  manualRevision: 0,
};
const track: CaptionTrack = {
  version: 1,
  id: "captions-zh-tw",
  name: "繁體中文字幕",
  language: "zh-TW",
  style: {
    version: 1,
    role: "subtitle",
    fontFamily: "Noto Sans CJK TC",
    fontSize: 48,
    safeArea: { left: 0.08, right: 0.08, top: 0.08, bottom: 0.12 },
  },
  cues: [cue],
};

function document(): EditorDocument {
  return {
    story: { id: "story", title: "A film", beats: [] },
    composition: {
      id: "composition",
      storyId: "story",
      duration: 14,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "locked-clip",
              assetId: "locked-source",
              sourceIn: 0,
              sourceOut: 4,
              timelineStart: 0,
              timelineDuration: 4,
              locked: true,
            },
          ],
        },
      ],
    },
  };
}

const lockedSource: MediaAsset = {
  id: "locked-source",
  name: "locked-source.mp4",
  uri: "file:///locked-source.mp4",
  mediaType: "video",
  duration: 4,
  tags: [],
  state: { locked: true },
  metadata: {},
};

const edit = (value: EditorDocument, command: TimelineCommand) =>
  applyTimelineCommand(value, [lockedSource], command);

describe("native caption editing commands", () => {
  it("adds and revises captions with stable IDs without editing locked source clips", () => {
    const initial = document();
    const added = edit(initial, { type: "caption.track.add", track });
    const revised = edit(added, {
      type: "caption.cue.update",
      trackId: track.id,
      cueId: cue.id,
      patch: { text: "你好，世界\n新的一行", startMs: 1_250, endMs: 2_750 },
    });
    expect(revised.composition.captionTracks?.[0]?.cues[0]).toEqual({
      ...cue,
      startMs: 1_250,
      endMs: 2_750,
      text: "你好，世界\n新的一行",
      manualRevision: 1,
    });
    expect(revised.composition.tracks).toEqual(initial.composition.tracks);
    expect(initial.composition).not.toHaveProperty("captionTracks");
  });

  it("edits style and deletes a cue without changing cue text revision", () => {
    const added = edit(document(), { type: "caption.track.add", track });
    const styled = edit(added, {
      type: "caption.track.style",
      trackId: track.id,
      style: { ...track.style, fontSize: 52, safeArea: { bottom: 0.16 } },
    });
    expect(styled.composition.captionTracks?.[0]?.style).toMatchObject({
      fontSize: 52,
      safeArea: { bottom: 0.16 },
    });
    expect(styled.composition.captionTracks?.[0]?.cues[0]?.manualRevision).toBe(
      0,
    );
    const deleted = edit(styled, {
      type: "caption.cue.delete",
      trackId: track.id,
      cueId: cue.id,
    });
    expect(deleted.composition.captionTracks?.[0]?.cues).toEqual([]);
  });

  it("rejects duplicate IDs, invalid timing and empty edits", () => {
    const added = edit(document(), { type: "caption.track.add", track });
    expect(() => edit(added, { type: "caption.track.add", track })).toThrow(
      /duplicate/i,
    );
    expect(() =>
      edit(added, {
        type: "caption.cue.update",
        trackId: track.id,
        cueId: cue.id,
        patch: { endMs: 1_000 },
      }),
    ).toThrow();
    expect(() =>
      edit(added, {
        type: "caption.cue.update",
        trackId: track.id,
        cueId: cue.id,
        patch: {},
      }),
    ).toThrow();
  });

  it("keeps composition-time cues unchanged through trim, split and speed edits", () => {
    const editable = document();
    editable.composition.tracks[0]!.clips[0]!.locked = false;
    const withCaptions = edit(editable, { type: "caption.track.add", track });
    const before = structuredClone(withCaptions.composition.captionTracks);
    const unlockedSource = { ...lockedSource, state: {} };
    for (const command of [
      { type: "trim", clipId: "locked-clip", sourceIn: 0.5, sourceOut: 3.5 },
      { type: "clip.split", clipId: "locked-clip", sourceTime: 2 },
      { type: "speed", clipId: "locked-clip", speed: 1.5 },
    ] as const) {
      const changed = applyTimelineCommand(
        withCaptions,
        [unlockedSource],
        command,
      );
      expect(changed.composition.captionTracks).toEqual(before);
    }
  });
});
