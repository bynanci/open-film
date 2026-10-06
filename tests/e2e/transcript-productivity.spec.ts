import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
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
  await page.goto("/");
  await transcriptMode(page);
  await selectRow(page);
  await tools(page, "suggestions");
  for (const action of ["mode", "close"] as const) {
    await tools(page, "suggestions");
    await button(page, "findMatches").click();
    await expect(page.getByTestId("review-suggestion").first()).toBeVisible({
      timeout: 10_000,
    });
    const suggestion = page.getByTestId("review-suggestion").first();
    const id = (await suggestion.getAttribute("data-suggestion-id"))!;
    let release!: () => void;
    let arrived!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const pattern = `**/api/review/suggestions/${id}/accept`;
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      arrived();
      await gate;
      await route.fulfill({ response });
    });
    const before = await field(page).inputValue();
    try {
      await suggestion
        .getByRole("button", { name: t("accept"), exact: true })
        .click();
      await started;
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

async function seedManySegments(request: APIRequestContext, id: string) {
  const initial = await transcribe(request, id);
  const lines = Array.from(
    { length: 121 },
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
  for (let index = 0; index < 120; index++) {
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
  expect(state.total).toBe(121);
  expect(state.document?.segments).toHaveLength(100);
  return state;
}

test("bounded transcript pages stream completed review batches and preserve partial results on cancellation", async ({
  page,
  request,
}) => {
  const { asset, compositionId } = await createSource(
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
  await expect(page.getByTestId("review-suggestion")).toHaveCount(49);
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
  ).toHaveLength(49);
  await page
    .getByTestId("review-suggestion")
    .first()
    .getByRole("button", { name: t("skip"), exact: true })
    .click();
  await expect(page.getByTestId("review-suggestion")).toHaveCount(48);
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
    // Pending and stale views each use50 rows; all121 suggestions are reachable.
    for (const count of [50, 21]) {
      await page
        .locator(".transcript-side-panel > .editor-actions")
        .filter({ has: page.locator("button") })
        .last()
        .locator("button")
        .last()
        .click();
      await expect(page.getByTestId("review-suggestion")).toHaveCount(count);
    }
    expect(missing).toEqual([]);
    await unchangedSource();
  });
}
