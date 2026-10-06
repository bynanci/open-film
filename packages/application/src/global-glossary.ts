import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import {
  ApplicationError,
  validateGlossaryEntry,
  type GlossaryEntry,
  type GlossaryInput,
} from "@openfilm/core";

const MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 1000;
const PRIMARY_NAME = "global-glossary.json";

interface GlossaryFile {
  version: 1;
  entries: GlossaryEntry[];
}

interface LockOwner {
  version: 1;
  pid: number;
  token: string;
  createdAt: string;
}

function busy(
  detail = "Another OpenFilm process is updating global glossary terms. Retry when it finishes.",
): ApplicationError {
  return new ApplicationError(
    "glossary.storageBusy",
    "Global glossary storage is busy. Retry the change.",
    409,
    undefined,
    detail,
  );
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Permission failures and unknown platform errors cannot prove an owner dead.
    return errorCode(error) !== "ESRCH";
  }
}

class UnsupportedGlossaryVersion extends Error {}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function storageError(message: string, cause?: unknown): ApplicationError {
  const detail =
    cause instanceof Error ? `${message}: ${cause.message}` : message;
  return new ApplicationError(
    "operation.failed",
    message,
    500,
    undefined,
    detail,
  );
}

function regularFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw storageError(`Global glossary path is not a regular file: ${path}`);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function validateFile(value: unknown): GlossaryFile {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.hasOwn(value, "version")
  )
    throw new Error("Expected a versioned global glossary object");
  const file = value as { version: unknown; entries?: unknown };
  if (file.version !== 1)
    throw new UnsupportedGlossaryVersion("Unsupported global glossary version");
  if (!Array.isArray(file.entries) || file.entries.length > MAX_ENTRIES)
    throw new Error(`Expected at most ${MAX_ENTRIES} global glossary entries`);
  const ids = new Set<string>();
  const sources = new Set<string>();
  const entries = file.entries.map((value) => {
    const entry = validateGlossaryEntry(value);
    if (entry.scope !== "global")
      throw new Error("Global glossary cannot contain project-scoped entries");
    if (entry.source.length > 512 || entry.replacement.length > 4096)
      throw new Error("Global glossary term exceeds its allowed length");
    if (ids.has(entry.id) || sources.has(entry.source))
      throw new Error("Global glossary contains duplicate ids or source terms");
    ids.add(entry.id);
    sources.add(entry.source);
    return entry;
  });
  return { version: 1, entries };
}

/** User-owned, offline glossary storage. Project terms stay in the project catalog. */
export class GlobalGlossaryStore {
  readonly directory: string;
  readonly filePath: string;
  readonly backupPath: string;
  readonly lockPath: string;

  constructor(userDataDirectory: string) {
    if (typeof userDataDirectory !== "string" || !userDataDirectory.trim())
      throw new ApplicationError(
        "request.invalid",
        "A user data directory is required for the global glossary",
      );
    this.directory = resolve(userDataDirectory);
    this.filePath = join(this.directory, PRIMARY_NAME);
    this.backupPath = `${this.filePath}.bak`;
    this.lockPath = `${this.filePath}.lock`;
    this.ensureDirectory(false);
  }

  list(): GlossaryEntry[] {
    // Always reload: another store instance may have written since our last call.
    return this.read().entries;
  }

