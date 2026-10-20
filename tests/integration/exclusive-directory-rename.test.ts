import { readdirSync, watch } from "node:fs";
import {
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
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getExclusiveDirectoryRenamer } from "../../packages/application/src/exclusive-directory-rename.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-exclusive-目錄 with spaces 🧪-"),
  );
  roots.push(root);
  const source = join(root, "私有 complete stage");
  const destination = join(root, "公開 destination");
  await mkdir(source);
  await writeFile(join(source, "證據.txt"), "complete immutable bytes");
  return { root, source, destination, before: await lstat(source) };
}

describe.skipIf(process.platform !== "linux")(
  "real OS exclusive directory publication",
  () => {
    it("publishes a complete Unicode tree with the original private directory identity", async () => {
      const { source, destination, before } = await fixture();
      const rename = await getExclusiveDirectoryRenamer();
      expect(rename(source, destination)).toBeUndefined();
      expect(await lstat(destination)).toMatchObject({
        dev: before.dev,
        ino: before.ino,
      });
      expect(await readFile(join(destination, "證據.txt"), "utf8")).toBe(
        "complete immutable bytes",
      );
      await expect(lstat(source)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it.each([
      "empty directory",
      "nonempty directory",
      "file",
      "symlink",
      "dangling symlink",
    ])(
      "preserves an existing %s and the complete private stage",
      async (kind) => {
        const { root, source, destination, before } = await fixture();
        if (kind.includes("directory")) {
          await mkdir(destination);
          if (kind === "nonempty directory")
            await writeFile(join(destination, "foreign"), "foreign bytes");
        } else if (kind === "file")
          await writeFile(destination, "foreign file");
        else
          await symlink(
            kind === "symlink" ? source : join(root, "missing"),
            destination,
          );
        const foreign = await lstat(destination);
        const rename = await getExclusiveDirectoryRenamer();
        expect(() => rename(source, destination)).toThrow(
          expect.objectContaining({ code: "EEXIST" }),
        );
        expect(await lstat(destination)).toMatchObject({
          dev: foreign.dev,
          ino: foreign.ino,
        });
        expect(await lstat(source)).toMatchObject({
          dev: before.dev,
          ino: before.ino,
        });
        expect(await readFile(join(source, "證據.txt"), "utf8")).toBe(
          "complete immutable bytes",
        );
        if (kind === "nonempty directory")
          expect(await readFile(join(destination, "foreign"), "utf8")).toBe(
            "foreign bytes",
          );
        if (kind === "file")
          expect(await readFile(destination, "utf8")).toBe("foreign file");
      },
    );

    it("preserves the native missing-source error without creating a public directory", async () => {
      const { root, destination } = await fixture();
      const rename = await getExclusiveDirectoryRenamer();
      expect(() => rename(join(root, "missing"), destination)).toThrow(
        expect.objectContaining({ code: "ENOENT" }),
      );
      await expect(lstat(destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("admits exactly one real process and exposes only its complete tree", async () => {
      const { root, destination } = await fixture();
      const stages = await Promise.all(
        Array.from({ length: 4 }, async (_, i) => {
          const path = join(root, `競爭 stage ${i}`);
          await mkdir(path);
          await writeFile(join(path, "first"), `${i}`);
          await writeFile(join(path, "last"), `complete ${i}`);
          return { path, identity: await lstat(path) };
        }),
      );
      const observations: string[][] = [];
      const observer = watch(root, (_event, name) => {
        if (name === "公開 destination")
          observations.push(readdirSync(destination).sort());
      });
      const workers = stages.map(({ path }) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "--input-type=module",
            "-e",
            `
        import {getExclusiveDirectoryRenamer} from ${JSON.stringify(pathToFileURL(resolve("packages/application/src/exclusive-directory-rename.ts")).href)};
        const rename = await getExclusiveDirectoryRenamer();
        process.stdout.write('ready\\n');
        await new Promise(done => process.stdin.once('data', done));
        try { rename(process.argv[1],process.argv[2]); process.stdout.write('published\\n'); }
        catch(error) { process.stdout.write(error.code+'\\n'); process.exitCode=2; }
        process.stdin.destroy();
      `,
            path,
            destination,
          ],
          { cwd: resolve("."), env: {}, stdio: ["pipe", "pipe", "pipe"] },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (b) => (stdout += b.toString()));
        child.stderr.on("data", (b) => (stderr += b.toString()));
        const ready = new Promise<void>((done, reject) => {
          child.stdout.on("data", () => {
            if (stdout.includes("ready\n")) done();
          });
          child.once("error", reject);
          child.once("exit", () => {
            if (!stdout.includes("ready\n")) reject(new Error(stderr));
          });
        });
        const closed = new Promise<{
          code: number | null;
          stdout: string;
          stderr: string;
        }>((done, reject) => {
          child.once("error", reject);
          child.once("close", (code) => done({ code, stdout, stderr }));
        });
        return { child, ready, closed };
      });
      try {
        await Promise.all(workers.map((w) => w.ready));
        for (const w of workers) w.child.stdin.end("publish");
        const outcomes = await Promise.all(workers.map((w) => w.closed));
        expect(outcomes.filter((o) => o.code === 0)).toHaveLength(1);
        expect(
          outcomes.filter((o) => o.code === 2 && o.stdout.endsWith("EEXIST\n")),
        ).toHaveLength(3);
        expect(outcomes.every((o) => !o.stderr)).toBe(true);
        const winner = outcomes.findIndex((o) => o.code === 0);
        expect(await lstat(destination)).toMatchObject({
          dev: stages[winner]!.identity.dev,
          ino: stages[winner]!.identity.ino,
        });
        expect(await readFile(join(destination, "first"), "utf8")).toBe(
          `${winner}`,
        );
        expect(await readFile(join(destination, "last"), "utf8")).toBe(
          `complete ${winner}`,
        );
        for (const [i, stage] of stages.entries()) {
          if (i === winner)
            await expect(lstat(stage.path)).rejects.toMatchObject({
              code: "ENOENT",
            });
          else
            expect(await lstat(stage.path)).toMatchObject({
              dev: stage.identity.dev,
              ino: stage.identity.ino,
            });
        }
        expect(observations.length).toBeGreaterThan(0);
        expect(
          observations.every((files) => files.join(",") === "first,last"),
        ).toBe(true);
      } finally {
        observer.close();
        for (const w of workers) if (w.child.exitCode === null) w.child.kill();
      }
    });
  },
);
