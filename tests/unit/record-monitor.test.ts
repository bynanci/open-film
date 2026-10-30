import * as playbackModule from "../../apps/desktop/src/recordAudioPlayback";
import type { RecordAudioPreviewDescriptor } from "@openfilm/application";
import { sourceColorStyle } from "../../apps/desktop/src/source-color";
import { existsSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import {
  useRecordTransport,
  type RecordTransport,
} from "../../apps/desktop/src/composables/useRecordTransport";
import type { SourceStatus } from "../../apps/desktop/src/api";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host";

const path = "apps/desktop/src/components/RecordMonitor.vue";
type MonitorHandle = Omit<
  RecordTransport,
  "frame" | "playing" | "shuttleRate" | "buffering"
> & {
  frame: number;
  playing: boolean;
  shuttleRate: number;
  buffering: boolean;
  split(): void;
};
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const settings: core.ProjectSettings = {
  width: 320,
  height: 180,
  frameRate: 10,
};
const asset = (
  id: string,
  mediaType: core.MediaType = "video",
): core.MediaAsset => ({
  id,
  name: id,
  uri: `file:///${id}.mp4`,
  mediaType,
  duration: 20,
  dimensions: { width: 640, height: 480 },
  frameRate: 20,
  tags: [],
  state: {},
  metadata:
    mediaType === "video"
      ? { "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] } }
      : {},
});
const cut = (): core.Composition => ({
  id: "cut",
  storyId: "story",
  duration: 6,
  tracks: [
    {
      id: "v",
      type: "video",
      clips: [
        {
          id: "a",
          assetId: "a",
          timelineStart: 0,
          timelineDuration: 2,
          sourceIn: 1,
        },
        {
          id: "b",
          assetId: "b",
          timelineStart: 2,
          timelineDuration: 2,
          sourceIn: 5,
        },
        {
          id: "c",
          assetId: "c",
          timelineStart: 4,
          timelineDuration: 2,
          sourceIn: 9,
        },
      ],
    },
  ],
});
async function settle() {
  await vue.nextTick();
  await vue.nextTick();
}

async function mount(
  saved = cut(),
  assets = [asset("a"), asset("b"), asset("c")],
  graphicFrame: (
    compositionId: string,
    projectId: string,
    revision: string,
    frame: number,
    signal?: AbortSignal,
  ) => Promise<Blob> = async () => new Blob(["frame"]),
  audioRuntime?: {
    context: AudioContext;
    prepare?: (
      compositionId: string,
      revision: string,
      signal?: AbortSignal,
    ) => Promise<RecordAudioPreviewDescriptor>;
    read?: (
      id: string,
      start: number,
      count: number,
      signal?: AbortSignal,
    ) => Promise<Uint8Array>;
  },
) {
  // Missing adapter is an assertion failure in RED, rather than a loader error.
  expect(existsSync(path), "Composition RecordMonitor is implemented").toBe(
    true,
  );
  let now = 0;
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const history: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++id, callback);
    history.push(callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => callbacks.delete(key));
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  vi.stubGlobal("URL", {
    createObjectURL: () => "/graphic.png",
    revokeObjectURL: () => {},
  });
  if (audioRuntime)
    vi.stubGlobal("AudioContext", function () {
      return audioRuntime.context;
    });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      async decode() {}
    },
  );
  const api = {
    api: {
      prepareRecordAudioPreview:
        audioRuntime?.prepare ??
        (async (_compositionId: string, revision: string) => ({
          version: 1,
          id: "12345678-1234-1234-1234-123456789abc",
          revision,
          sourceKeyDigest: "a".repeat(64),
          sampleRate: 48000,
          channels: 2,
          format: "pcm_s24le",
          lengthSamples: Math.round(saved.duration * 48000),
        })),
      recordAudioPcm:
        audioRuntime?.read ??
        (async (_id: string, _start: number, count: number) =>
          new Uint8Array(count * 6)),
    },
    nativeTextOverlay: async () => new Blob(["caption"], { type: "image/png" }),
    nativeTextInspection: async () => ({
      status: "measured",
      runFonts: [],
      warnings: [],
    }),
    sourceUrl: (key: string, version: string | number) =>
      `/source/${key}?v=${encodeURIComponent(version)}`,
    titlePreviewUrl: (_cut: string, clipId: string) => `/title/${clipId}.png`,
    graphicFrame,
    ApiError: class extends Error {},
  };
  const look = loadComponent("apps/desktop/src/components/FilmLookFilter.vue", {
    "@openfilm/core": core,
  });
  const primary = loadComponent(
    "apps/desktop/src/components/PrimaryColorFilter.vue",
    { "@openfilm/core": core },
  );
  const title = loadComponent(
    "apps/desktop/src/components/NativeTitlePreview.vue",
    { "@openfilm/core": core },
  );
  const photo = loadComponent(
    "apps/desktop/src/components/PhotoPresentationPreview.vue",
    {
      "@openfilm/core": core,
      "../api": api,
      "vue-i18n": { useI18n: () => ({ t: String }) },
      "../i18n": { formatDuration: String },
      "./FilmLookFilter.vue": look,
      "./PrimaryColorFilter.vue": primary,
      "../source-color": { sourceColorStyle },
    },
  );
  const graphics = loadComponent(
    "apps/desktop/src/components/GraphicScenePreview.vue",
    {
      "@openfilm/core": core,
      "../api": api,
      "vue-i18n": { useI18n: () => ({ t: String }) },
      "./GraphicSceneLayerOverlay.vue": {},
    },
  );
  const captions = loadComponent(
    "apps/desktop/src/components/NativeCaptionPreview.vue",
    {
      "@openfilm/core": core,
      "../api": api,
      "vue-i18n": { useI18n: () => ({ t: String }) },
    },
  );
  const component = loadComponent(path, {
    "../recordAudioPlayback": playbackModule,
    "vue-i18n": { useI18n: () => ({ t: String }) },
    "./NativeCaptionPreview.vue": captions,
    "@openfilm/core": core,
    "../api": api,
    "../composables/useRecordTransport": { useRecordTransport },
    "./PhotoPresentationPreview.vue": photo,
    "./NativeTitlePreview.vue": title,
    "./GraphicScenePreview.vue": graphics,
    "./FilmLookFilter.vue": look,
    "./PrimaryColorFilter.vue": primary,
    "../source-color": { sourceColorStyle },
  });
  let transport: MonitorHandle;
  const frames: number[] = [];
  const issues: Array<{ code: string; clipId?: string }> = [];
  const selections: string[] = [];
  const splits: Array<{ clipId: string; sourceTime: number }> = [];
  const props = vue.reactive({
    projectId: "project",
    composition: saved,
    assets,
    revision: "r1",
    settings,
    sourceStatuses: {} as Record<string, SourceStatus>,
    sourceVersion: 0,
    active: true,
    bypassLook: false,
    ref: (value: MonitorHandle) => {
      if (value) transport = value;
    },
    onFrame: (frame: number) => frames.push(frame),
    onIssue: (issue: { code: string; clipId?: string }) => issues.push(issue),
    onSelectClip: (clipId: string) => selections.push(clipId),
    onSplit: (split: { clipId: string; sourceTime: number }) =>
      splits.push(split),
  });
  const mounted = mountComponent(component, props);
  cleanup.push(mounted.unmount);
  await settle();
  const nodes = () => flatten(mounted.root);
  const banks = () =>
    nodes().filter((node) => node.props["data-bank"] !== undefined);
  const audio = () => nodes().filter((node) => node.tag === "audio");
  const event = async (node: HostNode, name: string) => {
    (node.props[name] as ((event: unknown) => void) | undefined)?.({
      currentTarget: node,
      target: node,
    });
    await settle();
  };
  const ready = async (clipId: string) => {
    const bank = banks().find((node) => node.props["data-clip-id"] === clipId)!;
    expect(bank, `prearmed media for ${clipId}`).toBeDefined();
    if (bank.tag === "video") await event(bank, "onCanplay");
    else
      for (const image of flatten(bank).filter(
        (node) => node.tag === "img" && !node.props.class,
      ))
        await event(image, "onLoad");
    return bank;
  };
  const seek = async (frame: number) => {
    transport.seek(frame);
    await settle();
  };
  const tick = async (ms: number) => {
    now = ms;
    const work = [...callbacks.values()];
    callbacks.clear();
    work.forEach((callback) => callback(ms));
    await settle();
  };
  return {
    ...mounted,
    props,
    nodes,
    banks,
    audio,
    event,
    ready,
    seek,
    tick,
    frames,
    issues,
    selections,
    splits,
    callbacks,
    history,
    transport: () => transport,
    pcmTick: async (seconds: number) => {
      if (audioRuntime)
        Object.assign(audioRuntime.context, { currentTime: seconds });
      await vi.advanceTimersByTimeAsync(25);
      for (let i = 0; i < 10; i++) await settle();
    },
    graphics: async () => {
      await vi.advanceTimersByTimeAsync(0);
      await settle();
    },
  };
}

