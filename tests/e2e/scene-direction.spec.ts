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
  Clip,
  Composition,
  OpenFilmProject,
  ProjectContentLocale,
} from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";
import { pseudoText } from "../../apps/desktop/src/i18n/pseudo.js";

const api = "http://127.0.0.1:4310/api";
const compositionId = "direction-film";
const sourceText = "Keep proportions; Gentle push-in; match the music";
const cleanup: Array<() => Promise<void>> = [];

interface DirectionPlan {
  id: string;
  sourceText: string;
  actions: Array<{ id: string; clipId: string; kind: "layout" | "motion" }>;
}

interface EditorSnapshot {
  composition: Composition;
  revision: string;
  canUndo: boolean;
  canRedo: boolean;
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

async function createFilm(
  request: APIRequestContext,
  locale: ProjectContentLocale = "en-US",
  dependentMotion = false,
  sourceLocked = false,
) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Our own words / 私たちの思い出 / 我們的回憶",
    { projectContentLocale: locale },
  );
  try {
    await app.importFolder(fixture.media);
    const assets = app.catalog.listAssets({ limit: 100 });
    const id = (name: string) =>
      assets.find((asset) => asset.name === name)!.id;
    app.project.settings = { width: 320, height: 180, frameRate: 24 };
    app.project.stories.push({
      id: "direction-story",
      title: "A carefully chosen memory",
      targetDuration: 14,
      maxDuration: 14,
      beats: [
        {
          id: "direction-beat",
          title: "Time together",
          targetDuration: 10,
          candidateAssetIds: [id("01-photo.png"), id("03-evening.png")],
          selectedAssetIds: [id("01-photo.png"), id("03-evening.png")],
          script: {
            narration: "我們一起慢慢走。\nThese words belong to the author.",
            visualDirection: sourceText,
          },
        },
        {
          id: "outside-beat",
          title: "The next scene",
          selectedAssetIds: [id("04-motion.mp4")],
        },
      ],
    });
    app.project.timelines.push({
      id: compositionId,
      storyId: "direction-story",
      duration: 14,
      tracks: [
        {
          id: "direction-pictures",
          type: "video",
          clips: [
            {
              id: "direction-photo",
              assetId: id("01-photo.png"),
              beatId: "direction-beat",
              timelineStart: 0,
              timelineDuration: 5,
              title: "Keep this authored title",
              titleStyle: { version: 1, role: "scene-statement" },
              transform: { rotation: 2, x: 4 },
            },
            {
              id: "direction-second-photo",
              assetId: id("03-evening.png"),
              beatId: "direction-beat",
              timelineStart: 5,
              timelineDuration: 5,
            },
            {
              id: "direction-video",
              assetId: id("04-motion.mp4"),
              beatId: "outside-beat",
              timelineStart: 10,
              timelineDuration: 4,
              sourceIn: 0.25,
              sourceOut: 2.25,
              transform: { speed: 0.5, volume: 0.4 },
            },
          ],
        },
        {
          id: "direction-overlay",
          type: "titles",
          timing: "overlay",
          clips: [
            {
              id: "direction-authored-overlay",
              assetId: id("03-evening.png"),
              timelineStart: 1,
              timelineDuration: 3,
              title: "This deliberate overlay must survive.",
            },
          ],
        },
        {
          id: "direction-sound",
          type: "music",
          timing: "overlay",
          clips: [
            {
              id: "direction-authored-sound",
              assetId: id("05-tone.wav"),
              timelineStart: 0,
              timelineDuration: 2,
              sourceIn: 0,
              sourceOut: 2,
              transform: { volume: 0.2 },
              audioAutomation: { version: 1, role: "music" },
            },
          ],
        },
      ],
    });
    if (dependentMotion) {
      const photo = app.catalog.getAsset(id("01-photo.png"))!;
      app.catalog.upsertAsset({
        ...photo,
        dimensions: { width: 1000, height: 2000 },
        metadata: {
          ...photo.metadata,
          "openfilm.display": { version: 1, width: 1000, height: 2000 },
        },
      });
      const selected = app.project.timelines[0]!.tracks[0]!.clips[0]!;
      selected.layout = {
        version: 1,
        preset: "hero",
        focalPoint: { x: 0.5, y: 1 },
        protectedRegion: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
      };
      delete selected.transform;
    }
    if (sourceLocked) {
      for (const name of ["01-photo.png", "04-motion.mp4"])
        app.catalog.updateAsset(id(name), { state: { locked: true } });
    }
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
  return fixture;
}

