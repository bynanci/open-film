// SPDX-License-Identifier: Apache-2.0
export const browserShardCount = 4;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid browser report object.");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid browser report array.");
  return value;
}
function nonemptyString(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 512)
    throw new Error("Invalid browser test identity.");
  return value;
}

function cases(
  report: unknown,
): { id: string; test: Record<string, unknown>; ok: unknown }[] {
  const parsed = record(report);
  if (array(parsed.errors).length)
    throw new Error("Browser report contains global errors.");
  const entries: ReturnType<typeof cases> = [];
  let visited = 0;
  function visit(suites: unknown, depth: number) {
    if (depth > 32) throw new Error("Browser suite nesting exceeds the bound.");
    for (const suite of array(suites)) {
      if (++visited > 10_000)
        throw new Error("Browser suite count exceeds the bound.");
      const current = record(suite);
      for (const spec of array(current.specs ?? [])) {
        const parsedSpec = record(spec);
        for (const test of array(parsedSpec.tests)) {
          const parsedTest = record(test);
          if (typeof parsedTest.projectId !== "string")
            throw new Error("Missing browser project identity.");
          entries.push({
            id: JSON.stringify([
              nonemptyString(parsedSpec.id),
              parsedTest.projectId,
            ]),
            test: parsedTest,
            ok: parsedSpec.ok,
          });
          if (entries.length > 10_000)
            throw new Error("Browser test count exceeds the bound.");
        }
      }
      visit(current.suites ?? [], depth + 1);
    }
  }
  visit(parsed.suites, 0);
  return entries;
}

export function browserTestIds(report: unknown): string[] {
  return cases(report).map(({ id }) => id);
}

export function validateBrowserPartition(
  all: readonly string[],
  shards: readonly (readonly string[])[],
): { total: number; shards: number[] } {
  if (shards.length !== browserShardCount)
    throw new Error("Exactly four browser shards are required.");
  for (const inventory of [all, ...shards]) {
    if (
      !inventory.length ||
      inventory.length > 10_000 ||
      inventory.some((id) => !id) ||
      new Set(inventory).size !== inventory.length
    )
      throw new Error(
        "Browser inventory is empty, duplicated or exceeds its bound.",
      );
  }
  const expected = new Set(all);
  const selected = shards.flat();
  if (new Set(selected).size !== selected.length)
    throw new Error("Browser shards overlap.");
  if (
    selected.length !== expected.size ||
    selected.some((id) => !expected.has(id))
  )
    throw new Error("Browser shards do not exactly cover full discovery.");
  return { total: all.length, shards: shards.map((ids) => ids.length) };
}

export function validateBrowserResults(
  discovery: unknown,
  reports: readonly unknown[],
  candidate: string,
): { total: number; shards: number[]; candidate: string } {
  if (!/^[a-f0-9]{40}$/u.test(candidate))
    throw new Error("An exact source candidate SHA is required.");
  if (reports.length !== browserShardCount)
    throw new Error("Missing browser shard reports.");
  const expected = browserTestIds(discovery);
  const discoveryConfig = record(record(discovery).config);
  if (
    record(discoveryConfig.metadata).sourceCandidate !== candidate ||
    discoveryConfig.shard !== null
  )
    throw new Error("Discovery does not match the full candidate inventory.");
  const inventories = reports.map((report, index) => {
    const parsed = record(report);
    const config = record(parsed.config);
    const shard = record(config.shard);
    if (
      record(config.metadata).sourceCandidate !== candidate ||
      shard.current !== index + 1 ||
      shard.total !== browserShardCount
    )
      throw new Error(
        "Browser report source or shard identity does not match.",
      );
    if (
      config.workers !== 1 ||
      config.fullyParallel !== false ||
      array(config.projects).length !== 1 ||
      array(config.projects).some(
        (project) =>
          record(project).retries !== 0 || record(project).repeatEach !== 1,
      )
    )
      throw new Error(
        "Browser report changed serial execution or retry policy.",
      );
    const entries = cases(report);
    for (const { test, ok } of entries) {
      const results = array(test.results);
      if (
        ok !== true ||
        test.expectedStatus !== "passed" ||
        test.status !== "expected" ||
        results.length !== 1 ||
        record(results[0]).status !== "passed" ||
        record(results[0]).retry !== 0
      )
        throw new Error(
          "Every browser case must execute once and pass without retries.",
        );
    }
    const stats = record(parsed.stats);
    if (
      stats.expected !== entries.length ||
      stats.skipped !== 0 ||
      stats.flaky !== 0 ||
      stats.unexpected !== 0
    )
      throw new Error(
        "Browser report statistics do not prove complete passing execution.",
      );
    return entries.map(({ id }) => id);
  });
  return { ...validateBrowserPartition(expected, inventories), candidate };
}
