import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { frameAlignedDuration, type Composition } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it.each([
  [1.01, 30, 1],
  [1.02, 30000 / 1001, 1.001],
])(
  "real MP4 floors a %s second spoken clip at %s fps to the shared %s second boundary",
  async (duration, frameRate, expected) => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-render-timing-"));
    directories.push(directory);
    const source = join(directory, "speech.wav");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      String(duration),
      "-c:a",
      "pcm_s16le",
      "-y",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "speech.wav",
    });
    const sourceHash = await hashFile(source);
    const composition: Composition = {
      id: "film",
      storyId: "story",
      duration,
      tracks: [
        {
          id: "voice",
          type: "audio",
          clips: [
            {
              id: "spoken",
              assetId: asset.id,
              sourceIn: 0,
              sourceOut: duration,
              timelineStart: 0,
              timelineDuration: duration,
            },
          ],
        },
      ],
    };
    const before = structuredClone(composition);
    const output = join(directory, "film.mp4");
    await new FFmpegRenderer().render(composition, [asset], output, {
      width: 64,
      height: 36,
      frameRate,
    });
    const probe = await runProcess("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=duration,nb_frames",
      "-of",
      "json",
      output,
    ]);
    const stream = JSON.parse(probe.stdout.toString("utf8")).streams[0] as {
      duration: string;
      nb_frames: string;
    };
    expect(Number(stream.duration)).toBeCloseTo(expected, 6);
    expect(Number(stream.duration)).toBeCloseTo(
      frameAlignedDuration(duration, frameRate),
      6,
    );
    expect(Number(stream.nb_frames)).toBe(30);
    expect(Number(stream.duration)).toBeLessThan(duration);
    expect(await hashFile(source)).toBe(sourceHash);
    expect(composition).toEqual(before);
  },
);

it("keeps the renderer's sub-frame error and creates no partial output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-render-subframe-"));
  directories.push(directory);
  expect(frameAlignedDuration(0.01, 30)).toBe(0);
  await expect(
    new FFmpegRenderer().render(
      { id: "film", storyId: "story", duration: 0.01, tracks: [] },
      [],
      join(directory, "film.mp4"),
      { width: 64, height: 36, frameRate: 30 },
    ),
  ).rejects.toThrow("Composition must last at least one output frame");
  expect(await readdir(directory)).toEqual([]);
});
