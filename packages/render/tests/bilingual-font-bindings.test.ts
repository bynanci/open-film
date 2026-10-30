// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import {
  canonicalRenderFontBindings,
  type RenderFontBinding,
} from "../src/manifest.js";

it("binds primary and secondary faces independently for one title usage", () => {
  const primary: RenderFontBinding = {
    usage: ["title", "track", "clip"],
    run: "primary",
    family: "Noto Sans CJK TC",
    postscriptName: "Regular",
    sha256: "a".repeat(64),
  };
  const secondary: RenderFontBinding = {
    ...primary,
    run: "secondary",
    postscriptName: "Bold",
    sha256: "b".repeat(64),
  };
  expect(canonicalRenderFontBindings([secondary, primary])).toEqual([
    primary,
    secondary,
  ]);
  expect(() =>
    canonicalRenderFontBindings([
      primary,
      { ...primary, sha256: "c".repeat(64) },
    ]),
  ).toThrow(/conflicting/iu);
  const swapped = canonicalRenderFontBindings([
    { ...secondary, run: "primary" },
    { ...primary, run: "secondary" },
  ]);
  expect(swapped).not.toEqual(
    canonicalRenderFontBindings([primary, secondary]),
  );
  expect(() =>
    canonicalRenderFontBindings([{ ...primary, run: "third" } as never]),
  ).toThrow(/invalid/iu);
  const legacy = {
    usage: ["caption", "track", "cue"] as const,
    family: "Noto",
    postscriptName: "Regular",
    sha256: "a".repeat(64),
  };
  expect(canonicalRenderFontBindings([legacy])).toEqual([legacy]);
});
