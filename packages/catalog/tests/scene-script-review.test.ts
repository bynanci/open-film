import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Job, type SceneScriptReviewSuggestion } from "@openfilm/core";
import { CATALOG_SCHEMA_VERSION, ProjectCatalog } from "../src/index.js";
import { dropCatalogV6Tables } from "./catalog-version-fixtures.js";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-script-review-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let catalog: ProjectCatalog | undefined = new ProjectCatalog(directory);
  cleanup.push(() => catalog?.close());
  return {
    directory,
    get catalog() {
      return catalog!;
    },
    close() {
      catalog?.close();
      catalog = undefined;
    },
    reopen() {
      catalog?.close();
      catalog = new ProjectCatalog(directory);
      return catalog;
    },
  };
}
function suggestion(
  patch: Partial<SceneScriptReviewSuggestion> = {},
): SceneScriptReviewSuggestion {
  return {
    id: "suggestion",
    kind: "scene-script",
    target: { storyId: "story", beatId: "beat", field: "narration" },
    sourceRevisionId: "base",
    before: "Original",
    after: "Improved",
    reason: "More concrete",
    source: { type: "provider", id: "language" },
    status: "pending",
    createdAt: "2026-10-16T00:00:00Z",
    ...patch,
  };
}
const accepted = {
  status: "accepted" as const,
  acceptedAt: "2026-10-16T00:00:01Z",
  acceptedRevisionId: "accepted",
  requestId: "request",
};

