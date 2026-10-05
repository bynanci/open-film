import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  win32,
} from "node:path";
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

export interface Insta360Association {
  kind: "explicit-metadata" | "named-sibling";
  uri: string;
  evidence: string;
  available?: boolean;
}

export interface Insta360Metadata {
  level: 1 | 2;
  original360Sources: string[];
  requiresReframedExport: boolean;
  evidence: {
    recognition: string[];
    association: Insta360Association[];
  };
}

const RAW_REASON =
  "360 source / Requires reframed export. Export a stitched, reframed JPG or MP4 from Insta360 Studio and import that export. Raw stitching and reframing are not available.";
const CAMERA_FIELDS = new Set([
  "make",
  "manufacturer",
  "model",
  "cameramodelname",
  "devicemanufacturer",
  "devicemodelname",
  "software",
  "encoder",
  "creatortool",
  "encodedby",
  "compressorname",
]);
const REFERENCE_FIELDS = new Set([
  "originalfilename",
  "originalrawfilename",
  "derivedfromfilepath",
  "sourcefile",
]);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** The extension identifies a source format, never proof of a flat, rendered image. */
export function isInsta360Raw(uri: string): boolean {
  if (typeof uri !== "string") return false;
  try {
    const path = uri.startsWith("file:") ? localPath(uri) : uri;
    return /\.(?:insv|insp)$/iu.test(path);
  } catch {
    return false;
  }
}

async function regular(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>>> {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (await realpath(path)) !== resolve(path)
  )
    throw new Error("Insta360 source must be a regular file without symlinks");
  return info;
}

function metadataFields(
  value: unknown,
  prefix: string,
  depth = 0,
): { key: string; path: string; value: unknown }[] {
  if (depth > 5) return [];
  if (Array.isArray(value))
    return value.flatMap((entry, index) =>
      metadataFields(entry, `${prefix}[${index}]`, depth + 1),
    );
  return Object.entries(record(value)).flatMap(([key, entry]) => {
    const path = `${prefix}.${key}`;
    return [
      { key: key.split(":").at(-1)!.toLowerCase(), path, value: entry },
      ...metadataFields(entry, path, depth + 1),
    ];
  });
}

function recognition(asset: MediaAsset): string[] {
  const fields = [
    ...Object.entries(asset.source ?? {}).map(([key, value]) => ({
      path: `source.${key}`,
      value,
    })),
    ...metadataFields(asset.metadata["openfilm.exif"], "openfilm.exif").filter(
      ({ key }) => CAMERA_FIELDS.has(key),
    ),
    ...metadataFields(
      asset.metadata["openfilm.ffprobe"],
      "openfilm.ffprobe",
    ).filter(({ key }) => CAMERA_FIELDS.has(key)),
  ];
  return fields
    .filter(
      ({ value }) =>
        typeof value === "string" &&
        /\b(?:insta360|arashi\s+vision)\b/iu.test(value),
    )
    .map(({ path, value }) => `${path}: ${String(value)}`);
}

function sphericalEvidence(asset: MediaAsset): string[] {
  const isTrue = (value: unknown): boolean =>
    value === true ||
    value === 1 ||
    (typeof value === "string" && /^(?:true|yes|1)$/iu.test(value.trim()));
  const exif = metadataFields(
    asset.metadata["openfilm.exif"],
    "openfilm.exif",
  ).filter(
    ({ key, value }) =>
      (key === "projectiontype" &&
        typeof value === "string" &&
        /^(?:equirectangular|spherical|cubemap)$/iu.test(value.trim())) ||
      (["sphericalvideo", "spherical", "usesphericalviewer"].includes(key) &&
        isTrue(value)),
  );
  const probe = metadataFields(
    asset.metadata["openfilm.ffprobe"],
    "openfilm.ffprobe",
  ).filter(
    ({ key, value }) =>
      key === "side_data_type" &&
      typeof value === "string" &&
      /^spherical[ _-]*mapping$/iu.test(value.trim()),
  );
  return [...exif, ...probe].map(
    ({ path, value }) =>
      `${path}: ${String(value)}; explicit spherical projection requires reframing.`,
  );
}

