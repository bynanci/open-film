import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type { OpenFilmProject } from "@openfilm/core";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import { navigate, openFilm } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
const capture = process.env.OPENFILM_CAPTURE_SITE === "1";
let root: string;
let media: string;
test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-tobiishi-"));
  media = join(root, "generated-media");
  await generateSampleMedia(media);
  if (capture)
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-loop",
      "1",
      "-i",
      resolve("docs/public/images/garden-path.webp"),
      "-t",
      "4",
      "-vf",
      "scale=640:360",
      "-r",
      "24",
      "-pix_fmt",
      "yuv420p",
      join(media, "04-motion.mp4"),
    ]);
});
test.beforeEach(async ({ page, request }, info) => {
  await request.post(`${api}/project/close`, { data: {} });
  const path = join(root, `${info.testId}.openfilm`);
  const app = await OpenFilmApplication.create(path, "A quiet afternoon", {
    filmSettings: { templateId: "blank", targetDuration: 12, maxDuration: 18 },
  });
  try {
    await app.importFiles([
      ...(capture
        ? [
            resolve("docs/public/images/garden-path.webp"),
            resolve("docs/public/images/garden-courtyard.webp"),
          ]
        : [join(media, "01-photo.png"), join(media, "03-evening.png")]),
      join(media, "04-motion.mp4"),
    ]);
    app.project.settings = { width: 1280, height: 720, frameRate: 24 };
    const story = app.generateStory({
      title: "A quiet afternoon",
      template: "custom-outline",
      customOutline: ["Arriving", "Along the path", "A place to pause"],
      targetDuration: 12,
      maxDuration: 18,
    });
    const assets = app.catalog
      .listAssets()
      .sort(
        (a, b) =>
          Number(a.mediaType !== "image") - Number(b.mediaType !== "image"),
      );
    const storedStory = app.project.stories.find(
      (entry) => entry.id === story.id,
    )!;
    storedStory.beats.forEach((beat, index) => {
      beat.selectedAssetIds = [assets[index % assets.length]!.id];
    });
    app.compose(story.id);
    await app.save();
  } finally {
    app.close();
  }
  await page.addInitScript(() => {
    localStorage.setItem("openfilm.uiLocale", "en-US");
  });
  await page.goto("/");
  await openFilm(page, path);
});
test.afterEach(async ({ request }) => {
  await request.post(`${api}/project/close`, { data: {} });
});
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
async function project(request: APIRequestContext): Promise<OpenFilmProject> {
  return (await (await request.get(`${api}/project`)).json()).project;
}

test("finds safe quick actions and opens Fit review without applying an edit", async ({
  page,
  request,
}) => {
  const before = await project(request);
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Search actions" })
    .fill("fit duration");
  await page.keyboard.press("Enter");
  await expect(page.locator("#editor-fit-review")).toBeVisible();
  await expect(page.locator("#editor-fit-review")).toBeFocused();
  expect(await project(request)).toEqual(before);
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Search actions" })
    .fill("import media");
  let lazyImportWasDelayed = false;
  await page.route("**/ImportPanel.vue*", async (route) => {
    lazyImportWasDelayed = true;
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });
  await page.keyboard.press("Enter");
  await expect(page.locator(".import-panel")).toBeVisible();
  await expect(page.locator(".import-panel")).toBeFocused();
  expect(lazyImportWasDelayed).toBe(true);
  expect(await project(request)).toEqual(before);
});

test("keeps the sidebar readable until compact icon navigation activates", async ({
  page,
}) => {
  const sidebar = page.locator(".workspace-sidebar");
  const label = page.locator(".workspace-sidebar .main-nav .nav-label").first();

  for (const width of [1200, 1101]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      (await sidebar.boundingBox())!.width,
      `${width}px sidebar`,
    ).toBeGreaterThanOrEqual(160);
    expect(
      (await label.boundingBox())!.width,
      `${width}px navigation label`,
    ).toBeGreaterThan(1);
  }

  await page.setViewportSize({ width: 1200, height: 900 });
  const navButtons = sidebar.locator(".main-nav button");
  await navButtons.nth(1).hover();
  await expect
    .poll(() =>
      navButtons
        .nth(1)
        .evaluate((button) => getComputedStyle(button).boxShadow),
    )
    .toBe("none");
  await navButtons.first().hover();
  await expect
    .poll(() =>
      navButtons
        .first()
        .evaluate((button) => getComputedStyle(button).boxShadow),
    )
    .not.toBe("none");

  await page.setViewportSize({ width: 1100, height: 900 });
  expect(
    (await sidebar.boundingBox())!.width,
    "compact sidebar",
  ).toBeLessThanOrEqual(80);
  expect(
    (await label.boundingBox())!.width,
    "compact navigation label",
  ).toBeLessThanOrEqual(1);
  const compactNavigation = sidebar.locator(".main-nav button").first();
  await compactNavigation.focus();
  const navigationLabel = await compactNavigation.getAttribute("aria-label");
  await expect(compactNavigation).toHaveAttribute("title", navigationLabel!);
});

