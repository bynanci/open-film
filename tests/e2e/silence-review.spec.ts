import { appendFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Composition, MediaAsset } from "@openfilm/core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile } from "@openfilm/media";
import { initialLocale, navigate } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310/api";
const compositionId = "silence-review-cut";
const roots: string[] = [];

test.use({ viewport: { width: 1024, height: 768 }, actionTimeout: 15_000 });

function wave(): Buffer {
  const rate = 48_000;
  const samples = 4 * rate;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    const seconds = index / rate;
    const quiet =
      (seconds >= 0.75 && seconds < 1.5) || (seconds >= 2 && seconds < 2.75);
    const value = quiet
      ? 0
      : Math.round(12_000 * Math.sin((2 * Math.PI * 440 * index) / rate));
    bytes.writeInt16LE(value, 44 + index * 2);
  }
  return bytes;
}

async function createProject(request: APIRequestContext) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-silence-review-ui-"));
  roots.push(root);
  const source = join(root, "synthetic-voice.wav");
  await writeFile(source, wave());
  const app = await OpenFilmApplication.create(
    join(root, "silence-review.openfilm"),
    "Synthetic silence review",
  );
  app.project.settings = { width: 320, height: 180, frameRate: 25 };
  const asset: MediaAsset = {
    id: "synthetic-voice",
    name: "synthetic-voice.wav",
    uri: pathToFileURL(source).href,
    contentHash: await hashFile(source),
    mediaType: "audio",
    duration: 4,
    tags: [],
    state: {},
    metadata: {},
  };
  app.catalog.upsertAsset(asset);
  app.project.stories.push({
    id: "silence-review-story",
    title: "Synthetic voice",
    targetDuration: 4,
    maxDuration: 8,
    beats: [
      {
        id: "voice-beat",
        title: "Voice",
        selectedAssetIds: [asset.id],
        candidateAssetIds: [asset.id],
      },
    ],
  });
  app.project.timelines.push({
    id: compositionId,
    storyId: "silence-review-story",
    duration: 4,
    tracks: [
      {
        id: "voice-track",
        type: "audio",
        clips: [
          {
            id: "synthetic-voice-clip",
            assetId: asset.id,
            beatId: "voice-beat",
            sourceIn: 0,
            sourceOut: 4,
            timelineStart: 0,
            timelineDuration: 4,
          },
        ],
      },
    ],
  });
  await app.save();
  const projectId = app.project.id;
  const projectPath = app.directory;
  app.close();
  const opened = await request.post(`${base}/project/open`, {
    data: { path: projectPath },
  });
  expect(opened.ok(), await opened.text()).toBe(true);
  return { root, projectId, projectPath, source, asset };
}

async function composition(request: APIRequestContext): Promise<Composition> {
  const response = await request.get(`${base}/project`);
  expect(response.ok()).toBe(true);
  const project = (await response.json()).project;
  return project.timelines.find(
    (entry: Composition) => entry.id === compositionId,
  )!;
}

async function openSilenceReview(page: Page) {
  await page.goto("/");
  await navigate(page, "edit");
  await expect(page.locator("#clip-synthetic-voice-clip")).toBeVisible();
  await page
    .getByRole("group", { name: "Editing mode", exact: true })
    .getByRole("button", { name: "Precision", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Silence review", exact: true })
    .click();
  await expect(page.locator(".silence-review")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  const closed = await request.post(`${base}/project/close`, { data: {} });
  expect(closed.ok()).toBe(true);
});

test.afterEach(async ({ request }) => {
  const closed = await request.post(`${base}/project/close`, { data: {} });
  expect(closed.ok()).toBe(true);
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      }),
    ),
  );
});

