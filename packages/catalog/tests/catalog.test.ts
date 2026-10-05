import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { ProjectCatalog } from "../src/index";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function asset(id: string, time: string): MediaAsset {
  return {
    id,
    uri: pathToFileURL(`/tmp/${id}.png`).href,
    name: `${id}.png`,
    mediaType: "image",
    capturedAt: time,
    tags: [],
    state: {},
    metadata: { "example.data": { nested: true } },
  };
}

describe("real SQLite catalog", () => {
  it("persists edits and jobs while paging/filtering in SQL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-catalog-"));
    directories.push(directory);
    let catalog = new ProjectCatalog(directory);
    const original = asset("b", "2024-02-01T00:00:00Z");
    catalog.upsertAsset(original);
    catalog.upsertAsset(asset("a", "2024-01-01T00:00:00Z"));
    const patch = {
      rating: 5,
      state: { favorite: true, locked: true },
      tags: ["holiday"],
    };
    catalog.updateAsset("b", patch);
    patch.tags.push("later");
    expect(original.state).toEqual({});
    expect(catalog.listAssets({ limit: 1 }).map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(
      catalog.listAssets({ offset: 1, limit: 1 }).map((item) => item.id),
    ).toEqual(["b"]);
    expect(
      catalog
        .listAssets({
          state: { favorite: true },
          search: "holiday",
          ids: ["a", "b"],
        })
        .map((item) => item.id),
    ).toEqual(["b"]);
    expect(catalog.countAssets({ favorite: true, search: "holiday" })).toBe(1);
    expect(catalog.listAssets({ query: "' OR 1=1 --" })).toEqual([]);
    expect(() => catalog.listAssets({ order: "unsafe" as "name" })).toThrow(
      "Unsupported",
    );
    expect(() =>
      catalog.updateAsset("b", { uri: "file:///overwrite" } as never),
    ).toThrow("Only");
    expect(() => catalog.updateAsset("b", { rating: 6 })).toThrow(/rating/i);
    catalog.saveJob({
      id: "job-1",
      type: "import",
      status: "cancelled",
      progress: 0.4,
    });
    catalog.close();
    catalog = new ProjectCatalog(directory);
    expect(catalog.countAssets()).toBe(2);
    expect(catalog.getAsset("b")?.tags).toEqual(["holiday"]);
    expect(catalog.listJobs()[0]?.status).toBe("cancelled");
    expect([...catalog.iterateAssetSummaries()][0]?.metadata).toEqual({});
    catalog.close();
  });

  it("rejects future catalog schemas without resetting their version", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-future-"));
    directories.push(directory);
    const database = new DatabaseSync(join(directory, "database.sqlite"));
    database.exec("PRAGMA user_version=99");
    database.close();
    expect(() => new ProjectCatalog(directory)).toThrow("future");
    const reopened = new DatabaseSync(join(directory, "database.sqlite"));
    expect(reopened.prepare("PRAGMA user_version").get()?.user_version).toBe(
      99,
    );
    reopened.close();
  });

  it("optionally pages portable references without materializing other metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-summary-"));
    directories.push(directory);
    const catalog = new ProjectCatalog(directory);
    const reference = {
      mediaLibraryId: "library",
      rootUri: "file:///current/mount",
      originalUri: "file:///original/mount/source.jpg",
    };
    for (let index = 0; index < 501; index++) {
      const item = asset(
        `asset-${String(index).padStart(4, "0")}`,
        "2024-01-01T00:00:00Z",
      );
      item.metadata = {
        "openfilm.exif": { opaque: "x".repeat(1024) },
        ...(index === 1
          ? {}
          : { "openfilm.reference": index === 2 ? "legacy value" : reference }),
      };
      catalog.upsertAsset(item);
    }
    expect(
      [...catalog.iterateAssetSummaries()].every(
        (item) => Object.keys(item.metadata).length === 0,
      ),
    ).toBe(true);
    const summaries = [
      ...catalog.iterateAssetSummaries({ includeReference: true }),
    ];
    expect(summaries).toHaveLength(501);
    expect(summaries[0]!.metadata).toEqual({ "openfilm.reference": reference });
    expect(summaries[1]!.metadata).toEqual({});
    expect(summaries[2]!.metadata).toEqual({
      "openfilm.reference": "legacy value",
    });
    expect(summaries[500]!.metadata).toEqual({
      "openfilm.reference": reference,
    });
    expect(summaries.every((item) => !("openfilm.exif" in item.metadata))).toBe(
      true,
    );
    catalog.close();
  });
});
