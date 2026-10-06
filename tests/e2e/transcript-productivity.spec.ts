import { createHash, randomUUID } from "node:crypto";
import {
  cp,
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
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Response as PlaywrightResponse,
  type TestInfo,
} from "@playwright/test";
import type {
  Composition,
  GlossaryEntry,
  Job,
  MediaAsset,
  OpenFilmProject,
  ProjectContentLocale,
  ReviewBatch,
  TranscriptReviewSuggestion as ReviewSuggestion,
  Story,
  TranscriptCommand,
  TranscriptDocument,
  TranscriptRevision,
} from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import { OpenFilmApplication } from "@openfilm/application";
import { candidatesFromIntelligence } from "@openfilm/analysis";
import axe from "axe-core";
import {
  chooseImportFolder,
  createFilm,
  initialLocale,
  navigate,
  openFilm,
  uiText,
} from "./ui-helpers.js";

// All media processing, HTTP, jobs, SQLite revisions and browser interactions
// are real. The explicit server fixture returns predetermined transcript/review
// text: these tests make no ASR, AI, Resolve or GPU-quality claim.
const api = "http://127.0.0.1:4310/api";
const filename = "Spoken fixture 回憶 & #1.mp4";
const locales = ["en-US", "zh-TW", "ja-JP", "en-XA"] as const;
const sizes = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
let root: string;
let media: string;
let sourceHash: string;

interface TranscriptState {
  document?: TranscriptDocument;
  revision?: string;
  revisionInfo?: TranscriptRevision;
  total: number;
  offset: number;
  limit: number;
  canUndo: boolean;
  canRedo: boolean;
  acknowledgedRevision?: string;
}
interface SuggestionsState {
  suggestions: ReviewSuggestion[];
  total: number;
  offset: number;
  limit: number;
}
const t = (key: string, locale: ProjectContentLocale = "en-US") =>
  uiText(locale, `transcript.${key}`);
const workspace = (page: Page) => page.getByTestId("transcript-workspace");
const button = (page: Page, key: string) =>
  workspace(page).getByRole("button", { name: t(key), exact: true });
const rows = (page: Page) => page.getByTestId("transcript-row");
const field = (page: Page) => page.getByTestId("transcript-text");

