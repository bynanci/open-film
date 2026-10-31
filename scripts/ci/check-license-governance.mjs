import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
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
  ".github/workflows/contributor-provenance.yml",
  "scripts/ci/dco-policy.mjs",
  "scripts/ci/check-pr-provenance.mjs",
  "docs/governance/repository-permissions.md",
  "docs/en/governance/repository-permissions.md",
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


const historicalLicenseBlobs = {
  LICENSE: "d645695673349e3947e8e5ae42332d0ac3164cd7",
  "LICENSES/Apache-2.0.txt": "d645695673349e3947e8e5ae42332d0ac3164cd7",
  "LICENSES/GPL-3.0-only.txt": "f288702d2fa16d3cdf0035b15a9fcbc552cd88e7",
};

for (const [path, expected] of Object.entries(historicalLicenseBlobs)) {
  if (!existsSync(filePath(path))) continue;
  const bytes = readFileSync(filePath(path));
  const actual = createHash("sha1")
    .update("blob " + bytes.length + "\0")
    .update(bytes)
    .digest("hex");
  if (actual !== expected) {
    failures.push(path + " no longer matches the pinned historical license text.");
  }
}

for (const rootName of ["apps", "packages", "templates"]) {
  const dir = filePath(rootName);
  if (!existsSync(dir)) continue;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const relative = rootName + "/" + item.name + "/package.json";
    if (!existsSync(filePath(relative))) continue;
    const manifest = JSON.parse(contents(relative));
    if (manifest.license !== "Apache-2.0") {
      failures.push(relative + " has inconsistent first-party license metadata.");
    }
  }
}

const nativeManifestPath = "apps/desktop/src-tauri/Cargo.toml";
if (
  existsSync(filePath(nativeManifestPath)) &&
  !/^license\s*=\s*"Apache-2.0"\s*$/m.test(contents(nativeManifestPath))
) {
  failures.push(nativeManifestPath + " lacks the expected first-party license.");
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
  console.log(
    "License governance: Apache-2.0 and project policy checks passed.",
  );
}
