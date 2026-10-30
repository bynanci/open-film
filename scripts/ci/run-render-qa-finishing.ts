// SPDX-License-Identifier: Apache-2.0
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { readPinnedTestFonts } from "../../tests/helpers/render-qa-fonts.js";
import { renderQaPlatforms } from "../../tests/helpers/render-qa-contract.js";
import { observeRenderQaTools } from "../../tests/helpers/render-qa-media.js";
import type { RenderQaToolReceipt } from "./setup-render-qa.js";
import {
  finishingVitestArgs,
  MAX_FINISHING_REPORT_BYTES,
  validateFinishingReport,
} from "./render-qa-finishing.js";
const execute = promisify(execFile);
const sha = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
async function main() {
  const output = process.argv[2];
  if (!output || !isAbsolute(output))
    throw new Error("Finishing QA needs an absolute owned output directory.");
  const platformId = `${process.platform}-${process.arch}`;
  if (!(renderQaPlatforms as readonly string[]).includes(platformId))
    throw new Error("Unsupported finishing QA platform.");
  const hosted = process.env.GITHUB_ACTIONS === "true";
  const candidateSha = git("rev-parse", "HEAD");
  const workingTreeDirty = Boolean(git("status", "--porcelain"));
  if (
    (process.env.OPENFILM_SOURCE_CANDIDATE &&
      process.env.OPENFILM_SOURCE_CANDIDATE !== candidateSha) ||
    (hosted && workingTreeDirty)
  )
    throw new Error(
      "Finishing QA checkout does not match its selected candidate.",
    );
  const runId = process.env.GITHUB_RUN_ID ?? "local",
    runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  if (
    hosted &&
    (!process.env.OPENFILM_SOURCE_CANDIDATE ||
      !/^[1-9][0-9]*$/u.test(runId) ||
      !/^[1-9][0-9]*$/u.test(runAttempt))
  )
    throw new Error("Finishing QA lacks its current hosted run identity.");
  const fonts = await readPinnedTestFonts();
  const receiptPath =
    process.env.OPENFILM_RENDER_QA_TOOL_RECEIPT ??
    join(dirname(fonts.sansRegular.path), "..", "tool-receipt.json");
  const admission = JSON.parse(
    await readFile(receiptPath, "utf8"),
  ) as RenderQaToolReceipt;
  const observedTools = await observeRenderQaTools(admission, hosted);
  await mkdir(output, { recursive: true });
  const rawDirectory = await mkdtemp(join(output, "raw-")),
    rawPath = join(rawDirectory, "finishing-vitest.json");
  const startedAt = Date.now();
  try {
    const result = await execute(
      process.execPath,
      finishingVitestArgs(process.cwd(), rawPath),
      {
        encoding: "utf8",
        timeout: 600_000,
        maxBuffer: MAX_FINISHING_REPORT_BYTES,
        windowsHide: true,
      },
    );
    await writeFile(
      join(rawDirectory, "vitest.log"),
      Buffer.from(result.stdout + result.stderr).subarray(
        0,
        MAX_FINISHING_REPORT_BYTES,
      ),
      { flag: "wx" },
    );
  } catch (cause) {
    const failure = cause as { stdout?: string; stderr?: string };
    await writeFile(
      join(rawDirectory, "vitest.log"),
      Buffer.from(`${failure.stdout ?? ""}${failure.stderr ?? ""}`).subarray(
        0,
        MAX_FINISHING_REPORT_BYTES,
      ),
      { flag: "wx" },
    );
    throw new Error(
      "Finishing Vitest failed; its bounded raw report/log remain local.",
      { cause },
    );
  }
  const endedAt = Date.now(),
    info = await lstat(rawPath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 1 ||
    info.size > MAX_FINISHING_REPORT_BYTES
  )
    throw new Error("Finishing QA report is not a bounded regular file.");
  const raw = await readFile(rawPath);
  if (raw.length !== info.size)
    throw new Error("Finishing QA report changed while reading.");
  const result = validateFinishingReport(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
    { checkoutRoot: process.cwd(), startedAt, endedAt },
  );
  const finalFonts = await readPinnedTestFonts();
  const fontSha256 = Object.fromEntries(
    Object.entries(fonts).map(([key, value]) => [key, value.sha256]),
  );
  if (
    JSON.stringify(fontSha256) !==
      JSON.stringify(
        Object.fromEntries(
          Object.entries(finalFonts).map(([key, value]) => [key, value.sha256]),
        ),
      ) ||
    JSON.stringify(observedTools) !==
      JSON.stringify(await observeRenderQaTools(admission, hosted)) ||
    candidateSha !== git("rev-parse", "HEAD") ||
    workingTreeDirty !== Boolean(git("status", "--porcelain"))
  )
    throw new Error(
      "Finishing QA checkout or admitted inputs changed during execution.",
    );
  const summary = {
    schemaVersion: 1,
    format: "openfilm.render-qa-finishing",
    scope: hosted ? "hosted-pinned" : "local-observation",
    candidateSha,
    workingTreeDirty,
    runId,
    runAttempt,
    platformId,
    rawReportSha256: sha(raw),
    ...result,
    fontSha256,
    observedTools,
    complete: true,
    workstationVerified: false,
  };
  await writeFile(
    join(output, `${platformId}.summary.json`),
    JSON.stringify(summary, null, 2) + "\n",
    { flag: "wx" },
  );
  process.stdout.write(JSON.stringify(summary) + "\n");
}
main().catch((cause: unknown) => {
  const message =
    cause instanceof Error && cause.message.startsWith("Finishing")
      ? cause.message
      : "Finishing QA could not produce a valid current bounded report.";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
