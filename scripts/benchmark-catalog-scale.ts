/** Generated Catalog scale workload. Run: pnpm exec tsx scripts/benchmark-catalog-scale.ts [output.json] */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  encodeAssetPageCursor,
  ProjectCatalog,
} from "../packages/catalog/src/index.ts";
import type { MediaAsset } from "../packages/core/src/index.ts";

const repository = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(
  process.argv[2] ?? join(tmpdir(), "openfilm-catalog-scale-benchmark.json"),
);
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
const sourceFiles = [
  "scripts/benchmark-catalog-scale.ts",
  "packages/catalog/src/index.ts",
  "packages/core/src/validation.ts",
];
const measuredSourceSHA256 = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (file) => [
      file,
      hash(await readFile(join(repository, file))),
    ]),
  ),
);
const sqlite = new DatabaseSync(":memory:");
const sqliteVersion = sqlite
  .prepare("SELECT sqlite_version() AS version")
  .get()!.version;
sqlite.close();

function generatedAsset(index: number): MediaAsset {
  const id = `asset-${String(index).padStart(6, "0")}`;
  return {
    id,
    name: `Generated media ${id}`,
    uri: `file:///openfilm-scale-fixture/${id}.mp4`,
    mediaType: "video",
    duration: 4,
    ...(index % 101 === 0
      ? {}
      : {
          capturedAt: new Date(
            Date.UTC(2020, 0, 1) + index * 1000,
          ).toISOString(),
        }),
    dimensions: { width: 1920, height: 1080 },
    contentHash: `generated-content-${index}`,
    tags: [`batch-${Math.floor(index / 1000)}`, `group-${index % 64}`],
    state: {
      ...(index % 10 === 0 ? { favorite: true } : {}),
      ...(index % 97 === 0 ? { rejected: true } : {}),
    },
    metadata: { fixture: "generated catalog scale workload" },
  };
}

function measure<T>(operation: () => T, validate: (result: T) => void) {
  validate(operation());
  const samplesMilliseconds: number[] = [];
  for (let run = 0; run < 5; run++) {
    const started = performance.now();
    const result = operation();
    samplesMilliseconds.push(performance.now() - started);
    validate(result);
  }
  const sorted = [...samplesMilliseconds].sort((a, b) => a - b);
  return {
    samplesMilliseconds,
    minimumMilliseconds: sorted[0]!,
    medianMilliseconds: sorted[Math.floor(sorted.length / 2)]!,
    maximumMilliseconds: sorted.at(-1)!,
    warmupRuns: 1,
  };
}

