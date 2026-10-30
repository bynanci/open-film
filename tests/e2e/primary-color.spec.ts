// SPDX-License-Identifier: Apache-2.0
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import axe from "axe-core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { initialLocale, navigate } from "./ui-helpers.js";
const base = "http://127.0.0.1:4310",
  roots: string[] = [];
test.afterEach(async ({ request }) => {
  await request.post(`${base}/api/project/close`, { data: {} });
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(request: APIRequestContext, video = false) {
  const root = await mkdtemp(join(tmpdir(), "primary-color-browser-"));
  roots.push(root);
  const directory = join(root, "color.openfilm"),
    app = await OpenFilmApplication.create(directory, "Primary color");
  const hashes: { path: string; sha256: string }[] = [];
  try {
    app.project.settings = { width: 320, height: 180, frameRate: 12 };
    for (const [i, id] of ["target", "reference"].entries()) {
      const path = join(root, `${id}.bmp`);
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "gradients=seed=1:s=96x64:c0=0x303030:c1=0xa0a0a0:x0=0:y0=0:x1=96:y1=64",
        ...(i ? ["-vf", "lutrgb=r=val+24:g=val+24:b=val+24"] : []),
        "-frames:v",
        "1",
        "-threads",
        "1",
        path,
      ]);
      const sha256 = await hashFile(path);
      hashes.push({ path, sha256 });
      app.catalog.upsertAsset({
        ...(await inspectMedia({
          path,
          name: id,
          uri: pathToFileURL(path).href,
        })),
        id,
        contentHash: sha256,
      });
    }
    app.project.stories.push({
      id: "s",
      title: "Color",
      beats: [{ id: "b", title: "Scene" }],
    });
    app.project.timelines.push({
      id: "f",
      storyId: "s",
      duration: 2,
      tracks: [
        {
          id: "v",
          type: "video",
          clips: ["target", "reference"].map((id, i) => ({
            id,
            assetId: id,
            beatId: "b",
            timelineStart: i,
            timelineDuration: 1,
          })),
        },
      ],
    });
    if (video) {
      const path = join(root, "chart.mp4");
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=320x180:r=12:d=1",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        path,
      ]);
      const sha256 = await hashFile(path);
      hashes.push({ path, sha256 });
      app.catalog.upsertAsset({
        ...(await inspectMedia({
          path,
          name: "Chart video",
          uri: pathToFileURL(path).href,
        })),
        id: "video",
        contentHash: sha256,
      });
      app.project.timelines[0]!.duration = 3;
      app.project.timelines[0]!.tracks[0]!.clips.push({
        id: "video",
        assetId: "video",
        beatId: "b",
        sourceIn: 0,
        sourceOut: 1,
        timelineStart: 2,
        timelineDuration: 1,
      });
    }
    await app.save();
  } finally {
    app.close();
  }
  expect(
    (
      await request.post(`${base}/api/project/open`, {
        data: { path: directory },
      })
    ).ok(),
  ).toBe(true);
  return { root, hashes };
}
async function state(request: APIRequestContext) {
  const response = await request.get(`${base}/api/compositions/f/editor`);
  expect(response.ok()).toBe(true);
  return response.json();
}
async function editor(
  page: Page,
  locale: "en-US" | "zh-TW" | "ja-JP" | "en-XA" = "en-US",
) {
  if (locale === "en-XA")
    await page.addInitScript(
      (value) => localStorage.setItem("openfilm.uiLocale", value),
      locale,
    );
  else await initialLocale(page, locale);
  await page.goto("/");
  if (locale === "en-XA") await page.locator(".main-nav button").nth(2).click();
  else await navigate(page, "edit", locale);
  await page.locator("#clip-target").click();
  await expect(page.locator(".primary-color-inspector")).toBeVisible();
}
async function pixel(path: string, x: number, y: number) {
  return [
    ...(
      await runProcess("ffmpeg", [
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
        "-",
      ])
    ).stdout.subarray(0, 3),
  ];
}
test("primary draft Apply, history and reopen agree with actual browser and MP4 pixels", async ({
  page,
  request,
}) => {
  const { root, hashes } = await fixture(request);
  await editor(page);
  const before = (await state(request)).composition;
  await page.getByTestId("primary-exposure").fill("0.3");
  await page.getByTestId("primary-temperature").fill("0.4");
  expect((await state(request)).composition).toEqual(before);
  await page.getByTestId("primary-apply").click();
  await expect
    .poll(
      async () =>
        (await state(request)).composition.tracks[0].clips[0].primaryColor
          ?.exposureEv,
    )
    .toBe(0.3);
  const saved = (await state(request)).composition;
  expect(saved.duration).toBe(2);
  const frame = page
    .locator(".editor-player-region .editor-composition-frame")
    .first();
  await expect(frame.locator("img").first()).toHaveJSProperty("complete", true);
  const screenshot = join(root, "browser.png");
  await frame.screenshot({ path: screenshot, animations: "disabled" });
  const rect = await frame.boundingBox();
  const browser = await pixel(
    screenshot,
    Math.floor(rect!.width / 2),
    Math.floor(rect!.height / 2),
  );
  const response = await request.post(`${base}/api/export`, {
    data: { format: "mp4", compositionId: "f" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const output = (await response.json()).path as string;
  const rendered = await pixel(output, 160, 90);
  for (let c = 0; c < 3; c++)
    expect(Math.abs(browser[c]! - rendered[c]!)).toBeLessThanOrEqual(5);
  await test.info().attach("primary-pixels", {
    body: Buffer.from(
      JSON.stringify({
        browser,
        rendered,
        difference: browser.map((v, i) => v - rendered[i]!),
        manifest: JSON.parse(await readFile(`${output}.manifest.json`, "utf8"))
          .primaryColor,
      }),
    ),
    contentType: "application/json",
  });
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await state(request)).composition.tracks[0].clips[0].primaryColor,
    )
    .toBeUndefined();
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(async () => (await state(request)).composition)
    .toEqual(saved);
  await page.reload();
  await navigate(page, "edit");
  await page.locator("#clip-target").click();
  await expect(page.getByTestId("primary-exposure")).toHaveValue("0.3");
  for (const source of hashes)
    expect(await hashFile(source.path)).toBe(source.sha256);
});
test("statistical Auto Match requires loaded before/after and explicit review before one history Apply", async ({
  page,
  request,
}) => {
  await fixture(request);
  await editor(page);
  const before = (await state(request)).composition;
  await page.locator(".primary-color-inspector > button").click();
  const panel = page.locator(".primary-review");
  await page.getByTestId("primary-measure").click();
  await expect(panel.locator("img")).toHaveCount(3);
  await expect(page.getByTestId("primary-match-apply")).toBeDisabled();
  expect((await state(request)).composition).toEqual(before);
  await panel.getByRole("checkbox").check();
  await expect(page.getByTestId("primary-match-apply")).toBeEnabled();
  await page.getByTestId("primary-match-apply").click();
  await expect
    .poll(
      async () =>
        (await state(request)).composition.tracks[0].clips[0].primaryColor,
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await state(request)).composition)
    .toEqual(before);
});

