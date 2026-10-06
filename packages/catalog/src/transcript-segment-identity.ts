import type { DatabaseSync } from "node:sqlite";
import { validateTranscriptSegmentId } from "@openfilm/core";

/** SQLite's UTF-8 binding replaces isolated UTF-16 surrogates. A JSON string
 * key escapes those code units and is injective for the established opaque ID
 * contract. Original IDs remain in segment JSON, never in this encoded form. */
export function transcriptSegmentKey(id: unknown): string {
  return JSON.stringify(validateTranscriptSegmentId(id));
}

/** Runs inside the complete catalog migration transaction. Rebuild instead of
 * updating keys in place: an old `foo` and `"foo"` may otherwise collide midway.
 * SQL copies every original non-key value without native TEXT decoding. */
export function migrateTranscriptSegmentIdentity(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE intelligence_segments_v4 (
      revision INTEGER NOT NULL REFERENCES intelligence_transcripts(revision) ON DELETE CASCADE,
      position INTEGER NOT NULL, segment_id TEXT NOT NULL,
      start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (revision, position), UNIQUE (revision, segment_id)
    );
  `);
  const insert = database.prepare(`
    INSERT INTO intelligence_segments_v4(revision,position,segment_id,start,end,text,data)
    SELECT revision,position,?,start,end,text,data FROM intelligence_segments
    WHERE revision=? AND position=?
  `);
  for (const row of database
    .prepare(
      "SELECT revision,position,data FROM intelligence_segments ORDER BY revision,position",
    )
    .iterate()) {
    const segment: unknown = JSON.parse(String(row.data));
    if (!segment || typeof segment !== "object" || Array.isArray(segment))
      throw new Error("Cannot migrate invalid transcript segment identity");
    insert.run(
      transcriptSegmentKey((segment as { id?: unknown }).id),
      row.revision!,
      row.position!,
    );
  }
  database.exec(`
    DROP TABLE intelligence_segments;
    ALTER TABLE intelligence_segments_v4 RENAME TO intelligence_segments;
  `);
}
