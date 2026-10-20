import { expect, test } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { initialLocale, navigate } from "./ui-helpers.js";
import { createDesktopFixture } from "./helpers.js";
const api = process.env.OPENFILM_E2E_API ?? "http://127.0.0.1:4310/api";
const compositionId = "graphic-film";
let fixture: Awaited<ReturnType<typeof createDesktopFixture>> | undefined;
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
});
test.afterEach(async ({ request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  await fixture?.cleanup();
  fixture = undefined;
});
test("authors all primitives, seeks exact shared frames and preserves history and reopen", async ({
  page,
  request,
}) => {
  fixture = await createDesktopFixture(0);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Synthetic graphic film",
  );
  try {
    await app.importFolder(fixture.media);
    const photo = app.catalog
      .listAssets({ limit: 100 })
      .find((asset) => asset.name === "01-photo.png")!;
    const secondPhoto = app.catalog
      .listAssets({ limit: 100 })
      .find((asset) => asset.name === "03-evening.png")!;
    app.project.settings = { width: 320, height: 180, frameRate: 30 };
    const story = app.generateStory({
      title: "Synthetic animation",
      template: "blank",
      assetIds: [photo.id, secondPhoto.id],
      targetDuration: 6,
      maxDuration: 6,
    });
    const composition = app.compose(story.id);
    composition.id = compositionId;
    composition.duration = 6;
    composition.tracks = [
      {
        id: "video",
        type: "video",
        clips: [
          {
            id: "graphic-photo",
            assetId: photo.id,
            beatId: story.beats[0]!.id,
            timelineStart: 0,
            timelineDuration: 6,
            motion: {
              version: 1,
              preset: "push-in",
              easing: "linear",
              from: { scale: 1, x: 0, y: 0 },
              to: { scale: 1.1, x: 0, y: 0 },
            },
          },
        ],
      },
    ];
    app.project.timelines[app.project.timelines.length - 1] = composition;
    await app.save();
  } finally {
    app.close();
  }
  expect(
    (
      await request.post(`${api}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await (await request.get(`${api}/project`)).json()
    ).project?.timelines.some(
      (timeline: { id: string }) => timeline.id === compositionId,
    ),
  ).toBe(true);
  await initialLocale(page);
  await page.goto("/");
  await navigate(page, "edit");
  await expect(page.locator("#clip-graphic-photo")).toBeVisible();
  await page.getByTestId("graphic-inspector-tab").click();
  const panel = page.locator(".graphic-inspector");
  await panel.getByRole("button", { name: "Add scene", exact: true }).click();
  await panel.getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByTestId("graphic-node-x").fill("-80");
  await page.getByTestId("graphic-node-x").press("Tab");
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  const state = async () =>
    (await request.get(`${api}/compositions/${compositionId}/editor`)).json();
  const firstShapeId = (await state()).composition.graphicScenes[0].nodes[0].id;
  await panel.getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByTestId("graphic-node-x").fill("100");
  await page.getByTestId("graphic-node-x").press("Tab");
  await expect
    .poll(async () => (await state()).composition.graphicScenes[0].nodes.length)
    .toBe(2);
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  await panel
    .getByRole("button", { name: `Select layer ${firstShapeId}`, exact: true })
    .click();
  const preview = page.getByTestId("graphic-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-frame", "0");
  const pixel = await preview.evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(80, 90, 1, 1).data];
  });
  expect(pixel).toEqual([237, 184, 79, 255]);
  await expect(
    panel.getByRole("checkbox", { name: "Snap to grid and guides" }),
  ).toBeChecked();
  await expect(
    panel.getByRole("checkbox", { name: "Show center and alignment guides" }),
  ).toBeChecked();
  const canvas = page.getByTestId("graphic-layer-canvas");
  await expect(canvas).toHaveClass(/graphic-layer-overlay-active/);
  const selectLayer = panel.getByRole("button", {
    name: `Select layer ${firstShapeId}`,
    exact: true,
  });
  await selectLayer.focus();
  await selectLayer.press("ArrowRight");
  await expect
    .poll(async () => (await state()).composition.graphicScenes[0].nodes[0].x)
    .toBe(-79);
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  const agent = page.getByTestId("graphic-agent-review");
  await agent.getByTestId("graphic-agent-instruction").fill("move right 12");
  await agent.getByTestId("graphic-agent-preview").click();
  await expect(agent.getByTestId("graphic-agent-plan")).toBeVisible();
  const proposedAction = agent.getByTestId("graphic-agent-action");
  await expect(proposedAction).toContainText("move right 12");
  const acceptAgentEdit = agent.getByTestId("graphic-agent-accept");
  await proposedAction.getByRole("checkbox").uncheck();
  await expect(acceptAgentEdit).toBeDisabled();
  await proposedAction.getByRole("checkbox").check();
  await acceptAgentEdit.click();
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  await expect
    .poll(async () => (await state()).composition.graphicScenes[0].nodes[0].x)
    .toBe(-67);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await state()).composition.graphicScenes[0].nodes[0].x)
    .toBe(-79);

  await agent.getByTestId("graphic-agent-instruction").fill("move right 12");
  await agent.getByTestId("graphic-agent-preview").click();
  await expect(agent.getByTestId("graphic-agent-plan")).toBeVisible();
  const pendingAction = agent.getByTestId("graphic-agent-action");
  await pendingAction.getByRole("checkbox").check();
  const acceptPath = "**/api/compositions/graphic-film/graphic-agent/accept";
  await page.route(acceptPath, async (route) => {
    const receipt = await page.evaluate(() =>
      Object.keys(localStorage).find((key) =>
        key.startsWith("openfilm.graphic-agent:"),
      ),
    );
    expect(receipt).toBeTruthy();
    await route.abort();
  });
  await agent.getByTestId("graphic-agent-accept").click();
  await expect(agent.getByTestId("graphic-agent-retry")).toBeVisible();
  await page.getByTestId("graphic-template-tab").click();
  await expect(agent).toHaveCount(0);
  await navigate(page, "story");
  await expect(
    page.locator(".main-nav button[aria-current='page']"),
  ).toHaveText("Edit");
  await page.reload();
  await navigate(page, "edit");
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await state()).composition.graphicScenes[0].nodes[0].x)
    .toBe(-79);
  await expect(page.getByTestId("direction-generate")).toBeDisabled();
  await navigate(page, "story");
  await expect(
    page.locator(".main-nav button[aria-current='page']"),
  ).toHaveText("Edit");
  await page.getByTestId("graphic-inspector-tab").click();
  await expect(agent.getByTestId("graphic-agent-retry")).toBeVisible();
  await page.unroute(acceptPath);
  await agent.getByTestId("graphic-agent-retry").click();
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  await expect
    .poll(async () => (await state()).composition.graphicScenes[0].nodes[0].x)
    .toBe(-67);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await state()).composition.graphicScenes[0].nodes[0].x)
    .toBe(-79);

  const target = page.locator(
    `[data-testid="graphic-layer-target"][data-layer-id="${firstShapeId}"]`,
  );
  const canvasBox = await canvas.boundingBox();
  const targetBox = await target.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2 + (canvasBox!.width * 16) / 320,
    targetBox!.y + targetBox!.height / 2,
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await state()).composition.graphicScenes[0].nodes[0].x)
    .toBe(-64);
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");

  // A second local command advances the saved revision while the pointer is
  // still held. The earlier draft gesture must be cancelled, not replayed.
  const staleGestureBox = await target.boundingBox();
  expect(staleGestureBox).not.toBeNull();
  await page.mouse.move(
    staleGestureBox!.x + staleGestureBox!.width / 2,
    staleGestureBox!.y + staleGestureBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    staleGestureBox!.x +
      staleGestureBox!.width / 2 +
      (canvasBox!.width * 16) / 320,
    staleGestureBox!.y + staleGestureBox!.height / 2,
  );
  await page.getByTestId("graphic-node-x").fill("-40");
  await page.getByTestId("graphic-node-x").press("Tab");
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  await page.mouse.up();
  await expect
    .poll(async () => (await state()).composition.graphicScenes[0].nodes[0].x)
    .toBe(-40);

  const resize = page.locator(
    '[data-testid="graphic-layer-resize-handle"][data-handle="e"]',
  );
  await expect(resize).toBeVisible();
  const resizeBox = await resize.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2,
    resizeBox!.y + resizeBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2 + (canvasBox!.width * 16) / 320,
    resizeBox!.y + resizeBox!.height / 2,
  );
  await page.mouse.up();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].nodes[0].width,
    )
    .toBeCloseTo(176, 0);
  await expect
    .poll(async () => (await state()).composition.graphicScenes[0].nodes[0].x)
    .toBeCloseTo(-32, 0);
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");

  const rotate = page.getByTestId("graphic-layer-rotation-handle");
  await expect(rotate).toBeVisible();
  const rotateBox = await rotate.boundingBox();
  const nodeBox = await page
    .getByTestId("graphic-layer-target")
    .first()
    .boundingBox();
  expect(rotateBox).not.toBeNull();
  expect(nodeBox).not.toBeNull();
  const center = {
    x: nodeBox!.x + nodeBox!.width / 2,
    y: nodeBox!.y + nodeBox!.height / 2,
  };
  const handlePoint = {
    x: rotateBox!.x + rotateBox!.width / 2,
    y: rotateBox!.y + rotateBox!.height / 2,
  };
  const radius = Math.hypot(handlePoint.x - center.x, handlePoint.y - center.y);
  await page.mouse.move(handlePoint.x, handlePoint.y);
  await page.mouse.down();
  await page.mouse.move(center.x + radius, center.y);
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await state()).composition.graphicScenes[0].nodes[0].rotation,
    )
    .toBeCloseTo(90, 0);
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");

  await page.getByTestId("graphic-node-opacity").fill("0.5");
  await page.getByTestId("graphic-node-opacity").press("Tab");
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].nodes[0].opacity,
    )
    .toBe(0.5);
  const selectedLayerRow = panel.locator(".graphic-layer-row.selected");
  await selectedLayerRow
    .getByRole("button", { name: "Raise layer", exact: true })
    .click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].nodes[0].zIndex,
    )
    .toBe(1);
  await selectedLayerRow
    .getByRole("button", { name: "Lower layer", exact: true })
    .click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].nodes[0].zIndex,
    )
    .toBe(-1);

  await selectedLayerRow
    .getByRole("button", { name: "Hide layer", exact: true })
    .click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].nodes[0].hidden,
    )
    .toBe(true);
  await selectedLayerRow
    .getByRole("button", { name: "Show layer", exact: true })
    .click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].nodes[0].hidden,
    )
    .toBe(false);
  await selectedLayerRow
    .getByRole("button", { name: "Lock layer", exact: true })
    .click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].nodes[0].locked,
    )
    .toBe(true);
  await expect(page.getByTestId("graphic-node-x")).toBeDisabled();
  const lockedX = (await state()).composition.graphicScenes[0].nodes[0].x;
  const lockedTargetBox = await target.boundingBox();
  expect(lockedTargetBox).not.toBeNull();
  await page.mouse.move(
    lockedTargetBox!.x + lockedTargetBox!.width / 2,
    lockedTargetBox!.y + lockedTargetBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    lockedTargetBox!.x + lockedTargetBox!.width / 2 + 32,
    lockedTargetBox!.y + lockedTargetBox!.height / 2,
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await state()).composition.graphicScenes[0].nodes[0].x)
    .toBe(lockedX);
  await selectedLayerRow
    .getByRole("button", { name: "Unlock layer", exact: true })
    .click();
  await expect(page.getByTestId("graphic-node-x")).toBeEnabled();

  await page.getByTestId("graphic-enter-duration").fill("3");
  await page.getByTestId("graphic-enter-duration").press("Tab");
  await page.getByTestId("graphic-enter-duration").fill("0");
  await page.getByTestId("graphic-enter-duration").press("Tab");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("graphic-enter-duration")).toHaveValue("0");
  await page.getByTestId("graphic-enter-duration").fill("3");
  await page.getByTestId("graphic-enter-duration").press("Tab");
  const seek = page.locator(".photo-presentation-transport input[type=range]");
  const digests = new Map<number, string>();
  for (const seconds of [3, 0, 5, 3]) {
    await seek.fill(String(seconds));
    await seek.dispatchEvent("input");
    await expect(preview).toHaveAttribute("data-frame", String(seconds * 30));
    const digest = await preview.evaluate(async (image: HTMLImageElement) => {
      const bytes = await (await fetch(image.src)).arrayBuffer();
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    });
    if (digests.has(seconds)) expect(digest).toBe(digests.get(seconds));
    else digests.set(seconds, digest);
  }
  expect(digests.get(0)).not.toBe(digests.get(3));
  await panel.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByTestId("graphic-text").fill("繁中動態敘事");
  await page.getByTestId("graphic-text").press("Tab");
  await panel.getByRole("button", { name: "Group", exact: true }).click();
  // Wait for this accepted history entry before adding its child; rapid edits
  // intentionally share the existing autosave batch and its Undo boundary.
  await expect
    .poll(async () => {
      const response = await request.get(
        `${api}/compositions/${compositionId}/editor`,
      );
      return (await response.json()).composition.graphicScenes[0].nodes.map(
        (node: { type: string }) => node.type,
      );
    })
    .toEqual(["shape", "shape", "text", "group"]);
  const groupId = (await state()).composition.graphicScenes[0].nodes[3].id;
  const selectById = (id: string) =>
    panel.getByRole("button", { name: `Select layer ${id}`, exact: true });
  const rowById = (id: string) =>
    panel.locator(
      `.graphic-layer-row:has(button[aria-label="Select layer ${id}"])`,
    );
  const groupRow = () => rowById(groupId);
  await groupRow()
    .getByRole("button", { name: "Lock layer", exact: true })
    .click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].nodes[3].locked,
    )
    .toBe(true);
  await expect(page.getByTestId("graphic-node-x")).toBeDisabled();
  await groupRow()
    .getByRole("button", { name: "Unlock layer", exact: true })
    .click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].nodes[3].locked,
    )
    .toBe(false);
  await panel.getByRole("button", { name: "Image", exact: true }).click();
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  const childId = (await state()).composition.graphicScenes[0].nodes[3]
    .children[0].id;
  await groupRow()
    .getByRole("button", { name: "Lock layer", exact: true })
    .click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].nodes[3].locked,
    )
    .toBe(true);
  await selectById(childId).click();
  await expect(page.getByTestId("graphic-node-x")).toBeDisabled();
  await expect(
    rowById(childId).getByRole("button", { name: "Lock layer", exact: true }),
  ).toBeDisabled();
  await groupRow()
    .getByRole("button", { name: "Unlock layer", exact: true })
    .click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].nodes[3].locked,
    )
    .toBe(false);
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  await selectById(groupId).click();
  await panel.getByRole("button", { name: "Image", exact: true }).click();
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  const saved = await state();
  expect(
    saved.composition.graphicScenes[0].nodes.map(
      (node: { type: string }) => node.type,
    ),
  ).toEqual(["shape", "shape", "text", "group"]);
  expect(
    saved.composition.graphicScenes[0].nodes[3].children.map(
      (node: { type: string }) => node.type,
    ),
  ).toEqual(["image", "image"]);
  expect(saved.composition.graphicScenes[0].nodes[2].text).toBe("繁中動態敘事");
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await state()).composition.graphicScenes[0].nodes[3].children.length,
    )
    .toBe(1);
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(async () => (await state()).composition.graphicScenes)
    .toEqual(saved.composition.graphicScenes);
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  expect(
    (
      await request.post(`${api}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await navigate(page, "edit");
  expect((await state()).composition.graphicScenes).toEqual(
    saved.composition.graphicScenes,
  );
  await page.getByTestId("graphic-inspector-tab").click();
  await expect(page.getByTestId("graphic-scene-select")).toHaveValue(
    saved.composition.graphicScenes[0].id,
  );

  await page.getByTestId("graphic-template-tab").click();
  const studio = page.locator(".graphic-template-studio");
  await studio.getByLabel("Speaker", { exact: true }).fill("合成說話者");
  await studio
    .getByLabel("Message text", { exact: true })
    .fill("合成繁中對話內容");
  await studio
    .getByLabel("Keep the original message and citation", { exact: true })
    .check();
  const sourceDetails = studio.locator("details").first();
  await sourceDetails.evaluate((element: HTMLDetailsElement) => {
    element.open = true;
  });
  await expect(sourceDetails.locator("summary")).toBeVisible();
  await expect(
    sourceDetails.getByRole("combobox", {
      name: "Source attribution",
      exact: true,
    }),
  ).toBeVisible();
  await sourceDetails
    .locator("select")
    .selectOption("excerpt", { force: true });
  await sourceDetails
    .getByLabel("Original source text", { exact: true })
    .fill("這是完整的虛構🙂原始對話紀錄");
  await sourceDetails
    .getByLabel("Excerpt start (character index)", { exact: true })
    .fill("8");
  await sourceDetails
    .getByLabel("Excerpt end (character index)", { exact: true })
    .fill("12");
  await studio
    .getByLabel("Citation or source label", { exact: true })
    .fill("Synthetic conversation fixture");

  await studio
    .getByRole("button", { name: "Add message", exact: true })
    .click();
  await studio
    .getByRole("button", { name: "Add message", exact: true })
    .click();
  const messageCards = studio.locator(".template-card");
  await messageCards
    .nth(1)
    .getByLabel("Speaker", { exact: true })
    .fill("中間訊息");
  await messageCards
    .nth(1)
    .getByLabel("Message text", { exact: true })
    .fill("準備移除");
  await messageCards
    .nth(2)
    .getByLabel("Speaker", { exact: true })
    .fill("保留訊息");
  await messageCards
    .nth(2)
    .getByLabel("Message text", { exact: true })
    .fill("移動前");
  await messageCards
    .nth(1)
    .getByRole("button", { name: "Remove message", exact: true })
    .click();
  await studio
    .getByRole("button", { name: "Add message", exact: true })
    .click();
  const lastCard = studio.locator(".template-card").last();
  await lastCard.getByLabel("Speaker", { exact: true }).fill("新增訊息");
  await lastCard.getByLabel("Message text", { exact: true }).fill("移動後");
  await studio
    .getByRole("button", { name: "Move message up", exact: true })
    .last()
    .click();
  await studio.getByRole("button", { name: "Save template scene" }).click();
  await expect
    .poll(async () => (await state()).composition.graphicSceneTemplates?.length)
    .toBe(1);
  const conversation = (await state()).composition.graphicSceneTemplates[0];
  expect(conversation.templateId).toBe("conversation-card");
  expect(
    conversation.data.messages.map((message: { id: string }) => message.id),
  ).toHaveLength(3);
  expect(
    new Set(
      conversation.data.messages.map((message: { id: string }) => message.id),
    ).size,
  ).toBe(3);
  expect(conversation.data.messages[0].source).toMatchObject({
    originalText: "這是完整的虛構🙂原始對話紀錄",
    attribution: "excerpt",
    excerpt: { start: 9, end: 13 },
    citation: "Synthetic conversation fixture",
  });
  const savedScene = (await state()).composition.graphicScenes.find(
    (scene: { id: string }) => scene.id === conversation.sceneId,
  );
  const savedTexts = conversation.data.messages.map(
    (message: { textNodeId: string }) =>
      savedScene.nodes.find(
        (node: { id: string; text?: string }) => node.id === message.textNodeId,
      )?.text,
  );
  expect(savedTexts).toEqual(["原始對話", "移動後", "移動前"]);

  await studio
    .getByRole("button", { name: "Route story", exact: true })
    .click();
  const gpx = Buffer.from(
    '<gpx><trk><name>Synthetic Fictional Walk</name><trkseg><trkpt lat="25.0" lon="121.0"/><trkpt lat="25.1" lon="121.1"/></trkseg></trk><wpt lat="25.05" lon="121.05"><name>Fictional Marker</name></wpt></gpx>',
  );
  await studio.getByLabel("Import a GPX route file").setInputFiles({
    name: "synthetic-route.gpx",
    mimeType: "application/gpx+xml",
    buffer: gpx,
  });
  await expect(studio.getByText(/Source: synthetic-route\.gpx/)).toBeVisible();
  await studio.getByRole("button", { name: "Save template scene" }).click();
  await expect
    .poll(async () => (await state()).composition.graphicSceneTemplates?.length)
    .toBe(2);
  const route = (await state()).composition.graphicSceneTemplates[1];
  expect(route.templateId).toBe("route-story");
  expect(route.data.source).toMatchObject({
    kind: "gpx",
    fileName: "synthetic-route.gpx",
  });
  expect(route.data.waypoints[0].label).toBe("Fictional Marker");

  await studio
    .getByRole("button", { name: "Photo relationship", exact: true })
    .click();
  await studio
    .getByRole("combobox", { name: "Photo relationship", exact: true })
    .selectOption("compare");
  const photoSelects = studio.locator("fieldset.template-card select");
  await photoSelects.nth(0).selectOption({ index: 1 });
  await photoSelects.nth(1).selectOption({ index: 2 });
  await studio.getByRole("button", { name: "Save template scene" }).click();
  await expect
    .poll(async () => (await state()).composition.graphicSceneTemplates?.length)
    .toBe(3);
  const templates = (await state()).composition.graphicSceneTemplates;
  expect(templates[2].templateId).toBe("photo-relationship");
  expect(
    templates[2].data.photos.map((photo: { assetId: string }) => photo.assetId),
  ).toHaveLength(2);
  expect(
    new Set(
      templates[2].data.photos.map(
        (photo: { assetId: string }) => photo.assetId,
      ),
    ).size,
  ).toBe(2);

  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await state()).composition.graphicSceneTemplates?.length)
    .toBe(2);
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(async () => (await state()).composition.graphicSceneTemplates?.length)
    .toBe(3);
  expect((await state()).composition.graphicSceneTemplates).toEqual(templates);
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  expect(
    (
      await request.post(`${api}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await navigate(page, "edit");
  expect((await state()).composition.graphicSceneTemplates).toEqual(templates);
});

test("authors local PhotoDepth layers, previews shared frames, and preserves undo/reopen", async ({
  page,
  request,
}) => {
  fixture = await createDesktopFixture(0);
  const dependencies = join(fixture.root, "depth-layers");
  await mkdir(dependencies);
  const maskPath = join(dependencies, "synthetic-depth-mask.png");
  const backgroundPath = join(dependencies, "synthetic-depth-background.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "nullsrc=s=320x180,format=rgba,geq=r='255':g='255':b='255':a='if(between(X,40,139)*between(Y,30,149),255,0)'",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-pix_fmt",
    "rgba",
    "-y",
    maskPath,
  ]);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x1d694b:s=320x180",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    backgroundPath,
  ]);
  const importedHashes = await Promise.all(
    [maskPath, backgroundPath].map((path) => hashFile(path)),
  );
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Synthetic PhotoDepth film",
  );
  let sourceHash: string;
  let replacementId: string;
  let replacementHash: string;
  try {
    await app.importFolder(fixture.media);
    const assets = app.catalog.listAssets({ limit: 100 });
    const photo = assets.find((asset) => asset.name === "01-photo.png")!;
    const replacementPhoto = assets.find(
      (asset) => asset.name === "02-photo-copy.png",
    )!;
    sourceHash = photo.contentHash!;
    replacementId = replacementPhoto.id;
    replacementHash = replacementPhoto.contentHash!;
    app.project.settings = { width: 320, height: 180, frameRate: 30 };
    const story = app.generateStory({
      title: "Synthetic parallax",
      template: "blank",
      assetIds: [photo.id, replacementPhoto.id],
      targetDuration: 6,
      maxDuration: 6,
    });
    story.beats[0]!.constraints = [
      { type: "must-include", assetIds: [photo.id] },
    ];
    const composition = app.compose(story.id);
    composition.id = compositionId;
    composition.duration = 6;
    composition.tracks = [
      {
        id: "photo-track",
        type: "video",
        clips: [
          {
            id: "photo-clip",
            assetId: photo.id,
            beatId: story.beats[0]!.id,
            sourceIn: 0,
            sourceOut: 6,
            timelineStart: 0,
            timelineDuration: 6,
          },
        ],
      },
    ];
    composition.graphicScenes = [
      {
        version: 1,
        id: "photo-depth-scene",
        name: "Synthetic depth",
        start: 0,
        duration: 6,
        zIndex: 0,
        nodes: [
          {
            id: "photo-depth-image",
            type: "image",
            assetId: photo.id,
            x: 0,
            y: 0,
            width: 320,
            height: 180,
            opacity: 1,
            zIndex: 0,
            start: 0,
            end: 6,
          },
        ],
      },
    ];
    app.project.timelines[app.project.timelines.length - 1] = composition;
    await app.save();
  } finally {
    app.close();
  }
  expect(
    (
      await request.post(`${api}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  await initialLocale(page);
  await page.goto("/");
  await navigate(page, "edit");
  await page.getByTestId("graphic-inspector-tab").click();
  const panel = page.locator(".graphic-inspector");
  await panel
    .getByRole("button", {
      name: "Select layer photo-depth-image",
      exact: true,
    })
    .click();
  const controls = panel.getByTestId("photo-depth-controls");
  await expect(controls).toBeVisible();
  const state = async () =>
    (await request.get(`${api}/compositions/${compositionId}/editor`)).json();
  await page.getByTestId("graphic-node-opacity").fill("0.9");
  await page.getByTestId("graphic-node-opacity").press("Tab");
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  const beforeImport = await state();
  expect(beforeImport.canUndo).toBe(true);
  expect(
    beforeImport.story.beats.every((beat: { candidateAssetIds?: string[] }) =>
      Array.isArray(beat.candidateAssetIds),
    ),
  ).toBe(true);
  await controls
    .getByRole("button", { name: "Import local photo layers", exact: true })
    .click();
  await expect(page.locator(".import-panel")).toBeVisible();
  await page.locator(".import-actions .primary").click();
  await page.locator("input[name='media-folder']").fill(dependencies);
  await page.locator(".import-folder-form .primary").click();
  await expect(
    controls.getByLabel("Foreground alpha mask (PNG)"),
  ).toContainText("synthetic-depth-mask.png");
  const imported = await (
    await request.get(`${api}/assets?mediaType=image&limit=200`)
  ).json();
  const mask = imported.assets.find(
    (asset: { name: string }) => asset.name === "synthetic-depth-mask.png",
  );
  const background = imported.assets.find(
    (asset: { name: string }) =>
      asset.name === "synthetic-depth-background.png",
  );
  const maskId = mask.id;
  const maskHash = mask.contentHash;
  const backgroundId = background.id;
  expect(mask.state.locked).not.toBe(true);
  expect(background.state.locked).not.toBe(true);
  const afterImport = await state();
  expect(afterImport.revision).toBe(beforeImport.revision);
  expect(afterImport.canUndo).toBe(true);
  expect(afterImport.story).toEqual(beforeImport.story);
  expect(
    afterImport.assets.some((asset: { id: string }) =>
      [maskId, backgroundId].includes(asset.id),
    ),
  ).toBe(false);
  await controls.getByLabel("Foreground alpha mask (PNG)").selectOption(maskId);
  await controls.getByLabel("Background source").selectOption("asset");
  await controls.getByLabel("Background fill image").selectOption(backgroundId);
  await controls
    .getByRole("button", { name: "Create photo motion", exact: true })
    .click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].photoDepth?.mode,
    )
    .toBe("parallax");
  const recipe = (await state()).composition.graphicScenes[0].photoDepth;
  expect(recipe).toMatchObject({
    mode: "parallax",
    sourceAssetId: expect.any(String),
    maskAssetId: expect.any(String),
    background: { kind: "asset", assetId: backgroundId },
    duration: 6,
  });
  expect(recipe.sourceSha256).toBe(sourceHash);
  expect(recipe.maskSha256).toBe(maskHash);
  expect((await state()).story).toEqual(beforeImport.story);
  await page.getByTestId("graphic-node-end").fill("4.5");
  await page.getByTestId("graphic-node-end").press("Tab");
  await expect
    .poll(
      async () =>
        (await state()).composition.graphicScenes[0].photoDepth.duration,
    )
    .toBe(4.5);
  await page.getByTestId("graphic-node-start").fill("1.5");
  await page.getByTestId("graphic-node-start").press("Tab");
  await expect
    .poll(
      async () =>
        (await state()).composition.graphicScenes[0].photoDepth.duration,
    )
    .toBe(3);
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await state()).composition.graphicScenes[0].photoDepth.duration,
    )
    .toBe(4.5);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await state()).composition.graphicScenes[0].photoDepth.duration,
    )
    .toBe(6);
  const projectId = (await (await request.get(`${api}/project`)).json()).project
    .id;
  const saved = await state();
  const frameUrl = `${api}/compositions/${compositionId}/graphics.png?projectId=${encodeURIComponent(projectId)}&revision=${encodeURIComponent(saved.revision)}&frame=90`;
  let frame = await request.get(frameUrl);
  await expect
    .poll(async () => {
      if (
        frame.status() === 409 &&
        (await frame.json()).code === "graphics.busy"
      )
        frame = await request.get(frameUrl);
      return frame.status();
    })
    .toBe(200);
  if (!frame.ok())
    throw new Error(
      `Graphic preview returned HTTP ${frame.status()}: ${await frame.text()}`,
    );
  expect(frame.headers()["content-type"]).toContain("image/png");
  const frameBytes = await frame.body();
  expect(frameBytes.readUInt32BE(16)).toBe(320);
  expect(frameBytes.readUInt32BE(20)).toBe(180);
  await controls
    .getByRole("button", { name: "Preview middle", exact: true })
    .click();
  await expect(page.locator(".graphic-preview-status")).toHaveCount(0);
  await expect(page.getByTestId("graphic-preview")).toBeVisible();
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");

  const sourcePicker = panel.getByTestId("graphic-node-image-asset");
  await expect(sourcePicker).toBeEnabled();
  await sourcePicker.selectOption(replacementId, { timeout: 5_000 });
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].photoDepth?.mode,
    )
    .toBe("fallback");
  expect((await state()).composition.graphicScenes[0].photoDepth).toMatchObject(
    {
      sourceAssetId: replacementId,
      fallbackReason: "mask-unreliable",
    },
  );
  await expect
    .poll(
      async () =>
        (await state()).composition.graphicScenes[0].photoDepth?.sourceSha256,
    )
    .toBe(replacementHash);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].photoDepth?.mode,
    )
    .toBe("parallax");
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].photoDepth?.mode,
    )
    .toBe("fallback");

  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].photoDepth?.mode,
    )
    .toBe("parallax");
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].photoDepth?.mode,
    )
    .toBe("fallback");
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].photoDepth?.id,
    )
    .toBe(recipe.id);
  expect(
    await Promise.all([maskPath, backgroundPath].map((path) => hashFile(path))),
  ).toEqual(importedHashes);
  await request.post(`${api}/project/close`, { data: {} });
  expect(
    (
      await request.post(`${api}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await navigate(page, "edit");
  await page.getByTestId("graphic-inspector-tab").click();
  await expect
    .poll(
      async () => (await state()).composition.graphicScenes[0].photoDepth?.id,
    )
    .toBe(recipe.id);
  await expect(
    page.locator("[data-testid='photo-depth-controls']"),
  ).toBeVisible();

  await panel
    .getByRole("button", {
      name: "Select layer photo-depth-image",
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Remove layer", exact: true })
    .click();
  await expect
    .poll(async () => {
      const current = (await state()).composition.graphicScenes[0];
      return {
        hasPhotoLayer: current.nodes.some(
          (node: { id: string }) => node.id === "photo-depth-image",
        ),
        recipe: current.photoDepth,
      };
    })
    .toEqual({ hasPhotoLayer: false, recipe: undefined });
});
