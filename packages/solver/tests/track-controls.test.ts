import { describe, expect, it } from "vitest";
import {
  buildAudioMixPlan,
  resolveCompositionFrame,
  validateComposition,
  type AudioMixContext,
  type Composition,
  type MediaAsset,
  type ProjectTimebaseV1,
} from "@openfilm/core";
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
  metadata: {
    "openfilm.ffprobe": {
      streams: [
        { codec_type: "video", duration: "30.0", width: 1920, height: 1080 },
        { codec_type: "audio", duration: "30.0" },
      ],
      format: { duration: "30.0" },
    },
  },
  ...patch,
});

const assets = [
  asset("video-1", { duration: 30 }),
  asset("video-2", { duration: 30 }),
  asset("audio-1", {
    mediaType: "audio",
    duration: 30,
    metadata: {
      "openfilm.ffprobe": {
        streams: [{ codec_type: "audio", duration: "30.0" }],
        format: { duration: "30.0" },
      },
    },
  }),
  asset("audio-2", {
    mediaType: "audio",
    duration: 30,
    metadata: {
      "openfilm.ffprobe": {
        streams: [{ codec_type: "audio", duration: "30.0" }],
        format: { duration: "30.0" },
      },
    },
  }),
];

function createMultiTrackDoc(): EditorDocument {
  return {
    story: {
      id: "story-1",
      title: "Multi-track Story",
      targetDuration: 20,
      maxDuration: 30,
      beats: [
        { id: "beat-1", title: "Beat 1" },
        { id: "beat-2", title: "Beat 2" },
      ],
    },
    composition: {
      id: "comp-1",
      storyId: "story-1",
      duration: 20,
      tracks: [
        {
          id: "track-v1",
          type: "video",
          target: true,
          locked: false,
          visible: true,
          clips: [
            {
              id: "clip-v1-a",
              assetId: "video-1",
              beatId: "beat-1",
              sourceIn: 0,
              sourceOut: 5,
              timelineStart: 0,
              timelineDuration: 5,
            },
            {
              id: "clip-v1-b",
              assetId: "video-2",
              beatId: "beat-1",
              sourceIn: 5,
              sourceOut: 10,
              timelineStart: 5,
              timelineDuration: 5,
            },
          ],
        },
        {
          id: "track-v2",
          type: "video",
          target: false,
          locked: false,
          visible: true,
          clips: [
            {
              id: "clip-v2-a",
              assetId: "video-1",
              beatId: "beat-2",
              sourceIn: 10,
              sourceOut: 15,
              timelineStart: 0,
              timelineDuration: 5,
            },
          ],
        },
        {
          id: "track-a1",
          type: "audio",
          target: true,
          locked: false,
          muted: false,
          solo: false,
          clips: [
            {
              id: "clip-a1-a",
              assetId: "audio-1",
              beatId: "beat-1",
              sourceIn: 0,
              sourceOut: 10,
              timelineStart: 0,
              timelineDuration: 10,
            },
          ],
        },
        {
          id: "track-a2",
          type: "audio",
          target: false,
          locked: false,
          muted: false,
          solo: false,
          clips: [
            {
              id: "clip-a2-a",
              assetId: "audio-2",
              beatId: "beat-2",
              sourceIn: 0,
              sourceOut: 10,
              timelineStart: 0,
              timelineDuration: 10,
            },
          ],
        },
      ],
    },
  };
}

const edit = (doc: EditorDocument, command: TimelineCommand): EditorDocument =>
  applyTimelineCommand(doc, assets, command);

const timebase: ProjectTimebaseV1 = {
  version: 1,
  rateNumerator: 30,
  rateDenominator: 1,
  dropFrame: false,
};

const audioContext: AudioMixContext = {
  timebase,
  coverage: [],
};

