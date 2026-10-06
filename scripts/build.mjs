import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, copyFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
for (const app of ["cli", "server"]) {
  await build({
    entryPoints: [`apps/${app}/src/index.ts`],
    outfile: `dist/${app}/index.mjs`,
    bundle: true,
    platform: "node",
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
execFileSync("pnpm", ["--filter", "@openfilm/desktop", "run", "build"], {
  stdio: "inherit",
});
