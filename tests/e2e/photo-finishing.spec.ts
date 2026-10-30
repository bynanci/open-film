import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import type { Clip, Composition, ProjectContentLocale } from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";
import { uiText } from "./ui-helpers.js";
import en from "../../apps/desktop/src/i18n/locales/en-US.js";
import { pseudoMessages } from "../../apps/desktop/src/i18n/pseudo";

const base = "http://127.0.0.1:4310";
const cleanups: Array<() => Promise<unknown>> = [];
test.afterEach(async ({ request }) => {
  await request.post(`${base}/api/project/close`, { data: {} });
  for (const action of cleanups.splice(0).reverse()) await action();
});
type Locale = ProjectContentLocale | "en-XA";
function label(locale: Locale, key: string): string {
  if (locale !== "en-XA") return uiText(locale, key);
  let value: unknown = pseudoMessages(en);
  for (const part of key.split("."))
    value = (value as Record<string, unknown>)[part];
  if (typeof value !== "string") throw new Error(`Missing pseudo label ${key}`);
  return value;
}
async function editor(
  request: APIRequestContext,
): Promise<{ composition: Composition; revision: string }> {
  const response = await request.get(
    `${base}/api/compositions/photo-finishing/editor`,
  );
  expect(response.ok()).toBe(true);
  return response.json();
}
async function fixture(request: APIRequestContext, ambient = false) {
  const files = await createDesktopFixture(0);
  cleanups.push(files.cleanup);
  const source = join(files.media, "00-finishing-portrait.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x305090:s=100x200,drawbox=x=20:y=70:w=20:h=50:c=white:t=fill,drawbox=x=60:y=0:w=40:h=200:c=red:t=fill",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    source,
  ]);
  const sourceHash = await hashFile(source);
  const app = await OpenFilmApplication.create(
    files.project,
    "Synthetic photo finishing",
  );
  await app.importFolder(files.media);
  const asset = app.catalog
    .listAssets({ limit: 100 })
    .find((item) => item.name === "00-finishing-portrait.png")!;
  const secondaryId = app.catalog
    .listAssets({ limit: 100 })
    .find((item) => item.name === "03-evening.png")!.id;
  app.project.settings = { width: 320, height: 180, frameRate: 30 };
  app.project.stories.push({
    id: "photo-story",
    title: "Together",
    beats: [{ id: "beat", title: "Memory", candidateAssetIds: [asset.id] }],
  });
  const clip: Clip = {
    id: "finishing-photo",
    assetId: asset.id,
    beatId: "beat",
    timelineStart: 0,
    timelineDuration: 6,
  };
  if (ambient) {
    clip.layout = {
      version: 2,
      preset: "contain",
      fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
    };
    clip.motion = {
      version: 2,
      preset: "pan",
      easing: {
        version: 1,
        kind: "cubic-bezier",
        x1: 0.25,
        y1: 0.1,
        x2: 0.25,
        y2: 1,
      },
      from: { scale: 1.08, x: -6, y: 0 },
      to: { scale: 1.08, x: 6, y: 0 },
    };
    clip.look = { version: 1, preset: "retro", strength: 1 };
  }
  app.project.timelines.push({
    id: "photo-finishing",
    storyId: "photo-story",
    duration: 6,
    tracks: [{ id: "visual", type: "video", clips: [clip] }],
  });
  app.close();
  const opened = await request.post(`${base}/api/project/open`, {
    data: { path: files.project },
  });
  expect(opened.ok()).toBe(true);
  return { ...files, source, sourceHash, secondaryId };
}
async function openEditor(page: Page, locale: Locale = "en-US") {
  await page.addInitScript((locale) => {
    localStorage.setItem("openfilm.uiLocale", locale);
    localStorage.setItem(
      "openfilm.preferences.v1",
      JSON.stringify({ workspaceMode: "standard" }),
    );
  }, locale);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page
    .getByRole("navigation", {
      name: label(locale, "app.navigation.label"),
      exact: true,
    })
    .getByRole("button", {
      name: label(locale, "app.navigation.edit"),
      exact: true,
    })
    .click();
  await page.locator("#clip-finishing-photo").click();
}
const selected = async (request: APIRequestContext) =>
  (await editor(request)).composition.tracks[0]!.clips[0]!;

