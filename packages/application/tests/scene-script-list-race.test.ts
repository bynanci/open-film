import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});
const narration = "We arrived at dawn.";
const childNarration = "The boats appeared before sunrise.";
const target = { beatId: "beat", field: "narration" as const };

function register(app: OpenFilmApplication) {
  app.knowledge.registerLanguageProvider({
    id: "scene-script-list-race-language",
    name: "Deterministic list race fixture",
    kind: "language",
    execution: "local",
    dataKinds: ["text"],
    generate: async (prompt) => {
      const context = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
      return JSON.stringify({
        suggestions: [
          {
            beatId: context.beat.id,
            field: context.field,
            after: `${context.text} Revised.`,
            reason: "Deterministic fixture",
          },
        ],
      });
    },
  });
}
async function review(
  app: OpenFilmApplication,
  beatId = "beat",
  field: "narration" | "visualDirection" = "narration",
) {
  expect(
    (await app.runSceneScriptReview("story", { beatId, field })).status,
  ).toBe("completed");
  return app.catalog.knowledge.sceneScriptSuggestionsList("story", {
    beatId,
    field,
  }).suggestions[0]!;
}
function database(app: OpenFilmApplication) {
  return Reflect.get(app.catalog, "database") as DatabaseSync;
}
async function openOther(context: Awaited<ReturnType<typeof fixture>>) {
  const app = await OpenFilmApplication.open(
    context.app.directory,
    context.runtime,
  );
  cleanup.push(() => app.catalog.close());
  return app;
}
async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-scene-script-list-race-"),
  );
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = { userDataDirectory: join(root, "user-data") };
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Script list race",
    {},
    runtime,
  );
  cleanup.push(() => {
    try {
      app.catalog.close();
    } catch {
      /* Already closed by a test. */
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
        script: { narration, visualDirection: "Open on the quiet harbour." },
        candidateAssetIds: [],
      },
    ],
  });
  await app.save();
  register(app);
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
  suggestionId?: string;
}
/** Open the real child before the parent reaches its synchronous barrier. */
async function writer(context: Awaited<ReturnType<typeof fixture>>) {
  const commandPath = join(context.root, "review-command");
  const resultPath = join(context.root, "review-result.json");
  const child = spawn(
    process.execPath,
    [
      "--import",
      createRequire(import.meta.url).resolve("tsx"),
      "--input-type=module",
      "--eval",
      `
      import { existsSync, renameSync, writeFileSync } from "node:fs";
      import { OpenFilmApplication } from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)};
      const app = await OpenFilmApplication.open(${JSON.stringify(context.app.directory)}, ${JSON.stringify(context.runtime)});
      app.catalog.database.exec("PRAGMA busy_timeout=50");
      app.knowledge.registerLanguageProvider({
        id: "child-scene-script-list-race", name: "Deterministic child list race fixture",
        kind: "language", execution: "local", dataKinds: ["text"],
        generate: async () => JSON.stringify({ suggestions: [{
          beatId: "beat", field: "narration", after: "The harbour boats appeared at dawn.", reason: "Child fixture",
        }] }),
      });
      app.project.stories[0].beats[0].script.narration = ${JSON.stringify(childNarration)};
      await new Promise((resolve, reject) => process.send({ ready: true }, error => error ? reject(error) : resolve()));
      await new Promise(resolve => {
        const timer = setInterval(() => {
          if (existsSync(${JSON.stringify(commandPath)})) { clearInterval(timer); resolve(); }
        }, 5);
      });
      let result;
      try {
        await app.save();
        const job = await app.runSceneScriptReview("story", { beatId: "beat", field: "narration" });
        if (job.status !== "completed") throw new Error("Child review did not complete: " + JSON.stringify(job));
        const suggestion = app.catalog.knowledge.sceneScriptSuggestionsList("story", { beatId: "beat", field: "narration" }).suggestions[0];
        result = { pid: process.pid, status: "saved", suggestionId: suggestion.id };
      } catch (error) {
        result = { pid: process.pid, status: "rejected", code: error.code, message: error.message };
      }
      writeFileSync(${JSON.stringify(resultPath)} + ".tmp", JSON.stringify(result));
      renameSync(${JSON.stringify(resultPath)} + ".tmp", ${JSON.stringify(resultPath)});
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
      () => reject(new Error(`Child did not open: ${stderr}`)),
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
      reject(new Error(`Child exited ${code}: ${stderr}`));
    });
  });
  return {
    review(): WriterResult {
      writeFileSync(commandPath, "review");
      const deadline = Date.now() + 10_000;
      const wake = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(resultPath)) {
        if (Date.now() > deadline)
          throw new Error(`Child did not review: ${stderr}`);
        Atomics.wait(wake, 0, 0, 5);
      }
      return JSON.parse(readFileSync(resultPath, "utf8")) as WriterResult;
    },
    exited,
  };
}

describe("scene script list writer serialization", () => {
  it.each(["scoped", "history"] as const)(
    "protects a fresh child suggestion from an obsolete %s poll",
    async (scope) => {
      const context = await fixture();
      const child = await writer(context);
      const service = context.app.sceneScriptReview as unknown as {
        saved(): void;
      };
      const saved = service.saved.bind(service);
      let result: WriterResult | undefined;
      // Synchronization only: the child uses real save/review/catalog operations.
      vi.spyOn(service, "saved").mockImplementationOnce(() => {
        saved();
        result = child.review();
      });
      context.app.sceneScriptReview.list(
        "story",
        scope === "scoped" ? target : {},
      );
      await child.exited;
      expect(result?.pid).not.toBe(process.pid);
      if (result?.status === "saved") {
        expect(
          context.app.catalog.knowledge.getSceneScriptSuggestion(
            result.suggestionId!,
          )?.status,
        ).toBe("pending");
      }
      expect(result).toMatchObject({ status: "rejected", code: "jobs.busy" });
      const disk = JSON.parse(await readFile(context.projectPath, "utf8"));
      expect(disk.stories[0].beats[0].script.narration).toBe(narration);
    },
  );

  it.each(["scoped", "history"] as const)(
    "preserves a successful child's pending evidence when an already obsolete parent lists %s",
    async (scope) => {
      const context = await fixture();
      const child = await writer(context);
      const result = child.review();
      await child.exited;
      expect(result).toMatchObject({
        status: "saved",
        suggestionId: expect.any(String),
      });
      const bytes = await readFile(context.projectPath, "utf8");
      const fresh = context.app.catalog.knowledge.getSceneScriptSuggestion(
        result.suggestionId!,
      )!;
      expect(fresh).toMatchObject({
        status: "pending",
        before: childNarration,
      });
      expect(context.app.project.stories[0]!.beats[0]!.script!.narration).toBe(
        narration,
      );

      const page = context.app.sceneScriptReview.list(
        "story",
        scope === "scoped" ? target : {},
      );
      expect(page.suggestions).toEqual([fresh]);
      expect(
        context.app.catalog.knowledge.getSceneScriptSuggestion(fresh.id),
      ).toEqual(fresh);
      expect(await readFile(context.projectPath, "utf8")).toBe(bytes);
    },
  );

  it("reports temporary list lock contention as retryable and preserves the same app's ability to save", async () => {
    const context = await fixture();
    const suggestion = await review(context.app);
    const other = await openOther(context);
    database(context.app).exec("PRAGMA busy_timeout=50");
    const before = await readFile(context.projectPath, "utf8");
    other.catalog.withProjectWrite(() => {
      expect(() =>
        context.app.sceneScriptReview.list("story", target),
      ).toThrowError(
        expect.objectContaining({ code: "jobs.busy", status: 409 }),
      );
    });
    expect(database(context.app).isTransaction).toBe(false);
    expect(await readFile(context.projectPath, "utf8")).toBe(before);
    expect(
      context.app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id)
        ?.status,
    ).toBe("pending");
    expect(
      context.app.sceneScriptReview.list("story", target).suggestions[0]
        ?.status,
    ).toBe("pending");
    context.app.project.stories[0]!.beats[0]!.script!.narration =
      "A manual draft after temporary contention.";
    await expect(context.app.save()).resolves.toBeUndefined();
    expect(
      JSON.parse(await readFile(context.projectPath, "utf8")).stories[0]
        .beats[0].script.narration,
    ).toBe("A manual draft after temporary contention.");
  });

  it("keeps exact pagination bounded and stales only the selected saved field", async () => {
    const { app } = await fixture();
    app.project.stories[0]!.beats.push({
      id: "other-beat",
      title: "Later",
      targetDuration: 6,
      script: {
        narration: "We sailed away.",
        visualDirection: "Wide shot of the sea.",
      },
      candidateAssetIds: [],
    });
    await app.save();
    const first = await review(app);
    const second = app.catalog.knowledge.saveSceneScriptSuggestion({
      ...first,
      id: "second-narration-suggestion",
      after: `${first.after} Another option.`,
    });
    const narrationRows = [first, second];
    const visual = await review(app, "beat", "visualDirection");
    const other = await review(app, "other-beat");
    app.project.stories[0]!.beats[0]!.script!.narration =
      "We arrived on the next morning.";
    await app.save();
    const pageRead = vi.spyOn(
      app.catalog.knowledge,
      "sceneScriptSuggestionsList",
    );
    const staleUpdate = vi.spyOn(
      app.catalog.knowledge,
      "staleSceneScriptSuggestions",
    );

    const page = app.sceneScriptReview.list("story", {
      ...target,
      offset: 1,
      limit: 1,
    });
    expect(page.total).toBe(2);
    expect(page.suggestions).toHaveLength(1);
    expect(page.suggestions[0]?.status).toBe("stale");
    expect(pageRead).toHaveBeenCalledOnce();
    expect(staleUpdate).toHaveBeenCalledExactlyOnceWith(
      "story",
      "beat",
      "narration",
      page.revision,
    );
    for (const row of narrationRows)
      expect(
        app.catalog.knowledge.getSceneScriptSuggestion(row.id)?.status,
      ).toBe("stale");
    for (const row of [visual, other])
      expect(
        app.catalog.knowledge.getSceneScriptSuggestion(row.id)?.status,
      ).toBe("pending");
  });

  it.each(["scoped", "history"] as const)(
    "keeps pending evidence inspectable from an unsaved local draft in %s",
    async (scope) => {
      const context = await fixture();
      const suggestion = await review(context.app);
      const bytes = await readFile(context.projectPath, "utf8");
      context.app.project.stories[0]!.beats[0]!.script!.narration =
        "An unsaved local draft.";

      expect(
        context.app.sceneScriptReview.list(
          "story",
          scope === "scoped" ? target : {},
        ).suggestions,
      ).toEqual([suggestion]);
      expect(
        context.app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id),
      ).toEqual(suggestion);
      expect(await readFile(context.projectPath, "utf8")).toBe(bytes);
      await expect(context.app.save()).resolves.toBeUndefined();
    },
  );

  it.each(["malformed", "missing"] as const)(
    "keeps evidence inspectable without changing pending lifecycle when disk is %s",
    async (state) => {
      const context = await fixture();
      const suggestion = await review(context.app);
      if (state === "malformed")
        await writeFile(
          context.projectPath,
          "{ external incomplete JSON",
          "utf8",
        );
      else await rm(context.projectPath);
      const staleUpdate = vi.spyOn(
        context.app.catalog.knowledge,
        "staleSceneScriptSuggestions",
      );
      const receiptUpdate = vi.spyOn(
        context.app.catalog.knowledge,
        "updateSceneScriptSuggestion",
      );
      for (const options of [target, {}]) {
        expect(
          context.app.sceneScriptReview.list("story", options).suggestions,
        ).toEqual([suggestion]);
      }
      expect(
        context.app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id),
      ).toEqual(suggestion);
      expect(staleUpdate).not.toHaveBeenCalled();
      expect(receiptUpdate).not.toHaveBeenCalled();
      if (state === "malformed")
        expect(await readFile(context.projectPath, "utf8")).toBe(
          "{ external incomplete JSON",
        );
      else expect(existsSync(context.projectPath)).toBe(false);
    },
  );

  it("recognizes a child's fresh saved suggestion after reopening", async () => {
    const context = await fixture();
    const child = await writer(context);
    const result = child.review();
    await child.exited;
    expect(result.status).toBe("saved");
    const reopened = await openOther(context);
    const page = reopened.sceneScriptReview.list("story", target);
    expect(page.suggestions).toHaveLength(1);
    expect(page.suggestions[0]).toMatchObject({
      id: result.suggestionId,
      status: "pending",
      before: childNarration,
      sourceRevisionId: page.revision,
    });
    expect(
      reopened.sceneScriptReview.list("story", {}).suggestions[0]?.status,
    ).toBe("pending");
  });

  it("retries receipt reconciliation after a later list failure rolls back its audit update", async () => {
    const context = await fixture();
    const { app } = context;
    const suggestion = await review(app);
    const input = {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "list-rollback-receipt",
    };
    vi.spyOn(
      app.catalog.knowledge,
      "updateSceneScriptSuggestion",
    ).mockImplementationOnce(() => {
      throw new Error("Injected acceptance audit write failure");
    });
    expect(() => app.sceneScriptReview.accept(suggestion.id, input)).toThrow(
      "Injected acceptance audit write failure",
    );
    const published = await readFile(context.projectPath, "utf8");
    const disk = JSON.parse(published);
    const receipt = disk.sceneScriptReviewReceipts[0];
    expect(disk.stories[0].beats[0].script.narration).toBe(suggestion.after);
    expect(receipt).toMatchObject({
      suggestionId: suggestion.id,
      requestId: input.requestId,
    });
    expect(
      app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id)?.status,
    ).toBe("pending");
    const update = vi.spyOn(
      app.catalog.knowledge,
      "updateSceneScriptSuggestion",
    );
    update.mockClear();
    vi.spyOn(
      app.catalog.knowledge,
      "staleSceneScriptSuggestions",
    ).mockImplementationOnce(() => {
      expect(
        app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id)?.status,
      ).toBe("accepted");
      throw new Error("Injected failure after receipt reconciliation");
    });

    expect(() => app.sceneScriptReview.list("story", target)).toThrow(
      "Injected failure after receipt reconciliation",
    );
    expect(update).toHaveBeenCalledWith(
      suggestion.id,
      expect.objectContaining({ status: "accepted" }),
    );
    expect(database(app).isTransaction).toBe(false);
    expect(
      app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id)?.status,
    ).toBe("pending");
    const page = app.sceneScriptReview.list("story", target);
    expect(page.suggestions[0]).toMatchObject({
      id: suggestion.id,
      status: "accepted",
      requestId: receipt.requestId,
      acceptedAt: receipt.acceptedAt,
      acceptedRevisionId: receipt.acceptedRevisionId,
    });
    expect(app.sceneScriptReview.list("story", {}).suggestions[0]?.status).toBe(
      "accepted",
    );
    expect(
      app.sceneScriptReview.accept(suggestion.id, input).beats[0]?.script
        ?.narration,
    ).toBe(suggestion.after);
    expect(await readFile(context.projectPath, "utf8")).toBe(published);
  });

  it("retries receipt reconciliation after its caller rolls back an existing writer transaction", async () => {
    const context = await fixture();
    const { app } = context;
    const suggestion = await review(app);
    const input = {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "caller-rollback-receipt",
    };
    vi.spyOn(
      app.catalog.knowledge,
      "updateSceneScriptSuggestion",
    ).mockImplementationOnce(() => {
      throw new Error("Injected acceptance audit write failure");
    });
    expect(() => app.sceneScriptReview.accept(suggestion.id, input)).toThrow(
      "Injected acceptance audit write failure",
    );
    const published = await readFile(context.projectPath, "utf8");
    const receipt = JSON.parse(published).sceneScriptReviewReceipts[0];
    expect(
      app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id)?.status,
    ).toBe("pending");

    expect(() =>
      app.catalog.withProjectWrite(() => {
        expect(
          app.sceneScriptReview.list("story", {}).suggestions[0]?.status,
        ).toBe("accepted");
        expect(database(app).isTransaction).toBe(true);
        throw new Error("Injected caller rollback after list");
      }),
    ).toThrow("Injected caller rollback after list");
    expect(database(app).isTransaction).toBe(false);
    expect(
      app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id)?.status,
    ).toBe("pending");
    expect(
      app.sceneScriptReview.list("story", {}).suggestions[0],
    ).toMatchObject({
      id: suggestion.id,
      status: "accepted",
      requestId: receipt.requestId,
      acceptedAt: receipt.acceptedAt,
      acceptedRevisionId: receipt.acceptedRevisionId,
    });
    expect(
      app.sceneScriptReview.list("story", target).suggestions[0]?.status,
    ).toBe("accepted");
    expect(await readFile(context.projectPath, "utf8")).toBe(published);
  });
});