test("primary-only video keeps controls ungraded through shuffled source seeks", async ({
  page,
  request,
}) => {
  const { hashes } = await fixture(request, true);
  await editor(page);
  await page.locator("#clip-video").click();
  await page.getByTestId("primary-exposure").fill("0.3");
  await page.getByTestId("primary-apply").click();
  await expect
    .poll(
      async () =>
        (await state(request)).composition.tracks[0].clips.find(
          (clip: { id: string }) => clip.id === "video",
        ).primaryColor?.exposureEv,
    )
    .toBe(0.3);
  const video = page.locator(".editor-source-screen video");
  await expect(video).toHaveJSProperty("controls", false);
  await expect(video).toHaveCSS("filter", /primary-color-/);
  const controls = page.getByRole("group", {
    name: "Clip playback and frame controls",
    exact: true,
  });
  await expect(controls).toHaveCSS("filter", "none");
  const seek = controls.getByRole("slider", {
    name: "Seek within selected clip",
    exact: true,
  });
  for (const frame of [10, 0, 6, 3]) {
    await seek.evaluate((element, value) => {
      (element as HTMLInputElement).value = String(value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, frame / 12);
    await expect
      .poll(() =>
        video.evaluate((element) => (element as HTMLVideoElement).currentTime),
      )
      .toBeCloseTo(frame / 12, 2);
    await expect
      .poll(() =>
        video.evaluate((element) => (element as HTMLVideoElement).seeking),
      )
      .toBe(false);
    await expect(video).toHaveCSS("filter", /primary-color-/);
  }
  for (const source of hashes)
    expect(await hashFile(source.path)).toBe(source.sha256);
});
for (const locale of ["en-US", "zh-TW", "ja-JP", "en-XA"] as const)
  test(`primary controls reflow and remain accessible in ${locale}`, async ({
    page,
    request,
  }) => {
    await fixture(request);
    await editor(page, locale);
    const panel = page.locator(".primary-color-inspector");
    for (const size of [
      { width: 768, height: 1024 },
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await panel.scrollIntoViewIfNeeded();
      for (const input of await panel.locator("input,select,button").all()) {
        const box = await input.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      ).toBe(true);
      expect(await panel.innerText()).not.toMatch(
        /primaryColor\.[\w.]+|\bundefined\b/,
      );
    }
    await page.addScriptTag({ content: axe.source });
    const result = await page.evaluate(async () => {
      const a = (
        window as unknown as {
          axe: {
            run: (
              selector: string,
              options: unknown,
            ) => Promise<{ violations: { id: string }[] }>;
          };
        }
      ).axe;
      return a.run(".primary-color-inspector", {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      });
    });
    expect(result.violations).toEqual([]);
    const evidence = join(test.info().outputDir, `primary-${locale}.png`);
    await mkdir(test.info().outputDir, { recursive: true });
    await panel.screenshot({ path: evidence });
    await test.info().attach(`primary-${locale}`, {
      path: evidence,
      contentType: "image/png",
    });
    await page.getByTestId("primary-exposure").focus();
    await page.keyboard.press("ArrowUp");
    await page.getByTestId("primary-apply").focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(
        async () =>
          (await state(request)).composition.tracks[0].clips[0].primaryColor
            ?.exposureEv,
      )
      .toBe(0.01);
  });
