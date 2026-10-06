import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationError,
  type TranscriptReviewSuggestion,
} from "@openfilm/core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile } from "@openfilm/media";

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-suggestion-cas-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.wav");
  await writeFile(source, "Source-identity fixture, not speech recognition.");
  const sourceHash = await hashFile(source);
  const userDataDirectory = join(root, "user-data");
  const directory = join(root, "film.openfilm");
  let app = await OpenFilmApplication.create(
    directory,
    "Suggestion lifecycle race",
    {},
    { userDataDirectory },
  );
  cleanup.push(() => app.close());
  app.catalog.upsertAsset({
    id: "source",
    uri: pathToFileURL(source).href,
    name: "source.wav",
    mediaType: "audio",
    duration: 10,
    contentHash: sourceHash,
    metadata: {},
    tags: [],
    state: { locked: true },
  });
  app.catalog.intelligence.replaceTranscript({
    id: "immutable-fixture-document",
    assetId: "source",
    language: "en",
    provenance: {
      providerId: "fixture-no-asr",
      model: "not-speech-recognition",
      version: "1",
      sourceHash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: [{ id: "segment-0", start: 0, end: 2, text: "teh memory" }],
  });
  app.knowledge.glossaryUpsert({
    scope: "project",
    source: "teh",
    replacement: "the",
    caseSensitive: true,
  });
  expect((await app.knowledge.glossaryReview("source")).status).toBe(
    "completed",
  );
  const suggestion = (await app.knowledge.suggestionsList("source"))
    .suggestions[0]!;
  await app.save();
  return {
    root,
    directory,
    userDataDirectory,
    source,
    sourceHash,
    suggestion,
    get app() {
      return app;
    },
    async reopen() {
      app.close();
      app = await OpenFilmApplication.open(directory, { userDataDirectory });
      return app;
    },
  };
}

