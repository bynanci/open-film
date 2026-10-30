// SPDX-License-Identifier: Apache-2.0
import { isAbsolute, relative, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
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
interface FinishingFailure {
  path: string;
  assertionIndex: number;
  kind:
    | "numeric-comparison"
    | "length-comparison"
    | "equality"
    | "ffmpeg-exit"
    | "assertion"
    | "unclassified";
  actual?: number;
  operator?:
    | "less-than-or-equal"
    | "greater-than-or-equal"
    | "less-than"
    | "greater-than";
  expected?: number;
  location?: { line: number; column: number };
  messageTruncated?: true;
}
/** Failure evidence is diagnostic only. Never publish arbitrary test text/paths. */
export function summarizeFinishingFailure(
  value: unknown,
  context: FinishingReportContext,
): {
  status: "failed" | "unavailable";
  failures: FinishingFailure[];
} {
  try {
    const report = record(value),
      start = time(report.startTime);
    if (
      !isAbsolute(context.checkoutRoot) ||
      start < time(context.startedAt) ||
      start > time(context.endedAt) ||
      report.success !== false ||
      !Array.isArray(report.testResults) ||
      report.testResults.length !== renderQaFinishingFiles.length
    )
      invalid();
    const expected = new Set<string>(renderQaFinishingFiles),
      seen = new Set<string>();
    const failures: FinishingFailure[] = [];
    for (const entry of report.testResults) {
      const suite = record(entry);
      if (typeof suite.name !== "string" || !isAbsolute(suite.name)) invalid();
      const path = relative(
        context.checkoutRoot,
        resolve(suite.name),
      ).replaceAll("\\", "/");
      if (
        !expected.has(path) ||
        seen.has(path) ||
        time(suite.startTime) < start ||
        time(suite.endTime) < time(suite.startTime) ||
        time(suite.endTime) > context.endedAt ||
        !Array.isArray(suite.assertionResults) ||
        suite.assertionResults.length > 1000
      )
        invalid();
      seen.add(path);
      for (let index = 0; index < suite.assertionResults.length; index++) {
        const assertion = record(suite.assertionResults[index]);
        if (
          !["passed", "failed", "pending", "skipped", "todo"].includes(
            String(assertion.status),
          ) ||
          !Array.isArray(assertion.failureMessages) ||
          assertion.failureMessages.length > 16 ||
          assertion.failureMessages.some(
            (message) => typeof message !== "string",
          )
        )
          invalid();
        if (assertion.status !== "failed") continue;
        if (failures.length >= 50) invalid();
        const messages = assertion.failureMessages as string[];
        const messageTruncated = messages.some(
          (message) => message.length > 4096,
        );
        const message = stripVTControlCharacters(
          messages
            .map((message) =>
              message.length > 4096
                ? `${message.slice(0, 2048)}\n<omitted>\n${message.slice(-2048)}`
                : message,
            )
            .join("\n"),
        );
        const failure: FinishingFailure = {
          path,
          assertionIndex: index,
          kind: "unclassified",
        };
        if (messageTruncated) failure.messageTruncated = true;
        const length =
          /\bto have a length of (\d{1,9}) but got (\d{1,9})\b/u.exec(message);
        const numeric =
          /^\s*(?:AssertionError:\s*)?expected\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+to be (less than or equal to|greater than or equal to|less than|greater than)\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:\s|$)/iu.exec(
            message,
          );
        if (
          numeric &&
          Number.isFinite(Number(numeric[1])) &&
          Number.isFinite(Number(numeric[3]))
        ) {
          failure.kind = "numeric-comparison";
          failure.actual = Number(numeric[1]);
          failure.expected = Number(numeric[3]);
          const operators = {
            "less than or equal to": "less-than-or-equal",
            "greater than or equal to": "greater-than-or-equal",
            "less than": "less-than",
            "greater than": "greater-than",
          } as const;
          failure.operator =
            operators[numeric[2]!.toLowerCase() as keyof typeof operators];
        } else if (length) {
          failure.kind = "length-comparison";
          failure.expected = Number(length[1]);
          failure.actual = Number(length[2]);
        } else if (
          /^AssertionError:.*(?:deeply equal|strictly equal|to equal)/iu.test(
            message,
          )
        )
          failure.kind = "equality";
        else if (
          /Command failed:.*ffmpeg|^(?:Error:\s*)?ffmpeg exited [0-9]+:/imu.test(
            message,
          )
        )
          failure.kind = "ffmpeg-exit";
        else if (/^AssertionError:/u.test(message)) failure.kind = "assertion";
        const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        const location = new RegExp(
          `${escapedPath}:(\\d{1,7}):(\\d{1,5})(?:\\s|\\)|$)`,
          "u",
        ).exec(message.replaceAll("\\", "/"));
        if (location)
          failure.location = {
            line: Number(location[1]),
            column: Number(location[2]),
          };
        failures.push(failure);
      }
    }
    return { status: "failed", failures };
  } catch {
    return { status: "unavailable", failures: [] };
  }
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
