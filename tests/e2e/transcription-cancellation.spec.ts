import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication, TimelineEditor } from "@openfilm/application";
import { INTELLIGENCE_CACHE_VERSION } from "@openfilm/catalog";
import type {
  Job,
  MediaAsset,
  OpenFilmProject,
  ProjectContentLocale,
  TranscriptDocument,
} from "@openfilm/core";
import { hashFile, runProcess } from "@openfilm/media";
import type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "@openfilm/plugin-sdk";
import { startServer } from "../../apps/server/src/server.js";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

let mediaRoot: string;
let source: string;
test.use({ actionTimeout: 15_000, viewport: { width: 1280, height: 720 } });
test.beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "openfilm-cancellation-media-"));
  source = join(mediaRoot, "Generated memory 回憶 & #1.mp4");
  // Real procedural video/audio exercises import, playback and identity checks.
  // Provider text below is an explicit boundary fixture, never speech-quality QA.
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x455448:s=320x180:r=24:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=4",
    "-t",
    "4",
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
});
test.afterAll(async () => {
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
});

async function get<T>(
  request: APIRequestContext,
  api: string,
  path: string,
): Promise<T> {
  const response = await request.get(`${api}${path}`);
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json() as Promise<T>;
}

async function precision(page: Page, locale: ProjectContentLocale) {
  await navigate(page, "edit", locale);
  await page
    .getByRole("group", {
      name: uiText(locale, "precision.modeLabel"),
      exact: true,
    })
    .getByRole("button", {
      name: uiText(locale, "precision.precisionMode"),
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      page
        .getByLabel(uiText(locale, "precision.sourcePreview"), { exact: true })
        .evaluate((node) => (node as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
}

async function analysis(page: Page, locale: ProjectContentLocale) {
  await page
    .locator(".precision-panel-tabs")
    .getByRole("button", {
      name: uiText(locale, "precision.analysis"),
      exact: true,
    })
    .click();
  await expect(
    page.getByText(uiText(locale, "precision.modelReady"), { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(uiText(locale, "precision.language"))
    .selectOption("en");
  await page
    .getByLabel(uiText(locale, "precision.execution"))
    .selectOption("cpu");
}

function result(text: string, version: string): TranscriptionResult {
  return {
    text,
    language: "en",
    execution: "cpu",
    model: "explicit-cancellation-boundary-fixture-not-ASR",
    version,
    segments: [
      {
        start: 0.5,
        end: 2,
        text,
        words: [{ start: 0.5, end: 2, text }],
      },
    ],
  };
}

for (const locale of ["en-US", "zh-TW", "ja-JP"] as const) {
  test(`${locale}: cancelling an uncooperative transcription releases retry and project navigation without accepting late output`, async ({
    page,
    request,
  }, testInfo) => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-cancellation-browser-"),
    );
    const path = join(root, "Cancellation film.openfilm");
    const userDataDirectory = join(root, "isolated-user-data");
    const priorText = "Preserve this explicit prior transcript 回憶";
    const successorText = "The successor boundary result survives reopening";
    const sourceHash = await hashFile(source);
    let asset!: MediaAsset;
    const app = await OpenFilmApplication.create(
      path,
      "Cancel safely",
      {
        projectContentLocale: "en-US",
        filmSettings: {
          templateId: "blank",
          targetDuration: 3,
          maxDuration: 4,
        },
      },
      { userDataDirectory },
    );
    try {
      await app.importFiles([source]);
      asset = app.catalog.listAssets()[0]!;
      expect(asset).toBeDefined();
      app.catalog.intelligence.replaceTranscript({
        id: randomUUID(),
        assetId: asset.id,
        language: "en",
        provenance: {
          providerId: "explicit-prior-boundary-fixture-not-ASR",
          version: INTELLIGENCE_CACHE_VERSION,
          providerVersion: "prior-1",
          model: "explicit-cancellation-boundary-fixture-not-ASR",
          sourceHash,
          createdAt: "2026-10-07T00:00:00Z",
        },
        segments: [
          {
            id: "prior-segment",
            start: 0.5,
            end: 2,
            text: priorText,
            words: [{ start: 0.5, end: 2, text: priorText }],
            alignmentState: "original",
          },
        ],
      });
      const story = app.generateStory({ assetIds: [asset.id] });
      const composition = app.compose(story.id);
      const clip = composition.tracks
        .flatMap((track) => track.clips)
        .find((item) => item.assetId === asset.id)!;
      expect(clip).toBeDefined();
      const editor = new TimelineEditor(app);
      await editor.edit(composition.id, {
        baseRevision: editor.get(composition.id).revision,
        requestId: randomUUID(),
        commands: [
          { type: "trim", clipId: clip.id, sourceIn: 0.5, sourceOut: 3 },
          { type: "lock", clipId: clip.id, locked: true },
        ],
      });
      await app.save();
    } finally {
      app.close();
    }

    let firstOptions: TranscriptionOptions | undefined;
    const calls: TranscriptionOptions[] = [];
    let release!: (value: TranscriptionResult) => void;
    let heldSettled = false;
    const held = new Promise<TranscriptionResult>((resolve) => {
      release = resolve;
    });
    void held.then(() => {
      heldSettled = true;
    });
    const provider: TranscriptionProvider = {
      id: "explicit-uncooperative-browser-boundary-not-ASR",
      name: "Explicit cancellation boundary fixture — not speech recognition",
      kind: "transcription",
      execution: "local",
      dataKinds: ["audio", "metadata"],
      capabilities: {
        wordTimestamps: true,
        languages: ["en"],
        cpuFallback: true,
      },
      async transcribe(_asset, options) {
        expect(options).toBeDefined();
        calls.push(options!);
        options?.onStage?.("transcribing");
        options?.onProgress?.(0.4);
        if (calls.length === 1) {
          firstOptions = options;
          // Deliberately ignores AbortSignal. Only the test can resolve this
          // Promise, after cancel/retry/close/reopen have demonstrably succeeded.
          return held;
        }
        return result(successorText, "successor-1");
      },
    };
    const runtime = await startServer({
      port: 0,
      project: path,
      transcriptionProvider: provider,
      userDataDirectory,
    });
    const api = `http://127.0.0.1:${runtime.port}/api`;
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      // Use the real private HTTP service, not mocked responses. Only this page's
      // API traffic is forwarded; normal suite servers/project state stay intact.
      await page.route("**/api/**", async (route) => {
        const original = new URL(route.request().url());
        const upstream = await route.fetch({
          url: `http://127.0.0.1:${runtime.port}${original.pathname}${original.search}`,
          headers: {
            ...route.request().headers(),
            host: `127.0.0.1:${runtime.port}`,
          },
        });
        await route.fulfill({ response: upstream });
      });
      const initial = await get<{ transcript: TranscriptDocument }>(
        request,
        api,
        `/assets/${asset.id}/intelligence`,
      );
      expect(initial.transcript).toBeDefined();
      expect(initial.transcript.segments[0]?.text).toBe(priorText);
      const initialProject = await get<{ project: OpenFilmProject }>(
        request,
        api,
        "/project",
      );
      const film = {
        stories: initialProject.project.stories,
        compositions: initialProject.project.timelines,
      };
      await initialLocale(page, locale);
      await page.goto("/");
      await precision(page, locale);
      await expect(page.locator(".precision-words button")).toHaveText([
        priorText,
      ]);
      await analysis(page, locale);
      const transcribe = page
        .getByRole("region", {
          name: uiText(locale, "precision.analysis"),
          exact: true,
        })
        .getByRole("button", {
          name: uiText(locale, "precision.transcribe"),
          exact: true,
        });
      async function start() {
        const started = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/assets/${asset.id}/intelligence` &&
            response.request().method() === "POST",
        );
        await transcribe.click();
        const response = await started;
        expect(response.status()).toBe(202);
        return ((await response.json()) as { job: Job }).job.id;
      }
      async function job(id: string) {
        return (await get<{ jobs: Job[] }>(request, api, "/jobs")).jobs.find(
          (item) => item.id === id,
        );
      }
      const cancelledId = await start();
      await expect.poll(() => calls.length).toBe(1);
      expect(heldSettled).toBe(false);
      const cancelledRow = page.locator(
        `.precision-job[data-job-id="${cancelledId}"]`,
      );
      await expect(transcribe).toBeDisabled();
      const cancelResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/jobs/${cancelledId}/cancel` &&
          response.request().method() === "POST",
      );
      await cancelledRow
        .getByRole("button", {
          name: uiText(locale, "precision.cancelJob"),
          exact: true,
        })
        .click();
      expect((await cancelResponse).status()).toBe(200);
      await expect
        .poll(async () => (await job(cancelledId))?.status, { timeout: 5000 })
        .toBe("cancelled");
      await expect(cancelledRow).toContainText(
        uiText(locale, "precision.jobStatus.cancelled"),
      );
      await expect(transcribe).toBeEnabled();
      expect(firstOptions?.signal?.aborted).toBe(true);
      expect(heldSettled).toBe(false);
      expect(
        (
          await get<{ transcript: TranscriptDocument }>(
            request,
            api,
            `/assets/${asset.id}/intelligence`,
          )
        ).transcript,
      ).toEqual(initial.transcript);
      const cancelled = await job(cancelledId);

      // Retry succeeds while the cancelled provider call is still unresolved.
      const successorId = await start();
      await expect
        .poll(async () => (await job(successorId))?.status)
        .toBe("completed");
      expect(calls).toHaveLength(2);
      expect(heldSettled).toBe(false);
      const successor = await get<{ transcript: TranscriptDocument }>(
        request,
        api,
        `/assets/${asset.id}/intelligence`,
      );
      expect(successor.transcript.id).not.toBe(initial.transcript.id);
      expect(successor.transcript.segments[0]?.text).toBe(successorText);
      expect(successor.transcript.provenance.providerVersion).toBe(
        "successor-1",
      );
      const successorJob = await job(successorId);

      // Closing and reopening through the product UI must not await the old
      // provider Promise, and must preserve both terminal jobs and the new text.
      const closed = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/project/close" &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", {
          name: uiText(locale, "app.navigation.switchProject"),
          exact: true,
        })
        .click();
      expect((await closed).status()).toBe(200);
      await expect(page.locator(".launcher-actions")).toBeVisible();
      expect(heldSettled).toBe(false);
      await openFilm(page, path, locale);
      await precision(page, locale);
      await expect(page.locator(".precision-words button")).toHaveText([
        successorText,
      ]);
      expect(heldSettled).toBe(false);
      expect(await job(cancelledId)).toEqual(cancelled);
      expect(await job(successorId)).toEqual(successorJob);

      // Late callbacks and a valid late result try to write into an application
      // whose catalog has already closed. They must be ignored, without errors,
      // changing terminal job evidence, or replacing the successor transcript.
      firstOptions?.onStage?.("indexing");
      firstOptions?.onProgress?.(1);
      release(
        result("Late cancelled output must never become current", "late-1"),
      );
      await held;
      await nextTurn();
      expect(heldSettled).toBe(true);
      const reopened = await get<{ transcript: TranscriptDocument }>(
        request,
        api,
        `/assets/${asset.id}/intelligence`,
      );
      expect(reopened.transcript).toEqual(successor.transcript);
      expect(await job(cancelledId)).toEqual(cancelled);
      expect(await job(successorId)).toEqual(successorJob);
      const finalProject = await get<{ project: OpenFilmProject }>(
        request,
        api,
        "/project",
      );
      expect({
        stories: finalProject.project.stories,
        compositions: finalProject.project.timelines,
      }).toEqual(film);
      expect(await hashFile(source)).toBe(sourceHash);
      expect(pageErrors).toEqual([]);
      await testInfo.attach("transcription-cancellation-evidence", {
        body: JSON.stringify(
          {
            fixture: "explicit-provider-boundary-not-ASR",
            locale,
            cancelled,
            successor: successorJob,
            providerCalls: calls.length,
            heldThroughRetryAndReopen: true,
            lateOutputIgnored: true,
            sourceHash,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } finally {
      // A failing pre-fix run must release its deliberately uncooperative fixture
      // before stopping the private server, so cleanup cannot hang the suite.
      release(result("Cleanup-only late boundary result", "cleanup-1"));
      await held;
      await page.goto("about:blank");
      await page.unroute("**/api/**");
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
