// SPDX-License-Identifier: Apache-2.0
import type { Clip, Composition, PrimaryColorCorrection } from "./models.js";
import { validatePrimaryColorCorrection } from "./validation.js";

export const PRIMARY_COLOR_VERSION = 1 as const;
export const PRIMARY_COLOR_DOMAIN = "encoded-sdr-rgb" as const;
export const PRIMARY_COLOR_IDENTITY: Readonly<PrimaryColorCorrection> =
  Object.freeze({
    version: 1,
    temperature: 0,
    exposureEv: 0,
    contrast: 1,
  });
export interface PrimaryColorCoefficients {
  version: 1;
  domain: typeof PRIMARY_COLOR_DOMAIN;
  slopes: readonly [number, number, number];
  offset: number;
  /** Unassociated RGBA; constant-column lift, alpha unchanged. */
  matrix: readonly number[];
}
const rounded = (v: number) => Number(v.toFixed(12)) || 0;
export function primaryColorCoefficients(
  value?: PrimaryColorCorrection | null,
): PrimaryColorCoefficients {
  const recipe =
    value == null
      ? PRIMARY_COLOR_IDENTITY
      : validatePrimaryColorCorrection(value);
  const gain = 2 ** recipe.exposureEv * recipe.contrast;
  const slopes = Object.freeze([
    rounded(gain * (1 + 0.1 * recipe.temperature)),
    rounded(gain),
    rounded(gain * (1 - 0.1 * recipe.temperature)),
  ] as const);
  const offset = rounded(0.5 * (1 - recipe.contrast));
  return Object.freeze({
    version: 1,
    domain: PRIMARY_COLOR_DOMAIN,
    slopes,
    offset,
    matrix: Object.freeze([
      slopes[0],
      0,
      0,
      0,
      offset,
      0,
      slopes[1],
      0,
      0,
      offset,
      0,
      0,
      slopes[2],
      0,
      offset,
      0,
      0,
      0,
      1,
      0,
    ]),
  });
}
export function isPrimaryColorActive(
  value?: PrimaryColorCorrection | null,
): boolean {
  if (value == null) return false;
  const coefficients = primaryColorCoefficients(value);
  return (
    coefficients.offset !== 0 ||
    coefficients.slopes.some((slope) => slope !== 1)
  );
}
export interface ResolvedPrimaryColor {
  correction: PrimaryColorCorrection;
  source: "clip" | "beat" | "film" | "original";
}
export function resolvePrimaryColor(
  composition: Pick<Composition, "defaultPrimaryColor" | "beatPrimaryColors">,
  clip: Pick<Clip, "primaryColor" | "beatId">,
): ResolvedPrimaryColor {
  if (clip.primaryColor !== undefined)
    return {
      correction: validatePrimaryColorCorrection(clip.primaryColor),
      source: "clip",
    };
  const beat = composition.beatPrimaryColors?.find(
    (entry) => entry.beatId === clip.beatId,
  );
  if (beat)
    return {
      correction: validatePrimaryColorCorrection(beat.correction),
      source: "beat",
    };
  if (composition.defaultPrimaryColor !== undefined)
    return {
      correction: validatePrimaryColorCorrection(
        composition.defaultPrimaryColor,
      ),
      source: "film",
    };
  return { correction: { ...PRIMARY_COLOR_IDENTITY }, source: "original" };
}
export function applyPrimaryColorPixel(
  rgba: readonly [number, number, number, number],
  coefficients: PrimaryColorCoefficients,
): [number, number, number, number] {
  return [
    ...coefficients.slopes.map((s, i) =>
      Math.floor(
        Math.max(0, Math.min(255, rgba[i]! * s + 255 * coefficients.offset)) +
          0.5,
      ),
    ),
    rgba[3],
  ] as [number, number, number, number];
}

/** Check even hidden/inactive recipes before direct rendering or interchange. */
export function assertPrimaryColorSettings(composition: Composition): void {
  if (composition.defaultPrimaryColor !== undefined)
    validatePrimaryColorCorrection(composition.defaultPrimaryColor);
  const entries = composition.beatPrimaryColors;
  if (entries !== undefined) {
    if (!Array.isArray(entries) || entries.length > 1000)
      throw new Error("Invalid scene primary color overrides.");
    const seen = new Set<string>();
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry.beatId !== "string" ||
        !entry.beatId.trim() ||
        seen.has(entry.beatId) ||
        Object.keys(entry).some(
          (key) => !["beatId", "correction"].includes(key),
        )
      )
        throw new Error("Invalid or duplicate scene primary color override.");
      seen.add(entry.beatId);
      validatePrimaryColorCorrection(entry.correction);
    }
  }
  for (const track of composition.tracks)
    for (const clip of track.clips)
      if (clip.primaryColor !== undefined)
        validatePrimaryColorCorrection(clip.primaryColor);
}
