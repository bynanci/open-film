import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type { Clip, Composition } from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310/api";
const cleanup: Array<() => Promise<void>> = [];

test.afterEach(async ({ request }) => {
  await request.post(`${base}/project/close`);
  await Promise.all(cleanup.splice(0).map((action) => action()));
});

async function openFixture(page: Page, request: APIRequestContext) {
  const fixture = await createDesktopFixture(1);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Direct picture fixture",
  );
  await app.importFolder(fixture.media);
  const assets = app.catalog.listAssets({ limit: 100 });
  const photo = assets.find((asset) => asset.name === "01-photo.png")!;
  const video = assets.find((asset) => asset.name === "04-motion.mp4")!;
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.project.stories.push({
    id: "gesture-story",
    title: "Shape the picture",
    targetDuration: 7,
    maxDuration: 20,
    beats: [
      {
        id: "moments",
        title: "Our moments",
        targetDuration: 7,
        candidateAssetIds: [photo.id, video.id],
        selectedAssetIds: [],
      },
    ],
  });
  app.project.timelines.push({
    id: "gesture-cut",
    storyId: "gesture-story",
    duration: 7,
    tracks: [
      {
        id: "visuals",
        type: "video",
        clips: [
          {
            id: "photo",
            assetId: photo.id,
            beatId: "moments",
            timelineStart: 0,
            timelineDuration: 4,
          },
          {
            id: "video",
            assetId: video.id,
            beatId: "moments",
            timelineStart: 4,
            timelineDuration: 3,
            sourceIn: 0,
            sourceOut: 3,
          },
        ],
      },
    ],
  });
  await app.save();
  app.close();
  expect(
    (
      await request.post(`${base}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  await initialLocale(page);
  await page.goto("/");
  await navigate(page, "edit");
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  return fixture;
}

async function clip(request: APIRequestContext, id = "photo"): Promise<Clip> {
  const response = await request.get(`${base}/compositions/gesture-cut/editor`);
  expect(response.ok()).toBe(true);
  const state = (await response.json()) as { composition: Composition };
  return state.composition.tracks
    .flatMap((track) => track.clips)
    .find((item) => item.id === id)!;
}

async function move(page: Page, x: number, y: number, cancel = false) {
  const control = page.getByRole("button", {
    name: "Move picture",
    exact: true,
  });
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  // The monitor controls intentionally sit above the picture. Start from the
  // exposed lower area so the test exercises the same hit target as a user.
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height * 0.82 };
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label"),
      start,
    ),
  ).toBe("Move picture");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(page.locator(".clip-transform-box")).toHaveClass(/dragging/);
  await page.mouse.move(start.x + x, start.y + y, { steps: 5 });
  await expect(
    page.getByLabel("Clip position X", { exact: true }),
  ).not.toHaveValue("0");
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}

async function resize(page: Page, x: number, y: number) {
  const control = page.getByRole("button", {
    name: "Resize picture bottom right",
    exact: true,
  });
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label"),
      start,
    ),
  ).toBe("Resize picture bottom right");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(page.locator(".clip-transform-box")).toHaveClass(/dragging/);
  await page.mouse.move(start.x + x, start.y + y, { steps: 5 });
  await expect(page.getByLabel("Clip scale", { exact: true })).not.toHaveValue(
    "1",
  );
  await page.mouse.up();
}

test("moves a clip with one transaction, cancels safely, and survives Undo/Redo and reopen", async ({
  page,
  request,
}) => {
  const fixture = await openFixture(page, request);
  const edits: unknown[] = [];
  page.on("request", (entry) => {
    if (
      entry.method() === "POST" &&
      new URL(entry.url()).pathname === "/api/compositions/gesture-cut/edit"
    )
      edits.push(entry.postDataJSON());
  });
  await page
    .getByRole("button", { name: "Adjust picture", exact: true })
    .click();
  await move(page, 24, 12);
  await expect
    .poll(async () => (await clip(request)).transform?.x ?? 0)
    .toBeGreaterThan(20);
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  const moved = (await clip(request)).transform!;
  // The browser frame is fractionally scaled to fit its container. The
  // persisted composition-space delta therefore need not be an integer.
  expect(moved.x).toBeCloseTo(24, 0);
  expect(moved.y).toBeCloseTo(12, 0);
  expect(edits).toHaveLength(1);
  expect(edits[0]).toMatchObject({
    commands: [
      {
        type: "transform",
        clipId: "photo",
        x: moved.x,
        y: moved.y,
        scale: 1,
        rotation: 0,
      },
    ],
  });

  await move(page, 30, 20, true);
  expect((await clip(request)).transform).toEqual(moved);
  expect(edits).toHaveLength(1);

  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request)).transform)
    .toBeUndefined();
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect.poll(async () => (await clip(request)).transform).toEqual(moved);

  await request.post(`${base}/project/close`);
  expect(
    (
      await request.post(`${base}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await navigate(page, "edit");
  expect((await clip(request)).transform).toEqual(moved);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("resizes a clip proportionally through one atomic transaction", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  const edits: unknown[] = [];
  page.on("request", (entry) => {
    if (
      entry.method() === "POST" &&
      new URL(entry.url()).pathname === "/api/compositions/gesture-cut/edit"
    )
      edits.push(entry.postDataJSON());
  });
  await page
    .getByRole("button", { name: "Adjust picture", exact: true })
    .click();
  await resize(page, 30, 15);
  await expect
    .poll(async () => (await clip(request)).transform?.scale ?? 1)
    .toBeGreaterThan(1.05);
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");

  const resized = (await clip(request)).transform!;
  expect(resized.x).toBeGreaterThan(0);
  expect(resized.y).toBeGreaterThan(0);
  expect(resized.rotation).toBe(0);
  expect(edits).toHaveLength(1);
  expect(edits[0]).toMatchObject({
    commands: [{ type: "transform", clipId: "photo", ...resized }],
  });

  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request)).transform)
    .toBeUndefined();
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request)).transform)
    .toEqual(resized);
});

