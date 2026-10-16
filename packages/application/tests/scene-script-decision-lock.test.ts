import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ApplicationError, type OpenFilmProject } from "@openfilm/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

const target = { beatId: "beat", field: "narration" as const };
const narration = "We arrived at dawn.";
const revisedNarration = "We reached the harbour at dawn.";

function database(app: OpenFilmApplication) {
  return Reflect.get(app.catalog, "database") as DatabaseSync;
}

async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-scene-script-decision-lock-"),
  );
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = { userDataDirectory: join(root, "user-data") };
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Script decision lock",
    {},
    runtime,
  );
  cleanup.push(() => app.catalog.close());
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
        script: {
          narration,
          visualDirection: "Open on the quiet harbour.",
        },
        candidateAssetIds: [],
      },
    ],
  });
  await app.save();
  app.knowledge.registerLanguageProvider({
    id: "scene-script-decision-lock-language",
    name: "Deterministic decision lock fixture",
    kind: "language",
    execution: "local",
    dataKinds: ["text"],
    generate: async () =>
      JSON.stringify({
        suggestions: [
          {
            ...target,
            after: revisedNarration,
            reason: "Deterministic fixture",
          },
        ],
      }),
  });
  expect((await app.runSceneScriptReview("story", target)).status).toBe(
    "completed",
  );
  const suggestion = app.catalog.knowledge.sceneScriptSuggestionsList(
    "story",
    target,
  ).suggestions[0]!;
  const other = await OpenFilmApplication.open(app.directory, runtime);
  cleanup.push(() => other.catalog.close());
  database(app).exec("PRAGMA busy_timeout=50");
  return {
    app,
    other,
    suggestion,
    projectPath: join(app.directory, "project.json"),
    input: {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "same-decision-lock-acceptance",
    },
  };
}

async function snapshot(context: Awaited<ReturnType<typeof fixture>>) {
  return {
    project: structuredClone(context.app.project),
    bytes: await readFile(context.projectPath, "utf8"),
    evidence: context.app.catalog.knowledge.sceneScriptSuggestionsList(
      "story",
      {},
    ),
    jobs: context.app.catalog.listJobs(),
  };
}

function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("The decision unexpectedly succeeded.");
}

function expectApplicationError(error: unknown, code: string, status: number) {
  expect(error).toBeInstanceOf(ApplicationError);
  expect(error).toMatchObject({ code, status });
}

function expectUnexpectedError(error: unknown, technicalDetail: string) {
  expectApplicationError(error, "operation.failed", 500);
  expect(error).toMatchObject({ detail: technicalDetail });
}

