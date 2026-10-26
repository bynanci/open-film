// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import axe from "axe-core";
import { OpenFilmApplication } from "@openfilm/application";
import type { Composition } from "@openfilm/core";
import { hashFile } from "@openfilm/media";
import { professionalCutDeskFixture } from "../fixtures/professional-cut-desk.js";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
let root: string;
let media: Awaited<ReturnType<typeof professionalCutDeskFixture>>;
let projectNumber = 0;
test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-professional-browser-"));
  media = await professionalCutDeskFixture(root);
});
test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  await initialLocale(page);
});
test.afterEach(async ({ page, request }) => {
  await page.unrouteAll({ behavior: "wait" });
  await page.close();
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  for (const [index, path] of media.paths.entries())
    expect(await hashFile(path)).toBe(media.hashes[index]);
});
test.afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function makeProject(
  options: {
    clipLocked?: boolean;
    sourceLocked?: boolean;
    overlayLocked?: boolean;
    long?: boolean;
    hostileName?: boolean;
  } = {},
) {
  const path = join(root, `project-${projectNumber++}.openfilm`);
  const app = await OpenFilmApplication.create(
    path,
    "Synthetic Cut Desk 合成剪輯",
    { timebase: media.settings.timebase },
  );
  try {
    app.project.settings = structuredClone(media.settings);
    const cut = structuredClone(media.composition);
    cut.tracks[0]!.clips[0]!.locked = options.clipLocked ?? false;
    cut.tracks[1]!.clips[0]!.locked = options.overlayLocked ?? false;
    if (options.long) {
      cut.duration = 62.062;
      cut.tracks[0]!.clips[2]!.timelineDuration = 58.058;
    }
    for (const [index, original] of media.assets.entries()) {
      const asset = structuredClone(original);
      if (options.sourceLocked && (index === 0 || index === 3))
        asset.state.locked = true;
      if (options.hostileName && index === 0)
        asset.name =
          '<img src="https://untrusted.invalid/remote" onerror="window.cutDeskInjected=1">';
      app.catalog.upsertAsset(asset);
    }
    app.project.stories.push({
      id: "synthetic-story",
      title: "Three colors / 三色 / 三色",
      targetDuration: cut.duration,
      maxDuration: 90,
      beats: [
        {
          id: "synthetic-beat",
          title: "Synthetic edit",
          selectedAssetIds: media.assets.map((asset) => asset.id),
          candidateAssetIds: media.assets.map((asset) => asset.id),
        },
      ],
    });
    app.project.timelines.push(cut);
    await app.save();
  } finally {
    app.close();
  }
  return path;
}
async function openCut(page: Page, path: string) {
  await page.goto("/");
  await openFilm(page, path);
  await navigate(page, "edit");
  await page
    .getByRole("combobox", { name: "Workspace mode", exact: true })
    .selectOption("expert");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved");
}
async function state(request: APIRequestContext): Promise<{
  composition: Composition;
  revision: string;
  canUndo: boolean;
  canRedo: boolean;
}> {
  const response = await request.get(
    `${api}/compositions/professional-cut/editor`,
  );
  expect(response.ok()).toBe(true);
  return response.json();
}
async function seekRecord(page: Page, frame: number) {
  // Below minute one DF labels equal nominal frame labels; no production
  // formatter/resolver is used to compute expectations.
  const field = page.getByRole("textbox", {
    name: "Sequence timecode",
    exact: true,
  });
  await field.fill(
    `00:00:${String(Math.floor(frame / 30)).padStart(2, "0")};${String(frame % 30).padStart(2, "0")}`,
  );
  await field.press("Enter");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator(".record-monitor")).toHaveAttribute(
    "data-frame",
    String(frame),
  );
}
async function source(page: Page, clip = "red") {
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page
    .locator(".precision-source-picker")
    .getByLabel(uiText("en-US", "precision.selectedClip"))
    .selectOption(clip);
  await expect(
    page.getByLabel(uiText("en-US", "precision.snap"), { exact: true }),
  ).toBeEnabled();
}
async function saved(page: Page) {
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved");
}

