import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type { CaptionCue, Composition, OpenFilmProject } from "@openfilm/core";
import { serializeCaptions } from "@openfilm/exporters";
import { runProcess } from "@openfilm/media";
import axe from "axe-core";
import { closeProject } from "../fixtures/close-browser-project.js";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

// The persisted text is an explicit fixture, edited through the actual transcript
// command service. No speech model, remote provider or NLE is used or certified.
const api = "http://127.0.0.1:4310/api";
const correctedText = "十和田湖 & 家族の思い出";
const sizes = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const locales = ["en-US", "zh-TW", "ja-JP", "en-XA"] as const;
let root: string;
let sources: string[];
let hashes: string[];

test.use({ actionTimeout: 15_000, viewport: sizes[0] });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-captions-browser-"));
  const media = join(root, "Original memories 回憶 & #1");
  await mkdir(media);
  sources = [
    join(media, "Spoken memory.mp4"),
    join(media, "No transcript.mp4"),
  ];
  for (const [index, source] of sources.entries()) {
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      `color=c=${index ? "blue" : "green"}:s=320x180:r=24:d=8`,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=8",
      "-t",
      "8",
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
  }
  hashes = await Promise.all(sources.map(hash));
});
test.beforeEach(async () => closeProject());
test.afterEach(async () => closeProject());
test.afterAll(async () => {
  await closeProject();
  if (root) await rm(root, { recursive: true, force: true });
});

