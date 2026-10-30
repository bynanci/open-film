// SPDX-License-Identifier: Apache-2.0
import {
  filmLookMatrix,
  isFilmLookActive,
  type FilmLook,
  validateFilmLook,
} from "@openfilm/core";
import { assertRenderPresetSnapshot } from "./preset-integrity.js";

/** Apply the shared encoded SDR RGB matrix to each decoded source, preserving its alpha. */
export function filmLookFilters(look?: FilmLook | null): string[] {
  if (look != null) {
    look = validateFilmLook(look);
    if (look.version === 2) assertRenderPresetSnapshot(look.snapshot);
  }
  if (!isFilmLookActive(look)) return [];
  const matrix = filmLookMatrix(look);
  const channels = [
    ["rr", 0],
    ["rg", 1],
    ["rb", 2],
    ["ra", 3],
    ["gr", 5],
    ["gg", 6],
    ["gb", 7],
    ["ga", 8],
    ["br", 10],
    ["bg", 11],
    ["bb", 12],
    ["ba", 13],
  ] as const;
  return [
    "format=rgba",
    `colorchannelmixer=${channels.map(([name, index]) => `${name}=${matrix[index]}`).join(":")}:aa=1`,
  ];
}
