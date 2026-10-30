// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import {
  projectClipWaveform,
  type Clip,
  type Composition,
  type MediaAsset,
  type ProjectTimebaseV1,
} from "@openfilm/core";
import { generateWaveform, hashFile, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index.js";

function intervals(values: readonly number[], threshold: number, step: number) {
  const spans: { start: number; end: number }[] = [];
  for (const [index, value] of values.entries()) {
    if (value <= threshold) continue;
    const previous = spans.at(-1);
    if (previous && Math.abs(previous.end - index * step) < step / 2)
      previous.end = (index + 1) * step;
    else spans.push({ start: index * step, end: (index + 1) * step });
  }
  return spans;
}

it("matches Sequence peaks to decoded real MP4 pulses after trim, fast/slow/repeated source and silent video hold", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-sequence-pulse-"));
  try {
    const source = join(root, "synthetic-pulse-source.mp4");
    const pulse =
      "0.8*sin(2*PI*1000*t)*(between(t\\,0.5\\,0.58)+between(t\\,1.5\\,1.58)+between(t\\,3\\,3.08))";
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=20:duration=4",
      "-f",
      "lavfi",
      "-i",
      `aevalsrc=${pulse}:s=48000:d=4`,
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      source,
    ]);
    const sourceHash = await hashFile(source);
    const asset: MediaAsset = {
      id: "synthetic-pulses",
      name: "CC0 generated pulses",
      uri: pathToFileURL(source).href,
      mediaType: "video",
      duration: 4,
      dimensions: { width: 160, height: 90 },
      frameRate: 20,
      contentHash: sourceHash,
      tags: [],
      state: { locked: true },
      metadata: {
        "openfilm.ffprobe": {
          streams: [{ codec_type: "video" }, { codec_type: "audio" }],
        },
      },
    };
    const wave = await generateWaveform(asset, sourceHash);
    const clips: Clip[] = [
      {
        id: "trim",
        assetId: asset.id,
        timelineStart: 0.4,
        timelineDuration: 1,
        sourceIn: 0.25,
        sourceOut: 1.25,
        locked: true,
      },
      {
        id: "fast",
        assetId: asset.id,
        timelineStart: 2,
        timelineDuration: 0.5,
        sourceIn: 1,
        sourceOut: 2,
        transform: { speed: 2 },
        locked: true,
      },
      {
        id: "hold",
        assetId: asset.id,
        timelineStart: 3,
        timelineDuration: 2,
        sourceIn: 2.5,
        sourceOut: 3.5,
        locked: true,
      },
      {
        id: "slow",
        assetId: asset.id,
        timelineStart: 5,
        timelineDuration: 1,
        sourceIn: 0.25,
        sourceOut: 0.75,
        transform: { speed: 0.5 },
        locked: true,
      },
    ];
    const composition: Composition = {
      id: "pulse-cut",
      storyId: "synthetic",
      duration: 6,
      tracks: [{ id: "picture-and-audio", type: "video", clips }],
    };
    const before = structuredClone(composition);
    const timebase: ProjectTimebaseV1 = {
      version: 1,
      rateNumerator: 20,
      rateDenominator: 1,
      dropFrame: false,
    };
    const projections = clips.map((clip) =>
      projectClipWaveform({
        clip,
        asset,
        waveform: wave,
        sourceHash,
        timebase,
        viewStartFrame: 0,
        viewEndFrame: 120,
        columns: 600,
      }),
    );
    const combined = Array.from({ length: 600 }, (_, column) =>
      Math.max(...projections.map((result) => result.peaks[column]!)),
    );
    const projected = intervals(combined, 0.15, 0.01);
    expect(projected).toHaveLength(4);
    // Independent edited source centers: .4+(.54-.25),2+(1.54-1)/2,
    // 3+(3.04-2.5),5+(.54-.25)/.5. No production helper derives expectations.
    const expectedCenters = [0.69, 2.27, 3.54, 5.58];
    for (const [index, span] of projected.entries())
      expect(
        Math.abs((span.start + span.end) / 2 - expectedCenters[index]!),
      ).toBeLessThanOrEqual(1 / wave.sampleRate + 0.000001);
    expect(
      projections[2]!.covered.slice(400, 500).every((covered) => !covered),
    ).toBe(true);
    const output = join(root, "six-second-sequence.mp4");
    await new FFmpegRenderer().render(composition, [asset], output, {
      width: 160,
      height: 90,
      frameRate: 20,
      timebase,
    });
    const probe = JSON.parse(
      (
        await runProcess("ffprobe", [
          "-v",
          "error",
          "-count_frames",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=avg_frame_rate,nb_read_frames,duration",
          "-of",
          "json",
          output,
        ])
      ).stdout.toString(),
    );
    expect(probe.streams[0]).toMatchObject({
      avg_frame_rate: "20/1",
      nb_read_frames: "120",
      duration: "6.000000",
    });
    const rgb = (
      await runProcess(
        "ffmpeg",
        [
          "-v",
          "error",
          "-i",
          output,
          "-map",
          "0:v:0",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ],
        { maxOutputBytes: 8 * 1024 * 1024 },
      )
    ).stdout;
    expect(rgb.length).toBe(120 * 160 * 90 * 3);
    const pcm = (
      await runProcess(
        "ffmpeg",
        [
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
        ],
        { maxOutputBytes: 2 * 1024 * 1024 },
      )
    ).stdout;
    const samples = new Float32Array(
      pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
    );
    const rms: number[] = [];
    for (let first = 0; first < 6 * 48000; first += 480) {
      let power = 0;
      for (let index = first; index < first + 480; index++)
        power += (samples[index] ?? 0) ** 2;
      rms.push(Math.sqrt(power / 480));
    }
    const decoded = intervals(rms, 0.15, 0.01);
    expect(decoded).toHaveLength(4);
    // Compare centers within the coarsest admitted observation resolution.
    const timingTolerance = Math.max(1 / 20, 1 / wave.sampleRate, 1024 / 48000);
    for (const [index, span] of decoded.entries()) {
      const center = (span.start + span.end) / 2;
      expect(Math.abs(center - expectedCenters[index]!)).toBeLessThanOrEqual(
        timingTolerance,
      );
      expect(
        Math.abs(
          center - (projected[index]!.start + projected[index]!.end) / 2,
        ),
      ).toBeLessThanOrEqual(timingTolerance);
    }
    expect(Math.max(...rms.slice(420, 480))).toBeLessThan(0.003);
    expect(await hashFile(source)).toBe(sourceHash);
    expect(composition).toEqual(before);
    if (process.env.OPENFILM_SEQUENCE_WAVEFORM_QA_OUTPUT) {
      const evidence = join(
        process.env.OPENFILM_SEQUENCE_WAVEFORM_QA_OUTPUT,
        basename(root),
      );
      await mkdir(evidence, { recursive: true });
      await copyFile(output, join(evidence, "synthetic.mp4"));
      await writeFile(
        join(evidence, "evidence.json"),
        JSON.stringify(
          {
            sourceHash,
            outputHash: await hashFile(output),
            decodedFrameHash: createHash("sha256").update(rgb).digest("hex"),
            decodedPcmHash: createHash("sha256").update(pcm).digest("hex"),
            frameCount: 120,
            duration: 6,
            frameRate: 20,
            waveformBinsPerSecond: wave.sampleRate,
            expectedCenters,
            projected,
            decoded,
            timingTolerance,
            immutable: true,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
