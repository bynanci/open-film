// SPDX-License-Identifier: Apache-2.0
// Modified by OpenFilm contributors on 2026-11-11. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  runtimePath,
  verifyRuntimeBundle,
} from "../../apps/server/src/runtime-manifest.js";
import {
  canonicalJson,
  verifyLinkageInputs,
  type LinkageEvidence,
} from "./linkage.js";
import { assertRegularInput } from "./input-files.js";
import { verifyCandidateAttribution } from "./receipt-attribution.js";
import { verifySecurityClosure } from "./receipt-security.js";
import {
  artifactDigest,
  exactKeys,
  MAX_ARTIFACT_BYTES,
  MAX_EVIDENCE_BYTES,
  pinFile,
  readEvidence,
  requireEvidence,
  validHash,
  validText,
  validTime,
  validateFinalBytes,
  validateIdentity,
  validateObservation,
  validatePin,
  validateTarget,
  verifyPin,
  type CandidateIdentity,
  type CandidateTarget,
  type FilePin,
  type FinalBytes,
  type IndependentReview,
  type ObservationKind,
} from "./receipt-contract.js";
/** Detach only Cargo's default build subject; all caller-selected inputs stay strict. */
async function prepareBuildShellAtPath(
  root: string,
  path: string,
  subject: "Default shell" | "Target shell",
): Promise<string> {
  const source = runtimePath(root, path);
  // The sole hardlink exception is a read-only source for this bounded copy.
  await assertRegularInput(source, false);
  const input = await open(source, "r");
  let output: Awaited<ReturnType<typeof open>> | undefined;
  let created: Stats | undefined;
  let promoted = false;
  const temporaryPath = `${path}.receipt-stage-${randomUUID()}`;
  const temporary = runtimePath(root, temporaryPath);
  const same = (a: Stats, b: Stats) =>
    ["dev", "ino", "size", "mode", "nlink", "mtimeMs", "ctimeMs"].every(
      (key) => a[key as keyof Stats] === b[key as keyof Stats],
    );
  try {
    const before = await input.stat();
    requireEvidence(
      before.isFile() &&
        before.nlink >= 1 &&
        before.size <= MAX_ARTIFACT_BYTES &&
        (before.mode & 0o7000) === 0,
      `${subject} must be a bounded ordinary build file`,
    );
    await assertRegularInput(source, false);
    requireEvidence(
      same(before, await lstat(source)),
      `${subject} changed before staging`,
    );
    if (before.nlink === 1) {
      await pinFile(root, path, MAX_ARTIFACT_BYTES);
      return path;
    }
    output = await open(temporary, "wx", before.mode & 0o777);
    created = await output.stat();
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of input.createReadStream({
      autoClose: false,
      start: 0,
    })) {
      const bytes = chunk as Buffer;
      size += bytes.length;
      requireEvidence(
        size <= MAX_ARTIFACT_BYTES && size <= before.size,
        `${subject} grew during staging`,
      );
      hash.update(bytes);
      await output.writeFile(bytes);
    }
    await output.chmod(before.mode & 0o777);
    await output.sync();
    await output.close();
    output = undefined;
    const expectedHash = hash.digest("hex");
    const staged = await pinFile(root, temporaryPath, MAX_ARTIFACT_BYTES);
    requireEvidence(
      size === before.size &&
        staged.size === size &&
        staged.sha256 === expectedHash,
      `${subject} staging byte mismatch`,
    );
    await assertRegularInput(source, false);
    requireEvidence(
      same(before, await input.stat()) && same(before, await lstat(source)),
      `${subject} changed during staging`,
    );
    // Same-path atomic replacement keeps the compiler ID, signing subject and
    // workflow upload path fixed. Never unlink first or fall back on Windows.
    await rename(temporary, source);
    promoted = true;
    const original = await input.stat();
    requireEvidence(
      original.size === before.size &&
        original.mode === before.mode &&
        original.mtimeMs === before.mtimeMs &&
        original.nlink === before.nlink - 1,
      `${subject} source changed during promotion`,
    );
    const pinned = await pinFile(root, path, MAX_ARTIFACT_BYTES);
    requireEvidence(
      pinned.sha256 === expectedHash &&
        pinned.size === size &&
        ((await lstat(source)).mode & 0o777) === (before.mode & 0o777),
      `${subject} promotion mismatch`,
    );
    return path;
  } finally {
    await output?.close();
    await input.close();
    if (created && !promoted) {
      const current = await lstat(temporary).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return undefined;
        },
      );
      if (current?.ino === created.ino && current.dev === created.dev)
        await unlink(temporary);
    }
  }
}
export async function prepareDefaultBuildShell(
  root: string,
  platform: CandidateTarget["platform"],
): Promise<string> {
  requireEvidence(
    ["linux", "darwin", "win32"].includes(platform),
    "Unknown default shell platform",
  );
  const path =
    "apps/desktop/src-tauri/target/release/openfilm-desktop" +
    (platform === "win32" ? ".exe" : "");
  return prepareBuildShellAtPath(root, path, "Default shell");
}
export async function prepareTargetBuildShell(
  root: string,
  target: string,
): Promise<string> {
  requireEvidence(
    /^(?:x86_64|aarch64)-(?:unknown-linux-gnu|apple-darwin|pc-windows-msvc)$/u.test(
      target,
    ),
    "Unsupported native target",
  );
  const path =
    `apps/desktop/src-tauri/target/${target}/release/openfilm-desktop` +
    (target.endsWith("windows-msvc") ? ".exe" : "");
  return prepareBuildShellAtPath(root, path, "Target shell");
}
export interface IdentityOptions {
  candidateSha: string;
  target: CandidateTarget;
  runtimeRoot: string;
  shellPath: string;
  installerPaths: string[];
  buildEvidencePath?: string;
}
export interface FinalizationInputs {
  schemaVersion: 1;
  candidate: FilePin;
  finalBytes: FilePin;
  attribution: FilePin;
  finalLinkagePolicy: FilePin;
  finalLinkage: FilePin;
  security: FilePin;
  trust: FilePin;
  lifecycle: FilePin;
  review: FilePin;
}
async function runtime(root: string, identity: CandidateIdentity) {
  await verifyPin(root, identity.runtimeManifest);
  await verifyBuildEvidence(root, identity);
  return verifyRuntimeBundle(runtimePath(root, identity.runtimeRoot), {
    manifestSha256: identity.runtimeManifest.sha256,
    platform: identity.target.platform,
    architecture: identity.target.architecture,
  });
}

