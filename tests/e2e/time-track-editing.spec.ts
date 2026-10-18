import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
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

async function openFixture(
  page: Page,
  request: APIRequestContext,
  photoDuration = 4,
) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "An editable time track",
  );
  await app.importFolder(fixture.media);
  const assets = app.catalog.listAssets({ limit: 100 });
  const photo = assets.find((asset) => asset.name === "01-photo.png")!;
  const motion = assets.find((asset) => asset.name === "04-motion.mp4")!;
  const audio = assets.find((asset) => asset.name === "05-tone.wav")!;
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.project.stories.push({
    id: "track-story",
    title: "Timed moments",
    targetDuration: 7,
    maxDuration: Math.max(20, photoDuration + 10),
    beats: [
      {
        id: "moments",
        title: "Our moments",
        candidateAssetIds: [motion.id, photo.id, audio.id],
      },
    ],
  });
  app.project.timelines.push({
    id: "track-cut",
    storyId: "track-story",
    duration: 3 + photoDuration,
    tracks: [
      {
        id: "visuals",
        type: "video",
        clips: [
          {
            id: "motion",
            assetId: motion.id,
            beatId: "moments",
            timelineStart: 1,
            timelineDuration: 1,
            sourceIn: 0.5,
            sourceOut: 2.5,
            transform: { speed: 2 },
          },
          {
            id: "photo",
            assetId: photo.id,
            beatId: "moments",
            timelineStart: 3,
            timelineDuration: photoDuration,
          },
        ],
      },
      {
        id: "audio",
        type: "audio",
        clips: [
          {
            id: "sound",
            assetId: audio.id,
            beatId: "moments",
            timelineStart: 0,
            timelineDuration: 2,
            sourceIn: 0,
            sourceOut: 2,
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
  await page.getByRole("button", { name: "Time tracks", exact: true }).click();
  return fixture;
}

async function composition(request: APIRequestContext): Promise<Composition> {
  const response = await request.get(`${base}/compositions/track-cut/editor`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { composition: Composition }).composition;
}
async function clip(request: APIRequestContext, id = "motion"): Promise<Clip> {
  return (await composition(request)).tracks
    .flatMap((track) => track.clips)
    .find((item) => item.id === id)!;
}
async function drag(
  page: Page,
  handle: Locator,
  delta: number,
  cancel = false,
) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + delta, start.y, { steps: 5 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}

test("pointer edge trims use the ruler scale and playback speed, ripple gaps and undo once", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  const pane = await page.locator(".editor-time-track-area").boundingBox();
  const firstClip = await page
    .locator(".time-track-row .time-track-clip")
    .first()
    .boundingBox();
  expect(pane).not.toBeNull();
  expect(firstClip).not.toBeNull();
  expect(firstClip!.y + firstClip!.height).toBeLessThanOrEqual(
    pane!.y + pane!.height,
  );
  const edits: unknown[] = [];
  page.on("request", (entry) => {
    if (
      entry.method() === "POST" &&
      new URL(entry.url()).pathname === "/api/compositions/track-cut/edit"
    )
      edits.push(entry.postDataJSON());
  });
  const handle = page.getByRole("button", {
    name: "Trim end of 04-motion.mp4",
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 12, start.y, { steps: 5 });
  expect((await clip(request)).sourceOut).toBe(2.5);
  expect(edits).toHaveLength(0);
  await expect
    .poll(
      async () =>
        (
          await page
            .locator('.time-track-clip[data-clip-id="motion"]')
            .boundingBox()
        )?.width,
    )
    .toBeCloseTo(36, 0);
  await page.mouse.up();
  await expect.poll(async () => (await clip(request)).sourceOut).toBe(2);
  expect((await clip(request)).timelineStart).toBe(1);
  expect((await clip(request, "photo")).timelineStart).toBeCloseTo(2.75, 5);
  expect(edits).toHaveLength(1);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect.poll(async () => (await clip(request)).sourceOut).toBe(2.5);
  await expect
    .poll(async () => (await clip(request, "photo")).timelineStart)
    .toBe(3);
  await drag(
    page,
    page.getByRole("button", {
      name: "Trim start of 04-motion.mp4",
      exact: true,
    }),
    12,
  );
  await expect.poll(async () => (await clip(request)).sourceIn).toBe(1);
  expect((await clip(request)).timelineDuration).toBe(0.75);
  expect((await clip(request)).timelineStart).toBe(1);
});

test("Escape cancels a captured trim and source bounds retain at least one output frame", async ({
  page,
  request,
}) => {
  const fixture = await openFixture(page, request);
  const before = await composition(request);
  const end = page.getByRole("button", {
    name: "Trim end of 04-motion.mp4",
    exact: true,
  });
  await drag(page, end, 80, true);
  expect(await composition(request)).toEqual(before);
  await drag(page, end, 240);
  await expect.poll(async () => (await clip(request)).sourceOut).toBe(3);
  await drag(
    page,
    page.getByRole("button", {
      name: "Trim start of 04-motion.mp4",
      exact: true,
    }),
    240,
  );
  await expect
    .poll(async () => (await clip(request)).timelineDuration)
    .toBeCloseTo(1 / 24, 6);
  expect((await clip(request)).sourceIn).toBeCloseTo(3 - 2 / 24, 6);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("keyboard trimming works for video, audio and either photo edge", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  const end = page.getByRole("button", {
    name: "Trim end of 04-motion.mp4",
    exact: true,
  });
  await end.focus();
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => (await clip(request)).sourceOut)
    .toBeCloseTo(2.5 - 2 / 24, 6);
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  await expect(end).toBeFocused();
  const photoStart = page.getByRole("button", {
    name: "Trim start of 01-photo.png",
    exact: true,
  });
  await photoStart.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect
    .poll(async () => (await clip(request, "photo")).timelineDuration)
    .toBeCloseTo(4 + 10 / 24, 6);
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  await expect(photoStart).toBeFocused();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect
    .poll(async () => (await clip(request, "photo")).timelineDuration)
    .toBeCloseTo(4 + 20 / 24, 6);
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  await expect(photoStart).toBeFocused();
  const audioEnd = page.getByRole("button", {
    name: "Trim end of 05-tone.wav",
    exact: true,
  });
  await audioEnd.focus();
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => (await clip(request, "sound")).sourceOut)
    .toBeCloseTo(2 - 1 / 24, 6);
});

test("changing the selected clip cancels a captured draft before it can affect the new selection", async ({
  page,
  request,
}) => {
  await openFixture(page, request);
  const before = await composition(request);
  const end = page.getByRole("button", {
    name: "Trim end of 04-motion.mp4",
    exact: true,
  });
  await end.scrollIntoViewIfNeeded();
  const box = await end.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y, { steps: 5 });
  await expect(
    page.locator('.time-track-clip[data-clip-id="motion"]'),
  ).toHaveClass(/is-drafting/);
  // Move keyboard focus outside the handle while the pointer remains captured,
  // then use the editor's normal next-clip shortcut.
  await page.locator(".time-track-scroller").focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.locator(
      '.time-track-clip[data-clip-id="photo"] .time-track-clip-body',
    ),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".time-track-clip.is-drafting")).toHaveCount(0);
  await page.mouse.up();
  expect(await composition(request)).toEqual(before);
  const photoEnd = page.getByRole("button", {
    name: "Trim end of 01-photo.png",
    exact: true,
  });
  await photoEnd.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await clip(request, "photo")).timelineDuration)
    .toBeCloseTo(4 + 1 / 24, 6);
  expect((await clip(request)).sourceOut).toBe(2.5);
});

