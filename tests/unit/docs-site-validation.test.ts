// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";

it("ignores installed documentation dependencies while still requiring every owned mirror", () => {
  const root = mkdtempSync(join(tmpdir(), "openfilm-docs-gate-"));
  const script = resolve("scripts/check-doc-locales.mjs");
  function write(file: string, text: string) {
    const absolute = join(root, file);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }
  try {
    write("README.md", "README.zh-TW.md README.ja.md");
    write("README.zh-TW.md", "說明");
    write("README.ja.md", "説明");
    for (const slug of [
      "index",
      "product-workflow",
      "collect-media",
      "project-format",
      "media-portability",
      "source-support",
      "i18n",
      "creative-story-templates",
      "precision-editing",
      "markers-and-snapping",
      "export-quality",
      "audio-quality",
    ]) {
      write(`docs/${slug}.md`, "繁體中文");
      write(`docs/en/${slug}.md`, "English reference");
      write(`docs/ja/${slug}.md`, "日本語ガイド");
    }
    write("docs/architecture.md", "Owned source");
    write("docs/en/architecture.md", "Owned source");
    write(
      "docs/node_modules/dependency/README.md",
      "Third-party installed docs",
    );
    write("docs/.vitepress/cache/generated.md", "Generated build output");
    const output = execFileSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toContain(
      "README locales: 1; English reference mirrors: 1.",
    );
    rmSync(join(root, "docs/en/architecture.md"));
    const invalid = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain(
      "Missing English reference mirror docs/en/architecture.md",
    );
    expect(invalid.stderr).not.toContain("node_modules");
    expect(readFileSync("docs/.vitepress/config.mts", "utf8")).toContain(
      '"node_modules"',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
