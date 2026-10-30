// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readSync,
  renameSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ApplicationError,
  PROXY_CACHE_LIMITS,
  validateProxyCachePolicy,
  validateProxyCacheReceipt,
  type ProxyCachePolicy,
  type ProxyCacheReceipt,
  type ReviewExecutionOwner,
} from "@openfilm/core";
import { acquireExportRequestLock } from "./export-request-lock.js";
import { createReviewOwner, reviewOwnerState } from "./review-owner.js";

import { proxyDigest } from "./proxy-cache-identity.js";
export { proxyDigest } from "./proxy-cache-identity.js";
export const fileIdentity = (s: Stats): string =>
  `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/** Bounded regular-file reads; never follow a project-supplied symlink. */
export function readProxyJson(
  path: string,
  maximum: number = PROXY_CACHE_LIMITS.receiptBytes,
): { value: unknown; identity: string; digest: string } | undefined {
  let before: Stats;
  try {
    before = lstatSync(path);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum)
    throw new ApplicationError(
      "proxy.storageUnavailable",
      "Proxy state is not a bounded regular file.",
      409,
    );
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = fstatSync(fd);
    if (fileIdentity(info) !== fileIdentity(before))
      throw new ApplicationError(
        "proxy.stale",
        "Proxy state changed during its read.",
        409,
      );
    const bytes = Buffer.alloc(Math.min(maximum + 1, info.size + 1));
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (
      length > maximum ||
      fileIdentity(lstatSync(path)) !== fileIdentity(info)
    )
      throw new ApplicationError(
        "proxy.stale",
        "Proxy state changed during its read.",
        409,
      );
    const raw = bytes.subarray(0, length);
    return {
      value: JSON.parse(raw.toString("utf8")),
      identity: fileIdentity(info),
      digest: createHash("sha256").update(raw).digest("hex"),
    };
  } finally {
    closeSync(fd);
  }
}

export interface ProxyWorkerLease {
  owner: ReviewExecutionOwner;
  assertOwned(): void;
  release(): void;
}

export interface ProxyRecordedVerification {
  status: "verified" | "stale";
  sourceStatus: "verified" | "missing" | "changed" | "unavailable";
  checkedAt: string;
}

export interface ProxyReaderRecovery {
  name: string;
  fingerprint: string;
  ownerState: "alive" | "dead" | "unknown";
}

export class ProxyCacheStore {
  readonly managed: string;
  readonly operational: string;
  readonly work: string;
  readonly readers: string;
  private readonly policyPath: string;
  private readonly lockPath: string;
  private readonly touched = new Map<string, number>();
  private readonly readerOwner = createReviewOwner();

  constructor(
    readonly directory: string,
    readonly projectId: string,
  ) {
    this.managed = join(directory, "cache/proxies/managed");
    this.operational = join(directory, "cache/proxy-manager");
    this.work = join(this.operational, "work");
    this.readers = join(this.operational, "readers");
    this.policyPath = join(this.operational, "policy.json");
    this.lockPath = join(this.operational, "worker.lock");
  }

  ensure(): void {
    const root = lstatSync(this.directory);
    if (!root.isDirectory() || root.isSymbolicLink())
      throw new Error("Unsafe project root.");
    for (const part of [
      "cache",
      "cache/proxies",
      "cache/proxies/managed",
      "cache/proxy-manager",
      "cache/proxy-manager/work",
      "cache/proxy-manager/readers",
    ]) {
      const path = join(this.directory, part);
      try {
        mkdirSync(path, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const info = lstatSync(path);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new ApplicationError(
          "proxy.storageUnavailable",
          "Proxy storage cannot traverse a link or non-directory.",
          409,
        );
    }
  }

  policy(): ProxyCachePolicy {
    this.ensure();
    const stored = readProxyJson(this.policyPath);
    return stored
      ? validateProxyCachePolicy(stored.value)
      : {
          version: 1,
          revision: 0,
          quotaBytes: PROXY_CACHE_LIMITS.defaultQuotaBytes,
        };
  }

  savePolicy(policy: ProxyCachePolicy): void {
    this.ensure();
    const value = validateProxyCachePolicy(policy);
    readProxyJson(this.policyPath);
    this.write(this.policyPath, value, true);
  }

  private write(path: string, value: unknown, replace = false): void {
    const temporary = join(dirname(path), `.write-${randomUUID()}.tmp`);
    let failure: unknown;
    try {
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(value));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (replace) renameSync(temporary, path);
      else linkSync(temporary, path);
    } catch (error) {
      failure = error;
    }
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (!missing(error)) failure ??= error;
    }
    if (failure) throw failure;
  }

  receipt(
    id: string,
  ):
    | { receipt: ProxyCacheReceipt; identity: string; digest: string }
    | undefined {
    if (!/^[a-f0-9]{64}$/u.test(id))
      throw new Error("Invalid proxy artifact identity.");
    this.ensure();
    const data = readProxyJson(join(this.managed, `${id}.json`));
    if (!data) return undefined;
    const receipt = validateProxyCacheReceipt(data.value);
    if (receipt.projectId !== this.projectId || receipt.artifactId !== id)
      throw new ApplicationError(
        "proxy.stale",
        "Proxy receipt belongs to another project or artifact.",
        409,
      );
    return { receipt, identity: data.identity, digest: data.digest };
  }

  saveReceipt(receipt: ProxyCacheReceipt): void {
    const value = validateProxyCacheReceipt(receipt);
    if (value.projectId !== this.projectId)
      throw new Error("Foreign proxy receipt.");
    this.ensure();
    this.write(join(this.managed, `${value.artifactId}.json`), value);
  }

  preferred(assetId: string): string | undefined {
    this.ensure();
    const record = readProxyJson(
      join(this.operational, `preferred-${proxyDigest(assetId)}.json`),
    );
    if (!record) return undefined;
    const value = record.value as {
      version?: unknown;
      projectId?: unknown;
      assetId?: unknown;
      artifactId?: unknown;
    };
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) =>
          !["version", "projectId", "assetId", "artifactId"].includes(key),
      ) ||
      value.version !== 1 ||
      value.projectId !== this.projectId ||
      value.assetId !== assetId ||
      typeof value.artifactId !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value.artifactId)
    )
      throw new ApplicationError(
        "proxy.storageUnavailable",
        "Unsupported preferred-proxy state.",
        409,
      );
    return value.artifactId;
  }

  setPreferred(assetId: string, artifactId: string): void {
    const receipt = this.receipt(artifactId)?.receipt;
    if (!receipt || receipt.assetId !== assetId)
      throw new Error("Preferred proxy does not belong to this source.");
    this.preferred(assetId);
    this.write(
      join(this.operational, `preferred-${proxyDigest(assetId)}.json`),
      { version: 1, projectId: this.projectId, assetId, artifactId },
      true,
    );
  }

  clearPreferred(assetId: string, artifactId: string): void {
    if (this.preferred(assetId) === artifactId)
      unlinkSync(
        join(this.operational, `preferred-${proxyDigest(assetId)}.json`),
      );
  }

  verification(
    artifactId: string,
    identity: string,
  ): ProxyRecordedVerification | undefined {
    if (!/^[a-f0-9]{64}$/u.test(artifactId))
      throw new Error("Invalid proxy artifact identity.");
    const data = readProxyJson(
      join(this.operational, `verified-${artifactId}.json`),
    );
    if (!data) return undefined;
    const value = data.value as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) =>
          ![
            "version",
            "projectId",
            "artifactId",
            "identity",
            "status",
            "sourceStatus",
            "checkedAt",
          ].includes(key),
      ) ||
      value.version !== 1 ||
      value.projectId !== this.projectId ||
      value.artifactId !== artifactId ||
      typeof value.identity !== "string" ||
      value.identity.length > 512 ||
      !["verified", "stale"].includes(String(value.status)) ||
      !["verified", "missing", "changed", "unavailable"].includes(
        String(value.sourceStatus),
      ) ||
      typeof value.checkedAt !== "string" ||
      !Number.isFinite(Date.parse(value.checkedAt))
    )
      throw new ApplicationError(
        "proxy.storageUnavailable",
        "Unsupported proxy verification record.",
        409,
      );
    if (value.identity !== identity) return undefined;
    return {
      status: value.status as "verified" | "stale",
      sourceStatus:
        value.sourceStatus as ProxyRecordedVerification["sourceStatus"],
      checkedAt: value.checkedAt,
    };
  }

  saveVerification(
    artifactId: string,
    identity: string,
    value: Omit<ProxyRecordedVerification, "checkedAt">,
  ): void {
    if (!/^[a-f0-9]{64}$/u.test(artifactId))
      throw new Error("Invalid proxy artifact identity.");
    this.verification(artifactId, identity);
    this.write(
      join(this.operational, `verified-${artifactId}.json`),
      {
        version: 1,
        projectId: this.projectId,
        artifactId,
        identity,
        ...value,
        checkedAt: new Date().toISOString(),
      },
      true,
    );
  }

  artifactId(uri: string | undefined): string | undefined {
    return (
      (uri &&
        /^cache\/proxies\/managed\/([a-f0-9]{64})\.(?:mp4|mp3)$/u.exec(
          uri,
        )?.[1]) ||
      undefined
    );
  }

  outputPath(receipt: ProxyCacheReceipt): string {
    validateProxyCacheReceipt(receipt);
    this.ensure();
    return resolve(this.directory, receipt.output.uri);
  }

  lease(): ProxyWorkerLease {
    this.ensure();
    let release: () => void;
    try {
      release = acquireExportRequestLock(
        this.lockPath,
        proxyDigest([this.projectId, "proxy-cache-v1"]),
      );
    } catch (error) {
      throw new ApplicationError(
        "jobs.busy",
        "Proxy storage is owned by another worker or its owner is unknown.",
        409,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
    const claimed = readProxyJson(this.lockPath, 4096)!;
    const owner = (claimed.value as { owner: ReviewExecutionOwner }).owner;
    const assertOwned = () => {
      const current = readProxyJson(this.lockPath, 4096);
      if (
        !current ||
        current.digest !== claimed.digest ||
        current.identity !== claimed.identity
      )
        throw new ApplicationError(
          "proxy.stale",
          "The proxy worker lease changed.",
          409,
        );
    };
    return {
      owner,
      assertOwned,
      release: () => {
        const current = readProxyJson(this.lockPath, 4096);
        if (
          current?.digest === claimed.digest &&
          current.identity === claimed.identity
        )
          release();
      },
    };
  }

  recovery():
    | { fingerprint: string; ownerState: "alive" | "dead" | "unknown" }
    | undefined {
    this.ensure();
    const stored = readProxyJson(this.lockPath, 4096);
    if (!stored) return undefined;
    const owner = (stored.value as { owner?: unknown })?.owner;
    return {
      fingerprint: proxyDigest([stored.digest, stored.identity]),
      ownerState: reviewOwnerState(owner),
    };
  }

  recover(
    fingerprint: string,
    confirmedStopped: boolean,
  ): ReviewExecutionOwner | undefined {
    this.ensure();
    const current = readProxyJson(this.lockPath, 4096);
    if (!current) return undefined;
    if (
      !confirmedStopped ||
      fingerprint !== proxyDigest([current.digest, current.identity])
    )
      throw new ApplicationError(
        "proxy.stale",
        "Confirm the exact observed abandoned worker before recovery.",
        409,
      );
    const owner = (current.value as { owner?: ReviewExecutionOwner }).owner;
    if (reviewOwnerState(owner) === "alive")
      throw new ApplicationError(
        "jobs.busy",
        "A live proxy worker cannot be recovered.",
        409,
      );
    const release = acquireExportRequestLock(
      join(this.operational, `recovery-${fingerprint}.lock`),
      fingerprint,
    );
    try {
      const latest = readProxyJson(this.lockPath, 4096);
      if (
        !latest ||
        latest.digest !== current.digest ||
        latest.identity !== current.identity
      )
        throw new ApplicationError(
          "proxy.stale",
          "Proxy ownership changed during recovery.",
          409,
        );
      unlinkSync(this.lockPath);
      return owner;
    } finally {
      release();
    }
  }

  reader(artifactId: string): () => void {
    if (!/^[a-f0-9]{64}$/u.test(artifactId))
      throw new Error("Invalid proxy artifact identity.");
    this.ensure();
    const path = join(this.readers, `${artifactId}-${randomUUID()}.lock`);
    this.write(path, {
      version: 1,
      owner: this.readerOwner,
      fingerprint: proxyDigest([this.projectId, artifactId]),
    });
    const claimed = readProxyJson(path, 4096)!;
    return () => {
      const current = readProxyJson(path, 4096);
      if (
        current?.digest === claimed.digest &&
        current.identity === claimed.identity
      )
        unlinkSync(path);
    };
  }

  hasReaders(artifactId: string): boolean {
    this.ensure();
    const directory = opendirSync(this.readers);
    let visited = 0;
    try {
      for (
        let entry = directory.readSync();
        entry;
        entry = directory.readSync()
      ) {
        if (++visited > PROXY_CACHE_LIMITS.inventoryFiles) return true;
        const name = entry.name;
        if (!name.startsWith(`${artifactId}-`)) continue;
        try {
          const data = readProxyJson(join(this.readers, name), 4096);
          if (
            data &&
            reviewOwnerState((data.value as { owner?: unknown }).owner) !==
              "dead"
          )
            return true;
        } catch {
          return true;
        }
      }
      return false;
    } finally {
      directory.closeSync();
    }
  }

  readerRecoveries(): ProxyReaderRecovery[] {
    this.ensure();
    const directory = opendirSync(this.readers);
    const result: ProxyReaderRecovery[] = [];
    let count = 0;
    try {
      for (
        let entry = directory.readSync();
        entry;
        entry = directory.readSync()
      ) {
        if (++count > PROXY_CACHE_LIMITS.inventoryFiles)
          throw new ApplicationError(
            "proxy.storageUnavailable",
            "Too many proxy access records.",
            409,
          );
        if (!/^[a-f0-9]{64}-[a-f0-9-]{36}\.lock$/u.test(entry.name)) continue;
        const data = readProxyJson(join(this.readers, entry.name), 4096);
        if (data)
          result.push({
            name: entry.name,
            fingerprint: proxyDigest([data.digest, data.identity]),
            ownerState: reviewOwnerState(
              (data.value as { owner?: unknown })?.owner,
            ),
          });
      }
      return result;
    } finally {
      directory.closeSync();
    }
  }

  recoverReaders(records: readonly ProxyReaderRecovery[]): void {
    const current = new Map(
      this.readerRecoveries().map((record) => [record.name, record]),
    );
    for (const record of records) {
      const latest = current.get(record.name);
      if (
        !latest ||
        latest.fingerprint !== record.fingerprint ||
        latest.ownerState === "alive"
      )
        throw new ApplicationError(
          "proxy.stale",
          "Preview access ownership changed during recovery.",
          409,
        );
    }
    for (const record of records) unlinkSync(join(this.readers, record.name));
  }

  cleanStoppedWork(
    stopped: (owner: ReviewExecutionOwner) => boolean,
    protectedPath: (path: string) => boolean,
  ): number {
    try {
      if (
        !lstatSync(this.work).isDirectory() ||
        lstatSync(this.work).isSymbolicLink()
      )
        return 0;
    } catch (error) {
      if (missing(error)) return 0;
      throw error;
    }
    this.ensure();
    const root = opendirSync(this.work);
    let visited = 0;
    let removed = 0;
    const boundedTree = (
      path: string,
      count: { value: number },
      depth = 0,
    ): boolean => {
      if (++count.value > 64 || depth > 4) return false;
      const info = lstatSync(path);
      if (info.isSymbolicLink()) return false;
      if (info.isFile()) return true;
      if (!info.isDirectory()) return false;
      const directory = opendirSync(path);
      try {
        for (
          let child = directory.readSync();
          child;
          child = directory.readSync()
        )
          if (!boundedTree(join(path, child.name), count, depth + 1))
            return false;
        return true;
      } finally {
        directory.closeSync();
      }
    };
    try {
      for (let entry = root.readSync(); entry; entry = root.readSync()) {
        if (++visited > PROXY_CACHE_LIMITS.inventoryFiles) break;
        if (!/^proxy-[a-f0-9]{64}-[a-zA-Z0-9]{6}$/u.test(entry.name)) continue;
        const path = join(this.work, entry.name);
        const info = lstatSync(path);
        if (!info.isDirectory() || info.isSymbolicLink()) continue;
        const data = readProxyJson(join(path, "owner.json"), 4096);
        const value = data?.value as
          | {
              version?: unknown;
              projectId?: unknown;
              jobId?: unknown;
              generation?: unknown;
              owner?: ReviewExecutionOwner;
            }
          | undefined;
        const owner = value?.owner;
        if (
          !data ||
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).some(
            (key) =>
              ![
                "version",
                "projectId",
                "jobId",
                "generation",
                "owner",
              ].includes(key),
          ) ||
          value.version !== 1 ||
          value.projectId !== this.projectId ||
          typeof value.jobId !== "string" ||
          !/^proxy-[a-f0-9]{64}$/u.test(value.jobId) ||
          !entry.name.startsWith(`${value.jobId}-`) ||
          !Number.isSafeInteger(value.generation) ||
          Number(value.generation) < 1 ||
          !owner ||
          typeof owner !== "object" ||
          Array.isArray(owner) ||
          Object.keys(owner).some(
            (key) => !["host", "pid", "token"].includes(key),
          ) ||
          typeof owner.host !== "string" ||
          !owner.host ||
          owner.host.length > 512 ||
          !Number.isSafeInteger(owner.pid) ||
          owner.pid < 1 ||
          owner.pid > 2147483647 ||
          typeof owner.token !== "string" ||
          !/^[a-f0-9-]{36}$/u.test(owner.token)
        )
          continue;
        if (
          !stopped(owner) ||
          protectedPath(path) ||
          !boundedTree(path, { value: 0 })
        )
          continue;
        if (
          readProxyJson(join(path, "owner.json"), 4096)?.digest !==
            data.digest ||
          fileIdentity(lstatSync(path)) !== fileIdentity(info)
        )
          continue;
        rmSync(path, { recursive: true });
        removed++;
      }
      return removed;
    } finally {
      root.closeSync();
    }
  }

  touch(artifactId: string): void {
    const now = Date.now();
    if (now - (this.touched.get(artifactId) ?? 0) < 30_000) return;
    this.ensure();
    const path = join(this.managed, `${artifactId}.json`);
    if (this.receipt(artifactId))
      utimesSync(path, new Date(now), new Date(now));
    if (this.touched.size >= PROXY_CACHE_LIMITS.inventoryFiles)
      this.touched.clear();
    this.touched.set(artifactId, now);
  }
}
