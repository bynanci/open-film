import { createHash } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
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
import type { MediaAsset, OpenFilmProject, Story } from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310/api";
let root: string;
let source: string;
let sourceHash: string;

test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-review-browser-"));
  source = join(root, "generated.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=teal:s=96x64",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    source,
  ]);
  sourceHash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex");
});
test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  await initialLocale(page);
});
test.afterEach(async ({ request }) => {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
});
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function prepareProject(
  name: string,
  count: number,
  story?: Story,
  legacy = false,
) {
  const directory = join(root, name);
  const media = join(directory, "media");
  const path = join(directory, `${name}.openfilm`);
  await mkdir(media, { recursive: true });
  const app = await OpenFilmApplication.create(path, name);
  const assets: MediaAsset[] = [];
  try {
    await mkdir(join(path, "cache", "thumbnails"), { recursive: true });
    await copyFile(source, join(path, "cache", "thumbnails", "generated.png"));
    for (let index = 0; index < count; index++) {
      const suffix = String(index).padStart(3, "0");
      const name = `memory-${suffix}.png`;
      await link(source, join(media, name));
      const asset: MediaAsset = {
        id: `asset-${suffix}`,
        uri: pathToFileURL(join(media, name)).href,
        mediaType: "image",
        name,
        dimensions: { width: 96, height: 64 },
        capturedAt: new Date(Date.UTC(2024, 0, 1, 0, index)).toISOString(),
        contentHash: sourceHash,
        thumbnailUri: "cache/thumbnails/generated.png",
        tags: [],
        state: { locked: false, favorite: false },
        metadata: {},
      };
      app.catalog.upsertAsset(asset);
      assets.push(asset);
    }
    app.project.mediaLibraries.push({
      id: "library",
      uri: pathToFileURL(media).href,
      name: "Generated memories",
    });
    if (story) app.project.stories.push(story);
    if (legacy) {
      delete app.project.projectContentLocale;
      delete app.project.filmSettings;
    }
    await app.save();
  } finally {
    app.close();
  }
  return { path, media, directory, assets };
}
async function project(request: APIRequestContext): Promise<OpenFilmProject> {
  const response = await request.get(`${base}/project`);
  expect(response.ok()).toBe(true);
  return (await response.json()).project;
}
async function reopen(page: Page, path: string) {
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  await openFilm(page, path);
}

test("reopens a beat with 305 selected memories using bounded catalog requests", async ({
  page,
  request,
}) => {
  const ids = Array.from(
    { length: 305 },
    (_, index) => `asset-${String(index).padStart(3, "0")}`,
  );
  const story: Story = {
    id: "many-selected",
    title: "All of these moments",
    template: "blank",
    targetDuration: 915,
    maxDuration: 1000,
    beats: [
      {
        id: "selected-beat",
        title: "A large selection",
        targetDuration: 915,
        candidateAssetIds: ids,
        selectedAssetIds: ids,
      },
    ],
  };
  const fixture = await prepareProject("Many selected", ids.length, story);
  const failures: number[] = [];
  const requestedBatches: string[][] = [];
  page.on("request", (entry) => {
    const url = new URL(entry.url());
    if (url.pathname === "/api/assets" && url.searchParams.has("ids"))
      requestedBatches.push(url.searchParams.get("ids")!.split(","));
  });
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname === "/api/assets" &&
      response.status() >= 400
    )
      failures.push(response.status());
  });
  await page.goto("/");
  await openFilm(page, fixture.path);
  await navigate(page, "story");
  const selected = page.getByRole("region", {
    name: "Must include",
    exact: true,
  });
  await expect(selected.locator(".asset-card")).toHaveCount(305);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(requestedBatches.length).toBeGreaterThanOrEqual(2);
  expect(requestedBatches.every((batch) => batch.length <= 200)).toBe(true);
  expect(failures).toEqual([]);
  expect(
    (await project(request)).stories[0]!.beats[0]!.selectedAssetIds,
  ).toEqual(ids);
  await selected
    .getByRole("button", { name: "Remove memory-304.png", exact: true })
    .click();
  await page.getByRole("button", { name: "Save beat", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await project(request)).stories[0]!.beats[0]!.selectedAssetIds?.length,
    )
    .toBe(304);
  expect(
    (await project(request)).stories[0]!.beats[0]!.selectedAssetIds,
  ).toEqual(ids.slice(0, -1));
  await reopen(page, fixture.path);
  await navigate(page, "story");
  await expect(selected.locator(".asset-card")).toHaveCount(304);
  await page.getByRole("button", { name: "Compose film", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Composition timeline", exact: true })
      .getByRole("status")
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Switch project", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const composition = (await project(request)).timelines.at(-1)!;
  const included = new Set(
    composition.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.assetId),
    ),
  );
  expect(ids.slice(0, -1).every((id) => included.has(id))).toBe(true);
  expect(composition.duration).toBeGreaterThan(0);
  expect(composition.duration).toBeLessThanOrEqual(1000);
  expect(failures).toEqual([]);
  expect(requestedBatches.every((batch) => batch.length <= 200)).toBe(true);
});

