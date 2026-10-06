import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type {
  Composition,
  Job,
  MediaAsset,
  OpenFilmProject,
  ProjectContentLocale,
  SceneAnalysis,
  TimelineMarker,
  TranscriptDocument,
  WaveformData,
} from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import axe from "axe-core";
import {
  chooseImportFolder,
  createFilm,
  initialLocale,
  navigate,
  openFilm,
  uiText,
} from "./ui-helpers.js";

const base = "http://127.0.0.1:4310/api";
const videoName = "01-spoken-memory.mp4";
const sizes = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
let root: string;
let mediaDirectory: string;
const originalHashes = new Map<string, string>();

type Intelligence = {
  sourceHash: string;
  transcript?: TranscriptDocument;
  transcriptTotal: number;
  waveform?: WaveformData;
  scenes?: SceneAnalysis;
  markers: TimelineMarker[];
};

test.use({ actionTimeout: 15_000, viewport: sizes[0] });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-precision-browser-"));
  mediaDirectory = join(root, "Synthetic memories 回憶 & #1");
  await mkdir(mediaDirectory);
  const ffmpeg = (args: string[]) =>
    runProcess("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-threads",
      "1",
      ...args,
    ]);
  // Original procedural imagery and synthesized speech/tones. This recording is
  // not a recognition benchmark: the explicit server test runner returns fixed
  // text and scaled word timing, while import/FFmpeg/jobs/storage/UI remain real.
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=320x180:r=24:d=4",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=320x180:r=24:d=4",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=320x180:r=24:d=4",
    "-f",
    "lavfi",
    "-i",
    "flite=text='Our favorite memory starts here. We will remember this day.':voice=slt,apad=whole_dur=12",
    "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map",
    "[v]",
    "-map",
    "3:a",
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
    join(mediaDirectory, videoName),
  ]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0x246a75:s=320x180,drawbox=x=40:y=30:w=100:h=120:color=0xf7c88b:t=fill",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-update",
    "1",
    "-y",
    join(mediaDirectory, "02-memory.png"),
  ]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=3",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000:duration=3",
    "-filter_complex",
    "[0:a][1:a]concat=n=2:v=0:a=1[a]",
    "-map",
    "[a]",
    "-c:a",
    "pcm_s16le",
    "-y",
    join(mediaDirectory, "03-procedural-music.wav"),
  ]);
  for (const name of [videoName, "02-memory.png", "03-procedural-music.wav"])
    originalHashes.set(
      name,
      createHash("sha256")
        .update(await readFile(join(mediaDirectory, name)))
        .digest("hex"),
    );
});
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
});
test.afterEach(async ({ request }) => {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
});
test.afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function project(request: APIRequestContext): Promise<OpenFilmProject> {
  const response = await request.get(`${base}/project`);
  expect(response.ok()).toBe(true);
  return (await response.json()).project;
}
async function intelligence(
  request: APIRequestContext,
  assetId: string,
): Promise<Intelligence> {
  const response = await request.get(
    `${base}/assets/${assetId}/intelligence?limit=100`,
  );
  expect(response.ok()).toBe(true);
  return response.json();
}
async function composition(request: APIRequestContext): Promise<Composition> {
  return (await project(request)).timelines.at(-1) as Composition;
}
const allClips = (cut: Composition) =>
  cut.tracks.flatMap((track) => track.clips);
const clipById = (cut: Composition, id: string) =>
  allClips(cut).find((clip) => clip.id === id)!;
const text = (locale: ProjectContentLocale, key: string) => uiText(locale, key);

