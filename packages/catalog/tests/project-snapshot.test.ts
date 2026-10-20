import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { inspectCatalogSnapshot, ProjectCatalog } from "../src/index.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

describe("consistent project catalog snapshots", () => {
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
    expect(result.schemaVersion).toBe(5);

    const check = new DatabaseSync(join(directory, "database.sqlite"));
    try {
      expect(check.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe(
        "wal",
      );
    } finally {
      check.close();
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
