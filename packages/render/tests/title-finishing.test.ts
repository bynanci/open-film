// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runProcess } from "@openfilm/media";
import { titleTestFontOptions } from "../../../tests/helpers/title-test-fonts.js";
import {
  createTitleOverlay,
  inspectTitleOverlay,
  titleOverlayCacheKey,
} from "../src/titles.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const text = "繁體標題\nOur story";
const frame = { width: 640, height: 360 };
const style = {
  version: 1 as const,
  role: "subtitle" as const,
  fontSize: 28,
  background: "none" as const,
};
const textRuns = {
  version: 1 as const,
  splitAt: 4,
  primary: { fontWeight: 400, fontSize: 32, tracking: 1 },
  secondary: { fontWeight: 700, fontSize: 20, tracking: 2 },
  gap: 10,
};
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "openfilm-bilingual-raster-"));
  directories.push(path);
  return path;
}

it("measures and draws each run with the same actual local face and complete finishing bounds", async () => {
  const root = await directory();
  const fonts = await titleTestFontOptions();
  const overlay = await createTitleOverlay(
    text,
    {
      ...style,
      finishing: {
        version: 1,
        shadow: {
          color: "#113355",
          opacity: 0.7,
          offsetX: -7,
          offsetY: 5,
          blur: 2,
        },
        stroke: { color: "#224466", width: 4 },
        pill: {
          color: "#884422",
          opacity: 0.8,
          paddingX: 10,
          paddingY: 6,
          radius: 8,
        },
      },
    },
    frame,
    join(root, "both.png"),
    { ...fonts, textRuns },
  );
  expect(overlay.runFonts?.map((run) => [run.id, run.actualWeight])).toEqual([
    ["primary", 400],
    ["secondary", 700],
  ]);
  expect(
    new Set(overlay.runFonts?.map((run) => run.font.postscriptName)).size,
  ).toBe(2);
  expect(
    overlay.layout.runLayouts?.runs.map((run) => run.style.fontSize),
  ).toEqual([32, 20]);
  const pixels = (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      overlay.path,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "pipe:1",
    ])
  ).stdout;
  let outside = 0,
    inside = 0,
    colored = 0;
  const b = overlay.layout.bounds;
  for (let y = 0; y < 360; y++)
    for (let x = 0; x < 640; x++) {
      const index = (y * 640 + x) * 4;
      if (pixels[index + 3]! === 0) continue;
      inside++;
      if (pixels[index] !== pixels[index + 2]) colored++;
      if (
        x < Math.floor(b.x) - 1 ||
        x > Math.ceil(b.x + b.width) + 1 ||
        y < Math.floor(b.y) - 1 ||
        y > Math.ceil(b.y + b.height) + 1
      )
        outside++;
    }
  expect(inside).toBeGreaterThan(1000);
  expect(colored).toBeGreaterThan(500);
  expect(outside).toBe(0);
});

it("identifies secondary fallback and fails a missing secondary font or glyph before raster publication", async () => {
  const fonts = await titleTestFontOptions();
  const inspection = await inspectTitleOverlay(text, style, frame, {
    ...fonts,
    textRuns: {
      ...textRuns,
      secondary: { fontFamily: "Unavailable Local Family", fontSize: 20 },
    },
  });
  expect(inspection.status).toBe("measured");
  if (inspection.status !== "measured") throw new Error(inspection.message);
  expect(
    inspection.runFonts?.find((run) => run.id === "secondary")?.diagnostics,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "family-fallback",
        run: "secondary",
        requestedFamily: "Unavailable Local Family",
      }),
    ]),
  );
  const root = await directory();
  const missing = await inspectTitleOverlay(text, style, frame, {
    textRuns,
    fontPathForStyle: (s) =>
      s?.fontWeight === 700
        ? join(root, "missing.otf")
        : fonts.fontPathForStyle(s),
  });
  expect(missing).toMatchObject({
    status: "failed",
    kind: "font.load-failed",
    detail: "unavailable",
    run: "secondary",
  });
  const glyph = await inspectTitleOverlay(
    "繁體標題\n\u{10ffff}",
    style,
    frame,
    { ...fonts, textRuns },
  );
  expect(glyph).toMatchObject({
    status: "failed",
    kind: "font.load-failed",
    detail: "missing-glyph",
    run: "secondary",
  });
});

it("requires both run font cache identities and invalidates only-changing secondary font bytes", () => {
  const input = {
    text,
    style,
    frame,
    fontSha256: "a".repeat(64),
    postscriptName: "primary",
  };
  expect(() => titleOverlayCacheKey({ ...input, textRuns })).toThrow(/font/iu);
  const runFonts = [
    {
      id: "primary" as const,
      fontSha256: "a".repeat(64),
      postscriptName: "primary",
    },
    {
      id: "secondary" as const,
      fontSha256: "b".repeat(64),
      postscriptName: "secondary",
    },
  ];
  const original = titleOverlayCacheKey({ ...input, textRuns, runFonts });
  expect(
    titleOverlayCacheKey({
      ...input,
      textRuns,
      runFonts: [runFonts[0]!, { ...runFonts[1]!, fontSha256: "c".repeat(64) }],
    }),
  ).not.toBe(original);
  expect(
    titleOverlayCacheKey({
      ...input,
      textRuns: {
        ...textRuns,
        secondary: { ...textRuns.secondary, tracking: 3 },
      },
      runFonts,
    }),
  ).not.toBe(original);
});

it("preserves legacy pixels for absent or empty finishing and treats markup as literal glyphs", async () => {
  const root = await directory();
  const first = await createTitleOverlay(
    "Our story",
    style,
    frame,
    join(root, "old.png"),
  );
  const empty = await createTitleOverlay(
    "Our story",
    { ...style, finishing: { version: 1 } },
    frame,
    join(root, "empty.png"),
  );
  expect(await readFile(empty.path)).toEqual(await readFile(first.path));
  const literal = await createTitleOverlay(
    "<svg>\n& hello",
    style,
    frame,
    join(root, "literal.png"),
    { textRuns: { version: 1, splitAt: 5 } },
  );
  expect(literal.layout.lines.map((line) => line.text)).toEqual([
    "<svg>",
    "& hello",
  ]);
});
