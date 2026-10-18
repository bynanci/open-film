import { describe, expect, it } from "vitest";
import {
  layoutTitleText,
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

describe("measured title layout", () => {
  it("supports a safe top-right title without changing the bottom inset", () => {
    const style = {
      version: 1 as const,
      role: "subtitle" as const,
      fontSize: 20,
      position: "top" as const,
      align: "right" as const,
      background: "scrim" as const,
      bottomInset: 0.45,
    };
    expect(validateTitleStyle(style).position).toBe("top");
    const layout = layoutTitleText("字幕", style, frame, measure);
    expect(layout.bounds.y).toBeCloseTo(28.8);
    expect(layout.bounds.x + layout.bounds.width).toBeCloseTo(588.8);
    expect(layout.bounds.height).toBe(34);
    expect(
      layoutTitleText("字幕", { ...style, bottomInset: 0 }, frame, measure)
        .bounds,
    ).toEqual(layout.bounds);
    expect(resolveTitleStyle(undefined, frame).position).toBe("bottom");
  });

  it("places the complete bottom scrim at the authored inset", () => {
    const style = {
      version: 1 as const,
      role: "subtitle" as const,
      fontSize: 20,
      background: "scrim" as const,
    };
    const original = layoutTitleText("字幕", style, frame, measure);
    const raised = layoutTitleText(
      "字幕",
      { ...style, bottomInset: 0.15 },
      frame,
      measure,
    );
    expect(original.bounds.y + original.bounds.height).toBeCloseTo(331.2);
    expect(raised.bounds.y + raised.bounds.height).toBeCloseTo(306);
    expect(raised.bounds.height).toBe(original.bounds.height);
    const edge = layoutTitleText(
      "字幕",
      { ...style, bottomInset: 0 },
      frame,
      measure,
    );
    expect(edge.bounds.y + edge.bounds.height).toBe(360);
  });

  it("reserves top safety space for raised multiline titles but leaves centered titles unchanged", () => {
    const style = {
      version: 1 as const,
      role: "subtitle" as const,
      fontSize: 20,
    };
    const text = "字幕\n".repeat(7) + "字幕";
    expect(() =>
      layoutTitleText(text, { ...style, bottomInset: 0.45 }, frame, measure),
    ).toThrow(/overflow/iu);
    const centered = { ...style, position: "center" as const };
    expect(
      layoutTitleText(text, { ...centered, bottomInset: 0.45 }, frame, measure)
        .bounds,
    ).toEqual(layoutTitleText(text, centered, frame, measure).bounds);
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
