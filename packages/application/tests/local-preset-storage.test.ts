// SPDX-License-Identifier: Apache-2.0
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync,
  symlinkSync,
  linkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  LocalPresetRegistry,
  createReviewOwner,
  readLocalPresetDocument,
} from "../src/index.js";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "openfilm-preset-storage-"));
  roots.push(root);
  return { root, store: new LocalPresetRegistry(root) };
}
const input = (store: LocalPresetRegistry, p = presetPackage()) => {
  const document = JSON.stringify(p),
    r = store.reviewImport(document);
  return {
    document,
    packageSha256: r.packageSha256,
    baseRegistryRevision: r.registryRevision,
    reviewSha256: r.reviewSha256,
    acknowledgeLicense: true as const,
  };
};
it("reads a regular Unicode source without mutation and rejects links/traversal", async () => {
  const { root } = fixture(),
    file = join(root, "記憶😀.json"),
    document = JSON.stringify(presetPackage());
  writeFileSync(file, document);
  expect(await readLocalPresetDocument(file)).toBe(document);
  const alias = join(root, "alias.json");
  symlinkSync(file, alias);
  await expect(readLocalPresetDocument(alias)).rejects.toThrow();
  const hard = join(root, "hard.json");
  linkSync(file, hard);
  await expect(readLocalPresetDocument(hard)).rejects.toThrow();
  await expect(
    readLocalPresetDocument(
      join(root, "child", "..", "記憶😀.json").replace(root, root + "/.."),
    ),
  ).rejects.toThrow();
  expect(readFileSync(file, "utf8")).toBe(document);
});
it("preserves alive and unverifiable owners and recovers only a proven dead same-host owner", async () => {
  const { root, store } = fixture(),
    request = input(store);
  mkdirSync(join(root, "presets"));
  const lock = join(root, "presets", "registry-v1.lock"),
    owner = { version: 1, ...createReviewOwner() };
  writeFileSync(lock, JSON.stringify(owner));
  await expect(store.install(request)).rejects.toMatchObject({
    code: "presets.storageBusy",
  });
  expect(JSON.parse(readFileSync(lock, "utf8")).token).toBe(owner.token);
  writeFileSync(lock, JSON.stringify({ ...owner, host: "unknown-host" }));
  await expect(store.install(request)).rejects.toMatchObject({
    code: "presets.storageBusy",
  });
  writeFileSync(lock, JSON.stringify({ ...owner, pid: 2147483646 }));
  expect((await store.install(request)).packages).toHaveLength(1);
  expect(existsSync(lock)).toBe(false);
});
it("leaves an unknown lock version untouched even when its PID is provably dead", async () => {
  const { root, store } = fixture(),
    request = input(store);
  mkdirSync(join(root, "presets"));
  const lock = join(root, "presets", "registry-v1.lock"),
    bytes = JSON.stringify({
      version: 999,
      ...createReviewOwner(),
      pid: 2147483646,
    });
  writeFileSync(lock, bytes);
  await expect(store.install(request)).rejects.toMatchObject({
    code: "presets.storageBusy",
  });
  expect(readFileSync(lock, "utf8")).toBe(bytes);
});
it("rejects replaced root ownership and a hard-linked registry", async () => {
  const { root, store } = fixture();
  await store.install(input(store));
  const previous = readFileSync(join(root, "presets", "registry-v1.json"));
  renameSync(join(root, "presets"), join(root, "old"));
  mkdirSync(join(root, "presets"));
  writeFileSync(join(root, "presets", "registry-v1.json"), previous);
  expect(() => store.list()).toThrow(/ownership/);
  const other = new LocalPresetRegistry(root);
  linkSync(join(root, "presets", "registry-v1.json"), join(root, "alias"));
  expect(() => other.list()).toThrow();
});
it("a blocked backup publication leaves the accepted registry and outside sentinel unchanged", async () => {
  const { root, store } = fixture();
  await store.install(input(store));
  const registry = join(root, "presets", "registry-v1.json"),
    before = readFileSync(registry);
  const outside = join(root, "outside");
  writeFileSync(outside, "sentinel");
  symlinkSync(outside, registry + ".bak");
  const p = presetPackage();
  p.version = "1.0.1";
  await expect(store.install(input(store, p))).rejects.toThrow();
  expect(readFileSync(registry)).toEqual(before);
  expect(readFileSync(outside, "utf8")).toBe("sentinel");
});
it("rejects duplicate raw registry keys instead of silently selecting the last value", async () => {
  const { root, store } = fixture();
  await store.install(input(store));
  const path = join(root, "presets", "registry-v1.json");
  writeFileSync(path, '{"version":999,"version":1,"packages":[]}');
  expect(() => store.list()).toThrow();
});
it("canonicalizes trusted host ancestor aliases once and rejects an owned-root link or later alias replacement", async () => {
  const { root } = fixture(),
    actual = join(root, "host"),
    alias = join(root, "host-alias");
  mkdirSync(actual);
  symlinkSync(actual, alias, "junction");
  const store = new LocalPresetRegistry(join(alias, "user"));
  const request = input(store);
  expect((await store.install(request)).packages).toHaveLength(1);
  expect(existsSync(join(actual, "user", "presets", "registry-v1.json"))).toBe(
    true,
  );
  expect(() => new LocalPresetRegistry(alias).list()).toThrow();
  rmSync(alias);
  const replacement = join(root, "replacement");
  mkdirSync(replacement);
  symlinkSync(replacement, alias, "junction");
  expect(() => store.list()).toThrow();
  expect(existsSync(join(replacement, "user"))).toBe(false);
});
