import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  CANONICAL_AUDIO_FILTER,
  SOURCE_CLOCK_AUDIO_FILTER,
  hashFile,
  inspectCanonicalAudio,
  runProcess,
} from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function source(gap: number, audioOffset = 0, containerOffset = 0) {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-canonical-clock-"));
  directories.push(directory);
  const path = join(directory, "pulses.mkv");
  // Analytic pulses at source .6, 1 and 1.6 s; each packet is exactly 10 ms.
  // Packet removal changes PTS continuity, never the independently known pulse coordinates.
  const pulses = [28800, 48000, 76800]
    .map((n) => `between(n\\,${n}\\,${n + 479})`)
    .join("+");
  const holes = [0.4, 0.8, 1.2]
    .map((t) => `gte(t\\,${t})*lt(t\\,${(t + gap).toFixed(3)})`)
    .join("+");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=96x64:r=25:d=2",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=if(${pulses}\\,0.75\\,0.5):s=48000:d=2`,
    "-filter:a",
    `asetnsamples=n=480,aselect=not(${holes}),asetpts=PTS+${audioOffset}/TB`,
    "-c:v",
    "ffv1",
    "-c:a",
    "pcm_s24le",
    "-threads",
    "1",
    "-avoid_negative_ts",
    "disabled",
    "-output_ts_offset",
    String(containerOffset),
    path,
  ]);
  const hash = await hashFile(path);
  const facts = await inspectCanonicalAudio({
    id: "pulses",
    name: "Pulses",
    uri: pathToFileURL(path).href,
    mediaType: "video",
    duration: 2,
    contentHash: hash,
    tags: [],
    state: {},
    metadata: {},
  });
  return { path, hash, facts };
}

async function pulseSamples(path: string, rate: number, filter: string) {
  const result = await runProcess("ffmpeg", [
    "-v",
    "error",
    "-threads",
    "1",
    "-i",
    path,
    "-map",
    "0:a:0",
    "-af",
    filter,
    "-ar",
    String(rate),
    "-ac",
    "1",
    "-f",
    "f32le",
    "-",
  ]);
  const samples = new Float32Array(result.stdout.length / 4);
  const starts: number[] = [];
  for (let n = 0; n < samples.length; n++) {
    samples[n] = result.stdout.readFloatLE(n * 4);
    if (samples[n]! > 0.625 && (n === 0 || samples[n - 1]! <= 0.625))
      starts.push(n);
  }
  return { starts, length: samples.length };
}

it.each([0.02, 0.05, 0.08, 0.15])(
  "preserves independent pulse coordinates across repeated %s s internal gaps at 48k and restored 16k",
  async (gap) => {
    const { path, hash, facts } = await source(gap);
    const canonical = await pulseSamples(path, 48000, CANONICAL_AUDIO_FILTER);
    const transcript = await pulseSamples(
      path,
      16000,
      SOURCE_CLOCK_AUDIO_FILTER,
    );
    expect(canonical.starts).toHaveLength(3);
    expect(transcript.starts).toHaveLength(3);
    for (const [index, time] of [0.6, 1, 1.6].entries()) {
      expect(
        Math.abs(canonical.starts[index]! - time * 48000),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(transcript.starts[index]! - time * 16000),
      ).toBeLessThanOrEqual(1);
    }
    expect(canonical.length).toBe(96000);
    expect(facts.lengthSamples).toBe(canonical.length);
    expect(await hashFile(path)).toBe(hash);
  },
);

it.each([
  { name: "delayed stream", audioOffset: 0.125, containerOffset: 0 },
  { name: "negative first PTS", audioOffset: -0.125, containerOffset: 0 },
  { name: "nonzero container start", audioOffset: 0.125, containerOffset: 7 },
])(
  "retains source-local pulse positions for $name instead of erasing stream offset",
  async ({ audioOffset, containerOffset }) => {
    const { path, hash, facts } = await source(
      0.05,
      audioOffset,
      containerOffset,
    );
    const audio = facts.probe.streams.find(
      (stream) => stream.codec_type === "audio",
    )!;
    const formatStart = Number(facts.probe.format!.start_time);
    const sourceOffset = Math.max(0, Number(audio.start_time) - formatStart);
    expect(Number(audio.start_time)).toBeCloseTo(
      audioOffset + containerOffset,
      6,
    );
    expect(formatStart).toBeCloseTo(
      containerOffset + Math.min(0, audioOffset),
      6,
    );
    const canonical = await pulseSamples(path, 48000, CANONICAL_AUDIO_FILTER);
    const transcript = await pulseSamples(
      path,
      16000,
      SOURCE_CLOCK_AUDIO_FILTER,
    );
    expect(canonical.starts).toHaveLength(3);
    expect(transcript.starts).toHaveLength(3);
    for (const [index, time] of [0.6, 1, 1.6].entries()) {
      const expected = time + sourceOffset;
      expect(
        Math.abs(canonical.starts[index]! - expected * 48000),
      ).toBeLessThanOrEqual(1);
      const restored =
        transcript.starts[index]! + Math.round(sourceOffset * 16000);
      expect(Math.abs(restored - expected * 16000)).toBeLessThanOrEqual(1);
    }
    expect(canonical.length).toBe(Math.round((2 + sourceOffset) * 48000));
    expect(facts.lengthSamples).toBe(canonical.length);
    expect(await hashFile(path)).toBe(hash);
  },
);
