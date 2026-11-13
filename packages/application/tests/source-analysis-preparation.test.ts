import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectCatalog } from "@openfilm/catalog";
import type {
  AnalysisRun,
  ExpectedManifest,
  ImportBatch,
  MediaAsset,
  VerifiedManifest,
  VerifiedManifestMember,
} from "@openfilm/core";
import { SourceAnalysisService } from "../src/source-analysis.js";

const createdAt = "2026-11-12T00:00:00.000Z";
const contentHash = "a".repeat(64);
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const request = {
  projectId: "preparation-project",
  verifiedManifestId: "preparation-manifest",
  scopeMode: "selected-sources" as const,
  requestId: "preparation-request",
};

function member(index: number): VerifiedManifestMember {
  return {
    assetId: `asset:${String(index).padStart(5, "0")}`,
    bindingId: `binding:${String(index).padStart(5, "0")}`,
    contentHash,
    contextRevision: "context:1",
  };
}

function asset(id: string): MediaAsset {
  return {
    id,
    uri: `file:///synthetic-metadata-only/${id}.png`,
    name: id,
    mediaType: "image",
    contentHash,
    tags: [],
    state: {},
    metadata: {},
  };
}

// Metadata-only Catalog boundary double. It deliberately stops at run creation:
// these tests cover preparation, not SQLite persistence or media decoding.
// The existing source-analysis suite exercises the complete application path.
function preparationBoundary(members: VerifiedManifestMember[]) {
  const manifest: VerifiedManifest = {
    id: request.verifiedManifestId,
    expectedManifestId: "preparation-expected",
    members,
    failures: [],
    excludedOccurrenceIds: [],
    createdAt,
  };
  const expected: ExpectedManifest = {
    id: manifest.expectedManifestId,
    batchId: "preparation-batch",
    revision: 1,
    selectionHash: "b".repeat(64),
    entries: [],
    partialPolicy: "require-all",
    createdAt,
  };
  const batch: ImportBatch = {
    id: expected.batchId,
    projectId: request.projectId,
    draftRevision: 1,
    scopeMode: request.scopeMode,
    status: "sealed",
    expectedManifestId: expected.id,
    createdAt,
  };
  const prepared = new Error("Stop at the persistence boundary");
  const boundary = {
    multiSource: {
      getVerifiedManifest: vi.fn(() => structuredClone(manifest)),
      getExpectedManifest: vi.fn(() => structuredClone(expected)),
      getImportBatch: vi.fn(() => structuredClone(batch)),
      getAnalysisRun: vi.fn(() => undefined),
      createAnalysisRun: vi.fn((_run: AnalysisRun): never => {
        throw prepared;
      }),
    },
    getAsset: vi.fn((id: string): MediaAsset | undefined => asset(id)),
    countAssets: vi.fn(() => 10_000),
    listAssets: vi.fn(() => []),
    saveJob: vi.fn(),
  };
  const service = new SourceAnalysisService(
    request.projectId,
    boundary as unknown as ProjectCatalog,
  );
  return { boundary, manifest, prepared, service };
}

