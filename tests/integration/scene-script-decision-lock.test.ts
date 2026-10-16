import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { CatalogKnowledgeStore } from "@openfilm/catalog";
import type {
  Job,
  OpenFilmProject,
  SceneScriptReviewSuggestion,
} from "@openfilm/core";
import type { LanguageProvider } from "@openfilm/plugin-sdk";
import { startServer } from "../../apps/server/src/server.js";

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const storyId = "story # lock";
const beatId = "beat / lock";
const narration = "We arrived at dawn.";
const revisedNarration = "We arrived at dawn. Reviewed.";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-script-decision-http-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "film.openfilm");
  const runtimeOptions = { userDataDirectory: join(root, "user-data") };
  const app = await OpenFilmApplication.create(
    directory,
    "Script decision contention",
    {},
    runtimeOptions,
  );
  app.project.stories.push({
    id: storyId,
    title: "Our journey",
    targetDuration: 12,
    maxDuration: 15,
    beats: [
      {
        id: beatId,
        title: "Arriving",
        targetDuration: 6,
        script: { narration, visualDirection: "Open on the quiet harbour." },
      },
    ],
  });
  await app.save();
  app.close({ requireSave: true });
  const provider: LanguageProvider = {
    id: "scene-script-decision-http-provider",
    name: "Deterministic decision fixture",
    kind: "language",
    execution: "local",
    dataKinds: ["text"],
    generate: async () =>
      JSON.stringify({
        suggestions: [
          {
            beatId,
            field: "narration",
            after: revisedNarration,
            reason: "Deterministic HTTP decision fixture.",
          },
        ],
      }),
  };
  const runtime = await startServer({
    port: 0,
    project: directory,
    ...runtimeOptions,
    languageProvider: provider,
  });
  cleanups.push(() => runtime.close());
  const request = (path: string, data?: unknown, method?: string) =>
    fetch(`http://127.0.0.1:${runtime.port}/api${path}`, {
      method: method ?? (data === undefined ? "GET" : "POST"),
      ...(data === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          }),
    });
  const route = `/stories/${encodeURIComponent(storyId)}/script-review`;
  const started = await request(route, { beatId, field: "narration" });
  expect(started.status).toBe(202);
  const { job } = (await started.json()) as { job: Job };
  let completed = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const jobsResponse = await request("/jobs");
    expect(jobsResponse.status).toBe(200);
    const { jobs } = (await jobsResponse.json()) as { jobs: Job[] };
    const current = jobs.find((item) => item.id === job.id);
    expect(current).toBeDefined();
    if (current?.status === "completed") {
      completed = true;
      break;
    }
    expect(["failed", "cancelled"]).not.toContain(current?.status);
    await delay(20);
  }
  expect(completed).toBe(true);
  const query = new URLSearchParams({ beatId, field: "narration" });
  const listed = await request(`${route}/suggestions?${query}`);
  expect(listed.status).toBe(200);
  const state = (await listed.json()) as {
    revision: string;
    suggestions: SceneScriptReviewSuggestion[];
  };
  expect(state.suggestions).toHaveLength(1);
  const suggestion = state.suggestions[0]!;
  expect(suggestion.status).toBe("pending");
  const database = new DatabaseSync(join(directory, "database.sqlite"));
  cleanups.push(() => database.close());
  const manifest = () => readFile(join(directory, "project.json"), "utf8");
  const project = async () => JSON.parse(await manifest()) as OpenFilmProject;
  const audit = () => ({
    suggestions: database
      .prepare("SELECT * FROM scene_script_suggestions ORDER BY id")
      .all(),
    jobs: database.prepare("SELECT * FROM jobs ORDER BY id").all(),
  });
  return {
    request,
    database,
    manifest,
    project,
    audit,
    suggestion,
    receipt: {
      baseRevision: state.revision,
      requestId: "same-exact-http-acceptance-request",
    },
  };
}