function sourceUri(value: string, asset: MediaAsset): string | undefined {
  try {
    if (/^(?:[A-Za-z]:[\\/]|\\\\[^\\])/u.test(value))
      return isInsta360Raw(value)
        ? pathToFileURL(win32.normalize(value), { windows: true }).href
        : undefined;
    if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(value) && !value.startsWith("file:"))
      return undefined;
    const path = value.startsWith("file:")
      ? localPath(value)
      : isAbsolute(value)
        ? value
        : join(dirname(localPath(asset.uri)), value);
    return isInsta360Raw(path) ? pathToFileURL(resolve(path)).href : undefined;
  } catch {
    return undefined;
  }
}

/** Lens index is intentionally ignored only within the same named capture sequence. */
function captureKey(filename: string): string | undefined {
  const stem = basename(filename, extname(filename)).replace(
    /(?:[_-](?:export(?:ed)?|refram(?:ed|e)|flat|edited))(?:[_-]v?\d+)?$/iu,
    "",
  );
  const match = /^(VID|IMG)_(\d{8})_(\d{6})_(?:(?:00|10)_)?(\d+)$/iu.exec(stem);
  return match
    ? `${match[1]!.toUpperCase()}:${match[2]}:${match[3]}:${match[4]}`
    : undefined;
}

function exportedStem(filename: string): string {
  return basename(filename, extname(filename)).replace(
    /(?:[_-](?:export(?:ed)?|refram(?:ed|e)|flat|edited))(?:[_-]v?\d+)?$/iu,
    "",
  );
}

interface RawSibling {
  name: string;
  capture?: string;
}

interface DirectoryInventory {
  byStem: Map<string, RawSibling[]>;
  byCapture: Map<string, RawSibling[]>;
}

/** One import owns one context. Reusing it across imports would hide newly added sources. */
export class Insta360ImportContext {
  private readonly directories = new Map<string, Promise<DirectoryInventory>>();

  async siblings(
    path: string,
    mediaType: MediaAsset["mediaType"],
    signal?: AbortSignal,
  ): Promise<RawSibling[]> {
    checkAbort(signal);
    const directory = dirname(path);
    let inventory = this.directories.get(directory);
    if (!inventory) {
      inventory = this.readDirectory(directory, signal);
      // Store the pending promise too: concurrent imports share a single scan.
      this.directories.set(directory, inventory);
    }
    const { byStem, byCapture } = await inventory;
    checkAbort(signal);
    const extension = mediaType === "image" ? ".insp" : ".insv";
    const capture = captureKey(basename(path));
    const matches = [
      ...(byStem.get(`${exportedStem(path)}${extension}`) ?? []),
      ...(capture ? (byCapture.get(`${capture}${extension}`) ?? []) : []),
    ];
    return [...new Map(matches.map((entry) => [entry.name, entry])).values()];
  }

  private async readDirectory(
    directory: string,
    signal?: AbortSignal,
  ): Promise<DirectoryInventory> {
    const inventory: DirectoryInventory = {
      byStem: new Map(),
      byCapture: new Map(),
    };
    if ((await realpath(directory)) !== resolve(directory)) return inventory;
    checkAbort(signal);
    const entries = await readdir(directory, { withFileTypes: true });
    checkAbort(signal);
    const add = (
      map: Map<string, RawSibling[]>,
      key: string,
      entry: RawSibling,
    ) => {
      const existing = map.get(key);
      if (existing) existing.push(entry);
      else map.set(key, [entry]);
    };
    // Keep the established deterministic safety bound, applied once per folder.
    for (const entry of entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 10000)) {
      checkAbort(signal);
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !isInsta360Raw(entry.name)
      )
        continue;
      const extension = extname(entry.name).toLowerCase();
      const sibling = { name: entry.name, capture: captureKey(entry.name) };
      add(
        inventory.byStem,
        `${basename(entry.name, extname(entry.name))}${extension}`,
        sibling,
      );
      if (sibling.capture)
        add(inventory.byCapture, `${sibling.capture}${extension}`, sibling);
    }
    return inventory;
  }
}

