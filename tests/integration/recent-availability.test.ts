import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function project(root: string, name: string): Promise<string> {
  const directory = join(root, `${name}.openfilm`);
  const application = await OpenFilmApplication.create(directory, name);
  application.close();
  return directory;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-recent-availability-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const current = await project(root, "Current film");
  const runtime = await startServer({ port: 0, project: current });
  cleanup.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}/api`;
  return {
    root,
    current,
    currentProject: () =>
      fetch(`${base}/project`).then((response) => response.json()),
    availability: (paths: string[]) =>
      fetch(`${base}/projects/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      }),
  };
}

type StorageEntry = {
  path: string;
  mode: bigint;
  modified: bigint;
  bytes?: Buffer;
};

/** Include directory times to detect even temporary SQLite sidecar creation. */
async function storageSnapshot(directory: string): Promise<StorageEntry[]> {
  const entries: StorageEntry[] = [];
  async function visit(relativePath: string): Promise<void> {
    const absolutePath = join(directory, relativePath);
    const info = await lstat(absolutePath, { bigint: true });
    entries.push({
      path: relativePath,
      mode: info.mode,
      modified: info.mtimeNs,
      ...(info.isFile() ? { bytes: await readFile(absolutePath) } : {}),
    });
    if (info.isDirectory()) {
      for (const name of (await readdir(absolutePath)).sort())
        await visit(join(relativePath, name));
    }
  }
  await visit("");
  return entries;
}

describe("recent project catalog availability", () => {
  it.each(["non-SQLite", "corrupt", "future schema"] as const)(
    "reports a %s database as invalid without changing either project",
    async (kind) => {
      const test = await fixture();
      const recent = await project(test.root, "Recent film");
      const databasePath = join(recent, "database.sqlite");
      if (kind === "non-SQLite") {
        await writeFile(
          databasePath,
          "This regular file is not a SQLite database.",
        );
      } else if (kind === "corrupt") {
        const bytes = await readFile(databasePath);
        expect(bytes.subarray(0, 16).toString()).toBe("SQLite format 3\0");
        // Keep the SQLite header, but invalidate the sqlite_schema b-tree page.
        bytes[100] = 0xff;
        await writeFile(databasePath, bytes);
      } else {
        const database = new DatabaseSync(databasePath);
        try {
          database.exec("PRAGMA user_version=99");
        } finally {
          database.close();
        }
      }

      const recentBefore = await storageSnapshot(recent);
      const currentBefore = await storageSnapshot(test.current);
      const openBefore = await test.currentProject();
      const response = await test.availability([recent, test.current]);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        projects: [
          { path: recent, status: "invalid" },
          { path: test.current, status: "available" },
        ],
      });
      expect(await storageSnapshot(recent)).toEqual(recentBefore);
      expect(await storageSnapshot(test.current)).toEqual(currentBefore);
      expect(await test.currentProject()).toEqual(openBefore);
    },
  );

  it("reports a valid read-only recent project as available without creating sidecars or opening it", async () => {
    const test = await fixture();
    const recent = await project(test.root, "Read only film");
    const databasePath = join(recent, "database.sqlite");
    const manifestPath = join(recent, "project.json");
    await chmod(databasePath, 0o444);
    await chmod(manifestPath, 0o444);
    await chmod(recent, 0o555);
    cleanup.push(async () => {
      await chmod(recent, 0o755);
      await chmod(manifestPath, 0o644);
      await chmod(databasePath, 0o644);
    });
    expect(await readdir(recent)).not.toContain("database.sqlite-wal");
    expect(await readdir(recent)).not.toContain("database.sqlite-shm");
    const recentBefore = await storageSnapshot(recent);
    const currentBefore = await storageSnapshot(test.current);
    const openBefore = await test.currentProject();

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await test.availability([recent]);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        projects: [{ path: recent, status: "available" }],
      });
    }

    expect(await storageSnapshot(recent)).toEqual(recentBefore);
    expect(await storageSnapshot(test.current)).toEqual(currentBefore);
    expect(await test.currentProject()).toEqual(openBefore);
  });

  it("recognizes a valid recent catalog whose schema is still in another application's WAL", async () => {
    const test = await fixture();
    const recent = join(test.root, "Other application.openfilm");
    const other = await OpenFilmApplication.create(recent, "Other application");
    cleanup.push(async () => other.close());
    expect(other.catalog.countAssets()).toBe(0);
    expect(
      (await lstat(join(recent, "database.sqlite-wal"))).size,
    ).toBeGreaterThan(0);
    const recentBefore = await storageSnapshot(recent);
    const currentBefore = await storageSnapshot(test.current);
    const openBefore = await test.currentProject();

    const response = await test.availability([recent, test.current]);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projects: [
        { path: recent, status: "available" },
        { path: test.current, status: "available" },
      ],
    });
    expect(await storageSnapshot(recent)).toEqual(recentBefore);
    expect(await storageSnapshot(test.current)).toEqual(currentBefore);
    expect(await test.currentProject()).toEqual(openBefore);
  });

  it("rejects an unsupported catalog version committed to another connection's WAL", async () => {
    const test = await fixture();
    const recent = await project(test.root, "Future application");
    const database = new DatabaseSync(join(recent, "database.sqlite"));
    cleanup.push(async () => database.close());
    database.exec("PRAGMA user_version=99");
    expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(
      99,
    );
    expect(
      (await lstat(join(recent, "database.sqlite-wal"))).size,
    ).toBeGreaterThan(0);
    const recentBefore = await storageSnapshot(recent);
    const currentBefore = await storageSnapshot(test.current);
    const openBefore = await test.currentProject();

    const response = await test.availability([recent, test.current]);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projects: [
        { path: recent, status: "invalid" },
        { path: test.current, status: "available" },
      ],
    });
    expect(await storageSnapshot(recent)).toEqual(recentBefore);
    expect(await storageSnapshot(test.current)).toEqual(currentBefore);
    expect(await test.currentProject()).toEqual(openBefore);
  });
});
