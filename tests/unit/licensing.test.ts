// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { FILM_LOOK_RECIPE_LICENSE } from "@openfilm/core";

it("declares the selected copyleft license consistently for the current distribution", () => {
  const selected = "GPL-3.0-only";
  expect(readFileSync("LICENSE", "utf8")).toContain(
    "GNU GENERAL PUBLIC LICENSE",
  );
  for (const path of globSync([
    "package.json",
    "apps/*/package.json",
    "packages/*/package.json",
    "templates/*/package.json",
  ])) {
    expect(JSON.parse(readFileSync(path, "utf8")).license, path).toBe(selected);
  }
  expect(readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8")).toContain(
    'license = "GPL-3.0-only"',
  );
  expect(FILM_LOOK_RECIPE_LICENSE).toBe(selected);
});

it("retains the original Apache text and copyright notice without withdrawing historical grants", () => {
  // Exact LICENSE bytes from base 90921dc4546ad58efc612b1c79f40ffa66ffb043.
  const original = readFileSync("LICENSES/Apache-2.0.txt");
  expect(createHash("sha256").update(original).digest("hex")).toBe(
    "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  );
  expect(readFileSync("NOTICE", "utf8")).toContain(
    "OpenFilm\nCopyright 2026 OpenFilm contributors\n\nLicensed under the Apache License, Version 2.0.",
  );
  expect(readFileSync("docs/licensing.md", "utf8")).toContain(
    "Previously granted Apache-2.0 rights remain available",
  );
  expect(readFileSync("fixtures/proposal-film/LICENSE", "utf8")).toContain(
    "CC0 1.0 Universal",
  );
});
