// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { classifyExportWarning } from "../../apps/desktop/src/export-warning.js";

describe("classifyExportWarning", () => {
  it.each([
    [
      "Foreign NLEs do not enforce user pins. OpenFilm retains their state.",
      "warningUserPins",
    ],
    [
      "GraphicScene animation and compositing are METADATA ONLY.",
      "warningGraphicScenes",
    ],
    ["Track titles:main: titles semantics are METADATA ONLY.", "warningTrack"],
    [
      "Clip asset-id:clip:1: native OTIO plays an unretimed cut excerpt.",
      "warningSpeed",
    ],
    [
      "Clip asset-id:clip:1: the native OTIO cut displays primary photo only.",
      "warningDiptych",
    ],
    [
      "Clip asset-id:clip:1: speed, volume are METADATA ONLY.",
      "warningClipEdits",
    ],
  ] as const)("maps %s to %s even with compound IDs", (warning, key) => {
    expect(classifyExportWarning(warning)).toBe(key);
  });

  it("leaves unrecognized exporter warnings for the visible fallback", () => {
    expect(classifyExportWarning("Future exporter warning")).toBeUndefined();
  });
});
