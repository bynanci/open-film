import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenFilmApplication } from "@openfilm/application";
import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import { navigate, openFilm } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
const sizes = [
  { width: 640, height: 360 }, // 1280x720 at 200% equivalent CSS reflow.
  { width: 768, height: 600 },
  { width: 779, height: 600 },
  { width: 780, height: 600 },
  { width: 781, height: 600 },
  { width: 900, height: 600 },
  { width: 1024, height: 576 }, // 1280x720 at 125% equivalent CSS reflow.
  { width: 1099, height: 720 },
  { width: 1100, height: 720 },
  { width: 1101, height: 720 },
  { width: 1279, height: 720 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
let root: string;
let projectPath: string;

test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-responsive-surfaces-"));
  const media = join(root, "synthetic-media");
  await generateSampleMedia(media);
  projectPath = join(root, "responsive.openfilm");
  const app = await OpenFilmApplication.create(
    projectPath,
    "日常片刻 — 我們與風景的故事",
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
    const saved = app.project.stories.find((item) => item.id === story.id)!;
    saved.beats[0]!.title = "把日常中平凡卻重要的片刻，留給未來的自己與家人";
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

async function resize(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  // ResizeObserver and Vue's responsive panel state settle before the next paint.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
}

async function problems(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth + 2)
      issues.push(
        `page overflow ${document.documentElement.scrollWidth}/${innerWidth}`,
      );
    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, summary, h1, h2, h3, input, select, textarea",
      ),
    )) {
      if (
        !element.getClientRects().length ||
        element.closest(
          // Clip lanes and the spatial mind map intentionally pan internally.
          ".editor-clip-lane, .track-scroll, .clip-lane, .canvas-viewport",
        )
      )
        continue;
      const rect = element.getBoundingClientRect();
      if (
        rect.width < 2 ||
        rect.height < 2 ||
        getComputedStyle(element).visibility === "hidden"
      )
        continue;
      let locallyScrollable = false;
      for (
        let parent = element.parentElement;
        parent && parent !== document.body;
        parent = parent.parentElement
      ) {
        if (
          ["auto", "scroll"].includes(getComputedStyle(parent).overflowX) &&
          parent.scrollWidth > parent.clientWidth + 2
        )
          locallyScrollable = true;
      }
      const name = `${element.tagName.toLowerCase()}.${element.className} ${element.textContent?.trim().slice(0, 35)}`;
      if (!locallyScrollable && (rect.left < -2 || rect.right > innerWidth + 2))
        issues.push(`outside: ${name}`);
      if (
        element.matches("button,summary") &&
        element.scrollWidth > element.clientWidth + 3
      )
        issues.push(`clipped: ${name}`);
    }
    return [...new Set(issues)];
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme} surfaces fit split windows, breakpoint boundaries and zoom-equivalent reflow`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const failures: string[] = [];
    for (const workspace of ["library", "story", "edit", "export"] as const) {
      await resize(page, { width: 1440, height: 900 });
      await navigate(page, workspace, "zh-TW");
      if (workspace === "library")
        await page.locator(".contact-sheet .asset-card").first().click();
      if (workspace === "edit")
        await expect(page.locator(".timeline-editor")).toBeVisible();
      for (const size of sizes) {
        await resize(page, size);
        await page.evaluate(() => window.scrollTo(0, 0));
        const spacing = await page
          .locator("main.workspace-content")
          .evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              left: style.paddingLeft,
              right: style.paddingRight,
              top: style.paddingTop,
            };
          });
        const gutter = size.width <= 900 ? 16 : size.width >= 1600 ? 32 : 24;
        const section = size.width <= 900 ? 20 : size.width >= 1600 ? 32 : 24;
        expect(spacing, `${workspace} spacing at ${size.width}`).toEqual({
          left: `${gutter}px`,
          right: `${gutter}px`,
          top: `${section}px`,
        });
        const issues = await problems(page);
        failures.push(
          ...issues.map(
            (issue) => `${workspace} ${size.width}x${size.height}: ${issue}`,
          ),
        );
        if ([640, 1024, 1101, 1440].includes(size.width))
          await page.screenshot({
            path: info.outputPath(`${theme}-${workspace}-${size.width}.png`),
            fullPage: true,
            animations: "disabled",
          });
      }
    }
    await resize(page, { width: 1440, height: 900 });
    await navigate(page, "story", "zh-TW");
    await page.locator('button[aria-controls="story-create"]').click();
    await page
      .locator('select[name="story-template"]')
      .selectOption("custom-outline");
    await page
      .getByTestId("story-custom-outline")
      .fill(
        "回到故事的起點\n" +
          "一個平凡而重要的片刻 — 日々のつながり ".repeat(4) +
          "\n把結尾留給明天",
      );
    for (const size of sizes) {
      await resize(page, size);
      failures.push(
        ...(await problems(page)).map(
          (issue) => `setup ${size.width}x${size.height}: ${issue}`,
        ),
      );
    }
    await page.locator(".story-create-header button").click();
    await resize(page, { width: 1440, height: 900 });
    await page.locator(".pipeline-toggle").click();
    const drawer = page.locator(".pipeline-workbench-container");
    await expect(drawer).toBeVisible();
    for (const size of sizes) {
      await resize(page, size);
      failures.push(
        ...(await problems(page)).map(
          (issue) => `pipeline ${size.width}x${size.height}: ${issue}`,
        ),
      );
      if ([640, 1440].includes(size.width))
        await page.screenshot({
          path: info.outputPath(`${theme}-pipeline-${size.width}.png`),
          fullPage: true,
          animations: "disabled",
        });
    }
    await resize(page, { width: 1440, height: 900 });
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const audit = (window as unknown as { axe: typeof axe }).axe;
      return (
        await audit.run(".pipeline-workbench-container", {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map((rule) => ({
        id: rule.id,
        nodes: rule.nodes.map((node) => node.target),
      }));
    });
    expect.soft(violations, `${theme} pipeline accessibility`).toEqual([]);
    await page.keyboard.press("Escape");
    await page.locator(".settings-toggle").click();
    for (const size of sizes) {
      await resize(page, size);
      failures.push(
        ...(await problems(page)).map(
          (issue) => `settings ${size.width}x${size.height}: ${issue}`,
        ),
      );
    }
    expect(failures).toEqual([]);
  });
}

test("keeps desktop inspectors and beat navigation within usable viewport height", async ({
  page,
}) => {
  await page.locator(".contact-sheet .asset-card").first().click();
  const inspector = page.locator(".asset-inspector");
  const header = await page.locator(".workspace-topbar").boundingBox();
  expect((await inspector.boundingBox())!.height).toBeLessThanOrEqual(
    900 - header!.height - 16,
  );
  const lastControl = inspector.getByRole("button").last();
  await lastControl.focus();
  const bounds = await lastControl.boundingBox();
  expect(bounds!.y).toBeGreaterThan(header!.height);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
  await navigate(page, "story", "zh-TW");
  const list = await page.locator(".story-room .beat-list").boundingBox();
  expect(list!.height).toBeLessThan(900 - header!.height);
});

test("expanded labels keep story views usable and form boundaries visible in both themes", async ({
  page,
}, info) => {
  await navigate(page, "story", "zh-TW");
  await page.locator(".ui-language select").selectOption("en-XA");
  const failures: string[] = [];
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const perspective of ["graph", "storyboard"]) {
      await page.getByTestId(`perspective-tab-${perspective}`).click();
      for (const width of [640, 768, 1101, 1280]) {
        await resize(page, { width, height: width < 900 ? 600 : 720 });
        failures.push(
          ...(await problems(page)).map(
            (issue) => `${theme} expanded ${perspective} ${width}: ${issue}`,
          ),
        );
      }
    }
    await resize(page, { width: 1280, height: 720 });
    await page.locator('button[aria-controls="story-create"]').click();
    for (const width of [640, 768, 1101, 1280]) {
      await resize(page, { width, height: 720 });
      failures.push(
        ...(await problems(page)).map(
          (issue) => `${theme} expanded setup ${width}: ${issue}`,
        ),
      );
    }
    const ratios = await page.locator(".story-create").evaluate((form) => {
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
        );
      };
      return Array.from(
        form.querySelectorAll(".field input, .field select"),
      ).map((element) => {
        const style = getComputedStyle(element);
        const first = luminance(style.borderTopColor),
          second = luminance(style.backgroundColor);
        return (
          (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
        );
      });
    });
    expect(ratios.length).toBeGreaterThan(0);
    for (const ratio of ratios)
      expect(ratio, `${theme} rendered input boundary`).toBeGreaterThanOrEqual(
        3,
      );
    await page.screenshot({
      path: info.outputPath(`${theme}-expanded-setup.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.locator(".story-create-header button").click();
  }
  expect(failures).toEqual([]);
});

