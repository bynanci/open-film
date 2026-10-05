import type { MediaAsset } from "@openfilm/core";

type Detail = { label: string; value: string };
type Metadata = Record<string, unknown>;

export interface SourcePresentation {
  deviceLabel: string;
  adapter: "pixel" | "insta360" | "generic";
  kindLabel: string;
  badges: string[];
  previewSupported: boolean;
  previewReason?: string;
  previewWarnings: string[];
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
export function sourcePresentation(asset: MediaAsset): SourcePresentation {
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
    streams.find((item) => item.codec_type === "video") ??
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
        : "Generic device";
  const kindLabel = requiresReframedExport
    ? "360 source"
    : insta.level === 1
      ? "Exported flat media"
      : asset.mediaType === "image"
        ? extension(asset) === "dng"
          ? "DNG photo"
          : "Photo"
        : asset.mediaType === "audio"
          ? "Audio"
          : "Video";
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
    ...(requiresReframedExport ? ["Requires reframed export"] : []),
    ...(motionPhoto ? ["Motion Photo · Experimental"] : []),
    ...(hdr ? ["HDR"] : []),
    ...(hevc ? ["HEVC"] : []),
    ...(bitDepth && bitDepth >= 10 ? [`${bitDepth}-bit`] : []),
  ];
  const previewSupported =
    !requiresReframedExport && preview.supported !== false;
  const previewReason = requiresReframedExport
    ? "Export a flat, reframed JPG or MP4 in Insta360 Studio or the source camera’s app, then import that export to preview or render it."
    : !previewSupported
      ? (first(preview.reason) ??
        (extension(asset) === "dng"
          ? "This DNG cannot be previewed here. Create a JPEG export in a compatible photo app, then import it."
          : "This source cannot be previewed here. Create a supported JPG or MP4 export in a compatible app, then import it."))
      : undefined;
  const previewWarnings = [
    ...new Set([
      ...strings(preview.warnings, 8),
      ...(hdr
        ? [
            "HDR source. Judge brightness and color with a color-managed or tone-mapped preview.",
          ]
        : []),
      ...(hevc
        ? [
            "HEVC browser playback depends on available decoders. Use a compatible preview if direct playback fails.",
          ]
        : []),
      ...(bitDepth && bitDepth >= 10
        ? [
            `${bitDepth}-bit source. Preview support depends on the codec and color processing available.`,
          ]
        : []),
    ]),
  ].slice(0, 10);
  const details: Detail[] = [];
  const evidence: Detail[] = [];
  const add = (rows: Detail[], label: string, value: unknown) => {
    const text = shortText(value, 500);
    if (text && !rows.some((row) => row.label === label && row.value === text))
      rows.push({ label, value: text });
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
    "Camera",
    camera && make && !camera.toLowerCase().includes(make.toLowerCase())
      ? `${make} ${camera}`
      : (camera ?? make),
  );
  add(
    details,
    "Capture time",
    first(
      asset.capturedAt,
      pixelEvidence.dateTimeOriginal,
      tag(exif, "DateTimeOriginal"),
    ),
  );
  add(
    details,
    "Timezone",
    first(
      asset.timezone,
      pixelEvidence.offsetTimeOriginal,
      tag(exif, "OffsetTimeOriginal", "OffsetTime"),
    ),
  );
  add(
    details,
    "Orientation",
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
    add(details, "GPS", `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
  const width = numeric(asset.dimensions?.width) ?? numeric(stream.width);
  const height = numeric(asset.dimensions?.height) ?? numeric(stream.height);
  if (width && height) add(details, "Dimensions", `${width} × ${height}`);
  add(details, "Codec", codec);
  if (rate) add(details, "Frame rate", `${Number(rate.toFixed(3))} fps`);
  add(details, "Color transfer", transfer);
  add(details, "Pixel format", pixelFormat);
  if (bitDepth) add(details, "Bit depth", `${bitDepth}-bit`);
  add(
    details,
    "Color space",
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
    "Color primaries",
    first(
      color.primaries,
      stream.color_primaries,
      pixelEvidence.colorPrimaries,
      tag(exif, "ColorPrimaries"),
    ),
  );
  add(details, "Color range", first(color.range, stream.color_range));
  add(details, "Dynamic range", color.kind);
  add(
    details,
    "Camera software",
    first(asset.source?.application, tag(exif, "Software"), formatTags.encoder),
  );
  if (motionPhoto) {
    const kinds: Record<string, string> = {
      embedded: "Embedded",
      sidecar: "Sidecar",
      "metadata-reference": "Metadata reference",
    };
    const kind = kinds[shortText(motion.kind) ?? ""];
    add(evidence, "Motion Photo detection", kind ?? "Recorded detection");
    for (const item of strings(motion.evidence, 6))
      add(evidence, "Motion Photo evidence", item);
    add(evidence, "Motion Photo sidecar", motion.sidecarUri);
    add(evidence, "Motion Photo reference", motion.reference);
    if (numeric(motion.offsetBytes) !== undefined)
      add(evidence, "Embedded offset", `${numeric(motion.offsetBytes)} bytes`);
  }
  for (const item of strings(instaEvidence.recognition, 5))
    add(evidence, "Camera recognition", item);
  if (Array.isArray(instaEvidence.association))
    for (const raw of instaEvidence.association.slice(0, 12)) {
      const association = record(raw);
      const kind =
        association.kind === "explicit-metadata"
          ? "Metadata association"
          : association.kind === "named-sibling"
            ? "Filename association"
            : "Recorded association";
      const description = first(association.evidence);
      const uri = first(association.uri);
      if (description || uri)
        add(
          evidence,
          kind,
          [
            description,
            uri,
            association.available === false
              ? "Source currently unavailable"
              : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
        );
    }
  if (asset.capturedAtSource)
    add(evidence, "Capture time source", asset.capturedAtSource);
  if (pixel.recognized === false)
    add(
      evidence,
      "Device identification",
      "The available evidence does not establish a Google Pixel source; shown as a generic device.",
    );
  const original360Sources = strings(insta.original360Sources, 20, 800);
  return {
    deviceLabel,
    adapter,
    kindLabel,
    badges,
    previewSupported,
    ...(previewReason ? { previewReason } : {}),
    previewWarnings,
    requiresReframedExport,
    motionPhoto,
    details,
    evidence,
    original360Sources,
  };
}
