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
  MediaAsset,
  OpenFilmProject,
  ProjectContentLocale,
  Story,
} from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

// This suite runs real media import, HTTP, jobs, persistence, and user decisions.
// Its explicitly installed language fixture produces predetermined text; these
// checks are not evidence of AI wording quality or rendered narration/motion.
const api = "http://127.0.0.1:4310/api";
const storyId = "authored-script-story";
const beatId = "authored-script-beat";
const narration = "  我們慢慢走向海邊。\nWe kept our own words.  ";
const visualDirection = "写真の余白を残す。Keep the quiet original sound.";
const marker = " [fixture script reviewed]";
const cleanup: Array<() => Promise<void>> = [];
type Field = "narration" | "visualDirection";
interface Suggestion {
  id: string;
  before: string;
  after: string;
  reason: string;
  status: string;
  sourceRevisionId: string;
  target: { storyId: string; beatId: string; field: Field };
}
interface Suggestions {
  suggestions: Suggestion[];
  total: number;
  revision: string;
}

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
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).project;
}
function authoredStory(value: OpenFilmProject): Story {
  return value.stories.find((entry) => entry.id === storyId)!;
}
async function suggestions(
  request: APIRequestContext,
  field: Field = "narration",
  status?: string,
): Promise<Suggestions> {
  const response = await request.get(
    `${api}/stories/${storyId}/script-review/suggestions?beatId=${beatId}&field=${field}&limit=100${status ? `&status=${status}` : ""}`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<Suggestions>;
}
async function assets(request: APIRequestContext): Promise<MediaAsset[]> {
  const response = await request.get(`${api}/assets?limit=100`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).assets;
}
async function sourceFilm(
  request: APIRequestContext,
  locale: ProjectContentLocale = "en-US",
) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Our authored film / 私たちの記憶",
    {
      projectContentLocale: locale,
      filmSettings: { templateId: "blank", targetDuration: 8, maxDuration: 10 },
    },
  );
  try {
    expect((await app.importFolder(fixture.media)).imported).toBe(5);
    const imported = app.catalog.listAssets({ limit: 100 });
    const photo = imported.find((asset) => asset.name === "01-photo.png")!;
    const video = imported.find((asset) => asset.name === "04-motion.mp4")!;
    app.catalog.updateAsset(video.id, { state: { locked: true } });
    app.project.settings = { width: 320, height: 180, frameRate: 24 };
    app.project.stories.push({
      id: storyId,
      title: "海辺まで / A deliberate journey",
      targetDuration: 8,
      maxDuration: 10,
      beats: [
        {
          id: beatId,
          title: "到着 / Arriving",
          intent: "Remember our arrival using only what we authored.",
          targetDuration: 4.5,
          minDuration: 3,
          maxDuration: 6,
          candidateAssetIds: [photo.id, video.id],
          selectedAssetIds: [photo.id, video.id],
          constraints: [{ type: "must-include", assetIds: [video.id] }],
          script: { narration, visualDirection },
        },
        {
          id: "another-authored-beat",
          title: "An unchanged second scene",
          targetDuration: 3.5,
          candidateAssetIds: [photo.id],
          selectedAssetIds: [photo.id],
          script: { narration: "Second-scene text.", visualDirection: "Hold." },
        },
      ],
    });
    app.project.stories.push({
      id: "another-authored-story",
      title: "Keep the other story",
      beats: [
        { id: "other-story-beat", title: "Unchanged", candidateAssetIds: [] },
      ],
    });
    app.project.timelines.push({
      id: "authored-script-film",
      storyId,
      duration: 8,
      tracks: [
        {
          id: "authored-script-track",
          type: "video",
          clips: [
            {
              id: "authored-still",
              assetId: photo.id,
              beatId,
              timelineStart: 0,
              timelineDuration: 2,
              transition: { type: "crossfade", duration: 0.25 },
            },
            {
              id: "authored-locked-trim",
              assetId: video.id,
              beatId,
              timelineStart: 2,
              timelineDuration: 2.5,
              sourceIn: 0.25,
              sourceOut: 2.75,
              transform: { volume: 0.35, x: 4, y: -2 },
              locked: true,
            },
            {
              id: "authored-ending",
              assetId: photo.id,
              beatId: "another-authored-beat",
              timelineStart: 4.5,
              timelineDuration: 3.5,
            },
          ],
        },
      ],
    });
    await app.save();
  } finally {
    app.close();
  }
  const opened = await request.post(`${api}/project/open`, {
    data: { path: fixture.project },
  });
  expect(opened.ok(), await opened.text()).toBe(true);
  return fixture;
}

