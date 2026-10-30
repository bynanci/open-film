// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import toolchain from "../../fixtures/render-qa/toolchain.json";

export type PinnedTestFontKey =
  "sansRegular" | "sansBold" | "serifRegular" | "serifBold";
export type PinnedTestFont = Readonly<{
  path: string;
  sha256: string;
  family: string;
  weight: 400 | 700;
}>;

/** Explicit test fixture admission; never resolves or falls back to OS fonts. */
export async function readPinnedTestFonts(
  root = process.env.OPENFILM_TEST_FONT_ROOT,
): Promise<Readonly<Record<PinnedTestFontKey, PinnedTestFont>>> {
  if (!root) throw new Error("OPENFILM_TEST_FONT_ROOT is required");
  if (!isAbsolute(root))
    throw new Error("The font fixture root must be absolute");
  const directory = await lstat(root).catch(() => {
    throw new Error("The font fixture root is unavailable");
  });
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (await realpath(root)) !== resolve(root)
  )
    throw new Error("The font fixture root is a symlink or unexpected alias");
  const entries = [
    toolchain.fonts.license,
    ...Object.values(toolchain.fonts.faces),
  ];
  const expected = entries.map(({ filename }) => filename).sort();
  if (JSON.stringify((await readdir(root)).sort()) !== JSON.stringify(expected))
    throw new Error("The font fixture inventory is incomplete or unexpected");
  for (const entry of entries) {
    const path = join(root, entry.filename);
    const before = await lstat(path);
    const limit = entry.filename.endsWith(".otf") ? 32 * 1024 ** 2 : 64 * 1024;
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size < 1 ||
      before.size > limit
    )
      throw new Error("The font fixture must contain bounded regular files");
    const bytes = await readFile(path);
    const after = await lstat(path);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.size !== before.size ||
      bytes.length !== before.size ||
      createHash("sha256").update(bytes).digest("hex") !== entry.sha256
    )
      throw new Error(
        "The font fixture hash changed or does not match its pin",
      );
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(toolchain.fonts.faces).map(([key, face]) => [
        key,
        Object.freeze({
          path: join(root, face.filename),
          sha256: face.sha256,
          family: face.family,
          weight: face.weight as 400 | 700,
        }),
      ]),
    ),
  ) as Readonly<Record<PinnedTestFontKey, PinnedTestFont>>;
}