test("trimming the final clip at the right scroll limit keeps one ruler delta without a scroll jump", async ({
  page,
  request,
}, testInfo) => {
  await openFixture(page, request, 60);
  await page.screenshot({
    path: testInfo.outputPath("time-tracks.png"),
    fullPage: true,
  });
  const scroller = page.locator(".time-track-scroller");
  await page
    .locator('.time-track-clip[data-clip-id="photo"] .time-track-clip-body')
    .click({ position: { x: 20, y: 15 } });
  const originalScroll = await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    return element.scrollLeft;
  });
  expect(originalScroll).toBeGreaterThan(0);
  const end = page.getByRole("button", {
    name: "Trim end of 01-photo.png",
    exact: true,
  });
  const box = await end.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 12, start.y);
  await expect(
    page.locator('.time-track-clip[data-clip-id="photo"]'),
  ).toHaveClass(/is-drafting/);
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(
    originalScroll,
  );
  // A second event at the same coordinate must retain the same 12 px / 48 px/s delta.
  await page.mouse.move(start.x - 12, start.y);
  await page.mouse.up();
  await expect
    .poll(async () => (await clip(request, "photo")).timelineDuration)
    .toBeCloseTo(59.75, 6);
});

test("one-frame clips keep precise widths and independently reachable start and end handles", async ({
  page,
  request,
}) => {
  await openFixture(page, request, 1 / 24);
  const photo = page.locator('.time-track-clip[data-clip-id="photo"]');
  await photo.scrollIntoViewIfNeeded();
  expect((await photo.boundingBox())!.width).toBeCloseTo(2, 3);
  const start = page.getByRole("button", {
    name: "Trim start of 01-photo.png",
    exact: true,
  });
  const end = page.getByRole("button", {
    name: "Trim end of 01-photo.png",
    exact: true,
  });
  for (const handle of [start, end]) {
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const labelAtCenter = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label"),
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    );
    expect(labelAtCenter).toBe(await handle.getAttribute("aria-label"));
  }
  await expect(
    page.locator(
      '.time-track-clip[data-clip-id="motion"] .time-track-clip-body',
    ),
  ).toHaveAttribute("aria-pressed", "true");
  // The first pointer gesture must both select this photo and resize it; a
  // preview-source change must not cancel the newly selected clip's gesture.
  await drag(page, start, -12);
  await expect
    .poll(async () => (await clip(request, "photo")).timelineDuration)
    .toBeCloseTo(1 / 24 + 0.25, 6);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request, "photo")).timelineDuration)
    .toBeCloseTo(1 / 24, 6);
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  await drag(page, end, 12);
  await expect
    .poll(async () => (await clip(request, "photo")).timelineDuration)
    .toBeCloseTo(1 / 24 + 0.25, 6);
});

