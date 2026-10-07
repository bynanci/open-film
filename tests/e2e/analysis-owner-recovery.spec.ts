import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { OpenFilmApplication, TimelineEditor } from "@openfilm/application";
import { INTELLIGENCE_CACHE_VERSION, ProjectCatalog } from "@openfilm/catalog";
import type {
  Job,
  MediaAsset,
  OpenFilmProject,
  ProjectContentLocale,
  TranscriptDocument,
} from "@openfilm/core";
import { hashFile, runProcess } from "@openfilm/media";
import type {
  TranscriptionProvider,
  TranscriptionResult,
} from "@openfilm/plugin-sdk";
import { startServer } from "../../apps/server/src/server.js";
import { pseudoText } from "../../apps/desktop/src/i18n/pseudo.js";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

interface RecoveryState {
  jobId: string;
  ownerState: "alive" | "dead" | "unknown";
  manualRecoveryAllowed: boolean;
  canCancel: boolean;
  checkpoint: string;
  ownerToken?: string;
  updatedAt?: string;
}
interface TranscriptState {
  revision?: string;
  document?: TranscriptDocument;
}
type Locale = ProjectContentLocale | "en-XA";
const locales = ["en-US", "zh-TW", "ja-JP"] as const;
const sizes = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
let mediaRoot: string;
let source: string;
test.use({ actionTimeout: 15_000, viewport: sizes[0] });
test.beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "openfilm-analysis-owner-media-"));
  source = join(mediaRoot, "Generated memory 回憶 & #1.mp4");
  // Real procedural media exercises import, playback and source identity.
  // Provider results below are explicit boundaries, never real ASR quality QA.
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

function text(locale: Locale, key: string): string {
  const value = uiText(locale === "en-XA" ? "en-US" : locale, key);
  return locale === "en-XA" ? pseudoText(value) : value;
}
async function get<T>(
  request: APIRequestContext,
  api: string,
  path: string,
): Promise<T> {
  const response = await request.get(`${api}${path}`);
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json() as Promise<T>;
}
function result(value: string): TranscriptionResult {
  return {
    text: value,
    language: "en",
    execution: "cpu",
    model: "explicit-owner-recovery-boundary-not-ASR",
    version: "boundary-1",
    segments: [
      {
        start: 0.5,
        end: 2.5,
        text: value,
        words: [{ start: 0.5, end: 2.5, text: value }],
      },
    ],
  };
}
function provider(value: string, onCall?: () => void): TranscriptionProvider {
  return {
    id: "explicit-owner-recovery-boundary-not-ASR",
    name: "Explicit ownership boundary — not speech recognition",
    kind: "transcription",
    execution: "local",
    dataKinds: ["audio", "metadata"],
    capabilities: {
      wordTimestamps: true,
      languages: ["en"],
      cpuFallback: true,
    },
    async transcribe() {
      onCall?.();
      return result(value);
    },
  };
}