async function hash(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${api}${path}`);
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json() as Promise<T>;
}
async function seed(title: string, many = false) {
  const path = join(root, `${randomUUID()}.openfilm`);
  const app = await OpenFilmApplication.create(
    path,
    title,
    {},
    {
      userDataDirectory: join(root, "fixture-user-data"),
    },
  );
  try {
    await app.importFiles(sources);
    const assets = app.catalog.listAssets();
    const spoken = assets.find((asset) => asset.name === "Spoken memory.mp4")!;
    const absent = assets.find((asset) => asset.name === "No transcript.mp4")!;
    expect(spoken).toBeDefined();
    expect(absent).toBeDefined();
    app.catalog.intelligence.replaceTranscript({
      id: randomUUID(),
      assetId: spoken.id,
      language: "ja",
      provenance: {
        providerId: "explicit-caption-text-fixture-not-ASR",
        version: "1",
        sourceHash: hashes[0]!,
        createdAt: "2026-10-08T00:00:00Z",
      },
      segments: [
        { id: "cut-away", start: 0, end: 0.5, text: "This was cut away." },
        {
          id: "partial",
          start: 0.5,
          end: 1.5,
          text: "Do not invent partial words.",
          alignmentState: "text-edited",
        },
        {
          id: "corrected",
          start: 2,
          end: 4,
          text: "十河田湖 & 家族の思い出",
          words: [
            { start: 2, end: 3, text: "十河田湖" },
            { start: 3, end: 4, text: " & 家族の思い出" },
          ],
        },
        {
          id: "beyond-out",
          start: 6,
          end: 7,
          text: "This is outside both retained ranges.",
        },
      ],
    });
    const provider = await app.transcriptEditor.get(spoken.id);
    const edited = await app.transcriptEditor.edit(spoken.id, {
      baseRevision: provider.revision!,
      requestId: randomUUID(),
      commands: [
        { type: "replace-text", segmentId: "corrected", text: correctedText },
      ],
    });
    const storyId = "caption-story";
    app.project.settings = { width: 320, height: 180, frameRate: 24 };
    app.project.stories.push({
      id: storyId,
      title,
      beats: [{ id: "memories", title: "Our memories" }],
    });
    const composition: Composition = {
      id: "caption-film",
      storyId,
      duration: many ? 243 : 9,
      tracks: [
        {
          id: "dialogue",
          type: "video",
          clips: [
            {
              id: "fast-instance",
              assetId: spoken.id,
              beatId: "memories",
              sourceIn: 1,
              sourceOut: 5,
              timelineStart: 0,
              timelineDuration: 2,
              transform: { speed: 2 },
              locked: true,
            },
            {
              id: "repeated-instance",
              assetId: spoken.id,
              beatId: "memories",
              sourceIn: 1,
              sourceOut: 5,
              timelineStart: 3,
              timelineDuration: 4,
            },
            {
              id: "missing-transcript",
              assetId: absent.id,
              beatId: "memories",
              sourceIn: 0,
              sourceOut: 1,
              timelineStart: 8,
              timelineDuration: 1,
            },
            ...(many
              ? Array.from({ length: 117 }, (_, index) => ({
                  id: `extra-${index}`,
                  assetId: spoken.id,
                  beatId: "memories",
                  sourceIn: 2,
                  sourceOut: 4,
                  timelineStart: 9 + index * 2,
                  timelineDuration: 2,
                }))
              : []),
          ],
        },
      ],
    };
    app.project.timelines.push(composition);
    await app.save();
    return {
      path,
      projectId: app.project.id,
      composition,
      assetId: spoken.id,
      revision: edited.revision!,
      providerRevision: provider.revision!,
      document: edited.document!,
      providerDocument: provider.document!,
    };
  } finally {
    app.close();
  }
}

async function enter(page: Page, path: string) {
  await initialLocale(page);
  await page.goto("/");
  await openFilm(page, path);
  await navigate(page, "export");
  const panel = page.getByTestId("caption-export");
  await expect(panel).toBeVisible();
  if ((await panel.getAttribute("open")) === null)
    await panel.locator("summary").click();
  return panel;
}
async function generate(page: Page) {
  await page.getByTestId("caption-track").selectOption("dialogue");
  await page.getByTestId("caption-generate").click();
  await expect(page.getByTestId("caption-cue").first()).toBeVisible();
}

async function nativeVtt(page: Page, text: string) {
  // Chromium's independent WebVTT parser, rather than a companion implementation
  // of OpenFilm's serializer. Inspect decoded cue text and actual parser timing.
  return page.evaluate(async (content) => {
    const video = document.createElement("video");
    const track = document.createElement("track");
    const url = URL.createObjectURL(new Blob([content], { type: "text/vtt" }));
    try {
      document.body.append(video);
      const loaded = new Promise<void>((resolve, reject) => {
        track.addEventListener("load", () => resolve(), { once: true });
        track.addEventListener(
          "error",
          () => reject(new Error("Native WebVTT parser rejected export")),
          { once: true },
        );
      });
      track.kind = "subtitles";
      track.src = url;
      video.append(track);
      track.track.mode = "hidden";
      await loaded;
      return Array.from(track.track.cues ?? []).map((cue) => ({
        start: cue.startTime,
        end: cue.endTime,
        text: (cue as VTTCue).getCueAsHTML().textContent,
      }));
    } finally {
      video.remove();
      URL.revokeObjectURL(url);
    }
  }, text);
}

test("Chromium decodes literal Unicode, blank lines and timestamp-looking text without creating false cues", async ({
  page,
}) => {
  const documentRequests: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() && /^https?:/u.test(request.url()))
      documentRequests.push(request.url());
  });
  // This format-only check needs Chromium, not the app's startup lifecycle.
  // Keep asynchronous TextTrack parsing outside documents a dev server can
  // navigate. The real download workflow below still parses in the actual UI.
  await page.goto("about:blank");
  expect(documentRequests).toEqual([]);
  const literal =
    "十和田湖 & memories <literal>\r\n次の行\n\n00:00:05.000 --> 00:00:06.000\n🎬";
  const cue: CaptionCue = {
    id: "literal",
    startMs: 1,
    endMs: 999,
    text: literal,
    clipId: "literal-clip",
    assetId: "literal-asset",
    transcriptId: "literal-document",
    transcriptRevisionId: "literal-revision",
    segmentId: "literal-segment",
    sourceIn: 0.001,
    sourceOut: 0.999,
  };
  const exported = serializeCaptions("vtt", [cue]);
  expect(await nativeVtt(page, exported.content)).toEqual([
    {
      start: 0.001,
      end: 0.999,
      text: literal.replace(/\r\n/gu, "\n").replace(/\n\n/gu, "\n\u00a0\n"),
    },
  ]);
  expect(page.url()).toBe("about:blank");
  expect(documentRequests).toEqual([]);
});

test("corrected transcript exports mapped captions with warnings, independent parsers and immutable source evidence", async ({
  page,
  request,
}, info) => {
  const fixture = await seed("Our corrected memories");
  await enter(page, fixture.path);
  const originalProject = (
    await get<{ project: OpenFilmProject }>(request, "/project")
  ).project;
  const baseline = await get(request, `/assets/${fixture.assetId}/transcript`);
  const providerPath = `/assets/${fixture.assetId}/transcript?revisionId=${encodeURIComponent(fixture.providerRevision)}`;
  const providerEvidence = await get(request, providerPath);
  await expect(page.getByTestId("caption-generate")).toBeDisabled();
  await generate(page);
  await expect(page.getByTestId("caption-cue")).toHaveCount(2);
  await expect(page.getByTestId("caption-cues")).toContainText(correctedText);
  await expect(page.getByTestId("caption-issues")).toBeVisible();
  for (const issue of [
    "PARTIAL_SEGMENT",
    "ALIGNMENT_STALE",
    "TRANSCRIPT_MISSING",
  ]) {
    await expect(page.getByTestId("caption-issues")).toContainText(
      uiText("en-US", `captions.issues.${issue}`),
    );
  }
  await expect(page.getByTestId("caption-export")).toContainText(
    fixture.revision,
  );
  const expected = [
    { start: 0.5, end: 1.5, text: correctedText },
    { start: 4, end: 6, text: correctedText },
  ];
  for (const format of ["srt", "vtt"] as const) {
    await page.getByTestId(`caption-export-${format}`).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("caption-download").click();
    const download = await downloadPromise;
    const path = info.outputPath(`mapped.${format}`);
    await download.saveAs(path);
    const content = await readFile(path, "utf8");
    expect(content).not.toContain("This was cut away");
    expect(content).not.toContain("Do not invent partial words");
    if (format === "vtt")
      expect(await nativeVtt(page, content)).toEqual(expected);
    else {
      const output = await runProcess("ffprobe", [
        "-v",
        "error",
        "-show_packets",
        "-select_streams",
        "s:0",
        "-show_entries",
        "packet=pts_time,duration_time",
        "-of",
        "json",
        path,
      ]);
      const parsed = JSON.parse(output.stdout.toString("utf8")) as {
        packets: { pts_time: string; duration_time: string }[];
      };
      expect(
        parsed.packets.map((packet) => ({
          start: Number(packet.pts_time),
          end: Number(packet.pts_time) + Number(packet.duration_time),
        })),
      ).toEqual(expected.map(({ start, end }) => ({ start, end })));
      const decoded = await runProcess("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-f",
        "ass",
        "-",
      ]);
      expect(
        decoded.stdout
          .toString("utf8")
          // FFmpeg versions differ in ASS record delimiters, not cue content.
          .split(/\r?\n/u)
          .filter((line) => line.startsWith("Dialogue: "))
          .map((line) => line.split(",").slice(9).join(",")),
      ).toEqual(expected.map((item) => item.text));
    }
    const recordPromise = page.waitForEvent("download");
    await page.getByTestId("caption-manifest").click();
    const record = await recordPromise;
    const recordPath = info.outputPath(`mapped-${format}-source.json`);
    await record.saveAs(recordPath);
    const manifest = await readFile(recordPath, "utf8");
    expect(manifest).toContain(fixture.projectId);
    expect(manifest).toContain(fixture.composition.id);
    expect(manifest).toContain(fixture.revision);
    expect(manifest).toContain("fast-instance");
    expect(manifest).toContain("repeated-instance");
  }
  expect(await get(request, `/assets/${fixture.assetId}/transcript`)).toEqual(
    baseline,
  );
  expect(await get(request, providerPath)).toEqual(providerEvidence);
  expect(
    (await get<{ project: OpenFilmProject }>(request, "/project")).project,
  ).toEqual(originalProject);
  expect(await Promise.all(sources.map(hash))).toEqual(hashes);
});

test("completed caption and manifest downloads survive pagination and status checks", async ({
  page,
}, info) => {
  const fixture = await seed("Published captions remain downloadable", true);
  const panel = await enter(page, fixture.path);
  let publications = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/captions/export")
      publications++;
  });
  await generate(page);
  await page.getByTestId("caption-export-vtt").click();
  const captions = page.getByTestId("caption-download");
  const manifest = page.getByTestId("caption-manifest");
  await expect(captions).toBeVisible();
  await expect(manifest).toBeVisible();
  const captionUrl = await captions.getAttribute("href");
  const manifestUrl = await manifest.getAttribute("href");
  expect(captionUrl).toBeTruthy();
  expect(manifestUrl).toBeTruthy();
  const cuePages = panel.locator("nav.caption-pages").first();
  await cuePages.locator("button").last().click();
  await expect(page.getByTestId("caption-cue")).toHaveCount(19);
  await expect(captions).toHaveAttribute("href", captionUrl!);
  await expect(manifest).toHaveAttribute("href", manifestUrl!);
  await cuePages.locator("button").first().click();
  await expect(page.getByTestId("caption-cue")).toHaveCount(100);
  const issuePages = panel.locator("nav.caption-pages").last();
  await issuePages.locator("button").last().click();
  await expect(issuePages.locator("button").first()).toBeEnabled();
  await expect(captions).toHaveAttribute("href", captionUrl!);
  await expect(manifest).toHaveAttribute("href", manifestUrl!);
  const checked = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/captions/snapshot",
  );
  await panel
    .getByRole("button", {
      name: uiText("en-US", "captions.checkStatus"),
      exact: true,
    })
    .click();
  expect((await checked).ok()).toBe(true);
  await expect(page.getByTestId("caption-status")).toHaveAttribute(
    "data-status",
    "attention",
  );
  await expect(captions).toHaveAttribute("href", captionUrl!);
  await expect(manifest).toHaveAttribute("href", manifestUrl!);
  expect(publications).toBe(1);
  const captionDownload = page.waitForEvent("download");
  await captions.click();
  const captionPath = info.outputPath("retained.vtt");
  await (await captionDownload).saveAs(captionPath);
  const parsed = await nativeVtt(page, await readFile(captionPath, "utf8"));
  expect(parsed).toHaveLength(119);
  expect(parsed[0]).toEqual({ start: 0.5, end: 1.5, text: correctedText });
  const manifestDownload = page.waitForEvent("download");
  await manifest.click();
  const manifestPath = info.outputPath("retained-manifest.json");
  await (await manifestDownload).saveAs(manifestPath);
  const record = JSON.parse(await readFile(manifestPath, "utf8"));
  expect(record.publication.projectId).toBe(fixture.projectId);
  expect(record.snapshot.cues).toHaveLength(119);
  expect(publications).toBe(1);
});

test("a delayed caption snapshot never appears in a different film", async ({
  page,
  request,
}) => {
  const first = await seed("First film owns this caption request");
  const second = await seed("Second film owns a different snapshot");
  await enter(page, first.path);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  let finished = false;
  await page.route("**/api/captions/prepare", async (route) => {
    const response = await route.fetch();
    held = true;
    await gate;
    // The browser may abort the old request when its owning project unmounts.
    try {
      await route.fulfill({ response });
    } catch {
      /* Aborted is safe. */
    }
    finished = true;
  });
  try {
    await page.getByTestId("caption-track").selectOption("dialogue");
    await page.getByTestId("caption-generate").click();
    await expect.poll(() => held).toBe(true);
    await page
      .getByRole("button", {
        name: uiText("en-US", "app.navigation.switchProject"),
        exact: true,
      })
      .click();
    await openFilm(page, second.path);
    await navigate(page, "export");
    const panel = page.getByTestId("caption-export");
    if ((await panel.getAttribute("open")) === null)
      await panel.locator("summary").click();
    release();
    await expect.poll(() => finished).toBe(true);
    await expect(page.getByTestId("caption-cue")).toHaveCount(0);
    await expect(page.getByTestId("caption-download")).toHaveCount(0);
    await expect(panel).not.toContainText(first.revision);
    expect(
      (await get<{ project: OpenFilmProject }>(request, "/project")).project.id,
    ).toBe(second.projectId);
  } finally {
    release();
    await page.unroute("**/api/captions/prepare");
  }
  await generate(page);
  await expect(page.getByTestId("caption-export")).toContainText(
    second.revision,
  );
  await expect(page.getByTestId("caption-export")).not.toContainText(
    first.revision,
  );
});

test("a changed transcript makes the old preview stale before export and can be regenerated", async ({
  page,
  request,
}) => {
  const fixture = await seed("Changed transcript needs a new snapshot");
  await enter(page, fixture.path);
  await generate(page);
  const changedText = "校正之後的新字幕 — 新しい修正";
  const changed = await request.post(
    `${api}/assets/${fixture.assetId}/transcript/edit`,
    {
      data: {
        baseRevision: fixture.revision,
        requestId: randomUUID(),
        commands: [
          { type: "replace-text", segmentId: "corrected", text: changedText },
        ],
      },
    },
  );
  expect(changed.ok(), await changed.text()).toBe(true);
  const updated = (await changed.json()) as { revision: string };
  await page.getByTestId("caption-export-srt").click();
  await expect(page.getByTestId("caption-status")).toHaveAttribute(
    "data-status",
    "stale",
  );
  await expect(page.getByTestId("caption-export-srt")).toBeDisabled();
  await expect(page.getByTestId("caption-download")).toHaveCount(0);
  await page.getByTestId("caption-generate").click();
  await expect(page.getByTestId("caption-cues")).toContainText(changedText);
  await expect(page.getByTestId("caption-export")).toContainText(
    updated.revision,
  );
  await expect(page.getByTestId("caption-export-srt")).toBeEnabled();
  expect(
    (await get<{ project: OpenFilmProject }>(request, "/project")).project
      .timelines[0],
  ).toEqual(fixture.composition);
});

for (const locale of locales) {
  test(`${locale} caption preview is bounded, keyboard accessible and legible at three desktop sizes`, async ({
    page,
    request,
  }, info) => {
    const fixture = await seed(`Caption layout ${locale}`, true);
    const opened = await request.post(`${api}/project/open`, {
      data: { path: fixture.path },
    });
    expect(opened.ok(), await opened.text()).toBe(true);
    await page.addInitScript(
      (value) => localStorage.setItem("openfilm.uiLocale", value),
      locale,
    );
    const missing: string[] = [];
    page.on("console", (message) => {
      if (/Missing translation|Not found.*key/u.test(message.text()))
        missing.push(message.text());
    });
    await page.goto("/");
    await page.locator(".main-nav button").nth(3).click();
    const panel = page.getByTestId("caption-export");
    await expect(panel).toBeVisible();
    const summary = panel.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(panel).toHaveAttribute("open", "");
    const track = page.getByTestId("caption-track");
    await track.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(track).toHaveValue("dialogue");
    const generateButton = page.getByTestId("caption-generate");
    await generateButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("caption-cue").first()).toBeVisible();
    expect(await page.getByTestId("caption-cue").count()).toBeLessThanOrEqual(
      100,
    );
    for (const size of sizes) {
      await page.setViewportSize(size);
      const problems = await panel.evaluate((element) => {
        const issues: string[] = [];
        if (document.documentElement.scrollWidth > innerWidth + 2)
          issues.push("Page exceeds viewport width");
        for (const node of Array.from(
          element.querySelectorAll<HTMLElement>(
            "button, summary, select, h3, a",
          ),
        )) {
          if (!node.getClientRects().length) continue;
          const box = node.getBoundingClientRect();
          if (box.width < 2 || box.height < 2) continue;
          if (box.left < -2 || box.right > innerWidth + 2)
            issues.push(`Outside viewport: ${node.textContent?.trim()}`);
          if (node.scrollWidth > node.clientWidth + 3)
            issues.push(`Clipped control: ${node.textContent?.trim()}`);
        }
        return issues;
      });
      expect(problems, `${locale} ${size.width}x${size.height}`).toEqual([]);
      expect(await panel.innerText()).not.toMatch(
        /\b(?:captions|editor|app)\.[\w.]+\b|\bundefined\b/u,
      );
      const path = info.outputPath(
        `captions-${locale}-${size.width}x${size.height}.png`,
      );
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      await info.attach(`captions-${locale}-${size.width}`, {
        path,
        contentType: "image/png",
      });
    }
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: typeof axe }).axe.run(
        '[data-testid="caption-export"]',
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
        nodes: rule.nodes.map((node) => node.failureSummary),
      }));
    });
    expect(violations).toEqual([]);
    const cues = page.getByTestId("caption-cues");
    await cues.focus();
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(() => cues.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    const cuePages = panel.locator("nav.caption-pages").first();
    await cuePages.locator("button").last().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("caption-cue")).toHaveCount(19);
    await expect(cuePages.locator("button").last()).toBeDisabled();
    await expect(cuePages.locator("button").first()).toBeEnabled();
    expect(missing).toEqual([]);
    expect(await Promise.all(sources.map(hash))).toEqual(hashes);
  });
}
