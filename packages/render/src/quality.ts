// SPDX-License-Identifier: Apache-2.0
import { ApplicationError } from "@openfilm/core";

export type RenderQuality = "standard" | "high-detail";
export interface RenderQualityProfile {
  readonly quality: RenderQuality;
  readonly video: "libx264";
  readonly preset: "veryfast" | "medium";
  readonly crf: 23 | 18;
}
const profiles: Readonly<Record<RenderQuality, RenderQualityProfile>> =
  Object.freeze({
    standard: Object.freeze({
      quality: "standard",
      video: "libx264",
      preset: "veryfast",
      crf: 23,
    }),
    "high-detail": Object.freeze({
      quality: "high-detail",
      video: "libx264",
      preset: "medium",
      crf: 18,
    }),
  });

/** An output-only compression policy. It never changes the composition frame. */
export function resolveRenderQuality(
  value: unknown = undefined,
): RenderQualityProfile {
  if (value === undefined) return profiles.standard;
  if (value !== "standard" && value !== "high-detail")
    throw new ApplicationError(
      "request.invalid",
      "Choose standard or high-detail compression quality.",
    );
  return profiles[value];
}