test("analyzes, revises an immutable Review, applies through the editor history, and reopens", async ({
  page,
  request,
}) => {
  const fixture = await createProject(request);
  await initialLocale(page, "en-US");
  await openSilenceReview(page);

  const analyze = page.getByRole("button", {
    name: "Analyze silence",
    exact: true,
  });
  await analyze.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".silence-candidate")).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("status").filter({ hasText: "Review candidates" }),
  ).toBeVisible();

  const checkboxes = page.locator(".silence-candidate input[type=checkbox]");
  await expect(checkboxes).toHaveCount(2);
  await checkboxes.nth(1).focus();
  await page.keyboard.press("Space");
  await expect(page.getByText(/Create a new durable Review/)).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    const panel = page.locator(".silence-review");
    await expect(panel).toBeVisible();
    const overflow = await panel.evaluate((node) => ({
      width: node.clientWidth,
      scrollWidth: node.scrollWidth,
      offenders: Array.from(node.querySelectorAll<HTMLElement>("*"))
        .filter((child) => child.scrollWidth > child.clientWidth + 1)
        .map((child) => ({
          tag: child.tagName,
          className: child.className,
          width: child.clientWidth,
          scrollWidth: child.scrollWidth,
          text: child.textContent?.slice(0, 60),
        }))
        .slice(0, 8),
    }));
    expect(
      overflow.scrollWidth <= overflow.width,
      JSON.stringify(overflow),
    ).toBe(true);
    const reducedMotion = await panel.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(reducedMotion).toBe(true);
    const transitionDuration = await analyze.evaluate(
      (node) => getComputedStyle(node).transitionDuration,
    );
    expect(transitionDuration).toMatch(/^(0ms|0s)$/u);
    const screenshotDirectory = join(process.cwd(), "docs", "screenshots");
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(
        screenshotDirectory,
        `silence-review-${viewport.width}x${viewport.height}.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
  }

  const jobsResponse = await request.get(`${base}/jobs`);
  expect(jobsResponse.ok()).toBe(true);
  const jobs = (await jobsResponse.json()).jobs as Array<{
    id: string;
    type: string;
    silenceAnalysis?: { projectId: string; compositionId: string };
  }>;
  const originalJob = jobs.find(
    (job) =>
      job.type === "silence-analysis" &&
      job.silenceAnalysis?.projectId === fixture.projectId &&
      job.silenceAnalysis.compositionId === compositionId,
  )!;
  const originalResponse = await request.get(
    `${base}/silence/jobs/${encodeURIComponent(originalJob.id)}/review`,
  );
  expect(originalResponse.ok()).toBe(true);
  const originalReview = await originalResponse.json();
  const selectedCheckbox = checkboxes.nth(0);
  await expect(selectedCheckbox).toBeChecked();

  const reviseResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/silence/jobs/${originalJob.id}/review` &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create updated Review", exact: true })
    .click();
  const reviseResponse = await reviseResponsePromise;
  expect(reviseResponse.status()).toBe(202);
  await expect(
    page.getByRole("button", { name: "Accept removal", exact: true }),
  ).toBeEnabled({
    timeout: 30_000,
  });
  const childJob = (await reviseResponse.json()).job;
  const revisedResponse = await request.get(
    `${base}/silence/jobs/${encodeURIComponent(childJob.id)}/review`,
  );
  expect(revisedResponse.ok()).toBe(true);
  const revisedReview = await revisedResponse.json();
  expect(originalReview.review.proposal.selectedCandidateIds).toHaveLength(2);
  expect(revisedReview.review.proposal.selectedCandidateIds).toHaveLength(1);
  expect(revisedReview.review.proposal.sourceHash).toBe(
    originalReview.review.proposal.sourceHash,
  );

  const candidate = page.locator(".silence-candidate").first();
  const preview = candidate.getByRole("button", {
    name: "Preview",
    exact: true,
  });
  await preview.click();
  const audio = page.locator(".precision-player-region audio");
  await expect
    .poll(
      () => audio.evaluate((node) => (node as HTMLAudioElement).currentTime),
      {
        timeout: 5_000,
      },
    )
    .toBeGreaterThan(0.5);

  const beforeAudition = await composition(request);
  const audition = page.getByRole("region", {
    name: "Rendered seam audition",
    exact: true,
  });
  const auditionResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(
        `/silence/jobs/${childJob.id}/audition`,
      ) && response.request().method() === "POST",
  );
  const prepareAudition = audition.getByRole("button", {
    name: "Render before / after",
    exact: true,
  });
  await prepareAudition.focus();
  await page.keyboard.press("Enter");
  const auditionResponse = await auditionResponsePromise;
  expect(auditionResponse.ok(), await auditionResponse.text()).toBe(true);
  const rendered = await auditionResponse.json();
  expect(rendered.parity).toBe("renderer");
  expect(rendered.reviewId).toBe(revisedReview.review.reviewId);
  expect(rendered.seams.length).toBeGreaterThan(0);
  for (const name of ["Play original mix", "Play edited mix"]) {
    const pcmResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.includes("/record-audio-preview/") &&
        new URL(response.url()).pathname.endsWith("/pcm"),
    );
    await audition.getByRole("button", { name, exact: true }).click();
    const pcm = await pcmResponse;
    expect(pcm.ok(), await pcm.text()).toBe(true);
    expect(pcm.headers()["x-openfilm-pcm-sample-rate"]).toBe("48000");
    expect(pcm.headers()["x-openfilm-pcm-channels"]).toBe("2");
    await expect
      .poll(() => audio.evaluate((node) => (node as HTMLAudioElement).paused))
      .toBe(true);
    await audition
      .getByRole("button", { name: "Stop audition", exact: true })
      .click();
  }
  expect(await composition(request)).toEqual(beforeAudition);
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const afterControl = audition.getByRole("button", {
      name: "Play edited mix",
      exact: true,
    });
    await audition
      .getByText(/^Reviewed removal:/)
      .evaluate((node) =>
        node.scrollIntoView({ block: "start", inline: "nearest" }),
      );
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(afterControl).toBeVisible();
    await expect(
      audition.getByRole("button", { name: "Play original mix", exact: true }),
    ).toBeVisible();
    await expect(
      audition.getByRole("button", { name: "Stop audition", exact: true }),
    ).toBeVisible();
    await afterControl.evaluate((node) =>
      (node as HTMLElement).focus({ preventScroll: true }),
    );
    await expect(afterControl).toBeFocused();
    expect(
      await audition.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: join(
        process.cwd(),
        "docs",
        "screenshots",
        `silence-audition-${viewport.width}x${viewport.height}.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
  }

  const accept = page.getByRole("button", {
    name: "Accept removal",
    exact: true,
  });
  await accept.click();
  const confirmation = page.getByRole("dialog", {
    name: "Remove selected silence?",
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("synthetic-voice.wav");
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(accept).toBeFocused();

  await accept.click();
  await expect(confirmation).toBeVisible();
  const applyUrl = `**/api/silence/jobs/${childJob.id}/apply`;
  await page.route(applyUrl, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "revision.conflict" } }),
    }),
  );
  await confirmation
    .getByRole("button", { name: "Apply reviewed edit", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "The source or edit changed" }),
  ).toBeVisible();
  expect((await composition(request)).duration).toBe(4);
  await page.unroute(applyUrl);
  const applyResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/silence/jobs/${childJob.id}/apply` &&
      response.request().method() === "POST",
  );
  await confirmation
    .getByRole("button", { name: "Apply reviewed edit", exact: true })
    .click();
  expect((await applyResponsePromise).ok()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Silence review", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");

  const applied = await composition(request);
  expect(applied.duration).toBeCloseTo(
    4 - revisedReview.review.proposal.totalDurationReduced,
    2,
  );
  expect(applied.tracks[0]!.clips.length).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect.poll(async () => (await composition(request)).duration).toBe(4);
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(async () => (await composition(request)).duration)
    .toBeCloseTo(applied.duration, 2);
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");

  const closed = await request.post(`${base}/project/close`, { data: {} });
  expect(closed.ok()).toBe(true);
  const reopened = await request.post(`${base}/project/open`, {
    data: { path: fixture.projectPath },
  });
  expect(reopened.ok(), await reopened.text()).toBe(true);
  await page.reload();
  await navigate(page, "edit");
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  await expect
    .poll(async () => (await composition(request)).duration)
    .toBeCloseTo(applied.duration, 2);
  const reopenedJobs = await request.get(`${base}/jobs`);
  expect(reopenedJobs.ok()).toBe(true);
  expect(
    (await reopenedJobs.json()).jobs.some(
      (job: { id: string; status: string }) =>
        job.id === childJob.id && job.status === "completed",
    ),
  ).toBe(true);
});

