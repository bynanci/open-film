// SPDX-License-Identifier: Apache-2.0
/** Protocol identities, not a renderer or expected-pixel evaluator. */
export const renderQaPlatforms = [
  "linux-x64",
  "win32-x64",
  "darwin-arm64",
] as const;
export const renderQaControls = {
  oneFrameAudio: {
    metricId: "cutDesk.absentAmplitude",
    kind: "decoded-output",
    baseline: "audio.edgeAbsent.t1.f440",
    output: "oneFrameAudio",
  },
  pixelColor: {
    metricId: "cutDesk.channelError",
    kind: "decoded-output",
    baseline: "video.color.f0.c0",
    output: "blackVideo",
  },
  primaryGain: {
    metricId: "cutDesk.primaryAmplitudeError",
    kind: "decoded-output",
    baseline: "audio.primary.t0",
    output: "halfGain",
  },
  overlayGain: {
    metricId: "cutDesk.overlayAmplitudeError",
    kind: "decoded-output",
    baseline: "audio.overlay.t2",
    output: "halfGain",
  },
  absentTone: {
    metricId: "cutDesk.absentAmplitude",
    kind: "decoded-output",
    baseline: "audio.absent.t0.f880",
    output: "absentTone",
  },
  photoDepthPixels: {
    metricId: "photoDepth.rgbMae",
    kind: "decoded-output",
    baseline: "depth.mae.f90",
    output: "blackDepth",
  },
  fontSubstitution: {
    metricId: "identity.fontHash",
    kind: "identity-fixture",
    baseline: "font.sansRegular.identity",
    output: "substitutedFont",
  },
  sourceMutation: {
    metricId: "identity.sourceHash",
    kind: "identity-fixture",
    baseline: "source.original0",
    output: "mutatedSource",
  },
  missingFrame: {
    metricId: "identity.frameCount",
    kind: "decoded-output",
    baseline: "video.frameCount",
    output: "missingFrame",
  },
  losslessPixels: {
    metricId: "identity.decodedLossless",
    kind: "decoded-output",
    baseline: "png.lossless",
    output: "losslessNegated",
  },
} as const;
export const renderQaSourceIds = [
  "original0",
  "original1",
  "original2",
  "original3",
  "depth0",
  "depth1",
  "depth2",
] as const;
export const renderQaOutputIds = [
  "validVideo",
  "diagnosticPcm",
  "oneFrameAudio",
  "halfGain",
  "absentTone",
  "blackVideo",
  "missingFrame",
  "depthVideo",
  "blackDepth",
  "title.sansRegular",
  "title.sansBold",
  "title.serifRegular",
  "title.serifBold",
  "substitutedFont",
  "losslessCopy",
  "losslessNegated",
  "mutatedSource",
] as const;
const sampleMetrics: Record<string, string> = {
  "video.frameCount": "identity.frameCount",
  "png.lossless": "identity.decodedLossless",
};
for (const frame of [0, 59, 60, 67, 75, 90, 119, 120, 179]) {
  sampleMetrics[`video.pts.f${frame}`] = "cutDesk.pts";
  for (let c = 0; c < 3; c++)
    sampleMetrics[`video.color.f${frame}.c${c}`] = "cutDesk.channelError";
}
for (const [i, frequency] of [440, 660, 660, 880, 880, 880].entries()) {
  sampleMetrics[`audio.primary.t${i}`] = "cutDesk.primaryAmplitudeError";
  sampleMetrics[`audio.overlay.t${i}`] = "cutDesk.overlayAmplitudeError";
  for (const absent of [440, 660, 880].filter((value) => value !== frequency))
    sampleMetrics[`audio.absent.t${i}.f${absent}`] = "cutDesk.absentAmplitude";
}
for (const [i, frequency] of [
  440, 660, 660, 880, 1100, 1100, 1100, 1100,
].entries()) {
  if (frequency === 1100)
    sampleMetrics[`audio.edgeOverlay.t${i}`] = "cutDesk.overlayAmplitudeError";
  else {
    sampleMetrics[`audio.edgePcm.t${i}`] = "cutDesk.primaryAmplitudeError";
    sampleMetrics[`audio.edgeRatio.t${i}`] = "cutDesk.onsetGainRatio";
    for (const absent of [440, 660, 880].filter((value) => value !== frequency))
      sampleMetrics[`audio.edgeAbsent.t${i}.f${absent}`] =
        "cutDesk.absentAmplitude";
  }
}
for (const frame of [0, 90, 179]) {
  sampleMetrics[`depth.mae.f${frame}`] = "photoDepth.rgbMae";
  for (let c = 0; c < 3; c++)
    sampleMetrics[`depth.edge.f${frame}.c${c}`] = "photoDepth.edgeChannelError";
}
for (const face of ["sansRegular", "sansBold", "serifRegular", "serifBold"]) {
  sampleMetrics[`font.${face}.identity`] = "identity.fontHash";
  for (let c = 0; c < 3; c++)
    sampleMetrics[`title.${face}.c${c}`] = "title.highDetailGlyphChannelError";
}
for (const source of renderQaSourceIds)
  sampleMetrics[`source.${source}`] = "identity.sourceHash";
export const renderQaSampleMetricIds = Object.freeze(sampleMetrics);
export const requiredRenderQaMetrics = [
  ...new Set(Object.values(sampleMetrics)),
];
