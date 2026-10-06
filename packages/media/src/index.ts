import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { lstat, mkdir, readdir, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { MediaAsset } from "@openfilm/core";
import type {
  MediaCandidate as SourceCandidate,
  MediaMetadata,
  MediaSourceAdapter,
  OperationOptions,
} from "@openfilm/plugin-sdk";
import { resolveTimestamp } from "@openfilm/metadata";
import { probeColor, previewIssue, hdrToneMapFilter } from "./color.js";

export interface MediaCandidate extends SourceCandidate {
  path: string;
}
export interface ProcessOptions {
  signal?: AbortSignal;
  maxOutputBytes?: number;
  timeoutMs?: number;
  cwd?: string;
}
export interface ProcessOutput {
  stdout: Buffer;
  stderr: string;
}

export function abortError(): Error {
  return Object.assign(new Error("Operation cancelled"), {
    name: "AbortError",
  });
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** No shell interpolation. Every child is drained, timed out, and reaped on abort. */
export function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<ProcessOutput> {
  checkAbort(options.signal);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      cwd: options.cwd,
    });
    const output: Buffer[] = [];
    const diagnostics: Buffer[] = [];
    let bytes = 0;
    let stderrBytes = 0;
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => {
        child.kill("SIGKILL");
      }, 1500);
      killTimer.unref();
    };
    const abort = () => stop(abortError());
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(
      () => stop(new Error(`${command} exceeded its time limit`)),
      options.timeoutMs ?? 120000,
    );
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxOutputBytes ?? 8 * 1024 * 1024))
        stop(new Error(`${command} output exceeded its size limit`));
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes < 65536) diagnostics.push(chunk);
    });
    child.on("error", (error) => {
      failure ??= error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      const stderr = Buffer.concat(diagnostics).toString("utf8");
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new Error(`${command} exited ${code}: ${stderr.slice(-4000)}`));
      else resolvePromise({ stdout: Buffer.concat(output), stderr });
    });
  });
}

export function localPath(uri: string): string {
  if (!uri.startsWith("file:"))
    throw new Error("Only local file media references are supported");
  return fileURLToPath(uri);
}

const supported = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".avif",
  ".dng",
  ".insv",
  ".insp",
  ".mp4",
  ".mov",
  ".m4v",
  ".mkv",
  ".avi",
  ".webm",
  ".mts",
  ".m2ts",
  ".360",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
]);
const images = new Set([
  ".dng",
  ".insp",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".avif",
]);

export function isSupportedMediaFile(path: string): boolean {
  return supported.has(extname(path).toLowerCase());
}

export class FilesystemSource implements MediaSourceAdapter {
  readonly id = "openfilm.filesystem";
  supports(input: string | { uri?: string; path?: string }): boolean {
    return (
      typeof input === "string" ||
      typeof input.path === "string" ||
      Boolean(input.uri?.startsWith("file:"))
    );
  }

  async *discover(
    folder: string,
    signal?: AbortSignal,
  ): AsyncGenerator<MediaCandidate> {
    const requestedRoot = resolve(
      folder.startsWith("file:") ? localPath(folder) : folder,
    );
    const info = await lstat(requestedRoot);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error("Import source must be a directory, not a symlink");
    const root = await realpath(requestedRoot);
    // Depth first iterator stores directory names, never all source files or decoded media.
    const pending = [root];
    while (pending.length) {
      checkAbort(signal);
      const directory = pending.pop()!;
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        checkAbort(signal);
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile() && isSupportedMediaFile(entry.name)) {
          yield { path, uri: pathToFileURL(path).href, name: entry.name };
        }
      }
    }
  }

  async scan(
    input: string | { uri?: string; path?: string },
    options: OperationOptions = {},
  ): Promise<MediaCandidate[]> {
    const folder =
      typeof input === "string" ? input : (input.path ?? input.uri);
    if (!folder) throw new Error("Filesystem source requires a path");
    const result: MediaCandidate[] = [];
    for await (const candidate of this.discover(folder, options.signal)) {
      result.push(candidate);
      options.onProgress?.(result.length / (result.length + 1));
    }
    options.onProgress?.(1);
    return result;
  }

  async extractMetadata(
    candidate: SourceCandidate,
    options: OperationOptions = {},
  ): Promise<MediaMetadata> {
    const path =
      "path" in candidate && typeof candidate.path === "string"
        ? candidate.path
        : localPath(candidate.uri);
    const metadata: Partial<MediaAsset> = await inspectMedia(
      { ...candidate, path },
      options.signal,
    );
    for (const key of ["id", "uri", "name", "tags", "state"] as const)
      delete metadata[key];
    return metadata;
  }
}

let exifAvailable: boolean | undefined;
let exifCommand: { command: string; args: string[] } | undefined;
const require = createRequire(import.meta.url);