test("Record crosses both saved boundaries without selection restart and seeded seeks reproduce source and GraphicScene frames", async ({
  page,
  request,
}) => {
  await openCut(page, await makeProject());
  const before = await state(request);
  const selected = await page
    .locator(".editor-clip[aria-pressed=true]")
    .getAttribute("id");
  await page.locator(".record-monitor").evaluate((node) => {
    const samples: number[] = [];
    Object.assign(window, { professionalFrames: samples });
    new MutationObserver(() =>
      samples.push(Number(node.getAttribute("data-frame"))),
    ).observe(node, { attributes: true, attributeFilter: ["data-frame"] });
  });
  await page.locator("#workspace-main").focus();
  await page.keyboard.press("Space");
  await expect
    .poll(
      async () =>
        Number(
          await page.locator(".record-monitor").getAttribute("data-frame"),
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(135);
  await page.keyboard.press("k");
  const frames = await page.evaluate(
    () =>
      (window as unknown as { professionalFrames: number[] })
        .professionalFrames,
  );
  expect(frames.some((frame) => frame > 0 && frame < 60)).toBe(true);
  expect(frames.some((frame) => frame >= 60 && frame < 120)).toBe(true);
  expect(frames.some((frame) => frame >= 120)).toBe(true);
  expect(
    frames.every((frame, index) => index === 0 || frame >= frames[index - 1]!),
  ).toBe(true);
  expect(
    await page.locator(".editor-clip[aria-pressed=true]").getAttribute("id"),
  ).toBe(selected);
  const order = [0, 15, 59, 60, 67, 75, 90, 119, 120, 150, 179];
  let seed = 0x1a2026;
  for (let index = order.length - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const other = seed % (index + 1);
    [order[index], order[other]] = [order[other]!, order[index]!];
  }
  for (const frame of [...order, 60, 0, 179]) {
    await seekRecord(page, frame);
    const clip = frame < 60 ? "red" : frame < 120 ? "green" : "blue";
    const expectedLayers =
      frame >= 60 && frame < 75 ? ["red", "green"] : [clip];
    await expect
      .poll(() =>
        page
          .locator("[data-record-layer]")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-record-layer")),
          ),
      )
      .toEqual(expectedLayers);
    const expectedSource =
      0.5005 +
      ((frame - (frame < 60 ? 0 : frame < 120 ? 60 : 120)) * 1001) / 30000;
    await expect
      .poll(() =>
        page
          .locator(`.record-monitor video[data-clip-id="${clip}"]`)
          .evaluate((node: HTMLVideoElement) => node.currentTime),
      )
      .toBeCloseTo(expectedSource, 5);
    const graphic = page.getByTestId("graphic-preview");
    await expect(graphic).toHaveAttribute("data-frame", String(frame));
    await expect
      .poll(() =>
        graphic.evaluate(
          (node: HTMLImageElement) =>
            node.complete && node.naturalWidth === 160,
        ),
      )
      .toBe(true);
    const pixel = await graphic.evaluate(
      (node: HTMLImageElement, x) => {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const context = canvas.getContext("2d")!;
        context.drawImage(node, 0, 0);
        return [...context.getImageData(x, 70, 1, 1).data];
      },
      Math.round(20 + frame / 3),
    );
    expect(pixel).toEqual([255, 255, 0, 255]);
  }
  expect((await state(request)).composition).toEqual(before.composition);
  console.log("Professional browser boundary/seek evidence", {
    crossed: [60, 120],
    seekOrder: order,
    sourceTimeToleranceSeconds: 0.000005,
    graphicPixels: "RGBA 255,255,0,255",
  });
});

test("Source I/O stages without a write, Apply and Record split each have one Undo/Redo, and an external edit stales marks", async ({
  page,
  request,
}) => {
  const path = await makeProject();
  await openCut(page, path);
  const original = (await state(request)).composition;
  const writes: unknown[] = [];
  page.on("request", (sent) => {
    if (
      sent.method() === "POST" &&
      new URL(sent.url()).pathname === "/api/compositions/professional-cut/edit"
    )
      writes.push(sent.postDataJSON());
  });
  await source(page);
  const player = page.locator(".precision-editor video");
  const waveform = page.locator(".precision-waveform");
  for (const [time, key] of [
    [0.7007, "i"],
    [2.7027, "o"],
  ] as const) {
    await player.evaluate((node: HTMLVideoElement, at) => {
      node.pause();
      node.currentTime = at;
    }, time);
    await expect
      .poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime))
      .toBeCloseTo(time, 5);
    await waveform.press(key);
  }
  expect(writes).toEqual([]);
  expect((await state(request)).composition).toEqual(original);
  const apply = page.getByRole("button", {
    name: uiText("en-US", "precision.applyRange"),
    exact: true,
  });
  await expect(apply).toBeEnabled();
  await waveform.press("Home");
  await expect
    .poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime))
    .toBeCloseTo(0.7007, 5);
  await waveform.press("End");
  await expect
    .poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime))
    .toBeCloseTo(2.7027, 5);
  await apply.click();
  await saved(page);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    commands: [
      { type: "trim", clipId: "red", sourceIn: 0.7007, sourceOut: 2.7027 },
    ],
  });
  const trimmed = (await state(request)).composition;
  const undo = page.getByRole("button", { name: "Undo edit", exact: true });
  const redo = page.getByRole("button", { name: "Redo edit", exact: true });
  await undo.click();
  await saved(page);
  expect((await state(request)).composition).toEqual(original);
  await redo.click();
  await saved(page);
  expect((await state(request)).composition).toEqual(trimmed);
  await undo.click();
  await saved(page);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await seekRecord(page, 135);
  await page.locator("#workspace-main").focus();
  await page.keyboard.press("b");
  await saved(page);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({
    commands: [{ type: "clip.split", clipId: "blue", sourceTime: 1.001 }],
  });
  const split = (await state(request)).composition;
  expect(split.tracks[0]!.clips).toHaveLength(4);
  await undo.click();
  await saved(page);
  expect((await state(request)).composition).toEqual(original);
  await redo.click();
  await saved(page);
  expect((await state(request)).composition).toEqual(split);
  await source(page);
  const input = page.getByRole("spinbutton", {
    name: uiText("en-US", "precision.trimIn"),
    exact: true,
  });
  await input.fill("0.8008");
  await input.press("Tab");
  // A real command from another application client changes the authoritative
  // revision. The stale local history request must fail closed.
  const current = await state(request);
  const external = await request.post(
    `${api}/compositions/professional-cut/edit`,
    {
      data: {
        baseRevision: current.revision,
        requestId: "professional-external",
        commands: [{ type: "volume", clipId: "green", volume: 0.5 }],
      },
    },
  );
  expect(external.ok(), await external.text()).toBe(true);
  await undo.click();
  await expect(page.getByTestId("editor-save-state")).toHaveText(
    "Save conflict",
  );
  await page
    .getByRole("button", { name: "Reload latest cut", exact: true })
    .click();
  await saved(page);
  await expect(
    page.getByText(uiText("en-US", "precision.marksStale"), { exact: true }),
  ).toBeVisible();
  await expect(apply).toBeDisabled();
  const accepted = (await state(request)).composition;
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  await openFilm(page, path);
  await navigate(page, "edit");
  expect((await state(request)).composition).toEqual(accepted);
  expect((await state(request)).canUndo).toBe(false);
});

