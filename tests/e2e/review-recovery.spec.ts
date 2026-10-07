import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { TimelineEditor } from "../../packages/application/src/editor.js";
import { hashFile, runProcess } from "@openfilm/media";
import type {
  Job,
  MediaAsset,
  OpenFilmProject,
  ReviewBatch,
  TranscriptDocument,
  TranscriptReviewSuggestion,
} from "@openfilm/core";
import { closeProject } from "../fixtures/close-browser-project.js";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
const t = (key: string) => uiText("en-US", `transcript.${key}`);
interface TranscriptState {
  revision?: string;
  document?: TranscriptDocument;
  canUndo: boolean;
  canRedo: boolean;
}
interface RecoveryState {
  jobId: string;
  ownerState: "alive" | "dead" | "unknown";
  manualRecoveryAllowed: boolean;
  ownerToken?: string;
  updatedAt?: string;
}
let root: string | undefined;
test.use({ actionTimeout: 15_000, viewport: { width: 1280, height: 720 } });
test.beforeEach(async () => closeProject());
test.afterEach(async () => {
  await closeProject();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
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
async function transcriptMode(page: Page) {
  await navigate(page, "edit");
  await page
    .getByRole("group", {
      name: uiText("en-US", "precision.modeLabel"),
      exact: true,
    })
    .getByRole("button", { name: t("mode"), exact: true })
    .click();
  const workspace = page.getByTestId("transcript-workspace");
  await expect(workspace).toBeVisible();
  await expect(page.getByTestId("transcript-row")).toHaveCount(3);
  const show = workspace.getByRole("button", {
    name: t("showTools"),
    exact: true,
  });
  if (await show.isVisible()) await show.click();
  await page
    .locator(".transcript-tools > .editor-mode-switch")
    .getByRole("button", { name: t("suggestions"), exact: true })
    .click();
}
async function unchangedFilm(
  request: APIRequestContext,
  assetId: string,
  compositionId: string,
) {
  const { project } = await get<{ project: OpenFilmProject }>(
    request,
    "/project",
  );
  const { assets } = await get<{ assets: MediaAsset[] }>(
    request,
    `/assets?ids=${assetId}&limit=100`,
  );
  const editor = await get<{
    revision: string;
    canUndo: boolean;
    canRedo: boolean;
  }>(request, `/compositions/${compositionId}/editor`);
  return {
    stories: project.stories,
    compositions: project.timelines,
    assetState: assets[0]!.state,
    rating: assets[0]!.rating,
    editorRevision: editor.revision,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
  };
}

test("confirmed unknown-owner recovery preserves completed evidence and makes unfinished and legacy batches usable after reopening", async ({
  page,
  request,
}, testInfo) => {
  root = await mkdtemp(join(tmpdir(), "openfilm-review-recovery-browser-"));
  const source = join(root, "Generated memories 回憶 & #1.mp4");
  // Generated color/tone media and explicit text fixtures. This is recovery and
  // persistence evidence, not transcription, model-quality, GPU or NLE QA.
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x455448:s=320x180:r=24:d=6",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=6",
    "-t",
    "6",
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
    source,
  ]);
  const sourceHash = await hashFile(source);
  const path = join(root, "Recovery film.openfilm");
  const app = await OpenFilmApplication.create(
    path,
    "Recover my review",
    {
      projectContentLocale: "en-US",
      filmSettings: { templateId: "blank", targetDuration: 4, maxDuration: 6 },
    },
    { userDataDirectory: join(root, "fixture-user-data") },
  );
  let asset!: MediaAsset;
  let compositionId!: string;
  let partial!: Job;
  let legacy!: Job;
  let completed!: ReviewBatch;
  let originalSuggestions!: TranscriptReviewSuggestion[];
  try {
    await app.importFiles([source]);
    asset = app.catalog.listAssets()[0]!;
    expect(asset).toBeDefined();
    app.catalog.intelligence.replaceTranscript({
      id: randomUUID(),
      assetId: asset.id,
      language: "en",
      provenance: {
        providerId: "explicit-recovery-text-fixture-not-ASR",
        version: "1",
        sourceHash,
        createdAt: "2026-10-07T00:00:00Z",
      },
      segments: ["First teh memory 回憶", "Second memory", "Third memory"].map(
        (text, index) => ({
          id: `segment-${index}`,
          start: index * 2,
          end: index * 2 + 1.5,
          text,
        }),
      ),
    });
    app.knowledge.glossaryUpsert({
      scope: "project",
      source: "teh",
      replacement: "the",
    });
    // Generate the completed batch/suggestion through the actual offline service.
    const finished = await app.runKnowledgeReview(asset.id, {
      source: "glossary",
      batchSize: 1,
      segmentIds: ["segment-0"],
    });
    originalSuggestions = (await app.knowledge.suggestionsList(asset.id))
      .suggestions;
    expect(originalSuggestions).toHaveLength(1);
    completed = app.knowledge.batches(finished.id)[0]!;
    const revision = completed.sourceRevisionId;
    // Explicit portable partial-job fixture, deliberately unverifiable. A foreign
    // scope does not claim any real process is dead, and normal Open must preserve it.
    partial = {
      ...finished,
      status: "running",
      progress: 1 / 3,
      stage: "reviewing",
      updatedAt: "2026-10-07T00:01:00Z",
      reviewOwner: {
        host: "explicit-foreign-owner-fixture-not-liveness-evidence",
        pid: process.pid,
        token: randomUUID(),
      },
    };
    app.catalog.saveJob(partial);
    app.catalog.knowledge.saveBatch({
      ...completed,
      index: 1,
      segmentIds: ["segment-1"],
      status: "running",
      attempts: 1,
    });
    app.catalog.knowledge.saveBatch({
      ...completed,
      index: 2,
      segmentIds: ["segment-2"],
      status: "pending",
      attempts: 0,
    });
    // Legacy means a terminal job persisted before execution-owner metadata was
    // introduced. Keep its actual production type; "review" was never emitted by
    // KnowledgeService and is not a supported historical batch-action job type.
    legacy = {
      id: randomUUID(),
      type: "language-review",
      assetId: asset.id,
      status: "failed",
      createdAt: "2026-10-07T00:02:00Z",
      updatedAt: "2026-10-07T00:02:00Z",
    };
    app.catalog.saveJob(legacy);
    app.catalog.knowledge.saveBatch({
      jobId: legacy.id,
      index: 0,
      assetId: asset.id,
      sourceRevisionId: revision,
      providerId: "fixture-local-language-review",
      segmentIds: ["segment-2"],
      status: "cancelled",
      attempts: 1,
    });
    const story = app.generateStory({
      template: "blank",
      targetDuration: 4,
      maxDuration: 6,
      assetIds: [asset.id],
    });
    const composition = app.compose(story.id);
    compositionId = composition.id;
    const clip = composition.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.assetId === asset.id)!;
    expect(clip).toBeDefined();
    const editor = new TimelineEditor(app);
    await editor.edit(composition.id, {
      baseRevision: editor.get(composition.id).revision,
      requestId: randomUUID(),
      commands: [
        { type: "trim", clipId: clip.id, sourceIn: 1, sourceOut: 4 },
        { type: "lock", clipId: clip.id, locked: true },
      ],
    });
    app.catalog.upsertAsset({
      ...asset,
      rating: 5,
      state: { ...asset.state, favorite: true, locked: true },
    });
    await app.save();
  } finally {
    app.close();
  }

  await post(request, "/project/open", { path });
  const initialJob = (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.find(
    (job) => job.id === partial.id,
  )!;
  expect(initialJob).toEqual(partial);
  const initialTranscript = await get<TranscriptState>(
    request,
    `/assets/${asset.id}/transcript`,
  );
  const filmBaseline = await unchangedFilm(request, asset.id, compositionId);
  const checkpoint = await get<RecoveryState>(
    request,
    `/review/jobs/${partial.id}/recovery`,
  );
  expect(checkpoint).toMatchObject({
    ownerState: "unknown",
    manualRecoveryAllowed: true,
    ownerToken: partial.reviewOwner!.token,
    updatedAt: partial.updatedAt,
  });
  const recoveryPosts: unknown[] = [];
  const legacyRecoveryReads: string[] = [];
  const legacyRecoveryResponses: Promise<{
    status: number;
    state: RecoveryState;
  }>[] = [];
  page.on("request", (event) => {
    const uri = new URL(event.url());
    if (
      uri.pathname === `/api/review/jobs/${partial.id}/recovery` &&
      event.method() === "POST"
    )
      recoveryPosts.push(event.postDataJSON());
    if (uri.pathname === `/api/review/jobs/${legacy.id}/recovery`)
      legacyRecoveryReads.push(event.url());
  });
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname ===
        `/api/review/jobs/${legacy.id}/recovery` &&
      response.request().method() === "GET"
    )
      legacyRecoveryResponses.push(
        response.json().then((state: RecoveryState) => ({
          status: response.status(),
          state,
        })),
      );
  });
  async function expectLegacyRecoveryReadable() {
    const responses = await Promise.all(legacyRecoveryResponses);
    expect(responses.length).toBeGreaterThan(0);
    for (const response of responses) {
      expect(response.status).toBe(200);
      // Supported review types have an owner-status API even without historical
      // owner metadata. This terminal cancelled batch needs Retry/Skip, not a
      // manual-recovery confirmation; pending/running batches still need lookup.
      expect(response.state).toMatchObject({
        jobId: legacy.id,
        ownerState: "unknown",
        manualRecoveryAllowed: false,
      });
    }
    return responses;
  }
  await initialLocale(page);
  await page.goto("/");
  await transcriptMode(page);
  const ownerRow = page.locator(
    `[data-testid="review-owner-recovery"][data-job-id="${partial.id}"]`,
  );
  await expect(ownerRow).toBeVisible();
  await expect(ownerRow).toContainText(t("interruptedReview"));
  const legacyRow = page.locator(
    `[data-testid="review-recovery-batch"][data-job-id="${legacy.id}"]`,
  );
  await expect(legacyRow).toHaveAttribute("data-batch-status", "cancelled");
  await expect(
    legacyRow.getByRole("button", { name: t("retryBatch"), exact: true }),
  ).toBeEnabled();
  await ownerRow
    .getByRole("button", { name: t("recoverReview"), exact: true })
    .click();
  await expect(ownerRow).toContainText(t("recoverReviewConfirm"));
  expect(recoveryPosts).toEqual([]);
  expect(
    (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.find(
      (job) => job.id === partial.id,
    ),
  ).toEqual(initialJob);
  await ownerRow
    .getByRole("button", { name: t("cancelRecovery"), exact: true })
    .click();
  await expect(
    ownerRow.getByRole("button", { name: t("confirmStopped"), exact: true }),
  ).toHaveCount(0);
  expect(recoveryPosts).toEqual([]);
  await ownerRow
    .getByRole("button", { name: t("recoverReview"), exact: true })
    .click();
  const recoveryResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/review/jobs/${partial.id}/recovery` &&
      response.request().method() === "POST",
  );
  await ownerRow
    .getByRole("button", { name: t("confirmStopped"), exact: true })
    .click();
  const acknowledged = await recoveryResponse;
  expect(acknowledged.status(), await acknowledged.text()).toBe(200);
  expect(recoveryPosts).toEqual([
    {
      confirmStopped: true,
      ownerToken: checkpoint.ownerToken,
      updatedAt: checkpoint.updatedAt,
    },
  ]);
  const recovered = ((await acknowledged.json()) as { job: Job }).job;
  expect(recovered).toMatchObject({
    id: partial.id,
    status: "failed",
    stage: "interrupted",
  });
  expect(recovered.reviewOwner!.token).not.toBe(checkpoint.ownerToken);
  await expect(ownerRow).toHaveCount(0);
  const batches = async () =>
    (
      await get<{ batches: ReviewBatch[] }>(
        request,
        `/review/jobs/${partial.id}/batches`,
      )
    ).batches;
  const afterRecovery = await batches();
  expect(afterRecovery.map((batch) => batch.status)).toEqual([
    "completed",
    "cancelled",
    "cancelled",
  ]);
  expect(afterRecovery[0]).toEqual(completed);
  expect(afterRecovery.map((batch) => batch.attempts)).toEqual([1, 1, 0]);
  expect(
    (
      await get<{ suggestions: TranscriptReviewSuggestion[] }>(
        request,
        `/assets/${asset.id}/review/suggestions`,
      )
    ).suggestions,
  ).toEqual(originalSuggestions);
  expect(
    await get<TranscriptState>(request, `/assets/${asset.id}/transcript`),
  ).toEqual(initialTranscript);
  expect(await unchangedFilm(request, asset.id, compositionId)).toEqual(
    filmBaseline,
  );
  expect(await hashFile(source)).toBe(sourceHash);
  const retryRow = page.locator(
    `[data-testid="review-recovery-batch"][data-job-id="${partial.id}"][data-batch-index="1"]`,
  );
  await expect(retryRow).toHaveAttribute("data-batch-status", "cancelled");
  await retryRow
    .getByRole("button", { name: t("retryBatch"), exact: true })
    .click();
  await expect.poll(async () => (await batches())[1]!.status).toBe("completed");
  const remaining = page.locator(
    `[data-testid="review-recovery-batch"][data-job-id="${partial.id}"][data-batch-index="2"]`,
  );
  await remaining
    .getByRole("button", { name: t("skipBatch"), exact: true })
    .click();
  await legacyRow
    .getByRole("button", { name: t("skipBatch"), exact: true })
    .click();
  await expect(legacyRow).toHaveCount(0);
  await expectLegacyRecoveryReadable();
  const finalBatches = await batches();
  expect(finalBatches.map((batch) => batch.status)).toEqual([
    "completed",
    "completed",
    "skipped",
  ]);
  expect(finalBatches.map((batch) => batch.attempts)).toEqual([1, 2, 0]);
  expect(finalBatches[0]).toEqual(completed);
  const finalJobs = (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.filter(
    (job) => [partial.id, legacy.id].includes(job.id),
  );
  expect(finalJobs.every((job) => job.status === "completed")).toBe(true);
  await page
    .getByRole("button", {
      name: uiText("en-US", "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await expect(page.locator(".launcher-actions")).toBeVisible();
  await openFilm(page, path);
  await transcriptMode(page);
  await expect(page.getByTestId("review-suggestion")).toHaveCount(1);
  await expect(page.getByTestId("review-owner-recovery")).toHaveCount(0);
  await expect(page.getByTestId("review-recovery-batch")).toHaveCount(0);
  expect(await batches()).toEqual(finalBatches);
  expect(
    (await get<{ jobs: Job[] }>(request, "/jobs")).jobs.filter((job) =>
      [partial.id, legacy.id].includes(job.id),
    ),
  ).toEqual(finalJobs);
  expect(
    (
      await get<{ suggestions: TranscriptReviewSuggestion[] }>(
        request,
        `/assets/${asset.id}/review/suggestions`,
      )
    ).suggestions,
  ).toEqual(originalSuggestions);
  expect(
    await get<TranscriptState>(request, `/assets/${asset.id}/transcript`),
  ).toEqual(initialTranscript);
  expect(await unchangedFilm(request, asset.id, compositionId)).toEqual(
    filmBaseline,
  );
  expect(await hashFile(source)).toBe(sourceHash);
  const legacyOwnerLookups = await expectLegacyRecoveryReadable();
  await testInfo.attach("review-recovery-evidence.json", {
    contentType: "application/json",
    body: JSON.stringify({
      fixture: "generated-media-explicit-foreign-owner-not-hardware-QA",
      sourceHash,
      checkpoint,
      recoveryPosts,
      afterRecovery,
      finalBatches,
      preservedSuggestionIds: originalSuggestions.map(
        (suggestion) => suggestion.id,
      ),
      transcriptRevision: initialTranscript.revision,
      finalJobIds: finalJobs.map((job) => job.id),
      legacyRecoveryReads,
      legacyOwnerLookups,
    }),
  });
});
