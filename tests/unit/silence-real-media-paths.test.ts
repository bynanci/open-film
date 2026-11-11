// SPDX-License-Identifier: Apache-2.0
import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join, win32 } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createExternalEvidenceDirectory,
  isOutsideCheckout,
  resolveRecordedMediaPaths,
} from "../fixtures/silence-real-media-paths.js";

it.each(["..recorded-media", "..evidence", "ordinary", "nested/..evidence"])(
  "rejects actual inside child name %s",
  (name) => {
    expect(
      isOutsideCheckout(
        "/work/repo",
        path.posix.resolve("/work/repo", name),
        path.posix,
      ),
    ).toBe(false);
  },
);
it("accepts ordinary external siblings without mistaking similar checkout prefixes for containment", () => {
  expect(isOutsideCheckout("/work/repo", "/work/media", path.posix)).toBe(true);
  expect(
    isOutsideCheckout("/work/repo", "/work/repo-evidence", path.posix),
  ).toBe(true);
  expect(isOutsideCheckout("/work/repo", "/work", path.posix)).toBe(true);
  expect(isOutsideCheckout("/work/repo", "/work/repo", path.posix)).toBe(false);
});
it.each([
  ["C:\\repo", "D:\\media", true],
  ["C:\\repo", "C:\\media", true],
  ["C:\\repo", "C:\\repo\\..evidence", false],
  ["C:\\repo", "C:\\repo\\nested", false],
  ["C:\\repo", "C:\\repo", false],
])(
  "handles Windows lexical checkout %s and candidate %s as external=%s",
  (checkout, candidate, expected) => {
    expect(isOutsideCheckout(checkout, candidate, win32)).toBe(expected);
  },
);

let root: string, checkout: string, media: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-real-media-paths-"));
  checkout = join(root, "checkout");
  media = join(root, "media");
  await mkdir(checkout);
  await mkdir(media);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const directoryLink = (target: string, link: string) =>
  symlink(target, link, process.platform === "win32" ? "junction" : "dir");

it("canonicalizes checkout/source aliases and creates an ordinary external fresh sibling", async () => {
  const checkoutAlias = join(root, "checkout-alias"),
    mediaAlias = join(root, "media-alias");
  await directoryLink(checkout, checkoutAlias);
  await directoryLink(media, mediaAlias);
  const paths = await resolveRecordedMediaPaths(
    checkoutAlias,
    mediaAlias,
    join(root, "evidence"),
  );
  expect(paths).toEqual({
    checkoutRoot: await realpath(checkout),
    mediaRoot: await realpath(media),
    outputRoot: join(await realpath(root), "evidence"),
  });
  expect(
    await createExternalEvidenceDirectory(paths.checkoutRoot, paths.outputRoot),
  ).toBe(await realpath(join(root, "evidence")));
});
it("rejects an inside source whose ordinary name begins with two dots", async () => {
  const inside = join(checkout, "..recorded-media");
  await mkdir(inside);
  await expect(
    resolveRecordedMediaPaths(checkout, inside, join(root, "evidence")),
  ).rejects.toThrow("outside the checkout");
});
it("rejects an inside output whose ordinary name begins with two dots", async () => {
  await expect(
    resolveRecordedMediaPaths(checkout, media, join(checkout, "..evidence")),
  ).rejects.toThrow("outside the checkout");
});
it("rejects an apparently external source symlink pointing into the actual checkout", async () => {
  const inside = join(checkout, "source"),
    alias = join(root, "media-link");
  await mkdir(inside);
  await directoryLink(inside, alias);
  await expect(
    resolveRecordedMediaPaths(checkout, alias, join(root, "evidence")),
  ).rejects.toThrow("outside the checkout");
});
it("rejects an apparently external output parent symlink pointing into the checkout", async () => {
  const alias = join(root, "output-link");
  await directoryLink(checkout, alias);
  await expect(
    resolveRecordedMediaPaths(checkout, media, join(alias, "evidence")),
  ).rejects.toThrow("outside the checkout");
});
it("checks the actual checkout when the caller supplied a checkout symlink", async () => {
  const alias = join(root, "checkout-link"),
    inside = join(checkout, "source");
  await mkdir(inside);
  await directoryLink(checkout, alias);
  await expect(
    resolveRecordedMediaPaths(alias, inside, join(root, "evidence")),
  ).rejects.toThrow("outside the checkout");
});
it("requires an existing source directory", async () => {
  await expect(
    resolveRecordedMediaPaths(
      checkout,
      join(root, "missing-media"),
      join(root, "evidence"),
    ),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
it("retains the fresh-output guard when a directory already exists", async () => {
  const output = join(root, "evidence");
  await mkdir(output);
  const paths = await resolveRecordedMediaPaths(checkout, media, output);
  await expect(
    createExternalEvidenceDirectory(paths.checkoutRoot, paths.outputRoot),
  ).rejects.toMatchObject({ code: "EEXIST" });
});
it("rechecks the created output after its checked parent is redirected into the checkout", async () => {
  const parent = join(root, "output-parent");
  await mkdir(parent);
  const paths = await resolveRecordedMediaPaths(
    checkout,
    media,
    join(parent, "evidence"),
  );
  await rename(parent, join(root, "moved-parent"));
  await directoryLink(checkout, parent);
  await expect(
    createExternalEvidenceDirectory(paths.checkoutRoot, paths.outputRoot),
  ).rejects.toThrow("outside the checkout");
});
