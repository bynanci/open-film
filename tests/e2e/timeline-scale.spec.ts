import { createHash } from "node:crypto";
import { initialLocale, navigate } from "./ui-helpers.js";
import { link, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type { Clip, MediaAsset } from "@openfilm/core";
import { createThumbnail } from "@openfilm/media";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";

test.use({ actionTimeout: 15_000 });
test.beforeEach(async ({ page }) => {
  await initialLocale(page);
});

const base = "http://127.0.0.1:4310";
const roots: string[] = [];
test.afterAll(async ({ request }) => {
  expect(
    (await request.post(`${base}/api/project/close`, { data: {} })).ok(),
  ).toBe(true);
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("keeps 500 video clips on cached lazy thumbnails and decodes only the selected source", async ({
  page,
  request,
}) => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-timeline-scale-"));
  roots.push(root);
  const generated = join(root, "generated");
  await generateSampleMedia(generated);
  const original = join(generated, "04-motion.mp4");
  const originalHash = createHash("sha256")
    .update(await readFile(original))
    .digest("hex");
  const media = join(root, "media");
  await mkdir(media);
  const project = join(root, "large-cut.openfilm");
  const app = await OpenFilmApplication.create(project, "Five hundred moments");
  const thumbnail = "cache/thumbnails/scale-reference.jpg";
  await mkdir(join(project, "cache", "thumbnails"), { recursive: true });
  const descriptor: MediaAsset = {
    id: "reference",
    uri: pathToFileURL(original).href,
    name: "Reference motion",
    mediaType: "video",
    duration: 3,
    dimensions: { width: 320, height: 180 },
    frameRate: 24,
    tags: [],
    state: {},
    metadata: {},
  };
  await createThumbnail(descriptor, join(project, thumbnail));
  const clips: Clip[] = [];
  // These are 500 actual local catalog locations and timeline entries. Hard links
  // share the generated source bytes; every browser source request still traverses
  // the normal catalog lookup, range response and real media decoder.
  for (let index = 0; index < 500; index++) {
    const suffix = String(index).padStart(3, "0");
    const path = join(media, `${suffix}-motion.mp4`);
    await link(original, path);
    const id = `asset-${suffix}`;
    app.catalog.upsertAsset({
      ...descriptor,
      id,
      uri: pathToFileURL(path).href,
      name: `${suffix}-motion.mp4`,
      thumbnailUri: thumbnail,
      contentHash: originalHash,
    });
    clips.push({
      id: `scale-${suffix}`,
      assetId: id,
      beatId: `beat-${Math.floor(index / 50)}`,
      sourceIn: 0,
      sourceOut: 3,
      timelineStart: index * 3,
      timelineDuration: 3,
    });
  }
  app.project.mediaLibraries.push({
    id: "library",
    name: "Generated motion library",
    uri: pathToFileURL(media).href,
  });
  app.project.stories.push({
    id: "large-story",
    title: "A substantial cut",
    targetDuration: 1500,
    maxDuration: 1800,
    beats: Array.from({ length: 10 }, (_, index) => ({
      id: `beat-${index}`,
      title: `Chapter ${index + 1}`,
      candidateAssetIds: clips
        .filter((clip) => clip.beatId === `beat-${index}`)
        .map((clip) => clip.assetId),
    })),
  });
  app.project.timelines.push({
    id: "large-cut",
    storyId: "large-story",
    duration: 1500,
    tracks: [{ id: "video", type: "video", clips }],
  });
  app.close();
  expect(
    (
      await request.post(`${base}/api/project/open`, {
        data: { path: project },
      })
    ).ok(),
  ).toBe(true);

  const requestedSources = new Set<string>();
  page.on("request", (entry) => {
    const path = new URL(entry.url()).pathname;
    if (path.startsWith("/api/source/"))
      requestedSources.add(
        decodeURIComponent(path.slice("/api/source/".length)),
      );
  });
  await page.goto("/");
  await navigate(page, "edit");
  const editor = page.getByRole("region", {
    name: "Composition timeline",
    exact: true,
  });
  await expect(
    editor.getByRole("status").filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  await expect(editor.locator(".editor-clip")).toHaveCount(500);
  const thumbnails = editor.locator(".editor-clip img");
  await expect(thumbnails).toHaveCount(500);
  expect(
    await thumbnails.evaluateAll((images) =>
      images.every(
        (image) =>
          image.getAttribute("loading") === "lazy" &&
          new URL((image as HTMLImageElement).src).pathname.startsWith(
            "/api/thumbnail/",
          ),
      ),
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      thumbnails
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  const player = page.getByLabel("Selected clip source preview", {
    exact: true,
  });
  await expect(page.locator("video")).toHaveCount(1);
  await expect
    .poll(() =>
      player.evaluate((video) => (video as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
  expect([...requestedSources]).toEqual(["asset-000"]);

  await page.locator("#clip-scale-499").click();
  await expect(page.locator("#clip-scale-499")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(player).toHaveAttribute("src", /\/source\/asset-499(?:\?|$)/);
  await expect
    .poll(() =>
      player.evaluate((video) => (video as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#clip-scale-498")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(player).toHaveAttribute("src", /\/source\/asset-498(?:\?|$)/);
  await expect
    .poll(() =>
      player.evaluate((video) => (video as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Play clip", exact: true }).click();
  await expect
    .poll(() =>
      player.evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
  await player.evaluate((video) => (video as HTMLVideoElement).pause());
  await page.getByRole("button", { name: "Mute clip", exact: true }).click();
  await expect(
    editor.getByRole("status").filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  const state = await (
    await request.get(`${base}/api/compositions/large-cut/editor`)
  ).json();
  expect(state.assets).toHaveLength(500);
  expect(state.composition.tracks[0].clips).toHaveLength(500);
  expect(state.composition.tracks[0].clips[498].transform.volume).toBe(0);
  await expect(page.locator("video")).toHaveCount(1);
  expect([...requestedSources].sort()).toEqual([
    "asset-000",
    "asset-498",
    "asset-499",
  ]);
  expect(
    createHash("sha256")
      .update(await readFile(original))
      .digest("hex"),
  ).toBe(originalHash);
  await page.screenshot({
    path: test.info().outputPath("timeline-500-clips.png"),
  });
});
