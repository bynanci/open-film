import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import axe from "axe-core";
import { OpenFilmApplication } from "@openfilm/application";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";

const api = "http://127.0.0.1:4310";
const locales = ["en-US", "zh-TW", "ja-JP", "en-XA"] as const;
const sizes = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const authoredTitle = "我們一起走過那些平凡又重要的日子 / ふたりの日々";
let root: string;
let projectPath: string;
let originalPath: string;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-global-visual-"));
  const media = join(root, "回憶 Memories # & 2026");
  await mkdir(media);
  await generateSampleMedia(media);
  originalPath = join(media, "01-photo.png");
  for (let index = 0; index < 5; index++)
    await copyFile(
      join(media, index % 2 ? "03-evening.png" : "01-photo.png"),
      join(media, `旅の記憶 ${index + 1} # & memories.png`),
    );
  projectPath = join(root, "我們的故事 # & 2026.openfilm");
  const app = await OpenFilmApplication.create(
    projectPath,
    "Our memories — 我們的故事 — ふたりの思い出",
    {
      projectContentLocale: "en-US",
      filmSettings: {
        templateId: "proposal-film",
        targetDuration: 24,
        maxDuration: 30,
      },
    },
  );
  try {
    const imported = await app.importFolder(media);
    expect(imported.failed, JSON.stringify(imported.job.errors)).toBe(0);
    const photo = app.catalog
      .listAssets()
      .find((asset) => asset.name === "01-photo.png")!;
    app.catalog.updateAsset(photo.id, {
      state: { favorite: true, locked: true },
      rating: 5,
    });
    app.analyze();
    const story = app.generateStory();
    const saved = app.project.stories.find((entry) => entry.id === story.id)!;
    saved.beats[0]!.title = authoredTitle;
    saved.beats[0]!.titleSource = "user";
    app.compose(story.id);
    await app.save();
  } finally {
    app.close();
  }
});
test.afterAll(async ({ request }) => {
  await request.post(`${api}/api/project/close`, { data: {} });
  if (root) await rm(root, { recursive: true, force: true });
});

async function layout(page: Page, name: string) {
  await expect
    .poll(() => page.evaluate(() => document.fonts.status))
    .toBe("loaded");
  const problems = await page.evaluate(() => {
    const issues: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth + 2)
      issues.push(
        `Page width ${document.documentElement.scrollWidth} exceeds viewport ${innerWidth}`,
      );
    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>("button, summary, h1, h2, h3"),
    )) {
      if (
        !element.getClientRects().length ||
        element.closest(".editor-clip-lane, .track-scroll, .clip-lane")
      )
        continue;
      const bounds = element.getBoundingClientRect();
      if (bounds.width < 2 || bounds.height < 2) continue;
      if (bounds.left < -2 || bounds.right > innerWidth + 2)
        issues.push(
          `Outside viewport: ${element.className} ${element.textContent?.trim().slice(0, 70)}`,
        );
      if (element.scrollWidth > element.clientWidth + 3)
        issues.push(
          `Clipped label: ${element.className} ${element.textContent?.trim().slice(0, 70)}`,
        );
    }
    return issues;
  });
  expect(problems, name).toEqual([]);
  const text = await page.locator("body").innerText();
  expect(text, name).not.toMatch(
    /\b(?:navigation|app|editor|media)\.[a-zA-Z][\w.]+\b|\bundefined\b/u,
  );
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  await layout(page, name);
  const viewport = page.viewportSize()!;
  if (
    viewport.width === 1280 &&
    /(?:welcome|library|story|edit|export|settings|resolve|relink-file|relink-folder)$/u.test(
      name,
    )
  ) {
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const instance = (window as unknown as { axe: typeof axe }).axe;
      const results = await instance.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
      });
      return results.violations.map((rule) => ({
        id: rule.id,
        impact: rule.impact,
        help: rule.help,
        nodes: rule.nodes.map((node) => ({
          target: node.target,
          reason: node.failureSummary,
        })),
      }));
    });
    expect(violations, `${name} accessibility`).toEqual([]);
  }
  const path = info.outputPath(
    `${name}-${viewport.width}x${viewport.height}.png`,
  );
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

