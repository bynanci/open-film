import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { CATALOG_SCHEMA_VERSION, ProjectCatalog } from "../src/index";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function legacy() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-catalog-v1-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const database = new DatabaseSync(join(directory, "database.sqlite"));
  database.exec(`
    CREATE TABLE assets (
      id TEXT PRIMARY KEY, uri TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      media_type TEXT NOT NULL, captured_at TEXT, rating REAL,
      favorite INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL
    );
    CREATE TABLE jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL);
    PRAGMA user_version=1;
  `);
  const asset = JSON.stringify(
    {
      id: "legacy",
      uri: "file:///original/memory.mp4",
      name: "回憶",
      mediaType: "video",
      duration: 3,
      contentHash: "old-source-hash",
      rating: 5,
      tags: ["manual"],
      state: { favorite: true, locked: true },
      metadata: {
        "plugin.unknown": { opaque: [true, null, 3] },
        "user.notes": "original",
      },
    },
    null,
    3,
  );
  const job = JSON.stringify({
    id: "job",
    type: "import",
    status: "completed",
    progress: 1,
  });
  database
    .prepare(
      "INSERT INTO assets(id,uri,name,media_type,rating,favorite,locked,data) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      "legacy",
      "file:///original/memory.mp4",
      "回憶",
      "video",
      5,
      1,
      1,
      asset,
    );
  database
    .prepare("INSERT INTO jobs(id,created_at,data) VALUES(?,?,?)")
    .run("job", "2026-10-06T00:00:00Z", job);
  database.close();
  return { directory, asset, job };
}

it("upgrades a real v1 catalog additively, preserving opaque asset and job bytes across reopen", async () => {
  const test = await legacy();
  let catalog = new ProjectCatalog(test.directory);
  cleanup.push(() => catalog.close());
  expect(catalog.getAsset("legacy")).toEqual(JSON.parse(test.asset));
  expect(catalog.listAssets({ favorite: true, locked: true })).toHaveLength(1);
  expect(catalog.listJobs()).toEqual([JSON.parse(test.job)]);
  catalog.intelligence.replaceTranscript({
    id: "new-analysis",
    assetId: "legacy",
    provenance: {
      providerId: "local",
      version: "1",
      sourceHash: "old-source-hash",
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: [{ id: "segment", start: 0, end: 1, text: "你好" }],
  });
  catalog.close();
  catalog = new ProjectCatalog(test.directory);
  expect(
    catalog.intelligence.getFullTranscript("legacy", "old-source-hash")
      ?.segments[0]?.text,
  ).toBe("你好");
  const database = new DatabaseSync(join(test.directory, "database.sqlite"), {
    readOnly: true,
  });
  try {
    expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(
      CATALOG_SCHEMA_VERSION,
    );
    expect(
      database.prepare("SELECT data FROM assets WHERE id='legacy'").get()?.data,
    ).toBe(test.asset);
    expect(
      database.prepare("SELECT data FROM jobs WHERE id='job'").get()?.data,
    ).toBe(test.job);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA quick_check").get()?.quick_check).toBe(
      "ok",
    );
  } finally {
    database.close();
  }
});

it("rolls back a failed additive migration without advancing the schema or discarding legacy records", async () => {
  const test = await legacy();
  const path = join(test.directory, "database.sqlite");
  const collision = new DatabaseSync(path);
  collision.exec(
    "CREATE TABLE intelligence_segments (preserve_me TEXT); INSERT INTO intelligence_segments VALUES ('original');",
  );
  collision.close();
  expect(() => new ProjectCatalog(test.directory)).toThrow("already exists");
  const database = new DatabaseSync(path);
  try {
    expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
    expect(
      database.prepare("SELECT data FROM assets WHERE id='legacy'").get()?.data,
    ).toBe(test.asset);
    expect(
      database.prepare("SELECT data FROM jobs WHERE id='job'").get()?.data,
    ).toBe(test.job);
    expect(
      database.prepare("SELECT preserve_me FROM intelligence_segments").get()
        ?.preserve_me,
    ).toBe("original");
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name='intelligence_transcripts'",
        )
        .get(),
    ).toBeUndefined();
    database.exec("DROP TABLE intelligence_segments");
  } finally {
    database.close();
  }
  const recovered = new ProjectCatalog(test.directory);
  try {
    expect(recovered.getAsset("legacy")).toEqual(JSON.parse(test.asset));
    expect(
      recovered.intelligence.getTranscriptPage("legacy", "old-source-hash"),
    ).toEqual({ total: 0, offset: 0, limit: 200 });
  } finally {
    recovered.close();
  }
});

it("rejects incomplete v2 catalogs without silently recreating missing analysis tables", async () => {
  const test = await legacy();
  const catalog = new ProjectCatalog(test.directory);
  catalog.close();
  const path = join(test.directory, "database.sqlite");
  const damaged = new DatabaseSync(path);
  damaged.exec("DROP TABLE intelligence_segments");
  damaged.close();
  expect(() => new ProjectCatalog(test.directory)).toThrow(
    "intelligence_segments",
  );
  const database = new DatabaseSync(path);
  try {
    expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(
      database.prepare("SELECT data FROM assets WHERE id='legacy'").get()?.data,
    ).toBe(test.asset);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name='intelligence_segments'",
        )
        .get(),
    ).toBeUndefined();
  } finally {
    database.close();
  }
});
