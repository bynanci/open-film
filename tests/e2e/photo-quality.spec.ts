import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type { Clip, Composition, ProjectContentLocale } from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310";
const cleanup: (() => Promise<void>)[] = [];
test.afterAll(async ({ request }) => {
  await request.post(`${base}/api/project/close`, { data: {} });
  await Promise.all(cleanup.map((action) => action()));
});
async function createFilm(
  request: APIRequestContext,
  preset?:
    | "motion-only"
    | "diptych-gap"
    | "title-only"
    | "audio-rate"
    | "audio-unsupported",
) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Photo film quality",
  );
  await app.importFolder(fixture.media);
  const assets = app.catalog.listAssets({ limit: 100 });
  const id = (name: string) => assets.find((asset) => asset.name === name)!.id;
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.project.stories.push({
    id: "photo-quality-story",
    title: "Our memories",
    targetDuration: 20,
    maxDuration: 20,
    beats: [
      {
        id: "memories",
        title: "Time together",
        targetDuration: 20,
        minDuration: 1,
        maxDuration: 20,
        selectedAssetIds: [],
      },
    ],
  });
  app.project.timelines.push({
    id: "photo-quality-cut",
    storyId: "photo-quality-story",
    duration: 20,
    tracks: [
      {
        id: "visuals",
        type: "video",
        clips: [
          {
            id: "photo-one",
            assetId: id("01-photo.png"),
            beatId: "memories",
            timelineStart: 0,
            timelineDuration: 10,
          },
          {
            id: "photo-two",
            assetId: id("03-evening.png"),
            beatId: "memories",
            timelineStart: 10,
            timelineDuration: 10,
          },
        ],
      },
    ],
  });
  const first = app.project.timelines[0]!.tracks[0]!.clips[0]!;
  if (preset === "motion-only")
    first.motion = {
      version: 1,
      preset: "push-in",
      easing: "ease-in-out",
      from: { scale: 1, x: 0, y: 0 },
      to: { scale: 1.06, x: 0, y: 0 },
    };
  if (preset === "diptych-gap")
    first.layout = {
      version: 1,
      preset: "diptych",
      gap: 16,
      secondary: { assetId: id("03-evening.png") },
    };
  if (preset === "title-only") {
    first.title = "重要的是，我們一起。";
    first.titleStyle = { version: 1, role: "film-title", position: "center" };
    first.transform = { scale: 1.2, rotation: 5, x: 10 };
    const second = app.project.timelines[0]!.tracks[0]!.clips[1]!;
    second.assetId = id("04-motion.mp4");
    second.timelineDuration = 3;
    second.sourceIn = 0;
    second.sourceOut = 3;
    second.title = "一段真實的回憶";
    second.titleStyle = { version: 1, role: "scene-statement" };
  }
  const audioId = id("05-tone.wav");
  if (preset === "audio-rate" || preset === "audio-unsupported")
    app.project.timelines[0]!.tracks.push({
      id: "music",
      type: "music",
      timing: "overlay",
      clips: [
        {
          id: "seeded-sound",
          assetId: audioId,
          timelineStart: 0,
          timelineDuration: preset === "audio-unsupported" ? 2 : 0.75,
          sourceIn: 0.25,
          sourceOut: preset === "audio-unsupported" ? 0.27 : 1.75,
          transform: {
            speed: preset === "audio-unsupported" ? 0.01 : 2,
            volume: 0.8,
          },
          audioAutomation: { version: 1, role: "music" },
        },
      ],
    });
  app.close();
  expect(
    (
      await request.post(`${base}/api/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  return { ...fixture, audioId };
}
async function editor(
  request: APIRequestContext,
): Promise<{ composition: Composition; revision: string }> {
  const response = await request.get(
    `${base}/api/compositions/photo-quality-cut/editor`,
  );
  expect(response.ok()).toBe(true);
  return response.json();
}
async function clip(
  request: APIRequestContext,
  id = "photo-one",
): Promise<Clip> {
  return (await editor(request)).composition.tracks
    .flatMap((track) => track.clips)
    .find((item) => item.id === id)!;
}
async function field(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Tab");
}
async function openEditor(page: Page) {
  page.setDefaultTimeout(15_000);
  await initialLocale(page);
  await page.goto("/");
  await navigate(page, "edit");
  await expect(page.locator("#clip-photo-one")).toBeVisible();
  await page.locator("#clip-photo-one").click();
}

test("persisted motion without a layout seeks and plays without changing the film", async ({
  page,
  request,
}) => {
  await createFilm(request, "motion-only");
  const before = await editor(request);
  expect((await clip(request)).layout).toBeUndefined();
  await openEditor(page);
  await expect(page.locator(".photo-presentation-frame")).toBeVisible();
  await expect(page.getByLabel("Photo layout", { exact: true })).toHaveValue(
    "contain",
  );
  await expect(
    page.getByRole("button", { name: "Gentle push-in", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const seek = page.getByLabel("Seek within photo presentation", {
    exact: true,
  });
  await seek.focus();
  await seek.press("End");
  await expect(page.locator(".photo-presentation-layers")).toHaveAttribute(
    "style",
    /scale\(1\.06\)/,
  );
  await seek.press("Home");
  await page.locator(".editor-story-rail").focus();
  await page.keyboard.press("Space");
  await expect(
    page.locator(".photo-presentation-transport button"),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(
    page.locator(".photo-presentation-transport button"),
  ).toHaveAttribute("aria-pressed", "false");
  expect(await editor(request)).toEqual(before);
});

test("reopened diptych spacing is removed when choosing a single-photo layout", async ({
  page,
  request,
}) => {
  await createFilm(request, "diptych-gap");
  await openEditor(page);
  await expect(page.getByLabel("Photo layout", { exact: true })).toHaveValue(
    "diptych",
  );
  expect((await clip(request)).layout?.gap).toBe(16);
  await page.getByLabel("Photo layout", { exact: true }).selectOption("hero");
  await expect
    .poll(async () => (await clip(request)).layout)
    .toEqual({ version: 1, preset: "hero", focalPoint: { x: 0.5, y: 0.5 } });
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect.poll(async () => (await clip(request)).layout?.gap).toBe(16);
  await page
    .getByLabel("Photo layout", { exact: true })
    .selectOption("contain");
  await expect
    .poll(async () => (await clip(request)).layout)
    .toEqual({ version: 1, preset: "contain", focalPoint: { x: 0.5, y: 0.5 } });
});

test("title-only photos and videos show the shared title image outside source transforms", async ({
  page,
  request,
}) => {
  await createFilm(request, "title-only");
  await openEditor(page);
  for (const id of ["photo-one", "photo-two"]) {
    await page.locator(`#clip-${id}`).click();
    await expect(page.locator(".photo-presentation-preview")).toHaveCount(0);
    const title = page.locator(".editor-title-overlay");
    await expect(title).toBeVisible();
    await expect
      .poll(() =>
        title.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBe(320);
    const frame = await page.locator(".editor-composition-frame").boundingBox();
    const bounds = await title.boundingBox();
    expect(bounds!.width).toBeCloseTo(frame!.width, 0);
    expect(bounds!.height).toBeCloseTo(frame!.height, 0);
    await expect(title).toHaveCSS("transform", "none");
  }
});

test("sound preview reloads restored trim and speed on Undo and Redo", async ({
  page,
  request,
}) => {
  await createFilm(request, "audio-rate");
  const before = await editor(request);
  const edited = await request.post(
    `${base}/api/compositions/photo-quality-cut/edit`,
    {
      data: {
        baseRevision: before.revision,
        requestId: "sound-rate-fixture",
        commands: [
          { type: "speed", clipId: "seeded-sound", speed: 1 },
          {
            type: "trim",
            clipId: "seeded-sound",
            sourceIn: 0.5,
            sourceOut: 1.5,
          },
        ],
      },
    },
  );
  expect(edited.ok()).toBe(true);
  await openEditor(page);
  await page.getByRole("button", { name: "Sound", exact: true }).click();
  await page.locator(".editor-soundtrack-list button").first().click();
  const player = page.locator(".editor-soundtrack-panel audio");
  await expect
    .poll(() =>
      player.evaluate((audio) => (audio as HTMLAudioElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await expect(player).toHaveJSProperty("playbackRate", 1);
  await expect
    .poll(() =>
      player.evaluate((audio) => (audio as HTMLAudioElement).currentTime),
    )
    .toBeCloseTo(0.5, 2);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect(player).toHaveJSProperty("playbackRate", 2);
  await expect
    .poll(() =>
      player.evaluate((audio) => (audio as HTMLAudioElement).currentTime),
    )
    .toBeCloseTo(0.25, 2);
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect(player).toHaveJSProperty("playbackRate", 1);
  await expect
    .poll(() =>
      player.evaluate((audio) => (audio as HTMLAudioElement).currentTime),
    )
    .toBeCloseTo(0.5, 2);
});

test("unsupported sound speed stays paused when native playback is requested", async ({
  page,
  request,
}) => {
  await createFilm(request, "audio-unsupported");
  await openEditor(page);
  await page.getByRole("button", { name: "Sound", exact: true }).click();
  await page.locator(".editor-soundtrack-list button").first().click();
  const panel = page.locator(".editor-soundtrack-panel");
  await expect(
    panel.getByText(
      "This speed cannot be previewed here. Render a preview to watch the edit.",
      { exact: true },
    ),
  ).toBeVisible();
  const player = panel.locator("audio");
  await player.evaluate((audio) =>
    (audio as HTMLAudioElement).play().catch(() => {}),
  );
  await expect(player).toHaveJSProperty("paused", true);
  await expect(
    panel.getByText(
      "This speed cannot be previewed here. Render a preview to watch the edit.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("photo direction, CJK titles and overlay sound survive history and reopen", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await page
    .getByLabel("Photo layout", { exact: true })
    .selectOption("diptych");
  await expect
    .poll(async () => (await clip(request)).layout?.preset)
    .toBe("diptych");
  await expect(page.locator(".photo-presentation-layers img")).toHaveCount(2);
  await page.getByLabel("Photo layout", { exact: true }).selectOption("hero");
  await expect
    .poll(async () => (await clip(request)).layout?.preset)
    .toBe("hero");
  await page
    .getByRole("button", { name: "Gentle push-in", exact: true })
    .click();
  await expect
    .poll(async () => (await clip(request)).motion?.preset)
    .toBe("push-in");
  const seek = page.getByLabel("Seek within photo presentation", {
    exact: true,
  });
  await seek.focus();
  await seek.press("End");
  await expect(page.locator(".photo-presentation-layers")).toHaveAttribute(
    "style",
    /scale\(1\.06\)/,
  );
  await seek.press("Home");
  await page.locator(".editor-story-rail").focus();
  await page.keyboard.press("Space");
  await expect(
    page.locator(".photo-presentation-transport button"),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(
    page.locator(".photo-presentation-transport button"),
  ).toHaveAttribute("aria-pressed", "false");
  const title = "我們一起走過，那些平凡而重要的日子。";
  await field(page, "Text shown in the film", title);
  await expect.poll(async () => (await clip(request)).title).toBe(title);
  await page
    .getByLabel("Text role", { exact: true })
    .selectOption("film-title");
  await expect
    .poll(async () => (await clip(request)).titleStyle?.role)
    .toBe("film-title");
  await expect
    .poll(() =>
      page.locator(".photo-presentation-title").evaluate((image) => ({
        complete: (image as HTMLImageElement).complete,
        width: (image as HTMLImageElement).naturalWidth,
      })),
    )
    .toEqual({ complete: true, width: 320 });
  const titleInput = page.getByLabel("Text shown in the film", { exact: true });
  await titleInput.focus();
  await titleInput.press("End");
  await titleInput.press("Space");
  await expect(titleInput).toHaveValue(`${title} `);
  await expect(
    page.locator(".photo-presentation-transport button"),
  ).toHaveAttribute("aria-pressed", "false");
  await titleInput.press("Backspace");
  await titleInput.press("Tab");
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request)).titleStyle?.role)
    .toBe("scene-statement");
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request)).titleStyle?.role)
    .toBe("film-title");
  await page.getByRole("button", { name: "Sound", exact: true }).click();
  await page
    .getByLabel("Audio source", { exact: true })
    .selectOption(fixture.audioId);
  await page.getByRole("button", { name: "Add to film", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await editor(request)).composition.tracks
          .filter((track) => track.timing === "overlay")
          .flatMap((track) => track.clips).length,
    )
    .toBe(1);
  await expect(page.locator(".editor-story-rail .editor-clip")).toHaveCount(2);
  const audioButton = page.locator(".editor-soundtrack-list button").first();
  await audioButton.click();
  await field(page, "Fade in (seconds)", "0.2");
  await field(page, "Fade out (seconds)", "0.2");
  await page.getByText("Lower music during speech", { exact: true }).click();
  await field(page, "Fade down (seconds)", "0.1");
  await field(page, "Fade up (seconds)", "0.1");
  await page
    .getByRole("button", { name: "Apply ducking region", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await editor(request)).composition.tracks
          .flatMap((track) => track.clips)
          .find((item) => item.audioAutomation?.role === "music")
          ?.audioAutomation?.ducking?.length,
    )
    .toBe(1);
  await page
    .getByLabel("Audio role", { exact: true })
    .selectOption("narration");
  await page.getByRole("button", { name: "Add to film", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await editor(request)).composition.tracks
          .flatMap((track) => track.clips)
          .filter((item) => item.audioAutomation).length,
    )
    .toBe(2);
  const before = await editor(request);
  expect(before.composition.duration).toBe(20);
  expect(
    before.composition.tracks[0]!.clips.map((item) => item.timelineStart),
  ).toEqual([0, 10]);
  expect(
    (await request.post(`${base}/api/project/close`, { data: {} })).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`${base}/api/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await navigate(page, "edit");
  await expect(page.locator("#clip-photo-one")).toBeVisible();
  const reopened = await editor(request);
  expect(reopened.composition).toEqual(before.composition);
  await page.locator("#clip-photo-one").click();
  await expect(page.getByLabel("Photo layout", { exact: true })).toHaveValue(
    "hero",
  );
  await expect(
    page.getByLabel("Text shown in the film", { exact: true }),
  ).toHaveValue(title);
  await page.getByRole("button", { name: "Lock clip", exact: true }).click();
  await expect(page.getByLabel("Photo layout", { exact: true })).toBeDisabled();
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("photo controls fit desktop sizes in English, Traditional Chinese and Japanese", async ({
  page,
  request,
}, testInfo) => {
  await createFilm(request);
  await openEditor(page);
  await page
    .getByLabel("Photo layout", { exact: true })
    .selectOption("contain");
  await expect
    .poll(async () => (await clip(request)).layout?.preset)
    .toBe("contain");
  await field(
    page,
    "Text shown in the film",
    "我們一起走過那些平凡又重要的日子，Our memories in every little moment.",
  );
  await expect
    .poll(async () => (await clip(request)).title?.includes("Our memories"))
    .toBe(true);
  for (const locale of ["en-US", "zh-TW", "ja-JP", "en-XA"] as (
    ProjectContentLocale | "en-XA"
  )[]) {
    await page.addInitScript(
      (value) => localStorage.setItem("openfilm.uiLocale", value),
      locale,
    );
    await page.reload();
    if (locale === "en-XA")
      await page.locator(".main-nav button").nth(2).click();
    else await navigate(page, "edit", locale);
    await expect(
      page.locator(".editor-presentation-inspector select").first(),
    ).toHaveValue("contain");
    for (const [width, height] of [
      [1280, 720],
      [1440, 900],
      [1920, 1080],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect(page.locator(".photo-presentation-frame")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        )
        .toBe(true);
      const dimensions = await page
        .locator(".photo-presentation-frame")
        .boundingBox();
      expect(dimensions!.width / dimensions!.height).toBeCloseTo(16 / 9, 2);
      expect(dimensions!.width).toBeGreaterThan(100);
      await page.screenshot({
        path: testInfo.outputPath(`photo-${locale}-${width}.png`),
      });
    }
  }
});
