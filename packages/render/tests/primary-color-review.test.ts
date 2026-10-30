// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import * as render from "../src/index.js";
import { PRIMARY_COLOR_IDENTITY } from "@openfilm/core";
const pixels = Uint8Array.from(
  Array.from({ length: 128 }, (_, i) => [32 + i, 40 + i, 28 + i]).flat(),
);
it("measures deterministic luma/range/clipping from real RGB samples", () => {
  expect(render.measurePrimaryColorPixels).toBeTypeOf("function");
  expect(
    render.measurePrimaryColorPixels(
      Uint8Array.from([0, 0, 0, 128, 128, 128, 255, 255, 255]),
    ),
  ).toEqual({
    pixelCount: 3,
    p10Y: 0,
    p50Y: 128,
    p90Y: 255,
    meanR: 127.66666666666667,
    meanB: 127.66666666666667,
    clippedFraction: 2 / 3,
  });
  expect(() => render.measurePrimaryColorPixels(new Uint8Array())).toThrow();
});
it("finds a reproducible bounded statistical suggestion and never worsens its predicted score", () => {
  expect(render.suggestPrimaryColor).toBeTypeOf("function");
  const reference = render.measurePrimaryColorPixels(
    Uint8Array.from(pixels, (x) => Math.min(255, x + 24)),
  );
  const result = render.suggestPrimaryColor(
    [pixels],
    reference,
    PRIMARY_COLOR_IDENTITY,
  );
  expect(result).toEqual(
    render.suggestPrimaryColor([pixels], reference, PRIMARY_COLOR_IDENTITY),
  );
  expect(result.exposureEv).toBeGreaterThan(0);
  expect(result.exposureEv).toBeLessThanOrEqual(2);
  expect(result.temperature).toBeGreaterThanOrEqual(-1);
  expect(result.temperature).toBeLessThanOrEqual(1);
  expect(result.contrast).toBeGreaterThanOrEqual(0.5);
  expect(result.contrast).toBeLessThanOrEqual(1.5);
});
