import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  validateMediaAsset,
  validateProxyCacheTask,
  type Job,
  type MediaAsset,
} from "@openfilm/core";
import {
  CATALOG_SCHEMA_VERSION,
  CatalogIntelligenceStore,
  migrateIntelligenceSchema,
} from "./intelligence-store.js";
import {
  CatalogTranscriptEditorStore,
  migrateTranscriptEditorSchema,
} from "./transcript-editor-store.js";
import {
  CatalogKnowledgeStore,
  migrateKnowledgeSchema,
  migrateSceneScriptReviewSchema,
} from "./knowledge-store.js";
import { migrateTranscriptSegmentIdentity } from "./transcript-segment-identity.js";
import {
  CatalogMultiSourceStore,
  migrateMultiSourceSchema,
  sanitizePortableMultiSourceRows,
  validateMultiSourceSchema,
} from "./multi-source-store.js";

export * from "./transcript-editor-store.js";
export * from "./knowledge-store.js";
export * from "./multi-source-store.js";

export {
  CATALOG_SCHEMA_VERSION,
  CatalogIntelligenceStore,
  INTELLIGENCE_CACHE_VERSION,
  TRANSCRIPT_PAGE_LIMIT,
  type AnalysisCacheOptions,
  type OwnedAnalysisCompletionOptions,
  type TranscriptPage,
  type TranscriptPageOptions,
} from "./intelligence-store.js";

export interface AssetListOptions {
  offset?: number;
  limit?: number;
  order?: "chronological" | "name" | "rating" | "newest";
  mediaType?: MediaAsset["mediaType"];
  favorite?: boolean;
  rejected?: boolean;
  locked?: boolean;
  query?: string;
  search?: string;
  ids?: string[];
  state?: { favorite?: boolean; rejected?: boolean; locked?: boolean };
}

export interface JobListOptions {
  type?: string;
  assetId?: string;
  statuses?: Job["status"][];
  limit?: number;
  offset?: number;
  oldestFirst?: boolean;
  proxyRequestId?: string;
}

export interface CatalogRelinkChange {
  assetId: string;
  expectedUri: string;
  expectedContentHash?: string;
  newUri: string;
  reference: Record<string, unknown>;
  /** Fresh technical metadata for a confirmed relink with no prior content hash. */
  inspected?: MediaAsset;
}

export const CATALOG_SNAPSHOT_MAX_BYTES = 256 * 1024 * 1024;

