// SPDX-License-Identifier: Apache-2.0
// Modified by OpenFilm contributors on 2026-11-11. See LICENSE and NOTICE.
import { lstat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";
import { runtimePath } from "../../apps/server/src/runtime-manifest.js";
import type { CargoEvidence } from "./attribution.js";
import { collectCargoEvidence } from "./cargo-attribution.js";
import {
  createCargoPathResolver,
  type CargoPathMapping,
} from "./receipt-paths.js";
import { canonicalJson } from "./linkage.js";
import {
  exactKeys,
  MAX_ARTIFACT_BYTES,
  pinFile,
  readEvidence,
  readPinnedBytes,
  requireEvidence,
  verifyPin,
  type CandidateIdentity,
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
  pathMapping?: CargoPathMapping;
}

/** Bind replay roles to the same-build raw inputs named by candidate identity. */
export async function verifyCargoReplayAgainstCapture(
  root: string,
  inputPin: FilePin,
  identity: CandidateIdentity,
): Promise<void> {
  requireEvidence(
    identity.buildEvidence,
    "Same-build Cargo capture required for finalization",
  );
  const inputs = await readEvidence<CargoReplayInputs>(root, inputPin);
  const capture = await readEvidence<{
    candidateSha: string;
    target: string;
    metadata: {
      path: string;
      sha256: string;
      targetDirectory: string;
      recordedTargetDirectory: string;
      targetInputsDirectory: string;
    };
    invocation: { path: string; sha256: string };
    compilerMessages: { path: string; sha256: string };
    lock: { path: string; sha256: string };
    shell: { path: string; sha256: string; size: number };
    targetInputs: {
      path: string;
      capturePath: string;
      sha256: string;
      size: number;
    }[];
  }>(root, identity.buildEvidence);
  requireEvidence(
    capture.candidateSha === identity.candidateSha &&
      capture.target === identity.target.triple &&
      inputs.target === capture.target,
    "Cargo replay candidate/target differs from same-build capture",
  );
  const captureDirectory = dirname(identity.buildEvidence.path);
  for (const [role, captured] of [
    ["metadata", capture.metadata],
    ["messages", capture.compilerMessages],
    ["lock", capture.lock],
    ["invocation", capture.invocation],
  ] as const) {
    const replay = inputs[role];
    requireEvidence(
      replay.path === `${captureDirectory}/${captured.path}` &&
        replay.sha256 === captured.sha256,
      `Cargo replay ${role} pin differs from same-build capture`,
    );
  }
  requireEvidence(
    capture.metadata.targetDirectory === "apps/desktop/src-tauri/target" &&
      typeof capture.metadata.recordedTargetDirectory === "string" &&
      capture.metadata.targetInputsDirectory === "target-files",
    "Invalid same-build Cargo target directory identity",
  );
  if (inputs.pathMapping) {
    requireEvidence(
      inputs.targetDirectory ===
        `${captureDirectory}/${capture.metadata.targetInputsDirectory}` &&
        inputs.pathMapping.targetDirectory ===
          capture.metadata.recordedTargetDirectory,
      "Cargo replay path mapping differs from same-build target directory",
    );
  } else {
    requireEvidence(
      inputs.targetDirectory === capture.metadata.targetDirectory,
      "Cargo replay target directory differs from same-build capture",
    );
  }
  const targetShellPath = identity.shell.path.replace(
    "apps/desktop/src-tauri/",
    "",
  );
  const capturedShell = capture.targetInputs.find(
    (input) =>
      input.path === targetShellPath &&
      input.sha256 === identity.shell.sha256 &&
      input.size === identity.shell.size,
  );
  requireEvidence(
    capture.shell.path === identity.shell.path &&
      capture.shell.sha256 === identity.shell.sha256 &&
      inputs.shell.sha256 === identity.shell.sha256 &&
      (inputs.pathMapping
        ? inputs.shell.path ===
          `${captureDirectory}/${capturedShell?.capturePath}`
        : inputs.shell.path === identity.shell.path) &&
      capturedShell,
    "Cargo replay shell differs from same-build capture",
  );
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
    ...(Object.hasOwn(inputs, "pathMapping") ? ["pathMapping"] : []),
  ]);
  requireEvidence(
    inputs.schemaVersion === 1 &&
      inputs.target === expected.target &&
      expected.observationMode === "executed",
    "Cargo replay target/mode mismatch",
  );
  const targetDirectory = runtimePath(root, inputs.targetDirectory);
  const resolveRecordedPath = Object.hasOwn(inputs, "pathMapping")
    ? createCargoPathResolver(root, targetDirectory, inputs.pathMapping)
    : undefined;
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
  // Resolved package manifest bytes remain inside the selected input root.
  // The collector independently inventories and validates their complete source
  // trees, lock identities, compiler messages, output files and link directives.
  const metadata = await readEvidence<{
    packages: { manifest_path: string; source: string | null }[];
    target_directory?: string;
  }>(root, inputs.metadata);
  requireEvidence(
    Array.isArray(metadata.packages) && metadata.packages.length <= 2000,
    "Cargo package inventory limit",
  );
  for (const pkg of metadata.packages) {
    requireEvidence(
      typeof pkg.manifest_path === "string" &&
        (resolveRecordedPath || isAbsolute(pkg.manifest_path)),
      "Cargo manifest must use the original absolute path",
    );
    const local = resolveRecordedPath
      ? resolveRecordedPath(
          pkg.manifest_path,
          pkg.source === null ? "workspace" : "registry",
        )
      : pkg.manifest_path;
    await pinFile(root, relative(root, local).replaceAll("\\", "/"));
  }
  if (resolveRecordedPath) {
    requireEvidence(
      typeof metadata.target_directory === "string" &&
        resolveRecordedPath(metadata.target_directory, "artifact") ===
          targetDirectory,
      "Original Cargo metadata target directory mismatch",
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
      for (const path of message.filenames)
        await boundArtifact(
          resolveRecordedPath ? resolveRecordedPath(path, "artifact") : path,
        );
    }
    if (message.reason === "build-script-executed" && message.out_dir)
      await boundArtifact(
        resolveRecordedPath
          ? resolveRecordedPath(message.out_dir, "artifact")
          : message.out_dir,
      );
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
    resolveRecordedPath,
  });
  for (const pin of raw) await verifyPin(root, pin);
  await verifyPin(root, inputs.shell, MAX_ARTIFACT_BYTES);
  requireEvidence(
    canonicalJson(actual) === canonicalJson(expected),
    "Reconstructed Cargo inventory mismatch",
  );
  return actual;
}
