// SPDX-License-Identifier: Apache-2.0
// Modified by OpenFilm contributors on 2026-11-11. See LICENSE and NOTICE.
import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { runtimePath } from "../../apps/server/src/runtime-manifest.js";
import { assertRegularInput } from "./input-files.js";
import { canonicalJson } from "./linkage.js";

export const MAX_EVIDENCE_BYTES = 8 * 1024 ** 2;
export const MAX_ARTIFACT_BYTES = 4 * 1024 ** 3;
export interface FilePin {
  path: string;
  sha256: string;
  size: number;
}
export interface CandidateTarget {
  platform: "linux" | "darwin" | "win32";
  architecture: "x64" | "arm64";
  triple: string;
  abi: string;
}
export interface CandidateIdentity {
  schemaVersion: 1;
  kind: "native-candidate-identity";
  disposition: "incomplete";
  distributionApproved: false;
  candidateSha: string;
  target: CandidateTarget;
  runtimeRoot: string;
  runtimeManifest: FilePin;
  shell: FilePin;
  installers: FilePin[];
  buildEvidence?: FilePin;
  automaticUpdates: false;
}
export interface FinalBytes {
  schemaVersion: 1;
  kind: "native-final-bytes";
  disposition: "incomplete";
  distributionApproved: false;
  candidateIdentitySha256: string;
  runtimeManifest: FilePin;
  shell: FilePin;
  installers: FilePin[];
  artifactsSha256: string;
}
export type ObservationKind = "security" | "trust" | "lifecycle";
export interface Observation {
  schemaVersion: 1;
  kind: ObservationKind;
  candidateSha: string;
  candidateIdentitySha256: string;
  finalArtifactsSha256: string;
  target: CandidateTarget;
  observationMode: "executed";
  status: "passed";
  observedAt: string;
  observer: string;
  tool: string;
  toolVersion: string;
  checks: string[];
  raw: FilePin[];
}
export interface IndependentReview {
  schemaVersion: 1;
  kind: "native-candidate-review";
  candidateSha: string;
  candidateIdentitySha256: string;
  finalArtifactsSha256: string;
  target: CandidateTarget;
  disposition: "reviewed";
  observationMode: "executed";
  reviewer: string;
  reviewedAt: string;
  subjects: FilePin[];
  raw: FilePin[];
}
export const REQUIRED_CHECKS: Record<ObservationKind, readonly string[]> = {
  security: ["source-admission", "post-build-scan", "dependency-closure"],
  trust: ["signature", "publisher", "os-trust"],
  lifecycle: [
    "install",
    "launch",
    "close",
    "reopen",
    "uninstall",
    "original-media-preserved",
  ],
};
export function requireEvidence(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}
export function exactKeys(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  requireEvidence(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected evidence object",
  );
  const actual = Object.keys(value);
  requireEvidence(
    actual.length === keys.length && actual.every((key) => keys.includes(key)),
    "Unknown or missing evidence fields",
  );
}
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
export function validatePin(
  value: unknown,
  maxBytes = MAX_EVIDENCE_BYTES,
): asserts value is FilePin {
  exactKeys(value, ["path", "sha256", "size"]);
  requireEvidence(typeof value.path === "string", "Invalid evidence path");
  runtimePath("/evidence", value.path);
  requireEvidence(
    validHash(value.sha256) &&
      Number.isSafeInteger(value.size) &&
      Number(value.size) >= 0 &&
      Number(value.size) <= maxBytes,
    "Invalid evidence hash/size",
  );
}
/** Bound reads happen through the same regular-file handle used for hashing. */
async function fileBytes(
  root: string,
  path: string,
  maxBytes: number,
  retain: boolean,
) {
  const source = runtimePath(root, path);
  await assertRegularInput(source);
  const handle = await open(source, "r");
  try {
    const before = await handle.stat();
    requireEvidence(
      before.isFile() &&
        before.nlink === 1 &&
        before.size >= 0 &&
        before.size <= maxBytes,
      "Evidence must be a bounded regular file",
    );
    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      const bytes = chunk as Buffer;
      size += bytes.length;
      requireEvidence(size <= maxBytes, "Evidence exceeded byte limit");
      hash.update(bytes);
      if (retain) chunks.push(bytes);
    }
    const after = await handle.stat();
    const current = await lstat(source);
    await assertRegularInput(source);
    requireEvidence(
      current.ino === before.ino &&
        current.dev === before.dev &&
        current.size === before.size &&
        size === before.size &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      "Evidence changed during read",
    );
    return {
      pin: { path, sha256: hash.digest("hex"), size },
      bytes: Buffer.concat(chunks),
    };
  } finally {
    await handle.close();
  }
}
export async function pinFile(
  root: string,
  path: string,
  maxBytes = MAX_EVIDENCE_BYTES,
): Promise<FilePin> {
  return (await fileBytes(root, path, maxBytes, false)).pin;
}
export async function verifyPin(
  root: string,
  pin: FilePin,
  maxBytes = MAX_EVIDENCE_BYTES,
): Promise<void> {
  validatePin(pin, maxBytes);
  requireEvidence(
    canonicalJson(await pinFile(root, pin.path, maxBytes)) ===
      canonicalJson(pin),
    "Pinned evidence hash/size mismatch",
  );
}
export async function readPinnedBytes(
  root: string,
  pin: FilePin,
): Promise<Buffer> {
  validatePin(pin);
  const actual = await fileBytes(root, pin.path, MAX_EVIDENCE_BYTES, true);
  requireEvidence(
    canonicalJson(actual.pin) === canonicalJson(pin),
    "Pinned evidence hash/size mismatch",
  );
  return actual.bytes;
}
export async function readEvidence<T = unknown>(
  root: string,
  pin: FilePin,
): Promise<T> {
  return JSON.parse((await readPinnedBytes(root, pin)).toString("utf8")) as T;
}
export function validateTarget(
  value: unknown,
): asserts value is CandidateTarget {
  exactKeys(value, ["platform", "architecture", "triple", "abi"]);
  requireEvidence(
    ["linux", "darwin", "win32"].includes(String(value.platform)) &&
      ["x64", "arm64"].includes(String(value.architecture)),
    "Unsupported candidate target",
  );
  const triple = `${value.architecture === "x64" ? "x86_64" : "aarch64"}-${value.platform === "linux" ? "unknown-linux-gnu" : value.platform === "darwin" ? "apple-darwin" : "pc-windows-msvc"}`;
  requireEvidence(
    value.triple === triple &&
      typeof value.abi === "string" &&
      value.abi.length > 0 &&
      value.abi.length <= 160,
    "Target triple/ABI mismatch",
  );
}
export function validateIdentity(
  value: unknown,
): asserts value is CandidateIdentity {
  const identityKeys = [
    "schemaVersion",
    "kind",
    "disposition",
    "distributionApproved",
    "candidateSha",
    "target",
    "runtimeRoot",
    "runtimeManifest",
    "shell",
    "installers",
    "automaticUpdates",
  ];
  const hasBuildEvidence =
    value !== null &&
    typeof value === "object" &&
    Object.hasOwn(value, "buildEvidence");
  if (hasBuildEvidence) identityKeys.push("buildEvidence");
  exactKeys(value, identityKeys);
  requireEvidence(
    value.schemaVersion === 1 &&
      value.kind === "native-candidate-identity" &&
      value.disposition === "incomplete" &&
      value.distributionApproved === false &&
      value.automaticUpdates === false &&
      typeof value.candidateSha === "string" &&
      /^[a-f0-9]{40}$/u.test(value.candidateSha),
    "Invalid candidate identity",
  );
  validateTarget(value.target);
  requireEvidence(
    typeof value.runtimeRoot === "string",
    "Missing runtime root",
  );
  runtimePath("/evidence", value.runtimeRoot);
  validatePin(value.runtimeManifest);
  requireEvidence(
    value.runtimeManifest.path === `${value.runtimeRoot}/runtime-manifest.json`,
    "Runtime manifest path mismatch",
  );
  validateArtifacts(value.shell, value.installers);
  const identity = value as unknown as CandidateIdentity;
  if (hasBuildEvidence) validatePin(identity.buildEvidence);
  const paths = [
    identity.runtimeManifest,
    identity.shell,
    ...identity.installers,
    ...(hasBuildEvidence ? [identity.buildEvidence!] : []),
  ].map((p) => p.path);
  requireEvidence(
    new Set(paths).size === paths.length &&
      paths.slice(1).every((path) => !path.startsWith(`${value.runtimeRoot}/`)),
    "Candidate artifacts overlap runtime or each other",
  );
}
function validateArtifacts(
  shell: unknown,
  installers: unknown,
): asserts installers is FilePin[] {
  validatePin(shell, MAX_ARTIFACT_BYTES);
  requireEvidence(shell.size > 0, "Empty native shell");
  requireEvidence(
    Array.isArray(installers) &&
      installers.length > 0 &&
      installers.length <= 16,
    "Missing or excessive installers",
  );
  for (const installer of installers) {
    validatePin(installer, MAX_ARTIFACT_BYTES);
    requireEvidence(installer.size > 0, "Empty installer");
  }
  requireEvidence(
    installers.every((p) =>
      /\.(?:deb|rpm|AppImage|exe|msi|dmg)$/u.test(p.path),
    ),
    "Unsupported installer artifact",
  );
  requireEvidence(
    installers.reduce((sum, p) => sum + p.size, shell.size) <= 8 * 1024 ** 3,
    "Candidate total byte limit",
  );
}
export function artifactDigest(
  value: Pick<FinalBytes, "shell" | "installers" | "runtimeManifest">,
): string {
  return digest({
    runtimeManifest: value.runtimeManifest,
    shell: value.shell,
    installers: value.installers,
  });
}
export function validateFinalBytes(
  value: unknown,
  identity: CandidateIdentity,
  identityHash: string,
): asserts value is FinalBytes {
  exactKeys(value, [
    "schemaVersion",
    "kind",
    "disposition",
    "distributionApproved",
    "candidateIdentitySha256",
    "runtimeManifest",
    "shell",
    "installers",
    "artifactsSha256",
  ]);
  requireEvidence(
    value.schemaVersion === 1 &&
      value.kind === "native-final-bytes" &&
      value.disposition === "incomplete" &&
      value.distributionApproved === false &&
      value.candidateIdentitySha256 === identityHash,
    "Final bytes candidate mismatch",
  );
  validateArtifacts(value.shell, value.installers);
  validatePin(value.runtimeManifest);
  const final = value as unknown as FinalBytes;
  requireEvidence(
    canonicalJson(final.runtimeManifest) ===
      canonicalJson(identity.runtimeManifest) &&
      final.shell.path === identity.shell.path &&
      canonicalJson(final.installers.map((p) => p.path)) ===
        canonicalJson(identity.installers.map((p) => p.path)) &&
      final.artifactsSha256 === artifactDigest(final),
    "Final artifact/runtime identity mismatch",
  );
}
export function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 500 &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  );
}
export function validTime(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
export function validateObservation(
  value: unknown,
  kind: ObservationKind,
  identity: CandidateIdentity,
  final: FinalBytes,
): Observation {
  exactKeys(value, [
    "schemaVersion",
    "kind",
    "candidateSha",
    "candidateIdentitySha256",
    "finalArtifactsSha256",
    "target",
    "observationMode",
    "status",
    "observedAt",
    "observer",
    "tool",
    "toolVersion",
    "checks",
    "raw",
  ]);
  requireEvidence(
    value.schemaVersion === 1 &&
      value.kind === kind &&
      value.observationMode === "executed" &&
      value.status === "passed",
    "Incomplete or test-only observation",
  );
  requireEvidence(
    value.candidateSha === identity.candidateSha &&
      value.candidateIdentitySha256 === final.candidateIdentitySha256 &&
      value.finalArtifactsSha256 === final.artifactsSha256 &&
      canonicalJson(value.target) === canonicalJson(identity.target),
    "Observation candidate/target/final bytes mismatch",
  );
  requireEvidence(
    validTime(value.observedAt) &&
      validText(value.observer) &&
      validText(value.tool) &&
      validText(value.toolVersion),
    "Missing observation provenance",
  );
  requireEvidence(
    Array.isArray(value.checks) &&
      value.checks.every(validText) &&
      REQUIRED_CHECKS[kind].every((check) =>
        (value.checks as unknown[]).includes(check),
      ),
    "Incomplete observation checks",
  );
  requireEvidence(
    Array.isArray(value.raw) && value.raw.length > 0 && value.raw.length <= 128,
    "Missing or excessive raw observations",
  );
  for (const pin of value.raw) validatePin(pin);
  requireEvidence(
    (value.raw as FilePin[]).some((pin) => pin.size > 0),
    "Empty raw observations",
  );
  requireEvidence(
    (value.raw as FilePin[]).reduce((sum, pin) => sum + pin.size, 0) <=
      64 * 1024 ** 2,
    "Observation total byte limit",
  );
  return value as unknown as Observation;
}