describe("durable Story script review", () => {
  it("creates fresh pending evidence after an obsolete source is restored and explicitly reviewed again", async () => {
    const f = await fixture(),
      store = f.catalog.knowledge;
    const original = store.saveSceneScriptSuggestion(suggestion());
    store.staleSceneScriptSuggestions(
      "story",
      "beat",
      "narration",
      "edited-source",
    );
    const stale = store.getSceneScriptSuggestion(original.id)!;
    expect(stale.status).toBe("stale");
    // Restoring context and reading history never revives obsolete evidence.
    store.staleSceneScriptSuggestions("story", "beat", "narration", "base");
    expect(
      store.sceneScriptSuggestionsList("story", { status: "pending" }).total,
    ).toBe(0);
    const regenerated = store.saveSceneScriptSuggestion(
      suggestion({ id: "regenerated", createdAt: "2026-10-16T00:00:02Z" }),
    );
    expect(regenerated).toMatchObject({
      id: "regenerated",
      status: "pending",
      sourceRevisionId: "base",
    });
    expect(store.getSceneScriptSuggestion(original.id)).toEqual(stale);
    expect(
      f
        .reopen()
        .knowledge.sceneScriptSuggestionsList("story", { status: "pending" })
        .suggestions,
    ).toEqual([regenerated]);
    expect(
      f.catalog.knowledge.saveSceneScriptSuggestion(
        suggestion({ id: "retry" }),
      ),
    ).toEqual(regenerated);
    f.catalog.knowledge.staleSceneScriptSuggestions(
      "story",
      "beat",
      "narration",
      "another-edit",
    );
    f.catalog.knowledge.staleSceneScriptSuggestions(
      "story",
      "beat",
      "narration",
      "base",
    );
    const again = f.catalog.knowledge.saveSceneScriptSuggestion(
      suggestion({ id: "regenerated-again" }),
    );
    expect(again).toMatchObject({ id: "regenerated-again", status: "pending" });
    expect(
      f.catalog.knowledge
        .sceneScriptSuggestionsList("story", { status: "stale" })
        .suggestions.map((row) => row.id)
        .sort(),
    ).toEqual(["regenerated", "suggestion"]);
  });

  it("rolls back the dedupe slot when a regenerated ID conflicts with existing evidence", async () => {
    const f = await fixture(),
      store = f.catalog.knowledge;
    store.saveSceneScriptSuggestion(suggestion());
    store.saveSceneScriptSuggestion(
      suggestion({ id: "occupied", after: "Different suggestion" }),
    );
    store.staleSceneScriptSuggestions(
      "story",
      "beat",
      "narration",
      "edited-source",
    );
    const database = new DatabaseSync(join(f.directory, "database.sqlite"));
    try {
      const before = database
        .prepare(
          "SELECT id,dedupe_key,status,data FROM scene_script_suggestions ORDER BY id",
        )
        .all();
      expect(() =>
        store.saveSceneScriptSuggestion(suggestion({ id: "occupied" })),
      ).toThrow();
      expect(
        database
          .prepare(
            "SELECT id,dedupe_key,status,data FROM scene_script_suggestions ORDER BY id",
          )
          .all(),
      ).toEqual(before);
    } finally {
      database.close();
    }
    expect(
      store.saveSceneScriptSuggestion(suggestion({ id: "regenerated" })),
    ).toMatchObject({ id: "regenerated", status: "pending" });
  });

  it.each(["accepted", "skipped"] as const)(
    "preserves a %s decision on regenerated evidence without deduplicating against an older stale ID",
    async (status) => {
      const f = await fixture(),
        store = f.catalog.knowledge;
      store.saveSceneScriptSuggestion(suggestion());
      store.staleSceneScriptSuggestions(
        "story",
        "beat",
        "narration",
        "edited-source",
      );
      const regenerated = store.saveSceneScriptSuggestion(
        suggestion({ id: "regenerated" }),
      );
      expect(regenerated.id).toBe("regenerated");
      const reviewed = store.updateSceneScriptSuggestion(
        regenerated.id,
        status === "accepted" ? accepted : { status },
      );
      store.updateSceneScriptSuggestion("suggestion", { status: "skipped" });
      expect(
        store.saveSceneScriptSuggestion(suggestion({ id: "retry" })),
      ).toEqual(reviewed);
      expect(store.sceneScriptSuggestionsList("story").total).toBe(2);
    },
  );

  it("publishes one pending regeneration across concurrent processes while old stale IDs retain their lifecycle", async () => {
    const f = await fixture(),
      store = f.catalog.knowledge;
    store.saveSceneScriptSuggestion(suggestion());
    store.staleSceneScriptSuggestions(
      "story",
      "beat",
      "narration",
      "edited-source",
    );
    const require = createRequire(import.meta.url);
    const script = `import { ProjectCatalog } from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)};
const [directory, serialized] = process.argv.slice(1);
const catalog = new ProjectCatalog(directory);
try { process.stdout.write(JSON.stringify(catalog.knowledge.saveSceneScriptSuggestion(JSON.parse(serialized)))); }
finally { catalog.close(); }`;
    const saveInChild = (id: string) =>
      new Promise<SceneScriptReviewSuggestion>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            pathToFileURL(require.resolve("tsx")).href,
            "--input-type=module",
            "-e",
            script,
            f.directory,
            JSON.stringify(suggestion({ id })),
          ],
          { cwd: fileURLToPath(new URL("../../../", import.meta.url)) },
        );
        let output = "",
          error = "";
        const timeout = setTimeout(() => child.kill("SIGKILL"), 20000);
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          error += String(chunk);
        });
        child.once("error", reject);
        child.once("close", (code) => {
          clearTimeout(timeout);
          if (code !== 0)
            reject(new Error(`Regeneration worker exited ${code}: ${error}`));
          else {
            try {
              resolve(JSON.parse(output) as SceneScriptReviewSuggestion);
            } catch (failure) {
              reject(failure);
            }
          }
        });
      });
    const [first, second] = await Promise.all([
      saveInChild("regenerated-a"),
      saveInChild("regenerated-b"),
    ]);
    expect(first).toEqual(second);
    expect(first.status).toBe("pending");
    expect(first.id).not.toBe("suggestion");
    expect(
      store.sceneScriptSuggestionsList("story", { status: "pending" })
        .suggestions,
    ).toEqual([first]);
    expect(store.sceneScriptSuggestionsList("story").total).toBe(2);
    expect(() =>
      store.updateSceneScriptSuggestion("suggestion", accepted),
    ).toThrow();
    store.updateSceneScriptSuggestion("suggestion", { status: "skipped" });
    expect(store.getSceneScriptSuggestion(first.id)).toEqual(first);
    expect(
      store.saveSceneScriptSuggestion(suggestion({ id: "later-retry" })),
    ).toEqual(first);
  });

  it("persists evidence without assets and deduplicates retries without resetting reviewed state", async () => {
    const f = await fixture();
    const value = f.catalog.knowledge.saveSceneScriptSuggestion(suggestion());
    f.catalog.knowledge.updateSceneScriptSuggestion(value.id, accepted);
    const reopened = f.reopen().knowledge;
    expect(
      reopened.saveSceneScriptSuggestion(suggestion({ id: "retry" })),
    ).toEqual({ ...value, ...accepted });
    expect(reopened.sceneScriptSuggestionsList("story").suggestions).toEqual([
      { ...value, ...accepted },
    ]);
    expect(f.catalog.countAssets()).toBe(0);
  });

  it("paginates and filters real Story, scene and field scopes", async () => {
    const f = await fixture(),
      store = f.catalog.knowledge;
    for (const [id, beatId, field] of [
      ["a", "beat", "narration"],
      ["b", "beat", "visualDirection"],
      ["c", "second", "narration"],
    ] as const)
      store.saveSceneScriptSuggestion(
        suggestion({ id, target: { storyId: "story", beatId, field } }),
      );
    store.updateSceneScriptSuggestion("a", { status: "skipped" });
    expect(
      store.sceneScriptSuggestionsList("story", { offset: 1, limit: 1 }),
    ).toMatchObject({
      total: 3,
      offset: 1,
      limit: 1,
      suggestions: [{ id: "b" }],
    });
    expect(
      store
        .sceneScriptSuggestionsList("story", {
          beatId: "beat",
          field: "narration",
          status: "skipped",
        })
        .suggestions.map((row) => row.id),
    ).toEqual(["a"]);
    expect(() =>
      store.sceneScriptSuggestionsList("story", { limit: 101 }),
    ).toThrow();
    expect(store.sceneScriptSuggestionsList("unrelated").total).toBe(0);
  });

  it("roundtrips opaque nonblank Story IDs without SQLite UTF-8 collisions", async () => {
    const f = await fixture();
    for (const [index, id] of [
      "story\u0000\ud800",
      "story\u0000�",
      "x".repeat(300),
    ].entries()) {
      const row = suggestion({
        id: String(index),
        target: { storyId: id, beatId: id, field: "narration" },
      });
      f.catalog.knowledge.saveSceneScriptSuggestion(row);
      expect(
        f.catalog.knowledge.sceneScriptSuggestionsList(id, { beatId: id })
          .suggestions,
      ).toEqual([row]);
    }
  });

  it("marks only obsolete pending evidence for the targeted field stale", async () => {
    const f = await fixture(),
      store = f.catalog.knowledge;
    store.saveSceneScriptSuggestion(suggestion());
    store.saveSceneScriptSuggestion(
      suggestion({ id: "current", sourceRevisionId: "current" }),
    );
    store.saveSceneScriptSuggestion(
      suggestion({
        id: "visual",
        target: { storyId: "story", beatId: "beat", field: "visualDirection" },
      }),
    );
    store.staleSceneScriptSuggestions("story", "beat", "narration", "current");
    expect(store.getSceneScriptSuggestion("suggestion")?.status).toBe("stale");
    expect(store.getSceneScriptSuggestion("current")?.status).toBe("pending");
    expect(store.getSceneScriptSuggestion("visual")?.status).toBe("pending");
    expect(() =>
      store.updateSceneScriptSuggestion("suggestion", accepted),
    ).toThrow();
    expect(
      store.updateSceneScriptSuggestion("suggestion", { status: "skipped" })
        .status,
    ).toBe("skipped");
  });

  it("preserves a competing accepted lifecycle instead of overwriting it with Skip", async () => {
    const f = await fixture(),
      store = f.catalog.knowledge;
    store.saveSceneScriptSuggestion(suggestion());
    const competing = new ProjectCatalog(f.directory);
    cleanup.push(() => competing.close());
    const realRead = store.getSceneScriptSuggestion.bind(store);
    vi.spyOn(store, "getSceneScriptSuggestion").mockImplementationOnce((id) => {
      const observed = realRead(id);
      competing.knowledge.updateSceneScriptSuggestion(id, accepted);
      return observed;
    });
    expect(() =>
      store.updateSceneScriptSuggestion("suggestion", { status: "skipped" }),
    ).toThrow();
    expect(realRead("suggestion")).toMatchObject(accepted);
  });

  it("keeps accepted audit metadata immutable during a repeated lifecycle update", async () => {
    const f = await fixture(),
      store = f.catalog.knowledge;
    store.saveSceneScriptSuggestion(suggestion());
    const committed = store.updateSceneScriptSuggestion("suggestion", accepted);
    expect(store.updateSceneScriptSuggestion("suggestion", accepted)).toEqual(
      committed,
    );
    expect(() =>
      store.updateSceneScriptSuggestion("suggestion", {
        ...accepted,
        requestId: "different-request",
      }),
    ).toThrow();
    expect(store.getSceneScriptSuggestion("suggestion")).toEqual(committed);
  });

  it("rolls back callback evidence when acceptance fails", async () => {
    const f = await fixture(),
      store = f.catalog.knowledge;
    store.saveSceneScriptSuggestion(suggestion());
    expect(() =>
      store.withSceneScriptSuggestion("suggestion", (row) => {
        store.updateSceneScriptSuggestion(row.id, accepted);
        throw new Error("Project save failed");
      }),
    ).toThrow("Project save failed");
    expect(store.getSceneScriptSuggestion("suggestion")?.status).toBe(
      "pending",
    );
    expect(
      store.withSceneScriptSuggestion("suggestion", (row) =>
        store.updateSceneScriptSuggestion(row.id, accepted),
      ),
    ).toMatchObject(accepted);
  });

  it("publishes suggestions and the completed job only for its exact durable execution", async () => {
    const f = await fixture(),
      store = f.catalog.knowledge;
    const job: Job = {
      id: "job",
      type: "scene-script-review",
      storyId: "story",
      beatId: "beat",
      status: "running",
      reviewOwner: { host: "host", pid: 1, token: "owner" },
    };
    f.catalog.saveJob(job);
    store.completeSceneScriptReview(job, { ...job, status: "completed" }, [
      suggestion(),
    ]);
    expect(f.catalog.listJobs()[0]?.status).toBe("completed");
    expect(store.getSceneScriptSuggestion("suggestion")).toEqual(suggestion());
    expect(() =>
      store.completeSceneScriptReview(job, { ...job, status: "completed" }, [
        suggestion({ id: "late", after: "Late" }),
      ]),
    ).toThrow();
    expect(store.getSceneScriptSuggestion("late")).toBeUndefined();
  });

  it("cannot resurrect an already failed execution with its same owner token", async () => {
    const f = await fixture(),
      store = f.catalog.knowledge;
    const failed: Job = {
      id: "job",
      type: "scene-script-review",
      storyId: "story",
      beatId: "beat",
      status: "failed",
      reviewOwner: { host: "host", pid: 1, token: "owner" },
    };
    f.catalog.saveJob(failed);
    expect(() =>
      store.completeSceneScriptReview(
        failed,
        { ...failed, status: "completed" },
        [suggestion()],
      ),
    ).toThrow();
    expect(store.getSceneScriptSuggestion("suggestion")).toBeUndefined();
    expect(f.catalog.listJobs()[0]).toEqual(failed);
  });

  it("rolls back all evidence and Activity when any published suggestion is invalid", async () => {
    const f = await fixture(),
      store = f.catalog.knowledge;
    const running: Job = {
      id: "job",
      type: "scene-script-review",
      storyId: "story",
      beatId: "beat",
      status: "running",
      reviewOwner: { host: "host", pid: 1, token: "owner" },
    };
    f.catalog.saveJob(running);
    expect(() =>
      store.completeSceneScriptReview(
        running,
        { ...running, status: "completed" },
        [suggestion(), suggestion({ id: "invalid", after: "Original" })],
      ),
    ).toThrow();
    expect(store.sceneScriptSuggestionsList("story").total).toBe(0);
    expect(f.catalog.listJobs()[0]).toEqual(running);
  });
});

