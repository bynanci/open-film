// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, symlink, truncate } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  digest,
  pinFile,
  readEvidence,
  validateObservation,
  type CandidateIdentity,
  type FinalBytes,
  type Observation,
} from "../../scripts/native/receipt-contract.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "candidate-receipt-"));
  roots.push(root);
  await writeFile(join(root, "evidence.json"), '{"value":true}');
  return root;
}
it("pins actual bytes and rejects changed evidence", async () => {
  const root = await fixture();
  const pin = await pinFile(root, "evidence.json");
  expect(await readEvidence(root, pin)).toEqual({ value: true });
  await writeFile(join(root, pin.path), '{"value":false}');
  await expect(readEvidence(root, pin)).rejects.toThrow();
});
it.each([
  "../outside",
  "/tmp/outside",
  "C:/outside",
  "folder\\file",
  "./file",
  "CON",
  "folder//file",
])("rejects evidence path %s", async (path) => {
  await expect(pinFile(await fixture(), path)).rejects.toThrow();
});
it("rejects symlinks, missing receipts and oversized bytes before parsing", async () => {
  const root = await fixture();
  await symlink(join(root, "evidence.json"), join(root, "alias.json"));
  await expect(pinFile(root, "alias.json")).rejects.toThrow();
  await expect(pinFile(root, "absent.json")).rejects.toThrow();
  await truncate(join(root, "evidence.json"), 8 * 1024 ** 2 + 1);
  await expect(pinFile(root, "evidence.json")).rejects.toThrow();
});
const target = {
  platform: "win32",
  architecture: "x64",
  triple: "x86_64-pc-windows-msvc",
  abi: "msvc",
} as const;
const identity = { candidateSha: "a".repeat(40), target } as CandidateIdentity;
const final = {
  candidateIdentitySha256: "b".repeat(64),
  artifactsSha256: "c".repeat(64),
} as FinalBytes;
function observation(): Observation {
  return {
    schemaVersion: 1,
    kind: "trust",
    candidateSha: identity.candidateSha,
    candidateIdentitySha256: final.candidateIdentitySha256,
    finalArtifactsSha256: final.artifactsSha256,
    target,
    observationMode: "executed",
    status: "passed",
    observedAt: "2026-11-11T00:00:00.000Z",
    observer: "operator identity",
    tool: "Windows Authenticode",
    toolVersion: "10.0",
    checks: ["signature", "publisher", "os-trust"],
    raw: [{ path: "os-trust.txt", sha256: "d".repeat(64), size: 10 }],
  };
}
it("accepts only a record-only observation bound to this candidate and final bytes", () => {
  expect(validateObservation(observation(), "trust", identity, final)).toEqual(
    observation(),
  );
  expect(digest({ b: 1, a: 2 })).toBe(digest({ a: 2, b: 1 }));
});
it.each([
  "candidate",
  "identity",
  "final-bytes",
  "target",
  "fixture",
  "unavailable",
  "missing-check",
  "empty-raw",
  "zero-byte-raw",
  "unknown-schema",
  "unknown-field",
])("rejects %s observation", (fault) => {
  const value = observation();
  if (fault === "candidate") value.candidateSha = "f".repeat(40);
  if (fault === "identity") value.candidateIdentitySha256 = "f".repeat(64);
  if (fault === "final-bytes") value.finalArtifactsSha256 = "f".repeat(64);
  if (fault === "target") value.target = { ...target, abi: "other" };
  if (fault === "fixture") Object.assign(value, { observationMode: "fixture" });
  if (fault === "unavailable") Object.assign(value, { status: "unavailable" });
  if (fault === "missing-check") value.checks = ["signature"];
  if (fault === "empty-raw") value.raw = [];
  if (fault === "zero-byte-raw") value.raw[0]!.size = 0;
  if (fault === "unknown-schema") Object.assign(value, { schemaVersion: 2 });
  if (fault === "unknown-field")
    Object.assign(value, { distributionApproved: true });
  expect(() => validateObservation(value, "trust", identity, final)).toThrow();
});

import {
  validateReview,
  validateSecurityAdmission,
} from "../../scripts/native/receipt.js";
it("requires an independent review of every exact pinned subject", () => {
  const subjects = [{ path: "trust.json", sha256: "d".repeat(64), size: 10 }];
  const review = {
    schemaVersion: 1,
    kind: "native-candidate-review",
    candidateSha: identity.candidateSha,
    candidateIdentitySha256: final.candidateIdentitySha256,
    finalArtifactsSha256: final.artifactsSha256,
    target,
    disposition: "reviewed",
    observationMode: "executed",
    reviewer: "independent reviewer",
    reviewedAt: "2026-11-11T01:00:00.000Z",
    subjects,
    raw: [{ path: "review.txt", sha256: "e".repeat(64), size: 20 }],
  };
  expect(validateReview(review, identity, final, subjects).disposition).toBe(
    "reviewed",
  );
  for (const mutation of [
    { disposition: "pending" },
    { observationMode: "fixture" },
    { subjects: [] },
    { reviewer: "" },
    { finalArtifactsSha256: "e".repeat(64) },
  ])
    expect(() =>
      validateReview({ ...review, ...mutation }, identity, final, subjects),
    ).toThrow();
});
it("rejects stale, incomplete or failed native security admission", () => {
  const admission = {
    schemaVersion: 1,
    candidateSHA: identity.candidateSha,
    admission: "pass",
    sourceRemediation: "verified",
    reasons: [],
    evidenceDigests: Object.fromEntries(
      ["source", "closure", "regression", "audit"].map((key) => [
        key,
        "e".repeat(64),
      ]),
    ),
    reports: Object.fromEntries(
      ["actual", "currentRegistry", "historical"].map((key) => [
        key,
        { stdoutSHA256: "e".repeat(64), stderrSHA256: "f".repeat(64) },
      ]),
    ),
  };
  expect(() => validateSecurityAdmission(admission, identity)).not.toThrow();
  for (const mutation of [
    { candidateSHA: "e".repeat(40) },
    { admission: "blocked" },
    { reasons: ["missing scanner"] },
    { reports: {} },
    { evidenceDigests: {} },
    { sourceRemediation: "unverified" },
  ])
    expect(() =>
      validateSecurityAdmission({ ...admission, ...mutation }, identity),
    ).toThrow();
});

import { verifySecurityClosure } from "../../scripts/native/receipt-security.js";
it("does not accept a passing admission label without the original retained closure", async () => {
  const root = await fixture();
  await expect(
    verifySecurityClosure(root, observation(), identity),
  ).rejects.toThrow("admission.json");
  await writeFile(
    join(root, "admission.json"),
    JSON.stringify({
      schemaVersion: 1,
      admission: "pass",
      candidateSHA: identity.candidateSha,
    }),
  );
  const security = {
    ...observation(),
    kind: "security" as const,
    raw: [await pinFile(root, "admission.json")],
  };
  await expect(verifySecurityClosure(root, security, identity)).rejects.toThrow(
    "source.json",
  );
});
