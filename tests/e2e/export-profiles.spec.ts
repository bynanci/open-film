// SPDX-License-Identifier: Apache-2.0
import { expect, test, type APIRequestContext } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { createDesktopFixture } from "./helpers.js";
import { navigate } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310";
const cleanup: (() => Promise<void>)[] = [];

test.afterAll(async ({ request }) => {
  await request.post(`${base}/api/project/close`, { data: {} });
  await Promise.all(cleanup.map((action) => action()));
});

async function createFilm(request: APIRequestContext) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
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
      duration: 2,
      tracks: [
        {
          id: "visuals",
          type: "video",
          clips: [
            {
              id: "photo-clip",
              assetId: photo.id,
              timelineStart: 0,
              timelineDuration: 2,
            },
          ],
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
  await expect(mp4).toBeDisabled();
  await expect(cropConfirmation).toBeDisabled();

  await page.getByTestId("preview-export-frame").click();
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

  await still.click();
  const stillLink = page.locator(".export-profile-result a").first();
  await expect(stillLink).toBeVisible({ timeout: 30_000 });
  const stillHref = await stillLink.getAttribute("href");
  const stillResponse = await request.get(new URL(stillHref!, base).toString());
  expect(stillResponse.ok()).toBe(true);
  expect((await stillResponse.body()).subarray(1, 4).toString()).toBe("PNG");

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
  });
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
