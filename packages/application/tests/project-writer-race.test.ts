import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

const narration = "We arrived at dawn.";
const visualDirection = "Open on the quiet harbour.";
const childVisualDirection = "Cut to the boats at the pier.";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-project-writer-race-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = { userDataDirectory: join(root, "user-data") };
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Project writer race",
    {},
    runtime,
  );
  // Cleanup releases the connection without introducing another project write.
  cleanup.push(() => {
    try {
      app.catalog.close();
    } catch {
      // Tests that exercise app.close() have already released the database.
    }
  });
  app.project.stories.push({
    id: "story",
    title: "Our journey",
    targetDuration: 12,
    maxDuration: 15,
    beats: [
      {
        id: "beat",
        title: "Arriving",
        targetDuration: 6,
        script: { narration, visualDirection },
        candidateAssetIds: [],
      },
    ],
  });
  await app.save();
  return {
    root,
    runtime,
    app,
    projectPath: join(app.directory, "project.json"),
  };
}

interface WriterResult {
  pid: number;
  status: "saved" | "rejected";
  code?: string;
  message?: string;
}

/** The independent writer is fully open before either process starts saving. */
async function writer(
  context: Awaited<ReturnType<typeof fixture>>,
  attempts = 1,
) {
  const commands = Array.from({ length: attempts }, (_, index) => ({
    commandPath: join(context.root, `writer-command-${index}`),
    resultPath: join(context.root, `writer-result-${index}.json`),
  }));
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
      "--input-type=module",
      "--eval",
      `
        import { existsSync, renameSync, writeFileSync } from "node:fs";
        import { OpenFilmApplication } from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)};
        const app = await OpenFilmApplication.open(
          ${JSON.stringify(context.app.directory)},
          ${JSON.stringify(context.runtime)},
        );
        // Bound lock contention so the synchronous parent barrier cannot deadlock.
        app.catalog.database.exec("PRAGMA busy_timeout=50");
        app.project.stories[0].beats[0].script.visualDirection = ${JSON.stringify(childVisualDirection)};
        await new Promise((resolve, reject) => {
          process.send({ ready: true, pid: process.pid }, (error) => error ? reject(error) : resolve());
        });
        for (const { commandPath, resultPath } of ${JSON.stringify(commands)}) {
          await new Promise((resolve) => {
            const timer = setInterval(() => {
              if (existsSync(commandPath)) {
                clearInterval(timer);
                resolve();
              }
            }, 5);
          });
          let result;
          try {
            await app.save();
            result = { pid: process.pid, status: "saved" };
          } catch (error) {
            result = { pid: process.pid, status: "rejected", code: error.code, message: error.message };
          }
          writeFileSync(resultPath + ".tmp", JSON.stringify(result));
          renameSync(resultPath + ".tmp", resultPath);
        }
        app.catalog.close();
        process.disconnect();
      `,
    ],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  let stderr = "";
  child.stderr!.on("data", (data) => {
    stderr += String(data);
  });
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Child project writer did not open: ${stderr}`)),
      10_000,
    );
    child.once("message", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Child project writer exited ${code}: ${stderr}`));
    });
  });
  let nextCommand = 0;
  return {
    save(): WriterResult {
      const { commandPath, resultPath } = commands[nextCommand++]!;
      writeFileSync(commandPath, "save");
      const deadline = Date.now() + 10_000;
      const wake = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(resultPath)) {
        if (Date.now() > deadline)
          throw new Error(`Child project writer did not finish: ${stderr}`);
        Atomics.wait(wake, 0, 0, 5);
      }
      return JSON.parse(readFileSync(resultPath, "utf8")) as WriterResult;
    },
    exited,
  };
}