test("compact graph panels return focus and Fit content uses the actual canvas", async ({
  page,
}) => {
  await navigate(page, "story", "zh-TW");
  await page.locator(".ui-language select").selectOption("en-US");
  await page.getByTestId("perspective-tab-graph").click();
  await expect(page.locator(".graph-node").first()).toBeVisible();
  for (const width of [768, 1280, 1440]) {
    await resize(page, { width, height: 900 });
    const fit = page
      .locator(".canvas-toolbar")
      .getByRole("button", { name: "Fit to content", exact: true });
    await fit.click();
    const outside = await page
      .locator(".graph-main-canvas")
      .evaluate((canvas) => {
        const area = canvas.getBoundingClientRect();
        const toolbar = canvas
          .querySelector(".canvas-toolbar")!
          .getBoundingClientRect();
        return Array.from(canvas.querySelectorAll(".graph-node")).filter(
          (node) => {
            const bounds = node.getBoundingClientRect();
            return (
              bounds.left < area.left - 1 ||
              bounds.right > area.right + 1 ||
              bounds.top < toolbar.bottom - 1 ||
              bounds.bottom > area.bottom + 1
            );
          },
        ).length;
      });
    expect(outside, `Fit at ${width}`).toBe(0);
  }
  await resize(page, { width: 768, height: 900 });
  await expect(page.locator(".assets-palette .sidebar-content")).toBeHidden();
  const assets = page
    .locator(".canvas-toolbar")
    .getByRole("button", { name: "Assets", exact: true });
  await assets.click();
  await expect(page.locator(".assets-palette .sidebar-content")).toBeVisible();
  expect(
    await page
      .locator(".assets-palette")
      .evaluate((element) => element.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".assets-palette .sidebar-content")).toBeHidden();
  await expect(assets).toBeFocused();
});