test.use({ actionTimeout: 15_000, viewport: sizes[0] });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-transcript-browser-"));
  media = join(root, "Spoken memories 記憶");
  await mkdir(media);
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x455448:s=320x180:r=24:d=12",
    "-f",
    "lavfi",
    "-i",
    "flite=text='Our favorite memory starts here. We will remember this day.':voice=slt,apad=whole_dur=12",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-t",
    "12",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-y",
    join(media, filename),
  ]);
  sourceHash = createHash("sha256")
    .update(await readFile(join(media, filename)))
    .digest("hex");
});
test.beforeEach(async ({ request }) => closeProject(request));
test.afterEach(async ({ request }) => closeProject(request));
test.afterAll(async ({ request }) => {
  await closeProject(request);
  if (root) await rm(root, { recursive: true, force: true });
});

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${api}${path}`);
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json() as Promise<T>;
}
async function post<T>(
  request: APIRequestContext,
  path: string,
  data: unknown,
): Promise<T> {
  const response = await request.post(`${api}${path}`, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json() as Promise<T>;
}
async function closeProject(request: APIRequestContext) {
  const response = await request.post(`${api}/project/close`, { data: {} });
  if (response.ok()) return;
  expect(response.status()).toBe(409);
  const { jobs } = await get<{ jobs: Job[] }>(request, "/jobs");
  for (const job of jobs.filter((item) =>
    ["queued", "running"].includes(item.status),
  )) {
    const cancelled = await request.post(`${api}/jobs/${job.id}/cancel`, {
      data: {},
    });
    expect([200, 409]).toContain(cancelled.status());
  }
  await expect
    .poll(
      async () =>
        (await request.post(`${api}/project/close`, { data: {} })).status(),
      { timeout: 30_000 },
    )
    .toBe(200);
}
async function project(request: APIRequestContext) {
  return (await get<{ project: OpenFilmProject }>(request, "/project")).project;
}
async function transcript(
  request: APIRequestContext,
  id: string,
  offset = 0,
): Promise<TranscriptState> {
  return get(request, `/assets/${id}/transcript?offset=${offset}&limit=100`);
}
async function suggestions(
  request: APIRequestContext,
  id: string,
  status?: string,
): Promise<SuggestionsState> {
  return get(
    request,
    `/assets/${id}/review/suggestions?limit=100${status ? `&status=${status}` : ""}`,
  );
}
async function waitJob(
  request: APIRequestContext,
  id: string,
  status = "completed",
) {
  await expect
    .poll(
      async () => {
        const { jobs } = await get<{ jobs: Job[] }>(request, "/jobs");
        const job = jobs.find((item) => item.id === id);
        if (job?.status === "failed") throw new Error(JSON.stringify(job));
        return job?.status;
      },
      { timeout: 30_000 },
    )
    .toBe(status);
}
async function transcribe(request: APIRequestContext, id: string) {
  const { job } = await post<{ job: Job }>(
    request,
    `/assets/${id}/intelligence`,
    {
      operation: "transcribe",
      language: "en",
      execution: "cpu",
    },
  );
  await waitJob(request, job.id);
  const state = await transcript(request, id);
  expect(state.document?.provenance.model).toBe("fixture-protocol-not-asr");
  expect(state.total).toBe(2);
  return state;
}
async function edit(
  request: APIRequestContext,
  id: string,
  commands: TranscriptCommand[],
) {
  const state = await transcript(request, id);
  return post<TranscriptState>(request, `/assets/${id}/transcript/edit`, {
    baseRevision: state.revision,
    requestId: randomUUID(),
    commands,
  });
}
async function saved(page: Page) {
  await expect(page.getByTestId("transcript-save-state")).toHaveText(
    t("saved"),
  );
}
interface HeldTranscriptSave {
  packets: {
    baseRevision: string;
    requestId: string;
    commands: TranscriptCommand[];
  }[];
  responses: { status: number; body: string }[];
  release: () => void;
}
async function withHeldTranscriptSave(
  page: Page,
  assetId: string,
  run: (held: HeldTranscriptSave) => Promise<void>,
) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held: HeldTranscriptSave = { packets: [], responses: [], release };
  const reads = new Set<Promise<void>>();
  const pattern = `**/api/assets/${assetId}/transcript/edit`;
  const handler: Parameters<Page["route"]>[1] = (route) => {
    const read = (async () => {
      held.packets.push(route.request().postDataJSON());
      await gate;
      const response = await route.fetch();
      held.responses.push({
        status: response.status(),
        body: await response.text(),
      });
      await route.fulfill({ response });
    })();
    reads.add(read);
    return read.finally(() => reads.delete(read));
  };
  await page.route(pattern, handler);
  let failure: { error: unknown } | undefined;
  try {
    await run(held);
  } catch (error) {
    failure = { error };
  } finally {
    // Finish held writes before hooks close the project, including a failing
    // assertion. A cleanup error must not replace the original evidence.
    release();
    const cleanup = await Promise.allSettled([
      page.unroute(pattern, handler),
      ...reads,
    ]);
    for (const result of cleanup)
      if (result.status === "rejected" && !failure)
        failure = { error: result.reason };
  }
  if (failure) throw failure.error;
}
async function selectRow(page: Page, position = 0) {
  await rows(page).nth(position).locator(".transcript-row-select").click();
  await expect(field(page)).toBeVisible();
  await previewVisible(page);
}
async function previewVisible(page: Page) {
  await expect
    .poll(
      () =>
        page
          .getByTestId("transcript-source-preview")
          .locator("video")
          .evaluate((node) => {
            const player = node as HTMLVideoElement;
            return player.readyState >= 2 && !player.seeking;
          }),
      { message: "Source preview has a decoded frame after seeking" },
    )
    .toBe(true);
  await expect
    .poll(
      async () => {
        return workspace(page).evaluate((node) => {
          const video = node.querySelector<HTMLVideoElement>(
            ".transcript-player video",
          );
          const scroll = node.querySelector<HTMLElement>(".transcript-main");
          if (!video || !scroll)
            return { visible: false, reason: "No source player" };
          const frame = video.getBoundingClientRect();
          const viewport = {
            left: 0,
            top: 0,
            right: innerWidth,
            bottom: innerHeight,
          };
          const containers = [
            node.getBoundingClientRect(),
            scroll.getBoundingClientRect(),
            viewport,
          ];
          const left = Math.max(
            frame.left,
            ...containers.map((box) => box.left),
          );
          const top = Math.max(frame.top, ...containers.map((box) => box.top));
          const right = Math.min(
            frame.right,
            ...containers.map((box) => box.right),
          );
          const bottom = Math.min(
            frame.bottom,
            ...containers.map((box) => box.bottom),
          );
          // Require enough of the actual frame, including its lower control area,
          // to remain visible after selecting, searching or previewing text.
          const visible =
            frame.width >= 120 &&
            frame.height >= 100 &&
            right - left >= frame.width * 0.95 &&
            bottom - top >= frame.height * 0.95;
          return {
            visible,
            reason: visible
              ? ""
              : `Frame ${Math.round(frame.width)}x${Math.round(frame.height)}; visible ${Math.round(right - left)}x${Math.round(bottom - top)}`,
          };
        });
      },
      {
        message:
          "Source preview stays inside its scroll container and viewport",
      },
    )
    .toEqual({ visible: true, reason: "" });
}
async function typeText(page: Page, text: string) {
  await field(page).fill(text);
  await saved(page);
}
async function transcriptMode(
  page: Page,
  locale: ProjectContentLocale = "en-US",
) {
  await navigate(page, "edit", locale);
  await page
    .getByRole("group", {
      name: uiText(locale, "precision.modeLabel"),
      exact: true,
    })
    .getByRole("button", { name: t("mode", locale), exact: true })
    .click();
  await expect(workspace(page)).toBeVisible();
  await expect(
    page.getByTestId("transcript-source-preview").locator("video"),
  ).toBeVisible();
}
async function tools(page: Page, tab: "glossary" | "suggestions") {
  const show = button(page, "showTools");
  if (await show.isVisible()) await show.click();
  await page
    .locator(".transcript-tools > .editor-mode-switch")
    .getByRole("button", { name: t(tab), exact: true })
    .click();
}
async function addTerm(
  page: Page,
  source: string,
  replacement: string,
  scope: "global" | "project" = "project",
) {
  const panel = page.locator(".transcript-side-panel");
  await panel
    .getByRole("button", { name: t(`${scope}Scope`), exact: true })
    .click();
  await panel.getByLabel(t("sourceTerm"), { exact: true }).fill(source);
  await panel
    .getByLabel(t("replacementTerm"), { exact: true })
    .fill(replacement);
  await panel.getByRole("button", { name: t("addTerm"), exact: true }).click();
  await expect(
    page.getByTestId("glossary-entry").filter({ hasText: source }),
  ).toContainText(replacement);
}

async function prepareCut(request: APIRequestContext, asset: MediaAsset) {
  const { story } = await post<{ story: Story }>(request, "/stories", {
    title: "Keep spoken memories / 回憶 / 思い出",
    template: "blank",
    targetDuration: 8,
    maxDuration: 12,
    assetIds: [asset.id],
  });
  const response = await request.patch(`${api}/stories/${story.id}`, {
    data: {
      beats: story.beats.map((beat, index) => ({
        ...beat,
        selectedAssetIds: index === 0 ? [asset.id] : [],
      })),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const { composition } = await post<{ composition: Composition }>(
    request,
    "/compose",
    { storyId: story.id },
  );
  const clip = composition.tracks
    .flatMap((track) => track.clips)
    .find((item) => item.assetId === asset.id)!;
  expect(clip).toBeDefined();
  const state = await get<{ revision: string }>(
    request,
    `/compositions/${composition.id}/editor`,
  );
  await post(request, `/compositions/${composition.id}/edit`, {
    baseRevision: state.revision,
    requestId: randomUUID(),
    commands: [
      { type: "trim", clipId: clip.id, sourceIn: 1.1, sourceOut: 9.1 },
      { type: "lock", clipId: clip.id, locked: true },
    ],
  });
  const marked = await request.patch(`${api}/assets/${asset.id}`, {
    data: { state: { favorite: true, locked: true }, rating: 5 },
  });
  expect(marked.ok(), await marked.text()).toBe(true);
  return composition.id;
}
async function createSource(request: APIRequestContext, name: string) {
  const path = join(root, `${name}.openfilm`);
  await post(request, "/project/create", {
    title: name,
    path,
    projectContentLocale: "en-US",
    filmSettings: { templateId: "blank", targetDuration: 8, maxDuration: 12 },
  });
  const imported = await post<{ jobId: string }>(request, "/import", {
    folder: media,
  });
  await waitJob(request, imported.jobId);
  const { assets } = await get<{ assets: MediaAsset[] }>(
    request,
    "/assets?limit=100",
  );
  expect(assets).toHaveLength(1);
  const asset = assets[0]!;
  const compositionId = await prepareCut(request, asset);
  return { path, asset, compositionId };
}
async function immutableCut(
  request: APIRequestContext,
  id: string,
  compositionId: string,
) {
  const film = await project(request);
  const { assets } = await get<{ assets: MediaAsset[] }>(
    request,
    `/assets?ids=${id}&limit=100`,
  );
  const asset = assets.find((item) => item.id === id)!;
  const history = await get<{
    revision: string;
    canUndo: boolean;
    canRedo: boolean;
  }>(request, `/compositions/${compositionId}/editor`);
  return {
    stories: film.stories,
    timelines: film.timelines,
    state: asset.state,
    rating: asset.rating,
    history: {
      revision: history.revision,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    },
  };
}
async function unchangedSource() {
  expect(
    createHash("sha256")
      .update(await readFile(join(media, filename)))
      .digest("hex"),
  ).toBe(sourceHash);
}

test("offline transcript corrections, glossary decisions and cancelled retranscription persist without changing the film", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await initialLocale(page);
  await page.goto("/");
  const path = join(root, "Text corrections 回憶.openfilm");
  await createFilm(page, {
    title: "Text corrections 回憶",
    path,
    templateId: "blank",
    targetDuration: 8,
    maxDuration: 12,
  });
  await chooseImportFolder(page, media);
  await expect(
    page.getByText(uiText("en-US", "app.activity.import.complete"), {
      exact: true,
    }),
  ).toBeVisible({ timeout: 60_000 });
  const asset = (
    await get<{ assets: MediaAsset[] }>(request, "/assets?limit=100")
  ).assets[0]!;
  const compositionId = await prepareCut(request, asset);
  const baseline = await immutableCut(request, asset.id, compositionId);
  await page.reload();
  await transcriptMode(page);
  await expect(workspace(page)).toContainText(t("noTranscript"));
  await button(page, "transcribe").click();
  await expect(rows(page)).toHaveCount(2, { timeout: 30_000 });
  const original = await transcript(request, asset.id);
  expect(original.document?.provenance.model).toBe("fixture-protocol-not-asr");
  expect(
    original.document?.segments.every((segment) => segment.words?.length),
  ).toBe(true);
  await selectRow(page);
  await typeText(page, "Open Flim alpha memory. alpha");
  await expect(page.getByTestId("stale-alignment")).toBeVisible();
  await field(page).evaluate((node) =>
    (node as HTMLTextAreaElement).setSelectionRange(16, 16),
  );
  await button(page, "splitCursor").click();
  await expect(rows(page)).toHaveCount(3);
  await saved(page);
  const split = await transcript(request, asset.id);
  expect(split.document?.segments[0]?.timingSource).toBe("estimated");
  await button(page, "mergeNext").click();
  await expect(rows(page)).toHaveCount(2);
  await saved(page);
  await selectRow(page, 1);
  await typeText(page, "Open Flim alpha day.");
  const beforeReplace = await transcript(request, asset.id);
  await workspace(page).getByLabel(t("search"), { exact: true }).fill("alpha");
  await expect(page.getByTestId("transcript-search-status")).toHaveText(
    "3 matches",
  );
  await workspace(page)
    .getByLabel(t("replacement"), { exact: true })
    .fill("beta");
  await button(page, "replaceAll").click();
  await saved(page);
  await expect
    .poll(async () =>
      (await transcript(request, asset.id)).document?.segments.map(
        (segment) => segment.text,
      ),
    )
    .toEqual(
      beforeReplace.document?.segments.map((segment) =>
        segment.text.replaceAll("alpha", "beta"),
      ),
    );
  await button(page, "undo").click();
  await saved(page);
  expect((await transcript(request, asset.id)).document?.segments).toEqual(
    beforeReplace.document?.segments,
  );
  await button(page, "redo").click();
  await saved(page);
  await workspace(page).getByLabel(t("search"), { exact: true }).fill("");
  const edited = await transcript(request, asset.id);
  await selectRow(page, 1);
  const preview = page
    .getByTestId("transcript-source-preview")
    .locator("video");
  await expect
    .poll(() =>
      preview.evaluate((node) => (node as HTMLVideoElement).currentTime),
    )
    .toBeCloseTo(edited.document!.segments[1]!.start, 1);
  // Manual text disables word seeking/snapping; original evidence remains stored.
  await page
    .getByRole("group", {
      name: uiText("en-US", "precision.modeLabel"),
      exact: true,
    })
    .getByRole("button", {
      name: uiText("en-US", "precision.precisionMode"),
      exact: true,
    })
    .click();
  await expect(page.locator(".precision-words button")).toHaveCount(0);
  await expect(page.getByTestId("stale-alignment")).toHaveCount(2);
  expect(edited.document!.segments[1]!.words).toEqual(
    original.document!.segments[1]!.words,
  );
  const intelligence = await get<{ transcript: TranscriptDocument }>(
    request,
    `/assets/${asset.id}/intelligence?limit=100`,
  );
  const snapCandidates = candidatesFromIntelligence(
    [],
    intelligence.transcript,
  );
  expect(
    snapCandidates.filter((candidate) => candidate.type === "word"),
  ).toEqual([]);
  expect(
    snapCandidates.filter(
      (candidate) => candidate.type === "transcript-segment",
    ),
  ).toHaveLength(4);
  await transcriptMode(page);
  await tools(page, "glossary");
  let globalId: string | undefined;
  try {
    await addTerm(page, "Open Flim", "Global fixture name", "global");
    globalId = (
      await get<{ entries: GlossaryEntry[] }>(request, "/glossary?scope=global")
    ).entries.find((entry) => entry.source === "Open Flim")!.id;
    await addTerm(page, "Open Flim", "OpenFilm", "project");
    // An older project-scope response must not replace a newer Global view.
    await tools(page, "suggestions");
    let releaseGlossary!: () => void;
    let glossaryArrived!: () => void;
    let glossaryReturned!: () => void;
    const glossaryGate = new Promise<void>((resolve) => {
      releaseGlossary = resolve;
    });
    const glossaryStarted = new Promise<void>((resolve) => {
      glossaryArrived = resolve;
    });
    const glossaryFinished = new Promise<void>((resolve) => {
      glossaryReturned = resolve;
    });
    const glossaryPattern = "**/api/glossary?scope=project";
    await page.route(glossaryPattern, async (route) => {
      const response = await route.fetch();
      glossaryArrived();
      await glossaryGate;
      await route.fulfill({ response });
      glossaryReturned();
    });
    await tools(page, "glossary");
    await glossaryStarted;
    try {
      await page
        .locator(".transcript-side-panel")
        .getByRole("button", { name: t("globalScope"), exact: true })
        .click();
      await expect(page.getByTestId("glossary-entry")).toContainText(
        "Global fixture name",
      );
    } finally {
      releaseGlossary();
    }
    await glossaryFinished;
    await expect(page.getByTestId("glossary-entry")).toContainText(
      "Global fixture name",
    );
    await page.unroute(glossaryPattern);
    await page
      .locator(".transcript-side-panel")
      .getByRole("button", { name: t("projectScope"), exact: true })
      .click();
    await expect(page.getByTestId("glossary-entry")).toContainText("OpenFilm");
    await page
      .locator(".transcript-side-panel")
      .getByRole("button", { name: t("findMatches"), exact: true })
      .click();
    await expect(page.getByTestId("review-suggestion")).toHaveCount(2, {
      timeout: 15_000,
    });
    const proposed = await suggestions(request, asset.id, "pending");
    expect(
      proposed.suggestions.every(
        (item) =>
          item.after.includes("OpenFilm") &&
          !item.after.includes("Global fixture name"),
      ),
    ).toBe(true);
    const first = page.getByTestId("review-suggestion").first();
    await first
      .getByRole("button", { name: t("preview"), exact: true })
      .click();
    await previewVisible(page);
    const target = edited.document!.segments.find(
      (segment) => segment.id === proposed.suggestions[0]!.target.segmentId,
    )!;
    await expect
      .poll(() =>
        preview.evaluate((node) => (node as HTMLVideoElement).currentTime),
      )
      .toBeCloseTo(target.start, 1);
    await page
      .getByTestId("review-suggestion")
      .last()
      .getByRole("button", { name: t("skip"), exact: true })
      .click();
    await expect(page.getByTestId("review-suggestion")).toHaveCount(1);
    await first.getByRole("button", { name: t("accept"), exact: true }).click();
    await expect(page.getByTestId("review-suggestion")).toHaveCount(0);
    await saved(page);
    const corrected = await transcript(request, asset.id);
    expect(corrected.revisionInfo?.source).toBe("review-suggestion");
    expect(
      corrected.document?.segments.some((segment) =>
        segment.text.includes("OpenFilm"),
      ),
    ).toBe(true);
    await button(page, "undo").click();
    await saved(page);
    expect((await transcript(request, asset.id)).document?.segments).toEqual(
      edited.document?.segments,
    );
    await button(page, "redo").click();
    await saved(page);
    const kept = await transcript(request, asset.id);
    await workspace(page).locator(".transcript-transcribe > summary").click();
    await button(page, "retranscribe").click();
    await expect(
      workspace(page)
        .getByRole("alert")
        .filter({ hasText: t("retranscribeWarning") }),
    ).toBeVisible();
    await button(page, "continueTranscription").click();
    const cancel = workspace(page).getByRole("button", {
      name: uiText("en-US", "precision.cancelJob"),
      exact: true,
    });
    await expect(cancel).toBeVisible({ timeout: 10_000 });
    const job = (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.find(
      (item) =>
        item.assetId === asset.id &&
        ["queued", "running"].includes(item.status),
    )!;
    await cancel.click();
    await waitJob(request, job.id, "cancelled");
    expect((await transcript(request, asset.id)).document).toEqual(
      kept.document,
    );
    expect(await immutableCut(request, asset.id, compositionId)).toEqual(
      baseline,
    );
    await saved(page);
    await closeProject(request);
    await page.reload();
    await openFilm(page, path);
    await transcriptMode(page);
    expect((await transcript(request, asset.id)).document).toEqual(
      kept.document,
    );
    await tools(page, "glossary");
    await expect(page.getByTestId("glossary-entry")).toContainText("OpenFilm");
    const history = await suggestions(request, asset.id);
    expect(history.suggestions.map((item) => item.status).sort()).toEqual([
      "accepted",
      "skipped",
    ]);
    expect(await immutableCut(request, asset.id, compositionId)).toEqual(
      baseline,
    );
    await unchangedSource();
  } finally {
    if (globalId) {
      const removed = await request.delete(
        `${api}/glossary/${globalId}?scope=global`,
      );
      expect(removed.ok(), await removed.text()).toBe(true);
    }
  }
});

test("empty glossary replacements can be created, edited and accepted as an undoable deletion that survives reopening", async ({
  page,
  request,
}) => {
  const { path, asset, compositionId } = await createSource(
    request,
    "Deletion glossary",
  );
  const initial = await transcribe(request, asset.id);
  const originalText = "REMOVE ME";
  await edit(request, asset.id, [
    {
      type: "replace-text",
      segmentId: initial.document!.segments[0]!.id,
      text: originalText,
    },
    {
      type: "replace-text",
      segmentId: initial.document!.segments[1]!.id,
      text: "Keep the surviving memory.",
    },
  ]);
  const before = await transcript(request, asset.id);
  const baseline = await immutableCut(request, asset.id, compositionId);
  await initialLocale(page);
  await page.goto("/");
  await transcriptMode(page);
  await selectRow(page);
  await tools(page, "glossary");
  const panel = page.locator(".transcript-side-panel");
  const source = panel.getByLabel(t("sourceTerm"), { exact: true });
  const replacement = panel.getByLabel(t("replacementTerm"), { exact: true });
  await source.fill(originalText);
  await replacement.fill("");
  await expect(
    panel.getByRole("button", { name: t("addTerm"), exact: true }),
  ).toBeEnabled();
  await panel.getByRole("button", { name: t("addTerm"), exact: true }).click();
  const entry = page.getByTestId("glossary-entry");
  await expect(entry).toHaveCount(1);
  const created = (
    await get<{ entries: GlossaryEntry[] }>(request, "/glossary?scope=project")
  ).entries[0]!;
  expect(created.replacement).toBe("");
  // Update and resave the same term, including an empty value, without changing
  // its identity or creating a second rule.
  for (const value of ["Temporary correction", "", ""]) {
    await entry.locator(".transcript-term").click();
    await replacement.fill(value);
    await expect(
      panel.getByRole("button", { name: t("saveTerm"), exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole("button", { name: t("saveTerm"), exact: true })
      .click();
    await expect(source).toHaveValue("");
    const savedTerms = (
      await get<{ entries: GlossaryEntry[] }>(
        request,
        "/glossary?scope=project",
      )
    ).entries;
    expect(savedTerms).toHaveLength(1);
    expect(savedTerms[0]?.id).toBe(created.id);
    expect(savedTerms[0]?.replacement).toBe(value);
  }
  await panel
    .getByRole("button", { name: t("findMatches"), exact: true })
    .click();
  await expect(page.getByTestId("review-suggestion")).toHaveCount(1);
  const proposed = (await suggestions(request, asset.id, "pending"))
    .suggestions[0]!;
  expect(proposed.before).toBe(originalText);
  expect(proposed.after).toBe("");
  expect(proposed.target.segmentId).toBe(initial.document!.segments[0]!.id);
  await page
    .locator(`[data-suggestion-id="${proposed.id}"]`)
    .getByRole("button", { name: t("accept"), exact: true })
    .click();
  await saved(page);
  await expect(rows(page)).toHaveCount(1);
  const deleted = await transcript(request, asset.id);
  expect(deleted.document?.segments.map((segment) => segment.text)).toEqual([
    "Keep the surviving memory.",
  ]);
  await button(page, "undo").click();
  await saved(page);
  await expect(rows(page)).toHaveCount(2);
  expect((await transcript(request, asset.id)).document?.segments).toEqual(
    before.document?.segments,
  );
  await button(page, "redo").click();
  await saved(page);
  await expect(rows(page)).toHaveCount(1);
  const redone = await transcript(request, asset.id);
  expect(redone.document?.segments).toEqual(deleted.document?.segments);
  await page
    .getByRole("button", {
      name: uiText("en-US", "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await expect(page.locator(".launcher-actions")).toBeVisible();
  await openFilm(page, path);
  await transcriptMode(page);
  await expect(rows(page)).toHaveCount(1);
  expect((await transcript(request, asset.id)).document).toEqual(
    redone.document,
  );
  await tools(page, "glossary");
  await expect(entry).toHaveCount(1);
  await entry.locator(".transcript-term").click();
  await expect(replacement).toHaveValue("");
  expect(
    (
      await get<{ entries: GlossaryEntry[] }>(
        request,
        "/glossary?scope=project",
      )
    ).entries[0]?.replacement,
  ).toBe("");
  expect(
    (await suggestions(request, asset.id)).suggestions.find(
      (item) => item.id === proposed.id,
    )?.status,
  ).toBe("accepted");
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    baseline,
  );
  await unchangedSource();
});

test("editing disabled project and global glossary terms preserves their opt-out and excludes them from corrections", async ({
  page,
  request,
}) => {
  const { path, asset, compositionId } = await createSource(
    request,
    "Disabled glossary edits",
  );
  const initial = await transcribe(request, asset.id);
  await edit(request, asset.id, [
    {
      type: "replace-text",
      segmentId: initial.document!.segments[0]!.id,
      text: "disabled project phrase and disabled global phrase",
    },
  ]);
  const baseline = await immutableCut(request, asset.id, compositionId);
  const terms: GlossaryEntry[] = [];
  for (const scope of ["project", "global"] as const) {
    const { entry } = await post<{ entry: GlossaryEntry }>(
      request,
      "/glossary",
      {
        scope,
        source: `disabled ${scope} phrase`,
        replacement: `Original ${scope} correction`,
        enabled: false,
      },
    );
    terms.push(entry);
  }
  try {
    await initialLocale(page);
    await page.goto("/");
    await transcriptMode(page);
    await tools(page, "glossary");
    const panel = page.locator(".transcript-side-panel");
    for (const term of terms) {
      await panel
        .getByRole("button", { name: t(`${term.scope}Scope`), exact: true })
        .click();
      const entry = page
        .getByTestId("glossary-entry")
        .filter({ hasText: term.source });
      await expect(entry.getByRole("checkbox")).not.toBeChecked();
      await entry.locator(".transcript-term").click();
      await panel
        .getByLabel(t("replacementTerm"), { exact: true })
        .fill(`Edited ${term.scope} correction`);
      await panel
        .getByRole("button", { name: t("saveTerm"), exact: true })
        .click();
      await expect(
        panel.getByLabel(t("sourceTerm"), { exact: true }),
      ).toHaveValue("");
      await expect(entry.getByRole("checkbox")).not.toBeChecked();
      const stored = (
        await get<{ entries: GlossaryEntry[] }>(
          request,
          `/glossary?scope=${term.scope}`,
        )
      ).entries.find((item) => item.id === term.id)!;
      expect(stored.enabled).toBe(false);
      expect(stored.replacement).toBe(`Edited ${term.scope} correction`);
    }
    const effective = (
      await get<{ entries: GlossaryEntry[] }>(
        request,
        "/glossary?scope=effective",
      )
    ).entries;
    expect(
      effective.some((entry) => terms.some((term) => term.id === entry.id)),
    ).toBe(false);
    // New rules keep the normal enabled default, and the explicit checkbox
    // remains the action that changes whether the rule is active.
    await addTerm(page, "Unmatched enabled term", "New correction");
    const enabled = page
      .getByTestId("glossary-entry")
      .filter({ hasText: "Unmatched enabled term" })
      .getByRole("checkbox");
    await expect(enabled).toBeChecked();
    await enabled.uncheck();
    await expect(enabled).not.toBeChecked();
    await enabled.check();
    await expect(enabled).toBeChecked();
    const reviewRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/assets/${asset.id}/review` &&
        response.request().method() === "POST",
    );
    await panel
      .getByRole("button", { name: t("findMatches"), exact: true })
      .click();
    const { job } = (await (await reviewRead).json()) as { job: Job };
    await waitJob(request, job.id);
    expect((await suggestions(request, asset.id, "pending")).total).toBe(0);
    await expect(page.getByTestId("review-suggestion")).toHaveCount(0);
    await page
      .getByRole("button", {
        name: uiText("en-US", "app.navigation.switchProject"),
        exact: true,
      })
      .click();
    await expect(page.locator(".launcher-actions")).toBeVisible();
    await openFilm(page, path);
    await transcriptMode(page);
    await tools(page, "glossary");
    for (const term of terms) {
      await panel
        .getByRole("button", { name: t(`${term.scope}Scope`), exact: true })
        .click();
      await expect(
        page
          .getByTestId("glossary-entry")
          .filter({ hasText: term.source })
          .getByRole("checkbox"),
      ).not.toBeChecked();
    }
    expect(await immutableCut(request, asset.id, compositionId)).toEqual(
      baseline,
    );
    await unchangedSource();
  } finally {
    const global = terms.find((term) => term.scope === "global")!;
    const removed = await request.delete(
      `${api}/glossary/${global.id}?scope=global`,
    );
    expect(removed.ok(), await removed.text()).toBe(true);
  }
});