it.each([
  [23.976, 24000],
  [29.97, 30000],
  [59.94, 60000],
  [30, 30030],
])(
  "requests exact GraphicScene boundary and final frames at legacy %s without mutating settings",
  async (rate, numerator) => {
    const duration = (180 * 1001) / numerator;
    const saved = cut();
    saved.duration = duration;
    saved.tracks[0]!.clips = [
      { id: "a", assetId: "a", timelineStart: 0, timelineDuration: duration },
    ];
    saved.graphicScenes = [
      {
        version: 1,
        id: "g",
        name: "graphic",
        start: 0,
        duration,
        zIndex: 0,
        nodes: [],
      },
    ];
    const requests: number[] = [];
    const m = await mount(
      saved,
      [asset("a")],
      async (_cut, _project, _revision, frame) => {
        requests.push(frame);
        return new Blob([String(frame)]);
      },
    );
    m.props.settings = { width: 320, height: 180, frameRate: rate };
    const before = JSON.stringify(m.props.settings);
    await settle();
    for (const frame of [60, 179, 59, 120, 0, 119, 75, 178, 60, 179]) {
      await m.seek(frame);
      await m.graphics();
      expect(requests.at(-1)).toBe(frame);
      expect(
        m
          .nodes()
          .find((node) => node.props["data-testid"] === "graphic-preview")
          ?.props["data-frame"],
      ).toBe(frame);
    }
    expect(JSON.stringify(m.props.settings)).toBe(before);
    expect(m.props.settings.timebase).toBeUndefined();
  },
);

