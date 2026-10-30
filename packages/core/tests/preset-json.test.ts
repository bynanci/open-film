// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import * as core from "../src/index.js";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";
it("bounds raw bytes/depth and rejects duplicate keys, malformed Unicode and numeric overflow", () => {
  const valid = JSON.stringify(presetPackage());
  expect(core.parsePresetPackage(valid)).toEqual(presetPackage());
  for (const document of [
    valid.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    valid.replace('"defaultStrength":0.8', '"defaultStrength":1e999'),
    valid.replace('"name":"Local 記憶"', '"name":"\\ud800"'),
    '{"constructor":{}}',
    "\ufeff" + valid,
    new TextEncoder().encode("\ufeff" + valid),
    "[".repeat(13) + "]".repeat(13),
    " ".repeat(262145),
    new Uint8Array([0xff, 0xfe]),
  ])
    expect(() => core.parsePresetPackage(document)).toThrow();
});

it("accepts exact lexical byte, depth and token bounds and refuses one beyond", () => {
  const valid = JSON.stringify(presetPackage());
  const extraBytes = new TextEncoder().encode(valid).length - valid.length;
  expect(
    core.parsePresetPackage(valid.padEnd(262144 - extraBytes, " ")),
  ).toEqual(presetPackage());
  expect(() =>
    core.parsePresetPackage(valid.padEnd(262145 - extraBytes, " ")),
  ).toThrow();
  expect(() =>
    core.parsePresetJson("[".repeat(12) + "0" + "]".repeat(12)),
  ).not.toThrow();
  expect(() =>
    core.parsePresetJson("[".repeat(13) + "0" + "]".repeat(13)),
  ).toThrow(/depth/);
  expect(() =>
    core.parsePresetJson(JSON.stringify(new Array(19999).fill(0))),
  ).not.toThrow();
  expect(() =>
    core.parsePresetJson(JSON.stringify(new Array(20000).fill(0))),
  ).toThrow(/token/);
});
