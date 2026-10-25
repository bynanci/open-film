import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG_SCHEMA_VERSION,
  CATALOG_TABLE_POLICIES,
  createPortableCatalogSnapshot,
  inspectCatalogSnapshot,
  ProjectCatalog,
  upgradeCatalogSnapshot,
} from "../src/index.js";
import {
  CATALOG_V6_TABLES,
  dropCatalogV6Tables,
} from "./catalog-version-fixtures.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function legacyV5Image(image: Uint8Array): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-catalog-v5-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "database.sqlite");
  await writeFile(path, image, { mode: 0o600, flag: "wx" });
  const database = new DatabaseSync(path);
  try {
    if (
      Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 6
    ) {
      database.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
      dropCatalogV6Tables(database);
      database.exec("PRAGMA user_version=5; COMMIT; PRAGMA foreign_keys=ON;");
    }
  } finally {
    database.close();
  }
  return readFile(path);
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
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-catalog-upgrade-"),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const catalog = new ProjectCatalog(directory);
    cleanup.push(() => catalog.close());
    catalog.upsertAsset({
      id: "legacy-asset",
      uri: "file:///synthetic/legacy.png",
      name: "legacy.png",
      mediaType: "image",
      tags: [],
      state: {},
      metadata: {},
    });
    const current = catalog.withConsistentSnapshot((image) => image);
    const legacy = await legacyV5Image(current);
    const before = createHash("sha256").update(legacy).digest("hex");

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
            `logical-${id}`,
            1,
            1,
            JSON.stringify({ id }),
          );
        live
          .prepare(
            "INSERT INTO file_occurrences(id,display_name,relative_path,file_kind,byte_length,availability,scan_revision,data) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            `occurrence-${id}`,
            `${id}.png`,
            `${id}.png`,
            "image",
            64,
            "available",
            1,
            JSON.stringify({ id }),
          );
        live
          .prepare(
            "INSERT INTO selection_memberships(selection_id,occurrence_id,relative_path,included,data) VALUES(?,?,?,?,?)",
          )
          .run(`selection-${id}`, `occurrence-${id}`, `${id}.png`, 1, "{}");
        live
          .prepare(
            "INSERT INTO content_identities(id,hash_algorithm,full_hash,byte_length,media_kind,data) VALUES(?,?,?,?,?,?)",
          )
          .run(`content-${id}`, "sha256", suffix.repeat(64), 64, "image", "{}");
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
            "{}",
          );
      }
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
    } finally {
      projected.close();
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
    const sourceDirectory = await mkdtemp(
      join(tmpdir(), "openfilm-catalog-legacy-source-"),
    );
    const targetDirectory = await mkdtemp(
      join(tmpdir(), "openfilm-catalog-legacy-target-"),
    );
    cleanup.push(() => rm(sourceDirectory, { recursive: true, force: true }));
    cleanup.push(() => rm(targetDirectory, { recursive: true, force: true }));
    const source = new ProjectCatalog(sourceDirectory);
    cleanup.push(() => source.close());
    source.upsertAsset({
      id: "legacy",
      uri: "file:///synthetic/legacy.png",
      name: "legacy.png",
      mediaType: "image",
      tags: [],
      state: {},
      metadata: {},
    });
    const legacy = await legacyV5Image(
      source.withConsistentSnapshot((image) => image),
    );
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

    expect(target.listAssets().map((asset) => asset.id)).toEqual(["legacy"]);
    expect(
      target.withConsistentSnapshot((_, schemaVersion) => schemaVersion),
    ).toBe(6);
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