it("retains the completed GraphicScene during bounded forward renders and fences seek, reverse, buffering and replacement requests", async () => {
  const saved = cut();
  saved.graphicScenes = [
    {
      version: 1,
      id: "g",
      name: "graphic",
      start: 0,
      duration: 6,
      zIndex: 0,
      nodes: [],
    },
  ];
  const requests: Array<{
    frame: number;
    signal?: AbortSignal;
    finish: () => void;
  }> = [];
  const m = await mount(
    saved,
    [asset("a"), asset("b"), asset("c")],
    async (_cut, _project, _revision, frame, signal) =>
      new Promise<Blob>((resolve) => {
        requests.push({
          frame,
          signal,
          finish: () => resolve(new Blob([String(frame)])),
        });
      }),
  );
  const image = () =>
    m.nodes().find((node) => node.props["data-testid"] === "graphic-preview");
  await m.ready("a");
  await m.graphics();
  requests[0]!.finish();
  await settle();
  expect(image()?.props["data-frame"]).toBe(0);
  m.transport().play();
  await m.tick(100);
  await vi.advanceTimersByTimeAsync(120);
  expect(requests).toHaveLength(2);
  await m.tick(200);
  await m.tick(300);
  await vi.advanceTimersByTimeAsync(500);
  expect(image()?.props["data-frame"]).toBe(0);
  expect(requests[1]!.signal?.aborted).toBe(false);
  expect(requests).toHaveLength(2);
  requests[1]!.finish();
  await settle();
  expect(image()?.props["data-frame"]).toBe(1);
  await vi.advanceTimersByTimeAsync(120);
  expect(requests.at(-1)?.frame).toBe(3);
  await m.seek(15);
  await m.graphics();
  expect(requests[2]!.signal?.aborted).toBe(true);
  expect(requests.at(-1)?.frame).toBe(15);
  requests[2]!.finish();
  await settle();
  expect(image()).toBeUndefined();
  requests.at(-1)!.finish();
  await settle();
  expect(image()?.props["data-frame"]).toBe(15);
  const current = m.banks().find((node) => node.props["data-clip-id"] === "a")!;
  await m.event(current, "onWaiting");
  await m.graphics();
  expect(requests.at(-1)?.frame).toBe(15);
  requests.at(-1)!.finish();
  await settle();
  expect(image()?.props["data-frame"]).toBe(15);
  await m.ready("a");
  m.transport().shuttle(-1);
  m.transport().shuttle(-1);
  await m.tick(400);
  await m.graphics();
  expect(requests.at(-1)?.frame).toBe(14);
  const old = requests.at(-1)!;
  m.props.projectId = "replacement";
  await settle();
  await m.graphics();
  expect(old.signal?.aborted).toBe(true);
  old.finish();
  await settle();
  expect(image()).toBeUndefined();
  requests.at(-1)!.finish();
  await settle();
  expect(image()?.props["data-frame"]).toBe(0);
});

it("prearms the next primary and freezes at the first unready edit without hidden elapsed time", async () => {
  const m = await mount();
  expect(m.banks().map((node) => node.props["data-clip-id"])).toEqual([
    "a",
    "b",
  ]);
  await m.ready("a");
  m.transport().play();
  await settle();
  await m.tick(1900);
  expect(m.frames.at(-1)).toBe(19);
  await m.tick(3500);
  expect(m.frames.at(-1)).toBe(20);
  expect(m.transport().buffering).toBe(true);
  expect(m.callbacks.size).toBe(0);
  expect(m.issues.at(-1)).toMatchObject({
    code: "record.not-ready",
    clipId: "b",
  });
  await m.tick(9500);
  expect(m.frames.at(-1)).toBe(20);
  const prearmed = await m.ready("b");
  expect(m.transport().buffering).toBe(false);
  await m.tick(9600);
  expect(m.frames.at(-1)).toBe(21);
  expect(m.banks().find((node) => node.props["data-clip-id"] === "b")).toBe(
    prearmed,
  );
  expect(m.selections).toEqual([]);
});

it("does not skip an unready intermediate primary when one clock callback crosses two edits", async () => {
  const m = await mount();
  await m.ready("a");
  m.transport().play();
  await m.tick(5500);
  expect(m.frames.at(-1)).toBe(20);
  expect(m.transport().buffering).toBe(true);
  expect(m.frames).not.toContain(55);
});

it("pauses a missing source with a distinct issue and never auto-resumes it after recovery", async () => {
  const m = await mount();
  await m.ready("a");
  m.props.sourceStatuses = { b: { assetId: "b", status: "missing" } };
  await settle();
  m.transport().play();
  await m.tick(2200);
  expect(m.frames.at(-1)).toBe(20);
  expect(m.transport().playing).toBe(false);
  expect(m.issues.at(-1)).toMatchObject({
    code: "record.source-missing",
    clipId: "b",
  });
  m.props.sourceStatuses = {};
  m.props.sourceVersion++;
  await settle();
  await m.ready("b");
  expect(m.transport().playing).toBe(false);
});

it.each([
  "projectId",
  "composition",
  "revision",
  "settings",
  "sourceVersion",
] as const)(
  "remounts both banks and rejects late media events after %s changes",
  async (field) => {
    const m = await mount();
    await m.ready("a");
    const old = [...m.banks()];
    const staleReady = old[1]!.props.onCanplay as (event: unknown) => void;
    const staleError = old[0]!.props.onError as (event: unknown) => void;
    const staleTime = old[0]!.props.onTimeupdate as (event: unknown) => void;
    m.transport().play();
    if (field === "composition")
      m.props.composition = { ...cut(), id: "new-cut" };
    else if (field === "settings")
      m.props.settings = { ...settings, frameRate: 20 };
    else if (field === "sourceVersion") m.props.sourceVersion++;
    else m.props[field] = "new-owner";
    await settle();
    expect(m.banks()).toHaveLength(2);
    expect(m.banks().every((node) => !old.includes(node))).toBe(true);
    const frame = m.frames.at(-1);
    const count = m.issues.length;
    staleReady({ currentTarget: old[1] });
    staleError({ currentTarget: old[0] });
    old[0]!.currentTime = 999;
    staleTime({ currentTarget: old[0] });
    await settle();
    expect(m.frames.at(-1)).toBe(frame);
    expect(m.issues).toHaveLength(count);
    expect(m.transport().buffering).toBe(true);
    if (field !== "sourceVersion") expect(m.transport().playing).toBe(false);
  },
);

