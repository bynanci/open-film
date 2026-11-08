// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  browserShardCount,
  browserTestListText,
  browserTestIds,
  partitionBrowserTestCases,
  validateBrowserPartition,
  validateBrowserResults,
  validateBrowserTestFileSpread,
} from "./browser-shards.js";

function discover(
  options: { shard?: string; testList?: string } = {},
): unknown {
  const output = execFileSync(
    process.execPath,
    [
      resolve("node_modules/@playwright/test/cli.js"),
      "test",
      "--list",
      "--reporter=json",
      ...(options.testList ? [`--test-list=${options.testList}`] : []),
      ...(options.shard ? [`--shard=${options.shard}`] : []),
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
  );
  return JSON.parse(output);
}

const [mode, first, second] = process.argv.slice(2);
if (mode === "partition" && !first && !second) {
  const fullDiscovery = discover();
  const all = browserTestIds(fullDiscovery);
  const partitions = partitionBrowserTestCases(fullDiscovery);
  const temporaryDirectory = mkdtempSync(
    resolve(tmpdir(), "openfilm-browser-shards-"),
  );
  try {
    const shardReports = partitions.map((cases, index) => {
      const listPath = resolve(temporaryDirectory, `shard-${index + 1}.txt`);
      writeFileSync(listPath, browserTestListText(cases), { flag: "wx" });
      return discover({ testList: listPath, shard: "1/1" });
    });
    const shards = shardReports.map(browserTestIds);
    console.log(
      JSON.stringify({
        verified: true,
        ...validateBrowserPartition(all, shards),
        transcriptFileSpread: validateBrowserTestFileSpread(
          shardReports,
          "transcript-productivity.spec.ts",
        ),
      }),
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
} else if (mode === "write-list" && first && second && !process.argv[5]) {
  if (!/^[1-6]$/u.test(first))
    throw new Error("Browser shard number must be between 1 and 6.");
  const fullDiscovery = discover();
  const partition = partitionBrowserTestCases(fullDiscovery);
  const listPath = resolve(second);
  writeFileSync(listPath, browserTestListText(partition[Number(first) - 1]!), {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      verified: true,
      shard: Number(first),
      total: partition[Number(first) - 1]!.length,
    }),
  );
} else if (mode === "results" && first && !second) {
  const directory = first;
  const reports = Array.from({ length: browserShardCount }, (_, i) => {
    const file = resolve(directory, `e2e-result-${i + 1}.json`);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024)
      throw new Error(
        "Browser shard report must be a bounded regular JSON file.",
      );
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  });
  console.log(
    JSON.stringify({
      verified: true,
      ...validateBrowserResults(
        discover(),
        reports,
        process.env.OPENFILM_QA_CANDIDATE_SHA ?? "",
      ),
    }),
  );
} else
  throw new Error(
    "Usage: check-browser-shards.ts partition | write-list <shard> <path> | results <report-directory>",
  );