test("announces the scene planner disclosure and restores keyboard focus", async ({
  page,
}) => {
  await navigate(page, "story");
  const trigger = page.getByTestId("scene-planner-toggle");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveAttribute("aria-controls", "scene-planner");
  await trigger.click();
  const planner = page.locator("#scene-planner");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(planner).toBeVisible();
  await expect(planner).toBeFocused();
  await planner.getByRole("button", { name: "Close planner" }).click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});

test("announces the missing-media count in compact Library navigation", async ({
  page,
}) => {
  await page.route("**/api/media/status*", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    status.assets[0].status = "missing";
    await route.fulfill({ response, json: status });
  });
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  const library = page.locator(".workspace-sidebar .main-nav button").first();
  await expect(library).toHaveAttribute(
    "aria-describedby",
    "library-nav-attention",
  );
  await expect(page.locator("#library-nav-attention")).toHaveText(
    "1 file is offline",
  );
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(library).toHaveAttribute("title", "Library");
  await expect(library).toHaveAttribute("aria-label", "Library");
});

test("reveals secondary media actions on pointer hover and keyboard focus", async ({
  page,
}) => {
  const card = page.locator(".asset-card").first();
  const actions = card.locator(".asset-actions button");
  await page.mouse.move(0, 0);
  expect(
    await page.evaluate(
      () => matchMedia("(hover: hover) and (pointer: fine)").matches,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      actions.nth(1).evaluate((button) => getComputedStyle(button).opacity),
    )
    .toBe("0");

  await card.hover();
  await expect
    .poll(() =>
      actions.nth(1).evaluate((button) => getComputedStyle(button).opacity),
    )
    .toBe("1");
  await page.mouse.move(0, 0);
  await actions.first().click();
  await page.mouse.move(0, 0);
  await expect(actions.first()).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      actions.first().evaluate((button) => getComputedStyle(button).opacity),
    )
    .toBe("1");
  await card.locator(".asset-image-button").focus();
  await expect
    .poll(() =>
      actions.nth(1).evaluate((button) => getComputedStyle(button).opacity),
    )
    .toBe("1");
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await expect
    .poll(() => card.evaluate((node) => node.matches(":focus-within")))
    .toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      actions
        .nth(1)
        .evaluate((button) => getComputedStyle(button).transitionProperty),
    )
    .toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  expect(
    await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches),
  ).toBe(true);
  await expect
    .poll(() =>
      actions.nth(1).evaluate((button) => getComputedStyle(button).opacity),
    )
    .toBe("1");
  const reject = actions.nth(2);
  await reject.click();
  await expect(card).toHaveClass(/is-rejected/);
  const rejectedMark = card.locator(".asset-caption .asset-rejected-mark");
  await expect(rejectedMark).toBeVisible();
  const [markBounds, thumbnailBounds] = await Promise.all([
    rejectedMark.boundingBox(),
    card.locator(".asset-image-button").boundingBox(),
  ]);
  expect(markBounds!.y).toBeGreaterThanOrEqual(
    thumbnailBounds!.y + thumbnailBounds!.height,
  );
  expect(
    await card
      .locator(".asset-image-button img")
      .evaluate((image) => Number(getComputedStyle(image).opacity)),
  ).toBeGreaterThan(0.8);
  await reject.click();
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp.detach();
});

test("navigates inspector tabs with the keyboard and restores the collapsed panel", async ({
  page,
  request,
}) => {
  const before = await project(request);
  await navigate(page, "edit");
  const tabs = page.locator(".editor-inspector-tabs");
  await tabs.getByRole("tab", { name: "Clip", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { selected: true })).toHaveText(
    "Story beat",
  );
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { selected: true })).toHaveAttribute(
    "id",
    "inspector-tab-templates",
  );
  await page.keyboard.press("Home");
  await expect(
    tabs.getByRole("tab", { name: "Clip", exact: true }),
  ).toBeFocused();
  await page.locator('[aria-controls="timeline-inspector"]').click();
  await expect(page.locator("#timeline-inspector")).toBeHidden();
  await page.reload();
  await expect(page.locator("#timeline-inspector")).toBeHidden();
  await page.locator('[aria-controls="timeline-inspector"]').click();
  await expect(tabs).toBeVisible();
  expect(await project(request)).toEqual(before);
});

