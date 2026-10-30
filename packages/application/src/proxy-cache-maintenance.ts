// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
import { randomUUID } from "node:crypto";
import { lstatSync, unlinkSync } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import {
  ApplicationError,
  PROXY_CACHE_LIMITS,
  validateProxyCachePolicy,
  type ProxyCachePolicy,
  type ProxyCacheReceipt,
  type ProxyCleanupPreview,
  type ProxyCleanupResult,
  type ProxyVerificationResult,
} from "@openfilm/core";
import { checkAbort, hashFile, localPath } from "@openfilm/media";
import type { ProxyCacheHost } from "./proxy-cache.js";
import { proxyDigest, proxyInputFingerprint } from "./proxy-cache-identity.js";
import {
  fileIdentity,
  type ProxyCacheStore,
  type ProxyWorkerLease,
} from "./proxy-cache-store.js";

interface MaintenanceContext {
  host: ProxyCacheHost;
  store: ProxyCacheStore;
  exclusive<T>(work: (lease: ProxyWorkerLease) => Promise<T>): Promise<T>;
  inventory(): Promise<{ managedBytes: number; complete: boolean }>;
  protectedAssets(): Set<string>;
}
interface CleanupProof {
  receipt: ProxyCacheReceipt;
  receiptIdentity: string;
  receiptDigest: string;
  outputIdentity: string;
  sourceIdentity: string;
  bytes: number;
}
interface StoredPreview {
  public: ProxyCleanupPreview;
  proofs: CleanupProof[];
  context: string;
  expires: number;
  completed?: ProxyCleanupResult;
}
function stale(): never {
  throw new ApplicationError(
    "proxy.stale",
    "Proxy cleanup changed; refresh its preview before accepting.",
    409,
  );
}
function unavailable(): never {
  throw new ApplicationError(
    "proxy.storageUnavailable",
    "Proxy storage needs review before this operation.",
    409,
  );
}
class PartialCleanupError extends Error {
  constructor(readonly removedBytes: number) {
    super("Preview cleanup stopped after a partial filesystem change.");
  }
}

export class ProxyCacheMaintenance {
  private readonly previews = new Map<string, StoredPreview>();
  constructor(private readonly context: MaintenanceContext) {}

