// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import type {
  Clip,
  MediaAsset,
  ProjectTimebaseV1,
  WaveformData,
} from "../src/index.js";
import {
  projectClipWaveform,
  resolveClipAudioRange,
  waveformPeakBetween,
} from "../src/sequence-waveform.js";

const timebase: ProjectTimebaseV1 = {
  version: 1,
  rateNumerator: 20,
  rateDenominator: 1,
  dropFrame: false,
};
const asset: MediaAsset = {
  id: "pulse",
  name: "Synthetic pulse",
  uri: "file:///synthetic.wav",
  mediaType: "audio",
  duration: 4,
  contentHash: "pulse-hash",
  tags: [],
  state: { locked: true },
  metadata: {},
};
const wave: WaveformData = {
  assetId: "pulse",
  duration: 4,
  sampleRate: 2,
  peaks: [0, 0.2, 0.8, 0, 0.4, 1, 0, 0.1],
  provenance: {
    providerId: "openfilm.ffmpeg-waveform",
    version: "1",
    sourceHash: "pulse-hash",
    createdAt: "2026-10-30T00:00:00Z",
  },
};
const clip: Clip = {
  id: "trimmed",
  assetId: asset.id,
  sourceIn: 1,
  sourceOut: 3,
  timelineStart: 1,
  timelineDuration: 2,
  locked: true,
};
function project(
  overrides: Partial<Parameters<typeof projectClipWaveform>[0]> = {},
) {
  return projectClipWaveform({
    clip,
    asset,
    waveform: wave,
    sourceHash: "pulse-hash",
    timebase,
    viewStartFrame: 0,
    viewEndFrame: 80,
    columns: 8,
    ...overrides,
  });
}

it("places trimmed source peaks in sequence time and leaves gaps uncovered", () => {
  expect(project().peaks).toEqual([0, 0, 0.8, 0, 0.4, 1, 0, 0]);
  expect(project().covered).toEqual([
    false,
    false,
    true,
    true,
    true,
    true,
    false,
    false,
  ]);
  expect(project()).toMatchObject({
    startFrame: 20,
    endFrame: 60,
    audioStart: 1,
    audioEnd: 3,
  });
});
it("compresses source bins at double speed without moving the sequence origin", () => {
  expect(
    project({ clip: { ...clip, timelineDuration: 1, transform: { speed: 2 } } })
      .peaks,
  ).toEqual([0, 0, 0.8, 1, 0, 0, 0, 0]);
});
it("expands source bins at half speed using the rational frame viewport", () => {
  const result = project({
    clip: {
      ...clip,
      sourceIn: 0,
      sourceOut: 2,
      timelineDuration: 4,
      transform: { speed: 0.5 },
    },
    viewEndFrame: 120,
    columns: 12,
  });
  expect(result.peaks).toEqual([0, 0, 0, 0, 0.2, 0.2, 0.8, 0.8, 0, 0, 0, 0]);
  expect(result.covered).toEqual([
    false,
    false,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    false,
    false,
  ]);
});
it("renders silence after a short explicit source-out rather than holding the last peak", () => {
  const result = project({
    clip: { ...clip, timelineStart: 0, sourceOut: 1.5, timelineDuration: 3 },
    viewEndFrame: 60,
    columns: 6,
  });
  expect(result.peaks).toEqual([0.8, 0, 0, 0, 0, 0]);
  expect(result.covered).toEqual([true, false, false, false, false, false]);
  expect(result.audioEnd).toBe(0.5);
});
it("keeps repeated uses independent and never mutates locked source/clip/evidence", () => {
  const before = structuredClone({ clip, asset, wave });
  expect(
    project({ clip: { ...clip, timelineStart: 0, timelineDuration: 1 } }).peaks,
  ).toEqual([0.8, 0, 0, 0, 0, 0, 0, 0]);
  expect(
    project({ clip: { ...clip, timelineStart: 2, timelineDuration: 1 } }).peaks,
  ).toEqual([0, 0, 0, 0, 0.8, 0, 0, 0]);
  expect({ clip, asset, wave }).toEqual(before);
});
it("preserves renderer millisecond audio scheduling inside a frame-rounded picture range", () => {
  const short = { ...wave, sampleRate: 10, duration: 0.1, peaks: [1] };
  const result = project({
    clip: {
      ...clip,
      timelineStart: 0.026,
      timelineDuration: 0.1,
      sourceIn: 0,
      sourceOut: 0.1,
    },
    waveform: short,
    viewEndFrame: 20,
    columns: 100,
  });
  expect(result).toMatchObject({
    startFrame: 1,
    endFrame: 3,
    audioStart: 0.026,
    audioEnd: 0.126,
  });
  expect(
    result.covered.flatMap((covered, index) => (covered ? [index] : [])),
  ).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  expect(result.peaks.slice(13)).toEqual(Array(87).fill(0));
});
it("uses rational timebase and excludes the next edit's exact boundary", () => {
  const result = project({
    clip: {
      ...clip,
      timelineStart: 1.001,
      timelineDuration: 1.001,
      sourceIn: 0,
      sourceOut: 1.001,
    },
    timebase: { ...timebase, rateNumerator: 30000, rateDenominator: 1001 },
    viewEndFrame: 90,
    columns: 3,
  });
  expect(result.startFrame).toBe(30);
  expect(result.endFrame).toBe(60);
  expect(result.covered).toEqual([false, true, false]);
});
it("shares partial-final-bin boundaries with Source view", () => {
  const tail = {
    ...wave,
    sampleRate: 50,
    duration: 1.001,
    peaks: [...Array<number>(50).fill(0), 1],
  };
  expect(waveformPeakBetween(tail, 0.98, 1)).toBe(0);
  expect(waveformPeakBetween(tail, 1, 1.001)).toBe(1);
  expect(waveformPeakBetween(tail, 1.001, 1.1)).toBe(0);
  expect(waveformPeakBetween(tail, -0.2, 0)).toBe(0);
});
it("does not extend audio for a visual crossfade or past known source duration", () => {
  expect(
    project({
      clip: { ...clip, transition: { type: "crossfade", duration: 0.5 } },
    }).covered,
  ).toEqual(project().covered);
  expect(
    resolveClipAudioRange(
      { ...clip, sourceOut: 1.52 },
      { ...asset, duration: 1.5 },
    ),
  ).toMatchObject({ audioStart: 1, audioEnd: 1.5, sourceOut: 1.5 });
});
it.each([
  { sourceHash: "wrong" },
  { waveform: { ...wave, assetId: "foreign" } },
  {
    waveform: {
      ...wave,
      provenance: { ...wave.provenance, sourceHash: "old" },
    },
  },
  { waveform: { ...wave, peaks: [NaN] } },
  { waveform: { ...wave, peaks: [1.01] } },
  { waveform: { ...wave, peaks: Array(20001).fill(0) } },
  { waveform: { ...wave, sampleRate: 0 } },
  { waveform: { ...wave, duration: Infinity } },
  { viewStartFrame: -0.1 },
  { viewEndFrame: 0 },
  { columns: 0 },
  { columns: 2049 },
  { columns: 2.5 },
])("rejects invalid, stale or unbounded evidence %#", (input) => {
  expect(() => project(input)).toThrow();
});

