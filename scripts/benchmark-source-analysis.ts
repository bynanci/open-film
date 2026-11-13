/**
 * Synthetic, metadata-only Common Analysis benchmark. No media is decoded.
 * pnpm exec tsx scripts/benchmark-source-analysis.ts <assets> <bindings-per-asset> <output.json>
 * Run identical script bytes on both source revisions, without competing heavy work.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { ProjectCatalog } from "../packages/catalog/src/index.ts";
import type { MediaAsset } from "../packages/core/src/index.ts";
import { SourceAnalysisService } from "../packages/application/src/source-analysis.ts";

const repository = fileURLToPath(new URL("..", import.meta.url));
const assetCount = Number(process.argv[2]);
const copies = Number(process.argv[3]);
assert(
  Number.isSafeInteger(assetCount) && assetCount >= 1 && assetCount <= 10_000,
);
assert(
  Number.isSafeInteger(copies) && copies >= 1 && assetCount * copies <= 50_000,
);
assert(process.argv[4], "An external, new output path is required.");
const output = resolve(process.argv[4]);
const outputRelative = relative(repository, output);
assert(
  outputRelative === ".." ||
    outputRelative.startsWith(`..${sep}`) ||
    isAbsolute(outputRelative),
  "Keep benchmark results outside the source checkout.",
);
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
const sourcePaths = [
  "scripts/benchmark-source-analysis.ts",
  "packages/application/src/source-analysis.ts",
  "packages/catalog/src/index.ts",
  "packages/catalog/src/multi-source-store.ts",
  "packages/events/src/index.ts",
];
const sourceSha256 = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (path) => [
      path,
      digest(await readFile(join(repository, path))),
    ]),
  ),
);
const startedAt = new Date().toISOString();
const sourceHead = git("rev-parse", "HEAD");
const sqlite = new DatabaseSync(":memory:");
const sqliteVersion = sqlite
  .prepare("SELECT sqlite_version() AS version")
  .get()!.version;
sqlite.close();
const fixtureVersion = "common-analysis-metadata-v1";
const projectId = "benchmark-project";
const createdAt = "2026-01-01T00:00:00.000Z";
const manifestId = `manifest-${assetCount}-${copies}`;
const bindingId = (index: number) =>
  `binding-${String(index).padStart(6, "0")}`;
const occurrenceId = (index: number) =>
  `occurrence-${String(index).padStart(6, "0")}`;
const assetId = (index: number) => `asset-${String(index).padStart(6, "0")}`;
const contentHash = (index: number) => digest(`${fixtureVersion}:${index}`);
function asset(index: number): MediaAsset {
  return {
    id: assetId(index),
    name: `Synthetic image ${index}`,
    uri: `file:///synthetic-analysis-benchmark/${assetId(index)}.png`,
    mediaType: "image",
    contentHash: contentHash(index),
    // Groups of 100 stay below the existing per-evidence byte limit.
    capturedAt: new Date(
      Date.UTC(2020, 0, 1) +
        Math.floor(index / 100) * 86_400_000 +
        (index % 100) * 1000,
    ).toISOString(),
    dimensions: { width: 1920, height: 1080 },
    tags: [],
    state: {},
    metadata: { fixture: fixtureVersion },
  };
}

async function seed(directory: string) {
  await mkdir(directory);
  const catalog = new ProjectCatalog(directory);
  try {
    catalog.multiSource.saveSelection({
      id: "selection",
      projectId,
      kind: "folder",
      displayName: "Synthetic metadata",
      logicalRootId: "synthetic",
      recursive: true,
      selectionRevision: 1,
    });
    catalog.withProjectWrite(() => {
      for (let index = 0; index < assetCount; index++) {
        catalog.upsertAsset(asset(index));
        catalog.multiSource.saveContentIdentity({
          id: `content-${index}`,
          hashAlgorithm: "sha256",
          fullHash: contentHash(index),
          byteLength: 1,
          mediaKind: "image",
        });
      }
    });
    const totalBindings = assetCount * copies;
    for (let start = 0; start < totalBindings; start += 1000) {
      catalog.multiSource.upsertOccurrences(
        "selection",
        Array.from(
          { length: Math.min(1000, totalBindings - start) },
          (_, offset) => {
            const index = start + offset;
            return {
              occurrence: {
                id: occurrenceId(index),
                logicalRootId: "synthetic",
                displayName: `Synthetic ${index}`,
                relativePath: `image-${index}.png`,
                fileKind: "image" as const,
                availability: "available" as const,
                scanRevision: 1,
              },
              included: true,
            };
          },
        ),
      );
    }
    catalog.withProjectWrite(() => {
      for (let index = 0; index < totalBindings; index++) {
        catalog.multiSource.saveAssetContentVersion({
          id: bindingId(index),
          assetId: assetId(index % assetCount),
          occurrenceId: occurrenceId(index),
          contentId: `content-${index % assetCount}`,
          contextRevision: "context-1",
          descriptorSnapshotId: "synthetic-descriptor",
        });
      }
    });
    catalog.multiSource.createImportBatch(
      {
        id: "batch",
        projectId,
        draftRevision: 1,
        scopeMode: "selected-sources",
        status: "sealing",
        expectedManifestId: "expected",
        createdAt,
      },
      {
        id: "expected",
        batchId: "batch",
        revision: 1,
        selectionHash: digest(fixtureVersion),
        entries: Array.from({ length: totalBindings }, (_, index) => ({
          occurrenceId: occurrenceId(index),
          relativePath: `image-${index}.png`,
          included: true,
        })),
        partialPolicy: "require-all",
        createdAt,
      },
    );
    catalog.multiSource.createVerifiedManifest(
      { id: manifestId, expectedManifestId: "expected", createdAt },
      Array.from({ length: totalBindings }, (_, index) => ({
        occurrenceId: occurrenceId(index),
        status: "verified" as const,
        bindingId: bindingId(index),
        assetId: assetId(index % assetCount),
        contentHash: contentHash(index % assetCount),
        contextRevision: "context-1",
      })),
    );
    catalog.multiSource.finishImportBatch("batch", "sealed");
    return catalog;
  } catch (error) {
    catalog.close();
    throw error;
  }
}

const root = await mkdtemp(join(tmpdir(), "openfilm-analysis-benchmark-"));
const rows = [];
try {
  for (let repetition = 0; repetition < 4; repetition++) {
    const setupStarted = performance.now();
    const catalog = await seed(join(root, `run-${repetition}`));
    const setupMilliseconds = performance.now() - setupStarted;
    try {
      const service = new SourceAnalysisService(projectId, catalog);
      // Diagnostic wrapper on the existing private method; no product API or cache.
      const prepare = Reflect.get(service, "prepare") as (
        ...args: unknown[]
      ) => unknown;
      const preparationMilliseconds: number[] = [];
      Reflect.set(
        service,
        "prepare",
        function (this: SourceAnalysisService, ...args: unknown[]) {
          const started = performance.now();
          try {
            return prepare.apply(this, args);
          } finally {
            preparationMilliseconds.push(performance.now() - started);
          }
        },
      );
      const memoryBefore = process.memoryUsage();
      const cpuBefore = process.cpuUsage();
      const started = performance.now();
      const result = await service.createRun({
        projectId,
        verifiedManifestId: manifestId,
        scopeMode: "selected-sources",
        requestId: "benchmark-run",
      });
      const workflowMilliseconds = performance.now() - started;
      const cpu = process.cpuUsage(cpuBefore);
      const memoryAfter = process.memoryUsage();
      assert.equal(result.run.status, "completed");
      assert.equal(preparationMilliseconds.length, 3);
      assert.equal(result.run.inputBindingIds.length, assetCount * copies);
      assert.equal(result.results.length, Math.ceil(assetCount / 100));
      assert(result.results.every((row) => row.reviewStatus === "pending"));
      const semantic = {
        runId: result.run.id,
        inputFingerprint: result.run.inputFingerprint,
        configHash: result.run.configHash,
        inputBindingIds: result.run.inputBindingIds,
        results: result.results,
      };
      rows.push({
        repetition,
        warmup: repetition === 0,
        setupMilliseconds,
        workflowMilliseconds,
        preparationMilliseconds,
        preparationTotalMilliseconds: preparationMilliseconds.reduce(
          (sum, value) => sum + value,
          0,
        ),
        cpuUserMilliseconds: cpu.user / 1000,
        cpuSystemMilliseconds: cpu.system / 1000,
        memoryBefore,
        memoryAfter,
        semanticSha256: digest(JSON.stringify(semantic)),
        runId: result.run.id,
        inputFingerprint: result.run.inputFingerprint,
        resultCount: result.results.length,
      });
      assert.equal(rows[0]!.semanticSha256, rows.at(-1)!.semanticSha256);
    } finally {
      catalog.close();
    }
  }
  for (const path of sourcePaths)
    assert.equal(
      digest(await readFile(join(repository, path))),
      sourceSha256[path],
      "Measured source changed during the benchmark.",
    );
  assert.equal(
    git("rev-parse", "HEAD"),
    sourceHead,
    "Checkout changed during the benchmark.",
  );
  const report = {
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    fixtureVersion,
    fixtureSha256: digest(
      JSON.stringify({
        fixtureVersion,
        assetCount,
        copies,
        assets: Array.from({ length: assetCount }, (_, index) => asset(index)),
      }),
    ),
    source: {
      head: sourceHead,
      dirty: git("status", "--porcelain"),
      diffSha256: digest(
        execFileSync("git", ["diff", "HEAD", "--", ...sourcePaths], {
          cwd: repository,
        }),
      ),
      sourceSha256,
    },
    environment: {
      node: process.version,
      platform: platform(),
      release: release(),
      architecture: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      sqliteVersion,
      pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
      tsx: (
        JSON.parse(
          await readFile(
            join(repository, "node_modules/tsx/package.json"),
            "utf8",
          ),
        ) as { version: string }
      ).version,
    },
    assetCount,
    bindings: assetCount * copies,
    repetitions: 3,
    warmupRuns: 1,
    processMaximumRSSKiB: process.resourceUsage().maxRSS,
    limitations: [
      "Synthetic metadata, not an import or file-hash benchmark",
      "No FFmpeg decode, encode, seek, native UI or physical memory certification",
      "Heap/RSS snapshots are not per-operation peaks; processMaximumRSS includes setup and all repetitions",
      "Method wrapper is benchmark-only; no production API or scheduler",
    ],
    rows,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
} finally {
  await rm(root, { recursive: true, force: true });
}