for (const locale of locales) {
  test(`${locale} core screens remain readable at desktop sizes`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(120_000);
    expect(
      (await request.post(`${api}/api/project/close`, { data: {} })).ok(),
    ).toBe(true);
    await page.addInitScript(
      ({ locale }) => {
        localStorage.setItem("openfilm.uiLocale", locale);
        localStorage.setItem(
          "openfilm.preferences.v1",
          JSON.stringify({ theme: "dark" }),
        );
      },
      { locale },
    );
    const missingTranslations: string[] = [];
    page.on("console", (entry) => {
      if (/Missing translation|Not found.*key/u.test(entry.text()))
        missingTranslations.push(entry.text());
    });
    await page.goto("/");
    await expect(page.locator(".launcher-actions .primary")).toBeEnabled();
    for (const size of sizes) {
      await page.setViewportSize(size);
      await screenshot(page, info, `${locale}-welcome`);
    }
    await page.setViewportSize(sizes[0]!);
    await page.locator(".launcher-actions .primary").click();
    await expect(page.locator(".create-film-form")).toBeVisible();
    await page
      .locator('.create-film-form input[name="title"]')
      .fill(authoredTitle);
    await page
      .locator(".create-film-form select")
      .first()
      .selectOption("proposal-film");
    await screenshot(page, info, `${locale}-create`);
    await page.locator(".settings-toggle").click();
    await screenshot(page, info, `${locale}-settings`);
    await page.keyboard.press("Tab");
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press("Tab");
      expect(
        await page
          .locator(".settings-dialog")
          .evaluate((dialog) => dialog.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(".settings-dialog")).toHaveCount(0);

    // Exercise a real localized API error, retaining the original Unicode path.
    await page.locator(".project-start > .text-button").click();
    await page.locator(".launcher-actions .secondary").click();
    await page
      .locator('.open-project-form input[name="project-folder"]')
      .fill(join(root, "不存在 # & missing.openfilm"));
    await page.locator('.open-project-form button[type="submit"]').click();
    await expect(page.locator(".feedback.error")).toBeVisible();
    await screenshot(page, info, `${locale}-error`);

    expect(
      (
        await request.post(`${api}/api/project/open`, {
          data: { path: projectPath },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.patch(`${api}/api/project`, {
          data: { projectContentLocale: locale === "en-XA" ? "en-US" : locale },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(page.locator(".asset-card").first()).toBeVisible();
    const modes = ["library", "story", "edit", "export"] as const;
    for (const [index, workspace] of modes.entries()) {
      await page.locator(".main-nav button").nth(index).click();
      if (workspace === "edit") {
        await expect(page.locator(".editor-clip").first()).toBeVisible();
        await expect(page.locator(".editor-save-state")).toBeVisible();
      }
      if (workspace === "story")
        await expect(page.locator(".beat-list")).toContainText(authoredTitle);
      for (const size of sizes) {
        await page.setViewportSize(size);
        if (workspace === "export") {
          await page.evaluate(() => window.scrollTo(0, 0));
          await expect(
            page.locator(".export-destination > .primary"),
          ).toBeInViewport({ ratio: 1 });
        }
        await screenshot(page, info, `${locale}-${workspace}`);
      }
      await page.setViewportSize({ width: 1024, height: 768 });
      await layout(page, `${locale}-${workspace}-1024`);
      if (workspace === "export") {
        await page.locator(".export-goal").nth(1).click();
        await expect(page.locator(".compatibility-card")).toBeVisible();
        await expect(
          page.locator(".compatibility-feature-list > li"),
        ).not.toHaveCount(0);
        await layout(page, `${locale}-resolve-1024`);
        for (const size of sizes) {
          await page.setViewportSize(size);
          await screenshot(page, info, `${locale}-resolve`);
        }
      }
    }
    await page.setViewportSize(sizes[0]!);
    await page.locator(".main-nav button").first().click();
    await page.locator(".workflow-step").first().click();
    await expect(page.locator(".import-panel")).toBeVisible();
    await screenshot(page, info, `${locale}-import`);
    await page.locator(".import-heading > .icon-button").click();

    await rename(originalPath, `${originalPath}.offline`);
    try {
      await page.reload();
      await expect(page.locator(".asset-card.is-missing")).toHaveCount(1);
      await screenshot(page, info, `${locale}-missing`);
      await page.locator(".asset-card.is-missing .asset-image-button").click();
      await expect(page.locator(".asset-inspector")).toBeVisible();
      await screenshot(page, info, `${locale}-missing-inspector`);
      await page.locator(".selected-source-status button").click();
      await expect(page.locator(".relink-panel")).toBeVisible();
      await page.locator(".relink-modes button").nth(1).click();
      await expect(page.locator(".relink-modes button").nth(1)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await screenshot(page, info, `${locale}-relink-file`);
      await page.setViewportSize({ width: 1024, height: 768 });
      await layout(page, `${locale}-relink-file-1024`);
      await page.locator(".relink-modes button").first().click();
      await layout(page, `${locale}-relink-folder-1024`);
      await page.setViewportSize(sizes[0]!);
      await screenshot(page, info, `${locale}-relink-folder`);
      await page.locator(".relink-close").click();
    } finally {
      await rename(`${originalPath}.offline`, originalPath);
    }
    expect(missingTranslations).toEqual([]);
  });
}

test("theme, reduced motion, and keyboard focus remain functional", async ({
  page,
  request,
}, info) => {
  await request.post(`${api}/api/project/open`, {
    data: { path: projectPath },
  });
  await page.addInitScript(() => {
    localStorage.setItem("openfilm.uiLocale", "en-US");
    localStorage.setItem(
      "openfilm.preferences.v1",
      JSON.stringify({ theme: "dark" }),
    );
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.locator(".main-nav button")).toHaveCount(4);
  await page.locator(".main-nav button").first().focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => {
      const active = document.activeElement!;
      const styles = getComputedStyle(active);
      return (
        active.matches(":focus-visible") &&
        styles.outlineStyle !== "none" &&
        parseFloat(styles.outlineWidth) >= 2
      );
    }),
  ).toBe(true);
  await page.locator(".settings-toggle").click();
  await page.locator(".settings-dialog select").nth(1).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Escape");
  await screenshot(page, info, "light-library");
  const light = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--of-bg"),
  );
  await page.locator(".settings-toggle").click();
  await page.locator(".settings-dialog select").nth(1).selectOption("system");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  const dark = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--of-bg"),
  );
  expect(dark).not.toBe(light);
  expect(
    await page
      .locator(".main-nav button")
      .first()
      .evaluate((button) => getComputedStyle(button).transitionDuration),
  ).toBe("0s");
  await page.emulateMedia({ colorScheme: "light" });
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--of-bg"),
    ),
  ).toBe(light);
});
