import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Composition } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function frame(path: string, time: number): Promise<number> {
  const result = await runProcess("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(time),
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    "scale=1:1,format=rgb24",
    "-f",
    "rawvideo",
    "-",
  ]);
  return result.stdout[0]!;
}

describe("real FFmpeg preview renderer", () => {
  it("honors trim, speed, audio volume, title and crossfade while preserving source bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-render-"));
    directories.push(directory);
    const source = join(directory, "source.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=160x90:r=20,drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='gte(t,1.5)'",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-pix_fmt",
      "yuv420p",
      "-y",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "source.mp4",
    });
    const originalHash = await hashFile(source);
    const composition: Composition = {
      id: "timeline",
      storyId: "story",
      duration: 1,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "trimmed",
              assetId: asset.id,
              sourceIn: 1,
              sourceOut: 3,
              timelineStart: 0,
              timelineDuration: 1,
              transform: {
                speed: 2,
                volume: 0.3,
                scale: 1,
                rotation: 0,
                x: 0,
                y: 0,
              },
              transition: { type: "crossfade", duration: 0.05 },
            },
          ],
        },
        {
          id: "titles",
          type: "titles",
          clips: [
            {
              id: "title",
              assetId: "",
              title: "A title: 100% 'safe'",
              timelineStart: 0.65,
              timelineDuration: 0.3,
            },
          ],
        },
      ],
    };
    const before = structuredClone(composition);
    const output = join(directory, "preview.mp4");
    await new FFmpegRenderer().render(composition, [asset], output, {
      width: 160,
      height: 90,
      frameRate: 20,
    });
    expect(await frame(output, 0.15)).toBeGreaterThan(170);
    expect(await frame(output, 0.4)).toBeLessThan(20);
    const probe = await runProcess("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      output,
    ]);
    const metadata = JSON.parse(probe.stdout.toString()) as {
      format: { duration: string };
      streams: { codec_type: string }[];
    };
    expect(Number(metadata.format.duration)).toBeCloseTo(1, 1);
    expect(metadata.streams.map((stream) => stream.codec_type)).toEqual([
      "video",
      "audio",
    ]);
    expect(await hashFile(source)).toBe(originalHash);
    expect(composition).toEqual(before);
    expect(
      (await readdir(directory)).some((name) => name.startsWith(".render-")),
    ).toBe(false);
    await expect(
      new FFmpegRenderer().render(composition, [asset], source),
    ).rejects.toThrow("overwrite");
  }, 30000);

  it("blends overlapping crossfades and keeps encoded duration within a fractional limit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-crossfade-"));
    directories.push(directory);
    const assets = [];
    for (const color of ["red", "blue"]) {
      const path = join(directory, `${color}.png`);
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
        path,
      ]);
      assets.push(
        await inspectMedia({
          path,
          uri: pathToFileURL(path).href,
          name: `${color}.png`,
        }),
      );
    }
    const composition: Composition = {
      id: "crossfade",
      storyId: "story",
      duration: 2.03,
      tracks: [
        {
          id: "visual",
          type: "video",
          clips: [
            {
              id: "red",
              assetId: assets[0]!.id,
              timelineStart: 0,
              timelineDuration: 1,
            },
            {
              id: "blue",
              assetId: assets[1]!.id,
              timelineStart: 1,
              timelineDuration: 1.03,
              transition: { type: "crossfade", duration: 0.3 },
            },
          ],
        },
      ],
    };
    const output = join(directory, "preview.mp4");
    await new FFmpegRenderer().render(composition, assets, output, {
      width: 160,
      height: 90,
      frameRate: 20,
    });
    const blended = await runProcess("ffmpeg", [
      "-v",
      "error",
      "-ss",
      "1.15",
      "-i",
      output,
      "-frames:v",
      "1",
      "-vf",
      "scale=1:1,format=rgb24",
      "-f",
      "rawvideo",
      "-",
    ]);
    expect(blended.stdout[0]).toBeGreaterThan(60);
    expect(blended.stdout[2]).toBeGreaterThan(60);
    expect(await frame(output, 1.6)).toBeLessThan(20);
    const probe = await runProcess("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      output,
    ]);
    expect(
      Number(
        (
          JSON.parse(probe.stdout.toString()) as {
            format: { duration: string };
          }
        ).format.duration,
      ),
    ).toBeLessThanOrEqual(2.03);
  });

  it("renders literal title text under apostrophe, punctuation and backslash project paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-title-path-"));
    directories.push(directory);
    const composition: Composition = {
      id: "titles",
      storyId: "story",
      duration: 0.3,
      tracks: [
        {
          id: "text",
          type: "titles",
          clips: [
            {
              id: "literal",
              assetId: "",
              title: "Literal: 100% 'quoted' [title]",
              timelineStart: 0,
              timelineDuration: 0.3,
            },
          ],
        },
      ],
    };
    const output = join(directory, "Jo's:film\\[cut].openfilm", "preview.mp4");
    await expect(
      new FFmpegRenderer().render(composition, [], output, {
        width: 160,
        height: 90,
        frameRate: 20,
      }),
    ).resolves.toBe(output);
    const probe = await runProcess("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      output,
    ]);
    expect(
      Number(
        (
          JSON.parse(probe.stdout.toString()) as {
            format: { duration: string };
          }
        ).format.duration,
      ),
    ).toBeCloseTo(0.3, 2);
  });

  it("applies contain-fit geometry before scale, rotation and frame-pixel translation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-geometry-"));
    directories.push(directory);
    const source = join(directory, "geometry.png");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=80x40",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-y",
      source,
    ]);
    const asset = {
      id: "geometry",
      uri: pathToFileURL(source).href,
      mediaType: "image" as const,
      name: "geometry.png",
      tags: [],
      state: {},
      metadata: {},
      dimensions: { width: 80, height: 40 },
    };
    const composition: Composition = {
      id: "geometry-cut",
      storyId: "story",
      duration: 1,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "geometry-clip",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 1,
              transform: { scale: 0.5, rotation: 0, x: 20, y: 0 },
            },
          ],
        },
      ],
    };
    const output = join(directory, "geometry-preview.mp4");
    await new FFmpegRenderer().render(composition, [asset], output, {
      width: 160,
      height: 90,
      frameRate: 10,
    });
    const sample = async (x: number, y: number) =>
      (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-ss",
          "0.2",
          "-i",
          output,
          "-vf",
          `crop=1:1:${x}:${y},format=rgb24`,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-",
        ])
      ).stdout;
    // Contain-fit is 160x80; scale .5 becomes 80x40 and +20 frame px moves
    // the red rectangle from x=40..119 to x=60..139.
    expect((await sample(50, 45))[0]).toBeLessThan(30);
    expect((await sample(70, 45))[0]).toBeGreaterThan(180);
    expect((await sample(130, 45))[0]).toBeGreaterThan(180);
    expect((await sample(145, 45))[0]).toBeLessThan(30);
  });

  it("keeps rotated bounds transparent so lower visual tracks remain visible", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-geometry-alpha-"));
    directories.push(directory);
    const paths = {
      background: join(directory, "background.png"),
      foreground: join(directory, "foreground.png"),
    };
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=blue:s=160x90",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-y",
      paths.background,
    ]);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=80x40",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-y",
      paths.foreground,
    ]);
    const assets = await Promise.all(
      Object.entries(paths).map(([name, path]) =>
        inspectMedia({
          path,
          uri: pathToFileURL(path).href,
          name: `${name}.png`,
        }),
      ),
    );
    const [background, foreground] = assets;
    const composition: Composition = {
      id: "geometry-alpha",
      storyId: "story",
      duration: 1,
      tracks: [
        {
          id: "background",
          type: "video",
          clips: [
            {
              id: "background",
              assetId: background!.id,
              timelineStart: 0,
              timelineDuration: 1,
            },
          ],
        },
        {
          id: "foreground",
          type: "overlay",
          clips: [
            {
              id: "foreground",
              assetId: foreground!.id,
              timelineStart: 0,
              timelineDuration: 1,
              transform: { scale: 0.5, rotation: 45, x: 0, y: 0 },
            },
          ],
        },
      ],
    };
    const output = join(directory, "geometry-alpha-preview.mp4");
    await new FFmpegRenderer().render(composition, assets, output, {
      width: 160,
      height: 90,
      frameRate: 10,
    });
    const sample = async (x: number, y: number) =>
      (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-ss",
          "0.2",
          "-i",
          output,
          "-vf",
          `crop=1:1:${x}:${y},format=rgb24`,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-",
        ])
      ).stdout;
    const center = await sample(80, 45);
    expect(center[0]).toBeGreaterThan(170);
    expect(center[2]).toBeLessThan(80);
    const rotatedCorner = await sample(40, 5);
    expect(rotatedCorner[2]).toBeGreaterThan(120);
    expect(rotatedCorner[0]).toBeLessThan(100);
  });
  it("preserves display aspect when square-pixelizing anamorphic media", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-sar-"));
    directories.push(directory);
    const source = join(directory, "anamorphic.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=80x40:r=10,setsar=2",
      "-t",
      "0.4",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-y",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "anamorphic.mp4",
    });
    const hash = await hashFile(source);
    const composition: Composition = {
      id: "sar",
      storyId: "story",
      duration: 0.4,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 0.4,
            },
          ],
        },
      ],
    };
    const output = join(directory, "preview.mp4");
    await new FFmpegRenderer().render(composition, [asset], output, {
      width: 160,
      height: 90,
      frameRate: 10,
    });
    const decoded = await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-frames:v",
      "1",
      "-vf",
      "format=rgb24",
      "-f",
      "rawvideo",
      "-",
    ]);
    expect(decoded.stdout.length).toBe(160 * 90 * 3);
    // 80x40 coded pixels at SAR 2:1 display as 4:1: fit must be 160x40,
    // with black above y=25. Fitting coded pixels would incorrectly be 160x80.
    expect(decoded.stdout[(10 * 160 + 80) * 3]).toBeLessThan(25);
    expect(decoded.stdout[(45 * 160 + 80) * 3]).toBeGreaterThan(180);
    expect(await hashFile(source)).toBe(hash);
  });
});
