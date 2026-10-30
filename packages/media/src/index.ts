// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { Dir, Dirent } from "node:fs";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { lstat, mkdir, opendir, realpath, stat } from "node:fs/promises";
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
import { assetDisplayDimensions, type MediaAsset } from "@openfilm/core";
import type {
  MediaCandidate as SourceCandidate,
  MediaMetadata,
  MediaSourceAdapter,
  MediaSourceAdapterV2,
  OperationOptions,
  SourceInput,
} from "@openfilm/plugin-sdk";
import { resolveTimestamp } from "@openfilm/metadata";
import { probeColor, previewIssue, hdrToneMapFilter } from "./color.js";
import { localMediaInputOptions } from "./input-policy.js";
import { withVerifiedSourceFile } from "./verified-source.js";
export { withVerifiedSourceFile } from "./verified-source.js";
export {
  LOCAL_MEDIA_DEMUXERS,
  localMediaInputOptions,
} from "./input-policy.js";

export interface MediaCandidate extends SourceCandidate {
  path: string;
}
type FilesystemSourceInput = {
  uri?: string;
  path?: string;
  type?: SourceInput["type"];
  options?: Record<string, unknown>;
};
export interface ProcessOptions {
  signal?: AbortSignal;
  maxOutputBytes?: number;
  timeoutMs?: number;
  cwd?: string;
  onStdout?: (chunk: Buffer) => void;
}
export interface ProcessOutput {
  stdout: Buffer;
  stderr: string;
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
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
      else {
        output.push(chunk);
        try {
          options.onStdout?.(chunk);
        } catch {
          /* Progress observers cannot change the child process outcome. */
        }
      }
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

export class FilesystemSource
  implements MediaSourceAdapter, MediaSourceAdapterV2
{
  readonly id = "openfilm.filesystem";
  supports(input: string | FilesystemSourceInput): boolean {
    return (
      typeof input === "string" ||
      typeof input.path === "string" ||
      Boolean(input.uri?.startsWith("file:"))
    );
  }

  async *discover(
    input: string | FilesystemSourceInput,
    optionsOrSignal: OperationOptions | AbortSignal = {},
  ): AsyncGenerator<MediaCandidate> {
    const options =
      "aborted" in optionsOrSignal
        ? { signal: optionsOrSignal }
        : optionsOrSignal;
    const signal = options.signal;
    const source = typeof input === "string" ? undefined : input;
    const sourcePath =
      typeof input === "string" ? input : (input.path ?? input.uri);
    if (!sourcePath) throw new Error("Filesystem source requires a path");
    const requestedRoot = resolve(
      sourcePath.startsWith("file:") ? localPath(sourcePath) : sourcePath,
    );
    const info = await lstat(requestedRoot);
    if (info.isSymbolicLink())
      throw new Error("Import sources cannot be symlinks");
    const sourceType = source?.type;
    if (sourceType === "file" || info.isFile()) {
      if (!info.isFile() || !isSupportedMediaFile(requestedRoot))
        throw new Error(
          "Selected source is not a supported regular media file",
        );
      checkAbort(signal);
      yield {
        path: requestedRoot,
        uri: pathToFileURL(requestedRoot).href,
        name: basename(requestedRoot),
        relativePath: basename(requestedRoot),
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      };
      return;
    }
    if (!info.isDirectory())
      throw new Error("Import source must be a regular file or directory");
    const root = await realpath(requestedRoot);
    const recursive =
      typeof input === "string" || source?.options?.recursive !== false;
    const stack: Array<{
      directory: Dir;
      iterator: AsyncIterator<Dirent>;
      path: string;
      depth: number;
    }> = [];
    const openDirectory = async (path: string, depth: number) => {
      if (depth > 128)
        throw new Error(
          "Filesystem source nesting exceeds the safe depth limit",
        );
      const directory = await opendir(path, { bufferSize: 32 });
      stack.push({
        directory,
        iterator: directory[Symbol.asyncIterator](),
        path,
        depth,
      });
    };
    try {
      await openDirectory(root, 0);
      while (stack.length) {
        checkAbort(signal);
        const current = stack.at(-1)!;
        const next = await current.iterator.next();
        if (next.done) {
          stack.pop();
          await current.directory.close().catch(() => undefined);
          continue;
        }
        const entry = next.value;
        const path = join(current.path, entry.name);
        const relativePath = relative(root, path).split(sep).join("/");
        if (entry.isSymbolicLink()) {
          options.onSkipped?.({ reason: "symlink", relativePath });
          continue;
        }
        if (entry.isDirectory()) {
          if (recursive) {
            const directoryInfo = await lstat(path);
            if (
              directoryInfo.isSymbolicLink() ||
              !directoryInfo.isDirectory()
            ) {
              options.onSkipped?.({ reason: "symlink", relativePath });
              continue;
            }
            const actual = await realpath(path);
            if (!isPathInside(root, actual)) {
              options.onSkipped?.({ reason: "outside-root", relativePath });
              continue;
            }
            await openDirectory(path, current.depth + 1);
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const fileInfo = await lstat(path);
        if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) {
          options.onSkipped?.({ reason: "symlink", relativePath });
          continue;
        }
        if (!isSupportedMediaFile(path)) {
          options.onSkipped?.({ reason: "unsupported", relativePath });
          continue;
        }
        const actual = await realpath(path);
        if (!isPathInside(root, actual)) {
          options.onSkipped?.({ reason: "outside-root", relativePath });
          continue;
        }
        yield {
          path,
          uri: pathToFileURL(path).href,
          name: entry.name,
          relativePath,
          size: fileInfo.size,
          modifiedAt: fileInfo.mtime.toISOString(),
        };
      }
    } finally {
      await Promise.all(
        stack.map(async ({ directory }) =>
          directory.close().catch(() => undefined),
        ),
      );
    }
  }

  async scan(
    input: string | FilesystemSourceInput,
    options: OperationOptions = {},
  ): Promise<MediaCandidate[]> {
    const result: MediaCandidate[] = [];
    for await (const candidate of this.discover(input, options)) {
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
  const exif = await extractExif(path, signal);
  const orientation = Number(exif.Orientation);
  const inspectImageFrame =
    images.has(extname(path).toLowerCase()) &&
    !(Number.isInteger(orientation) && orientation >= 1 && orientation <= 8);
  const probe = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      ...(await localMediaInputOptions(path, signal)),
      "-show_format",
      "-show_streams",
      ...(inspectImageFrame
        ? [
            "-show_frames",
            "-read_intervals",
            "%+#1",
            "-show_entries",
            // Keep stream/format sections explicit alongside the bounded frame
            // projection; import needs their media type, dimensions and tags.
            "format:stream:frame=width,height,sample_aspect_ratio:frame_tags=Orientation:frame_side_data=rotation",
          ]
        : []),
      "-of",
      "json",
      path,
    ],
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
  const asset: MediaAsset = {
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
  if (mediaType === "image") {
    const display = assetDisplayDimensions(asset);
    if (display)
      asset.metadata["openfilm.display"] = { version: 1, ...display };
  }
  return asset;
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
      ...(await localMediaInputOptions(path, signal)),
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
      ...(await localMediaInputOptions(localPath(asset.uri), signal)),
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

export interface RepresentativeFrameBytes {
  bytes: Uint8Array;
  mimeType: "image/jpeg";
  width: 640;
  height: 360;
}

/** Deterministic, bounded JPEG sample for review providers; never returns a URI. */
export async function extractRepresentativeFrame(
  asset: MediaAsset,
  sourceTimeSeconds: number,
  signal?: AbortSignal,
): Promise<RepresentativeFrameBytes> {
  return (
    await extractRepresentativeFrames(asset, [sourceTimeSeconds], signal)
  )[0]!;
}

/** One private verified source snapshot for at most three bounded samples. */
export async function extractRepresentativeFrames(
  asset: MediaAsset,
  sourceTimes: readonly number[],
  signal?: AbortSignal,
): Promise<RepresentativeFrameBytes[]> {
  if (
    asset.mediaType === "audio" ||
    !sourceTimes.length ||
    sourceTimes.length > 3 ||
    sourceTimes.some((time) => !Number.isFinite(time) || time < 0)
  )
    throw new Error(
      "Representative frames require a visual asset and nonnegative source time.",
    );
  if (
    asset.duration !== undefined &&
    sourceTimes.some((time) => time > asset.duration!)
  )
    throw new Error(
      "Representative frame time is outside the source duration.",
    );
  return withVerifiedSourceFile(
    localPath(asset.uri),
    asset.contentHash,
    async (snapshot) => {
      const verifiedAsset = { ...asset, uri: pathToFileURL(snapshot).href };
      const frames: RepresentativeFrameBytes[] = [];
      for (const time of sourceTimes) {
        signal?.throwIfAborted();
        frames.push(
          await sampleVerifiedFrame(verifiedAsset, snapshot, time, signal),
        );
      }
      signal?.throwIfAborted();
      return frames;
    },
    { signal },
  );
}

async function sampleVerifiedFrame(
  asset: MediaAsset,
  path: string,
  sourceTimeSeconds: number,
  signal?: AbortSignal,
): Promise<RepresentativeFrameBytes> {
  const filters = await previewVideoFilters(asset, signal);
  const args = [
    "-v",
    "error",
    "-nostdin",
    "-threads",
    "1",
    "-filter_threads",
    "1",
    ...(await localMediaInputOptions(path, signal)),
    "-i",
    path,
    ...(asset.mediaType === "image" || sourceTimeSeconds === 0
      ? []
      : ["-ss", sourceTimeSeconds.toFixed(6)]),
    "-frames:v",
    "1",
    "-vf",
    [
      ...filters,
      "scale=640:360:force_original_aspect_ratio=decrease",
      "pad=640:360:(ow-iw)/2:(oh-ih)/2:black",
    ].join(","),
    "-q:v",
    "5",
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "pipe:1",
  ];
  const result = await runProcess("ffmpeg", args, {
    signal,
    timeoutMs: 120_000,
    maxOutputBytes: 512 * 1024,
  });
  if (
    result.stdout.length < 4 ||
    result.stdout[0] !== 0xff ||
    result.stdout[1] !== 0xd8 ||
    result.stdout[2] !== 0xff
  )
    throw new Error(
      "FFmpeg did not produce a valid bounded JPEG representative frame.",
    );
  return {
    bytes: new Uint8Array(result.stdout),
    mimeType: "image/jpeg",
    width: 640,
    height: 360,
  };
}

export async function createProxy(
  asset: MediaAsset,
  output: string,
  signal?: AbortSignal,
  options: { maximumBytes?: number } = {},
): Promise<void> {
  if (
    options.maximumBytes !== undefined &&
    (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1)
  )
    throw new Error("Proxy byte bound must be a positive safe integer.");
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
        ...(await localMediaInputOptions(localPath(asset.uri), signal)),
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
        ...(options.maximumBytes === undefined
          ? []
          : ["-fs", String(options.maximumBytes)]),
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
      ...(await localMediaInputOptions(localPath(asset.uri), signal)),
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
      ...(options.maximumBytes === undefined
        ? []
        : ["-fs", String(options.maximumBytes)]),
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
  SOURCE_CLOCK_AUDIO_FILTER,
  WAVEFORM_CACHE_IDENTITY,
  sceneCacheIdentity,
} from "./intelligence.js";
export type { SceneDetectionOptions } from "./intelligence.js";
