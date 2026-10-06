import {
  initialLocale,
  navigate,
  openFilm,
  chooseImportFolder,
} from "./ui-helpers.js";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type { Composition, MediaAsset } from "@openfilm/core";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";

test.use({ actionTimeout: 15_000 });
test.beforeEach(async ({ page }) => {
  await initialLocale(page);
});

const base = "http://127.0.0.1:4310";
const cleanup: Array<() => Promise<void>> = [];
test.afterAll(async ({ request }) => {
  expect(
    (await request.post(`${base}/api/project/close`, { data: {} })).ok(),
  ).toBe(true);
  await Promise.all(cleanup.map((action) => action()));
});

async function travelingFilm(request: APIRequestContext) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-relink-browser-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const media = join(root, "original-media");
  await generateSampleMedia(media);
  // Distinct hashes make automatic folder matches unique. Duplicate ambiguity
  // and manually confirmed legacy matches are covered at the service boundary.
  await rm(join(media, "02-photo-copy.png"));
  const names = [
    "01-photo.png",
    "03-evening.png",
    "04-motion.mp4",
    "05-tone.wav",
  ];
  const originals = new Map(
    await Promise.all(
      names.map(
        async (name) => [name, await readFile(join(media, name))] as const,
      ),
    ),
  );
  const project = join(root, "traveling.openfilm");
  const app = await OpenFilmApplication.create(project, "A film that travels");
  const imported = await app.importFolder(media);
  expect(imported.imported).toBe(4);
  expect(imported.failed).toBe(0);
  const assets = app.catalog.listAssets({ limit: 100 });
  const photo = assets.find((asset) => asset.name === "01-photo.png")!;
  const motion = assets.find((asset) => asset.name === "04-motion.mp4")!;
  app.catalog.upsertAsset({
    ...photo,
    rating: 4,
    state: { favorite: true, locked: true },
    metadata: { ...photo.metadata, "openfilm.test.note": "Keep this memory" },
  });
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.project.stories.push({
    id: "traveling-story",
    title: "Home is a memory",
    targetDuration: 8,
    maxDuration: 15,
    beats: [
      {
        id: "traveling-beat",
        title: "Together",
        candidateAssetIds: [photo.id, motion.id],
        selectedAssetIds: [photo.id, motion.id],
      },
    ],
  });
  app.project.timelines.push({
    id: "traveling-cut",
    storyId: "traveling-story",
    duration: 7,
    tracks: [
      {
        id: "visuals",
        type: "video",
        clips: [
          {
            id: "traveling-photo",
            assetId: photo.id,
            beatId: "traveling-beat",
            timelineStart: 0,
            timelineDuration: 4,
          },
          {
            id: "traveling-motion",
            assetId: motion.id,
            beatId: "traveling-beat",
            timelineStart: 4,
            timelineDuration: 3,
            sourceIn: 0,
            sourceOut: 3,
          },
        ],
      },
    ],
  });
  app.close();
  expect(
    (
      await request.post(`${base}/api/project/open`, {
        data: { path: project },
      })
    ).ok(),
  ).toBe(true);
  const moved = join(root, "new-computer");
  await mkdir(moved);
  return {
    root,
    media,
    project,
    names,
    originals,
    photo,
    motion,
    movedMedia: join(moved, "memories"),
    movedProject: join(moved, "traveling.openfilm"),
  };
}

async function assets(request: APIRequestContext): Promise<MediaAsset[]> {
  const response = await request.get(`${base}/api/assets`);
  expect(response.ok()).toBe(true);
  return (await response.json()).assets;
}

async function composition(request: APIRequestContext): Promise<Composition> {
  const response = await request.get(
    `${base}/api/compositions/traveling-cut/editor`,
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).composition;
}

async function saved(page: Page) {
  await expect(
    page
      .getByRole("region", { name: "Composition timeline", exact: true })
      .getByRole("status")
      .filter({ hasText: /^Saved$/ }),
  ).toHaveText("Saved");
}