export async function extractExif(
  path: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (exifAvailable === false) return {};
  try {
    const command = exifCommand ?? { command: "exiftool", args: [] };
    let output: ProcessOutput;
    try {
      output = await runProcess(
        command.command,
        [...command.args, "-json", "-n", path],
        { signal },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || exifCommand)
        throw error;
      // The official vendored Perl distribution avoids requiring privileged apt.
      const script = join(
        dirname(require.resolve("exiftool-vendored.pl/package.json")),
        "bin",
        "exiftool",
      );
      exifCommand = { command: "perl", args: [script] };
      output = await runProcess("perl", [script, "-json", "-n", path], {
        signal,
      });
    }
    exifAvailable = true;
    return (
      (
        JSON.parse(output.stdout.toString("utf8")) as Record<string, unknown>[]
      )[0] ?? {}
    );
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    if (
      ["ENOENT", "MODULE_NOT_FOUND"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      exifAvailable = false;
    return { "openfilm.exiftool.warning": String(error) };
  }
}

export async function inspectMedia(
  candidate: MediaCandidate,
  signal?: AbortSignal,
): Promise<MediaAsset> {
  checkAbort(signal);
  const path = candidate.path;
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Source changed or is not a regular file");
  const probe = await runProcess(
    "ffprobe",
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", path],
    { signal },
  );
  const result = JSON.parse(probe.stdout.toString("utf8")) as {
    format?: {
      duration?: string;
      tags?: Record<string, unknown>;
      format_name?: string;
    };
    streams?: {
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      duration?: string;
      color_space?: string;
      disposition?: { attached_pic?: number };
      tags?: Record<string, unknown>;
    }[];
  };
  const audio = result.streams?.find((stream) => stream.codec_type === "audio");
  const video = result.streams?.find(
    (stream) =>
      stream.codec_type === "video" &&
      (!audio || stream.disposition?.attached_pic !== 1),
  );
  const color = probeColor(video);
  if (!video && !audio)
    throw new Error("No decodable image, video or audio stream was found");
  const exif = await extractExif(path, signal);
  const tags = {
    ...result.format?.tags,
    ...video?.tags,
    ...audio?.tags,
    ...exif,
  };
  const timestamp = resolveTimestamp(tags, info.mtime.toISOString());
  const mediaType = images.has(extname(path).toLowerCase())
    ? "image"
    : video
      ? extname(path).toLowerCase() === ".360"
        ? "360-video"
        : "video"
      : "audio";
  const duration = Number(
    result.format?.duration ?? video?.duration ?? audio?.duration,
  );
  const rate = video?.avg_frame_rate?.split("/").map(Number);
  const frameRate = rate && rate[1] ? rate[0]! / rate[1] : undefined;
  const latitude = Number(exif.GPSLatitude);
  const longitude = Number(exif.GPSLongitude);
  return {
    id: createHash("sha256").update(candidate.uri).digest("hex").slice(0, 32),
    uri: candidate.uri,
    name: candidate.name || basename(path),
    mediaType,
    ...(timestamp.timestamp
      ? {
          capturedAt: timestamp.timestamp,
          capturedAtSource: timestamp.source,
          capturedAtConfidence: timestamp.confidence,
        }
      : {}),
    ...(mediaType !== "image" && Number.isFinite(duration) && duration > 0
      ? { duration }
      : {}),
    ...(video?.width && video.height
      ? { dimensions: { width: video.width, height: video.height } }
      : {}),
    ...(frameRate && Number.isFinite(frameRate) ? { frameRate } : {}),
    ...(video?.codec_name || audio?.codec_name
      ? { codec: video?.codec_name ?? audio?.codec_name }
      : {}),
    ...(video?.color_space ? { colorSpace: video.color_space } : {}),
    ...(video ? { hdr: color.hdr } : {}),
    ...(exif.Make || exif.Model || exif.Software
      ? {
          source: {
            ...(typeof exif.Make === "string"
              ? { manufacturer: exif.Make }
              : {}),
            ...(typeof exif.Model === "string" ? { device: exif.Model } : {}),
            ...(typeof exif.Software === "string"
              ? { application: exif.Software }
              : {}),
          },
        }
      : {}),
    ...(timestamp.timezone ? { timezone: timestamp.timezone } : {}),
    ...(Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { gps: { latitude, longitude } }
      : {}),
    tags: [],
    state: {},
    metadata: {
      "openfilm.ffprobe": result,
      "openfilm.color": color,
      ...(color.hdr
        ? {
            "openfilm.preview": {
              supported: true,
              warnings: [
                "HDR source. SDR previews use tone mapping; original color metadata is preserved.",
              ],
            },
          }
        : {}),
      "openfilm.exif": exif,
      "openfilm.metadata.exiftoolAvailable": exifAvailable !== false,
      "openfilm.filesystem": {
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      },
      "openfilm.timestamp": timestamp,
    },
  };
}

export async function hashFile(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  checkAbort(signal);
  const hash = createHash("sha256");
  const stream = createReadStream(path, { signal });
  try {
    for await (const chunk of stream) hash.update(chunk as Buffer);
  } finally {
    stream.destroy();
  }
  return hash.digest("hex");
}

export async function perceptualHash(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const output = await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-threads",
      "1",
      "-filter_threads",
      "1",
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      "scale=8:8:flags=area,format=gray",
      "-threads",
      "1",
      "-f",
      "rawvideo",
      "-",
    ],
    { signal, maxOutputBytes: 1024 },
  );
  if (output.stdout.length !== 64)
    throw new Error("Cannot decode an 8×8 perceptual fingerprint");
  const average = output.stdout.reduce((sum, value) => sum + value, 0) / 64;
  let bits = 0n;
  for (const value of output.stdout)
    bits = (bits << 1n) | (value >= average ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

/** Cache files may never escape the project or traverse a symlink. */
export async function safeProjectCachePath(
  directory: string,
  ...segments: string[]
): Promise<string> {
  const projectRoot = await realpath(directory);
  const cacheRoot = join(projectRoot, "cache");
  const target = resolve(cacheRoot, ...segments);
  const rel = relative(cacheRoot, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
    throw new Error("Cache target must be a file inside this project cache");
  const components = ["cache", ...rel.split(sep)];
  let cursor = projectRoot;
  for (let index = 0; index < components.length; index++) {
    cursor = join(cursor, components[index]!);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink())
        throw new Error("Project cache cannot contain symlinks");
      if (index < components.length - 1 && !info.isDirectory())
        throw new Error("Cache parent must be a directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (index < components.length - 1) {
        try {
          await mkdir(cursor);
        } catch (creationError) {
          if ((creationError as NodeJS.ErrnoException).code !== "EEXIST")
            throw creationError;
        }
        const created = await lstat(cursor);
        if (created.isSymbolicLink() || !created.isDirectory())
          throw new Error(
            "Project cache cannot contain symlinks or non-directories",
            { cause: error },
          );
      }
    }
  }
  return target;
}

async function ensureDerivedOutput(
  asset: MediaAsset,
  output: string,
): Promise<void> {
  if (resolve(localPath(asset.uri)) === resolve(output))
    throw new Error("Derived output cannot overwrite source media");
  try {
    const target = await lstat(output);
    if (target.isSymbolicLink() || !target.isFile())
      throw new Error("Derived output must be a regular file");
    const source = await stat(localPath(asset.uri));
    if (target.dev === source.dev && target.ino === source.ino)
      throw new Error("Derived output aliases source media");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function createThumbnail(
  asset: MediaAsset,
  output: string,
  signal?: AbortSignal,
): Promise<void> {
  await ensureDerivedOutput(asset, output);
  if (asset.mediaType === "audio") return;
  const filters = await previewVideoFilters(asset, signal);
  await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-threads",
      "1",
      "-filter_threads",
      "1",
      "-i",
      localPath(asset.uri),
      "-frames:v",
      "1",
      "-vf",
      [...filters, "scale=480:320:force_original_aspect_ratio=decrease"].join(
        ",",
      ),
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      output,
    ],
    { signal },
  );
}

export async function createProxy(
  asset: MediaAsset,
  output: string,
  signal?: AbortSignal,
): Promise<void> {
  await ensureDerivedOutput(asset, output);
  if (asset.mediaType === "audio") {
    const issue = previewIssue(asset);
    if (issue) throw new Error(issue);
    await runProcess(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-threads",
        "1",
        "-i",
        localPath(asset.uri),
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-y",
        output,
      ],
      { signal, timeoutMs: 600000 },
    );
    return;
  }
  if (asset.mediaType !== "video" && asset.mediaType !== "360-video") return;
  const filters = await previewVideoFilters(asset, signal);
  await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-threads",
      "1",
      "-filter_threads",
      "1",
      "-i",
      localPath(asset.uri),
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      [
        ...filters,
        "scale=640:360:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2",
      ].join(","),
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-preset",
      "ultrafast",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-y",
      output,
    ],
    { signal, timeoutMs: 600000 },
  );
}

