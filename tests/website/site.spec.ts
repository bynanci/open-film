import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { siteContent } from "../../docs/.vitepress/theme/site-content";

async function fits(page: Page) {
  const metrics = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= innerWidth + 2,
    width: innerWidth,
    offenders: Array.from(document.querySelectorAll("body *"))
      .map((element) => ({
        element: `${element.tagName}.${element.className}`,
        right: element.getBoundingClientRect().right,
        left: element.getBoundingClientRect().left,
      }))
      .filter((element) => element.right > innerWidth + 2 || element.left < -2)
      .slice(0, 12),
  }));
  expect(metrics.fits, JSON.stringify(metrics)).toBe(true);
}
for (const [locale, route] of [
  ["zh-TW", ""],
  ["en-US", "en/"],
  ["ja-JP", "ja/"],
] as const) {
  test(`${locale} follows the stone path to setup and task guides`, async ({
    page,
  }) => {
    const copy = siteContent[locale];
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route || "./");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator(".garden-hero h1")).toContainText(copy.title[0]);
    await expect(page.locator(".garden-steps li")).toHaveCount(5);
    await expect(page.locator(".garden-availability")).toContainText(
      copy.sourceNotice,
    );
    await expect
      .poll(() =>
        page
          .locator(".garden-product-hero img")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await fits(page);
    await page.locator(".garden-steps a").nth(3).click();
    await expect(page.locator(`[id="${copy.steps[3]![2]}"]`)).toBeVisible();
    await page
      .locator(".VPNavBarMenu")
      .getByRole("link", { name: copy.guides, exact: true })
      .click();
    await expect(page.locator(".garden-guide-groups section")).toHaveCount(7);
    await page.locator(".garden-guide-groups a").first().click();
    await expect(page.locator(".garden-article-path a")).toHaveCount(3);
    const href = await page
      .locator(".garden-article-path a")
      .last()
      .getAttribute("href");
    await page.locator(".garden-article-path a").last().click();
    await expect(page.locator(`[id="${href!.slice(1)}"]`)).toBeVisible();
    await fits(page);
  });

  test(`${locale} keeps search, theme and keyboard focus usable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${route}getting-started`);
    const search = page.locator(".VPNavBarSearch button");
    // VitePress loads the locale's index on demand. Its preview server also
    // compresses that first response, so wait for it separately from UI work.
    const indexLoaded = page.waitForResponse(
      (response) =>
        response.url().includes("@localSearchIndex") && response.ok(),
      { timeout: 20_000 },
    );
    await search.focus();
    await page.keyboard.press("Enter");
    const panel = page.locator(".VPLocalSearchBox");
    await expect(panel).toBeVisible();
    await panel.getByRole("searchbox").fill("MP4");
    await indexLoaded;
    await expect(panel.locator(".result").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).toBeFocused();
    await page.locator(".VPNavBar .VPSwitchAppearance:visible").click();
    const dark = await page
      .locator("html")
      .evaluate((element) => element.classList.contains("dark"));
    await page.reload();
    expect(
      await page
        .locator("html")
        .evaluate((element) => element.classList.contains("dark")),
    ).toBe(dark);
    const section = page.locator(".garden-sidebar details").first();
    await expect(section).toHaveAttribute("open", "");
    await section.locator("summary").first().focus();
    await page.keyboard.press("Space");
    await expect(section).not.toHaveAttribute("open", "");
    await page.keyboard.press("Space");
    await expect(section).toHaveAttribute("open", "");
    await expect(section.locator('[aria-current="page"]')).toHaveCount(1);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(
      async () =>
        (
          await (window as typeof window & { axe: typeof axe }).axe.run(
            document,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
              },
            },
          )
        ).violations,
    );
    expect(
      violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  });

  test(`${locale} composes readable home, guides and articles across screen sizes`, async ({
    page,
  }, info) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(route || "./");
      await expect(page.locator(".garden-hero")).toBeVisible();
      await fits(page);
      // A full-page screenshot does not trigger native lazy loading below the
      // viewport. Visit the imagery as a reader would before recording it.
      for (const photo of await page.locator(".garden-home img").all()) {
        await photo.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            photo.evaluate((el) => (el as HTMLImageElement).naturalWidth),
          )
          .toBeGreaterThan(0);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`${locale}-home-${viewport.width}.png`),
        fullPage: true,
      });
      await page.goto(`${route}guides`);
      await expect(page.locator(".garden-guide-groups")).toBeVisible();
      await fits(page);
      await page.goto(`${route}product-workflow`);
      await expect(page.locator(".vp-doc h1")).toBeVisible();
      await fits(page);
    }
  });
}
test("expanded labels retain the path and all controls", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("en/");
  await page.evaluate(() => {
    for (const element of Array.from(
      document.querySelectorAll(
        ".garden-steps h3, .garden-button, .garden-text-link",
      ),
    )) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      if (node?.textContent?.trim())
        node.textContent = `[!! ${node.textContent.trim()} — extended label !!]`;
    }
  });
  await fits(page);
  await expect(page.locator(".garden-steps a")).toHaveCount(5);
  await expect(page.locator(".garden-hero .garden-button")).toBeVisible();
});

test("loads the real silent film on demand without external services", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("en/");
  await expect(page.locator(".garden-hero h1")).toBeVisible();
  expect(requests.some((url) => url.endsWith("garden-film.mp4"))).toBe(false);
  const play = page.locator(".garden-film-start");
  await play.focus();
  await page.keyboard.press("Enter");
  const film = page.locator(".garden-example video");
  await expect(film).toBeVisible();
  await expect
    .poll(() =>
      film.evaluate((element) => (element as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
  expect(
    await film.evaluate((element) => (element as HTMLVideoElement).duration),
  ).toBeCloseTo(12, 1);
  await page.keyboard.press("Space");
  await expect
    .poll(() =>
      film.evaluate((element) => (element as HTMLVideoElement).paused),
    )
    .toBe(true);
  expect(
    requests.filter(
      (url) =>
        /^https?:/u.test(url) &&
        new URL(url).origin !== "http://127.0.0.1:4175",
    ),
  ).toEqual([]);
});

test("keeps the route usable when imagery is unavailable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/images/*.webp", (route) => route.abort());
  await page.goto("en/");
  await expect(page.locator(".garden-hero .garden-button")).toBeVisible();
  await expect(page.locator(".garden-steps a")).toHaveCount(5);
  await fits(page);
});

test("explains an unavailable sample and keeps the workflow reachable", async ({
  page,
}) => {
  await page.route("**/media/garden-film.mp4", (route) => route.abort());
  await page.goto("en/");
  await page.locator(".garden-film-start").click();
  const message = page.locator(".garden-film-error");
  await expect(message).toContainText(siteContent["en-US"].exampleUnavailable);
  await message.getByRole("link").click();
  await expect(page.locator(".garden-article-path a")).toHaveCount(5);
});
