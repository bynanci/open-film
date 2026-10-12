import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type { Clip, MediaAsset } from "@openfilm/core";
import {
  createThumbnail,
  sceneCacheIdentity,
  WAVEFORM_CACHE_IDENTITY,
} from "@openfilm/media";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";

// Synthetic UI work only: catalog rows share a tiny generated local video. The
// intentionally dense transcript is not speech recognition or large-source QA.
const api = "http://127.0.0.1:4310/api";
const counts = {
  assets: 2_000,
  clips: 500,
  segments: 10_000,
  wordsPerSegment: 10,
};
type RenderCounts = Record<string, { calls: number; milliseconds: number }>;
interface Probe {
  renders: RenderCounts;
  instrumentedComponents: string[];
  longTasks: number[];
  mutations: Record<string, number>;
  observers: MutationObserver[];
}
declare global {
  interface Window {
    __interactionProbe: Probe;
  }
}

async function installRenderProbe(page: Page) {
  await page.evaluate(() => {
    // Test-only Vue dev runtime instrumentation, never shipped to production.
    // Wrap only render functions; ownership, watchers and scheduler stay intact.
    type Instance = {
      type: { __name?: string; name?: string };
      parent?: Instance;
      render: (...args: unknown[]) => unknown;
      measured?: boolean;
    };
    const found = new Set<Instance>();
    for (const element of Array.from(document.querySelectorAll("*"))) {
      let instance = (element as Element & { __vueParentComponent?: Instance })
        .__vueParentComponent;
      while (instance && !found.has(instance)) {
        found.add(instance);
        instance = instance.parent;
      }
    }
    for (const instance of found) {
      const name = instance.type.__name ?? instance.type.name ?? "anonymous";
      if (
        instance.measured ||
        ![
          "App",
          "TimelineEditor",
          "PrecisionEditor",
          "PrecisionTranscript",
          "TranscriptEditor",
        ].includes(name)
      )
        continue;
      instance.measured = true;
      if (!window.__interactionProbe.instrumentedComponents.includes(name))
        window.__interactionProbe.instrumentedComponents.push(name);
      const render = instance.render;
      instance.render = function (...args) {
        const start = performance.now();
        try {
          return render.apply(this, args);
        } finally {
          const entry = (window.__interactionProbe.renders[name] ??= {
            calls: 0,
            milliseconds: 0,
          });
          entry.calls++;
          entry.milliseconds += performance.now() - start;
        }
      };
    }
    for (const selector of [
      ".editor-story-rail",
      ".precision-transcript",
      ".transcript-segments",
    ]) {
      const element = document.querySelector(selector);
      if (!element || element.hasAttribute("data-performance-observed"))
        continue;
      element.setAttribute("data-performance-observed", "true");
      const observer = new MutationObserver((entries) => {
        window.__interactionProbe.mutations[selector] =
          (window.__interactionProbe.mutations[selector] ?? 0) + entries.length;
      });
      observer.observe(element, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      window.__interactionProbe.observers.push(observer);
    }
  });
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test("measures bounded synthetic Library, Story, Timeline, Precision and Transcript interactions", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  await initialLocale(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    window.__interactionProbe = {
      renders: {},
      instrumentedComponents: [],
      longTasks: [],
      mutations: {},
      observers: [],
    };
    new PerformanceObserver((list) =>
      window.__interactionProbe.longTasks.push(
        ...list.getEntries().map((entry) => entry.duration),
      ),
    ).observe({ type: "longtask", buffered: true });
  });
  const root = await mkdtemp(join(tmpdir(), "openfilm-interaction-"));
  function productionFiles() {
    return [
      ...new Set(
        execFileSync(
          "git",
          [
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            "apps/desktop/src",
          ],
          { encoding: "utf8" },
        )
          .trim()
          .split("\n"),
      ),
    ].sort();
  }
  async function fingerprint() {
    const digest = createHash("sha256");
    for (const file of productionFiles())
      digest.update(file).update(await readFile(file));
    return digest.digest("hex");
  }
  const sourceBefore = await fingerprint();
  const samples: Record<string, unknown>[] = [];
  const requests: string[] = [];
  page.on("request", (entry) => {
    const url = new URL(entry.url());
    if (url.pathname.startsWith("/api/"))
      requests.push(`${entry.method()} ${url.pathname}${url.search}`);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  async function snapshot() {
    const values = (await cdp.send("Performance.getMetrics")).metrics;
    return Object.fromEntries(values.map((entry) => [entry.name, entry.value]));
  }
  async function measure(name: string, action: () => Promise<void>) {
    if (name !== "startup-library") await installRenderProbe(page);
    const before = await snapshot();
    const requestStart = requests.length;
    if (name !== "startup-library")
      await page.evaluate(() => {
        window.__interactionProbe.renders = {};
        window.__interactionProbe.longTasks = [];
        window.__interactionProbe.mutations = {};
      });
    const start = performance.now();
    await action();
    await settle(page);
    const elapsedMs = performance.now() - start;
    const after = await snapshot();
    const dom = await page.evaluate(() => ({
      elements: document.querySelectorAll("*").length,
      libraryCards: document.querySelectorAll(".asset-card").length,
      firstLibraryAsset: document.querySelector(".asset-card .asset-name")
        ?.textContent,
      timelineClips: document.querySelectorAll(".editor-clip").length,
      transcriptRows: document.querySelectorAll(
        '[data-testid="transcript-row"]',
      ).length,
      precisionSegments: document.querySelectorAll(".precision-segment").length,
      videos: document.querySelectorAll("video").length,
      ...window.__interactionProbe,
      observers: undefined,
    }));
    samples.push({
      name,
      elapsedMs,
      scriptMs: (after.ScriptDuration! - before.ScriptDuration!) * 1_000,
      layoutMs: (after.LayoutDuration! - before.LayoutDuration!) * 1_000,
      taskMs: (after.TaskDuration! - before.TaskDuration!) * 1_000,
      heapBytes: after.JSHeapUsedSize,
      requests: requests.slice(requestStart),
      ...dom,
    });
  }
  try {
    await generateSampleMedia(join(root, "generated"));
    const source = join(root, "generated", "04-motion.mp4");
    const hash = createHash("sha256")
      .update(await readFile(source))
      .digest("hex");
    const project = join(root, "interaction.openfilm");
    const app = await OpenFilmApplication.create(
      project,
      "Synthetic interaction benchmark",
    );
    const thumbnail = "cache/thumbnails/benchmark.jpg";
    await mkdir(join(project, "cache", "thumbnails"), { recursive: true });
    const descriptor: MediaAsset = {
      id: "asset-0000",
      uri: pathToFileURL(source).href,
      name: "Memory 0000.mp4",
      mediaType: "video",
      duration: 3,
      dimensions: { width: 320, height: 180 },
      frameRate: 24,
      tags: [],
      state: {},
      metadata: {},
      contentHash: hash,
      thumbnailUri: thumbnail,
    };
    await createThumbnail(descriptor, join(project, thumbnail));
    const clips: Clip[] = [];
    await mkdir(join(root, "media"));
    for (let index = 0; index < counts.assets; index++) {
      const suffix = String(index).padStart(4, "0");
      const location = join(root, "media", `${suffix}.mp4`);
      await link(source, location);
      app.catalog.upsertAsset({
        ...descriptor,
        uri: pathToFileURL(location).href,
        id: `asset-${suffix}`,
        name: `Memory ${suffix}.mp4`,
      });
      if (index < counts.clips)
        clips.push({
          id: `benchmark-${suffix}`,
          assetId: `asset-${suffix}`,
          beatId: `beat-${Math.floor(index / 50)}`,
          sourceIn: 0,
          sourceOut: 3,
          timelineStart: index * 3,
          timelineDuration: 3,
        });
    }
    app.project.mediaLibraries.push({
      id: "benchmark-library",
      name: "Generated media",
      uri: pathToFileURL(join(root, "generated")).href,
    });
    app.project.stories.push({
      id: "benchmark-story",
      title: "Five hundred memories",
      targetDuration: 1500,
      maxDuration: 1800,
      beats: Array.from({ length: 10 }, (_, index) => ({
        id: `beat-${index}`,
        title: `Chapter ${index + 1}`,
        targetDuration: 150,
        candidateAssetIds: clips
          .filter((clip) => clip.beatId === `beat-${index}`)
          .map((clip) => clip.assetId),
      })),
    });
    app.project.timelines.push({
      id: "benchmark-cut",
      storyId: "benchmark-story",
      duration: 1500,
      tracks: [{ id: "video", type: "video", clips }],
    });
    const provenance = {
      providerId: "synthetic-ui-benchmark",
      version: "1",
      sourceHash: hash,
      createdAt: new Date(0).toISOString(),
    };
    app.catalog.intelligence.replaceTranscript({
      id: "benchmark-transcript",
      assetId: descriptor.id,
      language: "en",
      provenance,
      segments: Array.from({ length: counts.segments }, (_, index) => {
        const start = (index * 3) / counts.segments;
        const end = ((index + 1) * 3) / counts.segments;
        const words = Array.from(
          { length: counts.wordsPerSegment },
          (_, word) => ({
            start: start + ((end - start) * word) / counts.wordsPerSegment,
            end: start + ((end - start) * (word + 1)) / counts.wordsPerSegment,
            text: `word${word}`,
          }),
        );
        return {
          id: `segment-${index}`,
          start,
          end,
          text: `Memory ${index} ${words.map((word) => word.text).join(" ")}`,
          words,
        };
      }),
    });
    app.catalog.intelligence.saveWaveform({
      assetId: descriptor.id,
      duration: 3,
      sampleRate: 1000,
      peaks: Array.from(
        { length: 3000 },
        (_, index) => Math.abs(Math.sin(index / 9)) * 0.8,
      ),
      provenance: { ...provenance, ...WAVEFORM_CACHE_IDENTITY },
    });
    app.catalog.intelligence.saveScenes({
      assetId: descriptor.id,
      markers: Array.from({ length: 200 }, (_, index) => ({
        id: `scene-${index}`,
        assetId: descriptor.id,
        time: ((index + 1) * 3) / 201,
        type: "scene-cut",
        confidence: 0.8,
      })),
      provenance: { ...provenance, ...sceneCacheIdentity() },
    });
    app.close();
    expect(
      (
        await request.post(`${api}/project/open`, { data: { path: project } })
      ).ok(),
    ).toBe(true);
    await measure("startup-library", async () => {
      await page.goto("/");
      await expect(page.locator(".asset-card")).toHaveCount(60);
      await expect(page.locator(".asset-card .asset-name").first()).toHaveText(
        "Memory 0000.mp4",
      );
      await expect(
        page
          .getByRole("navigation", {
            name: uiText("en-US", "app.navigation.label"),
            exact: true,
          })
          .getByRole("button", { name: "Edit", exact: true }),
      ).toBeEnabled();
    });
    await measure("library-next-page", async () => {
      await page
        .locator(".pagination")
        .getByRole("button", { name: "Next", exact: true })
        .click();
      await expect(page.locator(".asset-card")).toHaveCount(60);
      // Both pages contain 60 cards. Wait for the requested page's identity,
      // otherwise a slow catalog read could finish after this measurement.
      await expect(page.locator(".asset-card .asset-name").first()).toHaveText(
        "Memory 0060.mp4",
      );
      await expect(page.locator(".asset-card .asset-name").last()).toHaveText(
        "Memory 0119.mp4",
      );
    });
    await measure("story-open", async () => {
      await navigate(page, "story");
      await expect(page.locator(".beat-list button")).toHaveCount(10);
    });
    await measure("story-select-ten", async () => {
      for (let index = 0; index < 10; index++) {
        await page.locator(".beat-list button").nth(index).click();
        await settle(page);
      }
    });
    await measure("timeline-open", async () => {
      await navigate(page, "edit");
      await expect(page.locator(".editor-clip")).toHaveCount(500);
    });
    await measure("timeline-select-twenty", async () => {
      for (let index = 0; index < 20; index++) {
        await page
          .locator(`#clip-benchmark-${String(index % 2).padStart(4, "0")}`)
          .click();
        await settle(page);
      }
    });
    await page.locator("#clip-benchmark-0000").click();
    await measure("precision-open", async () => {
      await page
        .getByRole("button", { name: "Precision", exact: true })
        .click();
      await expect(page.locator(".precision-segment")).toHaveCount(100);
      await expect(
        page.locator(".precision-waveform svg path").first(),
      ).toBeAttached();
    });
    await measure("precision-hover-sixty-frames", async () => {
      const waveform = page.locator(".precision-waveform");
      await waveform.scrollIntoViewIfNeeded();
      const box = (await waveform.boundingBox())!;
      for (let index = 0; index < 60; index++) {
        await page.mouse.move(
          box.x + box.width * (0.1 + index / 100),
          box.y + box.height / 2,
        );
        await settle(page);
      }
      await expect(page.locator(".precision-hover-time")).toBeVisible();
    });
    await measure("precision-three-idle-polls", async () => {
      const initial = requests.filter(
        (entry) => entry === "GET /api/jobs",
      ).length;
      await expect
        .poll(
          () =>
            requests.filter((entry) => entry === "GET /api/jobs").length -
            initial,
          { timeout: 10_000, intervals: [100] },
        )
        .toBeGreaterThanOrEqual(3);
    });
    await measure("transcript-open", async () => {
      await page
        .locator(".editor-mode-switch")
        .getByRole("button", { name: "Transcript", exact: true })
        .click();
      await expect(page.getByTestId("transcript-row")).toHaveCount(100);
    });
    await measure("transcript-search", async () => {
      await page
        .getByTestId("transcript-workspace")
        .getByRole("searchbox")
        .fill("Memory 9999");
      await expect(page.getByTestId("transcript-search-status")).toContainText(
        "1 match",
      );
    });
    expect(
      await page.getByTestId("transcript-row").count(),
    ).toBeLessThanOrEqual(100);
    expect(await page.locator("video").count()).toBeLessThanOrEqual(2);
    expect(
      requests.filter((entry) => entry.includes("/transcript/search?")).length,
    ).toBeLessThanOrEqual(2);
    // Work budgets, independent of machine speed. Keep these after measurements
    // so comparative samples use the same actions as the retained baseline.
    const startup = samples.find(
      (sample) => sample.name === "startup-library",
    )!;
    expect(startup.libraryCards).toBe(60);
    expect(startup.timelineClips).toBe(0);
    expect(
      (startup.requests as string[]).some((path) =>
        /\/compositions\/.+\/editor/.test(path),
      ),
    ).toBe(false);
    const hover = samples.find(
      (sample) => sample.name === "precision-hover-sixty-frames",
    )!;
    expect(hover.instrumentedComponents).toContain("PrecisionTranscript");
    // Prove pointer events reached the active waveform before accepting the
    // zero-child-render budget; an inert surface must not count as a speedup.
    expect(
      (hover.renders as RenderCounts).PrecisionEditor?.calls ?? 0,
    ).toBeGreaterThan(0);
    expect(
      (hover.renders as RenderCounts).PrecisionTranscript?.calls ?? 0,
    ).toBe(0);
    expect(
      (hover.requests as string[]).every((path) => path === "GET /api/jobs"),
    ).toBe(true);
    const idle = samples.find(
      (sample) => sample.name === "precision-three-idle-polls",
    )!;
    expect((idle.renders as RenderCounts).PrecisionEditor?.calls ?? 0).toBe(0);
    expect((idle.renders as RenderCounts).PrecisionTranscript?.calls ?? 0).toBe(
      0,
    );
  } finally {
    const artifact = {
      label: process.env.OPENFILM_BENCHMARK_LABEL ?? "synthetic-ui",
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      fixture: counts,
      repeatIndex: testInfo.repeatEachIndex,
      productionSourceFiles: productionFiles(),
      productionSourceBefore: sourceBefore,
      productionSourceAfter: await fingerprint(),
      measurement:
        "Fresh browser per repetition; Vite dev server shared within --repeat-each. Warm-up run separate. Vue render elapsed is inclusive test instrumentation; CDP has separate accounting. No ASR, realistic speech density, 4K decode or workstation performance claim.",
      browser: await page.context().browser()?.version(),
      viewport: page.viewportSize(),
      samples,
    };
    const output = testInfo.outputPath("interaction-performance.json");
    await writeFile(output, JSON.stringify(artifact, null, 2));
    await testInfo.attach("interaction-performance", {
      path: output,
      contentType: "application/json",
    });
    if (process.env.OPENFILM_BENCHMARK_OUTPUT) {
      await mkdir(process.env.OPENFILM_BENCHMARK_OUTPUT, { recursive: true });
      await writeFile(
        join(
          process.env.OPENFILM_BENCHMARK_OUTPUT,
          `interaction-performance-${testInfo.repeatEachIndex}.json`,
        ),
        JSON.stringify(artifact, null, 2),
      );
    }
    await request.post(`${api}/project/close`, { data: {} });
    await rm(root, { recursive: true, force: true });
  }
});
