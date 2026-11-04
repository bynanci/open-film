// SPDX-License-Identifier: Apache-2.0
import { lstat } from "node:fs/promises";
import {
  ApplicationError,
  MAX_AUDIO_ACTIVITY_DURATION_SECONDS,
  MAX_SILENCE_INTERVALS,
  validateAudioActivityEvidence,
  type AudioActivityEvidence,
  type MediaAsset,
} from "@openfilm/core";
import type { OperationOptions } from "@openfilm/plugin-sdk";
import { checkAbort, localPath } from "./index.js";
import { localMediaInputOptions } from "./input-policy.js";
import {
  probeSource,
  SOURCE_CLOCK_AUDIO_FILTER,
  streamFfmpeg,
} from "./intelligence.js";

const SAMPLE_RATE = 48_000;
const WINDOW_SAMPLES = 960;
const MAX_SECONDS = MAX_AUDIO_ACTIVITY_DURATION_SECONDS;
const MAX_INTERVALS = MAX_SILENCE_INTERVALS;

export interface AudioActivityOptions extends OperationOptions {
  /** Channel-maximum amplitude threshold in dBFS, from -80 to -10. */
  thresholdDb?: number;
  /** Minimum contiguous quiet time, from 0.1 to 30 source seconds. */
  minimumSilenceSeconds?: number;
}

export const AUDIO_ACTIVITY_IDENTITY = {
  providerId: "openfilm.ffmpeg-audio-activity",
  version: "1",
  model: "source-clock-channel-max-s16le-48000hz-20ms-v1",
} as const;

function bounded(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const result = value === undefined ? fallback : value;
  if (
    typeof result !== "number" ||
    !Number.isFinite(result) ||
    result < minimum ||
    result > maximum
  )
    throw new ApplicationError(
      "request.invalid",
      `${name} must be a finite number between ${minimum} and ${maximum}.`,
    );
  return result;
}

/**
 * Low-energy evidence, not speech detection. All channels must remain below
 * the threshold for a window to be quiet; opposite-phase stereo cannot cancel.
 * The application owns source verification and passes a private snapshot here.
 */
