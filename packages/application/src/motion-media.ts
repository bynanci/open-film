// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { open, writeFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MediaAsset, ProjectSettings } from "@openfilm/core";
import {
  checkAbort,
  localPath,
  runProcess,
  localMediaInputOptions,
} from "@openfilm/media";
import { TimelineEditorError } from "./editor.js";
export const MOTION_BYTES = 64 * 1024 * 1024;
export const motionDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const bytesHash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
async function readMotionAssetInternal(
  asset: MediaAsset,
  maximum: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  checkAbort(signal);
  const path = localPath(asset.uri);
  await localMediaInputOptions(path, signal);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 8 || info.size > maximum)
      throw new TimelineEditorError(
        "Motion source exceeds the regular-file byte limit.",
        400,
      );
    const bytes = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < bytes.length) {
      checkAbort(signal);
      const read = await file.read(bytes, size, bytes.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (
      size !== info.size ||
      !asset.contentHash ||
      bytesHash(bytes.subarray(0, size)) !== asset.contentHash
    )
      throw new TimelineEditorError(
        "Motion source changed or has no verified hash. Reimport it.",
        409,
      );
    return new Uint8Array(bytes.subarray(0, size));
  } finally {
    await file.close();
  }
}
export interface MotionOutputProof {
  duration: number;
  frameRate: number;
  frames: number;
  width: number;
  height: number;
  codec: "h264";
  pixelFormat: "yuv420p";
  audioRemoved: boolean;
  inputColor: string;
  colorReview: "manual-required";
}
interface Stream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  nb_read_frames?: string;
  duration?: string;
  pix_fmt?: string;
  color_transfer?: string;
  color_primaries?: string;
  color_space?: string;
}
async function probe(path: string, signal?: AbortSignal, countFrames = true) {
  const result = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-max_alloc",
      "134217728",
      "-threads",
      "1",
      "-protocol_whitelist",
      "file",
      "-f",
      "mov",
      ...(countFrames ? ["-count_frames"] : []),
      "-show_entries",
      "stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,duration,pix_fmt,color_transfer,color_primaries,color_space:format=duration",
      "-of",
      "json",
      path,
    ],
    { signal, timeoutMs: 60000 },
  );
  return JSON.parse(result.stdout.toString()) as {
    streams: Stream[];
    format: { duration?: string };
  };
}
function videoSignature(bytes: Uint8Array) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 16 ||
    bytes.byteLength > MOTION_BYTES ||
    Buffer.from(bytes.subarray(4, 8)).toString() !== "ftyp"
  )
    throw new TimelineEditorError(
      "Motion candidates must be bounded self-contained MP4 bytes.",
      400,
    );
}
async function normalizeMotionInternal(
  bytes: Uint8Array,
  directory: string,
  settings: ProjectSettings,
  duration: number,
  signal?: AbortSignal,
): Promise<MotionOutputProof> {
  videoSignature(bytes);
  const raw = join(directory, "input.mp4"),
    output = join(directory, "preview.mp4");
  await writeFile(raw, bytes, { flag: "wx", mode: 0o600 });
  const source = await probe(raw, signal, false),
    streams = source.streams;
  const visuals = streams.filter((s) => s.codec_type === "video");
  const stream = visuals[0];
  const inputDuration = Number(source.format.duration);
  const [numerator, denominator] = (stream?.avg_frame_rate ?? "0/0")
    .split("/")
    .map(Number);
  const rate = numerator! / denominator!;
  if (
    !stream ||
    visuals.length !== 1 ||
    streams.some((s) => !["video", "audio"].includes(s.codec_type ?? "")) ||
    !["h264", "hevc", "mpeg4", "av1", "vp9"].includes(
      stream.codec_name ?? "",
    ) ||
    !Number.isFinite(inputDuration) ||
    inputDuration < duration - 0.001 ||
    inputDuration > 10 ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    rate > 60 ||
    ![
      "yuv420p",
      "yuvj420p",
      "yuv422p",
      "yuvj422p",
      "yuv444p",
      "yuvj444p",
      "nv12",
      "rgb24",
      "bgr24",
    ].includes(stream.pix_fmt ?? "") ||
    !stream.width ||
    !stream.height ||
    stream.width > 1920 ||
    stream.height > 1920 ||
    stream.width * stream.height > 1920 * 1080 ||
    /2020|2084|arib/.test(`${stream.color_primaries} ${stream.color_transfer}`)
  )
    throw new TimelineEditorError(
      "Unsupported motion duration, streams, SDR color, dimensions or frame rate.",
      400,
    );
  const frames = Math.round(duration * settings.frameRate);
  await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-max_alloc",
      "134217728",
      "-threads",
      "1",
      "-protocol_whitelist",
      "file",
      "-f",
      "mov",
      "-i",
      raw,
      "-map",
      "0:v:0",
      "-vf",
      `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${settings.frameRate}`,
      "-frames:v",
      String(frames),
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "1",
      "-movflags",
      "+faststart",
      "-fs",
      String(MOTION_BYTES),
      output,
    ],
    { signal, timeoutMs: 90000 },
  );
  checkAbort(signal);
  const measured = await probe(output, signal),
    picture = measured.streams[0];
  const [n, d] = (picture?.avg_frame_rate ?? "0/0").split("/").map(Number);
  if (
    (await stat(output)).size > MOTION_BYTES ||
    measured.streams.length !== 1 ||
    picture?.codec_type !== "video" ||
    picture.codec_name !== "h264" ||
    picture.pix_fmt !== "yuv420p" ||
    picture.width !== settings.width ||
    picture.height !== settings.height ||
    Number(picture.nb_read_frames) !== frames ||
    Math.abs(n! / d! - settings.frameRate) > 0.00001 ||
    Math.abs(Number(measured.format.duration) - duration) > 0.002
  )
    throw new TimelineEditorError(
      "Decoded motion output does not match fixed timeline timing.",
      409,
    );
  return {
    duration,
    frameRate: settings.frameRate,
    frames,
    width: settings.width,
    height: settings.height,
    codec: "h264",
    pixelFormat: "yuv420p",
    audioRemoved: streams.some((s) => s.codec_type === "audio"),
    inputColor: [
      stream.color_primaries ?? "unknown",
      stream.color_transfer ?? "unknown",
      stream.color_space ?? "unknown",
    ].join("/"),
    colorReview: "manual-required",
  };
}

