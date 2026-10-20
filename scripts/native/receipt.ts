import { release } from "node:os";
import { readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { runtimeHash } from "../../apps/server/src/runtime-manifest.js";
const directory = resolve(
  process.argv[2] ?? "apps/desktop/src-tauri/target/release/bundle",
);
const files: { path: string; sha256: string }[] = [];
async function walk(root: string, prefix: string) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error("Unexpected installer symlink");
    if (entry.isDirectory()) {
      if (!entry.name.endsWith(".app"))
        await walk(join(root, entry.name), path);
    } else if (/\.(?:deb|rpm|AppImage|exe|msi|dmg)$/u.test(entry.name))
      files.push({ path, sha256: await runtimeHash(join(root, entry.name)) });
  }
}
await walk(directory, "");
if (!files.length) throw new Error("No installer artifacts were produced");
files.sort((a, b) => a.path.localeCompare(b.path, "en"));
const runtimeManifestPath = resolve(
  "apps/desktop/src-tauri/resources/runtime/runtime-manifest.json",
);
const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
await writeFile(
  join(directory, "candidate.json"),
  JSON.stringify(
    {
      candidateSha,
      runtimeManifestSha256: await runtimeHash(runtimeManifestPath),
      hostOSRelease: release(),
      hostNodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      artifacts: files,
      workstationQA: { windows: "not-run", macOS: "not-run" },
      automaticUpdates: false,
    },
    null,
    2,
  ) + "\n",
);
