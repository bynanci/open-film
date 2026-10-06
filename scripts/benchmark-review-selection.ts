/** Generated review preparation only. Run: pnpm exec tsx scripts/benchmark-review-selection.ts [output.json] */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OpenFilmApplication } from "../packages/application/src/index.ts";
import type { Job, ReviewBatch } from "../packages/core/src/index.ts";
import { hashFile } from "../packages/media/src/index.ts";

const repository = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(
  process.argv[2] ?? join(tmpdir(), "openfilm-review-selection-benchmark.json"),
);
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
const files = [
  "scripts/benchmark-review-selection.ts",
  "packages/application/src/knowledge.ts",
  "packages/application/src/transcript-editor.ts",
  "packages/catalog/src/transcript-editor-store.ts",
  "packages/catalog/src/knowledge-store.ts",
  "packages/catalog/src/intelligence-store.ts",
];
const measuredSourceSHA256 = Object.fromEntries(
  await Promise.all(
    files.map(async (file) => [
      file,
      hash(await readFile(join(repository, file))),
    ]),
  ),
);
const repositoryState = {
  head: git("rev-parse", "HEAD"),
  branch: git("branch", "--show-current"),
  trackedDirty: git("diff", "HEAD", "--name-only").split("\n").filter(Boolean),
  measuredSourceSHA256,
};
const sqlite = new DatabaseSync(":memory:");
const sqliteVersion = sqlite
  .prepare("SELECT sqlite_version() AS version")
  .get()!.version;
sqlite.close();
const directory = await mkdtemp(
  join(tmpdir(), "openfilm-selection-benchmark-"),
);
let app: OpenFilmApplication | undefined;
try {
  const setupStart = performance.now();
  const source = join(directory, "generated identity # & 青森.source");
  const sourceBytes =
    "Generated source-identity fixture, not recorded speech or ASR.\n";
  await writeFile(source, sourceBytes);
  const sourceHash = await hashFile(source);
  app = await OpenFilmApplication.create(
    join(directory, "selection.openfilm"),
    "Review selection benchmark",
    {},
    { userDataDirectory: join(directory, "isolated-user-data") },
  );
  const count = 10000;
  app.catalog.upsertAsset({
    id: "generated-source",
    uri: pathToFileURL(source).href,
    name: "Generated identity fixture",
    mediaType: "audio",
    duration: count * 2,
    contentHash: sourceHash,
    metadata: { fixture: "identity-only; source timing is synthetic" },
    tags: [],
    state: {},
  });
  const segments = Array.from({ length: count }, (_, index) => ({
    id: `segment-${index}`,
    start: index * 2,
    end: index * 2 + 1,
    text: `Generated memory ${index}`,
  }));
  const seedStart = performance.now();
  app.catalog.intelligence.replaceTranscript({
    id: "generated-provider-revision",
    assetId: "generated-source",
    language: "en",
    provenance: {
      providerId: "generated-fixture-not-asr",
      model: "deterministic-corpus-1",
      version: "1",
      sourceHash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments,
  });
  const seedMilliseconds = performance.now() - seedStart;
  const setupMilliseconds = performance.now() - setupStart;
  const expectedIds = segments.map((segment) => segment.id);
  const segmentIds = [...expectedIds].reverse();
  const samplesMilliseconds: number[] = [];
  // Use the real public service, then cancel after preparation. This does not
  // time full review or suggestions, and no language provider is configured.
  for (let run = 0; run < 5; run++) {
    const controller = new AbortController();
    const started = performance.now();
    let prepared: number | undefined;
    const job: Job = await app.knowledge.glossaryReview("generated-source", {
      segmentIds,
      batchSize: 100,
      signal: controller.signal,
      onJob() {
        if (prepared !== undefined) return;
        prepared = performance.now() - started;
        controller.abort();
      },
    });
    assert.notEqual(prepared, undefined);
    assert.equal(job.status, "cancelled");
    const batches: ReviewBatch[] = app.knowledge.batches(job.id);
    assert.equal(batches.length, 100);
    assert.deepEqual(
      batches.flatMap((batch) => batch.segmentIds),
      expectedIds,
    );
    assert(batches.every((batch) => batch.status === "cancelled"));
    samplesMilliseconds.push(prepared!);
  }
  const sorted = [...samplesMilliseconds].sort((a, b) => a - b);
  const result = {
    measuredAt: new Date().toISOString(),
    method:
      "Five sequential public glossary-review preparation calls over a generated real SQLite transcript, selecting all 10,000 IDs in reverse order. Measures source verification, transcript loading, selection validation, partitioning and initial queued-job persistence until its notification. Each run then cancels: later batch writes/cancellation and full review are excluded. Fixture generation/seeding are reported separately. No warm-up or cold-cache flush; later calls may use warm caches.",
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
      segmentCount: count,
      selectedCount: segmentIds.length,
      selectionOrder: "reverse transcript order",
      providerId: "generated-fixture-not-asr",
      syntheticDurationSeconds: count * 2,
      sourceHash,
      sourceSizeBytes: Buffer.byteLength(sourceBytes),
      sourceKind: "Identity-only local file; not decoded media or ASR evidence",
      transcriptCorpusSHA256: hash(JSON.stringify(segments)),
      setupMilliseconds,
      seedMilliseconds,
    },
    preparation: {
      samplesMilliseconds,
      minimumMilliseconds: sorted[0],
      medianMilliseconds: sorted[Math.floor(sorted.length / 2)],
      maximumMilliseconds: sorted.at(-1),
      verifiedBatchCountPerRun: 100,
      verifiedSegmentCountPerRun: count,
      verifiedBatchOrder: "original transcript order",
    },
    limits:
      "Observed on this shared development host only. Not a latency SLA, hardware benchmark, ASR/LLM quality/performance result, full review throughput measurement, or UI responsiveness result. Timing is descriptive; the regression test enforces an operation-count bound instead.",
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output,
        head: result.repository.head,
        measuredSourceSHA256,
        setupMilliseconds,
        seedMilliseconds,
        preparation: result.preparation,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    app?.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
