import { expect, request as playwrightRequest } from "@playwright/test";
import type { Job } from "@openfilm/core";

export async function closeProject(api = "http://127.0.0.1:4310/api") {
  // An owned context starts cleanup with a fresh connection instead of an
  // idle pooled socket. HTTP failures and the existing busy-job flow remain
  // visible, and no transport failure is retried.
  const request = await playwrightRequest.newContext();
  try {
    const response = await request.post(`${api}/project/close`, { data: {} });
    if (response.ok()) return;
    expect(response.status()).toBe(409);
    const jobsResponse = await request.get(`${api}/jobs`);
    expect(jobsResponse.ok(), `/jobs: ${await jobsResponse.text()}`).toBe(true);
    const { jobs } = (await jobsResponse.json()) as { jobs: Job[] };
    for (const job of jobs.filter((item) =>
      ["queued", "running"].includes(item.status),
    )) {
      const cancelled = await request.post(`${api}/jobs/${job.id}/cancel`, {
        data: {},
      });
      expect([200, 409]).toContain(cancelled.status());
    }
    await expect
      .poll(
        async () =>
          (await request.post(`${api}/project/close`, { data: {} })).status(),
        { timeout: 30_000 },
      )
      .toBe(200);
  } finally {
    await request.dispose();
  }
}
