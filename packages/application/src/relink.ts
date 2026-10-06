import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { MediaAsset } from "@openfilm/core";
import {
  hashFile,
  inspectMedia,
  localPath,
  planMediaRelink,
  referenceFor,
  sourceStatus,
  type PortableReference,
  type RelinkCandidate,
  type RelinkMatch,
  type SourceStatus,
} from "@openfilm/media";
import type { CatalogRelinkChange } from "@openfilm/catalog";
import type { OpenFilmApplication } from "./index.js";

export interface RelinkPlan {
  id: string;
  createdAt: string;
  matches: RelinkMatch[];
}

export interface RelinkPlanInput {
  assetIds?: string[];
  libraryId?: string;
  folder?: string;
  file?: string;
}

export interface RelinkApplyInput {
  planId: string;
  selections: { assetId: string; candidateId: string; confirm?: boolean }[];
}

export interface MediaSourceStatus {
  assets: SourceStatus[];
  libraries: {
    id: string;
    name: string;
    status: "online" | "offline" | "partial";
    roots: string[];
  }[];
}

export class MediaRelinkError extends Error {
  override name = "MediaRelinkError";

  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

const ASSET_LIMIT = 2000;
const STATUS_CONCURRENCY = 16;
const PLAN_LIMIT = 20;
const PLAN_LIFETIME = 15 * 60 * 1000;

interface PlannedSource {
  uri: string;
  hash?: string;
  reference: PortableReference;
}

interface StoredPlan {
  plan: RelinkPlan;
  expiresAt: number;
  folder?: string;
  sources: Map<string, PlannedSource>;
}

function object(
  value: unknown,
  path: string,
  allowed: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new MediaRelinkError(`${path} must be an object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new MediaRelinkError(`${path}.${key} is not supported`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, maximum = 256): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    value.includes("\0")
  )
    throw new MediaRelinkError(
      `${path} must be a nonempty string of at most ${maximum} characters`,
    );
  return value;
}

function assetIds(value: unknown, bounded = true): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || (bounded && value.length > ASSET_LIMIT))
    throw new MediaRelinkError(
      bounded
        ? `assetIds must be an array of at most ${ASSET_LIMIT} IDs`
        : "assetIds must be an array",
    );
  const result = Array.from(value, (id) => text(id, "assetId"));
  if (new Set(result).size !== result.length)
    throw new MediaRelinkError("assetIds must not contain duplicates");
  return result;
}

function parsePlan(value: unknown): RelinkPlanInput {
  const data = object(value, "plan", [
    "assetIds",
    "libraryId",
    "folder",
    "file",
  ]);
  const ids = assetIds(data.assetIds);
  const folder =
    data.folder === undefined ? undefined : text(data.folder, "folder", 32768);
  const file =
    data.file === undefined ? undefined : text(data.file, "file", 32768);
  if ((folder === undefined) === (file === undefined))
    throw new MediaRelinkError("Choose exactly one folder or file to search");
  return {
    ...(ids === undefined ? {} : { assetIds: ids }),
    ...(data.libraryId === undefined
      ? {}
      : { libraryId: text(data.libraryId, "libraryId") }),
    ...(folder === undefined ? {} : { folder }),
    ...(file === undefined ? {} : { file }),
  };
}

function parseApply(value: unknown): RelinkApplyInput {
  const data = object(value, "apply", ["planId", "selections"]);
  const planId = text(data.planId, "planId");
  if (
    !Array.isArray(data.selections) ||
    !data.selections.length ||
    data.selections.length > ASSET_LIMIT
  )
    throw new MediaRelinkError(
      `Choose between 1 and ${ASSET_LIMIT} relink candidates`,
    );
  const selections = Array.from(data.selections, (entry, index) => {
    const selection = object(entry, `selections[${index}]`, [
      "assetId",
      "candidateId",
      "confirm",
    ]);
    if (
      selection.confirm !== undefined &&
      typeof selection.confirm !== "boolean"
    )
      throw new MediaRelinkError("Candidate confirmation must be a boolean");
    return {
      assetId: text(selection.assetId, "assetId"),
      candidateId: text(selection.candidateId, "candidateId"),
      ...(selection.confirm === undefined
        ? {}
        : { confirm: selection.confirm as boolean }),
    };
  });
  if (
    new Set(selections.map((selection) => selection.assetId)).size !==
    selections.length
  )
    throw new MediaRelinkError("Select each asset at most once");
  return { planId, selections };
}

/** A plan contains evidence only; files and current catalog rows are rechecked on apply. */
export class MediaRelinker {
  private readonly plans = new Map<string, StoredPlan>();
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly application: OpenFilmApplication) {}

  async status(selectedIds?: string[]): Promise<MediaSourceStatus> {
    const ids = assetIds(selectedIds, false);
    const selected = ids === undefined ? undefined : new Set(ids);
    const statuses: SourceStatus[] = [];
    const rootsByLibrary = new Map<string, Set<string>>();
    const missingByLibrary = new Set<string>();
    const batch: { asset: MediaAsset; libraryId: string }[] = [];
    const checkBatch = async () => {
      const results = await Promise.all(
        batch.map(({ asset }) => sourceStatus(asset)),
      );
      for (const [index, status] of results.entries()) {
        statuses.push(status);
        if (status.status !== "available")
          missingByLibrary.add(batch[index]!.libraryId);
      }
      batch.length = 0;
    };
    // Page lightweight descriptors and bound filesystem work without decoding media.
    for (const asset of this.application.catalog.iterateAssetSummaries({
      includeReference: true,
    })) {
      const reference = referenceFor(
        asset,
        this.application.project.mediaLibraries,
      );
      const roots =
        rootsByLibrary.get(reference.mediaLibraryId) ?? new Set<string>();
      roots.add(reference.rootUri);
      rootsByLibrary.set(reference.mediaLibraryId, roots);
      if (!selected || selected.has(asset.id)) {
        batch.push({ asset, libraryId: reference.mediaLibraryId });
        if (batch.length === STATUS_CONCURRENCY) await checkBatch();
      }
    }
    if (batch.length) await checkBatch();
    const byAsset = ids
      ? new Map(statuses.map((status) => [status.assetId, status]))
      : undefined;
    const ordered = ids?.map((id) => {
      const status = byAsset!.get(id);
      if (!status) throw new MediaRelinkError(`Asset not found: ${id}`, 404);
      return status;
    });
    const libraries: MediaSourceStatus["libraries"] = [];
    for (const library of this.application.project.mediaLibraries) {
      const roots = [
        ...(rootsByLibrary.get(library.id) ?? new Set([library.uri])),
      ];
      let online = 0;
      for (
        let offset = 0;
        offset < roots.length;
        offset += STATUS_CONCURRENCY
      ) {
        const mounted = await Promise.all(
          roots.slice(offset, offset + STATUS_CONCURRENCY).map(async (uri) => {
            try {
              const path = localPath(uri);
              const info = await lstat(path);
              return (
                info.isDirectory() &&
                !info.isSymbolicLink() &&
                (await realpath(path)) === resolve(path)
              );
            } catch {
              return false;
            }
          }),
        );
        online += mounted.filter(Boolean).length;
      }
      libraries.push({
        id: library.id,
        name: library.name,
        status: !online
          ? "offline"
          : online < roots.length || missingByLibrary.has(library.id)
            ? "partial"
            : "online",
        roots,
      });
    }
    return { assets: ordered ?? statuses, libraries };
  }

  async plan(input: RelinkPlanInput): Promise<RelinkPlan> {
    this.assertIdle();
    const parsed = parsePlan(input);
    const selected = this.assets(parsed.assetIds, parsed.libraryId);
    if (!selected.length)
      throw new MediaRelinkError("Choose at least one asset to relink");
    let folder: string | undefined;
    let matches: RelinkMatch[];
    try {
      matches = await planMediaRelink(
        selected,
        this.application.project.mediaLibraries,
        parsed,
      );
      if (parsed.folder)
        folder = await realpath(
          parsed.folder.startsWith("file:")
            ? localPath(parsed.folder)
            : parsed.folder,
        );
    } catch (error) {
      throw new MediaRelinkError(
        error instanceof Error ? error.message : String(error),
      );
    }
    this.assertIdle();
    const now = Date.now();
    const plan: RelinkPlan = {
      id: randomUUID(),
      createdAt: new Date(now).toISOString(),
      matches,
    };
    this.prune(now);
    this.plans.set(plan.id, {
      plan,
      expiresAt: now + PLAN_LIFETIME,
      ...(folder === undefined ? {} : { folder }),
      sources: new Map(
        selected.map((asset) => {
          const reference = referenceFor(
            asset,
            this.application.project.mediaLibraries,
          );
          return [
            asset.id,
            {
              uri: asset.uri,
              hash: asset.contentHash ?? reference.contentHash,
              reference,
            },
          ];
        }),
      ),
    });
    while (this.plans.size > PLAN_LIMIT)
      this.plans.delete(this.plans.keys().next().value!);
    return structuredClone(plan);
  }

  async apply(input: RelinkApplyInput): Promise<{ assets: MediaAsset[] }> {
    this.assertIdle();
    const parsed = parseApply(input);
    const operation = this.pending.then(async () => {
      this.assertIdle();
      this.prune(Date.now());
      const stored = this.plans.get(parsed.planId);
      if (!stored)
        throw new MediaRelinkError(
          "Relink plan expired or was already applied. Search again.",
          409,
        );
      const changes: CatalogRelinkChange[] = [];
      const verified: {
        candidate: RelinkCandidate;
        info: Stats;
        inspected?: MediaAsset;
      }[] = [];
      for (const selection of parsed.selections) {
        const match = stored.plan.matches.find(
          (item) => item.assetId === selection.assetId,
        );
        const candidate = match?.candidates.find(
          (item) => item.id === selection.candidateId,
        );
        const expected = stored.sources.get(selection.assetId);
        if (!candidate || !expected)
          throw new MediaRelinkError(
            "Selected candidate does not belong to this relink plan",
          );
        if (!candidate.automatic && selection.confirm !== true)
          throw new MediaRelinkError(
            `Confirm the unverified match for ${selection.assetId} before applying it`,
          );
        const current = this.application.catalog.getAsset(selection.assetId);
        if (!current)
          throw new MediaRelinkError(
            `Asset not found: ${selection.assetId}`,
            404,
          );
        const currentReference = referenceFor(
          current,
          this.application.project.mediaLibraries,
        );
        if (
          current.uri !== expected.uri ||
          (current.contentHash ?? currentReference.contentHash) !==
            expected.hash
        )
          throw new MediaRelinkError(
            `Asset ${current.id} changed since planning. Search again.`,
            409,
          );
        const verification = await this.revalidate(
          candidate,
          current,
          expected.hash,
        );
        verified.push({
          candidate,
          info: verification.info,
          ...(verification.inspected
            ? { inspected: verification.inspected }
            : {}),
        });
        const root = stored.folder ?? dirname(candidate.path);
        const relativePath = relative(root, candidate.path)
          .split(sep)
          .join("/");
        if (
          !relativePath ||
          relativePath === ".." ||
          relativePath.startsWith("../") ||
          relativePath.startsWith("/")
        )
          throw new MediaRelinkError(
            "Relink candidate is outside the selected root",
            409,
          );
        changes.push({
          assetId: current.id,
          expectedUri: expected.uri,
          ...(expected.hash === undefined
            ? {}
            : { expectedContentHash: expected.hash }),
          newUri: candidate.uri,
          ...(verification.inspected
            ? { inspected: verification.inspected }
            : {}),
          reference: {
            ...currentReference,
            originalUri: expected.reference.originalUri,
            rootUri: pathToFileURL(root).href,
            relativePath,
            filename: basename(candidate.path),
            fileSize: candidate.fileSize,
            contentHash: candidate.contentHash,
          },
        });
      }
      // All validation finishes before the synchronous transaction starts.
      for (const { candidate, info } of verified) {
        try {
          const latest = await lstat(candidate.path);
          if (
            !latest.isFile() ||
            latest.isSymbolicLink() ||
            latest.size !== info.size ||
            latest.mtimeMs !== info.mtimeMs ||
            latest.ino !== info.ino ||
            latest.dev !== info.dev ||
            (await realpath(candidate.path)) !== resolve(candidate.path)
          )
            throw new Error("Source changed during batch verification");
        } catch (error) {
          throw new MediaRelinkError(
            `Cannot commit relink: ${error instanceof Error ? error.message : String(error)}`,
            409,
          );
        }
      }
      this.assertIdle();
      let assets: MediaAsset[];
      try {
        assets = this.application.catalog.relinkAssets(changes);
      } catch (error) {
        const status =
          error instanceof Error &&
          "status" in error &&
          typeof error.status === "number"
            ? error.status
            : 500;
        throw new MediaRelinkError(
          error instanceof Error ? error.message : String(error),
          status,
        );
      }
      this.plans.delete(parsed.planId);
      return { assets };
    });
    this.pending = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private assets(ids?: string[], libraryId?: string): MediaAsset[] {
    if (
      libraryId &&
      !this.application.project.mediaLibraries.some(
        (library) => library.id === libraryId,
      )
    )
      throw new MediaRelinkError(`Media library not found: ${libraryId}`, 404);
    const result: MediaAsset[] = [];
    const selected =
      ids ??
      [...this.application.catalog.iterateAssetSummaries()].map(
        (asset) => asset.id,
      );
    for (const id of selected) {
      const asset = this.application.catalog.getAsset(id);
      if (!asset) throw new MediaRelinkError(`Asset not found: ${id}`, 404);
      if (
        !libraryId ||
        referenceFor(asset, this.application.project.mediaLibraries)
          .mediaLibraryId === libraryId
      )
        result.push(asset);
      if (result.length > ASSET_LIMIT)
        throw new MediaRelinkError(
          `Select at most ${ASSET_LIMIT} assets for one relink operation`,
        );
    }
    return result;
  }

  private prune(now: number): void {
    for (const [id, stored] of this.plans)
      if (stored.expiresAt <= now) this.plans.delete(id);
  }

  private assertIdle(): void {
    if (this.application.hasActiveJobs)
      throw new MediaRelinkError(
        "Wait for or cancel active import/render jobs before relinking media",
        409,
      );
  }

  private async revalidate(
    candidate: RelinkCandidate,
    asset: MediaAsset,
    knownHash?: string,
  ): Promise<{ info: Stats; inspected?: MediaAsset }> {
    try {
      const before = await lstat(candidate.path);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        (await realpath(candidate.path)) !== resolve(candidate.path)
      )
        throw new MediaRelinkError(
          "Candidate must remain a regular file without symlinks",
          409,
        );
      const hash = await hashFile(candidate.path);
      if (
        before.size !== candidate.fileSize ||
        hash !== candidate.contentHash ||
        (knownHash !== undefined &&
          hash.toLowerCase() !== knownHash.toLowerCase())
      )
        throw new MediaRelinkError(
          "Candidate content changed or contradicts the known content hash. Search again.",
          409,
        );
      let inspected: MediaAsset | undefined;
      if (!knownHash) {
        inspected = {
          ...(await inspectMedia({
            path: candidate.path,
            uri: candidate.uri,
            name: basename(candidate.path),
          })),
          contentHash: hash,
        };
        if (inspected.mediaType !== asset.mediaType)
          throw new MediaRelinkError(
            `Replacement media type ${inspected.mediaType} does not match ${asset.mediaType}`,
          );
        if (asset.mediaType !== "image") {
          const clips = this.application.project.timelines.flatMap((timeline) =>
            timeline.tracks.flatMap((track) =>
              track.clips.filter((clip) => clip.assetId === asset.id),
            ),
          );
          const required = Math.max(
            0,
            ...clips.map((clip) =>
              Math.max(
                clip.sourceOut ?? 0,
                (clip.sourceIn ?? 0) +
                  clip.timelineDuration * (clip.transform?.speed ?? 1),
              ),
            ),
          );
          if (
            inspected.duration === undefined ||
            inspected.duration + 1e-7 < required ||
            (asset.duration !== undefined &&
              inspected.duration + 1e-7 < asset.duration)
          )
            throw new MediaRelinkError(
              `Replacement source is too short for the existing duration and source trims (${Math.max(required, asset.duration ?? 0)}s required)`,
            );
        }
        if ((await hashFile(candidate.path)) !== hash)
          throw new MediaRelinkError(
            "Candidate changed during media inspection. Search again.",
            409,
          );
      }
      const after = await lstat(candidate.path);
      if (
        after.isSymbolicLink() ||
        !after.isFile() ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ino !== before.ino ||
        after.dev !== before.dev
      )
        throw new MediaRelinkError(
          "Candidate changed during verification. Search again.",
          409,
        );
      return { info: after, ...(inspected ? { inspected } : {}) };
    } catch (error) {
      if (error instanceof MediaRelinkError) throw error;
      throw new MediaRelinkError(
        `Cannot verify relink candidate: ${error instanceof Error ? error.message : String(error)}`,
        409,
      );
    }
  }
}