test("focal dragging previews locally and accepts one captured transaction with undo, keyboard and cancellation", async ({
  page,
  request,
}) => {
  const files = await fixture(request);
  await openEditor(page);
  const before = await editor(request);
  const posted: string[] = [];
  page.on("request", (value) => {
    if (
      value.method() === "POST" &&
      value.url().endsWith("/photo-finishing/edit")
    )
      posted.push(value.postData()!);
  });
  const setFocus = page.getByRole("button", { name: "Set focus", exact: true });
  await setFocus.click();
  const handle = page.getByRole("button", {
    name: "Move photo focus",
    exact: true,
  });
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 30,
    box.y + box.height / 2 + 15,
    { steps: 5 },
  );
  expect((await editor(request)).revision).toBe(before.revision);
  expect(posted).toHaveLength(0);
  await page.mouse.up();
  await expect
    .poll(async () => (await editor(request)).revision)
    .not.toBe(before.revision);
  expect(posted).toHaveLength(1);
  expect((await selected(request)).layout).toMatchObject({
    version: 1,
    preset: "hero",
  });
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await selected(request)).layout)
    .toBeUndefined();
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(async () => (await selected(request)).layout?.preset)
    .toBe("hero");
  await setFocus.click();
  await handle.focus();
  const saved = await editor(request);
  const initial = (await selected(request)).layout!.focalPoint!;
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  expect((await editor(request)).revision).toBe(saved.revision);
  await page.keyboard.up("ArrowRight");
  await expect
    .poll(async () => (await selected(request)).layout!.focalPoint!.x)
    .toBeCloseTo(initial.x + 0.02, 10);
  expect(posted).toHaveLength(2);
  await setFocus.click();
  await expect(handle).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(handle).toHaveCount(0);
  const cancelled = await editor(request);
  await setFocus.click();
  const again = (await handle.boundingBox())!;
  await page.mouse.move(again.x + 22, again.y + 22);
  await page.mouse.down();
  await page.mouse.move(again.x + 40, again.y + 30);
  await page.setViewportSize({ width: 1320, height: 740 });
  await page.mouse.up();
  await expect(handle).toHaveCount(0);
  expect((await editor(request)).composition).toEqual(cancelled.composition);
  expect(posted).toHaveLength(2);
  expect(await hashFile(files.source)).toBe(files.sourceHash);
});

