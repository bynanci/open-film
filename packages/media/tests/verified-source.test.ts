import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { withVerifiedSourceFile } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-verified-source-"));
  roots.push(root);
  const source = join(root, "source.mp4");
  const bytes = Buffer.from("synthetic source bytes");
  await writeFile(source, bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { root, source, bytes, hash };
}

it("streams a hash-verified private snapshot and removes it after the callback", async () => {
  const f = await fixture();
  let snapshot = "";
  const result = await withVerifiedSourceFile(
    f.source,
    f.hash,
    async (path) => {
      snapshot = path;
      expect(await readFile(path)).toEqual(f.bytes);
      await writeFile(f.source, "changed original");
      expect(await readFile(path)).toEqual(f.bytes);
      return "consumed verified bytes";
    },
    { temporaryRoot: f.root },
  );
  expect(result).toBe("consumed verified bytes");
  await expect(readFile(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(f.root)).toEqual(["source.mp4"]);
});

it("does not disclose mismatched bytes or exceed the declared source bound", async () => {
  const f = await fixture();
  const consume = vi.fn();
  await expect(
    withVerifiedSourceFile(f.source, "0".repeat(64), consume, {
      temporaryRoot: f.root,
    }),
  ).rejects.toMatchObject({ code: "source.changed" });
  await expect(
    withVerifiedSourceFile(f.source, f.hash, consume, {
      temporaryRoot: f.root,
      maximumBytes: f.bytes.length - 1,
    }),
  ).rejects.toThrow();
  expect(consume).not.toHaveBeenCalled();
  expect(await readdir(f.root)).toEqual(["source.mp4"]);
});

it("rejects symlinks and cancellation before exposing a snapshot", async () => {
  const f = await fixture();
  const link = join(f.root, "link.mp4");
  await symlink(f.source, link);
  const consume = vi.fn();
  await expect(withVerifiedSourceFile(link, f.hash, consume)).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(
    withVerifiedSourceFile(f.source, f.hash, consume, {
      signal: controller.signal,
      temporaryRoot: f.root,
    }),
  ).rejects.toThrow();
  expect(consume).not.toHaveBeenCalled();
});
