// SPDX-License-Identifier: Apache-2.0
import {
  isFilmLookActive,
  isPrimaryColorActive,
  type FilmLook,
  type PrimaryColorCorrection,
} from "@openfilm/core";
export function sourceColorStyle(
  primary: PrimaryColorCorrection | undefined,
  look: FilmLook | undefined,
  ids: { primary: string; look: string },
  bypassLook = false,
): { filter?: string } {
  const filter = (id: string) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_:.-]*$/.test(id))
      throw new Error("Source color filter IDs must be locally generated.");
    return `url(#${id})`;
  };
  const filters = [
    ...(isPrimaryColorActive(primary) ? [filter(ids.primary)] : []),
    ...(!bypassLook && isFilmLookActive(look) ? [filter(ids.look)] : []),
  ];
  return filters.length ? { filter: filters.join(" ") } : {};
}
