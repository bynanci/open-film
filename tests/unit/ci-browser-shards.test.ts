// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  browserShardCount,
  validateBrowserPartition,
  validateBrowserResults,
} from "../../scripts/ci/browser-shards.js";

const candidate = "a".repeat(40);
const ids = Array.from(
  { length: browserShardCount },
  (_, i) => `test-${i + 1}`,
);
function report(selected: string[], current?: number) {
  return {
    config: {
      workers: 1,
      fullyParallel: false,
      metadata: { sourceCandidate: candidate },
      projects: [{ id: "", retries: 0, repeatEach: 1 }],
      shard: current ? { current, total: browserShardCount } : null,
    },
    errors: [],
    stats: { expected: selected.length, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [
      {
        suites: [],
        specs: selected.map((id) => ({
          id,
          ok: true,
          tests: [
            {
              projectId: "",
              expectedStatus: "passed",
              status: "expected",
              results: [{ status: "passed", retry: 0 }],
            },
          ],
        })),
      },
    ],
  };
}
function reports() {
  return ids.map((id, i) => report([id], i + 1));
}
function validShards() {
  return ids.map((id) => [id]);
}
const invalidPartitions: string[][][] = [
  ids.slice(0, browserShardCount - 1).map((id) => [id]),
  (() => {
    const shards = validShards();
    shards[1] = [ids[0]!];
    return shards;
  })(),
  (() => {
    const shards = validShards();
    shards[0] = [ids[0]!, ids[0]!];
    return shards;
  })(),
  (() => {
    const shards = validShards();
    shards[browserShardCount - 1] = ["extra"];
    return shards;
  })(),
  (() => {
    const shards = validShards();
    shards[browserShardCount - 1] = [];
    return shards;
  })(),
  [],
];
it("requires nonempty disjoint exact discovery coverage across all shards", () => {
  expect(validateBrowserPartition(ids, validShards())).toEqual({
    total: browserShardCount,
    shards: ids.map(() => 1),
  });
});
it.each(invalidPartitions)(
  "rejects missing, duplicate, extra, empty or absent shards %#",
  (...shards) => {
    expect(() => validateBrowserPartition(ids, shards)).toThrow();
  },
);
it("verifies executed reports against fresh discovery and candidate", () => {
  expect(validateBrowserResults(report(ids), reports(), candidate)).toEqual({
    total: browserShardCount,
    shards: ids.map(() => 1),
    candidate,
  });
});
it.each(["skipped", "failed", "timedOut", "interrupted"])(
  "rejects %s execution",
  (status) => {
    const actual = reports();
    actual[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = status;
    expect(() =>
      validateBrowserResults(report(ids), actual, candidate),
    ).toThrow();
  },
);
it("rejects a passed retry, flaky status, expected failure or omitted results", () => {
  for (const mutate of [
    (
      test: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      test.results.push({ status: "passed", retry: 1 });
    },
    (
      test: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      test.status = "flaky";
    },
    (
      test: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      test.expectedStatus = "failed";
    },
    (
      test: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      test.results = [];
    },
  ]) {
    const actual = reports();
    mutate(actual[0]!.suites[0]!.specs[0]!.tests[0]!);
    expect(() =>
      validateBrowserResults(report(ids), actual, candidate),
    ).toThrow();
  }
});
it("rejects wrong source, shard identity, missing report and global errors", () => {
  for (const mutate of [
    (actual: ReturnType<typeof reports>) => {
      actual[0]!.config.metadata.sourceCandidate = "b".repeat(40);
    },
    (actual: ReturnType<typeof reports>) => {
      actual[0]!.config.shard!.current = 2;
    },
    (actual: ReturnType<typeof reports>) => {
      actual[0]!.config.shard!.total = 5;
    },
    (actual: ReturnType<typeof reports>) => {
      actual.pop();
    },
    (actual: ReturnType<typeof reports>) => {
      actual[0]!.errors = ["setup failure"] as never[];
    },
    (actual: ReturnType<typeof reports>) => {
      actual[0]!.stats.skipped = 1;
    },
    (actual: ReturnType<typeof reports>) => {
      actual[0]!.config.workers = 2;
    },
  ]) {
    const actual = reports();
    mutate(actual);
    expect(() =>
      validateBrowserResults(report(ids), actual, candidate),
    ).toThrow();
  }
  expect(() =>
    validateBrowserResults(report(ids), reports(), "local"),
  ).toThrow();
});
it("keeps actual docs build and isolated browser VMs mandatory before the legacy gate", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const shardMatrix = `shard: [${Array.from(
    { length: browserShardCount },
    (_, i) => i + 1,
  ).join(", ")}]`;
  expect(workflow).toContain("browser-e2e:");
  expect(workflow).toMatch(/push:\n\s+branches: \[main\]\n\s+pull_request:/u);
  expect(workflow).toContain("fail-fast: false");
  expect(workflow).toContain(shardMatrix);
  expect(workflow).toContain(
    "--shard=${{ matrix.shard }}/${{ strategy.job-total }}",
  );
  expect(workflow).toContain("pnpm test:browser-partition");
  expect(workflow).toContain("pnpm test:browser-results");
  expect(workflow).toContain("BROWSER_RESULT: ${{ needs.browser-e2e.result }}");
  expect(workflow).toContain("DOCS_RESULT: ${{ needs.docs-site.result }}");
  const browser = workflow
    .split("  browser-e2e:\n")[1]
    ?.split("\n  docs-site:")[0];
  expect(browser?.split("    steps:\n")[0]).not.toContain("runner.temp");
  expect(browser).toContain(
    "      - run: pnpm test:e2e --shard=${{ matrix.shard }}/${{ strategy.job-total }} --reporter=list,github,json\n        env:\n          PLAYWRIGHT_JSON_OUTPUT_NAME: ${{ runner.temp }}/e2e-result-${{ matrix.shard }}.json",
  );
  const docs = workflow.split("  docs-site:\n")[1]?.split("\n  #")[0];
  expect(docs).toContain("npm ci");
  expect(docs).toContain("npm run build");
  expect(
    workflow.split("  heavy-media-qa:\n")[1]?.split("\n  browser-e2e:")[0],
  ).not.toContain("pnpm test:e2e");
  expect(readFileSync("playwright.config.ts", "utf8")).toContain("workers: 1");
  expect(readFileSync("docs/.vitepress/config.mts", "utf8")).not.toMatch(
    /ignoreDeadLinks\s*:/u,
  );
  for (const file of ["docs/architecture.md", "docs/en/architecture.md"])
    expect(readFileSync(file, "utf8")).toContain(
      "https://github.com/bynanci/open-film/blob/main/docs/superpowers/specs/2026-10-30-proxy-storage-design.md",
    );
});
