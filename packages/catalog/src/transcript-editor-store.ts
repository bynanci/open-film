import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  ApplicationError,
  applyTranscriptCommand,
  compileTranscriptTextMatcher,
  validateTranscriptDocument,
  validateTranscriptSegmentId,
  type TranscriptCommand,
  type TranscriptDocument,
  type TranscriptRevision,
} from "@openfilm/core";
import { transcriptSegmentKey } from "./transcript-segment-identity.js";

export const TRANSCRIPT_HISTORY_LIMIT = 100;
const PAGE_LIMIT = 200;
export interface TranscriptEditorPage {
  document?: TranscriptDocument;
  revision?: string;
  revisionInfo?: TranscriptRevision;
  total: number;
  offset: number;
  limit: number;
  canUndo: boolean;
  canRedo: boolean;
  acknowledgedRevision?: string;
}
export interface TranscriptEditorPageOptions {
  offset?: number;
  limit?: number;
  revisionId?: string;
}
export interface TranscriptMutationInput {
  baseRevision: string;
  requestId: string;
  commands: TranscriptCommand[];
}
export interface TranscriptHistoryInput {
  baseRevision: string;
  requestId: string;
}
export interface TranscriptEditMetadata {
  source?: "user" | "glossary" | "review-suggestion";
  suggestionId?: string;
}
export interface TranscriptSearchOptions {
  query: string;
  caseSensitive?: boolean;
  offset?: number;
  limit?: number;
}
export interface TranscriptSearchResult {
  revision?: string;
  totalMatches: number;
  totalSegments: number;
  offset: number;
  limit: number;
  matches: Array<{
    segmentId: string;
    position: number;
    start: number;
    end: number;
    text: string;
    ranges: Array<{ start: number; end: number }>;
  }>;
}