describe("source analysis preparation at the Catalog boundary", () => {
  it.each([
    ["selected-sources", "current"],
    ["selected-sources", "changed"],
    ["selected-sources", "missing"],
    ["project-catalog", "current"],
    ["project-catalog", "changed"],
    ["project-catalog", "missing"],
  ] as const)(
    "rejects 10,001 distinct assets before hydration or work reservation (%s scope, %s source)",
    async (scopeMode, sourceState) => {
      const { boundary, service } = preparationBoundary(
        Array.from({ length: 10_001 }, (_, index) => member(index)),
      );
      if (sourceState === "changed")
        boundary.getAsset.mockImplementation((id) => ({
          ...asset(id),
          contentHash: "c".repeat(64),
        }));
      if (sourceState === "missing")
        boundary.getAsset.mockReturnValue(undefined);

      await expect(
        service.createRun({
          ...request,
          scopeMode,
          confirmProjectCatalog: true,
        }),
      ).rejects.toMatchObject({
        code: "request.tooLarge",
        status: 413,
      });
      expect(boundary.getAsset.mock.calls.length).toBe(0);
      expect(boundary.countAssets).not.toHaveBeenCalled();
      expect(boundary.listAssets).not.toHaveBeenCalled();
      expect(boundary.multiSource.getAnalysisRun).not.toHaveBeenCalled();
      expect(boundary.multiSource.createAnalysisRun).not.toHaveBeenCalled();
      expect(boundary.saveJob).not.toHaveBeenCalled();
    },
  );

  it("accepts exactly 10,000 distinct assets and 50,000 bindings", async () => {
    const { boundary, prepared, service } = preparationBoundary(
      Array.from({ length: 50_000 }, (_, index) => ({
        ...member(index),
        assetId: member(index % 10_000).assetId,
      })).reverse(),
    );
    await expect(service.createRun(request)).rejects.toBe(prepared);
    const run = boundary.multiSource.createAnalysisRun.mock.calls[0]![0];
    expect(run.inputBindingIds).toHaveLength(50_000);
    expect(run.inputBindingIds[0]).toBe("binding:00000");
    expect(run.inputBindingIds.at(-1)).toBe("binding:49999");
    expect(boundary.getAsset.mock.calls).toEqual(
      Array.from({ length: 10_000 }, (_, index) => [member(index).assetId]),
    );
    expect(boundary.saveJob).not.toHaveBeenCalled();
  });

  it("rejects 50,001 bindings before hydration even when they share one asset", async () => {
    const { boundary, service } = preparationBoundary(
      Array.from({ length: 50_001 }, (_, index) => ({
        ...member(index),
        assetId: member(0).assetId,
      })),
    );
    await expect(service.createRun(request)).rejects.toMatchObject({
      code: "request.tooLarge",
      status: 413,
    });
    expect(boundary.getAsset.mock.calls.length).toBe(0);
    expect(boundary.multiSource.createAnalysisRun).not.toHaveBeenCalled();
    expect(boundary.saveJob).not.toHaveBeenCalled();
  });

  it.each(["late mismatch", "missing asset", "missing hash"] as const)(
    "rejects within-limit repeated bindings with a %s before reserving work",
    async (invalid) => {
      const members = [
        member(0),
        member(1),
        { ...member(2), assetId: member(0).assetId },
      ];
      if (invalid === "late mismatch") members[2]!.contentHash = "c".repeat(64);
      const { boundary, service } = preparationBoundary(members);
      if (invalid === "missing asset")
        boundary.getAsset.mockReturnValue(undefined);
      if (invalid === "missing hash")
        boundary.getAsset.mockImplementation((id) => ({
          ...asset(id),
          contentHash: undefined,
        }));
      await expect(service.createRun(request)).rejects.toMatchObject({
        code: "analysis.scopeStale",
        status: 409,
      });
      expect(boundary.multiSource.createAnalysisRun).not.toHaveBeenCalled();
      expect(boundary.saveJob).not.toHaveBeenCalled();
    },
  );
});

