import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectCatalog } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function catalogFixture() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-discovery-store-"));
  directories.push(directory);
  const catalog = new ProjectCatalog(directory);
  return { directory, catalog };
}

const selection = (id: string) => ({
  id,
  projectId: "project-test",
  kind: "folder" as const,
  displayName: `Source ${id}`,
  logicalRootId: "root:" + "a".repeat(64),
  recursive: true,
  selectionRevision: 1,
});

const occurrence = {
  id: "occurrence-test",
  logicalRootId: "root:" + "a".repeat(64),
  displayName: "photo.jpg",
  relativePath: "trip/photo.jpg",
  fileKind: "image" as const,
  byteLength: 1234,
  modifiedAt: "2026-10-29T12:00:00.000Z",
  availability: "available" as const,
  scanRevision: 1,
};

describe("catalog multi-source discovery store", () => {
  it("persists shared occurrences and independent membership across project reopen", async () => {
    const fixture = await catalogFixture();
    let { catalog } = fixture;
    catalog.multiSource.saveSelection(selection("selection-a"));
    catalog.multiSource.saveSelection(selection("selection-b"));
    catalog.multiSource.upsertOccurrence("selection-a", occurrence, true);
    catalog.multiSource.upsertOccurrence("selection-b", occurrence, true);
    catalog.multiSource.setIncluded("selection-b", occurrence.id, false);
    catalog.multiSource.upsertOccurrence("selection-b", occurrence, true);

    expect(catalog.multiSource.listOccurrences("selection-a").items).toEqual([
      { occurrence, included: true },
    ]);
    expect(catalog.multiSource.listOccurrences("selection-b").items).toEqual([
      { occurrence, included: false },
    ]);

    catalog.close();
    catalog = new ProjectCatalog(fixture.directory);
    expect(catalog.multiSource.listOccurrences("selection-a").items).toEqual([
      { occurrence, included: true },
    ]);
    expect(catalog.multiSource.listOccurrences("selection-b").items).toEqual([
      { occurrence, included: false },
    ]);
    catalog.close();
  });

  it("rejects absolute paths and does not persist private access references", async () => {
    const { catalog, directory } = await catalogFixture();
    const privateSelection = {
      ...selection("selection-private"),
      accessRef: "/Users/private/Photos",
      accessClass: "native-path",
    };
    catalog.multiSource.saveSelection(privateSelection);
    expect(() =>
      catalog.multiSource.upsertOccurrence(
        "selection-private",
        { ...occurrence, relativePath: "../../private/photo.jpg" },
        true,
      ),
    ).toThrow(/relative path/i);

    const projected = new DatabaseSync(join(directory, "database.sqlite"), {
      readOnly: true,
    });
    const persisted = JSON.stringify(
      projected
        .prepare("SELECT logical_root,data FROM source_selections")
        .all(),
    );
    projected.close();
    expect(persisted).not.toContain("/Users/private/Photos");
    expect(persisted).not.toContain("accessRef");
    catalog.close();
  });

  it("seals immutable expected and verified manifests with exact content identity", async () => {
    const { catalog } = await catalogFixture();
    catalog.multiSource.saveSelection(selection("selection-seal"));
    catalog.multiSource.upsertOccurrence("selection-seal", occurrence, true);
    catalog.upsertAsset({
      id: "asset-sealed",
      uri: "file:///synthetic/asset.png",
      name: "asset.png",
      mediaType: "image",
      tags: [],
      state: {},
      metadata: {},
    });
    const createdAt = "2026-10-29T12:00:00.000Z";
    const expected = {
      id: "manifest-expected",
      batchId: "batch-sealed",
      revision: 1,
      selectionHash: "b".repeat(64),
      entries: [
        {
          occurrenceId: occurrence.id,
          relativePath: occurrence.relativePath,
          included: true,
          expectedByteLength: occurrence.byteLength,
          expectedModifiedAt: occurrence.modifiedAt,
        },
      ],
      partialPolicy: "allow-readable" as const,
      createdAt,
    };
    const batch = {
      id: "batch-sealed",
      projectId: "project-test",
      draftRevision: 1,
      scopeMode: "selected-sources" as const,
      status: "sealing" as const,
      expectedManifestId: expected.id,
      createdAt,
    };
    catalog.multiSource.createImportBatch(batch, expected);
    expect(catalog.multiSource.getExpectedManifest(expected.id)).toEqual(
      expected,
    );

    const identity = {
      id: `content:${"c".repeat(64)}`,
      hashAlgorithm: "sha256" as const,
      fullHash: "c".repeat(64),
      byteLength: 1234,
      mediaKind: "image" as const,
    };
    expect(catalog.multiSource.saveContentIdentity(identity)).toEqual(identity);
    expect(
      catalog.multiSource.saveContentIdentity({
        ...identity,
        id: "other-content-id",
      }),
    ).toEqual(identity);
    const binding = {
      id: "binding-sealed",
      assetId: "asset-sealed",
      occurrenceId: occurrence.id,
      contentId: identity.id,
      contextRevision: "context-rev-1",
      descriptorSnapshotId: "descriptor-snapshot-1",
    };
    expect(catalog.multiSource.saveAssetContentVersion(binding)).toEqual(
      binding,
    );
    const verifiedBase = {
      id: "manifest-verified",
      expectedManifestId: expected.id,
      createdAt,
    };
    catalog.multiSource.createVerifiedManifest(verifiedBase, [
      {
        occurrenceId: occurrence.id,
        status: "verified",
        bindingId: binding.id,
        assetId: binding.assetId,
        contentHash: identity.fullHash,
        contextRevision: binding.contextRevision,
      },
    ]);
    expect(
      catalog.multiSource.getVerifiedManifest(verifiedBase.id),
    ).toMatchObject({
      ...verifiedBase,
      members: [
        {
          bindingId: binding.id,
          assetId: binding.assetId,
          contentHash: identity.fullHash,
          contextRevision: binding.contextRevision,
        },
      ],
      failures: [],
      excludedOccurrenceIds: [],
    });
    catalog.multiSource.finishImportBatch(batch.id, "sealed");
    expect(catalog.multiSource.getImportBatch(batch.id)?.status).toBe("sealed");
    expect(() =>
      catalog.multiSource.finishImportBatch(batch.id, "failed"),
    ).toThrow(/transition/i);
    expect(() =>
      catalog.multiSource.createVerifiedManifest(verifiedBase, []),
    ).toThrow(/already exists/i);
    catalog.close();
  });

  it("recovers only seals older than the private lease window", async () => {
    const { catalog } = await catalogFixture();
    catalog.multiSource.saveSelection(selection("selection-recovery"));
    catalog.multiSource.upsertOccurrence(
      "selection-recovery",
      occurrence,
      true,
    );
    const expected = {
      id: "manifest-recovery",
      batchId: "batch-recovery",
      revision: 1,
      selectionHash: "d".repeat(64),
      entries: [
        {
          occurrenceId: occurrence.id,
          relativePath: occurrence.relativePath,
          included: true,
        },
      ],
      partialPolicy: "require-all" as const,
      createdAt: "2026-10-29T12:00:00.000Z",
    };
    catalog.multiSource.createImportBatch(
      {
        id: "batch-recovery",
        projectId: "project-test",
        draftRevision: 1,
        scopeMode: "selected-sources",
        status: "sealing",
        expectedManifestId: expected.id,
        createdAt: expected.createdAt,
      },
      expected,
    );
    expect(
      catalog.multiSource.recoverInterruptedImportBatches(
        "2026-10-29T11:59:59.000Z",
      ),
    ).toBe(0);
    expect(catalog.multiSource.getImportBatch("batch-recovery")?.status).toBe(
      "sealing",
    );
    expect(
      catalog.multiSource.recoverInterruptedImportBatches(
        "2026-10-30T00:00:00.000Z",
      ),
    ).toBe(1);
    expect(catalog.multiSource.getImportBatch("batch-recovery")?.status).toBe(
      "failed",
    );
    expect(catalog.multiSource.getExpectedManifest(expected.id)).toEqual(
      expected,
    );
    catalog.close();
  });
});
