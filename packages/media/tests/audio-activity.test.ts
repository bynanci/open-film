// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { analyzeAudioActivity, hashFile, runProcess } from "../src/index.js";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-activity-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function wav(
  name: string,
  duration: number,
  channels: number,
  value: (seconds: number, channel: number) => number,
): Promise<MediaAsset> {
  const rate = 48_000;
  const frames = Math.round(duration * rate);
  const dataBytes = frames * channels * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame++)
    for (let channel = 0; channel < channels; channel++)
      buffer.writeInt16LE(
        Math.max(
          -32768,
          Math.min(32767, Math.round(value(frame / rate, channel) * 32768)),
        ),
        44 + (frame * channels + channel) * 2,
      );
  await writeFile(join(root, name), buffer);
  return media(name, "audio");
}

async function media(
  name: string,
  mediaType: MediaAsset["mediaType"],
): Promise<MediaAsset> {
  return {
    id: name,
    name,
    uri: pathToFileURL(join(root, name)).href,
    mediaType,
    contentHash: await hashFile(join(root, name)),
    tags: [],
    state: {},
    metadata: {},
  };
}

describe("source-clock audio activity", () => {
  it("rejects a container whose advertised audio tail is truncated", async () => {
    const completeName = "truncated-source-complete.mp4";
    const truncatedName = "truncated-source.mp4";
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000:duration=5",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-y",
      join(root, completeName),
    ]);
    const complete = await readFile(join(root, completeName));
    let offset = 0;
    let mediaOffset = -1;
    let mediaSize = 0;
    while (offset + 8 <= complete.length) {
      let size = complete.readUInt32BE(offset);
      const type = complete.toString("ascii", offset + 4, offset + 8);
      if (size === 1) size = Number(complete.readBigUInt64BE(offset + 8));
      if (type === "mdat") {
        mediaOffset = offset;
        mediaSize = size;
        break;
      }
      if (size < 8) throw new Error("Invalid MP4 box size.");
      offset += size;
    }
    if (mediaOffset < 0 || mediaSize < 8)
      throw new Error("The generated MP4 has no media data box.");
    await writeFile(
      join(root, truncatedName),
      complete.subarray(0, mediaOffset + Math.floor(mediaSize * 0.25)),
    );
    const source = await media(truncatedName, "audio");

    await expect(
      analyzeAudioActivity(source, source.contentHash!),
    ).rejects.toMatchObject({ code: "media.unsupported", status: 422 });
  });

  it("finds leading, internal and partial trailing quiet ranges without changing the source", async () => {
    const source = await wav("pause # 回憶.wav", 4.013, 1, (t) =>
      (t >= 0.5 && t < 1.5) || (t >= 2.5 && t < 3.5) ? 0.5 : 0,
    );
    const progress: number[] = [];
    const result = await analyzeAudioActivity(
      { ...source, duration: 999 },
      source.contentHash!,
      {
        minimumSilenceSeconds: 0.3,
        onProgress: (v) => progress.push(v),
      },
    );
    expect(result.silenceIntervals).toEqual([
      { start: 0, end: 0.5 },
      { start: 1.5, end: 2.5 },
      { start: 3.5, end: 4.013 },
    ]);
    expect(result.duration).toBe(4.013);
    expect(result.sampleRate).toBe(48_000);
    expect(result.provenance.sourceHash).toBe(source.contentHash);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(await hashFile(join(root, source.name))).toBe(source.contentHash);
  });

  it("does not erase opposite-phase stereo or sound in a single channel", async () => {
    for (const [name, value] of [
      [
        "opposite.wav",
        (_t: number, channel: number) => (channel === 0 ? 0.5 : -0.5),
      ],
      [
        "one-channel.wav",
        (_t: number, channel: number) => (channel === 0 ? 0 : 0.5),
      ],
    ] as const) {
      const source = await wav(name, 2, 2, value);
      expect(
        (await analyzeAudioActivity(source, source.contentHash!))
          .silenceIntervals,
      ).toEqual([]);
    }
  });

  it("keeps audible high-frequency content instead of treating an 8 kHz tone as silence", async () => {
    const source = await wav(
      "high-frequency.wav",
      1,
      1,
      (t) => 0.5 * Math.sin(2 * Math.PI * 8000 * t),
    );
    expect(
      (await analyzeAudioActivity(source, source.contentHash!))
        .silenceIntervals,
    ).toEqual([]);
  });

  it("uses the requested threshold and minimum duration, including all-quiet sources", async () => {
    const source = await wav("low-energy.wav", 2, 1, () => 0.004);
    expect(
      (
        await analyzeAudioActivity(source, source.contentHash!, {
          thresholdDb: -40,
        })
      ).silenceIntervals,
    ).toEqual([{ start: 0, end: 2 }]);
    expect(
      (
        await analyzeAudioActivity(source, source.contentHash!, {
          thresholdDb: -60,
        })
      ).silenceIntervals,
    ).toEqual([]);
    const short = await wav("short-pause.wav", 1, 1, (t) =>
      t >= 0.4 && t < 0.6 ? 0 : 0.5,
    );
    expect(
      (await analyzeAudioActivity(short, short.contentHash!)).silenceIntervals,
    ).toEqual([]);
    expect(
      (
        await analyzeAudioActivity(short, short.contentHash!, {
          minimumSilenceSeconds: 0.1,
        })
      ).silenceIntervals,
    ).toEqual([{ start: 0.4, end: 0.6 }]);
  });

  it("preserves source-clock packet gaps and resumed audio positions", async () => {
    const name = "packet-gap.mkv";
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=96x64:r=25:d=3",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.5:s=48000:d=3",
      "-filter:a",
      "asetnsamples=n=480,aselect=not(between(t\\,1\\,1.99))",
      "-c:v",
      "ffv1",
      "-c:a",
      "pcm_s16le",
      "-threads",
      "1",
      "-y",
      join(root, name),
    ]);
    const source = await media(name, "video");
    const result = await analyzeAudioActivity(source, source.contentHash!);
    expect(result.duration).toBe(3);
    expect(result.silenceIntervals).toEqual([{ start: 1, end: 2 }]);
  });

  it("retains delayed audio and the known silent tail on a video's clock", async () => {
    const name = "delayed.mkv";
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=96x64:r=25:d=3",
      "-itsoffset",
      "0.5",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.5:s=48000:d=1",
      "-c:v",
      "ffv1",
      "-c:a",
      "pcm_s16le",
      "-threads",
      "1",
      "-y",
      join(root, name),
    ]);
    const source = await media(name, "video");
    const result = await analyzeAudioActivity(source, source.contentHash!, {
      minimumSilenceSeconds: 0.2,
    });
    expect(result.duration).toBe(3);
    expect(result.silenceIntervals[0]).toEqual({ start: 0, end: 0.5 });
    expect(result.silenceIntervals[1]?.start).toBeCloseTo(1.5, 1);
    expect(result.silenceIntervals[1]?.end).toBe(3);
  });

  it("rejects invalid parameters before reading media and supports cancellation without sidecars", async () => {
    const source = await wav("cancel.wav", 20, 2, () => 0.5);
    for (const options of [
      { thresholdDb: NaN },
      { thresholdDb: -81 },
      { thresholdDb: 0 },
      { minimumSilenceSeconds: 0 },
      { minimumSilenceSeconds: 31 },
    ])
      await expect(
        analyzeAudioActivity(source, source.contentHash!, options),
      ).rejects.toMatchObject({ code: "request.invalid" });
    const before = await readdir(root);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      analyzeAudioActivity(source, source.contentHash!, {
        signal: cancelled.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const running = new AbortController();
    await expect(
      analyzeAudioActivity(source, source.contentHash!, {
        signal: running.signal,
        onProgress: (p) => {
          if (p > 0 && p < 1) running.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(root)).toEqual(before);
  });

  it("rejects audio-less media instead of proposing removal of the entire visual source", async () => {
    const name = "no-audio.mkv";
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=96x64:r=25:d=1",
      "-c:v",
      "ffv1",
      "-threads",
      "1",
      "-y",
      join(root, name),
    ]);
    const source = await media(name, "video");
    await expect(
      analyzeAudioActivity(source, source.contentHash!),
    ).rejects.toMatchObject({ code: "media.unsupported" });
  });

  it("rejects ambiguous nonzero container clocks instead of inventing a long silent tail", async () => {
    const name = "offset-clock.mkv";
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=96x64:r=25:d=3",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.5:s=48000:d=3",
      "-c:v",
      "ffv1",
      "-c:a",
      "pcm_s16le",
      "-output_ts_offset",
      "10",
      "-threads",
      "1",
      "-y",
      join(root, name),
    ]);
    const source = await media(name, "video");
    await expect(
      analyzeAudioActivity(source, source.contentHash!),
    ).rejects.toMatchObject({
      code: "media.unsupported",
      status: 422,
    });
  });
});
