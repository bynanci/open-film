// SPDX-License-Identifier: Apache-2.0
import { ApplicationError } from "./errors.js";

export const COLLECT_DELIVERY_MODES = [
  "originals",
  "trimmed-originals",
  "offline-proxies",
] as const;
export type CollectDeliveryMode = (typeof COLLECT_DELIVERY_MODES)[number];
export interface CollectDeliveryOptionsV1 {
  version: 1;
  mode: CollectDeliveryMode;
  handlesSeconds: number;
}
export type CollectCoverageReason =
  | "source.identity-missing"
  | "source.timing-unavailable"
  | "source.unsupported"
  | "source.locked"
  | "source.user-pinned"
  | "source.opaque-reference"
  | "source.evidence-bound"
  | "source.range-invalid"
  | "source.unused";
export interface CollectSourceWindow {
  start: number;
  end: number;
}
export interface CollectSourceUse {
  compositionId: string;
  trackId: string;
  clipId: string;
  sourceIn: number;
  sourceOut: number;
  speed: number;
}
export interface CollectCoverageEntry {
  assetId: string;
  sourceHash?: string;
  action: "copy-original" | "trim-candidate" | "offline-candidate";
  uses: CollectSourceUse[];
  ranges: CollectSourceWindow[];
  sourceDuration?: number;
  retainedSeconds?: number;
  removedSeconds?: number;
  reasons: CollectCoverageReason[];
}
/** Planning is evidence for review; it never authorizes a derived package. */
export interface CollectCoveragePlanV1 {
  version: 1;
  projectId: string;
  revision: string;
  baselinePlanId: string;
  mode: CollectDeliveryMode;
  handlesSeconds: number;
  status: "review-only";
  executable: false;
  quality: "originals" | "requires-lossless-parity" | "offline-only";
  entries: CollectCoverageEntry[];
}
export function validateCollectDeliveryOptions(
  value: unknown,
): CollectDeliveryOptionsV1 {
  const invalid = (): never => {
    throw new ApplicationError(
      "request.invalid",
      "Choose a version-1 Collect delivery mode and 0–10 seconds of handles.",
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) => !["version", "mode", "handlesSeconds"].includes(key),
    ) ||
    data.version !== 1 ||
    !COLLECT_DELIVERY_MODES.includes(data.mode as CollectDeliveryMode)
  )
    invalid();
  const handles = data.handlesSeconds === undefined ? 2 : data.handlesSeconds;
  if (
    typeof handles !== "number" ||
    !Number.isFinite(handles) ||
    handles < 0 ||
    handles > 10
  )
    invalid();
  return {
    version: 1,
    mode: data.mode as CollectDeliveryMode,
    handlesSeconds: handles as number,
  };
}
