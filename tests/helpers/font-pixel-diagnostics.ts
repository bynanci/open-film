// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { isAbsolute, join, posix, win32 } from "node:path";

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** The canonical root comes from realpath of the owned synthetic fixture. */
export function syntheticFontPixelScope(
  root: string,
  canonicalRoot: string,
  platform: "posix" | "win32" = process.platform === "win32"
    ? "win32"
    : "posix",
) {
  const paths = platform === "win32" ? win32 : posix;
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const roots = [...new Set([root, canonicalRoot])].map((value) =>
    platform === "win32"
      ? value.split(/[\\/]/u).map(escape).join("[\\\\/]")
      : escape(value),
  );
  const redaction = new RegExp(
    `(?:${roots.join("|")})(?=$|${platform === "win32" ? "[\\\\/]" : "/"})`,
    platform === "win32" ? "giu" : "gu",
  );
  return {
    output(output: string) {
      const local = paths.relative(canonicalRoot, output);
      if (
        !paths.isAbsolute(canonicalRoot) ||
        !paths.isAbsolute(output) ||
        !local ||
        paths.isAbsolute(local) ||
        local.startsWith("..")
      )
        throw new Error("Font pixel collector refused an external output.");
      return output;
    },
    redact(argument: string) {
      return argument.replaceAll(redaction, "<synthetic-fixture>");
    },
  };
}

/** Diagnostics only: assertions continue to compare the complete RGB buffers. */
export function rgbPixelDifference(
  expected: Buffer,
  actual: Buffer,
  width: number,
) {
  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    expected.length !== actual.length ||
    expected.length % (width * 3) !== 0
  )
    throw new Error(
      "Font pixel diagnostics require equal complete RGB frames.",
    );
  let differentChannels = 0;
  let maximumAbsoluteDelta = 0;
  let totalAbsoluteDelta = 0;
  const pixels = new Set<number>();
  const firstDifferences: Array<{
    offset: number;
    x: number;
    y: number;
    channel: number;
    expected: number;
    actual: number;
  }> = [];
  let left = width,
    top = expected.length / width / 3,
    right = -1,
    bottom = -1;
  for (let offset = 0; offset < expected.length; offset++) {
    const delta = Math.abs(expected[offset]! - actual[offset]!);
    if (!delta) continue;
    differentChannels++;
    maximumAbsoluteDelta = Math.max(maximumAbsoluteDelta, delta);
    totalAbsoluteDelta += delta;
    const pixel = Math.floor(offset / 3);
    pixels.add(pixel);
    const x = pixel % width,
      y = Math.floor(pixel / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
    if (firstDifferences.length < 64)
      firstDifferences.push({
        offset,
        x,
        y,
        channel: offset % 3,
        expected: expected[offset]!,
        actual: actual[offset]!,
      });
  }
  return {
    expectedBytes: expected.length,
    actualBytes: actual.length,
    expectedSha256: sha256(expected),
    actualSha256: sha256(actual),
    differentChannels,
    differentPixels: pixels.size,
    maximumAbsoluteDelta,
    totalAbsoluteDelta,
    bounds: pixels.size ? { left, top, right, bottom } : null,
    firstDifferences,
  };
}

/** Called only by the three-font synthetic fixture after an assertion fails. */
export async function retainSyntheticFontPixelFailure(
  root: string,
  input: { evidence: Record<string, unknown>; files: Record<string, Buffer> },
) {
  if (!isAbsolute(root))
    throw new Error("Font pixel QA needs an absolute directory.");
  for (const name of Object.keys(input.files))
    if (!/^[a-z0-9][a-z0-9.-]*$/u.test(name) || name === "evidence.json")
      throw new Error("Font pixel QA artifact name is invalid.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const details = await lstat(root);
  if (details.isSymbolicLink() || !details.isDirectory())
    throw new Error("Font pixel QA needs an owned directory.");
  const directory = await mkdtemp(join(root, "synthetic-font-pixels-"));
  await Promise.all(
    Object.entries(input.files).map(([name, bytes]) =>
      writeFile(join(directory, name), bytes, { mode: 0o600, flag: "wx" }),
    ),
  );
  await writeFile(
    join(directory, "evidence.json"),
    JSON.stringify(input.evidence, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return directory;
}
