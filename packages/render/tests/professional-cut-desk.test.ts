import {
  assertRenderQaMetric,
  renderQaPolicy,
} from "../../../tests/helpers/render-qa-policy.js";
// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createExportProfile } from "@openfilm/core";
import { hashFile, runProcess } from "@openfilm/media";
import { professionalCutDeskFixture } from "../../../tests/fixtures/professional-cut-desk.js";
import { FFmpegRenderer } from "../src/index.js";

it("decodes 180 rational frames with saved edits, crossfade, graphics, tone gains and immutable source receipts", () =>
  verifyProfessionalRender(false));
it("decodes the same crossfade and source evidence with reversed saved clip order", () =>
  verifyProfessionalRender(true));

async function verifyProfessionalRender(reversed: boolean) {
  // Catches rate rounding, one-frame edit drift, lost outgoing tail/layer, wrong
  // source trim/audio gain/delay and receipt/source mutation. No resolver or
  // production evaluator computes the expected side of an assertion.
  const root = await mkdtemp(join(tmpdir(), "openfilm-professional-render-"));
  try {
    const fixture = await professionalCutDeskFixture(root);
    if (reversed) fixture.composition.tracks[0]!.clips.reverse();
    const before = structuredClone(fixture.composition);
    const output = join(root, "professional.mp4");
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
          "-count_frames",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=avg_frame_rate,nb_read_frames,duration:frame=best_effort_timestamp_time",
          "-of",
          "json",
          output,
        ])
      ).stdout.toString(),
    );
    expect(probe.streams[0]).toMatchObject({
      avg_frame_rate: "30000/1001",
      nb_read_frames: "180",
      duration: "6.006000",
    });
    expect(probe.frames).toHaveLength(180);
    const rgb = (
      await runProcess("ffmpeg", [
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
      ])
    ).stdout;
    expect(rgb.length).toBe(180 * 160 * 90 * 3);
    const pixel = (frame: number, x: number, y: number) => [
      ...rgb.subarray(
        ((frame * 90 + y) * 160 + x) * 3,
        ((frame * 90 + y) * 160 + x) * 3 + 3,
      ),
    ];
    const closePixel = (actual: number[], expected: number[]) =>
      actual.forEach((value, channel) =>
        assertRenderQaMetric(
          "cutDesk.channelError",
          Math.abs(value - expected[channel]!),
        ),
      );
    // Explicit hand-derived frame PTS and RGB. Incoming fade alpha = local/15;
    // frame 60 retains red, 67 is 8/15 red + 7/15 green, 75 is green.
    const samples = [
      { frame: 0, timestamp: 0, color: [255, 0, 0] },
      { frame: 59, timestamp: 1.968633, color: [255, 0, 0] },
      { frame: 60, timestamp: 2.002, color: [255, 0, 0] },
      { frame: 67, timestamp: 2.235567, color: [136, 119, 0] },
      { frame: 75, timestamp: 2.5025, color: [0, 255, 0] },
      { frame: 90, timestamp: 3.003, color: [0, 255, 0] },
      { frame: 119, timestamp: 3.970633, color: [0, 255, 0] },
      { frame: 120, timestamp: 4.004, color: [0, 0, 255] },
      { frame: 179, timestamp: 5.972633, color: [0, 0, 255] },
    ];
    for (const sample of samples) {
      assertRenderQaMetric(
        "cutDesk.pts",
        Number(probe.frames[sample.frame].best_effort_timestamp_time),
        sample.timestamp,
      );
      closePixel(pixel(sample.frame, 145, 10), sample.color);
    }
    for (const [frame, shapeX, graphicX] of [
      [0, 16, 20],
      [90, 72, 50],
      [179, 128, 80],
    ] as const) {
      closePixel(pixel(frame, shapeX, 38), [255, 255, 255]);
      closePixel(pixel(frame, graphicX, 70), [255, 255, 0]);
      // A static square or a missing layer must fail at middle/last frames.
      if (frame > 0)
        closePixel(
          pixel(frame, 20, 70),
          frame === 90 ? [0, 255, 0] : [0, 0, 255],
        );
    }
    // Source-frame chips change at source ticks 30 and 60. The saved 15-frame
    // source trim puts those changes at local ticks 15 and 45. Adjacent samples
    // catch even a one-frame source-position/trim regression independently.
    const sourceChips = [
      [0, 14],
      [14, 14],
      [15, 46],
      [44, 46],
      [45, 78],
      [59, 78],
      [90, 46],
      [120, 14],
      [134, 14],
      [135, 46],
      [164, 46],
      [165, 78],
      [179, 78],
    ] as const;
    for (const [frame, x] of sourceChips) {
      closePixel(pixel(frame, x, 12), [255, 255, 255]);
      closePixel(
        pixel(frame, x === 14 ? 46 : 14, 12),
        frame < 60 ? [255, 0, 0] : frame < 120 ? [0, 255, 0] : [0, 0, 255],
      );
    }
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
    const amplitude = (
      start: number,
      frequency: number,
      seconds = 0.2,
      bytes = audio,
    ) => {
      const first = Math.round(start * 48000),
        count = Math.round(seconds * 48000);
      let real = 0,
        imaginary = 0;
      for (let index = 0; index < count; index++) {
        const sample = bytes.readFloatLE((first + index) * 4);
        const angle = (2 * Math.PI * frequency * index) / 48000;
        real += sample * Math.cos(angle);
        imaginary += sample * Math.sin(angle);
      }
      return (2 * Math.hypot(real, imaginary)) / count;
    };
    // lavfi sine peak=1/8; clip volume and overlay gain are literal saved
    // decisions. Existing alimiter auto-level is 1/0.95; AAC tolerance is 0.006.
    const tones = [
      { start: 0.7, primary: 440, peak: 0.052632, overlay: false },
      { start: 2.2, primary: 660, peak: 0.078947, overlay: false },
      { start: 2.8, primary: 660, peak: 0.078947, overlay: true },
      { start: 4.2, primary: 880, peak: 0.105263, overlay: true },
      { start: 4.8, primary: 880, peak: 0.105263, overlay: false },
      { start: 5.7, primary: 880, peak: 0.105263, overlay: false },
    ].map((window) => ({
      ...window,
      measured: amplitude(window.start, window.primary),
      overlayMeasured: amplitude(window.start, 1100),
    }));
    for (const window of tones) {
      assertRenderQaMetric(
        "cutDesk.primaryAmplitudeError",
        Math.abs(window.measured - window.peak),
      );
      assertRenderQaMetric(
        "cutDesk.overlayAmplitudeError",
        Math.abs(window.overlayMeasured - (window.overlay ? 0.032895 : 0)),
      );
      for (const absent of [440, 660, 880].filter(
        (frequency) => frequency !== window.primary,
      ))
        assertRenderQaMetric(
          "cutDesk.absentAmplitude",
          amplitude(window.start, absent),
        );
    }
    // Fifty-millisecond windows contain integer cycles of every fixture tone.
    // A 25ms guard on either side catches a one-frame (33.37ms) timing shift.
    const toneEdges = [
      { start: 1.927, frequency: 440, peak: 0.052632 },
      { start: 2.027, frequency: 660, peak: 0.078947 },
      { start: 3.929, frequency: 660, peak: 0.078947 },
      { start: 4.029, frequency: 880, peak: 0.105263 },
      { start: 2.4275, frequency: 1100, peak: 0 },
      { start: 2.5275, frequency: 1100, peak: 0.032895 },
      { start: 4.4295, frequency: 1100, peak: 0.032895 },
      { start: 4.5295, frequency: 1100, peak: 0 },
    ].map((window) => ({
      ...window,
      measured: amplitude(window.start, window.frequency, 0.05),
    }));
    const diagnostic = join(root, "diagnostic.wav");
    await new FFmpegRenderer().render(
      fixture.composition,
      fixture.assets,
      diagnostic,
      fixture.settings,
      {
        audioOnly: true,
        exportProfile: createExportProfile({
          ratio: "16:9",
          width: 160,
          height: 90,
          frameRate: 30000 / 1001,
          format: "wav",
        }),
      },
    );
    const pcm = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        diagnostic,
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "f32le",
        "-",
      ])
    ).stdout;
    const sourcePcm = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        fixture.paths[1]!,
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "f32le",
        "-",
      ])
    ).stdout;
    const codecOnset = {
      aac: amplitude(2.027, 660, 0.05),
      pcm: amplitude(2.027, 660, 0.05, pcm),
      source: amplitude(0.5255, 660, 0.05, sourcePcm),
    };
    for (const window of toneEdges) {
      if (window.frequency === 1100) {
        assertRenderQaMetric(
          "cutDesk.overlayAmplitudeError",
          Math.abs(window.measured - window.peak),
        );
      } else {
        // AAC re-encoding overshoots at an abrupt tone change. The same real
        // renderer's lossless mix proves steady gain; AAC must retain >90% of
        // expected tone and exclude the old/new primary (<0.003), catching a
        // one-frame edit shift without treating onset amplitude as steady state.
        assertRenderQaMetric(
          "cutDesk.primaryAmplitudeError",
          Math.abs(
            amplitude(window.start, window.frequency, 0.05, pcm) - window.peak,
          ),
        );
        expect(window.measured).toBeGreaterThan(
          window.peak * renderQaPolicy["cutDesk.onsetGainRatio"].limit,
        );
        for (const absent of [440, 660, 880].filter(
          (frequency) => frequency !== window.frequency,
        ))
          assertRenderQaMetric(
            "cutDesk.absentAmplitude",
            amplitude(window.start, absent, 0.05),
          );
      }
    }
    const manifest = JSON.parse(
      await readFile(`${output}.manifest.json`, "utf8"),
    );
    expect(manifest.composition).toEqual(before);
    expect(manifest.settings).toEqual(fixture.settings);
    expect(manifest.warnings).toEqual([]);
    expect(manifest.outputSha256).toBe(await hashFile(output));
    expect(manifest.sources).toHaveLength(4);
    for (const [index, asset] of fixture.assets.entries()) {
      expect(manifest.sources).toContainEqual(
        expect.objectContaining({
          assetId: asset.id,
          sha256: fixture.hashes[index],
          uri: asset.uri,
        }),
      );
      expect(await hashFile(fixture.paths[index]!)).toBe(fixture.hashes[index]);
    }
    expect(fixture.composition).toEqual(before);
    console.log(
      "Professional Cut Desk FFmpeg evidence",
      JSON.stringify({
        temporaryOutput: output,
        cleanup: "removed after assertion",
        rate: probe.streams[0].avg_frame_rate,
        decodedFrames: probe.frames.length,
        samples: samples.map((sample) => ({
          ...sample,
          actual: pixel(sample.frame, 145, 10),
        })),
        sourceChips,
        tones,
        toneEdges,
        codecOnset,
        sourceSha256: fixture.hashes,
        warnings: manifest.warnings,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
