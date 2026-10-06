import { copyFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job, MediaAsset } from "@openfilm/core";
import type { LanguageProvider } from "@openfilm/plugin-sdk";
import { hashFile } from "@openfilm/media";
import { ProjectCatalog } from "@openfilm/catalog";
import { OpenFilmApplication } from "../src/index.js";
import { TranscriptEditor } from "../src/transcript-editor.js";
import { KnowledgeService } from "../src/knowledge.js";

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

function languageProvider(
  generate: LanguageProvider["generate"],
  overrides: Partial<LanguageProvider> = {},
): LanguageProvider {
  return {
    id: "explicit-test-language",
    name: "Fixture corrections, not real AI",
    kind: "language",
    execution: "local",
    dataKinds: ["text", "transcripts"],
    generate,
    ...overrides,
  };
}
function payload(prompt: string) {
  return JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as {
    language: string;
    segments: { segmentId: string; text: string }[];
    glossary: { source: string; replacement: string }[];
  };
}
function correction(prompt: string) {
  const segment = payload(prompt).segments[0]!;
  return JSON.stringify({
    suggestions: [
      {
        segmentId: segment.segmentId,
        after: segment.text + " corrected",
        reason: "Explicit deterministic provider fixture",
      },
    ],
  });
}
async function fixture(
  lines = ["我們去十河田湖", "Visit youtube", "Visit youtube again"],
) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-knowledge-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.wav");
  await writeFile(source, "identity-only transcript fixture; no actual ASR");
  const sourceHash = await hashFile(source);
  const asset: MediaAsset = {
    id: "source",
    uri: pathToFileURL(source).href,
    name: "source.wav",
    mediaType: "audio",
    duration: Math.max(100, lines.length * 2),
    contentHash: sourceHash,
    metadata: { privateGPS: "do not send" },
    tags: [],
    state: { locked: true },
  };
  let app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Knowledge fixture",
    {},
    { userDataDirectory: join(root, "user-data") },
  );
  cleanup.push(() => app.close());
  app.catalog.upsertAsset(asset);
  app.catalog.intelligence.replaceTranscript({
    id: "provider-revision",
    assetId: asset.id,
    language: "en",
    provenance: {
      providerId: "fixture-no-asr",
      model: "not-real-recognition",
      version: "1",
      sourceHash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: lines.map((text, id) => ({
      id: `segment-${id}`,
      start: id * 2,
      end: id * 2 + 1,
      text,
      words: [{ start: id * 2, end: id * 2 + 1, text }],
    })),
  });
  const story = app.generateStory({
    title: "Independent story",
    assetIds: [asset.id],
    targetDuration: 12,
    maxDuration: 20,
  });
  app.compose(story.id);
  let editor = new TranscriptEditor(app);
  let knowledge = new KnowledgeService(app.catalog, editor, {
    userDataDirectory: join(root, "user-data"),
  });
  return {
    root,
    asset,
    sourceHash,
    get app() {
      return app;
    },
    get editor() {
      return editor;
    },
    get knowledge() {
      return knowledge;
    },
    async reopen(move = false) {
      const original = app.directory;
      app.close();
      const destination = move ? join(root, "moved.openfilm") : original;
      if (move) await rename(original, destination);
      app = await OpenFilmApplication.open(destination, {
        userDataDirectory: join(root, "user-data"),
      });
      editor = new TranscriptEditor(app);
      knowledge = new KnowledgeService(app.catalog, editor, {
        userDataDirectory: join(root, "user-data"),
      });
      knowledge.recoverInterruptedReviews();
    },
  };
}

