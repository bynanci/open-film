// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { reviewRecordedAudioDuration } from "../fixtures/silence-real-media-contract.js";

// Literal expectations are independent of the core helper used by the QA gate.
it.each([
  { duration: 18.84, pcm: 904320, rate: 25 },
  { duration: 1.001, pcm: 48048, rate: 30000 / 1001 },
])(
  "keeps aligned $duration s at $rate fps free of tail warnings",
  ({ duration, pcm, rate }) => {
    expect(
      reviewRecordedAudioDuration({
        compositionDurationSeconds: duration,
        pcmFrames: pcm,
        exportFrameRate: rate,
        aacDurationSeconds: duration,
      }),
    ).toMatchObject({
      objectiveContractPass: true,
      fullPcmFrames: pcm,
      expectedExportFrames: pcm,
      lostTailSamples: 0,
      warnings: [],
    });
  },
);

it.each([
  {
    duration: 15.264,
    pcm: 732672,
    rate: 25,
    exported: 15.24,
    exportFrames: 731520,
    lost: 1152,
    milliseconds: 24,
  },
  {
    duration: 1.01,
    pcm: 48480,
    rate: 30,
    exported: 1,
    exportFrames: 48000,
    lost: 480,
    milliseconds: 10,
  },
  {
    duration: 1.02,
    pcm: 48960,
    rate: 30000 / 1001,
    exported: 1.001,
    exportFrames: 48048,
    lost: 912,
    milliseconds: 19,
  },
  {
    duration: 1.02,
    pcm: 48960,
    rate: 24000 / 1001,
    exported: 1.001,
    exportFrames: 48048,
    lost: 912,
    milliseconds: 19,
  },
])(
  "accepts contracted $exported s export while warning about the full $duration s tail at $rate fps",
  ({ duration, pcm, rate, exported, exportFrames, lost, milliseconds }) => {
    const review = reviewRecordedAudioDuration({
      compositionDurationSeconds: duration,
      pcmFrames: pcm,
      exportFrameRate: rate,
      aacDurationSeconds: exported,
    });
    expect(review).toMatchObject({
      objectiveContractPass: true,
      fullCompositionDurationSeconds: duration,
      fullPcmFrames: pcm,
      fullPcmDurationSeconds: duration,
      expectedExportFrames: exportFrames,
      lostTailSamples: lost,
      lostTailMilliseconds: milliseconds,
      warnings: [
        {
          code: "qa.frameAlignedAudioTail",
          severity: "manual-review-required",
          lostTailSamples: lost,
          lostTailMilliseconds: milliseconds,
        },
      ],
    });
    expect(review.expectedExportDurationSeconds).toBeCloseTo(exported, 12);
    expect(Math.abs(review.aacExportErrorSamples)).toBeLessThan(1e-8);
  },
);

it("rejects additional AAC shortening even when known frame-policy tail loss is present", () => {
  const review = reviewRecordedAudioDuration({
    compositionDurationSeconds: 15.264,
    pcmFrames: 732672,
    exportFrameRate: 25,
    aacDurationSeconds: 15.239,
  });
  expect(review.objectiveContractPass).toBe(false);
  expect(review.aacExportErrorSamples).toBeCloseTo(-48, 6);
  expect(review.warnings).toEqual([
    {
      code: "qa.frameAlignedAudioTail",
      severity: "manual-review-required",
      lostTailSamples: 1152,
      lostTailMilliseconds: 24,
    },
  ]);
});

it.each([-2, 2])(
  "rejects an unexpected AAC deviation of %s samples on aligned output",
  (samples) => {
    const review = reviewRecordedAudioDuration({
      compositionDurationSeconds: 1,
      pcmFrames: 48000,
      exportFrameRate: 25,
      aacDurationSeconds: (48000 + samples) / 48000,
    });
    expect(review.objectiveContractPass).toBe(false);
    expect(review.warnings).toEqual([]);
  },
);

it("retains the one-sample export-duration tolerance", () => {
  expect(
    reviewRecordedAudioDuration({
      compositionDurationSeconds: 1,
      pcmFrames: 48000,
      exportFrameRate: 25,
      aacDurationSeconds: 47999 / 48000,
    }).objectiveContractPass,
  ).toBe(true);
});

it("rejects shortened full PCM even if AAC matches the export boundary", () => {
  expect(
    reviewRecordedAudioDuration({
      compositionDurationSeconds: 15.264,
      pcmFrames: 731520,
      exportFrameRate: 25,
      aacDurationSeconds: 15.24,
    }).objectiveContractPass,
  ).toBe(false);
});
