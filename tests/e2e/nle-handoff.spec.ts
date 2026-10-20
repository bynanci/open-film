import { test, expect } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { createDesktopFixture } from "./helpers.js";
import { navigate } from "./ui-helpers.js";
const base = "http://127.0.0.1:4310";
test("reviews a localized handoff before explicit publication and downloads an intact exchange package", async ({
  page,
  request,
}) => {
  const fixture = await createDesktopFixture(0);
  try {
    const app = await OpenFilmApplication.create(
      fixture.project,
      "Synthetic NLE film",
    );
    try {
      await app.importFolder(fixture.media);
      const asset = app.catalog
        .listAssets({ limit: 100 })
        .find((a) => a.name === "01-photo.png")!;
      app.project.settings = { width: 160, height: 90, frameRate: 8 };
      const story = app.generateStory({
        template: "blank",
        title: "Synthetic story",
        assetIds: [asset.id],
        targetDuration: 2,
        maxDuration: 2,
      });
      const c = app.compose(story.id);
      c.duration = 2;
      c.tracks = [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "picture",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 2,
            },
          ],
        },
      ];
      c.graphicScenes = [
        {
          version: 1,
          id: "scene",
          name: "Synthetic",
          start: 1,
          duration: 1,
          zIndex: 1,
          nodes: [
            {
              id: "shape",
              type: "shape",
              shape: "rect",
              fill: "#ff0000",
              x: 0,
              y: 0,
              width: 40,
              height: 30,
              opacity: 1,
              zIndex: 0,
              start: 0,
              end: 1,
            },
          ],
        },
      ];
      app.project.timelines = [c];
      await app.save();
    } finally {
      app.close();
    }
    expect(
      (
        await request.post(`${base}/api/project/open`, {
          data: { path: fixture.project },
        })
      ).ok(),
    ).toBe(true);
    const before = await (await request.get(`${base}/api/project`)).json();
    await page.addInitScript(() =>
      localStorage.setItem("openfilm.uiLocale", "zh-TW"),
    );
    await page.goto("/");
    await navigate(page, "export", "zh-TW");
    const panel = page.getByRole("region", { name: "NLE 交換", exact: true });
    await expect(
      panel.getByRole("button", { name: "匯出已審閱交換包" }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "檢查交換計畫" }).click();
    await expect(panel).toContainText("僅 metadata");
    await panel.getByRole("combobox").selectOption("preserve-visual-fidelity");
    await expect(
      panel.getByRole("button", { name: "匯出已審閱交換包" }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "檢查交換計畫" }).focus();
    await page.keyboard.press("Enter");
    await expect(panel).toContainText("已預渲染");
    await panel.getByRole("button", { name: "匯出已審閱交換包" }).click();
    const link = panel.getByRole("link", { name: "下載交換包（.tar）" });
    await expect(link).toBeVisible();
    const received = page.waitForEvent("download");
    await link.click();
    const download = await received;
    expect(download.suggestedFilename()).toBe("handoff.tar");
    expect(await download.failure()).toBeNull();
    const downloaded = await request.get(
      (await link.getAttribute("href")) as string,
    );
    expect(downloaded.ok()).toBe(true);
    const bytes = await downloaded.body();
    expect(bytes.includes(Buffer.from("timeline.otio"))).toBe(true);
    expect(bytes.includes(Buffer.from("media/precomp-0.mp4"))).toBe(true);
    expect(await (await request.get(`${base}/api/project`)).json()).toEqual(
      before,
    );
  } finally {
    await request.post(`${base}/api/project/close`, { data: {} });
    await fixture.cleanup();
  }
});
