// SPDX-License-Identifier: Apache-2.0
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type {
  Composition,
  MediaAsset,
  ProjectContentLocale,
  WaveformData,
} from "@openfilm/core";
import {
  hashFile,
  inspectMedia,
  runProcess,
  WAVEFORM_CACHE_IDENTITY,
} from "@openfilm/media";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
let root: string;
let mediaPath: string;
let source: MediaAsset;
let originalHash: string;
let projectNumber = 0;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-sequence-waveform-browser-"));
  mediaPath = join(root, "literal-pulses.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x203050:s=160x90:r=30000/1001:d=3",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=if(between(t\\,0.25\\,0.4999)\\,0.75\\,if(between(t\\,0.75\\,0.9999)\\,0.25\\,0)):s=48000:d=3",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-y",
    mediaPath,
  ]);
  source = await inspectMedia({
    path: mediaPath,
    uri: pathToFileURL(mediaPath).href,
    name: "合成音訊・ソース音声・Literal pulses",
  });
  originalHash = await hashFile(mediaPath);
});
test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  await initialLocale(page);
});
test.afterEach(async ({ page, request }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.close();
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  expect(await hashFile(mediaPath)).toBe(originalHash);
});
test.afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function makeProject(
  options: {
    cached?: boolean;
    locked?: boolean;
    sources?: number;
    long?: boolean;
  } = {},
) {
  const path = join(root, `project-${projectNumber++}.openfilm`);
  const app = await OpenFilmApplication.create(
    path,
    "Waveform 合成波形 シーケンス",
    {
      timebase: {
        version: 1,
        rateNumerator: 30000,
        rateDenominator: 1001,
        dropFrame: false,
      },
    },
  );
  const assets: MediaAsset[] = [];
  try {
    app.project.settings = {
      width: 160,
      height: 90,
      frameRate: 30000 / 1001,
      timebase: {
        version: 1,
        rateNumerator: 30000,
        rateDenominator: 1001,
        dropFrame: false,
      },
    };
    for (let index = 0; index < (options.sources ?? 1); index++) {
      // Catalog identity is a unique imported URI, even for equal source bytes.
      const importedPath =
        index === 0
          ? mediaPath
          : join(root, `literal-pulses-${projectNumber}-${index}.mp4`);
      if (index > 0) await copyFile(mediaPath, importedPath);
      const asset = {
        ...structuredClone(source),
        id: `pulse-source-${index}`,
        uri: pathToFileURL(importedPath).href,
        contentHash: originalHash,
      };
      app.catalog.upsertAsset(asset);
      if (options.cached !== false) {
        // Literal cache bins are independent display fixtures. Actual decoded
        // MP4/render timing is covered by the separate media regression.
        const wave: WaveformData = {
          assetId: asset.id,
          duration: 3,
          sampleRate: 4,
          peaks: [0, 0.75, 0, 0.25, 0, 0, 0, 0, 0, 0, 0, 0],
          provenance: {
            ...WAVEFORM_CACHE_IDENTITY,
            sourceHash: originalHash,
            createdAt: "2026-10-30T00:00:00.000Z",
          },
        };
        app.catalog.intelligence.saveWaveform(wave);
      }
      if (options.locked) {
        asset.state.locked = true;
        app.catalog.upsertAsset(asset);
      }
      assets.push(asset);
    }
    const composition: Composition = {
      id: "waveform-cut",
      storyId: "waveform-story",
      duration: options.long ? 70.07 : 4.004,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "first",
              assetId: assets[0]!.id,
              sourceIn: 0,
              sourceOut: 1.001,
              timelineStart: 0.5005,
              timelineDuration: 1.001,
              locked: options.locked,
              transform: { volume: 0 },
            },
            {
              id: "repeat",
              assetId: assets[0]!.id,
              sourceIn: 0.25,
              sourceOut: 1,
              timelineStart: 2.002,
              timelineDuration: 0.5005,
              transform: { speed: 2 },
            },
          ],
        },
        {
          id: "audio",
          type: "audio",
          timing: "overlay",
          clips: assets.map((asset, index) => ({
            id: `overlay-${index}`,
            assetId: asset.id,
            sourceIn: 0,
            sourceOut: 1,
            timelineStart: 1.5015 + index,
            timelineDuration: 1,
          })),
        },
        {
          id: "music",
          type: "music",
          clips: [
            {
              id: "music",
              assetId: assets[0]!.id,
              sourceIn: 0,
              sourceOut: 1,
              timelineStart: 0,
              timelineDuration: 1,
              transform: { volume: 0.2 },
            },
          ],
        },
      ],
    };
    app.project.stories.push({
      id: "waveform-story",
      title: "合成音訊の編集",
      targetDuration: composition.duration,
      maxDuration: 90,
      beats: [
        {
          id: "waveform-beat",
          title: "Synthetic pulse edit",
          selectedAssetIds: assets.map((asset) => asset.id),
          candidateAssetIds: assets.map((asset) => asset.id),
        },
      ],
    });
    app.project.timelines.push(composition);
    await app.save();
    return { path, projectId: app.project.id };
  } finally {
    app.close();
  }
}
async function openCut(
  page: Page,
  path: string,
  locale: ProjectContentLocale = "en-US",
) {
  await page.goto("/");
  await openFilm(page, path, locale);
  await navigate(page, "edit", locale);
  await page
    .getByRole("combobox", {
      name: uiText(locale, "app.workspaceMode.label"),
      exact: true,
    })
    .selectOption("expert");
  await expect(page.getByTestId("sequence-waveform")).toBeVisible();
}
async function state(request: APIRequestContext) {
  const response = await request.get(`${api}/compositions/waveform-cut/editor`);
  expect(response.ok()).toBe(true);
  const value = await response.json();
  return {
    composition: value.composition,
    revision: value.revision,
    canUndo: value.canUndo,
    canRedo: value.canRedo,
  };
}

