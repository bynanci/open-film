import { describe, expect, it } from "vitest";
import {
  resolveTitleFadeFrames,
  titleOpacityAtTime,
  validateTitleStyle,
  type TitleStyle,
} from "../src/index.js";

const style: TitleStyle = { version: 1, role: "subtitle" };

describe("native title opacity", () => {
  it("preserves unfaded titles and their half-open timeline range", () => {
    expect(resolveTitleFadeFrames(undefined, 4, 30)).toEqual({
      fadeInFrames: 0,
      fadeOutFrames: 0,
      frameCount: 120,
    });
    for (const time of [0, 1, 119 / 30, 3.999])
      expect(titleOpacityAtTime(undefined, time, 4, 30)).toBe(1);
    for (const time of [-0.01, 4, 4.1, NaN, Infinity])
      expect(titleOpacityAtTime(undefined, time, 4, 30)).toBe(0);
  });

  it("fades linearly at output frames with transparent first and last frames", () => {
    const faded = { ...style, fadeIn: 0.2, fadeOut: 0.3 };
    expect(resolveTitleFadeFrames(faded, 4, 30)).toEqual({
      fadeInFrames: 6,
      fadeOutFrames: 9,
      frameCount: 120,
    });
    for (const [frame, opacity] of [
      [0, 0],
      [3, 0.5],
      [6, 1],
      [110, 1],
      [115, 4 / 9],
      [119, 0],
    ])
      expect(titleOpacityAtTime(faded, frame! / 30, 4, 30)).toBeCloseTo(
        opacity!,
      );
    expect(titleOpacityAtTime(faded, 3.9 / 30, 4, 30)).toBe(0.5);
  });

  it("shares a fully visible peak when requested fades overlap", () => {
    const faded = { ...style, fadeIn: 0.2, fadeOut: 0.4 };
    expect(resolveTitleFadeFrames(faded, 0.3, 30)).toEqual({
      fadeInFrames: 3,
      fadeOutFrames: 5,
      frameCount: 9,
    });
    expect(titleOpacityAtTime(faded, 0, 0.3, 30)).toBe(0);
    expect(titleOpacityAtTime(faded, 3 / 30, 0.3, 30)).toBe(1);
    expect(titleOpacityAtTime(faded, 5 / 30, 0.3, 30)).toBeCloseTo(0.6);
    expect(titleOpacityAtTime(faded, 8 / 30, 0.3, 30)).toBe(0);
  });

  it("keeps one- and two-frame titles visible instead of overlapping to black", () => {
    const faded = { ...style, fadeIn: 10, fadeOut: 10 };
    expect(resolveTitleFadeFrames(faded, 1 / 30, 30)).toEqual({
      fadeInFrames: 0,
      fadeOutFrames: 0,
      frameCount: 1,
    });
    expect(titleOpacityAtTime(faded, 0, 1 / 30, 30)).toBe(1);
    expect(resolveTitleFadeFrames(faded, 2 / 30, 30)).toEqual({
      fadeInFrames: 1,
      fadeOutFrames: 0,
      frameCount: 2,
    });
    expect(titleOpacityAtTime(faded, 1 / 30, 2 / 30, 30)).toBe(1);
  });

  it("rounds requested fades and tolerates floating point frame boundaries", () => {
    expect(
      resolveTitleFadeFrames(
        { ...style, fadeIn: 0.049, fadeOut: 0.051 },
        0.1 + 0.2,
        30,
      ),
    ).toEqual({
      fadeInFrames: 1,
      fadeOutFrames: 2,
      frameCount: 9,
    });
    expect(resolveTitleFadeFrames(undefined, 0.05, 30).frameCount).toBe(2);
    expect(resolveTitleFadeFrames(undefined, 0.001, 30).frameCount).toBe(1);
    expect(
      titleOpacityAtTime({ ...style, fadeIn: 1 }, 29 / 30, 2, 30),
    ).toBeCloseTo(29 / 30);
  });

  it("accepts bounded optional fields without changing existing style input", () => {
    const supplied = { ...style, fadeIn: 0.2, fadeOut: 10, bottomInset: 0.15 };
    expect(validateTitleStyle(supplied)).toEqual(supplied);
    expect(validateTitleStyle(style)).toEqual({ version: 1, role: "subtitle" });
    expect(
      validateTitleStyle({ ...style, fadeIn: 0, fadeOut: 0, bottomInset: 0.45 })
        .bottomInset,
    ).toBe(0.45);
  });

  it.each([
    ["fadeIn", -0.1],
    ["fadeIn", 10.1],
    ["fadeOut", NaN],
    ["fadeOut", Infinity],
    ["fadeOut", "0.2"],
    ["fadeIn", null],
    ["bottomInset", -0.01],
    ["bottomInset", 0.451],
    ["bottomInset", NaN],
  ])("rejects invalid %s=%s", (key, value) => {
    expect(() => validateTitleStyle({ ...style, [key]: value })).toThrow();
  });

  it("rejects invalid timing instead of returning an unusable opacity", () => {
    for (const duration of [0, -1, NaN, Infinity])
      expect(() => resolveTitleFadeFrames(style, duration, 30)).toThrow();
    for (const frameRate of [0, -1, NaN, Infinity])
      expect(() => resolveTitleFadeFrames(style, 2, frameRate)).toThrow();
    expect(() =>
      resolveTitleFadeFrames({ ...style, fadeIn: -1 }, 2, 30),
    ).toThrow();
  });
});
