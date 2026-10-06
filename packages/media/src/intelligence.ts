import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import {
  ApplicationError,
  type AnalysisProvenance,
  type MediaAsset,
  type SceneAnalysis,
  type TimelineMarker,
  type WaveformData,
} from "@openfilm/core";
import type { OperationOptions } from "@openfilm/plugin-sdk";
import { abortError, checkAbort, localPath, runProcess } from "./index.js";

const PCM_RATE = 8_000;
const INITIAL_BUCKET_SAMPLES = PCM_RATE / 50;
const MAX_PEAKS = 20_000;
const MAX_MARKERS = 20_000;
const MAX_DIAGNOSTIC_BYTES = 65_536;
type AnalysisKind = "waveform" | "scene";

/** Shared with cache readers so algorithm changes invalidate prior results. */
export const WAVEFORM_CACHE_IDENTITY = {
  providerId: "openfilm.ffmpeg-waveform",
  version: "1",
  model: "source-clock-channel-max-s16le-8000hz-max-20000-peaks",
} as const;

export function sceneCacheIdentity(threshold = 0.3) {
  return {
    providerId: "openfilm.ffmpeg-scenes",
    version: "1",
    model: `source-clock-scene-score-${threshold}-width-320`,
  } as const;
}

export interface SceneDetectionOptions extends OperationOptions {
  /** FFmpeg scene score in [0, 1]; higher values select stronger changes. */
  threshold?: number;
}

function failure(
  kind: AnalysisKind,
  asset: MediaAsset,
  reason: string,
  detail: string,
): ApplicationError {
  return new ApplicationError(
    kind === "waveform" ? "media.waveformFailed" : "media.sceneFailed",
    `${kind === "waveform" ? "Waveform generation" : "Scene detection"} failed for ${asset.name}: ${detail}`,
    422,
    { fileName: asset.name, reason },
    detail,
  );
}
function rethrow(error: unknown, kind: AnalysisKind, asset: MediaAsset): never {
  if (
    error instanceof ApplicationError ||
    (error instanceof Error && error.name === "AbortError")
  )
    throw error;
  throw failure(
    kind,
    asset,
    "decode-failed",
    error instanceof Error ? error.message : String(error),
  );
}
function provenance(
  identity: Pick<AnalysisProvenance, "providerId" | "version" | "model">,
  sourceHash: string,
): AnalysisProvenance {
  return {
    ...identity,
    sourceHash,
    createdAt: new Date().toISOString(),
  };
}

async function sourcePath(
  asset: MediaAsset,
  sourceHash: string,
  kind: AnalysisKind,
  signal?: AbortSignal,
): Promise<string> {
  checkAbort(signal);
  if (!sourceHash.trim())
    throw failure(kind, asset, "invalid-source", "A source hash is required.");
  let path: string;
  try {
    path = localPath(asset.uri);
  } catch {
    throw failure(kind, asset, "invalid-source", "Choose a local media file.");
  }
  try {
    const info = await lstat(path);
    checkAbort(signal);
    if (!info.isFile() || info.isSymbolicLink())
      throw failure(
        kind,
        asset,
        "invalid-source",
        "The media source must be a regular file, not a directory or symlink.",
      );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR")
      throw new ApplicationError(
        "media.missing",
        `Source file ${asset.name} is missing. Reconnect its drive or find the file.`,
        404,
        { fileName: asset.name },
      );
    throw error;
  }
  return path;
}

type ProbeStream = {
  index: number;
  codec_type?: string;
  duration?: string;
  start_time?: string;
  channels?: number;
  disposition?: { attached_pic?: number };
};
async function probeSource(path: string, signal?: AbortSignal) {
  const output = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-show_entries",
      "format=duration,start_time:stream=index,codec_type,duration,start_time,channels:stream_disposition=attached_pic",
      "-of",
      "json",
      path,
    ],
    { signal, maxOutputBytes: 1024 * 1024 },
  );
  const value = JSON.parse(output.stdout.toString("utf8")) as {
    format?: { duration?: string; start_time?: string };
    streams?: ProbeStream[];
  };
  return {
    streams: (value.streams ?? []).filter(
      (stream) => Number.isInteger(stream.index) && stream.index >= 0,
    ),
    duration: Number(value.format?.duration),
    start: Number(value.format?.start_time ?? 0),
  };
}

