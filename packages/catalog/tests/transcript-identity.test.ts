import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import type { TranscriptDocument } from "@openfilm/core";
import { CATALOG_SCHEMA_VERSION, ProjectCatalog } from "../src/index";
import { transcriptSegmentKey } from "../src/transcript-segment-identity";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const hash = "source-hash";
function document(ids: string[]): TranscriptDocument {
  return {
    id: "provider-result",
    assetId: "source",
    language: "zh",
    provenance: {
      providerId: "local",
      model: "tiny",
      version: "1",
      sourceHash: hash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: ids.map((id, position) => ({
      id,
      start: position * 3,
      end: position * 3 + 2,
      text: `Search match ${position}`,
      words: [
        {
          start: position * 3,
          end: position * 3 + 2,
          text: "Search",
          confidence: 0.91,
        },
      ],
    })),
  };
}
async function fixture(ids: string[]) {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-segment-identity-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let catalog: ProjectCatalog | undefined = new ProjectCatalog(directory);
  cleanup.push(() => catalog?.close());
  catalog.upsertAsset({
    id: "source",
    uri: "file:///source.mp4",
    name: "Original media",
    mediaType: "video",
    duration: 40_000,
    contentHash: hash,
    tags: ["important"],
    state: { locked: true },
    metadata: { preserve: true },
  });
  const provider = document(ids);
  catalog.intelligence.replaceTranscript(provider);
  return {
    directory,
    path: join(directory, "database.sqlite"),
    provider,
    get catalog() {
      return catalog!;
    },
    close() {
      catalog?.close();
      catalog = undefined;
    },
    reopen() {
      catalog?.close();
      catalog = undefined;
      catalog = new ProjectCatalog(directory);
      return catalog;
    },
  };
}

/** Reconstruct the actual pre-v4 raw UTF-8 key representation, including its
 * lossy native binding; do not just relabel a modern canonical-key database. */
function downgrade(path: string, version: 2 | 3): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE intelligence_segments RENAME TO preserved_segments;
      CREATE TABLE intelligence_segments (
        revision INTEGER NOT NULL REFERENCES intelligence_transcripts(revision) ON DELETE CASCADE,
        position INTEGER NOT NULL, segment_id TEXT NOT NULL,
        start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (revision, position), UNIQUE (revision, segment_id)
      );
    `);
    const insert = database.prepare(`
      INSERT INTO intelligence_segments(revision,position,segment_id,start,end,text,data)
      SELECT revision,position,?,start,end,text,data FROM preserved_segments
      WHERE revision=? AND position=?
    `);
    for (const row of database
      .prepare("SELECT revision,position,data FROM preserved_segments")
      .iterate()) {
      insert.run(JSON.parse(String(row.data)).id, row.revision!, row.position!);
    }
    database.exec("DROP TABLE preserved_segments;");
    if (version === 2)
      database.exec(`
        DROP TABLE transcript_edit_requests;
        DROP TABLE transcript_editor_history;
        DROP TABLE transcript_revision_metadata;
        DROP TABLE review_batches;
        DROP TABLE review_suggestions;
        DROP TABLE project_glossary;
      `);
    database.exec(`PRAGMA user_version=${version}; COMMIT;`);
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

function segmentBytes(database: DatabaseSync, includeKeys = false) {
  return database
    .prepare(
      `SELECT revision,position,start,end,hex(text) AS text,hex(data) AS data${includeKeys ? ",hex(segment_id) AS segment_id" : ""} FROM intelligence_segments ORDER BY revision,position`,
    )
    .all();
}
function evidence(database: DatabaseSync) {
  return Object.fromEntries(
    [
      "assets",
      "jobs",
      "intelligence_transcripts",
      "transcript_revision_metadata",
      "transcript_editor_history",
      "transcript_edit_requests",
      "project_glossary",
      "review_suggestions",
      "review_batches",
    ].map((table) => [
      table,
      database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}

it.each(["\ud800", "\udc00"])(
  "preserves distinct provider identities for isolated surrogate %j and the literal replacement character through all editing paths",
  async (surrogate) => {
    const ids = [`opaque-${surrogate}`, "opaque-\ufffd", "tail\u0000id"];
    const test = await fixture(ids);
    let store = test.catalog.transcripts;
    const original = store.get("source", hash);
    expect(store.getFull("source", hash)!.document).toEqual(test.provider);
    for (const [position, id] of ids.entries()) {
      expect(store.getSegment("source", hash, id)).toMatchObject({
        position,
        segment: test.provider.segments[position],
      });
      const found = store.search("source", hash, {
        query: "Search match",
        offset: position,
        limit: 1,
      });
      expect(found.matches[0]!.segmentId).toBe(id);
      expect(
        store.getSegment("source", hash, found.matches[0]!.segmentId).position,
      ).toBe(position);
    }
    const replaced = store.edit("source", hash, {
      baseRevision: original.revision!,
      requestId: "replace-distinct",
      commands: [
        {
          type: "replace-text",
          segmentId: ids[0]!,
          text: "Original corrected",
        },
        {
          type: "replace-text",
          segmentId: ids[1]!,
          text: "Replacement corrected",
        },
      ],
    });
    expect(store.getSegment("source", hash, ids[0]!).segment.text).toBe(
      "Original corrected",
    );
    expect(store.getSegment("source", hash, ids[1]!).segment.text).toBe(
      "Replacement corrected",
    );
    const split = store.edit("source", hash, {
      baseRevision: replaced.revision!,
      requestId: "split-distinct",
      commands: [
        {
          type: "split-segment",
          segmentId: ids[0]!,
          newSegmentId: "safe-split",
          splitTime: 1,
          cursorOffset: 8,
        },
      ],
    });
    const merged = store.edit("source", hash, {
      baseRevision: split.revision!,
      requestId: "merge-distinct",
      commands: [
        { type: "merge-segment", segmentId: ids[0]!, direction: "next" },
      ],
    });
    const deleted = store.edit("source", hash, {
      baseRevision: merged.revision!,
      requestId: "delete-distinct",
      commands: [{ type: "delete-segment", segmentId: ids[1]! }],
    });
    expect(store.getSegment("source", hash, ids[0]!).segment.id).toBe(ids[0]);
    expect(() => store.getSegment("source", hash, ids[1]!)).toThrow(
      "no longer exists",
    );
    const undone = store.undo("source", hash, {
      baseRevision: deleted.revision!,
      requestId: "undo-distinct",
    });
    expect(store.getSegment("source", hash, ids[1]!).segment.text).toBe(
      "Replacement corrected",
    );
    const redone = store.redo("source", hash, {
      baseRevision: undone.revision!,
      requestId: "redo-distinct",
    });
    const selected = store.selectRevision("source", hash, {
      baseRevision: redone.revision!,
      requestId: "select-provider",
      revisionId: original.revision!,
    });
    store = test.reopen().transcripts;
    expect(store.get("source", hash)).toEqual(selected);
    expect(store.getFull("source", hash, original.revision)!.document).toEqual(
      test.provider,
    );
    for (const [position, id] of ids.entries())
      expect(store.getSegment("source", hash, id).position).toBe(position);
  },
);

it("uses an indexed exact key lookup without decoding unrelated rows or aliasing a missing surrogate counterpart", async () => {
  const ids = [
    "only-\ud800",
    ...Array.from({ length: 1_000 }, (_, index) => `segment-${index}`),
  ];
  const test = await fixture(ids);
  const database = new DatabaseSync(test.path);
  try {
    const plan = database
      .prepare(
        "EXPLAIN QUERY PLAN SELECT position,data FROM intelligence_segments WHERE revision=? AND segment_id=?",
      )
      .all(1, transcriptSegmentKey(ids[0]));
    expect(plan.map((row) => String(row.detail)).join(" ")).toMatch(
      /SEARCH intelligence_segments .*revision=\? AND segment_id=\?/u,
    );
    database
      .prepare(
        "UPDATE intelligence_segments SET data='unrelated invalid JSON' WHERE position=1000",
      )
      .run();
    expect(
      test.catalog.transcripts.getSegment("source", hash, ids[0]!).position,
    ).toBe(0);
    expect(() =>
      test.catalog.transcripts.getSegment("source", hash, "only-\ufffd"),
    ).toThrow("no longer exists");
    expect(
      test.reopen().transcripts.getSegment("source", hash, ids[0]!).segment.id,
    ).toBe(ids[0]);
  } finally {
    database.close();
  }
});

it("migrates raw-key v3 without transient quote collisions and preserves provider bytes, revisions, history, receipts and review evidence", async () => {
  const ids = ["legacy-\ud800", "foo", '"foo"', "legacy\u0000id"];
  const test = await fixture(ids);
  const original = test.catalog.transcripts.get("source", hash);
  const input = {
    baseRevision: original.revision!,
    requestId: "legacy-edit",
    commands: [
      {
        type: "replace-text" as const,
        segmentId: ids[0]!,
        text: "Preserved user correction",
      },
    ],
  };
  const edited = test.catalog.transcripts.edit("source", hash, input);
  const entry = test.catalog.knowledge.glossaryUpsert({
    scope: "project",
    source: "Search",
    replacement: "Find",
    enabled: false,
  });
  const suggestion = test.catalog.knowledge.saveSuggestion({
    id: "accepted-review",
    kind: "terminology",
    target: { assetId: "source", segmentId: ids[0]! },
    sourceRevisionId: original.revision!,
    before: test.provider.segments[0]!.text,
    after: "Preserved user correction",
    reason: "Known project term",
    source: { type: "glossary", id: entry.id },
    status: "accepted",
    createdAt: "2026-10-06T00:00:00Z",
    acceptedAt: "2026-10-06T00:01:00Z",
    acceptedRevisionId: edited.revision!,
    requestId: input.requestId,
  });
  test.close();
  downgrade(test.path, 3);
  let database = new DatabaseSync(test.path);
  const bytes = segmentBytes(database),
    storedEvidence = evidence(database);
  // Demonstrate the old SQLite index is already lossy while the JSON evidence is exact.
  expect(
    database
      .prepare(
        "SELECT hex(segment_id) AS key FROM intelligence_segments WHERE revision=1 AND position=0",
      )
      .get()!.key,
  ).toBe(Buffer.from("legacy-\ufffd").toString("hex").toUpperCase());
  database.close();
  const catalog = test.reopen(),
    store = catalog.transcripts;
  expect(store.get("source", hash)).toEqual(edited);
  for (const [position, id] of ids.entries())
    expect(store.getSegment("source", hash, id).position).toBe(position);
  expect(() => store.getSegment("source", hash, "legacy-\ufffd")).toThrow(
    "no longer exists",
  );
  expect(store.getFull("source", hash, original.revision)!.document).toEqual(
    test.provider,
  );
  expect(catalog.knowledge.getSuggestion(suggestion.id)).toEqual(suggestion);
  expect(catalog.knowledge.glossaryList()).toEqual([entry]);
  database = new DatabaseSync(test.path);
  try {
    expect(database.prepare("PRAGMA user_version").get()!.user_version).toBe(
      CATALOG_SCHEMA_VERSION,
    );
    expect(segmentBytes(database)).toEqual(bytes);
    expect(evidence(database)).toEqual(storedEvidence);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA quick_check").get()!.quick_check).toBe(
      "ok",
    );
  } finally {
    database.close();
  }
  const count = store.revisions("source", hash).total;
  expect(store.edit("source", hash, input).acknowledgedRevision).toBe(
    edited.revision,
  );
  expect(store.revisions("source", hash).total).toBe(count);
  const undone = store.undo("source", hash, {
    baseRevision: edited.revision!,
    requestId: "legacy-undo",
  });
  expect(undone.document!.segments).toEqual(test.provider.segments);
  const redone = test.reopen().transcripts.redo("source", hash, {
    baseRevision: undone.revision!,
    requestId: "legacy-redo",
  });
  expect(redone.document!.segments[0]!.id).toBe(ids[0]);
  test.catalog.intelligence.replaceTranscript(
    document(["fresh-\ud800", "fresh-\ufffd"]),
  );
  expect(
    test.catalog.transcripts.getSegment("source", hash, "fresh-\ud800")
      .position,
  ).toBe(0);
  expect(
    test.catalog.transcripts.getSegment("source", hash, "fresh-\ufffd")
      .position,
  ).toBe(1);
});

it("upgrades genuine raw-key v2 analysis while preserving original opaque identity and word timing", async () => {
  const ids = ["legacy-\udc00", "foo", '"foo"'];
  const test = await fixture(ids);
  test.close();
  downgrade(test.path, 2);
  const catalog = test.reopen();
  expect(catalog.transcripts.getFull("source", hash)!.document).toEqual(
    test.provider,
  );
  expect(catalog.transcripts.get("source", hash).revision).toBe("legacy-1");
  for (const [position, id] of ids.entries())
    expect(catalog.transcripts.getSegment("source", hash, id).position).toBe(
      position,
    );
  expect(() =>
    catalog.transcripts.getSegment("source", hash, "legacy-\ufffd"),
  ).toThrow("no longer exists");
});

it.each(["malformed-json", "invalid-id", "duplicate-id"] as const)(
  "rolls back v3 identity migration atomically on %s without relabeling or replacing original tables",
  async (failure) => {
    const test = await fixture(["foo", '"foo"']);
    test.close();
    downgrade(test.path, 3);
    let database = new DatabaseSync(test.path);
    const original = String(
      database
        .prepare("SELECT data FROM intelligence_segments WHERE position=1")
        .get()!.data,
    );
    const value =
      failure === "malformed-json"
        ? "{"
        : JSON.stringify({
            ...JSON.parse(original),
            id: failure === "invalid-id" ? "" : "foo",
          });
    database
      .prepare("UPDATE intelligence_segments SET data=? WHERE position=1")
      .run(value);
    const bytes = segmentBytes(database, true),
      storedEvidence = evidence(database);
    database.close();
    expect(() => new ProjectCatalog(test.directory)).toThrow();
    database = new DatabaseSync(test.path);
    try {
      expect(database.prepare("PRAGMA user_version").get()!.user_version).toBe(
        3,
      );
      expect(segmentBytes(database, true)).toEqual(bytes);
      expect(evidence(database)).toEqual(storedEvidence);
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='intelligence_segments_v4'",
          )
          .get(),
      ).toBeUndefined();
      database
        .prepare("UPDATE intelligence_segments SET data=? WHERE position=1")
        .run(original);
    } finally {
      database.close();
    }
    const recovered = test.reopen();
    expect(recovered.transcripts.getFull("source", hash)!.document).toEqual(
      test.provider,
    );
  },
);

it("keeps a preexisting migration-table collision intact and rejects an incomplete v3 before creating replacement state", async () => {
  const test = await fixture(["foo", '"foo"']);
  test.close();
  downgrade(test.path, 3);
  let database = new DatabaseSync(test.path);
  database.exec(
    "CREATE TABLE intelligence_segments_v4(preserve_me TEXT); INSERT INTO intelligence_segments_v4 VALUES('original');",
  );
  const bytes = segmentBytes(database, true);
  database.close();
  expect(() => new ProjectCatalog(test.directory)).toThrow("already exists");
  database = new DatabaseSync(test.path);
  expect(database.prepare("PRAGMA user_version").get()!.user_version).toBe(3);
  expect(segmentBytes(database, true)).toEqual(bytes);
  expect(
    database.prepare("SELECT preserve_me FROM intelligence_segments_v4").get()!
      .preserve_me,
  ).toBe("original");
  database.exec(
    "DROP TABLE intelligence_segments_v4; ALTER TABLE transcript_edit_requests RENAME TO preserved_requests;",
  );
  database.close();
  expect(() => new ProjectCatalog(test.directory)).toThrow(
    "transcript_edit_requests",
  );
  database = new DatabaseSync(test.path);
  try {
    expect(database.prepare("PRAGMA user_version").get()!.user_version).toBe(3);
    expect(segmentBytes(database, true)).toEqual(bytes);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name='transcript_edit_requests'",
        )
        .get(),
    ).toBeUndefined();
    database.exec(
      "ALTER TABLE preserved_requests RENAME TO transcript_edit_requests;",
    );
  } finally {
    database.close();
  }
  expect(test.reopen().transcripts.getFull("source", hash)!.document).toEqual(
    test.provider,
  );
});