test("ambient errors remain visible until retry and Inspector edits preserve saved fill and curve", async ({
  page,
  request,
}) => {
  await fixture(request, true);
  let failed = false;
  await page.route("**/photo-fill/*.png?*", async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({ status: 503, body: "Transient synthetic failure" });
    } else await route.continue();
  });
  await openEditor(page);
  await expect(
    page.getByText(uiText("en-US", "editor.presentation.fillFailed"), {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry photo background", exact: true })
    .click();
  const ambient = page.locator(".photo-presentation-ambient");
  await expect
    .poll(() =>
      ambient.evaluate(
        (image) =>
          (image as HTMLImageElement).complete &&
          (image as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);
  const original = await selected(request);
  await page
    .getByRole("button", { name: "Gentle push-in", exact: true })
    .click();
  await expect
    .poll(async () => (await selected(request)).motion?.preset)
    .toBe("push-in");
  expect((await selected(request)).motion?.easing).toEqual(
    original.motion?.easing,
  );
  await page
    .getByText("Focal point and protected region", { exact: true })
    .click();
  await page.getByLabel("Focal point X (0–1)", { exact: true }).fill("0.65");
  await page.getByLabel("Focal point X (0–1)", { exact: true }).press("Tab");
  await expect
    .poll(async () => (await selected(request)).layout?.focalPoint?.x)
    .toBe(0.65);
  expect((await selected(request)).layout).toMatchObject({
    version: 2,
    fill: original.layout?.version === 2 ? original.layout.fill : null,
  });
});

for (const locale of ["zh-TW", "ja-JP", "en-XA"] as const)
  test(`localized focus controls wrap at 1280×720 and Escape restores the saved layout (${locale})`, async ({
    page,
    request,
  }) => {
    await fixture(request);
    await openEditor(page, locale);
    const before = await editor(request);
    await page
      .getByRole("button", {
        name: label(locale, "editor.presentation.setFocus"),
        exact: true,
      })
      .click();
    await expect(page.locator(".photo-focal-handle")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".photo-focal-handle")).toHaveCount(0);
    expect((await editor(request)).composition).toEqual(before.composition);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

test("Record Monitor bypass reuses raw ambient pixels and the diptych separator stays black outside the color group", async ({
  page,
  request,
}, info) => {
  const files = await fixture(request, true);
  const state = await editor(request);
  const updated = await request.post(
    `${base}/api/compositions/photo-finishing/edit`,
    {
      data: {
        baseRevision: state.revision,
        commands: [
          {
            type: "presentation",
            clipId: "finishing-photo",
            layout: {
              version: 2,
              preset: "diptych",
              gap: 8,
              secondary: { assetId: files.secondaryId },
              fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
            },
          },
        ],
      },
    },
  );
  expect(updated.ok()).toBe(true);
  await openEditor(page);
  const photo = page.locator(".editor-source-screen .photo-presentation-frame");
  await expect
    .poll(() =>
      photo
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  const gap = (await photo.locator(".photo-presentation-gap").boundingBox())!;
  const path = info.outputPath("black-separator.png");
  await page.screenshot({
    path,
    clip: {
      x: Math.floor(gap.x + gap.width / 2),
      y: Math.floor(gap.y + gap.height / 2),
      width: 2,
      height: 2,
    },
  });
  for (const value of await rgb(path)) expect(value).toBeLessThanOrEqual(2);
  await page
    .getByRole("combobox", { name: "Workspace mode", exact: true })
    .selectOption("expert");
  const record = page.locator(".record-monitor");
  const raw = record.locator(".photo-presentation-raw").first();
  const ambient = record.locator(".photo-presentation-ambient").first();
  await expect
    .poll(() =>
      ambient.evaluate(
        (node) =>
          (node as HTMLImageElement).complete &&
          (node as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect
    .poll(() => raw.evaluate((node) => (node as HTMLElement).style.filter))
    .not.toBe("");
  const source = await ambient.getAttribute("src");
  const before = (await editor(request)).composition;
  const writes: string[] = [];
  page.on("request", (sent) => {
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(sent.method()) &&
      sent.url().includes("/api/")
    )
      writes.push(sent.url());
  });
  const compare = page.getByRole("button", {
    name: "Hold to view original",
    exact: true,
  });
  await compare.dispatchEvent("pointerdown", {
    pointerId: 7,
    button: 0,
    isPrimary: true,
  });
  await expect
    .poll(() => raw.evaluate((node) => (node as HTMLElement).style.filter))
    .toBe("");
  expect(await ambient.getAttribute("src")).toBe(source);
  await compare.dispatchEvent("pointerup", { pointerId: 7 });
  await expect
    .poll(() => raw.evaluate((node) => (node as HTMLElement).style.filter))
    .not.toBe("");
  expect((await editor(request)).composition).toEqual(before);
  expect(writes).toEqual([]);
  expect(await hashFile(files.source)).toBe(files.sourceHash);
});

async function rgb(path: string, frame?: number): Promise<Buffer> {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      ...(frame === undefined ? [] : ["-vf", `select=eq(n\\,${frame})`]),
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ])
  ).stdout;
}
function meanError(
  actual: Buffer,
  expected: Buffer,
  region: "ambient" | "foreground",
  channel?: number,
): number {
  let total = 0,
    count = 0;
  for (let y = 30; y < 150; y++)
    for (let x = 0; x < 320; x++) {
      if (region === "ambient" ? x >= 100 && x <= 220 : x < 120 || x > 200)
        continue;
      for (const c of channel === undefined ? [0, 1, 2] : [channel]) {
        total += Math.abs(
          actual[(y * 320 + x) * 3 + c]! - expected[(y * 320 + x) * 3 + c]!,
        );
        count++;
      }
    }
  return total / count;
}
function whiteEdge(bytes: Buffer): number {
  return Array.from({ length: 320 }, (_, x) => x).find((x) =>
    [0, 1, 2].every((c) => bytes[(90 * 320 + x) * 3 + c]! > 220),
  )!;
}

test("actual Monitor and MP4 match raw ambient, grouped color and custom motion with shuffled seeks and deliberate failures", async ({
  page,
  request,
}, info) => {
  const files = await fixture(request, true);
  await openEditor(page);
  await page.addStyleTag({
    content:
      ".editor-source-screen .photo-presentation-frame{position:fixed!important;left:16px!important;top:16px!important;width:320px!important;height:180px!important;margin:0!important;border:0!important;box-sizing:content-box!important;z-index:10000!important}",
  });
  const frame = page.locator(".editor-source-screen .photo-presentation-frame");
  await expect
    .poll(() =>
      frame
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  const exported = await request.post(`${base}/api/export`, {
    data: { format: "mp4", compositionId: "photo-finishing" },
  });
  expect(exported.ok(), await exported.text()).toBe(true);
  const result = await exported.json();
  const seek = page.locator(".photo-presentation-transport input[type=range]");
  const samples: Record<string, unknown>[] = [];
  const repeated = new Map<number, string>();
  const monitorRepeated = new Map<number, string>();
  const sample = async (n: number, suffix = "") => {
    await seek.evaluate((element, value) => {
      (element as HTMLInputElement).value = String(value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, n / 30);
    const path = info.outputPath(`monitor-${n}${suffix}.png`);
    await frame.screenshot({ path, animations: "disabled" });
    return { path, bytes: await rgb(path) };
  };
  for (const n of [0, 90, 179, 35, 140, 179, 0, 90]) {
    const monitor = await sample(n);
    const decoded = await rgb(result.path, n);
    expect(monitor.bytes).toHaveLength(320 * 180 * 3);
    const ambient = meanError(monitor.bytes, decoded, "ambient"),
      foreground = meanError(monitor.bytes, decoded, "foreground");
    expect(ambient).toBeLessThanOrEqual(12);
    expect(foreground).toBeLessThanOrEqual(12);
    expect(
      Math.abs(whiteEdge(monitor.bytes) - whiteEdge(decoded)),
    ).toBeLessThanOrEqual(1.5);
    const hash = createHash("sha256").update(decoded).digest("hex");
    if (repeated.has(n)) expect(hash).toBe(repeated.get(n));
    repeated.set(n, hash);
    const monitorHash = createHash("sha256")
      .update(monitor.bytes)
      .digest("hex");
    if (monitorRepeated.has(n))
      expect(monitorHash).toBe(monitorRepeated.get(n));
    monitorRepeated.set(n, monitorHash);
    samples.push({
      frame: n,
      ambientMeanRgbError: ambient,
      foregroundMeanRgbError: foreground,
      monitorEdge: whiteEdge(monitor.bytes),
      decodedEdge: whiteEdge(decoded),
      decodedSha256: hash,
      monitorSha256: monitorHash,
    });
  }
  const decoded = await rgb(result.path, 90);
  await sample(90);
  const background = frame.locator(".photo-presentation-ambient");
  await background.evaluate((node) => {
    (node as HTMLElement).style.visibility = "hidden";
  });
  expect(
    meanError((await sample(90, "-missing-fill")).bytes, decoded, "ambient"),
  ).toBeGreaterThan(12);
  await background.evaluate((node) => {
    (node as HTMLElement).style.visibility = "";
    (node as HTMLElement).style.opacity = "0.55";
  });
  expect(
    meanError((await sample(90, "-double-dim")).bytes, decoded, "ambient"),
  ).toBeGreaterThan(12);
  await background.evaluate((node) => {
    (node as HTMLElement).style.opacity = "";
  });
  const group = frame.locator(".photo-presentation-raw");
  const filter = await group.evaluate(
    (node) => (node as HTMLElement).style.filter,
  );
  expect(filter).toContain("url(");
  await group.evaluate((node, filter) => {
    (node as HTMLElement).style.filter = `${filter} ${filter}`;
  }, filter);
  expect(
    meanError((await sample(90, "-double-color")).bytes, decoded, "ambient", 0),
  ).toBeGreaterThan(12);
  await group.evaluate((node, filter) => {
    (node as HTMLElement).style.filter = filter;
  }, filter);
  const motion = frame.locator(".photo-presentation-layers");
  await motion.evaluate((node) => {
    (node as HTMLElement).style.transform = "translate(-6px,0) scale(1.08)";
  });
  expect(
    Math.abs(
      whiteEdge((await sample(90, "-wrong-curve")).bytes) - whiteEdge(decoded),
    ),
  ).toBeGreaterThan(1.5);
  expect(await hashFile(files.source)).toBe(files.sourceHash);
  const evidence = process.env.OPENFILM_PHOTO_FINISHING_QA_OUTPUT;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await copyFile(result.path, join(evidence, "monitor-parity.mp4"));
    await copyFile(
      `${result.path}.manifest.json`,
      join(evidence, "monitor-parity.manifest.json"),
    );
    for (const n of [0, 90, 179, 35, 140]) {
      await copyFile(
        info.outputPath(`monitor-${n}.png`),
        join(evidence, `monitor-frame-${n}.png`),
      );
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        result.path,
        "-vf",
        `select=eq(n\\,${n})`,
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-y",
        join(evidence, `decoded-frame-${n}.png`),
      ]);
    }
    for (const name of [
      "missing-fill",
      "double-dim",
      "double-color",
      "wrong-curve",
    ])
      await copyFile(
        info.outputPath(`monitor-90-${name}.png`),
        join(evidence, `deliberate-${name}.png`),
      );
    await writeFile(
      join(evidence, "monitor-parity.json"),
      JSON.stringify(
        {
          version: 1,
          samples,
          sourceSha256: files.sourceHash,
          outputSha256: await hashFile(result.path),
          chromium: await page.context().browser()?.version(),
          viewport: page.viewportSize(),
          capture:
            "Actual component at320x180 CSS pixels and integer viewport position; no resampling",
          ffmpeg: (await runProcess("ffmpeg", ["-version"])).stdout
            .toString()
            .split("\n")[0],
          manifest: JSON.parse(
            await readFile(`${result.path}.manifest.json`, "utf8"),
          ),
        },
        null,
        2,
      ),
    );
  }
});
