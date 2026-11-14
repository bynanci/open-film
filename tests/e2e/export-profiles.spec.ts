// SPDX-License-Identifier: Apache-2.0
import { expect, test, type APIRequestContext } from "@playwright/test";
import { join } from "node:path";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
import { createDesktopFixture } from "./helpers.js";
import { navigate } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310";
const cleanup: (() => Promise<void>)[] = [];

test.afterAll(async ({ request }) => {
  await request.post(`${base}/api/project/close`, { data: {} });
  await Promise.all(cleanup.map((action) => action()));
});

async function createFilm(
  request: APIRequestContext,
  options: { duration?: number; withAudio?: boolean } = {},
) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const duration = options.duration ?? 2;
  if (options.withAudio)
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=880:sample_rate=48000:duration=${duration}`,
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      "-threads",
      "1",
      "-y",
      join(fixture.media, "synthetic-tail-tone.wav"),
    ]);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Export profile fixture",
  );
  try {
    await app.importFolder(fixture.media);
    const photo = app.catalog
      .listAssets({ limit: 100 })
      .find((asset) => asset.name === "01-photo.png");
    if (!photo) throw new Error("Synthetic photo fixture was not imported.");
    app.project.settings = { width: 320, height: 180, frameRate: 12 };
    app.project.stories.push({
      id: "profile-story",
      title: "Synthetic story",
      beats: [],
    });
    app.project.timelines.push({
      id: "profile-film",
      storyId: "profile-story",
      duration,
      tracks: [
        {
          id: "visuals",
          type: "video",
          clips: [
            {
              id: "photo-clip",
              assetId: photo.id,
              timelineStart: 0,
              timelineDuration: duration,
            },
          ],
        },
      ],
    });
    const audio = app.catalog
      .listAssets({ limit: 100 })
      .find((asset) => asset.name === "synthetic-tail-tone.wav");
    if (options.withAudio && !audio)
      throw new Error("Synthetic tail audio fixture was not imported.");
    if (audio)
      app.project.timelines[0]!.tracks.push({
        id: "narration",
        type: "audio",
        timing: "overlay",
        clips: [
          {
            id: "tail-tone",
            assetId: audio.id,
            timelineStart: 0,
            timelineDuration: duration,
            audioAutomation: { version: 1, role: "narration" },
          },
        ],
      });
    await app.save();
  } finally {
    app.close();
  }
  const opened = await request.post(`${base}/api/project/open`, {
    data: { path: fixture.project },
  });
  expect(opened.ok()).toBe(true);
}

test("warns about the frame-aligned MP4 tail and lets the full-mix WAV ending be auditioned", async ({
  page,
  request,
}) => {
  await createFilm(request, { duration: 2.02, withAudio: true });
  await page.addInitScript(() =>
    localStorage.setItem("openfilm.uiLocale", "en-US"),
  );
  await page.goto("/");
  await navigate(page, "export", "en-US");

  await expect(page.getByTestId("export-audio-tail-warning")).toContainText(
    "960 samples",
  );
  await expect(page.getByTestId("export-audio-tail-warning")).toContainText(
    "20 ms",
  );

  const exportResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/export") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("export-profile-mp4").click();
  const exportResponse = await exportResponsePromise;
  expect(exportResponse.ok(), await exportResponse.text()).toBe(true);
  const exported = await exportResponse.json();
  expect(exported.report.audioTail).toMatchObject({
    code: "qa.frameAlignedAudioTail",
    severity: "manual-review-required",
    lostTailSamples: 960,
    lostTailMilliseconds: 20,
  });
  await expect(page.locator(".export-report-audio-tail")).toContainText(
    "Manual listening is required",
  );

  const audioResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/export/audio") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("export-audio-mix").click();
  const audioResponse = await audioResponsePromise;
  expect(audioResponse.ok(), await audioResponse.text()).toBe(true);

  const player = page.getByTestId("export-audio-preview");
  await expect(player).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() =>
      player.evaluate((audio) => (audio as HTMLAudioElement).readyState),
    )
    .toBeGreaterThan(0);
  expect(
    await player.evaluate((audio) => (audio as HTMLAudioElement).duration),
  ).toBeCloseTo(2.02, 2);
  const src = await player.getAttribute("src");
  expect(src).toContain("inline=audio");
  expect(
    (
      await request.get(new URL(src!, "http://127.0.0.1:4310").href, {
        headers: { range: "bytes=0-63" },
      })
    ).status(),
  ).toBe(206);

  await page.getByTestId("export-audio-tail-preview").click();
  await expect
    .poll(() =>
      player.evaluate((audio) => (audio as HTMLAudioElement).currentTime),
    )
    .toBeGreaterThan(0.45);
  expect(
    await player.evaluate((audio) => (audio as HTMLAudioElement).paused),
  ).toBe(false);
});

test("Export previews a Traditional Chinese reviewed crop and writes PNG/MP4 without saving new geometry", async ({
  page,
  request,
}) => {
  await createFilm(request);
  const before = await (await request.get(`${base}/api/project`)).json();
  await page.addInitScript(() =>
    localStorage.setItem("openfilm.uiLocale", "zh-TW"),
  );
  await page.goto("/");
  await navigate(page, "export", "zh-TW");

  const ratio = page.getByTestId("export-ratio");
  const framing = page.getByTestId("export-framing");
  const cropConfirmation = page.getByTestId("confirm-export-crop");
  const mp4 = page.getByTestId("export-profile-mp4");
  const still = page.getByTestId("export-still");
  await ratio.selectOption("9:16");
  await framing.selectOption("crop");
  await page.getByTestId("export-frame-time").fill("0.5");
  await page.getByTestId("export-quality").selectOption("high-detail");
  await expect(mp4).toBeDisabled();
  await expect(cropConfirmation).toBeDisabled();

  const previewResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/export/frame-preview") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("preview-export-frame").click();
  const previewReceipt = await (await previewResponse).json();
  const preview = page.getByTestId("export-preview-image");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview).toHaveJSProperty("naturalWidth", 1080);
  await expect(preview).toHaveJSProperty("naturalHeight", 1920);
  await expect(cropConfirmation).toBeEnabled();
  await expect(page.locator(".export-profile-options")).toContainText(
    "置中裁切",
  );
  await cropConfirmation.check();
  await expect(still).toBeEnabled();
  await expect(mp4).toBeEnabled();

  const stillResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/export/still") &&
      response.request().method() === "POST",
  );
  await still.click();
  const savedResponse = await stillResponsePromise;
  expect(savedResponse.ok()).toBe(true);
  expect(savedResponse.request().postDataJSON()).toMatchObject({
    cropPreviewToken: previewReceipt.token,
    profile: { quality: "high-detail" },
  });
  const stillLink = page.locator(".export-profile-result a").first();
  await expect(stillLink).toBeVisible({ timeout: 30_000 });
  const stillHref = await stillLink.getAttribute("href");
  const stillResponse = await request.get(new URL(stillHref!, base).toString());
  expect(stillResponse.ok()).toBe(true);
  expect((await stillResponse.body()).subarray(1, 4).toString()).toBe("PNG");
  const previewResponseBytes = await request.get(
    `${base}/api/export/frame-preview/${previewReceipt.token}`,
  );
  expect(await stillResponse.body()).toEqual(await previewResponseBytes.body());

  await mp4.click();
  const mp4Result = page.locator(".export-result");
  await expect(mp4Result).toBeVisible({ timeout: 60_000 });
  await page
    .locator(".export-options > details.export-report-details summary")
    .click();
  const manifestLink = page.locator(
    ".export-options > details.export-report-details a",
  );
  const manifestResponse = await request.get(
    new URL((await manifestLink.getAttribute("href"))!, base).toString(),
  );
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.exportProfile).toMatchObject({
    ratio: "9:16",
    width: 1080,
    height: 1920,
    framing: "crop",
    quality: "high-detail",
  });
  expect(manifest.encoding).toMatchObject({ quality: "high-detail", crf: 18 });
  expect(manifest.warnings).toContain(
    "Explicit center crop may trim protected subjects or subtitle safe areas; review the export frame.",
  );

  await page.getByTestId("export-audio-stems").click();
  await expect(
    page.locator(".export-profile-audio .export-profile-warning"),
  ).toContainText("不會建立分軌檔案", { timeout: 30_000 });
  await expect(
    page.locator(".export-profile-audio .export-profile-result li"),
  ).toHaveCount(0);
  await expect(page.getByTestId("export-ratio")).toHaveValue("9:16");
  const after = await (await request.get(`${base}/api/project`)).json();
  expect(after.project.settings).toEqual(before.project.settings);
  expect(after.project.timelines).toEqual(before.project.timelines);
});