async function validateMotionPhotoInternal(
  bytes: Uint8Array,
  directory: string,
  signal?: AbortSignal,
): Promise<void> {
  const png = Buffer.from(bytes.subarray(0, 8)).equals(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg)
    throw new TimelineEditorError("Motion photos must be local PNG/JPEG.", 400);
  const path = join(directory, "source.image");
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    const result = await runProcess(
      "ffprobe",
      [
        "-v",
        "error",
        "-max_alloc",
        "134217728",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file",
        "-f",
        png ? "png_pipe" : "jpeg_pipe",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        path,
      ],
      { signal, timeoutMs: 15000 },
    );
    const streams = JSON.parse(result.stdout.toString()).streams as {
      width: number;
      height: number;
    }[];
    const image = streams[0];
    if (
      streams.length !== 1 ||
      !image ||
      image.width <= 0 ||
      image.height <= 0 ||
      image.width > 4096 ||
      image.height > 4096 ||
      image.width * image.height > 16777216
    )
      throw new TimelineEditorError(
        "Motion photo dimensions exceed the safety limit.",
        400,
      );
  } finally {
    await rm(path, { force: true });
  }
}

async function safeMedia<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    checkAbort(signal);
    if (error instanceof TimelineEditorError) throw error;
    throw new TimelineEditorError(
      "Motion media validation failed. Check local source format and availability.",
      400,
    );
  }
}
export function readMotionAsset(
  asset: MediaAsset,
  maximum: number,
  signal?: AbortSignal,
) {
  return safeMedia(
    () => readMotionAssetInternal(asset, maximum, signal),
    signal,
  );
}
export function normalizeMotion(
  bytes: Uint8Array,
  directory: string,
  settings: ProjectSettings,
  duration: number,
  signal?: AbortSignal,
) {
  return safeMedia(
    () => normalizeMotionInternal(bytes, directory, settings, duration, signal),
    signal,
  );
}
export function validateMotionPhoto(
  bytes: Uint8Array,
  directory: string,
  signal?: AbortSignal,
) {
  return safeMedia(
    () => validateMotionPhotoInternal(bytes, directory, signal),
    signal,
  );
}
