import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
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

  constructor(userDataDirectory: string) {
    if (typeof userDataDirectory !== "string" || !userDataDirectory.trim())
      throw new ApplicationError(
        "request.invalid",
        "A user data directory is required for the global glossary",
      );
    this.directory = resolve(userDataDirectory);
    this.filePath = join(this.directory, PRIMARY_NAME);
    this.backupPath = `${this.filePath}.bak`;
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
    const previous = this.read();
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
    const previous = this.read();
    const entries = previous.entries.filter((entry) => entry.id !== id);
    if (entries.length === previous.entries.length) return false;
    this.save(previous, { version: 1, entries });
    return true;
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

  private read(): GlossaryFile {
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
        this.atomicWrite(this.filePath, this.serialize(backup));
        return backup;
      }
    } catch (error) {
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