let hdrFiltersAvailable: boolean | undefined;
export async function previewVideoFilters(
  asset: MediaAsset,
  signal?: AbortSignal,
): Promise<string[]> {
  const issue = previewIssue(asset);
  if (issue) throw new Error(issue);
  const filter = hdrToneMapFilter(asset);
  if (!filter) return [];
  if (hdrFiltersAvailable === undefined) {
    const result = await runProcess("ffmpeg", ["-hide_banner", "-filters"], {
      signal,
    });
    const filters = result.stdout.toString("utf8");
    hdrFiltersAvailable =
      /\bzscale\b/.test(filters) && /\btonemap\b/.test(filters);
  }
  if (!hdrFiltersAvailable)
    throw new Error(
      `HDR preview for "${asset.name}" requires FFmpeg zscale and tonemap filters. Install a build with these filters or export an SDR copy.`,
    );
  return [filter];
}

export { probeColor, previewIssue, hdrToneMapFilter } from "./color.js";
export type { ColorMetadata } from "./color.js";

export { referenceFor, sourceStatus, planMediaRelink } from "./relink.js";
export type {
  PortableReference,
  SourceStatus,
  RelinkCandidate,
  RelinkMatch,
} from "./relink.js";

export {
  generateWaveform,
  detectScenes,
  WAVEFORM_CACHE_IDENTITY,
  sceneCacheIdentity,
} from "./intelligence.js";
export type { SceneDetectionOptions } from "./intelligence.js";
