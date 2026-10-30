// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import {
  runtimeHash,
  runtimePath,
  type RuntimeFile,
  type RuntimeManifest,
} from "../../apps/server/src/runtime-manifest.js";
export interface PinnedReceipt {
  source: string;
  sha256: string;
}
export interface LinkageInputs {
  policy: PinnedReceipt;
  evidence: PinnedReceipt;
}
export interface LinkageEvidence {
  schemaVersion: 1;
  verified: boolean;
  distributionApproved: false;
  observationMode: "executed" | "fixture";
  platform: string;
  architecture: string;
  policySha256: string;
  policyFileSha256: string;
  baseline: {
    os: string;
    build: string;
    architecture: string;
    abi: string;
    reviewed?: boolean;
    reviewReceipt?: { origin: string; sha256: string };
  };
  binaries: {
    path: string;
    sha256: string;
    architecture: string;
    resolved: {
      import: string;
      kind: "system" | "bundled";
      path?: string;
      baselineImport?: string;
    }[];
  }[];
  tool: {
    name: string;
    sha256: string;
    executions: { binary: string; exitCode: number }[];
  };
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function readPinnedJson<T>(input: PinnedReceipt): Promise<T> {
  const info = await lstat(input.source);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 ** 2)
    throw new Error("Receipt must be a bounded regular file");
  if (
    !/^[a-f0-9]{64}$/u.test(input.sha256) ||
    (await runtimeHash(input.source)) !== input.sha256
  )
    throw new Error("Pinned receipt hash mismatch");
  const bytes = await readFile(input.source);
  if (
    bytes.length > 8 * 1024 ** 2 ||
    createHash("sha256").update(bytes).digest("hex") !== input.sha256
  )
    throw new Error("Receipt changed or exceeds limits");
  return JSON.parse(bytes.toString()) as T;
}
export async function verifyLinkageInputs(
  inputs: LinkageInputs,
  files: RuntimeFile[],
  nativePaths: Set<string>,
  target: Pick<RuntimeManifest, "platform" | "architecture">,
  reviewReceiptSha256?: string,
): Promise<LinkageEvidence> {
  const policy = await readPinnedJson<{
    schemaVersion: number;
    baseline: LinkageEvidence["baseline"];
    platform: string;
    architecture: string;
    files: Record<string, string>;
    systemImports: Record<string, unknown>;
  }>(inputs.policy);
  const evidence = await readPinnedJson<LinkageEvidence>(inputs.evidence);
  if (
    policy.schemaVersion !== 1 ||
    evidence.schemaVersion !== 1 ||
    !evidence.verified ||
    evidence.observationMode !== "executed" ||
    evidence.platform !== target.platform ||
    evidence.architecture !== target.architecture ||
    policy.platform !== target.platform ||
    policy.architecture !== target.architecture ||
    evidence.policyFileSha256 !== inputs.policy.sha256 ||
    evidence.policySha256 !==
      createHash("sha256").update(canonicalJson(policy)).digest("hex") ||
    !/^[a-f0-9]{64}$/u.test(evidence.tool?.sha256) ||
    canonicalJson(evidence.baseline) !== canonicalJson(policy.baseline) ||
    !evidence.baseline?.abi
  )
    throw new Error("Executed target linkage evidence required");
  if (
    reviewReceiptSha256 &&
    (policy.baseline.reviewed !== true ||
      policy.baseline.reviewReceipt?.sha256 !== reviewReceiptSha256 ||
      !policy.baseline.reviewReceipt.origin)
  )
    throw new Error("Explicit reviewed OS baseline receipt required");
  if (
    !Array.isArray(evidence.binaries) ||
    Object.keys(policy.files).length !== nativePaths.size ||
    evidence.binaries.length !== nativePaths.size ||
    new Set(evidence.binaries.map((x) => x.path)).size !== nativePaths.size
  )
    throw new Error("Incomplete native linkage inventory");
  for (const binary of evidence.binaries) {
    runtimePath("/linkage", binary.path);
    if (
      !nativePaths.has(binary.path) ||
      binary.sha256 !== policy.files[binary.path] ||
      binary.sha256 !== files.find((x) => x.path === binary.path)?.sha256 ||
      binary.architecture !== target.architecture ||
      !evidence.tool.executions.some(
        (x) => x.binary === binary.path && x.exitCode === 0,
      )
    )
      throw new Error("Native linkage artifact mismatch");
    for (const imported of binary.resolved)
      if (
        imported.kind === "bundled"
          ? !evidence.binaries.some((x) => x.path === imported.path)
          : !imported.baselineImport ||
            !(imported.baselineImport in policy.systemImports)
      )
        throw new Error("Unresolved linkage receipt import");
  }
  return evidence;
}
