// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";

describe("closed local preset contracts", () => {
  it("detaches descriptor-safe reactive wrappers without structuredClone or getter access", () => {
    const input = presetPackage();
    input.entries[0]!.recipe = new Proxy(input.entries[0]!.recipe, {});
    const result = core.validatePresetPackage(new Proxy(input, {}));
    expect(result).toEqual(presetPackage());
    expect(result).not.toBe(input);
  });
  it("parses a detached package using title owner validation", () => {
    const input = presetPackage();
    const result = core.validatePresetPackage(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(core.parsePresetPackage(JSON.stringify(input))).toEqual(result);
    input.entries[1]!.recipe.fontSize = -1;
    expect(() => core.validatePresetPackage(input)).toThrow(/fontSize/);
  });
  it("rejects accessors before invoking them and refuses non JSON data", () => {
    let calls = 0;
    const input = presetPackage();
    Object.defineProperty(input, "entries", {
      enumerable: true,
      get() {
        calls++;
        return [];
      },
    });
    expect(() => core.validatePresetPackage(input)).toThrow(/data|accessor/);
    expect(calls).toBe(0);
    for (const bad of [
      undefined,
      NaN,
      Infinity,
      1n,
      () => 1,
      new Date(),
      Object.create({ bad: true }),
    ])
      expect(() =>
        core.validatePresetPackage({ ...presetPackage(), extra: bad }),
      ).toThrow();
    const cyclic: Record<string, unknown> = presetPackage();
    cyclic.extra = cyclic;
    expect(() => core.validatePresetPackage(cyclic)).toThrow();
    const sparse = presetPackage();
    sparse.entries = new Array(3);
    expect(() => core.validatePresetPackage(sparse)).toThrow(/dense|sparse/);
  });
  it.each([
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p, { entry: "run.js" }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p, { schemaVersion: 2 }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p, { id: "../escape" }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p, { id: "openfilm.fake" }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p, { version: "01.0.0" }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p, { version: "1.0.0-beta" }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p, { name: "<script>" }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p.provenance, { source: "https://example.test" }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p.provenance, { origin: "adapted" }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p.license, { spdxId: "unknown" }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p.entries[0]!.recipe, { domain: "linear-rgb" }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p.entries[0]!.recipe, { matrix: new Array(20).fill(0) }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p.entries[0]!.recipe, { defaultStrength: 1.1 }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p.entries[1]!.recipe, { fontFamily: "/tmp/private.ttf" }),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p.entries[1]!.recipe, { version: 999 }),
    (p: ReturnType<typeof presetPackage>) => p.entries.push(p.entries[0]!),
    (p: ReturnType<typeof presetPackage>) =>
      Object.assign(p, { entries: new Array(33).fill(p.entries[0]) }),
  ])(
    "rejects unknown versions, executable/path/URL data and invalid rights or recipes %#",
    (mutate) => {
      const input = presetPackage();
      mutate(input);
      expect(() => core.validatePresetPackage(input)).toThrow();
    },
  );
  it("defines stable canonical content and scoped IDs", () => {
    expect(core.canonicalPresetJson({ z: -0, a: [2, 1] })).toBe(
      '{"a":[2,1],"z":0}',
    );
    expect(
      core.canonicalPresetId("test.studio", "1.0.0", "title", "quiet"),
    ).toBe("local:test.studio@1.0.0/title/quiet");
    expect(() => core.canonicalPresetJson({ x: undefined })).toThrow();
  });
  it("rejects an unknown standalone clip title snapshot instead of preserving unchecked metadata", () => {
    expect(() =>
      core.validateComposition({
        id: "cut",
        storyId: "story",
        duration: 1,
        tracks: [
          {
            id: "v",
            type: "video",
            clips: [
              {
                id: "c",
                assetId: "a",
                timelineStart: 0,
                timelineDuration: 1,
                titlePresetSnapshot: { version: 999 },
              },
            ],
          },
        ],
      }),
    ).toThrow(/snapshot/);
  });
});
