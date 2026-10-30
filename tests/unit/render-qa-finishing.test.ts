// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  finishingVitestArgs,
  renderQaFinishingFiles,
  validateFinishingReport,
} from "../../scripts/ci/render-qa-finishing.js";
const root = resolve("."),
  context = { checkoutRoot: root, startedAt: 1000, endedAt: 5000 };
function report() {
  return {
    success: true,
    numTotalTestSuites: 5,
    numPassedTestSuites: 5,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 5,
    numPassedTests: 5,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    startTime: 2000,
    snapshot: { failure: false },
    testResults: renderQaFinishingFiles.map((file, i) => ({
      name: resolve(root, file),
      status: "passed",
      startTime: 2000,
      endTime: 3000,
      assertionResults: [
        {
          fullName: `actual fixture ${i}`,
          status: "passed",
          failureMessages: [] as string[],
        },
      ],
    })),
  };
}
it("selects the exact five finishing files without filters, retries or only-test acceptance", () => {
  expect(renderQaFinishingFiles).toEqual([
    "packages/render/tests/photo-easing.test.ts",
    "packages/render/tests/photo-ambient.test.ts",
    "packages/render/tests/bilingual-title-finishing.test.ts",
    "packages/render/tests/primary-color.test.ts",
    "packages/render/tests/photo-primary-local-look.test.ts",
  ]);
  const output = resolve("report.json");
  expect(finishingVitestArgs(root, output)).toEqual([
    resolve(root, "node_modules/vitest/vitest.mjs"),
    "run",
    ...renderQaFinishingFiles,
    "--maxWorkers=1",
    "--retry=0",
    "--allowOnly=false",
    "--reporter=json",
    `--outputFile=${output}`,
  ]);
});
it("accepts a complete current report and publishes only relative filenames and counts", () => {
  const actual = validateFinishingReport(report(), context);
  expect(actual.fileCount).toBe(5);
  expect(actual.passedTests).toBe(5);
  expect(actual.files).toHaveLength(5);
  expect(JSON.stringify(actual)).not.toContain(root);
  expect(JSON.stringify(actual)).not.toContain("actual fixture");
});
it.each(["missing", "duplicate", "foreign", "empty"] as const)(
  "rejects %s file selection",
  (kind) => {
    const value = report();
    if (kind === "missing") value.testResults.pop();
    if (kind === "duplicate")
      value.testResults[1]!.name = value.testResults[0]!.name;
    if (kind === "foreign")
      value.testResults[0]!.name = resolve(root, "tests/other.test.ts");
    if (kind === "empty") value.testResults[0]!.assertionResults = [];
    expect(() => validateFinishingReport(value, context)).toThrow();
  },
);
it.each(["failed", "pending", "skipped", "todo", "unknown"])(
  "rejects an actual %s case even when aggregate counters claim success",
  (status) => {
    const value = report();
    value.testResults[0]!.assertionResults[0]!.status = status;
    expect(() => validateFinishingReport(value, context)).toThrow();
  },
);
it.each([
  "numFailedTests",
  "numPendingTests",
  "numTodoTests",
  "numFailedTestSuites",
  "numPendingTestSuites",
] as const)("rejects nonzero %s", (field) => {
  const value = report();
  value[field] = 1;
  expect(() => validateFinishingReport(value, context)).toThrow();
});
it.each([
  "numTotalTests",
  "numPassedTests",
  "numTotalTestSuites",
  "numPassedTestSuites",
] as const)("rejects contradictory %s", (field) => {
  const value = report();
  value[field] += 1;
  expect(() => validateFinishingReport(value, context)).toThrow();
});
it("rejects unsuccessful suites, failure details, duplicate cases, stale clocks and snapshot failures", () => {
  for (const mutate of [
    (v: ReturnType<typeof report>) => {
      v.success = false;
    },
    (v: ReturnType<typeof report>) => {
      v.testResults[0]!.status = "failed";
    },
    (v: ReturnType<typeof report>) => {
      v.testResults[0]!.assertionResults[0]!.failureMessages = [
        "failure",
      ] as never[];
    },
    (v: ReturnType<typeof report>) => {
      v.testResults[0]!.assertionResults.push(
        v.testResults[0]!.assertionResults[0]!,
      );
      v.numTotalTests++;
      v.numPassedTests++;
    },
    (v: ReturnType<typeof report>) => {
      v.startTime = 500;
    },
    (v: ReturnType<typeof report>) => {
      v.testResults[0]!.endTime = 6000;
    },
    (v: ReturnType<typeof report>) => {
      v.snapshot.failure = true;
    },
  ]) {
    const value = report();
    mutate(value);
    expect(() => validateFinishingReport(value, context)).toThrow();
  }
});
it("requires the separate finishing invocation and bounded summary artifact while retaining the original aggregate prerequisite", () => {
  const workflow = readFileSync(".github/workflows/render-qa.yml", "utf8");
  expect(workflow).toContain("scripts/ci/run-render-qa-finishing.ts");
  expect(workflow).toContain("finishing-qa-${{ matrix.id }}");
  expect(workflow).toContain("openfilm-render-qa-finishing/*.summary.json");
  expect(workflow).toContain("MATRIX_RESULT: ${{ needs.render-qa.result }}");
  expect(workflow).toContain(
    "pattern: render-qa-*-${{ env.OPENFILM_SOURCE_CANDIDATE }}",
  );
  expect(workflow).not.toMatch(/continue-on-error|paths-ignore/u);
});
