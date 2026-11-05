// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  applySilenceCutProposal,
  applyTranscriptRipple,
  createSilenceCutProposal,
  validateAudioActivityEvidence,
  validateSilenceCutProposal,
  type AudioActivityEvidence,
  type Composition,
  type MediaAsset,
} from "../src/index.js";

const sourceHash = "a".repeat(64);
function evidence(): AudioActivityEvidence {
  return {
    version: 1,
    assetId: "interview",
    sourceHash,
    duration: 12,
    sampleRate: 48000,
    windowSeconds: 0.02,
    audioStreamIndex: 1,
    parameters: { thresholdDb: -40, minimumSilenceSeconds: 0.2 },
    silenceIntervals: [
      { start: 2, end: 4 },
      { start: 6, end: 7 },
    ],
    provenance: {
      providerId: "openfilm.ffmpeg-audio-activity",
      version: "1",
      sourceHash,
      createdAt: "2026-11-04T00:00:00Z",
    },
  };
}
function composition(): Composition {
  return {
    id: "composition",
    storyId: "story",
    duration: 14,
    tracks: [
      {
        id: "video",
        type: "video",
        clips: [
          {
            id: "first",
            assetId: "interview",
            timelineStart: 0,
            timelineDuration: 8,
            sourceIn: 0,
            sourceOut: 8,
          },
          {
            id: "repeat",
            assetId: "interview",
            timelineStart: 8,
            timelineDuration: 2,
            sourceIn: 2,
            sourceOut: 6,
            transform: { speed: 2 },
          },
          {
            id: "first-rip-1",
            assetId: "other",
            timelineStart: 10,
            timelineDuration: 4,
            sourceIn: 0,
            sourceOut: 4,
          },
        ],
      },
    ],
  };
}
const assets: MediaAsset[] = ["interview", "other"].map((id) => ({
  id,
  name: id,
  uri: `file:///${id}.mp4`,
  mediaType: "video",
  duration: 12,
  contentHash: sourceHash,
  tags: [],
  state: {},
  metadata: {},
}));
const options = {
  baseRevision: "reviewed-revision",
  paddingSeconds: 0.25,
  assets,
};

describe("bounded source-clock audio activity evidence", () => {
  it("returns detached canonical evidence with an explicit 48 kHz measurement clock", () => {
    const input = evidence();
    const result = validateAudioActivityEvidence(input);
    expect(result).toEqual(input);
    result.silenceIntervals[0]!.start = 3;
    expect(input.silenceIntervals[0]!.start).toBe(2);
  });

  it.each([
    [
      "unknown root field",
      (value: Record<string, unknown>) => {
        value.extra = true;
      },
    ],
    [
      "unknown detector parameter",
      (value: Record<string, unknown>) => {
        (value.parameters as Record<string, unknown>).vad = true;
      },
    ],
    [
      "unknown provenance field",
      (value: Record<string, unknown>) => {
        (value.provenance as Record<string, unknown>).command = "anything";
      },
    ],
    [
      "unbound hash",
      (value: Record<string, unknown>) => {
        value.sourceHash = "b".repeat(64);
      },
    ],
    [
      "non-SHA digest",
      (value: Record<string, unknown>) => {
        value.sourceHash = "not-a-hash";
      },
    ],
    [
      "old low-pass sample clock",
      (value: Record<string, unknown>) => {
        value.sampleRate = 8000;
      },
    ],
    [
      "unbounded duration",
      (value: Record<string, unknown>) => {
        value.duration = 86401;
      },
    ],
    [
      "nonfinite duration",
      (value: Record<string, unknown>) => {
        value.duration = Infinity;
      },
    ],
    [
      "fractional stream",
      (value: Record<string, unknown>) => {
        value.audioStreamIndex = 1.5;
      },
    ],
    [
      "overlapping ranges",
      (value: Record<string, unknown>) => {
        value.silenceIntervals = [
          { start: 2, end: 4 },
          { start: 3, end: 5 },
        ];
      },
    ],
    [
      "out-of-source range",
      (value: Record<string, unknown>) => {
        value.silenceIntervals = [{ start: 11, end: 13 }];
      },
    ],
    [
      "unqualified short range",
      (value: Record<string, unknown>) => {
        value.silenceIntervals = [{ start: 1, end: 1.1 }];
      },
    ],
    [
      "too many ranges",
      (value: Record<string, unknown>) => {
        value.silenceIntervals = Array.from({ length: 2001 }, () => ({
          start: 0,
          end: 1,
        }));
      },
    ],
  ] as const)("rejects %s", (_name, mutate) => {
    const value = evidence() as unknown as Record<string, unknown>;
    mutate(value);
    expect(() => validateAudioActivityEvidence(value)).toThrow();
  });

  it("rejects getters and sparse arrays without reading accessor content", () => {
    const input = evidence();
    let reads = 0;
    Object.defineProperty(input.parameters, "thresholdDb", {
      enumerable: true,
      get() {
        reads++;
        return -40;
      },
    });
    expect(() => validateAudioActivityEvidence(input)).toThrow();
    expect(reads).toBe(0);
    const sparse = evidence();
    sparse.silenceIntervals = new Array(2);
    expect(() => validateAudioActivityEvidence(sparse)).toThrow();
  });
});

