import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  validateSceneAnalysis,
  validateWaveformData,
  type MediaAsset,
} from "@openfilm/core";
import {
  detectScenes,
  generateWaveform,
  hashFile,
  runProcess,
} from "../src/index.js";

let root: string;
function asset(name: string, mediaType: MediaAsset["mediaType"]): MediaAsset {
  return {
    id: name,
    name,
    uri: pathToFileURL(join(root, name)).href,
    mediaType,
    tags: [],
    state: {},
    metadata: {},
  };
}
async function audio(name: string, duration: number) {
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=0.5:s=8000:d=${duration}`,
    "-c:a",
    "pcm_s16le",
    "-threads",
    "1",
    "-y",
    join(root, name),
  ]);
}
async function scenes(name: string, frameRate: string, duration: number) {
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-nostdin",
    ...["red", "blue", "green"].flatMap((color) => [
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=96x64:r=${frameRate}:d=${duration}`,
    ]),
    "-filter_complex_threads",
    "1",
    "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map",
    "[v]",
    "-c:v",
    "ffv1",
    "-threads",
    "1",
    "-y",
    join(root, name),
  ]);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-intelligence-"));
  await audio("short # & 回憶.wav", 1.017);
  await audio("long.wav", 405);
  await audio("longer.wav", 905);
  await scenes("cuts.mkv", "24", 1);
  await scenes("fractional.mkv", "30000/1001", 1.001);
  await writeFile(join(root, "malformed.wav"), "not an audio file");
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("local streaming waveform analysis", () => {
  it("preserves decoded duration and a partial last bucket without touching originals", async () => {
    const name = "short # & 回憶.wav";
    const hash = await hashFile(join(root, name));
    const progress: number[] = [];
    const result = await generateWaveform(
      { ...asset(name, "audio"), duration: 999 },
      hash,
      { onProgress: (value) => progress.push(value) },
    );
    expect(validateWaveformData(result)).toEqual(result);
    expect(result.duration).toBeCloseTo(1.017, 4);
    expect(result.sampleRate).toBe(50);
    expect(result.peaks).toHaveLength(51);
    expect(result.peaks.every((value) => Math.abs(value - 0.5) < 0.0001)).toBe(
      true,
    );
    expect(result.provenance).toMatchObject({
      providerId: "openfilm.ffmpeg-waveform",
      version: "1",
      sourceHash: hash,
    });
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(await hashFile(join(root, name))).toBe(hash);
  });

  it.each([
    ["long.wav", 405, 25],
    ["longer.wav", 905, 12.5],
  ] as const)(
    "bounds peaks for %s across many pipe chunks",
    async (name, duration, rate) => {
      expect((await stat(join(root, name))).size).toBeGreaterThan(6_000_000);
      const progress: number[] = [];
      const result = await generateWaveform(
        asset(name, "audio"),
        "known-source",
        {
          onProgress: (value) => progress.push(value),
        },
      );
      expect(result.duration).toBe(duration);
      expect(result.sampleRate).toBe(rate);
      expect(result.peaks).toHaveLength(Math.ceil(duration * rate));
      expect(result.peaks.length).toBeLessThanOrEqual(20_000);
      expect(result.peaks.every((peak) => peak === 0.5)).toBe(true);
      expect(progress.length).toBeGreaterThan(5);
      expect(progress.at(-1)).toBe(1);
      expect(validateWaveformData(result)).toEqual(result);
    },
  );

  it("keeps silence and negative full-scale samples in their original time buckets", async () => {
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(lt(t\\,0.2)\\,0\\,if(lt(t\\,0.6)\\,0.5\\,-1)):s=8000:d=1",
      "-c:a",
      "pcm_s16le",
      "-threads",
      "1",
      "-y",
      join(root, "levels.wav"),
    ]);
    const result = await generateWaveform(
      asset("levels.wav", "audio"),
      "levels-source",
    );
    expect(result.peaks.slice(0, 10)).toEqual(Array(10).fill(0));
    expect(result.peaks.slice(10, 30)).toEqual(Array(20).fill(0.5));
    expect(result.peaks.slice(30)).toEqual(Array(20).fill(1));
  });

  it("keeps delayed audio aligned with video and preserves a silent tail", async () => {
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=96x64:r=24:d=3",
      "-itsoffset",
      "1",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.5:s=8000:d=1",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "ffv1",
      "-c:a",
      "pcm_s16le",
      "-threads",
      "1",
      "-y",
      join(root, "delayed.mkv"),
    ]);
    const waveform = await generateWaveform(
      asset("delayed.mkv", "video"),
      "delayed-source",
    );
    expect(waveform.duration).toBe(3);
    expect(waveform.peaks.slice(0, 50)).toEqual(Array(50).fill(0));
    expect(waveform.peaks.slice(50, 100)).toEqual(Array(50).fill(0.5));
    expect(waveform.peaks.slice(100)).toEqual(Array(50).fill(0));
  });

  it("keeps opposite-polarity stereo audible instead of cancelling it in a mono mix", async () => {
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.5|-0.5:s=8000:d=1",
      "-c:a",
      "pcm_s16le",
      "-threads",
      "1",
      "-y",
      join(root, "stereo.wav"),
    ]);
    const waveform = await generateWaveform(
      asset("stereo.wav", "audio"),
      "stereo-source",
    );
    expect(waveform.duration).toBe(1);
    expect(waveform.peaks).toEqual(Array(50).fill(0.5));
  });

  it("keeps internal packet gaps silent without moving resumed audio earlier", async () => {
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=96x64:r=24:d=3",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.5:s=8000:d=3",
      "-filter:a",
      "asetnsamples=n=80,aselect=not(between(t\\,1\\,1.99))",
      "-c:v",
      "ffv1",
      "-c:a",
      "pcm_s16le",
      "-threads",
      "1",
      "-y",
      join(root, "packet-gap.mkv"),
    ]);
    const waveform = await generateWaveform(
      asset("packet-gap.mkv", "video"),
      "packet-gap-source",
    );
    expect(waveform.duration).toBe(3);
    expect(waveform.peaks.slice(20, 30)).toEqual(Array(10).fill(0.5));
    expect(waveform.peaks.slice(70, 80)).toEqual(Array(10).fill(0));
    expect(waveform.peaks.slice(120, 130)).toEqual(Array(10).fill(0.5));
  });

  it("rejects cancellation before spawn and during decoded output without cache artifacts", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      generateWaveform(asset("longer.wav", "audio"), "source", {
        signal: cancelled.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const files = await readdir(root);
    const running = new AbortController();
    await expect(
      generateWaveform(asset("longer.wav", "audio"), "source", {
        signal: running.signal,
        onProgress: (value) => {
          if (value > 0 && value < 1) running.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(root)).toEqual(files);
  });
});

describe("FFmpeg scene detection", () => {
  it("returns exact red/blue/green cuts and repeatable marker identities", async () => {
    const source = asset("cuts.mkv", "video");
    const hash = await hashFile(join(root, source.name));
    const result = await detectScenes(source, hash);
    expect(result.markers.map((marker) => marker.time)).toEqual([1, 2]);
    expect(
      result.markers.every(
        (marker) => marker.type === "scene-cut" && marker.confidence! > 0.3,
      ),
    ).toBe(true);
    expect(validateSceneAnalysis(result, { duration: 3 })).toEqual(result);
    expect((await detectScenes(source, hash)).markers).toEqual(result.markers);
    expect(result.provenance).toMatchObject({
      providerId: "openfilm.ffmpeg-scenes",
      version: "1",
      sourceHash: hash,
    });
    expect(await hashFile(join(root, source.name))).toBe(hash);
  });

  it("preserves fractional-frame source timing and allows a valid no-cuts result", async () => {
    const result = await detectScenes(
      asset("fractional.mkv", "video"),
      "fractional-source",
    );
    expect(result.markers.map((marker) => marker.time)).toEqual([1.001, 2.002]);
    const none = await detectScenes(asset("cuts.mkv", "video"), "source", {
      threshold: 1,
    });
    expect(none.markers).toEqual([]);
    expect(validateSceneAnalysis(none)).toEqual(none);
  });

  it("cancels a running scene process and does not write sidecar files", async () => {
    const files = await readdir(root);
    const controller = new AbortController();
    await expect(
      detectScenes(asset("cuts.mkv", "video"), "source", {
        signal: controller.signal,
        onProgress: (value) => {
          if (value > 0 && value < 1) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(root)).toEqual(files);
  });
});

describe("actionable analysis failures", () => {
  it("distinguishes missing media, absent streams, invalid requests, and malformed sources", async () => {
    await expect(
      generateWaveform(asset("missing.wav", "audio"), "source"),
    ).rejects.toMatchObject({ code: "media.missing" });
    await expect(
      detectScenes(asset("missing.mkv", "video"), "source"),
    ).rejects.toMatchObject({ code: "media.missing" });
    await expect(
      generateWaveform(asset("cuts.mkv", "video"), "source"),
    ).rejects.toMatchObject({
      code: "media.waveformFailed",
      params: { reason: "no-audio" },
    });
    await expect(
      detectScenes(asset("short # & 回憶.wav", "audio"), "source"),
    ).rejects.toMatchObject({
      code: "media.sceneFailed",
      params: { reason: "no-video" },
    });
    for (const analyze of [generateWaveform, detectScenes]) {
      await expect(
        analyze(asset("malformed.wav", "video"), "source"),
      ).rejects.toMatchObject({ params: { reason: "decode-failed" } });
      await expect(
        analyze(
          {
            ...asset("remote", "video"),
            uri: "https://example.invalid/media.mp4",
          },
          "source",
        ),
      ).rejects.toMatchObject({ params: { reason: "invalid-source" } });
    }
    await expect(
      generateWaveform(asset("long.wav", "audio"), ""),
    ).rejects.toMatchObject({ params: { reason: "invalid-source" } });
    for (const threshold of [-1, 1.1, NaN, Infinity])
      await expect(
        detectScenes(asset("cuts.mkv", "video"), "source", { threshold }),
      ).rejects.toMatchObject({
        code: "media.sceneFailed",
        params: { reason: "invalid-threshold" },
      });
  });
});