async function editor(request: APIRequestContext): Promise<EditorSnapshot> {
  const response = await request.get(
    `${api}/compositions/${compositionId}/editor`,
  );
  expect(response.ok()).toBe(true);
  return response.json();
}

async function project(request: APIRequestContext): Promise<OpenFilmProject> {
  const response = await request.get(`${api}/project`);
  expect(response.ok()).toBe(true);
  return (await response.json()).project;
}

function clip(snapshot: EditorSnapshot, id = "direction-photo"): Clip {
  return snapshot.composition.tracks
    .flatMap((track) => track.clips)
    .find((entry) => entry.id === id)!;
}

async function openEditor(page: Page, locale: ProjectContentLocale = "en-US") {
  await initialLocale(page, locale);
  await page.goto("/");
  await navigate(page, "edit", locale);
  await page.locator("#clip-direction-photo").click();
  const review = page.getByTestId("scene-direction-review");
  await expect(review).toBeVisible();
  if ((await review.getAttribute("open")) === null)
    await review.locator("summary").click();
  return review;
}

async function generate(page: Page): Promise<DirectionPlan> {
  const response = page.waitForResponse((entry) =>
    new URL(entry.url()).pathname.endsWith("/direction/preview"),
  );
  await page.getByTestId("direction-generate").click();
  const received = await response;
  expect(received.ok(), await received.text()).toBe(true);
  const body = (await received.json()) as
    DirectionPlan | { plan: DirectionPlan };
  const plan = "plan" in body ? body.plan : body;
  await expect(page.getByTestId("direction-action")).toHaveCount(
    plan.actions.length,
  );
  return plan;
}

