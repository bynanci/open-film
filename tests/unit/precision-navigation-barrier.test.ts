// Modified by OpenFilm contributors on 2026-10-18. Current license: Apache-2.0.
// Historical Apache-2.0 and GPL-3.0-only grants remain; see LICENSE and NOTICE.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveFilmLook,
  resolveProjectTimebase,
  timebaseKey,
  sequenceFrameAt,
  sequenceTimeAt,
  type Clip,
  type Job,
  type MediaAsset,
  type TimelineMarker,
} from "@openfilm/core";
import type { IntelligenceState } from "../../apps/desktop/src/api";
import type { TimelineCommand } from "@openfilm/solver";
import type { CommitTransactionResult } from "../../apps/desktop/src/composables/useTimelineEditor";
import * as sourceMarks from "../../apps/desktop/src/sourceMarks";
import * as monitor from "../../apps/desktop/src/monitor";

const vue = createRequire(resolve("apps/desktop/package.json"))("vue");
const reactivity = Object.fromEntries(
  ["ref", "shallowRef", "computed", "nextTick", "watch"].map((key) => [
    key,
    vue[key],
  ]),
);
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  vi.unstubAllGlobals();
});
type Ref<T> = { value: T };
type Barrier = { hasPending: Ref<boolean>; flush: () => Promise<boolean> };
function component<T>(name: string, names: string[]) {
  const source = readFileSync(
    resolve(`apps/desktop/src/components/${name}.vue`),
    "utf8",
  );
  const code = transformSync(
    source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)![1]!,
    { loader: "ts", format: "esm" },
  ).code.replace(/^import[\s\S]*?from "[^"\n]+";\n/gm, "");
  return (dependencies: Record<string, unknown>): T =>
    new Function(
      "dependencies",
      `const {${Object.keys(dependencies).join(",")}}=dependencies;\n${code}\nreturn {${names.map((name) => `${name}: typeof ${name} === "undefined" ? undefined : ${name}`).join(",")}};`,
    )(dependencies) as T;
}
// Run the real SFC scripts with Vue reactive state. Only network I/O and DOM
// lifecycle registration are supplied by the host; mutation logic is unchanged.
const precisionFactory = component<{
  addMarker: (time?: number) => Promise<void>;
  removeMarker: (marker: TimelineMarker) => Promise<void>;
  analyze: (operation: "transcribe" | "waveform" | "scenes") => Promise<void>;
  sourceVerified: Ref<boolean>;
  pending: Ref<boolean>;
  transcriptionReady: Ref<boolean>;
  hasSourceDuration: Ref<boolean>;
  analysisBusy: Ref<boolean>;
  playhead: Ref<number>;
  trimIn: Ref<number>;
  trimOut: Ref<number>;
  marksStale: Ref<boolean>;
  canApply: Ref<boolean>;
  stageIn: () => void;
  stageOut: () => void;
  applyRange: () => Promise<void>;
  split: () => Promise<void>;
  shuttle: (direction: -1 | 1) => void;
  stop: () => void;
  play: () => void;
  playbackError: Ref<boolean>;
  step: (direction: -1 | 1, seconds?: boolean) => void;
  shuttleTier: Ref<number>;
  player: Ref<unknown>;
  moveTrim: (event: KeyboardEvent, side: "in" | "out") => void;
  finishDrag: (event: PointerEvent) => void;
}>("PrecisionEditor", [
  "addMarker",
  "removeMarker",
  "analyze",
  "sourceVerified",
  "pending",
  "transcriptionReady",
  "hasSourceDuration",
  "analysisBusy",
  "playhead",
  "trimIn",
  "trimOut",
  "marksStale",
  "canApply",
  "stageIn",
  "stageOut",
  "applyRange",
  "split",
  "shuttle",
  "stop",
  "play",
  "playbackError",
  "step",
  "shuttleTier",
  "player",
  "moveTrim",
  "finishDrag",
]);
const timelineFactory = component<{
  precisionEditor?: Ref<unknown>;
  transcriptEditor: Ref<unknown>;
  editMode: Ref<"story" | "precision" | "transcript">;
  selectedClipId: Ref<string>;
  chooseClip: (clip: Clip) => void;
  setEditMode: (mode: "story" | "precision" | "transcript") => Promise<void>;
  history: (direction: "undo" | "redo") => Promise<boolean>;
  keyboard: (event: KeyboardEvent) => void;
}>("TimelineEditor", [
  "precisionEditor",
  "transcriptEditor",
  "editMode",
  "selectedClipId",
  "chooseClip",
  "setEditMode",
  "history",
  "keyboard",
]);
function deferred<T>() {
  let release!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  return { promise, release, reject };
}
const asset: MediaAsset = {
  id: "source",
  uri: "/media/memory.mp4",
  name: "memory.mp4",
  mediaType: "video",
  duration: 10,
  tags: [],
  state: {},
  metadata: {},
};
const clip: Clip = {
  id: "clip",
  assetId: asset.id,
  sourceIn: 0,
  sourceOut: 10,
  timelineStart: 0,
  timelineDuration: 10,
};
async function precision(activeJobs: Job[] = []) {
  vi.stubGlobal("document", { querySelector: () => null });
  const unmountCallbacks: Array<() => void> = [];
  const response = deferred<unknown>();
  const state: IntelligenceState = {
    sourceHash: "hash",
    transcriptTotal: 0,
    transcriptOffset: 0,
    markers: [],
  };
  const props = vue.reactive({
    projectId: "project",
    compositionId: "film",
    revision: "r1",
    settings: { frameRate: 30, width: 1920, height: 1080 },
    asset: { ...asset },
    clip: { ...clip },
    active: true,
    busy: false,
    sourceVersion: 0,
    clips: [],
    submit: vi.fn(),
    commit: vi.fn(
      async (
        _command: TimelineCommand,
        _signal?: AbortSignal,
      ): Promise<CommitTransactionResult> => ({
        status: "accepted",
        revision: "r2",
      }),
    ),
    sourceEditsLocked: false,
  });
  let exposed: Partial<Barrier> = {};
  const emit = vi.fn();
  const request = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/jobs" && !options?.method)
      return Promise.resolve({ jobs: activeJobs });
    return response.promise;
  });
  const scope = vue.effectScope();
  const instance = scope.run(() =>
    precisionFactory({
      ...reactivity,
      reset: sourceMarks.reset,
      markStale: sourceMarks.markStale,
      reconcileSourceMarks: sourceMarks.reconcileSourceMarks,
      sameSourceOwner: sourceMarks.sameSourceOwner,
      validSourceRange: sourceMarks.validSourceRange,
      ...monitor,
      stageSourceIn: sourceMarks.stageIn,
      stageSourceOut: sourceMarks.stageOut,
      resolveProjectTimebase,
      timebaseKey,
      sequenceFrameAt,
      sequenceTimeAt,
      defineProps: () => props,
      defineEmits: () => emit,
      defineExpose: (value: Barrier) => {
        exposed = value;
      },
      useI18n: () => ({ t: String, te: () => false }),
      onMounted: () => {},
      onBeforeUnmount: (stop: () => void) => unmountCallbacks.push(stop),
      cancelAnimationFrame: () => {},
      window: { removeEventListener: () => {} },
      api: {
        intelligence: vi.fn(async () => state),
        intelligenceProviders: vi.fn(async () => ({
          transcription: { available: true },
        })),
      },
      request,
    }),
  )!;
  function unmount() {
    for (const stop of unmountCallbacks.splice(0).reverse()) stop();
    scope.stop();
  }
  cleanup.push(unmount);
  await vi.waitFor(() => expect(instance.sourceVerified.value).toBe(true));
  await vue.nextTick();
  return { instance, props, exposed, response, request, emit, unmount };
}
function timeline(child: Partial<Barrier>) {
  const document = { querySelector: () => null };
  vi.stubGlobal("document", document);
  const calls: string[] = [];
  let compositionResult = true;
  let transcriptResult = true;
  let exposed!: Barrier;
  const compositionPending = vue.ref(false);
  const historyBusy = vue.ref(false);
  const state = vue.ref({ canUndo: false, canRedo: true });
  const compositionHistory = vi.fn(async (_direction: "undo" | "redo") => true);
  const compositionFlush = vi.fn(async () => {
    calls.push("composition");
    return compositionResult;
  });
  const transcriptFlush = vi.fn(async () => {
    calls.push("transcript");
    return transcriptResult;
  });
  const instance = timelineFactory({
    ...reactivity,
    useId: () => "precision-navigation-timeline",
    resolveFilmLook,
    ownsSourceShortcut: monitor.ownsSourceShortcut,
    defineProps: () => ({
      projectId: "project",
      compositionId: "film",
      active: true,
    }),
    defineEmits: () => vi.fn(),
    defineExpose: (value: Barrier) => {
      exposed = value;
    },
    useI18n: () => ({ t: String }),
    hasGraphicSceneAgentReceipt: () => false,
    onMounted: () => {},
    onBeforeUnmount: () => {},
    watch: () => {},
    document,
    useTimelineEditor: () => ({
      state,
      status: vue.ref("saved"),
      hasPending: compositionPending,
      historyBusy,
      history: compositionHistory,
      flush: compositionFlush,
    }),
  });
  if (instance.precisionEditor)
    instance.precisionEditor.value = vue.proxyRefs(child);
  instance.transcriptEditor.value = {
    hasPending: false,
    flush: transcriptFlush,
  };
  return {
    instance,
    exposed,
    calls,
    compositionPending,
    historyBusy,
    state,
    compositionHistory,
    compositionFlush,
    transcriptFlush,
    compositionFails: () => {
      compositionResult = false;
    },
    transcriptFails: () => {
      transcriptResult = false;
    },
  };
}