async function fixture(name: string) {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-analysis-owner-browser-"),
  );
  const path = join(root, "Recovery film.openfilm");
  const userDataDirectory = join(root, "isolated-user-data");
  const sourceHash = await hashFile(source);
  const app = await OpenFilmApplication.create(
    path,
    name,
    {
      projectContentLocale: "en-US",
      filmSettings: { templateId: "blank", targetDuration: 3, maxDuration: 4 },
    },
    { userDataDirectory },
  );
  let asset!: MediaAsset;
  try {
    await app.importFiles([source]);
    asset = app.catalog.listAssets()[0]!;
    expect(asset).toBeDefined();
    app.catalog.updateAsset(asset.id, { state: { favorite: true }, rating: 5 });
    app.catalog.intelligence.replaceTranscript({
      id: randomUUID(),
      assetId: asset.id,
      language: "en",
      provenance: {
        providerId: "explicit-prior-owner-fixture-not-ASR",
        version: INTELLIGENCE_CACHE_VERSION,
        providerVersion: "prior-1",
        sourceHash,
        createdAt: "2026-10-07T00:00:00Z",
      },
      segments: [
        {
          id: "prior-segment",
          start: 0.5,
          end: 2.5,
          text: "Prior transcript memory 回憶",
          words: [
            { start: 0.5, end: 2.5, text: "Prior transcript memory 回憶" },
          ],
          alignmentState: "original",
        },
      ],
    });
    const state = await app.transcriptEditor.get(asset.id);
    await app.transcriptEditor.edit(asset.id, {
      baseRevision: state.revision!,
      requestId: randomUUID(),
      commands: [
        {
          type: "replace-text",
          segmentId: "prior-segment",
          text: "Saved human correction 手動修正",
        },
      ],
    });
    const story = app.generateStory({ assetIds: [asset.id] });
    const composition = app.compose(story.id);
    const clip = composition.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.assetId === asset.id)!;
    const editor = new TimelineEditor(app);
    await editor.edit(composition.id, {
      baseRevision: editor.get(composition.id).revision,
      requestId: randomUUID(),
      commands: [
        { type: "trim", clipId: clip.id, sourceIn: 0.5, sourceOut: 3 },
        { type: "lock", clipId: clip.id, locked: true },
      ],
    });
    await app.intelligence.addMarker(asset.id, 1.5, "Preserved manual memory");
    await app.save();
  } finally {
    app.close();
  }
  return { root, path, userDataDirectory, sourceHash, asset };
}

async function forward(
  page: Page,
  port: number,
  beforeFetch?: (path: string, method: string) => Promise<void>,
) {
  // Forward actual HTTP requests to this private service; never fabricate /jobs.
  await page.route("**/api/**", async (route) => {
    const original = new URL(route.request().url());
    await beforeFetch?.(original.pathname, route.request().method());
    const response = await route.fetch({
      url: `http://127.0.0.1:${port}${original.pathname}${original.search}`,
      headers: { ...route.request().headers(), host: `127.0.0.1:${port}` },
    });
    await route.fulfill({ response });
  });
}
async function transcriptMode(page: Page, locale: Locale) {
  if (locale === "en-XA") await page.locator(".main-nav button").nth(2).click();
  else await navigate(page, "edit", locale);
  await page
    .getByRole("group", {
      name: text(locale, "precision.modeLabel"),
      exact: true,
    })
    .getByRole("button", { name: text(locale, "transcript.mode"), exact: true })
    .click();
  const workspace = page.getByTestId("transcript-workspace");
  await expect(workspace).toBeVisible();
  await expect(page.getByTestId("transcript-row")).toHaveCount(1);
  const details = workspace.locator(".transcript-transcribe");
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").click();
  return details;
}
function jobActions(parent: Locator, id: string) {
  return parent.locator(
    `[data-testid="analysis-job-actions"][data-job-id="${id}"]`,
  );
}
async function capture(
  page: Page,
  info: TestInfo,
  locale: Locale,
  name: string,
) {
  await expect
    .poll(() => page.evaluate(() => document.fonts.status))
    .toBe("loaded");
  const problems = await page.evaluate(() => {
    const issues: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth + 2)
      issues.push("Page exceeds viewport width");
    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="analysis-job-actions"] button, [data-testid="analysis-job-actions"] p',
      ),
    )) {
      if (!element.getClientRects().length) continue;
      const bounds = element.getBoundingClientRect();
      if (bounds.left < -2 || bounds.right > innerWidth + 2)
        issues.push(`Outside viewport: ${element.textContent}`);
      if (element.scrollWidth > element.clientWidth + 3)
        issues.push(`Clipped recovery label: ${element.textContent}`);
    }
    return issues;
  });
  expect(problems, `${locale} ${name}`).toEqual([]);
  expect(await page.locator("body").innerText()).not.toMatch(
    /\b(?:precision\.recovery|transcript|app)\.[\w.]+\b|\bundefined\b/u,
  );
  const size = page.viewportSize()!;
  await page.screenshot({
    path: info.outputPath(`${locale}-${name}-${size.width}x${size.height}.png`),
    fullPage: true,
    animations: "disabled",
  });
}
async function filmState(
  request: APIRequestContext,
  api: string,
  assetId: string,
) {
  const { project } = await get<{ project: OpenFilmProject }>(
    request,
    api,
    "/project",
  );
  const { assets } = await get<{ assets: MediaAsset[] }>(
    request,
    api,
    `/assets?ids=${assetId}&limit=100`,
  );
  const intelligence = await get<{ markers: unknown[] }>(
    request,
    api,
    `/assets/${assetId}/intelligence`,
  );
  return {
    stories: project.stories,
    compositions: project.timelines,
    rating: assets[0]?.rating,
    assetState: assets[0]?.state,
    markers: intelligence.markers,
  };
}
async function reopen(page: Page, path: string, locale: ProjectContentLocale) {
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
  await openFilm(page, path, locale);
}

