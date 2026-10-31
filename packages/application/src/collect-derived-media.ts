// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { lstat, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  ApplicationError,
  graphicSceneAssetIds,
  resolveClipSourceRange,
  frameAlignedDuration,
  projectFrameRate,
  type CollectCoverageEntry,
  type CollectDeliveryOptionsV1,
  type MediaAsset,
  type OpenFilmProject,
} from "@openfilm/core";
import {
  createProxy,
  hashFile,
  inspectMedia,
  localMediaInputOptions,
  runProcess,
} from "@openfilm/media";
import { FFmpegRenderer, type RenderOptions } from "@openfilm/render";

export interface CollectClockWindow {
  sourceStart: number;
  sourceEnd: number;
  derivedStart: number;
  derivedEnd: number;
}
export interface CollectDerivativeReceipt {
  version: 1;
  assetId: string;
  originalSha256: string;
  derivedSha256: string;
  sourceDuration: number;
  derivedDuration: number;
  recipe: "ffv1-pcm-v1" | "preview-v1";
  quality: "lossless" | "offline-only";
  windows: CollectClockWindow[];
}
export interface CollectDecodedSignature {
  videoSha256: string;
  videoFrames: number;
  duration: number;
  audioSha256?: string;
}
export interface CollectParityReceipt {
  compositionId: string;
  matched: boolean;
  original: CollectDecodedSignature;
  derived: CollectDecodedSignature;
}
function fail(message: string): never {
  throw new ApplicationError("export.failed", message, 422);
}
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const processOptions = (signal?: AbortSignal) => ({
  signal,
  timeoutMs: 600_000,
  maxOutputBytes: 8 * 1024 * 1024,
});
interface Stream {
  codec_type?: string;
  start_time?: string;
  duration?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  sample_fmt?: string;
  channels?: number;
  width?: number;
  height?: number;
  pix_fmt?: string;
  sample_aspect_ratio?: string;
  color_transfer?: string;
  side_data_list?: unknown[];
  tags?: Record<string, unknown>;
}
async function probe(path: string, signal?: AbortSignal) {
  const result = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      ...(await localMediaInputOptions(path, signal)),
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path,
    ],
    processOptions(signal),
  );
  return JSON.parse(result.stdout.toString("utf8")) as {
    streams: Stream[];
    format: { duration: string };
  };
}
function rate(text: string | undefined) {
  const parts = text?.split("/").map(Number);
  return parts?.length === 2 && parts[1]! > 0 ? parts[0]! / parts[1]! : NaN;
}
/** This first recipe admits measured CFR, zero-origin SDR clocks only. Other
 * sources remain complete originals rather than acquiring guessed timestamps. */
export async function createCollectDerivative(
  asset: MediaAsset,
  sourcePath: string,
  outputPath: string,
  entry: CollectCoverageEntry,
  options: CollectDeliveryOptionsV1,
  signal?: AbortSignal,
): Promise<
  | { asset: MediaAsset; receipt: CollectDerivativeReceipt; size: number }
  | { retainedReason: string }
