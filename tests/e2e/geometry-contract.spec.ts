import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310/api";
let root: string;
test.use({ viewport: { width: 1280, height: 1000 } });
test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  root = await mkdtemp(join(tmpdir(), "openfilm-geometry-ui-"));
  const media = join(root, "media");
  await mkdir(media);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=80x40",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    join(media, "source.png"),
  ]);
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(
    directory,
    "Geometry regression",
  );
  try {
    await app.importFolder(media);
    const asset = app.catalog.listAssets()[0]!;
    app.project.stories.push({
      id: "story",
      title: "Geometry",
      targetDuration: 2,
      maxDuration: 10,
      beats: [{ id: "beat", title: "Frame", candidateAssetIds: [asset.id] }],
    });
    app.project.timelines.push({
      id: "cut",
      storyId: "story",
      duration: 2,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "clip",
              beatId: "beat",
              assetId: asset.id,
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
  await initialLocale(page);
  await page.goto("/");
  await openFilm(page, directory);
  await navigate(page, "edit");
  await page.locator(".editor-clip").first().click();
  await expect
    .poll(() =>
      page
        .locator(".editor-composition-frame img")
        .evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
});
test.afterEach(async ({ request }) => {
  await request.post(`${base}/project/close`, { data: {} });
  if (root) await rm(root, { recursive: true, force: true });
});

test("transient geometry fields do not throw during preview rendering", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const field of ["scale", "rotation", "x", "y"]) {
    const input = page.getByLabel(
      uiText("en-US", `editor.clip.${field}Label`),
      { exact: true },
    );
    const before = await input.inputValue();
    await input.fill("");
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    expect(errors).toEqual([]);
    await expect(page.locator(".editor-composition-frame")).toBeVisible();
    await input.fill(before);
    await input.press("Tab");
  }
  expect(errors).toEqual([]);
});

test("preview refits when only the inspector changes its grid column", async ({
  page,
}) => {
  const viewport = page.locator(".editor-source-screen");
  const frame = page.locator(".editor-composition-frame");
  const toggle = page.locator('button[aria-controls="timeline-inspector"]');
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const before = await viewport.evaluate((el) => el.clientWidth);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() => viewport.evaluate((el) => el.clientWidth))
    .toBeGreaterThan(before + 10);
  for (let iteration = 0; iteration < 2; iteration++) {
    await expect
      .poll(async () => {
        const bounds = await viewport.evaluate((el) => ({
          width: el.clientWidth,
          height: el.clientHeight,
        }));
        const actual = await frame.boundingBox();
        const scale = Math.min(bounds.width / 1920, bounds.height / 1080);
        return Math.max(
          Math.abs(actual!.width - 1920 * scale),
          Math.abs(actual!.height - 1080 * scale),
        );
      })
      .toBeLessThan(1);
    if (iteration === 0) await toggle.click();
  }
});
