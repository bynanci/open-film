// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";
import { presetPackage } from "../fixtures/local-presets/package.js";
import type { ProjectContentLocale } from "@openfilm/core";
const base = "http://127.0.0.1:4310",
  cleanup: Array<() => Promise<unknown>> = [];
test.afterEach(async ({ request }) => {
  await request.post(base + "/api/project/close", { data: {} });
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture(request: APIRequestContext) {
  const f = await createDesktopFixture(0);
  cleanup.push(() => f.cleanup());
  const app = await OpenFilmApplication.create(f.project, "Local preset film");
  await app.importFolder(f.media, { proxies: false });
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  const names = ["01-photo.png", "03-evening.png", "04-motion.mp4"],
    assets = app.catalog.listAssets({ limit: 100 });
  app.project.stories.push({
    id: "preset-source",
    title: "Authored memories",
    targetDuration: 6,
    maxDuration: 12,
    beats: names.map((name, i) => ({
      id: `preset-beat-${i}`,
      title: `Scene ${i + 1}`,
      candidateAssetIds: [assets.find((a) => a.name === name)!.id],
      selectedAssetIds: [assets.find((a) => a.name === name)!.id],
      targetDuration: 2,
      minDuration: 1,
      maxDuration: 4,
    })),
  });
  const composition = app.compose("preset-source");
  composition.tracks[0]!.clips[0]!.title = "記憶 Memories";
  app.project.timelines[0] = composition;
  await app.save();
  app.close();
  expect(
    (
      await request.post(base + "/api/project/open", {
        data: { path: f.project },
      })
    ).ok(),
  ).toBe(true);
  const pkg = presetPackage();
  pkg.id = `test.browser.${randomUUID().replaceAll("-", "")}`;
  pkg.name = "暖光記憶と静かなタイトル";
  cleanup.push(async () => {
    const view = await (await request.get(base + "/api/presets")).json();
    const p = view.packages.find((p: { id: string }) => p.id === pkg.id);
    if (p)
      await request.post(base + "/api/presets/remove", {
        data: {
          packageId: p.id,
          packageVersion: p.version,
          packageSha256: p.packageSha256,
          baseRegistryRevision: view.revision,
        },
      });
  });
  return { ...f, composition, pkg };
}
async function settings(page: Page, locale: ProjectContentLocale = "en-US") {
  await page.locator(".settings-toggle").click();
  return page.getByRole("dialog", {
    name: uiText(locale, "app.settings.title"),
    exact: true,
  });
}
async function pixel(path: string, x: number, y: number) {
  const r = await runProcess("ffmpeg", [
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
  return [...r.stdout.subarray(0, 3)];
}
test("imports, reviews and applies all three kinds, then removes and reopens with SVG/MP4 parity", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const f = await fixture(request),
    outside: string[] = [];
  page.on("request", (r) => {
    if (
      /^https?:/u.test(r.url()) &&
      !["127.0.0.1", "localhost"].includes(new URL(r.url()).hostname)
    )
      outside.push(r.url());
  });
  await initialLocale(page);
  await page.goto("/");
  await navigate(page, "edit");
  let dialog = await settings(page);
  const panel = dialog.getByRole("region", {
    name: "Local presets",
    exact: true,
  });
  await panel
    .getByLabel("Choose preset JSON (up to 256 KiB)")
    .setInputFiles({
      name: "recipes.openfilm-presets.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(f.pkg)),
    });
  await expect(
    panel.getByRole("region", { name: "Review preset package" }),
  ).toContainText(f.pkg.name);
  await expect(
    panel.getByRole("button", {
      name: "Install reviewed package",
      exact: true,
    }),
  ).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", { name: "Install reviewed package", exact: true })
    .click();
  const installed = panel
    .locator(".preset-package")
    .filter({ hasText: f.pkg.name });
  await expect(installed).toBeVisible();
  for (const name of ["Warm 記憶", "Quiet title"]) {
    await installed
      .locator("li")
      .filter({ hasText: name })
      .getByRole("button", { name: "Apply…", exact: true })
      .click();
    const apply = panel.getByRole("region", {
      name: "Apply local preset",
      exact: true,
    });
    await apply
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    await apply
      .getByRole("button", { name: "Accept reviewed change", exact: true })
      .click();
    await expect(apply).toBeHidden();
  }
  await dialog
    .getByRole("button", {
      name: uiText("en-US", "app.settings.close"),
      exact: true,
    })
    .click();
  await page
    .locator(`[id="clip-${f.composition.tracks[0]!.clips[0]!.id}"]`)
    .click();
  const frame = page.locator(".editor-composition-frame");
  await expect(
    frame.locator("img:not(.editor-title-overlay)").first(),
  ).toHaveJSProperty("complete", true);
  const screenshot = test.info().outputPath("local-preset-browser.png");
  await frame.screenshot({ path: screenshot, animations: "disabled" });
  const box = await frame.boundingBox(),
    browser = await pixel(
      screenshot,
      Math.floor(box!.width * 0.9),
      Math.floor(box!.height * 0.5),
    );
  const response = await request.post(base + "/api/export", {
    data: { format: "mp4", compositionId: f.composition.id },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const output = await response.json(),
    rendered = await pixel(output.path, 288, 90);
  for (let i = 0; i < 3; i++)
    expect(Math.abs(browser[i]! - rendered[i]!)).toBeLessThanOrEqual(3);
  const manifest = JSON.parse(
    await readFile(output.path + ".manifest.json", "utf8"),
  );
  expect(
    manifest.presetSnapshots.some(
      (s: { kind: string }) => s.kind === "film-look",
    ),
  ).toBe(true);
  expect(manifest.looks.registryScope).toBe("builtins");
  dialog = await settings(page);
  await dialog
    .locator(".preset-package")
    .filter({ hasText: f.pkg.name })
    .locator("li")
    .filter({ hasText: "Three scenes" })
    .getByRole("button", { name: "Apply…", exact: true })
    .click();
  await dialog
    .getByRole("region", { name: "Apply local preset", exact: true })
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const plan = page.getByRole("dialog", {
    name: uiText("en-US", "app.storyPlan.title"),
    exact: true,
  });
  await expect(plan).toContainText("begin");
  await plan
    .getByRole("button", {
      name: uiText("en-US", "app.storyPlan.adoptButton"),
      exact: true,
    })
    .click();
  await expect(plan).toBeHidden();
  await expect
    .poll(
      async () =>
        (await (await request.get(base + "/api/project")).json()).project
          .timelines.length,
    )
    .toBe(2);
  dialog = await settings(page);
  await dialog
    .locator(".preset-package")
    .filter({ hasText: f.pkg.name })
    .getByRole("button", { name: "Remove…", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Remove installed package", exact: true })
    .click();
  await expect(
    dialog.locator(".preset-package").filter({ hasText: f.pkg.name }),
  ).toBeHidden();
  await dialog
    .getByRole("button", {
      name: uiText("en-US", "app.settings.close"),
      exact: true,
    })
    .click();
  await page.reload();
  await navigate(page, "edit");
  await page
    .getByLabel(uiText("en-US", "app.composition.active"), { exact: true })
    .selectOption(f.composition.id);
  await page
    .locator(`[id="clip-${f.composition.tracks[0]!.clips[0]!.id}"]`)
    .click();
  await expect(page.getByLabel("Whole film", { exact: true })).toHaveValue(
    `local:${f.pkg.id}@1.0.0/film-look/warm`,
  );
  expect(outside).toEqual([]);
  expect(await f.assertOriginalsUnchanged()).toBe(true);
});
for (const locale of ["zh-TW", "ja-JP"] as const)
  test(`local preset rights review, malformed URL rejection and keyboard cancellation at 360px in ${locale}`, async ({
    page,
    request,
  }) => {
    const f = await fixture(request);
    await initialLocale(page, locale);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    const dialog = await settings(page, locale),
      panel = dialog.getByRole("region", {
        name: uiText(locale, "presets.heading"),
        exact: true,
      }),
      input = panel.getByLabel(uiText(locale, "presets.chooseFile"));
    const bad = presetPackage();
    bad.provenance.source = "https://remote.example/execute";
    await input.setInputFiles({
      name: "unsafe.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bad)),
    });
    await expect(panel.getByRole("alert")).toBeVisible();
    await input.setInputFiles({
      name: "safe.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(f.pkg)),
    });
    await expect(
      panel.getByRole("region", {
        name: uiText(locale, "presets.importReview"),
        exact: true,
      }),
    ).toContainText(f.pkg.name);
    await expect(
      panel.getByRole("button", {
        name: uiText(locale, "presets.install"),
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await panel.getByRole("checkbox").focus();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator(".settings-toggle")).toBeFocused();
    const view = await (await request.get(base + "/api/presets")).json();
    expect(view.packages.some((p: { id: string }) => p.id === f.pkg.id)).toBe(
      false,
    );
  });