> {
  if (entry.action === "copy-original")
    return { retainedReason: "source.protected" };
  const inspected = await probe(sourcePath, signal);
  const video = inspected.streams.filter((s) => s.codec_type === "video"),
    audio = inspected.streams.filter((s) => s.codec_type === "audio");
  const pcmCodecs: Record<string, string> = {
    u8: "pcm_u8",
    u8p: "pcm_u8",
    s16: "pcm_s16le",
    s16p: "pcm_s16le",
    s32: "pcm_s32le",
    s32p: "pcm_s32le",
    flt: "pcm_f32le",
    fltp: "pcm_f32le",
    dbl: "pcm_f64le",
    dblp: "pcm_f64le",
  };
  const pcmCodec = pcmCodecs[audio[0]?.sample_fmt ?? ""];
  const duration = Number(asset.duration),
    fps = rate(video[0]?.avg_frame_rate),
    sampleRate = Number(audio[0]?.sample_rate);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 600 ||
    audio.length > 1 ||
    video.length > 1 ||
    inspected.streams.some(
      (s) =>
        !["video", "audio"].includes(s.codec_type ?? "") ||
        Math.abs(Number(s.start_time ?? 0)) > 1e-6,
    ) ||
    (video.length &&
      (!Number.isFinite(fps) ||
        fps < 1 ||
        fps > 120 ||
        Math.abs(fps - rate(video[0]?.r_frame_rate)) > 1e-7 ||
        video[0]!.width! > 4096 ||
        video[0]!.height! > 2160 ||
        asset.hdr ||
        video[0]!.pix_fmt !== "yuv420p" ||
        ![undefined, "1:1", "N/A"].includes(video[0]!.sample_aspect_ratio) ||
        video[0]!.side_data_list?.length ||
        video[0]!.tags?.rotate)) ||
    (audio.length &&
      (!pcmCodec ||
        ![1, 2].includes(audio[0]?.channels ?? 0) ||
        !Number.isSafeInteger(sampleRate) ||
        sampleRate < 8000 ||
        sampleRate > 192000))
  )
    return { retainedReason: "source.clock-unsupported" };
  if (video.length) {
    const measured = await runProcess(
      "ffprobe",
      [
        "-v",
        "error",
        ...(await localMediaInputOptions(sourcePath, signal)),
        "-select_streams",
        "v:0",
        "-show_entries",
        "frame=best_effort_timestamp_time",
        "-of",
        "csv=p=0",
        sourcePath,
      ],
      processOptions(signal),
    );
    const times = measured.stdout
      .toString("utf8")
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => Number(line.split(",")[0]));
    if (
      !times.length ||
      times.length > 36_000 ||
      times.some(
        (time, n) => !Number.isFinite(time) || Math.abs(time - n / fps) > 2e-6,
      ) ||
      Math.abs(times.length / fps - duration) > 1e-6
    )
      return { retainedReason: "source.clock-unsupported" };
  }
  const quantum = video.length ? fps : sampleRate;
  const ranges: { start: number; end: number }[] = [];
  for (const range of entry.ranges) {
    const next = {
      start: Math.max(0, Math.floor(range.start * quantum + 1e-7) / quantum),
      end: Math.min(duration, Math.ceil(range.end * quantum - 1e-7) / quantum),
    };
    if (
      audio.length &&
      [next.start, next.end].some(
        (t) => Math.abs(t * sampleRate - Math.round(t * sampleRate)) > 1e-5,
      )
    )
      return { retainedReason: "source.clock-unsupported" };
    const previous = ranges.at(-1);
    if (previous && previous.end >= next.start)
      previous.end = Math.max(previous.end, next.end);
    else ranges.push(next);
  }
  if (!ranges.length || ranges.length > 128)
    return { retainedReason: "source.clock-unsupported" };
  let offset = 0;
  const windows = ranges.map((range) => {
    const start = offset;
    offset += range.end - range.start;
    return {
      sourceStart: range.start,
      sourceEnd: range.end,
      derivedStart: start,
      derivedEnd: offset,
    };
  });
  const source = { ...asset, uri: pathToFileURL(sourcePath).href };
  if (options.mode === "offline-proxies") {
    await createProxy(source, outputPath, signal, { maximumBytes: MAX_BYTES });
  } else {
    const filters: string[] = [],
      labels: string[] = [];
    for (const [index, window] of windows.entries()) {
      if (video.length)
        filters.push(
          `[0:v:0]trim=start=${window.sourceStart}:end=${window.sourceEnd},setpts=PTS-STARTPTS[v${index}]`,
        );
      if (audio.length)
        filters.push(
          `[0:a:0]atrim=start_sample=${Math.round(window.sourceStart * sampleRate)}:end_sample=${Math.round(window.sourceEnd * sampleRate)},asetpts=PTS-STARTPTS[a${index}]`,
        );
      labels.push(
        `${video.length ? `[v${index}]` : ""}${audio.length ? `[a${index}]` : ""}`,
      );
    }
    filters.push(
      `${labels.join("")}concat=n=${windows.length}:v=${video.length}:a=${audio.length}${video.length ? "[v]" : ""}${audio.length ? "[a]" : ""}`,
    );
    await runProcess(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-xerror",
        "-threads",
        "1",
        ...(await localMediaInputOptions(sourcePath, signal)),
        "-i",
        sourcePath,
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        filters.join(";"),
        ...(video.length
          ? [
              "-map",
              "[v]",
              "-c:v",
              "ffv1",
              "-level",
              "3",
              "-g",
              "1",
              "-threads",
              "1",
              "-r",
              video[0]!.avg_frame_rate!,
              "-fps_mode",
              "cfr",
            ]
          : []),
        ...(audio.length ? ["-map", "[a]", "-c:a", pcmCodec!] : []),
        "-map_metadata",
        "-1",
        "-fs",
        String(MAX_BYTES),
        "-f",
        video.length ? "avi" : "wav",
        "-n",
        outputPath,
      ],
      processOptions(signal),
    );
  }
  const info = await lstat(outputPath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size <= 0 ||
    info.size >= MAX_BYTES
  )
    fail("Derived media exceeded its private output bound.");
  const derived = await inspectMedia(
    { path: outputPath, uri: pathToFileURL(outputPath).href, name: asset.name },
    signal,
  );
  const expected = options.mode === "offline-proxies" ? duration : offset;
  if (
    !derived.duration ||
    Math.abs(derived.duration - expected) > (video.length ? 1 / fps : 0.05)
  )
    fail("Derived media did not preserve its measured source windows.");
  if (options.mode === "trimmed-originals") {
    // A lossy MP4 comparison cannot establish native source losslessness.
    // Independently compare all retained decoded pixels and native-precision
    // samples, including handles outside the final film, before saying lossless.
    for (const kind of ["video", "audio"] as const) {
      if (kind === "video" ? !video.length : !audio.length) continue;
      const original = await retainedHash(
        sourcePath,
        kind,
        windows.map((w) => ({ start: w.sourceStart, end: w.sourceEnd })),
        sampleRate,
        pcmCodec,
        signal,
      );
      const delivered = await retainedHash(
        outputPath,
        kind,
        [{ start: 0, end: offset }],
        sampleRate,
        pcmCodec,
        signal,
      );
      if (original !== delivered)
        fail(
          "Derived source windows failed native-precision decoded pixel/sample parity.",
        );
    }
  }
  return {
    asset: {
      ...asset,
      codec: derived.codec,
      duration: expected,
      dimensions: derived.dimensions,
      frameRate: derived.frameRate,
      hdr: derived.hdr,
      colorSpace: derived.colorSpace,
      metadata: {
        ...asset.metadata,
        "openfilm.ffprobe":
          asset.metadata["openfilm.ffprobe"] === undefined
            ? undefined
            : derived.metadata["openfilm.ffprobe"],
        "openfilm.color": derived.metadata["openfilm.color"],
        "openfilm.collectDelivery": {
          version: 1,
          mode: options.mode,
          originalSha256: entry.sourceHash,
          quality:
            options.mode === "offline-proxies" ? "offline-only" : "lossless",
        },
      },
    },
    size: info.size,
    receipt: {
      version: 1,
      assetId: asset.id,
      originalSha256: entry.sourceHash!,
      derivedSha256: await hashFile(outputPath, signal),
      sourceDuration: duration,
      derivedDuration: expected,
      recipe: options.mode === "offline-proxies" ? "preview-v1" : "ffv1-pcm-v1",
      quality: options.mode === "offline-proxies" ? "offline-only" : "lossless",
      windows,
    },
  };
}

