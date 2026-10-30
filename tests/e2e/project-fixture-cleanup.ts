// SPDX-License-Identifier: Apache-2.0
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

interface FixturePage {
  isClosed(): boolean;
  goto(url: string): Promise<unknown>;
}
interface FixtureClient {
  post(
    url: string,
    options: { data: object; timeout?: number },
  ): Promise<{ status(): number }>;
  get(
    url: string,
    options?: { timeout?: number },
  ): Promise<{ ok(): boolean; json(): Promise<unknown> }>;
}
/** Test-only lifecycle owner. Measurement artifacts are outside this fixture;
 * closing/unlinking is deliberately after all benchmark samples and budgets. */
export async function cleanupProjectFixture(input: {
  page: FixturePage;
  request: FixtureClient;
  api: string;
  root: string;
  timeoutMs?: number;
}): Promise<{ closed: true; removed: true; attempts: number }> {
  if (!input.page.isClosed()) await input.page.goto("about:blank");
  const deadline = Date.now() + (input.timeoutMs ?? 10_000);
  let attempts = 0;
  for (;;) {
    const response = await input.request.post(`${input.api}/project/close`, {
      data: {},
      timeout: Math.max(100, Math.min(1000, deadline - Date.now())),
    });
    attempts++;
    const status = response.status();
    if (status === 200) break;
    if (status !== 409)
      throw new Error(
        `Fixture project close failed: HTTP${status}; fixture retained.`,
      );
    if (Date.now() >= deadline)
      throw new Error("Fixture project close remains busy; fixture retained.");
    await delay(50);
  }
  const state = await input.request.get(`${input.api}/project`, {
    timeout: 1000,
  });
  const data = await state.json();
  if (
    !state.ok() ||
    !data ||
    typeof data !== "object" ||
    !("project" in data) ||
    data.project !== null
  )
    throw new Error("Fixture project is still open; fixture retained.");
  // A confirmed close can still need a short Win32 handle-release interval.
  // Persistent locks propagate as failures; no benchmark budget is retried.
  await rm(input.root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
  return { closed: true, removed: true, attempts };
}