it("distinguishes decode failure from not-ready and ignores removed targets after disposal", async () => {
  const m = await mount();
  const current = await m.ready("a");
  m.transport().play();
  await m.event(current, "onError");
  expect(m.issues.at(-1)).toMatchObject({
    code: "record.decode-failed",
    clipId: "a",
  });
  expect(m.transport().playing).toBe(false);
  const count = m.issues.length;
  m.unmount();
  await m.event(current, "onCanplay");
  await m.event(current, "onError");
  m.history.forEach((callback) => callback(99999));
  expect(m.issues).toHaveLength(count);
  expect(m.callbacks.size).toBe(0);
});

it("preserves renderer visual order, exact source times, geometry and transition opacity at arbitrary seeks", async () => {
  const saved = cut();
  saved.tracks[0]!.clips[1]!.transition = { type: "crossfade", duration: 1 };
  saved.tracks[0]!.clips[1]!.transform = {
    speed: 2,
    x: 10,
    rotation: 90,
    scale: 1.2,
  };
  saved.tracks.push({
    id: "overlay",
    type: "overlay",
    clips: [
      { id: "top", assetId: "photo", timelineStart: 0, timelineDuration: 6 },
    ],
  });
  const m = await mount(saved, [
    asset("a"),
    asset("b"),
    asset("c"),
    asset("photo", "image"),
  ]);
  const before = JSON.stringify(saved);
  // Seeded shuffle deliberately revisits the outgoing crossfade tail out of order.
  let seed = 71;
  const frames = [20, 24, 29, 30, 12, 19];
  frames.sort(() => {
    seed = (seed * 16807) % 2147483647;
    return (seed % 3) - 1;
  });
  for (const frame of frames) {
    await m.seek(frame);
    await m.ready(frame < 20 ? "a" : "b");
    const layers = m
      .nodes()
      .filter((node) => node.props["data-record-layer"] !== undefined);
    expect(layers.map((node) => node.props["data-record-layer"])).toEqual(
      frame < 20 ? ["a", "top"] : frame < 30 ? ["a", "b", "top"] : ["b", "top"],
    );
    if (frame >= 20) {
      const incoming = layers.find(
        (node) => node.props["data-record-layer"] === "b",
      )!;
      expect((incoming.props.style as { opacity: number }).opacity).toBeCloseTo(
        Math.min(1, (frame - 20) / 10),
      );
      const player = m
        .banks()
        .find((node) => node.props["data-clip-id"] === "b")!;
      expect(player.currentTime).toBeCloseTo(5 + (frame - 20) / 5);
      expect(JSON.stringify(player.props.style)).toContain("rotate(90deg)");
    }
  }
  expect(JSON.stringify(saved)).toBe(before);
});

it("bypasses the effective look in place without changing media identity or saved composition", async () => {
  const saved = cut();
  saved.defaultLook = { version: 1, preset: "retro", strength: 0.8 };
  const before = JSON.stringify(saved);
  const m = await mount(saved);
  const player = m.banks().find((node) => node.props["data-clip-id"] === "a")!;

  expect((player.props.style as { filter?: string }).filter).toContain(
    "record-look-",
  );
  m.props.bypassLook = true;
  await settle();
  expect(m.banks().find((node) => node.props["data-clip-id"] === "a")).toBe(
    player,
  );
  expect((player.props.style as { filter?: string }).filter).toBeUndefined();
  expect(JSON.stringify(saved)).toBe(before);

  m.props.bypassLook = false;
  await settle();
  expect((player.props.style as { filter?: string }).filter).toContain(
    "record-look-",
  );
  expect(JSON.stringify(saved)).toBe(before);
});

it("keeps primary before Film Look and preserves it during look-only comparison", async () => {
  const saved = cut();
  saved.defaultPrimaryColor = {
    ...core.PRIMARY_COLOR_IDENTITY,
    exposureEv: 0.4,
  };
  saved.defaultLook = { version: 1, preset: "retro", strength: 0.5 };
  const before = JSON.stringify(saved),
    m = await mount(saved);
  const player = m.banks().find((n) => n.props["data-clip-id"] === "a")!;
  expect((player.props.style as { filter: string }).filter).toMatch(
    /record-primary-.*record-look-/,
  );
  m.props.bypassLook = true;
  await settle();
  expect((player.props.style as { filter: string }).filter).toContain(
    "record-primary-",
  );
  expect((player.props.style as { filter: string }).filter).not.toContain(
    "record-look-",
  );
  expect(m.banks().find((n) => n.props["data-clip-id"] === "a")).toBe(player);
  expect(JSON.stringify(saved)).toBe(before);
});

it("uses generated color filter IDs even when a valid project clip ID contains CSS punctuation", async () => {
  const saved = cut(),
    clipId = "clip (記憶) #1";
  saved.tracks[0]!.clips[0]!.id = clipId;
  saved.defaultPrimaryColor = {
    ...core.PRIMARY_COLOR_IDENTITY,
    exposureEv: 0.1,
  };
  const m = await mount(saved),
    player = m.banks().find((n) => n.props["data-clip-id"] === clipId)!;
  const filter = (player.props.style as { filter: string }).filter;
  expect(filter).toContain("record-primary-");
  expect(filter).not.toContain(clipId);
  for (const node of m.nodes().filter((n) => n.tag === "filter"))
    expect(node.props.id).toMatch(/^[a-zA-Z][a-zA-Z0-9_:.-]*$/);
});

it("bypasses PhotoPresentation layers without rebuilding the controlled photo", async () => {
  const saved = cut();
  saved.defaultLook = { version: 1, preset: "natural", strength: 1 };
  saved.tracks[0]!.clips = [
    {
      id: "photo",
      assetId: "photo",
      timelineStart: 0,
      timelineDuration: 6,
      layout: { version: 1, preset: "contain" },
    },
  ];
  const before = JSON.stringify(saved);
  const m = await mount(saved, [asset("photo", "image")]);
  const image = m
    .nodes()
    .find((node) => node.tag === "img" && node.props.alt === "photo")!;

  expect((image.props.style as { filter?: string }).filter).toContain(
    "photo-look-",
  );
  m.props.bypassLook = true;
  await settle();
  expect(
    m.nodes().find((node) => node.tag === "img" && node.props.alt === "photo"),
  ).toBe(image);
  expect((image.props.style as { filter?: string }).filter).toBeUndefined();
  expect(JSON.stringify(saved)).toBe(before);
});

