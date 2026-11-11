// SPDX-License-Identifier: Apache-2.0
// QA-only extraction of the recorded-media duration gate; no render authority.
import { frameAlignedDuration } from "@openfilm/core";
export interface RecordedAudioDurationInput {
  compositionDurationSeconds: number;
  pcmFrames: number;
  exportFrameRate: number;
  aacDurationSeconds: number;
}
export interface RecordedAudioTailWarning {
  code: "qa.frameAlignedAudioTail";
  severity: "manual-review-required";
  lostTailSamples: number;
  lostTailMilliseconds: number;
}
export interface RecordedAudioDurationReview {
  fullCompositionDurationSeconds: number;
  fullPcmFrames: number;
  fullPcmDurationSeconds: number;
  exportFrameRate: number;
  expectedExportDurationSeconds: number;
  expectedExportFrames: number;
  actualAacDurationSeconds: number;
  pcmCompositionErrorSamples: number;
  aacExportErrorSamples: number;
  lostTailSamples: number;
  lostTailMilliseconds: number;
  objectiveContractPass: boolean;
  warnings: RecordedAudioTailWarning[];
}

export function reviewRecordedAudioDuration(
  input: RecordedAudioDurationInput,
): RecordedAudioDurationReview {
  const exportDuration = frameAlignedDuration(
    input.compositionDurationSeconds,
    input.exportFrameRate,
  );
  const exportFrames = Math.round(exportDuration * 48000);
  const pcmError =
    input.pcmFrames - Math.round(input.compositionDurationSeconds * 48000);
  const error = input.aacDurationSeconds * 48000 - exportFrames;
  const lostTailSamples = Math.max(0, input.pcmFrames - exportFrames);
  const lostTailMilliseconds = lostTailSamples / 48;
  return {
    fullCompositionDurationSeconds: input.compositionDurationSeconds,
    fullPcmFrames: input.pcmFrames,
    fullPcmDurationSeconds: input.pcmFrames / 48000,
    exportFrameRate: input.exportFrameRate,
    expectedExportDurationSeconds: exportDuration,
    expectedExportFrames: exportFrames,
    actualAacDurationSeconds: input.aacDurationSeconds,
    pcmCompositionErrorSamples: pcmError,
    aacExportErrorSamples: error,
    lostTailSamples,
    lostTailMilliseconds,
    objectiveContractPass:
      Number.isSafeInteger(input.pcmFrames) &&
      input.pcmFrames > 0 &&
      exportFrames > 0 &&
      Math.abs(pcmError) <= 1 &&
      Math.abs(error) <= 1,
    warnings:
      lostTailSamples > 0
        ? [
            {
              code: "qa.frameAlignedAudioTail",
              severity: "manual-review-required",
              lostTailSamples,
              lostTailMilliseconds,
            },
          ]
        : [],
  };
}
