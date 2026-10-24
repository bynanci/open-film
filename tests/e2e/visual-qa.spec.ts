import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
import { initialLocale, navigate, openAdvancedTools } from "./ui-helpers.js";
import { createDesktopFixture } from "./helpers.js";

const api = "http://127.0.0.1:4310/api";
const compositionId = "visual-qa-film";
const cleanup: Array<() => Promise<unknown>> = [];

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
});
test.afterEach(async ({ request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  await Promise.all(cleanup.splice(0).map((action) => action()));
});

async function createFilm(request: APIRequestContext) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const black = join(fixture.media, "qa-black.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=320x180:d=1",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-update",
    "1",
    "-y",
    black,
  ]);

  const app = await OpenFilmApplication.create(
    fixture.project,
    "Synthetic Visual QA",
  );
  try {
    await app.importFolder(fixture.media);
    const assets = app.catalog.listAssets({ limit: 100 });
    const photo = assets.find((asset) => asset.name === "01-photo.png")!;
    const blackAsset = assets.find((asset) => asset.name === "qa-black.png")!;
    app.project.settings = { width: 320, height: 180, frameRate: 8 };
    const story = app.generateStory({
      title: "Synthetic contact sheet",
      template: "blank",
      assetIds: [photo.id, blackAsset.id],
      targetDuration: 4,
      maxDuration: 4,
    });
    const composition = app.compose(story.id);
    composition.id = compositionId;
    composition.duration = 4;
    const track = composition.tracks.find((item) => item.type === "video")!;
    const seed = track.clips[0]!;
    const beatId = seed.beatId;
    track.clips = [
      {
        ...seed,
        id: "qa-first",
        assetId: photo.id,
        beatId,
        timelineStart: 0,
        timelineDuration: 2,
        motion: {
          version: 1,
          preset: "push-in",
          easing: "linear",
          from: { scale: 1, x: 0, y: 0 },
          to: { scale: 1.1, x: 0, y: 0 },
        },
      },
      {
        ...seed,
        id: "qa-second",
        assetId: blackAsset.id,
        beatId,
        timelineStart: 2,
        timelineDuration: 2,
      },
    ];
    app.project.timelines[app.project.timelines.length - 1] = composition;
    const savedStory = app.project.stories.find(
      (item) => item.id === story.id,
    )!;
    savedStory.maxDuration = 4;
    await app.save();
  } finally {
    app.close();
  }

  const opened = await request.post(`${api}/project/open`, {
    data: { path: fixture.project },
  });
  expect(opened.ok(), await opened.text()).toBe(true);
  return fixture;
}

async function openEditor(page: Page) {
  await initialLocale(page);
  await page.goto("/");
  await navigate(page, "edit");
  await expect(page.locator("#clip-qa-first")).toBeVisible();
}

test("renders a private contact sheet and locates manual-review findings in Edit", async ({
  page,
  request,
}) => {
  await createFilm(request);
  await openEditor(page);
  const first = page.locator("#clip-qa-first");
  const second = page.locator("#clip-qa-second");
  await first.click();

  await openAdvancedTools(page);
  await page.getByRole("button", { name: "Open Visual QA panel" }).click();
  await expect(
    page.getByRole("dialog", { name: "Visual quality review" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check saved edit", exact: true })
    .click();
  const sheet = page.getByLabel("Timestamped contact sheet", { exact: true });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet.locator(".visual-qa-sample")).toHaveCount(2);
  await expect
    .poll(() =>
      sheet
        .locator("img")
        .nth(1)
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);

  await sheet.locator(".visual-qa-sample").first().click();
  await expect(
    page.getByRole("slider", {
      name: "Seek within photo presentation",
      exact: true,
    }),
  ).toHaveValue("1");
  await expect(page.locator(".photo-presentation-layers")).toHaveCSS(
    "transform",
    "matrix(1.05, 0, 0, 1.05, 0, 0)",
  );

  const blackFrameFinding = page.getByRole("button", {
    name: "Open Edit near 00:03.000",
    exact: true,
  });
  await expect(blackFrameFinding).toBeVisible();
  await expect(blackFrameFinding).toContainText("Manual review");
  await blackFrameFinding.focus();
  await page.keyboard.press("Enter");
  await expect(second).toHaveAttribute("aria-pressed", "true");

  const photoDuration = page.getByLabel("Photo duration", { exact: true });
  await photoDuration.fill("2.5");
  await photoDuration.press("Tab");
  await expect(sheet).toHaveCount(0);
});