function buttonDisabled(
  name: string,
  action: string,
  bindings: Record<string, unknown>,
) {
  const source = readFileSync(
    resolve(`apps/desktop/src/components/${name}.vue`),
    "utf8",
  );
  const button = source
    .match(/<button\b[\s\S]*?<\/button\s*>/gu)
    ?.find((tag) => tag.includes(`@click="${action}"`));
  const expression = button?.match(/:disabled="([\s\S]*?)"/u)?.[1];
  if (!expression)
    throw new Error(`Missing ${name} disabled state for ${action}`);
  const values = vue.proxyRefs(bindings);
  return new Function(
    "values",
    `const {${Object.keys(values).join(",")}}=values;return !!(${expression});`,
  )(values) as boolean;
}

function historyButtonDisabled(
  h: ReturnType<typeof timeline>,
  direction: "undo" | "redo",
) {
  return buttonDisabled("TimelineEditor", `history('${direction}')`, {
    state: h.state,
    historyBusy: h.historyBusy,
    compositionHasPending: h.compositionPending,
    hasPending: h.exposed.hasPending,
    precisionEditor: h.instance.precisionEditor,
  });
}

function shortcut(h: ReturnType<typeof timeline>, direction: "undo" | "redo") {
  const preventDefault = vi.fn();
  h.instance.keyboard({
    key: "z",
    ctrlKey: true,
    shiftKey: direction === "redo",
    defaultPrevented: false,
    target: { closest: () => null },
    preventDefault,
  } as unknown as KeyboardEvent);
  return preventDefault;
}

