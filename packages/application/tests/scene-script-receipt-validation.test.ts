import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectCatalog } from "@openfilm/catalog";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function publishedReceipts() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-receipt-identity-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "film.openfilm");
  const runtime = { userDataDirectory: join(root, "user-data") };
  const app = await OpenFilmApplication.create(
    directory,
    "Receipt recovery",
    {},
    runtime,
  );
  cleanup.push(() => {
    try {
      app.catalog.close();
    } catch {
      // The fixture deliberately releases its initial connection before reopen.
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
        candidateAssetIds: [],
        script: {
          narration: "We arrived at dawn.",
          visualDirection: "Open on the quiet harbour.",
        },
      },
    ],
  });
  await app.save();
  app.knowledge.registerLanguageProvider({
    id: "receipt-identity-fixture",
    name: "Deterministic receipt identity fixture",
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
            after: context.text + " Revised.",
            reason: "Deterministic recovery fixture",
          },
        ],
      });
    },
  });
  for (const field of ["narration", "visualDirection"] as const)
    expect(
      (await app.runSceneScriptReview("story", { beatId: "beat", field }))
        .status,
    ).toBe("completed");
  const evidence = app.catalog.knowledge.sceneScriptSuggestionsList("story", {
    limit: 100,
  }).suggestions;
  expect(evidence).toHaveLength(2);
  const audit = vi.spyOn(app.catalog.knowledge, "updateSceneScriptSuggestion");
  for (const [index, suggestion] of evidence.entries()) {
    audit.mockImplementationOnce(() => {
      throw new Error("Injected audit failure after file publication");
    });
    expect(() =>
      app.sceneScriptReview.accept(suggestion.id, {
        baseRevision: suggestion.sourceRevisionId,
        requestId: `receipt-request-${index}`,
      }),
    ).toThrow("Injected audit failure after file publication");
  }
  expect(
    app.catalog.knowledge
      .sceneScriptSuggestionsList("story", {})
      .suggestions.map((suggestion) => suggestion.status),
  ).toEqual(["pending", "pending"]);
  app.catalog.close();
  const path = join(directory, "project.json");
  const project = JSON.parse(await readFile(path, "utf8"));
  expect(project.sceneScriptReviewReceipts).toHaveLength(2);
  return { directory, runtime, path, project };
}

describe("restored script acceptance request identity", () => {
  it.each(
    ["workspace", "export"].flatMap((intent) =>
      [
        "requestId",
        "acceptedRevisionId",
        "suggestionId",
        "evidenceHash",
      ].flatMap((field) =>
        ["bad\nid", "x".repeat(257), "\ud800"].map((value) => ({
          intent: intent as "workspace" | "export",
          field,
          value,
        })),
      ),
    ),
  )(
    "rejects malformed $field before $intent opening can reconcile evidence",
    async ({ intent, field, value }) => {
      const context = await publishedReceipts();
      context.project.sceneScriptReviewReceipts[0][field] = value;
      const bytes = JSON.stringify(context.project, null, 2) + "\n";
      await writeFile(context.path, bytes);
      await expect(
        OpenFilmApplication.open(context.directory, context.runtime, {
          intent,
        }).then((opened) => {
          cleanup.push(() => opened.catalog.close());
          return opened;
        }),
      ).rejects.toThrow(field);
      expect(await readFile(context.path, "utf8")).toBe(bytes);
      const catalog = new ProjectCatalog(context.directory);
      try {
        expect(
          catalog.knowledge
            .sceneScriptSuggestionsList("story", {})
            .suggestions.map((item) => item.status),
        ).toEqual(["pending", "pending"]);
      } finally {
        catalog.close();
      }
    },
  );

  it.each(["workspace", "export"] as const)(
    "rejects duplicate request IDs before %s opening can reconcile pending evidence",
    async (intent) => {
      const context = await publishedReceipts();
      const receipts = context.project.sceneScriptReviewReceipts;
      receipts[1].requestId = receipts[0].requestId;
      const bytes = JSON.stringify(context.project, null, 2) + "\n";
      await writeFile(context.path, bytes);

      await expect(
        OpenFilmApplication.open(context.directory, context.runtime, {
          intent,
        }).then((opened) => {
          cleanup.push(() => opened.catalog.close());
          return opened;
        }),
      ).rejects.toThrow(/requestId/);
      expect(await readFile(context.path, "utf8")).toBe(bytes);
      const catalog = new ProjectCatalog(context.directory);
      try {
        expect(
          catalog.knowledge
            .sceneScriptSuggestionsList("story", {})
            .suggestions.map((suggestion) => suggestion.status),
        ).toEqual(["pending", "pending"]);
      } finally {
        catalog.close();
      }
    },
  );

  it("recovers both distinct request IDs from the same restored project", async () => {
    const context = await publishedReceipts();
    const app = await OpenFilmApplication.open(
      context.directory,
      context.runtime,
    );
    cleanup.push(() => app.close());
    const page = app.sceneScriptReview.list("story", {});
    expect(page.suggestions).toHaveLength(2);
    for (const receipt of context.project.sceneScriptReviewReceipts)
      expect(
        page.suggestions.find((item) => item.id === receipt.suggestionId),
      ).toMatchObject({
        status: "accepted",
        requestId: receipt.requestId,
        acceptedRevisionId: receipt.acceptedRevisionId,
      });
    expect(app.project).toEqual(context.project);
  });
});
