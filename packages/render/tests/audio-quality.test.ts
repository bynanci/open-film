import {
  assertRenderQaMetric,
  renderQaPolicy,
} from "../../../tests/helpers/render-qa-policy.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runProcess } from "@openfilm/media";
import {
  AUDIO_METER_FILTER,
  measureAudioOutput,
  normalizationSuggestion,
} from "../src/audio-quality.js";

it("measures decoded AAC MP4 loudness, peaks and meter bins; silence stays unmeasurable", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-audio-quality-"));
  try {
    const output = join(root, "synthetic.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=s=160x90:r=12:d=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4:sample_rate=48000",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-shortest",
      output,
    ]);
    const measured = await measureAudioOutput(output);
    assertRenderQaMetric("audio.integratedLufs", measured.integratedLufs!);
    expect(measured.truePeakDbtp).toBeGreaterThanOrEqual(
      measured.samplePeakDbfs! +
        renderQaPolicy["audio.trueMinusSamplePeak"].limit,
    );
    expect(measured.meterBins.length).toBeGreaterThan(10);
    expect(measured.meterBins.some((bin) => bin.peakDbfs !== null)).toBe(true);
    assertRenderQaMetric("audio.duration", measured.duration, 4);
    const silence = join(root, "silence.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      "4",
      "-c:a",
      "aac",
      silence,
    ]);
    const quiet = await measureAudioOutput(silence);
    expect(quiet.integratedLufs).toBeNull();
    expect(normalizationSuggestion(quiet, "narration", 1)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("suggests role gain with true-peak headroom and respects the existing unity limit", () => {
  const measured = { integratedLufs: -10, truePeakDbtp: -0.5 };
  const suggestion = normalizationSuggestion(measured, "narration", 0.4)!;
  expect(suggestion.targetLufs).toBe(-16);
  expect(suggestion.volume).toBeCloseTo(0.4 * 10 ** (-6 / 20), 6);
  const limited = normalizationSuggestion(
    { integratedLufs: -40, truePeakDbtp: -20 },
    "music",
    0.8,
  )!;
  expect(limited.volume).toBe(1);
  expect(limited.limited).toBe(true);
});

it("bounds meter evidence for one hour of stereo 48 kHz audio", async () => {
  const result = await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      "3600",
      "-af",
      AUDIO_METER_FILTER,
      "-f",
      "null",
      "-",
    ],
    { maxOutputBytes: 16 * 1024 * 1024, timeoutMs: 120000 },
  );
  expect(result.stdout.length).toBeLessThan(16 * 1024 * 1024);
  expect(result.stdout.toString()).toContain("pts_time:3599.9");
  expect(result.stdout.toString()).not.toContain("lavfi.astats.1.");
}, 120000);
