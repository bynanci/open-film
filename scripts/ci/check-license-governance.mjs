import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const failures = [];

function filePath(relativePath) {
  return resolve(root, relativePath);
}

function contents(relativePath) {
  return readFileSync(filePath(relativePath), "utf8");
}

const required = [
  "LICENSE",
  "LICENSES/Apache-2.0.txt",
  "LICENSES/GPL-3.0-only.txt",
  "NOTICE",
  "TRADEMARKS.md",
  "COMMERCIAL.md",
  "GOVERNANCE.md",
  "DCO.md",
  "docs/licensing.md",
  ".github/CODEOWNERS",
  ".github/PULL_REQUEST_TEMPLATE.md",
];

for (const path of required) {
  if (!existsSync(filePath(path))) {
    failures.push("Missing required licensing/governance file: " + path);
  }
}

if (
  existsSync(filePath("LICENSE")) &&
  existsSync(filePath("LICENSES/Apache-2.0.txt"))
) {
  const current = readFileSync(filePath("LICENSE"));
  const canonical = readFileSync(filePath("LICENSES/Apache-2.0.txt"));
  if (!current.equals(canonical)) {
    failures.push("Root LICENSE differs from the preserved Apache-2.0 text.");
  }
}

const pkg = JSON.parse(contents("package.json"));
if (pkg.license !== "Apache-2.0") {
  failures.push("Root package.json license must remain Apache-2.0.");
}

for (const readme of ["README.md", "README.zh-TW.md", "README.ja.md"]) {
  const text = contents(readme);
  for (const reference of [
    "LICENSE",
    "TRADEMARKS.md",
    "COMMERCIAL.md",
    "GOVERNANCE.md",
  ]) {
    if (!text.includes(reference)) {
      failures.push(readme + " lacks a link to " + reference);
    }
  }
}

for (const path of [
  "CONTRIBUTING.md",
  "CONTRIBUTING.zh-TW.md",
  "CONTRIBUTING.ja.md",
]) {
  if (!contents(path).includes("DCO.md")) {
    failures.push(path + " lacks contributor provenance guidance.");
  }
}

if (existsSync(filePath("docs/licensing.md"))) {
  const guide = contents("docs/licensing.md");
  for (const reference of ["TRADEMARKS.md", "COMMERCIAL.md", "DCO.md"]) {
    if (!guide.includes(reference)) {
      failures.push("docs/licensing.md lacks reference to " + reference);
    }
  }
}

if (
  existsSync(filePath("NOTICE")) &&
  !contents("NOTICE").includes("OpenFilm contributors")
) {
  failures.push("NOTICE is missing its preserved contributor attribution.");
}

for (const failure of failures) {
  console.error("License governance: " + failure);
}

if (failures.length > 0) {
  process.exitCode = 1;
} else {
  console.log("License governance: Apache-2.0 and project policy checks passed.");
}
