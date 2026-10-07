import { describe, expect, it, vi } from "vitest";
import type { Job, ReviewBatch } from "@openfilm/core";
import { loadReviewRecovery } from "../../apps/desktop/src/reviewRecovery";

const batch: ReviewBatch = {
  jobId: "legacy",
  index: 0,
  assetId: "asset",
  sourceRevisionId: "revision",
  providerId: "legacy",
  segmentIds: ["segment"],
  status: "cancelled",
  attempts: 1,
};

describe("desktop review recovery loading", () => {
  it("keeps legacy review batches without requesting owner recovery status", async () => {
    const job: Job = {
      id: "legacy",
      type: "review",
      status: "cancelled",
    };
    const readBatches = vi.fn(async () => ({ batches: [batch] }));
    const readRecovery = vi.fn(async () => {
      throw Object.assign(new Error("not found"), { status: 404 });
    });

    await expect(
      loadReviewRecovery(job, readBatches, readRecovery),
    ).resolves.toEqual({ batches: [batch] });
    expect(readBatches).toHaveBeenCalledWith(job.id);
    expect(readRecovery).not.toHaveBeenCalled();
  });

  it("retains modern batches when recovery-status lookup fails independently", async () => {
    const job: Job = {
      id: "modern",
      type: "language-review",
      status: "failed",
    };
    const readBatches = vi.fn(async () => ({
      batches: [{ ...batch, jobId: job.id }],
    }));
    const failure = new Error("recovery status unavailable");
    const readRecovery = vi.fn(async () => {
      throw failure;
    });

    const loaded = await loadReviewRecovery(job, readBatches, readRecovery);
    expect(loaded.batches).toEqual([{ ...batch, jobId: job.id }]);
    expect(loaded.recovery).toBeUndefined();
    expect(loaded.recoveryError).toBe(failure);
  });
});