  private request(input: object, fields: string[], projectId: string): void {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !fields.includes(key))
    )
      throw new ApplicationError(
        "request.invalid",
        "Unsupported proxy storage request.",
      );
    if (
      projectId !== this.context.host.project.id ||
      projectId !== this.context.store.projectId
    )
      stale();
  }

  private ids(values: unknown): asserts values is string[] {
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > 128 ||
      new Set(values).size !== values.length ||
      values.some(
        (value) =>
          typeof value !== "string" || !value.trim() || value.length > 512,
      )
    )
      throw new ApplicationError(
        "request.invalid",
        "Choose 1–128 distinct preview sources.",
      );
  }

  setPolicy(input: {
    projectId: string;
    baseRevision: number;
    quotaBytes: number;
  }): Promise<ProxyCachePolicy> {
    this.request(
      input,
      ["projectId", "baseRevision", "quotaBytes"],
      input.projectId,
    );
    return this.context.exclusive(async (lease) => {
      const previous = this.context.store.policy();
      if (previous.revision !== input.baseRevision) stale();
      const next = validateProxyCachePolicy({
        version: 1,
        revision: previous.revision + 1,
        quotaBytes: input.quotaBytes,
      });
      lease.assertOwned();
      this.context.store.savePolicy(next);
      return next;
    });
  }

  private protectionFingerprint(): string {
    return proxyDigest({
      policy: this.context.store.policy(),
      protected: [...this.context.protectedAssets()].sort(),
      timelines: this.context.host.project.timelines,
    });
  }

  private isProtected(receipt: ProxyCacheReceipt): boolean {
    if (
      this.context.protectedAssets().has(receipt.assetId) ||
      this.context.store.hasReaders(receipt.artifactId)
    )
      return true;
    const output = this.context.store.outputPath(receipt);
    for (const asset of this.context.host.catalog.iterateAssetSummaries()) {
      try {
        if (resolve(localPath(asset.uri)) === output) return true;
      } catch {
        /* Non-local sources cannot authorize deletion. */
      }
    }
    return false;
  }

  private async verifiedFile(
    path: string,
    expected: string,
    signal?: AbortSignal,
  ): Promise<string> {
    checkAbort(signal);
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) stale();
    const hash = await hashFile(path, signal);
    const after = lstatSync(path);
    if (hash !== expected || fileIdentity(before) !== fileIdentity(after))
      stale();
    return fileIdentity(after);
  }

  private async artifacts(signal?: AbortSignal): Promise<ProxyCacheReceipt[]> {
    this.context.store.ensure();
    const entries: Array<{ receipt: ProxyCacheReceipt; lastUsed: number }> = [];
    let visited = 0;
    for await (const entry of await opendir(this.context.store.managed)) {
      checkAbort(signal);
      if (++visited > PROXY_CACHE_LIMITS.inventoryFiles) unavailable();
      if (!/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue;
      const data = this.context.store.receipt(entry.name.slice(0, -5));
      if (!data) stale();
      entries.push({
        receipt: data.receipt,
        lastUsed: lstatSync(join(this.context.store.managed, entry.name))
          .mtimeMs,
      });
      if (visited % 16 === 0) await setImmediate(undefined, { signal });
    }
    return entries
      .sort(
        (a, b) =>
          a.lastUsed - b.lastUsed ||
          a.receipt.artifactId.localeCompare(b.receipt.artifactId),
      )
      .map(({ receipt }) => receipt);
  }

  private async proof(
    receipt: ProxyCacheReceipt,
    signal?: AbortSignal,
  ): Promise<CleanupProof | undefined> {
    if (this.isProtected(receipt)) return undefined;
    const asset = this.context.host.catalog.getAsset(receipt.assetId);
    if (
      !asset ||
      receipt.sourceHash !== asset.contentHash ||
      receipt.inputFingerprint !== proxyInputFingerprint(asset)
    )
      return undefined;
    let sourceIdentity: string;
    try {
      sourceIdentity = await this.verifiedFile(
        localPath(asset.uri),
        receipt.sourceHash,
        signal,
      );
    } catch (error) {
      checkAbort(signal);
      if (
        error instanceof ApplicationError ||
        (error as NodeJS.ErrnoException).code
      )
        return undefined;
      throw error;
    }
    const data = this.context.store.receipt(receipt.artifactId);
    if (!data || data.receipt.output.hash !== receipt.output.hash) stale();
    const path = this.context.store.outputPath(receipt);
    let outputIdentity: string;
    let outputBytes = 0;
    try {
      outputIdentity = await this.verifiedFile(
        path,
        receipt.output.hash,
        signal,
      );
      outputBytes = lstatSync(path).size;
    } catch (error) {
      checkAbort(signal);
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        outputIdentity = "missing";
      else if (error instanceof ApplicationError) return undefined;
      else throw error;
    }
    return {
      receipt,
      receiptIdentity: data.identity,
      receiptDigest: data.digest,
      outputIdentity,
      sourceIdentity,
      bytes:
        outputBytes +
        lstatSync(
          join(this.context.store.managed, `${receipt.artifactId}.json`),
        ).size,
    };
  }

  previewCleanup(input: {
    projectId: string;
    assetIds?: string[];
    signal?: AbortSignal;
  }): Promise<ProxyCleanupPreview> {
    this.request(input, ["projectId", "assetIds", "signal"], input.projectId);
    if (input.assetIds !== undefined) this.ids(input.assetIds);
    return this.context.exclusive(async (lease) => {
      const inventory = await this.context.inventory();
      if (!inventory.complete) unavailable();
      const context = this.protectionFingerprint();
      const receipts = await this.artifacts(input.signal);
      const selected = input.assetIds && new Set(input.assetIds);
      const proofs: CleanupProof[] = [];
      let protectedCount = 0;
      let examined = 0;
      for (const receipt of receipts) {
        if (selected && !selected.has(receipt.assetId)) continue;
        if (examined++ >= 128) break;
        const proof = await this.proof(receipt, input.signal);
        if (proof) proofs.push(proof);
        else protectedCount++;
        if (proofs.length >= 20) break;
      }
      lease.assertOwned();
      checkAbort(input.signal);
      if (context !== this.protectionFingerprint()) stale();
      const preview: ProxyCleanupPreview = {
        version: 1,
        projectId: input.projectId,
        previewId: randomUUID(),
        fingerprint: proxyDigest([context, proofs]),
        bytes: proofs.reduce((sum, proof) => sum + proof.bytes, 0),
        entries: proofs.map(({ receipt, bytes }) => ({
          artifactId: receipt.artifactId,
          assetId: receipt.assetId,
          name: this.context.host.catalog.getAsset(receipt.assetId)?.name ?? "",
          byteLength: bytes,
        })),
        protectedCount,
        hasMore:
          examined <
          receipts.filter(
            (receipt) => !selected || selected.has(receipt.assetId),
          ).length,
      };
      const now = Date.now();
      for (const [id, stored] of this.previews)
        if (stored.expires < now) this.previews.delete(id);
      while (this.previews.size >= 32)
        this.previews.delete(this.previews.keys().next().value!);
      this.previews.set(preview.previewId, {
        public: preview,
        proofs,
        context,
        expires: now + 10 * 60_000,
      });
      return structuredClone(preview);
    });
  }

  private assertProof(proof: CleanupProof, lease: ProxyWorkerLease): void {
    lease.assertOwned();
    const { receipt } = proof;
    if (this.isProtected(receipt)) stale();
    const current = this.context.store.receipt(receipt.artifactId);
    const asset = this.context.host.catalog.getAsset(receipt.assetId);
    if (
      !current ||
      current.identity !== proof.receiptIdentity ||
      current.digest !== proof.receiptDigest ||
      !asset ||
      proxyInputFingerprint(asset) !== receipt.inputFingerprint ||
      fileIdentity(lstatSync(localPath(asset.uri))) !== proof.sourceIdentity
    )
      stale();
    try {
      if (
        fileIdentity(lstatSync(this.context.store.outputPath(receipt))) !==
        proof.outputIdentity
      )
        stale();
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" ||
        proof.outputIdentity !== "missing"
      )
        throw error;
    }
  }

  private remove(proof: CleanupProof, lease: ProxyWorkerLease): number {
    return this.context.host.catalog.withProjectWrite(() => {
      this.assertProof(proof, lease);
      const { receipt } = proof;
      let removed = 0;
      try {
        if (proof.outputIdentity !== "missing") {
          unlinkSync(this.context.store.outputPath(receipt));
          removed += receipt.output.byteLength;
        }
        const path = join(
          this.context.store.managed,
          `${receipt.artifactId}.json`,
        );
        const size = lstatSync(path).size;
        unlinkSync(path);
        removed += size;
        this.context.store.clearPreferred(receipt.assetId, receipt.artifactId);
        return removed;
      } catch {
        throw new PartialCleanupError(removed);
      }
    });
  }

  acceptCleanup(input: {
    projectId: string;
    previewId: string;
    fingerprint: string;
    confirmed: boolean;
    signal?: AbortSignal;
  }): Promise<ProxyCleanupResult> {
    this.request(
      input,
      ["projectId", "previewId", "fingerprint", "confirmed", "signal"],
      input.projectId,
    );
    const stored = this.previews.get(input.previewId);
    if (
      !input.confirmed ||
      !stored ||
      stored.public.projectId !== input.projectId ||
      stored.public.fingerprint !== input.fingerprint ||
      stored.expires < Date.now()
    )
      stale();
    if (stored.completed)
      return Promise.resolve(structuredClone(stored.completed));
    return this.context.exclusive(async (lease) => {
      if (stored.context !== this.protectionFingerprint()) stale();
      const fresh: CleanupProof[] = [];
      for (const proof of stored.proofs) {
        const checked = await this.proof(proof.receipt, input.signal);
        if (!checked || proxyDigest(checked) !== proxyDigest(proof)) stale();
        fresh.push(checked);
      }
      checkAbort(input.signal);
      lease.assertOwned();
      if (stored.context !== this.protectionFingerprint()) stale();
      for (const proof of fresh) this.assertProof(proof, lease);
      const result: ProxyCleanupResult = {
        removedBytes: 0,
        removedArtifactIds: [],
        failedArtifactIds: [],
      };
      // No awaits between the final identity checks and bounded per-entry deletion.
      for (const proof of fresh) {
        try {
          result.removedBytes += this.remove(proof, lease);
          result.removedArtifactIds.push(proof.receipt.artifactId);
        } catch (error) {
          if (error instanceof PartialCleanupError)
            result.removedBytes += error.removedBytes;
          result.failedArtifactIds.push(proof.receipt.artifactId);
        }
      }
      stored.completed = structuredClone(result);
      return result;
    });
  }

  /** Automatic LRU excludes the current source's valid preview during replacement. */
  async makeRoom(
    requiredBytes: number,
    lease: ProxyWorkerLease,
    protectedArtifacts: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<void> {
    let inventory = await this.context.inventory();
    if (!inventory.complete) unavailable();
    const quota = this.context.store.policy().quotaBytes;
    if (quota - inventory.managedBytes >= requiredBytes) return;
    let examined = 0;
    for (const receipt of await this.artifacts(signal)) {
      if (examined++ >= 128) break;
      if (protectedArtifacts.has(receipt.artifactId)) continue;
      const proof = await this.proof(receipt, signal);
      if (!proof) continue;
      checkAbort(signal);
      lease.assertOwned();
      try {
        this.remove(proof, lease);
      } catch {
        lease.assertOwned();
      }
      inventory = await this.context.inventory();
      if (quota - inventory.managedBytes >= requiredBytes) return;
    }
  }

  verify(input: {
    projectId: string;
    assetIds: string[];
    signal?: AbortSignal;
  }): Promise<ProxyVerificationResult> {
    this.request(input, ["projectId", "assetIds", "signal"], input.projectId);
    this.ids(input.assetIds);
    return this.context.exclusive(async (lease) => {
      const results: ProxyVerificationResult["results"] = [];
      for (const assetId of input.assetIds) {
        checkAbort(input.signal);
        const asset = this.context.host.catalog.getAsset(assetId);
        if (!asset)
          throw new ApplicationError(
            "media.notFound",
            "Preview source was not found.",
            404,
          );
        const artifactId =
          this.context.store.preferred(assetId) ??
          this.context.store.artifactId(asset.proxyUri);
        if (!artifactId) {
          results.push({
            assetId,
            status: asset.proxyUri ? "legacy" : "missing",
            sourceStatus: "unavailable",
          });
          continue;
        }
        const receipt = this.context.store.receipt(artifactId)?.receipt;
        if (!receipt) {
          results.push({
            assetId,
            status: "unavailable",
            sourceStatus: "unavailable",
          });
          continue;
        }
        let sourceStatus: ProxyVerificationResult["results"][number]["sourceStatus"] =
          "verified";
        try {
          await this.verifiedFile(
            localPath(asset.uri),
            receipt.sourceHash,
            input.signal,
          );
        } catch (error) {
          checkAbort(input.signal);
          sourceStatus =
            (error as NodeJS.ErrnoException).code === "ENOENT"
              ? "missing"
              : error instanceof ApplicationError
                ? "changed"
                : "unavailable";
        }
        let status: "verified" | "stale" =
          sourceStatus === "changed" ||
          receipt.assetId !== assetId ||
          receipt.inputFingerprint !== proxyInputFingerprint(asset)
            ? "stale"
            : "verified";
        let identity: string;
        try {
          identity = fileIdentity(
            await lstat(this.context.store.outputPath(receipt)),
          );
          try {
            await this.verifiedFile(
              this.context.store.outputPath(receipt),
              receipt.output.hash,
              input.signal,
            );
          } catch (error) {
            checkAbort(input.signal);
            if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
            status = "stale";
          }
        } catch (error) {
          checkAbort(input.signal);
          results.push({
            assetId,
            status:
              (error as NodeJS.ErrnoException).code === "ENOENT"
                ? "missing"
                : "unavailable",
            sourceStatus,
          });
          continue;
        }
        lease.assertOwned();
        checkAbort(input.signal);
        if (
          fileIdentity(lstatSync(this.context.store.outputPath(receipt))) !==
            identity ||
          proxyInputFingerprint(
            this.context.host.catalog.getAsset(assetId)!,
          ) !== proxyInputFingerprint(asset)
        )
          stale();
        this.context.store.saveVerification(artifactId, identity, {
          status,
          sourceStatus,
        });
        results.push({ assetId, status, sourceStatus });
      }
      return { results };
    });
  }
}