test("literal source pulses share one read across tracks, seek locked clips, and survive reopen without saved changes", async ({
  page,
  request,
}) => {
  const project = await makeProject({ locked: true });
  const reads: string[][] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/intelligence/waveforms")
      reads.push(request.postDataJSON().assetIds);
  });
  await openCut(page, project.path);
  const original = await state(request);
  const overview = page.getByTestId("sequence-waveform");
  await expect(overview.locator("path[data-clip-id]")).toHaveCount(4);
  expect(
    (await page.locator(".record-monitor").boundingBox())!.height,
  ).toBeGreaterThanOrEqual(90);
  await expect(overview.locator('path[data-clip-id="first"]')).toHaveAttribute(
    "d",
    /M112\.5,17\.75v64\.5/,
  );
  await expect(overview.locator('path[data-clip-id="repeat"]')).toHaveAttribute(
    "d",
    /M300\.5,17\.75v64\.5/,
  );
  await expect(
    overview.getByText(uiText("en-US", "cutDesk.waveform.rawPeaks")),
  ).toBeVisible();
  expect(reads).toEqual([["pulse-source-0"]]);
  const slider = overview.getByRole("slider", {
    name: uiText("en-US", "cutDesk.waveform.seek"),
  });
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(page.locator(".record-monitor")).toHaveAttribute(
    "data-frame",
    "1",
  );
  const graph = overview.locator(
    '[data-track-id="picture"] .sequence-waveform-graph',
  );
  const rect = (await graph.boundingBox())!;
  await graph.click({ position: { x: rect.width / 2, y: rect.height / 2 } });
  await expect(page.locator(".record-monitor")).toHaveAttribute(
    "data-frame",
    "60",
  );
  expect(await state(request)).toEqual(original);
  await page.reload();
  await navigate(page, "edit");
  await expect(
    page.getByTestId("sequence-waveform").locator("path[data-clip-id]"),
  ).toHaveCount(4);
  expect(await state(request)).toEqual(original);
  expect(reads).toEqual([["pulse-source-0"], ["pulse-source-0"]]);
});

test("playback frames update the single playhead without waveform reads or path changes", async ({
  page,
}) => {
  await openCut(page, (await makeProject()).path);
  const overview = page.getByTestId("sequence-waveform");
  await expect(overview.locator("path[data-clip-id]")).toHaveCount(4);
  const before = await overview
    .locator("path[data-clip-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("d")));
  let reads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/intelligence/waveforms")
      reads++;
  });
  await page
    .getByRole("button", { name: "Play sequence", exact: true })
    .click();
  await expect
    .poll(async () =>
      Number(await page.locator(".record-monitor").getAttribute("data-frame")),
    )
    .toBeGreaterThan(30);
  await page
    .getByRole("button", { name: "Pause sequence", exact: true })
    .click();
  expect(reads).toBe(0);
  expect(
    await overview
      .locator("path[data-clip-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("d"))),
  ).toEqual(before);
});

test("explicit preparation uses the existing waveform job and retry refresh recovers a failed read", async ({
  page,
  request,
}) => {
  const project = await makeProject({ cached: false });
  let fail = true;
  const postBodies: unknown[] = [];
  await page.route("**/api/intelligence/waveforms", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 500,
        json: { error: { code: "operation.failed" } },
      });
    } else await route.continue();
  });
  page.on("request", (request) => {
    if (
      /\/api\/assets\/[^/]+\/intelligence$/.test(
        new URL(request.url()).pathname,
      ) &&
      request.method() === "POST"
    )
      postBodies.push(request.postDataJSON());
  });
  await openCut(page, project.path);
  const original = await state(request);
  const overview = page.getByTestId("sequence-waveform");
  await expect(overview.locator('li[data-source-status="failed"]')).toHaveCount(
    1,
  );
  await overview
    .getByRole("button", { name: "Refresh / retry visible", exact: true })
    .click();
  await expect(
    overview.locator('li[data-source-status="not-cached"]'),
  ).toHaveCount(1);
  await expect(overview.locator("path[data-clip-id]")).toHaveCount(0);
  await overview
    .getByRole("button", { name: "Prepare visible missing", exact: true })
    .click();
  await expect(overview.locator('li[data-source-status="ready"]')).toHaveCount(
    1,
    { timeout: 30_000 },
  );
  await expect(overview.locator("path[data-clip-id]")).toHaveCount(4);
  expect(postBodies).toEqual([
    { operation: "waveform", projectId: project.projectId },
  ]);
  expect(await state(request)).toEqual(original);
});