async function retainedHash(
  path: string,
  kind: "video" | "audio",
  windows: { start: number; end: number }[],
  sampleRate: number,
  pcmCodec: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const audio = kind === "audio",
    prefix = audio ? "a" : "v",
    filters = windows.map((w, index) =>
      audio
        ? `[0:a:0]atrim=start_sample=${Math.round(w.start * sampleRate)}:end_sample=${Math.round(w.end * sampleRate)},asetpts=PTS-STARTPTS[part${index}]`
        : `[0:v:0]trim=start=${w.start}:end=${w.end},setpts=PTS-STARTPTS[part${index}]`,
    );
  filters.push(
    `${windows.map((_, index) => `[part${index}]`).join("")}concat=n=${windows.length}:v=${audio ? 0 : 1}:a=${audio ? 1 : 0}[kept]`,
  );
  const result = await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-threads",
      "1",
      ...(await localMediaInputOptions(path, signal)),
      "-i",
      path,
      "-filter_complex_threads",
      "1",
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[kept]",
      `-c:${prefix}`,
      audio ? pcmCodec! : "rawvideo",
      "-threads",
      "1",
      ...(audio ? ["-vn"] : ["-an", "-fps_mode", "passthrough"]),
      "-f",
      "hash",
      "-hash",
      "sha256",
      "-",
    ],
    processOptions(signal),
  );
  const hash = /SHA256=([a-f0-9]{64})/u.exec(
    result.stdout.toString("utf8"),
  )?.[1];
  if (!hash) fail("Derived sources require complete native decoded evidence.");
  return hash;
}

export const COLLECT_PRIVATE_RENDER_BYTES = MAX_BYTES;
export function assertCollectRenderBudget(project: OpenFilmProject): void {
  if (
    project.timelines.length > 100 ||
    project.timelines.some((c) => c.duration > 300) ||
    project.settings.width > 1920 ||
    project.settings.height > 1080 ||
    projectFrameRate(project.settings) > 60
  )
    throw new ApplicationError(
      "request.tooLarge",
      "Derived Collect validation supports at most 100 five-minute 1080p/60 Compositions per package.",
      413,
    );
}

