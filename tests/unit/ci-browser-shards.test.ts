// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  validateBrowserPartition,
  validateBrowserResults,
} from "../../scripts/ci/browser-shards.js";

const candidate = "a".repeat(40);
const ids = ["one", "two", "three", "four", "five"];
function report(selected: string[], current?: number) {
  return {
    config: {
      workers: 1,
      fullyParallel: false,
      metadata: { sourceCandidate: candidate },
      projects: [{ id: "", retries: 0, repeatEach: 1 }],
      shard: current ? { current, total: 4 } : null,
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
  return [
    report(ids.slice(0, 2), 1),
    ...ids.slice(2).map((id, i) => report([id], i + 2)),
  ];
}
it("requires nonempty disjoint exact discovery coverage across four shards", () => {
  expect(
    validateBrowserPartition(ids, [
      ids.slice(0, 2),
      [ids[2]!],
      [ids[3]!],
      [ids[4]!],
    ]),
  ).toEqual({ total: 5, shards: [2, 1, 1, 1] });
});
it.each([
  [["one"], ["two"], ["three"], ["four"]],
  [["one", "two"], ["two", "three"], ["four"], ["five"]],
  [["one", "one", "two"], ["three"], ["four"], ["five"]],
  [["one", "two"], ["three"], ["four"], ["extra"]],
  [ids, [], [], []],
  [ids],
])(
  "rejects missing, duplicate, extra, empty or absent shards %#",
  (...shards) => {
    expect(() => validateBrowserPartition(ids, shards)).toThrow();
  },
);
it("verifies executed reports against fresh discovery and candidate", () => {
  expect(validateBrowserResults(report(ids), reports(), candidate)).toEqual({
    total: 5,
    shards: [2, 1, 1, 1],
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
  expect(workflow).toContain("browser-e2e:");
  expect(workflow).toMatch(/push:\n\s+branches: \[main\]\n\s+pull_request:/u);
  expect(workflow).toContain("fail-fast: false");
  expect(workflow).toContain("shard: [1, 2, 3, 4]");
  expect(workflow).toContain("--shard=${{ matrix.shard }}/4");
  expect(workflow).toContain("pnpm test:browser-partition");
  expect(workflow).toContain("pnpm test:browser-results");
  expect(workflow).toContain("BROWSER_RESULT: ${{ needs.browser-e2e.result }}");
  expect(workflow).toContain("DOCS_RESULT: ${{ needs.docs-site.result }}");
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