// Real SQLite Catalog fixture: synthetic metadata only, with three occurrences
// binding two assets. No media files are needed for Common Analysis.
async function sealedMetadataCatalog(reverse = false) {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-preparation-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const catalog = new ProjectCatalog(directory);
  cleanup.push(() => catalog.close());
  catalog.upsertAsset(asset(member(0).assetId));
  catalog.upsertAsset(asset(member(1).assetId));
  const members = [
    { ...member(3), assetId: member(1).assetId },
    member(0),
    member(1),
  ];
  if (reverse) members.reverse();
  const logicalRootId = `root:${"d".repeat(64)}`;
  catalog.multiSource.saveSelection({
    id: "preparation-selection",
    projectId: request.projectId,
    kind: "folder",
    displayName: "Synthetic metadata",
    logicalRootId,
    recursive: true,
    selectionRevision: 1,
  });
  const occurrences = members.map(({ bindingId }) => ({
    id: `occurrence:${bindingId}`,
    logicalRootId,
    displayName: `${bindingId}.png`,
    relativePath: `${bindingId.replace(":", "-")}.png`,
    fileKind: "image" as const,
    byteLength: 1234,
    modifiedAt: createdAt,
    availability: "available" as const,
    scanRevision: 1,
  }));
  for (const occurrence of occurrences)
    catalog.multiSource.upsertOccurrence(
      "preparation-selection",
      occurrence,
      true,
    );
  const expected: ExpectedManifest = {
    id: "preparation-expected",
    batchId: "preparation-batch",
    revision: 1,
    selectionHash: "b".repeat(64),
    entries: occurrences.map((occurrence) => ({
      occurrenceId: occurrence.id,
      relativePath: occurrence.relativePath,
      included: true,
      expectedByteLength: occurrence.byteLength,
      expectedModifiedAt: occurrence.modifiedAt,
    })),
    partialPolicy: "require-all",
    createdAt,
  };
  catalog.multiSource.createImportBatch(
    {
      id: expected.batchId,
      projectId: request.projectId,
      draftRevision: 1,
      scopeMode: request.scopeMode,
      status: "sealing",
      expectedManifestId: expected.id,
      createdAt,
    },
    expected,
  );
  const identity = catalog.multiSource.saveContentIdentity({
    id: `content:${contentHash}`,
    hashAlgorithm: "sha256",
    fullHash: contentHash,
    byteLength: 1234,
    mediaKind: "image",
  });
  members.forEach((binding, index) =>
    catalog.multiSource.saveAssetContentVersion({
      id: binding.bindingId,
      assetId: binding.assetId,
      occurrenceId: occurrences[index]!.id,
      contentId: identity.id,
      contextRevision: binding.contextRevision,
      descriptorSnapshotId: "descriptor:1",
    }),
  );
  catalog.multiSource.createVerifiedManifest(
    {
      id: request.verifiedManifestId,
      expectedManifestId: expected.id,
      createdAt,
    },
    members.map((binding, index) => ({
      ...binding,
      occurrenceId: occurrences[index]!.id,
      status: "verified" as const,
    })),
  );
  catalog.multiSource.finishImportBatch(expected.batchId, "sealed");
  const service = new SourceAnalysisService(request.projectId, catalog);
  return { catalog, service };
}

describe("source analysis preparation with SQLite metadata", () => {
  it.each([false, true])(
    "keeps exact identity and result binding order for repeated assets (reversed=%s)",
    async (reverse) => {
      const { catalog, service } = await sealedMetadataCatalog(reverse);
      const reads = vi.spyOn(catalog, "getAsset");
      const manifestReads = vi.spyOn(
        catalog.multiSource,
        "getVerifiedManifest",
      );
      const result = await service.createRun(request);
      expect(result.run).toMatchObject({
        id: "analysis:1bec96b93e5cdf91cdfa5adb8551dce21d611fd9f3fb1612cd273ec38bb4042e",
        inputFingerprint:
          "546c5d22849d1cf69b334b4f293430cdc41f8782783954d9371404aa46f48303",
        configHash:
          "e7ffaad26201e0cb0e0f546d65efd2734e1656562fff6ef23bc2ebfb0d1f1785",
        status: "completed",
        inputBindingIds: ["binding:00000", "binding:00001", "binding:00003"],
      });
      expect(
        result.results.map(({ kind, bindingIds }) => ({ kind, bindingIds })),
      ).toEqual([
        { kind: "event", bindingIds: ["binding:00001", "binding:00003"] },
        { kind: "event", bindingIds: ["binding:00000"] },
        {
          kind: "duplicate",
          bindingIds: ["binding:00000", "binding:00001", "binding:00003"],
        },
      ]);
      expect(manifestReads).toHaveBeenCalledTimes(3);
      expect(reads.mock.calls).toEqual([
        ["asset:00000"],
        ["asset:00001"],
        ["asset:00000"],
        ["asset:00001"],
        ["asset:00000"],
        ["asset:00001"],
      ]);
    },
  );

  it.each([2, 3])(
    "rechecks a late binding hash at prepare pass %s before publishing",
    async (pass) => {
      const { catalog, service } = await sealedMetadataCatalog();
      const readManifest = catalog.multiSource.getVerifiedManifest.bind(
        catalog.multiSource,
      );
      let count = 0;
      vi.spyOn(catalog.multiSource, "getVerifiedManifest").mockImplementation(
        (id) => {
          const manifest = readManifest(id)!;
          if (++count === pass)
            manifest.members.at(-1)!.contentHash = "c".repeat(64);
          return manifest;
        },
      );
      const result = await service.createRun(request);
      expect(result.run.status).toBe("failed");
      expect(result.results).toEqual([]);
      expect(result.attempts[0]?.status).toBe("failed");
      expect(count).toBe(pass);
    },
  );
});