export async function analyzeAudioActivity(
  asset: MediaAsset,
  sourceHash: string,
  options: AudioActivityOptions = {},
): Promise<AudioActivityEvidence> {
  checkAbort(options.signal);
  const thresholdDb = bounded(
    options.thresholdDb,
    -40,
    -80,
    -10,
    "thresholdDb",
  );
  const minimumSilenceSeconds = bounded(
    options.minimumSilenceSeconds,
    0.5,
    0.1,
    30,
    "minimumSilenceSeconds",
  );
  if (!/^[0-9a-f]{64}$/i.test(sourceHash))
    throw new ApplicationError(
      "request.invalid",
      "A SHA-256 source hash is required.",
    );
  const path = localPath(asset.uri);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new ApplicationError(
      "media.unsupported",
      "Choose a regular local media file.",
      422,
    );
  const probe = await probeSource(path, options.signal);
  // Some containers report an absolute end timestamp as format.duration when
  // their start_time is nonzero. Subtracting start is not portable either.
  // Without an indexed normalized video clock, do not invent a silent tail.
  if (!Number.isFinite(probe.start) || Math.abs(probe.start) > 1 / SAMPLE_RATE)
    throw new ApplicationError(
      "media.unsupported",
      "Silence review requires a zero-based container clock. Create a normalized copy of this source first.",
      422,
    );
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  if (!audio)
    throw new ApplicationError(
      "media.unsupported",
      "This source has no audio stream.",
      422,
    );
  const channels = audio.channels;
  if (!channels || !Number.isInteger(channels) || channels < 1 || channels > 64)
    throw new ApplicationError(
      "media.unsupported",
      "Audio activity supports 1 to 64 channels.",
      422,
    );
  const offset = Math.max(
    0,
    Number(audio.start_time ?? probe.start) - probe.start,
  );
  if (
    !Number.isFinite(offset) ||
    offset > MAX_SECONDS ||
    probe.duration > MAX_SECONDS
  )
    throw new ApplicationError(
      "media.unsupported",
      "Audio activity is limited to 24 source hours.",
      422,
    );
  const leadingSamples = Math.round(offset * SAMPLE_RATE);
  const sourceSamples =
    Number.isFinite(probe.duration) && probe.duration > 0
      ? Math.round(probe.duration * SAMPLE_RATE)
      : 0;
  const threshold = 10 ** (thresholdDb / 20);
  const silenceIntervals: Array<{ start: number; end: number }> = [];
  let samples = leadingSamples;
  let decodedSamples = 0;
  let channel = 0;
  let carry: number | undefined;
  let windowStart = Math.floor(samples / WINDOW_SAMPLES) * WINDOW_SAMPLES;
  let peak = 0;
  // Complete silent windows before the audio stream starts, on the source clock.
  let silenceStart: number | undefined = windowStart > 0 ? 0 : undefined;
  let lastProgress = 0;
  const closeSilence = (end: number) => {
    if (
      silenceStart !== undefined &&
      (end - silenceStart) / SAMPLE_RATE + 1e-9 >= minimumSilenceSeconds
    ) {
      if (silenceIntervals.length === MAX_INTERVALS)
        throw new ApplicationError(
          "request.tooLarge",
          "Audio activity exceeds 2000 quiet intervals; increase the minimum silence duration.",
          413,
        );
      silenceIntervals.push({
        start: silenceStart / SAMPLE_RATE,
        end: end / SAMPLE_RATE,
      });
    }
    silenceStart = undefined;
  };
  const finishWindow = (end: number) => {
    if (peak < threshold) silenceStart ??= windowStart;
    else closeSilence(windowStart);
    windowStart = end;
    peak = 0;
  };
  const addSample = (value: number) => {
    peak = Math.max(peak, Math.abs(value) / 32768);
    if (++channel !== channels) return;
    channel = 0;
    samples++;
    decodedSamples++;
    if (samples > MAX_SECONDS * SAMPLE_RATE)
      throw new ApplicationError(
        "media.unsupported",
        "Decoded audio exceeds 24 source hours.",
        422,
      );
    if (samples % WINDOW_SAMPLES === 0) finishWindow(samples);
  };
  options.onProgress?.(0);
  await streamFfmpeg(
    [
      "-hide_banner",
      "-v",
      "error",
      // Some demuxers report a known full duration after the indexed payload
      // has been truncated. FFmpeg may otherwise exit zero after logging a
      // decode failure, causing the absent tail to be misclassified as silence.
      "-xerror",
      "-nostdin",
      "-threads",
      "1",
      ...(await localMediaInputOptions(path, options.signal)),
      "-i",
      path,
      "-map",
      `0:${audio.index}`,
      "-vn",
      "-sn",
      "-dn",
      "-af",
      SOURCE_CLOCK_AUDIO_FILTER,
      // Deliberately preserve channel count. A mono downmix can erase activity.
      "-ar",
      String(SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      "-f",
      "s16le",
      "pipe:1",
    ],
    options,
    (chunk) => {
      let index = 0;
      if (carry !== undefined && chunk.length) {
        const value = carry | (chunk[0]! << 8);
        addSample(value >= 32768 ? value - 65536 : value);
        carry = undefined;
        index = 1;
      }
      for (; index + 1 < chunk.length; index += 2)
        addSample(chunk.readInt16LE(index));
      if (index < chunk.length) carry = chunk[index];
      const progress =
        sourceSamples > 0
          ? Math.min(0.99, samples / sourceSamples)
          : Math.min(0.99, samples / (samples + SAMPLE_RATE));
      if (progress - lastProgress >= 0.01) {
        lastProgress = progress;
        options.onProgress?.(progress);
      }
    },
  ).catch((error: unknown) => {
    checkAbort(options.signal);
    if (error instanceof ApplicationError) throw error;
    if (error instanceof Error && error.message.startsWith("FFmpeg exited "))
      throw new ApplicationError(
        "media.unsupported",
        "FFmpeg could not fully decode this audio source.",
        422,
        { fileName: asset.name, reason: "decode-failed" },
        error.message,
      );
    throw error;
  });
  checkAbort(options.signal);
  if (carry !== undefined || channel !== 0 || decodedSamples === 0)
    throw new ApplicationError(
      "media.unsupported",
      "FFmpeg did not produce complete audio samples.",
      422,
    );
  const totalSamples = Math.max(samples, sourceSamples);
  // Process a partial non-silent window before extending the known silent tail.
  // The rest of that tail needs neither synthetic PCM nor a per-window loop.
  const nextBoundary =
    (Math.floor(samples / WINDOW_SAMPLES) + 1) * WINDOW_SAMPLES;
  if (
    totalSamples > samples &&
    samples % WINDOW_SAMPLES !== 0 &&
    nextBoundary <= totalSamples
  )
    finishWindow(nextBoundary);
  if (totalSamples > windowStart) finishWindow(totalSamples);
  closeSilence(totalSamples);
  const normalizedHash = sourceHash.toLowerCase();
  const evidence = validateAudioActivityEvidence({
    version: 1,
    assetId: asset.id,
    sourceHash: normalizedHash,
    duration: totalSamples / SAMPLE_RATE,
    sampleRate: SAMPLE_RATE,
    windowSeconds: WINDOW_SAMPLES / SAMPLE_RATE,
    audioStreamIndex: audio.index,
    parameters: { thresholdDb, minimumSilenceSeconds },
    silenceIntervals,
    provenance: {
      ...AUDIO_ACTIVITY_IDENTITY,
      sourceHash: normalizedHash,
      createdAt: new Date().toISOString(),
    },
  });
  options.onProgress?.(1);
  return evidence;
}
