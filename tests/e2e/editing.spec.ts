import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type { Clip, Composition, Story } from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate, openFilm } from "./ui-helpers.js";

interface EditorState {
  composition: Composition;
  story: Story;
  revision: string;
  canUndo: boolean;
  canRedo: boolean;
}

const base = "http://127.0.0.1:4310";
const cleanup: Array<() => Promise<void>> = [];
test.afterAll(async ({ request }) => {
  expect(
    (await request.post(`${base}/api/project/close`, { data: {} })).ok(),
  ).toBe(true);
  await Promise.all(cleanup.map((action) => action()));
});

async function fixtureForEditing(
  request: APIRequestContext,
  withAudio = false,
) {
  const fixture = await createDesktopFixture(1);
  cleanup.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "A film to shape",
  );
  const imported = await app.importFolder(fixture.media);
  expect(imported.imported).toBe(6);
  expect(imported.failed).toBe(1);
  const assets = app.catalog.listAssets({ limit: 100 });
  const assetId = (name: string) =>
    assets.find((asset) => asset.name === name)!.id;
  const photo = assetId("01-photo.png");
  const motion = assetId("04-motion.mp4");
  const evening = assetId("03-evening.png");
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.project.stories.push({
    id: "editing-story",
    title: "The moments between",
    targetDuration: 8,
    maxDuration: 14,
    beats: [
      {
        id: "opening",
        title: "The beginning",
        targetDuration: 7,
        minDuration: 1,
        maxDuration: 12,
        selectedAssetIds: [],
        candidateAssetIds: [photo, motion, assetId("06-memory.png")],
      },
      {
        id: "ending",
        title: "Home again",
        targetDuration: 7,
        minDuration: 1,
        maxDuration: 12,
        selectedAssetIds: [],
        candidateAssetIds: [evening, motion, assetId("02-photo-copy.png")],
        constraints: [{ type: "must-include", assetIds: [evening] }],
      },
    ],
  });
  app.project.timelines.push({
    id: "editing-cut",
    storyId: "editing-story",
    duration: 14,
    tracks: [
      {
        id: "visuals",
        type: "video",
        clips: [
          {
            id: "opening-photo",
            assetId: photo,
            beatId: "opening",
            timelineStart: 0,
            timelineDuration: 4,
          },
          {
            id: "opening-motion",
            assetId: motion,
            beatId: "opening",
            timelineStart: 4,
            timelineDuration: 3,
            sourceIn: 0,
            sourceOut: 3,
          },
          {
            id: "ending-photo",
            assetId: evening,
            beatId: "ending",
            timelineStart: 7,
            timelineDuration: 4,
          },
          {
            id: "ending-motion",
            assetId: motion,
            beatId: "ending",
            timelineStart: 11,
            timelineDuration: 3,
            sourceIn: 0,
            sourceOut: 3,
          },
        ],
      },
    ],
  });
  if (withAudio)
    app.project.timelines[0]!.tracks.push({
      id: "sound",
      type: "audio",
      clips: [
        {
          id: "opening-audio",
          assetId: assetId("05-tone.wav"),
          beatId: "opening",
          timelineStart: 0,
          timelineDuration: 2,
          sourceIn: 0,
          sourceOut: 2,
        },
      ],
    });
  app.close();
  expect(
    (
      await request.post(`${base}/api/project/open`, {
        data: { path: fixture.project },
      })
    ).ok(),
  ).toBe(true);
  return fixture;
}

async function editorState(request: APIRequestContext): Promise<EditorState> {
  const response = await request.get(
    `${base}/api/compositions/editing-cut/editor`,
  );
  expect(response.ok()).toBe(true);
  return response.json();
}

const clips = (state: EditorState) =>
  state.composition.tracks.flatMap((track) => track.clips);
const clipById = (state: EditorState, id: string) =>
  clips(state).find((clip) => clip.id === id)!;
const sourceEdits = ({ timelineStart: _timelineStart, ...clip }: Clip) => clip;

async function saved(page: Page) {
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
}

async function field(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press("Tab");
}

