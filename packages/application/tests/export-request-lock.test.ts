import { spawn, execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { acquireExportRequestLock } from "../src/export-request-lock.js";

const cleanup: Array<() => Promise<unknown>> = [];
const exec = promisify(execFile);
const fingerprint = "a".repeat(64);
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-export-lock-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "png-request.lock");
}
const childSource = (path: string) =>
  `import { acquireExportRequestLock } from ${JSON.stringify(pathToFileURL(resolve("packages/application/src/export-request-lock.ts")).href)};` +
  `acquireExportRequestLock(${JSON.stringify(path)},${JSON.stringify(fingerprint)});`;
async function owner(path: string) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      childSource(path) +
        'process.stdout.write("locked\\n"); setInterval(()=>{},1000);',
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let ended = false;
  const done = new Promise<void>((accept) =>
    child.once("exit", () => {
      ended = true;
      accept();
    }),
  );
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => (errors += chunk.toString()));
  cleanup.push(async () => {
    if (!ended) child.kill("SIGKILL");
    await done;
  });
  await new Promise<void>((accept, reject) => {
    child.stdout.once("data", () => accept());
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`Owner exited ${code}: ${errors}`)),
    );
  });
  return { child, done };
}

it("keeps live processes mutually exclusive and recovers a SIGKILL owner", async () => {
  const path = await fixture();
  const first = await owner(path);
  const bytes = await readFile(path, "utf8");
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(() => acquireExportRequestLock(path, fingerprint)).toThrow(
    /already running/u,
  );
  await expect(
    exec(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      childSource(path),
    ]),
  ).rejects.toThrow(/already running/u);
  expect(await readFile(path, "utf8")).toBe(bytes);
  first.child.kill("SIGKILL");
  await first.done;
  const release = acquireExportRequestLock(path, fingerprint);
  expect(await readFile(path, "utf8")).not.toBe(bytes);
  release();
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it.skipIf(process.platform !== "linux")(
  "recognizes a reused PID by its process start identity",
  async () => {
    const path = await fixture();
    const first = await owner(path);
    first.child.kill("SIGKILL");
    await first.done;
    const record = JSON.parse(await readFile(path, "utf8"));
    record.owner.pid = process.pid;
    await writeFile(path, JSON.stringify(record));
    const release = acquireExportRequestLock(path, fingerprint);
    expect(JSON.parse(await readFile(path, "utf8")).owner.token).not.toBe(
      record.owner.token,
    );
    release();
  },
);

it.each(["token", "inode"] as const)(
  "does not release a replacement lock with a different %s",
  async (replacement) => {
    const path = await fixture();
    const release = acquireExportRequestLock(path, fingerprint);
    const record = JSON.parse(await readFile(path, "utf8"));
    if (replacement === "token")
      record.owner.token = "00000000-0000-4000-8000-000000000001";
    const temporary = `${path}.replacement`;
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, path);
    const bytes = await readFile(path, "utf8");
    expect(release).toThrow(/changed ownership/u);
    expect(await readFile(path, "utf8")).toBe(bytes);
  },
);
