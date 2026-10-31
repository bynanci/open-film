// Actual local service PCM and production WebAudio scheduling; no ASR or hardware QA.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import type {
  RecordAudioPreviewDescriptor,
  TimelineEditorState,
} from "@openfilm/application";
import {
  createExportProfile,
  resolveClipFrameRange,
  resolveProjectTimebase,
  type Composition,
  type MediaAsset,
} from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "@openfilm/render";
import { decodePolicyAudio, toneSource } from "../fixtures/audio-policy.js";

const api = "http://127.0.0.1:4310/api";
let root: string, directory: string, projectId: string, reference: string;
let composition: Composition, assets: MediaAsset[];
const settings = {
  width: 160,
  height: 90,
  frameRate: 30000 / 1001,
  timebase: {
    version: 1 as const,
    rateNumerator: 30000,
    rateDenominator: 1001,
    dropFrame: false,
  },
};

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-audio-policy-browser-"));
  directory = join(root, "film.openfilm");
  assets = [];
  for (const [name, frequency, color] of [
    ["primary", 440, "blue"],
    ["secondary", 880, "red"],
  ] as const) {
    const wav = await toneSource(root, name, frequency, 14);
    const path = join(root, `${name}.mp4`);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=160x90:r=30000/1001:d=14`,
      "-i",
      fileURLToPath(wav.uri),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      path,
    ]);
    assets.push({
      ...(await inspectMedia({ path, uri: pathToFileURL(path).href, name })),
      id: name,
      contentHash: await hashFile(path),
    });
  }
  const app = await OpenFilmApplication.create(
    directory,
    "Independent sound browser parity",
  );
  try {
    projectId = app.project.id;
    app.project.settings = settings;
    for (const asset of assets) app.catalog.upsertAsset(asset);
    app.project.stories = [{ id: "story", title: "Story", beats: [] }];
    composition = {
      id: "cut",
      storyId: "story",
      duration: 12,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "p",
              assetId: "primary",
              timelineStart: 0,
              timelineDuration: 6,
              sourceIn: 2,
              sourceOut: 8,
              audioTiming: {
                version: 1,
                sampleRate: 48000,
                timelineStartSample: 0,
                sourceInSample: 96000,
                sourceOutSample: 408000,
              },
              audioAutomation: { version: 1, role: "dialogue", fadeIn: 0.1 },
            },
            {
              id: "s",
              assetId: "secondary",
              timelineStart: 6,
              timelineDuration: 6,
              sourceIn: 2,
              sourceOut: 8,
              audioTiming: {
                version: 1,
                sampleRate: 48000,
                timelineStartSample: 252001,
                sourceInSample: 60001,
                sourceOutSample: 384000,
              },
            },
          ],
        },
      ],
    };
    app.project.timelines = [composition];
    app.project.schemaVersion = "1.2.0";
    await app.save();
    const path = join(root, "independent-reference.wav");
    await new FFmpegRenderer().render(composition, assets, path, settings, {
      audioOnly: true,
      exportProfile: createExportProfile({
        ratio: "16:9",
        width: 160,
        height: 90,
        frameRate: settings.frameRate,
        format: "wav",
      }),
    });
    const decoded = await decodePolicyAudio(path);
    reference = Buffer.from(decoded.samples.buffer).toString("base64");
  } finally {
    app.close();
  }
});
test.beforeEach(async ({ request, page }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  expect(
    (
      await request.post(`${api}/project/open`, { data: { path: directory } })
    ).ok(),
  ).toBe(true);
  await page.goto("/");
});
test.afterEach(async ({ page, request }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.close();
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  for (const asset of assets)
    expect(await hashFile(fileURLToPath(asset.uri))).toBe(asset.contentHash);
});
test.afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("captures real service PCM through the production OfflineAudioContext scheduler at 1x and an arbitrary seek", async ({
  page,
  request,
}, info) => {
  const editor = (await (
    await request.get(`${api}/compositions/cut/editor`)
  ).json()) as TimelineEditorState;
  const response = await request.post(
    `${api}/compositions/cut/record-audio-preview`,
    { data: { baseRevision: editor.revision } },
  );
  expect(response.ok()).toBe(true);
  const descriptor = (await response.json()) as RecordAudioPreviewDescriptor;
  const measured = await page.evaluate(
    async ({ descriptor, reference }) => {
      const modulePath = "/src/recordAudioPlayback.ts";
      const { createRecordAudioPlayback } = await import(
        /* @vite-ignore */ modulePath
      );
      const raw = Uint8Array.from(atob(reference), (c) => c.charCodeAt(0));
      const expected = new Float32Array(raw.buffer);
      const results = [];
      for (const startSample of [0, 53129]) {
        const context = new OfflineAudioContext(
          2,
          descriptor.lengthSamples - startSample + 48000,
          48000,
        );
        const starts: { when: number; count: number }[] = [];
        const nodeWaiters: { count: number; resolve: () => void }[] = [];
        const createSource = context.createBufferSource.bind(context);
        context.createBufferSource = () => {
          const node = createSource(),
            start = node.start.bind(node);
          node.start = (when = 0, offset = 0, duration?: number) => {
            starts.push({ when, count: node.buffer!.length });
            for (const waiter of nodeWaiters)
              if (starts.length >= waiter.count) waiter.resolve();
            if (duration === undefined) start(when, offset);
            else start(when, offset, duration);
          };
          return node;
        };
        const waitForNodes = (count: number) =>
          starts.length >= count
            ? Promise.resolve()
            : new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(
                  () =>
                    reject(new Error(`Missing scheduled PCM node ${count}`)),
                  10000,
                );
                nodeWaiters.push({
                  count,
                  resolve: () => {
                    clearTimeout(timeout);
                    resolve();
                  },
                });
              });
        const reads: { start: number; count: number }[] = [],
          states: string[] = [];
        const player = createRecordAudioPlayback({
          context: context as unknown as AudioContext,
          readPcm: async (
            id: string,
            start: number,
            count: number,
            signal: AbortSignal,
          ) => {
            reads.push({ start, count });
            const response = await fetch(
              `/api/record-audio-preview/${id}/pcm?startSample=${start}&count=${count}`,
              { signal },
            );
            if (!response.ok) throw new Error(`PCM service ${response.status}`);
            return new Uint8Array(await response.arrayBuffer());
          },
          onTime: () => {},
          onState: (state: string) => states.push(state),
          getHidden: () => false,
        });
        player.load(descriptor);
        const initial = context.suspend(0),
          firstHold = context.suspend(0.125);
        const rendering = context.startRendering();
        await initial;
        const playing = player.play(startSample);
        await firstHold;
        await playing;
        await waitForNodes(1);
        const total = Math.ceil(
          (descriptor.lengthSamples - startSample) / 96000,
        );
        for (let next = 2; next <= total; next++) {
          const previous = starts[next - 2]!;
          const hold = context.suspend(
            previous.when + previous.count / 48000 - 0.125,
          );
          await context.resume();
          await hold;
          await waitForNodes(next);
        }
        await context.resume();
        const actual = await rendering;
        player.dispose();
        const delay = Math.round(starts[0]!.when * 48000);
        let maxError = 0,
          seamError = 0;
        for (let n = 0; n < descriptor.lengthSamples - startSample; n++)
          for (let channel = 0; channel < 2; channel++) {
            const error = Math.abs(
              actual.getChannelData(channel)[n + delay]! -
                expected[(n + startSample) * 2 + channel]!,
            );
            maxError = Math.max(maxError, error);
            if (Math.abs(n % 96000) <= 1 || n % 96000 === 95999)
              seamError = Math.max(seamError, error);
          }
        for (let n = 1; n < starts.length; n++)
          if (
            Math.abs(
              starts[n]!.when -
                starts[n - 1]!.when -
                starts[n - 1]!.count / 48000,
            ) >
            1 / 48000
          )
            throw new Error("PCM scheduling is discontinuous");
        results.push({
          startSample,
          delay,
          maxError,
          seamError,
          nodes: starts.length,
          reads,
          states,
        });
      }
      return results;
    },
    { descriptor, reference },
  );
  for (const result of measured) {
    expect(result.maxError).toBeLessThanOrEqual(2 / 2 ** 23);
    expect(result.seamError).toBeLessThanOrEqual(2 / 2 ** 23);
    expect(result.reads[0]?.start).toBe(result.startSample);
    expect(result.reads.every((r) => r.count <= 96000)).toBe(true);
    expect(result.nodes).toBe(
      Math.ceil((descriptor.lengthSamples - result.startSample) / 96000),
    );
  }
  expect(
    resolveClipFrameRange(
      composition.tracks[0]!.clips[1]!,
      resolveProjectTimebase(settings),
    ).startFrame,
  ).toBe(180);
  await info.attach("actual-offline-pcm-parity.json", {
    body: JSON.stringify({ descriptor, measured }, null, 2),
    contentType: "application/json",
  });
});

test("production Record owns sound across pause, seek, interrupted preparation, Undo and reopen", async ({
  page,
  request,
}, info) => {
  const state = (await (
    await request.get(`${api}/compositions/cut/editor`)
  ).json()) as TimelineEditorState;
  await page.evaluate(
    async ({ projectId, state, settings }) => {
      const vuePath = "/node_modules/.vite/deps/vue.js",
        recordPath = "/src/components/RecordMonitor.vue",
        i18nPath = "/src/i18n/index.ts";
      const vue = await import(/* @vite-ignore */ vuePath),
        record = await import(/* @vite-ignore */ recordPath),
        locale = await import(/* @vite-ignore */ i18nPath);
      const previous = document.getElementById("app") as HTMLElement & {
        __vue_app__?: { unmount(): void };
      };
      previous.__vue_app__?.unmount();
      previous.replaceChildren();
      const props = vue.reactive({
        projectId,
        composition: state.composition,
        assets: state.assets,
        revision: state.revision,
        settings,
        active: true,
      });
      const monitor = vue.ref();
      let legacyAudioPlays = 0;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.tagName === "AUDIO") legacyAudioPlays++;
        return play.call(this);
      };
      const app = vue.createApp({
        render: () => vue.h(record.default, { ...props, ref: monitor }),
      });
      app.use(locale.i18n);
      app.mount(previous);
      const buttons = document.createElement("div");
      for (const [id, action] of [
        ["sound-play", () => monitor.value.play()],
        ["sound-pause", () => monitor.value.pause()],
        ["sound-seek", () => monitor.value.seek(180)],
      ] as const) {
        const button = document.createElement("button");
        button.id = id;
        button.textContent = id;
        button.onclick = action;
        buttons.append(button);
      }
      document.body.append(buttons);
      Object.assign(window, {
        audioPolicyHarness: {
          sync: (value: TimelineEditorState) => {
            props.composition = value.composition;
            props.assets = value.assets;
            props.revision = value.revision;
          },
          frame: () => monitor.value.frame,
          plays: () => legacyAudioPlays,
        },
      });
    },
    { projectId, state, settings },
  );
  const sound = page.locator("[data-record-audio-state]");
  await page.locator("#sound-play").click();
  await expect(sound).toHaveAttribute("data-record-audio-state", "playing");
  await page.locator("#sound-pause").click();
  await expect(sound).toHaveAttribute("data-record-audio-state", "ready");
  await page.locator("#sound-seek").click();
  await expect(page.locator(".record-monitor")).toHaveAttribute(
    "data-frame",
    "180",
  );
  const oldId = await page
    .locator(".record-monitor")
    .getAttribute("data-audio-preview-id");
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    seen = new Promise<void>((resolve) => {
      entered = resolve;
    });
  await page.route(
    "**/api/compositions/cut/record-audio-preview",
    async (route) => {
      entered();
      await held;
      await route.continue().catch(() => {});
    },
  );
  await page.locator("#sound-play").click();
  await seen;
  await expect(sound).toHaveAttribute("data-record-audio-state", "preparing");
  await page.locator("#sound-pause").click();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(sound).toHaveAttribute("data-record-audio-state", "ready");
  const changed = structuredClone(
    state.composition.tracks[0]!.clips[1]!.audioTiming!,
  );
  changed.timelineStartSample += 48;
  changed.sourceInSample += 48;
  const editedResponse = await request.post(`${api}/compositions/cut/edit`, {
    data: {
      baseRevision: state.revision,
      commands: [{ type: "audio.timing", clipId: "s", timing: changed }],
    },
  });
  expect(editedResponse.ok()).toBe(true);
  const edited = (await editedResponse.json()) as TimelineEditorState;
  const undoneResponse = await request.post(`${api}/compositions/cut/undo`, {
    data: { baseRevision: edited.revision },
  });
  expect(undoneResponse.ok()).toBe(true);
  const undone = (await undoneResponse.json()) as TimelineEditorState;
  expect(undone.composition).toEqual(state.composition);
  await page.evaluate((value) => {
    const harness = (
      window as unknown as {
        audioPolicyHarness: { sync(value: TimelineEditorState): void };
      }
    ).audioPolicyHarness;
    harness.sync(value);
  }, undone);
  await expect(sound).toHaveAttribute("data-record-audio-state", "idle");
  const stale = await request.get(
    `${api}/record-audio-preview/${oldId}/pcm?startSample=0&count=1`,
  );
  expect(stale.status()).toBe(409);
  await page.locator("#sound-play").click();
  await expect(sound).toHaveAttribute("data-record-audio-state", "playing");
  await page.locator("#sound-pause").click();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { audioPolicyHarness: { plays(): number } }
      ).audioPolicyHarness.plays(),
    ),
  ).toBe(0);
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  expect(
    (
      await request.post(`${api}/project/open`, { data: { path: directory } })
    ).ok(),
  ).toBe(true);
  const reopened = (await (
    await request.get(`${api}/compositions/cut/editor`)
  ).json()) as TimelineEditorState;
  expect(reopened.composition).toEqual(state.composition);
  await info.attach("record-generation-guards.json", {
    body: JSON.stringify(
      {
        previousId: oldId,
        staleStatus: stale.status(),
        legacyAudioPlays: 0,
        reopenedTiming: reopened.composition.tracks[0]!.clips[1]!.audioTiming,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
