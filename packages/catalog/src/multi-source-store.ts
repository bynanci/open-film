// Modified by OpenFilm contributors on 2026-10-25. See LICENSE and NOTICE.
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type {
  AnalysisEvidenceResult,
  AnalysisRun,
  AnalysisRunStatus,
  AssetContentVersion,
  CatalogSourceSelection,
  ContentIdentity,
  ExpectedManifest,
  ExpectedManifestEntry,
  FileOccurrence,
  ImportBatch,
  ImportBatchStatus,
  ReviewDecision,
  VerifiedManifest,
} from "@openfilm/core";
import {
  canTransitionAnalysisRun,
  canTransitionImportBatch,
} from "@openfilm/core";
import {
  TRAVEL_CONTEXT_LIMITS,
  validateTravelContext,
  validateVisualSampling,
} from "@openfilm/core";

export type CatalogTablePolicy =
  "portable-semantic" | "local-operational" | "cache";

export interface CatalogOccurrenceMembership {
  occurrence: FileOccurrence;
  included: boolean;
}

export interface CatalogOccurrencePage {
  items: CatalogOccurrenceMembership[];
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface CatalogVerifiedManifestEntry {
  occurrenceId: string;
  status: "verified" | "failed" | "excluded";
  bindingId?: string;
  assetId?: string;
  contentHash?: string;
  contextRevision?: string;
  code?: string;
}

export interface CatalogVerifiedManifestBase {
  id: string;
  expectedManifestId: string;
  createdAt: string;
}

export function fingerprintReviewResults(
  run: Pick<AnalysisRun, "id" | "manifestId">,
  results: readonly AnalysisEvidenceResult[],
  targetIds: readonly string[],
  decisions: readonly ReviewDecision[] = [],
): string {
  const byId = new Map(results.map((result) => [result.id, result]));
  const selected = [...new Set(targetIds)].sort().map((id) => {
    const result = byId.get(id);
    if (!result || result.runId !== run.id)
      throw new Error("Review target is missing from its fixed analysis run.");
    return {
      id: result.id,
      reviewStatus: result.reviewStatus,
      evidence: result.evidence,
      bindingIds: [...result.bindingIds].sort(),
    };
  });
  return createHash("sha256")
    .update(
      JSON.stringify({
        runId: run.id,
        manifestId: run.manifestId,
        results: selected,
        ...(decisions.some(
          (decision) =>
            decision.outcome === "applied" &&
            decision.targetIds.some((id) => targetIds.includes(id)),
        )
          ? {
              reviewLineage: decisions
                .filter(
                  (decision) =>
                    decision.outcome === "applied" &&
                    decision.targetIds.some((id) => targetIds.includes(id)),
                )
                .map(({ id, operationFingerprint, supersedesDecisionId }) => ({
                  id,
                  operationFingerprint,
                  ...(supersedesDecisionId ? { supersedesDecisionId } : {}),
                }))
                .sort((left, right) => left.id.localeCompare(right.id)),
            }
          : {}),
      }),
    )
    .digest("hex");
}

export interface CatalogContentMatch {
  identity: ContentIdentity;
  assetId?: string;
}

function requireText(value: string, label: string, maximum = 16_384): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error(`${label} is invalid.`);
  return value;
}

