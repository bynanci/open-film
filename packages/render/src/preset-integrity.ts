// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import {
  ApplicationError,
  compositionPresetSnapshots,
  presetRecipeHashInput,
  presetSnapshotHashInput,
  validatePresetSnapshot,
  type Composition,
  type FilmLook,
  type PresetSnapshot,
} from "@openfilm/core";
/** Render is independently callable: never rely on a prior application check. */
export function assertRenderPresetSnapshot(value: PresetSnapshot): void {
  const snapshot = validatePresetSnapshot(value, value.kind),
    hash = (text: string) =>
      createHash("sha256").update(text, "utf8").digest("hex");
  if (
    hash(presetRecipeHashInput(snapshot.recipe)) !== snapshot.recipeSha256 ||
    hash(presetSnapshotHashInput(snapshot)) !== snapshot.snapshotSha256
  )
    throw new ApplicationError(
      "presets.invalid",
      "Render preset snapshot integrity hash does not match its data.",
    );
}
export function renderPresetSnapshots(
  composition: Composition,
  override?: FilmLook | null,
): PresetSnapshot[] {
  const values = compositionPresetSnapshots(composition);
  if (override?.version === 2) values.push(override.snapshot);
  const unique = new Map<string, PresetSnapshot>();
  for (const s of values) {
    assertRenderPresetSnapshot(s);
    unique.set(s.snapshotSha256, s);
  }
  return [...unique.values()];
}
