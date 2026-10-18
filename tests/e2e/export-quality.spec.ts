// SPDX-License-Identifier: GPL-3.0-only
import { expect, test, type APIRequestContext } from "@playwright/test";
import axe from "axe-core";
import { OpenFilmApplication } from "@openfilm/application";
import { createDesktopFixture } from "./helpers.js";
import { navigate } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310";
const cleanup: (() => Promise<void>)[] = [];
test.afterAll(async ({ request }) => {
  await request.post(`${base}/api/project/close`, { data: {} });
  await Promise.all(cleanup.map((action) => action()));
});

async function createFilm(request: APIRequestContext) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Output picture",
  );
  try {
    await app.importFolder(fixture.media);
    const asset = app.catalog
      .listAssets({ limit: 100 })
      .find((asset) => asset.name === "01-photo.png")!;
    app.project.settings = {
      width: 1280,
      height: 720,
      frameRate: 30000 / 1001,
    };
    app.project.stories.push({
      id: "quality-story",
      title: "Our memories",
      targetDuration: 2,
      maxDuration: 3,
      beats: [
        {
          id: "memory",
          title: "Memory",
          targetDuration: 2,
          minDuration: 1,
          maxDuration: 3,
          selectedAssetIds: [asset.id],
        },
      ],
    });
    app.project.timelines.push({
      id: "quality-cut",
      storyId: "quality-story",
      duration: 2,
      tracks: [
        {
          id: "visuals",
          type: "video",
          clips: [
            {
              id: "quality-photo",
              assetId: asset.id,
              beatId: "memory",
              timelineStart: 0,
              timelineDuration: 2,
            },
          ],
        },
      ],
    });
  } finally {
    app.close();
  }
  expect(
    (
      await request.post(`${base}/api/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
}

for (const locale of ["en-US", "zh-TW", "ja-JP", "en-XA"] as const) {
  test(`MP4 quality is readable and leaves the saved film unchanged in ${locale}`, async ({
    page,
    request,
  }) => {
    await createFilm(request);
    const before = await (await request.get(`${base}/api/project`)).json();
    await page.addInitScript(
      (value) => localStorage.setItem("openfilm.uiLocale", value),
      locale,
    );
    await page.goto("/");
    if (locale === "en-XA")
      await page.locator(".main-nav button").nth(3).click();
    else await navigate(page, "export", locale);
    const quality = page.getByTestId("export-quality");
    await expect(quality).toHaveValue("standard");
    await expect(quality).toHaveAccessibleName(/\S/u);
    await expect(quality).toHaveAccessibleDescription(/\S/u);
    await expect(page.getByTestId("export-frame")).toContainText("1280 × 720");
    await expect(page.getByTestId("export-frame")).toContainText("29.97");
    await expect(page.getByTestId("export-frame")).not.toContainText(
      String(30000 / 1001),
    );
    for (const choice of ["standard", "high-detail"]) {
      await quality.selectOption(choice);
      await expect(quality).toHaveValue(choice);
      for (const size of [
        { width: 1280, height: 720 },
        { width: 1440, height: 900 },
        { width: 1920, height: 1080 },
        { width: 1024, height: 768 },
      ]) {
        await page.setViewportSize(size);
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(
          page.locator(".export-destination > .primary"),
          `${locale} ${choice} ${size.width}`,
        ).toBeInViewport({ ratio: 1 });
        await quality.scrollIntoViewIfNeeded();
        const box = await quality.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 2,
          ),
        ).toBe(true);
        expect(await page.locator("body").innerText()).not.toMatch(
          /\bexportQuality\.[\w.]+|\bundefined\b/u,
        );
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const results = await (window as unknown as { axe: typeof axe }).axe.run(
        ".export-options",
        {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
          },
        },
      );
      return results.violations.map((rule) => ({
        id: rule.id,
        impact: rule.impact,
        nodes: rule.nodes.map((node) => node.target),
      }));
    });
    expect(violations).toEqual([]);
    const screenshot = test.info().outputPath(`export-quality-${locale}.png`);
    await page.screenshot({
      path: screenshot,
      fullPage: true,
      animations: "disabled",
    });
    await test.info().attach(`export-quality-${locale}`, {
      path: screenshot,
      contentType: "image/png",
    });
    const after = await (await request.get(`${base}/api/project`)).json();
    expect(after.project.settings).toEqual(before.project.settings);
    expect(after.project.timelines).toEqual(before.project.timelines);
    expect(after.project.stories).toEqual(before.project.stories);
    await page.reload();
    if (locale === "en-XA")
      await page.locator(".main-nav button").nth(3).click();
    else await navigate(page, "export", locale);
    await expect(quality).toHaveValue("standard");
  });
}
