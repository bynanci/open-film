import type { Job, ReviewBatch } from "@openfilm/core";
import type { ReviewRecoveryState } from "./api";

export interface LoadedReviewRecovery {
  batches: ReviewBatch[];
  recovery?: ReviewRecoveryState;
  recoveryError?: unknown;
}

/**
 * Batch recovery predates execution-owner recovery. Legacy `review` jobs still
 * need their failed/cancelled batches even though they have no owner-status API.
 */
export async function loadReviewRecovery(
  job: Job,
  readBatches: (jobId: string) => Promise<{ batches: ReviewBatch[] }>,
  readRecovery: (jobId: string) => Promise<ReviewRecoveryState>,
): Promise<LoadedReviewRecovery> {
  const batchState = await readBatches(job.id);
  if (job.type === "review") return { batches: batchState.batches };
  try {
    return {
      batches: batchState.batches,
      recovery: await readRecovery(job.id),
    };
  } catch (recoveryError) {
    return {
      batches: batchState.batches,
      recoveryError,
    };
  }
}