for (const locale of locales) {
  test(`${locale}: unknown analysis recovery checks the current checkpoint, preserves a pending correction and enables explicit retry after reopening`, async ({
    page,
    request,
  }, info) => {
    const context = await fixture(`${locale} recover analysis`);
    const legacy = locale === "zh-TW";
    const job: Job = {
      id: randomUUID(),
      assetId: context.asset.id,
      type: "transcribe",
      status: "running",
      progress: 0.25,
      stage: "transcribing",
      createdAt: "2026-10-07T00:00:00Z",
      updatedAt: "2026-10-07T00:00:01Z",
      ...(legacy
        ? {}
        : {
            analysisOwner: {
              host: "explicit-unverifiable-portable-fixture-not-dead-process-evidence",
              pid: process.pid,
              token: randomUUID(),
            },
          }),
    };
    const catalog = new ProjectCatalog(context.path);
    try {
      catalog.saveJob(job);
    } finally {
      catalog.close();
    }
    const successorText = "Explicit retry creates a new provider revision 回憶";
    let providerCalls = 0;
    let saveArrivals = 0;
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let holdSave = false;
    let retrySawText: string | undefined;
    let recoveryRequests = 0;
    let cancelRequests = 0;
    const runtime = await startServer({
      port: 0,
      project: context.path,
      userDataDirectory: context.userDataDirectory,
      transcriptionProvider: provider(successorText, () => {
        providerCalls++;
      }),
    });
    const api = `http://127.0.0.1:${runtime.port}/api`;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await forward(page, runtime.port, async (path, method) => {
        if (method !== "POST") return;
        if (
          path === `/api/assets/${context.asset.id}/transcript/edit` &&
          holdSave
        ) {
          saveArrivals++;
          await saveGate;
        }
        if (path.endsWith("/recover")) recoveryRequests++;
        if (path.endsWith("/cancel")) cancelRequests++;
        if (path === `/api/assets/${context.asset.id}/intelligence`)
          retrySawText = (
            await get<TranscriptState>(
              request,
              api,
              `/assets/${context.asset.id}/transcript`,
            )
          ).document?.segments[0]?.text;
      });
      const before = await get<TranscriptState>(
        request,
        api,
        `/assets/${context.asset.id}/transcript`,
      );
      const film = await filmState(request, api, context.asset.id);
      const inspected = await get<RecoveryState>(
        request,
        api,
        `/intelligence/jobs/${job.id}/recovery`,
      );
      expect(inspected).toMatchObject({
        ownerState: "unknown",
        manualRecoveryAllowed: true,
        canCancel: false,
      });
      expect(inspected.ownerToken).toBe(job.analysisOwner?.token);
      await initialLocale(page, locale);
      await page.goto("/");
      let details = await transcriptMode(page, locale);
      let row = jobActions(details, job.id);
      await expect(row).toContainText(
        text(locale, "precision.recovery.unknown"),
      );
      await expect(
        row.getByRole("button", {
          name: text(locale, "precision.cancelJob"),
          exact: true,
        }),
      ).toHaveCount(0);
      const recover = () =>
        row.getByRole("button", {
          name: text(locale, "precision.recovery.recover"),
          exact: true,
        });
      const confirmation = () =>
        row.getByRole("group", {
          name: text(locale, "precision.recovery.confirmTitle"),
          exact: true,
        });
      await recover().click();
      await expect(confirmation()).toBeVisible();
      await expect(
        confirmation().getByRole("button", {
          name: text(locale, "precision.recovery.confirmStopped"),
          exact: true,
        }),
      ).toBeFocused();

      // A real second catalog changes the whole checkpoint without changing the
      // timestamp. The API must reject an old confirmation; polling dismisses it.
      const other = new ProjectCatalog(context.path);
      const progressed = { ...job, progress: 0.5 };
      try {
        other.saveJob(progressed);
      } finally {
        other.close();
      }
      const stale = await request.post(
        `${api}/intelligence/jobs/${job.id}/recover`,
        {
          data: {
            confirmStopped: true,
            checkpoint: inspected.checkpoint,
            ...(inspected.ownerToken
              ? { ownerToken: inspected.ownerToken }
              : {}),
          },
        },
      );
      expect(stale.status()).toBe(409);
      await expect(confirmation()).toHaveCount(0);
      const current = await get<RecoveryState>(
        request,
        api,
        `/intelligence/jobs/${job.id}/recovery`,
      );
      expect(current.updatedAt).toBe(inspected.updatedAt);
      expect(current.checkpoint).not.toBe(inspected.checkpoint);
      expect(
        (await get<{ jobs: Job[] }>(request, api, "/jobs")).jobs.find(
          (item) => item.id === job.id,
        ),
      ).toEqual(progressed);
      await recover().click();
      await confirmation()
        .getByRole("button", {
          name: text(locale, "precision.recovery.keepCurrent"),
          exact: true,
        })
        .click();
      await expect(confirmation()).toHaveCount(0);
      await expect(recover()).toBeFocused();
      expect(recoveryRequests).toBe(0);

      // Hold an actual command before HTTP arrival while recovery runs. The
      // product must keep the draft and its save queue, rather than reload it.
      const correction = `Pending manual correction ${locale} 手動修正`;
      holdSave = true;
      await page.getByTestId("transcript-text").fill(correction);
      await expect.poll(() => saveArrivals).toBe(1);
      await recover().click();
      for (const size of sizes) {
        await page.setViewportSize(size);
        await capture(page, info, locale, "unknown-analysis-confirmation");
      }
      const recoveredResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/intelligence/jobs/${job.id}/recover` &&
          response.request().method() === "POST",
      );
      await confirmation()
        .getByRole("button", {
          name: text(locale, "precision.recovery.confirmStopped"),
          exact: true,
        })
        .click();
      const response = await recoveredResponse;
      expect(response.status()).toBe(200);
      const recovered = ((await response.json()) as { job: Job }).job;
      expect(recovered).toMatchObject({
        status: "failed",
        stage: "interrupted",
      });
      expect(recovered.analysisOwner?.token).not.toBe(job.analysisOwner?.token);
      expect(response.request().postDataJSON()).toEqual({
        confirmStopped: true,
        checkpoint: current.checkpoint,
        ...(current.ownerToken ? { ownerToken: current.ownerToken } : {}),
      });
      await expect(page.getByTestId("transcript-text")).toHaveValue(correction);
      expect(
        await get<TranscriptState>(
          request,
          api,
          `/assets/${context.asset.id}/transcript`,
        ),
      ).toEqual(before);
      expect(await filmState(request, api, context.asset.id)).toEqual(film);
      expect(providerCalls).toBe(0);
      expect(recoveryRequests).toBe(1);
      expect(cancelRequests).toBe(0);
      holdSave = false;
      releaseSave();
      await expect(page.getByTestId("transcript-save-state")).toHaveText(
        text(locale, "transcript.saved"),
      );
      const saved = await get<TranscriptState>(
        request,
        api,
        `/assets/${context.asset.id}/transcript`,
      );
      expect(saved.document?.segments[0]).toMatchObject({
        text: correction,
        alignmentState: "text-edited",
      });
      await reopen(page, context.path, locale);
      details = await transcriptMode(page, locale);
      row = jobActions(details, job.id);
      await expect(row).toHaveCount(0);
      await expect(page.getByTestId("transcript-text")).toHaveValue(correction);
      expect(
        (await get<{ jobs: Job[] }>(request, api, "/jobs")).jobs.find(
          (item) => item.id === job.id,
        ),
      ).toEqual(recovered);
      expect(await filmState(request, api, context.asset.id)).toEqual(film);

      // Recovery never retries automatically. The existing explicit action must
      // warn about the saved human revision and retain it after provider success.
      // This explicit boundary provider supports English, not automatic
      // detection. Choose its actual capability through the product control.
      await details
        .getByLabel(text(locale, "transcript.language"), { exact: true })
        .selectOption("en");
      const retry = details.getByRole("button", {
        name: text(locale, "transcript.retranscribe"),
        exact: true,
      });
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect(
        details.getByText(text(locale, "transcript.retranscribeWarning"), {
          exact: true,
        }),
      ).toBeVisible();
      expect(providerCalls).toBe(0);
      const retryResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/assets/${context.asset.id}/intelligence` &&
          response.request().method() === "POST",
      );
      await details
        .getByRole("button", {
          name: text(locale, "transcript.continueTranscription"),
          exact: true,
        })
        .click();
      const retryHttp = await retryResponse;
      expect(retryHttp.status()).toBe(202);
      const successorId = ((await retryHttp.json()) as { job: Job }).job.id;
      await expect
        .poll(
          async () =>
            (await get<{ jobs: Job[] }>(request, api, "/jobs")).jobs.find(
              (item) => item.id === successorId,
            )?.status,
        )
        .toBe("completed");
      expect(providerCalls).toBe(1);
      expect(retrySawText).toBe(correction);
      const historical = await get<TranscriptState>(
        request,
        api,
        `/assets/${context.asset.id}/transcript?revisionId=${encodeURIComponent(saved.revision!)}`,
      );
      expect(historical.document?.segments[0]?.text).toBe(correction);
      await reopen(page, context.path, locale);
      await transcriptMode(page, locale);
      await expect(page.getByTestId("transcript-text")).toHaveValue(
        successorText,
      );
      expect(await filmState(request, api, context.asset.id)).toEqual(film);
      expect(await hashFile(source)).toBe(context.sourceHash);
      expect(errors).toEqual([]);
      await info.attach("analysis-owner-recovery-evidence", {
        body: JSON.stringify(
          {
            locale,
            fixture: legacy
              ? "explicit-ownerless-legacy-job"
              : "explicit-unverifiable-portable-owner",
            inspected,
            current,
            recovered,
            successorId,
            providerCalls,
            pendingDraftPreserved: true,
            historicalRevision: saved.revision,
            sourceHash: context.sourceHash,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } finally {
      releaseSave();
      await page.goto("about:blank");
      await page.unroute("**/api/**");
      await runtime.close();
      await rm(context.root, { recursive: true, force: true });
    }
  });
}

async function liveWorker(context: Awaited<ReturnType<typeof fixture>>) {
  const file = join(context.root, "actual-analysis-worker.mts");
  const jobId = randomUUID();
  await writeFile(
    file,
    `
    import { OpenFilmApplication } from ${JSON.stringify(new URL("../../packages/application/src/index.ts", import.meta.url).href)};
    const [directory, userDataDirectory, assetId, jobId] = process.argv.slice(2);
    const app = await OpenFilmApplication.open(directory, { userDataDirectory });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    process.on("message", message => { if (message === "release") release(); });
    app.intelligence.registerTranscriptionProvider({ id: "actual-child-boundary-not-ASR", name: "Actual child ownership boundary", kind: "transcription", execution: "local", dataKinds: ["audio", "metadata"], capabilities: { wordTimestamps: true, languages: ["en"], cpuFallback: true },
      async transcribe(_asset, options) { options.onProgress?.(0.4); process.send({ type: "ready", job: app.catalog.listJobs().find(job => job.id === jobId) }); await held; return ${JSON.stringify(result("Actual live child finishes its own revision"))}; } });
    try { const job = await app.analyzeIntelligence(assetId, { operation: "transcribe", jobId }); app.close(); process.send({ type: "finished", job }); process.disconnect(); }
    catch (error) { process.send({ type: "error", message: String(error) }); app.close(); process.disconnect(); process.exitCode = 1; }
  `,
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      createRequire(import.meta.url).resolve("tsx"),
      file,
      context.path,
      context.userDataDirectory,
      context.asset.id,
      jobId,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: join(process.cwd(), "tsconfig.json"),
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const messages: { type: string; job?: Job; message?: string }[] = [];
  let stderr = "";
  child.stderr!.on("data", (value) => {
    stderr += String(value);
  });
  child.on("message", (value) =>
    messages.push(value as (typeof messages)[number]),
  );
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  async function message(type: string) {
    await expect
      .poll(
        () => {
          if (
            messages.some((value) => value.type === "error") ||
            (child.exitCode !== null &&
              !messages.some((value) => value.type === type))
          )
            throw new Error(JSON.stringify(messages) + stderr);
          return messages.find((value) => value.type === type);
        },
        { timeout: 15_000 },
      )
      .toBeDefined();
    return messages.find((value) => value.type === type)!;
  }
  return {
    child,
    jobId,
    exit,
    ready: () => message("ready"),
    finished: () => message("finished"),
    release: () => child.send("release"),
    async close() {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exit;
    },
  };
}

test("a real live foreign analysis process has no local Cancel or manual recovery on Activity, Precision or Transcript", async ({
  page,
  request,
}, info) => {
  test.skip(
    process.platform !== "linux",
    "Verified process scope requires Linux boot/PID-namespace evidence; other platforms remain a manual liveness gate.",
  );
  const context = await fixture("Actual foreign analysis owner");
  const worker = await liveWorker(context);
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const ready = await worker.ready();
    expect(ready.job?.analysisOwner?.pid).toBe(worker.child.pid);
    expect(() => process.kill(worker.child.pid!, 0)).not.toThrow();
    runtime = await startServer({
      port: 0,
      project: context.path,
      userDataDirectory: context.userDataDirectory,
    });
    const api = `http://127.0.0.1:${runtime.port}/api`;
    await forward(page, runtime.port);
    const state = await get<RecoveryState>(
      request,
      api,
      `/intelligence/jobs/${worker.jobId}/recovery`,
    );
    expect(state).toMatchObject({
      ownerState: "alive",
      canCancel: false,
      manualRecoveryAllowed: false,
    });
    const film = await filmState(request, api, context.asset.id);
    const before = await get<TranscriptState>(
      request,
      api,
      `/assets/${context.asset.id}/transcript`,
    );
    await initialLocale(page, "en-US");
    await page.goto("/");
    async function foreign(parent: Locator) {
      const row = jobActions(parent, worker.jobId);
      await expect(row).toContainText(
        text("en-US", "precision.recovery.runningElsewhere"),
      );
      await expect(row.locator("button")).toHaveCount(0);
    }
    await foreign(page.locator(".activity-strip"));
    await navigate(page, "edit");
    await page
      .getByRole("group", {
        name: text("en-US", "precision.modeLabel"),
        exact: true,
      })
      .getByRole("button", {
        name: text("en-US", "precision.precisionMode"),
        exact: true,
      })
      .click();
    await page
      .locator(".precision-panel-tabs")
      .getByRole("button", {
        name: text("en-US", "precision.analysis"),
        exact: true,
      })
      .click();
    await foreign(
      page.getByRole("region", {
        name: text("en-US", "precision.title"),
        exact: true,
      }),
    );
    const details = await transcriptMode(page, "en-US");
    await foreign(details);
    expect(
      await get<TranscriptState>(
        request,
        api,
        `/assets/${context.asset.id}/transcript`,
      ),
    ).toEqual(before);
    // Even an explicit forged confirmation cannot recover a proven-live owner.
    const response = await request.post(
      `${api}/intelligence/jobs/${worker.jobId}/recover`,
      {
        data: {
          confirmStopped: true,
          checkpoint: state.checkpoint,
          ownerToken: state.ownerToken,
        },
      },
    );
    expect(response.status()).toBe(409);
    expect(
      (await get<{ jobs: Job[] }>(request, api, "/jobs")).jobs.find(
        (item) => item.id === worker.jobId,
      ),
    ).toEqual(ready.job);
    worker.release();
    const finished = await worker.finished();
    expect(finished.job?.status).toBe("completed");
    expect(await worker.exit).toEqual({ code: 0, signal: null });
    await expect(page.getByTestId("transcript-text")).toHaveValue(
      "Actual live child finishes its own revision",
    );
    expect(await filmState(request, api, context.asset.id)).toEqual(film);
    await info.attach("actual-live-analysis-owner-evidence", {
      body: JSON.stringify(
        {
          processPid: worker.child.pid,
          ready: ready.job,
          state,
          finished: finished.job,
          fixture:
            "actual-child-application-with-held-provider-boundary-not-ASR",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await worker.close();
    await page.goto("about:blank");
    await page.unroute("**/api/**");
    await runtime?.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("pseudo-localized recovery confirmation remains readable and keyboard reachable at three desktop sizes", async ({
  page,
}, info) => {
  const context = await fixture("Pseudo-localized recovery");
  const job: Job = {
    id: randomUUID(),
    type: "transcribe",
    assetId: context.asset.id,
    status: "queued",
    progress: 0,
    createdAt: "2026-10-07T00:00:00Z",
  };
  const catalog = new ProjectCatalog(context.path);
  try {
    catalog.saveJob(job);
  } finally {
    catalog.close();
  }
  const runtime = await startServer({
    port: 0,
    project: context.path,
    userDataDirectory: context.userDataDirectory,
  });
  try {
    await forward(page, runtime.port);
    await page.addInitScript(() =>
      localStorage.setItem("openfilm.uiLocale", "en-XA"),
    );
    await page.goto("/");
    const details = await transcriptMode(page, "en-XA");
    const row = jobActions(details, job.id);
    const recover = row.getByRole("button", {
      name: text("en-XA", "precision.recovery.recover"),
      exact: true,
    });
    await recover.focus();
    await page.keyboard.press("Enter");
    const confirmation = row.getByRole("group", {
      name: text("en-XA", "precision.recovery.confirmTitle"),
      exact: true,
    });
    const confirm = confirmation.getByRole("button", {
      name: text("en-XA", "precision.recovery.confirmStopped"),
      exact: true,
    });
    await expect(confirm).toBeFocused();
    for (const size of sizes) {
      await page.setViewportSize(size);
      await capture(page, info, "en-XA", "unknown-analysis-confirmation");
    }
    await confirm.focus();
    await page.keyboard.press("Tab");
    const keep = confirmation.getByRole("button", {
      name: text("en-XA", "precision.recovery.keepCurrent"),
      exact: true,
    });
    await expect(keep).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirmation).toHaveCount(0);
    await expect(recover).toBeFocused();
  } finally {
    await page.goto("about:blank");
    await page.unroute("**/api/**");
    await runtime.close();
    await rm(context.root, { recursive: true, force: true });
  }
});
