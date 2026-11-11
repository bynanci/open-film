// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareDefaultBuildShell } from "../../scripts/native/receipt.js";
import {
  MAX_ARTIFACT_BYTES,
  pinFile,
} from "../../scripts/native/receipt-contract.js";
// Keep real filesystem operations; make only explicit race/failure hooks spyable.
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
}));
vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof import("node:crypto")>()),
}));
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});
async function fixture(platform: "linux" | "win32" = "linux") {
  const root = await fs.mkdtemp(join(tmpdir(), "cargo-shell-stage-"));
  roots.push(root);
  const directory = "apps/desktop/src-tauri/target/release";
  const path = `${directory}/openfilm-desktop${platform === "win32" ? ".exe" : ""}`;
  await fs.mkdir(join(root, directory, "deps"), { recursive: true });
  const source = join(root, path),
    alias = join(root, directory, "deps/build-output");
  const bytes = Buffer.from("synthetic Cargo build output\n".repeat(10000));
  await fs.writeFile(source, bytes, { mode: 0o755 });
  await fs.link(source, alias);
  return { root, directory, path, source, alias, bytes, platform };
}
it.each(["linux", "win32"] as const)(
  "detaches %s default output without changing compiler bytes or alias",
  async (platform) => {
    const f = await fixture(platform);
    const original = await fs.lstat(f.source);
    await expect(pinFile(f.root, f.path)).rejects.toThrow("unlinked regular");
    expect(await prepareDefaultBuildShell(f.root, platform)).toBe(f.path);
    const staged = await fs.lstat(f.source),
      alias = await fs.lstat(f.alias);
    expect(staged.nlink).toBe(1);
    expect(alias.nlink).toBe(1);
    expect(staged.ino).not.toBe(original.ino);
    expect(alias.ino).toBe(original.ino);
    expect(staged.mode).toBe(original.mode);
    expect(await fs.readFile(f.source)).toEqual(f.bytes);
    expect(await fs.readFile(f.alias)).toEqual(f.bytes);
    const pinned = await pinFile(f.root, f.path);
    expect(pinned.sha256).toBe(
      crypto.createHash("sha256").update(f.bytes).digest("hex"),
    );
    await prepareDefaultBuildShell(f.root, platform);
    expect((await fs.lstat(f.source)).ino).toBe(staged.ino);
  },
);
it.each([
  "symlink",
  "parent-symlink",
  "outside-symlink",
  "directory",
  "special-mode",
  "oversized",
  "unknown-platform",
])("refuses %s before copying", async (fault) => {
  const f = await fixture();
  if (fault === "symlink") {
    await fs.unlink(f.source);
    await fs.symlink(f.alias, f.source);
  }
  if (fault === "outside-symlink") {
    const outside = await fs.mkdtemp(join(tmpdir(), "shell-outside-"));
    roots.push(outside);
    await fs.writeFile(join(outside, "unrelated"), "outside bytes");
    await fs.unlink(f.source);
    await fs.symlink(join(outside, "unrelated"), f.source);
  }
  if (fault === "parent-symlink") {
    const physical = join(f.root, "physical-release");
    await fs.rename(join(f.root, f.directory), physical);
    await fs.symlink(physical, join(f.root, f.directory));
  }
  if (fault === "directory") {
    await fs.unlink(f.source);
    await fs.mkdir(f.source);
  }
  if (fault === "special-mode") await fs.chmod(f.source, 0o1755);
  if (fault === "oversized")
    await fs.truncate(f.source, MAX_ARTIFACT_BYTES + 1);
  await expect(
    prepareDefaultBuildShell(
      f.root,
      fault === "unknown-platform" ? ("../../outside" as "linux") : "linux",
    ),
  ).rejects.toThrow();
  expect(
    (await fs.readdir(join(f.root, f.directory))).filter((p) =>
      p.includes("receipt-stage"),
    ),
  ).toEqual([]);
});
it("does not overwrite or clean up an existing exclusive staging destination", async () => {
  const f = await fixture();
  const id = "00000000-0000-0000-0000-000000000000";
  vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
  const collision = f.source + ".receipt-stage-" + id;
  await fs.writeFile(collision, "unrelated existing output");
  await expect(prepareDefaultBuildShell(f.root, "linux")).rejects.toThrow(
    /EEXIST/u,
  );
  expect(await fs.readFile(collision, "utf8")).toBe(
    "unrelated existing output",
  );
  expect((await fs.lstat(f.source)).nlink).toBe(2);
  expect(await fs.readFile(f.alias)).toEqual(f.bytes);
});
it("fails closed and cleans only its temp when atomic replacement is unavailable", async () => {
  const f = await fixture();
  vi.spyOn(fs, "rename").mockRejectedValue(
    Object.assign(new Error("Windows sharing violation"), { code: "EPERM" }),
  );
  await expect(prepareDefaultBuildShell(f.root, "linux")).rejects.toThrow(
    "sharing violation",
  );
  expect((await fs.lstat(f.source)).nlink).toBe(2);
  expect(await fs.readFile(f.source)).toEqual(f.bytes);
  expect(await fs.readFile(f.alias)).toEqual(f.bytes);
  expect(
    (await fs.readdir(join(f.root, f.directory))).filter((p) =>
      p.includes("receipt-stage"),
    ),
  ).toEqual([]);
});
it("detects mutation through the compiler alias during copying and removes its private temp", async () => {
  const f = await fixture();
  const actualOpen = fs.open;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await actualOpen(...args);
    if (args[1] === "wx") {
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        await sync();
        await fs.writeFile(f.alias, "changed concurrent compiler output");
      });
    }
    return handle;
  });
  await expect(prepareDefaultBuildShell(f.root, "linux")).rejects.toThrow(
    "changed during staging",
  );
  expect((await fs.lstat(f.source)).nlink).toBe(2);
  expect(
    (await fs.readdir(join(f.root, f.directory))).filter((p) =>
      p.includes("receipt-stage"),
    ),
  ).toEqual([]);
});
it("detects a source race at promotion without reporting a pinned candidate", async () => {
  const f = await fixture();
  const actualRename = fs.rename;
  vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
    await fs.writeFile(f.alias, "changed during promotion");
    await actualRename(...args);
  });
  await expect(prepareDefaultBuildShell(f.root, "linux")).rejects.toThrow(
    "source changed during promotion",
  );
  expect(await fs.readFile(f.source)).toEqual(f.bytes);
});