describe("scene-script decision HTTP retry errors", () => {
  it.each(["accept", "skip"] as const)(
    "returns jobs.busy for a contended %s without changing evidence and succeeds on retry",
    async (decision) => {
      const context = await fixture();
      const beforeManifest = await context.manifest();
      const beforeAudit = context.audit();
      const path = `/script-review/suggestions/${encodeURIComponent(context.suggestion.id)}/${decision}`;
      const body = decision === "accept" ? context.receipt : {};

      // Use an independent real SQLite connection; the server keeps its normal
      // 5000 ms busy timeout and must classify the resulting SQLITE_BUSY.
      context.database.exec("BEGIN IMMEDIATE");
      try {
        const blocked = await context.request(path, body);
        expect.soft(blocked.status).toBe(409);
        expect.soft(await blocked.json()).toMatchObject({ code: "jobs.busy" });
        expect(await context.manifest()).toBe(beforeManifest);
        expect(context.audit()).toEqual(beforeAudit);
      } finally {
        context.database.exec("ROLLBACK");
      }

      const retried = await context.request(path, body);
      expect(retried.status).toBe(200);
      const retriedBody = await retried.json();
      if (decision === "accept") {
        expect(retriedBody.story.beats[0].script.narration).toBe(
          revisedNarration,
        );
        expect((await context.project()).sceneScriptReviewReceipts).toEqual([
          expect.objectContaining({
            suggestionId: context.suggestion.id,
            requestId: context.receipt.requestId,
          }),
        ]);
      } else {
        expect(retriedBody.suggestion.status).toBe("skipped");
        expect(await context.manifest()).toBe(beforeManifest);
      }
      const published = await context.manifest();
      const decidedAudit = context.audit();
      expect(decidedAudit.jobs).toEqual(beforeAudit.jobs);
      expect(decidedAudit.suggestions).toHaveLength(1);
      expect(
        JSON.parse(String(decidedAudit.suggestions[0]!.data)),
      ).toMatchObject({
        ...context.suggestion,
        status: decision === "accept" ? "accepted" : "skipped",
      });

      const duplicate = await context.request(path, body);
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toEqual(retriedBody);
      expect(await context.manifest()).toBe(published);
      expect(context.audit()).toEqual(decidedAudit);
    },
  );

  it("returns a neutral server error after publication and recovers the exact acceptance receipt once", async () => {
    const context = await fixture();
    const beforeAudit = context.audit();
    const path = `/script-review/suggestions/${encodeURIComponent(context.suggestion.id)}/accept`;
    const update = vi
      .spyOn(CatalogKnowledgeStore.prototype, "updateSceneScriptSuggestion")
      .mockImplementationOnce(() => {
        throw new Error("Injected HTTP audit failure after publication");
      });

    const interrupted = await context.request(path, context.receipt);
    expect.soft(interrupted.status).toBe(500);
    expect
      .soft(await interrupted.json())
      .toMatchObject({ code: "operation.failed" });
    expect(update).toHaveBeenCalledTimes(1);
    update.mockRestore();
    const published = await context.manifest();
    const project = await context.project();
    expect(project.stories[0]!.beats[0]!.script?.narration).toBe(
      revisedNarration,
    );
    expect(project.sceneScriptReviewReceipts).toEqual([
      expect.objectContaining({
        suggestionId: context.suggestion.id,
        requestId: context.receipt.requestId,
      }),
    ]);
    expect(context.audit()).toEqual(beforeAudit);

    const beats = structuredClone(project.stories[0]!.beats);
    beats[0]!.script!.narration = "We later remembered the boats arriving.";
    const edited = await context.request(
      `/stories/${encodeURIComponent(storyId)}`,
      { beats },
      "PATCH",
    );
    expect(edited.status).toBe(200);
    const editedStory = (await edited.json()).story;
    expect(editedStory.beats[0].script.narration).toBe(
      beats[0]!.script!.narration,
    );
    expect((await context.project()).sceneScriptReviewReceipts).toEqual(
      project.sceneScriptReviewReceipts,
    );
    const afterManualEdit = await context.manifest();
    expect(afterManualEdit).not.toBe(published);

    const recovered = await context.request(path, context.receipt);
    expect(recovered.status).toBe(200);
    const recoveredBody = await recovered.json();
    expect(recoveredBody.story).toEqual(editedStory);
    expect(await context.manifest()).toBe(afterManualEdit);
    const acceptedAudit = context.audit();
    expect(acceptedAudit.jobs).toEqual(beforeAudit.jobs);
    expect(acceptedAudit.suggestions).toHaveLength(1);
    expect(
      JSON.parse(String(acceptedAudit.suggestions[0]!.data)),
    ).toMatchObject({
      ...context.suggestion,
      status: "accepted",
      requestId: context.receipt.requestId,
      acceptedAt: project.sceneScriptReviewReceipts![0]!.acceptedAt,
      acceptedRevisionId:
        project.sceneScriptReviewReceipts![0]!.acceptedRevisionId,
    });

    const repeated = await context.request(path, context.receipt);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(recoveredBody);
    expect(await context.manifest()).toBe(afterManualEdit);
    expect(context.audit()).toEqual(acceptedAudit);
  });

  it("keeps invalid request and genuine stale-revision errors distinct without changing evidence", async () => {
    const context = await fixture();
    const beforeManifest = await context.manifest();
    const beforeAudit = context.audit();
    const path = `/script-review/suggestions/${encodeURIComponent(context.suggestion.id)}/accept`;

    const invalid = await context.request(path, {
      ...context.receipt,
      requestId: "",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "request.invalid" });
    expect(await context.manifest()).toBe(beforeManifest);
    expect(context.audit()).toEqual(beforeAudit);

    const stale = await context.request(path, {
      ...context.receipt,
      baseRevision: "a-different-source-revision",
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "review.suggestionStale",
    });
    expect(await context.manifest()).toBe(beforeManifest);
    expect(context.audit()).toEqual(beforeAudit);
  });
});
