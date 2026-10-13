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
import type { EditorState } from "../../apps/desktop/src/api.js";
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
  mountedComponents: Record<string, number>;
  initialRenderInstrumented: boolean;
  mountHookInstalled: boolean;
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
      uid: number;
      type: { __name?: string; name?: string };
      parent?: Instance;
      appContext: {
        app: { mixin: (options: { beforeMount: () => void }) => void };
      };
      render: (...args: unknown[]) => unknown;
      measured?: boolean;
    };
    const measuredNames = [
      "App",
      "TimelineEditor",
      "TimelineClip",
      "PrecisionEditor",
      "PrecisionTranscript",
      "TranscriptEditor",
    ];
    function wrapRender(instance: Instance, initialMount: boolean) {
      const name = instance.type.__name ?? instance.type.name ?? "anonymous";
      if (!measuredNames.includes(name)) return;
      if (initialMount) {
        const probe = window.__interactionProbe;
        probe.mountedComponents[name] =
          (probe.mountedComponents[name] ?? 0) + 1;
        if (name === "TimelineEditor") probe.initialRenderInstrumented = true;
      }
      if (instance.measured) return;
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
    const found = new Set<Instance>();
    for (const element of Array.from(document.querySelectorAll("*"))) {
      let instance = (element as Element & { __vueParentComponent?: Instance })
        .__vueParentComponent;
      while (instance && !found.has(instance)) {
        found.add(instance);
        instance = instance.parent;
      }
    }
    for (const instance of found) wrapRender(instance, false);
    if (!window.__interactionProbe.mountHookInstalled) {
      const owner = found.values().next().value;
      if (owner) {
        // Registered after Library startup, before the deferred first Edit.
        // Vue calls beforeMount before its first render. The identical hook
        // runs in baseline and candidate; candidate's 500 extra wrappers may
        // themselves add mount overhead and are disclosed in the report.
        owner.appContext.app.mixin({
          beforeMount(this: { $: Instance }) {
            wrapRender(this.$, true);
          },
        });
        window.__interactionProbe.mountHookInstalled = true;
      }
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
      mountedComponents: {},
      initialRenderInstrumented: false,
      mountHookInstalled: false,
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
    const dom = await page.evaluate(() => {
      type Instance = {
        uid: number;
        type: { __name?: string; name?: string };
        parent?: Instance;
      };
      const instances = new Set<Instance>();
      for (const element of Array.from(document.querySelectorAll("*"))) {
        let instance = (
          element as Element & { __vueParentComponent?: Instance }
        ).__vueParentComponent;
        while (instance && !instances.has(instance)) {
          instances.add(instance);
          instance = instance.parent;
        }
      }
      const componentInstances: Record<string, number[]> = {};
      for (const instance of instances) {
        const name = instance.type.__name ?? instance.type.name ?? "anonymous";
        (componentInstances[name] ??= []).push(instance.uid);
      }
      return {
        elements: document.querySelectorAll("*").length,
        libraryCards: document.querySelectorAll(".asset-card").length,
        firstLibraryAsset: document.querySelector(".asset-card .asset-name")
          ?.textContent,
        timelineClips: document.querySelectorAll(".editor-clip").length,
        transcriptRows: document.querySelectorAll(
          '[data-testid="transcript-row"]',
        ).length,
        precisionSegments:
          document.querySelectorAll(".precision-segment").length,
        videos: document.querySelectorAll("video").length,
        ...window.__interactionProbe,
        observers: undefined,
        componentInstances,
        selectedClipIds: Array.from(
          document.querySelectorAll('.editor-clip[aria-pressed="true"]'),
          (clip) => clip.id,
        ),
      };
    });
    const sample = {
      name,
      elapsedMs,
      scriptMs: (after.ScriptDuration! - before.ScriptDuration!) * 1_000,
      layoutMs: (after.LayoutDuration! - before.LayoutDuration!) * 1_000,
      taskMs: (after.TaskDuration! - before.TaskDuration!) * 1_000,
      heapBytes: after.JSHeapUsedSize,
      heapBeforeBytes: before.JSHeapUsedSize,
      heapDeltaBytes: after.JSHeapUsedSize! - before.JSHeapUsedSize!,
      requests: requests.slice(requestStart),
      ...dom,
    };
    samples.push(sample);
    return sample;
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
    const draftKey = `openfilm:editor:${app.project.id}:benchmark-cut`;
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
      await expect(page.locator(".editor-save-state")).toHaveText("Saved");
      await expect(page.locator("#clip-benchmark-0000")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(
        page.locator(".editor-inspector-title h3").first(),
      ).toHaveText("Memory 0000.mp4");
    });
    async function editorContract() {
      const response = await request.get(
        `${api}/compositions/benchmark-cut/editor`,
      );
      expect(response.ok()).toBe(true);
      const state = (await response.json()) as EditorState;
      return {
        composition: state.composition,
        story: state.story,
        revision: state.revision,
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        recoveryDraft: await page.evaluate(
          (key) => localStorage.getItem(key),
          draftKey,
        ),
      };
    }
    const selectionContract = await editorContract();
    for (const [name, alternate] of [
      ["timeline-select-twenty", 1],
      ["timeline-select-cross-beat-twenty", 50],
    ] as const) {
      // Each scenario starts on clip 0. Its first click is deliberately a
      // no-op: twenty attempts must produce nineteen real selection changes.
      await page.locator("#clip-benchmark-0000").click();
      await expect(
        page.locator(".editor-inspector-title h3").first(),
      ).toHaveText("Memory 0000.mp4");
      await settle(page);
      let attemptedClicks = 0;
      let actualSelectionChanges = 0;
      const sample = await measure(name, async () => {
        for (let index = 0; index < 20; index++) {
          const suffix = String(index % 2 === 0 ? 0 : alternate).padStart(
            4,
            "0",
          );
          const clip = page.locator(`#clip-benchmark-${suffix}`);
          const changed = (await clip.getAttribute("aria-pressed")) !== "true";
          await clip.click();
          attemptedClicks++;
          await expect(clip).toHaveClass(/selected/);
          await expect(clip).toHaveAttribute("aria-pressed", "true");
          await expect(
            page.locator('.editor-clip[aria-pressed="true"]'),
          ).toHaveCount(1);
          await expect(
            page.locator(".editor-inspector-title h3").first(),
          ).toHaveText(`Memory ${suffix}.mp4`);
          if (changed) actualSelectionChanges++;
          await settle(page);
        }
      });
      Object.assign(sample, { attemptedClicks, actualSelectionChanges });
      expect(attemptedClicks).toBe(20);
      expect(actualSelectionChanges).toBe(19);
      expect(await editorContract()).toEqual(selectionContract);
      expect(
        sample.requests.some((path) =>
          /\/compositions\/.+\/editor|\/api\/(?:assets|catalog)(?:[/?]|$)/.test(
            path,
          ),
        ),
      ).toBe(false);
      expect(sample.requests.every((path) => path.startsWith("GET "))).toBe(
        true,
      );
      if (process.env.OPENFILM_RAIL_BASELINE !== "1") {
        expect(sample.instrumentedComponents).toContain("TimelineClip");
        const leaves = sample.renders.TimelineClip?.calls ?? 0;
        expect(leaves).toBeGreaterThanOrEqual(actualSelectionChanges * 2);
        expect(leaves).toBeLessThanOrEqual(40);
      }
    }
    await page.locator("#clip-benchmark-0000").click();
    await expect(page.locator(".editor-inspector-title h3").first()).toHaveText(
      "Memory 0000.mp4",
    );
    await settle(page);
    await measure("timeline-three-idle-polls", async () => {
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
    const firstMount = samples.find(
      (sample) => sample.name === "timeline-open",
    )!;
    const firstInstances = firstMount.componentInstances as Record<
      string,
      number[]
    >;
    expect(firstMount.initialRenderInstrumented).toBe(true);
    expect(
      (firstMount.renders as RenderCounts).TimelineEditor?.calls ?? 0,
    ).toBeGreaterThan(0);
    expect(firstInstances.TimelineEditor).toHaveLength(1);
    expect(
      (firstMount.requests as string[]).filter((path) =>
        /\/compositions\/.+\/editor/.test(path),
      ),
    ).toHaveLength(1);
    if (process.env.OPENFILM_RAIL_BASELINE !== "1") {
      expect(firstInstances.TimelineClip).toHaveLength(500);
      expect(
        (firstMount.renders as RenderCounts).TimelineClip?.calls ?? 0,
      ).toBeGreaterThanOrEqual(500);
    }
    for (let cycle = 1; cycle <= 3; cycle++) {
      const sample = await measure(
        `timeline-library-revisit-${cycle}`,
        async () => {
          await navigate(page, "library");
          await expect(page.locator(".workspace-library")).toBeVisible();
          await navigate(page, "edit");
          await expect(page.locator("#clip-benchmark-0000")).toHaveAttribute(
            "aria-pressed",
            "true",
          );
          await expect(page.locator(".editor-save-state")).toHaveText("Saved");
        },
      );
      expect(sample.componentInstances.TimelineEditor).toEqual(
        firstInstances.TimelineEditor,
      );
      expect(sample.componentInstances.TimelineClip ?? []).toEqual(
        firstInstances.TimelineClip ?? [],
      );
      expect(
        sample.requests.filter((path) =>
          /\/compositions\/.+\/editor/.test(path),
        ),
      ).toHaveLength(1);
      expect(await editorContract()).toEqual(selectionContract);
    }
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
    const railIdle = samples.find(
      (sample) => sample.name === "timeline-three-idle-polls",
    )!;
    if (process.env.OPENFILM_RAIL_BASELINE !== "1") {
      expect(railIdle.instrumentedComponents).toContain("TimelineClip");
      expect((railIdle.renders as RenderCounts).TimelineClip?.calls ?? 0).toBe(
        0,
      );
    }
    const idle = samples.find(
      (sample) => sample.name === "precision-three-idle-polls",
    )!;
    expect((idle.renders as RenderCounts).PrecisionEditor?.calls ?? 0).toBe(0);
    if (process.env.OPENFILM_RAIL_BASELINE !== "1")
      expect((idle.renders as RenderCounts).TimelineClip?.calls ?? 0).toBe(0);
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
      railBaselineBudgetExemption: process.env.OPENFILM_RAIL_BASELINE === "1",
      instrumentation:
        "Vue instance render wrappers and app beforeMount mixin, installed after startup Library and before first Edit. Baseline and candidate use the same hooks. Candidate's 500 leaf wrappers may add measured initial-mount overhead. DOM component UID snapshots prove retention; direct clip-label evaluations are measured separately by actual-SFC unit tests. Heap is sampled without forced GC.",
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
