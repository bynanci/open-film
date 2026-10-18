// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateTitleOpacity,
  type Composition,
  type TitleStyle,
} from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { FFmpegRenderer, createTitleOverlay } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const width = 320;
const height = 180;
const luminance = (pixels: Buffer, offset: number) =>
  (pixels[offset]! + pixels[offset + 1]! + pixels[offset + 2]!) / 3;

function sampleRaster(
  pixels: Buffer,
  predicate: (offset: number) => boolean,
): { x: number; y: number } {
  // Select a flat two-by-two interior at even coordinates, avoiding encoded
  // chroma edges and antialiasing when comparing the decoded output pixels.
  for (let y = 2; y < height - 2; y += 2)
    for (let x = 2; x < width - 2; x += 2)
      if (
        [0, 1].every((dy) =>
          [0, 1].every((dx) => predicate(((y + dy) * width + x + dx) * 4)),
        )
      )
        return { x, y };
  throw new Error("The real title raster has no flat sample of this kind.");
}

describe("native subtitle controls in real FFmpeg output", () => {
  it.each([
    { fadeOut: 1, frameRate: 30, attached: true, bottomSafeMargin: 0.2 },
    {
      fadeOut: 1,
      frameRate: 30000 / 1001,
      attached: false,
      bottomSafeMargin: 0.08,
    },
    { fadeOut: 0, frameRate: 30, attached: false, bottomSafeMargin: 0 },
    {
      fadeOut: 10,
      frameRate: 30000 / 1001,
      attached: true,
      bottomSafeMargin: 0.3,
    },
  ])(
    "fades only text and scrim with fade=$fadeOut, fps=$frameRate, attached=$attached",
    async ({ fadeOut, frameRate, attached, bottomSafeMargin }) => {
      const directory = await mkdtemp(join(tmpdir(), "openfilm-native-title-"));
      directories.push(directory);
      const source = join(directory, "source.mp4");
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=0x7090b0:s=160x90:r=30",
        "-t",
        "5",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-y",
        source,
      ]);
      const sourceHash = await hashFile(source);
      const asset = await inspectMedia({
        path: source,
        uri: pathToFileURL(source).href,
        name: "source.mp4",
      });
      const style: TitleStyle = {
        version: 1,
        role: "subtitle",
        fontFamily: "Noto Sans CJK TC",
        fontWeight: attached ? 700 : 400,
        fontSize: 26,
        fadeOut,
        bottomSafeMargin,
      };
      const overlay = await createTitleOverlay(
        "MMMM",
        style,
        { width, height },
        join(directory, "title.png"),
      );
      const rgba = (
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
      const text = sampleRaster(
        rgba,
        (offset) => rgba[offset]! >= 250 && rgba[offset + 3]! >= 250,
      );
      const scrim = sampleRaster(
        rgba,
        (offset) =>
          rgba[offset]! < 5 &&
          rgba[offset + 3]! >= 160 &&
          rgba[offset + 3]! <= 170,
      );
      for (let offset = 3; offset < rgba.length; offset += 4) {
        if (!rgba[offset]) continue;
        const y = Math.floor((offset - 3) / 4 / width);
        expect(y).toBeLessThan(Math.ceil(height * (1 - bottomSafeMargin)));
      }
      const title = { title: "MMMM", titleStyle: style };
      const start = 0.51;
      const duration = 2;
      const clip = {
        id: "video",
        assetId: asset.id,
        timelineStart: start,
        timelineDuration: duration,
        sourceIn: 0.5,
        sourceOut: 4.5,
        transform: { speed: 2 },
        ...(attached ? title : {}),
      };
      const composition: Composition = {
        id: "native-title",
        storyId: "story",
        duration: 3.2,
        tracks: [
          { id: "video", type: "video", clips: [clip] },
          ...(!attached
            ? [
                {
                  id: "titles",
                  type: "titles" as const,
                  clips: [
                    {
                      id: "title",
                      assetId: "",
                      timelineStart: start,
                      timelineDuration: duration,
                      ...title,
                    },
                  ],
                },
              ]
            : []),
        ],
      };
      const before = structuredClone(composition);
      const output = join(directory, "output.mp4");
      await new FFmpegRenderer().render(composition, [asset], output, {
        width,
        height,
        frameRate,
      });
      const pixels = (
        await runProcess(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            output,
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
          ],
          { maxOutputBytes: 32 * 1024 * 1024 },
        )
      ).stdout;
      const bytesPerFrame = width * height * 3;
      const startFrame = Math.round(start * frameRate);
      const colorAt = (frame: number, point: { x: number; y: number }) =>
        luminance(
          pixels,
          frame * bytesPerFrame + (point.y * width + point.x) * 3,
        );
      const sourceAt = (frame: number) => colorAt(frame, { x: 10, y: 10 });
      const firstTextDelta = colorAt(startFrame, text) - sourceAt(startFrame);
      const firstScrimDelta = colorAt(startFrame, scrim) - sourceAt(startFrame);
      expect(firstTextDelta).toBeGreaterThan(60);
      expect(firstScrimDelta).toBeLessThan(-60);
      for (const localTime of [0.5, 1.5, 1.9]) {
        const localFrame = Math.round(localTime * frameRate);
        const frame = startFrame + localFrame;
        const expected = evaluateTitleOpacity(
          style,
          localFrame / frameRate,
          duration,
        );
        expect(
          (colorAt(frame, text) - sourceAt(frame)) / firstTextDelta,
        ).toBeCloseTo(expected, 1);
        expect(
          (colorAt(frame, scrim) - sourceAt(frame)) / firstScrimDelta,
        ).toBeCloseTo(expected, 1);
        expect(sourceAt(frame)).toBeCloseTo(sourceAt(startFrame), 0);
      }
      // Gating retains the existing rounded output-frame start and exclusive end.
      expect(colorAt(startFrame - 1, text)).toBeLessThan(5);
      expect(
        colorAt(startFrame + Math.ceil((duration - 1e-9) * frameRate), text),
      ).toBeLessThan(5);
      expect(await hashFile(source)).toBe(sourceHash);
      expect(composition).toEqual(before);
    },
    60000,
  );
});
