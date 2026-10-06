import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  validateReviewSuggestion,
  type MediaAsset,
  type ReviewSuggestion,
} from "@openfilm/core";
import { hashFile } from "@openfilm/media";
import type { LanguageProvider, ProviderDataKind } from "@openfilm/plugin-sdk";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const opaqueIds = [
  "provider-" + "長".repeat(300),
  "provider\tbranch\nreview",
  "provider\u0000tail",
  "provider\ud800",
  "provider\udc00",
  " \tprovider\n ",
  "  provider with spaces  ",
];
function evidence(source: ReviewSuggestion["source"]): ReviewSuggestion {
  return {
    id: "suggestion-1",
    kind: "transcript-correction",
    target: { assetId: "source", segmentId: "segment-0" },
    sourceRevisionId: "revision-1",
    before: "Memory",
    after: "Corrected memory",
    reason: "Explicit fixture correction",
    source,
    status: "pending",
    createdAt: "2026-10-06T00:00:00Z",
  };
}
function payload(prompt: string) {
  return JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as {
    language: string;
    segments: { segmentId: string; text: string }[];
    glossary: { source: string; replacement: string }[];
  };
}
function corrections(prompt: string) {
  return JSON.stringify({
    suggestions: payload(prompt).segments.map((segment) => ({
      segmentId: segment.segmentId,
      after: `${segment.text} corrected`,
      reason: "Deterministic provider fixture, not real language model QA",
    })),
  });
}
function provider(id: string, remote = false) {
  const generate = vi.fn<LanguageProvider["generate"]>(async (prompt) =>
    corrections(prompt),
  );
  const descriptor: LanguageProvider = {
    id,
    name: "Opaque identifier fixture, not a real AI service",
    kind: "language",
    execution: remote ? "remote" : "local",
    ...(remote ? { endpoint: "https://review.example.invalid" } : {}),
    dataKinds: ["text", "transcripts"],
    generate,
  };
  return { descriptor, generate };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-review-provider-id-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "private-identity.wav");
  await writeFile(
    source,
    "Private identity bytes, not decoded as real ASR audio.",
  );
  const sourceHash = await hashFile(source);
  const asset: MediaAsset = {
    id: "source",
    uri: pathToFileURL(source).href,
    name: "private-identity.wav",
    mediaType: "audio",
    duration: 10,
    contentHash: sourceHash,
    metadata: { privateGPS: "private location must not be sent" },
    tags: [],
    state: { locked: true },
  };
  const runtime = { userDataDirectory: join(root, "user-data") };
  let app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Provider identity",
    {},
    runtime,
  );
  cleanup.push(() => app.close());
  app.catalog.upsertAsset(asset);
  app.catalog.intelligence.replaceTranscript({
    id: "provider-transcript",
    assetId: asset.id,
    language: "en",
    provenance: {
      providerId: "fixture-no-asr",
      version: "1",
      sourceHash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: ["First memory", "Private second memory"].map((text, index) => ({
      id: `segment-${index}`,
      start: index * 2,
      end: index * 2 + 1,
      text,
      words: [{ start: index * 2, end: index * 2 + 1, text }],
    })),
  });
  return {
    asset,
    sourceHash,
    get app() {
      return app;
    },
    async reopen() {
      const directory = app.directory;
      app.close();
      app = await OpenFilmApplication.open(directory, runtime);
    },
  };
}

