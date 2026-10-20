import { expect, test } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { inspectMedia } from "@openfilm/media";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
const cleanups: Array<() => Promise<unknown>> = [];

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
});
test.afterEach(async ({ request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

test("reviews rights, creates a private ZIP, and verifies relocation with a rendered MP4", async ({
  page,
  request,
}) => {
  const fixture = await createDesktopFixture(0);
  cleanups.push(fixture.cleanup);
  const sourcePath = join(fixture.media, "01-photo.png");
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Portable synthetic film",
  );
  app.project.settings = { width: 320, height: 180, frameRate: 10 };
  const asset = await inspectMedia({
    path: sourcePath,
    uri: pathToFileURL(sourcePath).href,
    name: "Synthetic still.png",
  });
  app.catalog.upsertAsset(asset);
  app.project.stories = [
    {
      id: "portable-story",
      title: "Synthetic story",
      beats: [
        {
          id: "opening-beat",
          title: "Opening",
          candidateAssetIds: [asset.id],
          selectedAssetIds: [asset.id],
        },
      ],
    },
  ];
  app.project.timelines = [
    {
      id: "portable-composition",
      storyId: "portable-story",
      duration: 1,
      tracks: [
        {
          id: "pictures",
          type: "video",
          clips: [
            {
              id: "opening-photo",
              assetId: asset.id,
              beatId: "opening-beat",
              timelineStart: 0,
              timelineDuration: 1,
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  app.close();

  const opened = await request.post(`${api}/project/open`, {
    data: { path: fixture.project },
  });
  expect(opened.ok(), await opened.text()).toBe(true);
  await initialLocale(page, "en-US");
  await page.goto("/");
  await navigate(page, "export");
  const panel = page.getByRole("region", { name: "Collect media" });
  await panel.getByTestId("collect-review").click();
  const card = panel
    .locator(".collect-item")
    .filter({ hasText: "Synthetic still.png" });
  await expect(card).toContainText("A rights declaration is required.");
  await card
    .getByLabel("I have the right to include this file in a portable package.")
    .check();
  await card.getByLabel("Rights basis").selectOption("owned");
  await panel.getByTestId("collect-review").click();
  await expect(panel.getByTestId("collect-create")).toBeEnabled();
  await expect(panel.getByTestId("collect-summary")).toContainText("1");

  await panel.getByTestId("collect-create").click();
  await expect(panel.getByTestId("collect-result")).toBeVisible({
    timeout: 60_000,
  });
  await expect(panel.getByTestId("collect-result")).toContainText(".zip");
  await panel.getByTestId("collect-verify").click();
  await expect(panel.getByTestId("collect-verified")).toBeVisible({
    timeout: 90_000,
  });
  await expect(panel.getByTestId("collect-verified")).toContainText(
    "10 frames",
  );
  await expect(panel.getByTestId("collect-verified")).toContainText(
    "MP4 SHA-256",
  );

  const project = await (await request.get(`${api}/project`)).json();
  const packageName = panel.locator(".collect-result code").first();
  await expect(packageName).toContainText(
    /^openfilm-collect-[0-9a-f-]{36}\.zip$/u,
  );
  expect(project.project.title).toBe("Portable synthetic film");
});
