// SPDX-License-Identifier: GPL-3.0-only
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import {
  type Clip,
  type Composition,
  type ProjectContentLocale,
} from "@openfilm/core";
import { pseudoText } from "../../apps/desktop/src/i18n/pseudo.js";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310";
const compositionId = "native-caption-cut";
const cleanup: (() => Promise<void>)[] = [];
type Locale = ProjectContentLocale | "en-XA";
const text = (locale: Locale, key: string) =>
  locale === "en-XA" ? pseudoText(uiText("en-US", key)) : uiText(locale, key);
const control = (page: Page, key: string, locale: Locale = "en-US") =>
  page.getByLabel(text(locale, `editor.presentation.${key}`), { exact: true });

test.afterEach(async ({ request }) => {
  await request.post(`${base}/api/project/close`, { data: {} });
  await Promise.all(cleanup.splice(0).map((action) => action()));
});

async function createFilm(request: APIRequestContext) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Native caption controls",
  );
  await app.importFolder(fixture.media);
  const assets = app.catalog.listAssets({ limit: 100 });
  const id = (name: string) => assets.find((asset) => asset.name === name)!.id;
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.project.stories.push({
    id: "native-caption-story",
    title: "Our memories",
    targetDuration: 7,
    maxDuration: 10,
    beats: [
      {
        id: "native-caption-memories",
        title: "我們一起走過那些平凡而重要的日子",
        targetDuration: 7,
        minDuration: 1,
        maxDuration: 10,
        selectedAssetIds: [],
      },
    ],
  });
  const common = {
    beatId: "native-caption-memories",
    title: "我們一起，把回憶留下。 Our memories",
  };
  app.project.timelines.push({
    id: compositionId,
    storyId: "native-caption-story",
    duration: 7,
    tracks: [
      {
        id: "native-caption-visuals",
        type: "video",
        clips: [
          {
            ...common,
            id: "native-caption-photo",
            assetId: id("01-photo.png"),
            timelineStart: 0,
            timelineDuration: 2,
          },
          {
            ...common,
            id: "native-caption-motion",
            assetId: id("03-evening.png"),
            timelineStart: 2,
            timelineDuration: 2,
            titleStyle: {
              version: 1,
              role: "subtitle",
              fadeOut: 1,
              bottomSafeMargin: 0.12,
              fontWeight: 700,
            },
            motion: {
              version: 1,
              preset: "push-in",
              easing: "ease-in-out",
              from: { scale: 1, x: 0, y: 0 },
              to: { scale: 1.06, x: 0, y: 0 },
            },
          },
          {
            ...common,
            id: "native-caption-video",
            assetId: id("04-motion.mp4"),
            timelineStart: 4,
            timelineDuration: 1,
            sourceIn: 0.5,
            sourceOut: 2.5,
            transform: { speed: 2 },
            titleStyle: {
              version: 1,
              role: "subtitle",
              fadeOut: 1,
              bottomSafeMargin: 0.12,
              fontWeight: 500,
            },
          },
          {
            ...common,
            id: "native-caption-film-title",
            assetId: id("01-photo.png"),
            timelineStart: 5,
            timelineDuration: 2,
            titleStyle: { version: 1, role: "film-title" },
          },
        ],
      },
    ],
  });
  app.close();
  const opened = await request.post(`${base}/api/project/open`, {
    data: { path: fixture.project },
  });
  expect(opened.ok(), await opened.text()).toBe(true);
  return fixture;
}
async function editor(
  request: APIRequestContext,
): Promise<{ composition: Composition }> {
  const response = await request.get(
    `${base}/api/compositions/${compositionId}/editor`,
  );
  expect(response.ok()).toBe(true);
  return response.json();
}
async function clip(
  request: APIRequestContext,
  id = "native-caption-photo",
): Promise<Clip> {
  return (await editor(request)).composition.tracks
    .flatMap((track) => track.clips)
    .find((item) => item.id === id)!;
}
async function openEditor(page: Page, locale: Locale = "en-US") {
  page.setDefaultTimeout(15_000);
  if (locale === "en-XA")
    await page.addInitScript(() =>
      localStorage.setItem("openfilm.uiLocale", "en-XA"),
    );
  else await initialLocale(page, locale);
  await page.goto("/");
  await navigateToEdit(page, locale);
  await page.locator("#clip-native-caption-photo").click();
}
async function navigateToEdit(page: Page, locale: Locale = "en-US") {
  await page
    .getByRole("navigation", {
      name: text(locale, "app.navigation.label"),
      exact: true,
    })
    .getByRole("button", {
      name: text(locale, "app.navigation.edit"),
      exact: true,
    })
    .click();
}
async function field(
  page: Page,
  key: string,
  value: string,
  locale: Locale = "en-US",
) {
  const input = control(page, key, locale);
  await input.fill(value);
  await input.press("Tab");
}
async function seekPhoto(page: Page, value: number, locale: Locale = "en-US") {
  const seek = control(page, "seek", locale);
  await seek.evaluate((element, time) => {
    (element as HTMLInputElement).value = String(time);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await expect(seek).toHaveValue(String(value));
}
async function opacity(overlay: Locator, expected: number) {
  await expect(overlay).toHaveJSProperty("complete", true);
  await expect
    .poll(() =>
      overlay.evaluate((element) => Number(getComputedStyle(element).opacity)),
    )
    .toBeCloseTo(expected, 2);
}
async function sourceUnaffected(source: Locator) {
  await expect(source).toBeVisible();
  // Source and every ancestor inside the monitor remain fully opaque: fading
  // the native text must never dim the photograph/video or its presentation.
  expect(
    await source.evaluate((element) => {
      for (
        let current: Element | null = element;
        current && !current.classList.contains("editor-source-screen");
        current = current.parentElement
      ) {
        if (getComputedStyle(current).opacity !== "1") return false;
      }
      return true;
    }),
  ).toBe(true);
}

// Procedural PNG/MP4 evidence checks behavior; it is not a camera, display or
// native workstation quality certification.
test("native text controls preserve defaults, history and reopen across photo, movement and trimmed video", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await createFilm(request);
  await openEditor(page);
  const before = (await editor(request)).composition;
  await expect(control(page, "titleFadeOut")).toHaveValue("0");
  await expect(control(page, "titleBottomSafeMargin")).toHaveValue("8");
  await expect(control(page, "titleFontWeight")).toHaveValue("400");
  expect((await clip(request)).titleStyle).toBeUndefined();
  await expect(page.locator(".editor-title-overlay")).toHaveJSProperty(
    "naturalWidth",
    320,
  );
  await sourceUnaffected(
    page.locator(".editor-composition-frame > img:not(.editor-title-overlay)"),
  );

  await control(page, "titleFontWeight").selectOption("700");
  await expect
    .poll(async () => (await clip(request)).titleStyle?.fontWeight)
    .toBe(700);
  await field(page, "titleFadeOut", "1");
  await expect
    .poll(async () => (await clip(request)).titleStyle?.fadeOut)
    .toBe(1);
  await field(page, "titleBottomSafeMargin", "12");
  await expect
    .poll(async () => (await clip(request)).titleStyle?.bottomSafeMargin)
    .toBe(0.12);
  await expect(page.locator(".editor-save-state")).toHaveText(
    uiText("en-US", "editor.save.saved"),
  );

  await page
    .getByRole("button", {
      name: uiText("en-US", "editor.undoLabel"),
      exact: true,
    })
    .click();
  await expect(control(page, "titleBottomSafeMargin")).toHaveValue("8");
  await expect
    .poll(async () => (await clip(request)).titleStyle?.bottomSafeMargin)
    .toBeUndefined();
  await page
    .getByRole("button", {
      name: uiText("en-US", "editor.redoLabel"),
      exact: true,
    })
    .click();
  await expect(control(page, "titleBottomSafeMargin")).toHaveValue("12");
  await expect
    .poll(async () => (await clip(request)).titleStyle?.bottomSafeMargin)
    .toBe(0.12);

  // A plain still with fade gets the existing photo transport but no authored
  // framing/movement. The source pixels stay fixed while only the text fades.
  await expect(page.locator(".photo-presentation-frame")).toBeVisible();
  expect((await clip(request)).layout).toBeUndefined();
  expect((await clip(request)).motion).toBeUndefined();
  const still = page.locator(".photo-presentation-layers img");
  const stillSource = await still.getAttribute("src");
  await seekPhoto(page, 0);
  await opacity(page.locator(".photo-presentation-title"), 1);
  await seekPhoto(page, 1.5);
  await opacity(page.locator(".photo-presentation-title"), 0.5);
  await expect(still).toHaveAttribute("src", stillSource!);
  await sourceUnaffected(still);

  await page.locator("#clip-native-caption-motion").click();
  await seekPhoto(page, 1.5);
  await opacity(page.locator(".photo-presentation-title"), 0.5);
  await sourceUnaffected(page.locator(".photo-presentation-layers img"));
  expect((await clip(request, "native-caption-motion")).motion).toEqual(
    before.tracks[0]!.clips[1]!.motion,
  );

  await page.locator("#clip-native-caption-video").click();
  await expect(control(page, "titleFontWeight")).toHaveValue("500");
  await expect(
    control(page, "titleFontWeight").locator('option[value="500"]'),
  ).toHaveCount(1);
  const video = page.locator(".editor-source-screen video");
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await video.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const player = element as HTMLVideoElement;
        player.pause();
        player.addEventListener("seeked", () => resolve(), { once: true });
        player.currentTime = 1.5; // (.5 source in + .5 timeline seconds * 2x).
      }),
  );
  await opacity(page.locator(".editor-title-overlay"), 0.5);
  await sourceUnaffected(video);
  expect((await clip(request, "native-caption-video")).transform?.speed).toBe(
    2,
  );
  expect(
    (await clip(request, "native-caption-video")).titleStyle?.fontWeight,
  ).toBe(500);

  await page.locator("#clip-native-caption-film-title").click();
  await expect(control(page, "titleFontWeight")).toHaveValue("700");
  await expect(control(page, "titlePosition")).toHaveValue("center");
  await expect(control(page, "titleBottomSafeMargin")).toHaveCount(0);
  expect((await clip(request, "native-caption-film-title")).titleStyle).toEqual(
    { version: 1, role: "film-title" },
  );

  await page.reload();
  await navigate(page, "edit");
  await page.locator("#clip-native-caption-photo").click();
  await expect(control(page, "titleFontWeight")).toHaveValue("700");
  await expect(control(page, "titleFadeOut")).toHaveValue("1");
  await expect(control(page, "titleBottomSafeMargin")).toHaveValue("12");
  const saved = (await editor(request)).composition;
  expect(saved.duration).toBe(before.duration);
  expect(saved.tracks[0]!.clips.slice(1)).toEqual(
    before.tracks[0]!.clips.slice(1),
  );
  const { titleStyle: _savedStyle, ...savedPhoto } = saved.tracks[0]!.clips[0]!;
  expect(savedPhoto).toEqual(before.tracks[0]!.clips[0]);
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
  await page.locator("#clip-native-caption-photo").click();
  await expect(control(page, "titleFadeOut")).toHaveValue("1");
  await expect(control(page, "titleBottomSafeMargin")).toHaveValue("12");
  expect((await editor(request)).composition).toEqual(saved);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

