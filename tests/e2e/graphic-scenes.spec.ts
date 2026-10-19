import { expect, test } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { initialLocale, navigate } from "./ui-helpers.js";
import { createDesktopFixture } from "./helpers.js";
const api = "http://127.0.0.1:4310/api";
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
    app.project.settings = { width: 320, height: 180, frameRate: 30 };
    const story = app.generateStory({
      title: "Synthetic animation",
      template: "blank",
      assetIds: [photo.id],
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
    .toEqual(["shape", "text", "group"]);
  await panel.getByRole("button", { name: "Image", exact: true }).click();
  await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
  const state = async () =>
    (await request.get(`${api}/compositions/${compositionId}/editor`)).json();
  const saved = await state();
  expect(
    saved.composition.graphicScenes[0].nodes.map(
      (node: { type: string }) => node.type,
    ),
  ).toEqual(["shape", "text", "group"]);
  expect(saved.composition.graphicScenes[0].nodes[2].children[0].type).toBe(
    "image",
  );
  expect(saved.composition.graphicScenes[0].nodes[1].text).toBe("繁中動態敘事");
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await state()).composition.graphicScenes[0].nodes[2].children.length,
    )
    .toBe(0);
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
});
