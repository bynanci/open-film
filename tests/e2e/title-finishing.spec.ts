// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Route,
  type APIResponse,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type { Composition, ProjectContentLocale } from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import { createTitleOverlay } from "@openfilm/render";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310/api",
  compositionId = "bilingual-film";
const cleanup: Array<() => Promise<void>> = [];
test.use({
  viewport: { width: 1440, height: 900 },
  actionTimeout: 15_000,
  hasTouch: true,
});
test.afterEach(async ({ page, request }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.close();
  await request.post(`${base}/project/close`, { data: {} });
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function createFilm(
  request: APIRequestContext,
  captionText = "繁體字幕\nOur caption",
  graphicCover = false,
) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Bilingual finishing",
  );
  await app.importFolder(fixture.media);
  const photo = app.catalog
    .listAssets({ limit: 100 })
    .find((asset) => asset.name === "01-photo.png")!;
  app.project.settings = { width: 640, height: 360, frameRate: 30 };
  app.project.stories = [
    {
      id: "story",
      title: "Story",
      beats: [{ id: "beat", title: "Together", candidateAssetIds: [photo.id] }],
    },
  ];
  const runs = {
    version: 1 as const,
    splitAt: 4,
    primary: { fontSize: 32, tracking: 1 },
    secondary: { fontSize: 18, tracking: 2, fontWeight: 700 },
    gap: 12,
  };
  app.project.timelines = [
    {
      id: compositionId,
      storyId: "story",
      duration: 3,
      tracks: [
        {
          id: "pictures",
          type: "video",
          clips: [
            {
              id: "bilingual-clip",
              assetId: photo.id,
              beatId: "beat",
              timelineStart: 0,
              timelineDuration: 3,
              title: "繁體標題\nOur story",
              titleRuns: runs,
              titleStyle: {
                version: 1,
                role: "film-title",
                fontSize: 32,
                position: "center",
                background: "none",
                finishing: {
                  version: 1,
                  stroke: { color: "#000000", width: 2 },
                  pill: {
                    color: "#221133",
                    opacity: 0.8,
                    paddingX: 12,
                    paddingY: 6,
                    radius: 8,
                  },
                },
              },
            },
          ],
        },
      ],
      captionTracks: [
        {
          version: 1,
          id: "captions",
          name: "Bilingual captions",
          style: {
            version: 1,
            role: "subtitle",
            fontSize: 24,
            background: "none",
          },
          cues: [
            {
              version: 1,
              id: "cue-a",
              startMs: 900,
              endMs: 1500,
              text: captionText,
              textRuns: runs,
              source: { kind: "manual" },
              manualRevision: 0,
            },
          ],
        },
        {
          version: 1,
          id: "other",
          name: "Other captions",
          style: { version: 1, role: "subtitle", fontSize: 24 },
          cues: [
            {
              version: 1,
              id: "cue-b",
              startMs: 900,
              endMs: 1500,
              text: "第二字幕\nOther captions",
              textRuns: runs,
              source: { kind: "manual" },
              manualRevision: 0,
            },
          ],
        },
      ],
    },
  ];
  if (graphicCover)
    app.project.timelines[0]!.graphicScenes = [
      {
        version: 1,
        id: "cover",
        name: "Black graphic",
        start: 0,
        duration: 3,
        zIndex: 0,
        nodes: [
          {
            id: "black",
            type: "shape",
            shape: "rect",
            x: 0,
            y: 0,
            width: 640,
            height: 360,
            opacity: 1,
            zIndex: 0,
            start: 0,
            end: 3,
            fill: "#000000",
          },
        ],
      },
    ];
  const projectId = app.project.id;
  app.close();
  expect(
    (
      await request.post(`${base}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  return { ...fixture, projectId };
}
async function state(
  request: APIRequestContext,
): Promise<{ composition: Composition; revision: string }> {
  const response = await request.get(
    `${base}/compositions/${compositionId}/editor`,
  );
  expect(response.ok()).toBe(true);
  return response.json();
}
async function openEditor(
  page: Page,
  locale: ProjectContentLocale = "en-US",
  expert = false,
) {
  await initialLocale(page, locale);
  await page.goto("/");
  await navigate(page, "edit", locale);
  await page
    .getByRole("combobox", {
      name: uiText(locale, "app.workspaceMode.label"),
      exact: true,
    })
    .selectOption(expert ? "expert" : "standard");
  await page.locator("#clip-bilingual-clip").click();
}
async function seek(page: Page, frame: number) {
  const field = page.getByRole("textbox", {
    name: "Sequence timecode",
    exact: true,
  });
  await field.fill(
    `00:00:${String(Math.floor(frame / 30)).padStart(2, "0")}:${String(frame % 30).padStart(2, "0")}`,
  );
  await field.press("Enter");
  await expect(page.locator(".record-monitor")).toHaveAttribute(
    "data-frame",
    String(frame),
  );
}

test("independent title controls keep history/reopen and show the exact measured raster", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request);
  await openEditor(page);
  await page
    .getByText("Secondary language typography", { exact: true })
    .click();
  const size = page.getByTestId("title-run-secondary-fontSize");
  await size.fill("22.5");
  await size.press("Tab");
  await expect
    .poll(
      async () =>
        (await state(request)).composition.tracks[0]!.clips[0]!.titleRuns
          ?.secondary?.fontSize,
    )
    .toBe(22.5);
  expect(
    (await state(request)).composition.tracks[0]!.clips[0]!.titleRuns?.primary,
  ).toEqual({ fontSize: 32, tracking: 1 });
  await page
    .getByRole("button", {
      name: uiText("en-US", "editor.undoLabel"),
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        (await state(request)).composition.tracks[0]!.clips[0]!.titleRuns
          ?.secondary?.fontSize,
    )
    .toBe(18);
  await page
    .getByRole("button", {
      name: uiText("en-US", "editor.redoLabel"),
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        (await state(request)).composition.tracks[0]!.clips[0]!.titleRuns
          ?.secondary?.fontSize,
    )
    .toBe(22.5);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved");
  const saved = await state(request),
    clip = saved.composition.tracks[0]!.clips[0]!;
  const raster = await createTitleOverlay(
    clip.title!,
    clip.titleStyle,
    { width: 640, height: 360 },
    join(fixture.root, "browser-reference.png"),
    { textRuns: clip.titleRuns },
  );
  const image = page
    .locator(".photo-presentation-title, .editor-title-overlay")
    .first();
  await expect(image).toHaveJSProperty("naturalWidth", 640);

  const displayed = await image.evaluate(async (node) =>
    Array.from(
      new Uint8Array(
        await (await fetch((node as HTMLImageElement).src)).arrayBuffer(),
      ),
    ),
  );
  expect(Buffer.from(displayed)).toEqual(await readFile(raster.path));
  expect(
    await image.evaluate((node) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d")!;
      context.drawImage(node as HTMLImageElement, 0, 0);
      return context
        .getImageData(0, 0, 640, 360)
        .data.some((value, index) => index % 4 === 3 && value > 200);
    }),
  ).toBe(true);
  await request.post(`${base}/project/close`, { data: {} });
  await request.post(`${base}/project/open`, {
    data: { path: fixture.project },
  });
  await page.reload();
  await navigate(page, "edit");
  await page.locator("#clip-bilingual-clip").click();
  await page
    .getByText("Secondary language typography", { exact: true })
    .click();
  await expect(page.getByTestId("title-run-secondary-fontSize")).toHaveValue(
    "22.5",
  );
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("Record caption boundaries and selection match the existing MP4 selector", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request, "繁體字幕\nOur caption", true);
  await openEditor(page, "en-US", true);
  const image = page
    .locator(".record-monitor")
    .getByTestId("native-caption-preview");
  await seek(page, 26);
  await expect(image).toHaveCount(0);
  await seek(page, 27);
  await expect(image).toHaveAttribute("data-cue-id", "cue-a");
  await expect(image).toHaveJSProperty("naturalWidth", 640);
  await expect(
    page.locator(".record-monitor").getByTestId("graphic-preview"),
  ).toHaveJSProperty("naturalWidth", 640);
  const record = page.locator(".record-frame"),
    shot = join(fixture.root, "record-caption.png");
  const recordBounds = (await record.boundingBox())!;
  console.info("Bilingual Record picture bounds", recordBounds);
  expect(recordBounds.height).toBeGreaterThanOrEqual(192);
  await writeFile(shot, await record.screenshot());
  await test.info().attach("record-caption", {
    path: shot,
    contentType: "image/png",
  });
  const raw = (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      shot,
      "-vf",
      "scale=640:360",
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ])
  ).stdout;
  let bright = 0;
  for (let y = 240; y < 360; y++)
    for (let x = 0; x < 640; x++) {
      const offset = (y * 640 + x) * 3;
      if (
        raw[offset]! > 220 &&
        raw[offset + 1]! > 220 &&
        raw[offset + 2]! > 220
      )
        bright++;
    }
  expect(bright).toBeGreaterThan(100); // captions must paint above the opaque GraphicScene, as in MP4.

  await seek(page, 44);
  await expect(image).toHaveCount(1);
  await seek(page, 45);
  await expect(image).toHaveCount(0);
  await seek(page, 33);
  await page.getByTestId("caption-inspector-tab").click();
  await page.getByTestId("monitor-caption-track").selectOption("other");
  await expect(image).toHaveAttribute("data-cue-id", "cue-b");
  await navigate(page, "export");
  await expect(page.getByTestId("export-caption-track")).toHaveValue("other");
  await page.getByTestId("export-caption-track").selectOption("__none");
  await navigate(page, "edit");
  await expect(image).toHaveCount(0);
  await expect(page.getByTestId("monitor-caption-track")).toHaveValue(
    "__none__",
  );
});

for (const locale of ["en-US", "zh-TW", "ja-JP"] as const) {
  test(`bilingual fields preserve IME edits and coarse targets without clipping in ${locale}`, async ({
    page,
    request,
  }) => {
    await createFilm(request);
    await openEditor(page, locale);
    await page.setViewportSize({ width: 390, height: 844 });
    const input = page.getByTestId("title-run-secondary-text");
    await input.scrollIntoViewIfNeeded();
    const before = (await state(request)).revision;
    await input.dispatchEvent("compositionstart");
    await input.fill("文字輸入 j k l");
    await input.dispatchEvent("change");
    expect((await state(request)).revision).toBe(before);
    await input.dispatchEvent("compositionend");
    await input.dispatchEvent("change");
    await input.press("Tab");
    await expect
      .poll(
        async () =>
          (await state(request)).composition.tracks[0]!.clips[0]!.title,
      )
      .toBe("繁體標題\n文字輸入 j k l");
    const panel = page.locator(".editor-presentation-inspector");
    expect(
      await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    const toggle = page.getByTestId("title-enable-bilingual").locator("..");
    const bounds = await toggle.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await expect(
      page.getByLabel(uiText(locale, "editor.titleFinishing.secondary"), {
        exact: true,
      }),
    ).toBeVisible();
  });
}

test("missing secondary glyph evidence and a delayed old-project caption never show stale pixels", async ({
  page,
  request,
}) => {
  const first = await createFilm(request);
  let held: { route: Route; response: APIResponse } | undefined;
  await page.route(
    "**/compositions/bilingual-film/caption/captions/cue-a.png?*",
    async (route) => {
      if (
        new URL(route.request().url()).searchParams.get("projectId") !==
        first.projectId
      ) {
        await route.continue();
        return;
      }
      held = { route, response: await route.fetch() };
    },
  );
  await openEditor(page, "en-US", true);
  await seek(page, 27);
  await expect.poll(() => !!held).toBe(true);
  const second = await createFilm(request, "另一字幕\nSecond film");
  await page.reload();
  await navigate(page, "edit");
  await page
    .getByRole("combobox", { name: "Workspace mode", exact: true })
    .selectOption("expert");
  await seek(page, 27);
  const image = page
    .locator(".record-monitor")
    .getByTestId("native-caption-preview");
  await expect(image).toHaveAttribute("alt", "另一字幕\nSecond film");
  await held!.route
    .fulfill({ response: held!.response })
    .catch(() => undefined);
  await expect(image).toHaveAttribute("alt", "另一字幕\nSecond film");
  await page.getByTestId("caption-inspector-tab").click();
  await page.getByTestId("caption-cue").first().click();
  const secondary = page.getByTestId("title-run-secondary-text");
  await secondary.fill("\u{10ffff}");
  await secondary.press("Tab");
  await expect
    .poll(
      async () =>
        (await state(request)).composition.captionTracks![0]!.cues[0]!.text,
    )
    .toBe("另一字幕\n\u{10ffff}");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved");
  await seek(page, 27);
  await expect(image).toHaveCount(0);
  await expect(
    page.locator(".record-monitor .native-text-status"),
  ).toContainText(uiText("en-US", "editor.titleFinishing.previewUnavailable"));
  const current = await state(request);
  const inspection = await request.get(
    `${base}/compositions/${compositionId}/caption/captions/cue-a/inspection?${new URLSearchParams({ projectId: second.projectId, revision: current.revision })}`,
  );
  expect(await inspection.json()).toMatchObject({
    status: "failed",
    kind: "font.load-failed",
    detail: "missing-glyph",
    run: "secondary",
  });
  expect(await second.assertOriginalsUnchanged()).toBe(true);
});