describe("v5 Story review migration", () => {
  it("upgrades v4 without rebuilding or rewriting existing transcript evidence", async () => {
    const f = await fixture();
    f.catalog.upsertAsset({
      id: "source",
      uri: "file:///source.wav",
      name: "Original source",
      mediaType: "audio",
      duration: 2,
      tags: [],
      state: {},
      metadata: { opaque: { preserve: true } },
    });
    f.catalog.intelligence.replaceTranscript({
      id: "original-transcript",
      assetId: "source",
      provenance: {
        providerId: "local",
        version: "1",
        sourceHash: "hash",
        createdAt: "2026-10-16T00:00:00Z",
      },
      segments: [
        { id: "segment\u0000\ud800", start: 0, end: 1, text: "Original words" },
      ],
    });
    const original = f.catalog.intelligence.getFullTranscript("source", "hash");
    f.close();
    const database = new DatabaseSync(join(f.directory, "database.sqlite"));
    database.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
    dropCatalogV6Tables(database);
    database.exec(
      "DROP TABLE IF EXISTS scene_script_suggestions; CREATE TRIGGER preserve_segments BEFORE DELETE ON intelligence_segments BEGIN SELECT RAISE(ABORT,'do not rewrite v4 segments'); END; PRAGMA user_version=4; COMMIT; PRAGMA foreign_keys=ON;",
    );
    const before = database
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE name='intelligence_segments'",
      )
      .get()?.sql;
    const originalBytes = database
      .prepare(
        "SELECT hex(segment_id) AS identity,hex(text) AS text,hex(data) AS data FROM intelligence_segments",
      )
      .all();
    database.close();
    const upgraded = new ProjectCatalog(f.directory);
    cleanup.push(() => upgraded.close());
    expect(CATALOG_SCHEMA_VERSION).toBe(6);
    expect(upgraded.intelligence.getFullTranscript("source", "hash")).toEqual(
      original,
    );
    upgraded.knowledge.saveSceneScriptSuggestion(suggestion());
    const read = new DatabaseSync(join(f.directory, "database.sqlite"));
    try {
      expect(read.prepare("PRAGMA user_version").get()?.user_version).toBe(6);
      expect(
        read
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE name='intelligence_segments'",
          )
          .get()?.sql,
      ).toBe(before);
      expect(
        read
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='preserve_segments'",
          )
          .get(),
      ).toBeDefined();
      expect(
        read
          .prepare(
            "SELECT hex(segment_id) AS identity,hex(text) AS text,hex(data) AS data FROM intelligence_segments",
          )
          .all(),
      ).toEqual(originalBytes);
    } finally {
      read.close();
    }
  });

  it("rolls back a failed v4 upgrade without advancing schema version", async () => {
    const f = await fixture();
    f.close();
    const database = new DatabaseSync(join(f.directory, "database.sqlite"));
    dropCatalogV6Tables(database);
    database.exec(
      "DROP TABLE IF EXISTS scene_script_suggestions; CREATE VIEW scene_script_suggestions AS SELECT 1; PRAGMA user_version=4;",
    );
    database.close();
    expect(() => new ProjectCatalog(f.directory)).toThrow();
    const read = new DatabaseSync(join(f.directory, "database.sqlite"));
    try {
      expect(read.prepare("PRAGMA user_version").get()?.user_version).toBe(4);
      expect(
        read
          .prepare(
            "SELECT type FROM sqlite_schema WHERE name='scene_script_suggestions'",
          )
          .get()?.type,
      ).toBe("view");
      expect(
        read
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='intelligence_segments_v4'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      read.close();
    }
  });
});
