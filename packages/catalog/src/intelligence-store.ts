import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  ApplicationError,
  validateJob,
  validateSceneAnalysis,
  validateTimelineMarker,
  validateTranscriptDocument,
  validateWaveformData,
  type SceneAnalysis,
  type TimelineMarker,
  type TranscriptDocument,
  type WaveformData,
  type Job,
} from "@openfilm/core";
import { recordTranscriptRevision } from "./transcript-editor-store.js";
import { transcriptSegmentKey } from "./transcript-segment-identity.js";

export const CATALOG_SCHEMA_VERSION = 6;
export const INTELLIGENCE_CACHE_VERSION = "1";
export const TRANSCRIPT_PAGE_LIMIT = 200;

export interface AnalysisCacheOptions {
  providerId?: string;
  version?: string;
  model?: string;
}

export interface TranscriptPageOptions extends AnalysisCacheOptions {
  offset?: number;
  limit?: number;
}

export interface TranscriptPage {
  document?: TranscriptDocument;
  total: number;
  offset: number;
  limit: number;
}

export interface OwnedAnalysisCompletionOptions {
  ownedCompletion?: Job;
}

const ANALYSIS_OPERATIONS = [
  "transcribe",
  "waveform",
  "scenes",
  "silence-analysis",
];

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value.length <= 256 &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  );
}

function validateAnalysisJob(
  job: Job,
  statuses: Job["status"][],
  requireOwner = true,
): void {
  const owner = job?.analysisOwner;
  if (
    !job ||
    typeof job !== "object" ||
    !validIdentifier(job.id) ||
    !validIdentifier(job.assetId) ||
    !ANALYSIS_OPERATIONS.includes(job.type) ||
    !statuses.includes(job.status) ||
    (job.progress !== undefined &&
      (!Number.isFinite(job.progress) ||
        job.progress < 0 ||
        job.progress > 1)) ||
    (requireOwner &&
      (!owner ||
        typeof owner !== "object" ||
        Array.isArray(owner) ||
        typeof owner.host !== "string" ||
        !owner.host.trim() ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid <= 0 ||
        owner.pid > 2147483647 ||
        typeof owner.token !== "string" ||
        !owner.token.trim()))
  )
    throw new ApplicationError(
      "request.invalid",
      "Invalid media analysis job.",
    );
  if (job.type === "silence-analysis") {
    try {
      validateJob(job);
    } catch (error) {
      throw new ApplicationError(
        "request.invalid",
        "Invalid durable silence analysis job.",
        400,
        undefined,
        String(error),
      );
    }
  }
}

function sameAnalysis(job: Job, next: Job): boolean {
  return (
    job.id === next.id && job.type === next.type && job.assetId === next.assetId
  );
}

function sameAnalysisOwner(job: Job, next: Job): boolean {
  return Boolean(
    job.analysisOwner &&
    next.analysisOwner &&
    job.analysisOwner.host === next.analysisOwner.host &&
    job.analysisOwner.pid === next.analysisOwner.pid &&
    job.analysisOwner.token === next.analysisOwner.token,
  );
}

function sameSilenceIdentity(job: Job, next: Job): boolean {
  const left = job.silenceAnalysis,
    right = next.silenceAnalysis;
  return Boolean(
    job.type === "silence-analysis" &&
    next.type === "silence-analysis" &&
    left &&
    right &&
    left.version === right.version &&
    left.projectId === right.projectId &&
    left.compositionId === right.compositionId &&
    left.baseRevision === right.baseRevision &&
    left.requestId === right.requestId &&
    left.requestFingerprint === right.requestFingerprint &&
    left.options.thresholdDb === right.options.thresholdDb &&
    left.options.minimumSilenceSeconds ===
      right.options.minimumSilenceSeconds &&
    left.options.paddingSeconds === right.options.paddingSeconds &&
    left.attempt === right.attempt &&
    left.sourceHash === right.sourceHash &&
    left.parentJobId === right.parentJobId &&
    left.sourceReviewId === right.sourceReviewId &&
    JSON.stringify(left.selectedCandidateIds ?? []) ===
      JSON.stringify(right.selectedCandidateIds ?? []) &&
    (left.reviewId === undefined || left.reviewId === right.reviewId) &&
    JSON.stringify(left.retryRequests ?? []) ===
      JSON.stringify(right.retryRequests ?? []),
  );
}