it("composites reversed saved clips chronologically within each track while preserving saved identity and stable equal-start ties", async () => {
  const saved = cut();
  saved.tracks[0]!.clips[1]!.transition = { type: "crossfade", duration: 1 };
  saved.tracks[0]!.clips.reverse();
  saved.tracks.push({
    id: "overlay",
    type: "overlay",
    clips: [
      {
        id: "tie-first",
        assetId: "photo",
        timelineStart: 0,
        timelineDuration: 6,
      },
      {
        id: "tie-second",
        assetId: "photo",
        timelineStart: 0,
        timelineDuration: 6,
      },
    ],
  });
  const before = JSON.stringify(saved);
  const m = await mount(saved, [
    asset("a"),
    asset("b"),
    asset("c"),
    asset("photo", "image"),
  ]);
  for (const [frame, alpha] of [
    [24, 0.4],
    [20, 0],
    [29, 0.9],
  ] as const) {
    await m.seek(frame);
    await m.ready("b");
    const visible = m
      .nodes()
      .filter((node) => node.props["data-record-layer"] !== undefined);
    const stacked = visible.toSorted(
      (a, b) =>
        (a.props.style as { zIndex: number }).zIndex -
        (b.props.style as { zIndex: number }).zIndex,
    );
    expect(stacked.map((node) => node.props["data-record-layer"])).toEqual([
      "a",
      "b",
      "tie-first",
      "tie-second",
    ]);
    expect(
      (stacked[1]!.props.style as { opacity: number }).opacity,
    ).toBeCloseTo(alpha);
    expect(
      m.banks().find((node) => node.props["data-clip-id"] === "b")!.props[
        "data-bank"
      ],
    ).toBe("current");
  }
  expect(JSON.stringify(saved)).toBe(before);
  expect(saved.tracks[0]!.clips.map((clip) => clip.id)).toEqual([
    "c",
    "b",
    "a",
  ]);
});

it("drives controlled photo local time and non-asset titles/GraphicScenes from Record sequence time", async () => {
  const saved: core.Composition = {
    id: "photos",
    storyId: "story",
    duration: 6,
    tracks: [
      {
        id: "v",
        type: "video",
        clips: [
          {
            id: "photo",
            assetId: "photo",
            timelineStart: 2,
            timelineDuration: 4,
            layout: { version: 1, preset: "contain" },
            title: "photo title",
            titleStyle: { version: 1, role: "subtitle", fadeOut: 2 },
          },
        ],
      },
      {
        id: "titles",
        type: "titles",
        clips: [
          {
            id: "title",
            assetId: "not-an-asset",
            timelineStart: 1,
            timelineDuration: 4,
            sourceIn: 99,
            transform: { speed: 3 },
            title: "saved title",
            titleStyle: { version: 1, role: "subtitle", fadeOut: 2 },
          },
        ],
      },
    ],
    graphicScenes: [
      {
        version: 1,
        id: "g",
        name: "graphic",
        start: 0,
        duration: 6,
        zIndex: 0,
        nodes: [],
      },
    ],
  };
  const m = await mount(saved, [asset("photo", "image")]);
  for (const [frame, photoOpacity, titleOpacity] of [
    [40, 1, 0.5],
    [45, 0.75, 0.25],
    [20, 1, 1],
    [50, 0.5, undefined],
  ] as const) {
    await m.seek(frame);
    await m.ready("photo");
    await m.graphics();
    const photoTitle = m
      .nodes()
      .find((node) => node.props.class === "photo-presentation-title")!;
    expect((photoTitle.props.style as { opacity: number }).opacity).toBe(
      photoOpacity,
    );
    const title = m
      .nodes()
      .find((node) => node.props.src === "/title/title.png");
    if (titleOpacity === undefined) expect(title).toBeUndefined();
    else
      expect((title!.props.style as { opacity: number }).opacity).toBe(
        titleOpacity,
      );
    expect(
      m.nodes().find((node) => node.props["data-testid"] === "graphic-preview")
        ?.props["data-frame"],
    ).toBe(frame);
    expect(
      m
        .nodes()
        .some((node) => node.props.class === "photo-presentation-transport"),
    ).toBe(false);
    expect(m.callbacks.size).toBe(0);
  }
});

it("creates only audible media, multiplies volume by local automation, and mutes reverse/stop/inactive", async () => {
  const saved = cut();
  saved.tracks[0]!.clips[0]!.transform = { volume: 0.5 };
  saved.tracks[0]!.clips[0]!.audioAutomation = {
    version: 1,
    role: "dialogue",
    fadeIn: 2,
  };
  saved.tracks.push({
    id: "music",
    type: "music",
    clips: [
      {
        id: "music",
        assetId: "music",
        timelineStart: 0,
        timelineDuration: 6,
        transform: { volume: 0.8 },
        audioAutomation: {
          version: 1,
          role: "music",
          points: [
            { time: 0, gain: 0.25 },
            { time: 6, gain: 1 },
          ],
        },
      },
      {
        id: "silent",
        assetId: "silent",
        timelineStart: 0,
        timelineDuration: 6,
        transform: { volume: 0 },
      },
    ],
  });
  const m = await mount(saved, [
    asset("a"),
    asset("b"),
    asset("c"),
    asset("music", "audio"),
    asset("silent", "audio"),
  ]);
  await m.ready("a");
  await m.seek(10);
  expect(m.audio().map((node) => node.props["data-clip-id"])).toEqual([
    "a",
    "music",
  ]);
  expect(m.audio()[0]!.volume).toBe(0.25);
  expect(m.audio()[1]!.volume).toBeCloseTo(0.3);
  let pauses = 0;
  for (const node of m.audio())
    Object.assign(node, {
      play: () => Promise.resolve(),
      pause: () => {
        pauses++;
      },
    });
  m.transport().play();
  await settle();
  expect(m.audio().every((node) => node.props.muted === false)).toBe(true);
  m.transport().shuttle(-1);
  await settle();
  expect(m.audio().every((node) => node.props.muted === true)).toBe(true);
  expect(pauses).toBeGreaterThan(0);
  m.transport().stop();
  await settle();
  expect(m.audio().every((node) => node.props.muted === true)).toBe(true);
  m.props.active = false;
  await settle();
  expect(m.audio()).toEqual([]);
});