test("preview and Skip preserve the film; selected adoption is one reversible saved edit", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request);
  const before = await editor(request);
  const projectBefore = await project(request);
  const fileBefore = await readFile(
    join(fixture.project, "project.json"),
    "utf8",
  );
  await openEditor(page);
  const first = await generate(page);
  expect(first.sourceText).toBe(sourceText);
  expect(first.actions.map((action) => action.kind).sort()).toEqual([
    "layout",
    "motion",
  ]);
  expect(
    first.actions.every((action) => action.clipId === "direction-photo"),
  ).toBe(true);
  await page.getByTestId("direction-preview").first().click();
  await expect(
    page.locator(".editor-source-screen .photo-presentation-preview"),
  ).toBeVisible();
  expect((await editor(request)).composition).toEqual(before.composition);
  expect(await project(request)).toEqual(projectBefore);
  expect(await readFile(join(fixture.project, "project.json"), "utf8")).toBe(
    fileBefore,
  );
  await page.getByTestId("direction-skip").first().click();
  await expect(
    page.locator(".editor-source-screen .photo-presentation-preview"),
  ).toHaveCount(0);
  expect((await editor(request)).composition).toEqual(before.composition);
  expect(await project(request)).toEqual(projectBefore);
  expect(await readFile(join(fixture.project, "project.json"), "utf8")).toBe(
    fileBefore,
  );

  const plan = await generate(page);
  expect(plan).toEqual(first);
  const layout = plan.actions.find((action) => action.kind === "layout")!;
  await page
    .locator(`[data-testid="direction-action"][data-action-id="${layout.id}"]`)
    .getByTestId("direction-select")
    .uncheck();
  await page.getByTestId("direction-accept").click();
  await expect
    .poll(async () => clip(await editor(request)).motion?.preset)
    .toBe("push-in");
  const accepted = await editor(request);
  expect(clip(accepted).layout).toBeUndefined();
  const expected = structuredClone(before.composition);
  expected.tracks[0]!.clips[0]!.motion = clip(accepted).motion;
  expect(accepted.composition).toEqual(expected);
  expect((await project(request)).stories).toEqual(projectBefore.stories);

  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect
    .poll(async () => (await editor(request)).composition)
    .toEqual(before.composition);
  expect((await editor(request)).canUndo).toBe(false);
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await expect
    .poll(async () => (await editor(request)).composition)
    .toEqual(accepted.composition);
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  expect(
    (
      await request.post(`${api}/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await navigate(page, "edit");
  expect((await editor(request)).composition).toEqual(accepted.composition);
  expect((await project(request)).stories).toEqual(projectBefore.stories);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("a saved manual change rejects stale direction without overwriting the film", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request);
  await openEditor(page);
  const plan = await generate(page);
  const beforeManual = await editor(request);
  const changed = await request.post(
    `${api}/compositions/${compositionId}/edit`,
    {
      data: {
        baseRevision: beforeManual.revision,
        requestId: "manual-change-after-direction-preview",
        commands: [
          {
            type: "presentation",
            clipId: "direction-photo",
            layout: { version: 1, preset: "hero" },
          },
        ],
      },
    },
  );
  expect(changed.ok(), await changed.text()).toBe(true);
  const manual = await editor(request);
  const projectBeforeAccept = await project(request);
  const bytesBeforeAccept = await readFile(
    join(fixture.project, "project.json"),
    "utf8",
  );
  const rejected = page.waitForResponse((entry) =>
    new URL(entry.url()).pathname.endsWith("/direction/accept"),
  );
  await page.getByTestId("direction-accept").click();
  expect((await rejected).status()).toBe(409);
  await expect(page.getByTestId("direction-error")).toBeVisible();
  expect((await editor(request)).composition).toEqual(manual.composition);
  expect(await project(request)).toEqual(projectBeforeAccept);
  expect(await readFile(join(fixture.project, "project.json"), "utf8")).toBe(
    bytesBeforeAccept,
  );
  expect(clip(manual).layout?.preset).toBe("hero");
  expect(clip(manual).motion).toBeUndefined();
  await expect(page.getByTestId("direction-generate")).toBeEnabled();
  const fresh = await generate(page);
  expect(fresh.id).not.toBe(plan.id);
  // The user's saved crop is protected unless replacement is explicitly chosen.
  expect(fresh.actions.some((action) => action.kind === "layout")).toBe(false);
  expect((await editor(request)).composition).toEqual(manual.composition);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("a lost acceptance response retries the exact receipt without adding another edit", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request);
  const before = await editor(request);
  await openEditor(page);
  await generate(page);
  const requests: unknown[] = [];
  let loseAcknowledgement = true;
  await page.route("**/direction/accept", async (route) => {
    requests.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    if (loseAcknowledgement) {
      loseAcknowledgement = false;
      await route.abort("failed");
    } else {
      await route.fulfill({ response });
    }
  });
  try {
    await page.getByTestId("direction-accept").click();
    await expect(page.getByTestId("direction-retry")).toBeVisible();
    expect(requests).toHaveLength(1);
    const accepted = await editor(request);
    expect(clip(accepted).layout?.preset).toBe("contain");
    expect(clip(accepted).motion?.preset).toBe("push-in");
    const savedBytes = await readFile(
      join(fixture.project, "project.json"),
      "utf8",
    );
    await expect(page.getByTestId("direction-generate")).toBeDisabled();
    for (const selection of await page.getByTestId("direction-select").all())
      await expect(selection).toBeDisabled();
    await page.reload();
    await navigate(page, "edit");
    await expect(page.getByTestId("direction-retry")).toBeVisible();
    await expect(page.getByTestId("direction-generate")).toBeDisabled();
    await page.getByTestId("direction-retry").click();
    await expect(page.getByTestId("direction-retry")).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect((await editor(request)).composition).toEqual(accepted.composition);
    expect(await readFile(join(fixture.project, "project.json"), "utf8")).toBe(
      savedBytes,
    );
    await page.getByRole("button", { name: "Undo edit", exact: true }).click();
    await expect
      .poll(async () => (await editor(request)).composition)
      .toEqual(before.composition);
    expect((await editor(request)).canUndo).toBe(false);
    expect(await fixture.assertOriginalsUnchanged()).toBe(true);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("a review generated after another client saves uses the latest saved context", async ({
  page,
  request,
}) => {
  await createFilm(request);
  await openEditor(page);
  const before = await editor(request);
  const changed = await request.post(
    `${api}/compositions/${compositionId}/edit`,
    {
      data: {
        baseRevision: before.revision,
        requestId: "manual-change-before-direction-preview",
        commands: [
          {
            type: "presentation",
            clipId: "direction-photo",
            layout: { version: 1, preset: "hero" },
          },
        ],
      },
    },
  );
  expect(changed.ok(), await changed.text()).toBe(true);
  const plan = await generate(page);
  expect(plan.actions.map((action) => action.kind)).toEqual(["motion"]);
  await page.getByTestId("direction-accept").click();
  await expect
    .poll(async () => clip(await editor(request)).motion?.preset)
    .toBe("push-in");
  expect(clip(await editor(request)).layout?.preset).toBe("hero");
});

test("skipping a prerequisite layout prevents unsafe motion preview and acceptance", async ({
  page,
  request,
}) => {
  await createFilm(request, "en-US", true);
  await openEditor(page);
  await page.getByTestId("direction-replace").check();
  const plan = await generate(page);
  expect(plan.actions.map((action) => action.kind)).toEqual([
    "layout",
    "motion",
  ]);
  await expect(page.getByTestId("direction-accept")).toBeEnabled();
  const before = await project(request);
  const layout = page.locator(
    '[data-testid="direction-action"][data-kind="layout"]',
  );
  const motionPreview = page
    .locator('[data-testid="direction-action"][data-kind="motion"]')
    .getByTestId("direction-preview");
  await motionPreview.click();
  await expect(motionPreview).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("direction-error")).toHaveCount(0);
  const seek = page.getByRole("slider", {
    name: uiText("en-US", "editor.presentation.seek"),
    exact: true,
  });
  await seek.focus();
  await seek.press("End");
  await expect(
    page.locator(".editor-source-screen .photo-presentation-layers"),
  ).toHaveAttribute("style", /scale\(1\.06\)/);
  expect(await project(request)).toEqual(before);
  await layout.getByTestId("direction-select").uncheck();
  await expect(motionPreview).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("direction-selection-warning")).toBeVisible();
  await expect(page.getByTestId("direction-accept")).toBeDisabled();
  await motionPreview.click();
  await expect(motionPreview).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("direction-error")).toHaveText(
    uiText("en-US", "editor.direction.selectionNeedsReview"),
  );
  expect(await project(request)).toEqual(before);
  await layout.getByTestId("direction-select").check();
  await expect(page.getByTestId("direction-selection-warning")).toHaveCount(0);
  await expect(page.getByTestId("direction-accept")).toBeEnabled();
  await motionPreview.click();
  await expect(motionPreview).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("direction-error")).toHaveCount(0);
  await seek.press("End");
  await expect(page.locator(".photo-presentation-layers")).toHaveAttribute(
    "style",
    /scale\(1\.06\)/u,
  );
  await page.getByTestId("direction-accept").click();
  await expect
    .poll(async () => clip(await editor(request)).layout?.preset)
    .toBe("contain");
  expect(clip(await editor(request)).motion?.preset).toBe("push-in");
});

test("source-locked regular photo and video keep clip-local edits available while presentation and source replacement stay protected", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request, "en-US", false, true);
  const before = await editor(request);
  const catalogBefore = await request.get(`${api}/assets?limit=100`);
  expect(catalogBefore.ok()).toBe(true);
  const assetsBefore: unknown = (await catalogBefore.json()).assets;
  await openEditor(page);
  const input = (key: string) =>
    page.getByLabel(uiText("en-US", `editor.clip.${key}`), { exact: true });
  const fill = async (key: string, value: string) => {
    await input(key).fill(value);
    await input(key).press("Tab");
  };
  const lockedFields = () => [
    input("photoDurationLabel"),
    input("rotationLabel"),
    input("transitionLabel"),
  ];
  for (const field of lockedFields()) await expect(field).toBeEnabled();
  await expect(
    page.getByLabel(uiText("en-US", "editor.presentation.layout"), {
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByLabel(uiText("en-US", "editor.presentation.titleText"), {
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByTestId("direction-generate")).toBeDisabled();
  const replacement = input("replacementLabel");
  const remove = page.getByRole("button", {
    name: uiText("en-US", "editor.clip.delete"),
    exact: true,
  });
  await expect(replacement).toBeDisabled();
  await expect(remove).toBeDisabled();
  await fill("photoDurationLabel", "4");
  await expect
    .poll(async () => clip(await editor(request)).timelineDuration)
    .toBe(4);
  await fill("rotationLabel", "7");
  await expect
    .poll(async () => clip(await editor(request)).transform?.rotation)
    .toBe(7);
  await input("transitionLabel").selectOption("crossfade");
  await expect
    .poll(async () => clip(await editor(request)).transition?.type)
    .toBe("crossfade");
  await page.getByRole("button", { name: "Lock clip", exact: true }).click();
  await expect.poll(async () => clip(await editor(request)).locked).toBe(true);
  for (const field of lockedFields()) await expect(field).toBeDisabled();
  await page.getByRole("button", { name: "Unlock clip", exact: true }).click();
  await expect.poll(async () => clip(await editor(request)).locked).toBe(false);
  for (const field of lockedFields()) await expect(field).toBeEnabled();
  await expect(page.getByTestId("direction-generate")).toBeDisabled();

  await page.locator("#clip-direction-video").click();
  const videoFields = () => [
    input("sourceInLabel"),
    input("sourceOutLabel"),
    input("speed"),
    input("volumeLabel"),
  ];
  for (const field of videoFields()) await expect(field).toBeEnabled();
  await expect(replacement).toBeDisabled();
  await expect(remove).toBeDisabled();
  await fill("sourceInLabel", "0.5");
  await expect
    .poll(async () => clip(await editor(request), "direction-video").sourceIn)
    .toBe(0.5);
  await fill("sourceOutLabel", "1.75");
  await expect
    .poll(async () => clip(await editor(request), "direction-video").sourceOut)
    .toBe(1.75);
  await fill("speed", "1");
  await expect
    .poll(
      async () =>
        clip(await editor(request), "direction-video").transform?.speed,
    )
    .toBe(1);
  await input("volumeLabel").press("End");
  await expect
    .poll(
      async () =>
        clip(await editor(request), "direction-video").transform?.volume,
    )
    .toBe(1);
  await page.getByRole("button", { name: "Lock clip", exact: true }).click();
  await expect
    .poll(async () => clip(await editor(request), "direction-video").locked)
    .toBe(true);
  for (const field of videoFields()) await expect(field).toBeDisabled();
  await page.getByRole("button", { name: "Unlock clip", exact: true }).click();
  await expect
    .poll(async () => clip(await editor(request), "direction-video").locked)
    .toBe(false);
  for (const field of videoFields()) await expect(field).toBeEnabled();

  const after = await editor(request);
  expect(clip(after).title).toBe(clip(before).title);
  expect(clip(after).titleStyle).toEqual(clip(before).titleStyle);
  expect(clip(after).layout).toEqual(clip(before).layout);
  expect(clip(after).motion).toEqual(clip(before).motion);
  const { timelineStart: _beforeStart, ...untouchedBefore } = clip(
    before,
    "direction-second-photo",
  );
  const { timelineStart: _afterStart, ...untouchedAfter } = clip(
    after,
    "direction-second-photo",
  );
  expect(untouchedAfter).toEqual(untouchedBefore);
  expect(after.composition.tracks.slice(1)).toEqual(
    before.composition.tracks.slice(1),
  );
  const catalogAfter = await request.get(`${api}/assets?limit=100`);
  expect(catalogAfter.ok()).toBe(true);
  expect((await catalogAfter.json()).assets).toEqual(assetsBefore);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("browser storage failure prevents acceptance from being sent", async ({
  page,
  request,
}) => {
  await createFilm(request);
  await openEditor(page);
  await generate(page);
  const before = await project(request);
  const acceptRequests: unknown[] = [];
  page.on("request", (entry) => {
    if (new URL(entry.url()).pathname.endsWith("/direction/accept"))
      acceptRequests.push(entry.postDataJSON());
  });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("openfilm.direction-acceptance:"))
        throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByTestId("direction-accept").click();
  await expect(page.getByTestId("direction-error")).toHaveText(
    uiText("en-US", "editor.direction.errors.storage"),
  );
  expect(acceptRequests).toEqual([]);
  expect(await project(request)).toEqual(before);
});

test("a publication conflict keeps the exact receipt and permits reopening for recovery", async ({
  page,
  request,
}) => {
  const fixture = await createFilm(request);
  await openEditor(page);
  await generate(page);
  const sent: unknown[] = [];
  let publishConflict = true;
  await page.route("**/direction/accept", async (route) => {
    sent.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    if (publishConflict) {
      publishConflict = false;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Reopen to acknowledge the saved revision",
          code: "story.planConflict",
        }),
      });
    } else await route.fulfill({ response });
  });
  try {
    await page.getByTestId("direction-accept").click();
    await expect(page.getByTestId("direction-error")).toHaveText(
      uiText("en-US", "editor.direction.errors.reopen"),
    );
    await expect(page.getByTestId("direction-retry")).toBeDisabled();
    await expect(page.getByTestId("direction-generate")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Undo edit", exact: true }),
    ).toBeDisabled();
    const accepted = await editor(request);
    expect(clip(accepted).motion?.preset).toBe("push-in");
    await navigate(page, "library");
    await expect(
      page.getByRole("heading", {
        name: "Make every moment count.",
        exact: true,
      }),
    ).toBeHidden();
    expect(
      (await request.post(`${api}/project/close`, { data: {} })).ok(),
    ).toBe(true);
    expect(
      (
        await request.post(`${api}/project/open`, {
          data: { path: fixture.project },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await navigate(page, "edit");
    await expect(page.getByTestId("direction-retry")).toBeEnabled();
    await page.getByTestId("direction-retry").click();
    await expect(page.getByTestId("direction-retry")).toHaveCount(0);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect((await editor(request)).composition).toEqual(accepted.composition);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
  }
});

async function assertLayout(page: Page, name: string) {
  const issues = await page.evaluate(() => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth + 2)
      problems.push(
        `Page exceeds viewport: ${document.documentElement.scrollWidth}`,
      );
    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="scene-direction-review"] button, [data-testid="scene-direction-review"] summary, [data-testid="scene-direction-review"] label, [data-testid="direction-action"], [data-testid="direction-examples"]',
      ),
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
  expect(
    await page.getByTestId("scene-direction-review").innerText(),
  ).not.toMatch(
    /\b(?:sceneDirection|editor|app)\.[a-zA-Z][\w.]+\b|\bundefined\b/u,
  );
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

function directionText(
  locale: ProjectContentLocale | "en-XA",
  key: "heading" | "generate" | "accept" | "preview" | "source",
  params: Record<string, string | number> = {},
) {
  const template = uiText(
    locale === "en-XA" ? "en-US" : locale,
    `editor.direction.${key}`,
  );
  const text = locale === "en-XA" ? pseudoText(template) : template;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

for (const locale of ["en-US", "zh-TW", "ja-JP", "en-XA"] as const) {
  test(`${locale} direction review preserves authored words and fits desktop sizes`, async ({
    page,
    request,
  }) => {
    const contentLocale = locale === "en-XA" ? "en-US" : locale;
    const fixture = await createFilm(request, contentLocale);
    const before = await project(request);
    const bytes = await readFile(join(fixture.project, "project.json"), "utf8");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (entry) => {
      if (/Missing translation|Not found.*key/u.test(entry.text()))
        errors.push(entry.text());
    });
    await openEditor(page, contentLocale);
    const plan = await generate(page);
    expect(plan.sourceText).toBe(sourceText);
    if (locale === "en-XA") {
      expect(
        await page.evaluate(async () => {
          const path = "/src/i18n/index.ts";
          const { setUiLocale, uiLocale } = await import(path);
          setUiLocale("en-XA");
          return uiLocale.value;
        }),
      ).toBe("en-XA");
    }
    const review = page.getByTestId("scene-direction-review");
    await expect(page.getByTestId("direction-examples")).toHaveText(
      uiText(contentLocale, "editor.direction.examples"),
    );
    await expect(review.locator("summary")).toHaveText(
      directionText(locale, "heading"),
    );
    await expect(page.getByTestId("direction-generate")).toHaveText(
      directionText(locale, "generate"),
    );
    await expect(page.getByTestId("direction-accept")).toHaveText(
      directionText(locale, "accept", { count: plan.actions.length }),
    );
    await expect(
      review.getByRole("button", {
        name: directionText(locale, "preview"),
        exact: true,
      }),
    ).toHaveCount(plan.actions.length);
    const savedDirection = review.getByRole("textbox", {
      name: directionText(locale, "source"),
      exact: true,
    });
    await expect(savedDirection).toHaveValue(sourceText);
    await expect(savedDirection).toHaveAttribute("readonly", "");
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await review.locator("summary").scrollIntoViewIfNeeded();
      await assertLayout(
        page,
        `${locale}-direction-${viewport.width}x${viewport.height}`,
      );
      await page.getByTestId("direction-accept").scrollIntoViewIfNeeded();
      await assertLayout(
        page,
        `${locale}-direction-${viewport.width}x${viewport.height}-footer`,
      );
    }
    expect(await project(request)).toEqual(before);
    expect(await readFile(join(fixture.project, "project.json"), "utf8")).toBe(
      bytes,
    );
    expect(errors).toEqual([]);
    expect(await fixture.assertOriginalsUnchanged()).toBe(true);
    // Locale affects controls only; the saved author text remains byte for byte.
    expect(before.stories[0]!.beats[0]!.script?.visualDirection).toBe(
      sourceText,
    );
  });
}
