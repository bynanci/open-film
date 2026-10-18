import {
  test,
  expect,
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
  expect((await request.post(`${base}/project/close`)).ok()).toBe(true);
  await Promise.all(cleanup.splice(0).map((action) => action()));
});

async function openFixture(page: Page, request: APIRequestContext) {
  const fixture = await createDesktopFixture(1);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "A picture to shape",
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
  const box = await page
    .getByRole("button", { name: "Move picture", exact: true })
    .boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + x, start.y + y, { steps: 5 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}

test("moves and resizes a picture with separate undo, cancellation, and durable reopening", async ({
  page,
  request,
}) => {
  const fixture = await openFixture(page, request);
  await page
    .getByRole("button", { name: "Adjust picture", exact: true })
    .click({ timeout: 3000 });
  await expect(
    page.getByRole("group", { name: "Picture transform", exact: true }),
  ).toBeVisible();
  await move(page, 24, 12);
  await expect
    .poll(async () => (await clip(request)).transform?.x ?? 0)
    .toBeGreaterThan(0);
  const first = (await clip(request)).transform!;
  await move(page, 12, -6);
  await expect
    .poll(async () => (await clip(request)).transform?.x)
    .toBeGreaterThan(first.x!);
  const second = (await clip(request)).transform!;
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect.poll(async () => (await clip(request)).transform).toEqual(first);
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request)).transform)
    .toEqual(second);
  await move(page, 30, 20, true);
  expect((await clip(request)).transform).toEqual(second);
  await page
    .getByRole("button", { name: "Reset picture", exact: true })
    .click();
  await expect.poll(async () => (await clip(request)).transform?.x).toBe(0);
  const handle = page.getByRole("button", {
    name: "Resize picture bottom right",
    exact: true,
  });
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 - 45,
    box!.y + box!.height / 2 - 25,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await clip(request)).transform?.scale)
    .toBeLessThan(1);
  const resized = (await clip(request)).transform!;
  expect((await request.post(`${base}/project/close`)).ok()).toBe(true);
  expect(
    (
      await request.post(`${base}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await navigate(page, "edit");
  expect((await clip(request)).transform).toEqual(resized);
});

test("adjusts rotated video with the keyboard while preserving playback and cancels on viewport resize", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  await page.locator("#clip-video").click();
  const rotation = page.getByLabel("Clip rotation", { exact: true });
  await rotation.fill("45");
  await rotation.press("Tab");
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  const video = page.locator(".editor-composition-frame video");
  await expect(video).toHaveJSProperty("controls", true);
  await page
    .getByRole("button", { name: "Adjust picture", exact: true })
    .click();
  await expect(video).toHaveJSProperty("controls", false);
  await page.getByRole("button", { name: "Play clip", exact: true }).click();
  await expect(video).toHaveJSProperty("paused", false);
  await page.getByRole("button", { name: "Pause clip", exact: true }).click();
  const control = page.getByRole("button", {
    name: "Move picture",
    exact: true,
  });
  await control.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(async () => (await clip(request, "video")).transform?.x)
    .toBe(10);
  expect((await clip(request, "video")).transform?.rotation).toBe(45);
  await expect(page.locator("#clip-video")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const before = (await clip(request, "video")).transform;
  const box = await control.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 24,
    box!.y + box!.height / 2 + 12,
    { steps: 3 },
  );
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: viewport.width - 120,
    height: viewport.height - 80,
  });
  await expect(page.getByLabel("Clip position X", { exact: true })).toHaveValue(
    "10",
  );
  await page.mouse.up();
  expect((await clip(request, "video")).transform).toEqual(before);
  await page.screenshot({
    path: "/workspace/.openfilm-tools/preview-transform.png",
    fullPage: true,
  });
});

test("recovers a failed gesture save after reload and disables locked picture manipulation", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  const endpoint = "**/api/compositions/gesture-cut/edit";
  await page.route(endpoint, (route) => route.abort("failed"));
  await page
    .getByRole("button", { name: "Adjust picture", exact: true })
    .click();
  await move(page, 24, 12);
  await expect(page.locator(".editor-save-state")).toHaveText("Save failed");
  expect((await clip(request)).transform).toBeUndefined();
  const draft = await page
    .getByLabel("Clip position X", { exact: true })
    .inputValue();
  expect(Number(draft)).toBeGreaterThan(0);
  await page.unroute(endpoint);
  await page.reload();
  await navigate(page, "edit");
  await expect
    .poll(async () => (await clip(request)).transform?.x)
    .toBeCloseTo(Number(draft), 5);
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  await page.getByRole("button", { name: "Lock clip", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Adjust picture", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("group", { name: "Picture transform", exact: true }),
  ).toHaveCount(0);
});

test("keeps other editing controls disabled until a gesture save completes", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/compositions/gesture-cut/edit", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Adjust picture", exact: true })
      .click();
    await move(page, 24, 12);
    await expect(page.locator(".editor-save-state")).toHaveText("Saving…");
    await expect(
      page.getByRole("button", { name: "Lock clip", exact: true }),
    ).toBeDisabled({ timeout: 1000 });
    await expect(page.locator("#clip-photo")).toHaveAttribute(
      "draggable",
      "false",
    );
  } finally {
    release();
  }
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  await expect(
    page.getByRole("button", { name: "Lock clip", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("#clip-photo")).toHaveAttribute(
    "draggable",
    "true",
  );
});

test("keeps picture tools inside the preview monitor", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  await page
    .getByRole("button", { name: "Adjust picture", exact: true })
    .click();
  const monitor = await page.locator(".editor-source-screen").boundingBox();
  const tools = await page.locator(".editor-picture-tools").boundingBox();
  expect(tools!.y).toBeGreaterThanOrEqual(monitor!.y);
  expect(tools!.y + tools!.height).toBeLessThanOrEqual(
    monitor!.y + monitor!.height,
  );
});

test("uses the last valid picture geometry after a rejected numeric scale", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  const scale = page.getByLabel("Clip scale", { exact: true });
  await scale.fill("-1");
  await scale.press("Tab");
  await page
    .getByRole("button", { name: "Adjust picture", exact: true })
    .click();
  await move(page, 24, 12);
  await expect
    .poll(async () => (await clip(request)).transform?.x ?? 0)
    .toBeGreaterThan(0);
  expect((await clip(request)).transform?.scale).toBe(1);
});

test("trims proportional tracks and ripples the following clip with one-step undo", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  await page
    .getByRole("button", { name: "Time tracks", exact: true })
    .click({ timeout: 3000 });
  const handle = page.getByRole("button", {
    name: "Trim end of 01-photo.png",
    exact: true,
  });
  await handle.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect
    .poll(async () => (await clip(request)).timelineDuration)
    .toBeLessThan(4);
  const shortened = await clip(request);
  expect((await clip(request, "video")).timelineStart).toBeCloseTo(
    shortened.timelineDuration,
    5,
  );
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect.poll(async () => (await clip(request)).timelineDuration).toBe(4);
  await expect
    .poll(async () => (await clip(request, "video")).timelineStart)
    .toBe(4);
});

test("cancels picture dragging with Escape after tabbing outside its overlay", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  const before = await clip(request);
  const edits: string[] = [];
  page.on("request", (entry) => {
    if (
      entry.method() === "POST" &&
      new URL(entry.url()).pathname === "/api/compositions/gesture-cut/edit"
    )
      edits.push(entry.url());
  });
  const toggle = page.getByRole("button", {
    name: "Adjust picture",
    exact: true,
  });
  await toggle.click();
  const control = page.getByRole("button", {
    name: "Move picture",
    exact: true,
  });
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(start.x + 24, start.y + 12, { steps: 3 });
    const x = page.getByLabel("Clip position X", { exact: true });
    await expect(x).not.toHaveValue(String(before.transform?.x ?? 0));
    for (let index = 0; index < 5; index++) await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(x).toHaveValue(String(before.transform?.x ?? 0));
  } finally {
    await page.mouse.up();
  }
  expect((await clip(request)).transform).toEqual(before.transform);
  expect(edits).toHaveLength(0);
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
});
