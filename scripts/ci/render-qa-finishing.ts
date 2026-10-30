// SPDX-License-Identifier: Apache-2.0
import { isAbsolute, relative, resolve } from "node:path";
export const renderQaFinishingFiles = Object.freeze([
  "packages/render/tests/photo-easing.test.ts",
  "packages/render/tests/photo-ambient.test.ts",
  "packages/render/tests/bilingual-title-finishing.test.ts",
  "packages/render/tests/primary-color.test.ts",
  "packages/render/tests/photo-primary-local-look.test.ts",
]);
export const MAX_FINISHING_REPORT_BYTES = 4 * 1024 ** 2;
export function finishingVitestArgs(checkoutRoot: string, reportPath: string) {
  return [
    resolve(checkoutRoot, "node_modules/vitest/vitest.mjs"),
    "run",
    ...renderQaFinishingFiles,
    "--maxWorkers=1",
    "--retry=0",
    "--allowOnly=false",
    "--reporter=json",
    `--outputFile=${reportPath}`,
  ];
}
export interface FinishingReportContext {
  checkoutRoot: string;
  startedAt: number;
  endedAt: number;
}
function invalid(): never {
  throw new Error(
    "Finishing QA requires the exact current five-file all-passed report.",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid();
  return value;
}
function time(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    invalid();
  return value;
}
export function validateFinishingReport(
  value: unknown,
  context: FinishingReportContext,
) {
  const report = record(value);
  const startedAt = time(context.startedAt),
    endedAt = time(context.endedAt);
  const reportStart = time(report.startTime);
  if (
    !isAbsolute(context.checkoutRoot) ||
    endedAt < startedAt ||
    reportStart < startedAt ||
    reportStart > endedAt ||
    report.success !== true
  )
    invalid();
  for (const field of [
    "numFailedTests",
    "numPendingTests",
    "numTodoTests",
    "numFailedTestSuites",
    "numPendingTestSuites",
  ])
    if (count(report[field]) !== 0) invalid();
  if (record(report.snapshot).failure !== false) invalid();
  const results = report.testResults;
  if (
    !Array.isArray(results) ||
    results.length !== renderQaFinishingFiles.length
  )
    invalid();
  const expected = new Set<string>(renderQaFinishingFiles);
  const seen = new Map<string, number>();
  let passedTests = 0;
  for (const value of results) {
    const suite = record(value);
    if (
      typeof suite.name !== "string" ||
      !isAbsolute(suite.name) ||
      suite.status !== "passed"
    )
      invalid();
    const path = relative(context.checkoutRoot, resolve(suite.name)).replaceAll(
      "\\",
      "/",
    );
    if (!expected.has(path) || seen.has(path)) invalid();
    const suiteStart = time(suite.startTime),
      suiteEnd = time(suite.endTime);
    if (suiteStart < reportStart || suiteEnd < suiteStart || suiteEnd > endedAt)
      invalid();
    const assertions = suite.assertionResults;
    if (
      !Array.isArray(assertions) ||
      assertions.length === 0 ||
      assertions.length > 1000
    )
      invalid();
    const names = new Set<string>();
    for (const value of assertions) {
      const assertion = record(value);
      if (
        assertion.status !== "passed" ||
        typeof assertion.fullName !== "string" ||
        !assertion.fullName.trim() ||
        names.has(assertion.fullName) ||
        !Array.isArray(assertion.failureMessages) ||
        assertion.failureMessages.length !== 0
      )
        invalid();
      names.add(assertion.fullName);
    }
    seen.set(path, assertions.length);
    passedTests += assertions.length;
  }
  if (
    seen.size !== expected.size ||
    count(report.numTotalTestSuites) !== expected.size ||
    count(report.numPassedTestSuites) !== expected.size ||
    count(report.numTotalTests) !== passedTests ||
    count(report.numPassedTests) !== passedTests ||
    passedTests === 0
  )
    invalid();
  return {
    fileCount: seen.size,
    passedTests,
    files: [...seen]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, passedTests]) => ({ path, passedTests })),
  };
}
