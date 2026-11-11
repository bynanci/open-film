// SPDX-License-Identifier: Apache-2.0
// Modified by OpenFilm contributors on 2026-11-11. See LICENSE and NOTICE.
import { isAbsolute, relative } from "node:path";
import {
  runtimePath,
  type RuntimeManifest,
} from "../../apps/server/src/runtime-manifest.js";
import {
  resolveBuildContributionSource,
  type BuildContributions,
  type PackageIdentity,
} from "../build-attribution.mjs";
import {
  createDistributionAttribution,
  type AttributionEvidence,
  type CargoEvidence,
  type LicenseReceipt,
  type NativeRuntimeInput,
} from "./attribution.js";
import { canonicalJson, type LinkageEvidence } from "./linkage.js";
import { verifyCandidateCargo } from "./receipt-cargo.js";
import {
  exactKeys,
  MAX_ARTIFACT_BYTES,
  pinFile,
  readEvidence,
  requireEvidence,
  validHash,
  verifyPin,
  type CandidateIdentity,
  type FilePin,
} from "./receipt-contract.js";
export interface CandidateAttributionInputs {
  schemaVersion: 1;
  report: FilePin;
  spdx: FilePin;
  buildContributions: FilePin;
  cargo: FilePin;
  cargoInputs: FilePin;
  licenseReceipts: FilePin;
  nativeRuntimeInputs: FilePin;
  nativeLinkage: FilePin;
  targetDirectory: string;
}
/** All original source inventories must be retained inside the selected root. */
function sourcePath(root: string, source: string): string {
  return runtimePath(
    root,
    isAbsolute(source) ? relative(root, source).split("\\").join("/") : source,
  );
}
async function verifySources(root: string, value: unknown): Promise<void> {
  let count = 0;
  async function visit(item: unknown, depth: number): Promise<void> {
    requireEvidence(
      ++count <= 50000 && depth <= 24,
      "Attribution evidence complexity limit",
    );
    if (Array.isArray(item)) {
      for (const child of item) await visit(child, depth + 1);
    } else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if ("source" in record && typeof record.source === "string") {
        requireEvidence(
          validHash(record.sha256),
          "Unpinned attribution source",
        );
        const source = sourcePath(root, record.source);
        const pin = await pinFile(
          root,
          relative(root, source).split("\\").join("/"),
        );
        requireEvidence(
          pin.sha256 === record.sha256,
          "Attribution source hash mismatch",
        );
        // Existing attribution APIs use absolute local source names. The pinned
        // input remains unchanged; only the in-memory resolver is normalized.
        record.source = source;
      }
      for (const child of Object.values(record)) await visit(child, depth + 1);
    }
  }
  await visit(value, 0);
}
/** Bound original contribution files before rebuilding attribution. */
export async function verifyContributionInventory(
  root: string,
  build: BuildContributions,
  cargo: Pick<
    CargoEvidence,
    "evidenceFiles" | "shell" | "compilations" | "generatedOutputs"
  >,
  targetDirectory: string,
): Promise<void> {
  // Bounds/alias checks precede existing hash and contribution verification.
  const originalFiles = [
    ...build.buildEvidence.map((file) => ({ file, buildInput: false })),
    ...build.artifacts.flatMap((artifact) => [
      { file: artifact, buildInput: false },
      ...artifact.inputs.map((file) => ({ file, buildInput: true })),
    ]),
    ...[
      ...(cargo.evidenceFiles ?? []),
      cargo.shell,
      ...cargo.compilations.flatMap((c) => c.artifacts),
      ...cargo.generatedOutputs,
    ].map((file) => ({ file, buildInput: false })),
  ];
  requireEvidence(
    originalFiles.length <= 20000,
    "Excessive native contribution inventory",
  );
  let originalBytes = 0;
  for (const { file, buildInput } of originalFiles) {
    // Only build input IDs use the capture resolver. Ordinary evidence and
    // artifact paths still reach pinFile unchanged; receipt bytes/IDs stay fixed.
    const path =
      buildInput && file.path.startsWith("generated:")
        ? relative(
            root,
            (await resolveBuildContributionSource(root, file.path)).absolute,
          )
            .split("\\")
            .join("/")
        : file.path.startsWith("target/")
          ? `${targetDirectory}/${file.path.slice(7)}`
          : file.path;
    const pin = await pinFile(root, path, MAX_ARTIFACT_BYTES);
    originalBytes += pin.size;
    requireEvidence(
      originalBytes <= 16 * 1024 ** 3,
      "Contribution total byte limit",
    );
    requireEvidence(
      pin.sha256 === file.sha256,
      "Contribution artifact hash mismatch",
    );
  }
}
export async function verifyCandidateAttribution(
  root: string,
  inputPin: FilePin,
  identity: CandidateIdentity,
  manifest: RuntimeManifest,
): Promise<FilePin[]> {
  const inputs = await readEvidence<CandidateAttributionInputs>(root, inputPin);
  exactKeys(inputs, [
    "schemaVersion",
    "report",
    "spdx",
    "buildContributions",
    "cargo",
    "cargoInputs",
    "licenseReceipts",
    "nativeRuntimeInputs",
    "nativeLinkage",
    "targetDirectory",
  ]);
  requireEvidence(
    inputs.schemaVersion === 1 && typeof inputs.targetDirectory === "string",
    "Invalid attribution closure contract",
  );
  const targetDirectory = runtimePath(root, inputs.targetDirectory);
  const pins = [
    inputs.report,
    inputs.spdx,
    inputs.buildContributions,
    inputs.cargo,
    inputs.cargoInputs,
    inputs.licenseReceipts,
    inputs.nativeRuntimeInputs,
    inputs.nativeLinkage,
  ];
  for (const pin of pins) await verifyPin(root, pin);
  const build = await readEvidence<BuildContributions>(
    root,
    inputs.buildContributions,
  );
  const cargo = await verifyCandidateCargo(
    root,
    inputs.cargoInputs,
    await readEvidence<CargoEvidence>(root, inputs.cargo),
    inputs.targetDirectory,
  );
  const licenses = await readEvidence<LicenseReceipt[]>(
    root,
    inputs.licenseReceipts,
  );
  const nativeInputs = await readEvidence<NativeRuntimeInput[]>(
    root,
    inputs.nativeRuntimeInputs,
  );
  const nativeLinkage = await readEvidence<LinkageEvidence>(
    root,
    inputs.nativeLinkage,
  );
  requireEvidence(
    cargo.observationMode === "executed" &&
      cargo.target === identity.target.triple &&
      cargo.shell.sha256 === identity.shell.sha256,
    "Cargo/pre-trust shell identity mismatch or fixture",
  );
  requireEvidence(
    nativeLinkage.baseline.abi === identity.target.abi,
    "Attribution ABI mismatch",
  );
  await verifySources(root, licenses);
  await verifySources(root, nativeInputs);
  await verifyContributionInventory(root, build, cargo, inputs.targetDirectory);
  const runtimeReport = await readEvidence<AttributionEvidence>(
    root,
    await pinFile(root, `${identity.runtimeRoot}/receipts/attribution.json`),
  );
  const linkage = await readEvidence<LinkageEvidence>(
    root,
    await pinFile(
      root,
      `${identity.runtimeRoot}/receipts/linkage-evidence.json`,
    ),
  );
  const runtimePackages: Record<string, PackageIdentity> = {};
  for (const component of manifest.components) {
    const p = runtimeReport.packages.find(
      (p) =>
        p.name === component.id &&
        p.version === component.version &&
        p.source.kind === "npm",
    );
    if (p) {
      requireEvidence(
        p.source.lockSha256 === build.lockSha256 &&
          p.source.packageJsonSha256 ===
            manifest.files.find(
              (f) => f.path === `node_modules/${component.id}/package.json`,
            )?.sha256,
        "Runtime npm source identity mismatch",
      );
      runtimePackages[component.id] = p;
    }
  }
  const computed = await createDistributionAttribution(
    build,
    cargo,
    manifest,
    licenses,
    {
      repository: root,
      targetDirectory,
      runtimePackages,
      linkage,
      nativeLinkage,
      nativeRuntimeInputs: nativeInputs,
    },
  );
  requireEvidence(
    computed.reviewStatus === "ready-for-independent-review" &&
      computed.runtimeReviewStatus === "ready-for-independent-review" &&
      computed.blockers.length === 0 &&
      computed.distributionApproved === false,
    `Incomplete native attribution: ${computed.blockers.join(", ")}`,
  );
  const report = await readEvidence<
    AttributionEvidence & {
      scope: string;
      runtimeManifestSha256: string;
      receiptFiles: { path: string; sha256: string }[];
    }
  >(root, inputs.report);
  requireEvidence(
    report.scope === "native-distribution" &&
      report.runtimeManifestSha256 === identity.runtimeManifest.sha256,
    "Attribution runtime manifest mismatch",
  );
  const { spdx, notices, ...fields } = computed;
  for (const key of Object.keys(fields) as (keyof typeof fields)[])
    requireEvidence(
      canonicalJson(report[key]) === canonicalJson(fields[key]),
      `Recomputed attribution mismatch: ${key}`,
    );
  requireEvidence(
    canonicalJson(report.notices) ===
      canonicalJson(notices.map(({ source: _source, ...notice }) => notice)),
    "Attribution notice inventory mismatch",
  );
  requireEvidence(
    canonicalJson(await readEvidence(root, inputs.spdx)) ===
      canonicalJson(spdx),
    "SPDX closure mismatch",
  );
  const reportDirectory = inputs.report.path.slice(
    0,
    inputs.report.path.lastIndexOf("/") + 1,
  );
  requireEvidence(
    Array.isArray(report.receiptFiles) &&
      report.receiptFiles.length > 0 &&
      report.receiptFiles.length <= 16,
    "Missing attribution receipt copies",
  );
  const retained: FilePin[] = [];
  for (const file of [
    ...report.receiptFiles,
    ...report.notices.map((n) => ({ path: n.destination, sha256: n.sha256 })),
  ]) {
    runtimePath(root, file.path);
    const pin = await pinFile(root, `${reportDirectory}${file.path}`);
    requireEvidence(
      pin.sha256 === file.sha256,
      "Attribution retained evidence mismatch",
    );
    retained.push(pin);
  }
  return [...pins, ...retained];
}