it("resyncs audio only on seek/boundary/source or drift beyond half a reliable source frame", async () => {
  const m = await mount();
  await m.ready("a");
  const player = m.audio()[0]!;
  let writes = 0;
  let time = player.currentTime;
  Object.defineProperty(player, "currentTime", {
    get: () => time,
    set: (value: number) => {
      writes++;
      time = value;
    },
    configurable: true,
  });
  Object.assign(player, { play: () => Promise.resolve() });
  m.transport().play();
  await settle();
  writes = 0;
  time = 1.09;
  await m.tick(100);
  expect(writes).toBe(0);
  time = 1.1;
  await m.tick(200);
  expect(writes).toBe(1);
  expect(time).toBe(1.2);
  await m.seek(2);
  expect(writes).toBe(2); // Explicit seek resyncs even at the same frame.
});

it("caps unsupported monitor gain explicitly and reports requested gain once per clip and owner", async () => {
  const saved = cut();
  saved.tracks[0]!.clips[0]!.transform = { volume: 1.5 };
  const m = await mount(saved);
  await m.ready("a");
  expect(m.audio()[0]!.volume).toBe(1);
  expect(
    m.issues.filter((issue) => issue.code === "record.audio-gain-unavailable"),
  ).toEqual([
    expect.objectContaining({ clipId: "a", trackId: "v", requestedGain: 1.5 }),
  ]);
  await m.seek(4);
  await m.seek(8);
  expect(
    m.issues.filter((issue) => issue.code === "record.audio-gain-unavailable"),
  ).toHaveLength(1);
});

it("holds a current source that loses readiness and resumes from the held frame", async () => {
  const m = await mount();
  const current = await m.ready("a");
  m.transport().play();
  await m.tick(1000);
  await m.event(current, "onWaiting");
  expect(m.transport().buffering).toBe(true);
  expect(m.callbacks.size).toBe(0);
  await m.tick(9000);
  expect(m.frames.at(-1)).toBe(10);
  await m.ready("a");
  await m.tick(9100);
  expect(m.frames.at(-1)).toBe(11);
});

it("treats edit and step commands as explicit resyncs even inside a source half-frame tolerance", async () => {
  const assets = [asset("a"), asset("b"), asset("c")].map((source) => ({
    ...source,
    frameRate: 1,
  }));
  const m = await mount(cut(), assets);
  await m.ready("a");
  const player = m.audio()[0]!;
  m.transport().step(1);
  await settle();
  expect(player.currentTime).toBe(1.1);
  m.transport().nextEdit();
  await settle();
  await m.ready("b");
  expect(m.audio()[0]!.currentTime).toBe(5);
  m.transport().split();
  expect(m.splits).toEqual([{ clipId: "b", sourceTime: 5 }]);
});

it("ignores a rejected old play operation after stop and a newer play", async () => {
  const m = await mount();
  const current = await m.ready("a");
  let reject: (reason: Error) => void = () => {};
  let calls = 0;
  Object.assign(current, {
    play: () =>
      ++calls === 1
        ? new Promise<void>((_resolve, no) => {
            reject = no;
          })
        : Promise.resolve(),
  });
  m.transport().play();
  await settle();
  m.transport().stop();
  m.transport().play();
  await settle();
  reject(new Error("old operation aborted"));
  await settle();
  expect(m.transport().playing).toBe(true);
  expect(m.issues.some((issue) => issue.code === "record.decode-failed")).toBe(
    false,
  );
});

it("bounds media URL versions with a large catalog and fences an in-place source URI change", async () => {
  const assets = [
    asset("a"),
    asset("b"),
    asset("c"),
    ...Array.from({ length: 200 }, (_, index) => ({
      ...asset(`unused-${index}`),
      uri: `file:///library/${"long-path/".repeat(40)}${index}.mp4`,
    })),
  ];
  const m = await mount(cut(), assets);
  for (const bank of m.banks()) {
    const version = decodeURIComponent(
      (bank.props.src as string).split("?v=")[1]!,
    );
    expect(version.length).toBeLessThan(1024);
    expect(version).not.toContain("long-path");
  }
  const old = await m.ready("a");
  const staleReady = old.props.onCanplay as (event: unknown) => void;
  m.transport().play();
  await m.tick(1000);
  m.props.assets[0]!.uri = "file:///relinked/a.mp4";
  await settle();
  const replacement = m
    .banks()
    .find((bank) => bank.props["data-clip-id"] === "a")!;
  expect(replacement).not.toBe(old);
  expect(replacement.props.src).not.toBe(old.props.src);
  expect(m.transport().buffering).toBe(true);
  const issues = m.issues.length;
  staleReady({ currentTarget: old });
  await settle();
  expect(m.transport().buffering).toBe(true);
  expect(m.issues).toHaveLength(issues);
  await m.tick(9000);
  expect(m.frames.at(-1)).toBe(10);
  await m.ready("a");
  await m.tick(9100);
  expect(m.frames.at(-1)).toBe(11);
});

