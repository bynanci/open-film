import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createExportProfile, type Composition } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { FFmpegRenderer, type RenderOptions } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function probe(path: string) {
  const result = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,sample_rate",
    "-of",
    "json",
    path,
  ]);
  return JSON.parse(result.stdout.toString("utf8")) as {
    format: { duration: string };
    streams: Array<Record<string, string>>;
  };
}

describe("profiled FFmpeg exports", () => {
  it("keeps the saved composition and source unchanged while contain and crop produce the requested actual frame", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-profiled-frame-"));
    roots.push(root);
    const source = join(root, "synthetic.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=320x180:r=30:d=0.2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "1",
      "-y",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "synthetic.mp4",
    });
    const composition: Composition = {
      id: "vertical-test",
      storyId: "story",
      duration: 0.2,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 0.2,
            },
          ],
        },
      ],
    };
    const before = structuredClone(composition);
    const hash = await hashFile(source);
    const renderer = new FFmpegRenderer();
    const render = async (name: string, framing: "contain" | "crop") => {
      const path = join(root, `${name}.mp4`);
      const profile = createExportProfile({
        ratio: "9:16",
        width: 108,
        height: 192,
        frameRate: 30,
        framing,
      });
      const options = { exportProfile: profile } as RenderOptions;
      await renderer.render(
        composition,
        [asset],
        path,
        { width: 160, height: 90, frameRate: 30 },
        options,
      );
      return {
        path,
        profile,
        manifest: JSON.parse(
          await readFile(`${path}.manifest.json`, "utf8"),
        ) as Record<string, unknown>,
      };
    };

    const contained = await render("contained", "contain");
    const cropped = await render("cropped", "crop");
    for (const output of [contained, cropped]) {
      const result = await probe(output.path);
      expect(result.streams[0]).toMatchObject({
        width: 108,
        height: 192,
        r_frame_rate: "30/1",
        nb_frames: "6",
      });
      expect(output.manifest.exportProfile).toEqual(output.profile);
      expect(output.manifest.outputSha256).toBe(await hashFile(output.path));
    }
    const containedFrame = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        contained.path,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ])
    ).stdout;
    const croppedFrame = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        cropped.path,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ])
    ).stdout;
    const topPixel = 0;
    expect([...containedFrame.subarray(topPixel, topPixel + 3)]).toEqual([
      0, 0, 0,
    ]);
    expect([...croppedFrame.subarray(topPixel, topPixel + 3)]).toEqual([
      253, 0, 0,
    ]);
    expect(contained.manifest.warnings).toContain(
      "Profile letterboxes the saved Composition frame with black padding.",
    );
    expect(cropped.manifest.warnings).toContain(
      "Explicit center crop may trim protected subjects or subtitle safe areas; review the export frame.",
    );
    expect(composition).toEqual(before);
    expect(await hashFile(source)).toBe(hash);
  });

  it("writes full-mix and role stems as aligned 48 kHz PCM WAV through the same automation path", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-profiled-wav-"));
    roots.push(root);
    const source = join(root, "narration.wav");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:sample_rate=48000:duration=0.4",
      "-c:a",
      "pcm_s16le",
      "-y",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "narration.wav",
    });
    const composition: Composition = {
      id: "audio-test",
      storyId: "story",
      duration: 0.4,
      tracks: [
        {
          id: "narration",
          type: "audio",
          timing: "overlay",
          clips: [
            {
              id: "voice",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 0.4,
              audioAutomation: {
                version: 1,
                role: "narration",
                fadeIn: 0.1,
                fadeOut: 0.1,
                points: [
                  { time: 0, gain: 0.7 },
                  { time: 0.4, gain: 0.5 },
                ],
              },
            },
          ],
        },
      ],
    };
    const hash = await hashFile(source);
    const profile = createExportProfile({
      ratio: "16:9",
      width: 160,
      height: 90,
      frameRate: 30,
      format: "wav",
    });
    for (const audioRole of [undefined, "narration"] as const) {
      const path = join(root, audioRole ? "narration-stem.wav" : "mix.wav");
      const options = {
        exportProfile: profile,
        audioOnly: true,
        ...(audioRole ? { audioRole } : {}),
      } as RenderOptions;
      await new FFmpegRenderer().render(
        composition,
        [asset],
        path,
        { width: 160, height: 90, frameRate: 30 },
        options,
      );
      const result = await probe(path);
      expect(result.streams).toHaveLength(1);
      expect(result.streams[0]).toMatchObject({
        codec_name: "pcm_s24le",
        sample_rate: "48000",
      });
      expect(Number(result.format.duration)).toBeCloseTo(0.4, 3);
      expect(await readFile(`${path}.manifest.json`, "utf8")).toContain(
        '"audio": "pcm_s24le"',
      );
    }
    expect(await hashFile(source)).toBe(hash);
  });
});
