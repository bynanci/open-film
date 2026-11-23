// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { inspectMedia, runProcess } from "@openfilm/media";
import type { Composition } from "@openfilm/core";
import { FFmpegRenderer } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("native SDR output range", () => {
  it.each(["tv", "pc"])(
    "converts %s source values to limited-range output instead of only retagging",
    async (range) => {
      const directory = await mkdtemp(join(tmpdir(), "openfilm-output-range-"));
      directories.push(directory);
      const source = join(directory, `source-${range}.mp4`);
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=gray:s=160x90:r=30:d=0.5",
        "-vf",
        `drawbox=x=0:y=0:w=40:h=ih:color=black:t=fill,drawbox=x=120:y=0:w=40:h=ih:color=white:t=fill,scale=in_range=tv:out_range=${range},format=yuv420p`,
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-crf",
        "0",
        "-color_range",
        range,
        "-y",
        source,
      ]);
      const asset = await inspectMedia({
        path: source,
        uri: pathToFileURL(source).href,
        name: basename(source),
      });
      const composition: Composition = {
        id: `range-${range}`,
        storyId: "synthetic",
        duration: 0.5,
        tracks: [
          {
            id: "main",
            type: "video",
            clips: [
              {
                id: "gray",
                assetId: asset.id,
                sourceIn: 0,
                sourceOut: 0.5,
                timelineStart: 0,
                timelineDuration: 0.5,
                transform: { volume: 0 },
              },
            ],
          },
        ],
      };
      const output = join(directory, "render.mp4");
      await new FFmpegRenderer().render(
        composition,
        [asset],
        output,
        { width: 160, height: 90, frameRate: 30 },
        { videoOnly: true, quality: "high-detail" },
      );
      const probe = JSON.parse(
        (
          await runProcess("ffprobe", [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=pix_fmt,color_range",
            "-of",
            "json",
            output,
          ])
        ).stdout.toString("utf8"),
      );
      // Decode without requesting another color conversion: changing only the H.264
      // full-range flag would leave values 0/255 and must fail these assertions.
      const pixels = (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-ss",
          "0.2",
          "-i",
          output,
          "-frames:v",
          "1",
          "-c:v",
          "rawvideo",
          "-threads",
          "1",
          "-f",
          "rawvideo",
          "-",
        ])
      ).stdout;
      expect(pixels.length).toBe((160 * 90 * 3) / 2);
      expect(pixels[20 * 160 + 20]).toBeGreaterThanOrEqual(14);
      expect(pixels[20 * 160 + 20]).toBeLessThanOrEqual(18);
      expect(pixels[20 * 160 + 140]).toBeGreaterThanOrEqual(232);
      expect(pixels[20 * 160 + 140]).toBeLessThanOrEqual(238);
      expect(probe.streams[0].pix_fmt).toBe("yuv420p");
      expect(probe.streams[0].color_range).toBe("tv");
    },
  );
});
