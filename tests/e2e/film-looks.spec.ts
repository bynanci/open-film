// SPDX-License-Identifier: Apache-2.0
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { runProcess } from "@openfilm/media";
import { OpenFilmApplication } from "@openfilm/application";
import { FILM_LOOK_PRESETS, type Composition } from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310";
const cleanup: (() => Promise<void>)[] = [];
test.afterAll(async ({ request }) => {
  await request.post(`${base}/api/project/close`, { data: {} });
  await Promise.all(cleanup.map((action) => action()));
});
async function createFilm(request: APIRequestContext, locked = false) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(fixture.project, "Film looks");
  await app.importFolder(fixture.media);
  const assets = app.catalog.listAssets({ limit: 100 });
  const id = (name: string) => assets.find((asset) => asset.name === name)!.id;
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.project.stories.push({
    id: "looks-story",
    title: "Our memories",
    targetDuration: 6,
    maxDuration: 10,
    beats: ["beginning", "adventure"].map((beatId) => ({
      id: beatId,
      title: beatId,
      targetDuration: 3,
      minDuration: 1,
      maxDuration: 6,
      selectedAssetIds: [],
    })),
  });
  app.project.timelines.push({
    id: "looks-cut",
    storyId: "looks-story",
    duration: 6,
    tracks: [
      {
        id: "visuals",
        type: "video",
        clips: [
          {
            id: "photo-one",
            assetId: id("01-photo.png"),
            beatId: "beginning",
            timelineStart: 0,
            timelineDuration: 2,
            ...(locked ? { locked: true } : {}),
            title: "Our story",
          },
          {
            id: "photo-two",
            assetId: id("03-evening.png"),
            beatId: "beginning",
            timelineStart: 2,
            timelineDuration: 2,
          },
          {
            id: "video-one",
            assetId: id("04-motion.mp4"),
            beatId: "adventure",
            sourceIn: 0,
            sourceOut: 2,
            title: "A moving memory",
            timelineStart: 4,
            timelineDuration: 2,
          },
        ],
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
  return fixture;
}
async function editor(
  request: APIRequestContext,
): Promise<{ composition: Composition }> {
  const response = await request.get(
    `${base}/api/compositions/looks-cut/editor`,
  );
  expect(response.ok()).toBe(true);
  return response.json();
}
async function openEditor(page: Page) {
  page.setDefaultTimeout(15_000);
  await initialLocale(page);
  await page.goto("/");
  await navigate(page, "edit");
  await page.locator("#clip-photo-one").click();
}

test("film, scene and clip looks inherit without changing timing, then undo, redo and reopen", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request);
  await openEditor(page);
  const panel = page.getByRole("group", { name: "Film look", exact: true });
  await expect(panel).toBeVisible();
  await panel
    .getByLabel("Whole film", { exact: true })
    .selectOption("soft-film");
  await expect
    .poll(async () => (await editor(request)).composition.defaultLook?.preset)
    .toBe("soft-film");
  await panel
    .getByLabel("This scene", { exact: true })
    .selectOption("americana");
  await expect
    .poll(
      async () =>
        (await editor(request)).composition.beatLooks?.[0]?.look.preset,
    )
    .toBe("americana");
  await panel.getByLabel("This clip", { exact: true }).selectOption("none");
  await expect
    .poll(
      async () =>
        (await editor(request)).composition.tracks[0]!.clips[0]!.look?.preset,
    )
    .toBe("none");
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect(panel.getByLabel("This clip", { exact: true })).toHaveValue(
    "inherit",
  );
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect(panel.getByLabel("This clip", { exact: true })).toHaveValue(
    "none",
  );
  const saved = (await editor(request)).composition;
  expect(saved.duration).toBe(6);
  expect(saved.tracks[0]!.clips.map((clip) => clip.timelineDuration)).toEqual([
    2, 2, 2,
  ]);
  await page.reload();
  await navigate(page, "edit");
  await page.locator("#clip-photo-one").click();
  await expect(panel.getByLabel("Whole film", { exact: true })).toHaveValue(
    "soft-film",
  );
  await expect(panel.getByLabel("This scene", { exact: true })).toHaveValue(
    "americana",
  );
  await expect(panel.getByLabel("This clip", { exact: true })).toHaveValue(
    "none",
  );
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("Expert Record compares the original momentarily or latched without saving or rebuilding media", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request);
  await openEditor(page);
  const panel = page.getByRole("group", { name: "Film look", exact: true });
  await panel.getByLabel("Whole film", { exact: true }).selectOption("natural");
  await expect
    .poll(async () => (await editor(request)).composition.defaultLook?.preset)
    .toBe("natural");
  const before = (await editor(request)).composition;

  await page
    .getByRole("combobox", { name: "Workspace mode", exact: true })
    .selectOption("expert");
  const record = page.locator(".record-monitor");
  const image = record.locator(".photo-presentation-layers img").first();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => element.style.filter))
    .not.toBe("");
  await image.evaluate((element) => {
    Object.assign(window, { openFilmCompareImage: element });
  });
  const writes: string[] = [];
  const waveformReads: Array<{ projectId: string; assetIds: string[] }> = [];
  const projectResponse = await request.get(`${base}/api/project`);
  expect(projectResponse.ok()).toBe(true);
  const projectId = (await projectResponse.json()).project.id as string;
  page.on("request", (sent) => {
    // This exact POST reads bounded current-source evidence; every other write
    // still violates Compare's no-mutation contract.
    if (
      sent.method() === "POST" &&
      new URL(sent.url()).pathname === "/api/intelligence/waveforms"
    ) {
      waveformReads.push(sent.postDataJSON());
      return;
    }
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(sent.method()) &&
      sent.url().includes("/api/")
    )
      writes.push(`${sent.method()} ${sent.url()}`);
  });

  const hold = page.getByRole("button", {
    name: uiText("en-US", "cutDesk.compare.hold"),
    exact: true,
  });
  await hold.dispatchEvent("pointerdown", {
    pointerId: 7,
    button: 0,
    isPrimary: true,
  });
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => image.evaluate((element) => element.style.filter))
    .toBe("");
  await page.evaluate(() =>
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 7,
        button: 0,
        isPrimary: true,
        bubbles: true,
      }),
    ),
  );
  await expect(hold).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => image.evaluate((element) => element.style.filter))
    .not.toBe("");
  await hold.focus();
  await page.keyboard.down("Space");
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => image.evaluate((element) => element.style.filter))
    .toBe("");
  await page.keyboard.up("Space");
  await expect(hold).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => image.evaluate((element) => element.style.filter))
    .not.toBe("");
  expect(
    await image.evaluate(
      (element) =>
        element ===
        (window as Window & { openFilmCompareImage?: Element })
          .openFilmCompareImage,
    ),
  ).toBe(true);

  const latch = page.getByRole("button", {
    name: uiText("en-US", "cutDesk.compare.latch"),
    exact: true,
  });
  await latch.click();
  await expect(latch).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => image.evaluate((element) => element.style.filter))
    .toBe("");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(latch).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(latch).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => image.evaluate((element) => element.style.filter))
    .not.toBe("");

  await latch.click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(record).toHaveCount(0);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(record).toBeVisible();
  await expect
    .poll(() =>
      record
        .locator(".photo-presentation-layers img")
        .first()
        .evaluate(
          (element) =>
            element ===
            (window as Window & { openFilmCompareImage?: Element })
              .openFilmCompareImage,
        ),
    )
    .toBe(false);
  expect(
    await record
      .locator(".photo-presentation-layers img")
      .first()
      .evaluate((element) => element.style.filter),
  ).not.toBe("");
  await expect.poll(() => waveformReads.length).toBeGreaterThan(0);
  const sourceIds = new Set(
    before.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)),
  );
  for (const body of waveformReads) {
    expect(body).toEqual({ projectId, assetIds: expect.any(Array) });
    expect(body.assetIds.length).toBeGreaterThan(0);
    expect(body.assetIds.length).toBeLessThanOrEqual(8);
    expect(new Set(body.assetIds).size).toBe(body.assetIds.length);
    expect(body.assetIds.every((id) => sourceIds.has(id))).toBe(true);
  }
  expect(writes).toEqual([]);
  expect((await editor(request)).composition).toEqual(before);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("output-only look is shared by preview and MP4 without mutating the saved film or editable export", async ({
  page,
  request,
}) => {
  await createFilm(request);
  await openEditor(page);
  const before = (await editor(request)).composition;
  await navigate(page, "export");
  await page
    .getByLabel("Look for this output", { exact: true })
    .selectOption("unify");
  await page.getByLabel("Output look", { exact: true }).selectOption("natural");
  const previewRequest = page.waitForRequest(
    (req) => req.url().endsWith("/api/render") && req.method() === "POST",
  );
  const previewResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/render") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Render preview", exact: true })
    .click();
  expect((await previewRequest).postDataJSON().lookOverride).toEqual({
    version: 1,
    preset: "natural",
    strength: 1,
  });
  expect((await previewResponse).ok()).toBe(true);
  const mp4Request = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/export") && req.postDataJSON()?.format === "mp4",
  );
  const mp4Response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/export") &&
      response.request().postDataJSON()?.format === "mp4",
  );
  await page.getByRole("button", { name: "Export MP4", exact: true }).click();
  expect((await mp4Request).postDataJSON().lookOverride).toEqual({
    version: 1,
    preset: "natural",
    strength: 1,
  });
  const outputResponse = await mp4Response;
  expect(outputResponse.ok()).toBe(true);
  const output = await outputResponse.json();
  const manifest = JSON.parse(
    await readFile(`${output.path}.manifest.json`, "utf8"),
  );
  expect(manifest.looks.override).toEqual({
    version: 1,
    preset: "natural",
    strength: 1,
  });
  expect((await editor(request)).composition).toEqual(before);
  await page
    .getByLabel("Look for this output", { exact: true })
    .selectOption("preserve");
  await expect(
    page.locator(".preview-stale").filter({ hasText: "Render again" }),
  ).toBeVisible();
  // A live MP4-only override must not leak into an editable timeline.
  await page
    .getByLabel("Look for this output", { exact: true })
    .selectOption("unify");
  await page.getByLabel("Output look", { exact: true }).selectOption("sport");
  await page.getByRole("button", { name: /^Continue editing/u }).click();
  const editableRequest = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/export") &&
      req.postDataJSON()?.format === "otio",
  );
  const editableResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/export") &&
      response.request().postDataJSON()?.format === "otio",
  );
  await page
    .getByRole("button", { name: "Export editable timeline", exact: true })
    .click();
  expect((await editableRequest).postDataJSON()).not.toHaveProperty(
    "lookOverride",
  );
  expect((await editableResponse).ok()).toBe(true);
  expect((await editor(request)).composition).toEqual(before);
  await page.reload();
  await navigate(page, "export");
  await expect(
    page.getByLabel("Look for this output", { exact: true }),
  ).toHaveValue("preserve");
});

