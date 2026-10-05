import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { ProjectCatalog, type CatalogRelinkChange } from "../src/index";

const directories: string[] = [];
const catalogs: ProjectCatalog[] = [];
afterEach(async () => {
  for (const catalog of catalogs.splice(0)) catalog.close();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function reference(assetId: string): Record<string, unknown> {
  return {
    originalUri: `file:///original/${assetId}.mp4`,
    contentHash: `hash-${assetId}`,
    filename: `${assetId}.mp4`,
    fileSize: 100,
    mediaLibraryId: "library-1",
    relativePath: `${assetId}.mp4`,
    volumeId: "volume-1",
    rootUri: "file:///old/",
  };
}

function asset(assetId: string): MediaAsset {
  return {
    id: assetId,
    uri: `file:///old/${assetId}.mp4`,
    mediaType: "video",
    name: `${assetId}.mp4`,
    contentHash: `hash-${assetId}`,
    duration: 12,
    dimensions: { width: 1920, height: 1080 },
    frameRate: 24,
    capturedAt: "2024-01-01T00:00:00Z",
    tags: ["original"],
    rating: 2,
    state: { locked: true },
    metadata: {
      "openfilm.reference": reference(assetId),
      "example.user": { note: "keep this", nested: [1, 2] },
    },
    thumbnailUri: `cache/thumbnails/${assetId}.jpg`,
    proxyUri: `cache/proxies/${assetId}.mp4`,
  };
}

function change(assetId: string): CatalogRelinkChange {
  return {
    assetId,
    expectedUri: `file:///old/${assetId}.mp4`,
    expectedContentHash: `hash-${assetId}`,
    newUri: `file:///moved/${assetId}.mp4`,
    reference: { ...reference(assetId), rootUri: "file:///moved/" },
  };
}

async function fixture(): Promise<{
  directory: string;
  catalog: ProjectCatalog;
}> {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-relink-catalog-"));
  directories.push(directory);
  const catalog = new ProjectCatalog(directory);
  catalogs.push(catalog);
  catalog.upsertAsset(asset("a"));
  catalog.upsertAsset(asset("b"));
  return { directory, catalog };
}

describe("atomic catalog relinking", () => {
  it("resolves current URIs to the existing asset identity", async () => {
    const { catalog } = await fixture();
    expect(catalog.getAssetByUri("file:///old/a.mp4")).toEqual(asset("a"));
    expect(catalog.getAssetByUri("file:///missing.mp4")).toBeUndefined();
    catalog.relinkAssets([change("a")]);
    expect(catalog.getAssetByUri("file:///old/a.mp4")).toBeUndefined();
    expect(catalog.getAssetByUri("file:///moved/a.mp4")?.id).toBe("a");
  });

  it("merges locations into the latest rows and preserves all editing data", async () => {
    const { directory, catalog } = await fixture();
    const selections = [change("a"), change("b")];
    selections[0]!.reference.originalUri = "file:///attempted-replacement.mp4";
    const concurrent = new ProjectCatalog(directory);
    catalogs.push(concurrent);
    const latest = concurrent.updateAsset("a", {
      rating: 5,
      tags: ["edited during planning"],
      state: { favorite: true, rejected: true },
    });
    latest.metadata["example.after-plan"] = { text: "new metadata" };
    concurrent.upsertAsset(latest);

    const result = catalog.relinkAssets(selections);
    expect(result).toEqual([
      {
        ...latest,
        uri: "file:///moved/a.mp4",
        metadata: {
          ...latest.metadata,
          "openfilm.reference": {
            ...reference("a"),
            rootUri: "file:///moved/",
          },
        },
      },
      {
        ...asset("b"),
        uri: "file:///moved/b.mp4",
        metadata: {
          ...asset("b").metadata,
          "openfilm.reference": selections[1]!.reference,
        },
      },
    ]);
    expect(catalog.listAssets({ favorite: true })).toEqual([result[0]]);
    const reopened = new ProjectCatalog(directory);
    catalogs.push(reopened);
    expect(reopened.getAsset("a")).toEqual(result[0]);
    expect(reopened.getAsset("b")).toEqual(result[1]);
    expect(reopened.countAssets()).toBe(2);
  });

  it.each(["uri", "contentHash", "reference hash", "new hash"])(
    "rejects stale %s expectations without changing any selected row",
    async (field) => {
      const { catalog } = await fixture();
      const changes = [change("a"), change("b")];
      const newer = asset("b");
      if (field === "uri") newer.uri = "file:///already-moved/b.mp4";
      if (field === "contentHash") newer.contentHash = "new-hash";
      if (field === "reference hash") {
        delete newer.contentHash;
        newer.metadata["openfilm.reference"] = {
          ...reference("b"),
          contentHash: "new-hash",
        };
      }
      if (field === "new hash") delete changes[1]!.expectedContentHash;
      catalog.upsertAsset(newer);
      expect(() => catalog.relinkAssets(changes)).toThrow(
        expect.objectContaining({ status: 409 }),
      );
      expect(catalog.getAsset("a")).toEqual(asset("a"));
      expect(catalog.getAsset("b")).toEqual(newer);
    },
  );

  it.each([undefined, "replacement-hash"])(
    "rejects replacing a known hash with %s",
    async (contentHash) => {
      const { catalog } = await fixture();
      const selection = change("b");
      selection.reference.contentHash = contentHash;
      expect(() => catalog.relinkAssets([change("a"), selection])).toThrow(
        expect.objectContaining({ status: 409 }),
      );
      expect(catalog.getAsset("a")).toEqual(asset("a"));
      expect(catalog.getAsset("b")).toEqual(asset("b"));
    },
  );

  it("uses stored reference hashes when the legacy asset has no top-level hash", async () => {
    const { catalog } = await fixture();
    const legacy = asset("a");
    delete legacy.contentHash;
    catalog.upsertAsset(legacy);
    const [updated] = catalog.relinkAssets([change("a")]);
    expect(updated?.contentHash).toBeUndefined();
    expect(updated?.metadata["openfilm.reference"]).toEqual({
      ...reference("a"),
      rootUri: "file:///moved/",
    });
  });

  it("adds a reference hash to an unhashed legacy asset without replacing source fields", async () => {
    const { catalog } = await fixture();
    const legacy = asset("a");
    delete legacy.contentHash;
    delete legacy.metadata["openfilm.reference"];
    catalog.upsertAsset(legacy);
    const selection = change("a");
    delete selection.expectedContentHash;
    selection.reference.originalUri = legacy.uri;
    const [updated] = catalog.relinkAssets([selection]);
    expect(updated).toEqual({
      ...legacy,
      uri: selection.newUri,
      metadata: {
        ...legacy.metadata,
        "openfilm.reference": selection.reference,
      },
    });
  });

  it("rejects duplicate selections, duplicate destinations, and occupied destinations", async () => {
    const { catalog } = await fixture();
    expect(() => catalog.relinkAssets([change("a"), change("a")])).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() =>
      catalog.relinkAssets([
        change("a"),
        { ...change("b"), newUri: "file:///moved/a.mp4" },
      ]),
    ).toThrow(expect.objectContaining({ status: 409 }));
    expect(() =>
      catalog.relinkAssets([{ ...change("a"), newUri: asset("b").uri }]),
    ).toThrow(expect.objectContaining({ status: 409 }));
    expect(() =>
      catalog.relinkAssets([
        { ...change("a"), newUri: asset("b").uri },
        { ...change("b"), newUri: asset("a").uri },
      ]),
    ).toThrow(expect.objectContaining({ status: 409 }));
    expect(catalog.getAsset("a")).toEqual(asset("a"));
    expect(catalog.getAsset("b")).toEqual(asset("b"));
  });

  it("reports a missing asset without committing earlier selections", async () => {
    const { catalog } = await fixture();
    expect(() =>
      catalog.relinkAssets([change("a"), change("missing")]),
    ).toThrow(expect.objectContaining({ status: 404 }));
    expect(catalog.getAsset("a")).toEqual(asset("a"));
  });

  it("validates change inputs and JSON reference data", async () => {
    const { catalog } = await fixture();
    const invalidInputs: unknown[] = [
      null,
      {},
      [],
      [null],
      [{ ...change("a"), assetId: "" }],
      [{ ...change("a"), expectedUri: "https://example.com/a.mp4" }],
      [{ ...change("a"), newUri: "not-a-uri" }],
      [{ ...change("a"), expectedContentHash: 123 }],
      [{ ...change("a"), reference: [] }],
      [{ ...change("a"), reference: { originalUri: "/tmp/a.mp4" } }],
      [{ ...change("a"), reference: { ...reference("a"), contentHash: 123 } }],
      [{ ...change("a"), reference: { ...reference("a"), extra: () => 1 } }],
    ];
    for (const input of invalidInputs)
      expect(() =>
        catalog.relinkAssets(input as CatalogRelinkChange[]),
      ).toThrow(expect.objectContaining({ status: 400 }));
    expect(catalog.getAsset("a")).toEqual(asset("a"));
    expect(() => catalog.getAssetByUri("https://example.com/a.mp4")).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("rolls back the first update when SQLite rejects the second update", async () => {
    const { directory, catalog } = await fixture();
    const database = new DatabaseSync(join(directory, "database.sqlite"));
    try {
      database.exec(`
        CREATE TRIGGER reject_second_relink BEFORE UPDATE OF uri ON assets
        WHEN OLD.id = 'b'
        BEGIN SELECT RAISE(ABORT, 'injected second update failure'); END;
      `);
      expect(() => catalog.relinkAssets([change("a"), change("b")])).toThrow(
        "injected second update failure",
      );
      expect(catalog.getAsset("a")).toEqual(asset("a"));
      expect(catalog.getAsset("b")).toEqual(asset("b"));
      expect(catalog.getAssetByUri("file:///moved/a.mp4")).toBeUndefined();
      database.exec("DROP TRIGGER reject_second_relink");
      expect(catalog.relinkAssets([change("a"), change("b")])).toHaveLength(2);
      expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(
        1,
      );
    } finally {
      database.close();
    }
  });
});
