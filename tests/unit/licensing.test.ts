// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { FILM_LOOK_RECIPE_LICENSE } from "@openfilm/core";

const apacheSha256 =
  "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";
const historicalGplSha256 =
  "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986";
const sha256 = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");

function currentLicenseProblems(source: string): string[] {
  const problems: string[] = [];
  for (const line of source.split(/\r?\n/u)) {
    const spdx = line.match(
      /^[\t ]*(?:\/\/|#|\/\*|\*|<!--)\s*SPDX-License-Identifier:\s*(.*?)(?:\s*\*\/|\s*-->)?\s*$/u,
    );
    if (spdx && spdx[1] !== "Apache-2.0") problems.push(line);
    if (
      /^[\t ]*(?:\/\/|#|\/\*|\*|<!--)\s*(?:Apache-2\.0 grants;\s*)?this derivative as a whole is GPL-3\.0-only[.;]/u.test(
        line,
      )
    )
      problems.push(line);
  }
  return problems;
}

it("restores the exact canonical Apache license as the current distribution license", () => {
  // Original LICENSE bytes from 90921dc4546ad58efc612b1c79f40ffa66ffb043.
  const current = readFileSync("LICENSE");
  const archivedApache = readFileSync("LICENSES/Apache-2.0.txt");
  expect(sha256(current)).toBe(apacheSha256);
  expect(sha256(archivedApache)).toBe(apacheSha256);
  expect(current).toEqual(archivedApache);
});

it("declares Apache consistently for all first-party packages, Cargo and new look evidence", () => {
  const selected = "Apache-2.0";
  const manifests = globSync([
    "package.json",
    "apps/*/package.json",
    "packages/*/package.json",
    "templates/*/package.json",
  ]);
  expect(manifests).toContain("package.json");
  for (const path of manifests)
    expect(JSON.parse(readFileSync(path, "utf8")).license, path).toBe(selected);
  const cargo = readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
  const cargoPackage = cargo.match(/\[package\]([\s\S]*?)(?=\n\[|$)/u)?.[1];
  expect(cargoPackage).toBeDefined();
  expect(cargoPackage).toMatch(/^license\s*=\s*"Apache-2\.0"\s*$/mu);
  expect(FILM_LOOK_RECIPE_LICENSE).toBe(selected);
});

it("keeps current first-party source and configuration declarations consistent", () => {
  const extensions = "{ts,tsx,js,mjs,cjs,vue,json,toml,rs,py,yaml,yml}";
  const paths = globSync(
    [
      `*.${extensions}`,
      ".github/**/*.{yaml,yml}",
      ...["apps", "packages", "templates", "scripts", "tests"].map(
        (root) => `${root}/**/*.${extensions}`,
      ),
      `fixtures/*/*.${extensions}`,
    ],
    {
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/target/**",
        "**/coverage/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
  );
  expect(paths.map((path) => path.replaceAll("\\", "/"))).toContain(
    "packages/core/src/looks.ts",
  );
  for (const path of paths)
    expect(currentLicenseProblems(readFileSync(path, "utf8")), path).toEqual(
      [],
    );
});

it("detects current GPL declarations while allowing historical license evidence", () => {
  expect(
    currentLicenseProblems("// SPDX-License-Identifier: GPL-3.0-only"),
  ).toHaveLength(1);
  expect(
    currentLicenseProblems(
      "// Apache-2.0 grants; this derivative as a whole is GPL-3.0-only. See LICENSE/NOTICE.",
    ),
  ).toHaveLength(1);
  expect(
    currentLicenseProblems(
      "// SPDX-License-Identifier: Apache-2.0\n" +
        "// Historical Apache-2.0 and GPL-3.0-only grants remain; see LICENSE and NOTICE.\n" +
        "// Historical evidence: this derivative as a whole is GPL-3.0-only.\n" +
        'const archive = "LICENSES/GPL-3.0-only.txt";',
    ),
  ).toEqual([]);
});

it("preserves verbatim historical GPL terms and the original attribution without withdrawing grants", () => {
  // Exact LICENSE bytes at 262f7c8659083d1005e35bf1a8446f90ff8c68eb.
  const historicalGpl = readFileSync("LICENSES/GPL-3.0-only.txt");
  expect(sha256(historicalGpl)).toBe(historicalGplSha256);
  expect(historicalGpl.toString("utf8")).toContain(
    "GNU GENERAL PUBLIC LICENSE",
  );
  const originalNotice = `OpenFilm
Copyright 2026 OpenFilm contributors

Licensed under the Apache License, Version 2.0.
Third-party dependencies retain their own licenses; see docs/third-party.md.

Local title rendering uses fontkit (MIT) and resvg (MPL-2.0), with their
upstream copyright and license notices retained in the installed packages.
Noto CJK fonts, when installed separately, are SIL Open Font License 1.1.
No operating-system fonts or private photographic material are redistributed
as part of this implementation.
`;
  const notice = readFileSync("NOTICE", "utf8");
  expect(notice).toContain(originalNotice);
  expect(notice).toContain("GPL-3.0-only");
  expect(notice).toContain("rights remain available");
  const policy = readFileSync("docs/licensing.md", "utf8");
  expect(policy).toContain(
    "Previously granted Apache-2.0 rights remain available",
  );
  expect(policy).toContain(
    "Previously granted GPL-3.0-only rights likewise remain",
  );
});

it("keeps fixture media and third-party components under their own terms", () => {
  const proposalFixture = readFileSync(
    "fixtures/proposal-film/LICENSE",
    "utf8",
  );
  const photoFixture = readFileSync(
    "fixtures/photo-film-quality/LICENSE",
    "utf8",
  );
  expect(proposalFixture).toContain("CC0 1.0 Universal");
  expect(photoFixture).toContain("CC0 1.0");
  for (const fixture of [proposalFixture, photoFixture])
    expect(fixture).toMatch(
      /The generator(?: and scenario)? source (?:is|are) distributed under Apache-2\.0/u,
    );
  const thirdParty = readFileSync("docs/third-party.md", "utf8");
  expect(thirdParty).toContain("fontkit");
  expect(thirdParty).toContain("MPL-2.0");
  expect(thirdParty).toContain("SIL Open Font License 1.1");
  expect(thirdParty).toContain("GPL-enabled");
  const policy = readFileSync("docs/licensing.md", "utf8");
  expect(policy).toContain("does not convert a GPL-enabled FFmpeg executable");
  expect(policy).toContain(
    "Ordinary rendered films are not automatically licensed",
  );
});