test("blocks acceptance after the analyzed source becomes stale", async ({
  page,
  request,
}) => {
  const fixture = await createProject(request);
  await initialLocale(page, "en-US");
  await openSilenceReview(page);
  await page
    .getByRole("button", { name: "Analyze silence", exact: true })
    .click();
  await expect(page.locator(".silence-candidate").first()).toBeVisible({
    timeout: 30_000,
  });

  await appendFile(fixture.source, Buffer.from([0]));
  await page
    .getByRole("button", { name: "Reconnect to job", exact: true })
    .click();
  await expect(page.locator(".silence-status")).toHaveText(
    "Edit changed · review again",
    { timeout: 10_000 },
  );
  await expect(
    page.getByRole("button", { name: "Accept removal", exact: true }),
  ).toBeDisabled();
  expect((await composition(request)).duration).toBe(4);
});

test("keeps Silence Review controls translated in Traditional Chinese and Japanese", async ({
  page,
  request,
}) => {
  await createProject(request);
  for (const [locale, label] of [
    ["zh-TW", "靜音審閱"],
    ["ja-JP", "無音レビュー"],
  ] as const) {
    await initialLocale(page, locale);
    await page.goto("/");
    await navigate(page, "edit", locale);
    await page
      .getByRole("group", {
        name: locale === "ja-JP" ? "編集モード" : "剪輯模式",
        exact: true,
      })
      .getByRole("button", {
        name: locale === "ja-JP" ? "精密" : "精準",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator(".silence-review")).toBeVisible();
    await expect(
      page.getByLabel(locale === "ja-JP" ? "無音しきい値" : "靜音門檻"),
    ).toBeVisible();
  }
});