async function openTimeline(page: Page) {
  await initialLocale(page);
  await page.goto("/");
  await navigate(page, "edit");
  await expect(
    page.getByRole("heading", { name: "Make every moment count." }),
  ).toBeVisible();
  await saved(page);
}

// The fixture uses real FFmpeg media, the importer and SQLite. Every edit below
// goes through the browser controls, the HTTP editor and the project on disk.
test("edits, protects, shortens, renders and reopens an actual two-beat film", async ({
  page,
  request,
}) => {
  const fixture = await fixtureForEditing(request);
  await openTimeline(page);
  await expect
    .poll(() =>
      page
        .locator(".editor-clip img")
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);

  await page.locator("#clip-opening-photo").click();
  await page
    .getByRole("button", {
      name: "Set photo duration to 5 seconds",
      exact: true,
    })
    .click();
  await saved(page);
  expect(
    clipById(await editorState(request), "opening-photo").timelineDuration,
  ).toBe(5);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await saved(page);
  await expect(page.getByLabel("Photo duration", { exact: true })).toHaveValue(
    "4",
  );
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await saved(page);
  await expect(page.getByLabel("Photo duration", { exact: true })).toHaveValue(
    "5",
  );
  await page
    .getByRole("button", { name: "Move clip later", exact: true })
    .click();
  await saved(page);
  expect(
    clips(await editorState(request))
      .filter((clip) => clip.beatId === "opening")
      .map((clip) => clip.id),
  ).toEqual(["opening-motion", "opening-photo"]);

  await page.locator("#clip-opening-motion").click();
  await field(page, "Source in", "0.5");
  await field(page, "Source out", "2.5");
  await page
    .getByRole("button", { name: "Set speed to 2 times", exact: true })
    .click();
  const volume = page.getByLabel("Clip volume", { exact: true });
  await volume.focus();
  await volume.press("Home");
  for (let index = 0; index < 35; index++) await volume.press("ArrowRight");
  await page
    .getByLabel("Clip transition", { exact: true })
    .selectOption("crossfade");
  await field(page, "Crossfade duration", "0.25");
  await field(page, "Clip scale", "1.1");
  await saved(page);
  const editedMotion = clipById(await editorState(request), "opening-motion");
  expect(editedMotion).toMatchObject({
    sourceIn: 0.5,
    sourceOut: 2.5,
    timelineDuration: 1,
    transform: { speed: 2, volume: 0.35, scale: 1.1 },
    transition: { type: "crossfade", duration: 0.25 },
  });
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
    .toBeGreaterThan(0.5);
  expect(
    await source.evaluate((video) => ({
      speed: (video as HTMLVideoElement).playbackRate,
      volume: (video as HTMLVideoElement).volume,
    })),
  ).toEqual({ speed: 2, volume: 0.35 });
  await source.evaluate((video) => (video as HTMLVideoElement).pause());
  await page.getByRole("button", { name: "Lock clip", exact: true }).click();
  await saved(page);
  await expect(
    page.getByRole("button", { name: "Delete clip", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Source in", { exact: true })).toBeDisabled();
  const protectedMotion = sourceEdits(
    clipById(await editorState(request), "opening-motion"),
  );

  await page.locator("#clip-ending-photo").click();
  await field(page, "Photo duration", "6");
  await saved(page);
  await expect(
    page.getByLabel("Film duration feedback", { exact: true }),
  ).toContainText("over maximum");
  // Focus a timeline clip before shortcuts so ordinary form editing is left alone.
  await page.locator("#clip-ending-photo").click();
  await page.keyboard.press("Control+z");
  await saved(page);
  await expect(page.getByLabel("Photo duration", { exact: true })).toHaveValue(
    "4",
  );
  await page.keyboard.press("Control+Shift+z");
  await saved(page);
  await expect(page.getByLabel("Photo duration", { exact: true })).toHaveValue(
    "6",
  );
  const beforeRegeneration = await editorState(request);
  const endingEdits = clips(beforeRegeneration)
    .filter((clip) => clip.beatId === "ending")
    .map(sourceEdits);
  await page
    .getByRole("button", { name: "Edit beat The beginning", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Regenerate beat", exact: true })
    .click();
  await saved(page);
  const regenerated = await editorState(request);
  expect(
    clips(regenerated)
      .filter((clip) => clip.beatId === "ending")
      .map(sourceEdits),
  ).toEqual(endingEdits);
  expect(sourceEdits(clipById(regenerated, "opening-motion"))).toEqual(
    protectedMotion,
  );
  expect(
    clips(regenerated).filter((clip) => clip.beatId === "opening"),
  ).not.toEqual(
    clips(beforeRegeneration).filter((clip) => clip.beatId === "opening"),
  );

  await page
    .getByRole("button", { name: "Fit to target", exact: true })
    .click();
  const suggestions = page.getByRole("region", {
    name: "Shortening suggestions",
    exact: true,
  });
  await expect(
    suggestions.getByRole("button", { name: /^Apply suggestion:/ }).first(),
  ).toBeVisible();
  await suggestions
    .getByRole("button", { name: /^Apply suggestion:/ })
    .first()
    .click();
  await saved(page);
  expect((await editorState(request)).composition.duration).toBeLessThan(
    regenerated.composition.duration,
  );
  const applyAll = suggestions.getByRole("button", {
    name: "Apply all suggestions",
    exact: true,
  });
  if (await applyAll.isEnabled()) {
    await applyAll.click();
    await saved(page);
  }
  const fitted = await editorState(request);
  expect(fitted.composition.duration).toBeLessThanOrEqual(
    fitted.story.targetDuration! + 0.001,
  );
  expect(sourceEdits(clipById(fitted, "opening-motion"))).toEqual(
    protectedMotion,
  );
  expect(clipById(fitted, "ending-photo")).toBeDefined();
  await page.screenshot({
    path: test.info().outputPath("edited-timeline.png"),
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
  ).toBeCloseTo(fitted.composition.duration, 1);
  await preview.evaluate((video) => (video as HTMLVideoElement).play());
  await expect
    .poll(() =>
      preview.evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
  await preview.evaluate((video) => (video as HTMLVideoElement).pause());

  // Switching projects must flush an edit even before its debounce timer fires.
  await page.locator("#clip-ending-photo").click();
  await page.getByLabel("Photo duration", { exact: true }).fill("6.5");
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  await openFilm(page, fixture.project);
  await navigate(page, "edit");
  await saved(page);
  const reopened = await editorState(request);
  expect(clipById(reopened, "ending-photo").timelineDuration).toBe(6.5);
  expect(sourceEdits(clipById(reopened, "opening-motion"))).toEqual(
    protectedMotion,
  );
  expect(reopened.canUndo).toBe(false);
  const persisted = JSON.parse(
    await readFile(join(fixture.project, "project.json"), "utf8"),
  );
  expect(persisted.timelines[0]).toEqual(reopened.composition);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("retains a real conflicting draft through reload and reapplies it explicitly", async ({
  page,
  request,
}) => {
  const fixture = await fixtureForEditing(request);
  await openTimeline(page);
  const initial = await editorState(request);
  const remoteEdit = await request.post(
    `${base}/api/compositions/editing-cut/edit`,
    {
      data: {
        baseRevision: initial.revision,
        commands: [{ type: "volume", clipId: "ending-motion", volume: 0.2 }],
      },
    },
  );
  expect(remoteEdit.ok()).toBe(true);
  await page.locator("#clip-opening-photo").click();
  await page
    .getByRole("button", {
      name: "Set photo duration to 5 seconds",
      exact: true,
    })
    .click();
  await expect(page.getByText("Save conflict", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Photo duration", { exact: true })).toHaveValue(
    "5",
  );
  expect(
    clipById(await editorState(request), "opening-photo").timelineDuration,
  ).toBe(4);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await navigate(page, "edit");
  await expect(page.getByText("Save conflict", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Photo duration", { exact: true })).toHaveValue(
    "5",
  );
  await page
    .getByRole("button", { name: "Apply draft to latest", exact: true })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Review draft action",
  });
  await expect(
    confirmation.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply draft to latest", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Apply draft to latest", exact: true })
    .click();
  await page.keyboard.press("Delete");
  await expect(page.getByLabel("Photo duration", { exact: true })).toHaveValue(
    "5",
  );
  await confirmation
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await saved(page);
  const merged = await editorState(request);
  expect(clipById(merged, "opening-photo").timelineDuration).toBe(5);
  expect(clipById(merged, "ending-motion").transform?.volume).toBe(0.2);
  expect(
    JSON.parse(await readFile(join(fixture.project, "project.json"), "utf8"))
      .timelines[0],
  ).toEqual(merged.composition);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("acknowledges a recovered batch before retrying queued edits", async ({
  page,
  request,
}) => {
  const fixture = await fixtureForEditing(request);
  await openTimeline(page);
  const initial = await editorState(request);
  const firstCommand = { type: "delete", clipId: "opening-photo" } as const;
  const queuedCommand = {
    type: "volume",
    clipId: "ending-motion",
    volume: 0.25,
  } as const;
  const batch = {
    baseRevision: initial.revision,
    requestId: "44444444-4444-4444-8444-444444444444",
    commands: [firstCommand],
  };
  const committed = await request.post(
    base + "/api/compositions/editing-cut/edit",
    { data: batch },
  );
  expect(committed.ok()).toBe(true);
  const committedState = (await committed.json()) as EditorState;
  const concurrentEdit = await request.post(
    base + "/api/compositions/editing-cut/edit",
    {
      data: {
        baseRevision: committedState.revision,
        requestId: "55555555-5555-4555-8555-555555555555",
        commands: [
          { type: "volume", clipId: "ending-motion", volume: 0.15 },
        ],
      },
    },
  );
  expect(concurrentEdit.ok()).toBe(true);
  const concurrentState = (await concurrentEdit.json()) as EditorState;
  const projectResponse = await request.get(base + "/project");
  expect(projectResponse.ok()).toBe(true);
  const projectId = (await projectResponse.json()).project.id as string;
  const key = "openfilm:editor:" + projectId + ":editing-cut";
  await page.evaluate(
    ({ storageKey, draft }) =>
      localStorage.setItem(storageKey, JSON.stringify(draft)),
    {
      storageKey: key,
      draft: {
        state: initial,
        pending: [firstCommand, queuedCommand],
        batch,
      },
    },
  );
  const retriedEdits: Record<string, unknown>[] = [];
  page.on("request", (entry) => {
    if (
      entry.method() === "POST" &&
      new URL(entry.url()).pathname === "/api/compositions/editing-cut/edit"
    )
      retriedEdits.push(entry.postDataJSON() as Record<string, unknown>);
  });
  await page.reload();
  await navigate(page, "edit");
  await expect(page.getByText("Save conflict", { exact: true })).toBeVisible();
  expect(retriedEdits).toHaveLength(1);
  expect(retriedEdits[0]).toMatchObject(batch);
  await page
    .getByRole("button", { name: "Apply draft to latest", exact: true })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Review draft action",
  });
  await confirmation
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await saved(page);
  expect(retriedEdits).toHaveLength(2);
  expect(retriedEdits[1]?.commands).toEqual([queuedCommand]);
  expect(retriedEdits[1]?.requestId).not.toBe(batch.requestId);
  const recovered = await editorState(request);
  expect(recovered.revision).not.toBe(concurrentState.revision);
  expect(clips(recovered).some((clip) => clip.id === "opening-photo")).toBe(
    false,
  );
  expect(clipById(recovered, "ending-motion").transform?.volume).toBe(0.25);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("previews and skips Fit without saving, protects skipped clips, and switches editor language in place", async ({
  page,
  request,
}) => {
  await fixtureForEditing(request);
  await page.setViewportSize({ width: 1024, height: 768 });
  await openTimeline(page);
  await expect(
    page.getByLabel("Timeline inspector", { exact: true }),
  ).not.toBeVisible();
  await page.locator("#clip-opening-photo").click();
  await expect(
    page.getByLabel("Timeline inspector", { exact: true }),
  ).toBeVisible();
  const mountedEditor = await page.locator(".timeline-editor").elementHandle();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Done", exact: true }).focus();
  await page.keyboard.press("Delete");
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("#clip-opening-photo")).toBeVisible();
  await field(page, "Photo duration", "0");
  const error = page.locator(".editor-message[role='alert']");
  await expect(error).toBeVisible();
  const englishError = await error.innerText();
  await page.locator(".ui-language select").selectOption("zh-TW");
  await expect(
    page.getByRole("heading", { name: "讓每個片刻都有意義。" }),
  ).toBeVisible();
  await expect(error).not.toHaveText(englishError);
  await expect(page.getByLabel("照片時長", { exact: true })).toHaveValue("0");
  await expect(
    page.getByRole("button", {
      name: "編輯「The beginning」段落",
      exact: true,
    }),
  ).toBeVisible();
  await page.locator(".ui-language select").selectOption("ja-JP");
  await expect(
    page.getByRole("heading", { name: "一つひとつの瞬間を大切に。" }),
  ).toBeVisible();
  await expect(error).toContainText(
    "この変更は素材やストーリーの制限を超えています。",
  );
  expect(await mountedEditor!.evaluate((element) => element.isConnected)).toBe(
    true,
  );
  expect((await editorState(request)).story.beats[0]!.title).toBe(
    "The beginning",
  );
  await page.locator(".ui-language select").selectOption("en-US");
  await field(page, "Photo duration", "4");
  await saved(page);
  await page.locator("#clip-opening-motion").click();
  await page.getByRole("button", { name: "Lock clip", exact: true }).click();
  await saved(page);
  const before = await editorState(request);
  await page
    .getByRole("button", { name: "Fit to target", exact: true })
    .click();
  const photoSuggestions = page.locator(
    '.editor-suggestion[data-clip-id="opening-photo"]',
  );
  await photoSuggestions
    .first()
    .getByRole("button", { name: /^Preview suggestion/ })
    .click();
  await expect(page.locator(".editor-fit-preview")).toContainText(
    "Preview only",
  );
  await expect(page.locator(".editor-fit-preview")).toContainText(
    "Film: 00:14 → 00:11",
  );
  // Wait past autosave's debounce to prove Preview did not queue an edit.
  await page.waitForTimeout(500);
  expect(await editorState(request)).toEqual(before);
  await photoSuggestions
    .first()
    .getByRole("button", { name: /^Skip suggestions/ })
    .click();
  await expect(photoSuggestions).toHaveCount(0);
  await expect(page.locator(".editor-fit-preview")).not.toBeVisible();
  await expect(page.locator(".editor-fit-panel")).toContainText(
    "This plan leaves the film above the target",
  );
  await page
    .getByRole("button", { name: "Apply all suggestions", exact: true })
    .click();
  await saved(page);
  const after = await editorState(request);
  expect(after.composition.duration).toBe(11);
  for (const id of ["opening-photo", "opening-motion", "ending-photo"])
    expect(sourceEdits(clipById(after, id))).toEqual(
      sourceEdits(clipById(before, id)),
    );
  expect(clipById(after, "ending-motion")).toBeUndefined();
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await saved(page);
  expect((await editorState(request)).composition).toEqual(before.composition);
});

test("saves photo rotation through reopening and keeps visual controls absent for audio", async ({
  page,
  request,
}) => {
  const fixture = await fixtureForEditing(request, true);
  await openTimeline(page);
  await page.locator("#clip-opening-photo").click();
  await field(page, "Clip rotation", "90");
  await saved(page);
  expect(
    clipById(await editorState(request), "opening-photo").transform?.rotation,
  ).toBe(90);
  const persisted = JSON.parse(
    await readFile(join(fixture.project, "project.json"), "utf8"),
  );
  expect(persisted.timelines[0].tracks[0].clips[0].transform.rotation).toBe(90);
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  await openFilm(page, fixture.project);
  await navigate(page, "edit");
  await saved(page);
  await page.locator("#clip-opening-photo").click();
  await expect(page.getByLabel("Clip rotation", { exact: true })).toHaveValue(
    "90",
  );
  expect(
    clipById(await editorState(request), "opening-photo").transform?.rotation,
  ).toBe(90);
  await page.locator("#clip-opening-audio").click();
  await expect(page.getByLabel("Source in", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Clip volume", { exact: true })).toBeVisible();
  for (const label of [
    "Clip rotation",
    "Clip scale",
    "Clip position X",
    "Clip position Y",
    "Clip transition",
    "Playback speed",
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});