test("transcription completed before browser polling refreshes in place and later completion preserves a pending manual draft", async ({
  page,
  request,
}) => {
  const { asset, compositionId } = await createSource(
    request,
    "Fast completed transcription",
  );
  const baseline = await immutableCut(request, asset.id, compositionId);
  await initialLocale(page);
  await page.route("**/api/**", (route) => route.continue());
  await page.goto("/");
  await transcriptMode(page);
  const mounted = await workspace(page).elementHandle();
  const completed: TranscriptState[] = [];
  let jobsGate: Promise<void> | undefined;
  let releaseJobs: (() => void) | undefined;
  const observedStatuses: string[][] = [];
  const jobReads = new Set<Promise<void>>();
  function holdJobs() {
    jobsGate = new Promise<void>((resolve) => {
      releaseJobs = resolve;
    });
  }
  const jobsHandler: Parameters<Page["route"]>[1] = (route) => {
    const read = (async () => {
      if (jobsGate) await jobsGate;
      const response = await route.fetch();
      const body = await response.text();
      // Forward the actual response before validating its contract. A server
      // error remains visible to the application and fails with its evidence.
      await route.fulfill({ response });
      expect(response.ok(), `GET /api/jobs ${response.status()}: ${body}`).toBe(
        true,
      );
      const payload = JSON.parse(body) as { jobs?: Job[] };
      expect(Array.isArray(payload.jobs), `GET /api/jobs body: ${body}`).toBe(
        true,
      );
      observedStatuses.push(payload.jobs!.map((job) => job.status));
    })();
    jobReads.add(read);
    return read.finally(() => jobReads.delete(read));
  };
  await page.route("**/api/jobs", jobsHandler);
  let holdUntilCompleted = true;
  let backgroundJob: Job | undefined;
  await page.route(`**/api/assets/${asset.id}/intelligence`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const { job } = (await response.json()) as { job: Job };
    if (holdUntilCompleted) {
      await waitJob(request, job.id);
      completed.push(await transcript(request, asset.id));
      releaseJobs?.();
      jobsGate = undefined;
    } else backgroundJob = job;
    await route.fulfill({ response });
  });
  try {
    holdJobs();
    await expect(button(page, "transcribe")).toBeEnabled();
    await button(page, "transcribe").click();
    await expect(rows(page)).toHaveCount(2, { timeout: 15_000 });
    expect(completed).toHaveLength(1);
    expect(
      observedStatuses.flat().every((status) => status === "completed"),
    ).toBe(true);
    expect(await mounted!.evaluate((node) => node.isConnected)).toBe(true);
    await selectRow(page);
    await expect(field(page)).toHaveValue(
      completed[0]!.document!.segments[0]!.text,
    );
    await typeText(page, "Manual revision preserved before retranscription.");
    const manual = await transcript(request, asset.id);
    await workspace(page).locator(".transcript-transcribe > summary").click();
    await button(page, "retranscribe").click();
    await expect(workspace(page)).toContainText(t("retranscribeWarning"));
    holdJobs();
    const retranscriptionAck = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/assets/${asset.id}/intelligence` &&
        response.request().method() === "POST",
    );
    await button(page, "continueTranscription").click();
    expect((await retranscriptionAck).ok()).toBe(true);
    expect(completed).toHaveLength(2);
    await expect(field(page)).toHaveValue(
      completed[1]!.document!.segments[0]!.text,
      { timeout: 10_000 },
    );
    expect(await mounted!.evaluate((node) => node.isConnected)).toBe(true);
    expect(completed[1]?.revision).not.toBe(manual.revision);
    const historical = await get<TranscriptState>(
      request,
      `/assets/${asset.id}/transcript?revisionId=${manual.revision}&limit=100`,
    );
    expect(historical.document?.segments[0]?.text).toBe(
      "Manual revision preserved before retranscription.",
    );
    // Acknowledged running jobs allow normal text editing. Keep the completion
    // poll delayed until the real provider result exists, then enter a draft
    // against the prior revision before releasing that poll.
    holdUntilCompleted = false;
    await button(page, "retranscribe").click();
    await expect.poll(() => backgroundJob?.id).toBeDefined();
    await expect(field(page)).toBeEnabled();
    holdJobs();
    await waitJob(request, backgroundJob!.id);
    const providerCurrent = await transcript(request, asset.id);
    const draft = "A manual draft remains recoverable after completion.";
    await field(page).fill(draft);
    releaseJobs?.();
    jobsGate = undefined;
    await expect(page.getByTestId("transcript-save-state")).toHaveText(
      t("conflict"),
      { timeout: 10_000 },
    );
    await expect(field(page)).toHaveValue(draft);
    expect((await transcript(request, asset.id)).document).toEqual(
      providerCurrent.document,
    );
    await button(page, "discardDraft").click();
    await workspace(page)
      .locator(".transcript-confirm")
      .getByRole("button", { name: t("discardDraft"), exact: true })
      .click();
    await saved(page);
    await expect(field(page)).toHaveValue(
      providerCurrent.document!.segments[0]!.text,
    );
    expect(await immutableCut(request, asset.id, compositionId)).toEqual(
      baseline,
    );
    await unchangedSource();
  } finally {
    // Hooks close the real project before Playwright disposes its page. Stop
    // this test's interception and finish its held reads while it is still open.
    await page.unroute("**/api/jobs", jobsHandler);
    releaseJobs?.();
    jobsGate = undefined;
    await Promise.all([...jobReads]);
    await page.unroute(`**/api/assets/${asset.id}/intelligence`);
  }
});

test("a definitive missing acceptance on a restored project copy clears only that receipt and releases navigation", async ({
  page,
  request,
}) => {
  const { path, asset, compositionId } = await createSource(
    request,
    "Restored acceptance receipt",
  );
  const initial = await transcribe(request, asset.id);
  await edit(request, asset.id, [
    {
      type: "replace-text",
      segmentId: initial.document!.segments[0]!.id,
      text: "Open Flim restored memory.",
    },
  ]);
  const baseline = await immutableCut(request, asset.id, compositionId);
  const original = await project(request);
  const restoredPath = join(root, "Restored same identity.openfilm");
  await closeProject(request);
  await cp(path, restoredPath, { recursive: true });
  await post(request, "/project/open", { path });
  await post(request, "/glossary", {
    source: "Open Flim",
    replacement: "OpenFilm",
    scope: "project",
  });
  const { job } = await post<{ job: Job }>(
    request,
    `/assets/${asset.id}/review`,
    { source: "glossary" },
  );
  await waitJob(request, job.id);
  const target = (await suggestions(request, asset.id, "pending"))
    .suggestions[0]!;
  const key = `openfilm:review-accept:${original.id}:${asset.id}`;
  const packets: string[] = [];
  let loseResponse = true;
  const pattern = `**/api/review/suggestions/${target.id}/accept`;
  await initialLocale(page);
  await page.route("**/api/**", (route) => route.continue());
  await page.route(pattern, async (route) => {
    packets.push(route.request().postData()!);
    if (loseResponse) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto("/");
  await transcriptMode(page);
  await selectRow(page);
  await tools(page, "suggestions");
  await page
    .locator(`[data-suggestion-id="${target.id}"]`)
    .getByRole("button", { name: t("accept"), exact: true })
    .click();
  const recovery = page.getByTestId("review-acceptance-recovery");
  await expect(recovery).toBeVisible();
  const receipt = await page.evaluate(
    (storageKey) => localStorage.getItem(storageKey),
    key,
  );
  expect(receipt).toBeTruthy();
  // A second uncertain transport result must retain the exact packet even
  // though the original acceptance already committed successfully.
  await recovery
    .getByRole("button", { name: t("retryAcceptance"), exact: true })
    .click();
  await expect.poll(() => packets.length).toBe(2);
  await expect(recovery).toBeVisible();
  await expect(
    recovery.getByRole("button", { name: t("retryAcceptance"), exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key),
  ).toBe(receipt);
  await expect(field(page)).toBeDisabled();
  await expect(button(page, "hideTools")).toBeDisabled();
  // Restore the portable project while the app is closed, preserving browser
  // storage but avoiding live reads against the externally closed database.
  await page.goto("about:blank");
  await closeProject(request);
  await post(request, "/project/open", { path: restoredPath });
  expect((await project(request)).id).toBe(original.id);
  const restored = await transcript(request, asset.id);
  expect(restored.document?.segments[0]?.text).toBe(
    "Open Flim restored memory.",
  );
  expect((await suggestions(request, asset.id)).total).toBe(0);
  loseResponse = false;
  await page.goto("/");
  await transcriptMode(page);
  await selectRow(page);
  await tools(page, "suggestions");
  await expect(recovery).toBeVisible();
  const missingRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      `/api/review/suggestions/${target.id}/accept`,
  );
  await recovery
    .getByRole("button", { name: t("retryAcceptance"), exact: true })
    .click();
  const missing = await missingRead;
  expect(missing.status()).toBe(404);
  expect((await missing.json()).code).toBe("request.notFound");
  await expect(recovery).toHaveCount(0);
  expect(
    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key),
  ).toBeNull();
  expect(new Set(packets).size).toBe(1);
  await expect(field(page)).toBeEnabled();
  expect((await transcript(request, asset.id)).document).toEqual(
    restored.document,
  );
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    baseline,
  );
  await page
    .getByRole("group", {
      name: uiText("en-US", "precision.modeLabel"),
      exact: true,
    })
    .getByRole("button", {
      name: uiText("en-US", "precision.precisionMode"),
      exact: true,
    })
    .click();
  await expect(page.locator(".precision-editor")).toBeVisible();
  await page
    .getByRole("button", {
      name: uiText("en-US", "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await expect(page.locator(".launcher-actions")).toBeVisible();
  await unchangedSource();
});

test("opaque legacy transcript IDs preserve seeking, text edits, search and row keyboard focus through reopening", async ({
  page,
  request,
}) => {
  const { path, asset, compositionId } = await createSource(
    request,
    "Opaque legacy IDs",
  );
  const baseline = await immutableCut(request, asset.id, compositionId);
  const ids = [
    "provider-" + "長".repeat(350) + " %/#&",
    "provider-\u0000\u0001\t\n %/#&",
  ];
  await closeProject(request);
  // Explicit offline legacy document fixture. This validates imported identity
  // compatibility and browser controls; it is not an ASR provider result.
  const fixture = await OpenFilmApplication.open(path, {
    userDataDirectory: join(root, "opaque-fixture-user-data"),
  });
  try {
    const sourceHash = await fixture.intelligence.sourceIdentity(asset.id);
    fixture.catalog.intelligence.replaceTranscript({
      id: `opaque-fixture-${randomUUID()}`,
      assetId: asset.id,
      language: "en",
      provenance: {
        providerId: "fixture-opaque-legacy-identifiers",
        model: "identity-fixture-not-asr",
        version: "1",
        sourceHash,
        createdAt: new Date().toISOString(),
      },
      segments: ids.map((id, index) => ({
        id,
        start: 0.5 + index * 3,
        end: 2.5 + index * 3,
        text: index
          ? "Legacy NUL fixture memory."
          : "Legacy long identifier memory.",
      })),
    });
  } finally {
    fixture.close();
  }
  await post(request, "/project/open", { path });
  await initialLocale(page);
  await page.goto("/");
  await transcriptMode(page);
  await expect(rows(page)).toHaveCount(2);
  expect(
    await rows(page).evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.segmentId),
    ),
  ).toEqual(ids);
  const first = rows(page).nth(0).locator(".transcript-row-select");
  const second = rows(page).nth(1).locator(".transcript-row-select");
  await first.click();
  await previewVisible(page);
  await typeText(page, "Edited long identifier memory.");
  await first.focus();
  await first.press("ArrowDown");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-current", "true");
  await expect(field(page)).toHaveValue("Legacy NUL fixture memory.");
  await previewVisible(page);
  const preview = page
    .getByTestId("transcript-source-preview")
    .locator("video");
  await expect
    .poll(() =>
      preview.evaluate((node) => (node as HTMLVideoElement).currentTime),
    )
    .toBeCloseTo(3.5, 1);
  await second.press("ArrowUp");
  await expect(first).toBeFocused();
  await expect(field(page)).toHaveValue("Edited long identifier memory.");
  await first.press("Tab");
  await expect(second).toBeFocused();
  await second.press("Shift+Tab");
  await expect(first).toBeFocused();
  await first.press("Enter");
  await expect(field(page)).toBeFocused();
  await field(page).press("Control+f");
  const search = workspace(page).getByLabel(t("search"), { exact: true });
  await expect(search).toBeFocused();
  const searchRead = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === `/api/assets/${asset.id}/transcript/search` &&
      url.searchParams.get("query") === "Legacy NUL fixture"
    );
  });
  await search.fill("Legacy NUL fixture");
  const searchResult = (await (await searchRead).json()) as {
    matches: { segmentId: string }[];
  };
  expect(searchResult.matches.map((match) => match.segmentId)).toEqual([
    ids[1],
  ]);
  await expect(page.getByTestId("transcript-search-status")).toHaveText(
    "1 match",
  );
  await button(page, "nextMatch").click();
  await expect(field(page)).toHaveValue("Legacy NUL fixture memory.");
  await previewVisible(page);
  await expect
    .poll(() =>
      preview.evaluate((node) => (node as HTMLVideoElement).currentTime),
    )
    .toBeCloseTo(3.5, 1);
  await typeText(page, "Edited NUL identifier memory.");
  await search.fill("");
  await button(page, "undo").click();
  await saved(page);
  await expect(field(page)).toHaveValue("Legacy NUL fixture memory.");
  await button(page, "redo").click();
  await saved(page);
  await expect(field(page)).toHaveValue("Edited NUL identifier memory.");
  for (const [position, id] of ids.entries()) {
    const found = await get<{
      segment: { id: string; text: string };
      position: number;
    }>(
      request,
      `/assets/${asset.id}/transcript/segments/${encodeURIComponent(id)}`,
    );
    expect(found.position).toBe(position);
    expect(found.segment.id).toBe(id);
    expect(found.segment.text).toBe(
      position
        ? "Edited NUL identifier memory."
        : "Edited long identifier memory.",
    );
  }
  await page
    .getByRole("button", {
      name: uiText("en-US", "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await expect(page.locator(".launcher-actions")).toBeVisible();
  await openFilm(page, path);
  await transcriptMode(page);
  expect(
    await rows(page).evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.segmentId),
    ),
  ).toEqual(ids);
  await first.click();
  await first.press("Tab");
  await expect(second).toBeFocused();
  await expect(field(page)).toHaveValue("Edited NUL identifier memory.");
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    baseline,
  );
  await unchangedSource();
});

test("lost edit responses retry one receipt and conflicting drafts preserve server text and independent input history", async ({
  page,
  request,
}) => {
  const { asset, compositionId } = await createSource(
    request,
    "Receipt recovery",
  );
  const initial = await transcribe(request, asset.id);
  const baseline = await immutableCut(request, asset.id, compositionId);
  await initialLocale(page);
  await page.goto("/");
  await transcriptMode(page);
  await selectRow(page);
  const receipts: string[] = [];
  let loseResponse = true;
  await page.route(
    `**/api/assets/${asset.id}/transcript/edit`,
    async (route) => {
      receipts.push(
        (route.request().postDataJSON() as { requestId: string }).requestId,
      );
      if (loseResponse) {
        loseResponse = false;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await field(page).fill("Recovered receipt keeps this text.");
  await expect(page.getByTestId("transcript-save-state")).toHaveText(
    t("failed"),
  );
  const committed = await transcript(request, asset.id);
  expect(committed.document!.segments[0]!.text).toBe(
    "Recovered receipt keeps this text.",
  );
  await button(page, "retrySave").click();
  await saved(page);
  expect(new Set(receipts).size).toBe(1);
  expect(receipts.length).toBeGreaterThanOrEqual(2);
  expect((await transcript(request, asset.id)).revision).toBe(
    committed.revision,
  );
  const revisions = await get<{
    revisions: TranscriptRevision[];
    total: number;
  }>(request, `/assets/${asset.id}/transcript/revisions?limit=100`);
  expect(revisions.total).toBe(2);
  await page.unroute(`**/api/assets/${asset.id}/transcript/edit`);
  // A saved receipt's follow-up read can overlap later typing. Keep the later
  // command suffix while replacing the acknowledged prefix with server data.
  let releaseRead!: () => void;
  let readArrived!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const readStarted = new Promise<void>((resolve) => {
    readArrived = resolve;
  });
  let holdRead = true;
  await page.route(`**/api/assets/${asset.id}/transcript?*`, async (route) => {
    if (!holdRead) return route.continue();
    holdRead = false;
    const response = await route.fetch();
    readArrived();
    await readGate;
    await route.fulfill({ response });
  });
  await field(page).fill("First acknowledged text.");
  await readStarted;
  await field(page).fill("Later typing survives the delayed saved read.");
  releaseRead();
  await saved(page);
  await expect
    .poll(
      async () =>
        (await transcript(request, asset.id)).document?.segments[0]?.text,
    )
    .toBe("Later typing survives the delayed saved read.");
  await page.unroute(`**/api/assets/${asset.id}/transcript?*`);
  const afterRead = await transcript(request, asset.id);
  // Ctrl+Z in a search input must use native input history, never transcript history.
  const search = workspace(page).getByLabel(t("search"), { exact: true });
  await search.fill("Recovered");
  await search.press("Control+z");
  expect((await transcript(request, asset.id)).revision).toBe(
    afterRead.revision,
  );
  await search.fill("");
  const external = await edit(request, asset.id, [
    {
      type: "replace-text",
      segmentId: initial.document!.segments[0]!.id,
      text: "Newer server text stays safe.",
    },
  ]);
  await field(page).fill("My conflicting local draft remains recoverable.");
  await expect(page.getByTestId("transcript-save-state")).toHaveText(
    t("conflict"),
  );
  expect((await transcript(request, asset.id)).revision).toBe(
    external.revision,
  );
  await expect(field(page)).toHaveValue(
    "My conflicting local draft remains recoverable.",
  );
  await page.reload();
  await transcriptMode(page);
  await selectRow(page);
  await expect(page.getByTestId("transcript-save-state")).toHaveText(
    t("conflict"),
  );
  await expect(field(page)).toHaveValue(
    "My conflicting local draft remains recoverable.",
  );
  await button(page, "discardDraft").click();
  await expect(workspace(page)).toContainText(t("discardDraftConfirm"));
  await workspace(page)
    .locator(".transcript-confirm")
    .getByRole("button", { name: t("discardDraft"), exact: true })
    .click();
  await saved(page);
  await expect(field(page)).toHaveValue("Newer server text stays safe.");
  await typeText(page, "Keyboard undo changes only transcript text.");
  await field(page).press("Control+z");
  await saved(page);
  await expect(field(page)).toHaveValue("Newer server text stays safe.");
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    baseline,
  );
  await unchangedSource();
});

test("delayed suggestion acceptance guards typing and waits before changing modes or closing the film", async ({
  page,
  request,
}) => {
  const { path, asset, compositionId } = await createSource(
    request,
    "Acceptance guard",
  );
  const initial = await transcribe(request, asset.id);
  await edit(
    request,
    asset.id,
    initial.document!.segments.map((segment, index) => ({
      type: "replace-text",
      segmentId: segment.id,
      text: `Open Flim memory ${index + 1}.`,
    })),
  );
  await post(request, "/glossary", {
    source: "Open Flim",
    replacement: "OpenFilm",
    scope: "project",
  });
  const baseline = await immutableCut(request, asset.id, compositionId);
  await initialLocale(page);
  // Keep interception enabled while specific held/lost-response handlers come
  // and go. Requests still reach the real API with their original contents.
  await page.route("**/api/**", (route) => route.continue());
  await page.goto("/");
  await transcriptMode(page);
  await selectRow(page);
  await tools(page, "suggestions");
  for (const action of ["mode", "close"] as const) {
    await tools(page, "suggestions");
    const generationPattern = `**/api/assets/${asset.id}/review`;
    let releaseGeneration: (() => void) | undefined;
    let generationReceived = false;
    if (action === "close") {
      await expect(
        page.getByTestId("review-suggestion").first(),
      ).toHaveAttribute("data-status", "stale");
      const gate = new Promise<void>((resolve) => {
        releaseGeneration = resolve;
      });
      await page.route(generationPattern, async (route) => {
        generationReceived = true;
        await gate;
        await route.continue();
      });
    }
    const reviewResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/assets/${asset.id}/review` &&
        response.request().method() === "POST",
    );
    try {
      await button(page, "findMatches").click();
      if (action === "close") {
        await expect
          .poll(() => generationReceived, {
            message: "Regeneration is pending before reaching the backend",
          })
          .toBe(true);
        // The prior first row is still visible but stale. A positional locator
        // could capture this ID and later click a different pending first row.
        await expect(
          page.getByTestId("review-suggestion").first(),
        ).toHaveAttribute("data-status", "stale");
        await expect(
          page.getByTestId("review-suggestion").getByRole("button", {
            name: t("accept"),
            exact: true,
          }),
        ).toHaveCount(0);
      }
    } finally {
      releaseGeneration?.();
    }
    const response = await reviewResponse;
    // Keep the resolved route through the page's lifetime. Removing the last
    // route while run() dispatches its refresh toggles Chromium interception
    // and can strand those reads; later timer polls would hide the lost read.
    expect(response.ok()).toBe(true);
    const { job } = (await response.json()) as { job: Job };
    await waitJob(request, job.id);
    const candidate = page
      .getByTestId("review-suggestion")
      .filter({
        has: page.getByRole("button", { name: t("accept"), exact: true }),
      })
      .first();
    await expect(candidate).toBeVisible({
      timeout: 10_000,
    });
    const id = (await candidate.getAttribute("data-suggestion-id"))!;
    // Polling can replace a positional first() row. The interception and click
    // must both refer to the same durable suggestion rather than its position.
    const suggestion = page.locator(`[data-suggestion-id="${id}"]`);
    expect(
      (await suggestions(request, asset.id, "pending")).suggestions.some(
        (item) => item.id === id,
      ),
    ).toBe(true);
    let release!: () => void;
    let received = false;
    let committed: { ok: boolean; status: number; detail: string } | undefined;
    let failed: string | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pattern = `**/api/review/suggestions/${id}/accept`;
    await page.route(pattern, async (route) => {
      received = true;
      try {
        const response = await route.fetch();
        committed = {
          ok: response.ok(),
          status: response.status(),
          detail: await response.text(),
        };
        await gate;
        await route.fulfill({ response });
      } catch (cause) {
        failed = String(cause);
        await route.abort("failed");
      }
    });
    const before = await field(page).inputValue();
    try {
      await expect(
        suggestion.getByRole("button", { name: t("accept"), exact: true }),
      ).toBeEnabled({ timeout: 10_000 });
      await suggestion
        .getByRole("button", { name: t("accept"), exact: true })
        .click();
      await expect
        .poll(() => received, {
          message: `${action}: Accept sends its durable receipt`,
          timeout: 15_000,
        })
        .toBe(true);
      await expect
        .poll(() => committed ?? failed, {
          message: `${action}: Accept reaches the backend before guarding navigation`,
          timeout: 15_000,
        })
        .not.toBeUndefined();
      expect(failed, `${action}: acceptance transport`).toBeUndefined();
      expect(committed?.ok, JSON.stringify(committed)).toBe(true);
      await expect(field(page)).toBeDisabled();
      await expect(page.getByTestId("transcript-source-picker")).toBeDisabled();
      await expect(button(page, "hideTools")).toBeDisabled();
      await field(page).evaluate((node) =>
        (node as HTMLTextAreaElement).focus(),
      );
      await page.keyboard.type("This cannot replace a reviewed correction.");
      await expect(field(page)).toHaveValue(before);
      if (action === "mode") {
        await page
          .getByRole("group", {
            name: uiText("en-US", "precision.modeLabel"),
            exact: true,
          })
          .getByRole("button", {
            name: uiText("en-US", "precision.precisionMode"),
            exact: true,
          })
          .click();
      } else {
        await page
          .getByRole("button", {
            name: uiText("en-US", "app.navigation.switchProject"),
            exact: true,
          })
          .click();
      }
      await expect(workspace(page)).toBeVisible();
      expect((await project(request)).id).toBeDefined();
    } finally {
      release();
    }
    if (action === "mode") {
      await expect(page.locator(".precision-editor")).toBeVisible();
      await transcriptMode(page);
      await saved(page);
    } else {
      await expect(page.locator(".launcher-actions")).toBeVisible();
      await openFilm(page, path);
      await transcriptMode(page);
    }
    await page.unroute(pattern);
  }
  expect(
    (await transcript(request, asset.id)).document?.segments.every((segment) =>
      segment.text.startsWith("OpenFilm"),
    ),
  ).toBe(true);
  // Losing an Accept response after its SQLite commit must leave a reachable
  // receipt retry even though the accepted suggestion disappears from pending.
  await post(request, "/glossary", {
    source: "memory",
    replacement: "remembered memory",
    scope: "project",
  });
  await tools(page, "suggestions");
  await button(page, "findMatches").click();
  await expect(
    page.getByTestId("review-suggestion").filter({
      has: page.getByRole("button", { name: t("accept"), exact: true }),
    }),
  ).toHaveCount(2);
  const pending = (await suggestions(request, asset.id, "pending")).suggestions;
  const target = pending[0]!;
  const beforeRecovery = await get<{ total: number }>(
    request,
    `/assets/${asset.id}/transcript/revisions?limit=100`,
  );
  const acceptPattern = `**/api/review/suggestions/${target.id}/accept`;
  const acceptReceipts: string[] = [];
  let loseAccept = true;
  await page.route(acceptPattern, async (route) => {
    acceptReceipts.push(
      (route.request().postDataJSON() as { requestId: string }).requestId,
    );
    if (loseAccept) {
      loseAccept = false;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .locator(`[data-suggestion-id="${target.id}"]`)
    .getByRole("button", { name: t("accept"), exact: true })
    .click();
  const recovery = page.getByTestId("review-acceptance-recovery");
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: t("retryAcceptance"), exact: true })
    .click();
  await expect(recovery).toHaveCount(0);
  expect(acceptReceipts.length).toBeGreaterThanOrEqual(2);
  expect(new Set(acceptReceipts).size).toBe(1);
  const afterRecovery = await get<{ total: number }>(
    request,
    `/assets/${asset.id}/transcript/revisions?limit=100`,
  );
  expect(afterRecovery.total).toBe(beforeRecovery.total + 1);
  await page.unroute(acceptPattern);
  const recovered = await transcript(request, asset.id);
  const position = recovered.document!.segments.findIndex(
    (segment) => segment.id === target.target.segmentId,
  );
  await selectRow(page, position);
  await expect(field(page)).toHaveValue(target.after);
  await typeText(page, "Final reviewed correction keeps durable receipts.");
  expect(
    (await transcript(request, asset.id)).document?.segments[position]?.text,
  ).toBe("Final reviewed correction keeps durable receipts.");
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    baseline,
  );
  await unchangedSource();
});

