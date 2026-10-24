import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Story, StoryGraph } from "@openfilm/core";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import {
  chooseImportFolder,
  createFilm,
  navigate,
  uiText,
} from "./ui-helpers.js";

const base = "http://127.0.0.1:4310/api";
let root: string;
let mediaDirectory: string;

test.use({ locale: "en-US", viewport: { width: 1280, height: 900 } });

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-story-authoring-"));
  mediaDirectory = join(root, "synthetic-media");
  await generateSampleMedia(mediaDirectory);
});

test.beforeEach(async ({ page, request }) => {
  await request.post(`${base}/project/close`, { data: {} });
  await page.addInitScript(() => {
    localStorage.setItem("openfilm.uiLocale", "en-US");
  });
});

test.afterEach(async ({ request }) => {
  await request.post(`${base}/project/close`, { data: {} });
});

test.afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("authors a freeform beat order, opens the mind map, then presents the existing pipeline", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await createFilm(page, {
    title: "Custom Story Arc",
    path: join(root, "custom-story.openfilm"),
    templateId: "blank",
    targetDuration: 18,
    maxDuration: 30,
  });
  await chooseImportFolder(page, mediaDirectory);
  await expect(
    page.getByText(uiText("en-US", "app.activity.import.complete"), {
      exact: true,
    }),
  ).toBeVisible({ timeout: 60_000 });

  await navigate(page, "story");
  await page
    .getByRole("button", {
      name: uiText("en-US", "app.story.createFirst"),
      exact: true,
    })
    .click();
  await page
    .getByLabel(uiText("en-US", "app.story.title"), { exact: true })
    .fill("A story in my own order");
  await page
    .locator('select[name="story-template"]')
    .selectOption("custom-outline");
  const headings = [
    "Begin with the note I kept",
    "Return to the day we met",
    "Leave the ending open",
  ];
  await page.getByTestId("story-custom-outline").fill(headings.join("\n"));

  const storyCreated = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/stories" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: uiText("en-US", "app.story.plan"),
      exact: true,
    })
    .click();
  expect((await storyCreated).status()).toBe(201);
  await expect(page.getByTestId("story-graph-view")).toBeVisible();
  await expect(page.getByTestId("perspective-tab-graph")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const projectResponse = await request.get(`${base}/project`);
  const project = (await projectResponse.json()).project;
  const story = project.stories.find(
    (item: Story) => item.title === "A story in my own order",
  ) as Story;
  expect(story.beats.map((beat) => beat.title)).toEqual(headings);
  const graphResponse = await request.get(
    `${base}/stories/${encodeURIComponent(story.id)}/graph`,
  );
  const graph = ((await graphResponse.json()) as { graph: StoryGraph }).graph;
  expect(
    graph.edges
      .filter((edge) => edge.type === "precedes")
      .map((edge) => [edge.from, edge.to]),
  ).toEqual([
    [`beat-node-${story.beats[0]!.id}`, `beat-node-${story.beats[1]!.id}`],
    [`beat-node-${story.beats[1]!.id}`, `beat-node-${story.beats[2]!.id}`],
  ]);

  const firstBeatNode = page.locator(".graph-node.node-beat").first();
  await firstBeatNode.click();
  const beatTitle = page
    .locator(".inspector-palette")
    .getByLabel("Beat Title", { exact: true });
  const imeTitle = "輸入法完成後要保存";
  await beatTitle.evaluate((input, value) => {
    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    (input as HTMLInputElement).value = value;
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: value,
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
    input.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: value }),
    );
  }, imeTitle);
  await expect
    .poll(async () => {
      const response = await request.get(`${base}/project`);
      const current = (await response.json()).project as { stories: Story[] };
      return current.stories
        .find((item) => item.id === story.id)
        ?.beats.find((beat) => beat.id === story.beats[0]!.id)?.title;
    })
    .toBe(imeTitle);

  await page
    .getByTestId("story-workflow")
    .getByRole("button", {
      name: new RegExp(uiText("en-US", "app.story.workflow.pipeline")),
    })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: uiText("en-US", "app.pipeline.workbench.title"),
      exact: true,
    }),
  ).toBeVisible();
});
