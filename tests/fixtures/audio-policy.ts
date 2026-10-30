// Deterministic synthetic local audio; no user media or dependencies.
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { hashFile, runProcess } from "@openfilm/media";
import type { MediaAsset } from "@openfilm/core";
export async function toneSource(
  root: string,
  name: string,
  frequency: number,
  duration = 12,
  sampleRate = 48000,
  channels = 2,
  impulse: boolean | readonly number[] = false,
): Promise<MediaAsset> {
  const samples = Math.round(duration * sampleRate),
    bytes = Buffer.alloc(samples * channels * 3),
    header = Buffer.alloc(44),
    impulses = new Set(impulse === true ? [0] : impulse || []);
  for (let sample = 0; sample < samples; sample++) {
    const value = Math.round(
      (impulse
        ? impulses.has(sample)
          ? 0.1
          : 0
        : 0.1 * Math.cos((2 * Math.PI * frequency * sample) / sampleRate)) *
        8388607,
    );
    for (let channel = 0; channel < channels; channel++)
      bytes.writeIntLE(value, (sample * channels + channel) * 3, 3);
  }
  header.write("RIFF");
  header.writeUInt32LE(36 + bytes.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 3, 28);
  header.writeUInt16LE(channels * 3, 32);
  header.writeUInt16LE(24, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes.length, 40);
  const path = join(root, `${name}.wav`);
  await writeFile(path, Buffer.concat([header, bytes]));
  return {
    id: name,
    name,
    uri: pathToFileURL(path).href,
    mediaType: "audio",
    duration,
    contentHash: await hashFile(path),
    tags: [],
    state: {},
    metadata: {},
  };
}
export async function decodePolicyAudio(
  path: string,
): Promise<{ samples: Float32Array; sha256: string }> {
  const result = await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-threads",
      "1",
      "-i",
      path,
      "-map",
      "0:a:0",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "f32le",
      "-",
    ],
    { maxOutputBytes: 32 * 1024 * 1024 },
  );
  const samples = new Float32Array(result.stdout.length / 4);
  for (let i = 0; i < samples.length; i++)
    samples[i] = result.stdout.readFloatLE(i * 4);
  return {
    samples,
    sha256: createHash("sha256").update(result.stdout).digest("hex"),
  };
}
export function spectralAmplitude(
  pcm: Float32Array,
  frequency: number,
  start: number,
  duration = 0.2,
): number {
  const first = Math.round(start * 48000),
    length = Math.round(duration * 48000);
  let sin = 0,
    cos = 0;
  for (let i = 0; i < length; i++) {
    const phase = (2 * Math.PI * frequency * i) / 48000,
      value = pcm[(first + i) * 2] ?? 0;
    sin += value * Math.sin(phase);
    cos += value * Math.cos(phase);
  }
  return (2 * Math.hypot(sin, cos)) / length;
}
export function firstAudibleSample(
  pcm: Float32Array,
  startSample = 0,
  endSample = pcm.length / 2,
): number {
  for (let i = startSample; i < endSample; i++)
    if (Math.abs(pcm[i * 2] ?? 0) > 1e-6) return i;
  return -1;
}
export async function policyManifest(paths: string[]) {
  return Promise.all(
    paths.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
  );
}
