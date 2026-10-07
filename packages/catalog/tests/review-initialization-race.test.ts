import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ProjectCatalog } from "../src/index.js";
import type { Job, ReviewBatch } from "@openfilm/core";
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-review-initialization-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const first = new ProjectCatalog(root);
  cleanup.push(() => first.close());
  const second = new ProjectCatalog(root);
  cleanup.push(() => second.close());
  const queued: Job = {
    id: "job",
    type: "language-review",
    assetId: "asset",
    status: "queued",
    reviewOwner: {
      host: "catalog-fixture-not-liveness-evidence",
      pid: 1,
      token: "original",
    },
    updatedAt: "2026-10-07T00:00:00Z",
  };
  first.saveJob(queued);
  const batches: ReviewBatch[] = [0, 1].map((index) => ({
    jobId: queued.id,
    index,
    assetId: "asset",
    sourceRevisionId: "revision",
    providerId: "fixture",
    segmentIds: [`segment-${index}`],
    status: "pending",
    attempts: 0,
  }));
  return { first, second, queued, batches };
}
it("initializes complete pending work against the unchanged queued checkpoint", async () => {
  const { first, second, queued, batches } = await fixture();
  first.knowledge.initializeReviewBatches(queued, batches);
  expect(second.listJobs().find((job) => job.id === queued.id)).toEqual(queued);
  expect(second.knowledge.batches(queued.id)).toEqual(batches);
});
it("cannot insert any work after a second SQLite connection wins recovery ownership", async () => {
  const { first, second, queued, batches } = await fixture();
  const recovered: Job = {
    ...queued,
    status: "failed",
    stage: "interrupted",
    reviewOwner: { ...queued.reviewOwner!, token: "recovered" },
  };
  expect(second.knowledge.recoverReviewJob(queued, recovered)).toBe(true);
  expect(() =>
    first.knowledge.initializeReviewBatches(queued, batches),
  ).toThrowError(expect.objectContaining({ status: 409 }));
  expect(second.knowledge.batches(queued.id)).toEqual([]);
  expect(second.listJobs().find((job) => job.id === queued.id)).toEqual(
    recovered,
  );
});
it("rolls back earlier inserts if a later batch is invalid, leaving initialization retryable", async () => {
  const { first, second, queued, batches } = await fixture();
  expect(() =>
    first.knowledge.initializeReviewBatches(queued, [
      batches[0]!,
      { ...batches[1]!, attempts: -1 },
    ]),
  ).toThrow(/Invalid review batch/);
  expect(second.knowledge.batches(queued.id)).toEqual([]);
  expect(second.listJobs().find((job) => job.id === queued.id)).toEqual(queued);
  first.knowledge.initializeReviewBatches(queued, batches);
  expect(second.knowledge.batches(queued.id)).toEqual(batches);
});
it("rejects repeated initialization without overwriting existing batch evidence", async () => {
  const { first, second, queued, batches } = await fixture();
  first.knowledge.initializeReviewBatches(queued, batches);
  const completed = {
    ...batches[0]!,
    status: "completed" as const,
    attempts: 1,
  };
  second.knowledge.saveBatch(completed);
  expect(() =>
    first.knowledge.initializeReviewBatches(queued, batches),
  ).toThrow(/already exist/);
  expect(second.knowledge.batches(queued.id)).toEqual([completed, batches[1]!]);
});
