// SPDX-License-Identifier: Apache-2.0
import type { Job } from "@openfilm/core";

/** Background preview children must not hide the user's foreground completion. */
export function latestActivityJob(jobs: readonly Job[]): Job | undefined {
  return jobs.find((job) => job.type !== "proxy") ?? jobs[0];
}