for (const locale of ["en-US", "zh-TW", "ja-JP", "en-XA"] as const) {
  test(`native text controls remain accessible without clipping in ${locale}`, async ({
    page,
    request,
  }, testInfo) => {
    const fixture = await createFilm(request);
    await openEditor(page, locale);
    await field(page, "titleFontSize", "14", locale);
    await expect
      .poll(async () => (await clip(request)).titleStyle?.fontSize)
      .toBe(14);
    await control(page, "titleFontWeight", locale).selectOption("700");
    await expect
      .poll(async () => (await clip(request)).titleStyle?.fontWeight)
      .toBe(700);
    await field(page, "titleFadeOut", "1", locale);
    await expect
      .poll(async () => (await clip(request)).titleStyle?.fadeOut)
      .toBe(1);
    await field(page, "titleBottomSafeMargin", "12", locale);
    await expect
      .poll(async () => (await clip(request)).titleStyle?.bottomSafeMargin)
      .toBe(0.12);
    await page
      .getByRole("button", {
        name: text(locale, "editor.presentation.motionPresets.pull-out"),
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await clip(request)).motion?.preset)
      .toBe("pull-out");
    expect((await clip(request)).layout).toBeUndefined();
    for (const size of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      const panel = page.locator(".editor-presentation-inspector");
      for (const key of [
        "titleFontSize",
        "titleFontWeight",
        "titleFadeOut",
        "titleBottomSafeMargin",
      ]) {
        const input = control(page, key, locale);
        await input.scrollIntoViewIfNeeded();
        await expect(input).toBeVisible();
        await expect(input).toBeEnabled();
        await input.focus();
        await expect(input).toBeFocused();
        const box = await input.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      expect(await panel.innerText()).not.toMatch(
        /\beditor\.presentation\.[\w.]+|\bundefined\b/u,
      );
      await seekPhoto(page, 1.5, locale);
      await opacity(page.locator(".photo-presentation-title"), 0.5);
      await sourceUnaffected(page.locator(".photo-presentation-layers img"));
      // Capture readable, fully visible text after asserting the half-fade.
      // The screenshots are review artifacts, not a pixel-perfect assertion.
      await seekPhoto(page, 0, locale);
      await opacity(page.locator(".photo-presentation-title"), 1);
      const path = testInfo.outputPath(
        `native-text-${locale}-${size.width}.png`,
      );
      await page.screenshot({ path });
      await testInfo.attach(`native-text-${locale}-${size.width}`, {
        path,
        contentType: "image/png",
      });
    }
    expect(await fixture.assertOriginalsUnchanged()).toBe(true);
  });
}

test("composition-pixel text size is readable, undoable and resettable without discarding native styles", async ({
  page,
  request,
}, testInfo) => {
  const locale = "zh-TW" as const;
  const fixture = await createFilm(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page, locale);
  const title = page.locator(".editor-title-overlay");
  await expect(control(page, "titleFontSize", locale)).toHaveValue("6.48");
  expect((await clip(request)).titleStyle).toBeUndefined();
  const ink = () =>
    title.evaluate((element) => {
      const image = element as HTMLImageElement;
      if (!image.complete || !image.naturalWidth) return 0;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let visible = 0;
      for (let index = 3; index < pixels.length; index += 4)
        if (pixels[index]) visible++;
      return visible;
    });
  await expect(title).toHaveJSProperty("naturalWidth", 320);
  const beforeInk = await ink();
  expect(beforeInk).toBeGreaterThan(0);
  await control(page, "titleFontWeight", locale).selectOption("700");
  await expect
    .poll(async () => (await clip(request)).titleStyle?.fontWeight)
    .toBe(700);
  await field(page, "titleFontSize", "14", locale);
  await expect
    .poll(async () => (await clip(request)).titleStyle?.fontSize)
    .toBe(14);
  await expect.poll(ink).toBeGreaterThan(beforeInk * 2);
  await page
    .getByRole("button", {
      name: uiText(locale, "editor.undoLabel"),
      exact: true,
    })
    .click();
  await expect(control(page, "titleFontSize", locale)).toHaveValue("6.48");
  await expect
    .poll(async () => (await clip(request)).titleStyle?.fontSize)
    .toBeUndefined();
  expect((await clip(request)).titleStyle?.fontWeight).toBe(700);
  await page
    .getByRole("button", {
      name: uiText(locale, "editor.redoLabel"),
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await clip(request)).titleStyle?.fontSize)
    .toBe(14);
  const saved = (await editor(request)).composition;
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
  await navigateToEdit(page, locale);
  await page.locator("#clip-native-caption-photo").click();
  await expect(control(page, "titleFontSize", locale)).toHaveValue("14");
  expect((await editor(request)).composition).toEqual(saved);
  await control(page, "titleFontSize", locale).scrollIntoViewIfNeeded();
  await control(page, "titleFontSize", locale).focus();
  const path = testInfo.outputPath("native-text-font-size-zh-TW.png");
  await page.screenshot({ path });
  await testInfo.attach("native-text-font-size-zh-TW", {
    path,
    contentType: "image/png",
  });
  await page
    .getByRole("button", {
      name: text(locale, "editor.presentation.titleFontSizeDefault"),
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await clip(request)).titleStyle?.fontSize)
    .toBeUndefined();
  await expect(control(page, "titleFontSize", locale)).toHaveValue("6.48");
  expect((await clip(request)).titleStyle?.fontWeight).toBe(700);
  await page
    .getByRole("button", {
      name: uiText(locale, "editor.undoLabel"),
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await clip(request)).titleStyle?.fontSize)
    .toBe(14);
  expect((await editor(request)).composition).toEqual(saved);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("pull-out works on original framing and survives history and reopening without changing film timing", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request);
  await openEditor(page);
  const before = (await editor(request)).composition;
  await expect(control(page, "layout")).toHaveValue("original");
  await page
    .getByRole("button", {
      name: uiText("en-US", "editor.presentation.motionPresets.pull-out"),
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await clip(request)).motion?.preset)
    .toBe("pull-out");
  const saved = (await editor(request)).composition;
  expect(saved.duration).toBe(before.duration);
  const { motion: _motion, ...photo } = saved.tracks[0]!.clips[0]!;
  expect(photo).toEqual(before.tracks[0]!.clips[0]);
  expect(saved.tracks[0]!.clips.slice(1)).toEqual(
    before.tracks[0]!.clips.slice(1),
  );
  await expect(control(page, "layout")).toHaveValue("original");
  await seekPhoto(page, 0);
  await expect(page.locator(".photo-presentation-layers")).toHaveAttribute(
    "style",
    /scale\(1\.06\)/,
  );
  await seekPhoto(page, 1);
  await expect(page.locator(".photo-presentation-layers")).toHaveAttribute(
    "style",
    /scale\(1\.03\)/,
  );
  await seekPhoto(page, 2);
  await expect(page.locator(".photo-presentation-layers")).toHaveAttribute(
    "style",
    /scale\(1\)/,
  );
  await page
    .getByRole("button", {
      name: uiText("en-US", "editor.undoLabel"),
      exact: true,
    })
    .click();
  await expect.poll(async () => (await clip(request)).motion).toBeUndefined();
  await expect(control(page, "layout")).toHaveValue("original");
  await page
    .getByRole("button", {
      name: uiText("en-US", "editor.redoLabel"),
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await clip(request)).motion?.preset)
    .toBe("pull-out");
  expect((await clip(request)).layout).toBeUndefined();
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
  await page.locator("#clip-native-caption-photo").click();
  expect((await editor(request)).composition).toEqual(saved);
  await expect(control(page, "layout")).toHaveValue("original");
  await expect(
    page.getByRole("button", {
      name: uiText("en-US", "editor.presentation.motionPresets.pull-out"),
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});
