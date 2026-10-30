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
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { ApplicationError, PRESET_LIMITS } from "@openfilm/core";
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
  readonly directory: string;
  readonly registryPath: string;
  readonly backupPath: string;
  readonly corruptPath: string;
  private rootIdentity?: Stats;
  private directoryIdentity?: Stats;
  constructor(private readonly root: string) {
    if (!isAbsolute(root) || root.includes("\0")) throw presetStorageFailure();
    this.directory = join(root, "presets");
    this.registryPath = join(this.directory, "registry-v1.json");
    this.backupPath = join(this.directory, "registry-v1.json.bak");
    this.corruptPath = join(this.directory, "registry-v1.corrupt");
  }
  ensure(create = false): boolean {
    const chain: string[] = [];
    for (let p = resolve(this.root); ; p = dirname(p)) {
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
    const root = lstatSync(this.root);
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
        try {
          const file = readPresetFile(path, 2048, true);
          if (!file) throw new Error();
          observed = JSON.parse(file.text);
        } catch {
          throw new ApplicationError(
            "presets.storageBusy",
            "Preset lock owner cannot be verified.",
            409,
          );
        }
        if (reviewOwnerState(observed) !== "dead")
          throw new ApplicationError(
            "presets.storageBusy",
            "Another or unknown process owns preset storage. Retry after it finishes.",
            409,
          );
        const release = this.lock(`${path}.recover`, depth + 1);
        try {
          const current = readPresetFile(path, 2048, true);
          if (!current || JSON.parse(current.text).token !== observed.token)
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
    const held = readPresetFile(path, 2048, true);
    if (!held || JSON.parse(held.text).token !== owner.token)
      throw presetStorageFailure();
    return () => {
      const current = readPresetFile(path, 2048, true);
      if (
        current &&
        same(current.identity, held.identity) &&
        JSON.parse(current.text).token === owner.token
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
