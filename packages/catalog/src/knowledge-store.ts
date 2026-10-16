import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ApplicationError,
  GLOSSARY_ENTRY_LIMIT,
  REVIEW_PAGE_LIMIT,
  validateGlossaryEntry,
  validateTranscriptReviewSuggestion,
  validateSceneScriptReviewSuggestion,
  type GlossaryEntry,
  type GlossaryInput,
  type Job,
  type ReviewBatch,
  type SceneScriptField,
  type SceneScriptReviewSuggestion,
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

/** Runs in the catalog's v4 → v5 transaction. Story IDs have no asset FK. */
export function migrateSceneScriptReviewSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE scene_script_suggestions (
      id TEXT PRIMARY KEY, story_id TEXT NOT NULL, beat_id TEXT NOT NULL,
      field TEXT NOT NULL CHECK(field IN ('narration','visualDirection')),
      source_revision_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','skipped','stale')),
      dedupe_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX scene_script_suggestions_scope ON scene_script_suggestions(story_id,beat_id,field,status,created_at,id);
  `);
}

export interface ReviewPageOptions {
  status?: ReviewSuggestion["status"];
  offset?: number;
  limit?: number;
}
export interface SceneScriptReviewPageOptions extends ReviewPageOptions {
  beatId?: string;
  field?: SceneScriptField;
}
export type SceneScriptReviewLifecyclePatch = Pick<
  SceneScriptReviewSuggestion,
  "status"
> &
  Partial<
    Pick<
      SceneScriptReviewSuggestion,
      "acceptedAt" | "acceptedRevisionId" | "requestId"
    >
  >;

/** JSON encodes opaque legacy Story IDs injectively, including isolated surrogates. */
function storyKey(id: string): string {
  if (typeof id !== "string" || !id.trim())
    throw new ApplicationError(
      "request.invalid",
      "Story and scene IDs must be nonblank strings.",
    );
  return JSON.stringify(id);
}

/** All state and evidence travel with the project; global vocabulary lives elsewhere. */
export class CatalogKnowledgeStore {
  constructor(
    private readonly database: DatabaseSync,
    verifySceneScriptReview = true,
  ) {
    for (const [table, columns] of [
      ["project_glossary", "id,source,data"],
      [
        "review_suggestions",
        "id,asset_id,segment_id,source_revision_id,status,dedupe_key,created_at,data",
      ],
      ["review_batches", "job_id,batch_index,asset_id,source_revision_id,data"],
    ])
      database.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`);
    if (verifySceneScriptReview)
      database.prepare(
        "SELECT id,story_id,beat_id,field,source_revision_id,status,dedupe_key,created_at,data FROM scene_script_suggestions LIMIT 0",
      );
  }

  saveSceneScriptSuggestion(
    value: SceneScriptReviewSuggestion,
  ): SceneScriptReviewSuggestion {
    const suggestion = validateSceneScriptReviewSuggestion(value);
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
      .prepare("SELECT data FROM scene_script_suggestions WHERE dedupe_key=?")
      .get(key);
    if (existing)
      return validateSceneScriptReviewSuggestion(
        JSON.parse(String(existing.data)),
      );
    this.database
      .prepare(
        "INSERT INTO scene_script_suggestions(id,story_id,beat_id,field,source_revision_id,status,dedupe_key,created_at,data) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        suggestion.id,
        storyKey(suggestion.target.storyId),
        storyKey(suggestion.target.beatId),
        suggestion.target.field,
        suggestion.sourceRevisionId,
        suggestion.status,
        key,
        suggestion.createdAt,
        JSON.stringify(suggestion),
      );
    return suggestion;
  }

  getSceneScriptSuggestion(
    id: string,
  ): SceneScriptReviewSuggestion | undefined {
    const row = this.database
      .prepare("SELECT data FROM scene_script_suggestions WHERE id=?")
      .get(id);
    return row
      ? validateSceneScriptReviewSuggestion(JSON.parse(String(row.data)))
      : undefined;
  }

  sceneScriptSuggestionsList(
    storyId: string,
    options: SceneScriptReviewPageOptions = {},
  ) {
    const offset = options.offset ?? 0,
      limit = options.limit ?? REVIEW_PAGE_LIMIT;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > REVIEW_PAGE_LIMIT ||
      (options.status !== undefined &&
        !["pending", "accepted", "skipped", "stale"].includes(
          options.status,
        )) ||
      (options.field !== undefined &&
        !["narration", "visualDirection"].includes(options.field))
    )
      throw new ApplicationError(
        "request.invalid",
        "Invalid scene script review page.",
      );
    const conditions = ["story_id=?"],
      params: string[] = [storyKey(storyId)];
    if (options.beatId !== undefined) {
      conditions.push("beat_id=?");
      params.push(storyKey(options.beatId));
    }
    if (options.field !== undefined) {
      conditions.push("field=?");
      params.push(options.field);
    }
    if (options.status !== undefined) {
      conditions.push("status=?");
      params.push(options.status);
    }
    const where = conditions.join(" AND ");
    const total = Number(
      this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM scene_script_suggestions WHERE ${where}`,
        )
        .get(...params)!.count,
    );
    const suggestions = this.database
      .prepare(
        `SELECT data FROM scene_script_suggestions WHERE ${where} ORDER BY created_at,id LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset)
      .map((row) =>
        validateSceneScriptReviewSuggestion(JSON.parse(String(row.data))),
      );
    return { suggestions, total, offset, limit };
  }

  updateSceneScriptSuggestion(
    id: string,
    patch: SceneScriptReviewLifecyclePatch,
  ): SceneScriptReviewSuggestion {
    const before = this.getSceneScriptSuggestion(id);
    if (!before)
      throw new ApplicationError(
        "request.notFound",
        "Scene script suggestion not found.",
        404,
      );
    if (
      Object.keys(patch).some(
        (key) =>
          !["status", "acceptedAt", "acceptedRevisionId", "requestId"].includes(
            key,
          ),
      )
    )
      throw new ApplicationError(
        "request.invalid",
        "Only review lifecycle fields may change.",
      );
    if (
      before.status !== "pending" &&
      before.status !== patch.status &&
      !(before.status === "stale" && patch.status === "skipped")
    )
      throw new ApplicationError(
        "review.suggestionStale",
        "This scene script suggestion was already reviewed or has become stale.",
        409,
      );
    const after = validateSceneScriptReviewSuggestion({ ...before, ...patch });
    if (
      before.status === "accepted" &&
      JSON.stringify(after) !== JSON.stringify(before)
    )
      throw new ApplicationError(
        "review.suggestionStale",
        "Accepted scene script audit evidence cannot change.",
        409,
      );
    const updated = this.database
      .prepare(
        "UPDATE scene_script_suggestions SET status=?,data=? WHERE id=? AND data=?",
      )
      .run(after.status, JSON.stringify(after), id, JSON.stringify(before));
    if (Number(updated.changes) !== 1)
      throw new ApplicationError(
        "review.suggestionStale",
        "This scene script suggestion changed while it was being reviewed. Reload it before trying again.",
        409,
      );
    return after;
  }

  staleSceneScriptSuggestions(
    storyId: string,
    beatId: string,
    field: SceneScriptField,
    currentRevision: string,
  ): void {
    this.database
      .prepare(
        "UPDATE scene_script_suggestions SET status='stale',data=json_set(data,'$.status','stale') WHERE story_id=? AND beat_id=? AND field=? AND source_revision_id<>? AND status='pending'",
      )
      .run(storyKey(storyId), storyKey(beatId), field, currentRevision);
  }

  /** Serialize acceptance and Skip across connections; project I/O belongs to the caller. */
  withSceneScriptSuggestion<T>(
    id: string,
    handler: (suggestion: SceneScriptReviewSuggestion) => T,
  ): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const suggestion = this.getSceneScriptSuggestion(id);
      if (!suggestion)
        throw new ApplicationError(
          "request.notFound",
          "Scene script suggestion not found.",
          404,
        );
      const result = handler(suggestion);
      if (result && typeof (result as { then?: unknown }).then === "function")
        throw new ApplicationError(
          "request.invalid",
          "Scene script acceptance must complete synchronously.",
        );
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Exact ownership checkpoint, evidence and completed Activity publish together. */
  completeSceneScriptReview(
    observedJob: Job,
    completedJob: Job,
    suggestions: SceneScriptReviewSuggestion[],
  ): void {
    if (
      observedJob.type !== "scene-script-review" ||
      observedJob.status !== "running" ||
      !observedJob.reviewOwner ||
      completedJob.id !== observedJob.id ||
      completedJob.type !== observedJob.type ||
      completedJob.storyId !== observedJob.storyId ||
      completedJob.beatId !== observedJob.beatId ||
      completedJob.scriptField !== observedJob.scriptField ||
      JSON.stringify(completedJob.reviewOwner) !==
        JSON.stringify(observedJob.reviewOwner) ||
      completedJob.status !== "completed" ||
      suggestions.some(
        (row) =>
          row.target.storyId !== observedJob.storyId ||
          (observedJob.beatId !== undefined &&
            row.target.beatId !== observedJob.beatId) ||
          (observedJob.scriptField !== undefined &&
            row.target.field !== observedJob.scriptField),
      )
    )
      throw new ApplicationError(
        "request.invalid",
        "Invalid scene script review completion.",
      );
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.compareAndSetReviewJob(observedJob, completedJob);
      for (const suggestion of suggestions)
        this.saveSceneScriptSuggestion(suggestion);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
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
    // Another connection can finish a review after the read. Preserve its
    // lifecycle evidence instead of overwriting it with this outdated copy.
    const updated = this.database
      .prepare(
        "UPDATE review_suggestions SET status=?,data=? WHERE id=? AND status=?",
      )
      .run(after.status, JSON.stringify(after), id, before.status);
    if (Number(updated.changes) !== 1)
      throw new ApplicationError(
        "review.suggestionStale",
        "This suggestion changed while it was being reviewed. Reload it before trying again.",
        409,
      );
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

  private validateBatch(batch: ReviewBatch): void {
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
  }

  saveBatch(batch: ReviewBatch): void {
    this.validateBatch(batch);
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

  /** Initial batches belong to the same queued execution, atomically. */
  initializeReviewBatches(observed: Job, batches: ReviewBatch[]): void {
    if (
      observed.status !== "queued" ||
      !observed.reviewOwner ||
      batches.some((batch) => batch.jobId !== observed.id)
    )
      throw new ApplicationError(
        "request.invalid",
        "Invalid review initialization.",
      );
    this.database.exec("BEGIN IMMEDIATE");
    try {
      // Recovery can revoke an execution after its initial notification. Check
      // the exact queued checkpoint before inserting any of its pending work.
      this.compareAndSetReviewJob(observed, observed);
      if (
        this.database
          .prepare("SELECT 1 FROM review_batches WHERE job_id=? LIMIT 1")
          .get(observed.id)
      )
        throw new ApplicationError(
          "request.invalid",
          "Review batches already exist for this execution.",
          409,
        );
      for (const batch of batches) this.saveBatch(batch);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Claim or finish only the exact durable attempt that the caller observed. */
  compareAndSetBatch(
    observed: ReviewBatch,
    next: ReviewBatch,
    commitHook?: () => void,
  ): void {
    this.validateBatch(next);
    if (observed.jobId !== next.jobId || observed.index !== next.index)
      throw new ApplicationError("request.invalid", "Invalid review batch.");
    if (commitHook) this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database
        .prepare(
          "UPDATE review_batches SET data=? WHERE job_id=? AND batch_index=? AND data=?",
        )
        .run(
          JSON.stringify(next),
          observed.jobId,
          observed.index,
          JSON.stringify(observed),
        );
      if (Number(result.changes) !== 1)
        throw new ApplicationError(
          "request.invalid",
          "This review batch changed. Reload it before retrying or skipping it.",
          409,
        );
      commitHook?.();
      if (commitHook) this.database.exec("COMMIT");
    } catch (error) {
      if (commitHook) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Used inside a batch claim transaction to publish the same execution owner. */
  compareAndSetReviewJob(observed: Job, next: Job): void {
    if (observed.id !== next.id)
      throw new ApplicationError("request.invalid", "Invalid review job.");
    const result = this.database
      .prepare("UPDATE jobs SET data=? WHERE id=? AND data=?")
      .run(JSON.stringify(next), observed.id, JSON.stringify(observed));
    if (Number(result.changes) !== 1)
      throw new ApplicationError(
        "request.invalid",
        "This review job changed. Reload it before trying again.",
        409,
      );
  }

  /** A late execution can publish only while its exact owner is still current. */
  saveOwnedReviewJob(job: Job): boolean {
    const owner = job.reviewOwner;
    if (!owner) return false;
    const result = this.database
      .prepare(
        `INSERT INTO jobs(id,created_at,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE json_extract(jobs.data,'$.reviewOwner.host')=? AND json_extract(jobs.data,'$.reviewOwner.pid')=? AND json_extract(jobs.data,'$.reviewOwner.token')=?`,
      )
      .run(
        job.id,
        job.createdAt ?? new Date().toISOString(),
        JSON.stringify(job),
        owner.host,
        owner.pid,
        owner.token,
      );
    return Number(result.changes) === 1;
  }

  /** Recovery cannot terminalize a retry that claimed the job after its read. */
  recoverReviewJob(observed: Job, recovered: Job): boolean {
    if (observed.id !== recovered.id)
      throw new ApplicationError("request.invalid", "Invalid review job.");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database
        .prepare("UPDATE jobs SET data=? WHERE id=? AND data=?")
        .run(JSON.stringify(recovered), observed.id, JSON.stringify(observed));
      if (Number(result.changes) !== 1) {
        this.database.exec("ROLLBACK");
        return false;
      }
      for (const batch of this.batches(observed.id)) {
        if (!["pending", "running"].includes(batch.status)) continue;
        this.compareAndSetBatch(batch, {
          ...batch,
          status: "cancelled",
          error: "The previous process stopped before this batch completed.",
        });
      }
      this.database.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
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
      this.compareAndSetBatch(batch, { ...batch, status: "completed" });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
