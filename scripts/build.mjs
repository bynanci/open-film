import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  recordEsbuildContributions,
  mergeBuildContributions,
} from "./build-attribution.mjs";

await mkdir("dist", { recursive: true });
for (const app of ["cli", "server"]) {
  const result = await build({
    entryPoints: [`apps/${app}/src/index.ts`],
    outfile: `dist/${app}/index.mjs`,
    bundle: true,
    platform: "node",
    // Keep the platform native loader intact. The root runtime dependency
    // makes it resolvable from both dist/cli and dist/server after installation.
    external: ["@resvg/resvg-js", "koffi"],
    format: "esm",
    target: "node24",
    sourcemap: true,
    metafile: true,
    banner: { js: "#!/usr/bin/env node" },
  });
  await recordEsbuildContributions(
    resolve("."),
    result.metafile,
    app === "server" ? "service" : "cli",
    `dist/attribution/${app}.json`,
  );
  await chmod(`dist/${app}/index.mjs`, 0o755);
  await copyFile(
    "packages/provider-whisper/src/whisper_runner.py",
    `dist/${app}/whisper_runner.py`,
  );
}
const launcher = await build({
  metafile: true,
  entryPoints: ["apps/server/src/native-entry.ts"],
  outfile: "dist/native/launcher.mjs",
  bundle: true,
  platform: "node",
  external: ["fontkit", "@resvg/resvg-js", "koffi"],
  format: "esm",
  target: "node24",
});
await recordEsbuildContributions(
  resolve("."),
  launcher.metafile,
  "launcher",
  "dist/attribution/launcher.json",
);
execFileSync(
  process.execPath,
  [resolve("node_modules/vite/bin/vite.js"), "build"],
  {
    cwd: "apps/desktop",
    stdio: "inherit",
  },
);

await mergeBuildContributions(
  resolve("."),
  [
    "dist/attribution/cli.json",
    "dist/attribution/server.json",
    "dist/attribution/launcher.json",
    "dist/attribution/desktop.json",
  ],
  "dist/build-contributions.json",
);
