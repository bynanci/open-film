import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import axe from "axe-core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import type {
  Job,
  ProxyCacheHealth,
  ProjectContentLocale,
} from "@openfilm/core";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";
const base = "http://127.0.0.1:4310/api";
const cleanup: Array<() => Promise<unknown>> = [];
test.afterEach(async ({ request }) => {
  await request.post(`${base}/proxy-cache/cancel`, {
    data: {
      projectId:
        (await (await request.get(`${base}/project`)).json()).project?.id ?? "",
    },
  });
  await expect
    .poll(async () =>
      (await request.post(`${base}/project/close`, { data: {} })).status(),
    )
    .toBe(200);
  for (const stop of cleanup.splice(0).reverse()) await stop();
});
async function fixture(request: APIRequestContext) {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  const root = await mkdtemp(join(tmpdir(), "openfilm-proxy-browser-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "synthetic.mp4"),
    path = join(root, "Film.openfilm");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=320x180:r=12",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  const originalHash = await hashFile(source);
  const app = await OpenFilmApplication.create(
    path,
    "Synthetic preview storage",
  );
  const projectId = app.project.id;
  app.catalog.upsertAsset({
    id: "video",
    name: "合成影片・長い思い出の見出し・此素材僅供本機驗證・Synthetic.mp4",
    uri: pathToFileURL(source).href,
    mediaType: "video",
    codec: "h264",
    contentHash: originalHash,
    duration: 2,
    dimensions: { width: 320, height: 180 },
    tags: [],
    state: {},
    metadata: {},
  });
  app.close();
  expect(
    (await request.post(`${base}/project/open`, { data: { path } })).ok(),
  ).toBe(true);
  const health = async () =>
    (
      await (
        await request.get(`${base}/proxy-cache?projectId=${projectId}`)
      ).json()
    ).health as ProxyCacheHealth;
  return { root, path, projectId, source, originalHash, health };
}
test("prepares real media, verifies corruption, rebuilds and accepts only reviewed cleanup", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await initialLocale(page);
  await page.goto("/");
  await navigate(page, "library");
  const panel = page.locator(".proxy-storage");
  const summary = panel.locator(":scope > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toHaveAttribute("open", "");
  await panel
    .getByRole("button", {
      name: uiText("en-US", "proxyStorage.prepare"),
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await f.health()).entries[0]?.status)
    .toBe("ready");
  await expect(panel.locator(".proxy-storage-source-status")).toContainText(
    uiText("en-US", "proxyStorage.status.ready"),
  );
  const jobs = (await (await request.get(`${base}/jobs`)).json()).jobs as Job[];
  const job = jobs.find((item) => item.type === "proxy")!;
  const response = await request.get(`${base}/source/video`);
  expect(response.headers()["x-openfilm-preview"]).toBe("managed");
  expect(
    createHash("sha256")
      .update(await response.body())
      .digest("hex"),
  ).toBe(job.proxyCache!.output!.hash);
  const proxy = join(f.path, job.proxyCache!.output!.uri);
  const bytes = await readFile(proxy);
  await writeFile(proxy, Buffer.alloc(bytes.length));
  await panel
    .getByRole("button", {
      name: uiText("en-US", "proxyStorage.verify"),
      exact: true,
    })
    .click();
  await expect(panel.locator(".proxy-storage-source-status")).toContainText(
    uiText("en-US", "proxyStorage.status.stale"),
  );
  const original = await request.get(`${base}/source/video`);
  expect(original.headers()["x-openfilm-preview"]).toBe("original");
  expect(
    createHash("sha256")
      .update(await original.body())
      .digest("hex"),
  ).toBe(f.originalHash);
  await panel
    .getByRole("button", {
      name: uiText("en-US", "proxyStorage.prepare"),
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await f.health()).entries[0]?.status)
    .toBe("ready");
  await panel
    .getByRole("button", {
      name: uiText("en-US", "proxyStorage.previewCleanup"),
      exact: true,
    })
    .click();
  const remove = panel.getByRole("button", {
    name: uiText("en-US", "proxyStorage.acceptCleanup"),
    exact: true,
  });
  await expect(remove).toBeDisabled();
  await panel
    .getByRole("checkbox", {
      name: uiText("en-US", "proxyStorage.confirmCleanup"),
      exact: true,
    })
    .check();
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect
    .poll(async () => (await f.health()).entries[0]?.status)
    .toBe("missing");
  expect(await hashFile(f.source)).toBe(f.originalHash);
});
for (const locale of [
  "en-US",
  "zh-TW",
  "ja-JP",
] as const satisfies readonly ProjectContentLocale[]) {
  test(`keeps preview controls accessible at compact and desktop widths in ${locale}`, async ({
    page,
    request,
  }) => {
    await fixture(request);
    await initialLocale(page, locale);
    await page.goto("/");
    await navigate(page, "library", locale);
    const panel = page.locator(".proxy-storage");
    await panel.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await panel.locator(".proxy-storage-settings > summary").focus();
    await page.keyboard.press("Enter");
    for (const width of [375, 720, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        panel.getByLabel(uiText(locale, "proxyStorage.quota"), { exact: true }),
      ).toBeVisible();
      expect(
        await panel.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(
      async () =>
        (
          await (window as unknown as { axe: typeof axe }).axe.run(
            document.querySelector(".proxy-storage")!,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            },
          )
        ).violations,
    );
    expect(violations).toEqual([]);
  });
}