test("protected clip keeps its look while whole-film controls remain available with localized feedback", async ({
  page,
  request,
}) => {
  await createFilm(request, true);
  await openEditor(page);
  const panel = page.getByRole("group", { name: "Film look", exact: true });
  await expect(panel.getByLabel("This clip", { exact: true })).toBeDisabled();
  const film = panel.getByLabel("Whole film", { exact: true });
  await expect(film).toBeEnabled();
  await film.selectOption("retro");
  await expect(page.locator(".editor-message")).toContainText(
    "protected clips",
  );
  await expect(film).toHaveValue("none");
  expect((await editor(request)).composition.defaultLook).toBeUndefined();
});

async function rgbPixel(path: string, x: number, y: number) {
  const result = await runProcess("ffmpeg", [
    "-v",
    "error",
    "-threads",
    "1",
    "-i",
    path,
    "-vf",
    `format=rgb24,crop=1:1:${x}:${y}`,
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  return [...result.stdout.subarray(0, 3)];
}

test("actual SVG source colors match encoded FFmpeg output across the six shared look recipes", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await createFilm(request);
  await openEditor(page);
  const panel = page.getByRole("group", { name: "Film look", exact: true });
  const frame = page.locator(".editor-composition-frame");
  await mkdir("/tmp/openfilm-film-look-ui-evidence", { recursive: true });
  for (const preset of FILM_LOOK_PRESETS.filter(
    (entry) => entry.id !== "none",
  )) {
    await panel
      .getByLabel("Whole film", { exact: true })
      .selectOption(preset.id);
    const strength = panel.getByLabel("Whole film strength", { exact: true });
    await strength.fill("65");
    await strength.dispatchEvent("change");
    await expect
      .poll(async () => (await editor(request)).composition.defaultLook)
      .toEqual({ version: 1, preset: preset.id, strength: 0.65 });
    await expect(
      frame.locator("img:not(.editor-title-overlay)"),
    ).toHaveJSProperty("complete", true);
    const screenshot = join(
      "/tmp/openfilm-film-look-ui-evidence",
      `parity-${preset.id}-browser.png`,
    );
    await frame.screenshot({ path: screenshot, animations: "disabled" });
    await test.info().attach(`look-parity-${preset.id}`, {
      path: screenshot,
      contentType: "image/png",
    });
    const rect = await frame.boundingBox();
    expect(rect).not.toBeNull();
    const browser = await rgbPixel(
      screenshot,
      // Sample the unobscured right-center patch; the monitor toolbar is a
      // sibling overlay and deliberately excluded from color comparisons.
      Math.floor(rect!.width * 0.9),
      Math.floor(rect!.height * 0.5),
    );
    const response = await request.post(`${base}/api/export`, {
      data: { format: "mp4", compositionId: "looks-cut" },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const path = (await response.json()).path as string;
    const rendered = await rgbPixel(path, 288, 90);
    expect(browser).toHaveLength(3);
    for (let channel = 0; channel < 3; channel++)
      expect(
        Math.abs(browser[channel]! - rendered[channel]!),
        `${preset.id} channel ${channel}: browser=${browser} rendered=${rendered}`,
      ).toBeLessThanOrEqual(3);
    await expect(frame.locator(".editor-title-overlay")).not.toHaveCSS(
      "filter",
      /url/u,
    );
  }
});

for (const locale of ["en-US", "zh-TW", "ja-JP", "en-XA"] as const) {
  test(`look controls remain usable at desktop sizes in ${locale}`, async ({
    page,
    request,
  }) => {
    page.setDefaultTimeout(15_000);
    await createFilm(request);
    await page.addInitScript(
      (value) => localStorage.setItem("openfilm.uiLocale", value),
      locale,
    );
    await page.goto("/");
    // The semantic workspace ID remains the same in every locale.
    if (locale !== "en-XA") await navigate(page, "edit", locale);
    else await page.locator(".main-nav button").nth(2).click();
    await page.locator("#clip-photo-one").click();
    await page
      .locator(".film-look-inspector select")
      .first()
      .selectOption("soft-film");
    await expect
      .poll(async () => (await editor(request)).composition.defaultLook?.preset)
      .toBe("soft-film");
    const evidence = "/tmp/openfilm-film-look-ui-evidence";
    await mkdir(evidence, { recursive: true });
    for (const size of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      const panel = page.locator(".film-look-inspector");
      await expect(panel).toBeVisible();
      await panel.scrollIntoViewIfNeeded();
      for (const select of await panel.locator("select").all()) {
        await expect(select).toBeEnabled();
        const box = await select.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      ).toBe(true);
      expect(await page.locator("body").innerText()).not.toMatch(
        /\blooks\.[\w.]+|\bundefined\b/u,
      );
      const screenshot = join(evidence, `edit-${locale}-${size.width}.png`);
      await page.screenshot({ path: screenshot });
      await test.info().attach(`look-edit-${locale}-${size.width}`, {
        path: screenshot,
        contentType: "image/png",
      });
    }
    if (locale !== "en-XA") await navigate(page, "export", locale);
    else await page.locator(".main-nav button").nth(3).click();
    const mode = page.locator(".export-look-options select").first();
    const action = page.locator(".export-destination > .primary");
    for (const outputMode of ["preserve", "unify"]) {
      await mode.selectOption(outputMode);
      if (outputMode === "unify") {
        const preset =
          locale === "en-XA"
            ? page.locator(".export-look-options select").nth(1)
            : page.getByLabel(uiText(locale, "looks.exportPreset"), {
                exact: true,
              });
        await preset.selectOption("soft-film");
        await expect(preset).toHaveValue("soft-film");
      }
      for (const size of [
        { width: 1280, height: 720 },
        { width: 1440, height: 900 },
        { width: 1920, height: 1080 },
        { width: 1024, height: 768 },
      ]) {
        await page.setViewportSize(size);
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(
          action,
          `${locale} ${outputMode} ${size.width}`,
        ).toBeInViewport({ ratio: 1 });
        const panel = page.locator(".export-look-options");
        await panel.scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 2,
          ),
        ).toBe(true);
        if (outputMode === "unify" && size.width !== 1024) {
          const screenshot = join(
            evidence,
            `export-${locale}-${size.width}.png`,
          );
          await page.screenshot({ path: screenshot });
          await test.info().attach(`look-export-${locale}-${size.width}`, {
            path: screenshot,
            contentType: "image/png",
          });
        }
      }
    }
  });
}

test("filtered source video keeps native controls ungraded and custom transport remains usable", async ({
  page,
  request,
}) => {
  await createFilm(request);
  await openEditor(page);
  await page.locator("#clip-video-one").click();
  const player = page.locator(".editor-source-screen video");
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await page
    .getByRole("group", { name: "Film look", exact: true })
    .getByLabel("This clip", { exact: true })
    .selectOption("sport");
  await expect(player).toHaveCSS("filter", /url/u);
  await expect(player).toHaveJSProperty("controls", false);
  const transport = page.getByRole("group", {
    name: "Clip playback and frame controls",
    exact: true,
  });
  const seek = transport.getByRole("slider", {
    name: "Seek within selected clip",
    exact: true,
  });
  await expect(transport).toHaveCSS("filter", "none");
  await seek.focus();
  await seek.press("Home");
  for (let frame = 0; frame < 6; frame++) await seek.press("ArrowRight");
  await expect(page.locator("#clip-video-one")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLVideoElement).currentTime),
    )
    .toBeCloseTo(0.25, 2);
  // Input-focused Space must not trigger the workspace play shortcut.
  await seek.press("Space");
  await expect(player).toHaveJSProperty("paused", true);
  await page.getByRole("button", { name: "Play clip", exact: true }).click();
  await expect(player).toHaveJSProperty("paused", false);
  await page.getByRole("button", { name: "Pause clip", exact: true }).click();
  await expect(player).toHaveJSProperty("paused", true);
  // Focus the rail, matching the editor's existing shortcut contract. Space
  // on a clip button deliberately retains that button's native activation.
  await page.locator(".editor-story-rail").focus();
  await page.keyboard.press("Space");
  await expect(player).toHaveJSProperty("paused", false);
  await page.keyboard.press("Space");
  await expect(player).toHaveJSProperty("paused", true);
  await page.getByLabel("Clip volume", { exact: true }).fill("0.35");
  await page.getByLabel("Clip volume", { exact: true }).dispatchEvent("input");
  await expect(player).toHaveJSProperty("volume", 0.35);
  const sourceIn = page.getByLabel("Source in", { exact: true });
  await sourceIn.fill("0.25");
  await sourceIn.press("Tab");
  await expect
    .poll(
      async () =>
        (await editor(request)).composition.tracks[0]!.clips[2]!.sourceIn,
    )
    .toBe(0.25);
  await expect(seek).toHaveAttribute("min", "0.25");
  await expect(page.locator(".editor-title-overlay")).toHaveCSS(
    "filter",
    "none",
  );
  await page
    .getByRole("group", { name: "Film look", exact: true })
    .getByLabel("This clip", { exact: true })
    .selectOption("none");
  await expect(player).toHaveJSProperty("controls", true);
  await expect(player).toHaveCSS("filter", "none");
});
