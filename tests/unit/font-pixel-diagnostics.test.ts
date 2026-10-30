// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  syntheticFontPixelScope,
  retainSyntheticFontPixelEvidence,
  rgbPixelDifference,
} from "../helpers/font-pixel-diagnostics.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
it.each([true, false])(
  "retains a %s observation without relabeling its strict comparison",
  async (comparisonPassed) => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-font-observation-test-"),
    );
    directories.push(root);
    const directory = await retainSyntheticFontPixelEvidence(root, {
      evidence: { syntheticOnly: true, comparisonPassed },
      files: { "literal.rgb": Buffer.from([1, 2, 3]) },
    });
    expect(
      JSON.parse(await readFile(join(directory, "evidence.json"), "utf8")),
    ).toEqual({ syntheticOnly: true, comparisonPassed });
    expect(await readFile(join(directory, "literal.rgb"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
  },
);

it("collects canonical Windows fixture outputs and redacts both temporary path spellings", () => {
  const scope = syntheticFontPixelScope(
    "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\openfilm-fixture",
    "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\openfilm-fixture",
    "win32",
  );
  for (const [output, redacted] of [
    [
      "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\openfilm-fixture\\project\\render.mp4",
      "<synthetic-fixture>\\project\\render.mp4",
    ],
    [
      "c:/users/RUNNERADMIN/AppData/Local/Temp/openfilm-fixture/project/render.mp4",
      "<synthetic-fixture>/project/render.mp4",
    ],
  ] as const) {
    expect(scope.output(output)).toBe(output);
    expect(scope.redact(output)).toBe(redacted);
  }
  expect(
    scope.redact(
      "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\openfilm-fixture\\synthetic.png",
    ),
  ).toBe("<synthetic-fixture>\\synthetic.png");
});

it.each([
  ["posix", "/tmp/fixture", "/tmp/fixture/render.mp4"],
  ["win32", "C:\\Temp\\fixture", "c:/temp/fixture/render.mp4"],
] as const)(
  "keeps %s output collection inside its owned fixture",
  (platform, root, output) => {
    const scope = syntheticFontPixelScope(root, root, platform);
    expect(scope.output(output)).toBe(output);
    const rejected =
      platform === "win32"
        ? [
            root,
            "C:\\Temp\\fixture-other\\render.mp4",
            "C:\\Temp\\fixture\\..\\other\\render.mp4",
            "D:\\Temp\\fixture\\render.mp4",
            "render.mp4",
          ]
        : [
            root,
            "/tmp/fixture-other/render.mp4",
            "/tmp/fixture/../other/render.mp4",
            "render.mp4",
          ];
    for (const external of rejected)
      expect(() => scope.output(external)).toThrow(/external output/u);
    expect(scope.redact(root + "-other/render.mp4")).toBe(
      root + "-other/render.mp4",
    );
  },
);

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
  const directory = await retainSyntheticFontPixelEvidence(root, {
    evidence: { syntheticOnly: true, comparison: { differentChannels: 1 } },
    files,
  });
  expect(await readdir(directory)).toContain("evidence.json");
  for (const [name, bytes] of Object.entries(files))
    expect(await readFile(join(directory, name))).toEqual(bytes);
  expect(
    JSON.parse(await readFile(join(directory, "evidence.json"), "utf8")),
  ).toEqual({ syntheticOnly: true, comparison: { differentChannels: 1 } });
  const second = await retainSyntheticFontPixelEvidence(root, {
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
    retainSyntheticFontPixelEvidence(root, {
      evidence: { syntheticOnly: true },
      files: { "../escaped.txt": Buffer.from("synthetic") },
    }),
  ).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
});
