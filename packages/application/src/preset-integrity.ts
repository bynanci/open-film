// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import {
  ApplicationError,
  assertPresetJsonData,
  canonicalPresetId,
  canonicalPresetJson,
  presetRecipeHashInput,
  presetSnapshotHashInput,
  projectPresetSnapshots,
  validatePresetPackage,
  validatePresetSnapshot,
  type OpenFilmProject,
  type PresetPackageV1,
  type PresetEntry,
  type PresetKind,
  type PresetSnapshot,
} from "@openfilm/core";
export function hashPresetData(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
export function createPresetSnapshot<K extends PresetKind>(
  packageValue: PresetPackageV1,
  entry: PresetEntry & { kind: K },
): PresetSnapshot<K> {
  const p = validatePresetPackage(packageValue),
    e = p.entries.find((e) => e.id === entry.id && e.kind === entry.kind);
  if (!e)
    throw new ApplicationError(
      "presets.invalid",
      "Preset entry is not in the reviewed package.",
    );
  const snapshot = {
    version: 1 as const,
    canonicalId: canonicalPresetId(p.id, p.version, e.kind, e.id),
    packageId: p.id,
    packageVersion: p.version,
    packageSha256: hashPresetData(canonicalPresetJson(p)),
    entryId: e.id,
    kind: e.kind,
    name: e.name,
    license: p.license,
    provenance: p.provenance,
    recipe: e.recipe,
    recipeSha256: hashPresetData(presetRecipeHashInput(e.recipe)),
    snapshotSha256: "0".repeat(64),
  } as PresetSnapshot<K>;
  snapshot.snapshotSha256 = hashPresetData(presetSnapshotHashInput(snapshot));
  return validatePresetSnapshot(snapshot, entry.kind);
}
export function assertPresetSnapshotIntegrity(value: PresetSnapshot): void {
  assertPresetJsonData(value);
  const s = validatePresetSnapshot(value, value.kind);
  if (
    hashPresetData(presetRecipeHashInput(s.recipe)) !== s.recipeSha256 ||
    hashPresetData(presetSnapshotHashInput(s)) !== s.snapshotSha256
  )
    throw new ApplicationError(
      "presets.invalid",
      "Saved preset snapshot integrity hash does not match its data.",
    );
}
export function assertProjectPresetIntegrity(project: OpenFilmProject): void {
  for (const snapshot of projectPresetSnapshots(project))
    assertPresetSnapshotIntegrity(snapshot);
}