async function storyWorkspace(
  page: Page,
  locale: ProjectContentLocale = "en-US",
) {
  if (!(await page.getByTestId("script-review-panel").isVisible()))
    await navigate(page, "story", locale);
  const activeStory = page.getByLabel(uiText(locale, "app.story.active"), {
    exact: true,
  });
  if ((await activeStory.inputValue()) !== storyId)
    await activeStory.selectOption(storyId);
  const firstBeat = page.locator(".beat-list button").first();
  if (await firstBeat.isEnabled()) await firstBeat.click();
  await expect(page.getByTestId("script-review-panel")).toBeVisible();
}
async function begin(page: Page, locale: ProjectContentLocale = "en-US") {
  await initialLocale(page, locale);
  await page.goto("/");
  await storyWorkspace(page, locale);
}
async function generate(page: Page, request: APIRequestContext, field: Field) {
  await page.getByTestId("script-review-field").selectOption(field);
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/stories/${storyId}/script-review` &&
      response.request().method() === "POST",
  );
  await page.getByTestId("script-review-generate").click();
  const response = await pending;
  expect(response.status(), await response.text()).toBe(202);
  await expect
    .poll(async () => (await suggestions(request, field, "pending")).total)
    .toBe(1);
  const suggestion = (await suggestions(request, field, "pending"))
    .suggestions[0]!;
  const card = page
    .getByTestId("script-review-suggestion")
    .filter({ has: page.getByTestId("script-review-before") });
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("data-suggestion-id", suggestion.id);
  return { suggestion, card };
}
async function assertFilmUnchanged(
  request: APIRequestContext,
  baseline: OpenFilmProject,
  baselineAssets: MediaAsset[],
) {
  const current = await project(request);
  expect(current.timelines).toEqual(baseline.timelines);
  expect(current.settings).toEqual(baseline.settings);
  expect(
    current.stories.find((entry) => entry.id === "another-authored-story"),
  ).toEqual(
    baseline.stories.find((entry) => entry.id === "another-authored-story"),
  );
  expect(await assets(request)).toEqual(baselineAssets);
}
async function layout(page: Page, name: string) {
  const issues = await page
    .getByTestId("script-review-panel")
    .evaluate((panel) => {
      const problems: string[] = [];
      if (document.documentElement.scrollWidth > innerWidth + 2)
        problems.push(
          `Page exceeds viewport: ${document.documentElement.scrollWidth}`,
        );
      for (const element of Array.from(
        panel.querySelectorAll<HTMLElement>("button, select, label, h2, h3, p"),
      )) {
        if (!element.getClientRects().length) continue;
        const bounds = element.getBoundingClientRect();
        if (bounds.left < -2 || bounds.right > innerWidth + 2)
          problems.push(`Outside viewport: ${element.textContent?.trim()}`);
        if (element.scrollWidth > element.clientWidth + 3)
          problems.push(`Clipped content: ${element.textContent?.trim()}`);
      }
      return problems;
    });
  expect(issues, name).toEqual([]);
  expect(await page.getByTestId("script-review-panel").innerText()).not.toMatch(
    /\b(?:scriptReview|scenePlan|app|editor)\.[a-zA-Z][\w.]+\b|\bundefined\b/u,
  );
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

test("flushes an authored draft, reviews a reasoned change, and persists only accepted script fields", async ({
  page,
  request,
}) => {
  const locale = "zh-TW";
  const fixture = await sourceFilm(request, locale);
  const baseline = await project(request);
  const baselineAssets = await assets(request);
  await begin(page, locale);
  const draft = "  這是作者剛改的旁白。\nOur own newest draft.  ";
  await page.getByTestId("beat-script-narration").fill(draft);
  const { suggestion, card } = await generate(page, request, "narration");
  expect(suggestion.before).toBe(draft);
  expect(suggestion.after).toBe(draft + marker);
  await expect(card.getByTestId("script-review-before")).toHaveText(draft);
  await expect(card.getByTestId("script-review-after")).toHaveText(
    draft + marker,
  );
  await expect(card.getByTestId("script-review-reason")).toContainText(
    "TEST FIXTURE:",
  );
  await expect(card.getByTestId("script-review-reason")).toContainText(
    "not an AI quality judgment",
  );
  const flushed = await project(request);
  const expected = structuredClone(authoredStory(baseline));
  expected.beats[0]!.script!.narration = draft;
  expect(authoredStory(flushed)).toEqual(expected);
  await assertFilmUnchanged(request, baseline, baselineAssets);
  await layout(page, "zh-TW-script-review-pending-1440x900");

  await card.getByTestId("script-review-accept").click();
  await expect
    .poll(
      async () =>
        authoredStory(await project(request)).beats[0]!.script!.narration,
    )
    .toBe(suggestion.after);
  expected.beats[0]!.script!.narration = suggestion.after;
  expect(authoredStory(await project(request))).toEqual(expected);
  await expect(page.getByTestId("beat-script-narration")).toHaveValue(
    suggestion.after,
  );
  await assertFilmUnchanged(request, baseline, baselineAssets);

  const direction = await generate(page, request, "visualDirection");
  expect(direction.suggestion.before).toBe(visualDirection);
  await direction.card.getByTestId("script-review-skip").click();
  await expect
    .poll(
      async () =>
        (await suggestions(request, "visualDirection", "pending")).total,
    )
    .toBe(0);
  expect(authoredStory(await project(request))).toEqual(expected);
  await page.getByTestId("script-review-history").click();
  await expect(page.getByTestId("script-review-suggestion")).toHaveAttribute(
    "data-status",
    "skipped",
  );
  await page.getByTestId("script-review-field").selectOption("narration");
  await expect(page.getByTestId("script-review-suggestion")).toHaveAttribute(
    "data-status",
    "accepted",
  );

  await page
    .getByRole("button", {
      name: uiText(locale, "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await openFilm(page, fixture.project, locale);
  await storyWorkspace(page, locale);
  await expect(page.getByTestId("beat-script-narration")).toHaveValue(
    suggestion.after,
  );
  await expect(page.getByTestId("beat-script-visual-direction")).toHaveValue(
    visualDirection,
  );
  expect((await suggestions(request, "narration", "accepted")).total).toBe(1);
  expect((await suggestions(request, "visualDirection", "skipped")).total).toBe(
    1,
  );
  await assertFilmUnchanged(request, baseline, baselineAssets);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("rejects a stale review after an independent script edit and preserves the newer authored text", async ({
  page,
  request,
}) => {
  const fixture = await sourceFilm(request);
  const baseline = await project(request);
  const baselineAssets = await assets(request);
  await begin(page);
  const { suggestion, card } = await generate(page, request, "narration");
  const newer = "A newer author made this deliberate edit. 新しい言葉。";
  const beats = structuredClone(authoredStory(await project(request)).beats);
  beats[0]!.script!.narration = newer;
  const patch = await request.patch(`${api}/stories/${storyId}`, {
    data: { beats },
  });
  expect(patch.ok(), await patch.text()).toBe(true);
  const rejection = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      `/api/script-review/suggestions/${suggestion.id}/accept`,
  );
  await card.getByTestId("script-review-accept").click();
  expect((await rejection).status()).toBe(409);
  await expect(page.getByTestId("script-review-error")).toBeVisible();
  expect(authoredStory(await project(request)).beats[0]!.script).toEqual({
    narration: newer,
    visualDirection,
  });
  await page.reload();
  await storyWorkspace(page);
  await expect(page.getByTestId("beat-script-narration")).toHaveValue(newer);
  await assertFilmUnchanged(request, baseline, baselineAssets);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("acceptance freezes the beat and guards navigation until its real server acknowledgment arrives", async ({
  page,
  request,
}) => {
  const fixture = await sourceFilm(request);
  const baseline = await project(request);
  const baselineAssets = await assets(request);
  await begin(page);
  const { suggestion, card } = await generate(page, request, "narration");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed = false;
  const pattern = `**/api/script-review/suggestions/${suggestion.id}/accept`;
  // Keep interception stable while the acknowledgment starts the UI's real
  // follow-up read. Removing the final route during that read can strand it.
  await page.route("**/api/**", (route) => route.continue());
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    committed = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await card.getByTestId("script-review-accept").click();
    await expect.poll(() => committed).toBe(true);
    for (const name of [
      "beat-script-narration",
      "beat-script-visual-direction",
      "script-review-field",
      "script-review-generate",
      "script-review-history",
    ]) {
      await expect(page.getByTestId(name)).toBeDisabled();
    }
    await expect(
      page.getByLabel(uiText("en-US", "app.story.active"), { exact: true }),
    ).toBeDisabled();
    for (const button of await page.locator(".beat-list button").all())
      await expect(button).toBeDisabled();
    const before = await page.getByTestId("beat-script-narration").inputValue();
    await page
      .getByTestId("beat-script-narration")
      .evaluate((node) => (node as HTMLTextAreaElement).focus());
    await page.keyboard.type("Cannot replace an acceptance in flight.");
    await expect(page.getByTestId("beat-script-narration")).toHaveValue(before);
    await navigate(page, "library");
    await expect(page.getByTestId("script-review-panel")).toBeVisible();
    expect(
      authoredStory(await project(request)).beats[0]!.script!.narration,
    ).toBe(suggestion.after);
    await assertFilmUnchanged(request, baseline, baselineAssets);
  } finally {
    release();
  }
  // The Library request made during acceptance resumes only after the server
  // acknowledgment and the component's follow-up read have both completed.
  await expect(page.getByTestId("script-review-panel")).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  await storyWorkspace(page);
  await expect(page.getByTestId("beat-script-narration")).toHaveValue(
    suggestion.after,
  );
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("a lost acceptance acknowledgment retains one receipt across retry and reload without applying twice", async ({
  page,
  request,
}) => {
  const fixture = await sourceFilm(request);
  const baseline = await project(request);
  const baselineAssets = await assets(request);
  await begin(page);
  const { suggestion, card } = await generate(page, request, "narration");
  const packets: string[] = [];
  let drop = true;
  const pattern = `**/api/script-review/suggestions/${suggestion.id}/accept`;
  // Keep request interception enabled after the failure handler is removed too;
  // the real server still processes every acceptance and creates its receipt.
  await page.route("**/api/**", (route) => route.continue());
  await page.route(pattern, async (route) => {
    packets.push(route.request().postData()!);
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    if (drop) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await card.getByTestId("script-review-accept").click();
  await expect(page.getByTestId("script-review-retry-accept")).toBeVisible();
  const accepted = await project(request);
  expect(authoredStory(accepted).beats[0]!.script!.narration).toBe(
    suggestion.after,
  );
  expect(accepted.sceneScriptReviewReceipts).toHaveLength(1);
  const acceptanceKey = `openfilm:script-review-accept:${accepted.id}`;
  const storage = await page.evaluate(
    (key) => localStorage.getItem(key),
    acceptanceKey,
  );
  expect(storage).toBeTruthy();
  expect(JSON.parse(storage!)).toMatchObject({
    storyId,
    beatId,
    field: "narration",
    suggestionId: suggestion.id,
    receipt: JSON.parse(packets[0]!),
  });
  await page.getByTestId("script-review-retry-accept").click();
  await expect.poll(() => packets.length).toBe(2);
  await expect(page.getByTestId("script-review-retry-accept")).toBeEnabled();
  await expect(page.getByTestId("beat-script-narration")).toBeDisabled();
  await navigate(page, "library");
  await expect(page.getByTestId("script-review-panel")).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), acceptanceKey),
  ).toBe(storage);

  await page.reload();
  await storyWorkspace(page);
  await expect(page.getByTestId("script-review-retry-accept")).toBeVisible();
  await expect(page.getByTestId("script-review-field")).toBeDisabled();
  drop = false;
  await page.getByTestId("script-review-retry-accept").click();
  await expect(page.getByTestId("script-review-retry-accept")).toHaveCount(0);
  await expect(page.getByTestId("beat-script-narration")).toBeEnabled();
  expect(packets).toHaveLength(3);
  expect(new Set(packets).size).toBe(1);
  expect(await project(request)).toEqual(accepted);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), acceptanceKey),
  ).toBeNull();
  await assertFilmUnchanged(request, baseline, baselineAssets);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

for (const [locale, viewport] of [
  ["en-US", { width: 1280, height: 720 }],
  ["zh-TW", { width: 1440, height: 900 }],
  ["ja-JP", { width: 1920, height: 1080 }],
] as const) {
  test(`${locale} script review is readable and keyboard operable without changing authored content`, async ({
    page,
    request,
  }) => {
    const fixture = await sourceFilm(request, locale);
    const baseline = await project(request);
    const missingTranslations: string[] = [];
    page.on("console", (entry) => {
      if (/Missing translation|Not found.*key/u.test(entry.text()))
        missingTranslations.push(entry.text());
    });
    await page.setViewportSize(viewport);
    await begin(page, locale);
    const { card } = await generate(page, request, "narration");
    await layout(
      page,
      `${locale}-script-review-${viewport.width}x${viewport.height}`,
    );
    expect(await project(request)).toEqual(baseline);
    const fileBefore = await readFile(
      join(fixture.project, "project.json"),
      "utf8",
    );
    const userDraft = "  User-authored words stay verbatim.\n作者の言葉。  ";
    await page.getByTestId("beat-script-visual-direction").fill(userDraft);
    const nextLocale = locale === "ja-JP" ? "en-US" : "ja-JP";
    await page.locator(".ui-language select").selectOption(nextLocale);
    await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
    await expect(page.getByTestId("beat-script-narration")).toHaveValue(
      narration,
    );
    await expect(page.getByTestId("beat-script-visual-direction")).toHaveValue(
      userDraft,
    );
    expect(await readFile(join(fixture.project, "project.json"), "utf8")).toBe(
      fileBefore,
    );
    if (locale === "en-US") {
      expect(
        await page.evaluate(async () => {
          const modulePath = "/src/i18n/index.ts";
          const { setUiLocale, uiLocale } = await import(modulePath);
          setUiLocale("en-XA");
          return uiLocale.value;
        }),
      ).toBe("en-XA");
      await expect(
        page.getByTestId("beat-script-visual-direction"),
      ).toHaveValue(userDraft);
      await layout(page, "en-XA-script-review-1280x720");
    }
    await card.getByTestId("script-review-accept").focus();
    await expect(card.getByTestId("script-review-accept")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(card.getByTestId("script-review-skip")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect
      .poll(
        async () => (await suggestions(request, "narration", "skipped")).total,
      )
      .toBe(1);
    // Skip records a decision. It must neither apply its text nor flush a
    // separate unsaved draft merely because the UI language changed.
    expect(await project(request)).toEqual(baseline);
    expect(missingTranslations).toEqual([]);
    expect(await fixture.assertOriginalsUnchanged()).toBe(true);
  });
}
