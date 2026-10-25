// Modified by OpenFilm contributors on 2026-10-25. See LICENSE and NOTICE.
import type { DatabaseSync } from "node:sqlite";

export type CatalogTablePolicy =
  "portable-semantic" | "local-operational" | "cache";

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