it("projects raw independent J/L peaks outside picture edges and contribution masks separately", async () => {
  const { buildAudioMixPlan } = await import("../src/index.js");
  const independent: Clip = {
    ...clip,
    audioTiming: {
      version: 1,
      sampleRate: 48000,
      timelineStartSample: 24000,
      sourceInSample: 24000,
      sourceOutSample: 168000,
    },
    transform: { volume: 0 },
  };
  const secondary = { ...independent, id: "secondary" };
  const mixPlan = buildAudioMixPlan(
    {
      id: "cut",
      storyId: "s",
      duration: 4,
      tracks: [{ id: "v", type: "video", clips: [independent, secondary] }],
    },
    [asset],
    {
      timebase,
      coverage: [
        {
          version: 1,
          bindingId: "b",
          compositionId: "cut",
          primaryClipId: clip.id,
          secondaryClipId: secondary.id,
          startSample: 60000,
          endSample: 96000,
          policy: {
            version: 1,
            mode: "replace-primary",
            role: "ambience",
            gain: 0.5,
          },
        },
      ],
    },
  );
  const result = project({ clip: independent, mixPlan });
  expect(result.peaks).toEqual([0, 0.2, 0.8, 0, 0.4, 1, 0, 0]);
  expect(result.audioStart).toBe(0.5);
  expect(result.audioEnd).toBe(3.5);
  expect(result.audible).toEqual([
    false,
    true,
    true,
    false,
    true,
    true,
    true,
    false,
  ]);
  expect(result.suppressed).toEqual([
    false,
    false,
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
  expect(result.excluded).toEqual(Array(8).fill(false));
  const other = project({ clip: secondary, mixPlan });
  expect(other.peaks).toEqual(result.peaks);
  expect(other.excluded).toEqual([
    false,
    true,
    true,
    false,
    true,
    true,
    true,
    false,
  ]);
});