interface EnrichmentOptions {
  signal?: AbortSignal;
  context?: Insta360ImportContext;
}

async function associations(
  asset: MediaAsset,
  { signal, context = new Insta360ImportContext() }: EnrichmentOptions,
): Promise<Insta360Association[]> {
  checkAbort(signal);
  const found = new Map<string, Insta360Association>();
  const add = async (value: string, evidence: string): Promise<void> => {
    checkAbort(signal);
    const uri = sourceUri(value, asset);
    if (!uri || uri === asset.uri || found.has(uri)) return;
    let available = false;
    try {
      await regular(localPath(uri));
      available = true;
    } catch {
      /* Keep explicitly recorded offline provenance. */
    }
    checkAbort(signal);
    found.set(uri, { kind: "explicit-metadata", uri, evidence, available });
  };
  const explicit = record(
    asset.metadata["openfilm.insta360"],
  ).original360Sources;
  if (Array.isArray(explicit))
    for (const value of explicit.slice(0, 100))
      if (typeof value === "string")
        await add(
          value,
          "Explicit openfilm.insta360.original360Sources reference; source identity has not been verified.",
        );
  for (const field of metadataFields(
    asset.metadata["openfilm.exif"],
    "openfilm.exif",
  ))
    if (REFERENCE_FIELDS.has(field.key) && typeof field.value === "string")
      await add(
        field.value,
        `Explicit ${field.path} reference; source identity has not been verified.`,
      );
  try {
    const path = localPath(asset.uri);
    const directory = dirname(path);
    const key = captureKey(basename(path));
    for (const entry of await context.siblings(path, asset.mediaType, signal)) {
      checkAbort(signal);
      const sameCapture = key !== undefined && key === entry.capture;
      const uri = pathToFileURL(join(directory, entry.name)).href;
      if (uri === asset.uri || found.has(uri)) continue;
      await regular(join(directory, entry.name));
      checkAbort(signal);
      found.set(uri, {
        kind: "named-sibling",
        uri,
        evidence: sameCapture
          ? "Matching Insta360 capture timestamp and sequence; filename evidence only."
          : "Matching source/export filename stem; filename evidence only.",
        available: true,
      });
    }
  } catch (error) {
    checkAbort(signal);
    if (error instanceof Error && error.name === "AbortError") throw error;
    /* A moved source folder must not prevent existing metadata from opening. */
  }
  return [...found.values()];
}

