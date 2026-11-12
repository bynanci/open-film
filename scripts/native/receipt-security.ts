// SPDX-License-Identifier: Apache-2.0
// Modified by OpenFilm contributors on 2026-11-11. See LICENSE and NOTICE.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runtimePath } from "../../apps/server/src/runtime-manifest.js";
import { canonicalJson } from "./linkage.js";
import {
  readEvidence,
  readPinnedBytes,
  requireEvidence,
  type CandidateIdentity,
  type FilePin,
  type Observation,
} from "./receipt-contract.js";
/** Replay the full original admission boundary from pinned, unmodified bytes. */
export async function verifySecurityClosure(
  root: string,
  observation: Observation,
  identity: CandidateIdentity,
): Promise<void> {
  const named = (name: string) => {
    const matches = observation.raw.filter(
      (pin) => pin.path.split("/").at(-1) === name,
    );
    requireEvidence(
      matches.length === 1,
      `Security closure requires exactly one retained ${name}`,
    );
    return matches[0]!;
  };
  const admission = await readEvidence(root, named("admission.json"));
  const files: Record<string, string> = {};
  let total = 0;
  async function retain(path: string, pin: FilePin) {
    runtimePath(root, path);
    requireEvidence(!(path in files), "Duplicate security snapshot path");
    const bytes = await readPinnedBytes(root, pin);
    total += bytes.length;
    requireEvidence(
      total <= 32 * 1024 ** 2,
      "Security closure total byte limit",
    );
    files[path] = bytes.toString("base64");
  }
  for (const [destination, name] of [
    ["source.json", "source.json"],
    ["closure.json", "closure.json"],
    ["controls/regression.json", "regression.json"],
    ["metadata.json", "metadata.json"],
    ["audit/audit.json", "audit.json"],
    ["audit/actual-metadata.stdout", "actual-metadata.stdout"],
    [
      "audit/current-registry-metadata.stdout",
      "current-registry-metadata.stdout",
    ],
    ["audit/current-registry-Cargo.lock", "current-registry-Cargo.lock"],
    ["audit/historical-Cargo.lock", "historical-Cargo.lock"],
    ["audit/advisory-db.bundle", "advisory-db.bundle"],
    ["audit/advisory-db.shallow", "advisory-db.shallow"],
  ])
    await retain(destination!, named(name!));
  const auditPin = named("audit.json");
  const audit = await readEvidence<{
    schemaVersion: number;
    dbSnapshot: {
      bundle: { path: string; size: number; sha256: string };
      shallow: { path: string; size: number; sha256: string };
    };
    candidateSHA: string;
    reports: Record<
      string,
      {
        stdoutFile: string;
        stdoutSHA256: string;
        stderrFile: string;
        stderrSHA256: string;
      }
    >;
  }>(root, auditPin);
  requireEvidence(
    audit.schemaVersion === 2 && !!audit.dbSnapshot,
    "Audit v2 snapshot required",
  );
  requireEvidence(
    audit.candidateSHA === identity.candidateSha &&
      audit.reports &&
      Object.keys(audit.reports).length === 3,
    "Stale/incomplete retained audit",
  );
  const prefix = auditPin.path.slice(0, auditPin.path.lastIndexOf("/") + 1);
  for (const report of Object.values(audit.reports)) {
    for (const field of ["stdout", "stderr"] as const) {
      const path = report[`${field}File`];
      runtimePath(root, path);
      requireEvidence(
        !path.includes("/"),
        "Scanner output must be a direct leaf",
      );
      const matching = observation.raw.filter(
        (pin) => pin.path.split("/").at(-1) === path,
      );
      requireEvidence(
        matching.length === 1 &&
          matching[0]!.path === `${prefix}${path}` &&
          matching[0]!.sha256 === report[`${field}SHA256`],
        "Missing/tampered retained scanner output",
      );
      await retain(`audit/${path}`, matching[0]!);
    }
  }
  // Base64 preserves exact original JSON, including Python's 1.0 representation.
  const input = JSON.stringify({ schemaVersion: 1, files });
  const output = execFileSync(
    "python",
    [fileURLToPath(new URL("./receipt-security.py", import.meta.url)), root],
    {
      input,
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer: 48 * 1024 ** 2,
      timeout: 60000,
    },
  );
  // The complete Python preflight must diagnose original source paths before
  // attempting snapshot restoration. Its shared auditor validates metadata and
  // exact bytes; also bind each original observation pin to that metadata here.
  for (const kind of ["bundle", "shallow"] as const) {
    const captured = audit.dbSnapshot[kind];
    const pin = named(`advisory-db.${kind}`);
    requireEvidence(
      captured.path === `advisory-db.${kind}` &&
        captured.size === pin.size &&
        captured.sha256 === pin.sha256,
      "Captured advisory snapshot pin differs",
    );
  }
  requireEvidence(
    canonicalJson(JSON.parse(output)) === canonicalJson(admission),
    "Replayed native security admission differs",
  );
}
