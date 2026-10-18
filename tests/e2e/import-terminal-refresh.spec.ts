import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test, type Route } from "@playwright/test";
import { generateProposalMedia } from "../../fixtures/proposal-film/generate.mjs";
import { chooseImportFolder, createFilm, initialLocale } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310";

test("refreshes the library when an import finishes before its acknowledgement", async ({
  page,
  request,
}) => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-import-terminal-"));
  let releaseOldPoll!: () => void;
  const oldPollHeld = new Promise<void>((resolve) => {
    releaseOldPoll = resolve;
  });
  let pollIntercepted = false;
  let importAcknowledged = false;
  const holdOldPoll = async (route: Route) => {
    if (!importAcknowledged) {
      pollIntercepted = true;
      await oldPollHeld;
    }
    await route.continue();
  };
  const finishBeforeAcknowledgement = async (route: Route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const { jobId } = (await response.json()) as { jobId: string };
    await expect
      .poll(
        async () => {
          const jobsResponse = await request.get(`${base}/api/jobs`);
          expect(jobsResponse.ok()).toBe(true);
          const { jobs } = await jobsResponse.json();
          return jobs.find((job: { id: string }) => job.id === jobId)?.status;
        },
        { timeout: 60_000 },
      )
      .toBe("completed");
    // The old poll remains blocked. The first fresh refreshJobs must observe
    // this terminal import and refresh the catalog itself, without relying on
    // a later queued/running -> completed transition that will never occur.
    importAcknowledged = true;
    await route.fulfill({ response });
  };
  try {
    const fixture = await generateProposalMedia(join(root, "originals"));
    await initialLocale(page);
    await page.goto("/");
    await createFilm(page, {
      title: "Fast import recovery",
      path: join(root, "fast-import.openfilm"),
    });
    await chooseImportFolder(page, fixture.mediaDirectory);
    await expect(
      page.getByRole("button", {
        name: "Inspect 06-pixel-portrait.jpg",
        exact: true,
      }),
    ).toBeVisible({ timeout: 60_000 });
    // A running import can expose partial media before its final refresh. Hold
    // polling only after the first import is fully acknowledged and settled.
    await expect(
      page.getByText("Import complete", { exact: true }),
    ).toBeVisible({
      timeout: 60_000,
    });

    await page.route("**/api/jobs", holdOldPoll);
    await expect.poll(() => pollIntercepted).toBe(true);
    await page.route("**/api/import", finishBeforeAcknowledgement);
    await page.getByRole("button", { name: "Add media", exact: true }).click();
    await chooseImportFolder(page, fixture.rawDirectory);
    await expect(
      page.getByRole("region", { name: "Import media", exact: true }),
    ).toBeHidden({ timeout: 60_000 });
    await expect(
      page.getByText("Import complete", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `Inspect ${basename(fixture.byId["insta360-raw-video"]!)}`,
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    releaseOldPoll();
    await page.unroute("**/api/jobs", holdOldPoll);
    await page.unroute("**/api/import", finishBeforeAcknowledgement);
    await request.post(`${base}/api/project/close`, { data: {} });
    await rm(root, { recursive: true, force: true });
  }
});

test("loads the current project's media when its initial activity request fails", async ({
  page,
  request,
}) => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-initial-jobs-"));
  let failedJobsReads = 0;
  let releaseRetries!: () => void;
  const retriesHeld = new Promise<void>((resolve) => {
    releaseRetries = resolve;
  });
  try {
    const fixture = await generateProposalMedia(join(root, "originals"));
    expect(
      (
        await request.post(`${base}/api/project/create`, {
          data: {
            path: join(root, "available.openfilm"),
            title: "Available film",
          },
        })
      ).ok(),
    ).toBe(true);
    const imported = await request.post(`${base}/api/import`, {
      data: { files: [fixture.byId["pixel-photo"]!] },
    });
    expect(imported.ok()).toBe(true);
    const { jobId } = await imported.json();
    await expect
      .poll(
        async () => {
          const { jobs } = await (await request.get(`${base}/api/jobs`)).json();
          return jobs.find((job: { id: string }) => job.id === jobId)?.status;
        },
        { timeout: 60_000 },
      )
      .toBe("completed");
    await page.route("**/api/jobs", async (route) => {
      if (failedJobsReads === 0) {
        failedJobsReads++;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "operation.failed" }),
        });
      } else {
        await retriesHeld;
        await route.continue();
      }
    });
    await initialLocale(page);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Available film", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Inspect 06-pixel-portrait.jpg",
        exact: true,
      }),
    ).toBeVisible();
    expect(failedJobsReads).toBe(1);
  } finally {
    releaseRetries();
    await page.unroute("**/api/jobs");
    await request.post(`${base}/api/project/close`, { data: {} });
    await rm(root, { recursive: true, force: true });
  }
});