describe("offline terminology, revisions and durable review", () => {
  it("pages and stales suggestions from a 10,000-segment persisted transcript without materializing its full document", async () => {
    const context = await fixture(
      Array.from(
        { length: 10000 },
        (_, index) => `Visit youtube memory ${index}`,
      ),
    );
    const { knowledge, editor, app } = context;
    knowledge.glossaryUpsert({
      scope: "project",
      source: "youtube",
      replacement: "YouTube",
    });
    await knowledge.glossaryReview("source", {
      segmentIds: Array.from({ length: 21 }, (_, index) => `segment-${index}`),
    });
    const original = await editor.get("source", { limit: 1 });
    const expected = app.catalog.knowledge.suggestionsList("source", {
      status: "pending",
      offset: 7,
      limit: 7,
    });
    const editorReads = vi.spyOn(editor, "get");
    const guard = vi
      .spyOn(app.catalog.transcripts, "getFull")
      .mockImplementation(() => {
        throw new Error(
          "Suggestion polling must not materialize a complete transcript.",
        );
      });
    expect(
      await knowledge.suggestionsList("source", {
        status: "pending",
        offset: 7,
        limit: 7,
      }),
    ).toEqual(expected);
    expect(guard).not.toHaveBeenCalled();
    expect(editorReads).toHaveBeenCalledWith("source", { limit: 1 });
    guard.mockRestore();
    editorReads.mockRestore();
    const edited = await editor.edit("source", {
      baseRevision: original.revision!,
      requestId: "edit-before-staling",
      commands: [
        {
          type: "replace-text",
          segmentId: "segment-0",
          text: "User authored memory",
        },
      ],
    });
    const stalingGuard = vi
      .spyOn(app.catalog.transcripts, "getFull")
      .mockImplementation(() => {
        throw new Error("Staling a suggestion page must stay bounded.");
      });
    expect(
      (
        await knowledge.suggestionsList("source", {
          status: "pending",
          limit: 7,
        })
      ).total,
    ).toBe(0);
    const stale = await knowledge.suggestionsList("source", {
      status: "stale",
      offset: 14,
      limit: 7,
    });
    expect(stale.total).toBe(21);
    expect(stale.suggestions).toHaveLength(7);
    expect(stalingGuard).not.toHaveBeenCalled();
    expect(
      stale.suggestions.every(
        (row) => row.sourceRevisionId === original.revision,
      ),
    ).toBe(true);
    stalingGuard.mockRestore();
    await context.reopen();
    const reopenedGuard = vi
      .spyOn(context.app.catalog.transcripts, "getFull")
      .mockImplementation(() => {
        throw new Error("Reopened suggestion polling must stay bounded.");
      });
    expect(
      await context.knowledge.suggestionsList("source", {
        status: "stale",
        offset: 14,
        limit: 7,
      }),
    ).toEqual(stale);
    expect((await context.editor.get("source", { limit: 1 })).revision).toBe(
      edited.revision,
    );
    await writeFile(
      join(context.root, "source.wav"),
      "Changed source bytes must invalidate suggestion access.",
    );
    await expect(
      context.knowledge.suggestionsList("source", { limit: 7 }),
    ).rejects.toMatchObject({ code: "source.changed" });
    await rm(join(context.root, "source.wav"));
    await expect(
      context.knowledge.suggestionsList("source", { limit: 7 }),
    ).rejects.toMatchObject({ code: "media.missing" });
    expect(reopenedGuard).not.toHaveBeenCalled();
    expect(
      context.app.catalog.knowledge.suggestionsList("source", {
        status: "stale",
        offset: 14,
        limit: 7,
      }),
    ).toEqual(stale);
  });

  it("keeps the missing-transcript error and source checks when suggestions use a bounded revision read", async () => {
    const { app, asset, knowledge, root } = await fixture();
    const untranscribed = join(root, "untranscribed.wav");
    await copyFile(join(root, "source.wav"), untranscribed);
    app.catalog.upsertAsset({
      ...asset,
      id: "untranscribed",
      uri: pathToFileURL(untranscribed).href,
    });
    const guard = vi
      .spyOn(app.catalog.transcripts, "getFull")
      .mockImplementation(() => {
        throw new Error(
          "No complete transcript is required for missing-transcript detection.",
        );
      });
    await expect(
      knowledge.suggestionsList("untranscribed", { limit: 1 }),
    ).rejects.toMatchObject({ code: "request.notFound", status: 404 });
    expect(guard).not.toHaveBeenCalled();
  });
  it.each(["retry", "skip"] as const)(
    "terminalizes an oversized glossary batch and allows offline %s without dropping completed results",
    async (action) => {
      const context = await fixture(["youtube", "x".repeat(19999), "youtube"]);
      const { knowledge, editor } = context;
      knowledge.glossaryUpsert({
        source: "youtube",
        replacement: "YouTube",
        scope: "project",
      });
      knowledge.glossaryUpsert({
        source: "x",
        replacement: "xx",
        scope: "project",
      });
      const original = await editor.get("source");
      const job = await knowledge.glossaryReview("source", { batchSize: 1 });
      expect(job.status).toBe("failed");
      expect(knowledge.batches(job.id).map((batch) => batch.status)).toEqual([
        "completed",
        "failed",
        "cancelled",
      ]);
      expect(knowledge.batches(job.id)[1]?.error).toMatch(/exceed/);
      const completed = (await knowledge.suggestionsList("source")).suggestions;
      expect(completed).toHaveLength(1);
      expect((await editor.get("source")).revision).toBe(original.revision);
      await context.reopen();
      expect(
        context.knowledge.batches(job.id).map((batch) => batch.status),
      ).toEqual(["completed", "failed", "cancelled"]);
      if (action === "retry") {
        expect((await context.knowledge.retryBatch(job.id, 1)).status).toBe(
          "failed",
        );
        expect(context.knowledge.batches(job.id)[1]?.status).toBe("failed");
        expect(context.knowledge.batches(job.id)[1]?.attempts).toBe(2);
        context.knowledge.glossaryUpsert({
          source: "x",
          replacement: "x",
          scope: "project",
        });
        expect(context.knowledge.languageProvider().configured).toBe(false);
        expect((await context.knowledge.retryBatch(job.id, 1)).status).toBe(
          "cancelled",
        );
        expect(context.knowledge.batches(job.id)[1]?.attempts).toBe(3);
        expect((await context.knowledge.retryBatch(job.id, 2)).status).toBe(
          "completed",
        );
        expect((await context.knowledge.suggestionsList("source")).total).toBe(
          2,
        );
      } else {
        expect(context.knowledge.skipBatch(job.id, 1).status).toBe("skipped");
        expect(context.knowledge.skipBatch(job.id, 2).status).toBe("skipped");
        expect(
          context.app.catalog.listJobs().find((row) => row.id === job.id)
            ?.status,
        ).toBe("completed");
      }
      expect(
        context.app.catalog.knowledge.getSuggestion(completed[0]!.id),
      ).toEqual(completed[0]);
      expect((await context.editor.get("source")).revision).toBe(
        original.revision,
      );
      await context.reopen();
      expect(
        context.knowledge
          .batches(job.id)
          .some((batch) =>
            ["pending", "running", "failed", "cancelled"].includes(
              batch.status,
            ),
          ),
      ).toBe(false);
      expect(
        context.app.catalog.knowledge.getSuggestion(completed[0]!.id),
      ).toEqual(completed[0]);
    },
  );
  it("claims an exact queued HTTP reservation while rejecting mismatched, active and reused jobs", async () => {
    const { knowledge, app } = await fixture();
    app.catalog.saveJob({
      id: "reserved-review",
      type: "glossary-review",
      assetId: "source",
      status: "queued",
      createdAt: "2026-10-06T00:00:00Z",
    });
    const job = await knowledge.glossaryReview("source", {
      jobId: "reserved-review",
    });
    expect(job.status).toBe("completed");
    expect(job.createdAt).toBe("2026-10-06T00:00:00Z");
    await expect(
      knowledge.glossaryReview("source", { jobId: "reserved-review" }),
    ).rejects.toMatchObject({ code: "request.invalid" });
    for (const [id, type, assetId, status] of [
      ["wrong-kind", "language-review", "source", "queued"],
      ["wrong-asset", "glossary-review", "other", "queued"],
      ["active", "glossary-review", "source", "running"],
    ] as const) {
      app.catalog.saveJob({ id, type, assetId, status });
      await expect(
        knowledge.glossaryReview("source", { jobId: id }),
      ).rejects.toMatchObject({ code: "request.invalid" });
      expect(app.catalog.listJobs().find((job) => job.id === id)?.status).toBe(
        status,
      );
    }
  });
  it("upserts duplicates, respects project precedence and carries project terms with a moved project", async () => {
    const context = await fixture();
    const { knowledge } = context;
    knowledge.glossaryUpsert({
      source: "youtube",
      replacement: "YouTube",
      scope: "global",
      caseSensitive: false,
    });
    const entry = knowledge.glossaryUpsert({
      source: "youtube",
      replacement: "YOUTUBE",
      scope: "project",
    });
    const updated = knowledge.glossaryUpsert({
      source: "youtube",
      replacement: "Youtube",
      scope: "project",
    });
    expect(updated.id).toBe(entry.id);
    expect(knowledge.glossaryList("project")).toHaveLength(1);
    expect(
      knowledge.glossaryList().find((entry) => entry.source === "youtube")
        ?.replacement,
    ).toBe("Youtube");
    await context.reopen(true);
    expect(context.knowledge.glossaryList("project")[0]?.id).toBe(entry.id);
    expect(context.knowledge.glossaryList("global")).toHaveLength(1);
    expect(context.knowledge.glossaryDelete(entry.id, "project")).toBe(true);
    expect(context.knowledge.glossaryList()[0]?.scope).toBe("global");
  });
  it("rejects conflicting renames and unknown IDs without changing project terms", async () => {
    const { knowledge } = await fixture();
    const first = knowledge.glossaryUpsert({
      source: "first",
      replacement: "First",
      scope: "project",
    });
    knowledge.glossaryUpsert({
      source: "second",
      replacement: "Second",
      scope: "project",
    });
    expect(() =>
      knowledge.glossaryUpsert({
        id: first.id,
        source: "second",
        replacement: "First",
        scope: "project",
      }),
    ).toThrowError(expect.objectContaining({ code: "glossary.entryConflict" }));
    expect(() =>
      knowledge.glossaryUpsert({
        id: "missing",
        source: "term",
        replacement: "Term",
        scope: "project",
      }),
    ).toThrowError(expect.objectContaining({ code: "request.notFound" }));
    expect(knowledge.glossaryList("project")).toHaveLength(2);
  });
  it("generates, deduplicates, skips and reopens glossary evidence without silently editing text", async () => {
    const context = await fixture();
    const { knowledge, editor } = context;
    knowledge.glossaryUpsert({
      source: "youtube",
      replacement: "YouTube",
      scope: "project",
    });
    const before = await editor.get("source");
    expect((await knowledge.glossaryReview("source")).status).toBe("completed");
    const suggestions = (await knowledge.suggestionsList("source")).suggestions;
    expect(suggestions).toHaveLength(2);
    expect((await editor.get("source")).revision).toBe(before.revision);
    await knowledge.glossaryReview("source");
    expect((await knowledge.suggestionsList("source")).total).toBe(2);
    knowledge.skipSuggestion(suggestions[0]!.id);
    await context.reopen();
    expect(
      (await context.knowledge.suggestionsList("source")).suggestions.filter(
        (row) => row.status === "skipped",
      ),
    ).toHaveLength(1);
    expect(context.knowledge.languageProvider()).toEqual({
      configured: false,
      available: false,
    });
  });
  it("atomically accepts a suggestion, preserves provenance/alignment history and deduplicates lost responses", async () => {
    const context = await fixture();
    const { knowledge, editor, app } = context;
    const story = structuredClone(app.project.stories);
    const compositions = structuredClone(app.project.timelines);
    knowledge.glossaryUpsert({
      source: "十河田",
      replacement: "十和田",
      scope: "project",
    });
    await knowledge.glossaryReview("source");
    const suggestion = (await knowledge.suggestionsList("source"))
      .suggestions[0]!;
    const input = {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "accept-once",
    };
    const result = await knowledge.acceptSuggestion(suggestion.id, input);
    expect(result.document?.segments[0]?.text).toBe("我們去十和田湖");
    expect(result.document?.segments[0]?.alignmentState).toBe("text-edited");
    expect(result.document?.provenance.providerId).toBe("fixture-no-asr");
    expect(
      (await knowledge.acceptSuggestion(suggestion.id, input)).revision,
    ).toBe(result.revision);
    const evidence = app.catalog.knowledge.getSuggestion(suggestion.id)!;
    expect(evidence.status).toBe("accepted");
    expect(evidence.acceptedRevisionId).toBe(result.revision);
    expect(evidence.requestId).toBe("accept-once");
    expect(app.project.stories).toEqual(story);
    expect(app.project.timelines).toEqual(compositions);
    expect(app.catalog.getAsset("source")?.state.locked).toBe(true);
    await editor.undo("source", {
      baseRevision: result.revision!,
      requestId: "undo-correction",
    });
    expect(app.catalog.knowledge.getSuggestion(suggestion.id)?.status).toBe(
      "accepted",
    );
    await context.reopen();
    expect(
      context.app.catalog.knowledge.getSuggestion(suggestion.id)?.acceptedAt,
    ).toBeDefined();
  });

  it.each(["", " \n\t"])(
    "accepts a blank correction as an undoable transcript deletion: %s",
    async (after) => {
      const context = await fixture(["um", "Keep this memory"]);
      const { knowledge, app } = context;
      knowledge.glossaryUpsert({
        source: "um",
        replacement: after,
        scope: "project",
      });
      await knowledge.glossaryReview("source");
      const suggestion = (await knowledge.suggestionsList("source"))
        .suggestions[0]!;
      const media = app.catalog.getAsset("source");
      const project = structuredClone(app.project);
      const request = {
        baseRevision: suggestion.sourceRevisionId,
        requestId: "delete-filler",
      };
      const edited = await knowledge.acceptSuggestion(suggestion.id, request);
      expect(edited.document?.segments.map((segment) => segment.text)).toEqual([
        "Keep this memory",
      ]);
      expect(
        (await knowledge.acceptSuggestion(suggestion.id, request)).revision,
      ).toBe(edited.revision);
      expect(app.catalog.getAsset("source")).toEqual(media);
      expect(app.project).toEqual(project);
      await context.reopen();
      expect(
        (await context.editor.get("source")).document?.segments,
      ).toHaveLength(1);
      const state = await context.editor.get("source");
      expect(
        (
          await context.editor.undo("source", {
            baseRevision: state.revision!,
            requestId: "restore-filler",
          })
        ).document?.segments[0]?.text,
      ).toBe("um");
      expect(
        context.app.catalog.knowledge.getSuggestion(suggestion.id)?.status,
      ).toBe("accepted");
    },
  );
  it("rolls transcript, history, receipt and suggestion status back together if acceptance audit fails", async () => {
    const { knowledge, editor, app } = await fixture();
    knowledge.glossaryUpsert({
      source: "youtube",
      replacement: "YouTube",
      scope: "project",
    });
    await knowledge.glossaryReview("source");
    const suggestion = (await knowledge.suggestionsList("source"))
      .suggestions[0]!;
    const before = await editor.get("source");
    const failure = vi
      .spyOn(app.catalog.knowledge, "updateSuggestion")
      .mockImplementation(() => {
        throw new Error("simulated disk/audit write failure");
      });
    await expect(
      knowledge.acceptSuggestion(suggestion.id, {
        baseRevision: before.revision!,
        requestId: "atomic-audit",
      }),
    ).rejects.toThrow("simulated disk");
    failure.mockRestore();
    expect((await editor.get("source")).revision).toBe(before.revision);
    expect(app.catalog.knowledge.getSuggestion(suggestion.id)?.status).toBe(
      "pending",
    );
    expect(
      (
        await knowledge.acceptSuggestion(suggestion.id, {
          baseRevision: before.revision!,
          requestId: "atomic-audit",
        })
      ).revision,
    ).not.toBe(before.revision);
  });
  it("rejects stale suggestions after manual edits and keeps the edited user text", async () => {
    const { knowledge, editor } = await fixture();
    knowledge.glossaryUpsert({
      source: "youtube",
      replacement: "YouTube",
      scope: "project",
    });
    await knowledge.glossaryReview("source");
    const suggestion = (await knowledge.suggestionsList("source"))
      .suggestions[0]!;
    const changed = await editor.edit("source", {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "user-wins",
      commands: [
        {
          type: "replace-text",
          segmentId: suggestion.target.segmentId,
          text: "User-authored content",
        },
      ],
    });
    await expect(
      knowledge.acceptSuggestion(suggestion.id, {
        baseRevision: changed.revision!,
        requestId: "stale-accept",
      }),
    ).rejects.toMatchObject({ code: "review.suggestionStale" });
    expect(
      (await editor.get("source")).document?.segments.find(
        (segment) => segment.id === suggestion.target.segmentId,
      )?.text,
    ).toBe("User-authored content");
    expect(
      (await knowledge.suggestionsList("source")).suggestions.every(
        (row) => row.status === "stale",
      ),
    ).toBe(true);
  });

  it("can dismiss stale evidence after accepting another suggestion without changing text or accepted audit", async () => {
    const context = await fixture();
    const { knowledge, editor, app } = context;
    knowledge.glossaryUpsert({
      source: "youtube",
      replacement: "YouTube",
      scope: "project",
    });
    await knowledge.glossaryReview("source");
    const original = (await knowledge.suggestionsList("source")).suggestions;
    const first = original[0]!;
    const second = original[1]!;
    await knowledge.acceptSuggestion(first.id, {
      baseRevision: first.sourceRevisionId,
      requestId: "accept-first",
    });
    expect(
      (await knowledge.suggestionsList("source")).suggestions.find(
        (row) => row.id === second.id,
      )?.status,
    ).toBe("stale");
    const before = await editor.get("source");
    expect(knowledge.skipSuggestion(second.id).status).toBe("skipped");
    expect((await editor.get("source")).revision).toBe(before.revision);
    expect(() => knowledge.skipSuggestion(first.id)).toThrowError(
      expect.objectContaining({ code: "review.suggestionStale" }),
    );
    expect(app.catalog.knowledge.getSuggestion(first.id)?.status).toBe(
      "accepted",
    );
    await context.reopen();
    expect(context.app.catalog.knowledge.getSuggestion(second.id)?.status).toBe(
      "skipped",
    );
  });
  it("rejects oversized pages and malformed batch configuration without leaving queued work", async () => {
    const { knowledge, app } = await fixture();
    await expect(
      knowledge.suggestionsList("source", { limit: 101 }),
    ).rejects.toMatchObject({ code: "request.invalid" });
    await expect(
      knowledge.glossaryReview("source", { batchSize: 1000 }),
    ).rejects.toMatchObject({ code: "request.invalid" });
    expect(app.catalog.listJobs()).toHaveLength(0);
  });
});

