// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  applyTranscriptRipple,
  createTranscriptRippleProposal,
  validateTranscriptRippleProposal,
  type Composition,
  type TranscriptDocument,
  type ProjectTimebaseV1,
} from "../src/index.js";

const timebase: ProjectTimebaseV1 = {
  version: 1,
  rateNumerator: 30,
  rateDenominator: 1,
  dropFrame: false,
};

const baseTranscript: TranscriptDocument = {
  id: "transcript-1",
  assetId: "asset-interview",
  provenance: {
    providerId: "test",
    version: "1",
    model: "test-model",
    sourceHash: "test-hash",
    createdAt: "2026-10-31T00:00:00Z",
  },
  segments: [
    {
      id: "seg-1",
      start: 0,
      end: 2,
      text: "Hello world,",
      timingSource: "provider",
      alignmentState: "original",
    },
    {
      id: "seg-2",
      start: 2,
      end: 4,
      text: "this is an unneeded pause,",
      timingSource: "provider",
      alignmentState: "original",
    },
    {
      id: "seg-3",
      start: 4,
      end: 6,
      text: "welcome to OpenFilm.",
      timingSource: "provider",
      alignmentState: "original",
    },
  ],
};

function createComposition(): Composition {
  return {
    id: "comp-1",
    storyId: "story-1",
    duration: 6,
    tracks: [
      {
        id: "v1",
        type: "video",
        clips: [
          {
            id: "clip-1",
            assetId: "asset-interview",
            timelineStart: 0,
            timelineDuration: 6,
            sourceIn: 0,
            sourceOut: 6,
          },
        ],
      },
      {
        id: "a1",
        type: "audio",
        timing: "overlay",
        clips: [
          {
            id: "bg-music",
            assetId: "asset-music",
            timelineStart: 0,
            timelineDuration: 6,
            sourceIn: 0,
            sourceOut: 6,
          },
        ],
      },
    ],
    captionTracks: [
      {
        version: 1,
        id: "captions-main",
        name: "English",
        language: "en",
        style: { version: 1, role: "subtitle" },
        cues: [
          {
            version: 1,
            id: "cue-1",
            startMs: 0,
            endMs: 2000,
            text: "Hello world,",
            manualRevision: 0,
            source: { kind: "manual" },
          },
          {
            version: 1,
            id: "cue-2",
            startMs: 2000,
            endMs: 4000,
            text: "this is an unneeded pause,",
            manualRevision: 0,
            source: { kind: "manual" },
          },
          {
            version: 1,
            id: "cue-3",
            startMs: 4000,
            endMs: 6000,
            text: "welcome to OpenFilm.",
            manualRevision: 0,
            source: { kind: "manual" },
          },
        ],
      },
    ],
    graphicScenes: [
      {
        version: 1,
        id: "lower-third",
        name: "Speaker Name",
        start: 4.5,
        duration: 1.0,
        zIndex: 0,
        nodes: [],
      },
    ],
  };
}

