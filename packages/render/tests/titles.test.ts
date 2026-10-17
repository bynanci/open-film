import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  createTitleOverlay,
  titleOverlayCacheKey,
  resolveTitleFont,
} from "../src/titles.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("local CJK title raster", () => {
  it("renders a measured Traditional Chinese title as a reusable transparent PNG", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-title-"));
    directories.push(directory);
    const result = await createTitleOverlay(
      "我們一起走過，那些平凡又重要的日子。 Our story",
      { version: 1, role: "scene-statement", maxWidth: 400, fontSize: 28 },
      { width: 640, height: 360 },
      join(directory, "title.png"),
    );
    expect(result.layout.lines.length).toBeGreaterThan(1);
    expect(result.font.postscriptName).not.toBe("");
    expect(result.font.sha256).toMatch(/^[a-f\d]{64}$/u);
    const png = await readFile(result.path);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(640);
    expect(png.readUInt32BE(20)).toBe(360);
    for (const line of result.layout.lines) {
      expect(line.x).toBeGreaterThanOrEqual(0);
      expect(line.x + line.width).toBeLessThanOrEqual(640);
    }
    // Decode the real raster through FFmpeg and verify the complete visible
    // graphic is inside its measured bounds. Uncovered pixels stay transparent.
    const pixels = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        result.path,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "pipe:1",
      ],
      { maxBuffer: 2_000_000 },
    );
    let visible = 0;
    let white = 0;
    for (let pixel = 0; pixel < pixels.length / 4; pixel++) {
      if (!pixels[pixel * 4 + 3]) continue;
      visible++;
      if (pixels[pixel * 4]! > 200) white++;
      const x = pixel % 640;
      const y = Math.floor(pixel / 640);
      expect(x).toBeGreaterThanOrEqual(Math.floor(result.layout.bounds.x));
      expect(x).toBeLessThanOrEqual(
        Math.ceil(result.layout.bounds.x + result.layout.bounds.width),
      );
      expect(y).toBeGreaterThanOrEqual(Math.floor(result.layout.bounds.y));
      expect(y).toBeLessThanOrEqual(
        Math.ceil(result.layout.bounds.y + result.layout.bounds.height),
      );
    }
    expect(visible).toBeGreaterThan(1_000);
    expect(white).toBeGreaterThan(500);
    expect(pixels[3]).toBe(0);
  });

  it("chooses the Traditional Chinese face explicitly inside the local collection", async () => {
    const result = await resolveTitleFont({
      fontFamily: "Noto Sans CJK TC",
      fontWeight: 400,
    });
    // The default CI/runtime prerequisite installs this family. An explicit
    // override may use another face, but must report that fallback to the user.
    if (
      !process.env.OPENFILM_TITLE_FONT &&
      result.font.family.includes("Noto")
    ) {
      expect(result.font.postscriptName).toContain("CJKtc");
      expect(result.warnings).toEqual([]);
    }
    const fallback = await resolveTitleFont({
      fontFamily: "A font that is not installed",
    });
    expect(fallback.warnings.join(" ")).toMatch(/unavailable.*using local/iu);
  });

  it("fails explicitly for an unavailable font or missing glyph", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-title-"));
    directories.push(directory);
    const output = join(directory, "missing.png");
    await expect(
      createTitleOverlay(
        "title",
        undefined,
        { width: 640, height: 360 },
        output,
        {
          fontPath: join(directory, "not-installed.otf"),
        },
      ),
    ).rejects.toThrow(/font.*unavailable|font.*not found/iu);
    await expect(
      createTitleOverlay(
        "\u{10ffff}",
        undefined,
        { width: 640, height: 360 },
        output,
      ),
    ).rejects.toThrow(/glyph/iu);
  });

  it("keys the exact font, typography, source text and output dimensions", () => {
    const input = {
      text: "我們的故事",
      style: { version: 1 as const, role: "film-title" as const },
      frame: { width: 640, height: 360 },
      fontSha256: "a".repeat(64),
      postscriptName: "NotoSansCJKtc-Regular",
    };
    const key = titleOverlayCacheKey(input);
    expect(titleOverlayCacheKey({ ...input })).toBe(key);
    expect(
      titleOverlayCacheKey({ ...input, fontSha256: "b".repeat(64) }),
    ).not.toBe(key);
    expect(titleOverlayCacheKey({ ...input, text: "Different" })).not.toBe(key);
    expect(
      titleOverlayCacheKey({
        ...input,
        style: { ...input.style, tracking: 2 },
      }),
    ).not.toBe(key);
    expect(
      titleOverlayCacheKey({ ...input, frame: { width: 1920, height: 1080 } }),
    ).not.toBe(key);
  });
});
