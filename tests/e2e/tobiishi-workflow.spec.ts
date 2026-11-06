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

  await page.setViewportSize({ width: 1100, height: 900 });
  expect(
    (await sidebar.boundingBox())!.width,
    "compact sidebar",
  ).toBeLessThanOrEqual(80);
  expect(
    (await label.boundingBox())!.width,
    "compact navigation label",
  ).toBeLessThanOrEqual(1);
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
        height: card.getBoundingClientRect().height,
      };
    });
  });
  for (const card of readability) {
    expect(card.title, JSON.stringify(card)).toBeGreaterThanOrEqual(4.5);
    expect(card.timing, JSON.stringify(card)).toBeGreaterThanOrEqual(4.5);
    expect(card.height, JSON.stringify(card)).toBeLessThan(300);
  }
  await page.screenshot({ path: info.outputPath("product-story.png") });
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
  await page.screenshot({ path: info.outputPath("product-edit.png") });
  await expect(page.locator(".pipeline-status-bar .bar-stage-dot")).toHaveCount(
    0,
  );
});