test("rapid acceptance during a held manual save reserves one receipt and rejects old suggestions without stranding navigation", async ({
  page,
  request,
}) => {
  await page.setViewportSize(sizes[2]!);
  const { path, asset, compositionId } = await createSource(
    request,
    "Reserved acceptance preflight",
  );
  const initial = await transcribe(request, asset.id);
  await edit(
    request,
    asset.id,
    initial.document!.segments.map((segment, index) => ({
      type: "replace-text",
      segmentId: segment.id,
      text: `Open Flim memory ${index + 1}.`,
    })),
  );
  await post(request, "/glossary", {
    source: "Open Flim",
    replacement: "OpenFilm",
    scope: "project",
  });
  const generated = await post<{ job: Job }>(
    request,
    `/assets/${asset.id}/review`,
    { source: "glossary" },
  );
  await waitJob(request, generated.job.id);
  const pending = (await suggestions(request, asset.id, "pending")).suggestions;
  expect(pending).toHaveLength(2);
  const before = await transcript(request, asset.id);
  const revisionsBefore = await get<{ total: number }>(
    request,
    `/assets/${asset.id}/transcript/revisions?limit=100`,
  );
  const projectId = (await project(request)).id;
  const baseline = await immutableCut(request, asset.id, compositionId);
  await initialLocale(page);
  await page.route("**/api/**", (route) => route.continue());
  await page.goto("/");
  await transcriptMode(page);
  await selectRow(page);
  await tools(page, "suggestions");
  const accepts = pending.map((suggestion) =>
    page
      .locator(`[data-suggestion-id="${suggestion.id}"]`)
      .getByRole("button", { name: t("accept"), exact: true }),
  );
  for (const accept of accepts) {
    await expect(accept).toBeEnabled();
    await expect(accept).toBeInViewport();
  }
  const acceptPattern = "**/api/review/suggestions/*/accept";
  const transmissions: {
    id: string;
    packet: { baseRevision: string; requestId: string };
    status: number;
    body: string;
  }[] = [];
  const acceptReads = new Set<Promise<void>>();
  const acceptHandler: Parameters<Page["route"]>[1] = (route) => {
    const read = (async () => {
      const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
      const packet = route.request().postDataJSON();
      const response = await route.fetch();
      transmissions.push({
        id,
        packet,
        status: response.status(),
        body: await response.text(),
      });
      await route.fulfill({ response });
    })();
    acceptReads.add(read);
    return read.finally(() => acceptReads.delete(read));
  };
  await page.route(acceptPattern, acceptHandler);
  const manual = "Open Flim manual wording survives an obsolete suggestion.";
  let secondDisabled = false;
  let switchDisabled = false;
  try {
    await withHeldTranscriptSave(page, asset.id, async (held) => {
      await field(page).fill(manual);
      await expect.poll(() => held.packets.length).toBe(1);
      expect(held.packets[0]?.baseRevision).toBe(before.revision);
      expect((await transcript(request, asset.id)).revision).toBe(
        before.revision,
      );
      const boxes = await Promise.all(
        accepts.map((accept) => accept.boundingBox()),
      );
      for (const box of boxes) expect(box).not.toBeNull();
      // Native pointer events obey disabled controls. Both suggestions are
      // clicked while the same real save is still held before server arrival.
      for (const box of boxes)
        await page.mouse.click(
          box!.x + box!.width / 2,
          box!.y + box!.height / 2,
        );
      secondDisabled = await accepts[1]!.isDisabled();
      expect(transmissions).toEqual([]);
      const switchProject = page.getByRole("button", {
        name: uiText("en-US", "app.navigation.switchProject"),
        exact: true,
      });
      switchDisabled = await switchProject.isDisabled();
      const switchBox = await switchProject.boundingBox();
      expect(switchBox).not.toBeNull();
      await page.mouse.click(
        switchBox!.x + switchBox!.width / 2,
        switchBox!.y + switchBox!.height / 2,
      );
      await expect(workspace(page)).toBeVisible();
      expect((await project(request)).id).toBe(projectId);
      held.release();
      await expect.poll(() => held.responses.length).toBe(1);
      expect(held.responses[0]?.status, held.responses[0]?.body).toBe(200);
      await expect.poll(() => transmissions.length).toBe(1);
      expect(transmissions[0]?.status, transmissions[0]?.body).toBe(409);
      expect([
        "review.suggestionStale",
        "transcript.revisionConflict",
      ]).toContain(JSON.parse(transmissions[0]!.body).code);
      await expect
        .poll(() =>
          page.evaluate(
            (key) => localStorage.getItem(key),
            `openfilm:review-accept:${projectId}:${asset.id}`,
          ),
        )
        .toBeNull();
      if (switchDisabled) await switchProject.click();
      await expect(page.locator(".launcher-actions")).toBeVisible();
    });
  } finally {
    await page.unroute(acceptPattern, acceptHandler);
    await Promise.all([...acceptReads]);
  }
  expect(secondDisabled).toBe(true);
  expect(transmissions[0]?.id).toBe(pending[0]?.id);
  await openFilm(page, path);
  await transcriptMode(page);
  await selectRow(page);
  await expect(field(page)).toHaveValue(manual);
  const current = await transcript(request, asset.id);
  expect(transmissions[0]?.packet.baseRevision).toBe(current.revision);
  expect(
    (await suggestions(request, asset.id)).suggestions.every(
      (suggestion) => suggestion.status === "stale",
    ),
  ).toBe(true);
  expect(
    (
      await get<{ total: number }>(
        request,
        `/assets/${asset.id}/transcript/revisions?limit=100`,
      )
    ).total,
  ).toBe(revisionsBefore.total + 1);
  await tools(page, "suggestions");
  await expect(page.getByTestId("review-acceptance-recovery")).toHaveCount(0);
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    baseline,
  );
  await unchangedSource();
});

