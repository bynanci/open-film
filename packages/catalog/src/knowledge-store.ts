import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ApplicationError,
  GLOSSARY_ENTRY_LIMIT,
  REVIEW_PAGE_LIMIT,
  validateGlossaryEntry,
  validateTranscriptReviewSuggestion,
  type GlossaryEntry,
  type GlossaryInput,
  type ReviewBatch,
  type TranscriptReviewSuggestion as ReviewSuggestion,
} from "@openfilm/core";

/** Included in the catalog's v2 → v3 transaction, never an independent migration. */
export function migrateKnowledgeSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE project_glossary (
      id TEXT PRIMARY KEY, source TEXT NOT NULL UNIQUE, data TEXT NOT NULL
    );
    CREATE TABLE review_suggestions (
      id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      segment_id TEXT NOT NULL, source_revision_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','skipped','stale')),
      dedupe_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX review_suggestions_asset ON review_suggestions(asset_id,status,created_at,id);
    CREATE TABLE review_batches (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      batch_index INTEGER NOT NULL, asset_id TEXT NOT NULL,
      source_revision_id TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(job_id,batch_index)
    );
  `);
}

export interface ReviewPageOptions {
  status?: ReviewSuggestion["status"];
  offset?: number;
  limit?: number;
}

/** All state and evidence travel with the project; global vocabulary lives elsewhere. */
export class CatalogKnowledgeStore {
  constructor(private readonly database: DatabaseSync) {
    for (const [table, columns] of [
      ["project_glossary", "id,source,data"],
      [
        "review_suggestions",
        "id,asset_id,segment_id,source_revision_id,status,dedupe_key,created_at,data",
      ],
      ["review_batches", "job_id,batch_index,asset_id,source_revision_id,data"],
    ])
      database.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`);
  }

  glossaryList(): GlossaryEntry[] {
    return this.database
      .prepare("SELECT data FROM project_glossary ORDER BY source,id")
      .all()
      .map((row) => validateGlossaryEntry(JSON.parse(String(row.data))));
  }

  glossaryUpsert(input: GlossaryInput): GlossaryEntry {
    if (input.scope !== "project")
      throw new ApplicationError(
        "request.invalid",
        "Project glossary entries require project scope.",
      );
    const current = this.glossaryList();
    const named =
      input.id === undefined
        ? undefined
        : current.find((entry) => entry.id === input.id);
    if (input.id !== undefined && !named)
      throw new ApplicationError(
        "request.notFound",
        "Glossary entry not found.",
        404,
      );
    const existing =
      named ?? current.find((entry) => entry.source === input.source);
    if (
      named &&
      current.some(
        (entry) => entry.source === input.source && entry.id !== named.id,
      )
    )
      throw new ApplicationError(
        "glossary.entryConflict",
        "Another project entry already defines this source.",
        409,
      );
    if (!existing && current.length >= GLOSSARY_ENTRY_LIMIT)
      throw new ApplicationError(
        "request.tooLarge",
        "The project glossary contains too many terms.",
      );
    const now = new Date().toISOString();
    const entry = validateGlossaryEntry({
      ...existing,
      ...input,
      id: existing?.id ?? randomUUID(),
      scope: "project",
      enabled: input.enabled ?? existing?.enabled ?? true,
      caseSensitive: input.caseSensitive ?? existing?.caseSensitive ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.database
      .prepare(
        "INSERT INTO project_glossary(id,source,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,data=excluded.data",
      )
      .run(entry.id, entry.source, JSON.stringify(entry));
    return entry;
  }

  glossaryDelete(id: string): boolean {
    return (
      Number(
        this.database.prepare("DELETE FROM project_glossary WHERE id=?").run(id)
          .changes,
      ) > 0
    );
  }

  saveSuggestion(value: ReviewSuggestion): ReviewSuggestion {
    const suggestion = validateTranscriptReviewSuggestion(value);
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          suggestion.sourceRevisionId,
          suggestion.target,
          suggestion.before,
          suggestion.after,
          suggestion.source,
        ]),
      )
      .digest("hex");
    const existing = this.database
      .prepare("SELECT data FROM review_suggestions WHERE dedupe_key=?")
      .get(key);
    if (existing)
      return validateTranscriptReviewSuggestion(
        JSON.parse(String(existing.data)),
      );
    this.database
      .prepare(
        `INSERT INTO review_suggestions(id,asset_id,segment_id,source_revision_id,status,dedupe_key,created_at,data) VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        suggestion.id,
        suggestion.target.assetId,
        suggestion.target.segmentId,
        suggestion.sourceRevisionId,
        suggestion.status,
        key,
        suggestion.createdAt,
        JSON.stringify(suggestion),
      );
    return suggestion;
  }

  getSuggestion(id: string): ReviewSuggestion | undefined {
    const row = this.database
      .prepare("SELECT data FROM review_suggestions WHERE id=?")
      .get(id);
    return row
      ? validateTranscriptReviewSuggestion(JSON.parse(String(row.data)))
      : undefined;
  }

  suggestionsList(assetId: string, options: ReviewPageOptions = {}) {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? REVIEW_PAGE_LIMIT;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > REVIEW_PAGE_LIMIT ||
      (options.status !== undefined &&
        !["pending", "accepted", "skipped", "stale"].includes(options.status))
    )
      throw new ApplicationError("request.invalid", "Invalid review page.");
    const where =
      options.status === undefined ? "asset_id=?" : "asset_id=? AND status=?";
    const params =
      options.status === undefined ? [assetId] : [assetId, options.status];
    const total = Number(
      this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM review_suggestions WHERE ${where}`,
        )
        .get(...params)!.count,
    );
    const suggestions = this.database
      .prepare(
        `SELECT data FROM review_suggestions WHERE ${where} ORDER BY created_at,id LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset)
      .map((row) =>
        validateTranscriptReviewSuggestion(JSON.parse(String(row.data))),
      );
    return { suggestions, total, offset, limit };
  }

  /** Lifecycle only: original before/after/source/revision evidence never changes. */
  updateSuggestion(
    id: string,
    patch: Pick<ReviewSuggestion, "status"> &
      Partial<
        Pick<
          ReviewSuggestion,
          "acceptedAt" | "acceptedRevisionId" | "requestId"
        >
      >,
  ): ReviewSuggestion {
    const before = this.getSuggestion(id);
    if (!before)
      throw new ApplicationError(
        "request.notFound",
        "Review suggestion not found.",
        404,
      );
    if (
      before.status !== "pending" &&
      before.status !== patch.status &&
      !(before.status === "stale" && patch.status === "skipped")
    )
      throw new ApplicationError(
        "review.suggestionStale",
        "This suggestion was already reviewed or has become stale.",
        409,
      );
    const after = validateTranscriptReviewSuggestion({ ...before, ...patch });
    this.database
      .prepare("UPDATE review_suggestions SET status=?,data=? WHERE id=?")
      .run(after.status, JSON.stringify(after), id);
    return after;
  }

  staleSuggestions(assetId: string, revisionId: string): void {
    // SQLite performs the unbounded lifecycle update; the browser still reads bounded pages.
    this.database
      .prepare(
        `UPDATE review_suggestions SET status='stale',data=json_set(data,'$.status','stale') WHERE asset_id=? AND source_revision_id<>? AND status='pending'`,
      )
      .run(assetId, revisionId);
  }

  saveBatch(batch: ReviewBatch): void {
    if (
      !Number.isSafeInteger(batch.index) ||
      batch.index < 0 ||
      !Number.isSafeInteger(batch.attempts) ||
      batch.attempts < 0 ||
      ![
        "pending",
        "running",
        "completed",
        "failed",
        "skipped",
        "cancelled",
      ].includes(batch.status) ||
      !Array.isArray(batch.segmentIds) ||
      batch.segmentIds.length > 100 ||
      batch.segmentIds.some((id) => typeof id !== "string" || !id)
    )
      throw new ApplicationError("request.invalid", "Invalid review batch.");
    this.database
      .prepare(
        `INSERT INTO review_batches(job_id,batch_index,asset_id,source_revision_id,data) VALUES(?,?,?,?,?) ON CONFLICT(job_id,batch_index) DO UPDATE SET data=excluded.data`,
      )
      .run(
        batch.jobId,
        batch.index,
        batch.assetId,
        batch.sourceRevisionId,
        JSON.stringify(batch),
      );
  }

  batches(jobId: string): ReviewBatch[] {
    return this.database
      .prepare(
        "SELECT data FROM review_batches WHERE job_id=? ORDER BY batch_index",
      )
      .all(jobId)
      .map((row) => JSON.parse(String(row.data)) as ReviewBatch);
  }

  /** Each completed batch is durable atomically, even when the next batch fails/cancels. */
  completeBatch(batch: ReviewBatch, suggestions: ReviewSuggestion[]): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const suggestion of suggestions) this.saveSuggestion(suggestion);
      this.saveBatch({ ...batch, status: "completed" });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