test("Record DF entry rejects missing labels, target bounds differ, Record M writes nothing, and project switch fences late media before General use", async ({
  page,
  request,
}) => {
  const first = await makeProject({ long: true });
  const second = await makeProject();
  await openCut(page, first);
  const field = page.getByRole("textbox", {
    name: "Sequence timecode",
    exact: true,
  });
  await field.fill("00:01:00;00");
  await field.press("Enter");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".record-monitor")).toHaveAttribute(
    "data-frame",
    "0",
  );
  await field.fill("00:01:00;02");
  await field.press("Enter");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator(".record-monitor")).toHaveAttribute(
    "data-frame",
    "1800",
  );
  await page.locator("#workspace-main").focus();
  await page.keyboard.press("End");
  await expect(page.locator(".record-monitor")).toHaveAttribute(
    "data-frame",
    "1859",
  );
  await page.keyboard.press("Home");
  const before = await state(request);
  const writes: string[] = [];
  page.on("request", (sent) => {
    if (
      ["POST", "PATCH", "DELETE"].includes(sent.method()) &&
      sent.url().startsWith(api)
    )
      writes.push(sent.url());
  });
  await page.keyboard.press("m");
  expect(await state(request)).toEqual(before);
  expect(writes).toEqual([]);
  const retired = await page
    .locator('.record-monitor video[data-clip-id="red"]')
    .elementHandle();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("cut-desk-target-status")).toContainText(
    "Playing",
  );
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  await openFilm(page, second);
  await navigate(page, "edit");
  await expect(page.locator(".record-monitor")).toHaveAttribute(
    "data-frame",
    "0",
  );
  await retired!.evaluate((node: HTMLVideoElement) => {
    node.currentTime = 2;
    for (const event of ["canplay", "timeupdate", "waiting", "error"])
      node.dispatchEvent(new Event(event));
  });
  await expect(page.locator(".record-monitor")).toHaveAttribute(
    "data-frame",
    "0",
  );
  await expect(page.getByTestId("cut-desk-target-status")).toContainText(
    "Paused",
  );
  await expect(page.locator(".cut-desk-record")).not.toContainText(
    "could not be decoded",
  );
  await page
    .getByRole("combobox", { name: "Workspace mode", exact: true })
    .selectOption("standard");
  await expect(page.locator(".editor-source-screen")).toBeVisible();
  await page.locator('[id="clip-blue"]').click();
  await expect(page.locator('[id="clip-blue"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("button", {
      name: uiText("en-US", "precision.precisionMode"),
      exact: true,
    })
    .click();
  await expect(page.locator(".precision-editor")).toBeVisible();
});