test("retrying a cancelled review saves the manual draft first and rejects the old batch before another provider attempt", async ({
  page,
  request,
}) => {
  const { asset, compositionId } = await createSource(
    request,
    "Review retry preflight",
  );
  const initial = await transcribe(request, asset.id);
  await edit(request, asset.id, [
    {
      type: "replace-text",
      segmentId: initial.document!.segments[0]!.id,
      text: "Fixture line 050 waits for an explicitly synthetic review.",
    },
  ]);
  const before = await transcript(request, asset.id);
  const baseline = await immutableCut(request, asset.id, compositionId);
  await initialLocale(page);
  await page.route("**/api/**", (route) => route.continue());
  await page.goto("/");
  await transcriptMode(page);
  await selectRow(page);
  await tools(page, "suggestions");
  const reviewAck = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/assets/${asset.id}/review` &&
      response.request().method() === "POST",
  );
  await button(page, "languageReview").click();
  const ack = await reviewAck;
  expect(ack.ok()).toBe(true);
  const { job } = (await ack.json()) as { job: Job };
  await expect(button(page, "cancelReview")).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await get<{ batches: ReviewBatch[] }>(
            request,
            `/review/jobs/${job.id}/batches`,
          )
        ).batches[0]?.status,
    )
    .toBe("running");
  await button(page, "cancelReview").click();
  await waitJob(request, job.id, "cancelled");
  const recovery = page.locator(
    `[data-testid="review-recovery-batch"][data-job-id="${job.id}"][data-batch-index="0"]`,
  );
  await expect(recovery).toHaveAttribute("data-batch-status", "cancelled");
  const retained = await get<{ batches: ReviewBatch[] }>(
    request,
    `/review/jobs/${job.id}/batches`,
  );
  expect(retained.batches).toHaveLength(1);
  expect(retained.batches[0]?.attempts).toBe(1);
  const retryPattern = `**/api/review/jobs/${job.id}/batches/0/retry`;
  const retryResponses: {
    status: number;
    body: string;
    saveAcknowledged: boolean;
  }[] = [];
  const retryReads = new Set<Promise<void>>();
  let retryArrived = false;
  let activeSave: HeldTranscriptSave | undefined;
  const retryHandler: Parameters<Page["route"]>[1] = (route) => {
    retryArrived = true;
    const acknowledged =
      activeSave?.responses.some((response) => response.status === 200) ??
      false;
    const read = (async () => {
      const response = await route.fetch();
      retryResponses.push({
        status: response.status(),
        body: await response.text(),
        saveAcknowledged: acknowledged,
      });
      await route.fulfill({ response });
    })();
    retryReads.add(read);
    return read.finally(() => retryReads.delete(read));
  };
  await page.route(retryPattern, retryHandler);
  const manual = "Manual wording changes the revision before a review retry.";
  try {
    await withHeldTranscriptSave(page, asset.id, async (held) => {
      activeSave = held;
      await field(page).fill(manual);
      await expect.poll(() => held.packets.length).toBe(1);
      await recovery
        .getByRole("button", { name: t("retryBatch"), exact: true })
        .click();
      expect(retryArrived).toBe(false);
      expect((await transcript(request, asset.id)).revision).toBe(
        before.revision,
      );
      // The held response marker observes a real successful save, rather than
      // predicting whether the editor will flush its queued draft.
      held.release();
      await expect.poll(() => held.responses.length).toBe(1);
      expect(held.responses[0]?.status, held.responses[0]?.body).toBe(200);
      await expect.poll(() => retryResponses.length).toBe(1);
      expect(retryResponses[0]?.status, retryResponses[0]?.body).toBe(202);
      expect(JSON.parse(retryResponses[0]!.body).job).toMatchObject({
        id: job.id,
        status: "queued",
      });
    });
  } finally {
    await page.unroute(retryPattern, retryHandler);
    await Promise.all([...retryReads]);
  }
  expect(retryResponses[0]?.saveAcknowledged).toBe(true);
  await saved(page);
  await expect(field(page)).toHaveValue(manual);
  expect((await transcript(request, asset.id)).revision).not.toBe(
    before.revision,
  );
  // The HTTP acknowledgment starts a real asynchronous retry. Its worker must
  // reject the changed revision before touching the retained batch/provider.
  await expect
    .poll(async () => {
      const retryJob = (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.find(
        (item) => item.id === job.id,
      );
      return {
        status: retryJob?.status,
        codes: retryJob?.errors?.map((error) => error.code),
      };
    })
    .toEqual({ status: "failed", codes: ["review.suggestionStale"] });
  expect(
    await get<{ batches: ReviewBatch[] }>(
      request,
      `/review/jobs/${job.id}/batches`,
    ),
  ).toEqual(retained);
  expect((await suggestions(request, asset.id)).total).toBe(0);
  await expect(recovery).toHaveAttribute("data-batch-status", "cancelled");
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    baseline,
  );
  await unchangedSource();
});

test("Transcript and Suggestions share parent job polling while real review progress and cancellation remain visible", async ({
  page,
  request,
}) => {
  const { asset, compositionId } = await createSource(
    request,
    "Shared job snapshots",
  );
  const initial = await transcribe(request, asset.id);
  await edit(request, asset.id, [
    {
      type: "replace-text",
      segmentId: initial.document!.segments[0]!.id,
      text: "Fixture line 050 exercises an interruptible synthetic provider.",
    },
  ]);
  const before = await transcript(request, asset.id);
  const baseline = await immutableCut(request, asset.id, compositionId);
  // Observe the actual fetch caller without replacing its response or request.
  await page.addInitScript(() => {
    const traced = window as unknown as Window & {
      __openfilmJobCalls: { at: number; stack: string }[];
    };
    traced.__openfilmJobCalls = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url, location.href).pathname === "/api/jobs")
        traced.__openfilmJobCalls.push({
          at: performance.now(),
          stack: new Error().stack ?? "",
        });
      return nativeFetch(input, init);
    };
  });
  const jobResponses: { status: number; body: string }[] = [];
  const jobReads = new Set<Promise<void>>();
  let failure: { error: unknown } | undefined;
  const responseHandler = (response: PlaywrightResponse) => {
    if (new URL(response.url()).pathname !== "/api/jobs") return;
    const read = (async () => {
      const body = await response.text();
      jobResponses.push({
        status: response.status(),
        body,
      });
      expect(response.ok(), `GET /api/jobs ${response.status()}: ${body}`).toBe(
        true,
      );
      expect(
        Array.isArray(JSON.parse(body).jobs),
        `GET /api/jobs body: ${body}`,
      ).toBe(true);
    })();
    jobReads.add(read);
    void read.then(
      () => jobReads.delete(read),
      (error) => {
        jobReads.delete(read);
        if (!failure) failure = { error };
      },
    );
  };
  page.on("response", responseHandler);
  try {
    await initialLocale(page);
    await page.goto("/");
    await transcriptMode(page);
    await tools(page, "suggestions");
    await expect(button(page, "languageReview")).toBeEnabled();
    await page.evaluate(() => {
      (
        window as unknown as Window & { __openfilmJobCalls: unknown[] }
      ).__openfilmJobCalls = [];
    });
    const calls = () =>
      page.evaluate(
        () =>
          (
            window as unknown as Window & {
              __openfilmJobCalls: { at: number; stack: string }[];
            }
          ).__openfilmJobCalls,
      );
    await expect
      .poll(async () => (await calls()).length)
      .toBeGreaterThanOrEqual(3);
    const idle = await calls();
    for (const call of idle) {
      const firstVueCaller = call.stack
        .split("\n")
        .find((line) => /\/src\/.*\.vue/u.test(line));
      expect(firstVueCaller, call.stack).toContain("/src/App.vue");
    }
    const reviewAck = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/assets/${asset.id}/review` &&
        response.request().method() === "POST",
    );
    await button(page, "languageReview").click();
    const ack = await reviewAck;
    expect(ack.ok()).toBe(true);
    const { job } = (await ack.json()) as { job: Job };
    await expect(button(page, "cancelReview")).toBeVisible();
    await expect(button(page, "findMatches")).toBeDisabled();
    await button(page, "cancelReview").click();
    await waitJob(request, job.id, "cancelled");
    await expect(
      page.locator(
        `[data-testid="review-recovery-batch"][data-job-id="${job.id}"]`,
      ),
    ).toHaveAttribute("data-batch-status", "cancelled");
    await expect(button(page, "findMatches")).toBeEnabled();
    for (const call of await calls()) {
      const firstVueCaller = call.stack
        .split("\n")
        .find((line) => /\/src\/.*\.vue/u.test(line));
      expect(firstVueCaller, call.stack).toContain("/src/App.vue");
    }
    expect((await transcript(request, asset.id)).document).toEqual(
      before.document,
    );
    expect(await immutableCut(request, asset.id, compositionId)).toEqual(
      baseline,
    );
    await unchangedSource();
  } catch (error) {
    if (!failure) failure = { error };
  } finally {
    page.off("response", responseHandler);
    for (const result of await Promise.allSettled([...jobReads]))
      if (result.status === "rejected" && !failure)
        failure = { error: result.reason };
  }
  if (failure) throw failure.error;
  expect(jobResponses.length).toBeGreaterThanOrEqual(3);
});