for (const resize of ["viewport", "inspector"] as const) {
  test(`resizing the ${resize} cancels a captured trim before scroll clamping can change its duration`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openFixture(page, request, 60);
    const before = await composition(request);
    let editPosts = 0;
    page.on("request", (entry) => {
      if (
        entry.method() === "POST" &&
        new URL(entry.url()).pathname === "/api/compositions/track-cut/edit"
      )
        editPosts++;
    });
    const scroller = page.locator(".time-track-scroller");
    await page
      .locator('.time-track-clip[data-clip-id="photo"] .time-track-clip-body')
      .click({ position: { x: 20, y: 15 } });
    const original = await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      return { scroll: element.scrollLeft, width: element.clientWidth };
    });
    expect(original.scroll).toBeGreaterThan(0);
    const end = page.getByRole("button", {
      name: "Trim end of 01-photo.png",
      exact: true,
    });
    const box = await end.boundingBox();
    expect(box).not.toBeNull();
    const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 12, start.y);
    await expect(
      page.locator('.time-track-clip[data-clip-id="photo"]'),
    ).toHaveClass(/is-drafting/);
    if (resize === "viewport") {
      await page.setViewportSize({ width: 1480, height: 720 });
    } else {
      // Keyboard activation changes the container without releasing its active pointer.
      await page
        .getByRole("button", { name: "Hide inspector", exact: true })
        .focus();
      await page.keyboard.press("Enter");
    }
    await expect
      .poll(async () => scroller.evaluate((element) => element.clientWidth))
      .toBeGreaterThan(original.width);
    await expect
      .poll(async () => scroller.evaluate((element) => element.scrollLeft))
      .toBeLessThan(original.scroll);
    await expect(page.locator(".time-track-clip.is-drafting")).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator(".editor-save-state")).toHaveText("Saved");
    expect(await composition(request)).toEqual(before);
    expect(editPosts).toBe(0);
  });
}

for (const selection of ["selected", "unselected"] as const) {
  test(`direct trimming a ${selection} clip keeps the collapsed inspector closed and completes the gesture`, async ({
    page,
    request,
  }) => {
    await openFixture(page, request);
    await page
      .getByRole("button", { name: "Hide inspector", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Show inspector", exact: true }),
    ).toBeVisible();
    const handle = page.getByRole("button", {
      name:
        selection === "selected"
          ? "Trim end of 04-motion.mp4"
          : "Trim start of 01-photo.png",
      exact: true,
    });
    await drag(page, handle, -12);
    if (selection === "selected") {
      await expect.poll(async () => (await clip(request)).sourceOut).toBe(2);
    } else {
      await expect
        .poll(async () => (await clip(request, "photo")).timelineDuration)
        .toBe(4.25);
      await expect(
        page.locator(
          '.time-track-clip[data-clip-id="photo"] .time-track-clip-body',
        ),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await expect(
      page.getByRole("button", { name: "Show inspector", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".editor-save-state")).toHaveText("Saved");
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    if (selection === "selected") {
      await expect
        .poll(async () => (await clip(request)).sourceOut)
        .toBeCloseTo(2 - 2 / 24, 6);
    } else {
      await expect
        .poll(async () => (await clip(request, "photo")).timelineDuration)
        .toBeCloseTo(4.25 + 1 / 24, 6);
    }
    await expect(
      page.getByRole("button", { name: "Show inspector", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".editor-save-state")).toHaveText("Saved");
    await page
      .locator(
        `.time-track-clip[data-clip-id="${selection === "selected" ? "motion" : "photo"}"] .time-track-clip-body`,
      )
      .click();
    await expect(
      page.getByRole("button", { name: "Hide inspector", exact: true }),
    ).toBeVisible();
  });
}
