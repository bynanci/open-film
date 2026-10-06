import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { ProjectCatalog } from "../src/index";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function legacyV2() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-transcript-v2-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const catalog = new ProjectCatalog(directory);
  catalog.upsertAsset({
    id: "asset",
    uri: "file:///asset.mp4",
    name: "Original",
    duration: 20,
    mediaType: "video",
    contentHash: "hash",
    tags: ["manual"],
    rating: 5,
    state: { locked: true },
    metadata: { opaque: { future: true } },
  });
  catalog.intelligence.replaceTranscript({
    id: "original-provider",
    assetId: "asset",
    provenance: {
      providerId: "local",
      version: "1",
      sourceHash: "hash",
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: [
      {
        id: "segment",
        start: 1,
        end: 2,
        text: "Original words",
        words: [{ start: 1, end: 2, text: "Original" }],
      },
    ],
  });
  const expected = catalog.intelligence.getFullTranscript("asset", "hash");
  catalog.close();
  const path = join(directory, "database.sqlite"),
    database = new DatabaseSync(path);
  database.exec(
    `DROP TABLE transcript_edit_requests;DROP TABLE transcript_editor_history;DROP TABLE transcript_revision_metadata;DROP TABLE review_batches;DROP TABLE review_suggestions;DROP TABLE project_glossary;PRAGMA user_version=2;`,
  );
  const header = database
      .prepare("SELECT header FROM intelligence_transcripts")
      .get()!.header,
    asset = database.prepare("SELECT data FROM assets").get()!.data;
  database.close();
  return { directory, path, expected, header, asset };
}
it("upgrades real v2 transcript tables transactionally without rebuilding analysis or modifying original provider bytes", async () => {
  const legacy = await legacyV2();
  let catalog = new ProjectCatalog(legacy.directory);
  cleanup.push(() => catalog.close());
  expect(catalog.intelligence.getFullTranscript("asset", "hash")).toEqual(
    legacy.expected,
  );
  const state = catalog.transcripts.get("asset", "hash");
  expect(state.revisionInfo).toMatchObject({
    id: "legacy-1",
    source: "provider",
    assetId: "asset",
  });
  const edited = catalog.transcripts.edit("asset", "hash", {
    baseRevision: state.revision!,
    requestId: "legacy-edit",
    commands: [
      { type: "replace-text", segmentId: "segment", text: "Corrected" },
    ],
  });
  catalog.close();
  catalog = new ProjectCatalog(legacy.directory);
  expect(catalog.transcripts.get("asset", "hash").revision).toBe(
    edited.revision,
  );
  const database = new DatabaseSync(legacy.path);
  try {
    expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
    expect(
      database
        .prepare("SELECT header FROM intelligence_transcripts WHERE revision=1")
        .get()?.header,
    ).toBe(legacy.header);
    expect(database.prepare("SELECT data FROM assets").get()?.data).toBe(
      legacy.asset,
    );
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    database.close();
  }
});
it("rolls back metadata backfill when knowledge migration fails, preserving exact v2 version and analysis", async () => {
  const legacy = await legacyV2();
  const collision = new DatabaseSync(legacy.path);
  collision.exec(
    "CREATE TABLE project_glossary (preserve_me TEXT);INSERT INTO project_glossary VALUES('original');",
  );
  collision.close();
  expect(() => new ProjectCatalog(legacy.directory)).toThrow("already exists");
  const database = new DatabaseSync(legacy.path);
  try {
    expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(
      database.prepare("SELECT header FROM intelligence_transcripts").get()
        ?.header,
    ).toBe(legacy.header);
    expect(database.prepare("SELECT data FROM assets").get()?.data).toBe(
      legacy.asset,
    );
    expect(
      database.prepare("SELECT preserve_me FROM project_glossary").get()
        ?.preserve_me,
    ).toBe("original");
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name='transcript_revision_metadata'",
        )
        .get(),
    ).toBeUndefined();
    database.exec("DROP TABLE project_glossary");
  } finally {
    database.close();
  }
  const recovered = new ProjectCatalog(legacy.directory);
  try {
    expect(recovered.transcripts.get("asset", "hash").revision).toBe(
      "legacy-1",
    );
  } finally {
    recovered.close();
  }
});
it("rejects corrupt v2 before migration and rejects incomplete v3 or future catalogs without creating missing data", async () => {
  const legacy = await legacyV2();
  let database = new DatabaseSync(legacy.path);
  database.exec(
    "ALTER TABLE intelligence_segments RENAME TO preserve_segments",
  );
  database.close();
  expect(() => new ProjectCatalog(legacy.directory)).toThrow(
    "intelligence_segments",
  );
  database = new DatabaseSync(legacy.path);
  expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
  expect(
    database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE name='transcript_revision_metadata'",
      )
      .get(),
  ).toBeUndefined();
  database.exec(
    "ALTER TABLE preserve_segments RENAME TO intelligence_segments",
  );
  database.close();
  const catalog = new ProjectCatalog(legacy.directory);
  catalog.close();
  database = new DatabaseSync(legacy.path);
  database.exec("DROP TABLE transcript_edit_requests");
  database.close();
  expect(() => new ProjectCatalog(legacy.directory)).toThrow(
    "transcript_edit_requests",
  );
  database = new DatabaseSync(legacy.path);
  expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
  database.exec("PRAGMA user_version=99");
  database.close();
  expect(() => new ProjectCatalog(legacy.directory)).toThrow(
    "future catalog schema 99",
  );
});