test("stopping preparation fences a delayed analysis POST without cancelling active jobs or starting queued sources", async ({
  page,
  request,
}) => {
  const project = await makeProject({ cached: false, sources: 2 });
  const received = deferred();
  const release = deferred();
  let starts = 0;
  const cancels: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/jobs\/[^/]+\/cancel$/.test(new URL(request.url()).pathname))
      cancels.push(request.url());
  });
  await page.route("**/api/assets/*/intelligence", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    starts++;
    const response = await route.fetch();
    received.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await openCut(page, project.path);
    const overview = page.getByTestId("sequence-waveform");
    await expect(
      overview.locator('li[data-source-status="not-cached"]'),
    ).toHaveCount(2);
    await overview
      .getByRole("button", { name: "Prepare visible missing", exact: true })
      .click();
    await received.promise;
    await overview
      .getByRole("button", { name: "Stop preparation queue", exact: true })
      .click();
    release.resolve();
    await expect(overview.getByRole("status")).toHaveText(
      uiText("en-US", "cutDesk.waveform.stopped"),
    );
    await expect
      .poll(async () => {
        const response = await request.get(`${api}/jobs`);
        const body = await response.json();
        return body.jobs.some(
          (job: { assetId?: string; type: string; status: string }) =>
            job.assetId === "pulse-source-0" &&
            job.type === "waveform" &&
            job.status === "completed",
        );
      })
      .toBe(true);
    // Refresh is an awaited read after the stopped POST; it cannot advance the queue.
    await overview
      .getByRole("button", { name: "Refresh / retry visible", exact: true })
      .click();
    await expect(
      overview.locator('li[data-source-status="not-cached"]'),
    ).toHaveCount(1);
    expect(starts).toBe(1);
    expect(cancels).toEqual([]);
  } finally {
    release.resolve();
  }
});

test("a delayed earlier-film read cannot populate a new film and current missing evidence remains absent", async ({
  page,
  request,
}) => {
  const first = await makeProject();
  const second = await makeProject({ cached: false });
  const received = deferred();
  const release = deferred();
  let held = false;
  await page.route("**/api/intelligence/waveforms", async (route) => {
    if (held) {
      await route.continue();
      return;
    }
    held = true;
    const response = await route.fetch();
    received.resolve();
    await release.promise;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await openCut(page, first.path);
    await received.promise;
    await page
      .getByRole("button", {
        name: uiText("en-US", "app.navigation.switchProject"),
        exact: true,
      })
      .click();
    await openFilm(page, second.path);
    await navigate(page, "edit");
    const overview = page.getByTestId("sequence-waveform");
    await expect(
      overview.locator('li[data-source-status="not-cached"]'),
    ).toHaveCount(1);
    const saved = await state(request);
    release.resolve();
    await expect(overview.locator("path[data-clip-id]")).toHaveCount(0);
    await expect(
      overview.locator('li[data-source-status="not-cached"]'),
    ).toHaveCount(1);
    expect(await state(request)).toEqual(saved);
  } finally {
    release.resolve();
  }
});

for (const locale of ["zh-TW", "ja-JP"] as const) {
  test(`${locale} coarse narrow waveform controls wrap and retain native keyboard seeking`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const narrow = await context.newPage();
    try {
      await initialLocale(narrow, locale);
      await openCut(narrow, (await makeProject({ long: true })).path, locale);
      const overview = narrow.getByTestId("sequence-waveform");
      const slider = overview.getByRole("slider", {
        name: uiText(locale, "cutDesk.waveform.seek"),
      });
      await expect(slider).toBeVisible();
      await slider.focus();
      await slider.press("ArrowRight");
      await expect(narrow.locator(".record-monitor")).toHaveAttribute(
        "data-frame",
        "1",
      );
      const dimensions = await overview.evaluate((node) => ({
        width: node.clientWidth,
        scroll: node.scrollWidth,
        body: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
      expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
      const buttons = overview.getByRole("button");
      for (const button of await buttons.all()) {
        const rect = (await button.boundingBox())!;
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.width).toBeGreaterThanOrEqual(44);
      }
      await overview
        .getByRole("button", {
          name: uiText(locale, "cutDesk.waveform.next"),
          exact: true,
        })
        .click();
      await expect(overview).toHaveAttribute("data-view-start", "900");
      await overview
        .getByRole("button", {
          name: uiText(locale, "cutDesk.waveform.fit"),
          exact: true,
        })
        .click();
      await expect(overview).toHaveAttribute("data-view-start", "0");
      await expect(overview).toHaveAttribute("data-view-end", "2100");
      await narrow.screenshot({
        path: testInfo.outputPath("sequence-waveforms-narrow.png"),
      });
    } finally {
      await context.close();
    }
  });
}