describe("silence cut proposals", () => {
  it("keeps per-candidate source/timeline locations and accepts only the reviewed selection", () => {
    const measured = createSilenceCutProposal(
      composition(),
      evidence(),
      options,
    );
    expect(measured.candidates).toHaveLength(2);
    expect(measured.candidates[0]).toMatchObject({
      sourceInterval: { start: 2, end: 4 },
      timelineIntervals: [
        { start: 2.25, end: 3.75 },
        { start: 8.125, end: 8.875 },
      ],
      durationReduced: 2.25,
    });

    const selected = createSilenceCutProposal(composition(), evidence(), {
      ...options,
      selectedCandidateIds: [measured.candidates[0]!.id],
    });
    expect(selected.selectedCandidateIds).toEqual([measured.candidates[0]!.id]);
    expect(selected.timelineIntervals).toEqual([
      { start: 2.25, end: 3.75 },
      { start: 8.125, end: 8.875 },
    ]);
    expect(selected.totalDurationReduced).toBe(2.25);
    expect(
      applySilenceCutProposal(composition(), selected, { assets }).duration,
    ).toBe(11.75);
    expect(() =>
      createSilenceCutProposal(composition(), evidence(), {
        ...options,
        selectedCandidateIds: ["silence-unknown"],
      }),
    ).toThrow(/candidate/i);
  });

  it("rejects candidate-to-timeline mappings that were changed after review", () => {
    const proposal = createSilenceCutProposal(
      composition(),
      evidence(),
      options,
    );
    const forged = structuredClone(proposal);
    const first = forged.candidates[0]!;
    const second = forged.candidates[1]!;
    [first.timelineIntervals, second.timelineIntervals] = [
      second.timelineIntervals,
      first.timelineIntervals,
    ];
    [first.durationReduced, second.durationReduced] = [
      second.durationReduced,
      first.durationReduced,
    ];
    expect(() =>
      applySilenceCutProposal(composition(), forged, { assets }),
    ).toThrow(/no longer matches current timeline geometry/u);
  });

  it("retains the existing transcript wrapper's explicit zero-total no-op semantics", () => {
    const before = composition();
    const after = applyTranscriptRipple(before, {
      version: 1,
      assetId: "interview",
      mode: "delete",
      sourceIntervals: [{ start: 2, end: 4 }],
      timelineIntervals: [{ start: 2, end: 4 }],
      totalDurationReduced: 0,
      verifiedSegmentIds: [],
    });
    expect(after).toEqual(before);
    expect(after).not.toBe(before);
  });
  it("maps trim, speed, and repeated instances without cutting outside measured silence", () => {
    const proposal = createSilenceCutProposal(
      composition(),
      evidence(),
      options,
    );
    expect(proposal.sourceIntervals).toEqual([
      { start: 2.25, end: 3.75 },
      { start: 6.25, end: 6.75 },
    ]);
    expect(proposal.timelineIntervals).toEqual([
      { start: 2.25, end: 3.75 },
      { start: 6.25, end: 6.75 },
      { start: 8.125, end: 8.875 },
    ]);
    expect(proposal.totalDurationReduced).toBe(2.75);
    expect(proposal.affectedClipIds).toEqual([
      "first",
      "first-rip-1",
      "repeat",
    ]);
    expect(validateSilenceCutProposal(proposal)).toEqual(proposal);
    const before = composition();
    const next = applySilenceCutProposal(before, proposal, { assets });
    expect(before).toEqual(composition());
    expect(next.duration).toBe(11.25);
    const clips = next.tracks.flatMap((track) => track.clips);
    expect(new Set(clips.map((clip) => clip.id)).size).toBe(clips.length);
    expect(clips.find((clip) => clip.id === "first-rip-1")!.timelineStart).toBe(
      7.25,
    );
    expect(
      clips
        .filter((clip) => clip.assetId === "interview")
        .map((clip) => [clip.sourceIn, clip.sourceOut]),
    ).toEqual([
      [0, 2.25],
      [3.75, 6.25],
      [6.75, 8],
      [2, 2.25],
      [3.75, 6],
    ]);
  });

  it("keeps excessive padding and out-of-trim silence as a zero-cut review", () => {
    const proposal = createSilenceCutProposal(composition(), evidence(), {
      ...options,
      paddingSeconds: 2,
    });
    expect(proposal.timelineIntervals).toEqual([]);
    expect(proposal.affectedClipIds).toEqual([]);
    expect(
      applySilenceCutProposal(composition(), proposal, { assets }),
    ).toEqual(composition());
  });

  it.each([
    "track",
    "clip",
    "source",
    "pin",
    "independent-audio",
    "audio-automation",
  ] as const)("rejects affected %s protection", (protection) => {
    const comp = composition(),
      library = structuredClone(assets);
    const last = comp.tracks[0]!.clips[2]!;
    if (protection === "track") comp.tracks[0]!.locked = true;
    if (protection === "clip") last.locked = true;
    if (protection === "source") library[1]!.state.locked = true;
    if (protection === "pin")
      last.userOverrides = {
        version: 1,
        isUserPinned: true,
        lockedAttributes: ["timing"],
      };
    if (protection === "independent-audio")
      last.audioTiming = {
        version: 1,
        sampleRate: 48000,
        timelineStartSample: 480000,
        sourceInSample: 0,
        sourceOutSample: 192000,
      };
    if (protection === "audio-automation")
      comp.tracks[0]!.clips[0]!.audioAutomation = {
        version: 1,
        role: "music",
        fadeIn: 0.5,
        fadeOut: 1,
        points: [{ time: 3, gain: 0.5 }],
        ducking: [
          {
            start: 1,
            end: 3.5,
            gain: 0.6,
            attack: 0.2,
            release: 0.2,
          },
        ],
      };
    expect(() =>
      createSilenceCutProposal(comp, evidence(), {
        ...options,
        assets: library,
      }),
    ).toThrow(/locked|pinned|independent sound|audio automation/i);
  });

  it("keeps clip-local audio automation intact when ripple only shifts the whole clip", () => {
    const comp = composition();
    const untouched = comp.tracks[0]!.clips[0]!;
    untouched.timelineDuration = 1;
    untouched.sourceOut = 1;
    untouched.audioAutomation = {
      version: 1,
      role: "dialogue",
      fadeIn: 0.2,
      points: [{ time: 0.5, gain: 0.8 }],
    };
    const proposal = createSilenceCutProposal(comp, evidence(), options);
    const applied = applySilenceCutProposal(comp, proposal, { assets });
    expect(applied.tracks[0]!.clips[0]!.audioAutomation).toEqual(
      untouched.audioAutomation,
    );
  });

  it("protects graphic scene pins and allows a protected clip before all cuts", () => {
    const comp = composition();
    comp.graphicScenes = [
      {
        version: 1,
        id: "scene",
        name: "Pinned title",
        start: 10,
        duration: 1,
        zIndex: 0,
        nodes: [],
        userOverrides: {
          version: 1,
          isUserPinned: true,
          lockedAttributes: ["timing"],
        },
      },
    ];
    expect(() => createSilenceCutProposal(comp, evidence(), options)).toThrow(
      /pinned scene/,
    );
    delete comp.graphicScenes;
    comp.tracks.unshift({
      id: "protected-before",
      type: "overlay",
      timing: "overlay",
      locked: true,
      clips: [
        {
          id: "untouched",
          assetId: "other",
          timelineStart: 0,
          timelineDuration: 1,
          sourceIn: 0,
          sourceOut: 1,
          locked: true,
        },
      ],
    });
    expect(
      createSilenceCutProposal(comp, evidence(), options).affectedClipIds,
    ).not.toContain("untouched");
  });

  it("recomputes current protection and geometry instead of trusting a submitted range", () => {
    const proposal = createSilenceCutProposal(
      composition(),
      evidence(),
      options,
    );
    const forged = structuredClone(proposal);
    forged.sourceIntervals[0]!.start = 0;
    expect(() =>
      applySilenceCutProposal(composition(), forged, { assets }),
    ).toThrow(/no longer matches/);
    const shifted = composition();
    shifted.tracks[0]!.clips[1]!.sourceIn = 3;
    shifted.tracks[0]!.clips[1]!.sourceOut = 7;
    expect(() =>
      applySilenceCutProposal(shifted, proposal, { assets }),
    ).toThrow(/no longer matches/);
    const locked = composition();
    locked.tracks[0]!.locked = true;
    expect(() => applySilenceCutProposal(locked, proposal, { assets })).toThrow(
      /locked/,
    );
    const wrongIds = structuredClone(proposal);
    wrongIds.affectedClipIds = ["first"];
    expect(() =>
      applySilenceCutProposal(composition(), wrongIds, { assets }),
    ).toThrow(/no longer matches/);
  });

  it("fails closed on source hash, duration, and proposal identity changes", () => {
    const staleAssets = structuredClone(assets);
    staleAssets[0]!.contentHash = "b".repeat(64);
    expect(() =>
      createSilenceCutProposal(composition(), evidence(), {
        ...options,
        assets: staleAssets,
      }),
    ).toThrow(/hash/);
    const shorter = evidence();
    shorter.duration = 7;
    expect(() =>
      createSilenceCutProposal(composition(), shorter, options),
    ).toThrow(/source clock/);
    const proposal = createSilenceCutProposal(
      composition(),
      evidence(),
      options,
    );
    proposal.compositionId = "different";
    expect(() =>
      applySilenceCutProposal(composition(), proposal, { assets }),
    ).toThrow(/another composition/);
  });
});
