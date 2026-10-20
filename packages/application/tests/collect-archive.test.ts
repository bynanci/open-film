import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  lstat,
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { extractStoredZip, writeStoredZip } from "../src/collect-archive.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-collect-zip-"));
  roots.push(root);
  const source = join(root, "package");
  const destination = join(root, "extracted");
  await mkdir(source);
  await mkdir(destination);
  return { root, source, destination };
}

function replaceBytes(input: Buffer, before: string, after: string): Buffer {
  const result = Buffer.from(input);
  const oldValue = Buffer.from(before);
  const newValue = Buffer.from(after);
  expect(oldValue.length).toBe(newValue.length);
  let offset = 0;
  while ((offset = result.indexOf(oldValue, offset)) >= 0) {
    newValue.copy(result, offset);
    offset += newValue.length;
  }
  return result;
}

describe("Collect Media ZIP archive", () => {
  it.each([false, true])(
    "cancels a writer with a pending actual open before returning (empty root=%s)",
    async (empty) => {
      const { root, source } = await workspace();
      if (!empty)
        await writeFile(join(source, "source.txt"), "synthetic receipt");
      const archive = join(root, "cancelled-pending-open.zip");
      const controller = new AbortController();
      const originalOpen = fs.open;
      const originalCreate = fs.createWriteStream;
      let releaseOpen: (() => void) | undefined;
      let started!: () => void;
      const openStarted = new Promise<void>((resolveOpen) => {
        started = resolveOpen;
      });
      let writer: ReturnType<typeof fs.createWriteStream> | undefined;
      fs.open = Object.assign((...args: unknown[]): void => {
        if (String(args[0]) !== archive) {
          Reflect.apply(originalOpen, fs, args);
          return;
        }
        releaseOpen = () => {
          Reflect.apply(originalOpen, fs, args);
        };
        started();
      }, originalOpen);
      fs.createWriteStream = (...args) => {
        const stream = originalCreate(...args);
        if (String(args[0]) === archive) writer = stream;
        return stream;
      };
      syncBuiltinESMExports();
      let settled = false;
      const task = writeStoredZip(source, archive, controller.signal).then(
        () => {
          settled = true;
          return undefined;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
      try {
        await Promise.race([
          openStarted,
          task.then(() => {
            throw new Error("ZIP writer settled before requesting its open.");
          }),
        ]);
        controller.abort();
        await nextTurn();
        expect(settled).toBe(false);
        releaseOpen!();
        releaseOpen = undefined;
        expect(await task).toMatchObject({ name: "AbortError" });
        expect(writer?.closed).toBe(true);
        await expect(lstat(archive)).rejects.toMatchObject({ code: "ENOENT" });
        await nextTurn();
        await expect(lstat(archive)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        releaseOpen?.();
        await task;
        fs.open = originalOpen;
        fs.createWriteStream = originalCreate;
        syncBuiltinESMExports();
      }
    },
  );

  it("preserves an existing archive when exclusive creation fails", async () => {
    const { root, source } = await workspace();
    await writeFile(join(source, "source.txt"), "synthetic package receipt", {
      flag: "wx",
    });
    const archive = join(root, "existing.zip");
    await writeFile(archive, "synthetic existing archive", { flag: "wx" });

    await expect(writeStoredZip(source, archive)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(archive, "utf8")).toBe("synthetic existing archive");
  });

  it("round-trips an empty file with its empty-content hash and private mode", async () => {
    const { root, source, destination } = await workspace();
    await writeFile(join(source, "empty.txt"), "", { flag: "wx" });
    const archive = join(root, "empty.zip");
    await writeStoredZip(source, archive);

    const files = await extractStoredZip(archive, destination);
    const path = join(destination, "empty.txt");
    expect(files).toEqual([{ path, size: 0 }]);
    const bytes = await readFile(path);
    expect(bytes).toHaveLength(0);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
  });

  it("round-trips a mixed inventory of empty, populated and nested UTF-8 files", async () => {
    const { root, source, destination } = await workspace();
    const entries = [
      ["a-empty.txt", Buffer.alloc(0)],
      ["b-data.bin", Buffer.from([0, 1, 2, 255])],
      ["c-empty.txt", Buffer.alloc(0)],
      ["素材/空.txt", Buffer.alloc(0)],
      ["素材/記録.txt", Buffer.from("synthetic package receipt")],
    ] as const;
    await mkdir(join(source, "素材"));
    for (const [name, bytes] of entries)
      await writeFile(join(source, name), bytes, { flag: "wx" });
    const archive = join(root, "mixed.zip");
    await writeStoredZip(source, archive);

    const files = await extractStoredZip(archive, destination);
    expect(files).toHaveLength(entries.length);
    for (const [name, bytes] of entries) {
      const path = join(destination, name);
      expect(files).toContainEqual({ path, size: bytes.length });
      expect(await readFile(path)).toEqual(bytes);
      expect((await lstat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it.each(["declared-size", "local-extra-length"] as const)(
    "rejects an empty entry with tampered %s bounds before extracting files",
    async (where) => {
      const { root, source, destination } = await workspace();
      await writeFile(join(source, "empty.txt"), "", { flag: "wx" });
      const archive = join(root, "bounds.zip");
      await writeStoredZip(source, archive);
      const changed = await readFile(archive);
      const central = changed.readUInt32LE(changed.length - 22 + 16);
      const dataOffset = 30 + changed.readUInt16LE(26);
      const overrun = central - dataOffset + 1;
      if (where === "declared-size") {
        changed.writeUInt32LE(overrun, central + 20);
        changed.writeUInt32LE(overrun, central + 24);
      } else changed.writeUInt16LE(overrun, 28);
      await writeFile(archive, changed);

      await expect(extractStoredZip(archive, destination)).rejects.toThrow(
        /exceeds its data section/u,
      );
      expect(await readdir(destination)).toEqual([]);
    },
  );

  it("checks an empty entry's CRC even when its descriptor agrees with the directory", async () => {
    const { root, source, destination } = await workspace();
    await writeFile(join(source, "empty.txt"), "", { flag: "wx" });
    const archive = join(root, "empty-crc.zip");
    await writeStoredZip(source, archive);
    const changed = await readFile(archive);
    const central = changed.readUInt32LE(changed.length - 22 + 16);
    const dataOffset = 30 + changed.readUInt16LE(26);
    changed.writeUInt32LE(1, central + 16);
    changed.writeUInt32LE(1, dataOffset + 4);
    await writeFile(archive, changed);

    await expect(extractStoredZip(archive, destination)).rejects.toThrow(
      /checksum/u,
    );
    expect(await readdir(destination)).toEqual([]);
  });

  it("creates empty targets exclusively and removes earlier entries after a collision", async () => {
    const { root, source, destination } = await workspace();
    await writeFile(join(source, "a-empty.txt"), "", { flag: "wx" });
    await writeFile(join(source, "b-empty.txt"), "", { flag: "wx" });
    const archive = join(root, "collision.zip");
    await writeStoredZip(source, archive);
    const existing = join(destination, "b-empty.txt");
    await writeFile(existing, "synthetic existing target", { flag: "wx" });

    await expect(extractStoredZip(archive, destination)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(existing, "utf8")).toBe("synthetic existing target");
    expect(await readdir(destination)).toEqual(["b-empty.txt"]);
  });

  it("cancels empty-entry extraction before creating a target", async () => {
    const { root, source, destination } = await workspace();
    await writeFile(join(source, "empty.txt"), "", { flag: "wx" });
    const archive = join(root, "cancelled-empty.zip");
    await writeStoredZip(source, archive);
    const controller = new AbortController();
    controller.abort();

    await expect(
      extractStoredZip(archive, destination, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(destination)).toEqual([]);
  });

  it.each(["prefix", "between-records", "before-directory"] as const)(
    "rejects unreceipted ZIP bytes in a %s",
    async (where) => {
      const { root, source, destination } = await workspace();
      await writeFile(join(source, "one.txt"), "synthetic one");
      await writeFile(join(source, "two.txt"), "synthetic two");
      const archive = join(root, "gap.zip");
      await writeStoredZip(source, archive);
      const original = await readFile(archive);
      const end = original.length - 22;
      const central = original.readUInt32LE(end + 16);
      const secondEntry = central + 46 + original.readUInt16LE(central + 28);
      const position =
        where === "prefix"
          ? 0
          : where === "before-directory"
            ? central
            : original.readUInt32LE(secondEntry + 42);
      const padding = Buffer.from("synthetic-unreceipted-payload");
      const changed = Buffer.concat([
        original.subarray(0, position),
        padding,
        original.subarray(position),
      ]);
      changed.writeUInt32LE(
        central + padding.length,
        end + padding.length + 16,
      );
      let entry = central + padding.length;
      for (let index = 0; index < original.readUInt16LE(end + 10); index++) {
        const offset = changed.readUInt32LE(entry + 42);
        if (offset >= position)
          changed.writeUInt32LE(offset + padding.length, entry + 42);
        entry +=
          46 +
          changed.readUInt16LE(entry + 28) +
          changed.readUInt16LE(entry + 30) +
          changed.readUInt16LE(entry + 32);
      }
      await writeFile(archive, changed);
      await expect(extractStoredZip(archive, destination)).rejects.toThrow(
        /unaccounted bytes/u,
      );
    },
  );

  it("round-trips UTF-8 CJK paths and file contents", async () => {
    const { source, destination } = await workspace();
    const nested = join(source, "素材", "家族の記録");
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(nested, "圖像-日本語.txt"),
      "synthetic package receipt",
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    const archive = join(source, "..", "package.zip");
    await writeStoredZip(source, archive);
    const files = await extractStoredZip(archive, destination);
    expect(files).toHaveLength(1);
    expect(
      await readFile(
        join(destination, "素材", "家族の記録", "圖像-日本語.txt"),
        "utf8",
      ),
    ).toBe("synthetic package receipt");
  });

  it("rejects Zip Slip names before writing an escaped file", async () => {
    const { root, source, destination } = await workspace();
    await writeFile(join(source, "safe.txt"), "local", {
      flag: "wx",
      mode: 0o600,
    });
    const archive = join(root, "unsafe.zip");
    await writeStoredZip(source, archive);
    await writeFile(
      archive,
      replaceBytes(await readFile(archive), "safe.txt", "../evilx"),
    );
    await expect(extractStoredZip(archive, destination)).rejects.toThrow(
      /unsafe path/u,
    );
    await expect(lstat(join(root, "evilx"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const driveArchive = join(root, "drive.zip");
    await writeStoredZip(source, driveArchive);
    await writeFile(
      driveArchive,
      replaceBytes(await readFile(driveArchive), "safe.txt", "C:/evilx"),
    );
    await expect(extractStoredZip(driveArchive, destination)).rejects.toThrow(
      /unsafe path/u,
    );

    const uncArchive = join(root, "unc.zip");
    await writeStoredZip(source, uncArchive);
    await writeFile(
      uncArchive,
      replaceBytes(await readFile(uncArchive), "safe.txt", "\\\\abcdef"),
    );
    await expect(extractStoredZip(uncArchive, destination)).rejects.toThrow(
      /unsafe path/u,
    );
  });

  it("rejects duplicate archive paths and payloads with a bad CRC", async () => {
    const { root, source, destination } = await workspace();
    const duplicateSource = join(root, "duplicate-source");
    await mkdir(duplicateSource);
    await writeFile(join(duplicateSource, "one.txt"), "first", {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(join(duplicateSource, "two.txt"), "other", {
      flag: "wx",
      mode: 0o600,
    });
    const duplicate = join(root, "duplicate.zip");
    await writeStoredZip(duplicateSource, duplicate);
    await writeFile(
      duplicate,
      replaceBytes(await readFile(duplicate), "two.txt", "one.txt"),
    );
    await expect(extractStoredZip(duplicate, destination)).rejects.toThrow(
      /duplicate paths/u,
    );

    await writeFile(join(source, "safe.txt"), "local", {
      flag: "wx",
      mode: 0o600,
    });
    const checksum = join(root, "checksum.zip");
    await writeStoredZip(source, checksum);
    const corrupted = await readFile(checksum);
    corrupted[30 + Buffer.byteLength("safe.txt")]! ^= 0x01;
    await writeFile(checksum, corrupted);
    await expect(extractStoredZip(checksum, destination)).rejects.toThrow(
      /checksum/u,
    );
    await expect(lstat(join(destination, "safe.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects case-colliding names and malformed local headers", async () => {
    const { root, destination } = await workspace();
    const source = join(root, "case-source");
    await mkdir(source);
    await writeFile(join(source, "safe.txt"), "first", {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(join(source, "SAFE.txt"), "other", {
      flag: "wx",
      mode: 0o600,
    });
    const duplicate = join(root, "case-collision.zip");
    await writeStoredZip(source, duplicate);
    await expect(extractStoredZip(duplicate, destination)).rejects.toThrow(
      /duplicate paths/u,
    );

    const malformed = join(root, "malformed.zip");
    await writeFile(join(source, "safe.txt"), "local", {
      flag: "w",
      mode: 0o600,
    });
    await writeStoredZip(source, malformed);
    const invalidHeader = await readFile(malformed);
    invalidHeader.writeUInt32LE(0, 0);
    await writeFile(malformed, invalidHeader);
    await expect(extractStoredZip(malformed, destination)).rejects.toThrow(
      /local header/u,
    );
  });

  it("rejects symlinks, nested archives, and cancellation without a package", async () => {
    const { root, source } = await workspace();
    const outside = join(root, "outside.txt");
    await writeFile(outside, "outside", { flag: "wx", mode: 0o600 });
    await symlink(outside, join(source, "linked.txt"));
    await expect(
      writeStoredZip(source, join(root, "symlink.zip")),
    ).rejects.toThrow(/symbolic link/u);
    await rm(join(source, "linked.txt"));

    await link(outside, join(source, "hard-linked.txt"));
    await expect(
      writeStoredZip(source, join(root, "hardlink.zip")),
    ).rejects.toThrow(/regular files only/u);
    await rm(join(source, "hard-linked.txt"));

    await writeFile(join(source, "nested.zip"), "nested", {
      flag: "wx",
      mode: 0o600,
    });
    await expect(
      writeStoredZip(source, join(root, "nested-output.zip")),
    ).rejects.toThrow(/Nested archives/u);
    await rm(join(source, "nested.zip"));

    await writeFile(
      join(source, "mislabelled-media.bin"),
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
      { flag: "wx", mode: 0o600 },
    );
    await expect(
      writeStoredZip(source, join(root, "mislabelled-output.zip")),
    ).rejects.toThrow(/Nested archives/u);
    await rm(join(source, "mislabelled-media.bin"));

    await writeFile(join(source, "source.txt"), "cancel", {
      flag: "wx",
      mode: 0o600,
    });
    const controller = new AbortController();
    controller.abort();
    const cancelled = join(root, "cancelled.zip");
    await expect(
      writeStoredZip(source, cancelled, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(lstat(cancelled)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
