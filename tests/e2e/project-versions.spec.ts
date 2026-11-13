import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile } from "@openfilm/media";
import type { MediaAsset } from "@openfilm/core";
import { toneSource } from "../fixtures/audio-policy.js";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";
import { createDesktopFixture } from "./helpers.js";

const api = "http://127.0.0.1:4310/api";
const cleanups: Array<() => Promise<unknown>> = [];

test.use({ viewport: { width: 1440, height: 900 } });
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

test("renders saved snapshots and synchronizes video, seeking, and one audio side", async ({
  page,
  request,
}, testInfo) => {
  const fixture = await createDesktopFixture(0);
  cleanups.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Synthetic A/B comparison",
  );
  const photo = async (id: string, filename: string): Promise<MediaAsset> => {
    const path = join(fixture.media, filename);
    return {
      id,
      name: id,
      uri: pathToFileURL(path).href,
      mediaType: "image",
      tags: [],
      state: {},
      metadata: {},
      contentHash: await hashFile(path),
    };
  };
  const imageA = await photo("ab-image-a", "01-photo.png"),
    imageB = await photo("ab-image-b", "03-evening.png"),
    soundA = await toneSource(fixture.root, "ab-tone-a", 440, 1),
    soundB = await toneSource(fixture.root, "ab-tone-b", 880, 1);
  for (const asset of [imageA, imageB, soundA, soundB])
    app.catalog.upsertAsset(asset);
  app.project.stories = [{ id: "ab-story", title: "A/B story", beats: [] }];
  app.project.settings = {
    ...app.project.settings,
    width: 160,
    height: 90,
    frameRate: 10,
    timebase: {
      version: 1,
      rateNumerator: 10,
      rateDenominator: 1,
      dropFrame: false,
    },
  };
  app.project.timelines = [
    {
      id: "ab-edit",
      storyId: "ab-story",
      duration: 1,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "picture-clip",
              assetId: imageA.id,
              timelineStart: 0,
              timelineDuration: 1,
            },
          ],
        },
        {
          id: "sound",
          type: "audio",
          clips: [
            {
              id: "sound-clip",
              assetId: soundA.id,
              timelineStart: 0,
              timelineDuration: 1,
              sourceIn: 0,
              sourceOut: 1,
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  await app.versions.create({
    name: "A · 440 Hz",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  app.project.timelines[0]!.tracks[0]!.clips[0]!.assetId = imageB.id;
  app.project.timelines[0]!.tracks[1]!.clips[0]!.assetId = soundB.id;
  app.project.settings = {
    ...app.project.settings,
    width: 192,
    height: 108,
    frameRate: 12,
    timebase: {
      version: 1,
      rateNumerator: 12,
      rateDenominator: 1,
      dropFrame: false,
    },
  };
  await app.save();
  await app.versions.create({
    name: "B · 880 Hz",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  app.close();

  const opened = await request.post(`${api}/project/open`, {
    data: { path: fixture.project },
  });
  expect(opened.ok(), await opened.text()).toBe(true);
  await initialLocale(page, "en-US");
  await page.goto("/");
  await navigate(page, "versions");
  const panel = page.getByRole("region", { name: "Named versions" });
  await expect(
    panel.locator(".version-card strong").filter({ hasText: "A · 440 Hz" }),
  ).toBeVisible();
  await expect(
    panel.locator(".version-card strong").filter({ hasText: "B · 880 Hz" }),
  ).toBeVisible();
  await panel
    .getByRole("combobox", { name: "Version A" })
    .selectOption({ label: "A · 440 Hz" });
  await panel
    .getByRole("combobox", { name: "Version B" })
    .selectOption({ label: "B · 880 Hz" });
  await panel.getByRole("button", { name: "Prepare comparison" }).click();
  const players = panel.locator(".versions-av-players video");
  await expect(players).toHaveCount(2);
  const sideA = players.nth(0);
  const sideB = players.nth(1);
  await expect(sideA).toHaveAttribute(
    "aria-label",
    "Saved version A: A · 440 Hz",
  );
  await expect(sideB).toHaveAttribute(
    "aria-label",
    "Saved version B: B · 880 Hz",
  );
  await expect(sideA).toHaveAttribute(
    "src",
    /\/api\/version-comparisons\/.*\/media\/a/,
  );
  await expect(sideB).toHaveAttribute(
    "src",
    /\/api\/version-comparisons\/.*\/media\/b/,
  );
  await expect
    .poll(() => sideA.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => sideB.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(1);
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await panel.scrollIntoViewIfNeeded();
    expect(
      await panel.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await testInfo.attach(`versions-av-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
  await panel.getByRole("button", { name: "Play both" }).click();
  await expect
    .poll(async () => {
      const [a, b] = await Promise.all([
        sideA.evaluate((video: HTMLVideoElement) => video.currentTime),
        sideB.evaluate((video: HTMLVideoElement) => video.currentTime),
      ]);
      return Math.abs(a - b);
    })
    .toBeLessThan(0.16);
  await panel.getByRole("button", { name: "Listen to B" }).click();
  await expect(sideA).toHaveJSProperty("muted", true);
  await expect(sideB).toHaveJSProperty("muted", false);
  await panel.getByRole("button", { name: "Pause", exact: true }).click();
  const seek = panel.getByRole("slider", { name: "Shared comparison time" });
  await seek.evaluate((range: HTMLInputElement) => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setValue?.call(range, "0.55");
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect
    .poll(() => sideA.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeCloseTo(0.55, 1);
  await expect
    .poll(() => sideB.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeCloseTo(0.55, 1);

  await navigate(page, "library");
  await expect(panel.locator("video")).toHaveCount(0);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
  await expect((await request.get(`${api}/project`)).ok()).toBe(true);
  await request.post(`${api}/project/close`, { data: {} });
  const reopened = await request.post(`${api}/project/open`, {
    data: { path: fixture.project },
  });
  expect(reopened.ok(), await reopened.text()).toBe(true);
  await navigate(page, "versions");
  await expect(
    page.getByRole("region", { name: "Named versions" }),
  ).toContainText("A · 440 Hz");
  await expect(
    page.getByRole("region", { name: "Named versions" }),
  ).toContainText("B · 880 Hz");
});

test("creates, compares, renames, and explicitly restores a saved version", async ({
  page,
  request,
}) => {
  const fixture = await createDesktopFixture(0);
  cleanups.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Synthetic versions film",
  );
  try {
    app.project.stories = [
      {
        id: "version-story",
        title: "Synthetic story",
        beats: [{ id: "opening", title: "Opening beat" }],
      },
    ];
    await app.save();
  } finally {
    app.close();
  }
  const opened = await request.post(`${api}/project/open`, {
    data: { path: fixture.project },
  });
  expect(opened.ok(), await opened.text()).toBe(true);

  await initialLocale(page, "en-US");
  await page.goto("/");
  await navigate(page, "versions");
  const panel = page.getByRole("region", { name: "Named versions" });
  await panel.getByLabel("Version name", { exact: true }).fill("Opening cut");
  await panel.getByRole("button", { name: "Save current version" }).click();
  await expect(panel.getByTestId(/^version-/)).toHaveCount(1);
  const firstId = await panel
    .locator(".version-card")
    .first()
    .locator(".version-select")
    .getAttribute("data-testid");
  expect(firstId).toMatch(/^version-/);

  const editStory = await request.patch(`${api}/stories/version-story`, {
    data: { title: "Revised synthetic story" },
  });
  expect(editStory.ok(), await editStory.text()).toBe(true);
  await panel.getByRole("button", { name: "Refresh versions" }).click();
  await panel.getByLabel("Version name", { exact: true }).fill("Second cut");
  await panel.getByRole("button", { name: "Save current version" }).click();
  await expect(panel.getByTestId(/^version-/)).toHaveCount(2);
  await expect(
    panel.getByText("Changes from Opening cut to Second cut"),
  ).toBeVisible();
  await expect(
    panel.getByText("Story and beats", { exact: true }),
  ).toBeVisible();

  const firstCard = panel.getByTestId(firstId!).locator("xpath=..");
  await firstCard.getByRole("button", { name: "Rename", exact: true }).click();
  const renameInput = firstCard.getByLabel("Version name", { exact: true });
  await renameInput.fill("Opening · approved");
  await firstCard
    .getByRole("button", { name: "Save name", exact: true })
    .click();
  await expect(panel.getByTestId(firstId!)).toContainText("Opening · approved");

  await firstCard
    .getByRole("button", { name: "Restore…", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog", {
    name: "Restore “Opening · approved”?",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("checkpoint");
  await dialog
    .getByRole("button", { name: "Create checkpoint and restore" })
    .click();

  await expect
    .poll(async () => {
      const current = await (await request.get(`${api}/project`)).json();
      return current.project.stories[0].title;
    })
    .toBe("Synthetic story");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(panel.getByTestId(/^version-/)).toHaveCount(3);
  await expect(
    page.getByLabel("Saved project versions", { exact: true }),
  ).toBeVisible();
  expect(uiText("en-US", "app.navigation.versions")).toBe("Versions");
  const checkpoint = panel
    .locator(".version-card")
    .filter({ hasText: "Before restore:" });
  await checkpoint
    .getByRole("button", { name: "Delete…", exact: true })
    .click();
  const deletion = page.getByRole("alertdialog", {
    name: /Delete “Before restore:/,
  });
  await expect(deletion).toContainText(
    "Original media and the current project stay unchanged",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(panel.getByTestId(/^version-/)).toHaveCount(3);
  await checkpoint
    .getByRole("button", { name: "Delete…", exact: true })
    .click();
  await expect(
    deletion.getByRole("button", { name: "Delete saved version", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByTestId(/^version-/)).toHaveCount(2);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(
    (await (await request.get(`${api}/project`)).json()).project.stories[0]
      .title,
  ).toBe("Synthetic story");
  let deleteRequests = 0;
  page.on("request", (sent) => {
    if (sent.method() === "DELETE" && sent.url().includes("/api/versions/"))
      deleteRequests++;
  });
  await firstCard.getByRole("button", { name: "Delete…", exact: true }).click();
  await page.route("**/api/versions/revision", (route) =>
    route.fulfill({
      json: { projectId: "another-project", revision: "0".repeat(64) },
    }),
  );
  const wrongProject = page.waitForResponse("**/api/versions/revision");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete saved version", exact: true })
    .click();
  await wrongProject;
  await expect(
    page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete saved version", exact: true }),
  ).toBeEnabled();
  expect(deleteRequests).toBe(0);
  await expect(panel.getByTestId(/^version-/)).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.unroute("**/api/versions/revision");
});