/** Annotate reliable device/export evidence while retaining the original inspected metadata. */
export async function enrichInsta360Asset(
  asset: MediaAsset,
  options: EnrichmentOptions = {},
): Promise<MediaAsset> {
  checkAbort(options.signal);
  const next = structuredClone(asset);
  if (!["image", "video", "360-video"].includes(next.mediaType)) return next;
  const raw = isInsta360Raw(next.uri);
  const matched = recognition(next);
  const spherical = sphericalEvidence(next);
  const associated = await associations(next, options);
  if (!raw && !matched.length && !associated.length) {
    if (spherical.length) {
      if (next.mediaType === "video") next.mediaType = "360-video";
      next.metadata["openfilm.preview"] = {
        ...record(next.metadata["openfilm.preview"]),
        supported: false,
        reason:
          "360 source / Requires reframed export. Import a flat, reframed JPG or MP4 before preview or rendering.",
      };
    }
    return next;
  }
  const requiresReframedExport =
    raw || next.mediaType === "360-video" || spherical.length > 0;
  matched.push(...spherical);
  if (raw)
    matched.unshift(
      `Raw source extension ${extname(localPath(next.uri)).toLowerCase()}; stitching and reframing are unsupported.`,
    );
  const previous = record(next.metadata["openfilm.insta360"]);
  const metadata: Insta360Metadata = {
    level: requiresReframedExport ? 2 : 1,
    original360Sources: [
      ...new Set([
        ...(raw ? [next.uri] : []),
        ...associated.map((association) => association.uri),
      ]),
    ],
    requiresReframedExport,
    evidence: { recognition: matched, association: associated },
  };
  next.metadata["openfilm.insta360"] = { ...previous, ...metadata };
  if (
    (raw && /\.insv$/iu.test(localPath(next.uri))) ||
    (spherical.length > 0 && next.mediaType === "video")
  )
    next.mediaType = "360-video";
  next.metadata["openfilm.preview"] = requiresReframedExport
    ? {
        ...record(next.metadata["openfilm.preview"]),
        supported: false,
        reason: RAW_REASON,
      }
    : { supported: true, ...record(next.metadata["openfilm.preview"]) };
  return next;
}

/** Read metadata only. Raw dual-fisheye payloads are never decoded as flat preview frames. */
export async function inspectInsta360Raw(
  candidate: MediaCandidate,
  signal?: AbortSignal,
  context?: Insta360ImportContext,
): Promise<MediaAsset> {
  checkAbort(signal);
  if (!isInsta360Raw(candidate.path))
    throw new Error("Expected an Insta360 .insv or .insp source");
  const info = await regular(candidate.path);
  const exif = await extractExif(candidate.path, signal);
  checkAbort(signal);
  let probe: Record<string, unknown> = {};
  let probeWarning: string | undefined;
  try {
    const output = await runProcess(
      "ffprobe",
      [
        "-v",
        "error",
        "-probesize",
        "1048576",
        "-analyzeduration",
        "1000000",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        candidate.path,
      ],
      { signal, timeoutMs: 10000, maxOutputBytes: 2 * 1024 * 1024 },
    );
    probe = record(JSON.parse(output.stdout.toString("utf8")));
  } catch (error) {
    if (signal?.aborted || (error as Error).name === "AbortError") throw error;
    probeWarning = error instanceof Error ? error.message : String(error);
  }
  checkAbort(signal);
  const format = record(probe.format);
  const streams = Array.isArray(probe.streams) ? probe.streams.map(record) : [];
  const video = streams.find((stream) => stream.codec_type === "video") ?? {};
  const timestamp = resolveTimestamp(
    { ...record(format.tags), ...record(video.tags), ...exif },
    info.mtime.toISOString(),
  );
  const duration =
    number(format.duration) ?? number(video.duration) ?? number(exif.Duration);
  const width = number(video.width) ?? number(exif.ImageWidth);
  const height = number(video.height) ?? number(exif.ImageHeight);
  const rate = string(video.avg_frame_rate)?.split("/").map(Number);
  const frameRate = rate && rate[1] ? rate[0]! / rate[1] : undefined;
  const latitude = number(exif.GPSLatitude),
    longitude = number(exif.GPSLongitude);
  const source = {
    ...(string(exif.Make) ? { manufacturer: string(exif.Make)! } : {}),
    ...(string(exif.Model) ? { device: string(exif.Model)! } : {}),
    ...(string(exif.Software) ? { application: string(exif.Software)! } : {}),
  };
  const mediaType = /\.insv$/iu.test(candidate.path) ? "360-video" : "image";
  const asset: MediaAsset = {
    id: createHash("sha256").update(candidate.uri).digest("hex").slice(0, 32),
    uri: candidate.uri,
    name: candidate.name || basename(candidate.path),
    mediaType,
    ...(Object.keys(source).length ? { source } : {}),
    ...(mediaType === "360-video" && duration !== undefined && duration > 0
      ? { duration }
      : {}),
    ...(width &&
    height &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0
      ? { dimensions: { width, height } }
      : {}),
    ...(frameRate && Number.isFinite(frameRate) && frameRate > 0
      ? { frameRate }
      : {}),
    ...(string(video.codec_name) ? { codec: string(video.codec_name)! } : {}),
    ...(string(video.color_space)
      ? { colorSpace: string(video.color_space)! }
      : {}),
    ...(["smpte2084", "arib-std-b67"].includes(String(video.color_transfer))
      ? { hdr: true }
      : {}),
    ...(timestamp.timestamp
      ? {
          capturedAt: timestamp.timestamp,
          capturedAtConfidence: timestamp.confidence,
          capturedAtSource: timestamp.source,
        }
      : {}),
    ...(timestamp.timezone ? { timezone: timestamp.timezone } : {}),
    ...(latitude !== undefined &&
    longitude !== undefined &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
      ? { gps: { latitude, longitude } }
      : {}),
    tags: [],
    state: {},
    metadata: {
      ...structuredClone(candidate.metadata ?? {}),
      "openfilm.exif": exif,
      "openfilm.ffprobe": probe,
      "openfilm.filesystem": {
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      },
      "openfilm.timestamp": timestamp,
      ...(probeWarning
        ? { "openfilm.insta360.probeWarning": probeWarning }
        : {}),
    },
  };
  const enriched = await enrichInsta360Asset(asset, { signal, context });
  checkAbort(signal);
  return enriched;
}

