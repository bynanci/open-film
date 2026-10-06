import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job, ReviewBatch } from "@openfilm/core";
import type { LanguageProvider } from "@openfilm/plugin-sdk";
import { hashFile } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";
import { createReviewOwner } from "../src/review-owner.js";

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

function provider(generate: LanguageProvider["generate"]): LanguageProvider {
  return {
    id: "explicit-retry-race-fixture",
    name: "Deterministic review transport fixture, not real AI",
    kind: "language",
    execution: "local",
    dataKinds: ["text", "transcripts"],
    generate,
  };
}

function correction(prompt: string) {
  const payload = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as {
    segments: { segmentId: string; text: string }[];
  };
  const segment = payload.segments[0]!;
  return JSON.stringify({
    suggestions: [
      {
        segmentId: segment.segmentId,
        after: `${segment.text} corrected`,
        reason: "Explicit deterministic provider fixture",
      },
    ],
  });
}

async function fixture(
  status: "failed" | "cancelled" = "failed",
  batchCount = 1,
) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-retry-cas-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.wav");
  await writeFile(source, "Source identity fixture, not speech recognition.");
  const sourceHash = await hashFile(source);
  const directory = join(root, "film.openfilm");
  const userDataDirectory = join(root, "user-data");
  const first = await OpenFilmApplication.create(
    directory,
    "Retry claim race",
    {},
    { userDataDirectory },
  );
  cleanup.push(() => first.close());
  first.catalog.upsertAsset({
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
  first.catalog.intelligence.replaceTranscript({
    id: "immutable-retry-fixture",
    assetId: "source",
    language: "en",
    provenance: {
      providerId: "fixture-no-asr",
      model: "not-speech-recognition",
      version: "1",
      sourceHash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: Array.from({ length: batchCount }, (_, index) => ({
      id: `segment-${index}`,
      start: index * 2,
      end: index * 2 + 2,
      text: "Original memory",
    })),
  });
  const controller = new AbortController();
  first.knowledge.registerLanguageProvider(
    provider(async () => {
      if (status === "cancelled") {
        controller.abort();
        throw new DOMException("Fixture cancellation", "AbortError");
      }
      throw new Error("Fixture provider outage");
    }),
  );
  const job = await first.runKnowledgeReview("source", {
    source: "language",
    signal: controller.signal,
    batchSize: 1,
  });
  expect(job.status).toBe(status);
  expect(first.knowledge.batches(job.id)[0]).toMatchObject({
    status,
    attempts: 1,
  });
  const revision = (await first.transcriptEditor.get("source")).revision!;
  await first.save();
  // Both normal applications and independent SQLite connections are open
  // before the race. Startup recovery is a separate ownership concern.
  const second = await OpenFilmApplication.open(directory, {
    userDataDirectory,
  });
  cleanup.push(() => second.close());
  let requests = 0;
  const generate: LanguageProvider["generate"] = async (prompt) => {
    requests++;
    return correction(prompt);
  };
  first.knowledge.registerLanguageProvider(provider(generate));
  second.knowledge.registerLanguageProvider(provider(generate));
  return { first, second, job, revision, requests: () => requests };
}

function holdPreparation(app: OpenFilmApplication) {
  const entered = deferred<void>();
  const release = deferred<void>();
  const read = app.transcriptEditor.get.bind(app.transcriptEditor);
  vi.spyOn(app.transcriptEditor, "get").mockImplementationOnce(
    async (...args) => {
      const actual = await read(...args);
      entered.resolve();
      await release.promise;
      return actual;
    },
  );
  return { entered: entered.promise, release: () => release.resolve() };
}

describe("atomic review batch retry claims", () => {
  it.each(["failed", "cancelled"] as const)(
    "rejects another connection's Skip while a %s retry prepares its real transcript",
    async (status) => {
      const { first, second, job, revision, requests } = await fixture(status);
      const preparation = holdPreparation(first);
      const work = first.retryKnowledgeReview(job.id, 0);
      let conflict: unknown;
      try {
        await preparation.entered;
        try {
          second.knowledge.skipBatch(job.id, 0);
        } catch (error) {
          conflict = error;
        }
      } finally {
        preparation.release();
      }
      expect((await work).status).toBe("completed");
      expect(conflict).toMatchObject({ code: "request.invalid" });
      expect(requests()).toBe(1);
      expect(second.knowledge.batches(job.id)[0]).toMatchObject({
        status: "completed",
        attempts: 2,
      });
      expect((await second.knowledge.suggestionsList("source")).total).toBe(1);
      expect((await first.transcriptEditor.get("source")).revision).toBe(
        revision,
      );
    },
  );

  it("allows only one provider request when two normal applications retry during preparation", async () => {
    const { first, second, job, requests } = await fixture();
    const preparation = holdPreparation(first);
    const work = first.retryKnowledgeReview(job.id, 0);
    let loser: unknown;
    try {
      await preparation.entered;
      try {
        await second.retryKnowledgeReview(job.id, 0);
      } catch (error) {
        loser = error;
      }
    } finally {
      preparation.release();
    }
    expect((await work).status).toBe("completed");
    expect(requests()).toBe(1);
    expect(loser).toMatchObject({ code: "request.invalid" });
    expect(second.knowledge.batches(job.id)[0]).toMatchObject({
      status: "completed",
      attempts: 2,
    });
    expect((await second.knowledge.suggestionsList("source")).total).toBe(1);
  });

  it("rejects a retry whose completed actual SELECT lost to another connection's Skip", async () => {
    const { first, second, job, requests } = await fixture();
    const read = first.catalog.knowledge.batches.bind(first.catalog.knowledge);
    vi.spyOn(first.catalog.knowledge, "batches").mockImplementationOnce(
      (id) => {
        const observed = read(id);
        expect(observed[0]?.status).toBe("failed");
        second.knowledge.skipBatch(id, 0);
        return observed;
      },
    );
    await expect(first.retryKnowledgeReview(job.id, 0)).rejects.toMatchObject({
      code: "request.invalid",
      status: 409,
    });
    expect(requests()).toBe(0);
    expect(first.knowledge.batches(job.id)[0]).toMatchObject({
      status: "skipped",
      attempts: 1,
    });
    expect((await second.knowledge.suggestionsList("source")).total).toBe(0);
  });

  it("rejects a Skip whose completed actual SELECT lost to another connection's retry claim", async () => {
    const { first, second, job, requests } = await fixture();
    const preparation = holdPreparation(first);
    const read = second.catalog.knowledge.batches.bind(
      second.catalog.knowledge,
    );
    let work:
      ReturnType<OpenFilmApplication["retryKnowledgeReview"]> | undefined;
    vi.spyOn(second.catalog.knowledge, "batches").mockImplementationOnce(
      (id) => {
        const observed = read(id);
        expect(observed[0]?.status).toBe("failed");
        work = first.retryKnowledgeReview(id, 0);
        return observed;
      },
    );
    let conflict: unknown;
    try {
      try {
        second.knowledge.skipBatch(job.id, 0);
      } catch (error) {
        conflict = error;
      }
      await preparation.entered;
    } finally {
      preparation.release();
    }
    expect((await work!).status).toBe("completed");
    expect(conflict).toMatchObject({ code: "request.invalid", status: 409 });
    expect(requests()).toBe(1);
    expect(second.knowledge.batches(job.id)[0]).toMatchObject({
      status: "completed",
      attempts: 2,
    });
  });

  it("restores its exact observed batch when transcript preparation fails before provider work", async () => {
    const { first, second, job, requests } = await fixture();
    const observed = first.knowledge.batches(job.id)[0]!;
    const originalJob = first.catalog
      .listJobs()
      .find((item) => item.id === job.id);
    vi.spyOn(first.transcriptEditor, "get").mockRejectedValueOnce(
      new Error("Source read failed before retry work"),
    );
    await expect(first.retryKnowledgeReview(job.id, 0)).rejects.toThrow(
      "Source read failed before retry work",
    );
    expect(second.knowledge.batches(job.id)[0]).toEqual(observed);
    expect(first.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
      originalJob,
    );
    expect(requests()).toBe(0);
    expect((await second.retryKnowledgeReview(job.id, 0)).status).toBe(
      "completed",
    );
    expect(requests()).toBe(1);
    expect(first.knowledge.batches(job.id)[0]?.attempts).toBe(2);
  });

  it("restores the claim when the actual transcript revision changed before retry", async () => {
    const { first, second, job, revision, requests } = await fixture();
    const observed = first.knowledge.batches(job.id)[0]!;
    await second.transcriptEditor.edit("source", {
      baseRevision: revision,
      requestId: "real-edit-before-retry",
      commands: [
        {
          type: "replace-text",
          segmentId: "segment-0",
          text: "User's new text",
        },
      ],
    });
    await expect(first.retryKnowledgeReview(job.id, 0)).rejects.toMatchObject({
      code: "review.suggestionStale",
      status: 409,
    });
    expect(first.knowledge.batches(job.id)[0]).toEqual(observed);
    expect(requests()).toBe(0);
    expect(second.knowledge.skipBatch(job.id, 0).status).toBe("skipped");
    expect(
      (await first.transcriptEditor.get("source")).document?.segments[0]?.text,
    ).toBe("User's new text");
  });

  it("restores the claim without provider work when the original provider is unavailable", async () => {
    const { first, second, job, requests } = await fixture();
    const observed = first.knowledge.batches(job.id)[0]!;
    first.knowledge.registerLanguageProvider({
      ...provider(async () => {
        throw new Error("An unauthorized replacement provider must not run.");
      }),
      id: "different-provider",
    });
    await expect(first.retryKnowledgeReview(job.id, 0)).rejects.toMatchObject({
      code: "review.providerUnavailable",
    });
    expect(second.knowledge.batches(job.id)[0]).toEqual(observed);
    expect(requests()).toBe(0);
    expect((await second.retryKnowledgeReview(job.id, 0)).status).toBe(
      "completed",
    );
    expect(first.knowledge.batches(job.id)[0]?.attempts).toBe(2);
  });

  it("records one failed retry attempt and permits the next actual retry without losing evidence", async () => {
    const { first, second, job, requests } = await fixture();
    let failures = 0;
    first.knowledge.registerLanguageProvider(
      provider(async () => {
        failures++;
        throw new Error("Retry provider outage");
      }),
    );
    expect((await first.retryKnowledgeReview(job.id, 0)).status).toBe("failed");
    expect(failures).toBe(1);
    expect(second.knowledge.batches(job.id)[0]).toMatchObject({
      status: "failed",
      attempts: 2,
      error: "Retry provider outage",
    });
    expect((await first.knowledge.suggestionsList("source")).total).toBe(0);
    expect((await second.retryKnowledgeReview(job.id, 0)).status).toBe(
      "completed",
    );
    expect(requests()).toBe(1);
    expect(first.knowledge.batches(job.id)[0]).toMatchObject({
      status: "completed",
      attempts: 3,
    });
    expect((await first.knowledge.suggestionsList("source")).total).toBe(1);
  });

  it("rolls back preflight restoration if another connection replaced the claimed job owner", async () => {
    const { first, second, job, requests } = await fixture();
    let claimed: ReviewBatch | undefined;
    let successor: Job | undefined;
    vi.spyOn(first.transcriptEditor, "get").mockImplementationOnce(async () => {
      claimed = second.knowledge.batches(job.id)[0]!;
      const owned = second.catalog
        .listJobs()
        .find((item) => item.id === job.id)!;
      successor = { ...owned, reviewOwner: createReviewOwner() };
      second.catalog.knowledge.compareAndSetReviewJob(owned, successor);
      throw new Error("Source read failed after ownership changed");
    });
    await expect(first.retryKnowledgeReview(job.id, 0)).rejects.toMatchObject({
      code: "request.invalid",
      status: 409,
    });
    expect(first.knowledge.batches(job.id)[0]).toEqual(claimed);
    expect(first.knowledge.batches(job.id)[0]).toMatchObject({
      status: "running",
      attempts: 2,
    });
    expect(first.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
      successor,
    );
    expect(requests()).toBe(0);
  });

  it("rolls back late provider evidence and preserves a successor's batch and job checkpoint", async () => {
    const { first, second, job, revision } = await fixture();
    const entered = deferred<string>();
    const result = deferred<string>();
    first.knowledge.registerLanguageProvider(
      provider((prompt) => {
        entered.resolve(prompt);
        return result.promise;
      }),
    );
    const work = first.retryKnowledgeReview(job.id, 0);
    const rejection = expect(work).rejects.toMatchObject({
      code: "request.invalid",
      status: 409,
    });
    const prompt = await entered.promise;
    const claimed = second.knowledge.batches(job.id)[0]!;
    const owned = second.catalog.listJobs().find((item) => item.id === job.id)!;
    const successorBatch: ReviewBatch = {
      ...claimed,
      status: "cancelled",
      error: "Successor checkpoint",
    };
    const successorJob: Job = {
      ...owned,
      status: "cancelled",
      reviewOwner: createReviewOwner(),
    };
    // A real conditional transaction replaces both checkpoints. The old
    // provider response must not publish evidence or run unconditional cleanup.
    second.catalog.knowledge.compareAndSetBatch(claimed, successorBatch, () =>
      second.catalog.knowledge.compareAndSetReviewJob(owned, successorJob),
    );
    result.resolve(correction(prompt));
    await rejection;
    expect(first.knowledge.batches(job.id)[0]).toEqual(successorBatch);
    expect(first.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
      successorJob,
    );
    expect((await first.knowledge.suggestionsList("source")).total).toBe(0);
    expect((await first.transcriptEditor.get("source")).revision).toBe(
      revision,
    );
  });
  it("rejects a different batch retry while the same job has a live claimed executor", async () => {
    const { first, second, job, requests } = await fixture("failed", 2);
    const preparation = holdPreparation(first);
    const work = first.retryKnowledgeReview(job.id, 0);
    try {
      await preparation.entered;
      await expect(
        second.retryKnowledgeReview(job.id, 1),
      ).rejects.toMatchObject({
        code: "jobs.busy",
        status: 409,
      });
    } finally {
      preparation.release();
    }
    expect((await work).status).toBe("failed");
    expect(requests()).toBe(1);
    expect(second.knowledge.batches(job.id)[1]).toMatchObject({
      status: "failed",
      attempts: 1,
    });
    expect((await second.retryKnowledgeReview(job.id, 1)).status).toBe(
      "completed",
    );
    expect(requests()).toBe(2);
    expect((await first.knowledge.suggestionsList("source")).total).toBe(2);
  });

  it.each(["pending", "running"] as const)(
    "keeps a completed single retry terminal when another legacy checkpoint is %s without an executor",
    async (status) => {
      const { first, second, job } = await fixture("failed", 2);
      const checkpoint = first.knowledge.batches(job.id)[1]!;
      second.catalog.knowledge.saveBatch({ ...checkpoint, status });
      expect((await first.retryKnowledgeReview(job.id, 0)).status).toBe(
        "cancelled",
      );
      expect(
        second.catalog.listJobs().find((item) => item.id === job.id)?.status,
      ).toBe("cancelled");
      expect(second.knowledge.batches(job.id)[1]).toEqual({
        ...checkpoint,
        status,
      });
    },
  );

  it("preserves a successor checkpoint when an initial provider invocation rejects late", async () => {
    const { first, second } = await fixture();
    const entered = deferred<void>();
    let rejectProvider!: (error: Error) => void;
    first.knowledge.registerLanguageProvider(
      provider(() => {
        entered.resolve();
        return new Promise<string>((_resolve, reject) => {
          rejectProvider = reject;
        });
      }),
    );
    const work = first.runKnowledgeReview("source", {
      source: "language",
      jobId: "initial-invocation-loses-owner",
    });
    const outcome = work.then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    await entered.promise;
    const claimed = second.knowledge.batches(
      "initial-invocation-loses-owner",
    )[0]!;
    const owned = second.catalog
      .listJobs()
      .find((item) => item.id === claimed.jobId)!;
    const successorBatch: ReviewBatch = {
      ...claimed,
      status: "cancelled",
      error: "Successor retained checkpoint",
    };
    const successorJob: Job = {
      ...owned,
      status: "cancelled",
      reviewOwner: createReviewOwner(),
    };
    second.catalog.knowledge.compareAndSetBatch(claimed, successorBatch, () =>
      second.catalog.knowledge.compareAndSetReviewJob(owned, successorJob),
    );
    rejectProvider(new Error("Old provider rejected after losing ownership"));
    await outcome;
    expect(first.knowledge.batches(claimed.jobId)[0]).toEqual(successorBatch);
    expect(
      first.catalog.listJobs().find((item) => item.id === claimed.jobId),
    ).toEqual(successorJob);
    expect((await first.knowledge.suggestionsList("source")).total).toBe(0);
  });

  it("preserves a successor's unfinished glossary checkpoint after an awaited transcript read fails", async () => {
    const { first, second } = await fixture("failed", 2);
    first.knowledge.glossaryUpsert({
      scope: "project",
      source: "Original",
      replacement: "Corrected",
    });
    const read = first.transcriptEditor.get.bind(first.transcriptEditor);
    let successorBatch: ReviewBatch | undefined;
    let successorJob: Job | undefined;
    vi.spyOn(first.transcriptEditor, "get")
      .mockImplementationOnce(read)
      .mockImplementationOnce(async (...args) => {
        await read(...args);
        const pending = second.knowledge.batches(
          "glossary-read-loses-owner",
        )[1]!;
        const owned = second.catalog
          .listJobs()
          .find((item) => item.id === pending.jobId)!;
        successorBatch = {
          ...pending,
          status: "running",
          attempts: pending.attempts + 1,
        };
        successorJob = { ...owned, reviewOwner: createReviewOwner() };
        second.catalog.knowledge.compareAndSetBatch(
          pending,
          successorBatch,
          () =>
            second.catalog.knowledge.compareAndSetReviewJob(
              owned,
              successorJob!,
            ),
        );
        throw new Error("Old glossary read failed after ownership changed");
      });
    await expect(
      first.runKnowledgeReview("source", {
        source: "glossary",
        jobId: "glossary-read-loses-owner",
        batchSize: 1,
      }),
    ).rejects.toMatchObject({ code: "request.invalid", status: 409 });
    expect(first.knowledge.batches("glossary-read-loses-owner")[1]).toEqual(
      successorBatch,
    );
    expect(
      first.catalog.listJobs().find((item) => item.id === successorJob?.id),
    ).toEqual(successorJob);
    expect(
      first.knowledge.batches("glossary-read-loses-owner")[0]?.status,
    ).toBe("completed");
    expect((await first.knowledge.suggestionsList("source")).total).toBe(1);
  });
});
