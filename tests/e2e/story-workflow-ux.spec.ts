import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenFilmApplication } from "@openfilm/application";
import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import { navigate, openFilm } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
let root: string;
let media: string;
let activeStoryId: string;
let firstBeatId: string;
let crossBeatAssetId: string;

test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 15_000 });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-story-ux-"));
  media = join(root, "synthetic-media");
  await generateSampleMedia(media);
});
test.beforeEach(async ({ page, request }, info) => {
  await request.post(`${api}/project/close`, { data: {} });
  const path = join(root, `film-${info.testId}.openfilm`);
  const app = await OpenFilmApplication.create(path, "Story UX", {
    projectContentLocale: "zh-TW",
  });
  try {
    await app.importFiles([
      join(media, "01-photo.png"),
      join(media, "04-motion.mp4"),
    ]);
    const story = app.generateStory({
      title: "Our authored sequence",
      template: "custom-outline",
      customOutline: ["Photo moment", "Motion moment"],
      targetDuration: 6,
      maxDuration: 12,
    });
    const assets = app.catalog.listAssets();
    const saved = app.project.stories.find((item) => item.id === story.id)!;
    saved.beats[0]!.selectedAssetIds = [
      assets.find((asset) => asset.mediaType === "image")!.id,
    ];
    saved.beats[1]!.selectedAssetIds = [
      assets.find((asset) => asset.mediaType === "video")!.id,
    ];
    activeStoryId = saved.id;
    firstBeatId = saved.beats[0]!.id;
    crossBeatAssetId = assets.find((asset) => asset.mediaType === "video")!.id;
    await app.save();
  } finally {
    app.close();
  }
  await page.addInitScript(() => {
    localStorage.setItem("openfilm.uiLocale", "en-US");
    localStorage.setItem(
      "openfilm.preferences.v1",
      JSON.stringify({ theme: "dark" }),
    );
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

test("previews authored order, explains invalid fields, and keeps a dismissed draft", async ({
  page,
  request,
}, info) => {
  await navigate(page, "story");
  const trigger = page.getByRole("button", { name: "New story", exact: true });
  await trigger.click();
  const form = page.locator(".story-create");
  const title = form.locator('input[name="story-title"]');
  await expect(title).toBeFocused();
  await title.fill("A story of my own");
  await form
    .locator('select[name="story-template"]')
    .selectOption("custom-outline");
  const outline = form.getByTestId("story-custom-outline");
  await outline.fill("先看見一封信 💌\n回到當天\n把結尾留給明天");
  await expect(
    form.getByTestId("story-outline-preview").locator("li"),
  ).toHaveText(["先看見一封信 💌", "回到當天", "把結尾留給明天"]);
  await form.locator('input[name="target-duration"]').fill("40");
  await form.locator('input[name="max-duration"]').fill("20");
  await form.getByRole("button", { name: "Plan story", exact: true }).click();
  await expect(form.locator('input[name="max-duration"]')).toBeFocused();
  await expect(form.locator('input[name="max-duration"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(
    (await (await request.get(`${api}/project`)).json()).project.stories,
  ).toHaveLength(1);
  await form.locator('input[name="max-duration"]').fill("60");
  await outline.fill(
    Array.from({ length: 31 }, (_, index) => `Beat ${index + 1}`).join("\n"),
  );
  await form.getByRole("button", { name: "Plan story", exact: true }).click();
  await expect(outline).toBeFocused();
  await expect(outline).toHaveAttribute("aria-invalid", "true");
  await outline.fill("先看見一封信 💌\n回到當天\n把結尾留給明天");
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const audit = (window as unknown as { axe: typeof axe }).axe;
    return (
      await audit.run(".story-create", {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      })
    ).violations.map((item) => item.id);
  });
  expect(violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("story-create-preview.png"),
    fullPage: true,
  });
  await form
    .getByRole("button", { name: "Close story setup", exact: true })
    .click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(outline).toHaveValue(
    "先看見一封信 💌\n回到當天\n把結尾留給明天",
  );
  await form.getByRole("button", { name: "Plan story", exact: true }).click();
  await expect(page.getByTestId("story-graph-view")).toBeVisible();
  const project = (await (await request.get(`${api}/project`)).json()).project;
  expect(
    project.stories.at(-1).beats.map((beat: { title: string }) => beat.title),
  ).toEqual(["先看見一封信 💌", "回到當天", "把結尾留給明天"]);
});

test("uses keyboard tabs and previews full-size photos and playable video without losing focus", async ({
  page,
}, info) => {
  await navigate(page, "story");
  const outlineTab = page.getByTestId("perspective-tab-outline");
  const graphTab = page.getByTestId("perspective-tab-graph");
  const storyboardTab = page.getByTestId("perspective-tab-storyboard");
  await outlineTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(graphTab).toBeFocused();
  await expect(graphTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(storyboardTab).toBeFocused();
  await expect(storyboardTab).toHaveAttribute("tabindex", "0");
  await expect(outlineTab).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    (await storyboardTab.getAttribute("id")) ?? "",
  );

  const photoCard = page
    .locator(".storyboard-card")
    .filter({ hasText: "Photo moment" });
  const photo = photoCard.getByRole("button", {
    name: /Preview.*01-photo.png/,
  });
  await photo.focus();
  await page.keyboard.press("Enter");
  await expect(
    photoCard.getByTestId("storyboard-media-preview").locator("img"),
  ).toHaveAttribute("src", /\/source/);
  await expect
    .poll(() =>
      photoCard
        .getByTestId("storyboard-media-preview")
        .locator("img")
        .evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await photoCard.getByRole("button", { name: "Close media preview" }).click();
  await expect(photo).toBeFocused();
  await page.route("**/api/source/*", (route) => route.abort("failed"), {
    times: 1,
  });
  await photo.click();
  await expect(photoCard.locator(".preview-error")).toBeVisible();
  await photoCard
    .getByRole("button", { name: "Retry preview", exact: true })
    .click();
  await expect
    .poll(() =>
      photoCard
        .getByTestId("storyboard-media-preview")
        .locator("img")
        .evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await photoCard.getByRole("button", { name: "Close media preview" }).click();
  const videoCard = page
    .locator(".storyboard-card")
    .filter({ hasText: "Motion moment" });
  const video = videoCard.getByRole("button", {
    name: /Preview.*04-motion.mp4/,
  });
  await video.focus();
  await page.keyboard.press("Space");
  await expect(videoCard.locator("video")).toBeVisible();
  await expect
    .poll(() =>
      videoCard
        .locator("video")
        .evaluate(
          (element: HTMLVideoElement) =>
            element.readyState >= 2 && element.videoWidth > 0,
        ),
    )
    .toBe(true);
  await expect(page.locator(".storyboard-view video")).toHaveCount(1);
  await expect(photoCard.getByTestId("storyboard-media-preview")).toHaveCount(
    0,
  );
  await videoCard.getByRole("button", { name: "Close media preview" }).focus();
  await page.keyboard.press("Escape");
  await expect(video).toBeFocused();
  await expect(videoCard.locator("video")).toHaveCount(0);
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const audit = (window as unknown as { axe: typeof axe }).axe;
    return (
      await audit.run(".storyboard-view", {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      })
    ).violations.map((item) => item.id);
  });
  expect(violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 500));
  const header = await page.locator(".workspace-topbar").boundingBox();
  const sidebar = await page.locator(".workspace-sidebar").boundingBox();
  expect(header!.y).toBe(0);
  expect(sidebar!.y).toBeGreaterThanOrEqual(header!.height - 1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("storyboard-review.png"),
    fullPage: true,
  });
});

