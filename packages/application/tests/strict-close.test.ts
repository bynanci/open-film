import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

function releaseCatalog(app: OpenFilmApplication) {
  cleanup.push(() => {
    try {
      app.catalog.close();
    } catch {
      // A successful close has already released this connection.
    }
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-strict-close-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = { userDataDirectory: join(root, "user-data") };
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Strict close fixture",
    {},
    runtime,
  );
  releaseCatalog(app);
  return { app, runtime, projectPath: join(app.directory, "project.json") };
}

type Replacement = "directory" | "malformed" | "missing";
const externalBytes = '{"stories":[ unfinished external edit';

async function replaceManifest(path: string, replacement: Replacement) {
  if (replacement === "malformed") {
    await writeFile(path, externalBytes);
    return;
  }
  await rm(path);
  if (replacement === "directory") {
    // A directory is unreadable as a manifest even when tests run as root.
    await mkdir(path);
    await writeFile(join(path, "external.txt"), externalBytes);
  }
}

async function expectPreserved(path: string, replacement: Replacement) {
  if (replacement === "directory") {
    expect((await lstat(path)).isDirectory()).toBe(true);
    expect(await readFile(join(path, "external.txt"), "utf8")).toBe(
      externalBytes,
    );
  } else if (replacement === "malformed") {
    expect(await readFile(path, "utf8")).toBe(externalBytes);
  } else {
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  }
}

describe("strict application close", () => {
  it("persists workspace edits before releasing its catalog", async () => {
    const { app, projectPath } = await fixture();
    app.project.title = "Saved during strict close";

    app.close({ requireSave: true });

    expect(JSON.parse(await readFile(projectPath, "utf8")).title).toBe(
      "Saved during strict close",
    );
    expect(() => app.catalog.listJobs()).toThrow();
  });

  it.each(["directory", "malformed", "missing"] as const)(
    "rejects an externally %s manifest and keeps its catalog usable",
    async (replacement) => {
      const { app, projectPath } = await fixture();
      app.project.title = "Unsaved workspace edit";
      await replaceManifest(projectPath, replacement);

      expect(() => app.close({ requireSave: true })).toThrow(
        expect.objectContaining({ code: "story.planConflict" }),
      );

      expect(app.catalog.listJobs()).toEqual([]);
      expect(app.project.title).toBe("Unsaved workspace edit");
      await expectPreserved(projectPath, replacement);
    },
  );

  it("rejects an already detected writer conflict without releasing its catalog", async () => {
    const { app, runtime, projectPath } = await fixture();
    const other = await OpenFilmApplication.open(app.directory, runtime);
    releaseCatalog(other);
    other.project.title = "Newer saved title";
    await other.save();
    const newerBytes = await readFile(projectPath, "utf8");
    app.project.title = "Stale unsaved title";
    await expect(app.save()).rejects.toMatchObject({
      code: "story.planConflict",
    });

    expect(() => app.close({ requireSave: true })).toThrow(
      expect.objectContaining({ code: "story.planConflict" }),
    );

    expect(app.catalog.listJobs()).toEqual([]);
    expect(await readFile(projectPath, "utf8")).toBe(newerBytes);
    expect(() => app.close()).not.toThrow();
    expect(await readFile(projectPath, "utf8")).toBe(newerBytes);
  });

  it.each(["directory", "malformed", "missing"] as const)(
    "allows default close after detecting an externally %s manifest",
    async (replacement) => {
      const { app, projectPath } = await fixture();
      await replaceManifest(projectPath, replacement);
      await expect(app.save()).rejects.toMatchObject({
        code: "story.planConflict",
      });

      expect(() => app.close()).not.toThrow();

      expect(() => app.catalog.listJobs()).toThrow();
      await expectPreserved(projectPath, replacement);
    },
  );

  it.each(["malformed", "missing"] as const)(
    "keeps export close read only after the manifest becomes %s",
    async (replacement) => {
      const { app, runtime, projectPath } = await fixture();
      const exporter = await OpenFilmApplication.openForExport(
        app.directory,
        runtime,
      );
      releaseCatalog(exporter);
      exporter.project.title = "Export must not publish this title";
      await replaceManifest(projectPath, replacement);

      expect(() => exporter.close({ requireSave: true })).not.toThrow();

      expect(() => exporter.catalog.listJobs()).toThrow();
      await expectPreserved(projectPath, replacement);
    },
  );
});
