import type { MediaAsset } from "@openfilm/core";
import english from "./i18n/modules/media/en-US";

type Params = Record<string, string | number>;
export interface SourcePresentationOptions {
  translate?: (key: string, params?: Params) => string;
  formatNumber?: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate?: (value: string, options?: Intl.DateTimeFormatOptions) => string;
}
function defaultTranslate(key: string, params: Params = {}): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (item, part) =>
        item && typeof item === "object"
          ? (item as Record<string, unknown>)[part]
          : undefined,
      english,
    );
  if (typeof value !== "string")
    throw new Error(`Missing source translation: ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params[name] ?? ""),
  );
}

/** Keep actual filesystem values intact; shorten only their display. */
export function compactPath(value: string): string {
  let path = value;
  if (path.startsWith("file:")) {
    try {
      path = decodeURIComponent(new URL(path).pathname);
    } catch {
      /* Preserve malformed legacy references. */
    }
  }
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length > 3 ? `…/${segments.slice(-3).join("/")}` : path;
}

type Detail = { key: string; label: string; value: string };
type Metadata = Record<string, unknown>;

export interface SourcePresentation {
  deviceLabel: string;
  adapter: "pixel" | "insta360" | "generic";
  kindLabel: string;
  badges: string[];
  previewSupported: boolean;
  previewReason?: string;
  previewWarnings: string[];
  technicalWarnings: string[];
  requiresReframedExport: boolean;
  motionPhoto: boolean;
  details: Detail[];
  evidence: Detail[];
  original360Sources: string[];
}

function record(value: unknown): Metadata {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Metadata)
    : {};
}

function shortText(value: unknown, limit = 320): string | undefined {
  const text =
    typeof value === "string"
      ? value.trim().replace(/\s+/g, " ")
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : typeof value === "boolean"
          ? String(value)
          : "";
  return text
    ? text.length > limit
      ? `${text.slice(0, limit - 1)}…`
      : text
    : undefined;
}

function first(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = shortText(value);
    if (text) return text;
  }
  return undefined;
}

function strings(value: unknown, count = 12, limit = 500): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, count).flatMap((item) => {
    const text = typeof item === "string" ? shortText(item, limit) : undefined;
    return text ? [text] : [];
  });
}

function numeric(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return;
  if (typeof value === "string" && !value.trim()) return;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function frameRate(value: unknown): number | undefined {
  if (typeof value === "string" && value.includes("/")) {
    const [numerator, denominator] = value.split("/").map(Number);
    return numerator && denominator ? numerator / denominator : undefined;
  }
  const number = numeric(value);
  return number && number > 0 ? number : undefined;
}

function tag(tags: Metadata, ...names: string[]): unknown {
  for (const name of names) {
    if (tags[name] !== undefined) return tags[name];
    const key = Object.keys(tags).find((key) => key.split(":").at(-1) === name);
    if (key) return tags[key];
  }
  return undefined;
}

function extension(asset: MediaAsset): string {
  let path = asset.uri.split(/[?#]/)[0] ?? asset.uri;
  try {
    path = decodeURIComponent(path);
  } catch {
    // A legacy non-URL path is still useful for identifying raw extensions.
  }
  return (
    /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ??
    /\.([a-z0-9]+)$/i.exec(asset.name)?.[1]?.toLowerCase() ??
    ""
  );
}

/** Present recorded source evidence without promoting uncertain camera guesses. */
export function sourcePresentation(
  asset: MediaAsset,
  options: SourcePresentationOptions = {},
): SourcePresentation {
  const t = options.translate ?? defaultTranslate;
  const number =
    options.formatNumber ??
    ((value: number, settings?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat("en-US", settings).format(value));
  const metadata = record(asset.metadata);
  const pixel = record(metadata["openfilm.pixel"]);
  const pixelEvidence = record(pixel.evidence);
  const motion = record(pixel.motionPhoto);
  const insta = record(metadata["openfilm.insta360"]);
  const instaEvidence = record(insta.evidence);
  const preview = record(metadata["openfilm.preview"]);
  const color = record(metadata["openfilm.color"]);
  const exif = record(metadata["openfilm.exif"]);
  const probe = record(metadata["openfilm.ffprobe"]);
  const streams = Array.isArray(probe.streams) ? probe.streams.map(record) : [];
  const stream =
    streams.find(
      (item) =>
        item.codec_type === (asset.mediaType === "audio" ? "audio" : "video"),
    ) ??
    streams.find((item) => item.codec_type === "audio") ??
    {};
  const streamTags = record(stream.tags);
  const formatTags = record(record(probe.format).tags);
  const rawExtension = ["insv", "insp"].includes(extension(asset));
  const requiresReframedExport =
    insta.requiresReframedExport === true ||
    insta.level === 2 ||
    asset.mediaType === "360-video" ||
    rawExtension;
  const recognizedPixel = pixel.recognized === true;
  const recognizedInsta =
    insta.level === 1 || insta.level === 2 || rawExtension;
  const adapter = recognizedInsta
    ? "insta360"
    : recognizedPixel
      ? "pixel"
      : "generic";
  const pixelDevice = first(pixel.device);
  const deviceLabel =
    adapter === "insta360"
      ? "Insta360"
      : adapter === "pixel"
        ? pixelDevice
          ? /google/i.test(pixelDevice)
            ? pixelDevice
            : /pixel/i.test(pixelDevice)
              ? `Google ${pixelDevice}`
              : `Google Pixel · ${pixelDevice}`
          : "Google Pixel"
        : t("media.source.genericDevice");
  const kindLabel = requiresReframedExport
    ? t("media.source.kind360")
    : insta.level === 1
      ? t("media.source.kindFlat")
      : asset.mediaType === "image"
        ? extension(asset) === "dng"
          ? t("media.source.kindDng")
          : t("media.source.kindPhoto")
        : asset.mediaType === "audio"
          ? t("media.source.kindAudio")
          : t("media.source.kindVideo");
  const motionPhoto = recognizedPixel && motion.detected === true;
  const codec = first(
    asset.codec,
    stream.codec_name,
    pixelEvidence.codec,
    tag(exif, "VideoCodec", "Compression"),
  );
  const transfer = first(
    color.transfer,
    stream.color_transfer,
    pixelEvidence.colorTransfer,
    pixelEvidence.color_transfer,
    tag(exif, "TransferCharacteristics", "ColorTransfer"),
  );
  const pixelFormat = first(
    color.pixelFormat,
    stream.pix_fmt,
    pixelEvidence.pixelFormat,
    pixelEvidence.pix_fmt,
  );
  const bitDepthCandidates = [
    color.bitDepth,
    stream.bits_per_raw_sample,
    stream.bits_per_sample,
    pixelEvidence.bitDepth,
    tag(exif, "BitDepth", "BitsPerSample"),
  ];
  let bitDepth = bitDepthCandidates
    .map(numeric)
    .find((value) => value !== undefined && value > 0 && value <= 64);
  if (!bitDepth && pixelFormat) {
    const match =
      /(?:p|gray)(10|12|14|16)(?:le|be)?$/i.exec(pixelFormat) ??
      /^p0(10|12|16)(?:le|be)$/i.exec(pixelFormat);
    bitDepth = match ? Number(match[1]) : undefined;
  }
  const hdr =
    asset.hdr === true ||
    color.hdr === true ||
    /smpte2084|arib-std-b67|\bhlg\b|\bpq\b/i.test(transfer ?? "");
  const hevc = /hevc|h[ ._-]?265|hvc1|hev1/i.test(codec ?? "");
  const rate =
    frameRate(asset.frameRate) ??
    frameRate(stream.avg_frame_rate) ??
    frameRate(stream.r_frame_rate);
  const badges = [
    ...(requiresReframedExport ? [t("media.source.reframe")] : []),
    ...(motionPhoto ? [t("media.source.motionBadge")] : []),
    ...(hdr ? ["HDR"] : []),
    ...(hevc ? ["HEVC"] : []),
    ...(bitDepth && bitDepth >= 10
      ? [t("media.source.bitDepthValue", { depth: number(bitDepth) })]
      : []),
  ];
  const previewSupported =
    !requiresReframedExport && preview.supported !== false;
  const previewReason = requiresReframedExport
    ? t("media.source.reframeHelp")
    : !previewSupported
      ? extension(asset) === "dng"
        ? t("media.source.dngHelp")
        : t("media.source.unsupportedHelp")
      : undefined;
  const previewWarnings = [
    ...new Set([
      ...(hdr ? [t("media.source.hdrHelp")] : []),
      ...(hevc ? [t("media.source.hevcHelp")] : []),
      ...(bitDepth && bitDepth >= 10
        ? [t("media.source.depthHelp", { depth: number(bitDepth) })]
        : []),
    ]),
  ].slice(0, 10);
  const details: Detail[] = [];
  const evidence: Detail[] = [];
  const add = (
    rows: Detail[],
    key: string,
    value: unknown,
    preserve = false,
  ) => {
    const text =
      preserve && typeof value === "string" ? value : shortText(value, 500);
    if (text && !rows.some((row) => row.key === key && row.value === text))
      rows.push({ key, label: t(`media.source.fields.${key}`), value: text });
  };
  const camera = first(
    asset.source?.device,
    pixelEvidence.model,
    tag(exif, "Model", "CameraModelName"),
  );
  const make = first(
    asset.source?.manufacturer,
    pixelEvidence.make,
    tag(exif, "Make"),
  );
  add(
    details,
    "camera",
    camera && make && !camera.toLowerCase().includes(make.toLowerCase())
      ? `${make} ${camera}`
      : (camera ?? make),
  );
  add(
    details,
    "captureTime",
    first(
      asset.capturedAt && options.formatDate
        ? options.formatDate(asset.capturedAt, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })
        : asset.capturedAt,
      pixelEvidence.dateTimeOriginal,
      tag(exif, "DateTimeOriginal"),
    ),
  );
  add(
    details,
    "timezone",
    first(
      asset.timezone,
      pixelEvidence.offsetTimeOriginal,
      tag(exif, "OffsetTimeOriginal", "OffsetTime"),
    ),
  );
  add(
    details,
    "orientation",
    first(
      pixelEvidence.orientation,
      tag(exif, "Orientation"),
      streamTags.rotate,
    ),
  );
  const latitude =
    numeric(asset.gps?.latitude) ?? numeric(tag(exif, "GPSLatitude"));
  const longitude =
    numeric(asset.gps?.longitude) ?? numeric(tag(exif, "GPSLongitude"));
  if (
    latitude !== undefined &&
    longitude !== undefined &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  )
    add(details, "gps", `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
  const width = numeric(asset.dimensions?.width) ?? numeric(stream.width);
  const height = numeric(asset.dimensions?.height) ?? numeric(stream.height);
  if (width && height) add(details, "dimensions", `${width} × ${height}`);
  add(details, "codec", codec);
  if (rate)
    add(
      details,
      "frameRate",
      t("media.source.fps", {
        rate: number(rate, { maximumFractionDigits: 3 }),
      }),
    );
  add(details, "colorTransfer", transfer);
  add(details, "pixelFormat", pixelFormat);
  if (bitDepth)
    add(
      details,
      "bitDepth",
      t("media.source.bitDepthValue", { depth: number(bitDepth) }),
    );
  add(
    details,
    "colorSpace",
    first(
      color.matrix,
      asset.colorSpace,
      stream.color_space,
      pixelEvidence.colorSpace,
      tag(exif, "ColorSpace"),
    ),
  );
  add(
    details,
    "colorPrimaries",
    first(
      color.primaries,
      stream.color_primaries,
      pixelEvidence.colorPrimaries,
      tag(exif, "ColorPrimaries"),
    ),
  );
  add(details, "colorRange", first(color.range, stream.color_range));
  add(details, "dynamicRange", color.kind);
  add(
    details,
    "cameraSoftware",
    first(asset.source?.application, tag(exif, "Software"), formatTags.encoder),
  );
  if (motionPhoto) {
    const kinds: Record<string, string> = {
      embedded: t("media.source.embedded"),
      sidecar: t("media.source.sidecar"),
      "metadata-reference": t("media.source.metadataReference"),
    };
    const kind = kinds[shortText(motion.kind) ?? ""];
    add(
      evidence,
      "motionDetection",
      kind ?? t("media.source.recordedDetection"),
    );
    for (const item of strings(motion.evidence, 6))
      add(evidence, "motionEvidence", item);
    add(evidence, "motionSidecar", motion.sidecarUri, true);
    add(evidence, "motionReference", motion.reference, true);
    if (numeric(motion.offsetBytes) !== undefined)
      add(
        evidence,
        "embeddedOffset",
        t("media.source.bytes", {
          count: number(numeric(motion.offsetBytes)!),
        }),
      );
  }
  for (const item of strings(instaEvidence.recognition, 5))
    add(evidence, "cameraRecognition", item);
  if (Array.isArray(instaEvidence.association))
    for (const raw of instaEvidence.association.slice(0, 12)) {
      const association = record(raw);
      const kind =
        association.kind === "explicit-metadata"
          ? "metadataAssociation"
          : association.kind === "named-sibling"
            ? "filenameAssociation"
            : "recordedAssociation";
      const description = first(association.evidence);
      const uri =
        typeof association.uri === "string" ? association.uri : undefined;
      if (description || uri)
        add(
          evidence,
          kind,
          [
            description,
            uri,
            association.available === false
              ? t("media.source.unavailable")
              : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
          true,
        );
    }
  if (asset.capturedAtSource)
    add(evidence, "captureSource", asset.capturedAtSource);
  if (pixel.recognized === false)
    add(evidence, "deviceIdentification", t("media.source.genericEvidence"));
  const original360Sources = Array.isArray(insta.original360Sources)
    ? insta.original360Sources
        .filter((item): item is string => typeof item === "string")
        .slice(0, 20)
    : [];
  return {
    deviceLabel,
    adapter,
    kindLabel,
    badges,
    previewSupported,
    ...(previewReason ? { previewReason } : {}),
    previewWarnings,
    technicalWarnings: [
      ...strings(preview.warnings, 8),
      ...(!previewSupported && typeof preview.reason === "string"
        ? [preview.reason]
        : []),
    ],
    requiresReframedExport,
    motionPhoto,
    details,
    evidence,
    original360Sources,
  };
}
