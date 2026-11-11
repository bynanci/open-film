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
  type Observation,
} from "./receipt-contract.js";
/** Replay the existing source/closure/security policy using pinned original bytes. */
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
  const originalJson = async (name: string) =>
    (await readPinnedBytes(root, named(name))).toString("utf8");
  const source = await originalJson("source.json");
  const closure = await originalJson("closure.json");
  const regression = await originalJson("regression.json");
  const metadata = await originalJson("metadata.json");
  const auditPin = named("audit.json");
  const audit = await readEvidence<{
    candidateSHA: string;
    reports: Record<
      string,
      {
        stdoutFile: string;
        stdoutSHA256: string;
        stderrFile: string;
        stderrSHA256: string;
        raw?: unknown;
        stderr?: string;
        validatedBytes?: boolean;
      }
    >;
  }>(root, auditPin);
  requireEvidence(
    audit.candidateSHA === identity.candidateSha &&
      audit.reports &&
      Object.keys(audit.reports).length === 3,
    "Stale/incomplete retained audit",
  );
  const prefix = auditPin.path.slice(0, auditPin.path.lastIndexOf("/") + 1);
  const scans: Record<string, { stdout: string; stderr: string }> = {};
  for (const [name, report] of Object.entries(audit.reports)) {
    const scan = { stdout: "", stderr: "" };
    for (const field of ["stdout", "stderr"] as const) {
      const path = report[`${field}File`];
      runtimePath(root, path);
      const matching = observation.raw.filter(
        (pin) =>
          pin.path === `${prefix}${path}` &&
          pin.sha256 === report[`${field}SHA256`],
      );
      requireEvidence(
        matching.length === 1,
        "Missing/tampered retained scanner output",
      );
      const bytes = await readPinnedBytes(root, matching[0]!);
      scan[field] = bytes.toString("utf8");
    }
    scans[name] = scan;
  }
  const input = JSON.stringify({
    source,
    closure,
    regression,
    metadata,
    audit,
  });
  requireEvidence(
    Buffer.byteLength(input) <= 32 * 1024 ** 2,
    "Security closure total byte limit",
  );
  const output = execFileSync(
    "python",
    [fileURLToPath(new URL("./receipt-security.py", import.meta.url)), root],
    { input, encoding: "utf8", maxBuffer: 32 * 1024 ** 2, timeout: 60000 },
  );
  requireEvidence(
    canonicalJson(JSON.parse(output)) === canonicalJson(admission),
    "Replayed native security admission differs",
  );
}