test("refreshes the Missing view after source recovery and relink while clamping a stale page", async ({
  page,
  request,
}) => {
  const fixture = await prepareProject("Missing collection", 121);
  const offline = join(fixture.directory, "moved media");
  await rename(fixture.media, offline);
  await mkdir(fixture.media);
  await page.goto("/");
  await openFilm(page, fixture.path);
  const availability = page.getByRole("region", {
    name: "Media availability",
    exact: true,
  });
  await expect(availability).toContainText("121 files are offline");
  const missing = page
    .getByRole("navigation", { name: "Library view", exact: true })
    .getByRole("button", { name: /^Missing\b/ });
  await missing.click();
  const cards = page.locator(".contact-sheet .asset-card");
  await expect(cards).toHaveCount(60);
  const pagination = page.locator(".library-main .pagination");
  await pagination.getByRole("button", { name: "Next", exact: true }).click();
  await expect(pagination).toContainText("61–120 of 121 memories");
  await pagination.getByRole("button", { name: "Next", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(
    cards.getByRole("button", { name: "Inspect memory-120.png", exact: true }),
  ).toBeVisible();

  await rename(
    join(offline, "memory-120.png"),
    join(fixture.media, "memory-120.png"),
  );
  await availability
    .getByRole("button", { name: "Check again", exact: true })
    .click();
  await expect(availability).toContainText("120 files are offline");
  await expect(cards).toHaveCount(60);
  await expect(pagination).toContainText("61–120 of 120 memories");
  await expect(
    cards.getByRole("button", { name: "Inspect memory-120.png", exact: true }),
  ).toHaveCount(0);
  await expect(
    pagination.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();

  await cards
    .getByRole("button", { name: "Inspect memory-119.png", exact: true })
    .click();
  await page.getByRole("button", { name: "Find File", exact: true }).click();
  const relink = page.getByRole("region", {
    name: "Find missing media",
    exact: true,
  });
  await relink.getByRole("button", { name: "Find File", exact: true }).click();
  await relink
    .getByLabel("Replacement file path", { exact: true })
    .fill(join(offline, "memory-119.png"));
  await relink
    .getByRole("button", { name: "Find matches", exact: true })
    .click();
  await expect(
    relink.getByRole("button", { name: "Apply selected matches", exact: true }),
  ).toBeEnabled();
  await relink
    .getByRole("button", { name: "Apply selected matches", exact: true })
    .click();
  await expect(
    relink.getByText("One file reconnected.", { exact: true }),
  ).toBeVisible();
  await relink
    .getByRole("button", { name: "Close find missing media", exact: true })
    .click();
  await expect(availability).toContainText("119 files are offline");
  await expect(missing).toHaveAttribute("aria-current", "page");
  await expect(cards).toHaveCount(59);
  await expect(
    cards.getByRole("button", { name: "Inspect memory-119.png", exact: true }),
  ).toHaveCount(0);
  await expect(pagination).toContainText("61–119 of 119 memories");
  const reconnected = await request.get(`${base}/assets?ids=asset-119&limit=1`);
  expect((await reconnected.json()).assets[0].uri).toBe(
    pathToFileURL(join(offline, "memory-119.png")).href,
  );

  // Keep a genuine pre-edit GET response pending while a newer user write lands.
  // Releasing the stale snapshot must not replace the acknowledged lock, nor
  // cause the next favorite operation to write the old unlocked state back.
  let releaseAssets!: () => void;
  const assetsGate = new Promise<void>((resolve) => {
    releaseAssets = resolve;
  });
  let snapshotReady!: (value: { assets: MediaAsset[] }) => void;
  const staleSnapshot = new Promise<{ assets: MediaAsset[] }>((resolve) => {
    snapshotReady = resolve;
  });
  await page.route(
    (url) => url.pathname === "/api/assets",
    async (route) => {
      const response = await route.fetch();
      snapshotReady(await response.json());
      await assetsGate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await availability
    .getByRole("button", { name: "Check again", exact: true })
    .click();
  try {
    const snapshot = await staleSnapshot;
    expect(
      snapshot.assets.find((asset) => asset.id === "asset-118")!.state.locked,
    ).toBe(false);
    const locked = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/assets/asset-118" &&
        response.request().method() === "PATCH",
    );
    await cards
      .getByRole("button", { name: "Lock memory-118.png", exact: true })
      .click();
    const response = await locked;
    expect(response.ok()).toBe(true);
    expect((await response.json()).asset.state.locked).toBe(true);
    await expect(
      cards.getByRole("button", { name: "Unlock memory-118.png", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    releaseAssets();
  }
  await expect(
    availability.getByRole("button", { name: "Check again", exact: true }),
  ).toBeEnabled();
  await expect(
    cards.getByRole("button", { name: "Unlock memory-118.png", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const favored = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/assets/asset-118" &&
      response.request().method() === "PATCH",
  );
  await cards
    .getByRole("button", { name: "Favorite memory-118.png", exact: true })
    .click();
  const favoriteResponse = await favored;
  expect(favoriteResponse.ok()).toBe(true);
  expect(favoriteResponse.request().postDataJSON().state).toEqual({
    favorite: true,
  });
  expect((await favoriteResponse.json()).asset.state).toMatchObject({
    favorite: true,
    locked: true,
  });
  await expect(
    cards.getByRole("button", { name: "Unlock memory-118.png", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const persistedFlags = await request.get(
    `${base}/assets?ids=asset-118&limit=1`,
  );
  expect((await persistedFlags.json()).assets[0].state).toMatchObject({
    favorite: true,
    locked: true,
  });

  for (const name of await readdir(offline)) {
    if (name !== "memory-119.png")
      await rename(join(offline, name), join(fixture.media, name));
  }
  await availability
    .getByRole("button", { name: "Check again", exact: true })
    .click();
  await expect(cards).toHaveCount(0);
  await expect(
    page
      .locator(".library-empty")
      .getByRole("heading", { name: "All media available", exact: true }),
  ).toBeVisible();
  await expect(pagination).toHaveCount(0);
  await expect(missing).toHaveAttribute("aria-current", "page");
  const statuses = await (await request.get(`${base}/media/status`)).json();
  expect(statuses.assets).toHaveLength(121);
  expect(
    statuses.assets.every(
      (asset: { status: string }) => asset.status === "available",
    ),
  ).toBe(true);
  expect(
    createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
  ).toBe(sourceHash);
});

test("offers the English-default film language for a legacy project without renaming existing text", async ({
  page,
  request,
}) => {
  const story: Story = {
    id: "legacy-story",
    title: "My existing story / 原來的故事",
    template: "proposal-film",
    targetDuration: 4,
    maxDuration: 8,
    beats: [
      {
        id: "legacy-beat",
        title: "Cold Open",
        intent: "Words I already wrote / 私の言葉",
        templateBeatKey: "proposal.coldOpen",
        targetDuration: 4,
        candidateAssetIds: ["asset-000"],
      },
    ],
  };
  const fixture = await prepareProject("Legacy film", 1, story, true);
  const before = JSON.parse(
    await readFile(join(fixture.path, "project.json"), "utf8"),
  ) as OpenFilmProject;
  expect(before.projectContentLocale).toBeUndefined();
  expect(before.stories[0]!.beats[0]!.titleSource).toBeUndefined();
  await page.goto("/");
  await openFilm(page, fixture.path);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const locale = settings.getByLabel(
    uiText("en-US", "app.settings.currentFilmLanguage"),
  );
  await expect(locale).toBeVisible();
  await expect(locale).toBeEnabled();
  await expect(locale).toHaveValue("en-US");
  await locale.selectOption("ja-JP");
  await expect
    .poll(async () => (await project(request)).projectContentLocale)
    .toBe("ja-JP");
  await expect(locale).toBeEnabled();
  await settings
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  expect((await project(request)).stories).toEqual(before.stories);
  await navigate(page, "story");
  await expect(page.getByLabel("Beat title", { exact: true })).toHaveValue(
    "Cold Open",
  );
  await expect(page.getByLabel("Beat intent", { exact: true })).toHaveValue(
    story.beats[0]!.intent!,
  );
  await reopen(page, fixture.path);
  expect((await project(request)).projectContentLocale).toBe("ja-JP");
  expect((await project(request)).stories).toEqual(before.stories);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    settings.getByLabel(uiText("en-US", "app.settings.currentFilmLanguage")),
  ).toHaveValue("ja-JP");
});