/** Drain both pipes with bounded diagnostics; decoded PCM is consumed, never buffered. */
function streamFfmpeg(
  args: string[],
  options: OperationOptions,
  stdout: (chunk: Buffer) => void,
  stderr?: (chunk: Buffer) => void,
): Promise<void> {
  checkAbort(options.signal);
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let diagnostic = Buffer.alloc(0);
    let failed: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error) => {
      failed ??= error;
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 1500);
      killTimer.unref();
    };
    const abort = () => stop(abortError());
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(
      () =>
        stop(new Error("FFmpeg analysis exceeded its one-hour time limit.")),
      60 * 60 * 1000,
    );
    timer.unref();
    const consume = (callback: (chunk: Buffer) => void, chunk: Buffer) => {
      if (failed) return;
      try {
        callback(chunk);
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
      }
    };
    child.stdout.on("data", (chunk: Buffer) => consume(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostic = Buffer.concat([diagnostic, chunk]).subarray(
        -MAX_DIAGNOSTIC_BYTES,
      );
      if (stderr) consume(stderr, chunk);
    });
    child.on("error", (error) => {
      failed ??= error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      if (failed) reject(failed);
      else if (code !== 0)
        reject(
          new Error(
            `FFmpeg exited ${code}: ${diagnostic.toString("utf8").slice(-4000)}`,
          ),
        );
      else resolve();
    });
  });
}

/** Channel-maximum peaks at 50 buckets/second; adaptively halved for long sources. */
export async function generateWaveform(
  asset: MediaAsset,
  sourceHash: string,
  options: OperationOptions = {},
): Promise<WaveformData> {
  try {
    const path = await sourcePath(
      asset,
      sourceHash,
      "waveform",
      options.signal,
    );
    const probe = await probeSource(path, options.signal);
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    if (!audio)
      throw failure(
        "waveform",
        asset,
        "no-audio",
        "This source has no audio stream.",
      );
    const channels = audio.channels;
    if (
      !channels ||
      !Number.isInteger(channels) ||
      channels < 1 ||
      channels > 64
    )
      throw failure(
        "waveform",
        asset,
        "unsupported-audio",
        "Waveforms support audio with 1 to 64 channels.",
      );
    options.onProgress?.(0);
    const peaks = new Float32Array(MAX_PEAKS);
    const offset = Math.max(
      0,
      Number(audio.start_time ?? probe.start) - probe.start,
    );
    const leadingSamples = Number.isFinite(offset)
      ? Math.round(offset * PCM_RATE)
      : 0;
    const sourceSamples =
      Number.isFinite(probe.duration) && probe.duration > 0
        ? Math.round(probe.duration * PCM_RATE)
        : 0;
    if (
      !Number.isSafeInteger(leadingSamples) ||
      !Number.isSafeInteger(sourceSamples)
    )
      throw failure(
        "waveform",
        asset,
        "invalid-duration",
        "The source duration is outside the supported range.",
      );
    let samples = leadingSamples;
    let decodedSamples = 0;
    let channel = 0;
    let bucketSamples = INITIAL_BUCKET_SAMPLES;
    let size = 0;
    let carry: number | undefined;
    let lastProgress = 0;
    const bucketFor = (sample: number) => {
      let bucket = Math.floor(sample / bucketSamples);
      while (bucket >= MAX_PEAKS) {
        for (let index = 0; index < MAX_PEAKS / 2; index++)
          peaks[index] = Math.max(peaks[index * 2]!, peaks[index * 2 + 1]!);
        peaks.fill(0, MAX_PEAKS / 2);
        size = Math.ceil(size / 2);
        bucketSamples *= 2;
        bucket = Math.floor(sample / bucketSamples);
      }
      return bucket;
    };
    const addSample = (value: number) => {
      const bucket = bucketFor(samples);
      peaks[bucket] = Math.max(peaks[bucket]!, Math.abs(value) / 32768);
      size = Math.max(size, bucket + 1);
      if (++channel === channels) {
        channel = 0;
        samples++;
        decodedSamples++;
      }
    };
    await streamFfmpeg(
      [
        "-hide_banner",
        "-v",
        "error",
        "-nostdin",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        path,
        "-map",
        `0:${audio.index}`,
        "-vn",
        "-sn",
        "-dn",
        // Keep packet gaps on the source clock while the leading offset is
        // represented by zero bins above. Raw PCM otherwise loses timestamps.
        "-af",
        "asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0",
        "-ar",
        String(PCM_RATE),
        "-c:a",
        "pcm_s16le",
        "-f",
        "s16le",
        "pipe:1",
      ],
      options,
      (chunk) => {
        let offset = 0;
        if (carry !== undefined && chunk.length) {
          const value = carry | (chunk[0]! << 8);
          addSample(value >= 32768 ? value - 65536 : value);
          carry = undefined;
          offset = 1;
        }
        for (; offset + 1 < chunk.length; offset += 2)
          addSample(chunk.readInt16LE(offset));
        if (offset < chunk.length) carry = chunk[offset];
        const duration = samples / PCM_RATE;
        const progress =
          Number.isFinite(probe.duration) && probe.duration > 0
            ? Math.min(0.99, duration / probe.duration)
            : duration / (duration + 1);
        if (progress - lastProgress >= 0.01) {
          lastProgress = progress;
          options.onProgress?.(progress);
        }
      },
    );
    checkAbort(options.signal);
    if (carry !== undefined || channel !== 0 || decodedSamples === 0)
      throw failure(
        "waveform",
        asset,
        "empty-audio",
        "FFmpeg did not produce complete audio samples.",
      );
    // Silent lead/tail intervals are represented as zero bins without decoding
    // or allocating synthetic PCM for the rest of a video's source timeline.
    samples = Math.max(samples, sourceSamples);
    const finalBucket = bucketFor(samples - 1);
    size = Math.max(size, finalBucket + 1);
    options.onProgress?.(1);
    return {
      assetId: asset.id,
      duration: samples / PCM_RATE,
      sampleRate: PCM_RATE / bucketSamples,
      peaks: Array.from(peaks.subarray(0, size)),
      provenance: provenance(WAVEFORM_CACHE_IDENTITY, sourceHash),
    };
  } catch (error) {
    rethrow(error, "waveform", asset);
  }
}

