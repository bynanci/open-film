import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  validateSceneAnalysis,
  validateTimelineMarker,
  validateTranscriptDocument,
  validateWaveformData,
  type SceneAnalysis,
  type TimelineMarker,
  type TranscriptDocument,
  type WaveformData,
} from "@openfilm/core";
import { recordTranscriptRevision } from "./transcript-editor-store.js";
import { transcriptSegmentKey } from "./transcript-segment-identity.js";

export const CATALOG_SCHEMA_VERSION = 4;
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
    options: { expectedRevision?: string | null } = {},
  ): void {
    const document = validateTranscriptDocument(value);
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
  ): void {
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

  saveWaveform(value: WaveformData): void {
    this.saveCache("waveform", validateWaveformData(value));
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

  saveScenes(value: SceneAnalysis): void {
    this.saveCache("scenes", validateSceneAnalysis(value));
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
