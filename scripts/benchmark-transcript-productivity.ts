/** Generated text workloads only. Run: pnpm exec tsx scripts/benchmark-transcript-productivity.ts [output.json] */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, platform, release, arch, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { OpenFilmApplication } from "../packages/application/src/index.ts";
import { hashFile } from "../packages/media/src/index.ts";
import { compileGlossaryMatcher } from "../packages/core/src/knowledge.ts";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(
  process.argv[2] ??
    join(tmpdir(), "openfilm-transcript-productivity-benchmark.json"),
);
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
const files = [
  "packages/catalog/src/transcript-editor-store.ts",
  "packages/catalog/src/intelligence-store.ts",
  "packages/core/src/transcript-editing.ts",
  "packages/application/src/transcript-editor.ts",
  "packages/core/src/knowledge.ts",
];
const sourceFiles = Object.fromEntries(
  await Promise.all(
    files.map(async (file) => [
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
const directory = await mkdtemp(join(tmpdir(), "openfilm-search-benchmark-"));
let app: OpenFilmApplication | undefined;
try {
  const source = join(directory, "generated identity # & 青森.source");
  const sourceBytes =
    "Generated catalog-only identity fixture, 10,000 deterministic transcript segments. Not audio and not ASR evidence.\n";
  await writeFile(source, sourceBytes);
  const sourceHash = await hashFile(source);
  const setupStart = performance.now();
  app = await OpenFilmApplication.create(
    join(directory, "search.openfilm"),
    "Literal search benchmark",
    {},
    { userDataDirectory: join(directory, "isolated-user-data") },
  );
  app.catalog.upsertAsset({
    id: "generated-source",
    uri: pathToFileURL(source).href,
    name: "Generated identity fixture",
    mediaType: "audio",
    duration: 20000,
    contentHash: sourceHash,
    metadata: { fixture: "identity-only; source timing is synthetic" },
    state: {},
    tags: [],
  });
  const segments = Array.from({ length: 10000 }, (_, index) => ({
    id: `segment-${index}`,
    start: index * 2,
    end: index * 2 + 1,
    text: `Memory ${String(index).padStart(5, "0")}: ${index % 10 === 0 ? "OpenFilm" : index % 5 === 0 ? "openfilm" : "local memories"} ${index % 7 === 0 ? "青森の思い出" : "family journey"} # &. Generated story text describes a quiet walk beside the river and a shared meal with friends.`,
    words: [
      {
        start: index * 2,
        end: index * 2 + 1,
        text: "Generated timing fixture",
      },
    ],
  }));
  const seedStart = performance.now();
  app.catalog.intelligence.replaceTranscript({
    id: "generated-provider-document",
    assetId: "generated-source",
    language: "en",
    provenance: {
      providerId: "generated-fixture-not-asr",
      model: "deterministic-corpus-1",
      version: "1",
      sourceHash,
      createdAt: "2026-10-06T00:00:00.000Z",
    },
    segments,
  });
  const seedMilliseconds = performance.now() - seedStart;
  const setupMilliseconds = performance.now() - setupStart;
  const cases = [
    {
      name: "case-sensitive first page",
      query: "OpenFilm",
      caseSensitive: true,
      offset: 0,
      expected: 1000,
    },
    {
      name: "case-sensitive late page",
      query: "OpenFilm",
      caseSensitive: true,
      offset: 900,
      expected: 1000,
    },
    {
      name: "case-insensitive late page",
      query: "openfilm",
      caseSensitive: false,
      offset: 1700,
      expected: 2000,
    },
    {
      name: "CJK late page",
      query: "青森",
      caseSensitive: true,
      offset: 1000,
      expected: 1429,
    },
    {
      name: "literal symbols dense page",
      query: "# &",
      caseSensitive: true,
      offset: 9900,
      expected: 10000,
    },
    {
      name: "absent literal",
      query: "not-in-this-corpus-92861",
      caseSensitive: false,
      offset: 0,
      expected: 0,
    },
  ];
  const summary = (times: number[]) => {
    const sorted = [...times].sort((a, b) => a - b);
    return {
      samplesMilliseconds: times,
      minimumMilliseconds: sorted[0],
      medianMilliseconds: sorted[Math.floor(sorted.length / 2)],
      maximumMilliseconds: sorted.at(-1),
    };
  };
  // Verify and warm source identity outside the query-only measurement.
  assert.equal(
    await app.intelligence.sourceIdentity("generated-source"),
    sourceHash,
  );
  const measurements = [];
  for (const entry of cases) {
    const options = {
      query: entry.query,
      caseSensitive: entry.caseSensitive,
      offset: entry.offset,
      limit: 100,
    };
    const timings: number[] = [],
      applicationTimings: number[] = [];
    let count = 0;
    for (let iteration = 0; iteration < 5; iteration++) {
      const start = performance.now();
      const result = app.catalog.transcripts.search(
        "generated-source",
        sourceHash,
        options,
      );
      timings.push(performance.now() - start);
      assert.equal(result.totalMatches, entry.expected);
      assert.equal(result.totalSegments, entry.expected);
      count = Math.min(100, Math.max(0, entry.expected - entry.offset));
      assert.equal(result.matches.length, count);
      assert(result.matches.every((row) => row.ranges.length === 1));
    }
    for (let iteration = 0; iteration < 5; iteration++) {
      const start = performance.now();
      const result = await app.transcriptEditor.search(
        "generated-source",
        options,
      );
      applicationTimings.push(performance.now() - start);
      assert.equal(result.totalMatches, entry.expected);
      assert.equal(result.matches.length, count);
    }
    measurements.push({
      ...entry,
      limit: 100,
      returnedRows: count,
      queryOnly: summary(timings),
      applicationWithWarmSourceIdentity: summary(applicationTimings),
    });
  }
  const terms = Array.from({ length: 1000 }, (_, id) => ({
    id: String(id),
    source: `term-${id}`,
    replacement: `Term ${id}`,
    scope: "project" as const,
    enabled: true,
    caseSensitive: true,
    createdAt: "2026-10-06T00:00:00Z",
    updatedAt: "2026-10-06T00:00:00Z",
  }));
  const matcherStart = performance.now();
  const match = compileGlossaryMatcher(terms);
  const matcherCompiled = performance.now();
  let matchCount = 0;
  for (let id = 0; id < 10000; id++)
    matchCount += match(`We remember term-${id % 1000} together.`).matches
      .length;
  const matcherFinished = performance.now();
  assert.equal(matchCount, 10000);
  const glossary = {
    method:
      "Generated in-memory exact matching, one run with no warm-up; scan includes constructing each short string.",
    terms: terms.length,
    lines: 10000,
    matches: matchCount,
    compileMilliseconds: matcherCompiled - matcherStart,
    scanMilliseconds: matcherFinished - matcherCompiled,
  };
  const result = {
    measuredAt: new Date().toISOString(),
    method:
      "Plain SQLite-backed catalog streaming plus exact literal matcher, no FTS or AI. Five sequential measurements per case; source generation, database seeding and identity warm-up excluded from queryOnly. No dedicated cold-cache flush; environment may have concurrent developer processes.",
    repository: {
      head: git("rev-parse", "HEAD"),
      branch: git("branch", "--show-current"),
      trackedDirty: git("diff", "--name-only").split("\n").filter(Boolean),
      measuredSourceSHA256: sourceFiles,
    },
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
      segmentCount: segments.length,
      providerId: "generated-fixture-not-asr",
      syntheticDurationSeconds: 20000,
      sourceHash,
      sourceSizeBytes: Buffer.byteLength(sourceBytes),
      sourceKind:
        "Identity-only local file; not media decoding or ASR quality/performance evidence",
      transcriptCorpusSHA256: hash(JSON.stringify(segments)),
      totalTextCharacters: segments.reduce((n, row) => n + row.text.length, 0),
      setupMilliseconds,
      seedMilliseconds,
    },
    measurements,
    glossary,
    limits:
      "Observed on this shared Linux development machine only. Not a latency SLA, device benchmark, ASR/LLM quality result, or a measurement of 10,000-segment editing/full revision writes.",
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output,
        head: result.repository.head,
        seedMilliseconds,
        glossary,
        measurements: measurements.map((row) => ({
          name: row.name,
          totalMatches: row.expected,
          returnedRows: row.returnedRows,
          queryMedianMilliseconds: row.queryOnly.medianMilliseconds,
          queryMaximumMilliseconds: row.queryOnly.maximumMilliseconds,
          applicationMedianMilliseconds:
            row.applicationWithWarmSourceIdentity.medianMilliseconds,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  app?.close();
  await rm(directory, { recursive: true, force: true });
}