async function verifyBuildEvidence(
  root: string,
  identity: CandidateIdentity,
): Promise<void> {
  if (!identity.buildEvidence) return;
  const capture = await readEvidence<{
    schemaVersion: number;
    kind: string;
    candidateSha: string;
    target: string;
    rustcVersion: string;
    cargoVersion: string;
    invocation: { path: string; sha256: string };
    metadata: {
      path: string;
      sha256: string;
      targetDirectory: string;
      recordedTargetDirectory: string;
      recordedWorkspaceRoot: string;
      targetInputsDirectory: string;
    };
    metadataInvocation: { path: string; sha256: string };
    metadataStderr: { path: string; sha256: string };
    compilerMessages: { path: string; sha256: string };
    compilerStderr: { path: string; sha256: string };
    toolchain: { path: string; sha256: string };
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
    capture.schemaVersion === 1 &&
      capture.kind === "native-cargo-build-capture" &&
      capture.candidateSha === identity.candidateSha &&
      capture.target === identity.target.triple &&
      typeof capture.rustcVersion === "string" &&
      capture.rustcVersion.startsWith("rustc 1.99.0") &&
      typeof capture.cargoVersion === "string" &&
      capture.cargoVersion.startsWith("cargo 1.99.0") &&
      capture.metadata?.path === "metadata.json" &&
      /^[a-f0-9]{64}$/u.test(capture.metadata.sha256) &&
      capture.metadata.targetDirectory === "apps/desktop/src-tauri/target" &&
      capture.metadata.targetInputsDirectory === "target-files" &&
      typeof capture.metadata.recordedTargetDirectory === "string" &&
      capture.metadata.recordedTargetDirectory.length > 0 &&
      typeof capture.metadata.recordedWorkspaceRoot === "string" &&
      capture.metadata.recordedWorkspaceRoot.length > 0 &&
      capture.shell.path === identity.shell.path &&
      capture.shell.sha256 === identity.shell.sha256 &&
      capture.shell.size === identity.shell.size,
    "Captured Cargo evidence does not match candidate identity",
  );
  const roles = [
    [capture.invocation, "invocation.json"],
    [capture.metadata, "metadata.json"],
    [capture.metadataInvocation, "metadata-invocation.json"],
    [capture.metadataStderr, "metadata-stderr.log"],
    [capture.compilerMessages, "compiler-messages.jsonl"],
    [capture.compilerStderr, "compiler-stderr.log"],
    [capture.toolchain, "toolchain.json"],
    [capture.lock, "Cargo.lock"],
  ] as const;
  requireEvidence(
    roles.every(
      ([role, path]) =>
        role.path === path && /^[a-f0-9]{64}$/u.test(role.sha256),
    ),
    "Captured Cargo evidence is missing a required raw input",
  );
  const captureDirectory = dirname(identity.buildEvidence.path);
  const rawPins = new Map<string, FilePin>();
  for (const [role] of roles) {
    const maximum =
      role.path === "metadata.json" ||
      role.path === "metadata-stderr.log" ||
      role.path === "compiler-messages.jsonl" ||
      role.path === "compiler-stderr.log" ||
      role.path === "Cargo.lock"
        ? 32 * 1024 ** 2
        : MAX_EVIDENCE_BYTES;
    const pin = await pinFile(
      root,
      `${captureDirectory}/${role.path}`,
      maximum,
    );
    requireEvidence(
      pin.sha256 === role.sha256,
      "Captured Cargo raw input differs from its manifest",
    );
    rawPins.set(role.path, pin);
  }
  const metadata = await readEvidence<{
    target_directory: string;
    workspace_root: string;
  }>(root, rawPins.get("metadata.json")!);
  const invocation = await readEvidence<{
    arguments: string[];
    cwd: string;
    exitCode: number;
    rustcVersion: string;
    cargoVersion: string;
    outputLimitExceeded: boolean;
  }>(root, rawPins.get("invocation.json")!);
  const metadataInvocation = await readEvidence<{
    arguments: string[];
    cwd: string;
    exitCode: number;
    cargoVersion: string;
    outputLimitExceeded: boolean;
  }>(root, rawPins.get("metadata-invocation.json")!);
  const targetIndex = invocation.arguments.indexOf("--target");
  requireEvidence(
    metadata.target_directory === capture.metadata.recordedTargetDirectory &&
      metadata.workspace_root === capture.metadata.recordedWorkspaceRoot &&
      invocation.cwd === metadata.workspace_root &&
      metadataInvocation.cwd === metadata.workspace_root &&
      invocation.exitCode === 0 &&
      metadataInvocation.exitCode === 0 &&
      !invocation.outputLimitExceeded &&
      !metadataInvocation.outputLimitExceeded &&
      invocation.arguments[0] === "build" &&
      invocation.arguments.includes("--locked") &&
      invocation.arguments.includes("--release") &&
      invocation.arguments.includes("--message-format=json") &&
      targetIndex >= 0 &&
      invocation.arguments[targetIndex + 1] === identity.target.triple &&
      invocation.rustcVersion === capture.rustcVersion &&
      invocation.cargoVersion === capture.cargoVersion &&
      metadataInvocation.cargoVersion === capture.cargoVersion,
    "Captured Cargo invocation/metadata identity mismatch",
  );
  requireEvidence(
    Array.isArray(capture.targetInputs) &&
      capture.targetInputs.length > 0 &&
      capture.targetInputs.length <= 20_000,
    "Captured Cargo target input inventory is incomplete or excessive",
  );
  let targetInputBytes = 0;
  const capturePaths = new Set<string>();
  for (const input of capture.targetInputs) {
    requireEvidence(
      typeof input.path === "string" &&
        input.path.startsWith("target/") &&
        input.capturePath ===
          `target-files/${input.path.slice("target/".length)}` &&
        /^[a-f0-9]{64}$/u.test(input.sha256) &&
        Number.isSafeInteger(input.size) &&
        input.size >= 0 &&
        input.size <= MAX_ARTIFACT_BYTES &&
        !capturePaths.has(input.capturePath),
      "Invalid Cargo target input pin",
    );
    capturePaths.add(input.capturePath);
    targetInputBytes += input.size;
    requireEvidence(
      targetInputBytes <= 8 * 1024 ** 3,
      "Cargo target input byte limit",
    );
    const pin = await pinFile(
      root,
      `${captureDirectory}/${input.capturePath}`,
      MAX_ARTIFACT_BYTES,
    );
    requireEvidence(
      pin.sha256 === input.sha256 && pin.size === input.size,
      "Captured Cargo target input differs from its manifest",
    );
  }
  const targetShellPath = identity.shell.path.replace(
    "apps/desktop/src-tauri/",
    "",
  );
  requireEvidence(
    Array.isArray(capture.targetInputs) &&
      capture.targetInputs.some(
        (input) =>
          input.path === targetShellPath &&
          input.sha256 === identity.shell.sha256 &&
          input.size === identity.shell.size,
      ),
    "Captured Cargo inputs do not include the identity shell",
  );
}
export async function createCandidateIdentity(
  root: string,
  options: IdentityOptions,
): Promise<CandidateIdentity> {
  validateTarget(options.target);
  const identity: CandidateIdentity = {
    schemaVersion: 1,
    kind: "native-candidate-identity",
    disposition: "incomplete",
    distributionApproved: false,
    candidateSha: options.candidateSha,
    target: options.target,
    runtimeRoot: options.runtimeRoot,
    runtimeManifest: await pinFile(
      root,
      `${options.runtimeRoot}/runtime-manifest.json`,
    ),
    shell: await pinFile(root, options.shellPath, MAX_ARTIFACT_BYTES),
    installers: [],
    automaticUpdates: false,
    ...(options.buildEvidencePath
      ? { buildEvidence: await pinFile(root, options.buildEvidencePath) }
      : {}),
  };
  requireEvidence(
    Array.isArray(options.installerPaths) &&
      options.installerPaths.length <= 16,
    "Excessive installer inventory",
  );
  for (const path of [...options.installerPaths].sort())
    identity.installers.push(await pinFile(root, path, MAX_ARTIFACT_BYTES));
  validateIdentity(identity);
  await runtime(root, identity);
  return identity;
}
/** Capture after signing/packaging. This stage still grants no trust or approval. */
export async function captureFinalBytes(
  root: string,
  candidate: FilePin,
): Promise<FinalBytes> {
  const identity = await readEvidence<CandidateIdentity>(root, candidate);
  validateIdentity(identity);
  await runtime(root, identity);
  const final: FinalBytes = {
    schemaVersion: 1,
    kind: "native-final-bytes",
    disposition: "incomplete",
    distributionApproved: false,
    candidateIdentitySha256: candidate.sha256,
    runtimeManifest: identity.runtimeManifest,
    shell: await pinFile(root, identity.shell.path, MAX_ARTIFACT_BYTES),
    installers: [],
    artifactsSha256: "",
  };
  for (const p of identity.installers)
    final.installers.push(await pinFile(root, p.path, MAX_ARTIFACT_BYTES));
  final.artifactsSha256 = artifactDigest(final);
  validateFinalBytes(final, identity, candidate.sha256);
  return final;
}
async function finalLinkage(
  root: string,
  inputs: FinalizationInputs,
  identity: CandidateIdentity,
  final: FinalBytes,
): Promise<FilePin[]> {
  const evidence = await readEvidence<LinkageEvidence>(
    root,
    inputs.finalLinkage,
  );
  requireEvidence(
    evidence.baseline.reviewed === true &&
      validText(evidence.baseline.reviewReceipt?.origin) &&
      validHash(evidence.baseline.reviewReceipt?.sha256) &&
      evidence.baseline.abi === identity.target.abi,
    "Final linkage requires reviewed matching ABI",
  );
  requireEvidence(
    Array.isArray(evidence.binaries) &&
      evidence.binaries.length > 0 &&
      evidence.binaries.length <= 1024 &&
      evidence.binaries.some(
        (b) => b.path === final.shell.path && b.sha256 === final.shell.sha256,
      ),
    "Final shell linkage missing/mismatched",
  );
  const files = [];
  const pins: FilePin[] = [];
  for (const binary of evidence.binaries) {
    const pin = await pinFile(root, binary.path, MAX_ARTIFACT_BYTES);
    requireEvidence(
      pin.sha256 === binary.sha256,
      "Final linkage binary changed",
    );
    pins.push(pin);
    files.push({ ...pin, executable: true, component: "native" });
  }
  await verifyLinkageInputs(
    {
      policy: {
        source: runtimePath(root, inputs.finalLinkagePolicy.path),
        sha256: inputs.finalLinkagePolicy.sha256,
      },
      evidence: {
        source: runtimePath(root, inputs.finalLinkage.path),
        sha256: inputs.finalLinkage.sha256,
      },
    },
    files,
    new Set(files.map((f) => f.path)),
    identity.target,
    evidence.baseline.reviewReceipt!.sha256,
  );
  return pins;
}
/** Review is a retained independent statement; this validator never invents one. */
export function validateReview(
  review: unknown,
  identity: CandidateIdentity,
  final: FinalBytes,
  subjects: FilePin[],
): IndependentReview {
  exactKeys(review, [
    "schemaVersion",
    "kind",
    "candidateSha",
    "candidateIdentitySha256",
    "finalArtifactsSha256",
    "target",
    "disposition",
    "observationMode",
    "reviewer",
    "reviewedAt",
    "subjects",
    "raw",
  ]);
  requireEvidence(
    review.schemaVersion === 1 &&
      review.kind === "native-candidate-review" &&
      review.disposition === "reviewed" &&
      review.observationMode === "executed" &&
      validText(review.reviewer) &&
      validTime(review.reviewedAt),
    "Independent review missing/incomplete/test-only",
  );
  requireEvidence(
    review.candidateSha === identity.candidateSha &&
      review.candidateIdentitySha256 === final.candidateIdentitySha256 &&
      review.finalArtifactsSha256 === final.artifactsSha256 &&
      canonicalJson(review.target) === canonicalJson(identity.target),
    "Independent review candidate mismatch",
  );
  requireEvidence(
    Array.isArray(review.subjects) &&
      review.subjects.length === subjects.length,
    "Independent review subject closure incomplete",
  );
  for (const pin of review.subjects) validatePin(pin);
  const sort = (pins: FilePin[]) =>
    [...pins].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  requireEvidence(
    canonicalJson(sort(review.subjects as FilePin[])) ===
      canonicalJson(sort(subjects)),
    "Independent review subject mismatch",
  );
  requireEvidence(
    Array.isArray(review.raw) &&
      review.raw.length > 0 &&
      review.raw.length <= 128,
    "Independent review source missing",
  );
  for (const pin of review.raw) validatePin(pin);
  requireEvidence(
    (review.raw as FilePin[]).some((pin) => pin.size > 0),
    "Empty independent review source",
  );
  return review as unknown as IndependentReview;
}
/** Validate the existing source-admission receipt without rewriting its schema. */
export function validateSecurityAdmission(
  value: unknown,
  identity: CandidateIdentity,
): void {
  requireEvidence(
    value !== null && typeof value === "object",
    "Missing native security admission",
  );
  const record = value as Record<string, unknown>;
  requireEvidence(
    record.schemaVersion === 1 &&
      record.candidateSHA === identity.candidateSha &&
      record.admission === "pass" &&
      record.sourceRemediation === "verified" &&
      Array.isArray(record.reasons) &&
      record.reasons.length === 0,
    "Stale/incomplete native security admission",
  );
  const digests = record.evidenceDigests as Record<string, unknown> | undefined;
  requireEvidence(
    digests &&
      Object.keys(digests).length === 4 &&
      ["source", "closure", "regression", "audit"].every((key) =>
        validHash(digests[key]),
      ),
    "Missing native security closure digests",
  );
  const reports = record.reports as
    | Record<string, { stdoutSHA256?: string; stderrSHA256?: string }>
    | undefined;
  requireEvidence(
    reports &&
      Object.keys(reports).length === 3 &&
      ["actual", "currentRegistry", "historical"].every(
        (key) =>
          validHash(reports[key]?.stdoutSHA256) &&
          validHash(reports[key]?.stderrSHA256),
      ),
    "Incomplete three-graph native security reports",
  );
}
export async function finalizeCandidate(
  root: string,
  inputs: FinalizationInputs,
) {
  exactKeys(inputs, [
    "schemaVersion",
    "candidate",
    "finalBytes",
    "attribution",
    "finalLinkagePolicy",
    "finalLinkage",
    "security",
    "trust",
    "lifecycle",
    "review",
  ]);
  requireEvidence(inputs.schemaVersion === 1, "Unknown finalization schema");
  const identity = await readEvidence<CandidateIdentity>(
    root,
    inputs.candidate,
  );
  validateIdentity(identity);
  const manifest = await runtime(root, identity);
  requireEvidence(
    manifest.distribution.status === "reviewed",
    "Cannot finalize test-only/unreviewed runtime",
  );
  const final = await readEvidence<FinalBytes>(root, inputs.finalBytes);
  validateFinalBytes(final, identity, inputs.candidate.sha256);
  for (const pin of [final.shell, ...final.installers])
    await verifyPin(root, pin, MAX_ARTIFACT_BYTES);
  const subjects = [
    inputs.candidate,
    inputs.finalBytes,
    inputs.attribution,
    inputs.finalLinkagePolicy,
    inputs.finalLinkage,
    inputs.security,
    inputs.trust,
    inputs.lifecycle,
  ];
  requireEvidence(
    new Set(subjects.map((p) => p.path)).size === subjects.length &&
      subjects.every((p) => p.path !== inputs.review.path),
    "Duplicate/cyclic evidence subjects",
  );
  for (const pin of subjects) await verifyPin(root, pin);
  requireEvidence(
    identity.buildEvidence,
    "Same-build Cargo capture required for finalization",
  );
  const retained: FilePin[] = [];
  const observations = [];
  for (const kind of ["security", "trust", "lifecycle"] as ObservationKind[]) {
    const observation = validateObservation(
      await readEvidence(root, inputs[kind]),
      kind,
      identity,
      final,
    );
    observations.push(observation);
    requireEvidence(
      Date.parse(observation.observedAt) <= Date.now(),
      "Future observation timestamp",
    );
    if (kind === "security") {
      requireEvidence(
        Date.now() - Date.parse(observation.observedAt) <= 6 * 60 * 60 * 1000,
        "Security observations must be refreshed within six hours",
      );
      const admission = observation.raw.filter(
        (p) => p.path.split("/").at(-1) === "admission.json",
      );
      requireEvidence(
        admission.length === 1,
        "Retained native security admission.json required",
      );
      validateSecurityAdmission(
        await readEvidence(root, admission[0]!),
        identity,
      );
      await verifySecurityClosure(root, observation, identity);
    }
    for (const pin of observation.raw) {
      requireEvidence(
        ![...subjects, inputs.review].some(
          (subject) => subject.path === pin.path,
        ),
        "Observation must reference raw leaves, not receipt nodes",
      );
      await verifyPin(root, pin);
      retained.push(pin);
    }
  }
  const review = validateReview(
    await readEvidence(root, inputs.review),
    identity,
    final,
    subjects,
  );
  requireEvidence(
    Date.parse(review.reviewedAt) <= Date.now() &&
      observations.every(
        (o) =>
          o.observer !== review.reviewer &&
          Date.parse(o.observedAt) <= Date.parse(review.reviewedAt),
      ),
    "Review must independently follow observations",
  );
  for (const pin of review.raw) {
    await verifyPin(root, pin);
    retained.push(pin);
  }
  // Recompute actual Cargo/generated/static/sysroot/license/SPDX contribution
  // closure with the existing native attribution implementation.
  retained.push(
    ...(await verifyCandidateAttribution(
      root,
      inputs.attribution,
      identity,
      manifest,
    )),
  );
  const linkageFiles = await finalLinkage(root, inputs, identity, final);
  // Source admission must refer to the same checkout, not a stale source SHA.
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  requireEvidence(head === identity.candidateSha, "Stale candidate checkout");
  // Recheck all outer evidence and final bytes after closure validation.
  for (const pin of [...subjects, inputs.review, ...retained])
    await verifyPin(root, pin);
  for (const pin of [final.shell, ...final.installers, ...linkageFiles])
    await verifyPin(root, pin, MAX_ARTIFACT_BYTES);
  await runtime(root, identity);
  return {
    schemaVersion: 1 as const,
    kind: "native-candidate-receipt" as const,
    disposition: "evidence-complete-record-only" as const,
    distributionApproved: false as const,
    candidateSha: identity.candidateSha,
    target: identity.target,
    candidateIdentitySha256: inputs.candidate.sha256,
    finalArtifactsSha256: final.artifactsSha256,
    runtimeManifest: identity.runtimeManifest,
    shell: final.shell,
    installers: final.installers,
    evidence: inputs,
    retainedEvidence: retained,
    automaticUpdates: false as const,
  };
}
/** Exclusive external outputs prevent rewriting an embedded or reviewed node. */
export async function writeReceipt(
  root: string,
  output: string,
  value: unknown,
  runtimeRoot: string,
): Promise<void> {
  const path = runtimePath(root, output);
  requireEvidence(
    output !== runtimeRoot && !output.startsWith(`${runtimeRoot}/`),
    "Candidate receipts must be outside the embedded runtime",
  );
  // Check every existing parent before mkdir follows it.
  let cursor = dirname(path);
  while (cursor !== dirname(cursor)) {
    try {
      requireEvidence(
        !(await lstat(cursor)).isSymbolicLink(),
        "Receipt output parent is a symlink",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    cursor = dirname(cursor);
  }
  const bytes = JSON.stringify(value, null, 2) + "\n";
  requireEvidence(
    Buffer.byteLength(bytes) <= 8 * 1024 ** 2,
    "Receipt output byte limit",
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
}
async function installers(root: string, directory: string): Promise<string[]> {
  const result: string[] = [];
  let count = 0;
  async function walk(path: string, depth: number) {
    requireEvidence(depth <= 16, "Installer directory depth limit");
    for (const entry of await readdir(runtimePath(root, path), {
      withFileTypes: true,
    })) {
      requireEvidence(
        ++count <= 10000 && !entry.isSymbolicLink(),
        "Installer inventory limit or symlink",
      );
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!entry.name.endsWith(".app")) await walk(child, depth + 1);
      } else if (/\.(?:deb|rpm|AppImage|exe|msi|dmg)$/u.test(entry.name))
        result.push(child);
    }
  }
  await walk(directory, 0);
  return result;
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "prepare-shell") {
    const [rootInput, target] = args;
    requireEvidence(
      rootInput && target && args.length === 2,
      "Usage: receipt.ts prepare-shell <root> <native-target-triple>",
    );
    const root = await realpath(rootInput);
    const shellPath = await prepareTargetBuildShell(root, target);
    console.log(JSON.stringify({ stage: command, shellPath }));
    return;
  }
  if (command === "seal" || command === "finalize" || command === "identity") {
    const [rootInput, inputPath, output] = args;
    requireEvidence(
      rootInput && inputPath && output && args.length === 3,
      `Usage: receipt.ts ${command} <root> <inputs.json> <new-output.json>`,
    );
    const root = await realpath(rootInput);
    const pin = await pinFile(root, inputPath);
    if (command === "seal") {
      const identity = await readEvidence<CandidateIdentity>(root, pin);
      await writeReceipt(
        root,
        output,
        await captureFinalBytes(root, pin),
        identity.runtimeRoot,
      );
    } else if (command === "identity") {
      const identity = await createCandidateIdentity(
        root,
        await readEvidence<IdentityOptions>(root, pin),
      );
      requireEvidence(
        identity.candidateSha ===
          execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
          }).trim(),
        "Candidate checkout mismatch",
      );
      await writeReceipt(root, output, identity, identity.runtimeRoot);
    } else {
      const inputs = await readEvidence<FinalizationInputs>(root, pin);
      const receipt = await finalizeCandidate(root, inputs);
      const identity = await readEvidence<CandidateIdentity>(
        root,
        inputs.candidate,
      );
      await writeReceipt(root, output, receipt, identity.runtimeRoot);
    }
    console.log(
      JSON.stringify({ stage: command, output, distributionApproved: false }),
    );
    return;
  }
  requireEvidence(args.length === 0, "Unknown receipt command");
  const root = await realpath(process.cwd());
  const directory = relative(
    root,
    resolve(command ?? "apps/desktop/src-tauri/target/release/bundle"),
  )
    .split("\\")
    .join("/");
  const runtimeRoot = "apps/desktop/src-tauri/resources/runtime";
  const manifest = await verifyRuntimeBundle(runtimePath(root, runtimeRoot));
  const triple = `${manifest.architecture === "x64" ? "x86_64" : "aarch64"}-${manifest.platform === "linux" ? "unknown-linux-gnu" : manifest.platform === "darwin" ? "apple-darwin" : "pc-windows-msvc"}`;
  const linkage = await readEvidence<LinkageEvidence>(
    root,
    await pinFile(root, `${runtimeRoot}/receipts/linkage-evidence.json`),
  );
  const candidatePath = `${directory}/candidate.json`;
  try {
    await lstat(runtimePath(root, candidatePath));
    throw new Error("Candidate output already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const shellPath = await prepareDefaultBuildShell(root, manifest.platform);
  const identity = await createCandidateIdentity(root, {
    candidateSha: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    target: {
      platform: manifest.platform,
      architecture: manifest.architecture,
      triple,
      abi: linkage.baseline.abi,
    },
    runtimeRoot,
    shellPath,
    installerPaths: await installers(root, directory),
  });
  await writeReceipt(
    root,
    `${directory}/candidate.json`,
    identity,
    runtimeRoot,
  );
  console.log(
    JSON.stringify({
      stage: "pre-trust",
      disposition: "incomplete",
      distributionApproved: false,
    }),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