function sameSilenceRequest(job: Job, next: Job): boolean {
  const left = job.silenceAnalysis,
    right = next.silenceAnalysis;
  return Boolean(
    job.type === "silence-analysis" &&
    next.type === "silence-analysis" &&
    job.assetId === next.assetId &&
    left &&
    right &&
    left.version === right.version &&
    left.projectId === right.projectId &&
    left.compositionId === right.compositionId &&
    left.baseRevision === right.baseRevision &&
    left.requestId === right.requestId &&
    left.requestFingerprint === right.requestFingerprint &&
    left.options.thresholdDb === right.options.thresholdDb &&
    left.options.minimumSilenceSeconds ===
      right.options.minimumSilenceSeconds &&
    left.options.paddingSeconds === right.options.paddingSeconds &&
    left.sourceHash === right.sourceHash &&
    left.parentJobId === right.parentJobId &&
    left.sourceReviewId === right.sourceReviewId &&
    JSON.stringify(left.selectedCandidateIds ?? []) ===
      JSON.stringify(right.selectedCandidateIds ?? []),
  );
}

/** Called inside the catalog's migration transaction. */
export function migrateIntelligenceSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE intelligence_transcripts (
      revision INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      source_hash TEXT NOT NULL, provider_id TEXT NOT NULL,
      provider_version TEXT NOT NULL, model TEXT NOT NULL,
      header TEXT NOT NULL, segment_count INTEGER NOT NULL
    );
    CREATE INDEX intelligence_transcripts_source ON intelligence_transcripts
      (asset_id, source_hash, provider_version, revision DESC);
    CREATE TABLE intelligence_segments (
      revision INTEGER NOT NULL REFERENCES intelligence_transcripts(revision) ON DELETE CASCADE,
      position INTEGER NOT NULL, segment_id TEXT NOT NULL,
      start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (revision, position), UNIQUE (revision, segment_id)
    );
    CREATE TABLE intelligence_cache (
      updated_seq INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('waveform', 'scenes')),
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      source_hash TEXT NOT NULL, provider_id TEXT NOT NULL,
      provider_version TEXT NOT NULL, model TEXT NOT NULL, data TEXT NOT NULL,
      UNIQUE (kind, asset_id, source_hash, provider_id, provider_version, model)
    );
    CREATE INDEX intelligence_cache_source ON intelligence_cache
      (asset_id, source_hash, provider_version, kind, updated_seq DESC);
    CREATE TABLE intelligence_markers (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      source_hash TEXT NOT NULL, time REAL NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX intelligence_markers_source ON intelligence_markers
      (asset_id, source_hash, time, id);
  `);
}

function text(value: unknown, name: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error(
      `${name} must be a nonempty string without control characters`,
    );
}

function cacheFilter(options: AnalysisCacheOptions): {
  sql: string;
  params: SQLInputValue[];
} {
  const version = options.version ?? INTELLIGENCE_CACHE_VERSION;
  text(version, "Analysis version");
  let sql = "provider_version=?";
  const params: SQLInputValue[] = [version];
  for (const [field, value] of [
    ["provider_id", options.providerId],
    ["model", options.model],
  ] as const) {
    if (value === undefined) continue;
    text(value, field);
    sql += ` AND ${field}=?`;
    params.push(value);
  }
  return { sql, params };
}

function page(options: TranscriptPageOptions): {
  offset: number;
  limit: number;
} {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? TRANSCRIPT_PAGE_LIMIT;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("Transcript offset must be a nonnegative integer");
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > TRANSCRIPT_PAGE_LIMIT
  )
    throw new Error(
      `Transcript limit must be between 1 and ${TRANSCRIPT_PAGE_LIMIT}`,
    );
  return { offset, limit };
}

/** Derived analysis stays outside MediaAsset and portable project manifests. */
export class CatalogIntelligenceStore {
  constructor(private readonly database: DatabaseSync) {
    // A catalog claiming v2 must have the complete schema. Never silently
    // recreate missing analysis tables and conceal corruption or lost data.
    for (const [table, columns] of [
      [
        "intelligence_transcripts",
        "revision,document_id,asset_id,source_hash,provider_id,provider_version,model,header,segment_count",
      ],
      [
        "intelligence_segments",
        "revision,position,segment_id,start,end,text,data",
      ],
      [
        "intelligence_cache",
        "updated_seq,kind,asset_id,source_hash,provider_id,provider_version,model,data",
      ],
      ["intelligence_markers", "id,asset_id,source_hash,time,data"],
    ])
      database.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`);
  }

  private source(assetId: string, sourceHash: string, writing = false) {
    text(assetId, "Asset ID");
    text(sourceHash, "Source hash");
    const asset = this.database
      .prepare(
        "SELECT json_extract(data,'$.contentHash') AS hash, json_extract(data,'$.duration') AS duration FROM assets WHERE id=?",
      )
      .get(assetId);
    if (!asset || (asset.hash !== null && asset.hash !== sourceHash)) {
      if (writing) throw new Error("Analysis source is missing or has changed");
      return undefined;
    }
    return {
      ...(asset.duration === null ? {} : { duration: Number(asset.duration) }),
    };
  }

  private transaction<T>(action: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Reserve one project analysis before any provider or decoder is invoked. */
  reserveAnalysisJob(job: Job): void {
    if (job.type === "silence-analysis")
      throw new ApplicationError(
        "request.invalid",
        "Silence jobs require request-idempotent reservation.",
      );
    validateAnalysisJob(job, ["queued"]);
    this.transaction(() => {
      this.insertAnalysisReservation(job);
    });
  }

  /** Reserve silence work atomically with its request-id idempotency check. */
  reserveSilenceAnalysisJob(job: Job): { job: Job; created: boolean } {
    validateAnalysisJob(job, ["queued"]);
    if (job.type !== "silence-analysis" || !job.silenceAnalysis)
      throw new ApplicationError(
        "request.invalid",
        "A durable silence analysis job is required.",
      );
    return this.transaction(() => {
      const existing = this.database
        .prepare(
          `SELECT data FROM jobs WHERE json_extract(data,'$.type')='silence-analysis'
           AND json_extract(data,'$.silenceAnalysis.requestId')=? LIMIT 1`,
        )
        .get(job.silenceAnalysis!.requestId);
      if (existing) {
        const prior = validateJob(JSON.parse(String(existing.data)));
        validateAnalysisJob(prior, [
          "queued",
          "running",
          "waiting-review",
          "completed",
          "failed",
          "cancelled",
        ]);
        if (!sameSilenceRequest(prior, job))
          throw new ApplicationError(
            "request.invalid",
            "This requestId is already bound to another silence analysis.",
            409,
          );
        return { job: structuredClone(prior), created: false };
      }
      this.insertAnalysisReservation(job);
      return { job: structuredClone(job), created: true };
    });
  }

  getSilenceAnalysisByRequestId(requestId: string): Job | undefined {
    if (!validIdentifier(requestId))
      throw new ApplicationError(
        "request.invalid",
        "A valid silence analysis requestId is required.",
      );
    const row = this.database
      .prepare(
        `SELECT data FROM jobs WHERE json_extract(data,'$.type')='silence-analysis'
         AND json_extract(data,'$.silenceAnalysis.requestId')=? LIMIT 1`,
      )
      .get(requestId);
    return row ? validateJob(JSON.parse(String(row.data))) : undefined;
  }

  private insertAnalysisReservation(job: Job): void {
    if (this.database.prepare("SELECT 1 FROM jobs WHERE id=?").get(job.id))
      throw new ApplicationError(
        "request.invalid",
        "Media analysis job ID already exists.",
        409,
      );
    if (
      this.database
        .prepare(
          `SELECT 1 FROM jobs WHERE json_extract(data,'$.type') IN ('transcribe','waveform','scenes','silence-analysis')
           AND json_extract(data,'$.status') IN ('queued','running') LIMIT 1`,
        )
        .get()
    )
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active media analysis before starting another task.",
        409,
      );
    this.database
      .prepare("INSERT INTO jobs(id,created_at,data) VALUES(?,?,?)")
      .run(
        job.id,
        job.createdAt ?? new Date().toISOString(),
        JSON.stringify(job),
      );
  }

  /** Consume the exact queued reservation once, without claiming foreign work. */
  claimAnalysisReservation(observed: Job, running: Job): boolean {
    validateAnalysisJob(observed, ["queued"]);
    validateAnalysisJob(running, ["running"]);
    if (
      !sameAnalysis(observed, running) ||
      !sameAnalysisOwner(observed, running) ||
      (observed.type === "silence-analysis" &&
        !sameSilenceIdentity(observed, running))
    )
      throw new ApplicationError(
        "request.invalid",
        "Invalid media analysis claim.",
      );
    const result = this.database
      .prepare("UPDATE jobs SET data=? WHERE id=? AND data=?")
      .run(JSON.stringify(running), observed.id, JSON.stringify(observed));
    return Number(result.changes) === 1;
  }

  /** Terminal attempts and changed owners can never publish progress again. */
  saveOwnedAnalysisJob(job: Job): boolean {
    if (job.type === "silence-analysis") {
      validateAnalysisJob(job, ["running"]);
      return this.transaction(() => {
        const row = this.database
          .prepare("SELECT data FROM jobs WHERE id=?")
          .get(job.id);
        if (!row) return false;
        const observed = validateJob(JSON.parse(String(row.data)));
        if (observed.status !== "running") return false;
        validateAnalysisJob(observed, ["running"]);
        if (
          !sameAnalysis(observed, job) ||
          !sameAnalysisOwner(observed, job) ||
          !sameSilenceIdentity(observed, job) ||
          observed.silenceAnalysis!.reviewId !==
            job.silenceAnalysis!.reviewId ||
          (job.progress ?? 0) < (observed.progress ?? 0)
        )
          return false;
        const result = this.database
          .prepare("UPDATE jobs SET data=? WHERE id=? AND data=?")
          .run(JSON.stringify(job), job.id, String(row.data));
        return Number(result.changes) === 1;
      });
    }
    validateAnalysisJob(job, [
      "queued",
      "running",
      "waiting-review",
      "completed",
      "failed",
      "cancelled",
    ]);
    const owner = job.analysisOwner!;
    // A running attempt cannot return to queued; running and completion must
    // follow the exact queued claim, rather than bypassing reservation CAS.
    const statuses =
      job.status === "queued"
        ? ["queued"]
        : job.status === "running"
          ? ["running"]
          : job.status === "waiting-review"
            ? ["running"]
            : job.status === "completed"
              ? job.type === "silence-analysis"
                ? ["waiting-review"]
                : ["running"]
              : ["queued", "running"];
    const result = this.database
      .prepare(
        `UPDATE jobs SET data=? WHERE id=? AND json_extract(data,'$.type')=?
       AND json_extract(data,'$.assetId')=? AND json_extract(data,'$.analysisOwner.host')=?
       AND json_extract(data,'$.analysisOwner.pid')=? AND json_extract(data,'$.analysisOwner.token')=?
       AND json_extract(data,'$.status') IN (?,?)`,
      )
      .run(
        JSON.stringify(job),
        job.id,
        job.type,
        job.assetId!,
        owner.host,
        owner.pid,
        owner.token,
        statuses[0]!,
        statuses[1] ?? statuses[0]!,
      );
    return Number(result.changes) === 1;
  }

  /** Exact silence lifecycle transitions; callbacks cannot cross a terminal edge. */
  transitionOwnedSilenceJob(observed: Job, next: Job): boolean {
    const allowed: Record<string, readonly string[]> = {
      queued: ["running", "failed", "cancelled"],
      running: ["waiting-review", "failed", "cancelled"],
      "waiting-review": ["completed"],
    };
    validateAnalysisJob(observed, ["queued", "running", "waiting-review"]);
    validateAnalysisJob(next, [
      "running",
      "waiting-review",
      "failed",
      "cancelled",
      "completed",
    ]);
    if (
      observed.type !== "silence-analysis" ||
      next.type !== "silence-analysis" ||
      !allowed[observed.status]?.includes(next.status) ||
      !sameAnalysis(observed, next) ||
      !sameAnalysisOwner(observed, next) ||
      !sameSilenceIdentity(observed, next) ||
      (next.progress ?? 0) < (observed.progress ?? 0)
    )
      throw new ApplicationError(
        "request.invalid",
        "Invalid silence job state transition.",
      );
    const result = this.database
      .prepare("UPDATE jobs SET data=? WHERE id=? AND data=?")
      .run(JSON.stringify(next), observed.id, JSON.stringify(observed));
    return Number(result.changes) === 1;
  }

  /** Retry one failed attempt with a new owner; retry request replay is durable. */
  retrySilenceAnalysisJob(
    observed: Job,
    next: Job,
    requestId: string,
  ): { job: Job; created: boolean } {
    validateAnalysisJob(observed, ["failed", "cancelled"]);
    validateAnalysisJob(next, ["queued"]);
    if (
      observed.type !== "silence-analysis" ||
      next.type !== "silence-analysis" ||
      !validIdentifier(requestId) ||
      !sameAnalysis(observed, next) ||
      !sameSilenceRequest(observed, next) ||
      observed.silenceAnalysis?.baseRevision !==
        next.silenceAnalysis?.baseRevision ||
      sameAnalysisOwner(observed, next) ||
      observed.silenceAnalysis?.sourceHash !==
        next.silenceAnalysis?.sourceHash ||
      next.silenceAnalysis!.attempt !== observed.silenceAnalysis!.attempt + 1
    )
      throw new ApplicationError(
        "request.invalid",
        "Invalid silence analysis retry.",
        409,
      );
    const currentReceipts = observed.silenceAnalysis!.retryRequests ?? [];
    const retryReceipts = next.silenceAnalysis!.retryRequests ?? [];
    if (
      retryReceipts.length !== currentReceipts.length + 1 ||
      currentReceipts.some(
        (receipt, index) =>
          JSON.stringify(receipt) !== JSON.stringify(retryReceipts[index]),
      ) ||
      retryReceipts.at(-1)?.requestId !== requestId ||
      retryReceipts.at(-1)?.attempt !== next.silenceAnalysis!.attempt
    )
      throw new ApplicationError(
        "request.invalid",
        "The retry receipt is invalid or this job has reached its retry limit.",
        409,
      );
    return this.transaction(() => {
      const row = this.database
        .prepare("SELECT data FROM jobs WHERE id=?")
        .get(observed.id);
      if (!row)
        throw new ApplicationError(
          "request.notFound",
          "Silence job not found.",
          404,
        );
      const stored = validateJob(JSON.parse(String(row.data)));
      const priorReceipt = stored.silenceAnalysis?.retryRequests?.find(
        (receipt) => receipt.requestId === requestId,
      );
      if (priorReceipt) {
        const requested = retryReceipts.at(-1)!;
        if (priorReceipt.fingerprint !== requested.fingerprint)
          throw new ApplicationError(
            "request.invalid",
            "This retry requestId is already bound to another attempt.",
            409,
          );
        return { job: structuredClone(stored), created: false };
      }
      if (currentReceipts.length >= 100)
        throw new ApplicationError(
          "request.invalid",
          "This silence job has reached its retry request limit.",
          409,
        );
      if (
        JSON.stringify(stored) !== JSON.stringify(observed) ||
        !sameSilenceRequest(stored, observed)
      )
        throw new ApplicationError(
          "request.invalid",
          "The silence job changed before retry.",
          409,
        );
      if (
        this.database
          .prepare(
            `SELECT 1 FROM jobs WHERE id<>? AND json_extract(data,'$.type') IN ('transcribe','waveform','scenes','silence-analysis')
             AND json_extract(data,'$.status') IN ('queued','running') LIMIT 1`,
          )
          .get(observed.id)
      )
        throw new ApplicationError(
          "jobs.busy",
          "Wait for the active media analysis before retrying this task.",
          409,
        );
      const updated = this.database
        .prepare("UPDATE jobs SET data=? WHERE id=? AND data=?")
        .run(JSON.stringify(next), observed.id, JSON.stringify(observed));
      if (Number(updated.changes) !== 1)
        throw new ApplicationError(
          "request.invalid",
          "The silence job changed during retry.",
          409,
        );
      return { job: structuredClone(next), created: true };
    });
  }

  /** Explicit recovery rotates ownership only against the inspected checkpoint. */
  recoverAnalysisJob(observed: Job, recovered: Job): boolean {
    // Ownerless or malformed historical owners can be repaired after the
    // application's explicit stopped-process confirmation, never auto-claimed.
    validateAnalysisJob(observed, ["queued", "running"], false);
    validateAnalysisJob(recovered, ["failed", "cancelled"]);
    if (
      !sameAnalysis(observed, recovered) ||
      observed.analysisOwner?.token === recovered.analysisOwner!.token ||
      (observed.type === "silence-analysis" &&
        !sameSilenceIdentity(observed, recovered))
    )
      throw new ApplicationError(
        "request.invalid",
        "Invalid media analysis recovery.",
      );
    const result = this.database
      .prepare("UPDATE jobs SET data=? WHERE id=? AND data=?")
      .run(JSON.stringify(recovered), observed.id, JSON.stringify(observed));
    return Number(result.changes) === 1;
  }

  private validateCompletion(
    job: Job | undefined,
    operation: string,
    assetId: string,
  ): void {
    if (job === undefined) return;
    validateAnalysisJob(job, ["completed"]);
    if (job.type !== operation || job.assetId !== assetId)
      throw new ApplicationError(
        "request.invalid",
        "Analysis completion belongs to another operation or media asset.",
      );
  }

  private completeOwnedAnalysis(job: Job | undefined): void {
    if (job !== undefined && !this.saveOwnedAnalysisJob(job))
      throw new ApplicationError(
        "request.invalid",
        "This media analysis execution changed ownership or is no longer running.",
        409,
      );
  }

  private transcript(
    assetId: string,
    sourceHash: string,
    options: AnalysisCacheOptions,
  ) {
    if (!this.source(assetId, sourceHash)) return undefined;
    const filter = cacheFilter(options);
    return this.database
      .prepare(
        `SELECT revision, header, segment_count FROM intelligence_transcripts
         WHERE asset_id=? AND source_hash=? AND ${filter.sql} ORDER BY revision DESC LIMIT 1`,
      )
      .get(assetId, sourceHash, ...filter.params);
  }

  getTranscriptPage(
    assetId: string,
    sourceHash: string,
    options: TranscriptPageOptions = {},
  ): TranscriptPage {
    const bounds = page(options);
    const stored = this.transcript(assetId, sourceHash, options);
    if (!stored) return { ...bounds, total: 0 };
    const segments = this.database
      .prepare(
        "SELECT data FROM intelligence_segments WHERE revision=? ORDER BY position LIMIT ? OFFSET ?",
      )
      .all(stored.revision!, bounds.limit, bounds.offset)
      .map((row) => JSON.parse(String(row.data)));
    return {
      ...bounds,
      total: Number(stored.segment_count),
      document: validateTranscriptDocument(
        { ...JSON.parse(String(stored.header)), segments },
        this.source(assetId, sourceHash),
      ),
    };
  }

  /** Convenience bounded read; use getTranscriptPage when the total is needed. */
  getTranscript(
    assetId: string,
    sourceHash: string,
    options: TranscriptPageOptions = {},
  ) {
    return this.getTranscriptPage(assetId, sourceHash, options).document;
  }

  /** Internal use: materializes and validates the complete successful revision. */
  getFullTranscript(
    assetId: string,
    sourceHash: string,
    options: AnalysisCacheOptions = {},
  ): TranscriptDocument | undefined {
    const stored = this.transcript(assetId, sourceHash, options);
    if (!stored) return undefined;
    const segments = this.database
      .prepare(
        "SELECT data FROM intelligence_segments WHERE revision=? ORDER BY position",
      )
      .all(stored.revision!)
      .map((row) => JSON.parse(String(row.data)));
    return validateTranscriptDocument(
      { ...JSON.parse(String(stored.header)), segments },
      this.source(assetId, sourceHash),
    );
  }

  replaceTranscript(
    value: TranscriptDocument,
    options: {
      expectedRevision?: string | null;
    } & OwnedAnalysisCompletionOptions = {},
  ): void {
    const document = validateTranscriptDocument(value);
    this.validateCompletion(
      options.ownedCompletion,
      "transcribe",
      document.assetId,
    );
    const { segments, ...header } = document;
    this.transaction(() => {
      validateTranscriptDocument(
        document,
        this.source(document.assetId, document.provenance.sourceHash, true),
      );
      const provenance = document.provenance;
      const inserted = this.database
        .prepare(
          `INSERT INTO intelligence_transcripts
           (document_id,asset_id,source_hash,provider_id,provider_version,model,header,segment_count)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          document.id,
          document.assetId,
          provenance.sourceHash,
          provenance.providerId,
          provenance.version,
          provenance.model ?? "",
          JSON.stringify(header),
          segments.length,
        );
      const insert = this.database.prepare(
        "INSERT INTO intelligence_segments(revision,position,segment_id,start,end,text,data) VALUES(?,?,?,?,?,?,?)",
      );
      for (const [position, segment] of segments.entries())
        insert.run(
          inserted.lastInsertRowid,
          position,
          transcriptSegmentKey(segment.id),
          segment.start,
          segment.end,
          segment.text,
          JSON.stringify(segment),
        );
      recordTranscriptRevision(
        this.database,
        inserted.lastInsertRowid,
        document,
        options,
      );
      this.completeOwnedAnalysis(options.ownedCompletion);
    });
  }

  private cached(
    kind: "waveform" | "scenes",
    assetId: string,
    sourceHash: string,
    options: AnalysisCacheOptions,
  ): unknown | undefined {
    if (!this.source(assetId, sourceHash)) return undefined;
    const filter = cacheFilter(options);
    const stored = this.database
      .prepare(
        `SELECT data FROM intelligence_cache WHERE kind=? AND asset_id=? AND source_hash=?
         AND ${filter.sql} ORDER BY updated_seq DESC LIMIT 1`,
      )
      .get(kind, assetId, sourceHash, ...filter.params);
    return stored ? JSON.parse(String(stored.data)) : undefined;
  }

  private saveCache(
    kind: "waveform" | "scenes",
    value: WaveformData | SceneAnalysis,
    options: OwnedAnalysisCompletionOptions,
  ): void {
    this.validateCompletion(options.ownedCompletion, kind, value.assetId);
    this.transaction(() => {
      const source = this.source(
        value.assetId,
        value.provenance.sourceHash,
        true,
      );
      if (kind === "scenes") validateSceneAnalysis(value, source);
      const provenance = value.provenance;
      this.database
        .prepare(
          `INSERT INTO intelligence_cache(kind,asset_id,source_hash,provider_id,provider_version,model,data)
           VALUES(?,?,?,?,?,?,?) ON CONFLICT(kind,asset_id,source_hash,provider_id,provider_version,model)
           DO UPDATE SET data=excluded.data,updated_seq=excluded.updated_seq`,
        )
        .run(
          kind,
          value.assetId,
          provenance.sourceHash,
          provenance.providerId,
          provenance.version,
          provenance.model ?? "",
          JSON.stringify(value),
        );
      this.completeOwnedAnalysis(options.ownedCompletion);
    });
  }

  getWaveform(
    assetId: string,
    sourceHash: string,
    options: AnalysisCacheOptions = {},
  ): WaveformData | undefined {
    const value = this.cached("waveform", assetId, sourceHash, options);
    return value === undefined ? undefined : validateWaveformData(value);
  }

  saveWaveform(
    value: WaveformData,
    options: OwnedAnalysisCompletionOptions = {},
  ): void {
    this.saveCache("waveform", validateWaveformData(value), options);
  }

  getScenes(
    assetId: string,
    sourceHash: string,
    options: AnalysisCacheOptions = {},
  ): SceneAnalysis | undefined {
    const value = this.cached("scenes", assetId, sourceHash, options);
    return value === undefined
      ? undefined
      : validateSceneAnalysis(value, this.source(assetId, sourceHash));
  }

  saveScenes(
    value: SceneAnalysis,
    options: OwnedAnalysisCompletionOptions = {},
  ): void {
    this.saveCache("scenes", validateSceneAnalysis(value), options);
  }

  listMarkers(
    assetId: string,
    sourceHash: string,
    options: AnalysisCacheOptions = {},
  ): TimelineMarker[] {
    const source = this.source(assetId, sourceHash);
    if (!source) return [];
    const manual = this.database
      .prepare(
        "SELECT data FROM intelligence_markers WHERE asset_id=? AND source_hash=? ORDER BY time,id",
      )
      .all(assetId, sourceHash)
      .map((row) =>
        validateTimelineMarker(JSON.parse(String(row.data)), {
          ...source,
          assetId,
        }),
      );
    return [
      ...manual,
      ...(this.getScenes(assetId, sourceHash, options)?.markers ?? []),
    ].sort(
      (left, right) =>
        left.time - right.time || left.id.localeCompare(right.id),
    );
  }

  saveManualMarker(value: TimelineMarker, sourceHash: string): void {
    const marker = validateTimelineMarker(value);
    if (marker.type !== "manual")
      throw new Error("Only manual markers can be saved directly");
    this.transaction(() => {
      validateTimelineMarker(
        marker,
        this.source(marker.assetId, sourceHash, true),
      );
      const existing = this.database
        .prepare("SELECT asset_id FROM intelligence_markers WHERE id=?")
        .get(marker.id);
      if (existing && existing.asset_id !== marker.assetId)
        throw new Error("Marker ID belongs to another asset");
      this.database
        .prepare(
          `INSERT INTO intelligence_markers(id,asset_id,source_hash,time,data) VALUES(?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET source_hash=excluded.source_hash,time=excluded.time,data=excluded.data`,
        )
        .run(
          marker.id,
          marker.assetId,
          sourceHash,
          marker.time,
          JSON.stringify(marker),
        );
    });
  }

  removeMarker(assetId: string, markerId: string, sourceHash: string): void {
    text(markerId, "Marker ID");
    this.transaction(() => {
      this.source(assetId, sourceHash, true);
      this.database
        .prepare(
          "DELETE FROM intelligence_markers WHERE id=? AND asset_id=? AND source_hash=?",
        )
        .run(markerId, assetId, sourceHash);
    });
  }
}
