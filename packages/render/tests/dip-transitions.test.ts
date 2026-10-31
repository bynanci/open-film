// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Composition } from "@openfilm/core";
import { inspectMedia } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index.js";
import { runProcess } from "@openfilm/media";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

async function extractPixel(
  videoPath: string,
  timestampSeconds: number,
): Promise<{ r: number; g: number; b: number }> {
  const result = await runProcess("ffmpeg", [
    "-v",
    "error",
    "-ss",
    timestampSeconds.toFixed(3),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=1:1,format=rgb24",
    "-f",
    "rawvideo",
    "-",
  ]);
  return {
    r: result.stdout[0] ?? 0,
    g: result.stdout[1] ?? 0,
    b: result.stdout[2] ?? 0,
  };
}

describe("Dip Transitions Rendering (D2B)", () => {
  it("renders dip-to-black with black midpoint and seamless boundaries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openfilm-dip-black-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    const assets = [];
    for (const color of ["red", "blue"]) {
      const imgPath = join(dir, `${color}.png`);
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=${color}:s=160x90`,
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-update",
        "1",
        "-y",
        imgPath,
      ]);
      assets.push(
        await inspectMedia({
          path: imgPath,
          uri: pathToFileURL(imgPath).href,
          name: `${color}.png`,
        }),
      );
    }

    const composition: Composition = {
      id: "dip-black-comp",
      storyId: "story-1",
      duration: 3.0,
      tracks: [
        {
          id: "video-track",
          type: "video",
          clips: [
            {
              id: "clip-red",
              assetId: assets[0]!.id,
              timelineStart: 0,
              timelineDuration: 1.5,
            },
            {
              id: "clip-blue",
              assetId: assets[1]!.id,
              timelineStart: 1.5,
              timelineDuration: 1.5,
              transition: { type: "dip-to-black", duration: 0.6 },
            },
          ],
        },
      ],
    };

    const output = join(dir, "dip-black.mp4");
    await new FFmpegRenderer().render(composition, assets, output, {
      width: 160,
      height: 90,
      frameRate: 25,
    });

    // 1. Before transition (t = 0.8s): Red dominant
    const prePixel = await extractPixel(output, 0.8);
    expect(prePixel.r).toBeGreaterThan(150);
    expect(prePixel.b).toBeLessThan(50);

    // 2. Midpoint of transition (T = 1.5s, D = 0.6s -> midpoint = 1.8s): Black (all channels low)
    const midPixel = await extractPixel(output, 1.8);
    expect(midPixel.r).toBeLessThan(35);
    expect(midPixel.g).toBeLessThan(35);
    expect(midPixel.b).toBeLessThan(35);

    // 3. After transition (t = 2.5s): Blue dominant
    const postPixel = await extractPixel(output, 2.5);
    expect(postPixel.b).toBeGreaterThan(150);
    expect(postPixel.r).toBeLessThan(50);
  });

  it("renders dip-to-white with white midpoint and seamless boundaries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openfilm-dip-white-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    const assets = [];
    for (const color of ["red", "blue"]) {
      const imgPath = join(dir, `${color}.png`);
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=${color}:s=160x90`,
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-update",
        "1",
        "-y",
        imgPath,
      ]);
      assets.push(
        await inspectMedia({
          path: imgPath,
          uri: pathToFileURL(imgPath).href,
          name: `${color}.png`,
        }),
      );
    }

    const composition: Composition = {
      id: "dip-white-comp",
      storyId: "story-1",
      duration: 3.0,
      tracks: [
        {
          id: "video-track",
          type: "video",
          clips: [
            {
              id: "clip-red",
              assetId: assets[0]!.id,
              timelineStart: 0,
              timelineDuration: 1.5,
            },
            {
              id: "clip-blue",
              assetId: assets[1]!.id,
              timelineStart: 1.5,
              timelineDuration: 1.5,
              transition: { type: "dip-to-white", duration: 0.6 },
            },
          ],
        },
      ],
    };

    const output = join(dir, "dip-white.mp4");
    await new FFmpegRenderer().render(composition, assets, output, {
      width: 160,
      height: 90,
      frameRate: 25,
    });

    // 1. Before transition (t = 0.8s): Red dominant
    const prePixel = await extractPixel(output, 0.8);
    expect(prePixel.r).toBeGreaterThan(150);
    expect(prePixel.b).toBeLessThan(50);

    // 2. Midpoint of transition (T = 1.5s, D = 0.6s -> midpoint = 1.8s): White (all channels high)
    const midPixel = await extractPixel(output, 1.8);
    expect(midPixel.r).toBeGreaterThan(200);
    expect(midPixel.g).toBeGreaterThan(200);
    expect(midPixel.b).toBeGreaterThan(200);

    // 3. After transition (t = 2.5s): Blue dominant
    const postPixel = await extractPixel(output, 2.5);
    expect(postPixel.b).toBeGreaterThan(150);
    expect(postPixel.r).toBeLessThan(50);
  });
});