test("a pending transcription request stays with its original film before project switching and recovers after transport failure", async ({
  page,
  request,
}) => {
  const { path, asset, compositionId } = await createSource(
    request,
    "Dispatch A",
  );
  const original = await project(request);
  const baseline = await immutableCut(request, asset.id, compositionId);
  const copiedPath = join(root, "Dispatch B.openfilm");
  await closeProject(request);
  await cp(path, copiedPath, { recursive: true });
  const manifestPath = join(copiedPath, "project.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as OpenFilmProject;
  await writeFile(
    manifestPath,
    JSON.stringify({
      ...manifest,
      id: `project-${randomUUID()}`,
      title: "Dispatch B",
    }),
  );
  await post(request, "/project/open", { path: copiedPath });
  const copied = await project(request);
  expect(copied.id).not.toBe(original.id);
  expect(
    (
      await get<{ assets: MediaAsset[] }>(request, "/assets?limit=100")
    ).assets.map((item) => item.id),
  ).toContain(asset.id);
  const copiedBaseline = await immutableCut(request, asset.id, compositionId);
  expect((await transcript(request, asset.id)).revision).toBeUndefined();
  expect(
    (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.filter(
      (item) => item.type === "transcribe",
    ),
  ).toEqual([]);
  await closeProject(request);
  await post(request, "/project/open", { path });
  await initialLocale(page);
  await page.route("**/api/**", (route) => route.continue());
  await page.goto("/");
  await transcriptMode(page);
  const start = button(page, "transcribe");
  const switchProject = page.getByRole("button", {
    name: uiText("en-US", "app.navigation.switchProject"),
    exact: true,
  });
  const pattern = `**/api/assets/${asset.id}/intelligence`;
  for (const outcome of ["failed", "acknowledged"] as const) {
    let releaseCompletion: (() => void) | undefined;
    let completionHeld = false;
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    const completionPattern = `**/api/assets/${asset.id}/transcript?*`;
    const completionReads = new Set<Promise<void>>();
    const completionHandler: Parameters<Page["route"]>[1] = (route) => {
      const read = (async () => {
        const response = await route.fetch();
        const body = await response.text();
        expect(
          response.ok(),
          `Transcript completion read ${response.status()}: ${body}`,
        ).toBe(true);
        const state = JSON.parse(body) as TranscriptState;
        if (state.document?.provenance.model === "fixture-protocol-not-asr") {
          completionHeld = true;
          await completionGate;
        }
        await route.fulfill({ response });
      })();
      completionReads.add(read);
      return read.finally(() => completionReads.delete(read));
    };
    if (outcome === "acknowledged")
      await page.route(completionPattern, completionHandler);
    let received = false;
    let finished = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler: Parameters<Page["route"]>[1] = async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        operation: "transcribe",
      });
      received = true;
      await gate;
      if (outcome === "failed") await route.abort("failed");
      else await route.continue();
      finished = true;
    };
    await page.route(pattern, handler);
    let phaseFailure: { error: unknown } | undefined;
    let cleanup: PromiseSettledResult<void>[];
    try {
      try {
        await start.click();
        await expect
          .poll(() => received, {
            message: `${outcome}: transcription is held before backend arrival`,
          })
          .toBe(true);
        await expect(start).toBeDisabled();
        await expect(
          page.getByTestId("transcript-source-picker"),
        ).toBeDisabled();
        await switchProject.click();
        await expect(workspace(page)).toBeVisible();
        expect((await project(request)).id).toBe(original.id);
        expect(
          (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.filter(
            (item) => item.type === "transcribe",
          ),
        ).toEqual([]);
        expect((await transcript(request, asset.id)).revision).toBeUndefined();
      } finally {
        release();
      }
      await expect.poll(() => finished).toBe(true);
      if (outcome === "failed") {
        // A rejected dispatch releases local controls but blocks the waiting switch.
        await expect(workspace(page).getByRole("alert").first()).toBeVisible();
        await expect(start).toBeEnabled();
        expect((await project(request)).id).toBe(original.id);
        expect(
          (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.filter(
            (item) => item.type === "transcribe",
          ),
        ).toEqual([]);
      } else {
        await expect
          .poll(
            async () =>
              (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.filter(
                (item) => item.type === "transcribe",
              ).length,
          )
          .toBe(1);
        const job = (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.find(
          (item) => item.type === "transcribe",
        )!;
        await waitJob(request, job.id);
        expect(
          (await transcript(request, asset.id)).document?.provenance.model,
        ).toBe("fixture-protocol-not-asr");
        expect(await immutableCut(request, asset.id, compositionId)).toEqual(
          baseline,
        );
        await expect
          .poll(() => completionHeld, {
            timeout: 15_000,
            message: "The provider result is held while the editor is Loading",
          })
          .toBe(true);
        await expect(switchProject).toBeEnabled();
        try {
          await switchProject.click();
          await expect(workspace(page)).toBeVisible();
          expect((await project(request)).id).toBe(original.id);
        } finally {
          releaseCompletion?.();
        }
        await expect(page.locator(".launcher-actions")).toBeVisible();
      }
    } catch (error) {
      phaseFailure = { error };
    } finally {
      // Release every held read even if an earlier assertion fails, then drain
      // it before the hook closes the project. Keep the primary assertion.
      release();
      releaseCompletion?.();
      cleanup = await Promise.allSettled([
        page.unroute(pattern, handler),
        outcome === "acknowledged"
          ? page.unroute(completionPattern, completionHandler)
          : Promise.resolve(),
        ...completionReads,
      ]);
    }
    if (phaseFailure) throw phaseFailure.error;
    for (const result of cleanup)
      if (result.status === "rejected") throw result.reason;
  }
  await openFilm(page, copiedPath);
  expect((await project(request)).id).toBe(copied.id);
  expect((await transcript(request, asset.id)).revision).toBeUndefined();
  expect(
    (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.filter(
      (item) => item.type === "transcribe",
    ),
  ).toEqual([]);
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    copiedBaseline,
  );
  await switchProject.click();
  await expect(page.locator(".launcher-actions")).toBeVisible();
  await openFilm(page, path);
  const jobs = (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.filter(
    (item) => item.type === "transcribe",
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.status).toBe("completed");
  expect((await transcript(request, asset.id)).total).toBe(2);
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    baseline,
  );
  await unchangedSource();
});

test("glossary saves, remembered corrections, toggles and removal finish in their owning film before switching projects", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const filmA = await createSource(request, "Glossary owner A");
  const initial = await transcribe(request, filmA.asset.id);
  const filmAId = (await project(request)).id;
  const baseline = await immutableCut(
    request,
    filmA.asset.id,
    filmA.compositionId,
  );
  await closeProject(request);
  const filmB = await createSource(request, "Glossary owner B");
  await closeProject(request);
  await post(request, "/project/open", { path: filmA.path });
  await initialLocale(page);
  await page.goto("/");
  await transcriptMode(page);
  await tools(page, "glossary");
  const original = "A term held before switching";
  const corrected = "Saved inside film A";
  const rememberedSource = initial.document!.segments[0]!.text;
  const remembered = "A remembered correction stays with this film.";
  for (const action of ["save", "remember", "toggle", "remove"] as const) {
    const entries = (
      await get<{ entries: GlossaryEntry[] }>(
        request,
        "/glossary?scope=project",
      )
    ).entries;
    const entry = entries.find((term) => term.source === original);
    if (action === "save") {
      await page
        .locator(".transcript-side-panel")
        .getByLabel(t("sourceTerm"), { exact: true })
        .fill(original);
      await page
        .locator(".transcript-side-panel")
        .getByLabel(t("replacementTerm"), { exact: true })
        .fill(corrected);
    } else if (action === "remember") {
      await selectRow(page);
      await typeText(page, remembered);
      await expect(button(page, "remember")).toBeVisible();
    } else expect(entry).toBeDefined();
    const pattern =
      action === "remove"
        ? `**/api/glossary/${entry!.id}?scope=project`
        : "**/api/glossary";
    let release!: () => void;
    let arrived!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await page.route(pattern, async (route) => {
      expect(route.request().method()).toBe(
        action === "remove" ? "DELETE" : "POST",
      );
      if (action !== "remove") {
        const body = route.request().postDataJSON() as {
          scope: string;
          source: string;
        };
        expect(body.scope).toBe("project");
        expect(body.source).toBe(
          action === "remember" ? rememberedSource : original,
        );
      }
      // The server has not received the mutation yet. Releasing it after a
      // project switch would otherwise bind it to the newly opened catalog.
      arrived();
      await gate;
      await route.continue();
    });
    let switchQueued = false;
    const switchProject = page.getByRole("button", {
      name: uiText("en-US", "app.navigation.switchProject"),
      exact: true,
    });
    try {
      if (action === "save")
        await page
          .locator(".transcript-side-panel")
          .getByRole("button", { name: t("addTerm"), exact: true })
          .click();
      else if (action === "remember") await button(page, "remember").click();
      else {
        const row = page
          .getByTestId("glossary-entry")
          .filter({ hasText: original });
        if (action === "toggle")
          await row
            .getByRole("checkbox", { name: t("enabled"), exact: true })
            .uncheck();
        else
          await row
            .getByRole("button", { name: t("removeTerm"), exact: true })
            .click();
      }
      await started;
      await expect(page.getByTestId("transcript-source-picker")).toBeDisabled();
      if (await switchProject.isEnabled()) {
        await switchProject.click();
        switchQueued = true;
      } else await expect(switchProject).toBeDisabled();
      await expect(workspace(page)).toBeVisible();
      expect((await project(request)).id).toBe(filmAId);
    } finally {
      release();
    }
    if (!switchQueued) await switchProject.click();
    await expect(page.locator(".launcher-actions")).toBeVisible();
    await page.unroute(pattern);
    await openFilm(page, filmB.path);
    const otherTerms = (
      await get<{ entries: GlossaryEntry[] }>(
        request,
        "/glossary?scope=project",
      )
    ).entries;
    expect(otherTerms).toEqual([]);
    await page
      .getByRole("button", {
        name: uiText("en-US", "app.navigation.switchProject"),
        exact: true,
      })
      .click();
    await expect(page.locator(".launcher-actions")).toBeVisible();
    await openFilm(page, filmA.path);
    await transcriptMode(page);
    await tools(page, "glossary");
    const savedTerms = (
      await get<{ entries: GlossaryEntry[] }>(
        request,
        "/glossary?scope=project",
      )
    ).entries;
    const savedTerm = savedTerms.find((term) => term.source === original);
    if (action === "remove") expect(savedTerm).toBeUndefined();
    else {
      expect(savedTerm?.replacement).toBe(corrected);
      expect(savedTerm?.enabled).toBe(action !== "toggle");
    }
    if (action !== "save")
      expect(
        savedTerms.find((term) => term.source === rememberedSource)
          ?.replacement,
      ).toBe(remembered);
    expect(
      await immutableCut(request, filmA.asset.id, filmA.compositionId),
    ).toEqual(baseline);
  }
  expect(
    (await transcript(request, filmA.asset.id)).document?.segments[0]?.text,
  ).toBe(remembered);
  await unchangedSource();
});

async function seedManySegments(
  request: APIRequestContext,
  id: string,
  count = 121,
) {
  const initial = await transcribe(request, id);
  const lines = Array.from(
    { length: count },
    (_, index) =>
      `Fixture line ${String(index).padStart(3, "0")} alpha 回憶 思い出`,
  );
  const commands: TranscriptCommand[] = [
    { type: "delete-segment", segmentId: initial.document!.segments[1]!.id },
    {
      type: "replace-text",
      segmentId: initial.document!.segments[0]!.id,
      text: lines.join(" "),
    },
  ];
  let current = initial.document!.segments[0]!.id;
  for (let index = 0; index < count - 1; index++) {
    const next = `fixture-split-${index + 1}`;
    commands.push({
      type: "split-segment",
      segmentId: current,
      newSegmentId: next,
      cursorOffset: lines[index]!.length,
    });
    current = next;
  }
  for (let offset = 0; offset < commands.length; offset += 100)
    await edit(request, id, commands.slice(offset, offset + 100));
  const state = await transcript(request, id);
  expect(state.total).toBe(count);
  expect(state.document?.segments).toHaveLength(100);
  return state;
}

test("shrinking the last transcript page clamps its rows and history changes clear stale remembered corrections", async ({
  page,
  request,
}) => {
  const { path, asset, compositionId } = await createSource(
    request,
    "Transcript page history",
  );
  await seedManySegments(request, asset.id, 101);
  const baseline = await immutableCut(request, asset.id, compositionId);
  await initialLocale(page);
  await page.goto("/");
  await transcriptMode(page);
  await expect(rows(page)).toHaveCount(100);
  await button(page, "nextPage").click();
  await expect(rows(page)).toHaveCount(1);
  await selectRow(page);
  const originalLast = await field(page).inputValue();
  await typeText(page, "A corrected last transcript line.");
  await expect(button(page, "remember")).toBeVisible();
  await button(page, "undo").click();
  await saved(page);
  await expect(field(page)).toHaveValue(originalLast);
  await expect(button(page, "remember")).toHaveCount(0);
  await button(page, "redo").click();
  await saved(page);
  await expect(field(page)).toHaveValue("A corrected last transcript line.");
  await expect(button(page, "remember")).toHaveCount(0);
  await typeText(page, "A fresh correction that will be deleted.");
  await expect(button(page, "remember")).toBeVisible();
  await button(page, "deleteSegment").click();
  await saved(page);
  await expect(rows(page)).toHaveCount(100);
  await expect(workspace(page)).toContainText("Page 1 of 1");
  await expect(button(page, "nextPage")).toBeDisabled();
  await expect(button(page, "remember")).toHaveCount(0);
  const deleted = await transcript(request, asset.id);
  expect(deleted.total).toBe(100);
  // Undo restores the row; redo while viewing the last page must clamp again.
  await button(page, "undo").click();
  await saved(page);
  await button(page, "nextPage").click();
  await expect(rows(page)).toHaveCount(1);
  await button(page, "redo").click();
  await saved(page);
  await expect(rows(page)).toHaveCount(100);
  await expect(workspace(page)).toContainText("Page 1 of 1");
  await button(page, "undo").click();
  await saved(page);
  await button(page, "nextPage").click();
  await expect(rows(page)).toHaveCount(1);
  await selectRow(page);
  await typeText(page, "Another draft before restoring fewer rows.");
  await expect(button(page, "remember")).toBeVisible();
  await workspace(page).locator(".transcript-history > summary").click();
  const history = workspace(page).locator(".transcript-history select");
  const revisions = await get<{ revisions: TranscriptRevision[] }>(
    request,
    `/assets/${asset.id}/transcript/revisions?limit=100`,
  );
  expect(
    revisions.revisions.some((revision) => revision.id === deleted.revision),
  ).toBe(true);
  await expect(
    history.locator(`option[value="${deleted.revision}"]`),
  ).toHaveCount(1);
  await history.selectOption(deleted.revision!);
  await button(page, "restoreRevision").click();
  await saved(page);
  await expect(rows(page)).toHaveCount(100);
  await expect(workspace(page)).toContainText("Page 1 of 1");
  await expect(button(page, "remember")).toHaveCount(0);
  await selectRow(page);
  await typeText(page, "A correction belonging only to the first row.");
  await expect(button(page, "remember")).toBeVisible();
  await selectRow(page, 1);
  await expect(button(page, "remember")).toHaveCount(0);
  expect(
    (
      await get<{ entries: GlossaryEntry[] }>(
        request,
        "/glossary?scope=project",
      )
    ).entries,
  ).toEqual([]);
  await selectRow(page);
  const liveBefore = await field(page).inputValue();
  const liveAfter = "Remember this current correction only.";
  await typeText(page, liveAfter);
  await button(page, "remember").click();
  await expect(page.getByTestId("glossary-entry")).toHaveCount(1);
  const terms = (
    await get<{ entries: GlossaryEntry[] }>(request, "/glossary?scope=project")
  ).entries;
  expect(terms).toHaveLength(1);
  expect(terms[0]?.source).toBe(liveBefore);
  expect(terms[0]?.replacement).toBe(liveAfter);
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    baseline,
  );
  await page
    .getByRole("button", {
      name: uiText("en-US", "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await expect(page.locator(".launcher-actions")).toBeVisible();
  await openFilm(page, path);
  await transcriptMode(page);
  await expect(rows(page)).toHaveCount(100);
  await selectRow(page);
  await expect(field(page)).toHaveValue(liveAfter);
  await expect(button(page, "remember")).toHaveCount(0);
  await unchangedSource();
});

test("opaque lone-surrogate and very long IDs use exact JSON lookup for review preview and survive editing and reopening", async ({
  page,
  request,
}) => {
  const { path, asset, compositionId } = await createSource(
    request,
    "Opaque JSON segment lookup",
  );
  const ids = [
    "legacy-\ud800",
    "legacy-\udc00",
    "legacy-\ufffd",
    "legacy-" + "x".repeat(32_768),
  ];
  const texts = [
    "Fixword high surrogate memory.",
    "Fixword low surrogate memory.",
    "Fixword literal replacement character memory.",
    "Fixword very long identity memory.",
  ];
  const starts = [0.5, 3, 5.5, 8];
  const baseline = await immutableCut(request, asset.id, compositionId);
  await closeProject(request);
  // Explicit source-bound legacy identity fixture. JSON preserves every code
  // unit; this fixture does not represent ASR recognition or model quality.
  const fixture = await OpenFilmApplication.open(path, {
    userDataDirectory: join(root, "opaque-json-fixture-user-data"),
  });
  try {
    const sourceHash = await fixture.intelligence.sourceIdentity(asset.id);
    fixture.catalog.intelligence.replaceTranscript({
      id: `opaque-json-fixture-${randomUUID()}`,
      assetId: asset.id,
      language: "en",
      provenance: {
        providerId: "fixture-opaque-json-legacy-identifiers",
        model: "identity-fixture-not-asr",
        version: "1",
        sourceHash,
        createdAt: new Date().toISOString(),
      },
      segments: ids.map((id, position) => ({
        id,
        start: starts[position]!,
        end: starts[position]! + 2,
        text: texts[position]!,
      })),
    });
  } finally {
    fixture.close();
  }
  await post(request, "/project/open", { path });
  await initialLocale(page);
  await page.goto("/");
  await transcriptMode(page);
  await expect(rows(page)).toHaveCount(4);
  expect(
    await rows(page).evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.segmentId),
    ),
  ).toEqual(ids);
  for (const [position, id] of ids.entries()) {
    const found = await post<{
      segment: { id: string; text: string };
      position: number;
    }>(request, `/assets/${asset.id}/transcript/segment`, { segmentId: id });
    expect(found.position).toBe(position);
    expect(found.segment.id).toBe(id);
    expect(found.segment.text).toBe(texts[position]);
  }
  await selectRow(page, 0);
  await typeText(page, "Fixword edited high surrogate memory.");
  texts[0] = "Fixword edited high surrogate memory.";
  await button(page, "undo").click();
  await saved(page);
  await expect(field(page)).toHaveValue("Fixword high surrogate memory.");
  await button(page, "redo").click();
  await saved(page);
  await expect(field(page)).toHaveValue(texts[0]!);
  await selectRow(page, 3);
  await typeText(page, "Fixword edited very long identity memory.");
  texts[3] = "Fixword edited very long identity memory.";
  await post(request, "/glossary", {
    source: "Fixword",
    replacement: "Correctword",
    scope: "project",
  });
  const { job } = await post<{ job: Job }>(
    request,
    `/assets/${asset.id}/review`,
    { source: "glossary" },
  );
  await waitJob(request, job.id);
  const pending = (await suggestions(request, asset.id, "pending")).suggestions;
  expect(pending).toHaveLength(4);
  for (const id of ids)
    expect(pending.some((item) => item.target.segmentId === id)).toBe(true);
  await tools(page, "suggestions");
  await expect(page.getByTestId("review-suggestion")).toHaveCount(4);
  for (const [position, id] of ids.entries()) {
    const suggestion = pending.find((item) => item.target.segmentId === id)!;
    const lookup = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/assets/${asset.id}/transcript/segment` &&
        response.request().method() === "POST" &&
        (response.request().postDataJSON() as { segmentId: string })
          .segmentId === id,
    );
    await page
      .locator(`[data-suggestion-id="${suggestion.id}"]`)
      .getByRole("button", { name: t("preview"), exact: true })
      .click();
    const response = await lookup;
    expect(response.ok()).toBe(true);
    const result = (await response.json()) as {
      segment: { id: string };
      position: number;
    };
    expect(result.segment.id).toBe(id);
    expect(result.position).toBe(position);
    await expect(field(page)).toHaveValue(texts[position]!);
    await previewVisible(page);
    await expect
      .poll(() =>
        page
          .getByTestId("transcript-source-preview")
          .locator("video")
          .evaluate((node) => (node as HTMLVideoElement).currentTime),
      )
      .toBeCloseTo(starts[position]!, 1);
  }
  const search = workspace(page).getByLabel(t("search"), { exact: true });
  await search.fill("edited high surrogate");
  await expect(page.getByTestId("transcript-search-status")).toHaveText(
    "1 match",
  );
  await button(page, "nextMatch").click();
  await expect(field(page)).toHaveValue(texts[0]!);
  await previewVisible(page);
  await search.fill("");
  await page
    .getByRole("button", {
      name: uiText("en-US", "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await expect(page.locator(".launcher-actions")).toBeVisible();
  await openFilm(page, path);
  await transcriptMode(page);
  expect(
    await rows(page).evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.segmentId),
    ),
  ).toEqual(ids);
  for (const [position, id] of ids.entries()) {
    const found = await post<{
      segment: { id: string; text: string };
      position: number;
    }>(request, `/assets/${asset.id}/transcript/segment`, { segmentId: id });
    expect(found.position).toBe(position);
    expect(found.segment.id).toBe(id);
    expect(found.segment.text).toBe(texts[position]);
  }
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    baseline,
  );
  await unchangedSource();
});

test("bounded transcript pages stream completed review batches and preserve partial results on cancellation", async ({
  page,
  request,
}) => {
  const { path, asset, compositionId } = await createSource(
    request,
    "Bounded review batches",
  );
  const seeded = await seedManySegments(request, asset.id);
  const baseline = await immutableCut(request, asset.id, compositionId);
  await initialLocale(page);
  await page.goto("/");
  await transcriptMode(page);
  await expect(rows(page)).toHaveCount(100);
  await button(page, "nextPage").click();
  await expect(rows(page)).toHaveCount(21);
  await button(page, "previousPage").click();
  await expect(rows(page)).toHaveCount(100);
  // A late response to an older query cannot restore old replace targets.
  let releaseSearch!: () => void;
  let searchArrived!: () => void;
  let searchReturned!: () => void;
  const searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  const searchStarted = new Promise<void>((resolve) => {
    searchArrived = resolve;
  });
  const searchFinished = new Promise<void>((resolve) => {
    searchReturned = resolve;
  });
  const searchPattern = `**/api/assets/${asset.id}/transcript/search?query=alpha&*`;
  await page.route(searchPattern, async (route) => {
    const response = await route.fetch();
    searchArrived();
    await searchGate;
    await route.fulfill({ response });
    searchReturned();
  });
  const search = workspace(page).getByLabel(t("search"), { exact: true });
  await search.fill("alpha");
  await searchStarted;
  try {
    await expect(button(page, "replaceAll")).toBeDisabled();
    await search.fill("Fixture line 120");
    await expect(page.getByTestId("transcript-search-status")).toHaveText(
      "1 match",
    );
    await expect(button(page, "replaceCurrent")).toBeEnabled();
  } finally {
    releaseSearch();
  }
  await searchFinished;
  await expect(page.getByTestId("transcript-search-status")).toHaveText(
    "1 match",
  );
  await page.unroute(searchPattern);
  await button(page, "nextMatch").click();
  await expect(field(page)).toHaveValue("Fixture line 120 alpha 回憶 思い出");
  await previewVisible(page);
  await expect(rows(page)).toHaveCount(21);
  await search.fill("");
  await button(page, "previousPage").click();
  await expect(rows(page)).toHaveCount(100);
  await tools(page, "suggestions");
  const provider = await get<{
    configured: boolean;
    available: boolean;
    provider: { id: string; execution: string };
  }>(request, "/review/provider");
  expect(provider.configured).toBe(true);
  expect(provider.available).toBe(true);
  expect(provider.provider.id).toBe("fixture-local-language-review");
  expect(provider.provider.execution).toBe("local");
  await button(page, "languageReview").click();
  await expect(page.getByTestId("review-suggestion")).toHaveCount(50, {
    timeout: 15_000,
  });
  await expect(button(page, "cancelReview")).toBeVisible();
  const job = (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.find(
    (item) => item.type === "language-review",
  )!;
  expect(["queued", "running"]).toContain(job.status);
  const activeBatches = await get<{ batches: ReviewBatch[] }>(
    request,
    `/review/jobs/${job.id}/batches`,
  );
  expect(activeBatches.batches.map((batch) => batch.segmentIds.length)).toEqual(
    [50, 50, 21],
  );
  expect(activeBatches.batches[0]?.status).toBe("completed");
  await button(page, "cancelReview").click();
  await waitJob(request, job.id, "cancelled");
  await expect(workspace(page)).toContainText(t("reviewPartial"), {
    timeout: 10_000,
  });
  expect((await suggestions(request, asset.id, "pending")).total).toBe(50);
  const retained = (await suggestions(request, asset.id, "pending"))
    .suggestions;
  expect((await transcript(request, asset.id)).revision).toBe(seeded.revision);
  const batches = (
    await get<{ batches: ReviewBatch[] }>(
      request,
      `/review/jobs/${job.id}/batches`,
    )
  ).batches;
  expect(batches[0]?.status).toBe("completed");
  expect(
    batches
      .slice(1)
      .every(
        (batch) => batch.status === "cancelled" || batch.status === "pending",
      ),
  ).toBe(true);
  const recovery = page.getByTestId("review-recovery-batch");
  await expect(recovery).toHaveCount(2);
  // A real source-read failure happens before review batches are created. This
  // newer failed job must not hide the earlier cancelled job's recovery actions.
  const sourcePath = fileURLToPath(asset.uri);
  const offlinePath = `${sourcePath}.offline-for-review-test`;
  let newer!: Job;
  await rename(sourcePath, offlinePath);
  try {
    const response = await post<{ job: Job }>(
      request,
      `/assets/${asset.id}/review`,
      { source: "glossary" },
    );
    newer = response.job;
    await expect
      .poll(
        async () =>
          (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.find(
            (item) => item.id === newer.id,
          )?.status,
      )
      .toBe("failed");
    expect(
      (
        await get<{ batches: ReviewBatch[] }>(
          request,
          `/review/jobs/${newer.id}/batches`,
        )
      ).batches,
    ).toEqual([]);
  } finally {
    await rename(offlinePath, sourcePath);
  }
  const newerRead = await page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      `/api/review/jobs/${newer.id}/batches`,
  );
  await newerRead.finished();
  await expect(page.locator(".transcript-side-panel")).toHaveAttribute(
    "data-latest-job-id",
    newer.id,
  );
  await expect(recovery).toHaveCount(2);
  for (let index = 0; index < 2; index++)
    await expect(recovery.nth(index)).toHaveAttribute("data-job-id", job.id);
  const retryRow = page.locator(
    '[data-testid="review-recovery-batch"][data-batch-index="1"]',
  );
  await expect(retryRow).toHaveAttribute("data-batch-status", "cancelled");
  await retryRow
    .getByRole("button", { name: t("retryBatch"), exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await get<{ batches: ReviewBatch[] }>(
            request,
            `/review/jobs/${job.id}/batches`,
          )
        ).batches[1]?.status,
      { timeout: 15_000, message: "The cancelled second batch is retried" },
    )
    .toBe("completed");
  await expect(recovery).toHaveCount(1);
  const remaining = page.locator(
    '[data-testid="review-recovery-batch"][data-batch-index="2"]',
  );
  await expect(remaining).toHaveAttribute("data-batch-status", "cancelled");
  await remaining
    .getByRole("button", { name: t("skipBatch"), exact: true })
    .click();
  await waitJob(request, job.id);
  await expect(recovery).toHaveCount(0);
  const recoveredBatches = (
    await get<{ batches: ReviewBatch[] }>(
      request,
      `/review/jobs/${job.id}/batches`,
    )
  ).batches;
  expect(recoveredBatches.map((batch) => batch.status)).toEqual([
    "completed",
    "completed",
    "skipped",
  ]);
  expect(recoveredBatches.map((batch) => batch.attempts)).toEqual([1, 2, 0]);
  const recoveredSuggestions = await suggestions(request, asset.id, "pending");
  expect(recoveredSuggestions.total).toBe(100);
  const byId = new Map(
    recoveredSuggestions.suggestions.map((suggestion) => [
      suggestion.id,
      suggestion,
    ]),
  );
  for (const suggestion of retained)
    expect(byId.get(suggestion.id)).toEqual(suggestion);
  expect((await transcript(request, asset.id)).revision).toBe(seeded.revision);
  // The resumed job, skipped sibling and completed evidence survive reopening.
  await page
    .getByRole("button", {
      name: uiText("en-US", "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await expect(page.locator(".launcher-actions")).toBeVisible();
  await openFilm(page, path);
  await transcriptMode(page);
  await tools(page, "suggestions");
  await expect(page.getByTestId("review-suggestion")).toHaveCount(50);
  await expect(recovery).toHaveCount(0);
  expect(
    (
      await get<{ batches: ReviewBatch[] }>(
        request,
        `/review/jobs/${job.id}/batches`,
      )
    ).batches,
  ).toEqual(recoveredBatches);
  await page
    .getByTestId("review-suggestion")
    .first()
    .getByRole("button", { name: t("preview"), exact: true })
    .click();
  await previewVisible(page);
  await page
    .getByTestId("review-suggestion")
    .first()
    .getByRole("button", { name: t("accept"), exact: true })
    .click();
  await saved(page);
  await expect(page.getByTestId("review-suggestion")).toHaveCount(50);
  await expect(page.getByTestId("review-suggestion").first()).toHaveAttribute(
    "data-status",
    "stale",
  );
  const reviewed = await suggestions(request, asset.id);
  expect(
    reviewed.suggestions.filter((item) => item.status === "accepted"),
  ).toHaveLength(1);
  expect(
    reviewed.suggestions.filter((item) => item.status === "stale"),
  ).toHaveLength(99);
  const skippedId = await page
    .getByTestId("review-suggestion")
    .first()
    .getAttribute("data-suggestion-id");
  await page
    .getByTestId("review-suggestion")
    .first()
    .getByRole("button", { name: t("skip"), exact: true })
    .click();
  await expect(page.locator(`[data-suggestion-id="${skippedId}"]`)).toHaveCount(
    0,
  );
  expect(
    (await suggestions(request, asset.id)).suggestions.filter(
      (item) => item.status === "skipped",
    ),
  ).toHaveLength(1);
  expect(
    (await transcript(request, asset.id)).document?.segments.filter((segment) =>
      segment.text.endsWith("[fixture reviewed]"),
    ),
  ).toHaveLength(1);
  expect(await immutableCut(request, asset.id, compositionId)).toEqual(
    baseline,
  );
  await unchangedSource();
});

async function capture(page: Page, info: TestInfo, name: string) {
  await previewVisible(page);
  await expect
    .poll(
      () =>
        page
          .getByTestId("transcript-source-preview")
          .locator("video")
          .evaluate((node) => {
            const player = node as HTMLVideoElement;
            return player.readyState >= 3 && !player.seeking;
          }),
      { message: "Screenshot source preview has buffered future frames" },
    )
    .toBe(true);
  // Media state changes and viewport resizing can precede Chrome's native
  // control/compositor update. Let the ready frame reach the painted surface.
  await page
    .getByTestId("transcript-source-preview")
    .locator("video")
    .evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        }),
    );
  await expect
    .poll(() => page.evaluate(() => document.fonts.status))
    .toBe("loaded");
  const problems = await page.evaluate(() => {
    const issues: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth + 2)
      issues.push("Page exceeds viewport width");
    for (const node of Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="transcript-workspace"] button, [data-testid="transcript-workspace"] summary, [data-testid="transcript-workspace"] h3',
      ),
    )) {
      if (!node.getClientRects().length) continue;
      const box = node.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      if (box.left < -2 || box.right > innerWidth + 2)
        issues.push(`Outside viewport: ${node.textContent?.trim()}`);
      if (
        node.scrollWidth > node.clientWidth + 3 &&
        !node.matches(".transcript-term, .transcript-row-select")
      )
        issues.push(`Clipped control: ${node.textContent?.trim()}`);
    }
    return issues;
  });
  expect(problems, `${name} layout`).toEqual([]);
  expect(await workspace(page).innerText()).not.toMatch(
    /\b(?:transcript|editor|app)\.[\w.]+\b|\bundefined\b/u,
  );
  expect(await rows(page).count()).toBeLessThanOrEqual(100);
  expect(
    await page.getByTestId("review-suggestion").count(),
  ).toBeLessThanOrEqual(100);
  if (page.viewportSize()!.width === 1280) {
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: typeof axe }).axe.run(
        document,
        {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
          },
        },
      );
      return result.violations.map((rule) => ({
        id: rule.id,
        help: rule.help,
        nodes: rule.nodes.map((node) => ({
          target: node.target,
          reason: node.failureSummary,
        })),
      }));
    });
    expect(violations, `${name} accessibility`).toEqual([]);
  }
  const size = page.viewportSize()!;
  const path = info.outputPath(`${name}-${size.width}x${size.height}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

for (const locale of locales) {
  test(`${locale} transcript, glossary and suggestion screens remain accessible at three desktop sizes`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(150_000);
    const { asset } = await createSource(
      request,
      `${locale} transcript visual`,
    );
    await seedManySegments(request, asset.id);
    await post(request, "/glossary", {
      source: "alpha",
      replacement: "Alpine memories 阿爾卑斯的回憶 アルプスの思い出",
      scope: "project",
      enabled: true,
      caseSensitive: true,
    });
    await post(request, "/glossary", {
      source: "A long personal name remembered through all these years",
      replacement: "長い名前を含む大切な思い出 — 我和家人的珍貴回憶",
      scope: "project",
      enabled: true,
      caseSensitive: false,
    });
    const { job } = await post<{ job: Job }>(
      request,
      `/assets/${asset.id}/review`,
      { source: "glossary" },
    );
    await waitJob(request, job.id);
    await page.addInitScript(
      (value) => localStorage.setItem("openfilm.uiLocale", value),
      locale,
    );
    const missing: string[] = [];
    page.on("console", (entry) => {
      if (/Missing translation|Not found.*key/u.test(entry.text()))
        missing.push(entry.text());
    });
    await page.goto("/");
    await page.locator(".main-nav button").nth(2).click();
    await page
      .locator(".timeline-editor > .editor-toolbar .editor-mode-switch button")
      .nth(2)
      .click();
    await expect(workspace(page)).toBeVisible();
    const player = page
      .getByTestId("transcript-source-preview")
      .locator("video");
    await expect(player).toBeVisible();
    await expect
      .poll(() =>
        player.evaluate((node) => (node as HTMLVideoElement).readyState),
      )
      .toBeGreaterThanOrEqual(1);
    await expect(rows(page)).toHaveCount(100);
    await selectRow(page);
    for (const size of sizes) {
      await page.setViewportSize(size);
      await capture(page, info, `${locale}-transcript`);
    }
    await workspace(page)
      .locator(".transcript-toolbar .editor-actions button")
      .nth(2)
      .click();
    await page
      .locator(".transcript-tools > .editor-mode-switch button")
      .nth(0)
      .click();
    await expect(page.getByTestId("glossary-entry")).toHaveCount(2);
    for (const size of sizes) {
      await page.setViewportSize(size);
      await capture(page, info, `${locale}-glossary`);
    }
    await page
      .locator(".transcript-tools > .editor-mode-switch button")
      .nth(1)
      .click();
    await expect(page.getByTestId("review-suggestion")).toHaveCount(50);
    for (const size of sizes) {
      await page.setViewportSize(size);
      await capture(page, info, `${locale}-suggestions`);
    }
    // A page can keep the same row count. Acknowledged offset and changed
    // suggestion identities prove each Next click actually reached its page.
    const pagination = page.getByTestId("review-pagination");
    const firstIds = await page
      .getByTestId("review-suggestion")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-suggestion-id")),
      );
    await expect(pagination).toHaveAttribute("data-offset", "0");
    let releasePage: (() => void) | undefined;
    let pageReads = 0;
    let pageResponses = 0;
    const pagePattern = `**/api/assets/${asset.id}/review/suggestions?*`;
    if (locale === "en-XA") {
      const gate = new Promise<void>((resolve) => {
        releasePage = resolve;
      });
      await page.route(pagePattern, async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (
          params.get("status") !== "pending" ||
          params.get("offset") !== "50"
        ) {
          await route.continue();
          return;
        }
        pageReads++;
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
        pageResponses++;
      });
    }
    let heldReads = 0;
    try {
      await pagination.locator("button").last().click();
      if (locale === "en-XA") {
        await expect(pagination).toHaveAttribute(
          "data-requested-offset",
          "100",
        );
        await expect(pagination).toHaveAttribute("aria-busy", "true");
        await expect(pagination.locator("button").last()).toBeDisabled();
        // Hold the user request across a real timer poll. The poll must retain
        // the requested page rather than replacing it with settled offset zero.
        await expect
          .poll(() => pageReads, {
            timeout: 10_000,
            message: "Polling retains the unacknowledged Next page",
          })
          .toBeGreaterThanOrEqual(2);
        heldReads = pageReads;
      }
    } finally {
      releasePage?.();
    }
    await expect(pagination).toHaveAttribute("data-offset", "100");
    await expect(pagination).toHaveAttribute("aria-busy", "false");
    await expect(page.getByTestId("review-suggestion")).toHaveCount(50);
    const secondIds = await page
      .getByTestId("review-suggestion")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-suggestion-id")),
      );
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
    if (locale === "en-XA") {
      await expect.poll(() => pageResponses).toBeGreaterThanOrEqual(heldReads);
      await page.unroute(pagePattern);
    }
    await pagination.locator("button").last().click();
    await expect(pagination).toHaveAttribute("data-offset", "200");
    await expect(page.getByTestId("review-suggestion")).toHaveCount(21);
    await expect(pagination.locator("button").last()).toBeDisabled();
    expect(missing).toEqual([]);
    await unchangedSource();
  });
}
