import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MediaAsset } from "@openfilm/core";
import type {
  MediaCandidate as SourceCandidate,
  MediaMetadata,
  MediaSourceAdapter,
  OperationOptions,
  SourceInput,
} from "@openfilm/plugin-sdk";
import {
  checkAbort,
  extractExif,
  FilesystemSource,
  inspectMedia,
  localPath,
  runProcess,
  type MediaCandidate,
} from "@openfilm/media";
import { resolveTimestamp } from "@openfilm/metadata";

export interface PixelMotionPhoto {
  detected: true;
  kind: "embedded" | "sidecar" | "metadata-reference";
  experimental: true;
  evidence: string[];
  offsetBytes?: number;
  sidecarUri?: string;
  reference?: string;
}
export interface PixelMetadata {
  recognized: boolean;
  device?: string;
  fallback?: "GenericCamera";
  evidence: Record<string, unknown>;
  motionPhoto?: PixelMotionPhoto;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
function number(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function tag(records: Record<string, unknown>[], names: string[]): unknown {
  for (const input of records) {
    for (const name of names) {
      const key = Object.keys(input).find(
        (key) =>
          key.toLowerCase() === name.toLowerCase() ||
          key.split(":").at(-1)?.toLowerCase() === name.toLowerCase(),
      );
      if (key !== undefined) return input[key];
    }
  }
  return undefined;
}
function metadataRecords(asset: MediaAsset): Record<string, unknown>[] {
  const exif = record(asset.metadata["openfilm.exif"]);
  const probe = record(asset.metadata["openfilm.ffprobe"]);
  const streams = Array.isArray(probe.streams) ? probe.streams.map(record) : [];
  return [
    exif,
    record(exif.EXIF),
    record(exif.QuickTime),
    record(record(probe.format).tags),
    ...streams.map((stream) => record(stream.tags)),
    { Make: asset.source?.manufacturer, Model: asset.source?.device },
  ];
}
function coordinates(records: Record<string, unknown>[]): MediaAsset["gps"] {
  let latitude = number(tag(records, ["GPSLatitude"])),
    longitude = number(tag(records, ["GPSLongitude"]));
  if (latitude === undefined || longitude === undefined) return undefined;
  if (/^s(?:outh)?$/i.test(text(tag(records, ["GPSLatitudeRef"])) ?? ""))
    latitude = -Math.abs(latitude);
  if (/^w(?:est)?$/i.test(text(tag(records, ["GPSLongitudeRef"])) ?? ""))
    longitude = -Math.abs(longitude);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : undefined;
}
const enabled = (value: unknown): boolean =>
  value === true || value === 1 || /^(1|true|yes)$/i.test(text(value) ?? "");
async function sibling(
  path: string,
  candidate: string,
): Promise<string | undefined> {
  // Metadata references cannot make enrichment inspect an arbitrary external path.
  const root = dirname(path);
  let possible: string;
  try {
    possible = candidate.startsWith("file:")
      ? localPath(candidate)
      : resolve(root, candidate);
  } catch {
    return undefined;
  }
  if (dirname(possible) !== root || possible === path) return undefined;
  try {
    const info = await lstat(possible);
    return info.isFile() && !info.isSymbolicLink()
      ? pathToFileURL(possible).href
      : undefined;
  } catch {
    return undefined;
  }
}
async function motionPhoto(
  asset: MediaAsset,
  records: Record<string, unknown>[],
): Promise<PixelMotionPhoto | undefined> {
  const flags = ["MotionPhoto", "MicroVideo"].filter((name) =>
    enabled(tag(records, [name])),
  );
  const offset = number(
    tag(records, [
      "MicroVideoOffset",
      "MotionPhotoVideoSize",
      "MotionPhotoOffset",
    ]),
  );
  const reference = text(
    tag(records, [
      "MotionPhotoVideoFile",
      "MicroVideoFile",
      "EmbeddedVideoFile",
      "MotionPhotoFile",
      "MotionPhotoVideoURI",
    ]),
  );
  const binary = tag(records, ["MotionPhotoVideo", "EmbeddedVideo"]);
  const embeddedField = text(binary) !== undefined || (number(binary) ?? 0) > 0;
  const container = tag(records, ["Directory", "ContainerDirectory"]);
  const containerText =
    container === undefined ? "" : JSON.stringify(container);
  const containerVideo = /video\/mp4|MotionPhoto/i.test(containerText);
  if (
    !flags.length &&
    offset === undefined &&
    !reference &&
    !embeddedField &&
    !containerVideo
  )
    return undefined;
  const evidence = flags.map((name) => `${name}=1`);
  if (containerVideo)
    evidence.push("Container metadata references a motion video item");
  if (embeddedField) evidence.push("ExifTool reports an embedded video field");
  if (reference) evidence.push(`Motion video reference: ${reference}`);
  const fileSize = number(record(asset.metadata["openfilm.filesystem"]).size);
  const validOffset =
    offset !== undefined &&
    Number.isSafeInteger(offset) &&
    offset > 0 &&
    fileSize !== undefined &&
    offset < fileSize;
  if (offset !== undefined)
    evidence.push(
      validOffset
        ? `Motion video offset ${offset} bytes from EOF lies within the source`
        : `Unverified motion video offset: ${offset}`,
    );
  if (validOffset || embeddedField)
    return {
      detected: true,
      kind: "embedded",
      experimental: true,
      evidence,
      ...(validOffset ? { offsetBytes: offset } : {}),
      ...(reference ? { reference } : {}),
    };
  let path: string | undefined;
  try {
    path = localPath(asset.uri);
  } catch {
    /* Metadata-only references remain useful offline. */
  }
  if (path) {
    const stem = basename(path, extname(path));
    const stems = [
      ...new Set([stem, stem.replace(/\.MP$/i, ""), basename(path)]),
    ];
    const candidates = [
      ...(reference ? [reference] : []),
      ...stems.flatMap((stem) =>
        [".mp4", ".MP4", ".mov", ".MOV"].map(
          (extension) => `${stem}${extension}`,
        ),
      ),
    ];
    const found = new Set<string>();
    for (const candidate of candidates) {
      const sidecarUri = await sibling(path, candidate);
      if (sidecarUri) found.add(sidecarUri);
    }
    if (found.size === 1)
      return {
        detected: true,
        kind: "sidecar",
        experimental: true,
        sidecarUri: [...found][0]!,
        ...(reference ? { reference } : {}),
        evidence: [
          ...evidence,
          "A regular sibling file matches the motion reference/name; pairing is experimental",
        ],
      };
    if (found.size > 1)
      evidence.push(
        "Multiple sibling videos match; an explicit pairing is required",
      );
  }
  return {
    detected: true,
    kind: "metadata-reference",
    experimental: true,
    evidence,
    ...(reference ? { reference } : {}),
  };
}

/** Device recognition uses camera metadata; Pixel-like filenames are not evidence. */
export async function enrichPixelAsset(asset: MediaAsset): Promise<MediaAsset> {
  const next = structuredClone(asset);
  const records = metadataRecords(next);
  const make = text(
    tag(records, ["Make", "Manufacturer", "com.android.manufacturer"]),
  );
  const model = text(
    tag(records, [
      "Model",
      "CameraModelName",
      "UniqueCameraModel",
      "com.android.model",
    ]),
  );
  const pixelModel =
    /^(?:Google\s+)?Pixel(?:\s+(?:\d+[a-z]?|Pro|XL|Fold|Tablet))*$/i.test(
      model ?? "",
    );
  const google = make
    ? /^Google(?:\s+(?:Inc\.?|LLC))?$/i.test(make)
    : /^Google\s+Pixel\b/i.test(model ?? "");
  const recognized = pixelModel && google;
  const evidence: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({
    make,
    model,
    orientation: tag(records, ["Orientation"]),
    dateTimeOriginal: tag(records, ["DateTimeOriginal"]),
    offsetTimeOriginal: tag(records, ["OffsetTimeOriginal"]),
    dimensions: next.dimensions,
    codec: next.codec,
    frameRate: next.frameRate,
    colorSpace: next.colorSpace,
    hdr: next.hdr,
  }))
    if (value !== undefined) evidence[key] = value;
  const metadata: PixelMetadata = {
    recognized,
    ...(recognized
      ? { device: model }
      : { fallback: "GenericCamera" as const }),
    evidence,
  };
  if (recognized) {
    const exif = record(next.metadata["openfilm.exif"]);
    const timestamp = resolveTimestamp(exif);
    if (
      timestamp.timestamp &&
      !/^(?:user|manual)/i.test(next.capturedAtSource ?? "") &&
      timestamp.confidence >= (next.capturedAtConfidence ?? 0)
    ) {
      next.capturedAt = timestamp.timestamp;
      next.capturedAtConfidence = timestamp.confidence;
      next.capturedAtSource = timestamp.source;
      if (timestamp.timezone) next.timezone = timestamp.timezone;
      next.metadata["openfilm.timestamp"] = timestamp;
    }
    const gps = coordinates(records);
    if (gps) next.gps = gps;
    if (next.gps) evidence.gps = structuredClone(next.gps);
    if (next.timezone) evidence.timezone = next.timezone;
    next.source = {
      ...next.source,
      manufacturer: make ?? "Google",
      device: model,
    };
    metadata.motionPhoto = await motionPhoto(next, records);
    if (!metadata.motionPhoto) delete metadata.motionPhoto;
  }
  next.metadata["openfilm.pixel"] = metadata;
  return next;
}

/** Keep real DNG metadata catalogable even when the installed decoder cannot preview it. */
export async function inspectPixelDng(
  candidate: MediaCandidate,
  signal?: AbortSignal,
): Promise<MediaAsset> {
  checkAbort(signal);
  const path = candidate.path;
  if (extname(path).toLowerCase() !== ".dng")
    throw new Error("Pixel DNG inspection requires a .dng source.");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("DNG source must be a regular file, not a symlink.");
  let inspected: MediaAsset | undefined;
  let decodeFailure: unknown;
  try {
    inspected = await inspectMedia(candidate, signal);
    const decoded = await runProcess(
      "ffmpeg",
      [
        "-v",
        "error",
        "-xerror",
        "-i",
        path,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-an",
        "-vf",
        "scale=2:2",
        "-pix_fmt",
        "rgb24",
        "-threads",
        "1",
        "-f",
        "rawvideo",
        "-",
      ],
      { signal, maxOutputBytes: 32 },
    );
    if (decoded.stdout.length !== 12)
      throw new Error("DNG decoder did not return a complete image frame.");
    return enrichPixelAsset({ ...inspected, mediaType: "image" });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    decodeFailure = error;
  }
  checkAbort(signal);
  const exif = inspected
    ? record(inspected.metadata["openfilm.exif"])
    : await extractExif(path, signal);
  if (!text(exif.DNGVersion) && String(exif.FileType).toUpperCase() !== "DNG")
    throw new Error(
      `DNG decoding failed and usable DNG metadata was not found. ${decodeFailure instanceof Error ? decodeFailure.message : "Check the source file."}`,
    );
  const timestamp = resolveTimestamp(exif, info.mtime.toISOString());
  const width = number(tag([exif], ["ImageWidth", "ExifImageWidth"])),
    height = number(tag([exif], ["ImageHeight", "ExifImageHeight"]));
  const dimensions =
    width !== undefined && height !== undefined && width > 0 && height > 0
      ? { width, height }
      : undefined;
  const make = text(tag([exif], ["Make"])),
    model = text(tag([exif], ["Model", "UniqueCameraModel"]));
  const gps = coordinates([exif]);
  const fallback: MediaAsset = inspected ?? {
    id: createHash("sha256").update(candidate.uri).digest("hex").slice(0, 32),
    uri: candidate.uri,
    name: candidate.name || basename(path),
    mediaType: "image",
    ...(timestamp.timestamp
      ? {
          capturedAt: timestamp.timestamp,
          capturedAtSource: timestamp.source,
          capturedAtConfidence: timestamp.confidence,
        }
      : {}),
    ...(timestamp.timezone ? { timezone: timestamp.timezone } : {}),
    ...(dimensions ? { dimensions } : {}),
    ...(make || model
      ? {
          source: {
            ...(make ? { manufacturer: make } : {}),
            ...(model ? { device: model } : {}),
          },
        }
      : {}),
    ...(gps ? { gps } : {}),
    codec: "dng",
    tags: [],
    state: {},
    metadata: {
      "openfilm.exif": exif,
      "openfilm.timestamp": timestamp,
      "openfilm.filesystem": {
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      },
      "openfilm.metadata.exiftoolAvailable": !exif["openfilm.exiftool.warning"],
    },
  };
  fallback.mediaType = "image";
  if (
    (!fallback.dimensions?.width || !fallback.dimensions.height) &&
    dimensions
  )
    fallback.dimensions = dimensions;
  fallback.metadata["openfilm.preview"] = {
    supported: false,
    reason:
      "This DNG cannot be decoded by the installed media tools. Export a developed JPEG/TIFF from a RAW editor and relink or import that copy for preview and rendering.",
    warnings: [
      decodeFailure instanceof Error
        ? decodeFailure.message.slice(0, 1200)
        : "DNG decoder unavailable.",
    ],
  };
  return enrichPixelAsset(fallback);
}

export class PixelSource implements MediaSourceAdapter {
  readonly id = "openfilm.source.pixel";
  private readonly filesystem = new FilesystemSource();
  supports(input: SourceInput): boolean {
    return this.filesystem.supports(input);
  }
  async scan(
    input: SourceInput,
    options: OperationOptions = {},
  ): Promise<SourceCandidate[]> {
    checkAbort(options.signal);
    if (input.type === "file") {
      const path = localPath(input.uri);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error("Pixel source must be a regular file, not a symlink.");
      options.onProgress?.(1);
      return [
        {
          path,
          uri: input.uri,
          name: basename(path),
          sourceId: this.id,
        } as MediaCandidate,
      ];
    }
    return (await this.filesystem.scan(input, options)).map((candidate) => ({
      ...candidate,
      sourceId: this.id,
    }));
  }
  async extractMetadata(
    candidate: SourceCandidate,
    options: OperationOptions = {},
  ): Promise<MediaMetadata> {
    const path =
      "path" in candidate && typeof candidate.path === "string"
        ? candidate.path
        : localPath(candidate.uri);
    const inspected =
      extname(path).toLowerCase() === ".dng"
        ? await inspectPixelDng({ ...candidate, path }, options.signal)
        : await enrichPixelAsset(
            await inspectMedia({ ...candidate, path }, options.signal),
          );
    const metadata: Partial<MediaAsset> = inspected;
    for (const key of ["id", "uri", "name", "tags", "state"] as const)
      delete metadata[key];
    return metadata;
  }
}
