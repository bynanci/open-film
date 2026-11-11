// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";

try {
  const expectedSha = process.env.OPENFILM_SOURCE_CANDIDATE;
  if (!/^[0-9a-f]{40}$/u.test(expectedSha ?? "")) {
    throw new Error(
      "OPENFILM_SOURCE_CANDIDATE must be a full lowercase 40-character Git SHA",
    );
  }
  const actualSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (actualSha !== expectedSha) {
    throw new Error(
      `Source checkout mismatch: expected ${expectedSha}, actual ${actualSha}`,
    );
  }
  process.stdout.write(
    JSON.stringify({
      verification: "source-head",
      expectedSha,
      actualSha,
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      eventName: process.env.GITHUB_EVENT_NAME ?? null,
      mergeIntegrationVerified: false,
    }) + "\n",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
