// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
import { createHash } from "node:crypto";
import type { MediaAsset } from "@openfilm/core";

export const proxyDigest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function proxyDerivationFingerprint(asset: MediaAsset): string {
  return proxyDigest({
    hash: asset.contentHash,
    mediaType: asset.mediaType,
    duration: asset.duration,
    dimensions: asset.dimensions,
    frameRate: asset.frameRate,
    codec: asset.codec,
    hdr: asset.hdr,
    colorSpace: asset.colorSpace,
    decoding: Object.fromEntries(
      [
        "openfilm.ffprobe",
        "openfilm.color",
        "openfilm.preview",
        "openfilm.pixel",
        "openfilm.insta360",
      ].map((key) => [key, asset.metadata[key] ?? null]),
    ),
  });
}

export function proxyInputFingerprint(asset: MediaAsset): string {
  return proxyDigest([asset.uri, proxyDerivationFingerprint(asset)]);
}
