import { execFile } from "node:child_process";
import {
  copyFile,
  lstat,
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
        `import {getExclusiveDirectoryRenamer} from ${JSON.stringify(resolve("packages/application/src/exclusive-directory-rename.ts"))};
        if (process.argv[2]) {
          const rename = await getExclusiveDirectoryRenamer();
          try { rename(process.argv[2],process.argv[3]); }
          catch(error) { if(error.code !== 'EEXIST') throw error; process.exitCode=2; }
        }
        console.log("synthetic build fixture");`,
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
    for (const entry of [
      "dist/cli/index.mjs",
      "dist/server/index.mjs",
      "dist/native/launcher.mjs",
    ]) {
      const privateStage = join(
        root,
        `${entry.replaceAll("/", "-")} 私有 stage`,
      );
      const destination = `${privateStage} 公開`;
      await mkdir(privateStage);
      await writeFile(join(privateStage, "complete"), "complete tree");
      const before = await lstat(privateStage);
      await execute(
        process.execPath,
        [join(root, entry), privateStage, destination],
        { env: {} },
      );
      expect(await lstat(destination)).toMatchObject({
        dev: before.dev,
        ino: before.ino,
      });
      expect(await readFile(join(destination, "complete"), "utf8")).toBe(
        "complete tree",
      );
      await mkdir(privateStage);
      const loser = await lstat(privateStage);
      await expect(
        execute(
          process.execPath,
          [join(root, entry), privateStage, destination],
          { env: {} },
        ),
      ).rejects.toMatchObject({ code: 2 });
      expect(await lstat(privateStage)).toMatchObject({
        dev: loser.dev,
        ino: loser.ino,
      });
      expect(await lstat(destination)).toMatchObject({
        dev: before.dev,
        ino: before.ino,
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