/** Local source port; export recognition happens during metadata extraction. */
export class Insta360Source implements MediaSourceAdapter {
  readonly id = "openfilm.source.insta360";
  private readonly contexts = new WeakMap<
    SourceCandidate,
    Insta360ImportContext
  >();

  supports(input: SourceInput): boolean {
    return (
      !!input &&
      typeof input.uri === "string" &&
      input.uri.startsWith("file:") &&
      input.type !== "external"
    );
  }

  async scan(
    input: SourceInput,
    options: OperationOptions = {},
  ): Promise<MediaCandidate[]> {
    if (!this.supports(input))
      throw new Error("Insta360Source requires a local file or folder URI");
    checkAbort(options.signal);
    const path = localPath(input.uri);
    const info = await lstat(path);
    if (info.isSymbolicLink() || (await realpath(path)) !== resolve(path))
      throw new Error("Insta360 source cannot be a symlink");
    const context = new Insta360ImportContext();
    const contextualize = (candidate: MediaCandidate): MediaCandidate => {
      this.contexts.set(candidate, context);
      return candidate;
    };
    if (info.isFile()) {
      options.onProgress?.(1);
      return [
        contextualize({
          path,
          uri: pathToFileURL(path).href,
          name: basename(path),
          sourceId: this.id,
        }),
      ];
    }
    return (await new FilesystemSource().scan(input, options)).map(
      (candidate) => contextualize({ ...candidate, sourceId: this.id }),
    );
  }

  async extractMetadata(
    candidate: SourceCandidate,
    options: OperationOptions = {},
  ): Promise<MediaMetadata> {
    checkAbort(options.signal);
    const path =
      "path" in candidate && typeof candidate.path === "string"
        ? candidate.path
        : localPath(candidate.uri);
    const inspected = isInsta360Raw(candidate.uri)
      ? await inspectInsta360Raw(
          { ...candidate, path },
          options.signal,
          this.contexts.get(candidate),
        )
      : await enrichInsta360Asset(
          await inspectMedia({ ...candidate, path }, options.signal),
          { signal: options.signal, context: this.contexts.get(candidate) },
        );
    checkAbort(options.signal);
    const {
      id: _id,
      uri: _uri,
      name: _name,
      tags: _tags,
      state: _state,
      ...metadata
    } = inspected;
    return metadata;
  }
}
