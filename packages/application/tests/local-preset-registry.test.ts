// SPDX-License-Identifier: Apache-2.0
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as application from "../src/index.js";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "openfilm-presets-"));
  roots.push(root);
  return { root, store: new application.LocalPresetRegistry(root) };
}
function installInput(
  store: application.LocalPresetRegistry,
  p = presetPackage(),
) {
  const document = JSON.stringify(p),
    r = store.reviewImport(document);
  return {
    document,
    packageSha256: r.packageSha256,
    baseRegistryRevision: r.registryRevision,
    reviewSha256: r.reviewSha256,
    acknowledgeLicense: true as const,
  };
}
it("reviews without writes, requires rights acknowledgement and installs exact immutable versions", async () => {
  const { root, store } = fixture();
  const input = installInput(store);
  expect(existsSync(join(root, "presets"))).toBe(false);
  await expect(
    store.install({ ...input, acknowledgeLicense: false } as never),
  ).rejects.toThrow();
  const installed = await store.install(input);
  expect(installed.packages).toHaveLength(1);
  expect(await store.install(input)).toEqual(installed);
  const changed = presetPackage();
  changed.name = "Changed";
  await expect(
    store.install(installInput(store, changed)),
  ).rejects.toMatchObject({ code: "presets.conflict" });
  const next = presetPackage();
  next.version = "1.0.1";
  expect(
    (await store.install(installInput(store, next))).packages,
  ).toHaveLength(2);
  expect(
    new application.LocalPresetRegistry(root).list().packages,
  ).toHaveLength(2);
});
it("requires current registry and review hashes and an exact removal identity", async () => {
  const { root, store } = fixture(),
    input = installInput(store);
  const other = new application.LocalPresetRegistry(root);
  const next = presetPackage();
  next.id = "second.studio";
  await other.install(installInput(other, next));
  await expect(store.install(input)).rejects.toMatchObject({
    code: "presets.stale",
  });
  const latest = installInput(store);
  await expect(
    store.install({ ...latest, reviewSha256: "a".repeat(64) }),
  ).rejects.toMatchObject({ code: "presets.stale" });
  const view = await store.install(latest),
    p = view.packages.find((p) => p.id === "test.studio")!;
  await expect(
    store.remove({
      packageId: p.id,
      packageVersion: p.version,
      packageSha256: "a".repeat(64),
      baseRegistryRevision: view.revision,
    }),
  ).rejects.toThrow();
  expect(
    (
      await store.remove({
        packageId: p.id,
        packageVersion: p.version,
        packageSha256: p.packageSha256,
        baseRegistryRevision: view.revision,
      })
    ).packages,
  ).toHaveLength(1);
});
it("rejects unsafe roots and registry aliases without changing outside files", async () => {
  const { root, store } = fixture();
  const outside = join(root, "outside.json");
  writeFileSync(outside, "sentinel");
  mkdirSync(join(root, "presets"));
  symlinkSync(outside, join(root, "presets", "registry-v1.json"));
  expect(() => store.list()).toThrow();
  expect(readFileSync(outside, "utf8")).toBe("sentinel");
});
it("cancel before commit has no install and corrupt storage is never treated as empty", async () => {
  const { root, store } = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    store.install(installInput(store), controller.signal),
  ).rejects.toThrow();
  expect(store.list().packages).toHaveLength(0);
  await store.install(installInput(store));
  writeFileSync(join(root, "presets", "registry-v1.json"), "broken");
  expect(() => store.list()).toThrow();
});
it("recovers a reviewed backup without downgrading unknown registry versions", async () => {
  const { root, store } = fixture();
  await store.install(installInput(store));
  const next = presetPackage();
  next.version = "1.0.1";
  await store.install(installInput(store, next));
  const path = join(root, "presets", "registry-v1.json");
  writeFileSync(path, "broken");
  const review = store.reviewRecovery();
  const view = await store.recover({ ...review, acknowledgeRecovery: true });
  expect(view.packages).toHaveLength(1);
  expect(
    readFileSync(join(root, "presets", "registry-v1.corrupt"), "utf8"),
  ).toBe("broken");
  writeFileSync(path, JSON.stringify({ version: 999, packages: [] }));
  expect(() => store.reviewRecovery()).toThrow(/version/);
});
it("uses Node SHA-256 to verify recipe and full snapshot bytes", () => {
  const pkg = presetPackage();
  const snapshot = application.createPresetSnapshot<"film-look">(
    pkg as never,
    pkg.entries[0] as never,
  );
  expect(() =>
    application.assertPresetSnapshotIntegrity(snapshot),
  ).not.toThrow();
  const changed = structuredClone(snapshot);
  changed.recipe.defaultStrength = 0.1;
  expect(() => application.assertPresetSnapshotIntegrity(changed)).toThrow(
    /integrity|hash/,
  );
  const credit = structuredClone(snapshot);
  credit.provenance.author = "Other author";
  expect(() => application.assertPresetSnapshotIntegrity(credit)).toThrow();
});
