import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG_SCHEMA_VERSION,
  CATALOG_TABLE_POLICIES,
  createPortableCatalogSnapshot,
  inspectCatalogSnapshot,
  ProjectCatalog,
  sanitizePortableMultiSourceRows,
  upgradeCatalogSnapshot,
} from "../src/index.js";
import { CATALOG_V6_TABLES } from "./catalog-version-fixtures.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

const AUTHENTIC_V5_SHA256 =
  "11d5b3ac7d4093c59b329cd6a4840a9a2dacf62872bd776c01a3cb6d459d4a2d";

async function authenticV5Image(): Promise<Buffer> {
  const encoded = await readFile(
    new URL("./fixtures/catalog-v5-61a4659.sqlite.gz.b64", import.meta.url),
    "utf8",
  );
  return gunzipSync(Buffer.from(encoded.trim(), "base64"));
}

describe("consistent project catalog snapshots", () => {
  it("migrates to schema v6 and classifies every durable table", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-catalog-v6-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const catalog = new ProjectCatalog(directory);
    cleanup.push(() => catalog.close());
    expect(CATALOG_SCHEMA_VERSION).toBe(6);

    const check = new DatabaseSync(join(directory, "database.sqlite"));
    try {
      const tables = check
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => String(row.name));
      expect(tables).toEqual(
        expect.arrayContaining([...CATALOG_V6_TABLES].sort()),
      );
      expect(
        tables.filter((table) => CATALOG_TABLE_POLICIES[table] === undefined),
      ).toEqual([]);
    } finally {
      check.close();
    }
  });

  it("upgrades a private copy of a v5 snapshot without changing its bytes", async () => {
    const legacy = await authenticV5Image();
    const before = createHash("sha256").update(legacy).digest("hex");
    expect(before).toBe(AUTHENTIC_V5_SHA256);

    const upgraded = upgradeCatalogSnapshot(legacy, 5);

    expect(createHash("sha256").update(legacy).digest("hex")).toBe(before);
    expect(inspectCatalogSnapshot(legacy, 5).schemaVersion).toBe(5);
    expect(inspectCatalogSnapshot(upgraded, 6)).toMatchObject({
      schemaVersion: 6,
      assets: [expect.objectContaining({ id: "legacy-asset" })],
    });
  });

  it("copies committed WAL rows under an exclusive snapshot boundary", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-catalog-snapshot-"),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const catalog = new ProjectCatalog(directory);
    cleanup.push(() => catalog.close());
    catalog.upsertAsset({
      id: "asset-one",
      uri: "file:///synthetic/one.png",
      name: "one.png",
      mediaType: "image",
      contentHash: "a".repeat(64),
      tags: [],
      state: {},
      metadata: {},
    });
    const result = catalog.withConsistentSnapshot((image, schemaVersion) => {
      const snapshot = inspectCatalogSnapshot(image, schemaVersion);
      expect(snapshot.assets.map((asset) => asset.id)).toEqual(["asset-one"]);
      expect(snapshot.logicalRevision).toMatch(/^[a-f0-9]{64}$/u);
      return { bytes: image.length, schemaVersion };
    });
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.schemaVersion).toBe(6);

    const check = new DatabaseSync(join(directory, "database.sqlite"));
    try {
      expect(check.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe(
        "wal",
      );
    } finally {
      check.close();
    }
  });

  it("projects only selected media into a portable catalog image", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-portable-catalog-test-"),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const catalog = new ProjectCatalog(directory);
    cleanup.push(() => catalog.close());
    const privateSemanticSentinel =
      "PRIVATE_OPERATIONAL_TOKEN_DO_NOT_PACKAGE_7f04c8";
    const asset = (id: string) => ({
      id,
      uri: `file:///private/${id}.png`,
      name: `${id}.png`,
      mediaType: "image" as const,
      contentHash: "a".repeat(64),
      tags: [],
      state: {},
      metadata: {},
    });
    catalog.upsertAsset(asset("selected"));
    catalog.upsertAsset(asset("unselected-private-name"));
    const live = new DatabaseSync(join(directory, "database.sqlite"));
    try {
      live.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
      for (const [id, suffix] of [
        ["selected", "1"],
        ["unselected-private-name", "2"],
      ] as const) {
        live
          .prepare(
            "INSERT INTO source_selections(id,kind,display_name,logical_root,recursive,selection_revision,data) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            `selection-${id}`,
            "folder",
            id,
            id === "selected" ? "/private/source/root" : `logical-${id}`,
            1,
            1,
            JSON.stringify({
              id,
              projectId: "project-safe",
              accessRef: privateSemanticSentinel,
            }),
          );
        live
          .prepare(
            "INSERT INTO file_occurrences(id,display_name,relative_path,file_kind,byte_length,availability,scan_revision,data) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            `occurrence-${id}`,
            `${id}.png`,
            id === "selected" ? "C:private\\selected.png" : `${id}.png`,
            "image",
            64,
            "available",
            1,
            JSON.stringify({
              id,
              logicalRootId: `selection-${id}`,
              stagingPath: privateSemanticSentinel,
            }),
          );
        live
          .prepare(
            "INSERT INTO selection_memberships(selection_id,occurrence_id,relative_path,included,data) VALUES(?,?,?,?,?)",
          )
          .run(
            `selection-${id}`,
            `occurrence-${id}`,
            id === "selected"
              ? "file:C:\\private\\membership\\selected.png"
              : `${id}.png`,
            1,
            JSON.stringify({ credential: privateSemanticSentinel }),
          );
        live
          .prepare(
            "INSERT INTO content_identities(id,hash_algorithm,full_hash,byte_length,media_kind,data) VALUES(?,?,?,?,?,?)",
          )
          .run(
            `content-${id}`,
            "sha256",
            suffix.repeat(64),
            64,
            "image",
            JSON.stringify({ token: privateSemanticSentinel }),
          );
        live
          .prepare(
            "INSERT INTO asset_content_versions(id,asset_id,occurrence_id,content_id,context_revision,descriptor_snapshot_id,data) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            `binding-${id}`,
            id,
            `occurrence-${id}`,
            `content-${id}`,
            "context-1",
            "descriptor-1",
            JSON.stringify({ sourcePath: privateSemanticSentinel }),
          );
      }
      live
        .prepare(
          "INSERT INTO import_batches(id,draft_revision,scope_mode,status,created_at,data) VALUES(?,?,?,?,?,?)",
        )
        .run(
          "batch-selected",
          1,
          "selected-sources",
          "sealed",
          "2026-10-25T00:00:00.000Z",
          JSON.stringify({
            projectId: "project-safe",
            expectedManifestId: "expected-selected",
            ownerToken: privateSemanticSentinel,
          }),
        );
      live
        .prepare(
          "INSERT INTO expected_manifests(id,batch_id,revision,selection_hash,partial_policy,created_at,data) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          "expected-selected",
          "batch-selected",
          1,
          "e".repeat(64),
          "require-all",
          "2026-10-25T00:00:01.000Z",
          JSON.stringify({ localPath: privateSemanticSentinel }),
        );
      live
        .prepare(
          "INSERT INTO expected_manifest_entries(manifest_id,occurrence_id,position,included,data) VALUES(?,?,?,?,?)",
        )
        .run(
          "expected-selected",
          "occurrence-selected",
          0,
          1,
          JSON.stringify({
            relativePath: "safe/selected.png",
            expectedByteLength: 64,
            expectedModifiedAt: "2026-10-25T00:00:00.000Z",
            accessRef: privateSemanticSentinel,
          }),
        );
      live
        .prepare(
          "INSERT INTO verified_manifests(id,expected_manifest_id,created_at,data) VALUES(?,?,?,?)",
        )
        .run(
          "verified-selected",
          "expected-selected",
          "2026-10-25T00:00:02.000Z",
          JSON.stringify({ stagingPath: privateSemanticSentinel }),
        );
      live
        .prepare(
          "INSERT INTO verified_manifest_entries(manifest_id,position,occurrence_id,binding_id,status,data) VALUES(?,?,?,?,?,?)",
        )
        .run(
          "verified-selected",
          0,
          "occurrence-selected",
          "binding-selected",
          "verified",
          JSON.stringify({
            assetId: "selected",
            contentHash: "1".repeat(64),
            contextRevision: "context-1",
            credential: privateSemanticSentinel,
          }),
        );
      live
        .prepare(
          "INSERT INTO analysis_runs(id,manifest_id,scope_mode,algorithm_version,taxonomy_version,config_hash,status,created_at,data) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          "run-selected",
          "verified-selected",
          "selected-sources",
          "analysis-v1",
          "taxonomy-v1",
          "c".repeat(64),
          "completed",
          "2026-10-25T00:00:03.000Z",
          JSON.stringify({
            projectId: "project-safe",
            apiKey: privateSemanticSentinel,
          }),
        );
      live
        .prepare(
          "INSERT INTO analysis_results(id,run_id,kind,review_status,data) VALUES(?,?,?,?,?)",
        )
        .run(
          "result-selected",
          "run-selected",
          "moment",
          "accepted",
          JSON.stringify({
            payload: {
              label: "safe moment",
              confidence: 0.9,
              path: `/Users/alice/${privateSemanticSentinel}.mov`,
              relative_path: `../../${privateSemanticSentinel}.mov`,
              headers: [`Authorization: Bearer ${privateSemanticSentinel}`],
              opaque: { value: privateSemanticSentinel },
              value: `/private/${privateSemanticSentinel}.mov`,
              notes: [
                "safe semantic note",
                `Bearer ${privateSemanticSentinel}`,
                `C:\\private\\${privateSemanticSentinel}.mov`,
              ],
            },
            secret: privateSemanticSentinel,
          }),
        );
      live
        .prepare(
          "INSERT INTO analysis_result_members(result_id,binding_id,position,data) VALUES(?,?,?,?)",
        )
        .run(
          "result-selected",
          "binding-selected",
          0,
          JSON.stringify({
            range: { start: 0, end: 1 },
            localUri: privateSemanticSentinel,
          }),
        );
      live
        .prepare(
          "INSERT INTO review_decisions(id,base_run_id,before_fingerprint,outcome,created_at,data) VALUES(?,?,?,?,?,?)",
        )
        .run(
          "decision-selected",
          "run-selected",
          "f".repeat(64),
          "applied",
          "2026-10-25T00:00:04.000Z",
          JSON.stringify({
            schemaVersion: 1,
            projectId: "project-safe",
            baseResultIds: ["result-selected"],
            targetIds: ["result-selected"],
            operation: {
              kind: "set-observation",
              resultId: "result-selected",
              axis: "mood",
              value: "warm",
            },
            manifestId: "verified-selected",
            storyRevision: "story-1",
            bearer: privateSemanticSentinel,
          }),
        );
      live
        .prepare("INSERT INTO jobs(id,created_at,data) VALUES(?,?,?)")
        .run(
          "private-attempt",
          "2026-10-25T00:00:00.000Z",
          JSON.stringify({ stagingPath: "/private/staging/secret.mov" }),
        );
      live.exec("COMMIT;");
    } finally {
      live.close();
    }
    const image = catalog.withConsistentSnapshot((value) => Buffer.from(value));
    const packaged = {
      ...asset("selected"),
      uri: "openfilm-package://sources/selected.png",
    };
    const filtered = createPortableCatalogSnapshot(
      image,
      CATALOG_SCHEMA_VERSION,
      [packaged],
    );
    const snapshot = inspectCatalogSnapshot(filtered, CATALOG_SCHEMA_VERSION);
    expect(snapshot.assets).toEqual([packaged]);
    expect(filtered.toString("utf8")).not.toContain("unselected-private-name");
    expect(filtered.toString("utf8")).not.toContain("file:///private");
    expect(filtered.toString("utf8")).not.toContain("/private/staging");
    expect(filtered.toString("utf8")).not.toContain(privateSemanticSentinel);

    const projectedPath = join(directory, "portable.sqlite");
    await writeFile(projectedPath, filtered, { mode: 0o600, flag: "wx" });
    const projected = new DatabaseSync(projectedPath);
    try {
      expect(
        projected.prepare("SELECT id FROM source_selections ORDER BY id").all(),
      ).toEqual([{ id: "selection-selected" }]);
      expect(
        projected.prepare("SELECT id FROM file_occurrences ORDER BY id").all(),
      ).toEqual([{ id: "occurrence-selected" }]);
      expect(
        projected
          .prepare("SELECT id FROM content_identities ORDER BY id")
          .all(),
      ).toEqual([{ id: "content-selected" }]);
      expect(projected.prepare("SELECT id FROM jobs").all()).toEqual([]);
      expect(
        projected
          .prepare(
            "SELECT logical_root FROM source_selections WHERE id='selection-selected'",
          )
          .get()?.logical_root,
      ).toBe("source:selection-selected");
      expect(
        projected
          .prepare(
            "SELECT relative_path FROM file_occurrences WHERE id='occurrence-selected'",
          )
          .get()?.relative_path,
      ).toBe("selected.png");
      expect(
        projected
          .prepare(
            "SELECT relative_path FROM selection_memberships WHERE occurrence_id='occurrence-selected'",
          )
          .get()?.relative_path,
      ).toBe("selected.png");
      const dataFor = (
        table: string,
        predicate: string,
      ): Record<string, unknown> =>
        JSON.parse(
          String(
            projected
              .prepare(`SELECT data FROM ${table} WHERE ${predicate}`)
              .get()?.data,
          ),
        ) as Record<string, unknown>;
      expect(
        dataFor("source_selections", "id='selection-selected'"),
      ).toMatchObject({
        projectId: "project-safe",
        logicalRootId: "source:selection-selected",
      });
      expect(
        dataFor("file_occurrences", "id='occurrence-selected'"),
      ).toMatchObject({
        logicalRootId: "selection-selected",
        relativePath: "selected.png",
      });
      expect(dataFor("import_batches", "id='batch-selected'")).toMatchObject({
        projectId: "project-safe",
        expectedManifestId: "expected-selected",
      });
      expect(
        dataFor(
          "expected_manifest_entries",
          "manifest_id='expected-selected' AND position=0",
        ),
      ).toMatchObject({
        relativePath: "safe/selected.png",
        expectedByteLength: 64,
        expectedModifiedAt: "2026-10-25T00:00:00.000Z",
      });
      expect(
        dataFor("expected_manifests", "id='expected-selected'"),
      ).toMatchObject({
        entries: [
          {
            occurrenceId: "occurrence-selected",
            relativePath: "safe/selected.png",
            included: true,
            expectedByteLength: 64,
          },
        ],
      });
      expect(
        dataFor(
          "verified_manifest_entries",
          "manifest_id='verified-selected' AND position=0",
        ),
      ).toMatchObject({
        assetId: "selected",
        contentHash: "1".repeat(64),
        contextRevision: "context-1",
      });
      expect(
        dataFor("verified_manifests", "id='verified-selected'"),
      ).toMatchObject({
        members: [
          {
            bindingId: "binding-selected",
            assetId: "selected",
            contentHash: "1".repeat(64),
            contextRevision: "context-1",
          },
        ],
        failures: [],
        excludedOccurrenceIds: [],
      });
      expect(dataFor("analysis_runs", "id='run-selected'")).toMatchObject({
        projectId: "project-safe",
      });
      expect(dataFor("analysis_results", "id='result-selected'")).toMatchObject(
        {
          payload: {
            label: "safe moment",
            confidence: 0.9,
            notes: ["safe semantic note"],
          },
        },
      );
      expect(
        dataFor(
          "analysis_result_members",
          "result_id='result-selected' AND position=0",
        ),
      ).toMatchObject({ range: { start: 0, end: 1 } });
      expect(
        dataFor("review_decisions", "id='decision-selected'"),
      ).toMatchObject({
        schemaVersion: 1,
        projectId: "project-safe",
        baseResultIds: ["result-selected"],
        targetIds: ["result-selected"],
        operation: {
          kind: "set-observation",
          resultId: "result-selected",
          axis: "mood",
          value: "warm",
        },
        manifestId: "verified-selected",
        storyRevision: "story-1",
      });
      for (const table of [
        "source_selections",
        "file_occurrences",
        "selection_memberships",
        "content_identities",
        "asset_content_versions",
        "import_batches",
        "expected_manifests",
        "expected_manifest_entries",
        "verified_manifests",
        "verified_manifest_entries",
        "analysis_runs",
        "analysis_results",
        "analysis_result_members",
        "review_decisions",
      ])
        for (const row of projected.prepare(`SELECT data FROM ${table}`).all())
          expect(String(row.data)).not.toContain(privateSemanticSentinel);
    } finally {
      projected.close();
    }
  });

  it("redacts unsafe locator forms while retaining verified failure semantics", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-portable-locator-test-"),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const catalog = new ProjectCatalog(directory);
    cleanup.push(() => catalog.close());
    const live = new DatabaseSync(join(directory, "database.sqlite"));
    const unsafePaths = [
      "/absolute/private.mov",
      "C:relative\\private.mov",
      "\\\\server\\share\\private.mov",
      "file:C:\\private\\source.mov",
      "../private.mov",
      "~alice/private.mov",
      "safe/\u0001private.mov",
    ];
    try {
      live.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
      live
        .prepare(
          "INSERT INTO source_selections(id,kind,display_name,logical_root,recursive,selection_revision,data) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          "selection-paths",
          "folder",
          "paths",
          "/private/root",
          1,
          1,
          JSON.stringify({
            projectId: "project-paths",
            accessRef: "private-handle",
          }),
        );
      const insertOccurrence = live.prepare(
        "INSERT INTO file_occurrences(id,display_name,relative_path,file_kind,byte_length,availability,scan_revision,data) VALUES(?,?,?,?,?,?,?,?)",
      );
      const insertMembership = live.prepare(
        "INSERT INTO selection_memberships(selection_id,occurrence_id,relative_path,included,data) VALUES(?,?,?,?,?)",
      );
      for (const [index, relativePath] of unsafePaths.entries()) {
        const occurrenceId = `unsafe-${index}`;
        const displayName = `fallback-${index}.mov`;
        insertOccurrence.run(
          occurrenceId,
          displayName,
          relativePath,
          "video",
          64,
          "available",
          1,
          JSON.stringify({ logicalRootId: "selection-paths" }),
        );
        insertMembership.run(
          "selection-paths",
          occurrenceId,
          relativePath,
          1,
          "{}",
        );
      }
      insertOccurrence.run(
        "safe-relative",
        "safe.mov",
        "folder/safe.mov",
        "video",
        64,
        "available",
        1,
        JSON.stringify({ logicalRootId: "selection-paths" }),
      );
      insertMembership.run(
        "selection-paths",
        "safe-relative",
        "folder/safe.mov",
        1,
        "{}",
      );
      live
        .prepare(
          "INSERT INTO import_batches(id,draft_revision,scope_mode,status,created_at,data) VALUES(?,?,?,?,?,?)",
        )
        .run(
          "batch-failure",
          1,
          "selected-sources",
          "partial",
          "2026-10-25T00:00:00.000Z",
          JSON.stringify({
            projectId: "project-paths",
            expectedManifestId: "expected-failure",
          }),
        );
      live
        .prepare(
          "INSERT INTO expected_manifests(id,batch_id,revision,selection_hash,partial_policy,created_at,data) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          "expected-failure",
          "batch-failure",
          1,
          "e".repeat(64),
          "allow-readable",
          "2026-10-25T00:00:01.000Z",
          "{}",
        );
      live
        .prepare(
          "INSERT INTO expected_manifest_entries(manifest_id,occurrence_id,position,included,data) VALUES(?,?,?,?,?)",
        )
        .run(
          "expected-failure",
          "unsafe-0",
          0,
          1,
          JSON.stringify({ relativePath: "/private/failure.mov" }),
        );
      live
        .prepare(
          "INSERT INTO verified_manifests(id,expected_manifest_id,created_at,data) VALUES(?,?,?,?)",
        )
        .run(
          "verified-failure",
          "expected-failure",
          "2026-10-25T00:00:02.000Z",
          "{}",
        );
      live
        .prepare(
          "INSERT INTO verified_manifest_entries(manifest_id,position,occurrence_id,binding_id,status,data) VALUES(?,?,?,?,?,?)",
        )
        .run(
          "verified-failure",
          0,
          "unsafe-0",
          null,
          "failed",
          JSON.stringify({
            code: "source.unreadable",
            credential: "private-token",
          }),
        );

      sanitizePortableMultiSourceRows(live);
      live.exec("COMMIT;");

      expect(
        live
          .prepare("SELECT relative_path FROM file_occurrences ORDER BY id")
          .all(),
      ).toEqual([
        { relative_path: "folder/safe.mov" },
        ...unsafePaths.map((_, index) => ({
          relative_path: `fallback-${index}.mov`,
        })),
      ]);
      const failedEntry = JSON.parse(
        String(
          live
            .prepare(
              "SELECT data FROM verified_manifest_entries WHERE manifest_id='verified-failure'",
            )
            .get()?.data,
        ),
      ) as Record<string, unknown>;
      expect(failedEntry).toMatchObject({
        occurrenceId: "unsafe-0",
        status: "failed",
        code: "source.unreadable",
      });
      expect(JSON.stringify(failedEntry)).not.toContain("private-token");
      expect(
        JSON.parse(
          String(
            live
              .prepare(
                "SELECT data FROM verified_manifests WHERE id='verified-failure'",
              )
              .get()?.data,
          ),
        ),
      ).toMatchObject({
        failures: [{ occurrenceId: "unsafe-0", code: "source.unreadable" }],
      });
    } catch (error) {
      if (live.isTransaction) live.exec("ROLLBACK;");
      throw error;
    } finally {
      live.close();
    }
  });

  it("restores all catalog rows in place from a validated saved snapshot", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-catalog-restore-"),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const catalog = new ProjectCatalog(directory);
    cleanup.push(() => catalog.close());
    const original = (id: string) => ({
      id,
      uri: `file:///synthetic/${id}.png`,
      name: `${id}.png`,
      mediaType: "image" as const,
      contentHash: "a".repeat(64),
      tags: [],
      state: {},
      metadata: {},
    });
    catalog.upsertAsset(original("original"));
    const image = catalog.withConsistentSnapshot((value) => Buffer.from(value));
    const snapshotPath = join(directory, "saved-catalog.sqlite");
    await writeFile(snapshotPath, image, { mode: 0o600, flag: "wx" });
    catalog.upsertAsset(original("later"));

    catalog.restoreFromSnapshot(snapshotPath);
    expect(catalog.listAssets().map((asset) => asset.id)).toEqual(["original"]);
    expect(catalog.getAsset("later")).toBeUndefined();

    const check = new DatabaseSync(join(directory, "database.sqlite"));
    try {
      expect(check.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe(
        "wal",
      );
      expect(
        check.prepare("PRAGMA integrity_check").get()?.integrity_check,
      ).toBe("ok");
    } finally {
      check.close();
    }
  });

  it("restores a schema-v5 snapshot through an upgraded private copy", async () => {
    const targetDirectory = await mkdtemp(
      join(tmpdir(), "openfilm-catalog-legacy-target-"),
    );
    cleanup.push(() => rm(targetDirectory, { recursive: true, force: true }));
    const legacy = await authenticV5Image();
    const legacyPath = join(targetDirectory, "legacy-v5.sqlite");
    await writeFile(legacyPath, legacy, { mode: 0o600, flag: "wx" });

    const target = new ProjectCatalog(targetDirectory);
    cleanup.push(() => target.close());
    target.upsertAsset({
      id: "current",
      uri: "file:///synthetic/current.png",
      name: "current.png",
      mediaType: "image",
      tags: [],
      state: {},
      metadata: {},
    });

    target.restoreFromSnapshot(legacyPath, undefined, undefined, 5);

    expect(target.listAssets().map((asset) => asset.id)).toEqual([
      "legacy-asset",
    ]);
    expect(
      target.withConsistentSnapshot((_, schemaVersion) => schemaVersion),
    ).toBe(6);
  });

  it("still rejects structurally different snapshot schemas", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-catalog-schema-mismatch-"),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const catalog = new ProjectCatalog(directory);
    cleanup.push(() => catalog.close());
    const image = catalog.withConsistentSnapshot((value) => Buffer.from(value));
    const snapshotPath = join(directory, "schema-mismatch.sqlite");
    await writeFile(snapshotPath, image, { mode: 0o600, flag: "wx" });
    const changed = new DatabaseSync(snapshotPath);
    try {
      changed.exec("CREATE TABLE unexpected_private_state(value TEXT)");
    } finally {
      changed.close();
    }

    expect(() => catalog.restoreFromSnapshot(snapshotPath)).toThrow(
      "schema does not match",
    );
  });

  it("does not normalize SQLite-significant non-ASCII whitespace", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-catalog-unicode-schema-"),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const catalog = new ProjectCatalog(directory);
    cleanup.push(() => catalog.close());
    const live = new DatabaseSync(join(directory, "database.sqlite"));
    try {
      live.exec("CREATE TABLE unicode_schema_probe(x TEXT PRIMARY KEY)");
    } finally {
      live.close();
    }
    const image = catalog.withConsistentSnapshot((value) => Buffer.from(value));
    const snapshotPath = join(directory, "unicode-schema.sqlite");
    await writeFile(snapshotPath, image, { mode: 0o600, flag: "wx" });
    const changed = new DatabaseSync(snapshotPath);
    try {
      changed.exec(
        "DROP TABLE unicode_schema_probe; CREATE TABLE unicode_schema_probe(x TEXT PRIMARY\u00a0KEY)",
      );
      expect(
        changed.prepare("PRAGMA table_xinfo(unicode_schema_probe)").get()?.pk,
      ).toBe(0);
    } finally {
      changed.close();
    }

    expect(() => catalog.restoreFromSnapshot(snapshotPath)).toThrow(
      "schema does not match",
    );
  });

  it("rolls catalog restoration back when atomic manifest publication fails", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-catalog-restore-rollback-"),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const catalog = new ProjectCatalog(directory);
    cleanup.push(() => catalog.close());
    const asset = (id: string) => ({
      id,
      uri: `file:///synthetic/${id}.png`,
      name: `${id}.png`,
      mediaType: "image" as const,
      tags: [],
      state: {},
      metadata: {},
    });
    catalog.upsertAsset(asset("before"));
    const image = catalog.withConsistentSnapshot((value) => value);
    expect(image).toBeInstanceOf(Buffer);
    const snapshotPath = join(directory, "rollback-source.sqlite");
    await writeFile(snapshotPath, image as Buffer, { mode: 0o600, flag: "wx" });
    catalog.upsertAsset(asset("current"));

    expect(() =>
      catalog.restoreFromSnapshot(snapshotPath, () => {
        throw new Error("manifest publication failed");
      }),
    ).toThrow("manifest publication failed");
    expect(catalog.listAssets().map((item) => item.id)).toEqual([
      "before",
      "current",
    ]);
  });

  it("rejects another process transaction without changing WAL or rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-catalog-busy-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const catalog = new ProjectCatalog(directory);
    cleanup.push(() => catalog.close());
    catalog.upsertAsset({
      id: "committed",
      uri: "file:///synthetic/committed.png",
      name: "committed.png",
      mediaType: "image",
      tags: [],
      state: {},
      metadata: {},
    });
    const other = new DatabaseSync(join(directory, "database.sqlite"));
    cleanup.push(() => other.close());
    other.exec(
      "BEGIN IMMEDIATE; INSERT INTO assets(id,uri,name,media_type,locked,data) VALUES('uncommitted','file:///synthetic/uncommitted.png','uncommitted.png','image',0,'{}')",
    );
    expect(() => catalog.withConsistentSnapshot(() => "captured")).toThrow();
    other.exec("ROLLBACK");
    expect(catalog.getAsset("committed")?.id).toBe("committed");
    expect(catalog.getAsset("uncommitted")).toBeUndefined();
  });
});
