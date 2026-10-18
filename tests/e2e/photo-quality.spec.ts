import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import {
  resolveTitleStyle,
  type Clip,
  type Composition,
  type ProjectContentLocale,
} from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";

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
    | "diptych-secondary-locked"
    | "diptych-locked-choice"
    | "title-only"
    | "title-defaults"
    | "title-invalid"
    | "audio-rate"
    | "audio-unsupported"
    | "audio-source-locked"
    | "visual-overlays",
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
  if (preset === "diptych-gap" || preset === "diptych-secondary-locked")
    first.layout = {
      version: 1,
      preset: "diptych",
      gap: 16,
      secondary: { assetId: id("03-evening.png") },
    };
  let lockedSecondaryId: string | undefined;
  let unlockedSecondaryId: string | undefined;
  if (
    preset === "diptych-secondary-locked" ||
    preset === "diptych-locked-choice"
  ) {
    const candidates = assets
      .filter(
        (asset) => asset.mediaType === "image" && asset.id !== first.assetId,
      )
      .sort((left, right) => (left.id < right.id ? -1 : 1));
    lockedSecondaryId =
      preset === "diptych-secondary-locked"
        ? id("03-evening.png")
        : candidates[0]!.id;
    unlockedSecondaryId = candidates.find(
      (asset) => asset.id !== lockedSecondaryId,
    )!.id;
    app.catalog.updateAsset(lockedSecondaryId, { state: { locked: true } });
    app.project.stories[0]!.beats[0]!.script = {
      narration: "",
      visualDirection: "Keep proportions; Gentle push-in",
    };
    if (preset === "diptych-secondary-locked") {
      first.title = "Our saved two-photo memory";
      first.titleStyle = { version: 1, role: "scene-statement" };
    }
  }
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
  if (preset === "title-defaults") {
    first.title = "原始片名";
    first.titleStyle = { version: 1, role: "film-title" };
    app.project.timelines[0]!.tracks[0]!.clips[1]!.title = "原始字幕";
  }
  if (preset === "title-invalid") {
    first.title = "保留這句重要的話。";
    first.titleStyle = { version: 1, role: "film-title", tracking: 20 };
  }
  const audioId = id("05-tone.wav");
  if (preset === "visual-overlays")
    app.project.timelines[0]!.tracks.push(
      {
        id: "overlay-video-track",
        type: "video",
        timing: "overlay",
        clips: [
          {
            id: "overlay-video",
            assetId: id("04-motion.mp4"),
            sourceIn: 0.5,
            sourceOut: 2.5,
            timelineStart: 1,
            timelineDuration: 2,
            transform: { volume: 0.5 },
          },
        ],
      },
      {
        id: "overlay-title-track",
        type: "titles",
        timing: "overlay",
        clips: [
          {
            id: "overlay-title",
            assetId: id("01-photo.png"),
            title: "Together",
            timelineStart: 2,
            timelineDuration: 2,
          },
        ],
      },
      {
        id: "overlay-photo-track",
        type: "overlay",
        timing: "overlay",
        clips: [
          {
            id: "overlay-photo",
            assetId: id("03-evening.png"),
            timelineStart: 3,
            timelineDuration: 3,
          },
        ],
      },
      {
        id: "ordinary-audio-track",
        type: "audio",
        clips: [
          {
            id: "ordinary-audio",
            assetId: audioId,
            beatId: "memories",
            sourceIn: 0,
            sourceOut: 1,
            timelineStart: 0,
            timelineDuration: 1,
          },
        ],
      },
      {
        id: "overlay-music-track",
        type: "music",
        timing: "overlay",
        clips: [
          {
            id: "sound-only",
            assetId: audioId,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            timelineDuration: 2,
            audioAutomation: { version: 1, role: "music" },
          },
        ],
      },
    );
  if (
    preset === "audio-rate" ||
    preset === "audio-unsupported" ||
    preset === "audio-source-locked"
  )
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
  if (preset === "audio-source-locked")
    app.catalog.updateAsset(audioId, { state: { locked: true } });
  app.close();
  expect(
    (
      await request.post(`${base}/api/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  return { ...fixture, audioId, lockedSecondaryId, unlockedSecondaryId };
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

test("visual overlay clips stay selectable with source controls, keyboard navigation and track-scoped history", async ({
  page,
  request,
}) => {
  await createFilm(request, "visual-overlays");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const before = await editor(request);
  await expect(page.locator(".editor-story-rail .editor-clip")).toHaveCount(6);
  await expect(page.locator("#clip-sound-only")).toHaveCount(0);
  await expect(page.locator("#clip-ordinary-audio")).toBeVisible();
  const video = page.locator("#clip-overlay-video");
  await video.click();
  await expect(video).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Source in", { exact: true })).toHaveValue(
    "0.5",
  );
  await expect(page.getByLabel("Source out", { exact: true })).toHaveValue(
    "2.5",
  );
  await expect(page.getByLabel("Clip volume", { exact: true })).toHaveValue(
    "0.5",
  );
  const player = page.locator(".editor-source-screen video");
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLVideoElement).currentTime),
    )
    .toBeCloseTo(0.5, 2);
  await video.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#clip-overlay-title")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByLabel("Text shown in the film", { exact: true }),
  ).toHaveValue("Together");
  await expect(page.getByLabel("Photo layout", { exact: true })).toHaveCount(0);
  await page.locator("#clip-overlay-photo").click();
  await expect(page.locator("#clip-overlay-photo")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.locator(".editor-composition-frame > img:not(.editor-title-overlay)"),
  ).toHaveAttribute("alt", "03-evening.png");
  await video.dragTo(page.locator("#clip-overlay-title"));
  await expect(page.locator(".editor-message")).toContainText(
    "Move a clip within its story beat and track.",
  );
  expect((await editor(request)).composition).toEqual(before.composition);
  await video.click();
  await expect(
    page.getByRole("button", { name: "Move clip earlier", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Move clip later", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Clip volume", { exact: true }).press("Home");
  await expect
    .poll(async () => (await clip(request, "overlay-video")).transform?.volume)
    .toBe(0);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request, "overlay-video")).transform?.volume)
    .toBe(0.5);
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request, "overlay-video")).transform?.volume)
    .toBe(0);
  expect(
    (await editor(request)).composition.tracks
      .slice(1)
      .filter((track) => track.id !== "overlay-video-track"),
  ).toEqual(
    before.composition.tracks
      .slice(1)
      .filter((track) => track.id !== "overlay-video-track"),
  );
  await page.locator("#clip-ordinary-audio").click();
  await expect(page.getByLabel("Source in", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "Sound", exact: true }).click();
  await expect(page.locator(".editor-soundtrack-list button")).toHaveCount(1);
});

test("legacy invalid title styles open without mutation and recover through reset, history and reopen", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request, "title-invalid");
  const before = await editor(request);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openEditor(page);
  const warning = page.getByText(
    uiText("en-US", "editor.presentation.titleStyleRecoveryWarning"),
    { exact: true },
  );
  const reset = page.getByRole("button", {
    name: uiText("en-US", "editor.presentation.resetTitleStyle"),
    exact: true,
  });
  await expect(warning).toBeVisible();
  await expect(reset).toBeVisible();
  await expect(
    page.getByLabel("Text shown in the film", { exact: true }),
  ).toHaveValue("保留這句重要的話。");
  await expect(page.getByLabel("Text role", { exact: true })).toBeDisabled();
  expect((await editor(request)).composition).toEqual(before.composition);
  expect(errors).toEqual([]);
  await reset.click();
  await expect
    .poll(async () => (await clip(request)).titleStyle)
    .toBeUndefined();
  expect((await clip(request)).title).toBe("保留這句重要的話。");
  await expect(warning).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".editor-title-overlay")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBe(320);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request)).titleStyle?.tracking)
    .toBe(20);
  await expect(warning).toBeVisible();
  await expect(
    page.getByLabel("Text shown in the film", { exact: true }),
  ).toHaveValue("保留這句重要的話。");
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request)).titleStyle)
    .toBeUndefined();
  await expect(warning).toHaveCount(0);
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
  await expect(
    page.getByLabel("Text shown in the film", { exact: true }),
  ).toHaveValue("保留這句重要的話。");
  await expect(warning).toHaveCount(0);
  expect((await clip(request)).titleStyle).toBeUndefined();
  expect(errors).toEqual([]);
});

test("sparse and legacy title styles keep their rendered defaults after text edits and reopen", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request, "title-defaults");
  const frame = { width: 320, height: 180 };
  const originalFilm = resolveTitleStyle(
    (await clip(request)).titleStyle,
    frame,
  );
  const originalSubtitle = resolveTitleStyle(
    (await clip(request, "photo-two")).titleStyle,
    frame,
  );
  await openEditor(page);
  const position = page.getByLabel("Text position", { exact: true });
  const background = page.getByLabel("Text background", { exact: true });
  await expect(page.getByLabel("Text role", { exact: true })).toHaveValue(
    "film-title",
  );
  await expect(position).toHaveValue("center");
  await expect(background).toHaveValue("none");
  await field(page, "Text shown in the film", "更新後的片名");
  await expect
    .poll(async () => (await clip(request)).title)
    .toBe("更新後的片名");
  expect((await clip(request)).titleStyle).toEqual({
    version: 1,
    role: "film-title",
  });
  expect(resolveTitleStyle((await clip(request)).titleStyle, frame)).toEqual(
    originalFilm,
  );
  await page.locator("#clip-photo-two").click();
  await expect(page.getByLabel("Text role", { exact: true })).toHaveValue(
    "subtitle",
  );
  await expect(position).toHaveValue("bottom");
  await expect(background).toHaveValue("scrim");
  await field(page, "Text shown in the film", "更新後的字幕");
  await expect
    .poll(async () => (await clip(request, "photo-two")).title)
    .toBe("更新後的字幕");
  expect((await clip(request, "photo-two")).titleStyle).toBeUndefined();
  expect(
    resolveTitleStyle((await clip(request, "photo-two")).titleStyle, frame),
  ).toEqual(originalSubtitle);
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
  await expect(position).toHaveValue("center");
  await expect(background).toHaveValue("none");
  await page.locator("#clip-photo-two").click();
  await expect(page.getByLabel("Text role", { exact: true })).toHaveValue(
    "subtitle",
  );
  await expect(position).toHaveValue("bottom");
  await expect(background).toHaveValue("scrim");
  await page.locator("#clip-photo-one").click();
  await field(page, "Text shown in the film", "");
  await expect
    .poll(async () => ({
      title: (await clip(request)).title,
      style: (await clip(request)).titleStyle,
    }))
    .toEqual({ title: undefined, style: undefined });
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await clip(request)).titleStyle)
    .toEqual({ version: 1, role: "film-title" });
  await expect(position).toHaveValue("center");
  await expect(background).toHaveValue("none");
});

test("title role defaults follow Undo and Redo while explicit position and background win", async ({
  page,
  request,
}) => {
  await createFilm(request, "title-defaults");
  await openEditor(page);
  const role = page.getByLabel("Text role", { exact: true });
  const position = page.getByLabel("Text position", { exact: true });
  const background = page.getByLabel("Text background", { exact: true });
  await role.selectOption("scene-statement");
  await expect
    .poll(async () => (await clip(request)).titleStyle?.role)
    .toBe("scene-statement");
  await expect(position).toHaveValue("bottom");
  await expect(background).toHaveValue("scrim");
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect(role).toHaveValue("film-title");
  await expect(position).toHaveValue("center");
  await expect(background).toHaveValue("none");
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect(role).toHaveValue("scene-statement");
  await expect(position).toHaveValue("bottom");
  await expect(background).toHaveValue("scrim");
  await position.selectOption("center");
  await background.selectOption("none");
  await role.selectOption("subtitle");
  await expect
    .poll(async () => (await clip(request)).titleStyle?.role)
    .toBe("subtitle");
  await expect(position).toHaveValue("center");
  await expect(background).toHaveValue("none");
  expect((await clip(request)).titleStyle).toMatchObject({
    position: "center",
    background: "none",
  });
});

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
    "original",
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

test("a locked diptych secondary protects presentation and replacement while ordinary photo edits remain available", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request, "diptych-secondary-locked");
  const before = await editor(request);
  const savedPath = join(fixture.project, "project.json");
  const bytesBefore = await readFile(savedPath, "utf8");
  await openEditor(page);
  const layout = page.getByLabel("Photo layout", { exact: true });
  const secondary = page.getByLabel("Second photo", { exact: true });
  const title = page.getByLabel("Text shown in the film", { exact: true });
  const replacement = page.getByLabel(
    uiText("en-US", "editor.clip.replacementLabel"),
    { exact: true },
  );
  const remove = page.getByRole("button", { name: "Delete clip", exact: true });
  await expect(layout).toBeDisabled();
  await expect(layout).toHaveValue("diptych");
  await expect(secondary).toBeDisabled();
  await expect(secondary).toHaveValue(fixture.lockedSecondaryId!);
  const savedSecondary = secondary.locator(
    `option[value="${fixture.lockedSecondaryId}"]`,
  );
  await expect(savedSecondary).toHaveText("03-evening.png");
  await expect(savedSecondary).toBeDisabled();
  await expect(title).toBeDisabled();
  await expect(title).toHaveValue("Our saved two-photo memory");
  await expect(
    page.getByRole("button", { name: "Gentle push-in", exact: true }),
  ).toBeDisabled();
  const review = page.getByTestId("scene-direction-review");
  await review.locator("summary").click();
  await expect(page.getByTestId("direction-generate")).toBeDisabled();
  await expect(replacement).toBeDisabled();
  await expect(remove).toBeDisabled();
  await expect(
    page.getByText(uiText("en-US", "editor.clip.sourceProtected"), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Photo duration", { exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Clip rotation", { exact: true })).toBeEnabled();
  expect(await editor(request)).toEqual(before);
  expect(await readFile(savedPath, "utf8")).toBe(bytesBefore);
  await field(page, "Photo duration", "8");
  await expect.poll(async () => (await clip(request)).timelineDuration).toBe(8);
  await field(page, "Clip rotation", "7");
  await expect
    .poll(async () => (await clip(request)).transform?.rotation)
    .toBe(7);
  expect((await clip(request)).layout).toEqual(
    before.composition.tracks[0]!.clips[0]!.layout,
  );
  expect((await clip(request)).title).toBe("Our saved two-photo memory");

  const unlocked = await request.patch(
    `${base}/api/assets/${fixture.lockedSecondaryId}`,
    {
      data: { state: { locked: false } },
    },
  );
  expect(unlocked.ok(), await unlocked.text()).toBe(true);
  await page.reload();
  await navigate(page, "edit");
  await page.locator("#clip-photo-one").click();
  await expect(layout).toBeEnabled();
  await expect(secondary).toBeEnabled();
  await expect(secondary).toHaveValue(fixture.lockedSecondaryId!);
  await expect(savedSecondary).toBeEnabled();
  await expect(title).toBeEnabled();
  await expect(replacement).toBeEnabled();
  await expect(remove).toBeEnabled();
  await review.locator("summary").click();
  await expect(page.getByTestId("direction-generate")).toBeEnabled();
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("a new diptych excludes locked secondary choices and defaults to an unlocked source", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request, "diptych-locked-choice");
  const before = await editor(request);
  await openEditor(page);
  await page
    .getByLabel("Photo layout", { exact: true })
    .selectOption("diptych");
  await expect
    .poll(async () => (await clip(request)).layout?.secondary?.assetId)
    .toBe(fixture.unlockedSecondaryId);
  const secondary = page.getByLabel("Second photo", { exact: true });
  await expect(secondary).toHaveValue(fixture.unlockedSecondaryId!);
  await expect(
    secondary.locator(`option[value="${fixture.lockedSecondaryId}"]:enabled`),
  ).toHaveCount(0);
  expect((await clip(request)).assetId).toBe(
    before.composition.tracks[0]!.clips[0]!.assetId,
  );
  expect((await editor(request)).composition.duration).toBe(
    before.composition.duration,
  );
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("source-locked overlay sound protects timing, envelopes, ducking and volume until the source is unlocked", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request, "audio-source-locked");
  const before = await editor(request);
  const savedPath = join(fixture.project, "project.json");
  const bytesBefore = await readFile(savedPath, "utf8");
  await openEditor(page);
  const panel = page.locator(".editor-soundtrack-panel");
  const selected = panel.locator("fieldset");
  const soundField = (key: string) =>
    selected.getByLabel(uiText("en-US", `editor.sound.${key}`), {
      exact: true,
    });
  const soundFields = () =>
    [
      "start",
      "fadeIn",
      "fadeOut",
      "duckStart",
      "duckEnd",
      "duckGain",
      "attack",
      "release",
    ].map(soundField);
  const openSound = async () => {
    await page.getByRole("button", { name: "Sound", exact: true }).click();
    await panel.locator(".editor-soundtrack-list button").first().click();
    await selected
      .getByText(uiText("en-US", "editor.sound.ducking"), {
        exact: true,
      })
      .click();
  };
  await openSound();
  await expect(soundField("start")).toBeDisabled();
  for (const input of soundFields()) await expect(input).toBeDisabled();
  await expect(
    selected.getByRole("button", {
      name: uiText("en-US", "editor.sound.applyDuck"),
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    panel.getByText(uiText("en-US", "editor.clip.sourceProtected"), {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clip", exact: true }).click();
  const volume = page.getByLabel("Clip volume", { exact: true });
  await expect(volume).toBeDisabled();
  expect(await editor(request)).toEqual(before);
  expect(await readFile(savedPath, "utf8")).toBe(bytesBefore);

  const unlocked = await request.patch(
    `${base}/api/assets/${fixture.audioId}`,
    {
      data: { state: { locked: false } },
    },
  );
  expect(unlocked.ok(), await unlocked.text()).toBe(true);
  expect((await unlocked.json()).asset.state.locked).toBe(false);
  await page.reload();
  await navigate(page, "edit");
  await openSound();
  for (const input of soundFields()) await expect(input).toBeEnabled();
  await page.getByRole("button", { name: "Clip", exact: true }).click();
  await expect(volume).toBeEnabled();
  await page.getByRole("button", { name: "Lock clip", exact: true }).click();
  await expect
    .poll(async () => (await clip(request, "seeded-sound")).locked)
    .toBe(true);
  await expect(volume).toBeDisabled();
  await openSound();
  for (const input of soundFields()) await expect(input).toBeDisabled();
  await expect(
    panel.getByText(uiText("en-US", "editor.clip.protected"), { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clip", exact: true }).click();
  await page.getByRole("button", { name: "Unlock clip", exact: true }).click();
  await expect
    .poll(async () => (await clip(request, "seeded-sound")).locked)
    .toBe(false);
  await expect(volume).toBeEnabled();
  await volume.press("Home");
  await expect
    .poll(async () => (await clip(request, "seeded-sound")).transform?.volume)
    .toBe(0);
  await openSound();
  for (const input of soundFields()) await expect(input).toBeEnabled();
  for (const [key, value] of [
    ["start", "2"],
    ["fadeIn", "0.1"],
    ["fadeOut", "0.1"],
    ["duckStart", "0.1"],
    ["duckEnd", "0.6"],
    ["duckGain", "0.25"],
    ["attack", "0.1"],
    ["release", "0.1"],
  ]) {
    await soundField(key!).fill(value!);
    await soundField(key!).press("Tab");
  }
  await selected
    .getByRole("button", {
      name: uiText("en-US", "editor.sound.applyDuck"),
      exact: true,
    })
    .click();
  await expect
    .poll(async () => await clip(request, "seeded-sound"))
    .toMatchObject({
      timelineStart: 2,
      transform: { speed: 2, volume: 0 },
      audioAutomation: {
        version: 1,
        role: "music",
        fadeIn: 0.1,
        fadeOut: 0.1,
        ducking: [
          { start: 0.1, end: 0.6, gain: 0.25, attack: 0.1, release: 0.1 },
        ],
      },
    });
  expect((await editor(request)).composition.tracks[0]).toEqual(
    before.composition.tracks[0],
  );
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
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
    .toBeUndefined();
  await expect(page.getByLabel("Text role", { exact: true })).toHaveValue(
    "subtitle",
  );
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