describe("cross-process project writers", () => {
  it("excludes an ordinary child save between acceptance verification and publication", async () => {
    const context = await fixture();
    const { app, projectPath } = context;
    const after = "We reached the harbour at dawn.";
    app.knowledge.registerLanguageProvider({
      id: "project-writer-race-language",
      name: "Deterministic project writer fixture",
      kind: "language",
      execution: "local",
      dataKinds: ["text"],
      generate: async () =>
        JSON.stringify({
          suggestions: [
            { beatId: "beat", field: "narration", after, reason: "Fixture" },
          ],
        }),
    });
    expect(
      (
        await app.runSceneScriptReview("story", {
          beatId: "beat",
          field: "narration",
        })
      ).status,
    ).toBe("completed");
    const suggestion = app.sceneScriptReview.list("story", {}).suggestions[0]!;
    const child = await writer(context);
    let childResult: WriterResult | undefined;
    // Synchronize only: persistence, database locking, and both writers stay real.
    // publish(next) reaches saveSync after the acceptance's final saved() check.
    const persistence = app as unknown as { saveSync(): void };
    const saveSync = persistence.saveSync.bind(app);
    vi.spyOn(persistence, "saveSync").mockImplementationOnce(() => {
      childResult = child.save();
      saveSync();
    });
    app.sceneScriptReview.accept(suggestion.id, {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "cross-process-acceptance",
    });
    await child.exited;

    expect(childResult?.pid).not.toBe(process.pid);
    expect(childResult?.status).toBe("rejected");
    expect(childResult?.code).toBe("jobs.busy");
    const disk = JSON.parse(await readFile(projectPath, "utf8"));
    expect(disk.stories[0].beats[0].script).toEqual({
      narration: after,
      visualDirection,
    });
    expect(disk.sceneScriptReviewReceipts).toEqual([
      expect.objectContaining({
        suggestionId: suggestion.id,
        requestId: "cross-process-acceptance",
      }),
    ]);
    expect(app.sceneScriptReview.list("story", {}).suggestions[0]?.status).toBe(
      "accepted",
    );
  });

  it("rejects a stale ordinary save and preserves the newer child write on close", async () => {
    const context = await fixture();
    const child = await writer(context);
    expect(child.save().status).toBe("saved");
    await child.exited;
    const newerBytes = await readFile(context.projectPath, "utf8");
    context.app.project.stories[0]!.title = "Unsaved stale title";

    await expect(context.app.save()).rejects.toMatchObject({
      code: "story.planConflict",
    });
    expect(await readFile(context.projectPath, "utf8")).toBe(newerBytes);
    expect(() => context.app.close()).not.toThrow();
    expect(await readFile(context.projectPath, "utf8")).toBe(newerBytes);
  });

  it("preserves a newer child write when a stale opener closes without saving first", async () => {
    const context = await fixture();
    const child = await writer(context);
    expect(child.save().status).toBe("saved");
    await child.exited;
    const newerBytes = await readFile(context.projectPath, "utf8");

    expect(() => context.app.close()).not.toThrow();
    expect(await readFile(context.projectPath, "utf8")).toBe(newerBytes);
  });

  it("allows the same child writer to retry its draft after temporary lock contention", async () => {
    const context = await fixture();
    const child = await writer(context, 2);
    const originalBytes = await readFile(context.projectPath, "utf8");
    const blocked = context.app.catalog.withProjectWrite(() => child.save());
    expect(blocked).toMatchObject({ status: "rejected", code: "jobs.busy" });
    expect(await readFile(context.projectPath, "utf8")).toBe(originalBytes);

    expect(child.save()).toEqual({ pid: blocked.pid, status: "saved" });
    await child.exited;
    const disk = JSON.parse(await readFile(context.projectPath, "utf8"));
    expect(disk.stories[0].beats[0].script).toEqual({
      narration,
      visualDirection: childVisualDirection,
    });
  });

  it("preserves a published manifest after a transaction commit failure restores old application memory", async () => {
    const { app, projectPath } = await fixture();
    const database = Reflect.get(app.catalog, "database") as DatabaseSync;
    const exec = database.exec.bind(database);
    let failCommit = true;
    vi.spyOn(database, "exec").mockImplementation((sql) => {
      if (sql === "COMMIT" && failCommit) {
        failCommit = false;
        throw new Error("Injected manifest transaction commit failure");
      }
      exec(sql);
    });

    expect(() => app.updateFilm({ projectContentLocale: "ja-JP" })).toThrow(
      "Injected manifest transaction commit failure",
    );
    const publishedBytes = await readFile(projectPath, "utf8");
    expect(JSON.parse(publishedBytes).projectContentLocale).toBe("ja-JP");
    expect(app.project.projectContentLocale).not.toBe("ja-JP");
    expect(database.isTransaction).toBe(false);

    await expect(app.save()).rejects.toMatchObject({
      code: "story.planConflict",
    });
    expect(await readFile(projectPath, "utf8")).toBe(publishedBytes);
    expect(() => app.close()).not.toThrow();
    expect(await readFile(projectPath, "utf8")).toBe(publishedBytes);
  });
});
