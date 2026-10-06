import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import type { TranscriptDocument } from "@openfilm/core";
import { ProjectCatalog } from "../src/index";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const hash = "source-content-hash";
function document(count = 3): TranscriptDocument {
  return {
    id: "immutable-provider-result",
    assetId: "source",
    language: "zh",
    provenance: {
      providerId: "local",
      version: "1",
      model: "tiny",
      sourceHash: hash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: Array.from({ length: count }, (_, index) => ({
      id: `segment-${index}`,
      start: index * 3,
      end: index * 3 + 2,
      text: `十河田湖 ${index}`,
      words: [
        {
          start: index * 3,
          end: index * 3 + 1,
          text: "十河田",
          confidence: 0.9,
        },
        { start: index * 3 + 1, end: index * 3 + 2, text: "湖" },
      ],
    })),
  };
}
async function fixture(count = 3) {
  const directory = await mkdtemp(
    join(tmpdir(), "openfilm-transcript-editor-"),
  );
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let catalog = new ProjectCatalog(directory);
  cleanup.push(() => catalog.close());
  catalog.upsertAsset({
    id: "source",
    uri: "file:///source.mp4",
    name: "spoken video",
    mediaType: "video",
    duration: 40_000,
    contentHash: hash,
    tags: [],
    state: { locked: true },
    metadata: { user: "preserve" },
  });
  catalog.intelligence.replaceTranscript(document(count));
  return {
    directory,
    get catalog() {
      return catalog;
    },
    reopen() {
      catalog.close();
      catalog = new ProjectCatalog(directory);
      return catalog;
    },
    database() {
      const db = new DatabaseSync(join(directory, "database.sqlite"));
      cleanup.push(() => db.close());
      return db;
    },
  };
}

it.each(["provider-" + "x".repeat(300), "provider\u0000\nsegment"])(
  "keeps newly ingested opaque provider IDs editable without rewriting evidence: %j",
  async (segmentId) => {
    const context = await fixture();
    const provider = { ...document(), id: "opaque-provider-result" };
    provider.segments[0]!.id = segmentId;
    context.catalog.intelligence.replaceTranscript(provider);
    let store = context.catalog.transcripts;
    const original = store.get("source", hash);
    expect(store.getSegment("source", hash, segmentId).segment).toEqual(
      provider.segments[0],
    );
    const replaced = store.edit("source", hash, {
      baseRevision: original.revision!,
      requestId: "opaque-replace",
      commands: [{ type: "replace-text", segmentId, text: "十和田湖" }],
    });
    const split = store.edit("source", hash, {
      baseRevision: replaced.revision!,
      requestId: "opaque-split",
      commands: [
        {
          type: "split-segment",
          segmentId,
          newSegmentId: "new-safe-segment",
          splitTime: 1,
          cursorOffset: 3,
        },
      ],
    });
    const merged = store.edit("source", hash, {
      baseRevision: split.revision!,
      requestId: "opaque-merge",
      commands: [{ type: "merge-segment", segmentId, direction: "next" }],
    });
    expect(merged.document!.segments[0]!.id).toBe(segmentId);
    const deleted = store.edit("source", hash, {
      baseRevision: merged.revision!,
      requestId: "opaque-delete",
      commands: [{ type: "delete-segment", segmentId }],
    });
    expect(deleted.document!.segments.map((segment) => segment.id)).toEqual([
      "segment-1",
      "segment-2",
    ]);
    const restored = store.undo("source", hash, {
      baseRevision: deleted.revision!,
      requestId: "opaque-undo",
    });
    expect(restored.document!.segments).toEqual(merged.document!.segments);
    store = context.reopen().transcripts;
    expect(store.get("source", hash)).toEqual(restored);
    expect(store.getFull("source", hash, original.revision)!.document).toEqual(
      provider,
    );
    expect(store.getSegment("source", hash, segmentId).segment.id).toBe(
      segmentId,
    );
  },
);

it("returns complete opaque NUL IDs from paged search, navigation lookups and reopened catalogs", async () => {
  const context = await fixture();
  const provider = { ...document(), id: "opaque-search-result" };
  const ids = [
    "provider-" + "x".repeat(300),
    "provider-\u0000\u0001\t\n %/#&",
    "last-segment",
  ];
  provider.segments = provider.segments.map((segment, index) => ({
    ...segment,
    id: ids[index]!,
    text: `Search match ${index}`,
  }));
  context.catalog.intelligence.replaceTranscript(provider);
  let store = context.catalog.transcripts;
  const query = { query: "Search match", limit: 1 };
  const first = store.search("source", hash, query);
  const next = store.search("source", hash, { ...query, offset: 1 });
  const previous = store.search("source", hash, query);
  expect(first.matches[0]!.segmentId).toBe(ids[0]);
  expect(next).toMatchObject({
    totalMatches: 3,
    totalSegments: 3,
    matches: [{ segmentId: ids[1], position: 1 }],
  });
  expect(previous).toEqual(first);
  expect(
    store.getSegment("source", hash, next.matches[0]!.segmentId).segment,
  ).toEqual(provider.segments[1]);
  expect(
    store.search("source", hash, {
      query: "sEaRcH mAtCh",
      caseSensitive: false,
      offset: 1,
      limit: 1,
    }).matches[0]!.segmentId,
  ).toBe(ids[1]);
  store = context.reopen().transcripts;
  expect(store.search("source", hash, { ...query, offset: 1 })).toEqual(next);
  expect(store.getFull("source", hash)!.document).toEqual(provider);
});

it.each([true, false])(
  "searches canonical text before and after NUL with exact paged ranges (caseSensitive=%s)",
  async (caseSensitive) => {
    const context = await fixture(4);
    const provider = { ...document(4), id: "nul-text-provider" };
    const texts = [
      "記憶😀 \u0000OpenFilm tail",
      "記憶😀 Open\u0000Film tail",
      "記憶😀 OpenFilm\u0000tail",
      "記憶😀 OpenFilm\u0000OpenFilm",
    ];
    provider.segments = provider.segments.map((segment, index) => ({
      ...segment,
      id: `provider\u0000segment-${index}`,
      text: texts[index]!,
    }));
    context.catalog.intelligence.replaceTranscript(provider);
    const options = {
      query: caseSensitive ? "OpenFilm" : "oPeNfIlM",
      caseSensitive,
      limit: 1,
    };
    for (const [offset, position] of [0, 2, 3].entries()) {
      const result = context.catalog.transcripts.search("source", hash, {
        ...options,
        offset,
      });
      expect(result).toMatchObject({ totalMatches: 4, totalSegments: 3 });
      expect(result.matches).toEqual([
        {
          segmentId: provider.segments[position]!.id,
          position,
          start: position * 3,
          end: position * 3 + 2,
          text: texts[position],
          ranges:
            position === 0
              ? [{ start: 6, end: 14 }]
              : position === 2
                ? [{ start: 5, end: 13 }]
                : [
                    { start: 5, end: 13 },
                    { start: 14, end: 22 },
                  ],
        },
      ]);
    }
    const afterNul = context.catalog.transcripts.search("source", hash, {
      query: caseSensitive ? "Film" : "fIlM",
      caseSensitive,
      offset: 1,
      limit: 1,
    });
    expect(afterNul).toMatchObject({
      totalMatches: 5,
      totalSegments: 4,
      matches: [
        {
          segmentId: provider.segments[1]!.id,
          text: texts[1],
          ranges: [{ start: 10, end: 14 }],
        },
      ],
    });
    expect(() =>
      context.catalog.transcripts.search("source", hash, {
        query: "Open\u0000Film",
        caseSensitive,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "transcript.invalidCommand" }),
    );
    const reopened = context.reopen();
    expect(
      reopened.transcripts.search("source", hash, {
        query: caseSensitive ? "Film" : "fIlM",
        caseSensitive,
        offset: 1,
        limit: 1,
      }),
    ).toEqual(afterNul);
    expect(reopened.transcripts.getFull("source", hash)!.document).toEqual(
      provider,
    );
  },
);

it.each([true, false])(
  "keeps canonical isolated-surrogate text distinct from literal replacement characters (caseSensitive=%s)",
  async (caseSensitive) => {
    const context = await fixture();
    const provider = { ...document(), id: "surrogate-text-provider" };
    const texts = [
      "記憶😀 \ud800Memory \udc00",
      "記憶😀 \ufffdMemory \ufffd",
      "記憶😀 Memory",
    ];
    provider.segments = provider.segments.map((segment, index) => ({
      ...segment,
      text: texts[index]!,
    }));
    context.catalog.intelligence.replaceTranscript(provider);
    const options = {
      query: caseSensitive ? "Memory" : "mEmOrY",
      caseSensitive,
    };
    const found = context.catalog.transcripts.search("source", hash, options);
    expect(found.totalMatches).toBe(3);
    expect(found.matches.map(({ text }) => text)).toEqual(texts);
    expect(found.matches.map(({ ranges }) => ranges)).toEqual([
      [{ start: 6, end: 12 }],
      [{ start: 6, end: 12 }],
      [{ start: 5, end: 11 }],
    ]);
    const replacement = context.catalog.transcripts.search("source", hash, {
      query: "\ufffd",
      caseSensitive,
    });
    expect(replacement).toMatchObject({
      totalMatches: 2,
      totalSegments: 1,
      matches: [
        {
          segmentId: "segment-1",
          text: texts[1],
          ranges: [
            { start: 5, end: 6 },
            { start: 13, end: 14 },
          ],
        },
      ],
    });
    expect(
      context.reopen().transcripts.search("source", hash, options),
    ).toEqual(found);
    expect(
      context.catalog.transcripts.getFull("source", hash)!.document,
    ).toEqual(provider);
  },
);

it("preserves provider provenance, every original revision and independent transcript history through edits and reopen", async () => {
  const test = await fixture();
  let store = test.catalog.transcripts;
  const original = store.get("source", hash),
    asset = test.catalog.getAsset("source");
  const edited = store.edit("source", hash, {
    baseRevision: original.revision!,
    requestId: "edit-one",
    commands: [
      { type: "replace-text", segmentId: "segment-0", text: "十和田湖" },
    ],
  });
  expect(edited).toMatchObject({
    canUndo: true,
    canRedo: false,
    revisionInfo: { parentRevisionId: original.revision, source: "user" },
  });
  expect(edited.document!.provenance).toEqual(document().provenance);
  expect(edited.document!.segments[0]).toMatchObject({
    text: "十和田湖",
    alignmentState: "text-edited",
  });
  expect(store.getFull("source", hash, original.revision)!.document).toEqual(
    document(),
  );
  expect(test.catalog.getAsset("source")).toEqual(asset);
  store = test.reopen().transcripts;
  expect(store.get("source", hash).revision).toBe(edited.revision);
  expect(store.get("source", hash).canUndo).toBe(true);
  const undone = store.undo("source", hash, {
    baseRevision: edited.revision!,
    requestId: "undo-one",
  });
  expect(undone.document!.segments).toEqual(document().segments);
  expect(undone.revision).not.toBe(original.revision);
  expect(undone.revision).not.toBe(edited.revision);
  const redone = store.redo("source", hash, {
    baseRevision: undone.revision!,
    requestId: "redo-one",
  });
  expect(redone.document!.segments[0]!.text).toBe("十和田湖");
  expect(
    new Set([
      original.revision,
      edited.revision,
      undone.revision,
      redone.revision,
    ]).size,
  ).toBe(4);
  expect(store.revisions("source", hash).revisions).toHaveLength(4);
  expect(
    store
      .revisions("source", hash)
      .revisions.every((revision) => revision.assetId === "source"),
  ).toBe(true);
});
it("makes replace-all a single undo unit and retains redo across reopen", async () => {
  const test = await fixture(12);
  let store = test.catalog.transcripts;
  const original = store.get("source", hash);
  const edited = store.edit("source", hash, {
    baseRevision: original.revision!,
    requestId: "replace-all",
    commands: [{ type: "replace-all", query: "十河田", replacement: "十和田" }],
  });
  expect(
    edited.document!.segments.every((segment) =>
      segment.text.includes("十和田"),
    ),
  ).toBe(true);
  const undone = store.undo("source", hash, {
    baseRevision: edited.revision!,
    requestId: "undo-all",
  });
  expect(undone.document!.segments).toEqual(document(12).segments);
  expect(undone.canUndo).toBe(false);
  store = test.reopen().transcripts;
  const redone = store.redo("source", hash, {
    baseRevision: undone.revision!,
    requestId: "redo-all",
  });
  expect(
    redone.document!.segments.every((segment) =>
      segment.text.includes("十和田"),
    ),
  ).toBe(true);
});
it("uses durable fingerprints to dedupe a lost response even after another edit and application restart", async () => {
  const test = await fixture();
  let store = test.catalog.transcripts;
  const original = store.get("source", hash);
  const input = {
    baseRevision: original.revision!,
    requestId: "lost-response",
    commands: [
      {
        type: "split-segment" as const,
        segmentId: "segment-0",
        newSegmentId: "split-right",
        splitTime: 1,
        cursorOffset: 2,
      },
    ],
  };
  const split = store.edit("source", hash, input);
  const next = store.edit("source", hash, {
    baseRevision: split.revision!,
    requestId: "newer-edit",
    commands: [
      {
        type: "replace-text",
        segmentId: "segment-1",
        text: "Manual newer text",
      },
    ],
  });
  store = test.reopen().transcripts;
  let hookCalls = 0;
  const replay = store.edit("source", hash, input, {}, () => hookCalls++);
  expect(replay.acknowledgedRevision).toBe(split.revision);
  expect(replay.revision).toBe(next.revision);
  expect(replay.document!.segments).toHaveLength(4);
  expect(hookCalls).toBe(0);
  expect(() =>
    store.edit("source", hash, {
      ...input,
      commands: [{ type: "delete-segment", segmentId: "segment-0" }],
    }),
  ).toThrow("request ID");
  expect(store.revisions("source", hash).total).toBe(3);
});
it("rejects stale revisions and command batches atomically without consuming request IDs", async () => {
  const test = await fixture();
  const store = test.catalog.transcripts,
    original = store.get("source", hash);
  const first = store.edit("source", hash, {
    baseRevision: original.revision!,
    requestId: "first",
    commands: [{ type: "replace-text", segmentId: "segment-0", text: "first" }],
  });
  expect(() =>
    store.edit("source", hash, {
      baseRevision: original.revision!,
      requestId: "conflict",
      commands: [{ type: "delete-segment", segmentId: "segment-1" }],
    }),
  ).toThrow("changed");
  expect(() =>
    store.edit("source", hash, {
      baseRevision: first.revision!,
      requestId: "failed-batch",
      commands: [
        {
          type: "replace-text",
          segmentId: "segment-1",
          text: "must roll back",
        },
        { type: "delete-segment", segmentId: "does-not-exist" },
      ],
    }),
  ).toThrow("no longer exists");
  expect(store.get("source", hash).revision).toBe(first.revision);
  expect(store.get("source", hash).document!.segments[1]!.text).toBe(
    "十河田湖 1",
  );
  const reused = store.edit("source", hash, {
    baseRevision: first.revision!,
    requestId: "failed-batch",
    commands: [
      {
        type: "replace-text",
        segmentId: "segment-1",
        text: "valid retry after failure",
      },
    ],
  });
  expect(reused.document!.segments[1]!.text).toBe("valid retry after failure");
});
it("commits suggestion status hooks with text/history/receipt or rolls everything back on hook failure", async () => {
  const test = await fixture();
  const store = test.catalog.transcripts,
    original = store.get("source", hash),
    database = test.database();
  database.exec("CREATE TABLE hook_evidence (revision TEXT NOT NULL)");
  expect(() =>
    store.edit(
      "source",
      hash,
      {
        baseRevision: original.revision!,
        requestId: "atomic-hook",
        commands: [
          {
            type: "replace-text",
            segmentId: "segment-0",
            text: "accepted text",
          },
        ],
      },
      { source: "review-suggestion", suggestionId: "suggestion" },
      () => {
        throw new Error("injected status failure");
      },
    ),
  ).toThrow("injected status failure");
  expect(store.get("source", hash).revision).toBe(original.revision);
  expect(store.revisions("source", hash).total).toBe(1);
  let calls = 0;
  const saved = store.edit(
    "source",
    hash,
    {
      baseRevision: original.revision!,
      requestId: "atomic-hook",
      commands: [
        { type: "replace-text", segmentId: "segment-0", text: "accepted text" },
      ],
    },
    { source: "review-suggestion", suggestionId: "suggestion" },
    () => {
      calls++;
      expect(store.getFull("source", hash)!.revisionInfo.source).toBe(
        "review-suggestion",
      );
    },
  );
  expect(calls).toBe(1);
  expect(saved.revisionInfo).toMatchObject({
    suggestionId: "suggestion",
    source: "review-suggestion",
  });
});
it("prevents retranscription from replacing concurrent user edits and retains successful prior revisions", async () => {
  const test = await fixture();
  const original = test.catalog.transcripts.get("source", hash);
  const edited = test.catalog.transcripts.edit("source", hash, {
    baseRevision: original.revision!,
    requestId: "user-while-provider-running",
    commands: [
      {
        type: "replace-text",
        segmentId: "segment-0",
        text: "Trust this manual correction",
      },
    ],
  });
  const newResult = { ...document(), id: "new-provider-result" };
  expect(() =>
    test.catalog.intelligence.replaceTranscript(newResult, {
      expectedRevision: original.revision!,
    }),
  ).toThrow("while transcription was running");
  expect(test.catalog.transcripts.get("source", hash).revision).toBe(
    edited.revision,
  );
  expect(test.catalog.transcripts.revisions("source", hash).total).toBe(2);
  test.catalog.intelligence.replaceTranscript(newResult, {
    expectedRevision: edited.revision!,
  });
  const latest = test.catalog.transcripts.get("source", hash);
  expect(latest.revisionInfo).toMatchObject({
    source: "provider",
    parentRevisionId: edited.revision,
  });
  expect(latest.canUndo).toBe(false);
  expect(
    test.catalog.transcripts.getFull("source", hash, edited.revision)!.document
      .segments[0]!.text,
  ).toBe("Trust this manual correction");
});
it("restores a chosen historical revision by creating a new undoable revision", async () => {
  const test = await fixture();
  const store = test.catalog.transcripts,
    original = store.get("source", hash);
  const edited = store.edit("source", hash, {
    baseRevision: original.revision!,
    requestId: "edit",
    commands: [{ type: "delete-segment", segmentId: "segment-0" }],
  });
  const selected = store.selectRevision("source", hash, {
    baseRevision: edited.revision!,
    requestId: "restore-original",
    revisionId: original.revision!,
  });
  expect(selected.revision).not.toBe(original.revision);
  expect(selected.document!.segments).toEqual(document().segments);
  expect(selected.canUndo).toBe(true);
  const undone = store.undo("source", hash, {
    baseRevision: selected.revision!,
    requestId: "undo-restore",
  });
  expect(undone.document!.segments).toHaveLength(2);
});
it("bounds 10,000-segment page/revision/search results and performs matching without loading corrupted unrelated JSON", async () => {
  const test = await fixture(10_000);
  const store = test.catalog.transcripts;
  expect(
    store.get("source", hash, { offset: 9800, limit: 200 }).document!.segments,
  ).toHaveLength(200);
  const db = test.database();
  db.prepare("UPDATE intelligence_segments SET data=? WHERE position=9989").run(
    "invalid JSON outside requested page",
  );
  const started = performance.now();
  const result = store.search("source", hash, {
    query: "十河田",
    offset: 9990,
    limit: 10,
  });
  const elapsed = performance.now() - started;
  expect(result).toMatchObject({
    totalMatches: 10_000,
    totalSegments: 10_000,
    offset: 9990,
    limit: 10,
  });
  expect(result.matches).toHaveLength(10);
  expect(result.matches[0]!.position).toBe(9990);
  expect(result.matches[0]!.ranges).toEqual([{ start: 0, end: 3 }]);
  expect(
    store.search("source", hash, {
      query: "十河田",
      caseSensitive: false,
      offset: 9990,
      limit: 10,
    }),
  ).toEqual(result);
  expect(elapsed).toBeLessThan(3000);
  expect(() => store.get("source", hash, { limit: 201 })).toThrow("limit");
  expect(() =>
    store.search("source", hash, { query: "十河田", limit: 201 }),
  ).toThrow("limit");
  expect(store.get("source", hash).document!.segments).toHaveLength(200);
  const selected = store.getSegment("source", hash, "segment-9805");
  expect(selected).toMatchObject({
    position: 9805,
    segment: { id: "segment-9805", text: "十河田湖 9805" },
  });
  expect(selected.revision).toBe(store.get("source", hash).revision);
  expect(() => store.getSegment("source", hash, "missing")).toThrow(
    "no longer exists",
  );
});
it("does not allow one media asset's revision to replace another asset or changed content", async () => {
  const test = await fixture();
  const store = test.catalog.transcripts,
    original = store.get("source", hash);
  const asset = test.catalog.getAsset("source")!;
  test.catalog.upsertAsset({ ...asset, contentHash: "new-content-hash" });
  expect(() => store.get("source", hash)).toThrow("source changed");
  expect(() =>
    store.edit("source", hash, {
      baseRevision: original.revision!,
      requestId: "changed-source",
      commands: [{ type: "delete-segment", segmentId: "segment-0" }],
    }),
  ).toThrow("source changed");
  test.catalog.upsertAsset(asset);
  expect(store.get("source", hash).revision).toBe(original.revision);
});
