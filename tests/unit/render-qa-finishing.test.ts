// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  finishingVitestArgs,
  renderQaFinishingFiles,
  summarizeFinishingFailure,
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
it("publishes bounded numeric failure facts without raw messages, names or absolute paths", () => {
  const value = report();
  value.success = false;
  value.numFailedTests = 1;
  value.numPassedTests = 4;
  const suite = value.testResults[0]!;
  suite.status = "failed";
  suite.assertionResults[0]!.status = "failed";
  suite.assertionResults[0]!.fullName = "private C:\\Users\\person\\secret.txt";
  suite.assertionResults[0]!.failureMessages = [
    "AssertionError: expected 3.25 to be less than or equal to 3\n /private/media/person.jpg C:\\Users\\person\\secret.txt",
  ];
  const result = summarizeFinishingFailure(value, context);
  expect(result).toEqual({
    status: "failed",
    failures: [
      {
        path: renderQaFinishingFiles[0],
        assertionIndex: 0,
        kind: "numeric-comparison",
        actual: 3.25,
        operator: "less-than-or-equal",
        expected: 3,
      },
    ],
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private|Users|person|secret|AssertionError/u,
  );
  expect(() => validateFinishingReport(value, context)).toThrow();
});
it("retains only known failure categories and rejects foreign, stale or malformed diagnostics", () => {
  const value = report();
  value.success = false;
  value.testResults[1]!.status = "failed";
  value.testResults[1]!.assertionResults[0]!.status = "failed";
  value.testResults[1]!.assertionResults[0]!.failureMessages = [
    "Error: private data outside the expected assertion format",
  ];
  expect(summarizeFinishingFailure(value, context).failures).toEqual([
    {
      path: renderQaFinishingFiles[1],
      assertionIndex: 0,
      kind: "unclassified",
    },
  ]);
  for (const mutate of [
    (v: ReturnType<typeof report>) => {
      v.testResults[0]!.name = resolve(root, "private.test.ts");
    },
    (v: ReturnType<typeof report>) => {
      v.startTime = 1;
    },
    (v: ReturnType<typeof report>) => {
      v.testResults[1]!.assertionResults[0]!.failureMessages = [
        "x".repeat(65537),
      ];
    },
  ]) {
    const next = structuredClone(value);
    mutate(next);
    expect(summarizeFinishingFailure(next, context)).toEqual({
      status: "unavailable",
      failures: [],
    });
  }
});
it("retains only numeric source coordinates from ANSI Windows assertion stacks", () => {
  const value = report();
  value.success = false;
  const assertion = value.testResults[0]!.assertionResults[0]!;
  assertion.status = "failed";
  assertion.failureMessages = [
    "\u001b[31mAssertionError: expected 9 to be greater than 10\u001b[39m\n at C:\\Users\\private\\packages\\render\\tests\\photo-easing.test.ts:42:7)",
  ];
  expect(summarizeFinishingFailure(value, context).failures[0]).toEqual({
    path: renderQaFinishingFiles[0],
    assertionIndex: 0,
    kind: "numeric-comparison",
    actual: 9,
    operator: "greater-than",
    expected: 10,
    location: { line: 42, column: 7 },
  });
  expect(summarizeFinishingFailure(report(), context)).toEqual({
    status: "unavailable",
    failures: [],
  });
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
