import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { CaptionTrack, Composition } from "@openfilm/core";
import { serializeCaptions } from "@openfilm/exporters";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("native Composition caption rendering", () => {
  it("burns a segment-timed Traditional Chinese cue into decoded MP4 frames and retains SRT/VTT timing", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-native-captions-"),
    );
    directories.push(directory);
    const source = join(directory, "synthetic-narration.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x405060:s=320x180:r=30",
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
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-y",
      source,
    ]);
    const originalHash = await hashFile(source);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "synthetic-narration.mp4",
    });
    const cue = {
      version: 1 as const,
      id: "zh-caption-1",
      startMs: 900,
      endMs: 1_500,
      text: "繁體字幕",
      source: {
        kind: "transcript" as const,
        assetId: "synthetic-dialogue",
        transcriptId: "synthetic-transcript",
        transcriptRevisionId: "synthetic-revision",
        segmentId: "synthetic-segment",
        clipId: "synthetic-shot",
        alignment: "segment" as const,
        sourceIn: 0.9,
        sourceOut: 1.5,
      },
      warnings: ["timing-estimated" as const],
      manualRevision: 0,
    };
    const captions: CaptionTrack = {
      version: 1,
      id: "zh-TW",
      name: "繁體中文",
      language: "zh-TW",
      style: {
        version: 1,
        role: "subtitle",
        fontFamily: "Noto Sans CJK TC",
        fontSize: 24,
        background: "none",
        position: "bottom",
        safeArea: { left: 0.08, right: 0.08, top: 0.08, bottom: 0.15 },
      },
      cues: [cue],
    };
    const composition: Composition = {
      id: "synthetic-film",
      storyId: "story",
      duration: 3,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "synthetic-shot",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 3,
            },
          ],
        },
      ],
      captionTracks: [captions],
    };
    const output = join(directory, "native-caption.mp4");
    await new FFmpegRenderer().render(
      composition,
      [asset],
      output,
      { width: 320, height: 180, frameRate: 30 },
      { captionTrackId: captions.id },
    );

    const rendered = await inspectMedia({
      path: output,
      uri: pathToFileURL(output).href,
      name: "native-caption.mp4",
    });
    expect(rendered.metadata["openfilm.ffprobe"]).toMatchObject({
      streams: expect.arrayContaining([
        expect.objectContaining({ codec_type: "video", codec_name: "h264" }),
        expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
      ]),
    });
    const decode = async (time: number) =>
      runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        output,
        "-ss",
        String(time),
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ]).then((result) => result.stdout);
    const before = await decode(0.7);
    const active = await decode(1.1);
    const after = await decode(1.7);
    const bright = (pixels: Buffer) => {
      const points: Array<{ x: number; y: number }> = [];
      for (let y = 0; y < 180; y++)
        for (let x = 0; x < 320; x++) {
          const index = (y * 320 + x) * 3;
          if (
            pixels[index]! > 215 &&
            pixels[index + 1]! > 215 &&
            pixels[index + 2]! > 215
          )
            points.push({ x, y });
        }
      return points;
    };
    expect(bright(before)).toHaveLength(0);
    const textPixels = bright(active);
    expect(textPixels.length).toBeGreaterThan(30);
    expect(bright(after)).toHaveLength(0);
    const bounds = {
      left: Math.min(...textPixels.map((point) => point.x)),
      right: Math.max(...textPixels.map((point) => point.x)),
      top: Math.min(...textPixels.map((point) => point.y)),
      bottom: Math.max(...textPixels.map((point) => point.y)),
    };
    expect((bounds.left + bounds.right) / 2).toBeGreaterThan(110);
    expect((bounds.left + bounds.right) / 2).toBeLessThan(210);
    expect(bounds.top).toBeGreaterThan(90);
    expect(bounds.bottom).toBeLessThan(170);
    expect(await hashFile(source)).toBe(originalHash);
    const manifest = JSON.parse(
      await readFile(`${output}.manifest.json`, "utf8"),
    ) as { warnings: string[]; sources: { sha256: string }[] };
    expect(manifest.warnings).toContain(
      "Caption cue zh-caption-1 uses estimated segment timing; review its appearance manually.",
    );
    expect(manifest.warnings).not.toContain(
      "Caption cue zh-caption-1 has stale transcript alignment; review its appearance manually.",
    );
    expect(manifest.sources.map((item) => item.sha256)).toContain(originalHash);

    const exportCue = {
      id: cue.id,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text,
    };
    expect(serializeCaptions("srt", [exportCue]).content).toContain(
      "00:00:00,900 --> 00:00:01,500\n繁體字幕",
    );
    expect(serializeCaptions("vtt", [exportCue]).content).toContain(
      "00:00:00.900 --> 00:00:01.500\n繁體字幕",
    );
  }, 90_000);
});