describe("suggestion lifecycle compare-and-set", () => {
  it("rejects a Skip that read pending before another process atomically accepted the suggestion", async () => {
    const context = await fixture();
    const input = {
      baseRevision: context.suggestion.sourceRevisionId,
      requestId: "cross-process-accept",
    };
    const repository = fileURLToPath(new URL("../../../", import.meta.url));
    const worker = join(context.root, "accept-in-another-process.mts");
    await writeFile(
      worker,
      `import { OpenFilmApplication } from ${JSON.stringify(pathToFileURL(join(repository, "packages/application/src/index.ts")).href)};
const [directory, userDataDirectory, suggestionId, baseRevision, requestId] = process.argv.slice(2);
const app = await OpenFilmApplication.open(directory, { userDataDirectory });
try {
  const result = await app.knowledge.acceptSuggestion(suggestionId, { baseRevision, requestId });
  process.stdout.write(JSON.stringify({
    revision: result.revision,
    revisionInfo: result.revisionInfo,
    suggestion: app.catalog.knowledge.getSuggestion(suggestionId),
  }));
} finally {
  app.close();
}
`,
    );
    const require = createRequire(import.meta.url);
    let committed:
      | {
          revision: string;
          revisionInfo: unknown;
          suggestion: TranscriptReviewSuggestion;
        }
      | undefined;
    const store = context.app.catalog.knowledge;
    const realRead = store.getSuggestion.bind(store);
    // Finish the actual SELECT, then commit acceptance on a separate SQLite
    // process before returning its real, now-outdated read to the Skip writer.
    vi.spyOn(store, "getSuggestion").mockImplementationOnce((id) => {
      const observed = realRead(id);
      expect(observed?.status).toBe("pending");
      const accepted = spawnSync(
        process.execPath,
        [
          "--import",
          require.resolve("tsx"),
          worker,
          context.directory,
          context.userDataDirectory,
          id,
          input.baseRevision,
          input.requestId,
        ],
        {
          cwd: repository,
          encoding: "utf8",
          timeout: 20_000,
          env: {
            ...process.env,
            TSX_TSCONFIG_PATH: join(repository, "tsconfig.json"),
          },
        },
      );
      expect(accepted.error, accepted.stderr).toBeUndefined();
      expect(accepted.status, accepted.stderr).toBe(0);
      committed = JSON.parse(accepted.stdout);
      expect(committed?.suggestion.status).toBe("accepted");
      return observed;
    });

    let conflict: unknown;
    try {
      context.app.knowledge.skipSuggestion(context.suggestion.id);
    } catch (error) {
      conflict = error;
    }
    const evidence = store.getSuggestion(context.suggestion.id)!;
    const current = await context.app.transcriptEditor.get("source");
    expect(evidence).toEqual(committed!.suggestion);
    expect(evidence).toMatchObject({
      ...context.suggestion,
      status: "accepted",
      acceptedRevisionId: committed!.revision,
      requestId: input.requestId,
    });
    expect(evidence.acceptedAt).toBeDefined();
    expect(conflict).toBeInstanceOf(ApplicationError);
    expect(conflict).toMatchObject({
      code: "review.suggestionStale",
      status: 409,
    });
    expect(current.revision).toBe(committed!.revision);
    expect(current.revisionInfo).toEqual(committed!.revisionInfo);
    expect(current.document?.segments[0]?.text).toBe("the memory");
    expect(current.revisionInfo).toMatchObject({
      source: "review-suggestion",
      suggestionId: context.suggestion.id,
      parentRevisionId: input.baseRevision,
    });

    const database = new DatabaseSync(
      join(context.directory, "database.sqlite"),
      { readOnly: true },
    );
    try {
      expect(
        database
          .prepare(
            "SELECT request_id,asset_id,source_hash,revision_id FROM transcript_edit_requests WHERE request_id=?",
          )
          .get(input.requestId),
      ).toMatchObject({
        request_id: input.requestId,
        asset_id: "source",
        source_hash: context.sourceHash,
        revision_id: committed!.revision,
      });
      expect(
        JSON.parse(
          String(
            database
              .prepare(
                "SELECT data FROM transcript_revision_metadata WHERE revision_id=?",
              )
              .get(committed!.revision)!.data,
          ),
        ),
      ).toEqual(committed!.revisionInfo);
    } finally {
      database.close();
    }
    expect(
      (
        await context.app.knowledge.acceptSuggestion(
          context.suggestion.id,
          input,
        )
      ).revision,
    ).toBe(committed!.revision);
    expect((await context.app.transcriptEditor.revisions("source")).total).toBe(
      2,
    );
    await context.reopen();
    expect(
      context.app.catalog.knowledge.getSuggestion(context.suggestion.id),
    ).toEqual(evidence);
    expect((await context.app.transcriptEditor.get("source")).revision).toBe(
      committed!.revision,
    );
    expect(await hashFile(context.source)).toBe(context.sourceHash);
  });

  it.each(["pending", "stale"] as const)(
    "allows an idempotent Skip of %s evidence without transcript edits",
    async (status) => {
      const context = await fixture();
      if (status === "stale")
        context.app.catalog.knowledge.updateSuggestion(context.suggestion.id, {
          status,
        });
      const before = await context.app.transcriptEditor.get("source");
      const skipped = context.app.knowledge.skipSuggestion(
        context.suggestion.id,
      );
      expect(skipped).toEqual({ ...context.suggestion, status: "skipped" });
      expect(
        context.app.knowledge.skipSuggestion(context.suggestion.id),
      ).toEqual(skipped);
      expect((await context.app.transcriptEditor.get("source")).revision).toBe(
        before.revision,
      );
      expect(
        (await context.app.transcriptEditor.revisions("source")).total,
      ).toBe(1);
      await context.reopen();
      expect(
        context.app.catalog.knowledge.getSuggestion(context.suggestion.id),
      ).toEqual(skipped);
    },
  );
});