for (const protection of [
  "clip",
  "primary-source",
  "overlay-clip",
  "overlay-source",
] as const) {
  test(`${protection} protection enforces viewing, staging and operation-specific trim/split rules`, async ({
    page,
    request,
  }) => {
    const primarySource = protection === "primary-source";
    const overlay = protection.startsWith("overlay");
    await openCut(
      page,
      await makeProject({
        clipLocked: protection === "clip",
        sourceLocked: protection.endsWith("source"),
        overlayLocked: protection === "overlay-clip",
      }),
    );
    await source(page, overlay ? "tone-overlay" : "red");
    const before = (await state(request)).composition;
    const waveform = page.locator(".precision-waveform");
    await waveform.press("ArrowRight");
    const preview = page.getByLabel(
      uiText("en-US", "precision.sourcePreview"),
      { exact: true },
    );
    await expect
      .poll(() =>
        preview.evaluate((node: HTMLMediaElement) => node.currentTime),
      )
      .toBeGreaterThan(0);
    const trim = page.getByRole("spinbutton", {
      name: uiText("en-US", "precision.trimIn"),
      exact: true,
    });
    const split = page.getByRole("button", {
      name: uiText("en-US", "precision.split"),
      exact: true,
    });
    const apply = page.getByRole("button", {
      name: uiText("en-US", "precision.applyRange"),
      exact: true,
    });
    await expect(split).toBeDisabled();
    if (primarySource) {
      await expect(trim).toBeEnabled();
      await trim.fill("0.7007");
      await trim.press("Tab");
      const out = page.getByRole("spinbutton", {
        name: uiText("en-US", "precision.trimOut"),
        exact: true,
      });
      await out.fill("2.7027");
      await out.press("Tab");
      expect((await state(request)).composition).toEqual(before);
      await apply.click();
      await saved(page);
      expect(
        (await state(request)).composition.tracks[0]!.clips[0]!.sourceIn,
      ).toBe(0.7007);
    } else {
      await expect(trim).toBeEnabled();
      for (const action of ["setIn", "setOut"])
        await expect(
          page.getByRole("button", {
            name: uiText("en-US", `precision.${action}`),
            exact: true,
          }),
        ).toBeEnabled();
      for (const [time, key] of [
        [1, "i"],
        [2, "o"],
      ] as const) {
        await preview.evaluate((node: HTMLMediaElement, at) => {
          node.pause();
          node.currentTime = at;
          node.dispatchEvent(new Event("timeupdate"));
        }, time);
        await waveform.press(key);
      }
      await expect(trim).toHaveValue("1");
      await expect(
        page.getByRole("spinbutton", {
          name: uiText("en-US", "precision.trimOut"),
          exact: true,
        }),
      ).toHaveValue("2");
      await waveform.press("b");
      await expect(apply).toBeDisabled();
      expect((await state(request)).composition).toEqual(before);
    }
  });
}

