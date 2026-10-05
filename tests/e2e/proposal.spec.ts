import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type {
  Clip,
  Composition,
  MediaAsset,
  OpenFilmProject,
  Story,
} from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import { generateProposalMedia } from "../../fixtures/proposal-film/generate.mjs";

const base = "http://127.0.0.1:4310";
test.use({ actionTimeout: 15_000 });
const cleanup: string[] = [];
test.afterAll(async ({ request }) => {
  expect(
    (await request.post(`${base}/api/project/close`, { data: {} })).ok(),
  ).toBe(true);
  await Promise.all(
    cleanup.map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function saved(page: Page) {
  await expect(
    page
      .getByRole("region", { name: "Composition timeline", exact: true })
      .getByRole("status")
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
}

async function field(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press("Tab");
}

async function state(request: APIRequestContext): Promise<{
  project: OpenFilmProject;
  assets: MediaAsset[];
  composition: Composition;
  story: Story;
}> {
  const { project } = await (await request.get(`${base}/api/project`)).json();
  const { assets } = await (await request.get(`${base}/api/assets`)).json();
  const composition = project.timelines.at(-1);
  return {
    project,
    assets,
    composition,
    story: project.stories.find(
      (story: Story) => story.id === composition.storyId,
    ),
  };
}

const clips = (composition: Composition) =>
  composition.tracks.flatMap((track) => track.clips);
const sourceEdits = ({ timelineStart: _timelineStart, ...clip }: Clip) => clip;
const clipButton = (page: Page, id: string) =>
  page.locator(`[id=${JSON.stringify(`clip-${id}`)}]`);

async function importFolder(page: Page, path: string, first = false) {
  await page
    .getByRole("button", {
      name: first ? "Add your first media" : "Add media",
      exact: true,
    })
    .click();
  await page.getByLabel("Media folder", { exact: true }).fill(path);
  await page
    .getByRole("button", { name: "Import folder", exact: true })
    .click();
  await expect(page.getByText("Import complete", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

// This is the reproducible reference workflow: generated originals, real device
// metadata, the Proposal Film template, browser edits and an actual rendered cut.
test("turns generated device media into a protected, edited and fitted Proposal Film", async ({
  page,
  request,
}) => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-proposal-browser-"));
  cleanup.push(root);
  const fixture = await generateProposalMedia(join(root, "originals"));
  const projectPath = join(root, "our-story.openfilm");
  await page.goto("/");
  await page
    .getByLabel("Film title", { exact: true })
    .fill("A question, made of memories");
  await page.getByLabel("Project folder", { exact: true }).fill(projectPath);
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await importFolder(page, fixture.mediaDirectory, true);
  await page
    .getByRole("button", {
      name: "Favorite 06-pixel-portrait.jpg",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Inspect 06-pixel-portrait.jpg", exact: true })
    .click();
  await page.getByRole("button", { name: "Rate 5 stars", exact: true }).click();
  const sourceDetails = page.getByRole("region", {
    name: "Source format and preview",
    exact: true,
  });
  await expect(sourceDetails).toContainText("Google Pixel");
  await expect(sourceDetails).toContainText("Motion Photo · Experimental");
  await expect(sourceDetails).toContainText("+08:00");
  await sourceDetails
    .getByText("Technical details and evidence", { exact: true })
    .click();
  await expect(sourceDetails).toContainText("Orientation");
  await expect(sourceDetails).toContainText("GPS");
  await page
    .getByRole("button", { name: "Close media details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Inspect 07-pixel-motion.mp4", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Always include", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close media details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reject 03-exact-copy.jpg", exact: true })
    .click();
  await importFolder(page, fixture.rawDirectory);
  await page
    .getByRole("button", {
      name: `Inspect ${basename(fixture.byId["insta360-raw-video"]!)}`,
      exact: true,
    })
    .click();
  await expect(sourceDetails).toContainText("360 source");
  await expect(sourceDetails).toContainText("Requires reframed export");
  await expect(
    page.getByRole("button", { name: "Rate 4 stars", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Close media details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Find moments & duplicates", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Similar media", exact: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: /The same memory, more than once/ })
      .first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Stories", exact: true }).click();
  await page
    .getByRole("button", { name: "Create your first story", exact: true })
    .click();
  await page
    .getByLabel("Story title", { exact: true })
    .fill("Our proposal in little moments");
  await page.getByLabel("Starting structure").selectOption("proposal-film");
  await expect(
    page.getByLabel("Target (seconds)", { exact: true }),
  ).toHaveValue("270");
  await expect(
    page.getByLabel("Maximum (seconds)", { exact: true }),
  ).toHaveValue("300");
  await page.getByLabel("Target (seconds)", { exact: true }).fill("18");
  await page.getByLabel("Maximum (seconds)", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Plan story", exact: true }).click();
  await expect(page.locator(".beat-list button")).toHaveCount(9);
  await page.getByLabel("Beat title", { exact: true }).fill("The first hello");
  await page
    .getByLabel("Beat intent", { exact: true })
    .fill("Begin with a small shared moment.");
  await page.getByRole("button", { name: "Save beat", exact: true }).click();
  await page.getByRole("button", { name: "Compose film", exact: true }).click();
  await saved(page);
  let current = await state(request);
  expect(current.story.template).toBe("proposal-film");
  expect(current.story.beats).toHaveLength(9);
  const assetNamed = (name: string) =>
    current.assets.find((asset) => asset.name === name)!;
  const pixelPhoto = assetNamed("06-pixel-portrait.jpg");
  const pixelVideo = assetNamed("07-pixel-motion.mp4");
  const rejected = assetNamed("03-exact-copy.jpg");
  const unsupported = new Set(
    current.assets
      .filter(
        (asset) =>
          (
            asset.metadata["openfilm.preview"] as
              { supported?: boolean } | undefined
          )?.supported === false,
      )
      .map((asset) => asset.id),
  );
  expect(
    clips(current.composition).some(
      (clip) => unsupported.has(clip.assetId) || clip.assetId === rejected.id,
    ),
  ).toBe(false);
  const importantPhoto = clips(current.composition).find(
    (clip) => clip.assetId === pixelPhoto.id,
  )!;
  const importantVideo = clips(current.composition).find(
    (clip) => clip.assetId === pixelVideo.id,
  )!;
  expect(importantPhoto).toBeDefined();
  expect(importantVideo).toBeDefined();
  await clipButton(page, importantVideo.id).click();
  await field(page, "Source in", "0.25");
  await field(page, "Source out", "2.25");
  await page
    .getByRole("button", { name: "Set speed to 2 times", exact: true })
    .click();
  await page.getByRole("button", { name: "Mute clip", exact: true }).click();
  await page
    .getByLabel("Clip transition", { exact: true })
    .selectOption("crossfade");
  await field(page, "Crossfade duration", "0.2");
  await page.getByRole("button", { name: "Lock clip", exact: true }).click();
  await saved(page);
  await clipButton(page, importantPhoto.id).click();
  await page
    .getByRole("button", {
      name: "Set photo duration to 2 seconds",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Lock clip", exact: true }).click();
  await saved(page);
  current = await state(request);
  const protectedPhoto = sourceEdits(
    clips(current.composition).find((clip) => clip.id === importantPhoto.id)!,
  );
  const protectedVideo = sourceEdits(
    clips(current.composition).find((clip) => clip.id === importantVideo.id)!,
  );
  expect(protectedVideo).toMatchObject({
    locked: true,
    sourceIn: 0.25,
    sourceOut: 2.25,
    timelineDuration: 1,
    transform: { speed: 2, volume: 0 },
    transition: { type: "crossfade", duration: 0.2 },
  });
  const beat = current.story.beats.find(
    (beat) => beat.id === importantPhoto.beatId,
  )!;
  await page
    .getByRole("button", { name: `Edit beat ${beat.title}`, exact: true })
    .click();
  await field(page, "Beat maximum duration", "12");
  await field(page, "Beat target duration", "8");
  await saved(page);
  const beforeRegeneration = (await state(request)).composition;
  const untouchedBeats = clips(beforeRegeneration)
    .filter((clip) => clip.beatId !== beat.id)
    .map(sourceEdits);
  await page
    .getByRole("button", { name: "Regenerate beat", exact: true })
    .click();
  await saved(page);
  current = await state(request);
  expect(
    clips(current.composition)
      .filter((clip) => clip.beatId !== beat.id)
      .map(sourceEdits),
  ).toEqual(untouchedBeats);
  expect(
    sourceEdits(
      clips(current.composition).find((clip) => clip.id === importantPhoto.id)!,
    ),
  ).toEqual(protectedPhoto);
  expect(
    sourceEdits(
      clips(current.composition).find((clip) => clip.id === importantVideo.id)!,
    ),
  ).toEqual(protectedVideo);
  const regenerated = clips(current.composition).filter(
    (clip) => clip.beatId === beat.id,
  );
  expect(regenerated.length).toBeGreaterThan(1);
  const optional = regenerated.find(
    (clip) => clip.id !== importantPhoto.id && !clip.locked,
  )!;
  await clipButton(page, optional.id).dragTo(
    clipButton(page, importantPhoto.id),
  );
  await saved(page);
  current = await state(request);
  expect(
    clips(current.composition).filter((clip) => clip.beatId === beat.id)[0]!.id,
  ).toBe(optional.id);

  const stretchPhoto = clips(current.composition).find(
    (clip) =>
      !clip.locked &&
      clip.beatId !== beat.id &&
      current.assets.some(
        (asset) =>
          asset.id === clip.assetId &&
          asset.mediaType === "image" &&
          !asset.state.locked,
      ),
  )!;
  expect(stretchPhoto).toBeDefined();
  await clipButton(page, stretchPhoto.id).click();
  await field(page, "Photo duration", "8");
  await saved(page);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await saved(page);
  await expect(page.getByLabel("Photo duration", { exact: true })).toHaveValue(
    String(stretchPhoto.timelineDuration),
  );
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await saved(page);
  current = await state(request);
  expect(current.composition.duration).toBeGreaterThan(
    current.story.targetDuration!,
  );
  await page
    .getByRole("button", { name: "Fit to target", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Shortening suggestions", exact: true })
      .getByRole("button", { name: /^Apply suggestion:/ })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Apply all suggestions", exact: true })
    .click();
  await saved(page);
  current = await state(request);
  expect(current.composition.duration).toBeLessThanOrEqual(18.001);
  expect(current.composition.duration).toBeLessThanOrEqual(300);
  expect(
    sourceEdits(
      clips(current.composition).find((clip) => clip.id === importantPhoto.id)!,
    ),
  ).toEqual(protectedPhoto);
  expect(
    sourceEdits(
      clips(current.composition).find((clip) => clip.id === importantVideo.id)!,
    ),
  ).toEqual(protectedVideo);
  await page.screenshot({
    path: test.info().outputPath("proposal-edited-timeline.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Render preview", exact: true })
    .click();
  const preview = page.getByLabel("Film preview", { exact: true });
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() =>
      preview.evaluate((video) => (video as HTMLVideoElement).duration),
    )
    .toBeGreaterThan(0);
  expect(
    await preview.evaluate((video) => (video as HTMLVideoElement).duration),
  ).toBeCloseTo(current.composition.duration, 1);
  await preview.evaluate((video) => (video as HTMLVideoElement).play());
  await expect
    .poll(() =>
      preview.evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
  await preview.evaluate((video) => (video as HTMLVideoElement).pause());
  const rendered = await request.get(`${base}/api/preview`);
  expect(rendered.ok()).toBe(true);
  await writeFile(
    test.info().outputPath("proposal-preview.mp4"),
    await rendered.body(),
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("button", { name: "OpenFilm timeline", exact: false })
    .click();
  await expect(
    page.getByText("Saved to your project", { exact: true }),
  ).toBeVisible();
  const exportPath = await page.locator(".export-result code").textContent();
  const exported = JSON.parse(await readFile(exportPath!, "utf8"));
  expect(exported.composition).toEqual(current.composition);
  await page.getByRole("button", { name: /OpenTimelineIO/ }).click();
  await expect(page.locator(".export-result code")).toContainText(
    "timeline.otio",
  );
  const report = page.getByRole("region", {
    name: "Export compatibility report",
    exact: true,
  });
  await expect(report).toContainText(
    "Import in DaVinci Resolve still needs manual verification.",
  );
  await expect(report).toContainText(
    "Advanced edits need recreation in Resolve",
  );
  await expect(
    report.getByRole("list", { name: "Export warnings", exact: true }),
  ).toContainText("METADATA ONLY");
  const otioPath = await page.locator(".export-result code").textContent();
  const otio = JSON.parse(await readFile(otioPath!, "utf8"));
  expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
  expect(otio.metadata.openfilm.composition).toEqual(current.composition);
  expect(otio.metadata.openfilm.compatibility).toMatchObject({
    advancedEdits: "metadata-only",
    realNleVerified: false,
  });
  const parsed = await runProcess(
    process.env.OPENFILM_OTIO_PYTHON ?? "python3",
    [
      "-c",
      `import json, pathlib, sys, urllib.parse, urllib.request
import opentimelineio as otio
timeline = otio.adapters.read_from_file(sys.argv[1])
clips = list(timeline.find_clips())
for clip in clips:
    url = urllib.parse.urlparse(clip.media_reference.target_url)
    assert url.scheme == 'file', clip.name
    assert pathlib.Path(urllib.request.url2pathname(urllib.parse.unquote(url.path))).is_file(), clip.name
print(json.dumps({'duration': timeline.duration().to_seconds(), 'clip_count': len(clips), 'parser_version': otio.__version__}))`,
      otioPath!,
    ],
  );
  const parsedTimeline = JSON.parse(parsed.stdout.toString("utf8"));
  expect(parsedTimeline.duration).toBeCloseTo(current.composition.duration, 6);
  expect(parsedTimeline.clip_count).toBeGreaterThan(0);
  await writeFile(
    test.info().outputPath("official-otio-validation.json"),
    parsed.stdout,
  );
  await test.info().attach("official-otio-validation", {
    body: parsed.stdout,
    contentType: "application/json",
  });
  await page.screenshot({
    path: test.info().outputPath("proposal-export-report.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open project", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Existing .openfilm folder", { exact: true })
    .fill(projectPath);
  await page
    .getByRole("button", { name: "Open project", exact: true })
    .last()
    .click();
  expect((await state(request)).composition).toEqual(current.composition);
  for (const file of fixture.files)
    expect(
      createHash("sha256")
        .update(await readFile(file.path))
        .digest("hex"),
      file.id,
    ).toBe(file.sha256);
});
