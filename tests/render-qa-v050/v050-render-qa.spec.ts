// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { expect, it } from "vitest";
import { hashFile, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "@openfilm/render";
import { professionalCutDeskFixture } from "../fixtures/professional-cut-desk.js";
import {
  assertRenderQaIdentity,
  assertRenderQaMetric,
} from "../helpers/render-qa-policy.js";

const expectedPts = [
  [0, 0],
  [59, 1.968633],
  [60, 2.002],
  [67, 2.235567],
  [75, 2.5025],
  [90, 3.003],
  [119, 3.970633],
  [120, 4.004],
  [179, 5.972633],
] as const;
const expectedRgb = [
  [0, [255, 0, 0]],
  [59, [255, 0, 0]],
  [60, [255, 0, 0]],
  [67, [136, 119, 0]],
  [75, [0, 255, 0]],
  [90, [0, 255, 0]],
  [119, [0, 255, 0]],
  [120, [0, 0, 255]],
  [179, [0, 0, 255]],
] as const;

it("decodes the candidate composition and writes bounded synthetic render evidence", async () => {
  const evidenceRoot = process.env.OPENFILM_RENDER_QA_OUTPUT;
  if (!evidenceRoot || !isAbsolute(evidenceRoot))
    throw new Error("OPENFILM_RENDER_QA_OUTPUT must be an absolute directory");
  await mkdir(evidenceRoot, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), "openfilm-v050-render-qa-"));
  try {
    const fixture = await professionalCutDeskFixture(scratch);
    const output = join(scratch, "v050-candidate-render.mp4");
    await new FFmpegRenderer().render(
      fixture.composition,
      fixture.assets,
      output,
      fixture.settings,
      { quality: "high-detail" },
    );

    const probe = JSON.parse(
      (
        await runProcess("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_streams",
          "-show_frames",
          "-show_entries",
          "stream=width,height,avg_frame_rate:frame=best_effort_timestamp_time",
          "-of",
          "json",
          output,
        ])
      ).stdout.toString(),
    ) as {
      streams?: Array<{
        width?: number;
        height?: number;
        avg_frame_rate?: string;
      }>;
      frames?: Array<{ best_effort_timestamp_time?: string }>;
    };
    const videoStream = probe.streams?.[0];
    const frames = probe.frames ?? [];
    expect(videoStream).toMatchObject({
      width: 160,
      height: 90,
      avg_frame_rate: "30000/1001",
    });
    expect(frames).toHaveLength(180);
    const decoded = await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-i",
      output,
      "-map",
      "0:v:0",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    expect(decoded.stdout).toHaveLength(180 * 160 * 90 * 3);

    const pts = expectedPts.map(([frame, expected]) => {
      const seconds = Number(frames[frame]?.best_effort_timestamp_time);
      assertRenderQaMetric("cutDesk.pts", seconds, expected);
      return { frame, seconds };
    });
    const rgbSamples = expectedRgb.map(([frame, expected]) => {
      const index = ((frame * 90 + 10) * 160 + 145) * 3;
      const actual = [
        decoded.stdout[index]!,
        decoded.stdout[index + 1]!,
        decoded.stdout[index + 2]!,
      ];
      actual.forEach((channel, channelIndex) =>
        assertRenderQaMetric(
          "cutDesk.channelError",
          Math.abs(channel - expected[channelIndex]!),
        ),
      );
      return { frame, expected: [...expected], actual };
    });

    const audioProbe = JSON.parse(
      (
        await runProcess("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=codec_name,sample_rate,channels",
          "-of",
          "json",
          output,
        ])
      ).stdout.toString(),
    ) as {
      streams?: Array<{
        codec_name?: string;
        sample_rate?: string;
        channels?: number;
      }>;
    };
    const audioStream = audioProbe.streams?.[0];
    expect(audioStream).toMatchObject({
      codec_name: "aac",
      sample_rate: "48000",
      channels: 1,
    });
    const pcm = await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-i",
      output,
      "-map",
      "0:a:0",
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "48000",
      "-ac",
      "1",
      "pipe:1",
    ]);
    expect(pcm.stdout.length % 2).toBe(0);
    const decodedSampleFrames = pcm.stdout.length / 2;
    expect(Math.abs(decodedSampleFrames - 288288)).toBeLessThanOrEqual(2048);

    const sources = await Promise.all(
      fixture.paths.map(async (path, index) => {
        const actualHash = await hashFile(path);
        assertRenderQaIdentity(
          "sourceHash",
          fixture.hashes[index]!,
          actualHash,
        );
        return {
          id: index < 3 ? `source-${index}` : "overlay-audio",
          beforeSha256: fixture.hashes[index]!,
          afterSha256: actualHash,
        };
      }),
    );
    const evidence = {
      sources,
      outputSha256: await hashFile(output),
      width: videoStream!.width,
      height: videoStream!.height,
      frameRate: { numerator: 30000, denominator: 1001 },
      frameCount: frames.length,
      pts,
      rgbSamples,
      audio: {
        codec: audioStream!.codec_name,
        sampleRate: Number(audioStream!.sample_rate),
        channels: audioStream!.channels,
        decodedSampleFrames,
      },
    };
    await writeFile(
      resolve(evidenceRoot, "render.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 120_000);
