// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  retainSyntheticFontPixelFailure,
  rgbPixelDifference,
} from "../helpers/font-pixel-diagnostics.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it("records every changed RGB channel and its pixel without an error allowance", () => {
  const expected = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const actual = Buffer.from([1, 3, 3, 2, 5, 6, 7, 8, 9, 10, 11, 19]);
  expect(rgbPixelDifference(expected, actual, 2)).toMatchObject({
    expectedBytes: 12,
    actualBytes: 12,
    differentChannels: 3,
    differentPixels: 3,
    maximumAbsoluteDelta: 7,
    totalAbsoluteDelta: 10,
    bounds: { left: 0, top: 0, right: 1, bottom: 1 },
    firstDifferences: [
      { offset: 1, x: 0, y: 0, channel: 1, expected: 2, actual: 3 },
      { offset: 3, x: 1, y: 0, channel: 0, expected: 4, actual: 2 },
      { offset: 11, x: 1, y: 1, channel: 2, expected: 12, actual: 19 },
    ],
  });
  expect(actual).not.toEqual(expected);
  expect(rgbPixelDifference(expected, expected, 2)).toMatchObject({
    differentChannels: 0,
    differentPixels: 0,
    bounds: null,
    firstDifferences: [],
  });
  expect(() => rgbPixelDifference(expected, Buffer.alloc(3), 2)).toThrow();
});

it("retains exact synthetic artifacts and structured evidence in a new QA directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-font-diagnostic-test-"));
  directories.push(root);
  const files = {
    "preview.png": Buffer.from([137, 80, 78, 71]),
    "still.png": Buffer.from([137, 80, 78, 71, 1]),
    "delivery.mp4": Buffer.from([0, 0, 0, 24]),
    "delivery-fast-seek.rgb": Buffer.from([1, 2, 3]),
  };
  const directory = await retainSyntheticFontPixelFailure(root, {
    evidence: { syntheticOnly: true, comparison: { differentChannels: 1 } },
    files,
  });
  expect(await readdir(directory)).toContain("evidence.json");
  for (const [name, bytes] of Object.entries(files))
    expect(await readFile(join(directory, name))).toEqual(bytes);
  expect(
    JSON.parse(await readFile(join(directory, "evidence.json"), "utf8")),
  ).toEqual({ syntheticOnly: true, comparison: { differentChannels: 1 } });
  const second = await retainSyntheticFontPixelFailure(root, {
    evidence: { syntheticOnly: true },
    files: {},
  });
  expect(second).not.toBe(directory);
  expect(await readFile(join(directory, "preview.png"))).toEqual(
    files["preview.png"],
  );
});

it("refuses artifact names that escape the explicit QA directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-font-diagnostic-test-"));
  directories.push(root);
  await expect(
    retainSyntheticFontPixelFailure(root, {
      evidence: { syntheticOnly: true },
      files: { "../escaped.txt": Buffer.from("synthetic") },
    }),
  ).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
});
