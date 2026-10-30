// SPDX-License-Identifier: Apache-2.0
import type { BuiltinFilmLook, Clip, Composition, FilmLook } from "./models.js";
import { validateFilmLook } from "./validation.js";

export const FILM_LOOK_RECIPE_VERSION = 1 as const;
export const FILM_LOOK_MATRIX_DOMAIN = "encoded-sdr-rgb" as const;
export const FILM_LOOK_RECIPE_ORIGIN = "openfilm-original" as const;
export const FILM_LOOK_RECIPE_LICENSE = "Apache-2.0" as const;
/** Row-major SVG 4×5 coefficients; every public recipe has exactly 20 values. */
export type FilmLookMatrix = readonly number[];
const identity = Object.freeze([
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
]);

/**
 * Versioned original creative matrices on decoded, encoded-SDR RGB. The SVG
 * adapter uses browser sRGB; this is not universal transfer or color management.
 * Row four preserves alpha and each constant column is zero. Input alpha
 * supplies RGB lift so SVG and FFmpeg share the affine channel operation on
 * opaque source media. These recipes do not simulate a camera's response.
 */
export const FILM_LOOK_PRESETS: readonly {
  id: BuiltinFilmLook["preset"];
  matrix: readonly number[];
}[] = Object.freeze(
  (
    [
      { id: "none", matrix: identity },
      {
        id: "soft-film",
        matrix: [
          0.96, 0.02, 0.01, 0.035, 0, 0.015, 0.995, 0.02, 0.025, 0, 0.01, 0.025,
          0.92, 0.035, 0, 0, 0, 0, 1, 0,
        ],
      },
      {
        id: "americana",
        matrix: [
          1.12, 0.015, -0.015, -0.025, 0, 0.005, 1.05, 0, -0.02, 0, -0.005,
          0.005, 0.97, -0.035, 0, 0, 0, 0, 1, 0,
        ],
      },
      {
        id: "clean-camera",
        matrix: [
          1.06, -0.015, -0.005, -0.015, 0, -0.01, 1.055, -0.005, -0.01, 0,
          -0.005, -0.01, 1.07, -0.015, 0, 0, 0, 0, 1, 0,
        ],
      },
      {
        id: "retro",
        matrix: [
          0.94, 0.04, 0.005, 0.075, 0, 0.015, 0.91, 0.015, 0.055, 0, 0.025,
          0.06, 0.8, 0.045, 0, 0, 0, 0, 1, 0,
        ],
      },
      {
        id: "natural",
        matrix: [
          1.015, 0.005, -0.005, -0.002, 0, 0.002, 1.008, 0, 0.001, 0, 0, 0.003,
          1.005, -0.002, 0, 0, 0, 0, 1, 0,
        ],
      },
      {
        id: "sport",
        matrix: [
          1.26708624, -0.16993152, -0.01715472, -0.04, 0, -0.05051376,
          1.14766848, -0.01715472, -0.04, 0, -0.05051376, -0.16993152,
          1.30044528, -0.04, 0, 0, 0, 0, 1, 0,
        ],
      },
    ] satisfies { id: BuiltinFilmLook["preset"]; matrix: readonly number[] }[]
  ).map((entry) =>
    Object.freeze({ ...entry, matrix: Object.freeze(entry.matrix) }),
  ),
);

/** SVG 4×5 matrix, row-major. Clamp RGB after this operation; never change alpha. */
export function filmLookMatrix(value?: FilmLook | null): number[] {
  if (value == null) return [...identity];
  const look = validateFilmLook(value);
  const recipe = FILM_LOOK_PRESETS.find((preset) => preset.id === look.preset)!;
  if (look.strength === 0 || look.preset === "none") return [...identity];
  return recipe.matrix.map(
    (channel, index) =>
      identity[index]! + (channel - identity[index]!) * look.strength,
  );
}

export function isFilmLookActive(value?: FilmLook | null): boolean {
  if (value == null) return false;
  const look = validateFilmLook(value);
  return look.preset !== "none" && look.strength > 0;
}

export interface ResolvedFilmLook {
  look: FilmLook;
  source: "export" | "clip" | "beat" | "film" | "original";
}

/** `none` and strength zero intentionally stop inheritance at their own scope. */
export function resolveFilmLook(
  composition: Pick<Composition, "defaultLook" | "beatLooks">,
  clip: Pick<Clip, "look" | "beatId">,
  override?: FilmLook | null,
): ResolvedFilmLook {
  if (override != null)
    return { look: validateFilmLook(override), source: "export" };
  if (clip.look !== undefined)
    return { look: validateFilmLook(clip.look), source: "clip" };
  const beat = composition.beatLooks?.find(
    (entry) => entry.beatId === clip.beatId,
  );
  if (beat) return { look: validateFilmLook(beat.look), source: "beat" };
  if (composition.defaultLook !== undefined)
    return { look: validateFilmLook(composition.defaultLook), source: "film" };
  return {
    look: { version: 1, preset: "none", strength: 1 },
    source: "original",
  };
}
