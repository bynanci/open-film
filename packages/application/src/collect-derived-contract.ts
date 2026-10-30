// SPDX-License-Identifier: Apache-2.0
import {
  ApplicationError,
  validateCollectDeliveryOptions,
} from "@openfilm/core";
import type {
  CollectDecodedSignature,
  CollectDerivativeReceipt,
  CollectParityReceipt,
} from "./collect-derived-media.js";
const SHA = /^[a-f0-9]{64}$/u;
function invalid(): never {
  throw new ApplicationError(
    "request.invalid",
    "Collect derivative receipt has an invalid clock, identity or quality contract.",
  );
}
function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    invalid();
  return value as Record<string, unknown>;
}
function number(value: unknown, max = 600): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max
  )
    invalid();
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
function signature(value: unknown): CollectDecodedSignature {
  const s = object(value, [
    "videoSha256",
    "videoFrames",
    "duration",
    "audioSha256",
  ]);
  if (
    !SHA.test(String(s.videoSha256)) ||
    !Number.isSafeInteger(s.videoFrames) ||
    Number(s.videoFrames) < 1 ||
    Number(s.videoFrames) > 1_080_000 ||
    (s.audioSha256 !== undefined && !SHA.test(String(s.audioSha256)))
  )
    invalid();
  number(s.duration, 301);
  return s as unknown as CollectDecodedSignature;
}
export function validateDerivedCollectManifest(
  data: Record<string, unknown>,
): void {
  const delivery = validateCollectDeliveryOptions(data.delivery);
  const assets = data.assets as { id: string; sha256: string }[],
    compositionIds = data.compositionIds as string[];
  const known = new Map(assets.map((asset) => [asset.id, asset.sha256])),
    seen = new Set<string>();
  for (const value of list(data.derivatives, 10_000)) {
    const r = object(value, [
      "version",
      "assetId",
      "originalSha256",
      "derivedSha256",
      "sourceDuration",
      "derivedDuration",
      "recipe",
      "quality",
      "windows",
    ]);
    if (
      r.version !== 1 ||
      typeof r.assetId !== "string" ||
      !known.has(r.assetId) ||
      seen.has(r.assetId) ||
      !SHA.test(String(r.originalSha256)) ||
      known.get(r.assetId) !== r.derivedSha256 ||
      (delivery.mode === "trimmed-originals"
        ? r.recipe !== "ffv1-pcm-v1" || r.quality !== "lossless"
        : delivery.mode === "offline-proxies"
          ? r.recipe !== "preview-v1" || r.quality !== "offline-only"
          : true)
    )
      invalid();
    seen.add(r.assetId);
    number(r.sourceDuration);
    number(r.derivedDuration);
    const windows = list(r.windows, 128);
    if (!windows.length) invalid();
    let sourceEnd = 0,
      derivedEnd = 0;
    for (const raw of windows) {
      const w = object(raw, [
        "sourceStart",
        "sourceEnd",
        "derivedStart",
        "derivedEnd",
      ]);
      number(w.sourceStart);
      number(w.sourceEnd);
      number(w.derivedStart);
      number(w.derivedEnd);
      if (
        w.sourceStart < sourceEnd ||
        w.sourceEnd <= w.sourceStart ||
        w.sourceEnd > r.sourceDuration ||
        Math.abs(w.derivedStart - derivedEnd) > 1e-8 ||
        w.derivedEnd <= w.derivedStart ||
        Math.abs(
          w.sourceEnd - w.sourceStart - (w.derivedEnd - w.derivedStart),
        ) > 1e-8
      )
        invalid();
      sourceEnd = w.sourceEnd;
      derivedEnd = w.derivedEnd;
    }
    if (Math.abs(derivedEnd - r.derivedDuration) > 1e-8) invalid();
    if (
      delivery.mode === "offline-proxies" &&
      (windows.length !== 1 ||
        (r as unknown as CollectDerivativeReceipt).windows[0]!.sourceStart !==
          0 ||
        sourceEnd !== r.sourceDuration)
    )
      invalid();
  }
  const reasons = [
    "source.protected",
    "source.clock-unsupported",
    "source.identity-missing",
    "source.timing-unavailable",
    "source.unsupported",
    "source.locked",
    "source.opaque-reference",
    "source.evidence-bound",
    "source.range-invalid",
    "source.unused",
  ];
  for (const value of list(data.retained, 10_000)) {
    const r = object(value, ["assetId", "reason"]);
    if (
      typeof r.assetId !== "string" ||
      !known.has(r.assetId) ||
      seen.has(r.assetId) ||
      !reasons.includes(String(r.reason))
    )
      invalid();
    seen.add(r.assetId);
  }
  if (delivery.mode !== "originals" && seen.size !== known.size) invalid();
  const compositions = new Set<string>();
  for (const value of list(data.parity, 100)) {
    const p = object(value, [
      "compositionId",
      "matched",
      "original",
      "derived",
    ]);
    if (
      typeof p.compositionId !== "string" ||
      !compositionIds.includes(p.compositionId) ||
      compositions.has(p.compositionId) ||
      typeof p.matched !== "boolean"
    )
      invalid();
    compositions.add(p.compositionId);
    const a = signature(p.original),
      b = signature(p.derived);
    if (
      a.videoFrames !== b.videoFrames ||
      a.duration !== b.duration ||
      Boolean(a.audioSha256) !== Boolean(b.audioSha256) ||
      p.matched !== sameCollectSignature(a, b) ||
      (delivery.mode === "trimmed-originals" && !p.matched)
    )
      invalid();
  }
  if (
    delivery.mode !== "originals" &&
    compositions.size !== compositionIds.length
  )
    invalid();
  if (delivery.mode === "originals" && (seen.size || compositions.size))
    invalid();
}

export function validateDerivedProjectClocks(
  project: {
    timelines: {
      id: string;
      tracks: {
        clips: {
          id: string;
          assetId: string;
          sourceIn?: number;
          sourceOut?: number;
          locked?: boolean;
          title?: unknown;
        }[];
      }[];
    }[];
  },
  receipts: readonly CollectDerivativeReceipt[],
): void {
  for (const composition of project.timelines)
    for (const track of composition.tracks)
      for (const clip of track.clips) {
        const receipt = receipts.find((r) => r.assetId === clip.assetId);
        if (!receipt || clip.title) continue;
        if (
          clip.locked ||
          clip.sourceIn === undefined ||
          clip.sourceOut === undefined ||
          !receipt.windows.some(
            (w) =>
              clip.sourceIn! >= w.derivedStart - 1e-8 &&
              clip.sourceOut! <= w.derivedEnd + 1e-8 &&
              clip.sourceOut! > clip.sourceIn!,
          )
        )
          invalid();
      }
}
export function sameCollectSignature(
  a: CollectDecodedSignature,
  b: CollectDecodedSignature,
): boolean {
  return (
    a.videoSha256 === b.videoSha256 &&
    a.videoFrames === b.videoFrames &&
    a.duration === b.duration &&
    a.audioSha256 === b.audioSha256
  );
}
export type { CollectParityReceipt };