function lineConsumer(consume: (line: string) => void) {
  let pending = "";
  return (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      consume(pending.slice(0, newline).trim());
      pending = pending.slice(newline + 1);
    }
    if (pending.length > MAX_DIAGNOSTIC_BYTES)
      throw new Error("FFmpeg emitted an oversized metadata line.");
  };
}

/** Detect hard visual changes; timestamps stay in the original source time domain. */
export async function detectScenes(
  asset: MediaAsset,
  sourceHash: string,
  options: SceneDetectionOptions = {},
): Promise<SceneAnalysis> {
  try {
    const threshold = options.threshold ?? 0.3;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
      throw failure(
        "scene",
        asset,
        "invalid-threshold",
        "Scene threshold must be between 0 and 1.",
      );
    const path = await sourcePath(asset, sourceHash, "scene", options.signal);
    const probe = await probeSource(path, options.signal);
    const video = probe.streams.find(
      (stream) =>
        stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
    );
    if (!video || asset.mediaType === "image")
      throw failure(
        "scene",
        asset,
        "no-video",
        "Choose a video source for scene detection.",
      );
    options.onProgress?.(0);
    const markers: TimelineMarker[] = [];
    let time: number | undefined;
    let lastProgress = 0;
    const reportProgress = (seconds: number) => {
      if (!(probe.duration > 0) || !Number.isFinite(probe.duration)) return;
      const value = Math.min(0.99, seconds / probe.duration);
      if (value - lastProgress >= 0.01) {
        lastProgress = value;
        options.onProgress?.(value);
      }
      checkAbort(options.signal);
    };
    const metadata = lineConsumer((line) => {
      const timestamp = /\bpts_time:([-+\d.eE]+)/u.exec(line);
      if (timestamp) time = Number(timestamp[1]);
      const score = /^lavfi\.scene_score=([-+\d.eE]+)/u.exec(line);
      if (!score) return;
      const confidence = Number(score[1]);
      if (
        time === undefined ||
        !Number.isFinite(time) ||
        time < 0 ||
        !Number.isFinite(confidence)
      )
        throw new Error("FFmpeg emitted invalid scene timing or confidence.");
      if (time === 0 || markers.at(-1)?.time === time) return;
      reportProgress(time);
      if (markers.length >= MAX_MARKERS)
        throw failure(
          "scene",
          asset,
          "marker-limit",
          "The source exceeds the 20,000 scene-marker limit.",
        );
      markers.push({
        id: createHash("sha256")
          .update(`${asset.id}\0${sourceHash}\0${threshold}\0${time}`)
          .digest("hex")
          .slice(0, 32),
        assetId: asset.id,
        time,
        type: "scene-cut",
        confidence: Math.min(1, Math.max(0, confidence)),
        metadata: { threshold, detector: "ffmpeg-scene", analysisWidth: 320 },
      });
    });
    const progress = lineConsumer((line) => {
      const match = /^out_time_us=(\d+)$/u.exec(line);
      if (match) reportProgress(Number(match[1]) / 1_000_000);
    });
    await streamFfmpeg(
      [
        "-hide_banner",
        "-v",
        "error",
        "-nostdin",
        "-threads",
        "1",
        "-filter_threads",
        "1",
        "-progress",
        "pipe:2",
        "-nostats",
        "-copyts",
        "-start_at_zero",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        path,
        "-map",
        `0:${video.index}`,
        "-vf",
        `scale=w='min(320,iw)':h=-2,select='gt(scene,${threshold})',metadata=print:key=lavfi.scene_score:file=-`,
        "-an",
        "-sn",
        "-dn",
        "-fps_mode",
        "passthrough",
        "-f",
        "null",
        "-",
      ],
      options,
      metadata,
      progress,
    );
    checkAbort(options.signal);
    options.onProgress?.(1);
    return {
      assetId: asset.id,
      markers,
      provenance: provenance(sceneCacheIdentity(threshold), sourceHash),
    };
  } catch (error) {
    rethrow(error, "scene", asset);
  }
}