it("reconciles the newest seek made synchronously by a frame listener", async () => {
  const m = await mount();
  await m.ready("a");
  m.props.onFrame = (frame: number) => {
    m.frames.push(frame);
    if (frame === 1) {
      m.transport().seek(12);
      m.transport().seek(15);
    }
  };
  await settle();
  await m.seek(1);
  expect(m.transport().frame).toBe(15);
  expect(
    m.nodes().find((node) => node.props.class === "record-monitor")!.props[
      "data-frame"
    ],
  ).toBe(15);
  expect(m.frames.at(-1)).toBe(15);
  expect(m.frames).not.toContain(12);
  expect(m.transport().playing).toBe(false);
  expect(m.banks()[0]!.currentTime).toBe(2.5);
});

it("fades embedded titles by continuing sequence-local time through a short trim and outgoing tail", async () => {
  const saved = cut();
  saved.tracks[0]!.clips = [
    {
      id: "a",
      assetId: "a",
      timelineStart: 0,
      timelineDuration: 3,
      sourceIn: 2,
      sourceOut: 3,
      transform: { speed: 2 },
      title: "Trimmed title",
      titleStyle: { version: 1, role: "subtitle", fadeOut: 1 },
    },
    {
      id: "b",
      assetId: "b",
      timelineStart: 3,
      timelineDuration: 3,
      transition: { type: "crossfade", duration: 1 },
    },
  ];
  const m = await mount(saved);
  const before = JSON.stringify(saved);
  await m.ready("a");
  for (const [frame, opacity] of [
    [25, 0.5],
    [35, 0],
    [22, 0.8],
  ] as const) {
    await m.seek(frame);
    const title = m.nodes().find((node) => node.props.src === "/title/a.png")!;
    expect((title.props.style as { opacity: number }).opacity).toBeCloseTo(
      opacity,
    );
  }
  expect(JSON.stringify(saved)).toBe(before);
});

it("silences exhausted trimmed audio while the Record sequence keeps playing", async () => {
  const saved = cut();
  saved.tracks[0]!.clips[0] = {
    id: "a",
    assetId: "a",
    timelineStart: 0,
    timelineDuration: 2,
    sourceIn: 0,
    sourceOut: 1,
  };
  const m = await mount(saved);
  await m.ready("a");
  await m.seek(15);
  const sound = m.audio()[0]!;
  let plays = 0;
  Object.assign(sound, {
    play: () => {
      plays++;
      return Promise.resolve();
    },
  });
  m.transport().play();
  await settle();
  expect(sound.props.muted).toBe(true);
  expect(plays).toBe(0);
  await m.tick(100);
  expect(m.transport().frame).toBe(16);
  expect(m.transport().playing).toBe(true);
  expect(sound.props.muted).toBe(true);
  expect(plays).toBe(0);
});

it("leaves uncovered pixels of controlled photo overlays transparent", async () => {
  const saved = cut();
  saved.tracks.push({
    id: "overlay",
    type: "overlay",
    clips: [
      {
        id: "portrait",
        assetId: "portrait",
        timelineStart: 0,
        timelineDuration: 6,
        transform: { scale: 0.5 },
      },
    ],
  });
  const m = await mount(saved, [
    asset("a"),
    asset("b"),
    asset("c"),
    {
      ...asset("portrait", "image"),
      dimensions: { width: 90, height: 160 },
    },
  ]);
  const photoFrame = m
    .nodes()
    .find((node) => node.props.class === "photo-presentation-frame")!;
  expect((photoFrame.props.style as { background: string }).background).toBe(
    "transparent",
  );
});

it("bounds a same-frame nested publication while retaining external explicit source resync", async () => {
  const m = await mount();
  const player = await m.ready("a");
  let writes = 0;
  let time = player.currentTime;
  Object.defineProperty(player, "currentTime", {
    get: () => time,
    set: (value: number) => {
      writes++;
      time = value;
    },
    configurable: true,
  });
  let publications = 0;
  let requestNested = true;
  m.props.onFrame = (frame: number) => {
    m.frames.push(frame);
    if (frame === 1) {
      publications++;
      // The limit lets the broken implementation fail without overflowing.
      if (requestNested && publications < 4) m.transport().seek(frame);
    }
  };
  await settle();
  await m.seek(1);
  expect(publications).toBe(1);
  expect(writes).toBe(2); // One external seek and the one queued resync.
  expect(m.transport().frame).toBe(1);
  requestNested = false;
  await m.seek(1);
  expect(publications).toBe(2);
  expect(writes).toBe(3); // External same-frame commands still resync.
});

it("updates unchanged readiness silently but still resyncs and publishes an external same-frame command", async () => {
  const m = await mount();
  const player = await m.ready("a");
  await m.seek(1);
  let writes = 0;
  let time = player.currentTime;
  Object.defineProperty(player, "currentTime", {
    get: () => time,
    set: (value: number) => {
      writes++;
      time = value;
    },
    configurable: true,
  });
  const publications = m.frames.length;
  await m.event(player, "onWaiting");
  expect(m.transport().buffering).toBe(true);
  await m.event(player, "onCanplay");
  expect(m.transport().buffering).toBe(false);
  expect(m.frames).toHaveLength(publications);
  expect(writes).toBe(0);
  await m.seek(1);
  expect(m.frames).toHaveLength(publications + 1);
  expect(m.frames.at(-1)).toBe(1);
  expect(writes).toBe(1);
  await m.event(player, "onCanplay");
  expect(m.frames).toHaveLength(publications + 1);
  expect(writes).toBe(1);
});

