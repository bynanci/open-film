// SPDX-License-Identifier: Apache-2.0
import {
  isPrimaryColorActive,
  primaryColorCoefficients,
  type PrimaryColorCorrection,
} from "@openfilm/core";

/** Bounded numeric input only. Primary clamps before the separate creative look. */
export function primaryColorFilters(
  value?: PrimaryColorCorrection | null,
): string[] {
  if (!isPrimaryColorActive(value)) return [];
  const { slopes, offset } = primaryColorCoefficients(value);
  const expressions = ["r", "g", "b"].map(
    (name, i) =>
      `${name}='floor(clip(val*${slopes[i]}+maxval*${offset},0,maxval)+0.5)'`,
  );
  return ["format=rgba", `lutrgb=${expressions.join(":")}:a=val`];
}