test("reveals script tools on demand and preserves authored words across views", async ({
  page,
  request,
}) => {
  const before = await project(request);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await navigate(page, "story");
  await page.getByTestId("perspective-tab-outline").click();
  const writing = page.locator(".story-writing-tools");
  const tools = await page.locator(".beat-editor-tools").boundingBox();
  const memories = await page.locator(".beat-editor-memories").boundingBox();
  expect(memories!.x).toBeGreaterThanOrEqual(tools!.x + tools!.width + 24);
  expect(memories!.width / tools!.width).toBeGreaterThan(1.55);
  expect(memories!.width / tools!.width).toBeLessThan(1.68);
  await expect(writing).not.toHaveAttribute("open", "");
  await writing.locator("summary").click();
  await writing
    .getByTestId("beat-script-narration")
    .fill("Keep our own words, one step at a time.");
  await page.getByRole("button", { name: "Save beat", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await project(request)).stories[0]?.beats[0]?.script?.narration,
    )
    .toBe("Keep our own words, one step at a time.");
  await page.getByTestId("perspective-tab-storyboard").click();
  await page.getByTestId("perspective-tab-outline").click();
  await expect(writing.getByTestId("beat-script-narration")).toHaveValue(
    "Keep our own words, one step at a time.",
  );
  expect((await project(request)).timelines).toEqual(before.timelines);
});

