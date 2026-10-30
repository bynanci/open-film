// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { validateTestPartition } from "./test-lanes.js";

function discover(config: string): string[] {
  const output = execFileSync(
    process.execPath,
    [
      resolve("node_modules/vitest/vitest.mjs"),
      "list",
      "--filesOnly",
      "--json",
      "--config",
      config,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 60_000 },
  );
  const rows: unknown = JSON.parse(output);
  if (!Array.isArray(rows))
    throw new Error("Invalid Vitest discovery response.");
  return rows.map((row: unknown) => {
    if (
      !row ||
      typeof row !== "object" ||
      !("file" in row) ||
      typeof row.file !== "string"
    )
      throw new Error("Invalid Vitest test-file record.");
    return relative(process.cwd(), row.file).split(sep).join("/");
  });
}

const result = validateTestPartition(
  discover("vitest.config.ts"),
  discover("vitest.contract.config.ts"),
  discover("vitest.media.config.ts"),
);
console.log(JSON.stringify({ verified: true, ...result }));
