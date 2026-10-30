import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";
const base =
  process.env.OPENFILM_COLLECT_API_URL ?? "http://127.0.0.1:4310/api";
const stops: Array<() => Promise<unknown>> = [];
test.afterEach(async ({ request }) => {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  for (const stop of stops.splice(0).reverse()) await stop();
});
for (const locale of ["en-US", "zh-TW", "ja-JP"] as const) {
  test(`reviews source ranges with explicit delivery limits and accessible controls in ${locale}`, async ({
    page,
    request,
  }, testInfo) => {
    expect(
      (await request.post(`${base}/project/close`, { data: {} })).ok(),
    ).toBe(true);
    const root = await mkdtemp(join(tmpdir(), "openfilm-coverage-browser-"));
    stops.push(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "film.openfilm"),
      source = join(root, "synthetic.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=blue:s=160x90:r=12",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      source,
    ]);
    const hash = await hashFile(source);
    const app = await OpenFilmApplication.create(
      path,
      "Synthetic coverage review",
    );
    app.project.settings = { width: 160, height: 90, frameRate: 12 };
    app.catalog.upsertAsset({
      id: "source",
      name: "合成影片・長い見出し・Synthetic original.mp4",
      uri: pathToFileURL(source).href,
      mediaType: "video",
      codec: "h264",
      contentHash: hash,
      duration: 2,
      frameRate: 12,
      dimensions: { width: 160, height: 90 },
      tags: [],
      state: {},
      metadata: {},
    });
    app.project.stories = [
      {
        id: "story",
        title: "Synthetic source ranges",
        beats: [
          {
            id: "beat",
            title: "Synthetic beat",
            candidateAssetIds: ["source"],
            selectedAssetIds: ["source"],
          },
        ],
      },
    ];
    app.project.timelines = [
      {
        id: "film",
        storyId: "story",
        duration: 1,
        tracks: [
          {
            id: "picture",
            type: "video",
            clips: [
              {
                id: "clip",
                assetId: "source",
                beatId: "beat",
                sourceIn: 0.5,
                sourceOut: 1.5,
                timelineStart: 0,
                timelineDuration: 1,
              },
            ],
          },
        ],
      },
    ];
    await app.save();
    app.close();
    const project = await readFile(join(path, "project.json"));
    expect(
      (await request.post(`${base}/project/open`, { data: { path } })).ok(),
    ).toBe(true);
    let creates = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().endsWith("/collect/create"))
        creates++;
    });
    await initialLocale(page, locale);
    await page.goto("/");
    await navigate(page, "export", locale);
    const panel = page.locator(".collect-delivery");
    await panel.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await panel
      .getByLabel(uiText(locale, "collectDelivery.handles"), { exact: true })
      .fill("0.25");
    await panel
      .getByRole("button", {
        name: uiText(locale, "collectDelivery.review"),
        exact: true,
      })
      .click();
    await expect(panel.locator(".collect-delivery-sources > li")).toHaveCount(
      1,
    );
    await expect(panel).toContainText(
      uiText(locale, "collectDelivery.window", { start: "0.25", end: "1.75" }),
    );
    await expect(panel).toContainText(
      uiText(locale, "collectDelivery.planningOnly"),
    );
    await panel
      .getByLabel(uiText(locale, "collectDelivery.mode"), { exact: true })
      .selectOption("offline-proxies");
    await panel
      .getByRole("button", {
        name: uiText(locale, "collectDelivery.review"),
        exact: true,
      })
      .click();
    await expect(panel).toContainText(
      uiText(locale, "collectDelivery.quality.offline-only"),
    );
    for (const width of [375, 720, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await panel.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (width !== 720)
        await page.screenshot({
          path: testInfo.outputPath(`${locale}-${width}.png`),
          fullPage: true,
        });
    }
    await page.addScriptTag({ content: axe.source });
    expect(
      await page.evaluate(
        async () =>
          (
            await (window as unknown as { axe: typeof axe }).axe.run(
              document.querySelector(".collect-delivery")!,
              {
                runOnly: {
                  type: "tag",
                  values: ["wcag2a", "wcag2aa", "wcag21aa"],
                },
              },
            )
          ).violations,
      ),
    ).toEqual([]);
    expect(creates).toBe(0);
    expect(await readFile(join(path, "project.json"))).toEqual(project);
    expect(await hashFile(source)).toBe(hash);
  });
}