describe("scene script decision writer contention", () => {
  it("reports accept contention as retryable without mutations and replays its exact request once", async () => {
    const context = await fixture();
    const { app, other, suggestion, input } = context;
    const before = await snapshot(context);
    const error = other.catalog.withProjectWrite(() =>
      thrown(() => app.sceneScriptReview.accept(suggestion.id, input)),
    );

    expect(database(app).isTransaction).toBe(false);
    expect(await snapshot(context)).toEqual(before);
    expectApplicationError(error, "jobs.busy", 409);

    const accepted = app.sceneScriptReview.accept(suggestion.id, input);
    expect(accepted.beats[0]?.script?.narration).toBe(revisedNarration);
    expect(
      app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id),
    ).toMatchObject({
      status: "accepted",
      requestId: input.requestId,
    });
    expect(app.project.sceneScriptReviewReceipts).toHaveLength(1);
    expect(
      JSON.parse(await readFile(context.projectPath, "utf8"))
        .sceneScriptReviewReceipts,
    ).toEqual(app.project.sceneScriptReviewReceipts);

    app.project.stories[0]!.beats[0]!.script!.narration =
      "Later manual narration.";
    app.project.stories[0]!.beats[0]!.script!.visualDirection =
      "Later manual direction.";
    await app.save();
    const current = await snapshot(context);
    expect(app.sceneScriptReview.accept(suggestion.id, input)).toEqual(
      current.project.stories[0],
    );
    expect(await snapshot(context)).toEqual(current);
    expect(app.project.sceneScriptReviewReceipts).toHaveLength(1);
  });

  it("reports skip contention as retryable without mutations and skips after the lock releases", async () => {
    const context = await fixture();
    const { app, other, suggestion, input } = context;
    const before = await snapshot(context);
    const error = other.catalog.withProjectWrite(() =>
      thrown(() => app.sceneScriptReview.skip(suggestion.id)),
    );

    expect(database(app).isTransaction).toBe(false);
    expect(await snapshot(context)).toEqual(before);
    expectApplicationError(error, "jobs.busy", 409);

    expect(app.sceneScriptReview.skip(suggestion.id)).toMatchObject({
      id: suggestion.id,
      status: "skipped",
    });
    const skipped = await snapshot(context);
    expect(skipped.bytes).toBe(before.bytes);
    expect(skipped.project).toEqual(before.project);
    expect(skipped.jobs).toEqual(before.jobs);
    expect(skipped.project.sceneScriptReviewReceipts ?? []).toHaveLength(0);
    expect(app.sceneScriptReview.skip(suggestion.id).status).toBe("skipped");
    expectApplicationError(
      thrown(() => app.sceneScriptReview.accept(suggestion.id, input)),
      "review.suggestionStale",
      409,
    );
    expect(await snapshot(context)).toEqual(skipped);
  });

  it.each(["accept", "skip"] as const)(
    "preserves the missing-suggestion error for %s",
    async (decision) => {
      const context = await fixture();
      const before = await snapshot(context);
      expectApplicationError(
        thrown(() =>
          decision === "accept"
            ? context.app.sceneScriptReview.accept("missing", context.input)
            : context.app.sceneScriptReview.skip("missing"),
        ),
        "request.notFound",
        404,
      );
      expect(await snapshot(context)).toEqual(before);
    },
  );

  it("preserves stale-source acceptance errors", async () => {
    const context = await fixture();
    context.app.project.stories[0]!.beats[0]!.script!.narration =
      "A different saved source.";
    await context.app.save();
    const before = await snapshot(context);
    expectApplicationError(
      thrown(() =>
        context.app.sceneScriptReview.accept(
          context.suggestion.id,
          context.input,
        ),
      ),
      "review.suggestionStale",
      409,
    );
    expect(await snapshot(context)).toEqual(before);
  });

  it("preserves accepted-suggestion conflict errors for a different request and skip", async () => {
    const context = await fixture();
    const { app, suggestion, input } = context;
    app.sceneScriptReview.accept(suggestion.id, input);
    const before = await snapshot(context);
    for (const action of [
      () =>
        app.sceneScriptReview.accept(suggestion.id, {
          ...input,
          requestId: "different-acceptance-request",
        }),
      () => app.sceneScriptReview.skip(suggestion.id),
    ]) {
      expectApplicationError(thrown(action), "review.suggestionStale", 409);
      expect(await snapshot(context)).toEqual(before);
    }
  });

  it("reports a raw accept publication failure as a neutral server error without mutations", async () => {
    const context = await fixture();
    const before = await snapshot(context);
    const technicalDetail =
      "Injected prepublication failure at /private/project.json";
    const service = context.app.sceneScriptReview as unknown as {
      publish(next: OpenFilmProject): void;
    };
    vi.spyOn(service, "publish").mockImplementationOnce(() => {
      throw new Error(technicalDetail);
    });
    const error = thrown(() =>
      context.app.sceneScriptReview.accept(
        context.suggestion.id,
        context.input,
      ),
    );

    expect(database(context.app).isTransaction).toBe(false);
    expect(await snapshot(context)).toEqual(before);
    expectUnexpectedError(error, technicalDetail);
  });

  it("reports a raw skip audit failure as a neutral server error without mutations", async () => {
    const context = await fixture();
    const before = await snapshot(context);
    const technicalDetail =
      "Injected skip audit failure in scene_script_suggestions";
    vi.spyOn(
      context.app.catalog.knowledge,
      "updateSceneScriptSuggestion",
    ).mockImplementationOnce(() => {
      throw new Error(technicalDetail);
    });
    const error = thrown(() =>
      context.app.sceneScriptReview.skip(context.suggestion.id),
    );

    expect(database(context.app).isTransaction).toBe(false);
    expect(await snapshot(context)).toEqual(before);
    expectUnexpectedError(error, technicalDetail);
  });

  it("reports a raw postpublication audit failure as a neutral server error and recovers its durable receipt", async () => {
    const context = await fixture();
    const { app, suggestion, input } = context;
    const before = await snapshot(context);
    const technicalDetail =
      "Injected acceptance audit failure after publication";
    vi.spyOn(
      app.catalog.knowledge,
      "updateSceneScriptSuggestion",
    ).mockImplementationOnce(() => {
      throw new Error(technicalDetail);
    });
    const error = thrown(() =>
      app.sceneScriptReview.accept(suggestion.id, input),
    );

    expect(database(app).isTransaction).toBe(false);
    const published = await snapshot(context);
    expect(published.bytes).not.toBe(before.bytes);
    expect(published.project.stories[0]?.beats[0]?.script?.narration).toBe(
      revisedNarration,
    );
    expect(published.project.sceneScriptReviewReceipts).toHaveLength(1);
    expect(published.project.sceneScriptReviewReceipts?.[0]).toMatchObject({
      suggestionId: suggestion.id,
      requestId: input.requestId,
    });
    expect(JSON.parse(published.bytes)).toEqual(published.project);
    expect(published.evidence).toEqual(before.evidence);
    expect(published.jobs).toEqual(before.jobs);
    expectUnexpectedError(error, technicalDetail);

    expect(app.sceneScriptReview.accept(suggestion.id, input)).toEqual(
      published.project.stories[0],
    );
    expect(
      app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id),
    ).toMatchObject({
      status: "accepted",
      requestId: input.requestId,
    });
    const recovered = await snapshot(context);
    expect(recovered.bytes).toBe(published.bytes);
    expect(recovered.project).toEqual(published.project);
    expect(app.sceneScriptReview.accept(suggestion.id, input)).toEqual(
      recovered.project.stories[0],
    );
    expect(await snapshot(context)).toEqual(recovered);
    expect(app.project.sceneScriptReviewReceipts).toHaveLength(1);
  });

  it("preserves invalid acceptance input as a client error", async () => {
    const context = await fixture();
    const before = await snapshot(context);
    expectApplicationError(
      thrown(() =>
        context.app.sceneScriptReview.accept(context.suggestion.id, {
          ...context.input,
          requestId: "",
        }),
      ),
      "request.invalid",
      400,
    );
    expect(await snapshot(context)).toEqual(before);
  });
});
