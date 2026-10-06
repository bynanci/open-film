import { test, expect } from "@playwright/test";
import {
  initialLocale,
  navigate,
  createFilm,
  chooseImportFolder,
  openFilm,
  openAdvancedExports,
  uiText,
} from "./ui-helpers.js";
import type { MediaAsset, OpenFilmProject } from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";

test.use({ actionTimeout: 15_000 });
test.beforeEach(async ({ page }) => {
  await initialLocale(page);
});

const cleanupFixtures: Array<() => Promise<void>> = [];
test.afterAll(async () => {
  const response = await fetch("http://127.0.0.1:4310/api/project/close", {
    method: "POST",
  });
  if (!response.ok)
    throw new Error(`Could not close test project: ${await response.text()}`);
  await Promise.all(cleanupFixtures.map((cleanup) => cleanup()));
});

// These tests intentionally use the real loopback service, SQLite, FFmpeg, and
// imported media. A browser screenshot or mocked catalog cannot validate a film.
test("creates a local film, edits its story, renders, exports, and reopens it", async ({
  page,
  request,
}) => {
  const fixture = await createDesktopFixture();
  const unexpectedRequests: string[] = [];
  page.on("request", (item) => {
    if (!["127.0.0.1", "localhost"].includes(new URL(item.url()).hostname))
      unexpectedRequests.push(item.url());
  });
  try {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "A story worth telling.",
      }),
    ).toBeVisible();
    await createFilm(page, {
      title: "The moments between",
      path: fixture.project,
    });
    await expect(
      page.getByRole("heading", { name: "The moments between" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Every film begins with a moment." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add your first media" }).click();
    await chooseImportFolder(page, fixture.media);
    await expect(
      page.getByText("Import complete", { exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole("button", { name: "Inspect 01-photo.png", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("1 file needs attention", { exact: true }),
    ).toBeVisible();
    const response = await request.get("http://127.0.0.1:4310/api/assets");
    const catalog = (await response.json()) as {
      assets: MediaAsset[];
      total: number;
    };
    expect(catalog.total).toBe(11);
    await page.screenshot({
      path: test.info().outputPath("library.png"),
      fullPage: true,
    });
    await expect
      .poll(() =>
        page
          .locator(".contact-sheet img")
          .first()
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);

    await page
      .getByRole("button", { name: "Favorite 01-photo.png", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Unfavorite 01-photo.png",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Inspect 01-photo.png", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Rate 5 stars", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Rate 5 stars", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Always include", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Always include", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Close media details" }).click();
    await page
      .getByRole("button", { name: "Reject 02-photo-copy.png", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Restore 02-photo-copy.png",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Find moments & duplicates" })
      .click();
    await page
      .getByRole("button", { name: "Similar media", exact: true })
      .click();
    await expect(
      page
        .getByRole("button", { name: /The same memory, more than once/ })
        .first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /The same memory, more than once/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: /Exact duplicates/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "All media", exact: false })
      .first()
      .click();

    await navigate(page, "story");
    await page.getByRole("button", { name: "Create your first story" }).click();
    await page
      .getByLabel("Story title", { exact: true })
      .fill("A life in little moments");
    await page.getByLabel("Starting structure").selectOption("proposal-film");
    await page.getByLabel("Target (seconds)").fill("12");
    await page.getByLabel("Maximum (seconds)").fill("20");
    await page.getByRole("button", { name: "Plan story", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Cold Open", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("stories.png"),
      fullPage: true,
    });
    await expect(page.locator(".beat-list button")).toHaveCount(9);
    await page
      .getByLabel("Beat title", { exact: true })
      .fill("The moment before");
    await page
      .getByLabel("Beat intent", { exact: true })
      .fill("A small moment that opens the story.");
    const candidate = page
      .locator(".candidate-sheet .asset-image-button")
      .first();
    await expect(candidate).toBeVisible();
    await candidate.click();
    await expect(candidate).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Save beat", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "The moment before", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Compose film", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", {
          name: uiText("en-US", "editor.timeline"),
          exact: true,
        })
        .getByRole("status")
        .filter({
          hasText: new RegExp(`^${uiText("en-US", "editor.save.saved")}$`),
        }),
    ).toBeVisible();
    const state = (await (
      await request.get("http://127.0.0.1:4310/api/project")
    ).json()) as { project: OpenFilmProject };
    const composition = state.project.timelines.at(-1)!;
    expect(composition.duration).toBeGreaterThan(0);
    expect(composition.duration).toBeLessThanOrEqual(20);
    const selectedAssets = composition.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.assetId),
    );
    expect(selectedAssets).toContain(
      catalog.assets.find((asset) => asset.name === "01-photo.png")!.id,
    );
    expect(selectedAssets).not.toContain(
      catalog.assets.find((asset) => asset.name === "02-photo-copy.png")!.id,
    );
    await page
      .getByRole("button", { name: "Render preview", exact: true })
      .click();
    const preview = page.getByLabel("Film preview");
    await expect(preview).toBeVisible({ timeout: 60_000 });

    await expect
      .poll(() =>
        preview.evaluate((element) => (element as HTMLVideoElement).duration),
      )
      .toBeGreaterThan(0);
    await preview.evaluate((element) => (element as HTMLVideoElement).play());
    await expect
      .poll(() =>
        preview.evaluate(
          (element) => (element as HTMLVideoElement).currentTime,
        ),
      )
      .toBeGreaterThan(0);
    await preview.evaluate((element) => (element as HTMLVideoElement).pause());
    await page.screenshot({
      path: test.info().outputPath("timeline.png"),
      fullPage: true,
    });
    await navigate(page, "export");
    await openAdvancedExports(page);
    await page.getByRole("button", { name: /OpenTimelineIO/ }).click();
    await expect(
      page.getByText("Saved to your project", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".export-result code")).toContainText(
      "timeline.otio",
    );
    expect(await fixture.assertOriginalsUnchanged()).toBe(true);
    expect(unexpectedRequests).toEqual([]);

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "The moments between" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Unfavorite 01-photo.png",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Switch project", exact: true })
      .click();
    await openFilm(page, fixture.project);
    await expect(
      page.getByRole("heading", { name: "The moments between" }),
    ).toBeVisible();
    await navigate(page, "story");
    await expect(
      page.getByRole("heading", { name: "The moment before", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(
      page.getByRole("heading", { name: "Find the thread." }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
    await page.screenshot({
      path: test.info().outputPath("mobile-story.png"),
      fullPage: true,
    });
  } finally {
    cleanupFixtures.push(fixture.cleanup);
  }
});

test("cancels a real import and keeps the project available", async ({
  page,
  request,
}) => {
  const fixture = await createDesktopFixture(40);
  try {
    await page.goto("/");
    if (
      await page
        .getByRole("button", { name: "Switch project", exact: true })
        .isVisible()
    ) {
      await page
        .getByRole("button", { name: "Switch project", exact: true })
        .click();
    }
    await createFilm(page, {
      title: "An unfinished import",
      path: fixture.project,
    });
    await page.getByRole("button", { name: "Add your first media" }).click();
    await chooseImportFolder(page, fixture.media);
    await page
      .getByRole("button", { name: "Cancel import", exact: true })
      .click();
    await expect(
      page.getByText("Import cancelled", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const project = await request.get("http://127.0.0.1:4310/api/project");
    expect(project.ok()).toBe(true);
    expect((await project.json()).project.title).toBe("An unfinished import");
    expect(await fixture.assertOriginalsUnchanged()).toBe(true);
    await expect(
      page.getByRole("button", { name: "Add media", exact: true }),
    ).toBeEnabled();
  } finally {
    cleanupFixtures.push(fixture.cleanup);
  }
});

test("cancels a real preview render while its request is pending", async ({
  page,
  request,
}) => {
  const fixture = await createDesktopFixture(20);
  const gate = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    return { promise, release };
  };
  const catchStartedGate = gate();
  const newerPollStartedGate = gate();
  const cancelRefreshGate = gate();
  const newerPollGate = gate();
  let active = false;
  let catchStarted = false;
  let catchResponseReleased = false;
  let newerPollHeld = false;
  const startsAfterCatch = new Map<number, boolean>();
  const heldReads = new Set<Promise<void>>();
  let callbackFailure: unknown;
  let primaryFailure: unknown;
  try {
    await page.exposeBinding(
      "__holdRenderJobsResponse",
      (
        _source,
        payload: {
          id: number;
          reader: string;
          stage: "start" | "response";
          status?: number;
          jobs?: { id: string; type: string; status: string }[];
        },
      ) => {
        const read = (async () => {
          if (!active) return;
          if (payload.stage === "start") {
            if (payload.reader === "renderPreview" && !catchStarted) {
              catchStarted = true;
              catchStartedGate.release();
            }
            startsAfterCatch.set(payload.id, catchStarted);
            if (payload.reader === "pollJobs" && catchStarted)
              newerPollStartedGate.release();
            return;
          }
          expect(payload.status).toBe(200);
          expect(Array.isArray(payload.jobs)).toBe(true);
          if (payload.reader === "cancelJob") {
            await cancelRefreshGate.promise;
          } else if (payload.reader === "pollJobs") {
            await catchStartedGate.promise;
            if (startsAfterCatch.get(payload.id)) {
              newerPollHeld = true;
              await newerPollGate.promise;
            }
          } else if (
            payload.reader === "renderPreview" &&
            !catchResponseReleased
          ) {
            expect(
              payload.jobs?.find((job) => job.type === "render")?.status,
            ).toBe("cancelled");
            await newerPollStartedGate.promise;
            catchResponseReleased = true;
          }
        })();
        heldReads.add(read);
        void read.then(
          () => heldReads.delete(read),
          (cause: unknown) => {
            heldReads.delete(read);
            callbackFailure ??= cause;
          },
        );
        return read;
      },
    );
    await page.addInitScript(() => {
      const observed = window as unknown as Window & {
        __holdRenderJobsResponse: (payload: unknown) => Promise<void>;
      };
      const fetch = window.fetch.bind(window);
      let nextId = 0;
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (new URL(url, location.href).pathname !== "/api/jobs")
          return fetch(input, init);
        const stack = new Error().stack ?? "";
        const reader =
          stack.match(/\b(pollJobs|cancelJob|renderPreview)\b/)?.[1] ?? "other";
        const id = ++nextId;
        await observed.__holdRenderJobsResponse({ id, reader, stage: "start" });
        const response = await fetch(input, init);
        const body = await response.clone().json();
        await observed.__holdRenderJobsResponse({
          id,
          reader,
          stage: "response",
          status: response.status,
          jobs: body.jobs,
        });
        return response;
      };
    });
    const created = await request.post(
      "http://127.0.0.1:4310/api/project/create",
      { data: { path: fixture.project, title: "A longer film" } },
    );
    expect(created.ok()).toBe(true);
    const imported = await request.post("http://127.0.0.1:4310/api/import", {
      data: { folder: fixture.media },
    });
    const { jobId } = (await imported.json()) as { jobId: string };
    await expect
      .poll(
        async () => {
          const { jobs } = await (
            await request.get("http://127.0.0.1:4310/api/jobs")
          ).json();
          return jobs.find((job: { id: string }) => job.id === jobId)?.status;
        },
        { timeout: 60_000 },
      )
      .toBe("completed");
    const storyResponse = await request.post(
      "http://127.0.0.1:4310/api/stories",
      {
        data: {
          title: "A ninety second story",
          template: "blank",
          targetDuration: 90,
          maxDuration: 90,
        },
      },
    );
    expect(storyResponse.ok()).toBe(true);
    const { story } = await storyResponse.json();
    const composed = await request.post("http://127.0.0.1:4310/api/compose", {
      data: { storyId: story.id },
    });
    expect(composed.ok()).toBe(true);
    await page.goto("/");
    await navigate(page, "edit");
    await page
      .getByRole("button", { name: "Render preview", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch project", exact: true }),
    ).toBeDisabled();
    active = true;
    await page
      .getByRole("button", { name: "Cancel render", exact: true })
      .click();
    await expect(
      page.getByText("Preview render cancelled", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Render preview", exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(catchResponseReleased).toBe(true);
    await expect.poll(() => newerPollHeld).toBe(true);
    cancelRefreshGate.release();
    newerPollGate.release();
    const { jobs } = await (
      await request.get("http://127.0.0.1:4310/api/jobs")
    ).json();
    expect(
      jobs.find((job: { type: string }) => job.type === "render").status,
    ).toBe("cancelled");
    expect(await fixture.assertOriginalsUnchanged()).toBe(true);
  } catch (cause) {
    primaryFailure = cause;
  } finally {
    active = false;
    catchStartedGate.release();
    newerPollStartedGate.release();
    cancelRefreshGate.release();
    newerPollGate.release();
    await Promise.allSettled([...heldReads]);
    cleanupFixtures.push(fixture.cleanup);
  }
  if (primaryFailure) throw primaryFailure;
  if (callbackFailure) throw callbackFailure;
});