test("resizing preserves active graph editing and autosaved text survives reopening", async ({
  page,
  request,
}) => {
  await navigate(page, "story", "zh-TW");
  await page.locator(".ui-language select").selectOption("en-US");
  await page.getByTestId("perspective-tab-graph").click();
  await page
    .locator(".canvas-toolbar")
    .getByRole("button", { name: "Fit to content", exact: true })
    .click();
  await page.locator(".graph-node.node-beat").first().click();
  const title = page
    .locator(".inspector-palette")
    .getByLabel("Beat Title", { exact: true });
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /^\/api\/stories\/[^/]+$/.test(new URL(response.url()).pathname),
  );
  await title.fill("Resize keeps this local draft");
  await resize(page, { width: 768, height: 900 });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("Resize keeps this local draft");
  expect((await saved).status()).toBe(200);
  await page.keyboard.press("Escape");
  const toggle = page
    .locator(".canvas-toolbar")
    .getByRole("button", { name: "Inspector", exact: true });
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(title).toHaveValue("Resize keeps this local draft");
  const project = (await (await request.get(`${api}/project`)).json()).project;
  expect(project.stories[0].beats[0].title).toBe(
    "Resize keeps this local draft",
  );
  let releaseWrite!: () => void;
  const pausedWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  await page.route(
    "**/api/stories/*",
    async (route) => {
      await pausedWrite;
      await route.continue();
    },
    { times: 1 },
  );
  const firstWrite = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      /\/api\/stories\/[^/]+$/.test(new URL(request.url()).pathname),
  );
  const finalTitle = "最後輸入的完整故事標題";
  const latestSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response
        .request()
        .postDataJSON()
        ?.beats?.some(
          (beat: { title?: string }) => beat.title === finalTitle,
        ) &&
      response.status() === 200,
  );
  await title.fill("A partial edit while the save is pending");
  await firstWrite;
  await title.fill(finalTitle);
  releaseWrite();
  await latestSaved;
  await expect(title).toHaveValue(finalTitle);
  await page.route(
    "**/api/stories/*",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Synthetic save failure",
          code: "operation.failed",
        }),
      }),
    { times: 1 },
  );
  await title.fill("Retry preserves my words");
  const recovery = page.locator(".graph-save-recovery");
  await expect(recovery).toBeVisible();
  await expect(title).toHaveValue("Retry preserves my words");
  await recovery
    .getByRole("button", { name: "Save beat", exact: true })
    .click();
  await expect(recovery).toBeHidden();
  await expect(title).toBeFocused();
  const retried = (await (await request.get(`${api}/project`)).json()).project;
  expect(retried.stories[0].beats[0].title).toBe("Retry preserves my words");
  expect(retried.timelines).toEqual(project.timelines);
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  await openFilm(page, projectPath, "en-US");
  await navigate(page, "story", "en-US");
  await page.getByTestId("perspective-tab-outline").click();
  await expect(
    page.getByRole("textbox", { name: "Beat title", exact: true }),
  ).toHaveValue("Retry preserves my words");
});

