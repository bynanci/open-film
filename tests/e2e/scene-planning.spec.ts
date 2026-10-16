import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
  OpenFilmProject,
  ProjectContentLocale,
  Story,
} from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
const cleanup: Array<() => Promise<void>> = [];
const authoredTitle = "那些平凡而重要的日子 / ふたりの大切な日々";
const reviewedNarration = "那一天，我們決定慢慢走。\nThese are our own words.";
const reviewedDirection = "先停留在照片，再接現場聲音；不要猜測照片中的人物。";

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
});
test.afterEach(async ({ request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
});
test.afterAll(async () => {
  await Promise.all(cleanup.map((action) => action()));
});

async function project(request: APIRequestContext): Promise<OpenFilmProject> {
  const response = await request.get(`${api}/project`);
  expect(response.ok()).toBe(true);
  return (await response.json()).project;
}

async function assets(request: APIRequestContext): Promise<MediaAsset[]> {
  const response = await request.get(`${api}/assets?limit=100`);
  expect(response.ok()).toBe(true);
  return (await response.json()).assets;
}

function timing(composition: Composition) {
  // Acceptance gets a receipt identity for the reviewed text. Compare the
  // actual selected sources, trims and transitions independently of that ID.
  return {
    storyId: composition.storyId,
    duration: composition.duration,
    tracks: composition.tracks.map((track) => ({
      type: track.type,
      clips: track.clips.map(({ id: _id, ...clip }) => clip),
    })),
  };
}

async function createSourceFilm(
  request: APIRequestContext,
  locale: ProjectContentLocale,
) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Memories worth keeping / 思い出",
    {
      projectContentLocale: locale,
      filmSettings: {
        templateId: "blank",
        targetDuration: 10,
        maxDuration: 12,
      },
    },
  );
  let photo!: MediaAsset;
  let video!: MediaAsset;
  let evening!: MediaAsset;
  try {
    const imported = await app.importFolder(fixture.media);
    expect(imported.imported).toBe(5);
    expect(imported.failed).toBe(1);
    const importedAssets = app.catalog.listAssets({ limit: 100 });
    photo = importedAssets.find((asset) => asset.name === "01-photo.png")!;
    video = importedAssets.find((asset) => asset.name === "04-motion.mp4")!;
    evening = importedAssets.find((asset) => asset.name === "03-evening.png")!;
    for (const asset of [photo, evening])
      app.catalog.updateAsset(asset.id, {
        state: { favorite: true },
        tags: asset.id === photo.id ? ["出發 / Departure"] : ["回家 / Home"],
      });
    app.catalog.updateAsset(video.id, {
      state: { locked: true },
      tags: ["路上 / On the way"],
    });
    const duplicate = importedAssets.find(
      (asset) => asset.name === "02-photo-copy.png",
    )!;
    app.catalog.updateAsset(duplicate.id, { state: { rejected: true } });
    app.project.settings = { width: 320, height: 180, frameRate: 24 };
    app.project.stories.push({
      id: "already-authored-story",
      title: "Keep this film exactly",
      targetDuration: 4.5,
      maxDuration: 6,
      beats: [
        {
          id: "already-authored-beat",
          title: "A deliberate cut",
          candidateAssetIds: [photo.id, video.id],
          selectedAssetIds: [photo.id, video.id],
        },
      ],
    });
    app.project.timelines.push({
      id: "already-authored-film",
      storyId: "already-authored-story",
      duration: 4.5,
      tracks: [
        {
          id: "already-authored-track",
          type: "video",
          clips: [
            {
              id: "already-authored-photo",
              assetId: photo.id,
              beatId: "already-authored-beat",
              timelineStart: 0,
              timelineDuration: 2,
            },
            {
              id: "already-authored-video",
              assetId: video.id,
              beatId: "already-authored-beat",
              timelineStart: 2,
              timelineDuration: 2.5,
              sourceIn: 0.25,
              sourceOut: 2.75,
              transform: { volume: 0.35 },
              locked: true,
            },
          ],
        },
      ],
    });
    await app.save();
  } finally {
    app.close();
  }
  expect(
    (
      await request.post(`${api}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  return { ...fixture, photo, video, evening };
}

async function planner(page: Page, locale: ProjectContentLocale) {
  await navigate(page, "story", locale);
  await page.getByTestId("scene-planner-toggle").click();
  await expect(page.getByTestId("scene-planner")).toBeVisible();
  await page.getByTestId("scene-plan-title").fill(authoredTitle);
  await page
    .getByTestId("scene-plan-brief")
    .fill("記錄一起出發與回家的心情。Use only the supplied categories.");
  await page.getByTestId("scene-plan-grouping").selectOption("category");
  await page.getByTestId("scene-plan-target").fill("10");
  await page.getByTestId("scene-plan-maximum").fill("12");
  await page.getByTestId("scene-plan-transition").selectOption("crossfade");
}

async function preview(page: Page) {
  const response = page.waitForResponse(
    (entry) => new URL(entry.url()).pathname === "/api/story-plans/preview",
  );
  await page.getByTestId("scene-plan-preview").click();
  const received = await response;
  expect(received.ok(), await received.text()).toBe(true);
  const { plan } = (await received.json()) as {
    plan: { story: Story; composition: Composition; sourceAssetIds: string[] };
  };
  await expect(page.getByTestId("scene-plan-result")).toBeVisible();
  await expect(page.getByTestId("scene-plan-accept")).toBeEnabled();
  await expect(page.getByTestId("scene-plan-scene")).not.toHaveCount(0);
  await expect(page.getByTestId("scene-plan-duration")).toHaveAttribute(
    "data-duration",
    String(plan.composition.duration),
  );
  await expect(page.getByTestId("scene-plan-duration")).toHaveAttribute(
    "data-maximum",
    String(plan.story.maxDuration),
  );
  expect(plan.composition.duration).toBeGreaterThan(0);
  expect(plan.composition.duration).toBeLessThanOrEqual(
    plan.story.maxDuration!,
  );
  return plan;
}

async function saved(page: Page, locale: ProjectContentLocale) {
  await expect(page.locator(".editor-save-state")).toHaveText(
    uiText(locale, "editor.save.saved"),
  );
}

async function layout(page: Page, name: string) {
  const problems = await page.evaluate(() => {
    const issues: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth + 2)
      issues.push(
        `Page exceeds viewport: ${document.documentElement.scrollWidth}`,
      );
    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="scene-planner"] button, [data-testid="scene-planner"] h2, [data-testid="scene-planner"] h3, [data-testid="scene-planner"] label',
      ),
    )) {
      if (!element.getClientRects().length) continue;
      const bounds = element.getBoundingClientRect();
      if (bounds.left < -2 || bounds.right > innerWidth + 2)
        issues.push(`Outside viewport: ${element.textContent?.trim()}`);
      if (element.scrollWidth > element.clientWidth + 3)
        issues.push(`Clipped label: ${element.textContent?.trim()}`);
    }
    return issues;
  });
  expect(problems, name).toEqual([]);
  expect(await page.getByTestId("scene-planner").innerText()).not.toMatch(
    /\b(?:scenePlan|app|editor|media)\.[a-zA-Z][\w.]+\b|\bundefined\b/u,
  );
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

test("reviews categorized memories as a bounded film, preserves existing edits, and reopens authored scripts", async ({
  page,
  request,
}) => {
  const locale = "zh-TW";
  const fixture = await createSourceFilm(request, locale);
  const before = await project(request);
  await initialLocale(page, locale);
  await page.goto("/");
  await page
    .getByRole("button", {
      name: uiText(locale, "media.card.inspect", { name: fixture.photo.name }),
      exact: true,
    })
    .click();
  await page
    .getByTestId("category-tags")
    .fill("出發 / Departure, 旅行 / Travel");
  await page.getByTestId("save-category-tags").click();
  await expect
    .poll(
      async () =>
        (await assets(request)).find((asset) => asset.id === fixture.photo.id)!
          .tags,
    )
    .toEqual(["出發 / Departure", "旅行 / Travel"]);
  await page
    .getByRole("button", {
      name: uiText(locale, "app.inspector.close"),
      exact: true,
    })
    .click();
  await page
    .locator(".library-sidebar")
    .getByRole("button", {
      name: uiText(locale, "app.library.favorite"),
      exact: true,
    })
    .click();
  await expect(page.locator(".asset-card")).toHaveCount(2);
  await planner(page, locale);
  await page.getByTestId("scene-plan-scope").selectOption("page");
  const plan = await preview(page);
  expect(plan.sourceAssetIds).toContain(fixture.video.id);
  const previewClips = plan.composition.tracks.flatMap((track) => track.clips);
  expect(previewClips.some((clip) => clip.assetId === fixture.video.id)).toBe(
    true,
  );
  expect(
    previewClips.some((clip) => clip.transition?.type === "crossfade"),
  ).toBe(true);
  // Preview must not persist even when another edited, locked film already exists.
  expect(await project(request)).toEqual(before);
  await expect(page.getByTestId("scene-plan-scene")).toHaveCount(3);
  const firstScene = page.getByTestId("scene-plan-scene").first();
  await firstScene
    .getByTestId("scene-plan-scene-narration")
    .fill(reviewedNarration);
  await firstScene
    .getByTestId("scene-plan-scene-visual-direction")
    .fill(reviewedDirection);
  await layout(page, "zh-TW-scene-plan-1440x900");
  await page.getByTestId("scene-plan-accept").click();
  await expect
    .poll(async () => (await project(request)).stories.length)
    .toBe(2);
  const accepted = await project(request);
  const story = accepted.stories.find(
    (entry) => entry.id !== "already-authored-story",
  )!;
  expect(story.title).toBe(authoredTitle);
  expect(story.targetDuration).toBe(10);
  expect(story.maxDuration).toBe(12);
  expect(story.beats[0]!.script).toMatchObject({
    narration: reviewedNarration,
    visualDirection: reviewedDirection,
  });
  expect(accepted.stories[0]).toEqual(before.stories[0]);
  expect(
    accepted.timelines.find((film) => film.id === "already-authored-film"),
  ).toEqual(before.timelines[0]);
  expect(timing(accepted.timelines.at(-1)!)).toEqual(timing(plan.composition));
  await navigate(page, "edit", locale);
  await saved(page, locale);
  await page
    .getByRole("button", {
      name: uiText(locale, "app.composition.render"),
      exact: true,
    })
    .click();
  const rendered = page.getByLabel(uiText(locale, "app.composition.preview"), {
    exact: true,
  });
  await expect(rendered).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() =>
      rendered.evaluate((node) => (node as HTMLVideoElement).duration),
    )
    .toBeCloseTo(plan.composition.duration, 1);
  expect((await project(request)).timelines).toEqual(accepted.timelines);

  await navigate(page, "story", locale);
  await page
    .getByLabel(uiText(locale, "app.story.active"), { exact: true })
    .selectOption(story.id);
  const editedNarration =
    "我們一起把平凡的日子，編成自己的故事。\nA user-authored revision.";
  await page.getByTestId("beat-script-narration").fill(editedNarration);
  await page
    .getByTestId("beat-script-visual-direction")
    .fill("保留長鏡頭的呼吸感；以原音結束。");
  await page
    .getByRole("button", {
      name: uiText(locale, "app.story.saveBeat"),
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        (await project(request)).stories.find((entry) => entry.id === story.id)!
          .beats[0]!.script!.narration,
    )
    .toBe(editedNarration);
  await page
    .getByRole("button", {
      name: uiText(locale, "app.story.compose"),
      exact: true,
    })
    .click();
  await saved(page, locale);
  const composed = await project(request);
  const film = composed.timelines.at(-1)!;
  expect(film.storyId).toBe(story.id);
  expect(film.duration).toBeGreaterThan(0);
  expect(film.duration).toBeLessThanOrEqual(12);
  const clips = film.tracks.flatMap((track) => track.clips);
  expect(clips.some((clip) => clip.assetId === fixture.video.id)).toBe(true);
  expect(clips.some((clip) => clip.assetId === fixture.photo.id)).toBe(true);
  expect(clips.some((clip) => clip.assetId === fixture.evening.id)).toBe(true);
  expect(
    (await assets(request)).find((asset) => asset.id === fixture.video.id)!
      .state.locked,
  ).toBe(true);
  expect(
    composed.timelines.find((entry) => entry.id === "already-authored-film"),
  ).toEqual(before.timelines[0]);
  await page.reload();
  await navigate(page, "edit", locale);
  await saved(page, locale);
  expect((await project(request)).timelines).toEqual(composed.timelines);
  await page
    .getByRole("button", {
      name: uiText(locale, "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await openFilm(page, fixture.project, locale);
  await navigate(page, "story", locale);
  await page
    .getByLabel(uiText(locale, "app.story.active"), { exact: true })
    .selectOption(story.id);
  await expect(page.getByTestId("beat-script-narration")).toHaveValue(
    editedNarration,
  );
  await expect(page.getByTestId("beat-script-visual-direction")).toHaveValue(
    "保留長鏡頭的呼吸感；以原音結束。",
  );
  const fileBeforeLocale = await readFile(
    join(fixture.project, "project.json"),
    "utf8",
  );
  await page.locator(".ui-language select").selectOption("ja-JP");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja-JP");
  await expect(page.getByTestId("beat-script-narration")).toHaveValue(
    editedNarration,
  );
  expect(await readFile(join(fixture.project, "project.json"), "utf8")).toBe(
    fileBeforeLocale,
  );
  expect((await project(request)).stories).toEqual(composed.stories);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("a changed category rejects the stale plan without losing reviewed script or touching an existing film", async ({
  page,
  request,
}) => {
  const fixture = await createSourceFilm(request, "en-US");
  const before = await project(request);
  await initialLocale(page);
  await page.goto("/");
  await planner(page, "en-US");
  await preview(page);
  const narration = page.getByTestId("scene-plan-scene-narration").first();
  await narration.fill(reviewedNarration);
  expect(
    (
      await request.patch(`${api}/assets/${fixture.photo.id}`, {
        data: { tags: ["A newer category / 新分類"] },
      })
    ).ok(),
  ).toBe(true);
  const rejection = page.waitForResponse(
    (entry) => new URL(entry.url()).pathname === "/api/story-plans/accept",
  );
  await page.getByTestId("scene-plan-accept").click();
  expect((await rejection).status()).toBe(409);
  await expect(page.getByTestId("scene-plan-error")).toBeVisible();
  await expect(narration).toHaveValue(reviewedNarration);
  await expect(page.getByTestId("scene-plan-result")).toBeVisible();
  expect(await project(request)).toEqual(before);
  await layout(page, "en-US-stale-reviewed-plan-1440x900");
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("accepting a scene plan blocks edits to the old story until its acknowledgement arrives", async ({
  page,
  request,
}) => {
  const fixture = await createSourceFilm(request, "en-US");
  const initial = await project(request);
  const oldStory = initial.stories[0]!;
  const initialBeat = oldStory.beats[0]!;
  const beats = [
    {
      ...initialBeat,
      intent: "An intention already chosen by the author.",
      targetDuration: 4.5,
      candidateAssetIds: [
        fixture.photo.id,
        fixture.video.id,
        fixture.evening.id,
      ],
      script: {
        narration: "The old film's narration must remain safe.",
        visualDirection: "Keep the deliberate trim and the original sound.",
      },
    },
    {
      id: "another-existing-beat",
      title: "An existing second scene",
      candidateAssetIds: [fixture.evening.id],
      selectedAssetIds: [],
    },
  ];
  expect(
    (
      await request.patch(`${api}/stories/${oldStory.id}`, { data: { beats } })
    ).ok(),
  ).toBe(true);
  const before = await project(request);
  await initialLocale(page);
  await page.goto("/");
  await planner(page, "en-US");
  await preview(page);

  const editor = page.locator(".beat-editor");
  const fields = [
    editor.getByLabel(uiText("en-US", "app.story.beatTitle"), { exact: true }),
    editor.getByLabel(uiText("en-US", "app.story.beatDuration"), {
      exact: true,
    }),
    editor.getByLabel(uiText("en-US", "app.story.beatIntent"), { exact: true }),
    editor.getByTestId("beat-script-narration"),
    editor.getByTestId("beat-script-visual-direction"),
  ];
  const previousValues = await Promise.all(
    fields.map((field) => field.inputValue()),
  );
  await expect(page.locator(".beat-list button")).toHaveCount(2);
  const choices = editor.locator(".asset-image-button");
  await expect(choices).toHaveCount(3);
  const previousChoices = await choices.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-pressed")),
  );
  let release!: () => void;
  const acknowledgement = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed = false;
  const acceptPath = "**/api/story-plans/accept";
  await page.route(acceptPath, async (route) => {
    // Commit the real request; only the server acknowledgement is delayed.
    // This is the interval in which the old editable beat was being discarded.
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed = true;
    await acknowledgement;
    await route.fulfill({ response });
  });
  try {
    await page.getByTestId("scene-plan-accept").click();
    await expect.poll(() => committed).toBe(true);
    await expect(page.getByTestId("scene-plan-accept")).toBeDisabled();
    for (const field of fields) await expect(field).toBeDisabled();
    for (const button of await page.locator(".beat-list button").all())
      await expect(button).toBeDisabled();
    for (const button of await choices.all())
      await expect(button).toBeDisabled();
    await expect(
      page.getByLabel(uiText("en-US", "app.story.active"), { exact: true }),
    ).toBeDisabled();
    expect(
      await Promise.all(fields.map((field) => field.inputValue())),
    ).toEqual(previousValues);
    expect(
      await choices.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-pressed")),
      ),
    ).toEqual(previousChoices);
    expect(
      (await project(request)).stories.find(
        (story) => story.id === oldStory.id,
      ),
    ).toEqual(before.stories[0]);

    release();
    await expect(page.getByTestId("scene-plan-accepted")).toBeVisible();
    const accepted = await project(request);
    expect(accepted.stories).toHaveLength(2);
    expect(accepted.stories.find((story) => story.id === oldStory.id)).toEqual(
      before.stories[0],
    );
    expect(
      accepted.timelines.find((film) => film.id === "already-authored-film"),
    ).toEqual(before.timelines[0]);
    await page
      .getByLabel(uiText("en-US", "app.story.active"), { exact: true })
      .selectOption(oldStory.id);
    for (const [index, field] of fields.entries()) {
      await expect(field).toBeEnabled();
      await expect(field).toHaveValue(previousValues[index]!);
    }
    expect(await fixture.assertOriginalsUnchanged()).toBe(true);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

for (const [locale, viewport] of [
  ["en-US", { width: 1280, height: 720 }],
  ["ja-JP", { width: 1920, height: 1080 }],
] as const) {
  test(`${locale} scene planning stays localized and readable before explicit acceptance`, async ({
    page,
    request,
  }) => {
    const fixture = await createSourceFilm(request, locale);
    const before = await project(request);
    const missingTranslations: string[] = [];
    page.on("console", (entry) => {
      if (/Missing translation|Not found.*key/u.test(entry.text()))
        missingTranslations.push(entry.text());
    });
    await initialLocale(page, locale);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await planner(page, locale);
    await preview(page);
    await layout(
      page,
      `${locale}-scene-plan-${viewport.width}x${viewport.height}`,
    );
    expect(await project(request)).toEqual(before);
    if (locale === "en-US") {
      const beforeDraft = await page
        .getByTestId("scene-plan-scene-narration")
        .first()
        .inputValue();
      expect(
        await page.evaluate(async () => {
          const path = "/src/i18n/index.ts";
          const { setUiLocale, uiLocale } = await import(path);
          setUiLocale("en-XA");
          return uiLocale.value;
        }),
      ).toBe("en-XA");
      await expect(
        page.getByTestId("scene-plan-scene-narration").first(),
      ).toHaveValue(beforeDraft);
      await layout(page, "en-XA-scene-plan-1280x720");
      expect(await project(request)).toEqual(before);
    }
    expect(missingTranslations).toEqual([]);
    expect(await fixture.assertOriginalsUnchanged()).toBe(true);
  });
}
