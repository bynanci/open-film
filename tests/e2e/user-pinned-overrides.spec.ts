import { test, expect } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type { Composition } from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";
const endpoint = "http://127.0.0.1:4310/api";
const cleanup: Array<() => Promise<unknown>> = [];
test.use({ viewport: { width: 1440, height: 1000 } });
test.afterEach(async ({ request }) => {
  await request.post(`${endpoint}/project/close`, { data: {} });
  for (const action of cleanup.splice(0)) await action();
});
test("direct trim pins exact frames through neighbor regeneration reopen release and undo", async ({
  page,
  request,
}) => {
  await request.post(`${endpoint}/project/close`, { data: {} });
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(fixture.project, "Pinned edits");
  await app.importFolder(fixture.media);
  const assets = app.catalog.listAssets({ limit: 100 }),
    id = (name: string) => assets.find((a) => a.name === name)!.id;
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.project.stories = [
    {
      id: "story",
      title: "Pinned story",
      beats: [
        {
          id: "beat",
          title: "Pinned scene",
          targetDuration: 8,
          candidateAssetIds: [
            id("01-photo.png"),
            id("04-motion.mp4"),
            id("03-evening.png"),
          ],
        },
      ],
    },
  ];
  app.project.timelines = [
    {
      id: "cut",
      storyId: "story",
      duration: 8,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "a",
              assetId: id("01-photo.png"),
              beatId: "beat",
              timelineStart: 0,
              timelineDuration: 3,
            },
            {
              id: "anchor",
              assetId: id("04-motion.mp4"),
              beatId: "beat",
              timelineStart: 3,
              timelineDuration: 2,
              sourceIn: 0.25,
              sourceOut: 2.25,
            },
            {
              id: "c",
              assetId: id("03-evening.png"),
              beatId: "beat",
              timelineStart: 5,
              timelineDuration: 3,
            },
          ],
        },
      ],
    },
  ];
  app.close();
  expect(
    (
      await request.post(`${endpoint}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  const state = async () => {
    const response = await request.get(`${endpoint}/compositions/cut/editor`);
    expect(response.ok()).toBe(true);
    return (await response.json()) as {
      composition: Composition;
      revision: string;
    };
  };
  await initialLocale(page, "en-US");
  await page.goto("/");
  await navigate(page, "edit");
  await page.locator("#clip-anchor").click();
  await page.getByLabel("Source out", { exact: true }).fill("2");
  await page.getByLabel("Source out", { exact: true }).press("Tab");
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  const pinned = (await state()).composition.tracks[0]!.clips.find(
    (c) => c.id === "anchor",
  )!;
  expect(pinned.userOverrides?.isUserPinned).toBe(true);
  await expect(
    page.locator("#clip-anchor").getByTestId("user-pin-marker"),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: uiText("en-US", "editor.beats.editLabel", {
        title: "Pinned scene",
      }),
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Regenerate beat", exact: true })
    .click();
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  expect(
    (await state()).composition.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === "anchor"),
  ).toEqual(pinned);
  await page.reload();
  await navigate(page, "edit");
  await page.locator("#clip-anchor").click();
  await expect(page.getByTestId("clip-user-pin")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("clip-user-pin").click();
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  expect(
    (await state()).composition.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === "anchor")?.userOverrides?.isUserPinned,
  ).toBe(false);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  expect(
    (await state()).composition.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === "anchor"),
  ).toEqual(pinned);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});
