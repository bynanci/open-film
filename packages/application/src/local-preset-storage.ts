// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import {
  ApplicationError,
  PRESET_LIMITS,
  parsePresetJson,
  presetRecord,
} from "@openfilm/core";
import { createReviewOwner, reviewOwnerState } from "./review-owner.js";

export function presetStorageFailure(
  message = "Local preset storage cannot be verified.",
): ApplicationError {
  return new ApplicationError("presets.storageUnavailable", message, 500);
}
export function checkPresetAbort(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
export interface PresetFile {
  text: string;
  identity: Stats;
}
/** Bounded regular-file descriptor read; a swap cannot redirect this to a link/device. */
export function readPresetFile(
  path: string,
  maximum: number,
  allowLockLinks = false,
): PresetFile | undefined {
  let before: Stats;
  try {
    before = lstatSync(path);
  } catch (e) {
    if (missing(e)) return undefined;
    throw presetStorageFailure();
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    (!allowLockLinks && before.nlink !== 1) ||
    before.size > maximum
  )
    throw presetStorageFailure();
  let fd: number | undefined;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK,
    );
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      !same(before, opened) ||
      opened.size > maximum ||
      (!allowLockLinks && opened.nlink !== 1)
    )
      throw presetStorageFailure();
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (!n) break;
      length += n;
    }
    const after = fstatSync(fd),
      current = lstatSync(path);
    if (
      length > maximum ||
      length !== opened.size ||
      !same(opened, after) ||
      !same(after, current) ||
      current.isSymbolicLink() ||
      current.size !== opened.size ||
      current.mtimeMs !== opened.mtimeMs ||
      current.ctimeMs !== opened.ctimeMs ||
      (!allowLockLinks && current.nlink !== 1)
    )
      throw presetStorageFailure(
        "Local preset file changed during its bounded read.",
      );
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        buffer.subarray(0, length),
      );
    } catch {
      throw presetStorageFailure("Local preset file is not UTF-8.");
    }
    return { text, identity: current };
  } catch (e) {
    if (e instanceof ApplicationError) throw e;
    throw presetStorageFailure();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export async function readLocalPresetDocument(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  checkPresetAbort(signal);
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\0") ||
    !path.match(/^[^\uD800-\uDFFF]*$/u) ||
    /^(?:[\\/]{2}|[a-z][a-z0-9+.-]*:)/iu.test(
      path.replace(/^[a-z]:[\\/]/iu, "/"),
    ) ||
    path.split(/[\\/]/).includes("..")
  )
    throw new ApplicationError(
      "presets.invalid",
      "Choose one regular local JSON file.",
    );
  const full = resolve(path);
  let cursor = full;
  while (cursor !== parse(cursor).root) {
    const s = lstatSync(cursor);
    if (s.isSymbolicLink())
      throw presetStorageFailure(
        "Local preset input must not contain symlinks.",
      );
    cursor = dirname(cursor);
  }
  const value = readPresetFile(full, PRESET_LIMITS.packageBytes);
  if (!value)
    throw new ApplicationError(
      "request.notFound",
      "Local preset file was not found.",
      404,
    );
  checkPresetAbort(signal);
  return value.text;
}
export class LocalPresetStorage {
  private rootIdentity?: Stats;
  private directoryIdentity?: Stats;
  private canonicalRoot?: string;
  constructor(private readonly configuredRoot: string) {
    if (!isAbsolute(configuredRoot) || configuredRoot.includes("\0"))
      throw presetStorageFailure();
  }
  get directory(): string {
    return join(this.canonicalRoot ?? this.configuredRoot, "presets");
  }
  get registryPath(): string {
    return join(this.directory, "registry-v1.json");
  }
  get backupPath(): string {
    return join(this.directory, "registry-v1.json.bak");
  }
  get corruptPath(): string {
    return join(this.directory, "registry-v1.corrupt");
  }
  private hostRoot(): string {
    let ancestor = this.configuredRoot;
    const suffix: string[] = [];
    for (;;) {
      let info: Stats;
      try {
        info = lstatSync(ancestor);
      } catch (error) {
        if (!missing(error) || ancestor === parse(ancestor).root)
          throw presetStorageFailure();
        suffix.unshift(basename(ancestor));
        ancestor = dirname(ancestor);
        continue;
      }
      if (ancestor === this.configuredRoot && info.isSymbolicLink())
        throw presetStorageFailure(
          "The configured preset root must not be a symlink.",
        );
      // Only trusted host ancestors are canonicalized, before the owned boundary.
      const resolved = resolve(realpathSync(ancestor), ...suffix);
      if (this.canonicalRoot && resolved !== this.canonicalRoot)
        throw presetStorageFailure("The trusted preset root changed.");
      this.canonicalRoot ??= resolved;
      return this.canonicalRoot;
    }
  }
  ensure(create = false): boolean {
    const rootPath = this.hostRoot();
    const chain: string[] = [];
    for (let p = rootPath; ; p = dirname(p)) {
      chain.push(p);
      if (p === parse(p).root) break;
    }
    for (const p of chain.reverse()) {
      let s: Stats;
      try {
        s = lstatSync(p);
      } catch (e) {
        if (!missing(e)) throw presetStorageFailure();
        if (!create) return false;
        try {
          mkdirSync(p, { mode: 0o700 });
          s = lstatSync(p);
        } catch {
          throw presetStorageFailure();
        }
      }
      if (!s.isDirectory() || s.isSymbolicLink())
        throw presetStorageFailure(
          "Local preset directory must not contain symlinks.",
        );
    }
    const root = lstatSync(rootPath);
    if (this.rootIdentity && !same(root, this.rootIdentity))
      throw presetStorageFailure("Local preset root changed.");
    this.rootIdentity ??= root;
    let d: Stats;
    try {
      d = lstatSync(this.directory);
    } catch (e) {
      if (!missing(e)) throw presetStorageFailure();
      if (!create) return false;
      mkdirSync(this.directory, { mode: 0o700 });
      d = lstatSync(this.directory);
    }
    if (
      !d.isDirectory() ||
      d.isSymbolicLink() ||
      realpathSync(this.directory) !== resolve(this.directory) ||
      (this.directoryIdentity && !same(d, this.directoryIdentity))
    )
      throw presetStorageFailure("Local preset directory ownership changed.");
    this.directoryIdentity ??= d;
    return true;
  }
  read(): PresetFile | undefined {
    if (!this.ensure()) return undefined;
    return readPresetFile(this.registryPath, PRESET_LIMITS.registryBytes);
  }
  private unlinkOwned(path: string, identity: Stats): void {
    try {
      const current = lstatSync(path);
      if (same(current, identity) && !current.isSymbolicLink())
        unlinkSync(path);
    } catch (e) {
      if (!missing(e)) throw presetStorageFailure();
    }
  }
  private readLockOwner(
    path: string,
  ):
    | { owner: ReturnType<typeof createReviewOwner>; identity: Stats }
    | undefined {
    const file = readPresetFile(path, 2048, true);
    if (!file) return undefined;
    const owner = presetRecord(
      parsePresetJson(file.text, { bytes: 2048, depth: 2, tokens: 32 }),
      "lock",
      ["version", "host", "pid", "token"],
    );
    if (
      owner.version !== 1 ||
      typeof owner.host !== "string" ||
      !owner.host.trim() ||
      owner.host.length > 256 ||
      !Number.isSafeInteger(owner.pid) ||
      Number(owner.pid) < 1 ||
      Number(owner.pid) > 2147483647 ||
      typeof owner.token !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(owner.token)
    )
      throw new ApplicationError(
        "presets.storageBusy",
        "Preset lock version or owner cannot be verified.",
        409,
      );
    return {
      owner: owner as unknown as ReturnType<typeof createReviewOwner>,
      identity: file.identity,
    };
  }
  private lock(
    path = join(this.directory, "registry-v1.lock"),
    depth = 0,
  ): () => void {
    if (depth > 3)
      throw new ApplicationError(
        "presets.storageBusy",
        "Interrupted preset lock needs inspection.",
        409,
      );
    const owner = { version: 1, ...createReviewOwner() },
      temp = join(this.directory, `.owner-${randomUUID()}`);
    let identity: Stats | undefined;
    try {
      const fd = openSync(temp, "wx", 0o600);
      identity = fstatSync(fd);
      try {
        writeFileSync(fd, JSON.stringify(owner));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      identity = lstatSync(temp);
      try {
        linkSync(temp, path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST")
          throw presetStorageFailure();
        let observed: ReturnType<typeof createReviewOwner>;
        let observedIdentity: Stats;
        try {
          const file = this.readLockOwner(path);
          if (!file)
            throw new Error("Preset lock disappeared during recovery.", {
              cause: e,
            });
          observed = file.owner;
          observedIdentity = file.identity;
        } catch (cause) {
          const error = new ApplicationError(
            "presets.storageBusy",
            "Preset lock owner cannot be verified.",
            409,
          );
          Object.defineProperty(error, "cause", { value: cause });
          throw error;
        }
        if (reviewOwnerState(observed) !== "dead")
          throw new ApplicationError(
            "presets.storageBusy",
            "Another or unknown process owns preset storage. Retry after it finishes.",
            409,
          );
        const release = this.lock(`${path}.recover`, depth + 1);
        try {
          const current = this.readLockOwner(path);
          if (
            !current ||
            !same(current.identity, observedIdentity) ||
            current.owner.token !== observed.token
          )
            throw new ApplicationError(
              "presets.storageBusy",
              "Preset lock ownership changed.",
              409,
            );
          this.unlinkOwned(path, current.identity);
        } finally {
          release();
        }
        linkSync(temp, path);
      }
    } finally {
      if (identity) this.unlinkOwned(temp, identity);
    }
    const held = this.readLockOwner(path);
    if (!held || held.owner.token !== owner.token) throw presetStorageFailure();
    return () => {
      let current: ReturnType<LocalPresetStorage["readLockOwner"]>;
      try {
        current = this.readLockOwner(path);
      } catch {
        return;
      }
      if (
        current &&
        same(current.identity, held.identity) &&
        current.owner.token === owner.token
      )
        this.unlinkOwned(path, current.identity);
    };
  }

  withLock<T>(operation: () => T): T {
    this.ensure(true);
    const release = this.lock();
    try {
      this.ensure();
      return operation();
    } finally {
      release();
    }
  }
  private writeAtomic(
    path: string,
    text: string,
    assertCurrent: () => void,
    signal?: AbortSignal,
  ): void {
    const temp = join(this.directory, `.registry-${randomUUID()}`);
    let identity: Stats | undefined;
    try {
      const fd = openSync(temp, "wx", 0o600);
      try {
        identity = fstatSync(fd);
        writeFileSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.ensure();
      const target = readPresetFile(path, PRESET_LIMITS.registryBytes);
      void target;
      assertCurrent();
      checkPresetAbort(signal);
      const current = lstatSync(temp);
      if (
        !identity ||
        !same(current, identity) ||
        current.nlink !== 1 ||
        !current.isFile()
      )
        throw presetStorageFailure();
      renameSync(temp, path);
      identity = undefined;
    } catch (e) {
      if (e instanceof ApplicationError || signal?.aborted) throw e;
      throw presetStorageFailure("Local preset publication failed.");
    } finally {
      if (identity) this.unlinkOwned(temp, identity);
    }
  }
  publish(
    text: string,
    previous: PresetFile | undefined,
    signal?: AbortSignal,
    recovery = false,
  ): void {
    if (Buffer.byteLength(text) > PRESET_LIMITS.registryBytes)
      throw new ApplicationError(
        "request.tooLarge",
        "Local preset registry is full.",
        413,
      );
    const current = () => {
      this.ensure();
      const now = this.read();
      if (
        !now !== !previous ||
        (now &&
          previous &&
          (!same(now.identity, previous.identity) ||
            now.text !== previous.text))
      )
        throw new ApplicationError(
          "presets.stale",
          "Preset registry changed before publication.",
          409,
        );
    };
    current();
    checkPresetAbort(signal);
    if (previous && !recovery)
      this.writeAtomic(this.backupPath, previous.text, current, signal);
    this.writeAtomic(this.registryPath, text, current, signal);
  }
  preserveCorrupt(file: PresetFile): () => void {
    let identity: Stats | undefined;
    try {
      const fd = openSync(this.corruptPath, "wx", 0o600);
      try {
        identity = fstatSync(fd);
        writeFileSync(fd, file.text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch {
      throw new ApplicationError(
        "presets.recoveryUnavailable",
        "Archive the previous recovery copy before another recovery.",
        409,
      );
    }
    return () => {
      if (identity) this.unlinkOwned(this.corruptPath, identity);
    };
  }
}
