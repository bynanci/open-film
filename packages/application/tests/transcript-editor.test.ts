import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { hashFile } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index";

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanups.splice(0).reverse()) await action();
});
async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-transcript-application-"),
  );
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "spoken # & 回憶.mp4");
  await writeFile(
    source,
    "original source identity bytes; no media decoding is needed for editing",
  );
  const sourceHash = await hashFile(source);
  const directory = join(root, "film.openfilm"),
    runtime = { userDataDirectory: join(root, "user-data") };
  let app = await OpenFilmApplication.create(
    directory,
    "Transcript isolation",
    {},
    runtime,
  );
  cleanups.push(() => app.close());
  app.catalog.upsertAsset({
    id: "source",
    uri: pathToFileURL(source).href,
    name: "spoken # & 回憶.mp4",
    mediaType: "video",
    duration: 20,
    contentHash: sourceHash,
    tags: [],
    state: { favorite: true, locked: true },
    metadata: { "user.notes": "keep" },
  });
  app.catalog.intelligence.replaceTranscript({
    id: "provider-result",
    assetId: "source",
    language: "zh",
    provenance: {
      providerId: "test-local",
      version: "1",
      model: "protocol-fixture",
      sourceHash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: [
      {
        id: "a",
        start: 0,
        end: 4,
        text: "我們去十河田湖",
        words: [
          { start: 0, end: 1, text: "我們" },
          { start: 1, end: 2, text: "去" },
          { start: 2, end: 4, text: "十河田湖" },
        ],
      },
      { id: "b", start: 5, end: 7, text: "天氣很好" },
      { id: "c", start: 8, end: 10, text: "youtube 很美" },
    ],
  });
  const story = app.generateStory({
    title: "Unrelated Story",
    assetIds: ["source"],
    targetDuration: 12,
    maxDuration: 20,
  });
  app.compose(story.id);
  await app.save();
  return {
    source,
    sourceHash,
    root,
    directory,
    runtime,
    get app() {
      return app;
    },
    async reopen() {
      await app.close();
      app = await OpenFilmApplication.open(directory, runtime);
      return app;
    },
  };
}
it("supports shared edits/search/replace/split/merge and independently restores text history across project close/reopen", async () => {
  const test = await fixture();
  let editor = test.app.transcriptEditor;
  const initial = await editor.get("source");
  const edit = await editor.edit("source", {
    baseRevision: initial.revision!,
    requestId: "manual-edit",
    commands: [
      { type: "replace-text", segmentId: "a", text: "我們去十和田湖" },
    ],
  });
  expect(edit.sourceHash).toBe(test.sourceHash);
  expect(edit.revisionInfo!.source).toBe("user");
  const split = await editor.edit("source", {
    baseRevision: edit.revision!,
    requestId: "split",
    commands: [
      {
        type: "split-segment",
        segmentId: "a",
        newSegmentId: "a-right",
        splitTime: 2,
        cursorOffset: 3,
      },
    ],
  });
  expect(split.document!.segments[0]!.end).toBe(2);
  const merged = await editor.edit("source", {
    baseRevision: split.revision!,
    requestId: "merge",
    commands: [
      { type: "merge-segment", segmentId: "a-right", direction: "previous" },
    ],
  });
  expect(merged.document!.segments[0]!.text).toBe("我們去十和田湖");
  const search = await editor.search("source", {
    query: "十和田",
    caseSensitive: true,
  });
  expect(search).toMatchObject({
    totalMatches: 1,
    totalSegments: 1,
    revision: merged.revision,
  });
  expect(search.matches[0]).toMatchObject({
    segmentId: "a",
    start: 0,
    ranges: [{ start: 3, end: 6 }],
  });
  const replaced = await editor.edit("source", {
    baseRevision: merged.revision!,
    requestId: "replace-all",
    commands: [
      {
        type: "replace-all",
        query: "youtube",
        replacement: "YouTube",
        caseSensitive: false,
      },
    ],
  });
  expect(replaced.document!.segments[2]!.text).toBe("YouTube 很美");
  const undone = await editor.undo("source", {
    baseRevision: replaced.revision!,
    requestId: "undo-all",
  });
  expect(undone.document!.segments[2]!.text).toBe("youtube 很美");
  editor = (await test.reopen()).transcriptEditor;
  const reopened = await editor.get("source");
  expect(reopened.revision).toBe(undone.revision);
  expect(reopened.canRedo).toBe(true);
  const redone = await editor.redo("source", {
    baseRevision: reopened.revision!,
    requestId: "redo-all",
  });
  expect(redone.document!.segments[2]!.text).toBe("YouTube 很美");
  expect(redone.document!.segments[0]!.alignmentState).toBe("text-edited");
});
it("never edits media bytes, project story/composition/trims/locks or UI/content locale when correcting text", async () => {
  const test = await fixture();
  const originalProject = structuredClone(test.app.project),
    originalAsset = test.app.catalog.getAsset("source"),
    originalBytes = await readFile(test.source),
    initial = await test.app.transcriptEditor.get("source");
  const saved = await test.app.transcriptEditor.edit("source", {
    baseRevision: initial.revision!,
    requestId: "isolation",
    commands: [
      {
        type: "replace-text",
        segmentId: "a",
        text: "Correct this transcript only",
      },
      { type: "delete-segment", segmentId: "b" },
    ],
  });
  expect(saved.document!.segments).toHaveLength(2);
  expect(test.app.project).toEqual(originalProject);
  expect(test.app.catalog.getAsset("source")).toEqual(originalAsset);
  expect(await readFile(test.source)).toEqual(originalBytes);
  await test.reopen();
  expect(test.app.project.stories).toEqual(originalProject.stories);
  expect(test.app.project.timelines).toEqual(originalProject.timelines);
  expect(test.app.catalog.getAsset("source")!.state.locked).toBe(true);
});
it("checks actual source identity before reading or mutating historical transcripts", async () => {
  const test = await fixture();
  const original = await test.app.transcriptEditor.get("source");
  await writeFile(test.source, "new content with different size and identity");
  await expect(test.app.transcriptEditor.get("source")).rejects.toMatchObject({
    code: "source.changed",
  });
  await expect(
    test.app.transcriptEditor.edit("source", {
      baseRevision: original.revision!,
      requestId: "changed-source",
      commands: [{ type: "delete-segment", segmentId: "a" }],
    }),
  ).rejects.toMatchObject({ code: "source.changed" });
  expect(
    test.app.catalog.transcripts.getFull("source", test.sourceHash)!
      .revisionInfo.id,
  ).toBe(original.revision);
});
it("requires request IDs, rejects unknown application fields, and exposes structured revision conflicts without altering saved state", async () => {
  const test = await fixture();
  const initial = await test.app.transcriptEditor.get("source");
  await expect(
    test.app.transcriptEditor.edit("source", {
      baseRevision: initial.revision!,
      commands: [{ type: "delete-segment", segmentId: "a" }],
    } as never),
  ).rejects.toMatchObject({ code: "transcript.invalidCommand" });
  await expect(
    test.app.transcriptEditor.edit("source", {
      baseRevision: initial.revision!,
      requestId: "invalid",
      commands: [{ type: "delete-segment", segmentId: "a" }],
      filesystem: "forbidden",
    } as never),
  ).rejects.toMatchObject({ code: "transcript.invalidCommand" });
  const saved = await test.app.transcriptEditor.edit("source", {
    baseRevision: initial.revision!,
    requestId: "valid",
    commands: [
      { type: "replace-text", segmentId: "a", text: "Manual text wins" },
    ],
  });
  await expect(
    test.app.transcriptEditor.edit("source", {
      baseRevision: initial.revision!,
      requestId: "stale",
      commands: [{ type: "delete-segment", segmentId: "b" }],
    }),
  ).rejects.toMatchObject({ code: "transcript.revisionConflict", status: 409 });
  expect((await test.app.transcriptEditor.get("source")).revision).toBe(
    saved.revision,
  );
});
it("dedupes retried undo and revision selection after reopen without resurrecting an old revision token", async () => {
  const test = await fixture();
  let editor = test.app.transcriptEditor;
  const initial = await editor.get("source");
  const edited = await editor.edit("source", {
    baseRevision: initial.revision!,
    requestId: "edit",
    commands: [{ type: "delete-segment", segmentId: "a" }],
  });
  const undoInput = {
    baseRevision: edited.revision!,
    requestId: "undo-lost-response",
  };
  const undo = await editor.undo("source", undoInput);
  expect(undo.revision).not.toBe(initial.revision);
  editor = (await test.reopen()).transcriptEditor;
  const replay = await editor.undo("source", undoInput);
  expect(replay.revision).toBe(undo.revision);
  expect(replay.acknowledgedRevision).toBe(undo.revision);
  const revisions = await editor.revisions("source", { limit: 2 });
  expect(revisions.total).toBe(3);
  expect(revisions.revisions).toHaveLength(2);
  const selected = await editor.selectRevision("source", {
    baseRevision: undo.revision!,
    requestId: "restore-provider",
    revisionId: initial.revision!,
  });
  expect(selected.revision).not.toBe(initial.revision);
  expect(selected.document!.segments[0]!.text).toBe("我們去十河田湖");
});