function validRelativePath(value: string): string {
  const normalized = requireText(value, "Occurrence relative path").replaceAll(
    "\\",
    "/",
  );
  if (
    normalized.startsWith("/") ||
    /^[a-z]:/iu.test(normalized) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(
      "Occurrence relative path must remain inside its source root.",
    );
  return normalized;
}

function validLogicalRootId(value: string): string {
  const root = requireText(value, "Logical root ID", 256);
  if (!/^[a-z0-9:_-]+$/iu.test(root))
    throw new Error("Logical root ID must not contain a locator or path.");
  return root;
}

/** Durable semantic source discovery; access handles and absolute paths never enter the catalog. */
export class CatalogMultiSourceStore {
  constructor(private readonly database: DatabaseSync) {}

  saveSelection(selection: CatalogSourceSelection): void {
    const safe: CatalogSourceSelection = {
      id: requireText(selection.id, "Source selection ID", 256),
      projectId: requireText(selection.projectId, "Source project ID", 512),
      kind: selection.kind,
      displayName: requireText(
        selection.displayName,
        "Source display name",
        512,
      ),
      logicalRootId: validLogicalRootId(selection.logicalRootId),
      recursive: selection.recursive,
      selectionRevision: selection.selectionRevision,
    };
    if (
      !["file", "folder"].includes(safe.kind) ||
      typeof safe.recursive !== "boolean" ||
      !Number.isSafeInteger(safe.selectionRevision) ||
      safe.selectionRevision < 0
    )
      throw new Error("Source selection semantics are invalid.");
    const data = JSON.stringify(safe);
    this.database
      .prepare(
        `INSERT INTO source_selections(
           id,kind,display_name,logical_root,recursive,selection_revision,data
         ) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           kind=excluded.kind,display_name=excluded.display_name,
           logical_root=excluded.logical_root,recursive=excluded.recursive,
           selection_revision=excluded.selection_revision,data=excluded.data`,
      )
      .run(
        safe.id,
        safe.kind,
        safe.displayName,
        safe.logicalRootId,
        Number(safe.recursive),
        safe.selectionRevision,
        data,
      );
  }

  upsertOccurrence(
    selectionId: string,
    occurrence: FileOccurrence,
    included: boolean,
  ): void {
    this.upsertOccurrences(selectionId, [{ occurrence, included }]);
  }

  upsertOccurrences(
    selectionId: string,
    entries: readonly CatalogOccurrenceMembership[],
  ): void {
    const safeSelectionId = requireText(
      selectionId,
      "Source selection ID",
      256,
    );
    if (entries.length > 1000)
      throw new Error(
        "A discovery write batch cannot exceed 1,000 occurrences.",
      );
    const safeEntries = entries.map(({ occurrence, included }) => {
      const safe: FileOccurrence = {
        id: requireText(occurrence.id, "Occurrence ID", 256),
        logicalRootId: validLogicalRootId(occurrence.logicalRootId),
        displayName: requireText(
          occurrence.displayName,
          "Occurrence display name",
          512,
        ),
        relativePath: validRelativePath(occurrence.relativePath),
        fileKind: occurrence.fileKind,
        ...(occurrence.byteLength === undefined
          ? {}
          : { byteLength: occurrence.byteLength }),
        ...(occurrence.modifiedAt === undefined
          ? {}
          : {
              modifiedAt: requireText(
                occurrence.modifiedAt,
                "Modified time",
                128,
              ),
            }),
        availability: occurrence.availability,
        scanRevision: occurrence.scanRevision,
      };
      if (
        !["image", "video", "audio", "track", "unsupported"].includes(
          safe.fileKind,
        ) ||
        ![
          "available",
          "needs-reselection",
          "missing",
          "unreadable",
          "staged",
        ].includes(safe.availability) ||
        (safe.byteLength !== undefined &&
          (!Number.isSafeInteger(safe.byteLength) || safe.byteLength < 0)) ||
        !Number.isSafeInteger(safe.scanRevision) ||
        safe.scanRevision < 0 ||
        typeof included !== "boolean"
      )
        throw new Error("File occurrence semantics are invalid.");
      return { occurrence: safe, included };
    });

    const insert = this.database.prepare(
      `INSERT INTO file_occurrences(
         id,display_name,relative_path,file_kind,byte_length,modified_at,
         availability,scan_revision,data
       ) VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         display_name=excluded.display_name,relative_path=excluded.relative_path,
         file_kind=excluded.file_kind,byte_length=excluded.byte_length,
         modified_at=excluded.modified_at,availability=excluded.availability,
         scan_revision=excluded.scan_revision,data=excluded.data`,
    );
    const membership = this.database.prepare(
      `INSERT INTO selection_memberships(
         selection_id,occurrence_id,relative_path,included,data
       ) VALUES(?,?,?,?,?)
       ON CONFLICT(selection_id,occurrence_id) DO UPDATE SET
         relative_path=excluded.relative_path,data=excluded.data`,
    );
    const membershipById = this.database.prepare(
      `SELECT included FROM selection_memberships
       WHERE selection_id=? AND occurrence_id=?`,
    );
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const selection = this.database
        .prepare("SELECT 1 FROM source_selections WHERE id=?")
        .get(safeSelectionId);
      if (!selection) throw new Error("Source selection does not exist.");
      for (const { occurrence, included } of safeEntries) {
        const existing = this.database
          .prepare("SELECT data FROM file_occurrences WHERE id=?")
          .get(occurrence.id);
        if (existing) {
          const prior = JSON.parse(
            String(existing.data),
          ) as Partial<FileOccurrence>;
          if (
            prior.logicalRootId !== occurrence.logicalRootId ||
            prior.relativePath !== occurrence.relativePath
          )
            throw new Error(
              "Occurrence identity conflicts with saved source evidence.",
            );
        }
        insert.run(
          occurrence.id,
          occurrence.displayName,
          occurrence.relativePath,
          occurrence.fileKind,
          occurrence.byteLength ?? null,
          occurrence.modifiedAt ?? null,
          occurrence.availability,
          occurrence.scanRevision,
          JSON.stringify(occurrence),
        );
        const priorMembership = membershipById.get(
          safeSelectionId,
          occurrence.id,
        );
        const retainedIncluded = priorMembership
          ? Boolean(priorMembership.included)
          : included;
        membership.run(
          safeSelectionId,
          occurrence.id,
          occurrence.relativePath,
          Number(retainedIncluded),
          JSON.stringify({
            selectionId: safeSelectionId,
            occurrenceId: occurrence.id,
            relativePath: occurrence.relativePath,
            included: retainedIncluded,
            scanRevision: occurrence.scanRevision,
          }),
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  setIncluded(
    selectionId: string,
    occurrenceId: string,
    included: boolean,
  ): void {
    const selection = requireText(selectionId, "Source selection ID", 256);
    const occurrence = requireText(occurrenceId, "Occurrence ID", 256);
    if (typeof included !== "boolean")
      throw new Error("Inclusion state is invalid.");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database
        .prepare(
          "SELECT data FROM selection_memberships WHERE selection_id=? AND occurrence_id=?",
        )
        .get(selection, occurrence);
      if (!row) throw new Error("Source membership does not exist.");
      const data = JSON.parse(String(row.data)) as Record<string, unknown>;
      data.included = included;
      this.database
        .prepare(
          `UPDATE selection_memberships SET included=?,data=?
           WHERE selection_id=? AND occurrence_id=?`,
        )
        .run(Number(included), JSON.stringify(data), selection, occurrence);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listOccurrences(
    selectionId: string,
    options: { offset?: number; limit?: number } = {},
  ): CatalogOccurrencePage {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new Error("Occurrence page bounds are invalid.");
    const rows = this.database
      .prepare(
        `SELECT occurrence.id,occurrence.data,occurrence.display_name,
           occurrence.relative_path,occurrence.file_kind,occurrence.byte_length,
           occurrence.modified_at,occurrence.availability,occurrence.scan_revision,
           membership.included
         FROM selection_memberships AS membership
         JOIN file_occurrences AS occurrence ON occurrence.id=membership.occurrence_id
         WHERE membership.selection_id=?
         ORDER BY membership.relative_path,occurrence.id LIMIT ? OFFSET ?`,
      )
      .all(selectionId, limit + 1, offset);
    return {
      items: rows.slice(0, limit).map((row) => ({
        occurrence: {
          id: String(row.id),
          logicalRootId: String(
            (JSON.parse(String(row.data)) as { logicalRootId?: unknown })
              .logicalRootId ?? "",
          ),
          displayName: String(row.display_name),
          relativePath: String(row.relative_path),
          fileKind: String(row.file_kind) as FileOccurrence["fileKind"],
          ...(row.byte_length === null
            ? {}
            : { byteLength: Number(row.byte_length) }),
          ...(row.modified_at === null
            ? {}
            : { modifiedAt: String(row.modified_at) }),
          availability: String(
            row.availability,
          ) as FileOccurrence["availability"],
          scanRevision: Number(row.scan_revision),
        },
        included: Boolean(row.included),
      })),
      offset,
      limit,
      hasMore: rows.length > limit,
    };
  }

  getOccurrence(
    selectionId: string,
    occurrenceId: string,
  ): CatalogOccurrenceMembership | undefined {
    const row = this.database
      .prepare(
        `SELECT occurrence.id,occurrence.data,occurrence.display_name,
           occurrence.relative_path,occurrence.file_kind,occurrence.byte_length,
           occurrence.modified_at,occurrence.availability,occurrence.scan_revision,
           membership.included
         FROM selection_memberships AS membership
         JOIN file_occurrences AS occurrence ON occurrence.id=membership.occurrence_id
         WHERE membership.selection_id=? AND membership.occurrence_id=?`,
      )
      .get(
        requireText(selectionId, "Source selection ID", 256),
        requireText(occurrenceId, "Occurrence ID", 256),
      );
    if (!row) return undefined;
    return {
      occurrence: {
        id: String(row.id),
        logicalRootId: String(
          (JSON.parse(String(row.data)) as { logicalRootId?: unknown })
            .logicalRootId ?? "",
        ),
        displayName: String(row.display_name),
        relativePath: String(row.relative_path),
        fileKind: String(row.file_kind) as FileOccurrence["fileKind"],
        ...(row.byte_length === null
          ? {}
          : { byteLength: Number(row.byte_length) }),
        ...(row.modified_at === null
          ? {}
          : { modifiedAt: String(row.modified_at) }),
        availability: String(
          row.availability,
        ) as FileOccurrence["availability"],
        scanRevision: Number(row.scan_revision),
      },
      included: Boolean(row.included),
    };
  }

  nextScanRevision(selectionId: string): number {
    const selection = requireText(selectionId, "Source selection ID", 256);
    const row = this.database
      .prepare(
        `SELECT COALESCE(MAX(occurrence.scan_revision),0) AS revision
         FROM selection_memberships AS membership
         JOIN file_occurrences AS occurrence ON occurrence.id=membership.occurrence_id
         WHERE membership.selection_id=?`,
      )
      .get(selection);
    const next = Number(row?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(next))
      throw new Error("Source scan revision exceeds the supported range.");
    return next;
  }

  markUnseenOccurrencesMissing(
    selectionId: string,
    scanRevision: number,
  ): number {
    const selection = requireText(selectionId, "Source selection ID", 256);
    if (!Number.isSafeInteger(scanRevision) || scanRevision < 1)
      throw new Error("Source scan revision is invalid.");
    const rowsQuery = this.database.prepare(
      `SELECT membership.occurrence_id,membership.data AS membership_data,
         occurrence.display_name,occurrence.relative_path,occurrence.file_kind,
         occurrence.byte_length,occurrence.modified_at,occurrence.availability,
         occurrence.scan_revision,occurrence.data AS occurrence_data
       FROM selection_memberships AS membership
       JOIN file_occurrences AS occurrence ON occurrence.id=membership.occurrence_id
       WHERE membership.selection_id=?`,
    );
    const membershipOther = this.database.prepare(
      `SELECT included FROM selection_memberships
       WHERE occurrence_id=? AND selection_id<>?`,
    );
    const update = this.database.prepare(
      `UPDATE file_occurrences SET availability='missing',data=? WHERE id=?`,
    );
    let missing = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const rows = rowsQuery.all(selection);
      for (const row of rows) {
        const membership = JSON.parse(String(row.membership_data)) as {
          scanRevision?: unknown;
        };
        const lastSeen =
          typeof membership.scanRevision === "number"
            ? membership.scanRevision
            : 0;
        if (lastSeen >= scanRevision || row.availability === "missing")
          continue;
        const otherSelectionHasOccurrence = membershipOther
          .all(String(row.occurrence_id), selection)
          .some((other) => Boolean(other.included));
        if (otherSelectionHasOccurrence) continue;
        const occurrence = JSON.parse(String(row.occurrence_data)) as Record<
          string,
          unknown
        >;
        occurrence.availability = "missing";
        update.run(JSON.stringify(occurrence), String(row.occurrence_id));
        missing++;
      }
      this.database.exec("COMMIT");
      return missing;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createImportBatch(batch: ImportBatch, expected: ExpectedManifest): void {
    if (
      batch.status !== "sealing" ||
      batch.expectedManifestId !== expected.id ||
      expected.batchId !== batch.id ||
      expected.revision !== batch.draftRevision
    )
      throw new Error("Import batch and expected manifest do not match.");
    const safeBatch: ImportBatch = {
      id: requireText(batch.id, "Import batch ID", 256),
      projectId: requireText(batch.projectId, "Import project ID", 512),
      draftRevision: batch.draftRevision,
      scopeMode: batch.scopeMode,
      status: batch.status,
      expectedManifestId: requireText(expected.id, "Expected manifest ID", 256),
      createdAt: requireText(
        batch.createdAt,
        "Import batch creation time",
        128,
      ),
    };
    if (
      !Number.isSafeInteger(safeBatch.draftRevision) ||
      safeBatch.draftRevision < 0 ||
      !["selected-sources", "project-catalog"].includes(safeBatch.scopeMode) ||
      expected.entries.length < 1 ||
      expected.entries.length > 100_000
    )
      throw new Error("Import batch bounds or scope are invalid.");
    const safeExpected: ExpectedManifest = {
      id: safeBatch.expectedManifestId,
      batchId: safeBatch.id,
      revision: safeBatch.draftRevision,
      selectionHash: requireText(
        expected.selectionHash,
        "Selection fingerprint",
        64,
      ),
      entries: expected.entries.map((entry) => {
        const safe: ExpectedManifestEntry = {
          occurrenceId: requireText(
            entry.occurrenceId,
            "Expected occurrence ID",
            256,
          ),
          relativePath: validRelativePath(entry.relativePath),
          included: entry.included,
          ...(entry.expectedByteLength === undefined
            ? {}
            : { expectedByteLength: entry.expectedByteLength }),
          ...(entry.expectedModifiedAt === undefined
            ? {}
            : {
                expectedModifiedAt: requireText(
                  entry.expectedModifiedAt,
                  "Expected modified time",
                  128,
                ),
              }),
        };
        if (
          typeof safe.included !== "boolean" ||
          (safe.expectedByteLength !== undefined &&
            (!Number.isSafeInteger(safe.expectedByteLength) ||
              safe.expectedByteLength < 0))
        )
          throw new Error("Expected manifest entry is invalid.");
        return safe;
      }),
      partialPolicy: expected.partialPolicy,
      createdAt: requireText(
        expected.createdAt,
        "Expected manifest creation time",
        128,
      ),
    };
    if (
      !/^[a-f0-9]{64}$/u.test(safeExpected.selectionHash) ||
      !["require-all", "allow-readable"].includes(safeExpected.partialPolicy) ||
      new Set(safeExpected.entries.map(({ occurrenceId }) => occurrenceId))
        .size !== safeExpected.entries.length
    )
      throw new Error("Expected manifest semantics are invalid.");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const batchData = JSON.stringify(safeBatch);
      const expectedData = JSON.stringify({
        id: safeExpected.id,
        batchId: safeExpected.batchId,
        revision: safeExpected.revision,
        selectionHash: safeExpected.selectionHash,
        partialPolicy: safeExpected.partialPolicy,
        createdAt: safeExpected.createdAt,
      });
      this.database
        .prepare(
          `INSERT INTO import_batches(
             id,draft_revision,scope_mode,status,created_at,data
           ) VALUES(?,?,?,?,?,?)`,
        )
        .run(
          safeBatch.id,
          safeBatch.draftRevision,
          safeBatch.scopeMode,
          safeBatch.status,
          safeBatch.createdAt,
          batchData,
        );
      this.database
        .prepare(
          `INSERT INTO expected_manifests(
             id,batch_id,revision,selection_hash,partial_policy,created_at,data
           ) VALUES(?,?,?,?,?,?,?)`,
        )
        .run(
          safeExpected.id,
          safeExpected.batchId,
          safeExpected.revision,
          safeExpected.selectionHash,
          safeExpected.partialPolicy,
          safeExpected.createdAt,
          expectedData,
        );
      const insertEntry = this.database.prepare(
        `INSERT INTO expected_manifest_entries(
           manifest_id,occurrence_id,position,included,data
         ) VALUES(?,?,?,?,?)`,
      );
      safeExpected.entries.forEach((entry, position) => {
        insertEntry.run(
          safeExpected.id,
          entry.occurrenceId,
          position,
          Number(entry.included),
          JSON.stringify({
            manifestId: safeExpected.id,
            occurrenceId: entry.occurrenceId,
            position,
            included: entry.included,
            relativePath: entry.relativePath,
            ...(entry.expectedByteLength === undefined
              ? {}
              : { expectedByteLength: entry.expectedByteLength }),
            ...(entry.expectedModifiedAt === undefined
              ? {}
              : { expectedModifiedAt: entry.expectedModifiedAt }),
          }),
        );
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getImportBatch(id: string): ImportBatch | undefined {
    const row = this.database
      .prepare("SELECT status,data FROM import_batches WHERE id=?")
      .get(requireText(id, "Import batch ID", 256));
    if (!row) return undefined;
    const value = JSON.parse(String(row.data)) as ImportBatch;
    return { ...value, status: String(row.status) as ImportBatchStatus };
  }

  getImportBatchByExpectedId(
    expectedManifestId: string,
  ): ImportBatch | undefined {
    const expectedId = requireText(
      expectedManifestId,
      "Expected manifest ID",
      256,
    );
    const row = this.database
      .prepare(
        "SELECT id FROM import_batches WHERE id=(SELECT batch_id FROM expected_manifests WHERE id=?)",
      )
      .get(expectedId);
    return row ? this.getImportBatch(String(row.id)) : undefined;
  }

  finishImportBatch(id: string, status: ImportBatchStatus): void {
    const batchId = requireText(id, "Import batch ID", 256);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database
        .prepare("SELECT status,data FROM import_batches WHERE id=?")
        .get(batchId);
      if (!row) throw new Error("Import batch does not exist.");
      const current = String(row.status) as ImportBatchStatus;
      if (!canTransitionImportBatch(current, status))
        throw new Error(
          `Import batch cannot transition from ${current} to ${status}.`,
        );
      const data = JSON.parse(String(row.data)) as Record<string, unknown>;
      data.status = status;
      this.database
        .prepare("UPDATE import_batches SET status=?,data=? WHERE id=?")
        .run(status, JSON.stringify(data), batchId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  recoverInterruptedImportBatches(staleBefore: string): number {
    const cutoff = requireText(staleBefore, "Import recovery cutoff", 128);
    if (!Number.isFinite(Date.parse(cutoff)))
      throw new Error("Import recovery cutoff must be a valid timestamp.");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.database
        .prepare(
          "SELECT id,data FROM import_batches WHERE status='sealing' AND created_at<?",
        )
        .all(cutoff);
      const update = this.database.prepare(
        "UPDATE import_batches SET status='failed',data=? WHERE id=? AND status='sealing'",
      );
      for (const row of rows) {
        const data = JSON.parse(String(row.data)) as Record<string, unknown>;
        data.status = "failed";
        update.run(JSON.stringify(data), String(row.id));
      }
      this.database.exec("COMMIT");
      return rows.length;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getExpectedManifest(id: string): ExpectedManifest | undefined {
    const manifestId = requireText(id, "Expected manifest ID", 256);
    const row = this.database
      .prepare("SELECT data FROM expected_manifests WHERE id=?")
      .get(manifestId);
    if (!row) return undefined;
    const value = JSON.parse(String(row.data)) as Omit<
      ExpectedManifest,
      "entries"
    >;
    const entries = this.database
      .prepare(
        `SELECT occurrence_id,included,data FROM expected_manifest_entries
         WHERE manifest_id=? ORDER BY position`,
      )
      .all(manifestId)
      .map((entry) => {
        const data = JSON.parse(String(entry.data)) as Record<string, unknown>;
        return {
          occurrenceId: String(entry.occurrence_id),
          relativePath: validRelativePath(String(data.relativePath ?? "")),
          included: Boolean(entry.included),
          ...(data.expectedByteLength === undefined
            ? {}
            : { expectedByteLength: Number(data.expectedByteLength) }),
          ...(data.expectedModifiedAt === undefined
            ? {}
            : { expectedModifiedAt: String(data.expectedModifiedAt) }),
        } satisfies ExpectedManifestEntry;
      });
    return { ...value, entries };
  }

  saveContentIdentity(identity: ContentIdentity): ContentIdentity {
    const safe: ContentIdentity = {
      id: requireText(identity.id, "Content identity ID", 256),
      hashAlgorithm: "sha256",
      fullHash: identity.fullHash,
      byteLength: identity.byteLength,
      mediaKind: identity.mediaKind,
    };
    if (
      !/^[a-f0-9]{64}$/u.test(safe.fullHash) ||
      !Number.isSafeInteger(safe.byteLength) ||
      safe.byteLength < 0 ||
      !["image", "video", "audio", "track"].includes(safe.mediaKind)
    )
      throw new Error("Full content identity is invalid.");
    this.database
      .prepare(
        `INSERT INTO content_identities(
           id,hash_algorithm,full_hash,byte_length,media_kind,data
         ) VALUES(?,?,?,?,?,?)
         ON CONFLICT(hash_algorithm,full_hash,byte_length) DO NOTHING`,
      )
      .run(
        safe.id,
        safe.hashAlgorithm,
        safe.fullHash,
        safe.byteLength,
        safe.mediaKind,
        JSON.stringify(safe),
      );
    const row = this.database
      .prepare(
        `SELECT id,hash_algorithm,full_hash,byte_length,media_kind
         FROM content_identities WHERE hash_algorithm=? AND full_hash=? AND byte_length=?`,
      )
      .get(safe.hashAlgorithm, safe.fullHash, safe.byteLength);
    if (!row || row.media_kind !== safe.mediaKind)
      throw new Error(
        "Content identity conflicts with an existing media kind.",
      );
    return {
      id: String(row.id),
      hashAlgorithm: "sha256",
      fullHash: String(row.full_hash),
      byteLength: Number(row.byte_length),
      mediaKind: String(row.media_kind) as ContentIdentity["mediaKind"],
    };
  }

  findContentIdentity(
    fullHash: string,
    byteLength: number,
  ): CatalogContentMatch | undefined {
    if (
      !/^[a-f0-9]{64}$/u.test(fullHash) ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0
    )
      throw new Error("Full content identity lookup is invalid.");
    const row = this.database
      .prepare(
        `SELECT identity.id,identity.hash_algorithm,identity.full_hash,
           identity.byte_length,identity.media_kind,binding.asset_id
         FROM content_identities AS identity
         LEFT JOIN asset_content_versions AS binding ON binding.content_id=identity.id
         WHERE identity.hash_algorithm='sha256' AND identity.full_hash=?
           AND identity.byte_length=? ORDER BY binding.id LIMIT 1`,
      )
      .get(fullHash, byteLength);
    if (!row) return undefined;
    return {
      identity: {
        id: String(row.id),
        hashAlgorithm: "sha256",
        fullHash: String(row.full_hash),
        byteLength: Number(row.byte_length),
        mediaKind: String(row.media_kind) as ContentIdentity["mediaKind"],
      },
      ...(row.asset_id === null ? {} : { assetId: String(row.asset_id) }),
    };
  }

  saveAssetContentVersion(binding: AssetContentVersion): AssetContentVersion {
    const safe: AssetContentVersion = {
      id: requireText(binding.id, "Asset content version ID", 256),
      assetId: requireText(binding.assetId, "Asset ID", 256),
      occurrenceId: requireText(binding.occurrenceId, "Occurrence ID", 256),
      contentId: requireText(binding.contentId, "Content identity ID", 256),
      contextRevision: requireText(
        binding.contextRevision,
        "Context revision",
        256,
      ),
      descriptorSnapshotId: requireText(
        binding.descriptorSnapshotId,
        "Descriptor snapshot ID",
        256,
      ),
    };
    this.database
      .prepare(
        `INSERT INTO asset_content_versions(
           id,asset_id,occurrence_id,content_id,context_revision,
           descriptor_snapshot_id,data
         ) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(asset_id,occurrence_id,content_id,context_revision) DO NOTHING`,
      )
      .run(
        safe.id,
        safe.assetId,
        safe.occurrenceId,
        safe.contentId,
        safe.contextRevision,
        safe.descriptorSnapshotId,
        JSON.stringify(safe),
      );
    const row = this.database
      .prepare(
        `SELECT id,asset_id,occurrence_id,content_id,context_revision,descriptor_snapshot_id
         FROM asset_content_versions
         WHERE asset_id=? AND occurrence_id=? AND content_id=? AND context_revision=?`,
      )
      .get(
        safe.assetId,
        safe.occurrenceId,
        safe.contentId,
        safe.contextRevision,
      );
    if (!row) throw new Error("Asset content version was not saved.");
    return {
      id: String(row.id),
      assetId: String(row.asset_id),
      occurrenceId: String(row.occurrence_id),
      contentId: String(row.content_id),
      contextRevision: String(row.context_revision),
      descriptorSnapshotId: String(row.descriptor_snapshot_id),
    };
  }

  createVerifiedManifest(
    base: CatalogVerifiedManifestBase,
    entries: readonly CatalogVerifiedManifestEntry[],
  ): void {
    const id = requireText(base.id, "Verified manifest ID", 256);
    const expectedManifestId = requireText(
      base.expectedManifestId,
      "Expected manifest ID",
      256,
    );
    const createdAt = requireText(
      base.createdAt,
      "Verified manifest creation time",
      128,
    );
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.database
          .prepare("SELECT 1 FROM verified_manifests WHERE id=?")
          .get(id)
      )
        throw new Error("Verified manifest already exists and is immutable.");
      const expectedRows = this.database
        .prepare(
          `SELECT occurrence_id,included FROM expected_manifest_entries
           WHERE manifest_id=? ORDER BY position`,
        )
        .all(expectedManifestId);
      if (!expectedRows.length || expectedRows.length !== entries.length)
        throw new Error("Verified manifest must resolve every expected entry.");
      this.database
        .prepare(
          `INSERT INTO verified_manifests(id,expected_manifest_id,created_at,data)
           VALUES(?,?,?,?)`,
        )
        .run(
          id,
          expectedManifestId,
          createdAt,
          JSON.stringify({ id, expectedManifestId, createdAt }),
        );
      const insert = this.database.prepare(
        `INSERT INTO verified_manifest_entries(
           manifest_id,position,occurrence_id,binding_id,status,data
         ) VALUES(?,?,?,?,?,?)`,
      );
      entries.forEach((entry, position) => {
        const expected = expectedRows[position]!;
        if (
          entry.occurrenceId !== String(expected.occurrence_id) ||
          (!expected.included && entry.status !== "excluded") ||
          (expected.included && entry.status === "excluded")
        )
          throw new Error(
            "Verified manifest entries do not match the expected scope.",
          );
        const data: Record<string, unknown> = {};
        if (entry.status === "verified") {
          if (
            !entry.bindingId ||
            !entry.assetId ||
            !entry.contentHash ||
            !entry.contextRevision
          )
            throw new Error("Verified member identity is incomplete.");
          const binding = this.database
            .prepare(
              `SELECT binding.asset_id,binding.occurrence_id,binding.context_revision,
                 identity.full_hash
               FROM asset_content_versions AS binding
               JOIN content_identities AS identity ON identity.id=binding.content_id
               WHERE binding.id=?`,
            )
            .get(entry.bindingId);
          if (
            !binding ||
            binding.asset_id !== entry.assetId ||
            binding.occurrence_id !== entry.occurrenceId ||
            binding.context_revision !== entry.contextRevision ||
            binding.full_hash !== entry.contentHash
          )
            throw new Error(
              "Verified member does not match its sealed content binding.",
            );
          Object.assign(data, {
            assetId: entry.assetId,
            contentHash: entry.contentHash,
            contextRevision: entry.contextRevision,
          });
        } else if (entry.status === "failed") {
          if (
            !entry.code ||
            entry.code.length > 128 ||
            !/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/u.test(entry.code)
          )
            throw new Error("Verified failure code is invalid.");
          data.code = entry.code;
        } else if (entry.status !== "excluded") {
          throw new Error("Verified manifest status is invalid.");
        }
        insert.run(
          id,
          position,
          entry.occurrenceId,
          entry.status === "verified" ? entry.bindingId! : null,
          entry.status,
          JSON.stringify(data),
        );
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getVerifiedManifest(id: string): VerifiedManifest | undefined {
    const manifestId = requireText(id, "Verified manifest ID", 256);
    const row = this.database
      .prepare(
        "SELECT expected_manifest_id,created_at FROM verified_manifests WHERE id=?",
      )
      .get(manifestId);
    if (!row) return undefined;
    const members: VerifiedManifest["members"] = [];
    const failures: VerifiedManifest["failures"] = [];
    const excludedOccurrenceIds: string[] = [];
    for (const entry of this.database
      .prepare(
        `SELECT entry.occurrence_id,entry.binding_id,entry.status,entry.data,
           binding.asset_id,binding.context_revision,identity.full_hash
         FROM verified_manifest_entries AS entry
         LEFT JOIN asset_content_versions AS binding ON binding.id=entry.binding_id
         LEFT JOIN content_identities AS identity ON identity.id=binding.content_id
         WHERE entry.manifest_id=? ORDER BY entry.position`,
      )
      .all(manifestId)) {
      const data = JSON.parse(String(entry.data)) as Record<string, unknown>;
      if (entry.status === "verified")
        members.push({
          bindingId: String(entry.binding_id),
          assetId: String(entry.asset_id ?? data.assetId),
          contentHash: String(entry.full_hash ?? data.contentHash),
          contextRevision: String(
            entry.context_revision ?? data.contextRevision,
          ),
        });
      else if (entry.status === "failed")
        failures.push({
          occurrenceId: String(entry.occurrence_id),
          code: String(data.code),
        });
      else excludedOccurrenceIds.push(String(entry.occurrence_id));
    }
    return {
      id: manifestId,
      expectedManifestId: String(row.expected_manifest_id),
      members,
      failures,
      excludedOccurrenceIds,
      createdAt: String(row.created_at),
    };
  }

  getVerifiedManifestByExpectedId(
    expectedManifestId: string,
  ): VerifiedManifest | undefined {
    const expectedId = requireText(
      expectedManifestId,
      "Expected manifest ID",
      256,
    );
    const row = this.database
      .prepare("SELECT id FROM verified_manifests WHERE expected_manifest_id=?")
      .get(expectedId);
    return row ? this.getVerifiedManifest(String(row.id)) : undefined;
  }

  createAnalysisRun(run: AnalysisRun): AnalysisRun {
    const safe = this.validateAnalysisRun(run);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare("SELECT data FROM analysis_runs WHERE id=?")
        .get(safe.id);
      if (existing) {
        const prior = JSON.parse(String(existing.data)) as AnalysisRun;
        if (JSON.stringify(prior) !== JSON.stringify(safe))
          throw new Error(
            "Analysis run identity conflicts with immutable inputs.",
          );
        this.database.exec("COMMIT");
        return prior;
      }
      this.database
        .prepare(
          `INSERT INTO analysis_runs(
           id,manifest_id,scope_mode,algorithm_version,taxonomy_version,
           config_hash,status,created_at,data
         ) VALUES(?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          safe.id,
          safe.manifestId,
          safe.scopeMode,
          safe.algorithmVersion,
          safe.taxonomyVersion,
          safe.configHash,
          safe.status,
          safe.createdAt,
          JSON.stringify(safe),
        );
      this.database.exec("COMMIT");
      return safe;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getAnalysisRun(id: string): AnalysisRun | undefined {
    const row = this.database
      .prepare("SELECT data,status FROM analysis_runs WHERE id=?")
      .get(requireText(id, "Analysis run ID", 256));
    if (!row) return undefined;
    return {
      ...(JSON.parse(String(row.data)) as AnalysisRun),
      status: String(row.status) as AnalysisRunStatus,
    };
  }

  listAnalysisRuns(
    options: { offset?: number; limit?: number } = {},
  ): AnalysisRun[] {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500
    )
      throw new Error("Analysis run page bounds are invalid.");
    return this.database
      .prepare(
        "SELECT data,status FROM analysis_runs ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
      )
      .all(limit, offset)
      .map((row) => ({
        ...(JSON.parse(String(row.data)) as AnalysisRun),
        status: String(row.status) as AnalysisRunStatus,
      }));
  }

  transitionAnalysisRun(id: string, status: AnalysisRunStatus): AnalysisRun {
    const runId = requireText(id, "Analysis run ID", 256);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database
        .prepare("SELECT status,data FROM analysis_runs WHERE id=?")
        .get(runId);
      if (!row) throw new Error("Analysis run does not exist.");
      const from = String(row.status) as AnalysisRunStatus;
      if (!canTransitionAnalysisRun(from, status))
        throw new Error(
          `Analysis run cannot transition from ${from} to ${status}.`,
        );
      const run = JSON.parse(String(row.data)) as AnalysisRun;
      run.status = status;
      this.database
        .prepare("UPDATE analysis_runs SET status=?,data=? WHERE id=?")
        .run(status, JSON.stringify(run), runId);
      this.database.exec("COMMIT");
      return run;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  saveAnalysisResults(
    runId: string,
    results: readonly AnalysisEvidenceResult[],
    assertPublication?: () => void,
  ): void {
    const safeRunId = requireText(runId, "Analysis run ID", 256);
    if (!results.length || results.length > 50_000)
      throw new Error("Analysis result count is invalid.");
    const safeResults = results.map((result) => ({
      id: requireText(result.id, "Analysis result ID", 256),
      runId: requireText(result.runId, "Analysis result run ID", 256),
      kind: result.kind,
      reviewStatus: result.reviewStatus,
      evidence: this.validateAnalysisEvidence(result.evidence),
      bindingIds: result.bindingIds.map((bindingId) =>
        requireText(bindingId, "Analysis result binding ID", 256),
      ),
    }));
    if (
      new Set(safeResults.map(({ id }) => id)).size !== safeResults.length ||
      safeResults.some(
        (result) =>
          result.runId !== safeRunId ||
          !["event", "duplicate", "observation"].includes(result.kind) ||
          result.reviewStatus !== "pending" ||
          result.bindingIds.length < 1 ||
          result.bindingIds.length > 50_000 ||
          new Set(result.bindingIds).size !== result.bindingIds.length,
      )
    )
      throw new Error("Analysis result semantics are invalid.");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      assertPublication?.();
      const runRow = this.database
        .prepare("SELECT status,data FROM analysis_runs WHERE id=?")
        .get(safeRunId);
      if (!runRow || runRow.status !== "running")
        throw new Error(
          "Analysis results can only be published by a running operation.",
        );
      const run = JSON.parse(String(runRow.data)) as AnalysisRun;
      const inputBindings = new Set(run.inputBindingIds);
      if (
        safeResults.some((result) =>
          result.bindingIds.some((id) => !inputBindings.has(id)),
        )
      )
        throw new Error(
          "Analysis result references a binding outside its fixed input.",
        );
      if (
        this.database
          .prepare("SELECT 1 FROM analysis_results WHERE run_id=? LIMIT 1")
          .get(safeRunId)
      )
        throw new Error("Analysis results are immutable once published.");
      const insertResult = this.database.prepare(
        "INSERT INTO analysis_results(id,run_id,kind,review_status,data) VALUES(?,?,?,?,?)",
      );
      const insertMember = this.database.prepare(
        "INSERT INTO analysis_result_members(result_id,binding_id,position,data) VALUES(?,?,?,?)",
      );
      for (const result of safeResults) {
        insertResult.run(
          result.id,
          result.runId,
          result.kind,
          result.reviewStatus,
          JSON.stringify({ evidence: result.evidence }),
        );
        result.bindingIds.forEach((bindingId, position) =>
          insertMember.run(
            result.id,
            bindingId,
            position,
            JSON.stringify({ resultId: result.id, bindingId, position }),
          ),
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getAnalysisResults(runId: string): AnalysisEvidenceResult[] {
    const safeRunId = requireText(runId, "Analysis run ID", 256);
    return this.database
      .prepare(
        "SELECT id,run_id,kind,review_status,data FROM analysis_results WHERE run_id=? ORDER BY id",
      )
      .all(safeRunId)
      .map((row) => {
        const data = JSON.parse(String(row.data)) as { evidence: unknown };
        const bindingIds = this.database
          .prepare(
            "SELECT binding_id FROM analysis_result_members WHERE result_id=? ORDER BY position",
          )
          .all(String(row.id))
          .map(({ binding_id }) => String(binding_id));
        return {
          id: String(row.id),
          runId: String(row.run_id),
          kind: String(row.kind) as AnalysisEvidenceResult["kind"],
          reviewStatus: String(
            row.review_status,
          ) as AnalysisEvidenceResult["reviewStatus"],
          evidence: data.evidence,
          bindingIds,
        };
      });
  }

  saveReviewDecision(decision: ReviewDecision): ReviewDecision {
    const safeId = requireText(decision.id, "Review decision ID", 256);
    const safeRunId = requireText(
      decision.baseRunId,
      "Review base run ID",
      256,
    );
    const safeProjectId = requireText(
      decision.projectId,
      "Review project ID",
      512,
    );
    const safeManifestId = requireText(
      decision.manifestId,
      "Review manifest ID",
      256,
    );
    const safeFingerprint = requireText(
      decision.beforeFingerprint,
      "Review fingerprint",
      64,
    );
    const operationFingerprint = requireText(
      decision.operationFingerprint,
      "Review operation fingerprint",
      64,
    );
    const baseResultIds = decision.baseResultIds.map((id) =>
      requireText(id, "Review base result ID", 256),
    );
    const targetIds = decision.targetIds.map((id) =>
      requireText(id, "Review target ID", 256),
    );
    const operation = portableReviewOperation(decision.operation);
    const createdAt = requireText(
      decision.createdAt,
      "Review decision time",
      128,
    );
    if (
      decision.schemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/u.test(safeFingerprint) ||
      !/^[a-f0-9]{64}$/u.test(operationFingerprint) ||
      !Number.isFinite(Date.parse(createdAt)) ||
      !["applied", "conflicted", "superseded"].includes(decision.outcome) ||
      !baseResultIds.length ||
      baseResultIds.length > 1000 ||
      !targetIds.length ||
      targetIds.length > 1000 ||
      new Set(baseResultIds).size !== baseResultIds.length ||
      new Set(targetIds).size !== targetIds.length ||
      targetIds.some((id) => !baseResultIds.includes(id))
    )
      throw new Error("Review decision semantics are invalid.");
    const safe: ReviewDecision = {
      schemaVersion: 1,
      id: safeId,
      projectId: safeProjectId,
      baseRunId: safeRunId,
      baseResultIds: [...baseResultIds].sort(),
      targetIds: [...targetIds].sort(),
      operation: operation as ReviewDecision["operation"],
      operationFingerprint,
      beforeFingerprint: safeFingerprint,
      manifestId: safeManifestId,
      ...(decision.storyRevision === undefined
        ? {}
        : {
            storyRevision: requireText(
              decision.storyRevision,
              "Review story revision",
              64,
            ),
          }),
      ...(decision.supersedesDecisionId === undefined
        ? {}
        : {
            supersedesDecisionId: requireText(
              decision.supersedesDecisionId,
              "Superseded review decision ID",
              256,
            ),
          }),
      outcome: decision.outcome,
      createdAt,
    };
    if (
      createHash("sha256")
        .update(JSON.stringify(safe.operation))
        .digest("hex") !== safe.operationFingerprint
    )
      throw new Error(
        "Review operation fingerprint does not match its typed operation.",
      );
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare("SELECT data FROM review_decisions WHERE id=?")
        .get(safe.id);
      if (existing) {
        const prior = JSON.parse(String(existing.data)) as ReviewDecision;
        if (JSON.stringify(prior) !== JSON.stringify(safe))
          throw new Error(
            "A review decision ID cannot be reused for different content.",
          );
        this.database.exec("COMMIT");
        return prior;
      }
      const runRow = this.database
        .prepare("SELECT data FROM analysis_runs WHERE id=?")
        .get(safe.baseRunId);
      if (!runRow) throw new Error("Review base analysis run does not exist.");
      const run = JSON.parse(String(runRow.data)) as AnalysisRun;
      if (
        run.projectId !== safe.projectId ||
        run.manifestId !== safe.manifestId
      )
        throw new Error(
          "Review decision does not match its immutable project and manifest scope.",
        );
      if (
        safe.baseResultIds.length !== safe.targetIds.length ||
        safe.baseResultIds.some((id) => !safe.targetIds.includes(id))
      )
        throw new Error(
          "Review decision base and target result lineage must match exactly.",
        );
      const results = this.getAnalysisResults(safe.baseRunId);
      const actualFingerprint = fingerprintReviewResults(
        run,
        results,
        safe.targetIds,
        this.listReviewDecisions(safe.baseRunId),
      );
      const selected = results.filter((result) =>
        safe.targetIds.includes(result.id),
      );
      if (selected.length !== safe.targetIds.length)
        throw new Error(
          "Review decision references a result outside its base run.",
        );
      if (safe.supersedesDecisionId) {
        const prior = this.database
          .prepare("SELECT base_run_id FROM review_decisions WHERE id=?")
          .get(safe.supersedesDecisionId);
        if (!prior || String(prior.base_run_id) !== safe.baseRunId)
          throw new Error(
            "A superseded review decision must belong to the same base run.",
          );
      }
      const actualOperationFingerprint = createHash("sha256")
        .update(JSON.stringify(safe.operation))
        .digest("hex");
      if (
        safe.outcome === "applied" &&
        (actualFingerprint !== safe.beforeFingerprint ||
          actualOperationFingerprint !== safe.operationFingerprint ||
          selected.some(
            (result) =>
              result.reviewStatus !== "pending" &&
              !(
                safe.operation.kind === "adopt-story" &&
                result.reviewStatus === "accepted"
              ),
          ))
      )
        throw new Error(
          "Review preconditions changed; submit a conflicted decision instead.",
        );
      if (safe.outcome === "applied") {
        const status =
          safe.operation.kind === "reject-results" ? "rejected" : "accepted";
        const update = this.database.prepare(
          safe.operation.kind === "adopt-story"
            ? "UPDATE analysis_results SET review_status=? WHERE id=? AND run_id=? AND review_status IN ('pending','accepted')"
            : "UPDATE analysis_results SET review_status=? WHERE id=? AND run_id=? AND review_status='pending'",
        );
        for (const id of safe.targetIds) {
          const result = update.run(status, id, safe.baseRunId);
          if (result.changes !== 1)
            throw new Error(
              "Review target status changed during decision commit.",
            );
        }
      }
      this.database
        .prepare(
          "INSERT INTO review_decisions(id,base_run_id,before_fingerprint,outcome,created_at,data) VALUES(?,?,?,?,?,?)",
        )
        .run(
          safe.id,
          safe.baseRunId,
          safe.beforeFingerprint,
          safe.outcome,
          safe.createdAt,
          JSON.stringify(safe),
        );
      this.database.exec("COMMIT");
      return safe;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getReviewDecision(id: string): ReviewDecision | undefined {
    const safeId = requireText(id, "Review decision ID", 256);
    const row = this.database
      .prepare("SELECT data FROM review_decisions WHERE id=?")
      .get(safeId);
    return row
      ? structuredClone(JSON.parse(String(row.data)) as ReviewDecision)
      : undefined;
  }

  listReviewDecisions(runId: string): ReviewDecision[] {
    const safeRunId = requireText(runId, "Review base run ID", 256);
    return this.database
      .prepare(
        "SELECT data FROM review_decisions WHERE base_run_id=? ORDER BY created_at,id",
      )
      .all(safeRunId)
      .map(({ data }) => JSON.parse(String(data)) as ReviewDecision);
  }

  private validateAnalysisRun(run: AnalysisRun): AnalysisRun {
    const safe: AnalysisRun = {
      id: requireText(run.id, "Analysis run ID", 256),
      projectId: requireText(run.projectId, "Analysis project ID", 512),
      manifestId: requireText(run.manifestId, "Analysis manifest ID", 256),
      scopeMode: run.scopeMode,
      algorithmVersion: requireText(
        run.algorithmVersion,
        "Analysis algorithm version",
        128,
      ),
      taxonomyVersion: requireText(
        run.taxonomyVersion,
        "Analysis taxonomy version",
        128,
      ),
      configHash: requireText(run.configHash, "Analysis config hash", 64),
      inputFingerprint: requireText(
        run.inputFingerprint,
        "Analysis input fingerprint",
        64,
      ),
      inputBindingIds: run.inputBindingIds.map((bindingId) =>
        requireText(bindingId, "Analysis input binding ID", 256),
      ),
      ...(run.travelContext === undefined
        ? {}
        : { travelContext: validateTravelContext(run.travelContext) }),
      ...(run.visualSampling === undefined
        ? {}
        : { visualSampling: validateVisualSampling(run.visualSampling) }),
      ...(run.projectCatalogRevision === undefined
        ? {}
        : {
            projectCatalogRevision: requireText(
              run.projectCatalogRevision,
              "Project catalog revision",
              64,
            ),
          }),
      status: run.status,
      createdAt: requireText(run.createdAt, "Analysis run creation time", 128),
    };
    if (
      !["selected-sources", "project-catalog"].includes(safe.scopeMode) ||
      ![
        "queued",
        "running",
        "completed",
        "partial",
        "failed",
        "cancelled",
      ].includes(safe.status) ||
      !/^[a-f0-9]{64}$/u.test(safe.configHash) ||
      !/^[a-f0-9]{64}$/u.test(safe.inputFingerprint) ||
      (safe.projectCatalogRevision !== undefined &&
        !/^[a-f0-9]{64}$/u.test(safe.projectCatalogRevision)) ||
      !Number.isFinite(Date.parse(safe.createdAt)) ||
      !safe.inputBindingIds.length ||
      safe.inputBindingIds.length > 50_000 ||
      new Set(safe.inputBindingIds).size !== safe.inputBindingIds.length
    )
      throw new Error("Analysis run semantics are invalid.");
    return safe;
  }

  private validateAnalysisEvidence(value: unknown): Record<string, unknown> {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      throw new Error("Analysis evidence must be a plain object.");
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 100)
      throw new Error("Analysis evidence exceeds its field limit.");
    const safe = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    if (JSON.stringify(safe).length > 64 * 1024)
      throw new Error("Analysis evidence exceeds its size limit.");
    return safe;
  }
}

/**
 * Every durable table is classified explicitly. Tests compare this registry to
 * sqlite_master so a future migration cannot accidentally leak local state.
 */
export const CATALOG_TABLE_POLICIES: Readonly<
  Record<string, CatalogTablePolicy>
> = Object.freeze({
  assets: "portable-semantic",
  intelligence_transcripts: "portable-semantic",
  intelligence_segments: "portable-semantic",
  transcript_revision_metadata: "portable-semantic",
  transcript_editor_history: "portable-semantic",
  transcript_edit_requests: "portable-semantic",
  source_selections: "portable-semantic",
  file_occurrences: "portable-semantic",
  selection_memberships: "portable-semantic",
  content_identities: "portable-semantic",
  asset_content_versions: "portable-semantic",
  import_batches: "portable-semantic",
  expected_manifests: "portable-semantic",
  expected_manifest_entries: "portable-semantic",
  verified_manifests: "portable-semantic",
  verified_manifest_entries: "portable-semantic",
  analysis_runs: "portable-semantic",
  analysis_results: "portable-semantic",
  analysis_result_members: "portable-semantic",
  review_decisions: "portable-semantic",
  jobs: "local-operational",
  project_glossary: "local-operational",
  review_suggestions: "local-operational",
  review_batches: "local-operational",
  scene_script_suggestions: "local-operational",
  intelligence_cache: "cache",
  intelligence_markers: "cache",
});

/** Called inside the catalog migration transaction. */
export function migrateMultiSourceSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE source_selections (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
      display_name TEXT NOT NULL,
      logical_root TEXT NOT NULL,
      recursive INTEGER NOT NULL CHECK (recursive IN (0, 1)),
      selection_revision INTEGER NOT NULL CHECK (selection_revision >= 0),
      data TEXT NOT NULL
    );
    CREATE TABLE file_occurrences (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      file_kind TEXT NOT NULL CHECK (
        file_kind IN ('image', 'video', 'audio', 'track', 'unsupported')
      ),
      byte_length INTEGER CHECK (byte_length IS NULL OR byte_length >= 0),
      modified_at TEXT,
      availability TEXT NOT NULL CHECK (
        availability IN (
          'available', 'needs-reselection', 'missing', 'unreadable', 'staged'
        )
      ),
      scan_revision INTEGER NOT NULL CHECK (scan_revision >= 0),
      data TEXT NOT NULL
    );
    CREATE TABLE selection_memberships (
      selection_id TEXT NOT NULL REFERENCES source_selections(id) ON DELETE CASCADE,
      occurrence_id TEXT NOT NULL REFERENCES file_occurrences(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      included INTEGER NOT NULL CHECK (included IN (0, 1)),
      data TEXT NOT NULL,
      PRIMARY KEY (selection_id, occurrence_id)
    );
    CREATE INDEX selection_memberships_occurrence
      ON selection_memberships(occurrence_id, selection_id);
    CREATE TABLE content_identities (
      id TEXT PRIMARY KEY,
      hash_algorithm TEXT NOT NULL CHECK (hash_algorithm = 'sha256'),
      full_hash TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
      media_kind TEXT NOT NULL CHECK (
        media_kind IN ('image', 'video', 'audio', 'track')
      ),
      data TEXT NOT NULL,
      UNIQUE (hash_algorithm, full_hash, byte_length)
    );
    CREATE TABLE asset_content_versions (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      occurrence_id TEXT NOT NULL REFERENCES file_occurrences(id) ON DELETE RESTRICT,
      content_id TEXT NOT NULL REFERENCES content_identities(id) ON DELETE RESTRICT,
      context_revision TEXT NOT NULL,
      descriptor_snapshot_id TEXT NOT NULL,
      data TEXT NOT NULL,
      UNIQUE (asset_id, occurrence_id, content_id, context_revision)
    );
    CREATE INDEX asset_content_versions_asset
      ON asset_content_versions(asset_id, id);
    CREATE TABLE import_batches (
      id TEXT PRIMARY KEY,
      draft_revision INTEGER NOT NULL CHECK (draft_revision >= 0),
      scope_mode TEXT NOT NULL CHECK (
        scope_mode IN ('selected-sources', 'project-catalog')
      ),
      status TEXT NOT NULL CHECK (
        status IN ('sealing', 'sealed', 'partial', 'failed', 'cancelled')
      ),
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE expected_manifests (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL UNIQUE REFERENCES import_batches(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL CHECK (revision >= 0),
      selection_hash TEXT NOT NULL,
      partial_policy TEXT NOT NULL CHECK (
        partial_policy IN ('require-all', 'allow-readable')
      ),
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE expected_manifest_entries (
      manifest_id TEXT NOT NULL REFERENCES expected_manifests(id) ON DELETE CASCADE,
      occurrence_id TEXT NOT NULL REFERENCES file_occurrences(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK (position >= 0),
      included INTEGER NOT NULL CHECK (included IN (0, 1)),
      data TEXT NOT NULL,
      PRIMARY KEY (manifest_id, position),
      UNIQUE (manifest_id, occurrence_id)
    );
    CREATE TABLE verified_manifests (
      id TEXT PRIMARY KEY,
      expected_manifest_id TEXT NOT NULL UNIQUE REFERENCES expected_manifests(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE verified_manifest_entries (
      manifest_id TEXT NOT NULL REFERENCES verified_manifests(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0),
      occurrence_id TEXT NOT NULL REFERENCES file_occurrences(id) ON DELETE RESTRICT,
      binding_id TEXT REFERENCES asset_content_versions(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK (status IN ('verified', 'failed', 'excluded')),
      data TEXT NOT NULL,
      PRIMARY KEY (manifest_id, position),
      UNIQUE (manifest_id, occurrence_id),
      CHECK ((status = 'verified') = (binding_id IS NOT NULL))
    );
    CREATE TABLE analysis_runs (
      id TEXT PRIMARY KEY,
      manifest_id TEXT NOT NULL REFERENCES verified_manifests(id) ON DELETE RESTRICT,
      scope_mode TEXT NOT NULL CHECK (
        scope_mode IN ('selected-sources', 'project-catalog')
      ),
      algorithm_version TEXT NOT NULL,
      taxonomy_version TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')
      ),
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE analysis_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      review_status TEXT NOT NULL CHECK (
        review_status IN ('pending', 'accepted', 'rejected', 'superseded')
      ),
      data TEXT NOT NULL
    );
    CREATE INDEX analysis_results_run ON analysis_results(run_id, id);
    CREATE TABLE analysis_result_members (
      result_id TEXT NOT NULL REFERENCES analysis_results(id) ON DELETE CASCADE,
      binding_id TEXT NOT NULL REFERENCES asset_content_versions(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK (position >= 0),
      data TEXT NOT NULL,
      PRIMARY KEY (result_id, position),
      UNIQUE (result_id, binding_id)
    );
    CREATE TABLE review_decisions (
      id TEXT PRIMARY KEY,
      base_run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE RESTRICT,
      before_fingerprint TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (
        outcome IN ('applied', 'conflicted', 'superseded')
      ),
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX review_decisions_run ON review_decisions(base_run_id, id);
  `);
}

export function validateMultiSourceSchema(database: DatabaseSync): void {
  for (const [table, columns] of [
    [
      "source_selections",
      "id,kind,display_name,logical_root,recursive,selection_revision,data",
    ],
    [
      "file_occurrences",
      "id,display_name,relative_path,file_kind,byte_length,modified_at,availability,scan_revision,data",
    ],
    [
      "selection_memberships",
      "selection_id,occurrence_id,relative_path,included,data",
    ],
    [
      "content_identities",
      "id,hash_algorithm,full_hash,byte_length,media_kind,data",
    ],
    [
      "asset_content_versions",
      "id,asset_id,occurrence_id,content_id,context_revision,descriptor_snapshot_id,data",
    ],
    ["import_batches", "id,draft_revision,scope_mode,status,created_at,data"],
    [
      "expected_manifests",
      "id,batch_id,revision,selection_hash,partial_policy,created_at,data",
    ],
    [
      "expected_manifest_entries",
      "manifest_id,occurrence_id,position,included,data",
    ],
    ["verified_manifests", "id,expected_manifest_id,created_at,data"],
    [
      "verified_manifest_entries",
      "manifest_id,position,occurrence_id,binding_id,status,data",
    ],
    [
      "analysis_runs",
      "id,manifest_id,scope_mode,algorithm_version,taxonomy_version,config_hash,status,created_at,data",
    ],
    ["analysis_results", "id,run_id,kind,review_status,data"],
    ["analysis_result_members", "result_id,binding_id,position,data"],
    [
      "review_decisions",
      "id,base_run_id,before_fingerprint,outcome,created_at,data",
    ],
  ] as const)
    database.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`);
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const point = character.codePointAt(0)!;
    return point < 32 || point === 127;
  });
}

function withoutControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const point = character.codePointAt(0)!;
      return point >= 32 && point !== 127;
    })
    .join("");
}

function portableRelativePath(value: unknown, fallback: unknown): string {
  const candidate = String(value ?? "").replaceAll("\\", "/");
  const locator =
    candidate.startsWith("/") ||
    candidate.startsWith("~") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(candidate) ||
    candidate.includes("://");
  const parts = candidate
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");
  if (
    !locator &&
    parts.length &&
    !candidate.split("/").includes("..") &&
    !parts.some(hasControlCharacters)
  )
    return parts.join("/");
  const fallbackName = String(fallback ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .at(-1);
  const safeFallback = withoutControlCharacters(fallbackName ?? "").trim();
  return safeFallback && safeFallback !== "." && safeFallback !== ".."
    ? safeFallback
    : "source";
}

function portableData(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

/** Rebuild semantic travel fields before validating legacy/untrusted catalog JSON. */
function portableTravelContext(value: unknown) {
  const pick = (
    value: unknown,
    fields: readonly string[],
  ): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Portable travel context must contain typed objects.");
    const raw = value as Record<string, unknown>;
    return Object.fromEntries(
      fields
        .filter((key) => raw[key] !== undefined)
        .map((key) => [key, raw[key]]),
    );
  };
  const list = (
    value: unknown,
    maximum: number,
    project: (item: unknown) => unknown,
  ): unknown[] => {
    if (!Array.isArray(value) || value.length > maximum)
      throw new Error("Portable travel collection bounds are invalid.");
    return value.map(project);
  };
  const context = pick(value, [
    "version",
    "algorithmVersion",
    "tracks",
    "clockMappings",
    "assignments",
  ]);
  context.tracks = list(
    context.tracks,
    TRAVEL_CONTEXT_LIMITS.tracks,
    (value) => {
      const track = pick(value, ["id", "contentHash", "segments"]);
      track.segments = list(
        track.segments,
        TRAVEL_CONTEXT_LIMITS.segments,
        (value) => {
          const segment = pick(value, ["index", "points"]);
          segment.points = list(
            segment.points,
            TRAVEL_CONTEXT_LIMITS.points,
            (value) =>
              pick(value, ["latitude", "longitude", "time", "elevationMeters"]),
          );
          return segment;
        },
      );
      return track;
    },
  );
  context.clockMappings = list(
    context.clockMappings,
    TRAVEL_CONTEXT_LIMITS.mappings,
    (value) =>
      pick(value, [
        "id",
        "assetIds",
        "offsetMilliseconds",
        "timeZone",
        "source",
      ]),
  );
  context.assignments = list(
    context.assignments,
    TRAVEL_CONTEXT_LIMITS.assignments,
    (value) => pick(value, ["trackId", "assetIds"]),
  );
  return validateTravelContext(context);
}

function requiredSqlValue(
  value: unknown,
): string | number | bigint | Uint8Array | null {
  if (value === undefined)
    throw new Error("Portable multi-source row is missing a required value.");
  return value as string | number | bigint | Uint8Array | null;
}

function portableObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new Error(`Portable ${label} data is not valid JSON.`);
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(parsed))
  )
    throw new Error(`Portable ${label} data must be an object.`);
  return parsed as Record<string, unknown>;
}

function optionalPortableText(
  data: Record<string, unknown>,
  key: string,
  maximum = 16_384,
): string | undefined {
  const value = data[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !value ||
    [...value].length > maximum ||
    hasControlCharacters(value)
  )
    throw new Error(`Portable semantic field ${key} is invalid.`);
  return value;
}

function optionalPortableStringArray(
  data: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = data[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50_000)
    throw new Error(`Portable semantic field ${key} is invalid.`);
  return value.map((item) => {
    if (
      typeof item !== "string" ||
      !item ||
      item.length > 16_384 ||
      hasControlCharacters(item)
    )
      throw new Error(`Portable semantic field ${key} is invalid.`);
    return item;
  });
}

function optionalPortableNumber(
  data: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = data[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`Portable semantic field ${key} is invalid.`);
  return value;
}

/**
 * Analysis evidence is intentionally a closed portable vocabulary. Later
 * milestones must add new semantic fields here together with their typed
 * contract and redaction regression instead of copying plugin-shaped JSON.
 */
const PORTABLE_EVIDENCE_CONTAINERS = new Set([
  "cameraLocation",
  "context",
  "coordinates",
  "dependencies",
  "evidence",
  "members",
  "matchedPoint",
  "observations",
  "payload",
  "range",
  "ranges",
  "sourceRange",
  "sourceRanges",
  "suggestions",
  "timeRange",
  "sourceTimeRange",
  "providerReceipt",
  "suggestedLabels",
]);
const PORTABLE_EVIDENCE_IDENTIFIER_ARRAYS = new Set(["assetIds", "labels"]);
const PORTABLE_EVIDENCE_TEXT = new Set([
  "kind",
  "type",
  "matchKind",
  "startAt",
  "endAt",
]);
PORTABLE_EVIDENCE_TEXT.add("algorithmVersion");
PORTABLE_EVIDENCE_TEXT.add("classification");
PORTABLE_EVIDENCE_TEXT.add("reason");
PORTABLE_EVIDENCE_TEXT.add("originalCapturedAt");
PORTABLE_EVIDENCE_TEXT.add("adjustedCapturedAt");
PORTABLE_EVIDENCE_TEXT.add("clockMappingId");
PORTABLE_EVIDENCE_TEXT.add("timeZone");
PORTABLE_EVIDENCE_TEXT.add("trackId");
PORTABLE_EVIDENCE_TEXT.add("trackContentHash");
PORTABLE_EVIDENCE_TEXT.add("time");
PORTABLE_EVIDENCE_TEXT.add("assetId");
for (const field of [
  "sampleId",
  "sampleFingerprint",
  "sourceHash",
  "frameHash",
  "providerId",
  "execution",
  "invokedAt",
  "consentGrantedAt",
  "status",
  "label",
])
  PORTABLE_EVIDENCE_TEXT.add(field);
const PORTABLE_EVIDENCE_NUMBERS = new Set([
  "confidence",
  "distance",
  "distanceMeters",
  "duration",
  "elevation",
  "end",
  "gap",
  "height",
  "index",
  "latitude",
  "longitude",
  "position",
  "radiusKm",
  "score",
  "speedMetersPerSecond",
  "start",
  "uncertainty",
  "width",
  "confidence",
]);
const PORTABLE_EVIDENCE_BOOLEANS = new Set([
  "ambiguous",
  "manualReview",
  "needsReview",
  "timezoneUncertain",
  "manualReviewRequired",
]);

function portableEvidenceNumber(field: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`Portable analysis evidence ${field} is invalid.`);
  if (
    ((field === "confidence" || field === "score") &&
      (value < 0 || value > 1)) ||
    (field === "latitude" && (value < -90 || value > 90)) ||
    (field === "longitude" && (value < -180 || value > 180)) ||
    ([
      "distance",
      "distanceMeters",
      "duration",
      "end",
      "gap",
      "height",
      "index",
      "position",
      "start",
      "uncertainty",
      "width",
      "speedMetersPerSecond",
    ].includes(field) &&
      value < 0)
  )
    throw new Error(`Portable analysis evidence ${field} is out of range.`);
  return value;
}

function sanitizePortableEvidence(
  value: unknown,
  depth = 0,
): unknown | undefined {
  if (depth > 16)
    throw new Error("Portable analysis evidence is nested too deeply.");
  if (value === null || typeof value === "string") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(
        "Portable analysis evidence contains a nonfinite number.",
      );
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 50_000)
      throw new Error("Portable analysis evidence is too large.");
    return value
      .map((item) => sanitizePortableEvidence(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (
    value === undefined ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error("Portable analysis evidence contains an invalid value.");
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  const entries = Object.entries(value);
  if (entries.length > 50_000)
    throw new Error("Portable analysis evidence is too large.");
  for (const [field, item] of entries) {
    if (
      field.length > 512 ||
      hasControlCharacters(field) ||
      field === "__proto__" ||
      field === "constructor" ||
      field === "prototype"
    )
      continue;
    if (PORTABLE_EVIDENCE_NUMBERS.has(field)) {
      result[field] = portableEvidenceNumber(field, item);
      continue;
    }
    if (PORTABLE_EVIDENCE_IDENTIFIER_ARRAYS.has(field)) {
      const value = optionalPortableStringArray({ [field]: item }, field);
      if (value) result[field] = value;
      continue;
    }
    if (PORTABLE_EVIDENCE_TEXT.has(field)) {
      const value = optionalPortableText({ [field]: item }, field, 512);
      if (
        value &&
        ((field !== "startAt" &&
          field !== "endAt" &&
          field !== "originalCapturedAt" &&
          field !== "adjustedCapturedAt" &&
          field !== "time") ||
          Number.isFinite(Date.parse(value)))
      )
        result[field] = value;
      continue;
    }
    if (PORTABLE_EVIDENCE_BOOLEANS.has(field)) {
      if (typeof item !== "boolean")
        throw new Error(`Portable analysis evidence ${field} is invalid.`);
      result[field] = item;
      continue;
    }
    if (PORTABLE_EVIDENCE_CONTAINERS.has(field)) {
      if (item === null || typeof item !== "object")
        throw new Error(`Portable analysis evidence ${field} is invalid.`);
      const sanitized = sanitizePortableEvidence(item, depth + 1);
      if (sanitized !== undefined) result[field] = sanitized;
    }
  }
  return result;
}

function portableReviewOperation(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Portable review operation is invalid.");
  const operation = value as Record<string, unknown>;
  const kind = optionalPortableText(operation, "kind", 128);
  if (kind === "merge-results" || kind === "reject-results")
    return {
      kind,
      resultIds: optionalPortableStringArray(operation, "resultIds") ?? [],
    };
  if (kind === "split-result") {
    const resultId = optionalPortableText(operation, "resultId");
    if (!resultId || !Array.isArray(operation.ranges))
      throw new Error("Portable split review operation is invalid.");
    return {
      kind,
      resultId,
      ranges: operation.ranges.map((range) => {
        if (range === null || typeof range !== "object" || Array.isArray(range))
          throw new Error("Portable split review range is invalid.");
        const data = range as Record<string, unknown>;
        const assetId = optionalPortableText(data, "assetId");
        const start = optionalPortableNumber(data, "start");
        const end = optionalPortableNumber(data, "end");
        if (!assetId || start === undefined || end === undefined || end < start)
          throw new Error("Portable split review range is invalid.");
        return { assetId, start, end };
      }),
    };
  }
  if (kind === "set-observation") {
    const resultId = optionalPortableText(operation, "resultId");
    const axis = optionalPortableText(operation, "axis");
    const observation = optionalPortableText(operation, "value");
    if (!resultId || !axis || !observation)
      throw new Error("Portable observation review operation is invalid.");
    return { kind, resultId, axis, value: observation };
  }
  if (kind === "adopt-story") {
    const storyId = optionalPortableText(operation, "storyId");
    if (!storyId)
      throw new Error("Portable story review operation is invalid.");
    return {
      kind,
      storyId,
      resultIds: optionalPortableStringArray(operation, "resultIds") ?? [],
    };
  }
  throw new Error("Portable review operation kind is invalid.");
}

/**
 * Rebuild every retained multi-source JSON payload from typed columns before a
 * Collect Media catalog is published. Closed domain records keep only validated
 * contract fields. Extensible analysis evidence is recursively validated while
 * operational locators and secrets are removed at every depth.
 */
export function sanitizePortableMultiSourceRows(database: DatabaseSync): void {
  const sourceUpdate = database.prepare(
    "UPDATE source_selections SET logical_root=?,data=? WHERE id=?",
  );
  for (const row of database
    .prepare(
      "SELECT id,kind,display_name,recursive,selection_revision,data FROM source_selections",
    )
    .all()) {
    const logicalRootId = `source:${String(row.id)}`;
    const original = portableObject(row.data, "source selection");
    const projectId = optionalPortableText(original, "projectId");
    if (!projectId)
      throw new Error("Portable source selection projectId is required.");
    sourceUpdate.run(
      logicalRootId,
      portableData({
        id: row.id,
        projectId,
        kind: row.kind,
        displayName: row.display_name,
        logicalRootId,
        recursive: Boolean(row.recursive),
        selectionRevision: row.selection_revision,
      }),
      requiredSqlValue(row.id),
    );
  }

  const occurrenceUpdate = database.prepare(
    "UPDATE file_occurrences SET relative_path=?,data=? WHERE id=?",
  );
  for (const row of database
    .prepare(
      "SELECT id,display_name,relative_path,file_kind,byte_length,modified_at,availability,scan_revision,data FROM file_occurrences",
    )
    .all()) {
    const original = portableObject(row.data, "file occurrence");
    const logicalRootId = optionalPortableText(original, "logicalRootId");
    if (!logicalRootId)
      throw new Error("Portable file occurrence logicalRootId is required.");
    const relativePath = portableRelativePath(
      row.relative_path,
      row.display_name,
    );
    occurrenceUpdate.run(
      relativePath,
      portableData({
        id: row.id,
        logicalRootId,
        displayName: row.display_name,
        relativePath,
        fileKind: row.file_kind,
        ...(row.byte_length === null ? {} : { byteLength: row.byte_length }),
        ...(row.modified_at === null ? {} : { modifiedAt: row.modified_at }),
        availability: row.availability,
        scanRevision: row.scan_revision,
      }),
      requiredSqlValue(row.id),
    );
  }

  const membershipUpdate = database.prepare(
    "UPDATE selection_memberships SET relative_path=?,data=? WHERE selection_id=? AND occurrence_id=?",
  );
  for (const row of database
    .prepare(
      `SELECT membership.selection_id,membership.occurrence_id,
        membership.relative_path,membership.included,membership.data,
        occurrence.display_name
       FROM selection_memberships AS membership
       JOIN file_occurrences AS occurrence ON occurrence.id=membership.occurrence_id`,
    )
    .all()) {
    const relativePath = portableRelativePath(
      row.relative_path,
      row.display_name,
    );
    const original = portableObject(row.data, "selection membership");
    const scanRevision = optionalPortableNumber(original, "scanRevision");
    membershipUpdate.run(
      relativePath,
      portableData({
        selectionId: row.selection_id,
        occurrenceId: row.occurrence_id,
        relativePath,
        included: Boolean(row.included),
        ...(scanRevision === undefined ? {} : { scanRevision }),
      }),
      requiredSqlValue(row.selection_id),
      requiredSqlValue(row.occurrence_id),
    );
  }

  interface PortableTableSpecification {
    table: string;
    keys: readonly string[];
    columns: readonly (readonly [string, string])[];
    booleans?: readonly string[];
    preserve?: (
      original: Record<string, unknown>,
      row: Record<string, unknown>,
    ) => Record<string, unknown>;
  }
  const specifications: PortableTableSpecification[] = [
    {
      table: "content_identities",
      keys: ["id"],
      columns: [
        ["id", "id"],
        ["hash_algorithm", "hashAlgorithm"],
        ["full_hash", "fullHash"],
        ["byte_length", "byteLength"],
        ["media_kind", "mediaKind"],
      ],
    },
    {
      table: "asset_content_versions",
      keys: ["id"],
      columns: [
        ["id", "id"],
        ["asset_id", "assetId"],
        ["occurrence_id", "occurrenceId"],
        ["content_id", "contentId"],
        ["context_revision", "contextRevision"],
        ["descriptor_snapshot_id", "descriptorSnapshotId"],
      ],
    },
    {
      table: "import_batches",
      keys: ["id"],
      columns: [
        ["id", "id"],
        ["draft_revision", "draftRevision"],
        ["scope_mode", "scopeMode"],
        ["status", "status"],
        ["created_at", "createdAt"],
      ],
      preserve: (original) => {
        const projectId = optionalPortableText(original, "projectId");
        const expectedManifestId = optionalPortableText(
          original,
          "expectedManifestId",
        );
        if (!projectId || !expectedManifestId)
          throw new Error("Portable import batch semantics are incomplete.");
        return {
          projectId,
          expectedManifestId,
        };
      },
    },
    {
      table: "expected_manifests",
      keys: ["id"],
      columns: [
        ["id", "id"],
        ["batch_id", "batchId"],
        ["revision", "revision"],
        ["selection_hash", "selectionHash"],
        ["partial_policy", "partialPolicy"],
        ["created_at", "createdAt"],
      ],
    },
    {
      table: "expected_manifest_entries",
      keys: ["manifest_id", "position"],
      columns: [
        ["manifest_id", "manifestId"],
        ["occurrence_id", "occurrenceId"],
        ["position", "position"],
        ["included", "included"],
      ],
      booleans: ["included"],
      preserve: (original, row) => {
        const expectedByteLength = optionalPortableNumber(
          original,
          "expectedByteLength",
        );
        const expectedModifiedAt = optionalPortableText(
          original,
          "expectedModifiedAt",
        );
        return {
          relativePath: portableRelativePath(
            original.relativePath,
            row.occurrence_id,
          ),
          ...(expectedByteLength === undefined ? {} : { expectedByteLength }),
          ...(expectedModifiedAt === undefined ? {} : { expectedModifiedAt }),
        };
      },
    },
    {
      table: "verified_manifests",
      keys: ["id"],
      columns: [
        ["id", "id"],
        ["expected_manifest_id", "expectedManifestId"],
        ["created_at", "createdAt"],
      ],
    },
    {
      table: "verified_manifest_entries",
      keys: ["manifest_id", "position"],
      columns: [
        ["manifest_id", "manifestId"],
        ["position", "position"],
        ["occurrence_id", "occurrenceId"],
        ["binding_id", "bindingId"],
        ["status", "status"],
      ],
      preserve: (original) => {
        const data: Record<string, unknown> = {};
        for (const field of [
          "assetId",
          "contentHash",
          "contextRevision",
          "code",
        ]) {
          const value = optionalPortableText(original, field);
          if (value !== undefined) data[field] = value;
        }
        return data;
      },
    },
    {
      table: "analysis_runs",
      keys: ["id"],
      columns: [
        ["id", "id"],
        ["manifest_id", "manifestId"],
        ["scope_mode", "scopeMode"],
        ["algorithm_version", "algorithmVersion"],
        ["taxonomy_version", "taxonomyVersion"],
        ["config_hash", "configHash"],
        ["status", "status"],
        ["created_at", "createdAt"],
      ],
      preserve: (original) => {
        const projectId = optionalPortableText(original, "projectId");
        if (!projectId)
          throw new Error("Portable analysis run projectId is required.");
        const inputFingerprint = optionalPortableText(
          original,
          "inputFingerprint",
          64,
        );
        const inputBindingIds = optionalPortableStringArray(
          original,
          "inputBindingIds",
        );
        const projectCatalogRevision = optionalPortableText(
          original,
          "projectCatalogRevision",
          64,
        );
        if (inputFingerprint && !/^[a-f0-9]{64}$/u.test(inputFingerprint))
          throw new Error("Portable analysis input fingerprint is invalid.");
        if (
          projectCatalogRevision &&
          !/^[a-f0-9]{64}$/u.test(projectCatalogRevision)
        )
          throw new Error("Portable project catalog revision is invalid.");
        const travelContext =
          original.travelContext === undefined
            ? undefined
            : portableTravelContext(original.travelContext);
        const visualSampling =
          original.visualSampling === undefined
            ? undefined
            : validateVisualSampling(original.visualSampling);
        return {
          projectId,
          ...(inputFingerprint ? { inputFingerprint } : {}),
          ...(inputBindingIds ? { inputBindingIds } : {}),
          ...(projectCatalogRevision ? { projectCatalogRevision } : {}),
          ...(travelContext ? { travelContext } : {}),
          ...(visualSampling ? { visualSampling } : {}),
        };
      },
    },
    {
      table: "analysis_results",
      keys: ["id"],
      columns: [
        ["id", "id"],
        ["run_id", "runId"],
        ["kind", "kind"],
        ["review_status", "reviewStatus"],
      ],
      preserve: (original) =>
        sanitizePortableEvidence(original) as Record<string, unknown>,
    },
    {
      table: "analysis_result_members",
      keys: ["result_id", "position"],
      columns: [
        ["result_id", "resultId"],
        ["binding_id", "bindingId"],
        ["position", "position"],
      ],
      preserve: (original) =>
        sanitizePortableEvidence(original) as Record<string, unknown>,
    },
    {
      table: "review_decisions",
      keys: ["id"],
      columns: [
        ["id", "id"],
        ["base_run_id", "baseRunId"],
        ["before_fingerprint", "beforeFingerprint"],
        ["outcome", "outcome"],
        ["created_at", "createdAt"],
      ],
      preserve: (original) => {
        const result: Record<string, unknown> = {};
        if (original.schemaVersion !== 1)
          throw new Error("Portable review decision version is invalid.");
        result.schemaVersion = 1;
        const projectId = optionalPortableText(original, "projectId");
        const manifestId = optionalPortableText(original, "manifestId");
        const baseResultIds = optionalPortableStringArray(
          original,
          "baseResultIds",
        );
        const targetIds = optionalPortableStringArray(original, "targetIds");
        if (
          !projectId ||
          !manifestId ||
          !baseResultIds ||
          !targetIds ||
          original.operation === undefined
        )
          throw new Error("Portable review decision semantics are incomplete.");
        result.projectId = projectId;
        result.manifestId = manifestId;
        result.baseResultIds = baseResultIds;
        result.targetIds = targetIds;
        result.operation = portableReviewOperation(original.operation);
        for (const field of [
          "operationFingerprint",
          "storyRevision",
          "supersedesDecisionId",
        ]) {
          const value = optionalPortableText(original, field);
          if (value !== undefined) result[field] = value;
        }
        if (
          typeof result.operationFingerprint !== "string" ||
          !/^[a-f0-9]{64}$/u.test(result.operationFingerprint)
        )
          throw new Error("Portable review operation fingerprint is invalid.");
        if (
          createHash("sha256")
            .update(JSON.stringify(result.operation))
            .digest("hex") !== result.operationFingerprint
        )
          throw new Error(
            "Portable review operation fingerprint does not match its typed operation.",
          );
        return result;
      },
    },
  ];
  for (const specification of specifications) {
    const selected = specification.columns.map(([column]) => column);
    const rows = database
      .prepare(`SELECT ${selected.join(",")},data FROM ${specification.table}`)
      .all();
    const where = specification.keys.map((key) => `${key}=?`).join(" AND ");
    const update = database.prepare(
      `UPDATE ${specification.table} SET data=? WHERE ${where}`,
    );
    const booleanColumns = new Set<string>(specification.booleans ?? []);
    for (const row of rows) {
      const original = portableObject(row.data, specification.table);
      const data: Record<string, unknown> =
        specification.preserve?.(original, row) ?? {};
      for (const [column, field] of specification.columns) {
        const value = row[column];
        if (value === null) continue;
        data[field] = booleanColumns.has(column) ? Boolean(value) : value;
      }
      update.run(
        portableData(data),
        ...specification.keys.map((key) => requiredSqlValue(row[key])),
      );
    }
  }

  const expectedEntries = database.prepare(
    "SELECT data FROM expected_manifest_entries WHERE manifest_id=? ORDER BY position",
  );
  const expectedUpdate = database.prepare(
    "UPDATE expected_manifests SET data=? WHERE id=?",
  );
  for (const row of database
    .prepare("SELECT id,data FROM expected_manifests")
    .all()) {
    const manifest = portableObject(row.data, "expected manifest");
    const entries = expectedEntries
      .all(requiredSqlValue(row.id))
      .map((entry) => {
        const data = portableObject(entry.data, "expected manifest entry");
        const {
          manifestId: _manifestId,
          position: _position,
          ...semantic
        } = data;
        return semantic;
      });
    expectedUpdate.run(
      portableData({ ...manifest, entries }),
      requiredSqlValue(row.id),
    );
  }

  const verifiedEntries = database.prepare(`
    SELECT entry.status,entry.occurrence_id,entry.binding_id,entry.data,
      binding.asset_id,binding.context_revision,identity.full_hash
    FROM verified_manifest_entries AS entry
    LEFT JOIN asset_content_versions AS binding ON binding.id=entry.binding_id
    LEFT JOIN content_identities AS identity ON identity.id=binding.content_id
    WHERE entry.manifest_id=? ORDER BY entry.position
  `);
  const verifiedUpdate = database.prepare(
    "UPDATE verified_manifests SET data=? WHERE id=?",
  );
  for (const row of database
    .prepare("SELECT id,data FROM verified_manifests")
    .all()) {
    const manifest = portableObject(row.data, "verified manifest");
    const members: Record<string, unknown>[] = [];
    const failures: Record<string, unknown>[] = [];
    const excludedOccurrenceIds: string[] = [];
    for (const entry of verifiedEntries.all(requiredSqlValue(row.id))) {
      const data = portableObject(entry.data, "verified manifest entry");
      if (entry.status === "verified")
        members.push({
          bindingId: entry.binding_id,
          assetId: entry.asset_id ?? data.assetId,
          contentHash: entry.full_hash ?? data.contentHash,
          contextRevision: entry.context_revision ?? data.contextRevision,
        });
      else if (entry.status === "failed")
        failures.push({
          occurrenceId: entry.occurrence_id,
          code: data.code ?? "unknown",
        });
      else if (entry.status === "excluded")
        excludedOccurrenceIds.push(String(entry.occurrence_id));
    }
    verifiedUpdate.run(
      portableData({
        ...manifest,
        members,
        failures,
        excludedOccurrenceIds,
      }),
      requiredSqlValue(row.id),
    );
  }
}
