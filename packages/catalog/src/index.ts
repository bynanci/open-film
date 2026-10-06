import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { validateMediaAsset, type Job, type MediaAsset } from "@openfilm/core";
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
} from "./knowledge-store.js";
import { migrateTranscriptSegmentIdentity } from "./transcript-segment-identity.js";

export * from "./transcript-editor-store.js";
export * from "./knowledge-store.js";

export {
  CATALOG_SCHEMA_VERSION,
  CatalogIntelligenceStore,
  INTELLIGENCE_CACHE_VERSION,
  TRANSCRIPT_PAGE_LIMIT,
  type AnalysisCacheOptions,
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

export interface CatalogRelinkChange {
  assetId: string;
  expectedUri: string;
  expectedContentHash?: string;
  newUri: string;
  reference: Record<string, unknown>;
  /** Fresh technical metadata for a confirmed relink with no prior content hash. */
  inspected?: MediaAsset;
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
  readonly intelligence: CatalogIntelligenceStore;
  readonly transcripts: CatalogTranscriptEditorStore;
  readonly knowledge: CatalogKnowledgeStore;

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
      if (version >= 2) new CatalogIntelligenceStore(this.database);
      if (version >= 3) {
        new CatalogTranscriptEditorStore(this.database);
        new CatalogKnowledgeStore(this.database);
      }
      if (version < CATALOG_SCHEMA_VERSION) {
        this.database.exec("BEGIN IMMEDIATE");
        try {
          this.database.exec(`
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
          if (version < 2) migrateIntelligenceSchema(this.database);
          if (version < 3) {
            migrateTranscriptEditorSchema(this.database);
            migrateKnowledgeSchema(this.database);
          }
          migrateTranscriptSegmentIdentity(this.database);
          this.database.exec(
            `PRAGMA user_version=${CATALOG_SCHEMA_VERSION}; COMMIT;`,
          );
        } catch (error) {
          this.database.exec("ROLLBACK");
          throw error;
        }
      }
      this.intelligence = new CatalogIntelligenceStore(this.database);
      this.transcripts = new CatalogTranscriptEditorStore(this.database);
      this.knowledge = new CatalogKnowledgeStore(this.database);
    } catch (error) {
      this.database.close();
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

  listJobs(): Job[] {
    return this.database
      .prepare("SELECT data FROM jobs ORDER BY created_at DESC,id")
      .all()
      .map((row) => JSON.parse(String(row.data)) as Job);
  }

  close(): void {
    this.database.close();
  }
}