test("drags graph layout and creates a typed story connection through the expert handle", async ({
  page,
  request,
}) => {
  await page
    .getByRole("combobox", { name: "Workspace mode", exact: true })
    .selectOption("expert");
  await navigate(page, "story");
  await page.getByTestId("perspective-tab-graph").click();
  await expect(page.getByTestId("story-graph-view")).toBeVisible();

  const beatNodeId = `beat-node-${firstBeatId}`;
  const assetNodeId = `asset-node-${crossBeatAssetId}`;
  const beatNode = page.locator(`[data-node-id="${beatNodeId}"]`);
  await expect(beatNode).toBeVisible();
  const initialView = await (
    await request.get(`${api}/stories/${activeStoryId}/graph-view`)
  ).json();
  const initialX = initialView.viewState.nodes[beatNodeId].x as number;
  const beatBox = await beatNode.boundingBox();
  expect(beatBox).not.toBeNull();
  await page.mouse.move(
    beatBox!.x + beatBox!.width / 2,
    beatBox!.y + beatBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    beatBox!.x + beatBox!.width / 2 + 72,
    beatBox!.y + beatBox!.height / 2 + 24,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => {
      const value = await (
        await request.get(`${api}/stories/${activeStoryId}/graph-view`)
      ).json();
      return value.viewState.nodes[beatNodeId].x;
    })
    .not.toBe(initialX);

  const sourceHandle = page.getByTestId(`story-connect-handle-${beatNodeId}`);
  const targetNode = page.locator(`[data-node-id="${assetNodeId}"]`);
  await page
    .getByRole("button", { name: "Fit to content", exact: true })
    .click();
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetNode.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const viewport = page.viewportSize()!;
  const cancelledTargetPoint = {
    x: Math.min(
      targetBox!.x + Math.min(8, targetBox!.width / 2),
      viewport.width - 2,
    ),
    y: Math.min(
      targetBox!.y + Math.min(8, targetBox!.height / 2),
      viewport.height - 2,
    ),
  };
  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2,
  );
  await page.mouse.down();
  await expect(sourceHandle).toHaveClass(/active/);
  await page.keyboard.press("Escape");
  await expect(sourceHandle).not.toHaveClass(/active/);
  await page.mouse.move(cancelledTargetPoint.x, cancelledTargetPoint.y, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const project = (await (await request.get(`${api}/project`)).json())
        .project;
      const story = project.stories.find(
        (item: { id: string }) => item.id === activeStoryId,
      );
      return story.graph.edges.some(
        (edge: { from: string; to: string; type: string }) =>
          edge.from === beatNodeId &&
          edge.to === assetNodeId &&
          edge.type === "supports",
      );
    })
    .toBe(false);

  const actualSourceBox = await sourceHandle.boundingBox();
  expect(actualSourceBox).not.toBeNull();
  await page.mouse.move(
    actualSourceBox!.x + actualSourceBox!.width / 2,
    actualSourceBox!.y + actualSourceBox!.height / 2,
  );
  await page.mouse.down();
  await expect(sourceHandle).toHaveClass(/active/);
  const actualTargetBox = await targetNode.boundingBox();
  expect(actualTargetBox).not.toBeNull();
  const actualTargetPoint = {
    x: Math.min(
      actualTargetBox!.x + Math.min(8, actualTargetBox!.width / 2),
      viewport.width - 2,
    ),
    y: Math.min(
      actualTargetBox!.y + Math.min(8, actualTargetBox!.height / 2),
      viewport.height - 2,
    ),
  };
  await page.mouse.move(actualTargetPoint.x, actualTargetPoint.y, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator(".connection-result-toast")).toContainText(
    "Supports",
  );
  await expect
    .poll(async () => {
      const project = (await (await request.get(`${api}/project`)).json())
        .project;
      const story = project.stories.find(
        (item: { id: string }) => item.id === activeStoryId,
      );
      return {
        selectedAssetIds: story.beats.find(
          (beat: { id: string }) => beat.id === firstBeatId,
        ).selectedAssetIds,
        connected: story.graph.edges.some(
          (edge: { from: string; to: string; type: string }) =>
            edge.from === beatNodeId &&
            edge.to === assetNodeId &&
            edge.type === "supports",
        ),
      };
    })
    .toEqual({
      selectedAssetIds: expect.arrayContaining([crossBeatAssetId]),
      connected: true,
    });
});

