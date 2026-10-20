import {
  lstat,
  link,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
