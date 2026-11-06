import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  clipAnimationFfmpegExpression,
  createExportProfile,
  resolvePreviewClipGeometry,
  resolveCompositionFrame,
  resolveClipFrameTime,
  resolveProjectTimebase,
  type Composition,
  type MediaAsset,
  type ProjectSettings,
} from "@openfilm/core";
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

async function decodedGrayFrames(path: string): Promise<Buffer> {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-map",
      "0:v:0",
      "-an",
      "-vf",
      "format=gray",
      "-f",
      "rawvideo",
      "-",
    ])
  ).stdout;
}

function grayBounds(
  pixels: Buffer,
  width: number,
  height: number,
  threshold = 170,
) {
  let left = width,
    right = -1,
    top = height,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (pixels[y * width + x]! >= threshold) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  return right < left
    ? { x: 0, y: 0, width: 0, height: 0 }
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

describe("real FFmpeg preview renderer", () => {
  it("renders deterministic clip keyframes for position, scale, rotation and opacity", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-render-clip-animation-"),
    );
    directories.push(directory);
    const source = join(directory, "synthetic-animation.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x36:r=10:d=2",
      "-vf",
      "drawbox=x=20:y=14:w=24:h=8:color=white:t=fill",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "synthetic-animation.mp4",
    });
    const sourceHash = await hashFile(source);
    const animation: Composition = {
      id: "animation",
      storyId: "story",
      duration: 2,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "move-and-fade",
              assetId: asset.id,
              sourceIn: 0,
              sourceOut: 1,
              timelineStart: 0,
              timelineDuration: 1,
              animation: {
                version: 1,
                visualTracks: [
                  {
                    property: "x",
                    keys: [
                      { frame: 0, value: -16 },
                      { frame: 9, value: 16 },
                    ],
                  },
                  {
                    property: "opacity",
                    keys: [
                      { frame: 0, value: 1 },
                      { frame: 9, value: 0.5 },
                    ],
                  },
                ],
              },
            },
            {
              id: "scale-and-turn",
              assetId: asset.id,
              sourceIn: 1,
              sourceOut: 2,
              timelineStart: 1,
              timelineDuration: 1,
              animation: {
                version: 1,
                visualTracks: [
                  {
                    property: "scale",
                    keys: [
                      {
                        frame: 0,
                        value: 1,
                        interpolation: {
                          kind: "cubic-bezier",
                          x1: 0.42,
                          y1: 0,
                          x2: 0.58,
                          y2: 1,
                        },
                      },
                      { frame: 9, value: 1.5 },
                    ],
                  },
                  {
                    property: "rotation",
                    keys: [
                      { frame: 0, value: 0 },
                      { frame: 9, value: 90 },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const settings: ProjectSettings = {
      width: 64,
      height: 36,
      frameRate: 10,
      timebase: {
        version: 1,
        rateNumerator: 10,
        rateDenominator: 1,
        dropFrame: false,
      },
    };
    const resolved = [19, 0, 9, 10, 4].map((frameNumber) =>
      resolveCompositionFrame(
        animation,
        [asset],
        frameNumber,
        resolveProjectTimebase(settings),
      ),
    );
    expect(resolved[0]!.primary).toMatchObject({
      visualTransform: { scale: 1.5, rotation: 90 },
    });
    expect(resolved[1]!.primary).toMatchObject({
      visualTransform: { x: -16 },
      opacity: 1,
    });
    expect(resolved[2]!.primary).toMatchObject({
      visualTransform: { x: 16 },
      opacity: 0.5,
    });

    const output = join(directory, "animated.mp4");
    await new FFmpegRenderer().render(animation, [asset], output, settings);
    const decoded = await decodedGrayFrames(output);
    const frameSize = settings.width * settings.height;
    expect(decoded).toHaveLength(frameSize * 20);
    const pixel = (frameNumber: number, x: number, y: number) =>
      decoded[frameNumber * frameSize + y * settings.width + x]!;
    expect(pixel(0, 16, 18)).toBeGreaterThan(220);
    expect(pixel(9, 48, 18)).toBeGreaterThan(80);
    expect(pixel(9, 48, 18)).toBeLessThan(190);
    const beforeTurn = grayBounds(
      decoded.subarray(10 * frameSize, 11 * frameSize),
      64,
      36,
    );
    const afterTurn = grayBounds(
      decoded.subarray(19 * frameSize, 20 * frameSize),
      64,
      36,
    );
    expect(beforeTurn.width).toBeGreaterThan(afterTurn.width);
    expect(beforeTurn.height).toBeLessThan(afterTurn.height);
    expect(await hashFile(source)).toBe(sourceHash);
  });

  it("renders a multi-track cubic graph larger than Windows command-line limits", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-render-clip-animation-graph-size-"),
    );
    directories.push(directory);
    const source = join(directory, "synthetic-animation.png");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=64x36",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "synthetic-animation.png",
    });
    const sourceHash = await hashFile(source);
    const easing = {
      kind: "cubic-bezier" as const,
      x1: 0.42,
      y1: 0,
      x2: 0.58,
      y2: 1,
    };
    const keys = (value: (frame: number) => number) =>
      Array.from({ length: 8 }, (_, frame) => ({
        frame,
        value: value(frame),
        ...(frame < 7 ? { interpolation: easing } : {}),
      }));
    const largeAnimation: Composition["tracks"][number]["clips"][number]["animation"] =
      {
        version: 1,
        visualTracks: [
          { property: "x", keys: keys((frame) => frame * 2) },
          { property: "y", keys: keys((frame) => -frame) },
          { property: "scale", keys: keys((frame) => 1 + frame / 16) },
        ],
      };
    const commandLineFilterSize =
      clipAnimationFfmpegExpression(largeAnimation, "x", 0).length +
      clipAnimationFfmpegExpression(largeAnimation, "y", 0).length +
      2 * clipAnimationFfmpegExpression(largeAnimation, "scale", 1).length;
    expect(commandLineFilterSize).toBeGreaterThan(32767);
    const composition: Composition = {
      id: "large-animation-graph",
      storyId: "story",
      duration: 0.8,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "multi-track-animation",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 0.8,
              animation: largeAnimation,
            },
          ],
        },
      ],
    };
    const output = join(directory, "large-animation-graph.mp4");
    const settings: ProjectSettings = { width: 64, height: 36, frameRate: 10 };
    const rendered = await new FFmpegRenderer().render(
      composition,
      [asset],
      output,
      settings,
    );
    const decoded = await decodedGrayFrames(rendered);
    expect(decoded).toHaveLength(settings.width * settings.height * 8);
    expect(await hashFile(source)).toBe(sourceHash);
  }, 30000);

  it("seeks repeated video ranges while retaining frames and audible source audio", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-render-input-seek-"),
    );
    directories.push(directory);
    const source = join(directory, "source.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=12:duration=3",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=3",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-g",
      "24",
      "-keyint_min",
      "24",
      "-sc_threshold",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "synthetic split source",
    });
    const sourceHash = await hashFile(source);
    const single: Composition = {
      id: "single-range",
      storyId: "story",
      duration: 3,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "whole-source",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 3,
              sourceIn: 0,
              sourceOut: 3,
            },
          ],
        },
      ],
    };
    const split: Composition = {
      ...single,
      id: "split-ranges",
      tracks: [
        {
          id: "video",
          type: "video",
          clips: Array.from({ length: 3 }, (_, index) => ({
            id: `range-${index}`,
            assetId: asset.id,
            timelineStart: index,
            timelineDuration: 1,
            sourceIn: index,
            sourceOut: index + 1,
          })),
        },
      ],
    };
    const settings: ProjectSettings = {
      width: 160,
      height: 90,
      frameRate: 12,
    };
    const renderer = new FFmpegRenderer();
    const singleOutput = join(directory, "single.mp4");
    const splitOutput = join(directory, "split.mp4");
    await renderer.render(single, [asset], singleOutput, settings);
    await renderer.render(split, [asset], splitOutput, settings);
    const decodedFrames = async (path: string) =>
      (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-threads",
          "1",
          "-i",
          path,
          "-map",
          "0:v:0",
          "-an",
          "-f",
          "framemd5",
          "-hash",
          "md5",
          "-",
        ])
      ).stdout.toString("utf8");
    const decodedAudio = async (path: string) =>
      (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-threads",
          "1",
          "-i",
          path,
          "-map",
          "0:a:0",
          "-acodec",
          "pcm_s16le",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-f",
          "s16le",
          "-",
        ])
      ).stdout;
    expect(await decodedFrames(splitOutput)).toBe(
      await decodedFrames(singleOutput),
    );
    const pcm = await decodedAudio(splitOutput);
    expect(pcm.length).toBeGreaterThanOrEqual(3 * 48_000 * 4 - 4096);
    for (const startSeconds of [0.25, 0.9, 1.1, 1.9, 2.1, 2.5]) {
      const startFrame = Math.round(startSeconds * 48_000);
      let sumSquares = 0;
      const frameCount = 12_000;
      for (let frame = startFrame; frame < startFrame + frameCount; frame++) {
        const offset = frame * 4;
        const left = pcm.readInt16LE(offset);
        const right = pcm.readInt16LE(offset + 2);
        sumSquares += left * left + right * right;
      }
      const rms = Math.sqrt(sumSquares / (frameCount * 2));
      expect(
        rms,
        `source audio was lost near ${startSeconds}s`,
      ).toBeGreaterThan(500);
    }
    expect(await hashFile(source)).toBe(sourceHash);
  });

  it.each([
    { frameRate: 24, expectedRate: 24 },
    { frameRate: 25, expectedRate: 25 },
    { frameRate: 30, expectedRate: 30 },
    { frameRate: 29.97, expectedRate: 30000 / 1001 },
    { frameRate: 30000 / 1001, expectedRate: 30000 / 1001 },
  ])(
    "renders the canonical project rate for legacy $frameRate fps without mutating approved settings",
    async ({ frameRate, expectedRate }) => {
      const directory = await mkdtemp(
        join(tmpdir(), "openfilm-render-timebase-"),
      );
      directories.push(directory);
      const output = join(directory, "timebase.mp4");
      const settings: ProjectSettings = {
        width: 64,
        height: 36,
        frameRate,
      };
      const saved: Composition = {
        id: "timebase",
        storyId: "story",
        duration: 0.2,
        tracks: [],
      };
      const before = structuredClone(settings);
      const hash = (value: unknown) =>
        createHash("sha256").update(JSON.stringify(value)).digest("hex");
      await new FFmpegRenderer().render(saved, [], output, settings, {
        snapshot: {
          compositionSha256: hash(saved),
          settingsSha256: hash(settings),
          assetsSha256: hash([]),
          assertCurrent: () => {},
        },
      });
      const rendered = await inspectMedia({
        path: output,
        uri: pathToFileURL(output).href,
        name: "timebase.mp4",
      });
      expect(rendered.dimensions).toEqual({ width: 64, height: 36 });
      expect(rendered.frameRate).toBe(expectedRate);
      expect(settings).toEqual(before);
      expect(settings).not.toHaveProperty("timebase");
    },
  );

  it("accepts an exact project timebase while preserving an independent decimal export rate", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-render-profile-rate-"),
    );
    directories.push(directory);
    const output = join(directory, "profile.mp4");
    const settings: ProjectSettings = {
      width: 64,
      height: 64,
      frameRate: 30000 / 1001,
      timebase: {
        version: 1,
        rateNumerator: 30000,
        rateDenominator: 1001,
        dropFrame: true,
      },
    };
    await new FFmpegRenderer().render(
      { id: "profile", storyId: "story", duration: 0.2, tracks: [] },
      [],
      output,
      settings,
      {
        exportProfile: createExportProfile({
          ratio: "1:1",
          width: 64,
          height: 64,
          frameRate: 29.97,
        }),
      },
    );
    const rendered = await inspectMedia({
      path: output,
      uri: pathToFileURL(output).href,
      name: "profile.mp4",
    });
    expect(rendered.frameRate).toBe(29.97);
    expect(settings.frameRate).toBe(30000 / 1001);
    expect(settings.timebase?.dropFrame).toBe(true);
  });

  it("rejects mismatched project timebase metadata at admission", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-render-invalid-rate-"),
    );
    directories.push(directory);
    await expect(
      new FFmpegRenderer().render(
        { id: "invalid", storyId: "story", duration: 0.2, tracks: [] },
        [],
        join(directory, "invalid.mp4"),
        {
          width: 64,
          height: 36,
          frameRate: 29.97,
          timebase: {
            version: 1,
            rateNumerator: 30000,
            rateDenominator: 1001,
            dropFrame: false,
          },
        },
      ),
    ).rejects.toThrow(/frameRate does not match timebase rate/);
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([
    { frameRate: 30, timelineStart: 0.01, expectedFrame: 0 },
    { frameRate: 30, timelineStart: 0.02, expectedFrame: 1 },
    {
      frameRate: 30000 / 1001,
      timelineStart: 0.02,
      expectedFrame: 1,
    },
  ])(
    "activates a clip at $timelineStart seconds on rounded output frame $expectedFrame ($frameRate fps)",
    async ({ frameRate, timelineStart, expectedFrame }) => {
      const directory = await mkdtemp(
        join(tmpdir(), "openfilm-render-fractional-start-"),
      );
      directories.push(directory);
      const source = join(directory, "white.png");
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=white:s=8x8",
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-update",
        "1",
        "-y",
        source,
      ]);
      const asset = await inspectMedia({
        path: source,
        uri: pathToFileURL(source).href,
        name: "white.png",
      });
      const output = join(directory, "fractional-start.mp4");
      await new FFmpegRenderer().render(
        {
          id: "fractional-start",
          storyId: "story",
          duration: 0.2,
          tracks: [
            {
              id: "video",
              type: "video",
              clips: [
                {
                  id: "white",
                  assetId: asset.id,
                  timelineStart,
                  timelineDuration: 0.1,
                },
              ],
            },
          ],
        },
        [asset],
        output,
        { width: 64, height: 36, frameRate },
      );
      const pixels = await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        output,
        "-vf",
        "crop=2:2:32:18,format=gray,scale=1:1:flags=neighbor",
        "-frames:v",
        "3",
        "-f",
        "rawvideo",
        "-",
      ]);
      expect([...pixels.stdout]).toHaveLength(3);
      if (expectedFrame > 0)
        expect(pixels.stdout[expectedFrame - 1]).toBeLessThan(30);
      expect(pixels.stdout[expectedFrame]).toBeGreaterThan(220);
    },
  );

  it("preserves odd-pixel overlay placement in the rendered monitor frame", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-render-rgba-"));
    directories.push(directory);
    const source = join(directory, "white.png");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=white:s=8x8",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "white.png",
    });
    const composition: Composition = {
      id: "odd-offset",
      storyId: "story",
      duration: 0.5,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "white",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 0.5,
              transform: { x: 1 },
            },
          ],
        },
      ],
    };
    const output = join(directory, "odd-offset.mp4");
    await new FFmpegRenderer().render(composition, [asset], output, {
      width: 64,
      height: 36,
      frameRate: 30,
    });
    const lineAt = async (time: number) => {
      const decoded = await runProcess("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        output,
        "-frames:v",
        "1",
        "-vf",
        "crop=64:1:0:18,format=gray",
        "-f",
        "rawvideo",
        "-",
      ]);
      return [...decoded.stdout];
    };
    const first = await lineAt(0.1);
    const later = await lineAt(0.4);
    const startOfWhite = (line: number[]) =>
      line.findIndex((value) => value > 220);
    expect(startOfWhite(first)).toBe(15);
    expect(startOfWhite(later)).toBe(15);
    expect(later).toEqual(first);
  }, 30000);

  it("reports monotonic render progress from FFmpeg through completion", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-render-progress-"),
    );
    directories.push(directory);
    const source = join(directory, "white.png");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=white:s=8x8",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "white.png",
    });
    const progress: number[] = [];
    await new FFmpegRenderer().render(
      {
        id: "progress",
        storyId: "story",
        duration: 0.5,
        tracks: [
          {
            id: "video",
            type: "video",
            clips: [
              {
                id: "white",
                assetId: asset.id,
                timelineStart: 0,
                timelineDuration: 0.5,
              },
            ],
          },
        ],
      },
      [asset],
      join(directory, "progress.mp4"),
      { width: 64, height: 36, frameRate: 30 },
      { onProgress: (value) => progress.push(value) },
    );
    expect(progress.length).toBeGreaterThan(0);
    expect(
      progress.every(
        (value, index) =>
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 1 &&
          (index === 0 || value >= progress[index - 1]!),
      ),
    ).toBe(true);
    expect(progress.at(-1)).toBe(1);
  }, 30000);

  it.each(["video", "audio", "music"] as const)(
    "requires a reframed export before decoding an audible 360 source on a %s track",
    async (trackType) => {
      const directory = await mkdtemp(join(tmpdir(), "openfilm-360-gate-"));
      directories.push(directory);
      const asset: MediaAsset = {
        id: "spherical",
        name: "spherical.insv",
        // No source file exists: the supported-media guard must reject before
        // FFmpeg can attempt to open or decode it.
        uri: pathToFileURL(join(directory, "spherical.insv")).href,
        mediaType: "360-video",
        duration: 1,
        tags: [],
        state: {},
        metadata: {
          "openfilm.preview": { supported: true },
          "openfilm.ffprobe": {
            streams: [{ codec_type: "video" }, { codec_type: "audio" }],
          },
        },
      };
      const composition: Composition = {
        id: "film",
        storyId: "story",
        duration: 1,
        tracks: [
          {
            id: "selected",
            type: trackType,
            clips: [
              {
                id: "clip",
                assetId: asset.id,
                timelineStart: 0,
                timelineDuration: 1,
              },
            ],
          },
        ],
      };
      const before = structuredClone({ composition, asset });
      await expect(
        new FFmpegRenderer().render(
          composition,
          [asset],
          join(directory, "preview.mp4"),
        ),
      ).rejects.toThrow("360 source: Requires reframed export");
      expect(await readdir(directory)).toEqual([]);
      expect({ composition, asset }).toEqual(before);
    },
  );

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
    const frameTimebase = {
      version: 1 as const,
      rateNumerator: 20,
      rateDenominator: 1,
      dropFrame: false,
    };
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
    const speedClip = composition.tracks[0]!.clips[0]!;
    expect(
      resolveClipFrameTime(speedClip, asset, 3, frameTimebase).sourceTime,
    ).toBeCloseTo(1.3, 10);
    expect(
      resolveClipFrameTime(speedClip, asset, 8, frameTimebase).sourceTime,
    ).toBeCloseTo(1.8, 10);
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
    // A colon is valid inside a POSIX name but not a Windows directory name.
    // Native Windows separators and its drive colon still exercise escaping.
    const specialPath =
      process.platform === "win32"
        ? "Jo's,film 中文\\[cut].openfilm"
        : "Jo's:film\\[cut].openfilm";
    const output = join(directory, specialPath, "preview.mp4");
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

  it.each([2, 0.5, 0])(
    "contain-fits source display aspect for SAR %s before user transforms",
    async (sampleAspectRatio) => {
      const directory = await mkdtemp(join(tmpdir(), "openfilm-geometry-sar-"));
      directories.push(directory);
      const source = join(directory, "anamorphic.mp4");
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "color=red:s=160x90:r=10",
        "-vf",
        `setsar=${sampleAspectRatio}`,
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
      expect(asset.dimensions).toEqual({ width: 160, height: 90 });
      const probe = asset.metadata["openfilm.ffprobe"] as {
        streams: { sample_aspect_ratio?: string }[];
      };
      expect(probe.streams[0]?.sample_aspect_ratio).toBe(
        sampleAspectRatio === 2
          ? "2:1"
          : sampleAspectRatio === 0.5
            ? "1:2"
            : undefined,
      );
      const settings = { width: 160, height: 90, frameRate: 10 };
      for (const transform of [
        { scale: 1, rotation: 0, x: 0, y: 0 },
        { scale: 0.75, rotation: 90, x: 12, y: -4 },
      ]) {
        const composition: Composition = {
          id: "anamorphic",
          storyId: "story",
          duration: 0.4,
          tracks: [
            {
              id: "video",
              type: "video",
              clips: [
                {
                  id: "anamorphic-clip",
                  assetId: asset.id,
                  timelineStart: 0,
                  timelineDuration: 0.4,
                  transform,
                },
              ],
            },
          ],
        };
        const output = join(directory, `preview-${transform.rotation}.mp4`);
        await new FFmpegRenderer().render(
          composition,
          [asset],
          output,
          settings,
        );
        const decoded = await runProcess("ffmpeg", [
          "-v",
          "error",
          "-ss",
          "0.2",
          "-i",
          output,
          "-frames:v",
          "1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "-",
        ]);
        // Browser intrinsic video dimensions account for sample aspect ratio.
        // Compare encoded pixels with that same display-space source contract,
        // including a quarter turn, user scale, translation and frame clipping.
        const preview = resolvePreviewClipGeometry(
          transform,
          { width: 160 * (sampleAspectRatio || 1), height: 90 },
          settings,
          settings,
        );
        const width =
          (transform.rotation ? preview.media.height : preview.media.width) *
          preview.scale;
        const height =
          (transform.rotation ? preview.media.width : preview.media.height) *
          preview.scale;
        const center = { x: 80 + preview.x, y: 45 + preview.y };
        const points = [
          center,
          { x: center.x - width / 2 - 6, y: center.y },
          { x: center.x - width / 2 + 6, y: center.y },
          { x: center.x + width / 2 - 6, y: center.y },
          { x: center.x + width / 2 + 6, y: center.y },
          { x: center.x, y: center.y - height / 2 - 6 },
          { x: center.x, y: center.y - height / 2 + 6 },
          { x: center.x, y: center.y + height / 2 - 6 },
          { x: center.x, y: center.y + height / 2 + 6 },
        ];
        for (const point of points) {
          const x = Math.round(point.x);
          const y = Math.round(point.y);
          if (x < 0 || x >= settings.width || y < 0 || y >= settings.height)
            continue;
          const inside =
            Math.abs(x - center.x) < width / 2 &&
            Math.abs(y - center.y) < height / 2;
          const red = decoded.stdout[(y * settings.width + x) * 3]!;
          if (inside)
            expect(red, `${x},${y} should contain source`).toBeGreaterThan(180);
          else expect(red, `${x},${y} should reveal frame`).toBeLessThan(30);
        }
      }
    },
  );
});
