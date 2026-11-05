import type { DatabaseSync } from "node:sqlite";

/** Tables introduced by catalog schema v6, ordered child-first for teardown. */
export const CATALOG_V6_TABLES = [
  "review_decisions",
  "analysis_result_members",
  "analysis_results",
  "analysis_runs",
  "verified_manifest_entries",
  "verified_manifests",
  "expected_manifest_entries",
  "expected_manifests",
  "import_batches",
  "asset_content_versions",
  "content_identities",
  "selection_memberships",
  "file_occurrences",
  "source_selections",
] as const;

/**
 * Current-schema fixtures must lose all later tables before they declare an
 * older user_version. Real old catalogs never contained these tables.
 */
export function dropCatalogV6Tables(database: DatabaseSync): void {
  database.exec(`
    DROP TRIGGER IF EXISTS asset_search_insert;
    DROP TRIGGER IF EXISTS asset_search_delete;
    DROP TRIGGER IF EXISTS asset_search_update;
    DROP TABLE IF EXISTS asset_search;
  `);
  if (
    database
      .prepare("PRAGMA table_info(assets)")
      .all()
      .some((column) => column.name === "search_tags")
  )
    database.exec("ALTER TABLE assets DROP COLUMN search_tags");
  for (const table of CATALOG_V6_TABLES)
    database.exec(`DROP TABLE IF EXISTS "${table}"`);
}