test("recovers from an empty search with one action and offers a skip link", async ({
  page,
}) => {
  await page.getByRole("link", { name: "Skip to workspace" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("main.workspace-content")).toBeFocused();
  await page
    .getByRole("textbox", { name: "Search media", exact: true })
    .fill("no-matching-synthetic-file");
  await page
    .locator(".search-field")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await expect(page.locator(".library-empty")).toBeVisible();
  await page
    .locator(".library-empty")
    .getByRole("button", { name: "Clear search and filters" })
    .click();
  await expect(page.locator(".contact-sheet .asset-card")).toHaveCount(2);
  await expect(
    page.getByRole("textbox", { name: "Search media", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Search media", exact: true }),
  ).toHaveValue("");
});

test("opens pipeline stages with the keyboard and returns focus without starting production", async ({
  page,
  request,
}) => {
  const stage = page
    .locator(".pipeline-status-bar")
    .getByRole("button", { name: /^2\. / });
  await stage.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  expect(
    await drawer.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(stage).toBeFocused();
  expect(
    (await (await request.get(`${api}/project`)).json()).project.timelines,
  ).toHaveLength(0);
});

test("keeps one focused pipeline gate in standard mode and exposes canonical tasks in expert mode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const storyPlanStage = page
    .locator(".pipeline-status-bar")
    .getByRole("button", { name: /^2\. / });
  await storyPlanStage.click();
  const drawer = page.locator(".pipeline-workbench-container.is-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".gate-summary")).toContainText("Gate 2 of 5");
  await expect(drawer.locator(".workbench-pane-nav")).toHaveCount(0);
  await expect(drawer.locator(".workbench-pane-inspector")).toHaveCount(0);
  await expect(drawer.getByRole("progressbar")).toHaveAttribute(
    "aria-valuemax",
    "100",
  );
  await drawer.getByRole("button", { name: "Next gate", exact: true }).click();
  await expect(drawer.locator(".gate-summary")).toContainText("Gate 3 of 5");
  await expect(drawer.locator(".stage-card h3")).toContainText("Produce Clips");
  await page.keyboard.press("Escape");

  await page
    .getByRole("combobox", { name: "Workspace mode", exact: true })
    .selectOption("expert");
  await page
    .locator(".pipeline-status-bar")
    .getByRole("button", { name: /^3\. / })
    .click();
  await expect(drawer.locator(".canonical-task-row")).toHaveCount(8);
  await expect(drawer.locator(".workbench-pane-nav")).toBeVisible();
  await expect(drawer.locator(".workbench-pane-inspector")).toBeVisible();
  await expect(drawer.locator(".task-row-id")).toHaveText([
    "step-1",
    "step-2",
    "step-3",
    "step-4",
    "step-5",
    "step-6",
    "step-7",
    "step-8",
  ]);

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(drawer.locator(".gate-summary")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
      `pipeline should not overflow at ${viewport.width}×${viewport.height}`,
    ).toBe(true);
  }
});

test("keeps story setup and storyboard readable in CJK, expanded text and both themes", async ({
  page,
}, info) => {
  await navigate(page, "story");
  for (const locale of ["en-US", "zh-TW", "ja-JP", "en-XA"]) {
    await page.locator(".ui-language select").selectOption(locale);
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.locator('button[aria-controls="story-create"]').click();
      const form = page.locator(".story-create");
      await form
        .locator('select[name="story-template"]')
        .selectOption("custom-outline");
      await form
        .getByTestId("story-custom-outline")
        .fill(
          "我們一起走過平凡又重要的日子 — 思い出の風景\n" +
            "回憶與日常的連結 / 日々のつながり ".repeat(6) +
            "\n未完待續，留給明天",
        );
      for (const width of [1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 2,
          ),
          `${locale} ${theme} setup ${width}`,
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`${locale}-${theme}-setup-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
      await form.locator(".story-create-header button").click();
      await page.getByTestId("perspective-tab-storyboard").click();
      for (const width of [1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 2,
          ),
          `${locale} ${theme} storyboard ${width}`,
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`${locale}-${theme}-storyboard-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const audit = (window as unknown as { axe: typeof axe }).axe;
        return (
          await audit.run(".storyboard-view", {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map((item) => item.id);
      });
      expect(violations, `${locale} ${theme} storyboard accessibility`).toEqual(
        [],
      );
    }
  }
});
