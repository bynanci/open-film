import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job, MediaAsset } from "@openfilm/core";
import type { LanguageProvider } from "@openfilm/plugin-sdk";
import { hashFile } from "@openfilm/media";
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