async function field(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press("Tab");
}

async function openProject(page: Page, path: string) {
  await openFilm(page, path);
  await expect(
    page.getByRole("heading", { name: "A film that travels", exact: true }),
  ).toBeVisible();
}

test("moves a real edited project and its media, restores sources and imports them without duplicate identities", async ({
  page,
  request,
}) => {
  const fixture = await travelingFilm(request);
  await page.goto("/");
  await navigate(page, "edit");
  await saved(page);
  await page.locator("#clip-traveling-motion").click();
  await field(page, "Source in", "0.25");
  await field(page, "Source out", "2.75");
  await field(page, "Playback speed", "1.25");
  await page.getByRole("button", { name: "Mute clip", exact: true }).click();
  await page
    .getByLabel("Clip transition", { exact: true })
    .selectOption("crossfade");
  await page.getByRole("button", { name: "Lock clip", exact: true }).click();
  await saved(page);
  await page.locator("#clip-traveling-photo").click();
  await page
    .getByRole("button", {
      name: "Set photo duration to 5 seconds",
      exact: true,
    })
    .click();
  await saved(page);
  let edited = await composition(request);
  const beforeAssets = await assets(request);
  const beforeIds = beforeAssets.map((asset) => asset.id).sort();

  expect(
    (await request.post(`${base}/api/project/close`, { data: {} })).ok(),
  ).toBe(true);
  await rename(fixture.media, fixture.movedMedia);
  await rename(fixture.project, fixture.movedProject);
  await page.goto("/");
  await openProject(page, fixture.movedProject);
  // Source availability is transient. Moving either folder must not remove
  // assets, cached thumbnails, story selections or the edited timeline.
  await expect(page.getByText(/files are offline/i).first()).toBeVisible();
  await expect(page.getByText(/offline/i).first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".contact-sheet img")
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  expect((await assets(request)).map((asset) => asset.id).sort()).toEqual(
    beforeIds,
  );
  expect(await composition(request)).toEqual(edited);

  await navigate(page, "edit");
  await saved(page);
  await page.locator("#clip-traveling-photo").click();
  await expect(page.getByLabel("Photo duration", { exact: true })).toHaveValue(
    "5",
  );
  await field(page, "Photo duration", "4.5");
  await saved(page);
  edited = await composition(request);
  expect(
    edited.tracks[0]!.clips.find((clip) => clip.id === "traveling-photo")!
      .timelineDuration,
  ).toBe(4.5);
  await navigate(page, "library");

  const impostors = join(fixture.root, "impostors");
  await mkdir(impostors);
  const wrongVideo = Buffer.from(fixture.originals.get("04-motion.mp4")!);
  wrongVideo[wrongVideo.length - 1] = wrongVideo[wrongVideo.length - 1]! ^ 1;
  const wrongPath = join(impostors, "04-motion.mp4");
  await writeFile(wrongPath, wrongVideo);
  await page
    .getByRole("button", { name: "Inspect 04-motion.mp4", exact: true })
    .click();
  await page.getByRole("button", { name: "Find File", exact: true }).click();
  const relink = page.getByRole("region", {
    name: "Find missing media",
    exact: true,
  });
  await relink.getByRole("button", { name: "Find File", exact: true }).click();
  await relink
    .getByLabel("Media to reconnect", { exact: true })
    .selectOption(fixture.motion.id);
  await relink
    .getByLabel("Replacement file path", { exact: true })
    .fill(wrongPath);
  await relink
    .getByRole("button", { name: "Find matches", exact: true })
    .click();
  await relink.getByText("Matching details", { exact: true }).first().click();
  await expect(relink.getByText(/hash|fingerprint/i).first()).toBeVisible();
  await expect(
    relink.getByRole("button", { name: "Apply selected matches", exact: true }),
  ).toBeDisabled();
  expect(
    (await assets(request)).find((asset) => asset.id === fixture.motion.id)!
      .uri,
  ).toBe(fixture.motion.uri);

  const movedVideo = join(fixture.movedMedia, "04-motion.mp4");
  await relink
    .getByLabel("Replacement file path", { exact: true })
    .fill(movedVideo);
  await relink
    .getByRole("button", { name: "Find matches", exact: true })
    .click();
  await expect(
    relink.getByRole("radio", {
      name: `Use ${movedVideo} for 04-motion.mp4`,
      exact: true,
    }),
  ).toBeChecked();
  await relink
    .getByRole("button", { name: "Apply selected matches", exact: true })
    .click();
  await expect(
    relink.getByText("One file reconnected.", { exact: true }),
  ).toBeVisible();
  await relink
    .getByRole("button", { name: "Close find missing media", exact: true })
    .click();
  await expect(relink).not.toBeVisible();
  const detailClose = page.getByRole("button", {
    name: "Close media details",
    exact: true,
  });
  if (await detailClose.isVisible()) await detailClose.click();
  await navigate(page, "edit");
  await saved(page);
  await page.locator("#clip-traveling-motion").click();
  const source = page.getByLabel("Selected clip source preview", {
    exact: true,
  });
  await expect
    .poll(() =>
      source.evaluate((video) => (video as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Play clip", exact: true }).click();
  await expect
    .poll(() =>
      source.evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0.25);
  await source.evaluate((video) => (video as HTMLVideoElement).pause());
  expect(await composition(request)).toEqual(edited);

  await navigate(page, "library");
  await page.getByRole("button", { name: "Relink Media", exact: true }).click();
  await relink
    .getByRole("button", { name: "Find Folder", exact: true })
    .click();
  await relink
    .getByLabel("Search folder path", { exact: true })
    .fill(fixture.movedMedia);
  await relink
    .getByRole("button", { name: "Find matches", exact: true })
    .click();
  await expect(
    relink.getByRole("button", { name: "Apply selected matches", exact: true }),
  ).toBeEnabled();
  await relink
    .getByRole("button", { name: "Apply selected matches", exact: true })
    .click();
  await expect(relink.getByText(/files reconnected/)).toBeVisible();
  await relink
    .getByRole("button", { name: "Close find missing media", exact: true })
    .click();
  await expect(relink).not.toBeVisible();
  const status = await (await request.get(`${base}/api/media/status`)).json();
  expect(
    status.assets.map((asset: { status: string }) => asset.status),
  ).toEqual(["available", "available", "available", "available"]);
  expect(
    status.libraries.every(
      (library: { status: string }) => library.status === "online",
    ),
  ).toBe(true);
  const relinked = await assets(request);
  expect(relinked.map((asset) => asset.id).sort()).toEqual(beforeIds);
  expect(relinked.find((asset) => asset.id === fixture.photo.id)).toMatchObject(
    {
      rating: 4,
      state: { favorite: true, locked: true },
      metadata: { "openfilm.test.note": "Keep this memory" },
    },
  );
  for (const asset of relinked) {
    const original = beforeAssets.find((item) => item.id === asset.id)!;
    expect(asset.metadata["openfilm.reference"]).toMatchObject({
      originalUri: original.uri,
    });
    expect(fileURLToPath(asset.uri)).toBe(join(fixture.movedMedia, asset.name));
  }
  expect(await composition(request)).toEqual(edited);
  await page.screenshot({
    path: test.info().outputPath("relinked-library.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Add media", exact: true }).click();
  await chooseImportFolder(page, fixture.movedMedia);
  await expect(page.getByText("Import complete", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const reimported = await assets(request);
  expect(reimported.map((asset) => asset.id).sort()).toEqual(beforeIds);
  expect(await composition(request)).toEqual(edited);
  for (const name of fixture.names)
    expect(await readFile(join(fixture.movedMedia, name))).toEqual(
      fixture.originals.get(name),
    );
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  await openProject(page, fixture.movedProject);
  expect((await assets(request)).map((asset) => asset.id).sort()).toEqual(
    beforeIds,
  );
  expect(await composition(request)).toEqual(edited);
});
