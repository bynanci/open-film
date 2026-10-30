// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readPinnedTestFonts } from "../helpers/render-qa-fonts.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-qa-fonts-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("requires an explicit absolute font fixture root", async () => {
  vi.stubEnv("OPENFILM_TEST_FONT_ROOT", undefined);
  await expect(readPinnedTestFonts()).rejects.toThrow(
    /OPENFILM_TEST_FONT_ROOT/u,
  );
  await expect(readPinnedTestFonts("relative/fonts")).rejects.toThrow(
    /absolute/u,
  );
});
it("rejects an absent root without searching system fonts", async () => {
  await expect(
    readPinnedTestFonts(join(await fixture(), "missing")),
  ).rejects.toThrow(/font fixture/u);
});
it("rejects a root symlink rather than following its alias", async () => {
  const root = await fixture();
  await mkdir(join(root, "actual"));
  await symlink(join(root, "actual"), join(root, "alias"), "junction");
  await expect(readPinnedTestFonts(join(root, "alias"))).rejects.toThrow(
    /alias|symlink/u,
  );
});
it("rejects incomplete inventory and extra files", async () => {
  const root = await fixture();
  await expect(readPinnedTestFonts(root)).rejects.toThrow(/inventory/u);
  await writeFile(join(root, "unexpected.otf"), "untrusted font");
  await expect(readPinnedTestFonts(root)).rejects.toThrow(/inventory/u);
});
it("rejects substituted bytes even with all trusted filenames", async () => {
  const root = await fixture();
  for (const file of [
    "NotoSansCJKtc-Regular.otf",
    "NotoSansCJKtc-Bold.otf",
    "NotoSerifCJKtc-Regular.otf",
    "NotoSerifCJKtc-Bold.otf",
    "Noto-SIL-OFL.txt",
  ])
    await writeFile(join(root, file), "substituted bytes");
  await expect(readPinnedTestFonts(root)).rejects.toThrow(/hash/u);
});