test("graph beat selection waits for autosave and then enables the requested inspector", async ({
  page,
  request,
}) => {
  await navigate(page, "story", "zh-TW");
  await page.locator(".ui-language select").selectOption("en-US");
  await page.getByTestId("perspective-tab-graph").click();
  await page
    .locator(".canvas-toolbar")
    .getByRole("button", { name: "Fit to content", exact: true })
    .click();
  const project = (await (await request.get(`${api}/project`)).json()).project;
  const nodes = page.locator(".graph-node.node-beat");
  await nodes.first().click();
  const title = page
    .locator(".inspector-palette")
    .getByLabel("Beat Title", { exact: true });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/stories/*",
    async (route) => {
      await held;
      await route.continue();
    },
    { times: 1 },
  );
  const writing = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      /\/api\/stories\/[^/]+$/.test(new URL(request.url()).pathname),
  );
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/api\/stories\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.status() === 200,
  );
  await title.fill("One click selects after this save");
  await writing;
  await nodes.nth(1).click();
  await expect(title).toBeDisabled();
  release();
  await saved;
  await expect(title).toBeEnabled();
  await expect(title).toHaveValue(project.stories[0].beats[1].title);
  await nodes.first().click();
  await expect(title).toHaveValue("One click selects after this save");
});

test("theme switches keep pipeline labels readable throughout each animation frame", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".bar-stages-track")).toBeVisible();
  await expect(page.locator(".bar-stage-dot")).toHaveCount(5);
  const samples = await page.evaluate(async () => {
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
      return (
        channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      );
    };
    const result: { theme: string; frames: number; minimumContrast: number }[] =
      [];
    for (const theme of ["light", "dark"]) {
      document.documentElement.dataset.theme = theme;
      const start = performance.now();
      let frames = 0;
      let minimumContrast = Infinity;
      do {
        for (const button of Array.from(
          document.querySelectorAll(".bar-stage-dot"),
        )) {
          const style = getComputedStyle(button);
          const text = luminance(style.color),
            background = luminance(style.backgroundColor);
          minimumContrast = Math.min(
            minimumContrast,
            (Math.max(text, background) + 0.05) /
              (Math.min(text, background) + 0.05),
          );
        }
        frames += 1;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      } while (performance.now() - start < 250);
      result.push({ theme, frames, minimumContrast });
    }
    return result;
  });
  for (const sample of samples) {
    expect(sample.frames).toBeGreaterThan(1);
    expect(
      sample.minimumContrast,
      `${sample.theme} switching contrast`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});
