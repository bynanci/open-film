import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);

it("builds the desktop with the pinned Node toolchain when no pnpm executable is available", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-build-launcher-"));
  try {
    for (const path of [
      "scripts",
      "apps/cli/src",
      "apps/server/src",
      "apps/desktop",
      "packages/provider-whisper/src",
    ])
      await mkdir(join(root, path), { recursive: true });
    await copyFile(
      resolve("scripts/build.mjs"),
      join(root, "scripts/build.mjs"),
    );
    await symlink(
      resolve("node_modules"),
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    for (const path of [
      "apps/cli/src/index.ts",
      "apps/server/src/index.ts",
      "apps/server/src/native-entry.ts",
    ])
      await writeFile(
        join(root, path),
        'console.log("synthetic build fixture");',
      );
    await writeFile(
      join(root, "packages/provider-whisper/src/whisper_runner.py"),
      "# synthetic fixture\n",
    );
    await writeFile(
      join(root, "apps/desktop/index.html"),
      "<!doctype html><title>OpenFilm build fixture</title>",
    );
    await execute(process.execPath, [join(root, "scripts/build.mjs")], {
      cwd: root,
      env: { ...process.env, PATH: "", npm_execpath: "unavailable-pnpm.cmd" },
    });
    expect(
      await readFile(join(root, "apps/desktop/dist/index.html"), "utf8"),
    ).toContain("OpenFilm build fixture");
    expect(
      await readFile(join(root, "dist/native/launcher.mjs"), "utf8"),
    ).toContain("synthetic build fixture");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
