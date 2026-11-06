import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenFilmApplication } from "@openfilm/application";
import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import { navigate, openFilm, uiText } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
let root: string;
let projectPath: string;
test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-component-redesign-"));
  const media = join(root, "synthetic");
  await generateSampleMedia(media);
  projectPath = join(root, "studio.openfilm");
  const app = await OpenFilmApplication.create(
    projectPath,
    "日常・把片刻留成故事",
    {
      projectContentLocale: "zh-TW",
      filmSettings: {
        templateId: "blank",
        targetDuration: 12,
        maxDuration: 18,
      },
    },
  );
  try {
    await app.importFiles([
      join(media, "01-photo.png"),
      join(media, "04-motion.mp4"),
    ]);
    const story = app.generateStory();
    app.compose(story.id);
    await app.save();
  } finally {
    app.close();
  }
});
test.beforeEach(async ({ page, request }) => {
  await request.post(`${api}/project/close`, { data: {} });
  await page.addInitScript(() => {
    localStorage.setItem("openfilm.uiLocale", "zh-TW");
    localStorage.setItem(
      "openfilm.preferences.v1",
      JSON.stringify({ theme: "dark" }),
    );
  });
  await page.goto("/");
  await openFilm(page, projectPath, "zh-TW");
});
test.afterEach(async ({ request }) => {
  await request.post(`${api}/project/close`, { data: {} });
});
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("variant review surfaces keep readable contrast in both themes", async ({
  page,
  request,
}) => {
  const { project } = await (await request.get(`${api}/project`)).json();
  const story = project.stories.at(-1);
  const composition = project.timelines.at(-1);
  expect(story).toBeTruthy();
  expect(composition).toBeTruthy();

  for (const [index, name] of ["Quiet afternoon", "Longer pause"].entries()) {
    const response = await request.post(`${api}/creative-variants`, {
      data: {
        name,
        intent: `Reviewable theme contrast sample ${index + 1}`,
        scope: { type: "film" },
        baselineStoryId: story.id,
        baselineCompositionId: composition.id,
        modifications: {},
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }

  await navigate(page, "story", "zh-TW");
  await page.getByTestId("creative-variants-btn").click();
  const modal = page.getByTestId("creative-variant-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute("aria-modal", "true");
  await expect(modal).toHaveAttribute(
    "aria-labelledby",
    "creative-variant-dialog-title",
  );
  await expect(modal.locator(".close-btn")).toBeFocused();
  await expect(modal.locator(".variant-card")).toHaveCount(2);

  const contrastRatio = (foreground: string, background: string) => {
    const luminance = (value: string) => {
      const channels = value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      const linear = channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    const first = luminance(foreground);
    const second = luminance(background);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };

  for (const theme of ["light", "dark"] as const) {
    await page.locator("html").evaluate((element, value) => {
      element.setAttribute("data-theme", value);
    }, theme);
    const cardPair = await modal
      .locator(".variant-card")
      .first()
      .evaluate((card) => ({
        foreground: getComputedStyle(card.querySelector(".variant-name")!)
          .color,
        background: getComputedStyle(card).backgroundColor,
      }));
    expect(
      contrastRatio(cardPair.foreground, cardPair.background),
      `${theme} theme variant card contrast`,
    ).toBeGreaterThanOrEqual(4.5);
  }

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    const dialogBox = await modal
      .locator(".variants-modal-container")
      .boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(
      viewport.width + 1,
    );
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(
      viewport.height + 1,
    );
    const bodyWidth = await modal
      .locator(".variants-modal-body")
      .evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    expect(bodyWidth.scrollWidth).toBeLessThanOrEqual(
      bodyWidth.clientWidth + 1,
    );
    await page.screenshot({
      path: test
        .info()
        .outputPath(`variant-review-${viewport.width}x${viewport.height}.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await modal
    .locator(".variant-card")
    .last()
    .locator(".card-btn")
    .first()
    .click();
  await expect(modal.locator(".player-card")).toHaveCount(2);
  for (const theme of ["light", "dark"] as const) {
    await page.locator("html").evaluate((element, value) => {
      element.setAttribute("data-theme", value);
    }, theme);
    const playerPairs = await modal
      .locator(".player-card")
      .evaluateAll((cards) =>
        cards.map((card) => ({
          foreground: getComputedStyle(card.querySelector(".player-label")!)
            .color,
          background: getComputedStyle(card).backgroundColor,
        })),
      );
    for (const pair of playerPairs)
      expect(
        contrastRatio(pair.foreground, pair.background),
        `${theme} theme comparison player contrast`,
      ).toBeGreaterThanOrEqual(4.5);
  }

  const dialogButtons = modal.getByRole("button");
  await dialogButtons.last().focus();
  await page.keyboard.press("Tab");
  await expect(dialogButtons.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialogButtons.last()).toBeFocused();

  await modal.locator(".tab-btn").nth(1).click();
  const nameField = modal.locator("input").first();
  await nameField.focus();
  await nameField.evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        keyCode: 229,
        isComposing: true,
        bubbles: true,
      }),
    );
  });
  await expect(modal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId("creative-variants-btn")).toBeFocused();
});

test("keeps the desktop project and utility controls on one row without clipping", async ({
  page,
}) => {
  for (const locale of ["en-US", "zh-TW"] as const) {
    await page.locator(".app-header .ui-language select").selectOption(locale);
    for (const mode of ["standard", "expert"]) {
      await page.locator(".workspace-mode-control select").selectOption(mode);
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        const header = page.locator(".app-header");
        const bounds = await header.boundingBox();
        expect(
          bounds!.height,
          `${locale}/${mode}/${width}`,
        ).toBeLessThanOrEqual(80);
        const problems = await header.evaluate((element) =>
          Array.from(element.querySelectorAll<HTMLElement>("button, select"))
            .filter((control) => {
              const rect = control.getBoundingClientRect();
              return (
                rect.width > 0 &&
                (control.scrollWidth > control.clientWidth + 3 ||
                  rect.left < 0 ||
                  rect.right > innerWidth)
              );
            })
            .map((control) => control.outerHTML),
        );
        expect(problems).toEqual([]);
      }
    }
  }
  const switcher = page.getByRole("button", {
    name: uiText("zh-TW", "app.navigation.switchProject"),
    exact: true,
  });
  await switcher.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".project-launcher")).toBeVisible();
});

test.describe("coarse pointer", () => {
  test.use({ hasTouch: true });
  test("reveals media actions without hover and provides 44px action targets", async ({
    page,
  }) => {
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    await page.mouse.move(0, 0);
    const actions = page.locator(".asset-actions button");
    await expect(actions).toHaveCount(6);
    for (const control of await actions.all()) {
      await expect(control).toHaveCSS("opacity", "1");
    }
    for (const selector of [
      ".asset-actions button",
      ".workspace-command-trigger",
      ".settings-toggle",
      ".app-header .project-switch",
      ".workspace-mode-control select",
      ".app-header .ui-language select",
      ".library-sidebar button",
    ]) {
      for (const control of await page.locator(selector).all()) {
        const bounds = await control.boundingBox();
        expect(bounds!.width, selector).toBeGreaterThanOrEqual(44);
        expect(bounds!.height, selector).toBeGreaterThanOrEqual(44);
      }
    }
    const lock = actions.nth(1);
    await lock.tap();
    await expect(lock).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".asset-lock-mark")).toBeVisible();
    await lock.tap();
    await expect(lock).toHaveAttribute("aria-pressed", "false");
  });
});

test("retains the decoded rendered player and its seek position across Edit and Export", async ({
  page,
}) => {
  await navigate(page, "edit", "zh-TW");
  await page.locator(".composition-heading > .primary").click();
  const video = page.locator(".preview-screen video");
  // Wait for actual FFmpeg completion; the usual 5s UI timeout is not a render limit.
  await expect(video).toBeVisible({ timeout: 90_000 });
  await expect
    .poll(
      () =>
        video.evaluate((element) => (element as HTMLVideoElement).readyState),
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(2);
  expect(
    await video.evaluate((element) => (element as HTMLVideoElement).videoWidth),
  ).toBeGreaterThan(0);
  await video.evaluate((element) => {
    const player = element as HTMLVideoElement;
    player.pause();
    player.currentTime = 1.25;
    player.volume = 0.37;
    player.playbackRate = 1.25;
  });
  await expect(video).toHaveJSProperty("currentTime", 1.25);
  const original = (await video.elementHandle())!;
  for (const workspace of ["export", "edit"] as const) {
    await navigate(page, workspace, "zh-TW");
    expect(
      await original.evaluate((element) => element.isConnected),
      "the same native player stays mounted",
    ).toBe(true);
    await expect(video).toHaveJSProperty("currentTime", 1.25);
    await expect(video).toHaveJSProperty("volume", 0.37);
    await expect(video).toHaveJSProperty("playbackRate", 1.25);
    await expect(video).toHaveJSProperty("paused", true);
  }
});

for (const theme of ["dark", "light"] as const) {
  test(`${theme} creative components retain readable states and keyboard dialogs`, async ({
    page,
  }, info) => {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const workspace of [
      "library",
      "story",
      "edit",
      "export",
      "versions",
    ] as const) {
      await navigate(page, workspace, "zh-TW");
      if (workspace === "edit")
        await expect(page.locator(".timeline-editor")).toBeVisible();
      if (workspace === "export") {
        const preview = await page
          .locator(
            ".workspace-export .preview-placeholder, .workspace-export .preview-screen",
          )
          .boundingBox();
        expect(
          preview!.y + preview!.height,
          "preview is visible alongside the export settings",
        ).toBeLessThanOrEqual(900);
        await page
          .locator(".app-header .ui-language select")
          .selectOption("en-XA");
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.evaluate(() => window.scrollTo(0, 0));
        const positions = await page.evaluate(() =>
          Object.fromEntries(
            [
              ".app-header",
              ".project-heading",
              ".composition-heading",
              ".export-options > header",
              ".export-goals",
              ".export-destination",
              ".export-options > .primary",
            ].map((selector) => {
              const rect = document
                .querySelector(selector)!
                .getBoundingClientRect();
              return [
                selector,
                {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
              ];
            }),
          ),
        );
        await expect(
          page.locator(".export-options > .primary"),
          JSON.stringify(positions),
        ).toBeInViewport({ ratio: 1 });
        await page
          .locator(".app-header .ui-language select")
          .selectOption("zh-TW");
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator(".export-options > .primary")).toBeInViewport(
          { ratio: 1 },
        );
        await page.setViewportSize({ width: 1440, height: 900 });
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(1440);
      await page.screenshot({
        path: info.outputPath(`${theme}-${workspace}.png`),
        fullPage: true,
      });
      if (workspace === "export")
        await page.screenshot({
          path: info.outputPath(`${theme}-export-viewport.png`),
        });
    }
    await navigate(page, "story", "zh-TW");
    for (const perspective of ["graph", "storyboard"] as const) {
      await page
        .getByRole("tab", {
          name: uiText("zh-TW", `app.storyGraph.perspectives.${perspective}`),
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("tab", {
          name: uiText("zh-TW", `app.storyGraph.perspectives.${perspective}`),
          exact: true,
        }),
      ).toHaveAttribute("aria-selected", "true");
      await page.screenshot({
        path: info.outputPath(`${theme}-${perspective}.png`),
        fullPage: true,
      });
    }
    await page.locator(".app-header .pipeline-toggle").click();
    const pipeline = page.locator(".pipeline-workbench-container.is-drawer");
    await expect(pipeline).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${theme}-pipeline.png`) });
    await page.keyboard.press("Escape");
    await expect(pipeline).toBeHidden();
    const trigger = page.locator(".workspace-command-trigger");
    await trigger.focus();
    await page.keyboard.press("Control+k");
    const commands = page.locator(".workspace-commands");
    await expect(commands.getByRole("combobox")).toBeFocused();
    await page.screenshot({ path: info.outputPath(`${theme}-commands.png`) });
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.locator(".settings-toggle").click();
    const settings = page.locator(".settings-dialog");
    await expect(settings).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${theme}-settings.png`) });
    await page.addScriptTag({ content: axe.source });
    const violations = await settings.evaluate(async (element) => {
      const instance = (window as unknown as { axe: typeof axe }).axe;
      const result = await instance.run(element, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      });
      return result.violations.map((rule) => ({
        id: rule.id,
        nodes: rule.nodes.map((node) => node.failureSummary),
      }));
    });
    expect(violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.locator(".settings-toggle")).toBeFocused();
  });
}