async function benchmarkCatalog(assetCount: number, root: string) {
  const directory = join(root, `catalog-${assetCount}`);
  await mkdir(directory);
  const catalog = new ProjectCatalog(directory);
  let catalogClosed = false;
  let diagnosticDatabase: DatabaseSync | undefined;
  try {
    let assets = Array.from({ length: assetCount }, (_, index) =>
      generatedAsset(index),
    );
    const expectedChronologicalIds = [
      ...assets.filter((asset) => asset.capturedAt).map((asset) => asset.id),
      ...assets.filter((asset) => !asset.capturedAt).map((asset) => asset.id),
    ];
    const fixtureDigest = createHash("sha256");
    for (const asset of assets)
      fixtureDigest.update(
        `${asset.id}\0${asset.uri}\0${asset.name}\0${asset.capturedAt}\n`,
      );
    const fixtureSha256 = fixtureDigest.digest("hex");
    const memoryBeforeSeed = process.memoryUsage();
    const seedStarted = performance.now();
    catalog.withProjectWrite(() => {
      for (const asset of assets) catalog.upsertAsset(asset);
    });
    const seedMilliseconds = performance.now() - seedStarted;
    const memoryAfterSeed = process.memoryUsage();
    assets = [];
    diagnosticDatabase = new DatabaseSync(join(directory, "database.sqlite"), {
      readOnly: true,
    });

    const lastIndex = assetCount - 1;
    const firstId = generatedAsset(0).id;
    const middleIndex = Math.floor(assetCount / 2);
    const lastId = generatedAsset(lastIndex).id;
    const lastName = `Generated media ${lastId}`;
    const lastBatchStart = Math.floor(lastIndex / 1000) * 1000;
    const lastBatchTag = `batch-${Math.floor(lastIndex / 1000)}`;
    const lastBatchCount = Math.min(1000, assetCount - lastBatchStart);
    const expectedTagPageIds = expectedChronologicalIds
      .filter((id) => {
        const index = Number(id.slice("asset-".length));
        return (
          index >= lastBatchStart && index < lastBatchStart + lastBatchCount
        );
      })
      .slice(0, 60);
    const pageSize = 60;
    const page = (offset: number) =>
      catalog.listAssets({ limit: pageSize, offset });
    const legacyPage = (offset: number) =>
      diagnosticDatabase!
        .prepare(
          `SELECT data FROM assets
           ORDER BY captured_at IS NULL,captured_at ASC,id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(pageSize, offset)
        .map((row) => (JSON.parse(String(row.data)) as MediaAsset).id);
    const expectedPageIds = (offset: number) =>
      expectedChronologicalIds.slice(offset, offset + pageSize);
    const cursorAtOffset = (offset: number): string | undefined => {
      if (offset <= 0) return undefined;
      const previousId = expectedChronologicalIds[offset - 1]!;
      const previous = generatedAsset(
        Number(previousId.slice("asset-".length)),
      );
      return encodeAssetPageCursor({
        capturedAt: previous.capturedAt ?? null,
        id: previous.id,
      });
    };
    const cursorPage = (offset: number) =>
      catalog.listAssetPage({
        limit: pageSize,
        ...(cursorAtOffset(offset) ? { cursor: cursorAtOffset(offset) } : {}),
      });
    const escapedPattern = (search: string) =>
      `%${search.replace(/[\\%_]/gu, "\\$&")}%`;
    const legacySubstringSearch = (search: string) =>
      diagnosticDatabase!
        .prepare(
          `SELECT data FROM assets
           WHERE name LIKE ? ESCAPE '\\'
              OR EXISTS (
                SELECT 1 FROM json_each(assets.data,'$.tags')
                WHERE value LIKE ? ESCAPE '\\'
              )
           ORDER BY captured_at IS NULL,captured_at ASC,id ASC LIMIT ?`,
        )
        .all(escapedPattern(search), escapedPattern(search), pageSize)
        .map((row) => (JSON.parse(String(row.data)) as MediaAsset).id);
    const legacyFirstPage = measure(
      () => legacyPage(0),
      (ids) => assert.deepEqual(ids, expectedPageIds(0)),
    );
    const firstPage = measure(
      () => page(0).map((asset) => asset.id),
      (ids) => assert.deepEqual(ids, expectedPageIds(0)),
    );
    const cursorFirstPage = measure(
      () => cursorPage(0).assets.map((asset) => asset.id),
      (ids) => assert.deepEqual(ids, expectedPageIds(0)),
    );
    const middleOffset = Math.max(0, middleIndex - Math.floor(pageSize / 2));
    const legacyMiddlePage = measure(
      () => legacyPage(middleOffset),
      (ids) => assert.deepEqual(ids, expectedPageIds(middleOffset)),
    );
    const middlePage = measure(
      () => page(middleOffset).map((asset) => asset.id),
      (ids) => assert.deepEqual(ids, expectedPageIds(middleOffset)),
    );
    const cursorMiddlePage = measure(
      () => cursorPage(middleOffset).assets.map((asset) => asset.id),
      (ids) => assert.deepEqual(ids, expectedPageIds(middleOffset)),
    );
    const lastOffset = Math.max(0, assetCount - pageSize);
    const legacyLastPage = measure(
      () => legacyPage(lastOffset),
      (ids) => assert.deepEqual(ids, expectedPageIds(lastOffset)),
    );
    const lastPage = measure(
      () => page(lastOffset).map((asset) => asset.id),
      (ids) => assert.deepEqual(ids, expectedPageIds(lastOffset)),
    );
    const cursorLastPage = measure(
      () => cursorPage(lastOffset).assets.map((asset) => asset.id),
      (ids) => assert.deepEqual(ids, expectedPageIds(lastOffset)),
    );
    const legacyExactNameSearch = measure(
      () => legacySubstringSearch(lastName),
      (ids) => assert.deepEqual(ids, [lastId]),
    );
    const exactNameSearch = measure(
      () =>
        catalog
          .listAssets({ query: lastName, limit: pageSize })
          .map((asset) => asset.id),
      (ids) => assert.deepEqual(ids, [lastId]),
    );
    const legacyTagSearch = measure(
      () => legacySubstringSearch(lastBatchTag),
      (ids) => assert.deepEqual(ids, expectedTagPageIds),
    );
    const tagSearch = measure(
      () =>
        catalog
          .listAssets({ query: lastBatchTag, limit: pageSize })
          .map((asset) => asset.id),
      (ids) => assert.deepEqual(ids, expectedTagPageIds),
    );
    const pointLookup = measure(
      () => catalog.getAsset(lastId)?.id,
      (id) => assert.equal(id, lastId),
    );
    const countAssets = measure(
      () => catalog.countAssets(),
      (count) => assert.equal(count, assetCount),
    );
    const summaryScan = measure(
      () => {
        let count = 0;
        let first: string | undefined;
        let last: string | undefined;
        for (const asset of catalog.iterateAssetSummaries()) {
          first ??= asset.id;
          last = asset.id;
          count++;
        }
        return { count, first, last };
      },
      (result) =>
        assert.deepEqual(result, {
          count: assetCount,
          first: firstId,
          last: lastId,
        }),
    );
    const explain = (sql: string, ...parameters: number[]) =>
      diagnosticDatabase!
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...parameters)
        .map((row) => String(row.detail));
    const chronologicalPagePlan = explain(
      `SELECT data FROM assets
       ORDER BY captured_at IS NULL,captured_at ASC,id ASC
       LIMIT ? OFFSET ?`,
      pageSize,
      lastOffset,
    );
    const cursorPlanOffset = middleOffset;
    const cursorPlanPreviousId =
      expectedChronologicalIds[cursorPlanOffset - 1]!;
    const cursorPlanPrevious = generatedAsset(
      Number(cursorPlanPreviousId.slice("asset-".length)),
    );
    const cursorPagePlan = diagnosticDatabase!
      .prepare(
        `EXPLAIN QUERY PLAN SELECT data FROM assets
         WHERE captured_at IS NOT NULL AND (captured_at,id)>(?,?)
         ORDER BY captured_at ASC,id ASC LIMIT ?`,
      )
      .all(cursorPlanPrevious.capturedAt, cursorPlanPrevious.id, pageSize + 1)
      .map((row) => String(row.detail));
    const nullCursorPagePlan = diagnosticDatabase!
      .prepare(
        `EXPLAIN QUERY PLAN SELECT data FROM assets
         WHERE captured_at IS NULL AND id>?
         ORDER BY id ASC LIMIT ?`,
      )
      .all("asset-000000", pageSize + 1)
      .map((row) => String(row.detail));
    const nonNullCountPlan = explain(
      "SELECT COUNT(*) AS count FROM assets WHERE captured_at IS NOT NULL",
    );
    const datedPagePlan = explain(
      `SELECT data FROM assets
       WHERE captured_at IS NOT NULL
       ORDER BY captured_at ASC,id ASC LIMIT ? OFFSET ?`,
      pageSize,
      lastOffset,
    );
    const undatedPagePlan = explain(
      "SELECT data FROM assets WHERE captured_at IS NULL ORDER BY id ASC LIMIT ? OFFSET ?",
      pageSize,
      0,
    );
    const legacySearchPlan = diagnosticDatabase!
      .prepare(
        `EXPLAIN QUERY PLAN
        SELECT id FROM assets
        WHERE name LIKE ? ESCAPE '\\'
           OR EXISTS (
             SELECT 1 FROM json_each(assets.data,'$.tags')
             WHERE value LIKE ? ESCAPE '\\'
           )
        ORDER BY captured_at IS NULL,captured_at ASC,id ASC LIMIT ?`,
      )
      .all(escapedPattern(lastName), escapedPattern(lastName), pageSize)
      .map((row) => String(row.detail));
    const indexedSearchPlan = diagnosticDatabase!
      .prepare(
        `EXPLAIN QUERY PLAN
        SELECT candidate.id FROM asset_search
        JOIN assets AS candidate ON candidate.rowid=asset_search.rowid
        WHERE asset_search.name LIKE ? OR asset_search.search_tags LIKE ?`,
      )
      .all(escapedPattern(lastName), escapedPattern(lastName))
      .map((row) => String(row.detail));
    const memoryAfterReads = process.memoryUsage();
    diagnosticDatabase.close();
    diagnosticDatabase = undefined;
    catalog.close();
    catalogClosed = true;
    const databasePath = join(directory, "database.sqlite");
    const currentSchemaBytes = (await stat(databasePath)).size;
    const legacyDatabase = new DatabaseSync(databasePath);
    try {
      legacyDatabase.exec(`
        DROP TRIGGER asset_search_insert;
        DROP TRIGGER asset_search_delete;
        DROP TRIGGER asset_search_update;
        DROP TABLE asset_search;
        ALTER TABLE assets DROP COLUMN search_tags;
        PRAGMA user_version=6;
        VACUUM;
      `);
    } finally {
      legacyDatabase.close();
    }
    const schemaV6Bytes = (await stat(databasePath)).size;
    const migrationStarted = performance.now();
    const migratedCatalog = new ProjectCatalog(directory);
    const searchIndexMigrationMilliseconds =
      performance.now() - migrationStarted;
    try {
      assert.deepEqual(
        migratedCatalog
          .listAssets({ query: lastName, limit: pageSize })
          .map((asset) => asset.id),
        [lastId],
      );
    } finally {
      migratedCatalog.close();
    }
    const migratedDatabaseBytes = (await stat(databasePath)).size;
    return {
      assetCount,
      fixtureSha256,
      seedMilliseconds,
      databaseSizeBytes: migratedDatabaseBytes,
      databaseSizeBeforeV6MigrationBytes: schemaV6Bytes,
      databaseSizeBeforeDowngradeBytes: currentSchemaBytes,
      searchIndexMigrationMilliseconds,
      queryPlans: {
        chronologicalPage: chronologicalPagePlan,
        cursorPage: cursorPagePlan,
        nullCursorPage: nullCursorPagePlan,
        countDatedAssets: nonNullCountPlan,
        datedPage: datedPagePlan,
        undatedPage: undatedPagePlan,
        legacySubstringSearch: legacySearchPlan,
        indexedSubstringSearch: indexedSearchPlan,
      },
      memoryBytes: {
        beforeSeedRss: memoryBeforeSeed.rss,
        afterSeedRss: memoryAfterSeed.rss,
        afterReadsRss: memoryAfterReads.rss,
        beforeSeedHeapUsed: memoryBeforeSeed.heapUsed,
        afterSeedHeapUsed: memoryAfterSeed.heapUsed,
        afterReadsHeapUsed: memoryAfterReads.heapUsed,
      },
      reads: {
        countAssets,
        legacyFirstPage,
        firstPage,
        cursorFirstPage,
        legacyMiddlePage,
        middlePage,
        cursorMiddlePage,
        legacyLastPage,
        lastPage,
        cursorLastPage,
        exactNameSearch,
        legacyExactNameSearch,
        tagSearch,
        legacyTagSearch,
        pointLookup,
        fullSummaryScan: summaryScan,
      },
    };
  } finally {
    diagnosticDatabase?.close();
    if (!catalogClosed) catalog.close();
  }
}

const temporaryBase = resolve(tmpdir());
const temporaryRoot = resolve(
  await mkdtemp(join(temporaryBase, "openfilm-catalog-scale-")),
);
const temporaryRelative = relative(temporaryBase, temporaryRoot);
if (
  !temporaryRelative ||
  temporaryRelative === ".." ||
  temporaryRelative.startsWith(`..${sep}`) ||
  isAbsolute(temporaryRelative)
)
  throw new Error("Benchmark fixture directory escaped the system temp root.");
try {
  const repositoryState = {
    head: git("rev-parse", "HEAD"),
    branch: git("branch", "--show-current"),
    workingTreeStatus: git("status", "--short", "--untracked-files=normal"),
    measuredSourceSHA256,
  };
  const results = [];
  for (const count of [10_000, 100_000])
    results.push(await benchmarkCatalog(count, temporaryRoot));
  const result = {
    measuredAt: new Date().toISOString(),
    method:
      "Generated video-asset catalogs with 10,000 and 100,000 rows. Each database is seeded in one IMMEDIATE transaction. One warm-up plus five measured repetitions compare the previous escaped-LIKE name/tag scan with indexed public Catalog search and cover first/middle/last chronological 60-row pages, ID lookup and a complete paged summary scan. Query plans, schema v6-to-v7 migration time, database bytes and unforced process-memory observations are recorded separately. No source media is created or decoded.",
    repository: repositoryState,
    runtime: {
      node: process.version,
      sqlite: sqliteVersion,
      os: platform(),
      release: release(),
      architecture: arch(),
      cpuModel: cpus()[0]?.model,
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    fixture: {
      mediaFilesCreated: 0,
      mediaFilesDecoded: 0,
      pageSize: 60,
      summaryPageSize: 500,
      searchTerms: ["unique generated asset name", "batch tag"],
      warmupRuns: 1,
      measuredRuns: 5,
    },
    scales: results,
    limits:
      "Synthetic Catalog workload only. Does not measure filesystem discovery, media hashing/inspection, proxy generation, analysis/provider work, rendering, desktop UI responsiveness, native installation, or long-session workstation memory. Timings describe this host and are not a support guarantee or SLA.",
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output,
        head: repositoryState.head,
        measuredSourceSHA256,
        scales: results.map((scale) => ({
          assetCount: scale.assetCount,
          seedMilliseconds: scale.seedMilliseconds,
          databaseSizeBytes: scale.databaseSizeBytes,
          reads: Object.fromEntries(
            Object.entries(scale.reads).map(([name, value]) => [
              name,
              typeof value === "object" &&
              value &&
              "medianMilliseconds" in value
                ? {
                    medianMilliseconds: value.medianMilliseconds,
                    minimumMilliseconds: value.minimumMilliseconds,
                    maximumMilliseconds: value.maximumMilliseconds,
                  }
                : value,
            ]),
          ),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
