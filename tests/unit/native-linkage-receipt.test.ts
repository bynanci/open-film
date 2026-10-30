import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  canonicalJson,
  verifyLinkageInputs,
  type LinkageEvidence,
} from "../../scripts/native/linkage.js";
import { runtimeHash } from "../../apps/server/src/runtime-manifest.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-linkage-receipt-"));
  roots.push(root);
  const sha256 = "1".repeat(64),
    baseline = {
      os: "fixture",
      build: "fixture",
      architecture: "x64",
      abi: "fixture",
      reviewed: false,
    };
  const policy = {
    schemaVersion: 1,
    platform: "linux",
    architecture: "x64",
    baseline,
    files: { "bin/tool": sha256 },
    systemImports: {},
  };
  const evidence: LinkageEvidence = {
    schemaVersion: 1,
    verified: true,
    distributionApproved: false,
    observationMode: "executed",
    platform: "linux",
    architecture: "x64",
    policySha256: createHash("sha256")
      .update(canonicalJson(policy))
      .digest("hex"),
    policyFileSha256: "",
    baseline,
    binaries: [{ path: "bin/tool", sha256, architecture: "x64", resolved: [] }],
    tool: {
      name: "fixture-readelf",
      sha256: "2".repeat(64),
      executions: [{ binary: "bin/tool", exitCode: 0 }],
    },
  };
  const save = async () => {
    const source = join(root, "policy.json");
    await writeFile(source, JSON.stringify(policy));
    evidence.policyFileSha256 = await runtimeHash(source);
    evidence.policySha256 = createHash("sha256")
      .update(canonicalJson(policy))
      .digest("hex");
    const receipt = join(root, "evidence.json");
    await writeFile(receipt, JSON.stringify(evidence));
    return {
      policy: { source, sha256: await runtimeHash(source) },
      evidence: { source: receipt, sha256: await runtimeHash(receipt) },
    };
  };
  const files = [
    { path: "bin/tool", sha256, size: 1, executable: true, component: "node" },
  ];
  return { root, policy, evidence, files, save };
}
it("never treats an unreviewed OS baseline as a distribution review", async () => {
  const f = await fixture();
  const inputs = await f.save();
  await expect(
    verifyLinkageInputs(
      inputs,
      f.files,
      new Set(["bin/tool"]),
      { platform: "linux", architecture: "x64" },
      "3".repeat(64),
    ),
  ).rejects.toThrow("reviewed OS baseline");
});
it.each([
  "fixture",
  "binary-hash",
  "missing-observation",
  "baseline-swap",
  "import",
  "target",
])("rejects %s linkage evidence", async (fault) => {
  const f = await fixture();
  if (fault === "fixture") f.evidence.observationMode = "fixture";
  if (fault === "binary-hash") f.evidence.binaries[0]!.sha256 = "4".repeat(64);
  if (fault === "missing-observation") f.evidence.tool.executions = [];
  if (fault === "baseline-swap")
    f.evidence.baseline = { ...f.evidence.baseline, os: "different" };
  if (fault === "import")
    f.evidence.binaries[0]!.resolved = [
      { import: "unknown", kind: "system", baselineImport: "unknown" },
    ];
  if (fault === "target") f.evidence.architecture = "arm64";
  const inputs = await f.save();
  await expect(
    verifyLinkageInputs(inputs, f.files, new Set(["bin/tool"]), {
      platform: "linux",
      architecture: "x64",
    }),
  ).rejects.toThrow();
});
