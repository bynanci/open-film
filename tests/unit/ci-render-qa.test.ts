// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { syntheticRenderQaEvidence } from "../fixtures/render-qa-evidence.js";
import { renderQaPlatforms } from "../helpers/render-qa-contract.js";
import {
  requireRenderQaPrerequisite,
  validateRenderQaResults,
} from "../../scripts/ci/check-render-qa-results.js";

const expected = {
  candidateSha: "1".repeat(40),
  runId: "123",
  runAttempt: "1",
  platforms: [...renderQaPlatforms],
};
const reports = () =>
  renderQaPlatforms.map((platform) => syntheticRenderQaEvidence(platform));
it("requires exactly three successful current-run platform reports", () => {
  expect(validateRenderQaResults(reports(), expected)).toMatchObject({
    verified: true,
    platforms: renderQaPlatforms,
    measurements: 351,
    controls: 30,
    workstationVerified: false,
  });
});
it("executes the aggregate CLI against current-attempt regular files and rejects missing/nonregular files", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-qa-reports-"));
  const args = [
    resolve("node_modules/tsx/dist/cli.mjs"),
    "scripts/ci/check-render-qa-results.ts",
    root,
  ];
  const env = {
    ...process.env,
    MATRIX_RESULT: "success",
    OPENFILM_SOURCE_CANDIDATE: expected.candidateSha,
    GITHUB_RUN_ID: expected.runId,
    GITHUB_RUN_ATTEMPT: expected.runAttempt,
  };
  const execute = () =>
    execFileSync(process.execPath, args, {
      encoding: "utf8",
      stdio: "pipe",
      env,
    });
  try {
    for (const report of reports())
      await writeFile(
        join(root, `${report.platformId}.json`),
        JSON.stringify(report),
      );
    expect(JSON.parse(execute()).measurements).toBe(351);
    await rm(join(root, "darwin-arm64.json"));
    expect(execute).toThrow();
    await mkdir(join(root, "darwin-arm64.json"));
    expect(execute).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each(["failure", "cancelled", "skipped", "", undefined])(
  "rejects unsuccessful matrix outcome %s",
  (outcome) => {
    expect(() => requireRenderQaPrerequisite(outcome)).toThrow();
  },
);
it("admits the matrix only on literal success", () =>
  expect(() => requireRenderQaPrerequisite("success")).not.toThrow());
it("rejects missing/duplicate/unknown platforms and a caller requesting a subset", () => {
  expect(() =>
    validateRenderQaResults(reports().slice(0, 2), expected),
  ).toThrow();
  expect(() =>
    validateRenderQaResults(
      [reports()[0], reports()[0], reports()[2]],
      expected,
    ),
  ).toThrow();
  expect(() =>
    validateRenderQaResults(reports(), {
      ...expected,
      platforms: ["linux-x64"],
    }),
  ).toThrow();
  const data = reports();
  Object.assign(data[2]!, { platformId: "darwin-x64" });
  expect(() => validateRenderQaResults(data, expected)).toThrow();
});
it.each(["candidateSha", "runId", "runAttempt"] as const)(
  "rejects stale %s",
  (field) => {
    const data = reports();
    data[1]![field] = field === "candidateSha" ? "2".repeat(40) : "999";
    expect(() => validateRenderQaResults(data, expected)).toThrow();
  },
);
it("does not require encoded byte equality across OSes", () => {
  const data = reports();
  data[1]!.outputs.find((output) => output.id === "validVideo")!.sha256 =
    "b".repeat(64);
  expect(() => validateRenderQaResults(data, expected)).not.toThrow();
});
it("keeps the full Verify/browser/native commands and adds an always-evaluated three-OS gate", () => {
  const workflow = readFileSync(".github/workflows/render-qa.yml", "utf8");
  for (const token of [
    "ubuntu-24.04",
    "windows-2022",
    "macos-15",
    "darwin-arm64",
    "fail-fast: false",
    "if: always()",
    "render-qa-complete:",
    "needs: [render-qa]",
    "MATRIX_RESULT: ${{ needs.render-qa.result }}",
    "scripts/ci/setup-render-qa.ts hosted-tools",
    "pnpm test:render-qa",
    "scripts/ci/check-render-qa-results.ts",
  ])
    expect(workflow).toContain(token);
  expect(workflow).not.toMatch(
    /continue-on-error|paths-ignore|\bpaths:|macos-14|macos-latest/u,
  );
  expect(workflow).toContain("/*.json");
  expect(workflow).toContain("retention-days: 7");
  const verify = readFileSync(".github/workflows/ci.yml", "utf8");
  for (const token of [
    "pnpm test:contracts",
    "pnpm test:media",
    "pnpm test:e2e",
    "pnpm test:interchange",
    "pnpm test:native",
    "cargo build --locked",
    "pnpm test:browser-results",
    "npm run build",
  ])
    expect(verify).toContain(token);
});

it.each(["source inventory", "substituted font"])(
  "rejects aggregate reports with contradictory %s hashes",
  (mutation) => {
    const data = reports();
    if (mutation === "source inventory")
      data[0]!.sources[0]!.sha256 = "c".repeat(64);
    else
      data[0]!.controls.find(
        (control) => control.id === "fontSubstitution",
      )!.failedMeasurement.actual = "c".repeat(64);
    expect(() => validateRenderQaResults(data, expected)).toThrow();
  },
);
