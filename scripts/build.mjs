import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir("dist", { recursive: true });
for (const app of ["cli", "server"]) {
  await build({
    entryPoints: [`apps/${app}/src/index.ts`],
    outfile: `dist/${app}/index.mjs`,
    bundle: true,
    platform: "node",
    // Keep the platform native loader intact. The root runtime dependency
    // makes it resolvable from both dist/cli and dist/server after installation.
    external: ["@resvg/resvg-js"],
    format: "esm",
    target: "node24",
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
  });
  await chmod(`dist/${app}/index.mjs`, 0o755);
  await copyFile(
    "packages/provider-whisper/src/whisper_runner.py",
    `dist/${app}/whisper_runner.py`,
  );
}
await build({
  entryPoints: ["apps/server/src/native-entry.ts"],
  outfile: "dist/native/launcher.mjs",
  bundle: true,
  platform: "node",
  external: ["fontkit", "@resvg/resvg-js"],
  format: "esm",
  target: "node24",
});
execFileSync(
  process.execPath,
  [resolve("node_modules/vite/bin/vite.js"), "build"],
  {
    cwd: "apps/desktop",
    stdio: "inherit",
  },
);