  upsert(input: GlossaryInput): GlossaryEntry {
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      input.scope !== "global" ||
      (input.id !== undefined && typeof input.id !== "string") ||
      (input.enabled !== undefined && typeof input.enabled !== "boolean") ||
      (input.caseSensitive !== undefined &&
        typeof input.caseSensitive !== "boolean")
    )
      throw new ApplicationError(
        "request.invalid",
        "Global glossary entries must have global scope",
      );
    // Reject malformed terms before creating a previously absent user directory.
    try {
      validateGlossaryEntry({
        ...input,
        id: input.id ?? "input-validation",
        enabled: input.enabled ?? true,
        caseSensitive: input.caseSensitive ?? true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      throw new ApplicationError(
        "request.invalid",
        "Invalid global glossary entry",
        400,
        undefined,
        String(error),
      );
    }
    return this.withLock(() => this.upsertLocked(input));
  }

  private upsertLocked(input: GlossaryInput): GlossaryEntry {
    const previous = this.read(true);
    const byId = input.id
      ? previous.entries.find((entry) => entry.id === input.id)
      : undefined;
    if (input.id !== undefined && !byId)
      throw new ApplicationError(
        "request.notFound",
        "Global glossary entry was not found",
        404,
      );
    const bySource = previous.entries.find(
      (entry) => entry.source === input.source,
    );
    if (byId && bySource && byId.id !== bySource.id)
      throw new ApplicationError(
        "glossary.entryConflict",
        "Another global glossary entry already uses this source term",
        409,
      );
    const existing = byId ?? bySource;
    const now = new Date().toISOString();
    let entry: GlossaryEntry;
    try {
      entry = validateGlossaryEntry({
        id: existing?.id ?? input.id ?? randomUUID(),
        source: input.source,
        replacement: input.replacement,
        scope: "global",
        enabled: input.enabled ?? existing?.enabled ?? true,
        caseSensitive: input.caseSensitive ?? existing?.caseSensitive ?? true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      if (entry.source.length > 512 || entry.replacement.length > 4096)
        throw new Error("Global glossary term exceeds its allowed length");
    } catch (error) {
      throw new ApplicationError(
        "request.invalid",
        "Invalid global glossary entry",
        400,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
    const entries = existing
      ? previous.entries.map((item) => (item.id === existing.id ? entry : item))
      : [...previous.entries, entry];
    this.save(previous, { version: 1, entries });
    return entry;
  }

  remove(id: string): boolean {
    if (typeof id !== "string" || !id.trim() || id.length > 256)
      throw new ApplicationError(
        "request.invalid",
        "Invalid glossary entry id",
      );
    // A missing entry is a read-only no-op, including a missing user directory.
    if (!this.read().entries.some((entry) => entry.id === id)) return false;
    return this.withLock(() => {
      const previous = this.read(true);
      const entries = previous.entries.filter((entry) => entry.id !== id);
      if (entries.length === previous.entries.length) return false;
      this.save(previous, { version: 1, entries });
      return true;
    });
  }

  private lockOwner(path: string): LockOwner | undefined {
    if (!regularFile(path)) return undefined;
    let fd: number;
    try {
      fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      // The previous owner may release between lstat and open. This means
      // contention ended; it does not mean the glossary storage is corrupt.
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size < 1 || stat.size > 1024)
        throw busy(
          "The glossary lock owner cannot be verified; its lock was left untouched.",
        );
      const buffer = Buffer.alloc(1025);
      let length = 0;
      while (length < buffer.length) {
        const count = readSync(
          fd,
          buffer,
          length,
          buffer.length - length,
          null,
        );
        if (!count) break;
        length += count;
      }
      if (length > 1024)
        throw busy(
          "The glossary lock owner cannot be verified; its lock was left untouched.",
        );
      let owner: unknown;
      try {
        owner = JSON.parse(buffer.subarray(0, length).toString("utf8"));
      } catch {
        throw busy(
          "The glossary lock owner is incomplete or invalid; its lock was left untouched.",
        );
      }
      if (!owner || typeof owner !== "object" || Array.isArray(owner))
        throw busy(
          "The glossary lock owner cannot be verified; its lock was left untouched.",
        );
      const value = owner as Record<string, unknown>;
      if (
        value.version !== 1 ||
        !Number.isSafeInteger(value.pid) ||
        Number(value.pid) < 1 ||
        Number(value.pid) > 2147483647 ||
        typeof value.token !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
          value.token,
        ) ||
        typeof value.createdAt !== "string" ||
        !Number.isFinite(Date.parse(value.createdAt))
      )
        throw busy(
          "The glossary lock owner cannot be verified; its lock was left untouched.",
        );
      return value as unknown as LockOwner;
    } finally {
      closeSync(fd);
    }
  }

  private releaseLock(path: string, token: string): void {
    const owner = this.lockOwner(path);
    if (!owner) return;
    if (owner.token !== token)
      throw busy(
        "The glossary lock changed ownership; the replacement lock was left untouched.",
      );
    unlinkSync(path);
  }

  private acquireLock(path = this.lockPath, depth = 0): () => void {
    if (depth > 8)
      throw busy(
        "Repeated interrupted glossary lock recovery needs inspection; all unverified locks were left untouched.",
      );
    this.ensureDirectory(true);
    const owner: LockOwner = {
      version: 1,
      pid: process.pid,
      token: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const temporary = join(
      this.directory,
      `.${PRIMARY_NAME}.owner-${owner.token}.tmp`,
    );
    let fd: number | undefined;
    let claimed = false;
    let failure: unknown;
    try {
      // A hard link publishes the complete owner atomically. There is never an
      // empty/partially-written lock that another process can mistake for stale.
      fd = openSync(temporary, "wx", 0o600);
      writeFileSync(fd, JSON.stringify(owner), "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      try {
        linkSync(temporary, path);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        const observed = this.lockOwner(path);
        if (observed && processAlive(observed.pid)) throw busy();
        if (observed) {
          // Serialize reclamation for this exact stale token. After taking this
          // recovery lock, re-read so an old contender cannot unlink a new owner.
          const recoveryPath = `${this.lockPath}.recover-${createHash("sha256").update(`${path}\0${observed.token}`).digest("hex").slice(0, 32)}`;
          const release = this.acquireLock(recoveryPath, depth + 1);
          try {
            const latest = this.lockOwner(path);
            if (latest?.token === observed.token && !processAlive(latest.pid))
              unlinkSync(path);
          } finally {
            release();
          }
        }
        try {
          linkSync(temporary, path);
        } catch (error) {
          if (errorCode(error) === "EEXIST") throw busy();
          throw error;
        }
      }
      claimed = true;
    } catch (error) {
      failure = error;
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch (error) {
          failure ??= error;
        }
      }
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") failure ??= error;
      }
    }
    if (failure) {
      if (claimed) this.releaseLock(path, owner.token);
      if (failure instanceof ApplicationError) throw failure;
      throw storageError("Cannot safely lock global glossary storage", failure);
    }
    return () => this.releaseLock(path, owner.token);
  }

  private withLock<T>(action: () => T): T {
    const release = this.acquireLock();
    try {
      return action();
    } finally {
      release();
    }
  }

  private ensureDirectory(create: boolean): void {
    // Check before recursive mkdir, which would otherwise follow an ancestor link.
    const root = parse(this.directory).root;
    const ancestors: string[] = [];
    for (let path = this.directory; path !== root; path = dirname(path))
      ancestors.push(path);
    ancestors.push(root);
    for (const path of ancestors.reverse()) {
      try {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw storageError(`Global glossary directory is unsafe: ${path}`);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
    if (create) mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  private readFile(path: string): GlossaryFile | undefined {
    if (!regularFile(path)) return undefined;
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_BYTES)
        throw new Error(`Global glossary exceeds ${MAX_BYTES} bytes`);
      // A file growing after stat is still bounded; never decode an unbounded file.
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let length = 0;
      for (;;) {
        const read = readSync(fd, buffer, length, buffer.length - length, null);
        if (!read) break;
        length += read;
        if (length > MAX_BYTES)
          throw new Error(`Global glossary exceeds ${MAX_BYTES} bytes`);
      }
      return validateFile(
        JSON.parse(buffer.subarray(0, length).toString("utf8")),
      );
    } finally {
      closeSync(fd);
    }
  }

  private read(locked = false): GlossaryFile {
    this.ensureDirectory(false);
    // An unsafe backup is also rejected, even when the current file is healthy.
    regularFile(this.backupPath);
    let primaryError: unknown;
    try {
      const primary = this.readFile(this.filePath);
      if (primary) return primary;
    } catch (error) {
      if (
        error instanceof UnsupportedGlossaryVersion ||
        error instanceof ApplicationError
      )
        throw storageError("Cannot read the global glossary", error);
      primaryError = error;
    }
    try {
      const backup = this.readFile(this.backupPath);
      if (backup) {
        // Recovery also mutates storage. Re-read after locking so a concurrently
        // committed new primary cannot be overwritten by an older backup.
        if (!locked) return this.withLock(() => this.read(true));
        this.atomicWrite(this.filePath, this.serialize(backup));
        return backup;
      }
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        error.code === "glossary.storageBusy"
      )
        throw error;
      throw storageError("Cannot recover the global glossary backup", error);
    }
    if (primaryError)
      throw storageError(
        "Cannot read the global glossary; no valid backup exists",
        primaryError,
      );
    return { version: 1, entries: [] };
  }

  private serialize(file: GlossaryFile): string {
    if (file.entries.length > MAX_ENTRIES)
      throw new ApplicationError(
        "request.tooLarge",
        `Global glossary exceeds ${MAX_ENTRIES} entries`,
        413,
      );
    const content = `${JSON.stringify(validateFile(file), null, 2)}\n`;
    if (Buffer.byteLength(content, "utf8") > MAX_BYTES)
      throw new ApplicationError(
        "request.tooLarge",
        `Global glossary exceeds ${MAX_BYTES} bytes`,
        413,
      );
    return content;
  }

  private save(previous: GlossaryFile, next: GlossaryFile): void {
    // Validate both before touching either file, including the total payload size.
    const content = this.serialize(next);
    const backup = this.serialize(previous);
    this.ensureDirectory(true);
    regularFile(this.filePath);
    regularFile(this.backupPath);
    this.atomicWrite(this.backupPath, backup);
    this.atomicWrite(this.filePath, content);
  }

  private atomicWrite(path: string, content: string): void {
    this.ensureDirectory(true);
    regularFile(path);
    const temporary = join(
      this.directory,
      `.${PRIMARY_NAME}.${randomUUID()}.tmp`,
    );
    let fd: number | undefined;
    let failure: unknown;
    try {
      fd = openSync(temporary, "wx", 0o600);
      writeFileSync(fd, content, "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      regularFile(path);
      renameSync(temporary, path);
      // Directory fsync makes the rename durable on platforms that support it.
      let directoryFd: number | undefined;
      try {
        directoryFd = openSync(this.directory, constants.O_RDONLY);
        fsyncSync(directoryFd);
      } catch (error) {
        if (
          process.platform !== "win32" ||
          !["EINVAL", "ENOTSUP", "EPERM", "EACCES", "EISDIR"].includes(
            errorCode(error) ?? "",
          )
        )
          throw error;
      } finally {
        if (directoryFd !== undefined) closeSync(directoryFd);
      }
    } catch (error) {
      failure = error;
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch (error) {
          failure ??= error;
        }
      }
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") failure ??= error;
      }
    }
    if (failure) throw failure;
  }
}
