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
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("URL", {
    createObjectURL: () => "/graphic.png",
    revokeObjectURL: () => {},
  });
  const api = {
    sourceUrl: (key: string, version: string | number) =>
      `/source/${key}?v=${encodeURIComponent(version)}`,
    titlePreviewUrl: (_cut: string, clipId: string) => `/title/${clipId}.png`,
    graphicFrame: async () => new Blob(["frame"]),
    ApiError: class extends Error {},
  };
  const look = loadComponent("apps/desktop/src/components/FilmLookFilter.vue", {
    "@openfilm/core": core,
  });
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
  const component = loadComponent(path, {
    "@openfilm/core": core,
    "../api": api,
    "../composables/useRecordTransport": { useRecordTransport },
    "./PhotoPresentationPreview.vue": photo,
    "./NativeTitlePreview.vue": title,
    "./GraphicScenePreview.vue": graphics,
    "./FilmLookFilter.vue": look,
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
    await event(bank, bank.tag === "img" ? "onLoad" : "onCanplay");
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
    graphics: async () => {
      await vi.advanceTimersByTimeAsync(0);
      await settle();
    },
  };
}

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

it("preserves saved visual order, exact source times, geometry and transition opacity at arbitrary seeks", async () => {
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