/** Runs in the caller's catalog migration transaction. */
export function migrateTranscriptEditorSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE transcript_revision_metadata (
      sequence INTEGER PRIMARY KEY REFERENCES intelligence_transcripts(revision) ON DELETE CASCADE,
      revision_id TEXT NOT NULL UNIQUE, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      source_hash TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX transcript_revisions_source ON transcript_revision_metadata(asset_id,source_hash,sequence DESC);
    CREATE TABLE transcript_editor_history (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, source_hash TEXT NOT NULL,
      revision_id TEXT NOT NULL REFERENCES transcript_revision_metadata(revision_id),
      undo TEXT NOT NULL, redo TEXT NOT NULL, PRIMARY KEY(asset_id,source_hash)
    );
    CREATE TABLE transcript_edit_requests (
      request_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      source_hash TEXT NOT NULL, fingerprint TEXT NOT NULL,
      revision_id TEXT NOT NULL REFERENCES transcript_revision_metadata(revision_id)
    );
  `);
  const insert = database.prepare(
    "INSERT INTO transcript_revision_metadata(sequence,revision_id,asset_id,source_hash,data) VALUES(?,?,?,?,?)",
  );
  for (const row of database
    .prepare(
      "SELECT revision,asset_id,source_hash,header FROM intelligence_transcripts ORDER BY revision",
    )
    .iterate()) {
    const header = JSON.parse(String(row.header));
    const revision: TranscriptRevision = {
      id: `legacy-${row.revision}`,
      assetId: String(row.asset_id),
      source: "provider",
      createdAt: String(header.provenance.createdAt),
    };
    insert.run(
      row.revision!,
      revision.id,
      revision.assetId,
      row.source_hash!,
      JSON.stringify(revision),
    );
  }
}

function identifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new ApplicationError(
      "transcript.invalidCommand",
      `${label} must be a nonempty identifier of at most 256 characters.`,
    );
}
function bounds(options: { offset?: number; limit?: number }) {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? PAGE_LIMIT;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > PAGE_LIMIT
  )
    throw new ApplicationError(
      "transcript.invalidCommand",
      `Transcript pages require a nonnegative offset and a limit of 1–${PAGE_LIMIT}.`,
    );
  return { offset, limit };
}
function conflict(
  message = "The transcript changed. Reload the saved revision before applying this edit.",
): never {
  throw new ApplicationError("transcript.revisionConflict", message, 409);
}
function fingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => [key, canonical(value)]),
          )
        : item;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

/** The common provider insertion path records revisions without changing legacy document JSON. */
export function recordTranscriptRevision(
  database: DatabaseSync,
  sequence: SQLInputValue,
  document: TranscriptDocument,
  options: {
    expectedRevision?: string | null;
    revision?: TranscriptRevision;
  } = {},
): TranscriptRevision {
  const previous = database
    .prepare(
      `SELECT m.revision_id FROM transcript_revision_metadata m
    JOIN intelligence_transcripts t ON t.revision=m.sequence WHERE m.asset_id=? AND m.source_hash=? AND t.provider_version='1' AND m.sequence<? ORDER BY m.sequence DESC LIMIT 1`,
    )
    .get(document.assetId, document.provenance.sourceHash, sequence);
  const parent = previous ? String(previous.revision_id) : undefined;
  if (
    Object.hasOwn(options, "expectedRevision") &&
    (options.expectedRevision ?? undefined) !== parent
  )
    conflict(
      "The transcript changed while transcription was running. The previous revision is preserved.",
    );
  const revision: TranscriptRevision = options.revision ?? {
    id: randomUUID(),
    assetId: document.assetId,
    ...(parent ? { parentRevisionId: parent } : {}),
    source: "provider",
    createdAt: new Date().toISOString(),
  };
  identifier(revision.id, "revisionId");
  if (revision.assetId !== document.assetId)
    throw new ApplicationError(
      "transcript.invalidCommand",
      "Revision belongs to another media asset.",
    );
  database
    .prepare(
      "INSERT INTO transcript_revision_metadata(sequence,revision_id,asset_id,source_hash,data) VALUES(?,?,?,?,?)",
    )
    .run(
      sequence,
      revision.id,
      revision.assetId,
      document.provenance.sourceHash,
      JSON.stringify(revision),
    );
  if (revision.source === "provider")
    database
      .prepare(
        "DELETE FROM transcript_editor_history WHERE asset_id=? AND source_hash=?",
      )
      .run(document.assetId, document.provenance.sourceHash);
  return revision;
}

export class CatalogTranscriptEditorStore {
  constructor(private readonly database: DatabaseSync) {
    for (const [table, columns] of [
      [
        "transcript_revision_metadata",
        "sequence,revision_id,asset_id,source_hash,data",
      ],
      [
        "transcript_editor_history",
        "asset_id,source_hash,revision_id,undo,redo",
      ],
      [
        "transcript_edit_requests",
        "request_id,asset_id,source_hash,fingerprint,revision_id",
      ],
    ])
      database.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`);
  }

  private source(assetId: string, sourceHash: string) {
    identifier(assetId, "assetId");
    identifier(sourceHash, "sourceHash");
    const asset = this.database
      .prepare(
        "SELECT json_extract(data,'$.contentHash') AS hash,json_extract(data,'$.duration') AS duration FROM assets WHERE id=?",
      )
      .get(assetId);
    if (!asset)
      throw new ApplicationError("media.notFound", "Media not found.", 404);
    if (asset.hash !== null && asset.hash !== sourceHash)
      throw new ApplicationError(
        "source.changed",
        "The media source changed. Its historical transcript is preserved.",
        409,
      );
    return asset.duration === null ? {} : { duration: Number(asset.duration) };
  }
  private stored(assetId: string, sourceHash: string, revisionId?: string) {
    this.source(assetId, sourceHash);
    if (revisionId !== undefined) identifier(revisionId, "revisionId");
    const params: SQLInputValue[] = [assetId, sourceHash];
    if (revisionId) params.push(revisionId);
    return this.database
      .prepare(
        `SELECT t.revision,t.header,t.segment_count,m.revision_id,m.data AS revision_data
      FROM intelligence_transcripts t JOIN transcript_revision_metadata m ON m.sequence=t.revision
      WHERE t.asset_id=? AND t.source_hash=? AND t.provider_version='1' ${revisionId ? "AND m.revision_id=?" : ""}
      ORDER BY t.revision DESC LIMIT 1`,
      )
      .get(...params);
  }
  getFull(
    assetId: string,
    sourceHash: string,
    revisionId?: string,
  ):
    | { document: TranscriptDocument; revisionInfo: TranscriptRevision }
    | undefined {
    const stored = this.stored(assetId, sourceHash, revisionId);
    if (!stored) return undefined;
    const segments = this.database
      .prepare(
        "SELECT data FROM intelligence_segments WHERE revision=? ORDER BY position",
      )
      .all(stored.revision!)
      .map((row) => JSON.parse(String(row.data)));
    return {
      document: validateTranscriptDocument(
        { ...JSON.parse(String(stored.header)), segments },
        this.source(assetId, sourceHash),
      ),
      revisionInfo: JSON.parse(String(stored.revision_data)),
    };
  }
  get(
    assetId: string,
    sourceHash: string,
    options: TranscriptEditorPageOptions = {},
  ): TranscriptEditorPage {
    const page = bounds(options);
    const stored = this.stored(assetId, sourceHash, options.revisionId);
    if (!stored) {
      if (options.revisionId)
        throw new ApplicationError(
          "transcript.segmentNotFound",
          "Transcript revision not found.",
          404,
        );
      return { ...page, total: 0, canUndo: false, canRedo: false };
    }
    const segments = this.database
      .prepare(
        "SELECT data FROM intelligence_segments WHERE revision=? ORDER BY position LIMIT ? OFFSET ?",
      )
      .all(stored.revision!, page.limit, page.offset)
      .map((row) => JSON.parse(String(row.data)));
    const history = this.history(
      assetId,
      sourceHash,
      String(stored.revision_id),
    );
    return {
      ...page,
      total: Number(stored.segment_count),
      revision: String(stored.revision_id),
      revisionInfo: JSON.parse(String(stored.revision_data)),
      document: validateTranscriptDocument(
        { ...JSON.parse(String(stored.header)), segments },
        this.source(assetId, sourceHash),
      ),
      canUndo: history.undo.length > 0,
      canRedo: history.redo.length > 0,
    };
  }
  revisions(
    assetId: string,
    sourceHash: string,
    options: { offset?: number; limit?: number } = {},
  ) {
    this.source(assetId, sourceHash);
    const page = bounds(options);
    const total = Number(
      this.database
        .prepare(
          "SELECT count(*) AS count FROM transcript_revision_metadata WHERE asset_id=? AND source_hash=?",
        )
        .get(assetId, sourceHash)?.count,
    );
    const revisions = this.database
      .prepare(
        "SELECT data FROM transcript_revision_metadata WHERE asset_id=? AND source_hash=? ORDER BY sequence DESC LIMIT ? OFFSET ?",
      )
      .all(assetId, sourceHash, page.limit, page.offset)
      .map((row) => JSON.parse(String(row.data)) as TranscriptRevision);
    return { ...page, total, revisions };
  }
  getSegment(assetId: string, sourceHash: string, segmentId: string) {
    try {
      validateTranscriptSegmentId(segmentId);
    } catch {
      throw new ApplicationError(
        "transcript.invalidCommand",
        "segmentId must be a nonempty string.",
      );
    }
    const stored = this.stored(assetId, sourceHash);
    if (!stored)
      throw new ApplicationError(
        "transcript.segmentNotFound",
        "No transcript exists for this media.",
        404,
      );
    const row = this.database
      .prepare(
        "SELECT position,data FROM intelligence_segments WHERE revision=? AND segment_id=?",
      )
      .get(stored.revision!, transcriptSegmentKey(segmentId));
    if (!row)
      throw new ApplicationError(
        "transcript.segmentNotFound",
        "The transcript segment no longer exists.",
        404,
        { segmentId },
      );
    const segment = validateTranscriptDocument(
      {
        ...JSON.parse(String(stored.header)),
        segments: [JSON.parse(String(row.data))],
      },
      this.source(assetId, sourceHash),
    ).segments[0]!;
    return {
      segment,
      position: Number(row.position),
      revision: String(stored.revision_id),
    };
  }
  search(
    assetId: string,
    sourceHash: string,
    options: TranscriptSearchOptions,
  ): TranscriptSearchResult {
    const page = bounds(options);
    if (
      options.caseSensitive !== undefined &&
      typeof options.caseSensitive !== "boolean"
    )
      throw new ApplicationError(
        "transcript.invalidCommand",
        "caseSensitive must be boolean.",
      );
    const findMatches = compileTranscriptTextMatcher(
      options.query,
      options.caseSensitive ?? true,
    );
    const stored = this.stored(assetId, sourceHash);
    if (!stored)
      return { ...page, totalMatches: 0, totalSegments: 0, matches: [] };
    // Rows stream from SQLite and matching returns a bounded result page; no full transcript
    // is materialized. JS Unicode case folding is shared with replacement, unlike SQLite's ASCII LIKE.
    const matches: TranscriptSearchResult["matches"] = [];
    let totalMatches = 0,
      totalSegments = 0;
    const sensitive = options.caseSensitive ?? true;
    const segmentData = this.database.prepare(
      "SELECT data FROM intelligence_segments WHERE revision=? AND position=?",
    );
    const rows = this.database
      .prepare(
        `SELECT position,start,end,text,
          CASE WHEN instr(text,char(0))>0 OR instr(text,char(65533))>0
            THEN data -> '$.text' ELSE NULL END AS canonical_text
          FROM intelligence_segments WHERE revision=? ${sensitive ? "AND instr(text,?)>0" : ""} ORDER BY position`,
      )
      .iterate(
        ...(sensitive ? [stored.revision!, options.query] : [stored.revision!]),
      );
    for (const row of rows) {
      // Native TEXT truncates NUL and normalizes isolated surrogates to U+FFFD.
      // Recover only those rows' escaped canonical text before matching; ordinary
      // rows still avoid JSON parsing, and full segment reads stay page-bounded.
      const text: string =
          row.canonical_text === null
            ? String(row.text)
            : JSON.parse(String(row.canonical_text)),
        ranges = findMatches(text);
      if (!ranges.length) continue;
      if (totalSegments >= page.offset && matches.length < page.limit) {
        // Native SQLite TEXT reads truncate embedded NULs. The canonical JSON
        // escapes them and preserves opaque provider IDs. Read/parse only the
        // bounded result page through the revision/position primary-key index.
        const segment = JSON.parse(
          String(segmentData.get(stored.revision!, row.position!)!.data),
        );
        matches.push({
          segmentId: validateTranscriptSegmentId(segment.id),
          position: Number(row.position),
          start: Number(row.start),
          end: Number(row.end),
          text,
          ranges,
        });
      }
      totalSegments++;
      totalMatches += ranges.length;
    }
    return {
      ...page,
      revision: String(stored.revision_id),
      totalMatches,
      totalSegments,
      matches,
    };
  }
  private history(
    assetId: string,
    sourceHash: string,
    revision: string,
  ): { undo: string[]; redo: string[] } {
    const row = this.database
      .prepare(
        "SELECT revision_id,undo,redo FROM transcript_editor_history WHERE asset_id=? AND source_hash=?",
      )
      .get(assetId, sourceHash);
    return row?.revision_id === revision
      ? {
          undo: JSON.parse(String(row.undo)),
          redo: JSON.parse(String(row.redo)),
        }
      : { undo: [], redo: [] };
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
  edit(
    assetId: string,
    sourceHash: string,
    input: TranscriptMutationInput,
    metadata: TranscriptEditMetadata = {},
    commitHook?: () => void,
  ): TranscriptEditorPage {
    if (
      !Array.isArray(input.commands) ||
      !input.commands.length ||
      input.commands.length > 100
    )
      throw new ApplicationError(
        "transcript.invalidCommand",
        "Apply between 1 and 100 transcript commands per request.",
      );
    return this.mutate(
      assetId,
      sourceHash,
      input,
      "edit",
      { commands: input.commands, metadata },
      (before, history) => {
        let document = before.document;
        for (const command of input.commands)
          document = applyTranscriptCommand(document, command);
        return {
          document,
          history: {
            undo: [...history.undo, before.revisionInfo.id].slice(
              -TRANSCRIPT_HISTORY_LIMIT,
            ),
            redo: [],
          },
          metadata,
        };
      },
      commitHook,
    );
  }
  undo(assetId: string, sourceHash: string, input: TranscriptHistoryInput) {
    return this.travel(assetId, sourceHash, input, "undo");
  }
  redo(assetId: string, sourceHash: string, input: TranscriptHistoryInput) {
    return this.travel(assetId, sourceHash, input, "redo");
  }
  selectRevision(
    assetId: string,
    sourceHash: string,
    input: TranscriptHistoryInput & { revisionId: string },
  ) {
    identifier(input.revisionId, "revisionId");
    return this.mutate(
      assetId,
      sourceHash,
      input,
      "select-revision",
      { revisionId: input.revisionId },
      (before, history) => {
        const selected = this.getFull(assetId, sourceHash, input.revisionId);
        if (!selected)
          throw new ApplicationError(
            "transcript.segmentNotFound",
            "Transcript revision not found.",
            404,
          );
        return {
          document: selected.document,
          history: {
            undo: [...history.undo, before.revisionInfo.id].slice(
              -TRANSCRIPT_HISTORY_LIMIT,
            ),
            redo: [],
          },
          metadata: { source: "user" },
        };
      },
    );
  }
  private travel(
    assetId: string,
    sourceHash: string,
    input: TranscriptHistoryInput,
    direction: "undo" | "redo",
  ) {
    return this.mutate(
      assetId,
      sourceHash,
      input,
      direction,
      {},
      (before, history) => {
        const token = history[direction].at(-1);
        if (!token) conflict(`Nothing to ${direction}.`);
        const next = this.getFull(assetId, sourceHash, token);
        if (!next) conflict("Transcript history is unavailable.");
        const opposite = direction === "undo" ? "redo" : "undo";
        return {
          document: next.document,
          history: {
            ...history,
            [direction]: history[direction].slice(0, -1),
            [opposite]: [...history[opposite], before.revisionInfo.id].slice(
              -TRANSCRIPT_HISTORY_LIMIT,
            ),
          },
          metadata: { source: "user" },
        };
      },
    );
  }
  private mutate(
    assetId: string,
    sourceHash: string,
    input: TranscriptHistoryInput,
    kind: string,
    payload: unknown,
    produce: (
      before: {
        document: TranscriptDocument;
        revisionInfo: TranscriptRevision;
      },
      history: { undo: string[]; redo: string[] },
    ) => {
      document: TranscriptDocument;
      history: { undo: string[]; redo: string[] };
      metadata: TranscriptEditMetadata;
    },
    commitHook?: () => void,
  ): TranscriptEditorPage {
    identifier(input.baseRevision, "baseRevision");
    identifier(input.requestId, "requestId");
    const digest = fingerprint({
      assetId,
      sourceHash,
      baseRevision: input.baseRevision,
      kind,
      payload,
    });
    let acknowledgedRevision: string | undefined;
    this.transaction(() => {
      this.source(assetId, sourceHash);
      const receipt = this.database
        .prepare(
          "SELECT fingerprint,revision_id FROM transcript_edit_requests WHERE request_id=?",
        )
        .get(input.requestId);
      if (receipt) {
        if (receipt.fingerprint !== digest)
          conflict(
            "This request ID was already used for another transcript command.",
          );
        acknowledgedRevision = String(receipt.revision_id);
        return;
      }
      const before = this.getFull(assetId, sourceHash);
      if (!before)
        throw new ApplicationError(
          "transcript.segmentNotFound",
          "No transcript exists for this media.",
          404,
        );
      if (before.revisionInfo.id !== input.baseRevision) conflict();
      const next = produce(
        before,
        this.history(assetId, sourceHash, before.revisionInfo.id),
      );
      const source = next.metadata.source ?? "user";
      if (!["user", "glossary", "review-suggestion"].includes(source))
        throw new ApplicationError(
          "transcript.invalidCommand",
          "Unknown transcript revision source.",
        );
      if (next.metadata.suggestionId !== undefined)
        identifier(next.metadata.suggestionId, "suggestionId");
      const revision: TranscriptRevision = {
        id: randomUUID(),
        assetId,
        parentRevisionId: before.revisionInfo.id,
        source,
        createdAt: new Date().toISOString(),
        ...(next.metadata.suggestionId
          ? { suggestionId: next.metadata.suggestionId }
          : {}),
      };
      const document = validateTranscriptDocument(
        { ...next.document, id: revision.id },
        this.source(assetId, sourceHash),
      );
      const { segments, ...header } = document,
        provenance = document.provenance;
      const inserted = this.database
        .prepare(
          `INSERT INTO intelligence_transcripts(document_id,asset_id,source_hash,provider_id,provider_version,model,header,segment_count) VALUES(?,?,?,?,?,?,?,?)`,
        )
        .run(
          document.id,
          assetId,
          sourceHash,
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
        { expectedRevision: input.baseRevision, revision },
      );
      this.database
        .prepare(
          `INSERT INTO transcript_editor_history(asset_id,source_hash,revision_id,undo,redo) VALUES(?,?,?,?,?) ON CONFLICT(asset_id,source_hash) DO UPDATE SET revision_id=excluded.revision_id,undo=excluded.undo,redo=excluded.redo`,
        )
        .run(
          assetId,
          sourceHash,
          revision.id,
          JSON.stringify(next.history.undo),
          JSON.stringify(next.history.redo),
        );
      this.database
        .prepare(
          "INSERT INTO transcript_edit_requests(request_id,asset_id,source_hash,fingerprint,revision_id) VALUES(?,?,?,?,?)",
        )
        .run(input.requestId, assetId, sourceHash, digest, revision.id);
      commitHook?.();
    });
    return {
      ...this.get(assetId, sourceHash),
      ...(acknowledgedRevision ? { acknowledgedRevision } : {}),
    };
  }
}
