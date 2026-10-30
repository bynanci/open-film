// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import type { TitleStyle } from "../src/models.js";

const text = "繁體標題\nOur story";
const frame = { width: 640, height: 360 };
const style: TitleStyle = { version: 1, role: "subtitle", fontSize: 24 };
const measure = (
  _run: string,
  value: string,
  size: number,
  tracking: number,
) => ({
  width:
    [...value].length * size + Math.max(0, [...value].length - 1) * tracking,
  ascent: size * 0.8,
  descent: size * 0.2,
  left: -2,
});
const runs = {
  version: 1 as const,
  splitAt: 4,
  primary: { fontSize: 32, tracking: 1 },
  secondary: { fontSize: 16, tracking: 2 },
  gap: 8,
};

describe("closed bilingual title contracts", () => {
  it("keeps a canonical string and resolves each run independently", () => {
    expect(core.resolveTitleRuns).toBeTypeOf("function");
    const resolved = core.resolveTitleRuns(text, runs, style, frame);
    expect(
      resolved.map(({ id, text, style }) => [
        id,
        text,
        style.fontSize,
        style.tracking,
      ]),
    ).toEqual([
      ["primary", "繁體標題", 32, 1],
      ["secondary", "Our story", 16, 2],
    ]);
    expect(core.validateTitleTextRuns(runs, text)).toEqual(runs);
  });
  it.each([
    { version: 2, splitAt: 4 },
    { version: 1, splitAt: 4, html: "<b>" },
    { version: 1, splitAt: 3 },
    { version: 1, splitAt: 4.5 },
    { version: 1, splitAt: 4, gap: 128.01 },
    { version: 1, splitAt: 4, secondary: { fontSize: 0 } },
    { version: 1, splitAt: 4, secondary: { tracking: 101 } },
    { version: 1, splitAt: 4, primary: { fontWeight: 450.5 } },
    { version: 1, splitAt: 4, secondary: { fontSize: 12, tracking: 13 } },
    { version: 1, splitAt: 4, secondary: { url: "https://font.invalid" } },
    { version: 1, splitAt: 4, primary: { fontFamily: "bad\u0000font" } },
    { version: 1, splitAt: 4, gap: NaN },
    { version: 1, splitAt: 4, gap: Infinity },
  ])("rejects unsupported or unbounded metadata %j", (value) => {
    expect(core.validateTitleTextRuns).toBeTypeOf("function");
    expect(() => core.validateTitleTextRuns(value, text)).toThrow();
  });
  it("rejects CRLF boundaries, empty runs, invalid Unicode and oversized text", () => {
    expect(core.validateTitleTextRuns).toBeTypeOf("function");
    for (const [value, offset] of [
      ["A\r\nB", 2],
      [" \nB", 1],
      ["A\n ", 1],
      ["A\n\ud800", 1],
      ["A\n" + "B".repeat(7999), 1],
    ] as const)
      expect(() =>
        core.validateTitleTextRuns({ version: 1, splitAt: offset }, value),
      ).toThrow();
    expect(() =>
      core.validateTitleTextRuns(
        Object.assign(Object.create({ x: 1 }), runs),
        text,
      ),
    ).toThrow();
    expect(() =>
      core.validateTitleTextRuns({ ...runs, [Symbol("x")]: 1 }, text),
    ).toThrow();
  });
  it("validates inherited effective tracking and rejects font path-like controls", () => {
    expect(core.resolveTitleRuns).toBeTypeOf("function");
    expect(() =>
      core.resolveTitleRuns(
        text,
        { version: 1, splitAt: 4, secondary: { tracking: 50 } },
        style,
        frame,
      ),
    ).toThrow(/tracking/iu);
    expect(() =>
      core.resolveTitleRuns(
        text,
        { ...runs, version: 2 } as never,
        style,
        frame,
      ),
    ).toThrow();
  });
});

describe("bounded finishing and complete measured safety", () => {
  const finishing = {
    version: 1 as const,
    shadow: {
      color: "#112233",
      opacity: 0.5,
      offsetX: -10,
      offsetY: 5,
      blur: 4,
    },
    stroke: { color: "#000000", width: 4 },
    pill: {
      color: "#123abc",
      opacity: 0.8,
      paddingX: 8,
      paddingY: 5,
      radius: 12,
    },
  };
  it.each([
    { version: 2 },
    { version: 1, svg: "<svg>" },
    { ...finishing, shadow: { ...finishing.shadow, blur: 16.01 } },
    { ...finishing, shadow: { ...finishing.shadow, offsetX: -64.01 } },
    { ...finishing, stroke: { color: "url(x)", width: 2 } },
    { ...finishing, stroke: { color: "#000000", width: 16.01 } },
    { ...finishing, pill: { ...finishing.pill, paddingX: 65 } },
    { ...finishing, pill: { ...finishing.pill, opacity: "1" } },
    { ...finishing, pill: { ...finishing.pill, radius: Infinity } },
  ])("rejects invalid finishing %j", (value) => {
    expect(() =>
      core.validateTitleStyle({ ...style, finishing: value }),
    ).toThrow();
  });
  it("stacks independently measured blocks once inside complete paint bounds", () => {
    expect(core.layoutTitleRuns).toBeTypeOf("function");
    const layout = core.layoutTitleRuns(
      text,
      runs,
      { ...style, finishing },
      frame,
      measure,
    );
    expect(layout.runLayouts?.runs.map((run) => run.style.fontSize)).toEqual([
      32, 16,
    ]);
    expect(layout.lines.map((line) => line.text)).toEqual([
      "繁體標題",
      "Our story",
    ]);
    // Primary descent 6.4 + authored gap 8 + secondary ascent 12.8.
    expect(layout.lines[1]!.baseline - layout.lines[0]!.baseline).toBeCloseTo(
      27.2,
    );
    expect(layout.bounds.x).toBeGreaterThanOrEqual(51.2 - 1e-6);
    expect(layout.bounds.y).toBeGreaterThanOrEqual(28.8 - 1e-6);
    expect(layout.bounds.x + layout.bounds.width).toBeLessThanOrEqual(
      588.8 + 1e-6,
    );
    expect(layout.bounds.y + layout.bounds.height).toBeCloseTo(331.2);
    expect(layout.runLayouts?.runs[0]!.lines[0]!.originX).toBeGreaterThan(
      layout.lines[0]!.x,
    );
  });
  it("retains exact legacy layout when new metadata is absent or finishing empty", () => {
    expect(core.layoutTitleRuns).toBeTypeOf("function");
    const legacy = core.layoutTitleText(
      text,
      style,
      frame,
      (value, size, tracking) => measure("primary", value, size, tracking),
    );
    expect(
      core.layoutTitleRuns(text, undefined, style, frame, measure),
    ).toEqual(legacy);
    expect(
      core.layoutTitleRuns(
        text,
        undefined,
        { ...style, finishing: { version: 1 } },
        frame,
        measure,
      ),
    ).toEqual(legacy);
  });
  it("rejects combined overflow instead of clipping either language", () => {
    expect(core.layoutTitleRuns).toBeTypeOf("function");
    expect(() =>
      core.layoutTitleRuns(
        text,
        { ...runs, primary: { fontSize: 250 }, secondary: { fontSize: 150 } },
        style,
        frame,
        measure,
      ),
    ).toThrow(/fit|overflow/iu);
    expect(() =>
      core.layoutTitleRuns(
        "A\n" + "B\n".repeat(32),
        { version: 1, splitAt: 1 },
        style,
        frame,
        measure,
      ),
    ).toThrow(/overflow/iu);
  });
});
