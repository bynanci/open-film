import { describe, expect, it } from "vitest";
import {
  layoutTitleText,
  evaluateTitleOpacity,
  MAX_TITLE_LENGTH,
  resolveTitleStyle,
  type TitleTextMeasure,
} from "../src/title-layout.js";
import { validateTitleStyle } from "../src/validation.js";

const frame = { width: 640, height: 360 };
// Deliberately proportional metrics prove wrapping uses the selected face's
// advances, rather than a character-count estimate.
const measure: TitleTextMeasure = (text, size, tracking) => ({
  width:
    [...text].reduce((sum, value) => sum + (value === "i" ? 0.2 : 1), 0) *
      size +
    Math.max(0, [...text].length - 1) * tracking,
  ascent: size * 0.8,
  descent: size * 0.2,
  left: 0,
});

describe("native title opacity", () => {
  const style = { version: 1 as const, role: "subtitle" as const, fadeOut: 1 };
  it("fades only over the end of the timeline duration and gates outside the clip", () => {
    expect(evaluateTitleOpacity(style, -0.01, 3)).toBe(0);
    expect(evaluateTitleOpacity(style, 0, 3)).toBe(1);
    expect(evaluateTitleOpacity(style, 1.99, 3)).toBe(1);
    expect(evaluateTitleOpacity(style, 2.5, 3)).toBe(0.5);
    expect(evaluateTitleOpacity(style, 3, 3)).toBe(0);
    expect(evaluateTitleOpacity(style, 4, 3)).toBe(0);
  });
  it("keeps legacy and zero-fade subtitles solid and clamps overlong fade to the clip", () => {
    expect(evaluateTitleOpacity(undefined, 2.99, 3)).toBe(1);
    expect(evaluateTitleOpacity({ ...style, fadeOut: 0 }, 2.99, 3)).toBe(1);
    expect(evaluateTitleOpacity({ ...style, fadeOut: 10 }, 0.5, 2)).toBe(0.75);
    expect(evaluateTitleOpacity(style, 0, 0)).toBe(0);
  });
  it.each([
    [NaN, 2],
    [Infinity, 2],
    [0, NaN],
    [0, Infinity],
    [0, -1],
  ])("rejects invalid local time or duration (%s, %s)", (time, duration) => {
    expect(() => evaluateTitleOpacity(style, time, duration)).toThrow(
      /finite|duration/iu,
    );
  });
  it("rejects invalid fade without silently coercing it", () => {
    expect(() => evaluateTitleOpacity({ ...style, fadeOut: -1 }, 0, 2)).toThrow(
      /fade/iu,
    );
    expect(() =>
      evaluateTitleOpacity({ ...style, fadeOut: Infinity }, 0, 2),
    ).toThrow(/fade/iu);
  });
});