async function saved(page: Page, locale: ProjectContentLocale) {
  await expect(page.locator(".editor-save-state")).toHaveText(
    text(locale, "editor.save.saved"),
  );
}
async function mode(
  page: Page,
  locale: ProjectContentLocale,
  value: "story" | "precision",
) {
  await page
    .getByRole("group", {
      name: text(locale, "precision.modeLabel"),
      exact: true,
    })
    .getByRole("button", {
      name: text(locale, `precision.${value}Mode`),
      exact: true,
    })
    .click();
}
async function createSourceFilm(
  page: Page,
  request: APIRequestContext,
  locale: ProjectContentLocale,
  suffix = "",
) {
  await initialLocale(page, locale);
  await page.goto("/");
  const path = join(root, `${locale}-precision${suffix}.openfilm`);
  await createFilm(
    page,
    {
      title: `${locale} precision memories`,
      path,
      contentLocale: locale,
      templateId: locale === "en-US" ? "proposal-film" : "blank",
      targetDuration: 18,
      maxDuration: 30,
    },
    locale,
  );
  await chooseImportFolder(page, mediaDirectory, locale);
  await expect(
    page.getByText(text(locale, "app.activity.import.complete"), {
      exact: true,
    }),
  ).toBeVisible({ timeout: 60_000 });
  const assetsResponse = await request.get(`${base}/assets?limit=100`);
  expect(assetsResponse.ok()).toBe(true);
  const assets = (await assetsResponse.json()).assets as MediaAsset[];
  expect(assets).toHaveLength(3);
  const video = assets.find((asset) => asset.name === videoName)!;
  const audio = assets.find((asset) => asset.mediaType === "audio")!;
  await navigate(page, "story", locale);
  await page
    .getByRole("button", {
      name: text(locale, "app.story.createFirst"),
      exact: true,
    })
    .click();
  await page
    .getByLabel(text(locale, "app.story.title"), { exact: true })
    .fill("Keep these words / この言葉を残す");
  await page
    .getByRole("button", { name: text(locale, "app.story.plan"), exact: true })
    .click();
  const story = (await project(request)).stories[0]!;
  for (const asset of [video, audio]) {
    const beatIndex = story.beats.findIndex((beat) =>
      beat.candidateAssetIds?.includes(asset.id),
    );
    expect(beatIndex).toBeGreaterThanOrEqual(0);
    await page.locator(".beat-list button").nth(beatIndex).click();
    await page
      .getByRole("button", {
        name: uiText(locale, "media.card.select", { name: asset.name }),
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: text(locale, "app.story.saveBeat"),
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await project(request)).stories[0]!.beats[beatIndex]!
            .selectedAssetIds,
      )
      .toContain(asset.id);
  }
  await page
    .getByRole("button", {
      name: text(locale, "app.story.compose"),
      exact: true,
    })
    .click();
  await saved(page, locale);
  const cut = await composition(request);
  expect(
    new Set(
      allClips(cut).map(
        (entry) =>
          assets.find((asset) => asset.id === entry.assetId)?.mediaType,
      ),
    ),
  ).toEqual(new Set(["video", "image", "audio"]));
  const clip = allClips(cut).find((entry) => entry.assetId === video.id)!;
  const audioClip = allClips(cut).find((entry) => entry.assetId === audio.id)!;
  expect(clip).toBeDefined();
  expect(audioClip).toBeDefined();
  await mode(page, locale, "precision");
  await page
    .locator(".precision-source-picker")
    .getByLabel(text(locale, "precision.selectedClip"))
    .selectOption(clip.id);
  const preview = page.getByLabel(text(locale, "precision.sourcePreview"), {
    exact: true,
  });
  await expect
    .poll(() =>
      preview.evaluate((node) => (node as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
  return { path, video, clip, audioClip };
}
async function analyze(
  page: Page,
  request: APIRequestContext,
  locale: ProjectContentLocale,
  assetId: string,
  operation: "transcribe" | "waveform" | "scenes",
  whileRunning?: (jobId: string) => Promise<void>,
) {
  const key = {
    transcribe: "transcribe",
    waveform: "analyzeWaveform",
    scenes: "detectScenes",
  }[operation];
  const responseEvent = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/assets/${assetId}/intelligence` &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("region", {
      name: text(locale, "precision.analysis"),
      exact: true,
    })
    .getByRole("button", {
      name: text(locale, `precision.${key}`),
      exact: true,
    })
    .click();
  const response = await responseEvent;
  expect(response.status()).toBe(202);
  const jobId = (await response.json()).job.id as string;
  if (whileRunning) await whileRunning(jobId);
  let result: Job | undefined;
  await expect
    .poll(
      async () => {
        const jobsResponse = await request.get(`${base}/jobs`);
        expect(jobsResponse.ok()).toBe(true);
        result = ((await jobsResponse.json()).jobs as Job[]).find(
          (job) => job.id === jobId,
        );
        return result?.status;
      },
      { timeout: 30_000 },
    )
    .toBe("completed");
  expect(result!.errors).toBeUndefined();
  await expect(
    page.locator(`.precision-job[data-job-id="${jobId}"]`),
  ).toContainText(text(locale, "precision.jobStatus.completed"));
  return result!;
}
async function analysisPanel(page: Page, locale: ProjectContentLocale) {
  await page
    .locator(".precision-panel-tabs")
    .getByRole("button", {
      name: text(locale, "precision.analysis"),
      exact: true,
    })
    .click();
  await expect(
    page.getByText(text(locale, "precision.modelReady"), { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(text(locale, "precision.execution"))
    .selectOption("cpu");
}
async function screenChecks(page: Page, locale: ProjectContentLocale) {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(size.width);
    await expect(page.locator(".precision-player-region")).toBeInViewport({
      ratio: 1,
    });
    await expect(page.locator(".precision-panel-tabs")).toBeInViewport({
      ratio: 1,
    });
    await expect(page.locator(".precision-panel")).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(
      /(?:^|\s)(?:precision|app|editor|media)\.[a-zA-Z][\w.-]+\b|\bundefined\b/u,
    );
    if (size.width === 1280) {
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const checker = (window as unknown as { axe: typeof axe }).axe;
        const result = await checker.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
          },
        });
        return result.violations.map((rule) => ({
          id: rule.id,
          help: rule.help,
          nodes: rule.nodes.map((node) => ({
            target: node.target,
            reason: node.failureSummary,
          })),
        }));
      });
      expect(violations, `${locale} precision accessibility`).toEqual([]);
    }
    await page.screenshot({
      path: test
        .info()
        .outputPath(`${locale}-precision-${size.width}x${size.height}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize(sizes[0]!);
}
async function seekWord(
  page: Page,
  locale: ProjectContentLocale,
  index: number,
  expected: number,
) {
  await page
    .locator(".precision-panel-tabs")
    .getByRole("button", {
      name: text(locale, "precision.transcript"),
      exact: true,
    })
    .click();
  await page.locator(".precision-words button").nth(index).click();
  await expect
    .poll(() =>
      page
        .getByLabel(text(locale, "precision.sourcePreview"), { exact: true })
        .evaluate((node) => (node as HTMLMediaElement).currentTime),
    )
    .toBeCloseTo(expected, 2);
}

test("invalidates source evidence after rejected reads, marker writes and failed jobs, then recovers on refresh", async ({
  page,
  request,
}) => {
  const locale = "en-US";
  const original = await readFile(join(mediaDirectory, videoName));
  const changed = Buffer.concat([
    original,
    Buffer.from("precision-source-verification-regression"),
  ]);
  const { video } = await createSourceFilm(
    page,
    request,
    locale,
    "-source-invalidation",
  );
  const before = await composition(request);
  let wordCount = 0;
  const panel = (name: "analysis" | "transcript") =>
    page.locator(".precision-panel-tabs").getByRole("button", {
      name: text(locale, `precision.${name}`),
      exact: true,
    });
  const trimIn = page.getByRole("spinbutton", {
    name: text(locale, "precision.trimIn"),
    exact: true,
  });
  const marker = page.getByRole("button", {
    name: text(locale, "precision.addMarker"),
    exact: true,
  });
  const refresh = page.getByRole("button", {
    name: text(locale, "precision.refresh"),
    exact: true,
  });
  const startTranscription = async () => {
    const started = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/assets/${video.id}/intelligence` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("region", {
        name: text(locale, "precision.analysis"),
        exact: true,
      })
      .getByRole("button", {
        name: text(locale, "precision.transcribe"),
        exact: true,
      })
      .click();
    const response = await started;
    expect(response.status()).toBe(202);
    return (await response.json()).job.id as string;
  };
  const expectEvidence = async (available: boolean) => {
    await panel("transcript").click();
    await expect(page.locator(".precision-words button")).toHaveCount(
      available ? wordCount : 0,
    );
    if (available)
      await expect(page.locator(".precision-wave-path")).not.toHaveAttribute(
        "d",
        "",
      );
    else
      await expect(page.locator(".precision-wave-path")).toHaveAttribute(
        "d",
        "",
      );
    await expect(page.locator(".precision-marker-line")).toHaveCount(
      available ? 1 : 0,
    );
    if (available) {
      await expect(trimIn).toBeEnabled();
      await expect(marker).toBeEnabled();
      await expect(
        page.getByLabel(text(locale, "precision.snap"), { exact: true }),
      ).toBeEnabled();
    } else {
      await expect(trimIn).toBeDisabled();
      await expect(marker).toBeDisabled();
      await expect(
        page.getByLabel(text(locale, "precision.snap"), { exact: true }),
      ).toBeDisabled();
      await page.locator(".precision-waveform").press("m");
      await page.locator(".precision-waveform").press("b");
    }
    expect(await composition(request)).toEqual(before);
  };
  const recover = async () => {
    await writeFile(join(mediaDirectory, videoName), original);
    await panel("analysis").click();
    await refresh.click();
    await expectEvidence(true);
    await expect(page.locator(".precision-editor [role=alert]")).toHaveCount(0);
  };
  try {
    await analysisPanel(page, locale);
    await analyze(page, request, locale, video.id, "transcribe");
    await analyze(page, request, locale, video.id, "waveform");
    await marker.click();
    await expect
      .poll(async () => (await intelligence(request, video.id)).markers.length)
      .toBe(1);
    const evidence = await intelligence(request, video.id);
    wordCount = evidence.transcript!.segments.reduce(
      (count, segment) => count + (segment.words?.length ?? 0),
      0,
    );
    expect(wordCount).toBeGreaterThan(0);
    // Cancelling a replacement analysis keeps already verified evidence usable.
    const cancelledId = await startTranscription();
    await page
      .locator(`.precision-job[data-job-id="${cancelledId}"]`)
      .getByRole("button", {
        name: text(locale, "precision.cancelJob"),
        exact: true,
      })
      .click();
    await expect(
      page.locator(`.precision-job[data-job-id="${cancelledId}"]`),
    ).toContainText(text(locale, "precision.jobStatus.cancelled"));
    expect((await intelligence(request, video.id)).transcript).toEqual(
      evidence.transcript,
    );
    await expectEvidence(true);

    // Returning from Story re-verifies the bytes even when the asset ID, URI and
    // imported hash are unchanged. The failed read must remove old snap evidence.
    await mode(page, locale, "story");
    await writeFile(join(mediaDirectory, videoName), changed);
    const rejectedRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/assets/${video.id}/intelligence` &&
        response.request().method() === "GET",
    );
    await mode(page, locale, "precision");
    expect((await rejectedRead).status()).toBe(409);
    await expectEvidence(false);
    await recover();

    // Marker mutations can discover a changed source while the view is active.
    await writeFile(join(mediaDirectory, videoName), changed);
    const rejectedMarker = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/assets/${video.id}/markers` &&
        response.request().method() === "POST",
    );
    await marker.click();
    expect((await rejectedMarker).status()).toBe(409);
    await expectEvidence(false);
    await recover();

    // A job verifies the source again before persisting its result. A failure
    // delivered through job polling must invalidate the same evidence.
    await panel("analysis").click();
    const failedId = await startTranscription();
    await expect
      .poll(async () => {
        const jobs = (await (await request.get(`${base}/jobs`)).json())
          .jobs as Job[];
        return jobs.find((job) => job.id === failedId)?.stage;
      })
      .toBe("transcribing");
    await writeFile(join(mediaDirectory, videoName), changed);
    await expect(
      page.locator(`.precision-job[data-job-id="${failedId}"]`),
    ).toContainText(text(locale, "precision.jobStatus.failed"), {
      timeout: 30_000,
    });
    const jobs = (await (await request.get(`${base}/jobs`)).json())
      .jobs as Job[];
    expect(jobs.find((job) => job.id === failedId)?.errors?.[0]?.code).toBe(
      "source.changed",
    );
    await expectEvidence(false);
    await recover();
    expect((await intelligence(request, video.id)).transcript).toEqual(
      evidence.transcript,
    );
  } finally {
    await writeFile(join(mediaDirectory, videoName), original);
  }
});

test("uses real source analysis, a disclosed protocol transcript, snapped trim and shared split history", async ({
  page,
  request,
}) => {
  const locale = "en-US";
  const missingKeys: string[] = [];
  page.on("console", (message) => {
    if (/Missing translation|Not found.*key/.test(message.text()))
      missingKeys.push(message.text());
  });
  test.info().annotations.push({
    type: "provider",
    description:
      "Deterministic subprocess fixture, not ASR; FFmpeg source analysis and editing are real.",
  });
  const { path, video, clip, audioClip } = await createSourceFilm(
    page,
    request,
    locale,
  );
  await mode(page, locale, "story");
  await page.getByRole("button", { name: "Mute clip", exact: true }).click();
  await saved(page, locale);
  await mode(page, locale, "precision");
  await expect
    .poll(() =>
      page
        .getByLabel(text(locale, "precision.sourcePreview"), { exact: true })
        .evaluate((node) => (node as HTMLMediaElement).volume),
    )
    .toBe(0);
  await mode(page, locale, "story");
  await page.getByRole("button", { name: "Unmute clip", exact: true }).click();
  await saved(page, locale);
  await mode(page, locale, "precision");
  await expect
    .poll(() =>
      page
        .getByLabel(text(locale, "precision.sourcePreview"), { exact: true })
        .evaluate((node) => (node as HTMLMediaElement).volume),
    )
    .toBe(1);
  const beforeAnalysis = await composition(request);
  const setEdge = async (edge: "In" | "Out", value: number) => {
    const input = page.getByRole("spinbutton", {
      name: text(locale, `precision.trim${edge}`),
      exact: true,
    });
    await input.fill(String(value));
    await input.press("Tab");
    await saved(page, locale);
  };
  const undoEdits = async (count: number) => {
    for (let index = 0; index < count; index++) {
      await page
        .getByRole("button", { name: "Undo edit", exact: true })
        .click();
      await saved(page, locale);
    }
    expect(await composition(request)).toEqual(beforeAnalysis);
  };
  // Valid sub-frame selections stay positive at either source boundary. A
  // keyboard frame step must clamp within the tiny span rather than invert it.
  await setEdge("Out", 0.005);
  await page
    .getByRole("slider", {
      name: text(locale, "precision.trimOut"),
      exact: true,
    })
    .press("ArrowLeft");
  await saved(page, locale);
  const tinyStart = clipById(await composition(request), clip.id);
  expect(tinyStart.sourceIn).toBe(0);
  expect(tinyStart.sourceOut).toBeGreaterThan(0);
  expect(tinyStart.sourceOut).toBeLessThan(0.005);
  await undoEdits(2);
  await setEdge("Out", video.duration!);
  await setEdge("In", video.duration! - 0.005);
  await page
    .getByRole("slider", {
      name: text(locale, "precision.trimIn"),
      exact: true,
    })
    .press("ArrowRight");
  await saved(page, locale);
  const tinyEnd = clipById(await composition(request), clip.id);
  expect(tinyEnd.sourceIn).toBeGreaterThan(video.duration! - 0.005);
  expect(tinyEnd.sourceIn).toBeLessThan(video.duration!);
  expect(tinyEnd.sourceOut).toBe(video.duration!);
  await undoEdits(3);
  await analysisPanel(page, locale);
  await page.getByLabel(text(locale, "precision.language")).selectOption("en");
  const returnToRunningSource = async (jobId: string) => {
    const picker = page
      .locator(".precision-source-picker")
      .getByLabel(text(locale, "precision.selectedClip"));
    await picker.selectOption(audioClip.id);
    await expect(page.locator(".precision-player-region audio")).toBeVisible();
    await picker.selectOption(clip.id);
    await expect(page.locator(".precision-player-region video")).toBeVisible();
    await expect(
      page
        .locator(`.precision-job[data-job-id="${jobId}"]`)
        .getByRole("button", {
          name: text(locale, "precision.cancelJob"),
          exact: true,
        }),
    ).toBeEnabled();
    await expect(
      page.locator(`.precision-job[data-job-id="${jobId}"] progress`),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", {
          name: text(locale, "precision.analysis"),
          exact: true,
        })
        .getByRole("button", {
          name: text(locale, "precision.transcribe"),
          exact: true,
        }),
    ).toBeDisabled();
  };
  const started = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/assets/${video.id}/intelligence` &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: text(locale, "precision.transcribe"),
      exact: true,
    })
    .click();
  const cancelledResponse = await started;
  expect(cancelledResponse.status()).toBe(202);
  const cancelledId = (await cancelledResponse.json()).job.id;
  await returnToRunningSource(cancelledId);
  await page
    .locator(".precision-job")
    .getByRole("button", {
      name: text(locale, "precision.cancelJob"),
      exact: true,
    })
    .click();
  await expect
    .poll(async () => {
      const jobs = (await (await request.get(`${base}/jobs`)).json())
        .jobs as Job[];
      return jobs.find((job) => job.id === cancelledId)?.status;
    })
    .toBe("cancelled");
  await expect(
    page.locator(`.precision-job[data-job-id="${cancelledId}"]`),
  ).toContainText(text(locale, "precision.jobStatus.cancelled"));
  expect((await intelligence(request, video.id)).transcript).toBeUndefined();
  await analyze(
    page,
    request,
    locale,
    video.id,
    "transcribe",
    returnToRunningSource,
  );
  let evidence = await intelligence(request, video.id);
  expect(evidence.transcript).toMatchObject({
    assetId: video.id,
    language: "en",
    provenance: {
      model: "fixture-protocol-not-asr",
      sourceHash: video.contentHash,
    },
  });
  expect(evidence.transcriptTotal).toBe(2);
  expect(evidence.transcript!.segments[0]!.text).toBe(
    "Our favorite memory starts here.",
  );
  expect(
    evidence.transcript!.segments.every((segment) => segment.words!.length > 0),
  ).toBe(true);
  await analyze(page, request, locale, video.id, "waveform");
  await expect(page.locator(".precision-wave-path")).not.toHaveAttribute(
    "d",
    "",
  );
  await analyze(page, request, locale, video.id, "scenes");
  evidence = await intelligence(request, video.id);
  expect(evidence.waveform!.peaks.some((peak) => peak > 0.01)).toBe(true);
  expect(evidence.waveform!.provenance.providerId).toBe(
    "openfilm.ffmpeg-waveform",
  );
  for (const cut of [4, 8])
    expect(
      evidence.scenes!.markers.some(
        (marker) => Math.abs(marker.time - cut) < 1 / 24,
      ),
    ).toBe(true);
  expect(await composition(request)).toEqual(beforeAnalysis);

  const trimOut = page.getByRole("spinbutton", {
    name: text(locale, "precision.trimOut"),
    exact: true,
  });
  await trimOut.fill("10");
  await trimOut.press("Tab");
  await saved(page, locale);
  const words = evidence.transcript!.segments.flatMap(
    (segment) => segment.words!,
  );
  const markerTime = words[2]!.start;
  await seekWord(page, locale, 2, markerTime);
  await expect(
    page.locator(
      ".precision-transcript textarea, .precision-transcript [contenteditable=true]",
    ),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: text(locale, "precision.addMarker"),
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        (await intelligence(request, video.id)).markers.filter(
          (entry) => entry.type === "manual",
        ).length,
    )
    .toBe(1);
  const storedMarkers = (await intelligence(request, video.id)).markers;
  const marker = storedMarkers.find((entry) => entry.type === "manual")!;
  expect(storedMarkers.filter((entry) => entry.type === "scene-cut")).toEqual(
    evidence.scenes!.markers,
  );
  expect(marker.time).toBeCloseTo(markerTime, 3);
  await screenChecks(page, locale);

  await page
    .getByRole("button", {
      name: text(locale, "precision.wholeSource"),
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel(text(locale, "precision.snap"), { exact: true }),
  ).toBeChecked();
  const waveform = page.locator(".precision-waveform");
  const bounds = (await waveform.boundingBox())!;
  const handle = (await page
    .getByRole("slider", {
      name: text(locale, "precision.trimIn"),
      exact: true,
    })
    .boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + (markerTime / video.duration!) * bounds.width + 3,
    bounds.y + bounds.height / 2,
    { steps: 5 },
  );
  await expect(page.locator(".precision-snap-result")).toContainText(
    "Snapped to marker",
  );
  await page.mouse.up();
  await saved(page, locale);
  const trimmed = await composition(request);
  expect(clipById(trimmed, clip.id).sourceIn).toBeCloseTo(markerTime, 3);
  expect(clipById(trimmed, clip.id).sourceOut).toBe(10);

  // Keyboard adjustment remains exact with Snap on, even when the handle starts
  // at a marker. It must not snap back and swallow the requested frame.
  await page
    .getByRole("slider", {
      name: text(locale, "precision.trimIn"),
      exact: true,
    })
    .press("ArrowRight");
  await saved(page, locale);
  expect(clipById(await composition(request), clip.id).sourceIn).toBeCloseTo(
    markerTime + 1 / video.frameRate!,
    6,
  );
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await saved(page, locale);
  expect(await composition(request)).toEqual(trimmed);

  const splitTime = evidence.transcript!.segments[1]!.start;
  await seekWord(
    page,
    locale,
    evidence.transcript!.segments[0]!.words!.length,
    splitTime,
  );
  await page
    .getByRole("button", { name: text(locale, "precision.split"), exact: true })
    .click();
  await saved(page, locale);
  const split = await composition(request);
  expect(allClips(split)).toHaveLength(allClips(trimmed).length + 1);
  const halves = allClips(split).filter((entry) => entry.assetId === video.id);
  expect(halves).toHaveLength(2);
  expect(halves[0]!.sourceOut).toBeCloseTo(splitTime, 3);
  expect(halves[1]!.sourceIn).toBeCloseTo(splitTime, 3);
  expect(
    halves.reduce((sum, entry) => sum + entry.timelineDuration, 0),
  ).toBeCloseTo(clipById(trimmed, clip.id).timelineDuration, 6);
  await mode(page, locale, "story");
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await saved(page, locale);
  expect(await composition(request)).toEqual(trimmed);
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await saved(page, locale);
  expect(await composition(request)).toEqual(split);
  await page
    .getByRole("button", {
      name: text(locale, "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await openFilm(page, path, locale);
  await navigate(page, "edit", locale);
  await saved(page, locale);
  expect(await composition(request)).toEqual(split);
  await mode(page, locale, "precision");
  await page
    .locator(".precision-source-picker")
    .getByLabel(text(locale, "precision.selectedClip"))
    .selectOption(clip.id);
  await expect(page.locator(".precision-segment")).toHaveCount(2);
  expect((await intelligence(request, video.id)).markers).toEqual(
    storedMarkers,
  );
  await page
    .getByRole("button", { name: "Render preview", exact: true })
    .click();
  const rendered = page.getByLabel("Film preview", { exact: true });
  await expect(rendered).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() =>
      rendered.evaluate((node) => (node as HTMLVideoElement).duration),
    )
    .toBeCloseTo(split.duration, 1);
  await rendered.evaluate((node) => (node as HTMLVideoElement).play());
  await expect
    .poll(() =>
      rendered.evaluate((node) => (node as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
  await rendered.evaluate((node) => (node as HTMLVideoElement).pause());
  const mp4 = await request.get(`${base}/preview`);
  expect(mp4.ok()).toBe(true);
  const movie = await mp4.body();
  expect(movie.length).toBeGreaterThan(1000);
  await writeFile(
    test.info().outputPath("precision-proposal-preview.mp4"),
    movie,
  );
  expect(await composition(request)).toEqual(split);
  expect(missingKeys).toEqual([]);
  for (const [name, hash] of originalHashes)
    expect(
      createHash("sha256")
        .update(await readFile(join(mediaDirectory, name)))
        .digest("hex"),
    ).toBe(hash);
});

for (const locale of ["zh-TW", "ja-JP"] as const) {
  test(`${locale} precision smoke keeps source analysis and navigation localized at desktop sizes`, async ({
    page,
    request,
  }) => {
    const missingKeys: string[] = [];
    page.on("console", (message) => {
      if (/Missing translation|Not found.*key/.test(message.text()))
        missingKeys.push(message.text());
    });
    const { video } = await createSourceFilm(page, request, locale);
    await analysisPanel(page, locale);
    await page
      .getByLabel(text(locale, "precision.language"))
      .selectOption(locale === "zh-TW" ? "zh" : "ja");
    await analyze(page, request, locale, video.id, "transcribe");
    await analyze(page, request, locale, video.id, "waveform");
    const evidence = await intelligence(request, video.id);
    expect(evidence.transcript!.provenance.model).toBe(
      "fixture-protocol-not-asr",
    );
    expect(evidence.transcript!.language).toBe(
      locale === "zh-TW" ? "zh" : "ja",
    );
    await seekWord(
      page,
      locale,
      1,
      evidence.transcript!.segments[0]!.words![1]!.start,
    );
    await screenChecks(page, locale);
    expect(missingKeys).toEqual([]);
  });
}
