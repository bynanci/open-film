import type { MediaAsset } from "@openfilm/core";

export interface ColorMetadata {
  pixelFormat?: string;
  bitDepth?: number;
  primaries?: string;
  transfer?: string;
  matrix?: string;
  range?: string;
  hdr: boolean;
  kind: "SDR" | "HLG" | "HDR10/PQ" | "HDR (unrecognized transfer)";
}

export function probeColor(
  stream: Record<string, unknown> | undefined,
): ColorMetadata {
  const text = (key: string) =>
    typeof stream?.[key] === "string" ? (stream[key] as string) : undefined;
  const pixelFormat = text("pix_fmt");
  const declared = Number(stream?.bits_per_raw_sample);
  const inferred = pixelFormat?.match(
    /(?:p0?|gray)(9|10|12|14|16)(?:le|be)?$/,
  )?.[1];
  const bitDepth =
    declared > 0
      ? declared
      : inferred
        ? Number(inferred)
        : pixelFormat
          ? 8
          : undefined;
  const transfer = text("color_transfer");
  const hdr =
    transfer === "arib-std-b67" ||
    transfer === "smpte2084" ||
    (Array.isArray(stream?.side_data_list) &&
      stream.side_data_list.some(
        (entry: unknown) =>
          typeof entry === "object" &&
          entry !== null &&
          "side_data_type" in entry &&
          /mastering display|content light|dovi/i.test(
            String(entry.side_data_type),
          ),
      ));
  return {
    ...(pixelFormat ? { pixelFormat } : {}),
    ...(bitDepth ? { bitDepth } : {}),
    ...(text("color_primaries") ? { primaries: text("color_primaries") } : {}),
    ...(transfer ? { transfer } : {}),
    ...(text("color_space") ? { matrix: text("color_space") } : {}),
    ...(text("color_range") ? { range: text("color_range") } : {}),
    hdr,
    kind:
      transfer === "arib-std-b67"
        ? "HLG"
        : transfer === "smpte2084"
          ? "HDR10/PQ"
          : hdr
            ? "HDR (unrecognized transfer)"
            : "SDR",
  };
}

export function previewIssue(asset: MediaAsset): string | undefined {
  const preview = asset.metadata["openfilm.preview"] as
    { supported?: boolean; reason?: string } | undefined;
  if (preview?.supported === false)
    return (
      preview.reason ??
      "This source needs a compatible exported file before preview."
    );
  if (asset.mediaType === "360-video")
    return "360 source: Requires reframed export. Export a flat MP4 from the camera software before preview.";
  return undefined;
}

/** A conservative SDR preview conversion, never a change to original media. */
export function hdrToneMapFilter(asset: MediaAsset): string | undefined {
  if (!asset.hdr) return undefined;
  const color = asset.metadata["openfilm.color"] as ColorMetadata | undefined;
  if (
    !color ||
    !["arib-std-b67", "smpte2084"].includes(color.transfer ?? "") ||
    color.primaries !== "bt2020" ||
    !["bt2020nc", "bt2020c"].includes(color.matrix ?? "")
  )
    throw new Error(
      `HDR source "${asset.name}" has incomplete or unsupported color metadata. Export an SDR copy before preview; original metadata is preserved.`,
    );
  return "zscale=transfer=linear:npl=100,format=gbrpf32le,tonemap=tonemap=hable:desat=0,zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=limited,format=yuv420p";
}