export interface CatalogSnapshotInspection {
  schemaVersion: number;
  logicalRevision: string;
  assets: MediaAsset[];
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function withSnapshotDatabase<T>(
  image: Uint8Array,
  read: (database: DatabaseSync, path: string) => T,
): T {
  if (image.length === 0 || image.length > CATALOG_SNAPSHOT_MAX_BYTES)
    throw new Error("Catalog snapshot exceeds its size limit.");
  const directory = mkdtempSync(join(tmpdir(), "openfilm-catalog-snapshot-"));
  const path = join(directory, "database.sqlite");
  let copy: DatabaseSync | undefined;
  try {
    writeFileSync(path, image, { flag: "wx", mode: 0o600 });
    copy = new DatabaseSync(path);
    return read(copy, path);
  } finally {
    try {
      copy?.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

function validateDeclaredCatalogSchema(
  database: DatabaseSync,
  version: number,
): void {
  if (version >= 2) new CatalogIntelligenceStore(database);
  if (version >= 3) {
    new CatalogTranscriptEditorStore(database);
    new CatalogKnowledgeStore(database, version >= 5);
  }
  if (version >= 6) validateMultiSourceSchema(database);
}

function migrateCatalogDatabase(database: DatabaseSync, version: number): void {
  if (version >= CATALOG_SCHEMA_VERSION) return;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, uri TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        media_type TEXT NOT NULL, captured_at TEXT, rating REAL,
        favorite INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0,
        locked INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assets_capture ON assets(captured_at, id);
      CREATE INDEX IF NOT EXISTS assets_media_type ON assets(media_type);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL);
    `);
    if (version < 2) migrateIntelligenceSchema(database);
    if (version < 3) {
      migrateTranscriptEditorSchema(database);
      migrateKnowledgeSchema(database);
    }
    if (version < 4) migrateTranscriptSegmentIdentity(database);
    if (version < 5) migrateSceneScriptReviewSchema(database);
    if (version < 6) migrateMultiSourceSchema(database);
    database.exec(`PRAGMA user_version=${CATALOG_SCHEMA_VERSION}; COMMIT;`);
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function validateCatalogDatabase(
  database: DatabaseSync,
  expectedSchemaVersion: number,
): void {
  const integrity = database.prepare("PRAGMA integrity_check").all();
  if (
    integrity.length !== 1 ||
    integrity[0]?.integrity_check !== "ok" ||
    Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0) !==
      expectedSchemaVersion
  )
    throw new Error("Catalog snapshot failed its integrity or schema check.");
  if (database.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("Catalog snapshot has invalid foreign-key references.");
}

function canonicalSchemaSql(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let result = "";
  let quote: "'" | '"' | "`" | "]" | undefined;
  let whitespace = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (quote) {
      result += character;
      if (character === quote) {
        if (quote !== "]" && value[index + 1] === quote)
          result += value[++index]!;
        else quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      if (whitespace && result) result += " ";
      whitespace = false;
      quote = character;
      result += character;
      continue;
    }
    if (character === "[") {
      if (whitespace && result) result += " ";
      whitespace = false;
      quote = "]";
      result += character;
      continue;
    }
    const point = character.codePointAt(0)!;
    if (
      point === 0x09 ||
      point === 0x0a ||
      point === 0x0b ||
      point === 0x0c ||
      point === 0x0d ||
      point === 0x20
    ) {
      whitespace = true;
      continue;
    }
    if (whitespace && result) result += " ";
    whitespace = false;
    result += character;
  }
  return result.trim();
}

function catalogSchema(
  database: DatabaseSync,
  namespace: "main" | "version_snapshot" = "main",
): unknown {
  const objects = database
    .prepare(
      `SELECT type,name,tbl_name,sql FROM ${namespace}.sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`,
    )
    .all()
    .map((row) => ({
      type: String(row.type),
      name: String(row.name),
      tbl_name: String(row.tbl_name),
      sql: canonicalSchemaSql(row.sql),
    }));
  const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const pragma = (name: string, value: string) =>
    database.prepare(`PRAGMA ${namespace}.${name}(${quoted(value)})`).all();
  const tables = objects
    .filter((row) => row.type === "table")
    .map((row) => String(row.name))
    .sort()
    .map((table) => ({
      table,
      columns: pragma("table_xinfo", table),
      foreignKeys: pragma("foreign_key_list", table),
      indexes: pragma("index_list", table)
        .map((index) => ({
          name: String(index.name),
          unique: index.unique,
          origin: index.origin,
          partial: index.partial,
          columns: pragma("index_xinfo", String(index.name)),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    }));
  return { objects, tables };
}

function logicalCatalogRevision(database: DatabaseSync): string {
  const schema = catalogSchema(database);
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row.name));
  const rows = tables.map((table) => {
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return [
      table,
      database
        .prepare(`SELECT * FROM ${quoted}`)
        .all()
        .map((row) => JSON.stringify(row))
        .sort(),
    ];
  });
  return createHash("sha256")
    .update(
      JSON.stringify({
        schema,
        rows,
        version: database.prepare("PRAGMA user_version").get(),
      }),
    )
    .digest("hex");
}

/** Read a saved image through a private file-backed SQLite connection. */
export function inspectCatalogSnapshot(
  image: Uint8Array,
  expectedSchemaVersion: number,
): CatalogSnapshotInspection {
  return withSnapshotDatabase(image, (database) => {
    validateCatalogDatabase(database, expectedSchemaVersion);
    const schemaVersion = Number(
      database.prepare("PRAGMA user_version").get()?.user_version ?? 0,
    );
    const assets = database
      .prepare("SELECT data FROM assets ORDER BY id")
      .all()
      .map((row) => JSON.parse(String(row.data)) as MediaAsset);
    return {
      schemaVersion,
      logicalRevision: logicalCatalogRevision(database),
      assets,
    };
  });
}

/**
 * Upgrade an immutable historical image through a private temporary copy.
 * The caller's bytes are never changed and remain the integrity authority.
 */
export function upgradeCatalogSnapshot(
  image: Uint8Array,
  expectedSourceVersion: number,
): Buffer {
  if (
    !Number.isSafeInteger(expectedSourceVersion) ||
    expectedSourceVersion < 1 ||
    expectedSourceVersion > CATALOG_SCHEMA_VERSION
  )
    throw new Error("Catalog snapshot has an unsupported schema version.");
  return withSnapshotDatabase(image, (database, path) => {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    validateCatalogDatabase(database, expectedSourceVersion);
    validateDeclaredCatalogSchema(database, expectedSourceVersion);
    migrateCatalogDatabase(database, expectedSourceVersion);
    validateDeclaredCatalogSchema(database, CATALOG_SCHEMA_VERSION);
    validateCatalogDatabase(database, CATALOG_SCHEMA_VERSION);
    const mode = String(
      database.prepare("PRAGMA journal_mode=DELETE").get()?.journal_mode ?? "",
    ).toLowerCase();
    if (mode !== "delete")
      throw new Error("Catalog snapshot could not be finalized safely.");
    database.exec("VACUUM;");
    const result = readFileSync(path);
    validateCatalogDatabase(database, CATALOG_SCHEMA_VERSION);
    return Buffer.from(result);
  });
}

/**
 * Build a portable catalog image containing only the explicitly selected
 * media rows. Transcript revisions for those assets remain available, while
 * transient jobs, caches, suggestions and unrelated catalog rows are omitted.
 * URI rewriting is supplied by the application so paths remain package-local.
 */
export function createPortableCatalogSnapshot(
  image: Uint8Array,
  expectedSchemaVersion: number,
  assets: readonly MediaAsset[],
): Buffer {
  if (assets.length > 10_000)
    throw new Error("Portable catalog exceeds its asset count limit.");
  const ids = new Set<string>();
  for (const asset of assets) {
    validateMediaAsset(asset);
    if (ids.has(asset.id))
      throw new Error("Portable catalog has duplicate asset identifiers.");
    ids.add(asset.id);
  }
  if (image.length === 0 || image.length > CATALOG_SNAPSHOT_MAX_BYTES)
    throw new Error("Catalog snapshot exceeds its size limit.");
  const directory = mkdtempSync(join(tmpdir(), "openfilm-portable-catalog-"));
  const path = join(directory, "database.sqlite");
  let database: DatabaseSync | undefined;
  try {
    writeFileSync(path, image, { flag: "wx", mode: 0o600 });
    database = new DatabaseSync(path);
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    validateCatalogDatabase(database, expectedSchemaVersion);
    database.exec("BEGIN IMMEDIATE;");
    try {
      database.exec(`
        CREATE TEMP TABLE collect_selected_assets(id TEXT PRIMARY KEY);
        DELETE FROM intelligence_cache;
        DELETE FROM intelligence_markers;
        DELETE FROM review_suggestions;
        DELETE FROM review_batches;
        DELETE FROM scene_script_suggestions;
        DELETE FROM project_glossary;
        DELETE FROM jobs;
      `);
      const insertId = database.prepare(
        "INSERT INTO collect_selected_assets(id) VALUES(?)",
      );
      for (const id of ids) insertId.run(id);
      database.exec(`
        CREATE TEMP TABLE collect_selected_bindings(id TEXT PRIMARY KEY);
        INSERT INTO collect_selected_bindings(id)
          SELECT id FROM asset_content_versions
          WHERE asset_id IN (SELECT id FROM collect_selected_assets);

        CREATE TEMP TABLE collect_selected_manifests(id TEXT PRIMARY KEY);
        INSERT INTO collect_selected_manifests(id)
          SELECT verified.id
          FROM verified_manifests AS verified
          WHERE EXISTS (
            SELECT 1 FROM verified_manifest_entries AS member
            WHERE member.manifest_id=verified.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM verified_manifest_entries AS member
            WHERE member.manifest_id=verified.id
              AND (
                member.status!='verified'
                OR member.binding_id NOT IN (SELECT id FROM collect_selected_bindings)
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM expected_manifest_entries AS expected
            WHERE expected.manifest_id=verified.expected_manifest_id
              AND (
                expected.included!=1
                OR NOT EXISTS (
                  SELECT 1
                  FROM verified_manifest_entries AS member
                  JOIN asset_content_versions AS binding ON binding.id=member.binding_id
                  WHERE member.manifest_id=verified.id
                    AND member.status='verified'
                    AND binding.occurrence_id=expected.occurrence_id
                )
              )
          );

        CREATE TEMP TABLE collect_selected_runs(id TEXT PRIMARY KEY);
        INSERT INTO collect_selected_runs(id)
          SELECT run.id
          FROM analysis_runs AS run
          WHERE run.manifest_id IN (SELECT id FROM collect_selected_manifests)
            AND NOT EXISTS (
              SELECT 1 FROM analysis_results AS result
              WHERE result.run_id=run.id
                AND (
                  NOT EXISTS (
                    SELECT 1 FROM analysis_result_members AS member
                    WHERE member.result_id=result.id
                  )
                  OR EXISTS (
                    SELECT 1 FROM analysis_result_members AS member
                    WHERE member.result_id=result.id
                      AND member.binding_id NOT IN (SELECT id FROM collect_selected_bindings)
                  )
                )
            );

        DELETE FROM review_decisions
          WHERE base_run_id NOT IN (SELECT id FROM collect_selected_runs);
        DELETE FROM analysis_runs
          WHERE id NOT IN (SELECT id FROM collect_selected_runs);
        DELETE FROM verified_manifests
          WHERE id NOT IN (SELECT id FROM collect_selected_manifests);
        DELETE FROM expected_manifests
          WHERE id NOT IN (
            SELECT expected_manifest_id FROM verified_manifests
          );
        DELETE FROM import_batches
          WHERE id NOT IN (SELECT batch_id FROM expected_manifests);

        DELETE FROM assets
          WHERE id NOT IN (SELECT id FROM collect_selected_assets);
        DELETE FROM selection_memberships
          WHERE occurrence_id NOT IN (
            SELECT occurrence_id FROM asset_content_versions
          );
        DELETE FROM source_selections
          WHERE id NOT IN (SELECT selection_id FROM selection_memberships);
        DELETE FROM file_occurrences
          WHERE id NOT IN (SELECT occurrence_id FROM asset_content_versions);
        DELETE FROM content_identities
          WHERE id NOT IN (SELECT content_id FROM asset_content_versions);
      `);
      sanitizePortableMultiSourceRows(database);
      const update = database.prepare(`
        UPDATE assets SET uri=?,name=?,media_type=?,captured_at=?,rating=?,
          favorite=?,rejected=?,locked=?,data=? WHERE id=?
      `);
      for (const asset of assets) {
        const result = update.run(
          asset.uri,
          asset.name,
          asset.mediaType,
          asset.capturedAt ? new Date(asset.capturedAt).toISOString() : null,
          asset.rating ?? null,
          Number(Boolean(asset.state.favorite)),
          Number(Boolean(asset.state.rejected)),
          Number(Boolean(asset.state.locked)),
          JSON.stringify(asset),
          asset.id,
        );
        if (Number(result.changes) !== 1)
          throw new Error(`Portable catalog source was not found: ${asset.id}`);
      }
      database.exec("COMMIT;");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK;");
      throw error;
    }
    const actualIds = database
      .prepare("SELECT id FROM assets ORDER BY id")
      .all()
      .map((row) => String(row.id));
    if (
      actualIds.length !== assets.length ||
      actualIds.some((id) => !ids.has(id))
    )
      throw new Error("Portable catalog contains an unexpected media row.");
    // SQLite keeps deleted payloads in free pages until VACUUM. Rebuild the
    // projected catalog so omitted assets cannot be recovered from slack space.
    database.exec("VACUUM;");
    const mode = String(
      database.prepare("PRAGMA journal_mode=DELETE").get()?.journal_mode ?? "",
    ).toLowerCase();
    if (mode !== "delete")
      throw new Error("Portable catalog could not be finalized safely.");
    validateCatalogDatabase(database, expectedSchemaVersion);
    database.close();
    database = undefined;
    const result = readFileSync(path);
    validateCatalogImage(result, expectedSchemaVersion);
    return result;
  } finally {
    try {
      database?.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

function validateCatalogImage(
  image: Buffer,
  expectedSchemaVersion: number,
): void {
  withSnapshotDatabase(image, (database) =>
    validateCatalogDatabase(database, expectedSchemaVersion),
  );
}

function relinkError(
  status: number,
  message: string,
): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function fileUri(value: unknown): asserts value is string {
  if (
    typeof value === "string" &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    try {
      if (new URL(value).protocol === "file:") return;
    } catch {
      // Report malformed URLs through the same validation error below.
    }
  }
  throw relinkError(400, "Relinking requires local file URIs");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function id(value: string): void {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error(
      "Asset or job ID must be a nonempty string of at most 256 characters",
    );
  }
}

function validateAsset(asset: MediaAsset): void {
  validateMediaAsset(asset);
  id(asset.id);
  if (!["image", "video", "audio", "360-video"].includes(asset.mediaType))
    throw new Error("Invalid media type");
  if (typeof asset.uri !== "string" || !asset.uri.startsWith("file:"))
    throw new Error("Assets must reference a local file URI");
  if (
    typeof asset.name !== "string" ||
    !Array.isArray(asset.tags) ||
    asset.tags.some((tag) => typeof tag !== "string")
  )
    throw new Error("Invalid asset name or tags");
  if (
    !asset.state ||
    typeof asset.state !== "object" ||
    !asset.metadata ||
    typeof asset.metadata !== "object"
  )
    throw new Error("Asset state and metadata are required");
  if (
    asset.rating !== undefined &&
    (!Number.isFinite(asset.rating) || asset.rating < 0 || asset.rating > 5)
  )
    throw new Error("Rating must be between 0 and 5");
  for (const [key, value] of Object.entries(asset.state)) {
    if (
      !["favorite", "rejected", "locked"].includes(key) ||
      typeof value !== "boolean"
    )
      throw new Error("Invalid asset state");
  }
}

function assetFilter(
  options: Omit<AssetListOptions, "offset" | "limit" | "order">,
): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (options.mediaType !== undefined) {
    if (!["image", "video", "audio", "360-video"].includes(options.mediaType))
      throw new Error("Unsupported media type filter");
    clauses.push("media_type=?");
    params.push(options.mediaType);
  }
  for (const flag of ["favorite", "rejected", "locked"] as const) {
    const value = options[flag] ?? options.state?.[flag];
    if (value !== undefined) {
      if (typeof value !== "boolean")
        throw new Error("State filters must be boolean");
      clauses.push(`${flag}=?`);
      params.push(Number(value));
    }
  }
  if (options.ids) {
    if (options.ids.length > 10000)
      throw new Error("Resolve at most 10000 asset IDs per page");
    options.ids.forEach(id);
    clauses.push(
      options.ids.length
        ? `id IN (${options.ids.map(() => "?").join(",")})`
        : "0",
    );
    params.push(...options.ids);
  }
  const search = options.query ?? options.search;
  if (search) {
    clauses.push(
      "(name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM json_each(assets.data,'$.tags') WHERE value LIKE ? ESCAPE '\\'))",
    );
    const query = `%${search.replace(/[\\%_]/gu, "\\$&")}%`;
    params.push(query, query);
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

/** SQLite is an adapter, never a dependency of the portable domain. */
export class ProjectCatalog {
  private database: DatabaseSync;
  private readonly databasePath: string;
  readonly intelligence: CatalogIntelligenceStore;
  readonly transcripts: CatalogTranscriptEditorStore;
  readonly knowledge: CatalogKnowledgeStore;
  readonly multiSource: CatalogMultiSourceStore;

  constructor(directory: string) {
    if (
      lstatSync(directory).isSymbolicLink() ||
      !lstatSync(directory).isDirectory()
    )
      throw new Error("Catalog directory cannot be a symlink");
    const path = join(directory, "database.sqlite");
    if (
      existsSync(path) &&
      (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile())
    )
      throw new Error("Catalog database must be a regular file");
    this.databasePath = path;
    this.database = new DatabaseSync(path);
    try {
      const version = Number(
        this.database.prepare("PRAGMA user_version").get()?.user_version ?? 0,
      );
      if (version > CATALOG_SCHEMA_VERSION)
        throw new Error(
          `Unsupported future catalog schema ${version}; use a newer OpenFilm version`,
        );
      this.database.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        PRAGMA busy_timeout=5000;
      `);
      // Verify older schemas before migrating; missing tables must not be
      // silently recreated and relabeled as a healthy project.
      validateDeclaredCatalogSchema(this.database, version);
      migrateCatalogDatabase(this.database, version);
      validateDeclaredCatalogSchema(this.database, CATALOG_SCHEMA_VERSION);
      this.intelligence = new CatalogIntelligenceStore(this.database);
      this.transcripts = new CatalogTranscriptEditorStore(this.database);
      this.knowledge = new CatalogKnowledgeStore(this.database);
      this.multiSource = new CatalogMultiSourceStore(this.database);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  /**
   * Capture the saved catalog while blocking project readers and writers.
   * Switching out of WAL checkpoints committed pages into the main file; an
   * exclusive transaction then keeps that file stable while it is copied.
   * The callback must be synchronous and may only read this catalog; publish
   * the result only after this method returns successfully.
   */
  withConsistentSnapshot<T>(
    capture: (image: Buffer, schemaVersion: number) => T,
  ): T {
    if (this.database.isTransaction)
      throw new Error("Cannot capture a nested catalog snapshot.");
    const previousMode = String(
      this.database.prepare("PRAGMA journal_mode").get()?.journal_mode ?? "",
    ).toLowerCase();
    let transaction = false;
    let result: T;
    const cleanup = () => {
      const errors: unknown[] = [];
      try {
        if (transaction && this.database.isTransaction)
          this.database.exec("ROLLBACK");
      } catch (error) {
        errors.push(error);
      }
      try {
        if (previousMode === "wal") {
          const mode = String(
            this.database.prepare("PRAGMA journal_mode=WAL").get()
              ?.journal_mode ?? "",
          ).toLowerCase();
          if (mode !== "wal")
            throw new Error("Project catalog could not return to WAL mode.");
        }
      } catch (error) {
        errors.push(error);
      }
      if (errors.length)
        throw new AggregateError(errors, "Catalog snapshot cleanup failed.");
    };
    try {
      if (previousMode === "wal") {
        const mode = String(
          this.database.prepare("PRAGMA journal_mode=DELETE").get()
            ?.journal_mode ?? "",
        ).toLowerCase();
        if (mode !== "delete")
          throw new Error("Another process is using the project catalog.");
      }
      this.database.exec("BEGIN EXCLUSIVE");
      transaction = true;
      const schemaVersion = Number(
        this.database.prepare("PRAGMA user_version").get()?.user_version ?? 0,
      );
      if (schemaVersion !== CATALOG_SCHEMA_VERSION)
        throw new Error("Catalog schema changed before snapshot capture.");
      const info = lstatSync(this.databasePath);
      if (
        info.isSymbolicLink() ||
        !info.isFile() ||
        info.size <= 0 ||
        info.size > CATALOG_SNAPSHOT_MAX_BYTES
      )
        throw new Error("Catalog snapshot exceeds its size limit.");
      const image = readFileSync(this.databasePath);
      validateCatalogImage(image, schemaVersion);
      const captured = capture(Buffer.from(image), schemaVersion);
      if (isPromiseLike(captured))
        throw new Error("Catalog snapshot callback must be synchronous.");
      result = captured;
    } catch (error) {
      try {
        cleanup();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Catalog snapshot capture and cleanup failed.",
          { cause: cleanupError },
        );
      }
      throw error;
    }
    cleanup();
    return result;
  }

  /** Replace catalog rows in the current connection inside one SQLite transaction. */
  restoreFromSnapshot(
    snapshotPath: string,
    publishManifest?: () => void,
    assertCurrent?: () => void,
    snapshotSchemaVersion = CATALOG_SCHEMA_VERSION,
  ): void {
    if (this.database.isTransaction)
      throw new Error("Cannot restore a nested catalog snapshot.");
    if (resolve(snapshotPath) === resolve(this.databasePath))
      throw new Error("A project catalog cannot restore itself.");
    const snapshotInfo = lstatSync(snapshotPath);
    if (snapshotInfo.isSymbolicLink() || !snapshotInfo.isFile())
      throw new Error("Catalog snapshot must be a regular file.");
    if (
      snapshotInfo.size <= 0 ||
      snapshotInfo.size > CATALOG_SNAPSHOT_MAX_BYTES
    )
      throw new Error("Catalog snapshot exceeds its size limit.");
    const image = readFileSync(snapshotPath);
    validateCatalogImage(image, snapshotSchemaVersion);
    let restorePath = snapshotPath;
    let upgradedDirectory: string | undefined;
    try {
      if (snapshotSchemaVersion !== CATALOG_SCHEMA_VERSION) {
        const upgraded = upgradeCatalogSnapshot(image, snapshotSchemaVersion);
        upgradedDirectory = mkdtempSync(
          join(tmpdir(), "openfilm-catalog-restore-upgrade-"),
        );
        restorePath = join(upgradedDirectory, "database.sqlite");
        writeFileSync(restorePath, upgraded, { flag: "wx", mode: 0o600 });
      }
      validateCatalogImage(readFileSync(restorePath), CATALOG_SCHEMA_VERSION);
    } catch (error) {
      if (upgradedDirectory)
        rmSync(upgradedDirectory, { recursive: true, force: true });
      throw error;
    }

    const previousMode = String(
      this.database.prepare("PRAGMA journal_mode").get()?.journal_mode ?? "",
    ).toLowerCase();
    let transaction = false;
    let attached = false;
    let foreignKeysDisabled = false;
    const cleanup = () => {
      const errors: unknown[] = [];
      try {
        if (transaction && this.database.isTransaction)
          this.database.exec("ROLLBACK");
      } catch (error) {
        errors.push(error);
      }
      try {
        if (attached) this.database.exec("DETACH DATABASE version_snapshot");
      } catch (error) {
        errors.push(error);
      }
      try {
        if (foreignKeysDisabled) this.database.exec("PRAGMA foreign_keys=ON");
      } catch (error) {
        errors.push(error);
      }
      try {
        if (previousMode === "wal") {
          const mode = String(
            this.database.prepare("PRAGMA journal_mode=WAL").get()
              ?.journal_mode ?? "",
          ).toLowerCase();
          if (mode !== "wal")
            throw new Error("Project catalog could not return to WAL mode.");
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        if (upgradedDirectory)
          rmSync(upgradedDirectory, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
      if (errors.length)
        throw new AggregateError(errors, "Catalog restore cleanup failed.");
    };
    try {
      this.database.exec("PRAGMA foreign_keys=OFF");
      foreignKeysDisabled = true;
      if (previousMode === "wal") {
        const mode = String(
          this.database.prepare("PRAGMA journal_mode=DELETE").get()
            ?.journal_mode ?? "",
        ).toLowerCase();
        if (mode !== "delete")
          throw new Error("Another process is using the project catalog.");
      }
      this.database.exec("BEGIN EXCLUSIVE");
      transaction = true;
      this.database
        .prepare("ATTACH DATABASE ? AS version_snapshot")
        .run(restorePath);
      attached = true;

      if (
        JSON.stringify(catalogSchema(this.database, "main")) !==
        JSON.stringify(catalogSchema(this.database, "version_snapshot"))
      )
        throw new Error("Catalog snapshot schema does not match this project.");

      if (assertCurrent) {
        const result = (assertCurrent as () => unknown)();
        if (isPromiseLike(result))
          throw new Error("Restore baseline validation must be synchronous.");
      }

      const tables = this.database
        .prepare(
          "SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => String(row.name));
      const quoteIdentifier = (identifier: string) =>
        `"${identifier.replaceAll('"', '""')}"`;
      for (const table of tables) {
        const quoted = quoteIdentifier(table);
        const columns = this.database
          .prepare(`PRAGMA main.table_info(${quoted})`)
          .all()
          .map((column) => String(column.name));
        if (!columns.length)
          throw new Error(`Catalog snapshot table has no columns: ${table}`);
        const projection = columns.map(quoteIdentifier).join(",");
        this.database.exec(`DELETE FROM main.${quoted}`);
        this.database.exec(
          `INSERT INTO main.${quoted} (${projection}) SELECT ${projection} FROM version_snapshot.${quoted}`,
        );
      }
      if (
        this.database.prepare("PRAGMA main.integrity_check").get()
          ?.integrity_check !== "ok"
      )
        throw new Error("Restored catalog failed its integrity check.");
      if (this.database.prepare("PRAGMA main.foreign_key_check").all().length)
        throw new Error("Restored catalog has invalid foreign-key references.");
      if (publishManifest) {
        const result = (publishManifest as () => unknown)();
        if (isPromiseLike(result))
          throw new Error("Project manifest publication must be synchronous.");
      }
      this.database.exec("COMMIT");
      transaction = false;
    } catch (error) {
      try {
        cleanup();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Catalog restore and cleanup failed.",
          { cause: cleanupError },
        );
      }
      throw error;
    }
    cleanup();
  }

  /** Logical row revision is stable across WAL/rollback journal header changes. */
  logicalRevision(): string {
    return logicalCatalogRevision(this.database);
  }

  /** Serialize manifest baseline checks and publication with all catalog writers.
   * A caller already inside an IMMEDIATE transaction retains its ownership. */
  withProjectWrite<T>(publish: () => T): T {
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = publish();
      if (result && typeof (result as { then?: unknown }).then === "function")
        throw new Error("Project publication must be synchronous.");
      if (ownsTransaction) this.database.exec("COMMIT");
      return result;
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction)
        this.database.exec("ROLLBACK");
      throw error;
    }
  }

  upsertAsset(asset: MediaAsset): void {
    validateAsset(asset);
    this.database
      .prepare(
        `INSERT INTO assets
      (id,uri,name,media_type,captured_at,rating,favorite,rejected,locked,data)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      uri=excluded.uri,name=excluded.name,media_type=excluded.media_type,
      captured_at=excluded.captured_at,rating=excluded.rating,
      favorite=excluded.favorite,rejected=excluded.rejected,locked=excluded.locked,data=excluded.data
    `,
      )
      .run(
        asset.id,
        asset.uri,
        asset.name,
        asset.mediaType,
        asset.capturedAt ? new Date(asset.capturedAt).toISOString() : null,
        asset.rating ?? null,
        Number(Boolean(asset.state.favorite)),
        Number(Boolean(asset.state.rejected)),
        Number(Boolean(asset.state.locked)),
        JSON.stringify(asset),
      );
  }

  getAsset(assetId: string): MediaAsset | undefined {
    id(assetId);
    const row = this.database
      .prepare("SELECT data FROM assets WHERE id=?")
      .get(assetId);
    return row ? (JSON.parse(String(row.data)) as MediaAsset) : undefined;
  }

  getAssetByUri(uri: string): MediaAsset | undefined {
    fileUri(uri);
    const row = this.database
      .prepare("SELECT data FROM assets WHERE uri=?")
      .get(uri);
    return row ? (JSON.parse(String(row.data)) as MediaAsset) : undefined;
  }

  /** Recheck planned identities and merge only source locations in one transaction. */
  relinkAssets(changes: CatalogRelinkChange[]): MediaAsset[] {
    if (!Array.isArray(changes) || !changes.length)
      throw relinkError(400, "Relinking requires at least one change");
    const assetIds = new Set<string>();
    const destinations = new Set<string>();
    for (const change of changes) {
      if (!record(change)) throw relinkError(400, "Invalid relink change");
      try {
        id(change.assetId);
      } catch {
        throw relinkError(400, "Invalid relink asset ID");
      }
      if (assetIds.has(change.assetId))
        throw relinkError(400, `Duplicate relink asset: ${change.assetId}`);
      assetIds.add(change.assetId);
      fileUri(change.expectedUri);
      fileUri(change.newUri);
      if (destinations.has(change.newUri))
        throw relinkError(
          409,
          "Multiple assets cannot share a destination URI",
        );
      destinations.add(change.newUri);
      if (
        change.expectedContentHash !== undefined &&
        (typeof change.expectedContentHash !== "string" ||
          !change.expectedContentHash.trim())
      )
        throw relinkError(400, "Invalid expected content hash");
      if (!record(change.reference))
        throw relinkError(400, "Relinking requires reference metadata");
      fileUri(change.reference.originalUri);
      if (
        change.reference.contentHash !== undefined &&
        (typeof change.reference.contentHash !== "string" ||
          !change.reference.contentHash.trim())
      )
        throw relinkError(400, "Invalid reference content hash");
      if (change.inspected) {
        try {
          validateAsset(change.inspected);
        } catch (error) {
          throw relinkError(
            400,
            error instanceof Error
              ? error.message
              : "Invalid inspected replacement",
          );
        }
        if (
          change.inspected.uri !== change.newUri ||
          change.inspected.contentHash !== change.reference.contentHash
        )
          throw relinkError(409, "Inspected replacement does not match relink");
      }
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const nextAssets = changes.map((change) => {
        const latest = this.getAsset(change.assetId);
        if (!latest)
          throw relinkError(404, `Asset not found: ${change.assetId}`);
        const storedReference = latest.metadata["openfilm.reference"];
        const previous = record(storedReference) ? storedReference : undefined;
        const referenceHash =
          typeof previous?.contentHash === "string"
            ? previous.contentHash
            : undefined;
        const contentHash = latest.contentHash ?? referenceHash;
        if (
          latest.uri !== change.expectedUri ||
          contentHash !== change.expectedContentHash
        )
          throw relinkError(409, `Asset changed since planning: ${latest.id}`);
        if (
          (contentHash !== undefined &&
            change.reference.contentHash !== contentHash) ||
          (referenceHash !== undefined &&
            change.reference.contentHash !== referenceHash)
        )
          throw relinkError(409, `Content hash must not change: ${latest.id}`);
        const existing = this.getAssetByUri(change.newUri);
        if (existing && existing.id !== latest.id)
          throw relinkError(
            409,
            `Destination URI belongs to asset: ${existing.id}`,
          );
        if (change.inspected && contentHash !== undefined)
          throw relinkError(
            409,
            "Source inspection is only allowed for assets without a known content hash",
          );
        const metadata = { ...latest.metadata };
        if (change.inspected) {
          for (const key of [
            "openfilm.preview",
            "openfilm.pixel",
            "openfilm.insta360",
            "openfilm.color",
            "openfilm.ffprobe",
            "openfilm.exif",
            "openfilm.timestamp",
            "openfilm.filesystem",
            "openfilm.metadata.exiftoolAvailable",
            "openfilm.importPipeline",
          ])
            delete metadata[key];
          Object.assign(metadata, change.inspected.metadata);
        }
        const next: MediaAsset = {
          ...latest,
          ...(change.inspected
            ? { contentHash: change.inspected.contentHash }
            : {}),
          uri: change.newUri,
          metadata: {
            ...metadata,
            "openfilm.reference": {
              ...change.reference,
              ...(typeof previous?.originalUri === "string"
                ? { originalUri: previous.originalUri }
                : {}),
            },
          },
        };
        if (change.inspected) {
          const updated = next as unknown as Record<string, unknown>;
          const inspected = change.inspected as unknown as Record<
            string,
            unknown
          >;
          for (const key of [
            "capturedAt",
            "capturedAtConfidence",
            "capturedAtSource",
            "timezone",
            "duration",
            "dimensions",
            "frameRate",
            "codec",
            "colorSpace",
            "hdr",
            "source",
            "gps",
          ]) {
            if (inspected[key] === undefined) delete updated[key];
            else updated[key] = structuredClone(inspected[key]);
          }
          delete updated.thumbnailUri;
          delete updated.proxyUri;
          delete updated.perceptualHash;
        }
        try {
          validateAsset(next);
        } catch (error) {
          throw relinkError(
            400,
            error instanceof Error ? error.message : "Invalid relink metadata",
          );
        }
        return next;
      });
      const update = this.database.prepare(
        "UPDATE assets SET uri=?,data=? WHERE id=?",
      );
      for (const asset of nextAssets)
        update.run(asset.uri, JSON.stringify(asset), asset.id);
      this.database.exec("COMMIT");
      return nextAssets;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listAssets(options: AssetListOptions = {}): MediaAsset[] {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 60;
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 10000
    )
      throw new Error(
        "Pagination needs offset >= 0 and limit between 1 and 10000",
      );
    const orders = {
      chronological: "captured_at IS NULL, captured_at ASC, id ASC",
      newest: "captured_at IS NULL, captured_at DESC, id ASC",
      name: "name COLLATE NOCASE ASC, id ASC",
      rating: "COALESCE(rating,0) DESC, captured_at ASC, id ASC",
    };
    const order = options.order ?? "chronological";
    if (!Object.hasOwn(orders, order))
      throw new Error("Unsupported asset order");
    const filter = assetFilter(options);
    const rows = this.database
      .prepare(
        `SELECT data FROM assets ${filter.sql} ORDER BY ${orders[order]} LIMIT ? OFFSET ?`,
      )
      .all(...filter.params, limit, offset);
    return rows.map((row) => JSON.parse(String(row.data)) as MediaAsset);
  }

  countAssets(
    options: Omit<AssetListOptions, "offset" | "limit" | "order"> = {},
  ): number {
    const filter = assetFilter(options);
    return Number(
      this.database
        .prepare(`SELECT COUNT(*) AS count FROM assets ${filter.sql}`)
        .get(...filter.params)?.count ?? 0,
    );
  }

  /** Paged descriptors omit heavyweight EXIF/probe extension blobs for analysis. */
  *iterateAssetSummaries(
    options: { includeReference?: boolean } = {},
  ): Generator<MediaAsset> {
    let after = "";
    while (true) {
      const rows = this.database
        .prepare(
          `SELECT id,uri,name,media_type,captured_at,rating,favorite,rejected,locked,
        json_extract(data,'$.duration') AS duration,json_extract(data,'$.dimensions') AS dimensions,
        json_extract(data,'$.gps') AS gps,json_extract(data,'$.contentHash') AS content_hash,
        json_extract(data,'$.perceptualHash') AS perceptual_hash,json_extract(data,'$.tags') AS tags
        ${options.includeReference ? `,data -> '$.metadata."openfilm.reference"' AS portable_reference` : ""}
        FROM assets WHERE id > ? ORDER BY id LIMIT 500`,
        )
        .all(after);
      if (!rows.length) break;
      for (const row of rows)
        yield {
          id: String(row.id),
          uri: String(row.uri),
          name: String(row.name),
          mediaType: row.media_type as MediaAsset["mediaType"],
          ...(row.captured_at ? { capturedAt: String(row.captured_at) } : {}),
          ...(row.rating !== null ? { rating: Number(row.rating) } : {}),
          ...(row.duration !== null ? { duration: Number(row.duration) } : {}),
          ...(row.dimensions
            ? {
                dimensions: JSON.parse(
                  String(row.dimensions),
                ) as MediaAsset["dimensions"],
              }
            : {}),
          ...(row.gps
            ? { gps: JSON.parse(String(row.gps)) as MediaAsset["gps"] }
            : {}),
          ...(row.content_hash
            ? { contentHash: String(row.content_hash) }
            : {}),
          ...(row.perceptual_hash
            ? { perceptualHash: String(row.perceptual_hash) }
            : {}),
          tags: JSON.parse(String(row.tags ?? "[]")) as string[],
          metadata: row.portable_reference
            ? {
                "openfilm.reference": JSON.parse(
                  String(row.portable_reference),
                ),
              }
            : {},
          state: {
            favorite: Boolean(row.favorite),
            rejected: Boolean(row.rejected),
            locked: Boolean(row.locked),
          },
        };
      after = String(rows.at(-1)!.id);
    }
  }

  updateAsset(
    assetId: string,
    patch: Partial<Pick<MediaAsset, "rating" | "state" | "tags">>,
  ): MediaAsset {
    id(assetId);
    const asset = this.getAsset(assetId);
    if (!asset) throw new Error(`Asset not found: ${assetId}`);
    if (
      !patch ||
      typeof patch !== "object" ||
      Object.keys(patch).some(
        (key) => !["rating", "state", "tags"].includes(key),
      )
    )
      throw new Error("Only rating, state and tags can be edited");
    const next = {
      ...asset,
      ...structuredClone(patch),
      state: { ...asset.state, ...patch.state },
    };
    validateAsset(next);
    this.upsertAsset(next);
    return next;
  }

  saveJob(job: Job): void {
    id(job.id);
    if (
      !["queued", "running", "completed", "failed", "cancelled"].includes(
        job.status,
      )
    )
      throw new Error("Invalid job status");
    if (job.proxyCache !== undefined) {
      const task = validateProxyCacheTask(job.proxyCache);
      if (job.type !== "proxy" || job.assetId !== task.assetId)
        throw new Error("Proxy task does not match its owning job.");
    }
    this.database
      .prepare(
        "INSERT INTO jobs(id,created_at,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(
        job.id,
        job.createdAt ?? new Date().toISOString(),
        JSON.stringify(job),
      );
  }

  getJob(jobId: string): Job | undefined {
    id(jobId);
    const row = this.database
      .prepare("SELECT data FROM jobs WHERE id=?")
      .get(jobId);
    return row ? (JSON.parse(String(row.data)) as Job) : undefined;
  }

  listJobs(options: JobListOptions = {}): Job[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (options.type !== undefined) {
      id(options.type);
      where.push("json_extract(data,'$.type')=?");
      params.push(options.type);
    }
    if (options.assetId !== undefined) {
      id(options.assetId);
      where.push("json_extract(data,'$.assetId')=?");
      params.push(options.assetId);
    }
    if (options.proxyRequestId !== undefined) {
      id(options.proxyRequestId);
      where.push("json_extract(data,'$.proxyCache.requestId')=?");
      params.push(options.proxyRequestId);
    }
    if (options.statuses !== undefined) {
      if (
        !Array.isArray(options.statuses) ||
        !options.statuses.length ||
        options.statuses.length > 5 ||
        options.statuses.some(
          (status) =>
            !["queued", "running", "completed", "failed", "cancelled"].includes(
              status,
            ),
        )
      )
        throw new Error("Invalid job status filter.");
      where.push(
        `json_extract(data,'$.status') IN (${options.statuses.map(() => "?").join(",")})`,
      );
      params.push(...options.statuses);
    }
    if (
      options.limit !== undefined &&
      (!Number.isSafeInteger(options.limit) ||
        options.limit < 1 ||
        options.limit > 10_000)
    )
      throw new Error("Job page size is outside its supported bounds.");
    if (
      options.offset !== undefined &&
      (!Number.isSafeInteger(options.offset) ||
        options.offset < 0 ||
        options.offset > 1_000_000)
    )
      throw new Error("Invalid job page offset.");
    const order = options.oldestFirst ? "ASC" : "DESC";
    return this.database
      .prepare(
        `SELECT data FROM jobs${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at ${order},id ${order}${options.limit !== undefined ? " LIMIT ? OFFSET ?" : ""}`,
      )
      .all(
        ...params,
        ...(options.limit !== undefined
          ? [options.limit, options.offset ?? 0]
          : []),
      )
      .map((row) => JSON.parse(String(row.data)) as Job);
  }

  close(): void {
    this.database.close();
  }
}