function mutate(
  h: Awaited<ReturnType<typeof precision>>,
  operation: "add" | "remove" | "analyze",
) {
  return operation === "add"
    ? h.instance.addMarker(3)
    : operation === "remove"
      ? h.instance.removeMarker({
          id: "marker",
          assetId: asset.id,
          time: 3,
          type: "manual",
        })
      : h.instance.analyze("waveform");
}

describe("Precision navigation retains in-flight mutation submissions", () => {
  it.each(
    (["in", "out"] as const).flatMap((side) =>
      [
        "ctrl",
        "meta",
        "alt",
        "handled",
        "ime",
        "input",
        "textarea",
        "select",
        "contenteditable",
        "draft",
        "pipeline",
        "isolation",
        "dialog",
      ].map((context) => ({ side, context })),
    ),
  )(
    "isolates the $side handle in $context without claiming the event",
    async ({ side, context }) => {
      const h = await precision();
      h.instance.trimIn.value = 2;
      h.instance.trimOut.value = 8;
      const protectedTarget = [
        "input",
        "textarea",
        "select",
        "contenteditable",
        "draft",
        "pipeline",
        "isolation",
      ].includes(context);
      vi.stubGlobal("document", {
        querySelector: () => (context === "dialog" ? {} : null),
      });
      const event = {
        key: "ArrowRight",
        ctrlKey: context === "ctrl",
        metaKey: context === "meta",
        altKey: context === "alt",
        defaultPrevented: context === "handled",
        isComposing: context === "ime",
        target: { closest: () => (protectedTarget ? {} : null) },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      h.instance.moveTrim(event as unknown as KeyboardEvent, side);
      expect([h.instance.trimIn.value, h.instance.trimOut.value]).toEqual([
        2, 8,
      ]);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
      expect(h.props.commit).not.toHaveBeenCalled();
    },
  );
  it.each(["in", "out"] as const)(
    "keeps Shift adjustment owned by the %s handle",
    async (side) => {
      const h = await precision();
      h.instance.trimIn.value = 2;
      h.instance.trimOut.value = 8;
      const event = {
        key: side === "in" ? "ArrowRight" : "ArrowLeft",
        shiftKey: true,
        target: { closest: () => null },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      h.instance.moveTrim(event as unknown as KeyboardEvent, side);
      expect(
        side === "in" ? h.instance.trimIn.value : h.instance.trimOut.value,
      ).toBeCloseTo(side === "in" ? 2 + 10 / 30 : 8 - 10 / 30);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(h.props.commit).not.toHaveBeenCalled();
    },
  );
  it("keyboard trim stages without committing and preserves IME defaults", async () => {
    const h = await precision();
    const preventDefault = vi.fn();
    const event = {
      key: "ArrowRight",
      preventDefault,
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    h.instance.moveTrim(event, "in");
    expect(h.instance.trimIn.value).toBeCloseTo(1 / 30);
    expect(h.props.commit).not.toHaveBeenCalled();
    h.instance.moveTrim({ ...event, isComposing: true } as KeyboardEvent, "in");
    expect(h.instance.trimIn.value).toBeCloseTo(1 / 30);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
  it("positive playback tiers and reverse integer frames stop cleanly at the range boundary", async () => {
    const h = await precision();
    vi.useFakeTimers();
    try {
      const media = {
        pause: vi.fn(),
        play: vi.fn(async () => {}),
        currentTime: 5,
        playbackRate: 1,
        volume: 1,
      };
      h.instance.player.value = media;
      h.instance.playhead.value = 5;
      h.instance.shuttle(1);
      h.instance.shuttle(1);
      expect(media.playbackRate).toBe(2);
      h.instance.stop();
      h.instance.shuttle(-1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.instance.playhead.value).toBeCloseTo(4, 6);
      h.props.settings.frameRate = 24;
      expect(h.instance.shuttleTier.value).toBe(0);
      const stopped = h.instance.playhead.value;
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.instance.playhead.value).toBe(stopped);
      h.instance.playhead.value = 1 / 24;
      h.instance.shuttle(-1);
      await vi.advanceTimersByTimeAsync(100);
      expect(h.instance.playhead.value).toBe(0);
      expect(h.instance.shuttleTier.value).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("reverse shuttle observes a newly staged In bound without crossing it", async () => {
    const h = await precision();
    vi.useFakeTimers();
    try {
      h.instance.playhead.value = 5;
      h.instance.shuttle(-1);
      h.instance.trimIn.value = 4.5;
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.instance.playhead.value).toBe(4.5);
      expect(h.instance.shuttleTier.value).toBe(0);
    } finally {
      h.instance.stop();
      vi.useRealTimers();
    }
  });
  it.each(["AbortError", "NotAllowedError"])(
    "an obsolete %s from rapid L/L does not stop the newest 2× play",
    async (name) => {
      const h = await precision();
      const first = deferred<void>();
      const second = deferred<void>();
      const media = {
        pause: vi.fn(),
        play: vi
          .fn()
          .mockReturnValueOnce(first.promise)
          .mockReturnValueOnce(second.promise),
        currentTime: 5,
        playbackRate: 1,
        volume: 1,
      };
      h.instance.player.value = media;
      h.instance.playhead.value = 5;
      h.instance.shuttle(1);
      h.instance.shuttle(1);
      first.reject(new DOMException("Previous play was interrupted", name));
      await vue.nextTick();
      expect(h.instance.shuttleTier.value).toBe(2);
      expect(media.playbackRate).toBe(2);
      expect(h.instance.playbackError.value).toBe(false);
      second.release();
      await vue.nextTick();
    },
  );
  it.each(["play", "shuttle"] as const)(
    "a rejected %s promise cannot stop a later reverse shuttle",
    async (start) => {
      const h = await precision();
      const pendingPlay = deferred<void>();
      const media = {
        pause: vi.fn(),
        play: vi.fn(() => pendingPlay.promise),
        currentTime: 5,
        playbackRate: 1,
        volume: 1,
      };
      h.instance.player.value = media;
      h.instance.playhead.value = 5;
      vi.useFakeTimers();
      try {
        if (start === "play") h.instance.play();
        else h.instance.shuttle(1);
        h.instance.shuttle(-1);
        h.instance.shuttle(-1);
        pendingPlay.reject(
          new DOMException("Forward play interrupted", "AbortError"),
        );
        await vue.nextTick();
        await vi.advanceTimersByTimeAsync(100);
        expect(h.instance.shuttleTier.value).toBe(-1);
        expect(h.instance.playhead.value).toBeCloseTo(4.9, 6);
        expect(h.instance.playbackError.value).toBe(false);
      } finally {
        h.instance.stop();
        vi.useRealTimers();
      }
    },
  );
  it.each([
    "stop",
    "selection",
    "revision",
    "timebase",
    "source",
    "unmount",
    "media",
  ] as const)(
    "ignores pending play rejection after %s invalidates its owner",
    async (change) => {
      const h = await precision();
      const pendingPlay = deferred<void>();
      const media = {
        pause: vi.fn(),
        play: vi.fn(() => pendingPlay.promise),
        currentTime: 5,
        playbackRate: 1,
        volume: 1,
      };
      h.instance.player.value = media;
      h.instance.playhead.value = 5;
      h.instance.play();
      if (change === "stop") h.instance.stop();
      else if (change === "selection")
        h.props.clip = { ...clip, id: "next-clip" };
      else if (change === "revision") h.props.revision = "r2";
      else if (change === "timebase") h.props.settings.frameRate = 24;
      else if (change === "source") h.props.sourceVersion++;
      else if (change === "unmount") h.unmount();
      else h.instance.player.value = { ...media, pause: vi.fn() };
      await vue.nextTick();
      const expectedTier = h.instance.shuttleTier.value;
      pendingPlay.reject(
        new DOMException("Superseded media rejected", "NotAllowedError"),
      );
      await vue.nextTick();
      expect(h.instance.shuttleTier.value).toBe(expectedTier);
      expect(h.instance.playbackError.value).toBe(false);
    },
  );
  it.each(["play", "shuttle"] as const)(
    "reports and stops a current genuine %s rejection",
    async (start) => {
      const h = await precision();
      const pendingPlay = deferred<void>();
      const media = {
        pause: vi.fn(),
        play: vi.fn(() => pendingPlay.promise),
        currentTime: 5,
        playbackRate: 1,
        volume: 1,
      };
      h.instance.player.value = media;
      if (start === "play") h.instance.play();
      else h.instance.shuttle(1);
      pendingPlay.reject(
        new DOMException("Current playback denied", "NotAllowedError"),
      );
      await vue.nextTick();
      expect(h.instance.shuttleTier.value).toBe(0);
      expect(h.instance.playbackError.value).toBe(true);
    },
  );
  it("does not report an intentional current AbortError as a playback failure", async () => {
    const h = await precision();
    const pendingPlay = deferred<void>();
    h.instance.player.value = {
      pause: vi.fn(),
      play: () => pendingPlay.promise,
      currentTime: 5,
      playbackRate: 1,
      volume: 1,
    };
    h.instance.play();
    pendingPlay.reject(
      new DOMException("Intentional interruption", "AbortError"),
    );
    await vue.nextTick();
    expect(h.instance.playbackError.value).toBe(false);
  });
  it("I/O and numeric entry only stage; Apply submits one trim transaction and resets", async () => {
    const h = await precision();
    h.instance.playhead.value = 2;
    h.instance.stageIn();
    h.instance.playhead.value = 8;
    h.instance.stageOut();
    h.instance.trimIn.value = 3;
    expect(h.props.submit).not.toHaveBeenCalled();
    expect(h.props.commit).not.toHaveBeenCalled();
    expect(h.instance.canApply.value).toBe(true);
    await h.instance.applyRange();
    expect(h.props.commit).toHaveBeenCalledExactlyOnceWith(
      { type: "trim", clipId: "clip", sourceIn: 3, sourceOut: 8 },
      expect.any(AbortSignal),
    );
    expect(h.instance.canApply.value).toBe(false);
    expect(h.instance.marksStale.value).toBe(false);
  });
  it("invalid and stale ranges never commit, including a revision change before the watcher runs", async () => {
    const h = await precision();
    h.instance.trimIn.value = 11;
    expect(h.instance.canApply.value).toBe(false);
    await h.instance.applyRange();
    h.instance.trimIn.value = 2;
    h.props.revision = "r2";
    await h.instance.applyRange();
    expect(h.props.commit).not.toHaveBeenCalled();
    expect(h.instance.marksStale.value).toBe(true);
    expect(h.instance.trimIn.value).toBe(2);
    h.instance.playhead.value = 5;
    await h.instance.split();
    expect(h.props.commit).not.toHaveBeenCalled();
  });
  it.each(["projectId", "compositionId", "clip", "settings"] as const)(
    "clears staged marks on %s owner changes",
    async (key) => {
      const h = await precision();
      h.instance.trimIn.value = 2;
      if (key === "clip") h.props.clip = { ...clip, id: "other" };
      else if (key === "settings") h.props.settings.frameRate = 24;
      else h.props[key] = "other";
      await vue.nextTick();
      expect(h.instance.trimIn.value).toBe(0);
      expect(h.instance.canApply.value).toBe(false);
    },
  );
  it("failed transactions retain stale marks and block a second Apply", async () => {
    const h = await precision();
    h.props.commit.mockResolvedValue({ status: "conflict" });
    h.instance.trimIn.value = 2;
    await h.instance.applyRange();
    expect(h.instance.trimIn.value).toBe(2);
    expect(h.instance.marksStale.value).toBe(true);
    await h.instance.applyRange();
    expect(h.props.commit).toHaveBeenCalledTimes(1);
  });
  it("holds the navigation barrier for Apply, deduplicates clicks, and cancels an owner change", async () => {
    const h = await precision();
    const response = deferred<CommitTransactionResult>();
    h.props.commit.mockImplementation(() => response.promise);
    h.instance.trimIn.value = 2;
    const apply = h.instance.applyRange();
    expect(await h.exposed.flush?.()).toBe(false);
    await h.instance.applyRange();
    expect(h.props.commit).toHaveBeenCalledTimes(1);
    const signal = h.props.commit.mock.calls[0]![1] as AbortSignal;
    h.props.clip = { ...clip, id: "other" };
    expect(signal.aborted).toBe(true);
    response.release({ status: "accepted", revision: "r2" });
    await apply;
    expect(h.instance.trimIn.value).toBe(0);
    expect(h.instance.canApply.value).toBe(false);
    expect(await h.exposed.flush?.()).toBe(true);
  });
  it("primary source lock allows trim but blocks split; clip and overlay protection block both", async () => {
    const h = await precision();
    h.props.asset.state.locked = true;
    h.instance.trimIn.value = 2;
    h.instance.playhead.value = 5;
    await h.instance.split();
    expect(h.props.commit).not.toHaveBeenCalled();
    await h.instance.applyRange();
    expect(h.props.commit).toHaveBeenCalledTimes(1);
    for (const lock of ["clip", "overlay"]) {
      h.props.clip.locked = lock === "clip";
      h.props.sourceEditsLocked = lock === "overlay";
      h.instance.trimIn.value = 3;
      await h.instance.applyRange();
      await h.instance.split();
    }
    expect(h.props.commit).toHaveBeenCalledTimes(1);
    expect(h.props.submit).not.toHaveBeenCalled();
  });
  it.each(["add", "remove", "analyze"] as const)(
    "blocks navigation until the %s request settles",
    async (operation) => {
      const h = await precision();
      const mutation =
        operation === "add"
          ? h.instance.addMarker(3)
          : operation === "remove"
            ? h.instance.removeMarker({
                id: "marker",
                assetId: asset.id,
                time: 3,
                type: "manual",
              })
            : h.instance.analyze("waveform");
      expect(h.exposed.hasPending?.value).toBe(true);
      expect(await h.exposed.flush?.()).toBe(false);
      h.response.release({
        job: {
          id: "new-job",
          assetId: asset.id,
          type: "waveform",
          status: "queued",
        },
      });
      await mutation;
      expect(h.exposed.hasPending?.value).toBe(false);
      expect(await h.exposed.flush?.()).toBe(true);
    },
  );
  it("does not block read-only observation of an analysis owned elsewhere", async () => {
    const h = await precision([
      {
        id: "foreign-job",
        assetId: asset.id,
        type: "transcribe",
        status: "running",
      },
    ]);
    expect(h.exposed.hasPending?.value).toBe(false);
    expect(await h.exposed.flush?.()).toBe(true);
    await h.instance.analyze("waveform");
    expect(
      h.request.mock.calls.filter(([, options]) => options?.method),
    ).toHaveLength(0);
    // Manual markers remain editable while observing that foreign analysis.
    const mutation = h.instance.addMarker(2);
    expect(h.exposed.hasPending?.value).toBe(true);
    h.response.release({});
    await mutation;
    expect(await h.exposed.flush?.()).toBe(true);
  });
  it("retains the outstanding request barrier after source generation changes", async () => {
    const h = await precision();
    const mutation = h.instance.addMarker(4);
    h.props.sourceVersion++;
    await vue.nextTick();
    expect(h.instance.pending.value).toBe(false);
    expect(h.exposed.hasPending?.value).toBe(true);
    expect(await h.exposed.flush?.()).toBe(false);
    h.response.release({});
    await mutation;
    expect(await h.exposed.flush?.()).toBe(true);
  });
  it("releases the barrier after a failed mutation rather than trapping navigation", async () => {
    const h = await precision();
    const mutation = h.instance.addMarker(4);
    expect(h.exposed.hasPending?.value).toBe(true);
    h.response.reject({ code: "operation.failed" });
    await mutation;
    expect(h.exposed.hasPending?.value).toBe(false);
    expect(await h.exposed.flush?.()).toBe(true);
  });
  it("Timeline delegates Precision pending state and guards mode and source selection", async () => {
    const child = await precision();
    const h = timeline(child.exposed);
    h.instance.editMode.value = "precision";
    h.instance.selectedClipId.value = clip.id;
    const mutation = child.instance.addMarker(3);
    expect(h.exposed.hasPending.value).toBe(true);
    expect(await h.exposed.flush()).toBe(false);
    await h.instance.setEditMode("story");
    expect(h.instance.editMode.value).toBe("precision");
    h.instance.chooseClip({
      ...clip,
      id: "other-clip",
      assetId: "other-asset",
    });
    expect(h.instance.selectedClipId.value).toBe(clip.id);
    child.response.release({});
    await mutation;
    expect(h.exposed.hasPending.value).toBe(false);
    expect(await h.exposed.flush()).toBe(true);
    h.instance.chooseClip({ ...clip, id: "other-clip" });
    expect(h.instance.selectedClipId.value).toBe("other-clip");
    await h.instance.setEditMode("story");
    expect(h.instance.editMode.value).toBe("story");
  });
  it.each(["composition", "transcript"] as const)(
    "preserves failed %s draft barriers and their existing flush order",
    async (failed) => {
      const precisionFlush = vi.fn(async () => true);
      const h = timeline({ hasPending: vue.ref(false), flush: precisionFlush });
      if (failed === "composition") h.compositionFails();
      else h.transcriptFails();
      expect(await h.exposed.flush()).toBe(false);
      expect(h.calls).toEqual(
        failed === "composition"
          ? ["composition"]
          : ["composition", "transcript"],
      );
      expect(precisionFlush).not.toHaveBeenCalled();
    },
  );
  it.each(["add", "remove", "analyze"] as const)(
    "blocks Undo/Redo buttons, direct history and shortcuts while %s is pending",
    async (operation) => {
      const child = await precision();
      const h = timeline(child.exposed);
      h.instance.editMode.value = "precision";
      h.instance.selectedClipId.value = clip.id;
      // Existing history is available, so the test cannot pass merely because
      // this fixture happens to have nothing to Undo or Redo.
      h.state.value.canUndo = true;
      const mutation = mutate(child, operation);
      for (const direction of ["undo", "redo"] as const) {
        expect.soft(historyButtonDisabled(h, direction)).toBe(true);
        expect.soft(await h.instance.history(direction)).toBe(false);
        expect(shortcut(h, direction)).toHaveBeenCalledOnce();
      }
      expect.soft(h.compositionHistory).not.toHaveBeenCalled();
      expect(h.compositionFlush).not.toHaveBeenCalled();
      expect(h.instance.selectedClipId.value).toBe(clip.id);
      child.response.release({
        job: {
          id: "new-job",
          assetId: asset.id,
          type: "waveform",
          status: "queued",
        },
      });
      await mutation;
      expect(historyButtonDisabled(h, "undo")).toBe(false);
      expect(await h.instance.history("undo")).toBe(true);
      expect(h.compositionHistory).toHaveBeenCalledExactlyOnceWith("undo");
    },
  );
  it("a Precision submission alone never enables composition Undo without history", async () => {
    const child = await precision();
    const h = timeline(child.exposed);
    expect(historyButtonDisabled(h, "undo")).toBe(true);
    const mutation = child.instance.addMarker(3);
    expect(h.exposed.hasPending.value).toBe(true);
    expect(historyButtonDisabled(h, "undo")).toBe(true);
    child.response.release({});
    await mutation;
  });
  it.each(["button", "shortcut"] as const)(
    "preserves one-step Undo delegation for an unsaved composition via %s",
    async (action) => {
      const h = timeline({
        hasPending: vue.ref(false),
        flush: vi.fn(async () => true),
      });
      h.compositionPending.value = true;
      expect(h.state.value.canUndo).toBe(false);
      expect(historyButtonDisabled(h, "undo")).toBe(false);
      if (action === "button")
        expect(await h.instance.history("undo")).toBe(true);
      else expect(shortcut(h, "undo")).toHaveBeenCalledOnce();
      expect(h.compositionHistory).toHaveBeenCalledExactlyOnceWith("undo");
      expect(h.compositionFlush).not.toHaveBeenCalled();
    },
  );
  it.each(["add", "remove", "analyze"] as const)(
    "does not start %s when composition history was already dispatched",
    async (operation) => {
      const child = await precision();
      const h = timeline(child.exposed);
      h.state.value.canUndo = true;
      const response = deferred<boolean>();
      h.compositionHistory.mockImplementation(async () => {
        h.historyBusy.value = true;
        try {
          return await response.promise;
        } finally {
          h.historyBusy.value = false;
        }
      });
      cleanup.push(
        vue.watch(
          h.historyBusy,
          (busy: boolean) => {
            child.props.busy = busy;
          },
          { flush: "sync" },
        ),
      );
      const history = h.instance.history("undo");
      expect(child.props.busy).toBe(true);
      const mutation = mutate(child, operation);
      const callsWhileHistoryBusy = child.request.mock.calls.filter(
        ([, options]) => options?.method,
      );
      expect(callsWhileHistoryBusy).toHaveLength(0);
      expect(child.exposed.hasPending?.value).toBe(false);
      await mutation;
      response.release(true);
      expect(await history).toBe(true);
      expect(child.props.busy).toBe(false);
    },
  );
  it.each([
    "analyze('transcribe')",
    "analyze('waveform')",
    "analyze('scenes')",
    "addMarker()",
    "removeMarker(marker)",
  ])("disables the %s control during composition history", async (action) => {
    const child = await precision();
    const bindings = { ...child.instance, busy: false };
    expect(buttonDisabled("PrecisionEditor", action, bindings)).toBe(false);
    bindings.busy = true;
    expect(buttonDisabled("PrecisionEditor", action, bindings)).toBe(true);
  });
});
