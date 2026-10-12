import { describe, expect, it } from "vitest";
import { frameAlignedDuration } from "../src/index.js";

describe("shared output frame duration", () => {
  it.each([
    [1.01, 30, 1],
    [1.04, 30, 31 / 30],
    [1.02, 30000 / 1001, 1.001],
    [1, 30000 / 1001, (29 * 1001) / 30000],
    [1.02, 24000 / 1001, 1.001],
    [0.01, 30, 0],
    [1 / 30, 30, 1 / 30],
    [1 + 1e-10, 30, 1],
    [1 - 5e-10, 30, 1],
    [1 - 2e-9, 30, 29 / 30],
  ])(
    "aligns %s seconds at %s fps to %s seconds",
    (duration, frameRate, expected) => {
      expect(frameAlignedDuration(duration, frameRate)).toBeCloseTo(
        expected,
        12,
      );
    },
  );
  it.each([0, -1, Number.NaN, Infinity, -Infinity])(
    "rejects invalid duration %s",
    (duration) => {
      expect(() => frameAlignedDuration(duration, 30)).toThrow("duration");
    },
  );
  it.each([0, -1, Number.NaN, Infinity, -Infinity])(
    "rejects invalid frame rate %s",
    (frameRate) => {
      expect(() => frameAlignedDuration(1, frameRate)).toThrow("Frame rate");
    },
  );
});