test("real Expert controls remain keyboard reachable with focus visible, no page overflow and no serious axe issues at all three viewports", async ({
  page,
}) => {
  await openCut(page, await makeProject());
  await page.addScriptTag({ content: axe.source });
  for (const size of [
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    for (const target of ["Record", "Source"] as const) {
      await page.getByRole("button", { name: target, exact: true }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(size.width);
      for (const locator of [
        page.locator(
          target === "Record" ? ".record-frame" : ".precision-player-region",
        ),
        page
          .locator(target === "Record" ? ".editor-clip" : ".precision-waveform")
          .first(),
      ]) {
        await locator.scrollIntoViewIfNeeded();
        await expect(locator).toBeInViewport();
      }
      const field = page.getByRole("textbox", {
        name:
          target === "Record"
            ? "Sequence timecode"
            : uiText("en-US", "precision.sourceElapsed"),
        exact: true,
      });
      await field.focus();
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        return {
          visible: element.matches(":focus-visible"),
          reachable: !!element.getClientRects().length,
          tag: element.tagName,
        };
      });
      expect(focus.visible).toBe(true);
      expect(focus.reachable).toBe(true);
      expect(focus.tag).not.toBe("BODY");
      const violations = await page.evaluate(async () =>
        (
          await (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
            },
          })
        ).violations
          .filter(
            (violation) =>
              violation.impact === "serious" || violation.impact === "critical",
          )
          .map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.map((node) => node.target),
          })),
      );
      expect(violations, `${target} ${size.width}x${size.height}`).toEqual([]);
      console.log("Professional accessibility", {
        target,
        ...size,
        seriousOrCritical: violations.length,
        focus,
      });
    }
  }
});

test("untrusted catalog text stays inert and remote/executable GraphicScene input is rejected without a write", async ({
  page,
  request,
}) => {
  const remote: string[] = [];
  page.on("request", (sent) => {
    if (new URL(sent.url()).hostname === "untrusted.invalid")
      remote.push(sent.url());
  });
  await openCut(page, await makeProject({ hostileName: true }));
  await expect(page.locator('[id="clip-red"]')).toContainText("<img src=");
  expect(
    await page.evaluate(
      () => (window as unknown as { cutDeskInjected?: number }).cutDeskInjected,
    ),
  ).toBeUndefined();
  expect(remote).toEqual([]);
  const before = await state(request);
  for (const extra of [
    { html: "<script>window.cutDeskInjected=1</script>" },
    { url: "https://untrusted.invalid/remote.js" },
  ]) {
    const response = await request.post(
      `${api}/compositions/professional-cut/edit`,
      {
        data: {
          baseRevision: before.revision,
          requestId: `professional-unsafe-${Object.keys(extra)[0]}`,
          commands: [
            {
              type: "graphic.scene.upsert",
              scene: {
                ...media.composition.graphicScenes![0],
                id: "unsafe",
                ...extra,
              },
            },
          ],
        },
      },
    );
    expect(response.status()).toBe(400);
    expect((await state(request)).composition).toEqual(before.composition);
  }
  expect(remote).toEqual([]);
});
