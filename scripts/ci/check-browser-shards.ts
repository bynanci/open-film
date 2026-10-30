// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  browserShardCount,
  browserTestIds,
  validateBrowserPartition,
  validateBrowserResults,
} from "./browser-shards.js";

function discover(shard?: number): unknown {
  const output = execFileSync(
    process.execPath,
    [
      resolve("node_modules/@playwright/test/cli.js"),
      "test",
      "--list",
      "--reporter=json",
      ...(shard ? [`--shard=${shard}/${browserShardCount}`] : []),
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
  );
  return JSON.parse(output);
}

const [mode, directory] = process.argv.slice(2);
if (mode === "partition" && !directory) {
  const all = browserTestIds(discover());
  const shards = Array.from({ length: browserShardCount }, (_, i) =>
    browserTestIds(discover(i + 1)),
  );
  console.log(
    JSON.stringify({
      verified: true,
      ...validateBrowserPartition(all, shards),
    }),
  );
} else if (mode === "results" && directory) {
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
    "Usage: check-browser-shards.ts partition | results <report-directory>",
  );