describe("optional provider review, privacy and recoverable batches", () => {
  it("never sends an oversized accepted provider segment and retains valid completed batches across retry, skip and reopen", async () => {
    const oversized = "x".repeat(60001);
    const context = await fixture([
      "Keep this first memory",
      oversized,
      "Keep this last memory",
    ]);
    const { knowledge, editor } = context;
    const original = await editor.get("source");
    const prompts: string[] = [];
    knowledge.registerLanguageProvider(
      languageProvider(async (prompt) => {
        prompts.push(prompt);
        return correction(prompt);
      }),
    );
    const job = await knowledge.languageReview("source");
    expect(job.status).toBe("failed");
    expect(job.errors?.[0]?.code).toBe("request.tooLarge");
    expect(
      prompts.map((prompt) =>
        payload(prompt).segments.map((segment) => segment.segmentId),
      ),
    ).toEqual([["segment-0"], ["segment-2"]]);
    expect(
      prompts.every((prompt) => Buffer.byteLength(prompt, "utf8") <= 60000),
    ).toBe(true);
    expect(prompts.some((prompt) => prompt.includes(oversized))).toBe(false);
    expect(knowledge.batches(job.id).map((batch) => batch.status)).toEqual([
      "completed",
      "failed",
      "completed",
    ]);
    const retained = (await knowledge.suggestionsList("source")).suggestions;
    expect(retained).toHaveLength(2);
    expect((await editor.get("source")).revision).toBe(original.revision);
    expect((await editor.get("source")).document?.segments[1]?.text).toBe(
      oversized,
    );
    expect((await knowledge.retryBatch(job.id, 1)).status).toBe("failed");
    expect(prompts).toHaveLength(2);
    expect(knowledge.batches(job.id)[1]?.attempts).toBe(2);
    await context.reopen();
    expect(
      (await context.editor.get("source")).document?.segments[1]?.text,
    ).toBe(oversized);
    expect(
      (await context.knowledge.suggestionsList("source")).suggestions,
    ).toEqual(retained);
    context.knowledge.skipBatch(job.id, 1);
    expect(
      context.app.catalog.listJobs().find((row) => row.id === job.id)?.status,
    ).toBe("completed");
    await context.reopen();
    expect(context.knowledge.batches(job.id)[1]?.status).toBe("skipped");
    expect((await context.editor.get("source")).revision).toBe(
      original.revision,
    );
  });

  it.each([
    ["CJK", Array.from({ length: 7 }, () => "記憶".repeat(2500)), [3, 3, 1]],
    [
      "JSON escapes",
      Array.from({ length: 2 }, () => '"'.repeat(19999)),
      [1, 1],
    ],
  ] as const)(
    "groups ordinary %s text by the actual serialized UTF-8 request size",
    async (_label, lines, counts) => {
      const { knowledge } = await fixture([...lines]);
      const prompts: string[] = [];
      knowledge.registerLanguageProvider(
        languageProvider(async (prompt) => {
          prompts.push(prompt);
          return JSON.stringify({ suggestions: [] });
        }),
      );
      const job = await knowledge.languageReview("source");
      expect(job.status).toBe("completed");
      expect(prompts.map((prompt) => payload(prompt).segments.length)).toEqual([
        ...counts,
      ]);
      expect(
        prompts.every((prompt) => Buffer.byteLength(prompt, "utf8") <= 60000),
      ).toBe(true);
      expect(
        prompts.flatMap((prompt) =>
          payload(prompt).segments.map((segment) => segment.text),
        ),
      ).toEqual([...lines]);
      expect(
        knowledge
          .batches(job.id)
          .every((batch) => batch.status === "completed"),
      ).toBe(true);
    },
  );

  it("includes escaped glossary context in the prompt budget and permits retry after reducing that context", async () => {
    const context = await fixture(["\\".repeat(19999)]);
    const { knowledge, editor } = context;
    const terms = ["a", "b", "c"].map((source) =>
      knowledge.glossaryUpsert({
        source,
        replacement: "\n".repeat(3999),
        scope: "project",
      }),
    );
    const generate = vi.fn(async (_prompt: string) =>
      JSON.stringify({ suggestions: [] }),
    );
    knowledge.registerLanguageProvider(languageProvider(generate));
    const before = await editor.get("source");
    const job = await knowledge.languageReview("source");
    expect(job.status).toBe("failed");
    expect(job.errors?.[0]?.code).toBe("request.tooLarge");
    expect(generate).not.toHaveBeenCalled();
    expect(knowledge.batches(job.id)[0]?.status).toBe("failed");
    expect((await editor.get("source")).revision).toBe(before.revision);
    for (const term of terms)
      knowledge.glossaryUpsert({
        id: term.id,
        scope: "project",
        source: term.source,
        replacement: term.replacement,
        enabled: false,
      });
    expect((await knowledge.retryBatch(job.id, 0)).status).toBe("completed");
    expect(generate).toHaveBeenCalledTimes(1);
    const prompt = generate.mock.calls[0]?.[0] as string | undefined;
    expect(prompt && Buffer.byteLength(prompt, "utf8")).toBeLessThanOrEqual(
      60000,
    );
    await context.reopen();
    expect(context.knowledge.batches(job.id)[0]?.status).toBe("completed");
    expect((await context.editor.get("source")).revision).toBe(before.revision);
  });

  it("can review and accept a correction for an unchanged opaque long/control segment identifier", async () => {
    const context = await fixture(["Original words"]);
    const { app, knowledge, editor } = context;
    const initial = await editor.get("source");
    const id = "legacy\n" + "識別".repeat(160);
    app.catalog.intelligence.replaceTranscript({
      ...initial.document!,
      id: "opaque-id-provider-revision",
      segments: [{ ...initial.document!.segments[0]!, id }],
    });
    knowledge.registerLanguageProvider(
      languageProvider(async (prompt) => correction(prompt)),
    );
    const reviewed = await knowledge.languageReview("source");
    expect(reviewed.status).toBe("completed");
    const suggestion = (await knowledge.suggestionsList("source"))
      .suggestions[0]!;
    expect(suggestion.target.segmentId).toBe(id);
    const changed = await knowledge.acceptSuggestion(suggestion.id, {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "accept-opaque-id",
    });
    expect(changed.document?.segments[0]?.id).toBe(id);
    expect(changed.document?.segments[0]?.text).toBe(
      "Original words corrected",
    );
    await context.reopen();
    expect((await context.editor.get("source")).document?.segments[0]?.id).toBe(
      id,
    );
    expect(
      context.app.catalog.knowledge.getSuggestion(suggestion.id)?.target
        .segmentId,
    ).toBe(id);
  });
  it.each(["queued", "running"] as const)(
    "recovers an actual reopened catalog containing an interrupted %s review and preserves completed suggestions",
    async (status) => {
      const context = await fixture();
      const { knowledge, editor, app } = context;
      knowledge.registerLanguageProvider(
        languageProvider(async (prompt) => correction(prompt)),
      );
      const job = await knowledge.languageReview("source", {
        segmentIds: ["segment-0"],
      });
      const completed = (await knowledge.suggestionsList("source"))
        .suggestions[0]!;
      const completedBatch = knowledge.batches(job.id)[0]!;
      app.catalog.saveJob({ ...job, status });
      app.catalog.knowledge.saveBatch({
        ...completedBatch,
        index: 1,
        segmentIds: ["segment-1"],
        status: "running",
        attempts: 1,
      });
      app.catalog.knowledge.saveBatch({
        ...completedBatch,
        index: 2,
        segmentIds: ["segment-2"],
        status: "pending",
        attempts: 0,
      });
      app.catalog.saveJob({
        id: "unrelated-render",
        type: "render",
        status: "running",
      });
      // A fresh SQLite connection reads persisted crash checkpoints before the
      // application's generic job normalization can conceal a recovery defect.
      const reopened = new ProjectCatalog(app.directory);
      try {
        const recovered = new KnowledgeService(reopened, editor, {
          userDataDirectory: join(context.root, "user-data"),
        });
        expect(
          reopened.listJobs().find((row) => row.id === job.id)?.status,
        ).toBe(status);
        recovered.recoverInterruptedReviews();
        expect(
          reopened.listJobs().find((row) => row.id === job.id)?.status,
        ).toBe("failed");
        expect(
          reopened.listJobs().find((row) => row.id === "unrelated-render")
            ?.status,
        ).toBe("running");
        expect(recovered.batches(job.id).map((batch) => batch.status)).toEqual([
          "completed",
          "cancelled",
          "cancelled",
        ]);
        expect(recovered.batches(job.id)[0]).toEqual(completedBatch);
        expect(reopened.knowledge.getSuggestion(completed.id)).toEqual(
          completed,
        );
        recovered.registerLanguageProvider(
          languageProvider(async (prompt) => correction(prompt)),
        );
        expect((await recovered.retryBatch(job.id, 1)).status).toBe(
          "cancelled",
        );
        expect(recovered.skipBatch(job.id, 2).status).toBe("skipped");
        expect(
          reopened.listJobs().find((row) => row.id === job.id)?.status,
        ).toBe("completed");
        expect((await recovered.suggestionsList("source")).total).toBe(2);
      } finally {
        reopened.close();
      }
      await context.reopen();
      expect(
        context.knowledge.batches(job.id).map((batch) => batch.status),
      ).toEqual(["completed", "completed", "skipped"]);
      expect(context.app.catalog.knowledge.getSuggestion(completed.id)).toEqual(
        completed,
      );
    },
  );
  it.each(["never", "resolve", "reject"] as const)(
    "cancels a provider that ignores AbortSignal and safely discards a late %s",
    async (outcome) => {
      const context = await fixture();
      const { app } = context;
      const controller = new AbortController();
      let calls = 0;
      let secondStarted!: () => void;
      let resolveLate!: (value: string) => void;
      let rejectLate!: (error: Error) => void;
      let delayedPrompt = "";
      const second = new Promise<void>((resolve) => {
        secondStarted = resolve;
      });
      app.knowledge.registerLanguageProvider(
        languageProvider(async (prompt) => {
          calls++;
          if (calls === 1) return correction(prompt);
          delayedPrompt = prompt;
          secondStarted();
          return new Promise<string>((resolve, reject) => {
            resolveLate = resolve;
            rejectLate = reject;
          });
        }),
      );
      const work = app.runKnowledgeReview("source", {
        source: "language",
        jobId: "non-cooperative-review",
        batchSize: 1,
        signal: controller.signal,
      });
      await second;
      expect(app.hasActiveJobs).toBe(true);
      expect((await app.knowledge.suggestionsList("source")).total).toBe(1);
      controller.abort();
      await vi.waitFor(() => expect(app.hasActiveJobs).toBe(false));
      expect((await work).status).toBe("cancelled");
      expect(calls).toBe(2);
      expect(
        app.knowledge
          .batches("non-cooperative-review")
          .map((batch) => batch.status),
      ).toEqual(["completed", "cancelled", "cancelled"]);
      await context.reopen(); // Closing does not wait for a non-cooperative provider.
      if (outcome === "resolve") resolveLate(correction(delayedPrompt));
      if (outcome === "reject")
        rejectLate(new Error("Late rejection from the cancelled provider"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect((await context.knowledge.suggestionsList("source")).total).toBe(1);
      expect(
        context.app.catalog
          .listJobs()
          .find((job) => job.id === "non-cooperative-review")?.status,
      ).toBe("cancelled");
    },
  );

  it("does not invoke a provider or reserve a job when its signal was already cancelled", async () => {
    const { app } = await fixture();
    const generate = vi.fn(async (prompt) => correction(prompt));
    app.knowledge.registerLanguageProvider(languageProvider(generate));
    const controller = new AbortController();
    controller.abort();
    await expect(
      app.runKnowledgeReview("source", {
        source: "language",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(generate).not.toHaveBeenCalled();
    expect(app.hasActiveJobs).toBe(false);
    expect(app.catalog.listJobs()).toHaveLength(0);
  });
  it("makes no remote call without consent and sends only declared minimal text once consented", async () => {
    const { knowledge } = await fixture();
    const generate = vi.fn(async (prompt: string) => correction(prompt));
    const provider = languageProvider(generate, {
      execution: "remote",
      endpoint: "https://example.invalid/review",
    });
    knowledge.registerLanguageProvider(provider);
    expect(knowledge.languageProvider().available).toBe(false);
    await expect(knowledge.languageReview("source")).rejects.toMatchObject({
      code: "review.providerUnavailable",
    });
    expect(generate).not.toHaveBeenCalled();
    knowledge.grantConsent({
      providerId: provider.id,
      dataKinds: ["text", "transcripts"],
      grantedAt: "2026-10-06T00:00:00Z",
    });
    expect((await knowledge.languageReview("source")).status).toBe("completed");
    const sent = payload(generate.mock.calls[0]![0]);
    expect(Object.keys(sent).sort()).toEqual([
      "glossary",
      "language",
      "segments",
    ]);
    expect(JSON.stringify(sent)).not.toMatch(
      /source\.wav|file:|privateGPS|sourceHash|contentHash|clipId|duration/,
    );
    expect(sent.segments[0]).toEqual({
      segmentId: "segment-0",
      text: "我們去十河田湖",
    });
    knowledge.revokeConsent(provider.id);
    expect(knowledge.languageProvider().available).toBe(false);
  });
  it("requires transcript disclosure as well as text, and preserves a provider after rejected replacement", async () => {
    const { knowledge } = await fixture();
    const good = languageProvider(async (prompt) => correction(prompt));
    knowledge.registerLanguageProvider(good);
    expect(() =>
      knowledge.registerLanguageProvider({
        ...good,
        generate: undefined,
      } as unknown as LanguageProvider),
    ).toThrow();
    expect(knowledge.languageProvider().available).toBe(true);
    knowledge.registerLanguageProvider(
      languageProvider(async (prompt) => correction(prompt), {
        dataKinds: ["text"],
      }),
    );
    await expect(knowledge.languageReview("source")).rejects.toMatchObject({
      code: "review.providerUnavailable",
    });
  });

  it("preserves Unicode and spaced provider identifiers already accepted by the SDK", async () => {
    const { knowledge } = await fixture();
    knowledge.registerLanguageProvider(
      languageProvider(async (prompt) => correction(prompt), {
        id: "Local Review 日本語",
      }),
    );
    expect((await knowledge.languageReview("source")).status).toBe("completed");
    expect(
      (await knowledge.suggestionsList("source")).suggestions[0]?.source.id,
    ).toBe("Local Review 日本語");
  });
  it.each([
    "not json",
    JSON.stringify({
      suggestions: [
        { segmentId: "unknown", after: "Changed", reason: "Unknown target" },
      ],
    }),
    JSON.stringify({
      suggestions: [
        {
          segmentId: "segment-0",
          after: "我們去十河田湖",
          reason: "Unchanged",
        },
      ],
    }),
    JSON.stringify({
      suggestions: [
        { segmentId: "segment-0", after: "\uD800", reason: "Invalid Unicode" },
      ],
    }),
    JSON.stringify({
      suggestions: [
        {
          segmentId: "segment-0",
          after: "Changed",
          reason: "Correction",
          timeline: { delete: true },
        },
      ],
    }),
    JSON.stringify({
      suggestions: [
        {
          segmentId: "segment-0",
          after: "Changed",
          reason: "Correction",
          confidence: 99,
        },
      ],
    }),
    JSON.stringify({ suggestions: [], execute: "delete media" }),
  ])(
    "keeps invalid provider output out of evidence and transcript: %s",
    async (output) => {
      const { knowledge, editor } = await fixture();
      const before = await editor.get("source");
      knowledge.registerLanguageProvider(languageProvider(async () => output));
      const job = await knowledge.languageReview("source");
      expect(job.status).toBe("failed");
      expect(job.errors?.[0]?.code).toBe("review.invalidOutput");
      expect((await knowledge.suggestionsList("source")).total).toBe(0);
      expect((await editor.get("source")).revision).toBe(before.revision);
    },
  );
  it("continues after a failed bounded batch, then retries it without duplicating completed suggestions", async () => {
    const { knowledge } = await fixture();
    let fail = true;
    const seen: number[] = [];
    knowledge.registerLanguageProvider(
      languageProvider(async (prompt) => {
        const id = Number(payload(prompt).segments[0]!.segmentId.split("-")[1]);
        seen.push(id);
        if (id === 1 && fail) throw new Error("temporary provider outage");
        return correction(prompt);
      }),
    );
    const job = await knowledge.languageReview("source", { batchSize: 1 });
    expect(job.status).toBe("failed");
    expect(seen).toEqual([0, 1, 2]);
    expect((await knowledge.suggestionsList("source")).total).toBe(2);
    expect(knowledge.batches(job.id).map((batch) => batch.status)).toEqual([
      "completed",
      "failed",
      "completed",
    ]);
    fail = false;
    expect((await knowledge.retryBatch(job.id, 1)).status).toBe("completed");
    expect((await knowledge.suggestionsList("source")).total).toBe(3);
    await expect(knowledge.retryBatch(job.id, 0)).rejects.toMatchObject({
      code: "request.invalid",
    });
  });
  it("streams completed batches and retains partial suggestions across cancellation/reopen", async () => {
    const context = await fixture();
    const { knowledge } = context;
    const controller = new AbortController();
    let calls = 0;
    let startedSecond!: () => void;
    const second = new Promise<void>((resolve) => {
      startedSecond = resolve;
    });
    knowledge.registerLanguageProvider(
      languageProvider(async (prompt, options) => {
        calls++;
        if (calls === 1) return correction(prompt);
        startedSecond();
        await new Promise<void>((_resolve, reject) =>
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          ),
        );
        return correction(prompt);
      }),
    );
    const updates: Job[] = [];
    const work = knowledge.languageReview("source", {
      jobId: "streaming-review",
      batchSize: 1,
      signal: controller.signal,
      onJob: (job) => updates.push(job),
    });
    await second;
    expect((await knowledge.suggestionsList("source")).total).toBe(1);
    expect(updates.at(-1)?.status).toBe("running");
    controller.abort();
    expect((await work).status).toBe("cancelled");
    expect(
      knowledge.batches("streaming-review").map((batch) => batch.status),
    ).toEqual(["completed", "cancelled", "cancelled"]);
    await context.reopen();
    expect((await context.knowledge.suggestionsList("source")).total).toBe(1);
    context.knowledge.registerLanguageProvider(
      languageProvider(async (prompt) => correction(prompt)),
    );
    expect(
      (await context.knowledge.retryBatch("streaming-review", 1)).status,
    ).toBe("cancelled");
    expect(
      (await context.knowledge.retryBatch("streaming-review", 2)).status,
    ).toBe("completed");
    expect((await context.knowledge.suggestionsList("source")).total).toBe(3);
  });
  it("rejects a provider result if the user changes the source revision while review is running", async () => {
    const { knowledge, editor } = await fixture();
    const initial = await editor.get("source");
    let release!: (text: string) => void;
    let prompted = "";
    knowledge.registerLanguageProvider(
      languageProvider((prompt) => {
        prompted = prompt;
        return new Promise((resolve) => {
          release = resolve;
        });
      }),
    );
    const work = knowledge.languageReview("source");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await editor.edit("source", {
      baseRevision: initial.revision!,
      requestId: "manual-during-review",
      commands: [
        { type: "replace-text", segmentId: "segment-0", text: "New user text" },
      ],
    });
    release(correction(prompted));
    expect((await work).errors?.[0]?.code).toBe("review.suggestionStale");
    expect((await knowledge.suggestionsList("source")).total).toBe(0);
  });
  it("durably skips failed batches and marks interrupted pending batches retryable after restart", async () => {
    const context = await fixture();
    const { knowledge, app } = context;
    knowledge.registerLanguageProvider(
      languageProvider(async () => {
        throw new Error("provider offline");
      }),
    );
    const job = await knowledge.languageReview("source", { batchSize: 2 });
    expect(job.status).toBe("failed");
    knowledge.skipBatch(job.id, 0);
    knowledge.skipBatch(job.id, 1);
    expect(
      app.catalog.listJobs().find((row) => row.id === job.id)?.status,
    ).toBe("completed");
    const state = await context.editor.get("source");
    app.catalog.saveJob({
      id: "interrupted",
      type: "language-review",
      assetId: "source",
      status: "running",
    });
    app.catalog.knowledge.saveBatch({
      jobId: "interrupted",
      index: 0,
      assetId: "source",
      sourceRevisionId: state.revision!,
      providerId: "explicit-test-language",
      segmentIds: ["segment-0"],
      status: "running",
      attempts: 1,
    });
    await context.reopen();
    expect(context.knowledge.batches("interrupted")[0]?.status).toBe(
      "cancelled",
    );
    context.knowledge.registerLanguageProvider(
      languageProvider(async (prompt) => correction(prompt)),
    );
    expect((await context.knowledge.retryBatch("interrupted", 0)).status).toBe(
      "completed",
    );
  });
  it("defaults to bounded batches rather than a 10,000-line prompt or one request per line", async () => {
    const { knowledge } = await fixture(
      Array.from({ length: 105 }, (_, id) => `Line ${id}`),
    );
    const lengths: number[] = [];
    knowledge.registerLanguageProvider(
      languageProvider(async (prompt) => {
        lengths.push(payload(prompt).segments.length);
        return JSON.stringify({ suggestions: [] });
      }),
    );
    expect((await knowledge.languageReview("source")).status).toBe("completed");
    expect(lengths).toEqual([50, 50, 5]);
  });
});