test("captures the actual shareable workspace at each product step", async ({
  page,
  request,
}, info) => {
  await navigate(page, "library");
  await expect(page.locator(".asset-card").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("product-library.png") });
  await navigate(page, "story");
  await page.getByTestId("perspective-tab-storyboard").click();
  await expect(page.locator(".storyboard-view")).toBeVisible();
  const firstStoryboardMedia = page
    .locator(".storyboard-view .asset-preview-item")
    .first();
  await expect(firstStoryboardMedia).toBeVisible();
  expect(
    (await firstStoryboardMedia.boundingBox())!.width,
  ).toBeGreaterThanOrEqual(180);
  const cards = page.locator(".storyboard-card");
  const readability = await cards.evaluateAll((elements) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const luminance = (color: string) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = Array.from(context.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
      return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
    };
    return elements.map((card) => {
      const cardBounds = card.getBoundingClientRect();
      const cardStyle = getComputedStyle(card);
      const innerTop =
        cardBounds.top +
        Number.parseFloat(cardStyle.borderTopWidth) +
        Number.parseFloat(cardStyle.paddingTop);
      const innerBottom =
        cardBounds.bottom -
        Number.parseFloat(cardStyle.borderBottomWidth) -
        Number.parseFloat(cardStyle.paddingBottom);
      const contentItems = Array.from(
        card.querySelectorAll<HTMLElement>(
          ":scope > .card-header, :scope > .card-assets, :scope > .card-body, :scope > .card-footer",
        ),
      ).filter((item) => getComputedStyle(item).display !== "none");
      // The Tobi-ishi ::after layer intentionally casts a translated shadow
      // outside the card. Measure content against the padded box so decoration
      // does not look like clipped text or media.
      const contentOverflow = Math.max(
        0,
        ...contentItems.flatMap((item) => {
          const bounds = item.getBoundingClientRect();
          return [innerTop - bounds.top, bounds.bottom - innerBottom];
        }),
      );
      const background = getComputedStyle(card, "::before").backgroundColor;
      const contrast = (selector: string) => {
        const text = getComputedStyle(card.querySelector(selector)!).color;
        const values = [luminance(text), luminance(background)].sort(
          (a, b) => a - b,
        );
        return (values[1]! + 0.05) / (values[0]! + 0.05);
      };
      return {
        title: contrast(".card-title"),
        timing: contrast(".card-timing"),
        height: cardBounds.height,
        contentOverflow,
      };
    });
  });
  for (const card of readability) {
    expect(card.title, JSON.stringify(card)).toBeGreaterThanOrEqual(4.5);
    expect(card.timing, JSON.stringify(card)).toBeGreaterThanOrEqual(4.5);
    expect(card.height, JSON.stringify(card)).toBeLessThanOrEqual(320);
    expect(card.contentOverflow, JSON.stringify(card)).toBeLessThanOrEqual(1);
  }
  const mappingPill = page.locator(".storyboard-card .mapping-pill").first();
  const mappingShape = await mappingPill.evaluate((pill) => ({
    radius: Number.parseFloat(getComputedStyle(pill).borderTopLeftRadius),
    height: pill.getBoundingClientRect().height,
  }));
  expect(mappingShape.radius).toBeLessThan(mappingShape.height / 2);
  await expect(cards.first()).toHaveCSS("border-top-width", "0px");
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const documentWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(
      documentWidth,
      `Story ${viewport.width}x${viewport.height}`,
    ).toBeLessThanOrEqual(viewport.width + 1);
    if (viewport.width === 1920) {
      const storyboardCardWidth = await cards
        .first()
        .evaluate((card) => card.getBoundingClientRect().width);
      expect(storyboardCardWidth).toBeLessThan(1200);
    }
    if (viewport.width === 1280) {
      await expect(cards.nth(1).locator(".card-title")).toBeInViewport({
        ratio: 0.8,
      });
    }
    await page.screenshot({
      path: info.outputPath(
        `product-story-${viewport.width}x${viewport.height}.png`,
      ),
    });
  }
  await page.locator("html").evaluate((element) => {
    element.setAttribute("data-theme", "dark");
  });
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const darkSecondary = await page
      .locator(".project-heading-actions .secondary")
      .evaluate((button) => {
        const luminance = (color: string) => {
          const channels = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
          const [red, green, blue] = channels.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
          return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
        };
        const style = getComputedStyle(button);
        const values = [
          luminance(style.color),
          luminance(style.backgroundColor),
        ].sort((a, b) => a - b);
        return (values[1]! + 0.05) / (values[0]! + 0.05);
      });
    expect(
      darkSecondary,
      `dark theme secondary action contrast at ${viewport.width}×${viewport.height}`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width + 1);
    if (viewport.width === 1280) {
      await expect(cards.nth(1).locator(".card-title")).toBeInViewport({
        ratio: 0.8,
      });
    }
    await page.screenshot({
      path: info.outputPath(
        `product-story-dark-${viewport.width}x${viewport.height}.png`,
      ),
    });
  }
  await page.locator("html").evaluate((element) => {
    element.setAttribute("data-theme", "light");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigate(page, "edit");
  await expect(page.locator(".editor-clip").first()).toBeVisible();
  const images = (
    await (await request.get(`${api}/assets?mediaType=image&limit=100`)).json()
  ).assets as { id: string; mediaType: string }[];
  const current = await project(request);
  const clip = current.timelines[0]!.tracks.flatMap(
    (track) => track.clips,
  ).find((entry) =>
    images.some(
      (asset) => asset.mediaType === "image" && asset.id === entry.assetId,
    ),
  )!;
  await page.locator(`[id="clip-${clip.id}"]`).click();
  await expect(page.locator(".editor-source-screen img").first()).toBeVisible();
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const documentWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(
      documentWidth,
      `Edit ${viewport.width}x${viewport.height}`,
    ).toBeLessThanOrEqual(viewport.width + 1);
    await expect(page.locator(".editor-workspace")).toBeVisible();
    await page.screenshot({
      path: info.outputPath(
        `product-edit-${viewport.width}x${viewport.height}.png`,
      ),
    });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  const inspector = page.locator("#timeline-inspector");
  const photoDuration = inspector.getByRole("spinbutton", {
    name: "Photo duration",
  });
  const initialInspectorBounds = await inspector.boundingBox();
  const initialFieldBounds = await photoDuration.boundingBox();
  expect(initialInspectorBounds).not.toBeNull();
  expect(initialFieldBounds).not.toBeNull();
  expect(
    await inspector.evaluate(
      (panel) => getComputedStyle(panel, "::-webkit-scrollbar").width,
    ),
  ).toBe("8px");
  expect(initialFieldBounds!.y + initialFieldBounds!.height).toBeGreaterThan(
    initialInspectorBounds!.y + initialInspectorBounds!.height,
  );
  await inspector.getByRole("tab", { name: "Clip", exact: true }).focus();
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (
      await photoDuration.evaluate((field) => document.activeElement === field)
    )
      break;
    await page.keyboard.press("Tab");
  }
  await expect(photoDuration).toBeFocused();
  const focusedField = await photoDuration.evaluate((field) => {
    const panel = document.getElementById("timeline-inspector")!;
    const fieldRect = field.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      top: fieldRect.top,
      bottom: fieldRect.bottom,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      scrollTop: panel.scrollTop,
    };
  });
  expect(focusedField.scrollTop).toBeGreaterThan(0);
  expect(focusedField.top).toBeGreaterThanOrEqual(focusedField.panelTop - 1);
  expect(focusedField.bottom).toBeLessThanOrEqual(focusedField.panelBottom + 1);
  await page.screenshot({
    path: info.outputPath("product-edit-1280x720-inspector-focused.png"),
  });
  await photoDuration.fill("3.0");
  await photoDuration.press("Tab");
  await expect
    .poll(async () => {
      const saved = await project(request);
      return saved.timelines
        .flatMap((timeline) => timeline.tracks)
        .flatMap((track) => track.clips)
        .find((entry) => entry.id === clip.id)?.timelineDuration;
    })
    .toBe(3);
  await expect(page.locator(".pipeline-status-bar .bar-stage-dot")).toHaveCount(
    0,
  );
});