it("retains queued explicit source resync when same-target readiness arrives during publication", async () => {
  const m = await mount();
  const player = await m.ready("a");
  let writes = 0;
  let time = player.currentTime;
  Object.defineProperty(player, "currentTime", {
    get: () => time,
    set: (value: number) => {
      writes++;
      time = value;
    },
    configurable: true,
  });
  m.props.onFrame = (frame: number) => {
    m.frames.push(frame);
    if (frame === 1) {
      m.transport().seek(frame);
      (player.props.onCanplay as (event: unknown) => void)({
        currentTarget: player,
        target: player,
      });
    }
  };
  await settle();
  await m.seek(1);
  expect(writes).toBe(2);
  expect(m.frames.filter((frame) => frame === 1)).toHaveLength(1);
});

class PolicyAudioContext {
  currentTime = 0;
  state = "running";
  destination = {};
  nodes: {
    buffer: unknown;
    when: number;
    connected: boolean;
    stopped: boolean;
  }[] = [];
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from(
      { length: channels },
      () => new Float32Array(length),
    );
    return {
      length,
      sampleRate,
      getChannelData: (index: number) => data[index]!,
    };
  }
  createBufferSource() {
    const node = {
      buffer: null as unknown,
      when: -1,
      connected: false,
      stopped: false,
      onended: null as unknown,
      connect() {
        this.connected = true;
      },
      disconnect() {
        this.connected = false;
      },
      start(when: number) {
        this.when = when;
      },
      stop() {
        this.stopped = true;
      },
    };
    this.nodes.push(node);
    return node;
  }
  async resume() {
    this.state = "running";
  }
  async close() {
    this.state = "closed";
  }
}
it("policy PCM is the only sound owner and drives actual native captions through an underrun hold", async () => {
  const saved = cut();
  saved.tracks[0]!.clips[0]!.audioTiming = {
    version: 1,
    sampleRate: 48000,
    timelineStartSample: 817,
    sourceInSample: 48000,
    sourceOutSample: 144000,
  };
  saved.captionTracks = [
    {
      version: 1,
      id: "captions",
      name: "Captions",
      style: { version: 1, role: "subtitle" },
      cues: [
        {
          version: 1,
          id: "cue",
          startMs: 1000,
          endMs: 2500,
          text: "語\nSpeech",
          textRuns: {
            version: 1,
            splitAt: 1,
            primary: { fontSize: 20 },
            secondary: { fontSize: 12 },
          },
          source: { kind: "manual" },
          manualRevision: 0,
        },
      ],
    },
  ];
  const context = new PolicyAudioContext();
  let release!: (value: Uint8Array) => void;
  const blocked = new Promise<Uint8Array>((resolve) => {
    release = resolve;
  });
  const monitor = await mount(saved, undefined, undefined, {
    context: context as unknown as AudioContext,
    read: async (_id, start, count) =>
      start === 96000 ? blocked : new Uint8Array(count * 6),
  });
  await monitor.ready("a");
  await monitor.ready("b");
  expect(monitor.audio()).toHaveLength(0);
  monitor.transport().play();
  await monitor.pcmTick(0);
  await monitor.pcmTick(1.25);
  expect(monitor.transport().frame).toBe(10);
  expect(monitor.nodes().some((n) => n.props["data-cue-id"] === "cue")).toBe(
    true,
  );
  await monitor.tick(100000);
  expect(monitor.transport().frame).toBe(10);
  await monitor.pcmTick(3);
  expect(monitor.transport().frame).toBe(20);
  await monitor.pcmTick(20);
  expect(monitor.transport().frame).toBe(20);
  expect(monitor.nodes().some((n) => n.props["data-cue-id"] === "cue")).toBe(
    true,
  );
  release(new Uint8Array(96000 * 6));
  await monitor.pcmTick(20);
  await monitor.pcmTick(20.75);
  expect(monitor.transport().frame).toBe(25);
  expect(monitor.nodes().some((n) => n.props["data-cue-id"] === "cue")).toBe(
    false,
  );
  monitor.transport().pause();
  expect(context.nodes.every((n) => n.stopped || !n.connected)).toBe(true);
  expect(monitor.audio()).toHaveLength(0);
});
it("drops interrupted PCM preparation after a revision change and reports unsupported WebAudio without legacy audio", async () => {
  const saved = cut();
  saved.tracks[0]!.clips[0]!.audioTiming = {
    version: 1,
    sampleRate: 48000,
    timelineStartSample: 0,
    sourceInSample: 48000,
    sourceOutSample: 96000,
  };
  const context = new PolicyAudioContext();
  let complete!: (value: RecordAudioPreviewDescriptor) => void,
    signal: AbortSignal | undefined;
  const pending = new Promise<RecordAudioPreviewDescriptor>((resolve) => {
    complete = resolve;
  });
  const monitor = await mount(saved, undefined, undefined, {
    context: context as unknown as AudioContext,
    prepare: async (_id, _revision, value) => {
      signal = value;
      return pending;
    },
  });
  await monitor.ready("a");
  monitor.transport().play();
  await settle();
  monitor.props.revision = "r2";
  await settle();
  expect(signal?.aborted).toBe(true);
  complete({
    version: 1,
    id: "12345678-1234-1234-1234-123456789abc",
    revision: "r1",
    sourceKeyDigest: "a".repeat(64),
    sampleRate: 48000,
    channels: 2,
    format: "pcm_s24le",
    lengthSamples: 288000,
  });
  await settle();
  expect(context.nodes).toHaveLength(0);
  expect(monitor.audio()).toHaveLength(0);
  vi.stubGlobal("AudioContext", undefined);
  monitor.transport().play();
  await settle();
  expect(
    monitor
      .nodes()
      .some((n) => n.props["data-record-audio-state"] === "failed"),
  ).toBe(true);
  expect(monitor.audio()).toHaveLength(0);
});
