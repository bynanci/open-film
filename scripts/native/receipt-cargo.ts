// SPDX-License-Identifier: Apache-2.0
// Modified by OpenFilm contributors on 2026-11-11. See LICENSE and NOTICE.
import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { runtimePath } from "../../apps/server/src/runtime-manifest.js";
import type { CargoEvidence } from "./attribution.js";
import { collectCargoEvidence } from "./cargo-attribution.js";
import { canonicalJson } from "./linkage.js";
import {
  exactKeys,
  MAX_ARTIFACT_BYTES,
  pinFile,
  readEvidence,
  readPinnedBytes,
  requireEvidence,
  verifyPin,
  type FilePin,
} from "./receipt-contract.js";
export interface CargoReplayInputs {
  schemaVersion: 1;
  target: string;
  targetDirectory: string;
  metadata: FilePin;
  messages: FilePin;
  lock: FilePin;
  invocation: FilePin;
  shell: FilePin;
}
/** A derived inventory is accepted only if the original collector reproduces it. */
export async function verifyCandidateCargo(
  root: string,
  input: FilePin,
  expected: CargoEvidence,
  expectedTargetDirectory?: string,
): Promise<CargoEvidence> {
  const inputs = await readEvidence<CargoReplayInputs>(root, input);
  exactKeys(inputs, [
    "schemaVersion",
    "target",
    "targetDirectory",
    "metadata",
    "messages",
    "lock",
    "invocation",
    "shell",
  ]);
  requireEvidence(
    inputs.schemaVersion === 1 &&
      inputs.target === expected.target &&
      expected.observationMode === "executed",
    "Cargo replay target/mode mismatch",
  );
  const targetDirectory = runtimePath(root, inputs.targetDirectory);
  requireEvidence(
    !expectedTargetDirectory ||
      inputs.targetDirectory === expectedTargetDirectory,
    "Cargo replay target directory mismatch",
  );
  const raw = [
    inputs.metadata,
    inputs.messages,
    inputs.lock,
    inputs.invocation,
  ];
  requireEvidence(
    new Set([...raw, inputs.shell].map((pin) => pin.path)).size === 5,
    "Duplicate Cargo input roles",
  );
  for (const pin of raw) await verifyPin(root, pin);
  await verifyPin(root, inputs.shell, MAX_ARTIFACT_BYTES);
  requireEvidence(
    inputs.shell.sha256 === expected.shell.sha256,
    "Cargo replay shell mismatch",
  );
  // Original package manifests must remain inside the selected input root.
  // The collector independently inventories and validates their complete source
  // trees, lock identities, compiler messages, output files and link directives.
  const metadata = await readEvidence<{
    packages: { manifest_path: string }[];
  }>(root, inputs.metadata);
  requireEvidence(
    Array.isArray(metadata.packages) && metadata.packages.length <= 2000,
    "Cargo package inventory limit",
  );
  for (const pkg of metadata.packages) {
    requireEvidence(
      typeof pkg.manifest_path === "string" && isAbsolute(pkg.manifest_path),
      "Cargo manifest must use the original absolute path",
    );
    await pinFile(
      root,
      relative(root, pkg.manifest_path).replaceAll("\\", "/"),
    );
  }
  const seen = new Set<string>();
  let artifactBytes = 0;
  async function boundArtifact(path: string): Promise<void> {
    requireEvidence(
      typeof path === "string" && isAbsolute(path),
      "Cargo artifact must use the original absolute path",
    );
    const child = relative(targetDirectory, path).replaceAll("\\", "/");
    runtimePath(targetDirectory, child);
    const local = relative(root, path).replaceAll("\\", "/");
    if (seen.has(local)) return;
    seen.add(local);
    requireEvidence(seen.size <= 20000, "Cargo reference inventory limit");
    const info = await lstat(runtimePath(root, local));
    requireEvidence(!info.isSymbolicLink(), "Cargo artifact alias");
    if (info.isDirectory()) {
      for (const name of await readdir(path))
        await boundArtifact(runtimePath(path, name));
    } else {
      const pin = await pinFile(root, local, MAX_ARTIFACT_BYTES);
      artifactBytes += pin.size;
      requireEvidence(
        artifactBytes <= 16 * 1024 ** 3,
        "Cargo referenced artifact byte limit",
      );
    }
  }
  const messages = (await readPinnedBytes(root, inputs.messages))
    .toString("utf8")
    .split(/\r?\n/u)
    .filter(Boolean);
  requireEvidence(messages.length <= 20000, "Cargo message inventory limit");
  for (const line of messages) {
    const message = JSON.parse(line) as {
      reason?: string;
      filenames?: string[];
      out_dir?: string;
    };
    if (message.reason === "compiler-artifact") {
      requireEvidence(
        Array.isArray(message.filenames),
        "Missing Cargo artifact filenames",
      );
      for (const path of message.filenames) await boundArtifact(path);
    }
    if (message.reason === "build-script-executed" && message.out_dir)
      await boundArtifact(message.out_dir);
  }
  const actual = await collectCargoEvidence({
    root,
    target: inputs.target,
    targetDirectory,
    metadata: runtimePath(root, inputs.metadata.path),
    messages: runtimePath(root, inputs.messages.path),
    lock: runtimePath(root, inputs.lock.path),
    invocation: runtimePath(root, inputs.invocation.path),
    shell: runtimePath(root, inputs.shell.path),
    observationMode: "executed",
  });
  for (const pin of raw) await verifyPin(root, pin);
  await verifyPin(root, inputs.shell, MAX_ARTIFACT_BYTES);
  requireEvidence(
    canonicalJson(actual) === canonicalJson(expected),
    "Reconstructed Cargo inventory mismatch",
  );
  return actual;
}
