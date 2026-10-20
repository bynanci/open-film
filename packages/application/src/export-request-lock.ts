// Modified by OpenFilm contributors on 2026-10-20. See LICENSE/NOTICE.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ReviewExecutionOwner } from "@openfilm/core";
import { createReviewOwner, reviewOwnerState } from "./review-owner.js";

interface LockRecord {
  version: 1;
  owner: ReviewExecutionOwner;
  processStart?: string;
  fingerprint: string;
}
const busy = () =>
  new Error(
    "Export requestId is already running in another process or its owner cannot be verified; retry after it finishes or choose a new requestId.",
  );
const sameFile = (left: Stats, right: Stats) =>
  left.dev === right.dev && left.ino === right.ino;

function processStart(pid: number): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const value = readFileSync(`/proc/${pid}/stat`, "utf8");
    const ticks = value.slice(value.lastIndexOf(")") + 2).split(/\s+/u)[19];
    return ticks && /^\d+$/u.test(ticks) ? ticks : undefined;
  } catch {
    return undefined;
  }
}

function readLock(
  path: string,
): { record: LockRecord; identity: Stats } | undefined {
  let before: Stats;
  try {
    before = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size > 4096)
    throw busy();
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const identity = fstatSync(fd);
    if (!identity.isFile() || !sameFile(before, identity)) throw busy();
    const buffer = Buffer.alloc(4097);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > 4096) throw busy();
    let value: LockRecord;
    try {
      value = JSON.parse(
        buffer.subarray(0, length).toString("utf8"),
      ) as LockRecord;
    } catch {
      throw busy();
    }
    if (
      !value ||
      typeof value !== "object" ||
      value.version !== 1 ||
      typeof value.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value.fingerprint) ||
      !value.owner ||
      typeof value.owner.host !== "string" ||
      !Number.isSafeInteger(value.owner.pid) ||
      value.owner.pid < 1 ||
      value.owner.pid > 2147483647 ||
      typeof value.owner.token !== "string" ||
      !/^[a-f0-9-]{36}$/u.test(value.owner.token) ||
      (value.processStart !== undefined &&
        !/^\d+$/u.test(value.processStart)) ||
      !sameFile(identity, lstatSync(path))
    )
      throw busy();
    return { record: value, identity };
  } finally {
    closeSync(fd);
  }
}

function dead(record: LockRecord): boolean {
  const state = reviewOwnerState(record.owner);
  if (state === "dead") return true;
  if (state !== "alive" || !record.processStart) return false;
  const current = processStart(record.owner.pid);
  return current !== undefined && current !== record.processStart;
}

/** Atomically publish complete owners; only verified dead owners are reclaimed. */
export function acquireExportRequestLock(
  path: string,
  fingerprint: string,
  depth = 0,
): () => void {
  if (depth > 8) throw busy();
  const owner = createReviewOwner();
  const record: LockRecord = {
    version: 1,
    owner,
    processStart: processStart(owner.pid),
    fingerprint,
  };
  const temporary = join(
    dirname(path),
    `.${basename(path)}.owner-${owner.token}.tmp`,
  );
  const fd = openSync(temporary, "wx", 0o600);
  let identity: Stats;
  let initialized = false;
  try {
    writeFileSync(fd, JSON.stringify(record));
    fsyncSync(fd);
    identity = fstatSync(fd);
    initialized = true;
  } finally {
    try {
      closeSync(fd);
    } finally {
      if (!initialized) unlinkSync(temporary);
    }
  }
  try {
    try {
      linkSync(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const observed = readLock(path);
      if (observed) {
        if (!dead(observed.record)) throw busy();
        // Other reclaimers of this exact owner must serialize and re-read the
        // inode/token, so none can unlink a subsequently published live owner.
        const recovery = join(
          dirname(path),
          `.recover-${createHash("sha256")
            .update(
              `${path}\0${observed.record.owner.token}\0${observed.identity.dev}:${observed.identity.ino}`,
            )
            .digest("hex")
            .slice(0, 32)}.lock`,
        );
        const releaseRecovery = acquireExportRequestLock(
          recovery,
          fingerprint,
          depth + 1,
        );
        try {
          const latest = readLock(path);
          if (
            latest &&
            latest.record.owner.token === observed.record.owner.token &&
            sameFile(latest.identity, observed.identity) &&
            dead(latest.record)
          )
            unlinkSync(path);
        } finally {
          releaseRecovery();
        }
      }
      try {
        linkSync(temporary, path);
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code === "EEXIST") throw busy();
        throw failure;
      }
    }
  } finally {
    unlinkSync(temporary);
  }
  return () => {
    const current = readLock(path);
    if (!current) return;
    if (
      current.record.owner.token !== owner.token ||
      !sameFile(current.identity, identity)
    )
      throw new Error(
        "Export request lock changed ownership; the replacement was left untouched.",
      );
    unlinkSync(path);
  };
}
