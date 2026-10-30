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
    "[".repeat(13) + "]".repeat(13),
    " ".repeat(262145),
    new Uint8Array([0xff, 0xfe]),
  ])
    expect(() => core.parsePresetPackage(document)).toThrow();
});