describe("measured title layout", () => {
  it("preserves the complete subtitle scrim's existing eight-percent bottom safety by default", () => {
    const layout = layoutTitleText("Our story", undefined, frame, measure);
    expect(layout.style.fadeOut).toBe(0);
    expect(layout.style.bottomSafeMargin).toBe(0.08);
    expect(layout.bounds.y + layout.bounds.height).toBeCloseTo(
      frame.height * 0.92,
    );
  });

  it("lays multiline CJK subtitles inside authored fractional safe-area margins", () => {
    const style = {
      version: 1 as const,
      role: "subtitle" as const,
      fontSize: 24,
      safeArea: { left: 0.2, right: 0.1, top: 0.12, bottom: 0.18 },
    };
    const layout = layoutTitleText("繁體字幕\n第二行", style, frame, measure);
    expect(layout.bounds.x).toBeGreaterThanOrEqual(frame.width * 0.2);
    expect(layout.bounds.x + layout.bounds.width).toBeLessThanOrEqual(
      frame.width * 0.9,
    );
    expect(layout.bounds.y).toBeGreaterThanOrEqual(frame.height * 0.12);
    expect(layout.bounds.y + layout.bounds.height).toBeLessThanOrEqual(
      frame.height * 0.82,
    );
    expect(() =>
      validateTitleStyle({ ...style, safeArea: { left: 0.5, right: 0.5 } }),
    ).toThrow(/safeArea/u);
  });

  it.each([0, 0.08, 0.15, 0.3])(
    "places the complete visible scrim above a %s bottom margin",
    (bottomSafeMargin) => {
      const layout = layoutTitleText(
        "Our story",
        { version: 1, role: "subtitle", bottomSafeMargin },
        frame,
        measure,
      );
      expect(layout.bounds.y + layout.bounds.height).toBeCloseTo(
        frame.height * (1 - bottomSafeMargin),
      );
      expect(layout.bounds.y).toBeGreaterThanOrEqual(frame.height * 0.08);
    },
  );

  it("keeps centered titles on historical safety regardless of a stored bottom setting", () => {
    const style = {
      version: 1 as const,
      role: "film-title" as const,
      fontSize: 100,
      background: "scrim" as const,
      bottomSafeMargin: 0.3,
    };
    const layout = layoutTitleText("A", style, frame, measure);
    expect(layout.bounds).toEqual(
      layoutTitleText("A", { ...style, bottomSafeMargin: 0 }, frame, measure)
        .bounds,
    );
    expect(layout.bounds.y + layout.bounds.height / 2).toBeCloseTo(
      frame.height / 2,
    );
    expect(layout.bounds.y).toBeGreaterThanOrEqual(frame.height * 0.08);
    expect(layout.bounds.y + layout.bounds.height).toBeLessThanOrEqual(
      frame.height * 0.92,
    );
    expect(() => layoutTitleText("A\nB", style, frame, measure)).toThrow(
      /overflow/iu,
    );
  });

  it.each([
    ["fadeOut", -1],
    ["fadeOut", 10.01],
    ["fadeOut", NaN],
    ["fadeOut", Infinity],
    ["bottomSafeMargin", -0.01],
    ["bottomSafeMargin", 0.31],
    ["bottomSafeMargin", NaN],
    ["bottomSafeMargin", Infinity],
  ])(
    "rejects invalid %s %s in persisted data and direct layout",
    (field, value) => {
      const style = {
        version: 1 as const,
        role: "subtitle" as const,
        [field]: value,
      };
      expect(() => validateTitleStyle(style)).toThrow(
        new RegExp(String(field), "u"),
      );
      expect(() => resolveTitleStyle(style, frame)).toThrow(/fade|margin/iu);
    },
  );

  it("validates both optional controls while accepting legacy styles without mutation", () => {
    const legacy = { version: 1 as const, role: "subtitle" as const };
    expect(validateTitleStyle(legacy)).toEqual(legacy);
    expect(
      validateTitleStyle({ ...legacy, fadeOut: 10, bottomSafeMargin: 0.3 }),
    ).toEqual({ ...legacy, fadeOut: 10, bottomSafeMargin: 0.3 });
  });

  it("rejects input above the shared mutation bound before font measurement", () => {
    let measured = false;
    expect(() =>
      layoutTitleText(
        "字".repeat(MAX_TITLE_LENGTH + 1),
        undefined,
        frame,
        () => {
          measured = true;
          return { width: 1, ascent: 1, descent: 0 };
        },
      ),
    ).toThrow(/too long/iu);
    expect(measured).toBe(false);
  });
  it("gives film titles, scene statements and subtitles distinct roles", () => {
    const styles = ["film-title", "scene-statement", "subtitle"].map((role) =>
      resolveTitleStyle({ version: 1, role: role as "film-title" }, frame),
    );
    expect(styles[0]!.fontSize).toBeGreaterThan(styles[1]!.fontSize);
    expect(styles[1]!.fontSize).toBeGreaterThan(styles[2]!.fontSize);
    expect(styles[0]!.position).toBe("center");
    expect(styles[2]!.position).toBe("bottom");
  });

  it("wraps actual widths and keeps Latin words together when they fit", () => {
    const style = {
      version: 1 as const,
      role: "scene-statement" as const,
      fontSize: 20,
      maxWidth: 80,
    };
    expect(
      layoutTitleText("iiiiiiii", style, frame, measure).lines,
    ).toHaveLength(1);
    expect(
      layoutTitleText("WWWWWWWW", style, frame, measure).lines,
    ).toHaveLength(2);
    const layout = layoutTitleText(
      "hello world",
      { ...style, maxWidth: 120 },
      frame,
      measure,
    );
    expect(layout.lines.map((line) => line.text)).toEqual(["hello", "world"]);
  });

  it("keeps closing CJK punctuation off line starts and opening marks off ends", () => {
    const layout = layoutTitleText(
      "我們一起，看見（新的）風景。",
      { version: 1, role: "scene-statement", fontSize: 20, maxWidth: 100 },
      frame,
      measure,
    );
    expect(layout.lines.map((line) => line.text).join("")).toBe(
      "我們一起，看見（新的）風景。",
    );
    for (const line of layout.lines) {
      expect(line.text).not.toMatch(/^[，。！？、）】》」』]/u);
      expect(line.text).not.toMatch(/[（【《「『]$/u);
      expect(line.width).toBeLessThanOrEqual(100);
    }
  });

  it("preserves explicit paragraph breaks and compensates for ink overhang", () => {
    const layout = layoutTitleText(
      "第一行\n第二行",
      { version: 1, role: "film-title", fontSize: 20 },
      frame,
      (text, size, tracking) => ({
        ...measure(text, size, tracking),
        left: -2,
      }),
    );
    expect(layout.lines.map((line) => line.text)).toEqual(["第一行", "第二行"]);
    expect(layout.lines[0]!.originX).toBe(layout.lines[0]!.x + 2);
    expect(layout.bounds.y).toBeGreaterThan(0);
  });

  it("does not let spaces hide punctuation at a new line boundary", () => {
    const layout = layoutTitleText(
      "我們一起 ， 看風景。",
      { version: 1, role: "scene-statement", fontSize: 20, maxWidth: 100 },
      frame,
      measure,
    );
    for (const line of layout.lines) expect(line.text).not.toMatch(/^[，。]/u);
  });

  it("rejects unsafe controls and text that cannot fit without clipping", () => {
    expect(() =>
      layoutTitleText("bad\u0000text", undefined, frame, measure),
    ).toThrow(/control/iu);
    expect(() =>
      layoutTitleText(
        "字".repeat(300),
        { version: 1, role: "film-title", fontSize: 40, maxWidth: 120 },
        frame,
        measure,
      ),
    ).toThrow(/fit|overflow/iu);
  });
});