describe("Transcript-driven Ripple Editing (D4)", () => {
  it("creates valid ripple proposal for reliable transcript segment delete", () => {
    const comp = createComposition();
    const proposal = createTranscriptRippleProposal(comp, baseTranscript, {
      assetId: "asset-interview",
      mode: "delete",
      segmentIds: ["seg-2"],
    });

    expect(proposal.version).toBe(1);
    expect(proposal.mode).toBe("delete");
    expect(proposal.totalDurationReduced).toBe(2);
    expect(proposal.timelineIntervals).toEqual([{ start: 2, end: 4 }]);
    expect(validateTranscriptRippleProposal(proposal)).toEqual(proposal);
  });

  it("fails closed on estimated timing", () => {
    const comp = createComposition();
    const transcriptWithEstimated: TranscriptDocument = {
      ...baseTranscript,
      segments: [
        baseTranscript.segments[0]!,
        {
          ...baseTranscript.segments[1]!,
          timingSource: "estimated",
        },
        baseTranscript.segments[2]!,
      ],
    };

    expect(() =>
      createTranscriptRippleProposal(comp, transcriptWithEstimated, {
        assetId: "asset-interview",
        mode: "delete",
        segmentIds: ["seg-2"],
      }),
    ).toThrowError(/estimated timing/);
  });

  it("fails closed on unverified text-edited alignment", () => {
    const comp = createComposition();
    const transcriptWithEdited: TranscriptDocument = {
      ...baseTranscript,
      segments: [
        baseTranscript.segments[0]!,
        {
          ...baseTranscript.segments[1]!,
          alignmentState: "text-edited",
          timingSource: undefined,
        },
        baseTranscript.segments[2]!,
      ],
    };

    expect(() =>
      createTranscriptRippleProposal(comp, transcriptWithEdited, {
        assetId: "asset-interview",
        mode: "delete",
        segmentIds: ["seg-2"],
      }),
    ).toThrowError(/without realigned timing evidence/);
  });

  it("fails closed when segment is not found", () => {
    const comp = createComposition();
    expect(() =>
      createTranscriptRippleProposal(comp, baseTranscript, {
        assetId: "asset-interview",
        mode: "delete",
        segmentIds: ["non-existent"],
      }),
    ).toThrowError(/was not found/);
  });

  it("fails closed when locked clips are in the affected range", () => {
    const comp = createComposition();
    comp.tracks[0]!.clips[0]!.locked = true;

    expect(() =>
      createTranscriptRippleProposal(comp, baseTranscript, {
        assetId: "asset-interview",
        mode: "delete",
        segmentIds: ["seg-2"],
      }),
    ).toThrowError(/locked clip/);
  });

  it("applies ripple delete atomically across video, captions, audio, and graphics", () => {
    const comp = createComposition();
    const proposal = createTranscriptRippleProposal(comp, baseTranscript, {
      assetId: "asset-interview",
      mode: "delete",
      segmentIds: ["seg-2"], // 2s to 4s
    });

    const result = applyTranscriptRipple(comp, proposal, timebase);

    // 1. Total duration reduced from 6 to 4
    expect(result.duration).toBe(4);

    // 2. Video track: clip-1 split into two halves (0-2s and 2-4s)
    const videoClips = result.tracks[0]!.clips;
    expect(videoClips.length).toBe(2);

    expect(videoClips[0]!.timelineStart).toBe(0);
    expect(videoClips[0]!.timelineDuration).toBe(2);
    expect(videoClips[0]!.sourceIn).toBe(0);
    expect(videoClips[0]!.sourceOut).toBe(2);

    expect(videoClips[1]!.timelineStart).toBe(2);
    expect(videoClips[1]!.timelineDuration).toBe(2);
    expect(videoClips[1]!.sourceIn).toBe(4);
    expect(videoClips[1]!.sourceOut).toBe(6);

    // 3. Caption cues: cue-2 (2000-4000ms) deleted; cue-3 shifted from 4000-6000ms to 2000-4000ms
    const captionCues = result.captionTracks![0]!.cues;
    expect(captionCues.length).toBe(2);
    expect(captionCues[0]).toEqual({
      version: 1,
      id: "cue-1",
      startMs: 0,
      endMs: 2000,
      text: "Hello world,",
      manualRevision: 0,
      source: { kind: "manual" },
    });
    expect(captionCues[1]).toEqual({
      version: 1,
      id: "cue-3",
      startMs: 2000,
      endMs: 4000,
      text: "welcome to OpenFilm.",
      manualRevision: 0,
      source: { kind: "manual" },
    });

    // 4. Graphic scene shifted from 4.5s to 2.5s
    expect(result.graphicScenes!.length).toBe(1);
    expect(result.graphicScenes![0]!.start).toBe(2.5);
    expect(result.graphicScenes![0]!.duration).toBe(1.0);

    // 5. Audio overlay track trimmed to fit new duration
    const audioClips = result.tracks[1]!.clips;
    expect(audioClips[0]!.timelineDuration).toBe(4);
  });

  it("supports keep mode to ripple delete everything outside selected speech", () => {
    const comp = createComposition();
    const proposal = createTranscriptRippleProposal(comp, baseTranscript, {
      assetId: "asset-interview",
      mode: "keep",
      segmentIds: ["seg-1"], // keep 0 to 2s; delete 2 to 6s
    });

    expect(proposal.mode).toBe("keep");
    expect(proposal.totalDurationReduced).toBe(4);
    expect(proposal.timelineIntervals).toEqual([{ start: 2, end: 6 }]);

    const result = applyTranscriptRipple(comp, proposal, timebase);
    expect(result.duration).toBe(2);
    expect(result.tracks[0]!.clips.length).toBe(1);
    expect(result.tracks[0]!.clips[0]!.timelineDuration).toBe(2);
    expect(result.captionTracks![0]!.cues.length).toBe(1);
    expect(result.captionTracks![0]!.cues[0]!.text).toBe("Hello world,");
  });
});