test("restores the authoritative picture when a transform is rejected", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  await page.route(
    "**/api/compositions/gesture-cut/edit",
    (route) =>
      route.fulfill({
        status: 422,
        json: {
          error: "Synthetic transform rejection",
          code: "composition.invalidTransform",
        },
      }),
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Adjust picture", exact: true })
    .click();
  await move(page, 24, 12);

  await expect(page.getByLabel("Clip position X", { exact: true })).toHaveValue(
    "0",
  );
  await expect
    .poll(async () => (await clip(request)).transform)
    .toBeUndefined();
});

test("disables locked manipulation and cancels a drag when monitor geometry changes", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openFixture(page, request);
  const lock = page.getByRole("button", { name: "Lock clip", exact: true });
  await lock.click();
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  await expect(
    page.getByRole("button", { name: "Adjust picture", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Unlock clip", exact: true }).click();
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  await page
    .getByRole("button", { name: "Adjust picture", exact: true })
    .click();

  let editPosts = 0;
  page.on("request", (entry) => {
    if (
      entry.method() === "POST" &&
      new URL(entry.url()).pathname === "/api/compositions/gesture-cut/edit"
    )
      editPosts++;
  });
  const control = page.getByRole("button", {
    name: "Move picture",
    exact: true,
  });
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const start = {
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height * 0.82,
  };
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label"),
      start,
    ),
  ).toBe("Move picture");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(page.locator(".clip-transform-box")).toHaveClass(/dragging/);
  await page.mouse.move(start.x + 24, start.y + 12, {
    steps: 3,
  });
  await page.setViewportSize({ width: 1080, height: 720 });
  await expect(page.locator(".clip-transform-box")).not.toHaveClass(/dragging/);
  await page.mouse.up();
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  expect((await clip(request)).transform).toBeUndefined();
  expect(editPosts).toBe(0);
});

test.describe("coarse pointer", () => {
  test.use({ hasTouch: true });
  test("keeps direct resize controls touch-sized", async ({
    page,
    request,
  }) => {
    await openFixture(page, request);
    await page
      .getByRole("button", { name: "Adjust picture", exact: true })
      .click();
    for (const name of [
      "Resize picture top left",
      "Resize picture top right",
      "Resize picture bottom right",
      "Resize picture bottom left",
    ]) {
      const bounds = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.width, name).toBeGreaterThanOrEqual(44);
      expect(bounds!.height, name).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          ({ box, label }) =>
            [
              [box.x + 2, box.y + 2],
              [box.x + box.width - 2, box.y + 2],
              [box.x + 2, box.y + box.height - 2],
              [box.x + box.width - 2, box.y + box.height - 2],
            ].every(
              ([x, y]) =>
                document
                  .elementFromPoint(x!, y!)
                  ?.getAttribute("aria-label") === label,
            ),
          { box: bounds!, label: name },
        ),
        `${name} must remain hit-testable across its full target`,
      ).toBe(true);
    }
  });
});
