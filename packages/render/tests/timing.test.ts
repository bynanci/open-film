import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  frameAlignedDuration,
  generateCompositionCaptions,
  type Composition,
  type TranscriptDocument,
} from "@openfilm/core";
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

it.each([
  { mediaType: "audio", sourceIn: 0.25, speed: 1 },
  { mediaType: "video", sourceIn: 0.2, speed: 2 },
] as const)(
  "omitted sourceOut on a short $mediaType with sourceIn=$sourceIn and speed=$speed produces captions only while source audio is audible",
  async ({ mediaType, sourceIn, speed }) => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-render-implicit-source-end-"),
    );
    directories.push(directory);
    const source = join(
      directory,
      mediaType === "video" ? "short.mp4" : "short.wav",
    );
    const inputs =
      mediaType === "video"
        ? [
            "-f",
            "lavfi",
            "-i",
            "color=red:s=64x36:r=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
          ]
        : ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"];
    const codecs =
      mediaType === "video"
        ? [
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
          ]
        : ["-c:a", "pcm_s16le"];
    await runProcess("ffmpeg", [
      "-v",
      "error",
      ...inputs,
      "-t",
      "1.2",
      ...codecs,
      "-y",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: mediaType === "video" ? "short.mp4" : "short.wav",
    });
    expect(asset.mediaType).toBe(mediaType);
    expect(asset.duration).toBeCloseTo(1.2, 2);
    const sourceHash = await hashFile(source);
    const timelineStart = 0.2;
    const composition: Composition = {
      id: "film",
      storyId: "story",
      duration: 2.2,
      tracks: [
        {
          id: "spoken",
          type: mediaType,
          clips: [
            {
              id: "padded-source",
              assetId: asset.id,
              sourceIn,
              timelineStart,
              timelineDuration: 2,
              transform: { speed },
            },
          ],
        },
      ],
    };
    const before = structuredClone(composition);
    const output = join(directory, "padded.mp4");
    await new FFmpegRenderer().render(composition, [asset], output, {
      width: 64,
      height: 36,
      frameRate: 30,
    });
    const audio = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        output,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "f32le",
        "-",
      ])
    ).stdout;
    const rms = (start: number, end: number) => {
      const first = Math.round(start * 48000),
        last = Math.round(end * 48000);
      expect(audio.length).toBeGreaterThanOrEqual(last * 4);
      let squares = 0;
      for (let index = first; index < last; index++)
        squares += audio.readFloatLE(index * 4) ** 2;
      return Math.sqrt(squares / (last - first));
    };
    const audibleEnd = timelineStart + (asset.duration! - sourceIn) / speed;
    expect(rms(timelineStart + 0.15, timelineStart + 0.25)).toBeGreaterThan(
      0.01,
    );
    expect(rms(audibleEnd + 0.25, audibleEnd + 0.45)).toBeLessThan(0.0005);
    const probe = await runProcess("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=duration",
      "-of",
      "json",
      output,
    ]);
    const outputDuration = Number(
      JSON.parse(probe.stdout.toString("utf8")).streams[0].duration,
    );
    expect(outputDuration).toBeCloseTo(
      frameAlignedDuration(composition.duration, 30),
      6,
    );
    if (mediaType === "video") {
      const frozen = (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-ss",
          String(audibleEnd + 0.3),
          "-i",
          output,
          "-frames:v",
          "1",
          "-vf",
          "scale=1:1,format=rgb24",
          "-f",
          "rawvideo",
          "-",
        ])
      ).stdout;
      expect(frozen[0]).toBeGreaterThan(150);
      expect(frozen[1]).toBeLessThan(40);
    }
    const transcript: TranscriptDocument = {
      id: "known-segments",
      assetId: asset.id,
      provenance: {
        providerId: "fixture-not-asr",
        version: "1",
        sourceHash,
        createdAt: "2026-10-08T00:00:00Z",
      },
      segments: [
        {
          id: "trimmed",
          start: 0,
          end: sourceIn,
          text: "Before the selected source range",
        },
        {
          id: "heard",
          start: sourceIn + 0.1,
          end: sourceIn + 0.3,
          text: "Audible tone interval",
        },
        {
          id: "last",
          start: asset.duration! - 0.15,
          end: asset.duration!,
          text: "Last real source interval",
        },
        // Deliberately out-of-source text must never occupy the padded silence.
        {
          id: "padding",
          start: asset.duration! + 0.1,
          end: asset.duration! + 0.3,
          text: "Not spoken in the source",
        },
      ],
    };
    const transcriptBefore = structuredClone(transcript);
    const mapped = generateCompositionCaptions(
      composition,
      [
        {
          asset,
          available: true,
          transcript,
          transcriptRevisionId: "fixture-revision",
        },
      ],
      { trackId: "spoken", frameRate: 30 },
    );
    expect(mapped.issues.filter((issue) => issue.severity === "error")).toEqual(
      [],
    );
    expect(mapped.cues.map((cue) => cue.segmentId)).toEqual(["heard", "last"]);
    const heard = mapped.cues[0]!;
    expect(heard.startMs).toBe(
      Math.ceil((timelineStart + 0.1 / speed) * 1000 - 1e-6),
    );
    expect(heard.endMs).toBe(
      Math.floor((timelineStart + 0.3 / speed) * 1000 + 1e-6),
    );
    expect(
      mapped.cues.every(
        (cue) => cue.endMs <= Math.floor(audibleEnd * 1000 + 1e-6),
      ),
    ).toBe(true);
    expect(
      mapped.cues.every(
        (cue) => cue.endMs <= Math.floor(outputDuration * 1000),
      ),
    ).toBe(true);
    expect(await hashFile(source)).toBe(sourceHash);
    expect(composition).toEqual(before);
    expect(transcript).toEqual(transcriptBefore);
  },
);
