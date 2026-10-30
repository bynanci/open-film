// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateTestPartition } from "../../scripts/ci/test-lanes.js";

const contract = "packages/core/tests/schema.test.ts";
const media = "tests/integration/render.test.ts";

it("requires exact disjoint coverage of every root test", () => {
  expect(validateTestPartition([contract, media], [contract], [media])).toEqual(
    {
      total: 2,
      contracts: 1,
      media: 1,
    },
  );
});
it.each([
  { all: [contract, media], fast: [contract], heavy: [contract, media] },
  { all: [contract, media], fast: [contract], heavy: [] },
  {
    all: [contract, media, "tests/unit/omitted.test.ts"],
    fast: [contract],
    heavy: [media],
  },
  {
    all: [contract, media],
    fast: [contract],
    heavy: ["tests/unit/replacement.test.ts"],
  },
  {
    all: [contract, media],
    fast: [contract],
    heavy: [media, "tests/unit/extra.test.ts"],
  },
  { all: [contract, media], fast: [contract, contract], heavy: [media] },
  { all: [contract, media, media], fast: [contract], heavy: [media] },
  { all: [], fast: [], heavy: [] },
  {
    all: ["../outside.test.ts", media],
    fast: ["../outside.test.ts"],
    heavy: [media],
  },
])(
  "rejects missing, duplicate, overlapping, empty or escaped inventories %#",
  ({ all, fast, heavy }) => {
    expect(() => validateTestPartition(all, fast, heavy)).toThrow();
  },
);
it("keeps all previous CI commands and requires both new lanes", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  for (const name of [
    "fast-contract-check:",
    "heavy-media-qa:",
    "typescript-and-media:",
    "native-shell:",
  ])
    expect(workflow).toContain(name);
  for (const command of [
    "pnpm format:check",
    "pnpm test:i18n",
    "pnpm test:docs-i18n",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test:contracts",
    "pnpm test:ci-partition",
    "pnpm test:media",
    "pnpm build",
    "pnpm test:interchange",
    "node scripts/smoke-built-cli.mjs",
    "pnpm test:e2e",
    "pnpm test:native",
    "cargo build --locked",
  ])
    expect(workflow).toContain(command);
  const aggregate = workflow.match(
    / {2}typescript-and-media:\n([\s\S]*?)(?=\n {2}native-shell:)/u,
  )?.[1];
  expect(aggregate).toBeDefined();
  expect(aggregate).toContain("needs: [fast-contract-check, heavy-media-qa]");
  expect(aggregate).toContain("if: always()");
  expect(aggregate).toContain("node scripts/ci/check-required-lanes.mjs");
  expect(aggregate).toContain(
    "FAST_RESULT: ${{ needs.fast-contract-check.result }}",
  );
  expect(aggregate).toContain(
    "MEDIA_RESULT: ${{ needs.heavy-media-qa.result }}",
  );
  expect(workflow).not.toMatch(/continue-on-error|paths-ignore|\bpaths:/u);
});
it.each(["success", "failure", "cancelled", "skipped", ""])(
  "cannot pass the aggregate unless both lanes succeeded (fast=%s)",
  (fast) => {
    for (const heavy of ["success", "failure", "cancelled", "skipped", ""]) {
      const run = () =>
        execFileSync(
          process.execPath,
          ["scripts/ci/check-required-lanes.mjs"],
          {
            env: { ...process.env, FAST_RESULT: fast, MEDIA_RESULT: heavy },
            stdio: "pipe",
          },
        );
      if (fast === "success" && heavy === "success") expect(run).not.toThrow();
      else expect(run).toThrow();
    }
  },
);
