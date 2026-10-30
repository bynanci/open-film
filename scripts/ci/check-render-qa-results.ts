// SPDX-License-Identifier: Apache-2.0
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  renderQaPlatforms,
  validateRenderQaEvidence,
} from "../../tests/helpers/render-qa-evidence.js";

export function requireRenderQaPrerequisite(outcome: unknown): void {
  if (outcome !== "success")
    throw new Error("Every render QA platform job must succeed");
}
export function validateRenderQaResults(
  reports: unknown[],
  expected: {
    candidateSha: string;
    runId: string;
    runAttempt: string;
    platforms: readonly string[];
  },
) {
  if (
    !/^[a-f0-9]{40}$/u.test(expected.candidateSha) ||
    !/^[1-9]\d*$/u.test(expected.runId) ||
    !/^[1-9]\d*$/u.test(expected.runAttempt) ||
    expected.platforms.length !== renderQaPlatforms.length ||
    new Set(expected.platforms).size !== renderQaPlatforms.length ||
    renderQaPlatforms.some(
      (platform) => !expected.platforms.includes(platform),
    ) ||
    reports.length !== renderQaPlatforms.length
  )
    throw new Error(
      "Render QA requires the exact three-platform current-run inventory",
    );
  const validated = reports.map((report) => validateRenderQaEvidence(report));
  if (
    new Set(validated.map((report) => report.platformId)).size !==
      renderQaPlatforms.length ||
    validated.some(
      (report) =>
        report.candidateSha !== expected.candidateSha ||
        report.runId !== expected.runId ||
        report.runAttempt !== expected.runAttempt,
    )
  )
    throw new Error("Duplicate, missing or stale render QA platform report");
  return {
    verified: true,
    platforms: [...renderQaPlatforms],
    measurements: validated.reduce(
      (total, report) => total + report.metrics.length,
      0,
    ),
    controls: validated.reduce(
      (total, report) => total + report.controls.length,
      0,
    ),
    workstationVerified: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  requireRenderQaPrerequisite(process.env.MATRIX_RESULT);
  const [directory, ...extra] = process.argv.slice(2);
  if (!directory || extra.length)
    throw new Error(
      "Usage: check-render-qa-results.ts <current-run-report-directory>",
    );
  const root = resolve(directory),
    expectedFiles = renderQaPlatforms
      .map((platform) => `${platform}.json`)
      .sort();
  if (
    JSON.stringify((await readdir(root)).sort()) !==
    JSON.stringify(expectedFiles)
  )
    throw new Error("Unexpected or missing render QA report files");
  const reports = await Promise.all(
    expectedFiles.map(async (filename) => {
      const path = resolve(root, filename),
        info = await lstat(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size < 1 ||
        info.size > 1024 * 1024
      )
        throw new Error("Render QA reports must be bounded regular JSON files");
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    }),
  );
  console.log(
    JSON.stringify(
      validateRenderQaResults(reports, {
        candidateSha: process.env.OPENFILM_SOURCE_CANDIDATE ?? "",
        runId: process.env.GITHUB_RUN_ID ?? "",
        runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "",
        platforms: renderQaPlatforms,
      }),
    ),
  );
}