describe("provider identity is portable evidence, separate from generated IDs", () => {
  it.each(opaqueIds)(
    "reviews, deduplicates and preserves exact provider ID %j through acceptance and reopen",
    async (id) => {
      const context = await fixture();
      const testProvider = provider(id);
      context.app.knowledge.registerLanguageProvider(testProvider.descriptor);
      expect(context.app.knowledge.languageProvider().provider?.id).toBe(id);
      const original = await context.app.transcriptEditor.get("source");
      const first = await context.app.knowledge.languageReview("source");
      expect(first.status).toBe("completed");
      expect(context.app.knowledge.batches(first.id)).toMatchObject([
        { providerId: id, status: "completed" },
      ]);
      const created = await context.app.knowledge.suggestionsList("source");
      expect(created.total).toBe(2);
      expect(
        created.suggestions.every((suggestion) => suggestion.source.id === id),
      ).toBe(true);
      const repeated = await context.app.knowledge.languageReview("source");
      expect(repeated.status).toBe("completed");
      expect(
        (await context.app.knowledge.suggestionsList("source")).suggestions,
      ).toEqual(created.suggestions);
      expect(testProvider.generate).toHaveBeenCalledTimes(2);
      const accepted = created.suggestions.find(
        (suggestion) => suggestion.target.segmentId === "segment-0",
      )!;
      const skipped = created.suggestions.find(
        (suggestion) => suggestion.target.segmentId === "segment-1",
      )!;
      context.app.knowledge.skipSuggestion(skipped.id);
      const input = {
        baseRevision: original.revision!,
        requestId: "accept-opaque-provider",
      };
      const edited = await context.app.knowledge.acceptSuggestion(
        accepted.id,
        input,
      );
      // Retrying the acceptance keeps its original evidence and does not duplicate an edit.
      const replayed = await context.app.knowledge.acceptSuggestion(
        accepted.id,
        input,
      );
      expect(replayed.revision).toBe(edited.revision);
      expect(replayed.document).toEqual(edited.document);
      const full = context.app.catalog.transcripts.getFull(
        "source",
        context.sourceHash,
      )!;
      expect(full.revisionInfo).toMatchObject({
        source: "review-suggestion",
        suggestionId: accepted.id,
      });
      expect(full.document.provenance).toEqual(original.document!.provenance);
      const saved = await context.app.knowledge.suggestionsList("source");
      expect(
        saved.suggestions.find((suggestion) => suggestion.id === accepted.id),
      ).toMatchObject({
        source: { type: "provider", id },
        status: "accepted",
        acceptedRevisionId: edited.revision,
      });
      expect(
        saved.suggestions.find((suggestion) => suggestion.id === skipped.id),
      ).toMatchObject({ source: { type: "provider", id }, status: "skipped" });
      await context.reopen();
      expect(context.app.knowledge.batches(first.id)[0]?.providerId).toBe(id);
      expect(context.app.knowledge.batches(repeated.id)[0]?.providerId).toBe(
        id,
      );
      expect(await context.app.knowledge.suggestionsList("source")).toEqual(
        saved,
      );
      expect(
        (
          await context.app.transcriptEditor.get("source")
        ).document?.segments.map((segment) => segment.text),
      ).toEqual(["First memory corrected", "Private second memory"]);
      expect(
        (await context.app.transcriptEditor.revisions("source")).revisions,
      ).toHaveLength(2);
    },
  );

  it.each([
    ["opaque\ud800", "opaque\ufffd"],
    ["opaque\udc00", "opaque\ufffd"],
    ["opaque\u0000tail", "opaque"],
  ])(
    "does not conflate %j with %j in persisted deduplication evidence",
    async (firstId, secondId) => {
      const context = await fixture();
      for (const id of [firstId, secondId]) {
        context.app.knowledge.registerLanguageProvider(provider(id).descriptor);
        const first = await context.app.knowledge.languageReview("source");
        expect(first.status).toBe("completed");
        expect(context.app.knowledge.batches(first.id)[0]?.providerId).toBe(id);
        expect(
          (await context.app.knowledge.languageReview("source")).status,
        ).toBe("completed");
      }
      const saved = await context.app.knowledge.suggestionsList("source");
      expect(saved.total).toBe(4);
      expect(
        saved.suggestions.filter(
          (suggestion) => suggestion.source.id === firstId,
        ),
      ).toHaveLength(2);
      expect(
        saved.suggestions.filter(
          (suggestion) => suggestion.source.id === secondId,
        ),
      ).toHaveLength(2);
      await context.reopen();
      expect(await context.app.knowledge.suggestionsList("source")).toEqual(
        saved,
      );
    },
  );

  it("accepts every original nonblank provider ID without normalization and rejects blank/nonstring IDs", () => {
    for (const id of opaqueIds)
      expect(
        validateReviewSuggestion(evidence({ type: "provider", id })).source.id,
      ).toBe(id);
    for (const id of ["", " \t\r\n", undefined, null, 1, []])
      expect(() =>
        validateReviewSuggestion({
          ...evidence({ type: "provider", id: "valid" }),
          source: { type: "provider", id },
        }),
      ).toThrow();
  });

  it("keeps generated suggestion and rule/glossary IDs strict", () => {
    const invalid = [
      "x".repeat(257),
      "opaque\t",
      "opaque\n",
      "opaque\u0000",
      "opaque\ud800",
      "opaque\udc00",
    ];
    for (const id of invalid) {
      expect(() =>
        validateReviewSuggestion({
          ...evidence({ type: "provider", id: "valid" }),
          id,
        }),
      ).toThrow();
      for (const type of ["rule", "glossary"] as const)
        expect(() =>
          validateReviewSuggestion(evidence({ type, id })),
        ).toThrow();
    }
  });

  it("requires exact opaque remote identity consent and sends only selected transcript text", async () => {
    const context = await fixture();
    const id = " remote\u0000\ud800\tprovider ";
    const testProvider = provider(id, true);
    context.app.knowledge.registerLanguageProvider(testProvider.descriptor);
    const run = () =>
      context.app.knowledge.languageReview("source", {
        segmentIds: ["segment-0"],
      });
    await expect(run()).rejects.toMatchObject({
      code: "review.providerUnavailable",
    });
    expect(testProvider.generate).not.toHaveBeenCalled();
    for (const dataKinds of [
      ["text"],
      ["transcripts"],
      ["text", "transcripts", "text"],
      ["not-a-kind"],
    ])
      expect(() =>
        context.app.knowledge.grantConsent({
          providerId: id,
          dataKinds: dataKinds as ProviderDataKind[],
          grantedAt: new Date().toISOString(),
        }),
      ).toThrow();
    expect(() =>
      context.app.knowledge.grantConsent({
        providerId: " remote\u0000\ufffd\tprovider ",
        dataKinds: ["text", "transcripts"],
        grantedAt: new Date().toISOString(),
      }),
    ).toThrow();
    await expect(run()).rejects.toMatchObject({
      code: "review.providerUnavailable",
    });
    expect(testProvider.generate).not.toHaveBeenCalled();
    context.app.knowledge.grantConsent({
      providerId: id,
      dataKinds: ["text", "transcripts"],
      grantedAt: new Date().toISOString(),
    });
    expect((await run()).status).toBe("completed");
    expect(testProvider.generate).toHaveBeenCalledOnce();
    const prompt = testProvider.generate.mock.calls[0]![0];
    expect(payload(prompt)).toEqual({
      language: "en",
      segments: [{ segmentId: "segment-0", text: "First memory" }],
      glossary: [],
    });
    for (const privateValue of [
      "Private second memory",
      "privateGPS",
      context.asset.metadata.privateGPS,
      context.asset.uri,
      context.asset.name,
      "Private identity bytes",
    ])
      expect(prompt).not.toContain(privateValue);
    expect(
      (await context.app.knowledge.suggestionsList("source")).suggestions[0]
        ?.source.id,
    ).toBe(id);
    context.app.knowledge.revokeConsent(id);
    await expect(run()).rejects.toMatchObject({
      code: "review.providerUnavailable",
    });
    expect(testProvider.generate).toHaveBeenCalledOnce();
    expect(context.app.hasActiveJobs).toBe(false);
  });
});
