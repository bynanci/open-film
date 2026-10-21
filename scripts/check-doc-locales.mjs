import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const docsRoot = path.join(root, "docs");
const errors = [];
const readmes = [];

function collect(directory, ignoredDirectories) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        output.push(...collect(full, ignoredDirectories));
      }
    } else if (entry.isFile()) {
      output.push(full);
    }
  }
  return output;
}

function readFileSyncSafe(file) {
  try {
    readFileSync(file, "utf8");
    return true;
  } catch {
    return false;
  }
}

for (const file of collect(
  root,
  new Set([".git", "node_modules", "dist", "target", "coverage", ".vitepress"]),
)) {
  if (path.basename(file) === "README.md") readmes.push(file);
}

for (const readme of readmes) {
  const directory = path.dirname(readme);
  const source = readFileSync(readme, "utf8");
  for (const locale of ["zh-TW", "ja"]) {
    const translated = path.join(directory, `README.${locale}.md`);
    if (!readFileSyncSafe(translated)) {
      errors.push(`Missing ${path.relative(root, translated)}`);
    }
  }
  if (
    !source.includes("README.zh-TW.md") ||
    !source.includes("README.ja.md")
  ) {
    errors.push(`Missing language links in ${path.relative(root, readme)}`);
  }
}

const guideSlugs = [
  "product-workflow",
  "collect-media",
  "project-format",
  "media-portability",
  "source-support",
  "i18n",
];
for (const slug of guideSlugs) {
  for (const locale of ["", "en/", "ja/"]) {
    const file = path.join(docsRoot, locale, `${slug}.md`);
    if (!readFileSyncSafe(file)) {
      errors.push(`Missing localized guide ${path.relative(root, file)}`);
    }
  }
}

for (const locale of ["", "en/", "ja/"]) {
  const file = path.join(docsRoot, locale, "index.md");
  if (!readFileSyncSafe(file)) {
    errors.push(`Missing docs home ${path.relative(root, file)}`);
  }
}

const ignoredDocDirectories = new Set([
  ".vitepress",
  "en",
  "ja",
  "superpowers",
]);
const sourceDocs = collect(docsRoot, ignoredDocDirectories).filter((file) => {
  const rel = path.relative(docsRoot, file).split(path.sep).join("/");
  return (
    rel.endsWith(".md") &&
    rel !== "PROJECT_BRIEF.md" &&
    rel !== "index.md" &&
    !guideSlugs.some((slug) => rel === `${slug}.md`)
  );
});

for (const source of sourceDocs) {
  const relative = path.relative(docsRoot, source);
  const mirror = path.join(docsRoot, "en", relative);
  let sourceText;
  let mirrorText;
  try {
    sourceText = readFileSync(source, "utf8");
    mirrorText = readFileSync(mirror, "utf8");
  } catch {
    errors.push(
      `Missing English reference mirror docs/en/${relative.split(path.sep).join("/")}`,
    );
    continue;
  }
  if (sourceText !== mirrorText) {
    errors.push(
      `English reference mirror is out of sync: docs/${relative.split(path.sep).join("/")}`,
    );
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `README locales: ${readmes.length}; English reference mirrors: ${sourceDocs.length}.`,
  );
}