/** Rewrite source clocks only in the private portable capture. */
export function remapCollectProject(
  project: OpenFilmProject,
  assets: readonly MediaAsset[],
  receipts: readonly CollectDerivativeReceipt[],
): OpenFilmProject {
  const result = structuredClone(project),
    assetMap = new Map(assets.map((a) => [a.id, a])),
    maps = new Map(receipts.map((r) => [r.assetId, r]));
  for (const composition of result.timelines) {
    for (const track of composition.tracks)
      for (const clip of track.clips) {
        if (clip.audioTiming && maps.has(clip.assetId))
          fail("An independent sound source clock cannot be rewritten.");
        if (
          clip.userOverrides?.isUserPinned &&
          [
            clip.assetId,
            ...(clip.layout?.secondary ? [clip.layout.secondary.assetId] : []),
          ].some((id) => maps.has(id))
        )
          fail("A user pinned source clock cannot be rewritten.");
      }
    for (const scene of composition.graphicScenes ?? [])
      if (
        scene.userOverrides?.isUserPinned &&
        graphicSceneAssetIds([scene]).some((id) => maps.has(id))
      )
        fail("A user pinned scene dependency cannot be remapped.");
  }
  for (const composition of result.timelines)
    for (const track of composition.tracks)
      for (const clip of track.clips) {
        const mapping = maps.get(clip.assetId);
        if (!mapping || clip.title) continue;
        const range = resolveClipSourceRange(clip, assetMap.get(clip.assetId)!);
        const window = mapping.windows.find(
          (w) =>
            range.sourceIn >= w.sourceStart - 1e-8 &&
            range.sourceOut <= w.sourceEnd + 1e-8,
        );
        if (!window || clip.locked)
          fail("A protected or unmapped source clock cannot be rewritten.");
        clip.sourceIn =
          range.sourceIn - window.sourceStart + window.derivedStart;
        clip.sourceOut =
          range.sourceOut - window.sourceStart + window.derivedStart;
      }
  return result;
}

export async function collectDecodedSignature(
  path: string,
  signal?: AbortSignal,
): Promise<CollectDecodedSignature> {
  const inspected = await probe(path, signal);
  const frames = await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-threads",
      "1",
      ...(await localMediaInputOptions(path, signal)),
      "-i",
      path,
      "-map",
      "0:v:0",
      "-an",
      "-f",
      "framehash",
      "-hash",
      "sha256",
      "-",
    ],
    processOptions(signal),
  );
  const rows = frames.stdout
    .toString("utf8")
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#"));
  if (!rows.length) fail("Collect parity requires decoded video frames.");
  const signature: CollectDecodedSignature = {
    videoSha256: createHash("sha256").update(rows.join("\n")).digest("hex"),
    videoFrames: rows.length,
    duration: Number(inspected.format.duration),
  };
  if (inspected.streams.some((s) => s.codec_type === "audio")) {
    const audio = await runProcess(
      "ffmpeg",
      [
        "-v",
        "error",
        "-threads",
        "1",
        ...(await localMediaInputOptions(path, signal)),
        "-i",
        path,
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        "pcm_f32le",
        "-f",
        "hash",
        "-hash",
        "sha256",
        "-",
      ],
      processOptions(signal),
    );
    const match = /SHA256=([a-f0-9]{64})/u.exec(audio.stdout.toString("utf8"));
    if (!match) fail("Collect parity requires decoded audio samples.");
    signature.audioSha256 = match![1]!;
  }
  return signature;
}

export async function renderCollectParity(
  original: OpenFilmProject,
  derived: OpenFilmProject,
  originalAssets: MediaAsset[],
  derivedAssets: MediaAsset[],
  work: string,
  options: RenderOptions = {},
): Promise<CollectParityReceipt[]> {
  options = { ...options, maximumOutputBytes: MAX_BYTES };
  const result: CollectParityReceipt[] = [];
  const renderer = new FFmpegRenderer();
  for (const [index, composition] of original.timelines.entries()) {
    const before = `${work}/original-${index}.mp4`,
      after = `${work}/derived-${index}.mp4`;
    await renderer.render(
      composition,
      originalAssets,
      before,
      original.settings,
      options,
    );
    await renderer.render(
      derived.timelines[index]!,
      derivedAssets,
      after,
      derived.settings,
      options,
    );
    const a = await collectDecodedSignature(before, options.signal),
      b = await collectDecodedSignature(after, options.signal);
    const expectedFrames = Math.round(
      frameAlignedDuration(
        composition.duration,
        projectFrameRate(original.settings),
      ) * projectFrameRate(original.settings),
    );
    if (
      a.videoFrames !== expectedFrames ||
      b.videoFrames !== expectedFrames ||
      a.duration !== b.duration
    )
      fail("Collect delivery did not preserve the complete Composition clock.");
    await rm(before);
    await rm(`${before}.manifest.json`);
    await rm(after);
    await rm(`${after}.manifest.json`);
    result.push({
      compositionId: composition.id,
      matched: JSON.stringify(a) === JSON.stringify(b),
      original: a,
      derived: b,
    });
  }
  return result;
}
