// SPDX-License-Identifier: Apache-2.0
// Modified by OpenFilm contributors on 2026-11-11. See LICENSE and NOTICE.
import { resolve } from "node:path";
import { runtimePath } from "../../apps/server/src/runtime-manifest.js";
import type { CargoRecordedPathRole } from "./cargo-attribution.js";
import { exactKeys, requireEvidence } from "./receipt-contract.js";
export interface CargoPathMapping {
  syntax: "win32" | "posix";
  repositoryRoot: string;
  targetDirectory: string;
  externalRoots: { originalRoot: string; localRoot: string }[];
}
/** Lexical recorded paths use the build OS rules, never the replay host rules. */
export function createCargoPathResolver(
  root: string,
  targetDirectory: string,
  value: unknown,
) {
  exactKeys(value, [
    "syntax",
    "repositoryRoot",
    "targetDirectory",
    "externalRoots",
  ]);
  requireEvidence(
    value.syntax === "win32" || value.syntax === "posix",
    "Unknown recorded Cargo path syntax",
  );
  const windows = value.syntax === "win32";
  const key = (path: string) => (windows ? path.toLowerCase() : path);
  function original(path: unknown): string {
    requireEvidence(
      typeof path === "string" && path.length <= 1024,
      "Invalid recorded Cargo path",
    );
    const normalized = windows ? path.replaceAll("\\", "/") : path;
    requireEvidence(
      windows
        ? /^[A-Za-z]:\//u.test(normalized)
        : normalized.startsWith("/") && !normalized.includes("\\"),
      "Recorded Cargo path must be absolute in its declared syntax",
    );
    const suffix = normalized.slice(windows ? 3 : 1);
    requireEvidence(
      suffix.length > 0,
      "Recorded Cargo root cannot be a volume root",
    );
    // Check every segment before any normalization could erase traversal or
    // separators. This also excludes UNC/device paths, ADS and reserved names.
    for (const segment of suffix.split("/")) runtimePath("/recorded", segment);
    return windows
      ? normalized[0]!.toUpperCase() + normalized.slice(1)
      : normalized;
  }
  const within = (parent: string, child: string) =>
    key(child) === key(parent) || key(child).startsWith(`${key(parent)}/`);
  const repository = original(value.repositoryRoot);
  const target = original(value.targetDirectory);
  requireEvidence(
    Array.isArray(value.externalRoots) && value.externalRoots.length <= 32,
    "Cargo root mapping limit",
  );
  const externals = value.externalRoots.map((item) => {
    exactKeys(item, ["originalRoot", "localRoot"]);
    const recorded = original(item.originalRoot);
    requireEvidence(
      typeof item.localRoot === "string",
      "Invalid local Cargo root",
    );
    runtimePath(root, item.localRoot);
    return { originalRoot: recorded, localRoot: item.localRoot };
  });
  const recordedRoots = [
    repository,
    ...externals.map((item) => item.originalRoot),
  ];
  for (let i = 0; i < recordedRoots.length; i++)
    for (let j = i + 1; j < recordedRoots.length; j++)
      requireEvidence(
        !within(recordedRoots[i]!, recordedRoots[j]!) &&
          !within(recordedRoots[j]!, recordedRoots[i]!),
        "Overlapping original Cargo roots",
      );
  for (let i = 0; i < externals.length; i++)
    for (let j = i + 1; j < externals.length; j++)
      requireEvidence(
        !within(externals[i]!.localRoot, externals[j]!.localRoot) &&
          !within(externals[j]!.localRoot, externals[i]!.localRoot),
        "Overlapping local Cargo roots",
      );
  const originalToLocal = new Map<string, string>();
  const localToOriginal = new Map<string, string>();
  function resolveRecordedPath(
    path: string,
    role: CargoRecordedPathRole,
  ): string {
    const recorded = original(path);
    const inRepository = within(repository, recorded);
    requireEvidence(
      role !== "workspace" || inRepository,
      "Workspace Cargo source outside original repository",
    );
    requireEvidence(
      role !== "artifact" || within(target, recorded),
      "Cargo artifact outside original target directory",
    );
    let local: string;
    if (inRepository) {
      const suffix = recorded.slice(repository.length + 1);
      requireEvidence(
        !externals.some((item) => within(item.localRoot, suffix)),
        "Original repository path aliases a reserved external Cargo root",
      );
      local = suffix ? runtimePath(root, suffix) : resolve(root);
    } else {
      const mapping = externals.find((item) =>
        within(item.originalRoot, recorded),
      );
      requireEvidence(mapping, "Unknown original Cargo path root");
      const suffix = recorded.slice(mapping.originalRoot.length + 1);
      local = runtimePath(
        root,
        suffix ? `${mapping.localRoot}/${suffix}` : mapping.localRoot,
      );
    }
    const originalKey = key(recorded),
      localKey = key(local);
    requireEvidence(
      !originalToLocal.has(originalKey) ||
        originalToLocal.get(originalKey) === local,
      "Case alias in recorded Cargo path",
    );
    requireEvidence(
      !localToOriginal.has(localKey) ||
        localToOriginal.get(localKey) === originalKey,
      "Cargo path mapping collision",
    );
    originalToLocal.set(originalKey, local);
    localToOriginal.set(localKey, originalKey);
    return local;
  }
  requireEvidence(
    resolveRecordedPath(target, "artifact") === resolve(targetDirectory),
    "Recorded/local Cargo target directory mismatch",
  );
  return resolveRecordedPath;
}
