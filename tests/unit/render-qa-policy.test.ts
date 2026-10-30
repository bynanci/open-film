// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import {
  assertRenderQaIdentity,
  assertRenderQaMetric,
  renderQaPolicy,
} from "../helpers/render-qa-policy.js";

const bounds = [
  ["photoDepth.rgbMae", "rgb-channel-units", "lt", 12],
  ["photoDepth.edgeChannelError", "rgb-channel-units", "lte", 8],
  ["photoDepth.alphaChannelError", "rgb-channel-units", "lte", 8],
  ["filmLook.channelError", "rgb-channel-units", "lte", 3],
  ["filmLook.losslessChannelError", "rgb-channel-units", "lte", 1],
  ["title.highDetailGlyphChannelError", "rgb-channel-units", "lte", 8],
  ["cutDesk.channelError", "rgb-channel-units", "lte", 12],
  ["cutDesk.primaryAmplitudeError", "linear-peak-amplitude", "lt", 0.006],
  ["cutDesk.overlayAmplitudeError", "linear-peak-amplitude", "lt", 0.004],
  ["cutDesk.absentAmplitude", "linear-peak-amplitude", "lt", 0.003],
  ["cutDesk.onsetGainRatio", "ratio", "gt", 0.9],
  ["title.textDelta", "luminance-units", "gt", 60],
  ["title.scrimDelta", "luminance-units", "lt", -60],
  ["title.exclusiveGateLuminance", "luminance-units", "lt", 5],
  ["audio.trueMinusSamplePeak", "decibels", "gte", -0.2],
  ["photo.subjectEdgeError", "output-pixels", "lte", 1.5],
  ["photo.firstFrameCenterError", "output-pixels", "lt", 0.12],
  ["photo.panTravel", "output-pixels", "gt", 1.5],
  ["photo.panStep", "output-pixels-per-frame", "lt", 0.18],
  ["photo.fadeOutRmsRatio", "ratio", "lt", 0.2],
  ["photo.fadeInRmsRatio", "ratio", "lt", 0.5],
] as const;
it.each(bounds)(
  "preserves %s units and its exact comparator",
  (id, unit, op, limit) => {
    expect(renderQaPolicy[id]).toEqual({ kind: "bound", unit, op, limit });
    const delta = Math.max(1e-12, Math.abs(limit) * 1e-12);
    const accepted =
      op === "gt" || op === "gte" ? limit + delta : limit - delta;
    const rejected =
      op === "gt" || op === "gte" ? limit - delta : limit + delta;
    expect(assertRenderQaMetric(id, accepted).passed).toBe(true);
    expect(() => assertRenderQaMetric(id, rejected)).toThrow();
    if (op === "lte" || op === "gte")
      expect(() => assertRenderQaMetric(id, limit)).not.toThrow();
    else expect(() => assertRenderQaMetric(id, limit)).toThrow();
  },
);
it.each([
  ["cutDesk.pts", "seconds", 6],
  ["title.opacityRatio", "ratio", 1],
  ["title.sourceLuminance", "luminance-units", 0],
  ["audio.duration", "seconds", 1],
  ["photo.duration", "seconds", 1],
  ["photo.tightDuration", "seconds", 3],
] as const)("retains Vitest closeTo precision for %s", (id, unit, digits) => {
  expect(renderQaPolicy[id]).toEqual({ kind: "closeTo", unit, digits });
  const boundary = 0.5 * 10 ** -digits;
  for (const actual of [
    0,
    boundary * 0.99,
    boundary,
    boundary * 1.01,
    -boundary,
  ]) {
    let matcherPassed = true;
    try {
      expect(actual).toBeCloseTo(0, digits);
    } catch {
      matcherPassed = false;
    }
    if (matcherPassed)
      expect(() => assertRenderQaMetric(id, actual, 0)).not.toThrow();
    else expect(() => assertRenderQaMetric(id, actual, 0)).toThrow();
  }
});
it("retains the open LUFS interval and dynamic duration bound", () => {
  expect(() => assertRenderQaMetric("audio.integratedLufs", -20)).not.toThrow();
  for (const value of [-35, -10])
    expect(() => assertRenderQaMetric("audio.integratedLufs", value)).toThrow();
  const bound = 1 / 30 + 0.001;
  expect(
    assertRenderQaMetric("photoFilm.durationError", bound, undefined, {
      frameRate: 30,
    }).rule,
  ).toMatchObject({ op: "lte", limit: bound });
  expect(() =>
    assertRenderQaMetric("photoFilm.durationError", bound + 0.0001, undefined, {
      frameRate: 30,
    }),
  ).toThrow();
});
it("rejects missing/nonfinite measurements and missing/invalid rate context", () => {
  for (const value of [NaN, Infinity, -Infinity])
    expect(() => assertRenderQaMetric("photoDepth.rgbMae", value)).toThrow();
  expect(() => assertRenderQaMetric("cutDesk.pts", 0)).toThrow();
  for (const frameRate of [undefined, 0, -1, NaN, Infinity])
    expect(() =>
      assertRenderQaMetric("photoFilm.durationError", 0, undefined, {
        frameRate,
      }),
    ).toThrow();
});
it.each([
  ["photoDepth.rgbMae", -1],
  ["cutDesk.channelError", 256],
  ["cutDesk.primaryAmplitudeError", -0.001],
  ["photo.firstFrameCenterError", -0.001],
] as const)("rejects an impossible %s observable", (id, value) => {
  expect(() => assertRenderQaMetric(id, value)).toThrow(/invalid/u);
});
it("checks identities without coercion and only compares decoded bytes", () => {
  const hash = "a".repeat(64);
  expect(assertRenderQaIdentity("sourceHash", hash, hash).passed).toBe(true);
  expect(() =>
    assertRenderQaIdentity("fontHash", "b".repeat(64), hash),
  ).toThrow();
  expect(() =>
    assertRenderQaIdentity("sourceHash", "unhashed", hash),
  ).toThrow();
  expect(() => assertRenderQaIdentity("frameCount", 180, "180")).toThrow();
  expect(() => assertRenderQaIdentity("frameCount", 0, 0)).toThrow();
  expect(
    assertRenderQaIdentity(
      "decodedLossless",
      Uint8Array.of(1, 2, 3),
      Uint8Array.of(1, 2, 3),
    ).passed,
  ).toBe(true);
  expect(() =>
    assertRenderQaIdentity(
      "decodedLossless",
      Uint8Array.of(1, 2, 4),
      Uint8Array.of(1, 2, 3),
    ),
  ).toThrow();
  expect(() =>
    assertRenderQaIdentity(
      "decodedLossless",
      new Uint8Array(),
      new Uint8Array(),
    ),
  ).toThrow();
});