describe("Professional Cut Desk Phase 3: Track Controls & Persistence", () => {
  describe("track.update command", () => {
    it("updates track lock, target, muted, solo, and visible states", () => {
      const initial = createMultiTrackDoc();
      const updated = edit(initial, {
        type: "track.update",
        trackId: "track-v1",
        patch: {
          locked: true,
          visible: false,
        },
      });

      const trackV1 = updated.composition.tracks.find(
        (t) => t.id === "track-v1",
      )!;
      expect(trackV1.locked).toBe(true);
      expect(trackV1.visible).toBe(false);
    });

    it("enforces single target per track type when setting target to true", () => {
      const initial = createMultiTrackDoc();
      expect(
        initial.composition.tracks.find((t) => t.id === "track-v1")?.target,
      ).toBe(true);
      expect(
        initial.composition.tracks.find((t) => t.id === "track-v2")?.target,
      ).toBe(false);

      const updated = edit(initial, {
        type: "track.update",
        trackId: "track-v2",
        patch: { target: true },
      });

      const trackV1 = updated.composition.tracks.find(
        (t) => t.id === "track-v1",
      )!;
      const trackV2 = updated.composition.tracks.find(
        (t) => t.id === "track-v2",
      )!;
      const trackA1 = updated.composition.tracks.find(
        (t) => t.id === "track-a1",
      )!;

      expect(trackV2.target).toBe(true);
      expect(trackV1.target).toBe(false);
      // Audio track target is untouched because it's a different track type
      expect(trackA1.target).toBe(true);
    });

    it("allows unsetting target on a track without clearing others", () => {
      const initial = createMultiTrackDoc();
      const updated = edit(initial, {
        type: "track.update",
        trackId: "track-v1",
        patch: { target: false },
      });

      const trackV1 = updated.composition.tracks.find(
        (t) => t.id === "track-v1",
      )!;
      expect(trackV1.target).toBe(false);
    });

    it("rejects non-boolean values and non-existent track IDs", () => {
      const doc = createMultiTrackDoc();
      expect(() =>
        edit(doc, {
          type: "track.update",
          trackId: "non-existent-track",
          patch: { locked: true },
        }),
      ).toThrow(/Track "non-existent-track" was not found/);

      expect(() =>
        edit(doc, {
          type: "track.update",
          trackId: "track-v1",
          patch: { locked: "invalid" as unknown as boolean },
        }),
      ).toThrow(/Track locked state must be a boolean/);

      expect(() =>
        edit(doc, {
          type: "track.update",
          trackId: "track-v1",
          patch: { target: 123 as unknown as boolean },
        }),
      ).toThrow(/Track target state must be a boolean/);

      expect(() =>
        edit(doc, {
          type: "track.update",
          trackId: "track-v1",
          patch: { muted: "no" as unknown as boolean },
        }),
      ).toThrow(/Track muted state must be a boolean/);

      expect(() =>
        edit(doc, {
          type: "track.update",
          trackId: "track-v1",
          patch: { solo: null as unknown as boolean },
        }),
      ).toThrow(/Track solo state must be a boolean/);

      expect(() =>
        edit(doc, {
          type: "track.update",
          trackId: "track-v1",
          patch: { visible: "yes" as unknown as boolean },
        }),
      ).toThrow(/Track visible state must be a boolean/);
    });
  });

  describe("Track lock enforcement", () => {
    it("rejects modifying clip locks when parent track is locked", () => {
      const doc = createMultiTrackDoc();
      const lockedTrackDoc = edit(doc, {
        type: "track.update",
        trackId: "track-v1",
        patch: { locked: true },
      });

      expect(() =>
        edit(lockedTrackDoc, {
          type: "lock",
          clipId: "clip-v1-a",
          locked: true,
        }),
      ).toThrow(
        /Track "track-v1" is locked. Unlock the track before modifying clip locks/,
      );
    });

    it("rejects standard clip edits on a locked track (trim, split, delete, slip, slide, lift)", () => {
      const doc = createMultiTrackDoc();
      const lockedTrackDoc = edit(doc, {
        type: "track.update",
        trackId: "track-v1",
        patch: { locked: true },
      });

      expect(() =>
        edit(lockedTrackDoc, {
          type: "trim",
          clipId: "clip-v1-a",
          sourceIn: 1,
          sourceOut: 4,
        }),
      ).toThrow(/Track "track-v1" is locked/);

      expect(() =>
        edit(lockedTrackDoc, {
          type: "clip.split",
          clipId: "clip-v1-a",
          sourceTime: 2,
        }),
      ).toThrow(/Track "track-v1" is locked/);

      expect(() =>
        edit(lockedTrackDoc, {
          type: "delete",
          clipId: "clip-v1-a",
        }),
      ).toThrow(/Track "track-v1" is locked/);

      expect(() =>
        edit(lockedTrackDoc, {
          type: "slip",
          clipId: "clip-v1-a",
          delta: 1,
        }),
      ).toThrow(/Track "track-v1" is locked/);

      expect(() =>
        edit(lockedTrackDoc, {
          type: "slide",
          clipId: "clip-v1-a",
          delta: 1,
        }),
      ).toThrow(/Track "track-v1" is locked/);

      expect(() =>
        edit(lockedTrackDoc, {
          type: "lift",
          clipId: "clip-v1-a",
        }),
      ).toThrow(/Track "track-v1" is locked/);
    });

    it("rejects roll edit when track is locked", () => {
      const doc = createMultiTrackDoc();
      const lockedTrackDoc = edit(doc, {
        type: "track.update",
        trackId: "track-v1",
        patch: { locked: true },
      });

      expect(() =>
        edit(lockedTrackDoc, {
          type: "roll",
          clipIdA: "clip-v1-a",
          clipIdB: "clip-v1-b",
          delta: 1,
        }),
      ).toThrow(/Cannot roll edit: track "track-v1" is locked/);
    });

    it("rejects insert edit on a locked track", () => {
      const doc = createMultiTrackDoc();
      const lockedTrackDoc = edit(doc, {
        type: "track.update",
        trackId: "track-v1",
        patch: { locked: true },
      });

      expect(() =>
        edit(lockedTrackDoc, {
          type: "insert",
          trackId: "track-v1",
          assetId: "video-1",
          timelineStart: 2,
          sourceIn: 0,
          sourceOut: 3,
        }),
      ).toThrow(/Cannot insert edit: track "track-v1" is locked/);
    });

    it("rejects overwrite edit on a locked track", () => {
      const doc = createMultiTrackDoc();
      const lockedTrackDoc = edit(doc, {
        type: "track.update",
        trackId: "track-v1",
        patch: { locked: true },
      });

      expect(() =>
        edit(lockedTrackDoc, {
          type: "overwrite",
          trackId: "track-v1",
          assetId: "video-1",
          timelineStart: 2,
          sourceIn: 0,
          sourceOut: 3,
        }),
      ).toThrow(/Cannot overwrite edit: track "track-v1" is locked/);
    });
  });

  describe("Target track routing for insert and overwrite", () => {
    it("routes insert without explicit trackId to the target video track", () => {
      const doc = createMultiTrackDoc();
      // Set track-v2 as target
      const docWithV2Target = edit(doc, {
        type: "track.update",
        trackId: "track-v2",
        patch: { target: true },
      });

      const updated = edit(docWithV2Target, {
        type: "insert",
        assetId: "video-1",
        timelineStart: 2,
        sourceIn: 0,
        sourceOut: 2,
      });

      const trackV2 = updated.composition.tracks.find(
        (t) => t.id === "track-v2",
      )!;
      // Track V2 original clip [0, 5] splits around insert [2, 4], yielding 3 clips total
      expect(trackV2.clips.length).toBe(3);
      expect(
        trackV2.clips.some(
          (c) => c.timelineStart === 2 && c.timelineDuration === 2,
        ),
      ).toBe(true);
    });

    it("routes overwrite without explicit trackId to the target audio track for audio media", () => {
      const doc = createMultiTrackDoc();
      // Set track-a2 as target
      const docWithA2Target = edit(doc, {
        type: "track.update",
        trackId: "track-a2",
        patch: { target: true },
      });

      const updated = edit(docWithA2Target, {
        type: "overwrite",
        assetId: "audio-1",
        timelineStart: 2,
        sourceIn: 0,
        sourceOut: 3,
      });

      const trackA2 = updated.composition.tracks.find(
        (t) => t.id === "track-a2",
      )!;
      expect(
        trackA2.clips.some(
          (c) => c.timelineStart === 2 && c.timelineDuration === 3,
        ),
      ).toBe(true);
    });
  });

  describe("Track visibility and solo/mute semantics in sequence & audio-policy", () => {
    it("omits video clips from visual layers when track.visible === false", () => {
      const doc = createMultiTrackDoc();
      // Initially, frame at t=1 (frame 30) should resolve visual clip from track-v1
      const initialFrame = resolveCompositionFrame(
        doc.composition,
        assets,
        30,
        timebase,
      );
      expect(initialFrame.visual.some((c) => c.clip.id === "clip-v1-a")).toBe(
        true,
      );

      // Hide track-v1
      const hiddenComp: Composition = {
        ...doc.composition,
        tracks: doc.composition.tracks.map((t) =>
          t.id === "track-v1" ? { ...t, visible: false } : t,
        ),
      };

      const hiddenFrame = resolveCompositionFrame(
        hiddenComp,
        assets,
        30,
        timebase,
      );
      expect(hiddenFrame.visual.some((c) => c.clip.id === "clip-v1-a")).toBe(
        false,
      );
    });

    it("excludes muted track from audio mix plan and audible frame layers", () => {
      const doc = createMultiTrackDoc();
      const planNormal = buildAudioMixPlan(
        doc.composition,
        assets,
        audioContext,
      );
      expect(
        planNormal.segments.some((seg) => seg.clipId === "clip-a1-a"),
      ).toBe(true);

      const mutedComp: Composition = {
        ...doc.composition,
        tracks: doc.composition.tracks.map((t) =>
          t.id === "track-a1" ? { ...t, muted: true } : t,
        ),
      };

      const planMuted = buildAudioMixPlan(mutedComp, assets, audioContext);
      expect(planMuted.segments.some((seg) => seg.clipId === "clip-a1-a")).toBe(
        false,
      );
      expect(planMuted.segments.some((seg) => seg.clipId === "clip-a2-a")).toBe(
        true,
      );

      const frameMuted = resolveCompositionFrame(
        mutedComp,
        assets,
        30,
        timebase,
      );
      expect(frameMuted.audible.some((c) => c.clip.id === "clip-a1-a")).toBe(
        false,
      );
    });

    it("solo track isolates audio: only soloed tracks are audible; un-soloed tracks are muted", () => {
      const doc = createMultiTrackDoc();

      // Solo track-a1
      const soloComp: Composition = {
        ...doc.composition,
        tracks: doc.composition.tracks.map((t) =>
          t.id === "track-a1" ? { ...t, solo: true } : t,
        ),
      };

      const plan = buildAudioMixPlan(soloComp, assets, audioContext);
      expect(plan.segments.some((seg) => seg.clipId === "clip-a1-a")).toBe(
        true,
      );
      // track-a2 is not soloed, so it should be muted
      expect(plan.segments.some((seg) => seg.clipId === "clip-a2-a")).toBe(
        false,
      );

      const frame = resolveCompositionFrame(soloComp, assets, 30, timebase);
      expect(frame.audible.some((c) => c.clip.id === "clip-a1-a")).toBe(true);
      expect(frame.audible.some((c) => c.clip.id === "clip-a2-a")).toBe(false);
    });

    it("multiple soloed tracks are all audible; un-soloed tracks remain muted", () => {
      const doc = createMultiTrackDoc();

      // Solo both track-a1 and track-a2
      const multiSoloComp: Composition = {
        ...doc.composition,
        tracks: doc.composition.tracks.map((t) =>
          t.id === "track-a1" || t.id === "track-a2" ? { ...t, solo: true } : t,
        ),
      };

      const plan = buildAudioMixPlan(multiSoloComp, assets, audioContext);
      expect(plan.segments.some((seg) => seg.clipId === "clip-a1-a")).toBe(
        true,
      );
      expect(plan.segments.some((seg) => seg.clipId === "clip-a2-a")).toBe(
        true,
      );
    });

    it("mute takes precedence over solo on the same track", () => {
      const doc = createMultiTrackDoc();

      // Solo track-a1 AND mute track-a1
      const soloAndMutedComp: Composition = {
        ...doc.composition,
        tracks: doc.composition.tracks.map((t) =>
          t.id === "track-a1" ? { ...t, solo: true, muted: true } : t,
        ),
      };

      const plan = buildAudioMixPlan(soloAndMutedComp, assets, audioContext);
      // Both track-a1 (muted) and track-a2 (not soloed) should be muted!
      expect(plan.segments.some((seg) => seg.clipId === "clip-a1-a")).toBe(
        false,
      );
      expect(plan.segments.some((seg) => seg.clipId === "clip-a2-a")).toBe(
        false,
      );
    });
  });

  describe("Validation schema compliance", () => {
    it("validates tracks with all track control flags set", () => {
      const doc = createMultiTrackDoc();
      expect(() => validateComposition(doc.composition)).not.toThrow();
    });

    it("rejects non-boolean track control fields during validation", () => {
      const doc = createMultiTrackDoc();
      const invalid = {
        ...doc.composition,
        tracks: [
          {
            ...doc.composition.tracks[0],
            locked: "not-a-bool" as unknown as boolean,
          },
        ],
      };
      expect(() =>
        validateComposition(invalid as unknown as Composition),
      ).toThrow();
    });
  });
});
