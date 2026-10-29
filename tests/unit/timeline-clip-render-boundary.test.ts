import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import * as solver from "@openfilm/solver";
import * as analysis from "@openfilm/analysis";
import * as sourceMarks from "../../apps/desktop/src/sourceMarks";
import { waveformPath } from "../../apps/desktop/src/waveform";
import {
  ApiError,
  type EditorState,
  type SourceStatus,
  type IntelligenceState,
} from "../../apps/desktop/src/api";
import { sourcePresentation } from "../../apps/desktop/src/sourcePresentation";
import {
  clipControls,
  shorteningAction,
} from "../../apps/desktop/src/editorPresentation";
import { durationStatus } from "../../apps/desktop/src/duration";
import { createNativeBenchmark } from "../../apps/desktop/src/nativeBenchmark";
import { canCreatePhotoDepth } from "../../apps/desktop/src/photo-depth-controls";
import * as clipTransformInteraction from "../../apps/desktop/src/clipTransformInteraction";
import { sameRateDropFrameChoice } from "../../apps/desktop/src/projectTimebase";
import {
  clampFrameStep,
  formatTimecode,
  frameGuideRect,
  mapFramePixelOffsetToViewport,
  nextStableWorkspaceHeight,
  playbackBoundaryAction,
  restartTimeAtClipBoundary,
  roundFrameDimensions,
  ownsSourceShortcut,
  nextShuttleTier,
  shouldSeekHover,
} from "../../apps/desktop/src/monitor";

const desktopRequire = createRequire(resolve("apps/desktop/package.json"));
interface HostNode {
  tag: string;
  tagName: string;
  text: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  style: Record<string, unknown>;
  currentTime: number;
  paused: boolean;
  clientWidth: number;
  clientHeight: number;
  value: unknown;
  selected: boolean;
  options: HostNode[];
  pause: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
  getBoundingClientRect: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  querySelector: () => null;
  getRootNode: () => unknown;
}
interface EditorProxy {
  reload: () => Promise<void>;
  hasPending: boolean;
  navigateToTime: (time: number) => Promise<boolean>;
  navigateToRecordFrame: (frame: number) => Promise<boolean>;
}
interface HostApp {
  mount: (root: HostNode) => EditorProxy;
  unmount: () => void;
}
const vue = desktopRequire("vue") as Record<string, unknown> & {
  createRenderer: (host: object) => {
    createApp: (component: object, props?: object) => HostApp;
  };
  nextTick: () => Promise<void>;
  ref: <T>(value: T) => { value: T };
  reactive: <T extends object>(value: T) => T;
  h: (component: object | string, props?: object) => object;
};
const compiler = desktopRequire("@vue/compiler-sfc") as {
  parse: (source: string, options: object) => { descriptor: unknown };
  compileScript: (descriptor: unknown, options: object) => { content: string };
};

function node(tag: string, text = ""): HostNode {
  return {
    tag,
    tagName: tag.toUpperCase(),
    text,
    props: {},
    children: [],
    parent: null,
    style: {},
    currentTime: 0,
    paused: true,
    clientWidth: 800,
    clientHeight: 450,
    value: "",
    selected: false,
    get options() {
      return this.children
        .flatMap(flatten)
        .filter((item) => item.tag === "option");
    },
    pause: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }),
    querySelector: () => null,
    getRootNode: () => document,
  };
}
function flatten(root: HostNode): HostNode[] {
  return [root, ...root.children.flatMap(flatten)];
}
function text(root: HostNode): string {
  return root.text + root.children.map(text).join("");
}
function hasClass(root: HostNode, name: string): boolean {
  return String(root.props.class ?? "")
    .split(/\s+/)
    .includes(name);
}

// Compile both the production TimelineEditor and its real composable. The clip
// leaf, if present, is always compiled too. Only unrelated workspace components
// and browser/network I/O are supplied by the host; clip rendering is not mocked.
function script(
  path: string,
  dependencies: Record<string, unknown>,
  sfc = false,
): Record<string, unknown> {
  const source = readFileSync(path, "utf8");
  const content = sfc
    ? compiler.compileScript(
        compiler.parse(source, { filename: path }).descriptor,
        {
          id: path,
          inlineTemplate: true,
        },
      ).content
    : source;
  const code = transformSync(content, { loader: "ts", format: "cjs" }).code;
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", code)(
    (name: string): unknown => {
      if (name in dependencies) return dependencies[name];
      if (name.endsWith(".vue"))
        return {
          __esModule: true,
          default: script(resolve(dirname(path), name), dependencies, true)
            .default,
        };
      throw new Error(`Unexpected import: ${name}`);
    },
    module,
    module.exports,
  );
  return module.exports;
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  vi.unstubAllGlobals();
});

function fixture(count = 500): EditorState {
  const assets = Array.from({ length: count }, (_, index) => ({
    id: `asset-${index}`,
    uri: `file:///synthetic-${index}.mp4`,
    name: `Memory ${index}`,
    mediaType: "video" as const,
    duration: 60,
    dimensions: { width: 1920, height: 1080 },
    tags: [],
    state: {},
    metadata: {},
  }));
  return {
    revision: "revision-before",
    acknowledgedRevision: "receipt-before",
    canUndo: true,
    canRedo: true,
    assets,
    story: {
      id: "story",
      title: "Our memories",
      targetDuration: count * 4,
      maxDuration: count * 5,
      beats: Array.from({ length: Math.ceil(count / 50) }, (_, index) => ({
        id: `beat-${index}`,
        title: `Beat ${index}`,
        candidateAssetIds: assets
          .slice(index * 50, (index + 1) * 50)
          .map((asset) => asset.id),
      })),
    },
    composition: {
      id: "composition",
      storyId: "story",
      duration: count * 4,
      tracks: [
        {
          id: "track",
          type: "video",
          clips: assets.map((asset, index) => ({
            id: `instance-${index}`,
            assetId: asset.id,
            beatId: `beat-${Math.floor(index / 50)}`,
            sourceIn: 0,
            sourceOut: 4,
            timelineStart: index * 4,
            timelineDuration: 4,
          })),
        },
      ],
    },
  };
}

async function settle() {
  await vue.nextTick();
  await vue.nextTick();
  await vue.nextTick();
}
async function mountTimeline(
  initial = fixture(),
  statuses: Record<string, SourceStatus> = {},
  expertMode = false,
  realSource = false,
) {
  const storage = new Map<string, string>();
  const local = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  };
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: () => ({ matches: false }),
    innerHeight: 900,
  });
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      activeElement: null,
      hidden: false,
      querySelector: () => null,
      getElementById: () => null,
    }),
  );
  vi.stubGlobal("Document", class {});
  vi.stubGlobal("ShadowRoot", class {});
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  let saved = initial;
  let releaseSource!: (value: unknown) => void;
  const sourceResponse = new Promise<unknown>((resolve) => {
    releaseSource = resolve;
  });
  const sourceData: IntelligenceState = {
    sourceHash: "verified-source-hash",
    transcriptTotal: 0,
    transcriptOffset: 0,
    markers: [
      {
        id: "manual-marker",
        assetId: "asset-0",
        time: 1,
        type: "manual",
        label: "Verified source marker",
      },
    ],
  };
  const api = {
    editor: vi.fn(async () => saved),
    edit: vi.fn(async () => saved),
    history: vi.fn(async () => saved),
    intelligence: vi.fn(async () => sourceData),
    intelligenceProviders: vi.fn(async () => ({
      transcription: { available: true, providerId: "offline-fixture" },
    })),
  };
  const sourceRequest = vi.fn((path: string, options?: RequestInit) =>
    path === "/jobs" && !options?.method
      ? Promise.resolve({ jobs: [] })
      : sourceResponse,
  );
  const clipLabels = vi.fn();
  const locale = vue.ref("en-US");
  const useI18n = () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "editor.clip.select" || key === "editor.clip.selectLocked")
        clipLabels(key, values);
      return `${locale.value}:${key}:${JSON.stringify(values ?? {})}`;
    },
    te: () => true,
  });
  const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(
      locale.value === "en-XA" ? "en-US" : locale.value,
      options,
    ).format(value);
  const formatDuration = (value: number) =>
    `${Math.floor(value / 60)
      .toString()
      .padStart(2, "0")}:${Math.floor(value % 60)
      .toString()
      .padStart(2, "0")}`;
  const io = {
    api,
    request: sourceRequest,
    ApiError,
    sourceUrl: (id: string) => `source:${id}`,
    titlePreviewUrl: (compositionId: string, clipId: string) =>
      `title:${compositionId}:${clipId}`,
    thumbnailUrl: (id: string) => `thumbnail:${id}`,
  };
  const i18n = {
    formatNumber,
    formatDuration,
    formatDate: String,
    errorDetail: String,
    localizeError: String,
  };
  const benchmarkInvoke = vi.fn();
  const benchmarkFrame = vi.fn();
  const dependencies: Record<string, unknown> = {
    vue,
    "vue-i18n": { useI18n },
    "@openfilm/core": core,
    "@openfilm/story": {},
    "@openfilm/solver": solver,
    "@openfilm/analysis": analysis,
    "../sourceMarks": sourceMarks,
    "../waveform": { waveformPath },
    "../api": io,
    "../photo-depth-controls": { canCreatePhotoDepth },
    "../clipTransformInteraction": clipTransformInteraction,
    "../i18n": i18n,
    "../duration": { durationStatus },
    "../nativeBenchmark": {
      nativeBenchmark: createNativeBenchmark({
        isNative: () => false,
        invoke: benchmarkInvoke,
        requestFrame: benchmarkFrame,
        cancelFrame: () => {},
        isVisible: () => true,
        onVisibilityChange: () => () => {},
      }),
    },
    "../graphic-scene-agent-receipt": {
      hasGraphicSceneAgentReceipt: () => false,
    },
    "../monitor": {
      clampFrameStep,
      formatTimecode,
      frameGuideRect,
      mapFramePixelOffsetToViewport,
      nextStableWorkspaceHeight,
      playbackBoundaryAction,
      restartTimeAtClipBoundary,
      roundFrameDimensions,
      ownsSourceShortcut,
      nextShuttleTier,
      shouldSeekHover,
    },
    "../projectTimebase": { sameRateDropFrameChoice },
    "../editorPresentation": { clipControls, shorteningAction },
    "../sourcePresentation": { sourcePresentation },
    "./Icon.vue": {
      __esModule: true,
      default: {
        props: ["name", "size"],
        render(this: { name: string }) {
          return vue.h("span", { "data-icon": this.name });
        },
      },
    },
    "./SourceDetails.vue": {
      __esModule: true,
      default: { render: () => null },
    },
    "./PrecisionEditor.vue": {
      __esModule: true,
      default: {
        setup(_props: unknown, context: { expose: (value: object) => void }) {
          context.expose({ hasPending: false, flush: async () => true });
          return () => null;
        },
      },
    },
    "./TranscriptEditor.vue": {
      __esModule: true,
      default: {
        setup(_props: unknown, context: { expose: (value: object) => void }) {
          context.expose({ hasPending: false, flush: async () => true });
          return () => null;
        },
      },
    },
    "./PhotoPresentationPreview.vue": {
      __esModule: true,
      default: { render: () => null },
    },
    "./PhotoPresentationInspector.vue": {
      __esModule: true,
      default: { render: () => null },
    },
    "./SoundtrackPanel.vue": {
      __esModule: true,
      default: { render: () => null },
    },
  };
  const sourceInstances: Array<{
    props: { active: boolean; busy: boolean };
    exposed: { hasPending: { value: boolean } };
  }> = [];
  if (realSource) {
    const source = script(
      resolve("apps/desktop/src/components/PrecisionEditor.vue"),
      dependencies,
      true,
    ).default as { setup: (props: object, context: object) => unknown };
    dependencies["./PrecisionEditor.vue"] = {
      __esModule: true,
      default: {
        ...source,
        setup(props: object, context: object) {
          sourceInstances.push(
            (
              vue.getCurrentInstance as () => (typeof sourceInstances)[number]
            )(),
          );
          return source.setup(props, context);
        },
      },
    };
  }
  dependencies["../composables/useTimelineEditor"] = script(
    resolve("apps/desktop/src/composables/useTimelineEditor.ts"),
    dependencies,
  );
  dependencies["../composables/useRecordTransport"] = script(
    resolve("apps/desktop/src/composables/useRecordTransport.ts"),
    dependencies,
  );
  const monitor = script(
    resolve("apps/desktop/src/components/RecordMonitor.vue"),
    dependencies,
    true,
  ).default as {
    setup: (props: object, context: object) => unknown;
  };
  const monitorInstances: Array<{
    vnode: { props: Record<string, unknown> };
    exposed: { frame: { value: number }; playing: { value: boolean } };
  }> = [];
  dependencies["./RecordMonitor.vue"] = {
    __esModule: true,
    default: {
      ...monitor,
      setup(props: object, context: object) {
        monitorInstances.push(
          (vue.getCurrentInstance as () => (typeof monitorInstances)[number])(),
        );
        return monitor.setup(props, context);
      },
    },
  };
  const parent = script(
    resolve("apps/desktop/src/components/TimelineEditor.vue"),
    dependencies,
    true,
  ).default as object;
  const renderer = vue.createRenderer({
    createElement: (tag: string) => node(tag),
    createText: (value: string) => node("text", value),
    createComment: (value: string) => node("comment", value),
    setText: (element: HostNode, value: string) => {
      element.text = value;
    },
    setElementText: (element: HostNode, value: string) => {
      element.text = value;
      element.children = [];
    },
    patchProp: (
      element: HostNode,
      key: string,
      _old: unknown,
      value: unknown,
    ) => {
      element.props[key] = value;
      if (key === "value") element.value = value;
    },
    insert: (element: HostNode, parent: HostNode, anchor?: HostNode) => {
      if (element.parent) {
        const at = element.parent.children.indexOf(element);
        if (at >= 0) element.parent.children.splice(at, 1);
      }
      element.parent = parent;
      const at = anchor ? parent.children.indexOf(anchor) : -1;
      if (at >= 0) parent.children.splice(at, 0, element);
      else parent.children.push(element);
    },
    remove: (element: HostNode) => {
      const parent = element.parent;
      if (!parent) return;
      const at = parent.children.indexOf(element);
      if (at >= 0) parent.children.splice(at, 1);
      element.parent = null;
    },
    parentNode: (element: HostNode) => element.parent,
    nextSibling: (element: HostNode) =>
      element.parent?.children[element.parent.children.indexOf(element) + 1] ??
      null,
  });
  const props = vue.reactive({
    projectId: "project",
    compositionId: "composition",
    active: true,
    expertMode,
    shortcutsBlocked: false,
    timebasePending: false,
    timebaseError: "",
    sourceVersion: 7,
    projectSettings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
    } as core.ProjectSettings,
    sourceStatuses: statuses,
    jobs: [] as core.Job[],
    analysisRecovery: {},
  });
  let editor!: EditorProxy;
  const timebaseChange = vi.fn();
  const wrapper = {
    setup: () => () =>
      vue.h(parent, {
        ...props,
        onTimebaseChange: timebaseChange,
        ref: (instance: EditorProxy | null) => {
          if (instance) editor = instance;
        },
      }),
  };
  const root = node("root");
  const app = renderer.createApp(wrapper);
  app.mount(root);
  cleanup.push(() => app.unmount());
  await settle();
  const buttons = () =>
    flatten(root).filter(
      (item) => item.tag === "button" && hasClass(item, "editor-clip"),
    );
  const button = (index: number) =>
    buttons().find((item) => item.props.id === `clip-instance-${index}`)!;
  const click = async (index: number) => {
    (button(index).props.onClick as () => void)();
    await settle();
  };
  const reload = async (next: EditorState) => {
    saved = next;
    await editor.reload();
    await settle();
  };
  const assertReadOnly = () => {
    expect(benchmarkInvoke).not.toHaveBeenCalled();
    expect(benchmarkFrame).not.toHaveBeenCalled();
    expect(api.edit).not.toHaveBeenCalled();
    expect(api.history).not.toHaveBeenCalled();
    expect(local.setItem).not.toHaveBeenCalled();
    expect(local.removeItem).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
    expect(editor.hasPending).toBe(false);
  };
  return {
    root,
    api,
    clipLabels,
    props,
    locale,
    timebaseChange,
    button,
    buttons,
    click,
    reload,
    monitorInstances,
    sourceInstances,
    sourceRequest,
    sourceData,
    releaseSource,
    sourceVerified: () =>
      flatten(root)
        .find(
          (item) =>
            item.tag === "label" && text(item).includes("precision.snap"),
        )
        ?.children.find((item) => item.tag === "input")?.props.disabled ===
      false,
    clickControl: async (key: string) => {
      const control = flatten(root).find(
        (item) =>
          item.tag === "button" &&
          (text(item).includes(key) ||
            String(item.props["aria-label"]).includes(key)),
      );
      expect(control, key).toBeDefined();
      const result = (control!.props.onClick as () => unknown)();
      await settle();
      return { result };
    },
    mode: async (name: string) => {
      const button = flatten(root).find(
        (item) => item.tag === "button" && text(item).includes(name),
      );
      expect(button).toBeDefined();
      await (button!.props.onClick as () => Promise<void>)();
      await settle();
    },
    key: async (key: string, extra: object = {}) => {
      await settle();
      const event = {
        key,
        code: key === " " ? "Space" : key,
        target: { closest: () => null },
        preventDefault: vi.fn(),
        ...extra,
      };
      const listeners = (
        window.addEventListener as ReturnType<typeof vi.fn>
      ).mock.calls.filter(([name]) => name === "keydown");
      for (const [, listener] of listeners) listener(event);
      await settle();
      return event;
    },
    navigateToRecordFrame: (frame: number) =>
      editor.navigateToRecordFrame?.(frame),
    navigateToTime: (time: number) => editor.navigateToTime(time),
    assertReadOnly,
  };
}

describe("Timeline clip render boundary", () => {
  it.each(
    [false, true].flatMap((expert) =>
      ["add", "remove", "analyze"].map((operation) => ({ expert, operation })),
    ),
  )(
    "keeps the real Source active, verified and unaborted during $operation in Expert=$expert",
    async ({ expert, operation }) => {
      const view = await mountTimeline(fixture(2), {}, expert, true);
      await view.mode(expert ? "cutDesk.source" : "precision.precisionMode");
      await vi.waitFor(() => expect(view.sourceVerified()).toBe(true));
      await view.clickControl(
        operation === "analyze" ? "precision.analysis" : "precision.markers",
      );
      expect(
        flatten(view.root).filter((item) =>
          hasClass(item, "precision-marker-line"),
        ),
      ).toHaveLength(1);
      const sourceVideo = () =>
        flatten(view.root)
          .find((item) => hasClass(item, "precision-editor"))!
          .children.flatMap(flatten)
          .find((item) => item.tag === "video");
      const playhead = sourceVideo()!;
      expect(playhead).toBeDefined();
      const action = await view.clickControl(
        operation === "add"
          ? "precision.addMarker"
          : operation === "remove"
            ? "precision.removeMarker"
            : "precision.analyzeWaveform",
      );
      const sent = view.sourceRequest.mock.calls.find(
        ([, options]) =>
          options?.method === (operation === "remove" ? "DELETE" : "POST"),
      );
      expect(sent).toBeDefined();
      const signal = sent![1]!.signal!;
      expect.soft(view.sourceInstances.at(-1)!.props.active).toBe(true);
      expect.soft(signal.aborted).toBe(false);
      expect.soft(view.sourceVerified()).toBe(true);
      expect
        .soft(
          flatten(view.root).filter((item) =>
            hasClass(item, "precision-marker-line"),
          ),
        )
        .toHaveLength(1);
      expect.soft(sourceVideo() === playhead).toBe(true);
      expect(view.api.intelligence).toHaveBeenCalledOnce();
      expect(view.sourceInstances.at(-1)!.exposed.hasPending.value).toBe(true);
      const undo = flatten(view.root).find(
        (item) =>
          item.tag === "button" &&
          String(item.props["aria-label"]).includes("editor.undoLabel"),
      )!;
      expect(undo.props.disabled).toBe(true);
      await (undo.props.onClick as () => Promise<boolean>)();
      await view.key("z", { ctrlKey: true });
      expect(view.api.history).not.toHaveBeenCalled();
      await view.mode(expert ? "cutDesk.record" : "precision.storyMode");
      await view.click(1);
      expect(view.button(0).props["aria-pressed"]).toBe(true);
      const time = playhead.currentTime;
      expect(
        (await view.key("ArrowRight")).preventDefault,
      ).not.toHaveBeenCalled();
      expect(playhead.currentTime).toBe(time);
      view.props.expertMode = false;
      await settle();
      expect.soft(view.sourceInstances.at(-1)!.props.active).toBe(true);
      expect.soft(signal.aborted).toBe(false);
      view.releaseSource({
        job: {
          id: "completed-analysis",
          assetId: "asset-0",
          type: "waveform",
          status: "completed",
        },
      });
      await action.result;
      await settle();
      expect(view.sourceInstances.at(-1)!.exposed.hasPending.value).toBe(false);
      expect(view.sourceVerified()).toBe(true);
      await view.mode("precision.storyMode");
      expect(view.sourceInstances.at(-1)!.props.active).toBe(false);
      expect(signal.aborted).toBe(true);
    },
  );

  it("aborts real Source work only when the editor becomes inactive and fences its late result", async () => {
    const view = await mountTimeline(fixture(2), {}, true, true);
    await view.mode("cutDesk.source");
    await vi.waitFor(() => expect(view.sourceVerified()).toBe(true));
    const action = await view.clickControl("precision.addMarker");
    const sent = view.sourceRequest.mock.calls.find(
      ([, options]) => options?.method === "POST",
    )!;
    expect.soft(sent[1]!.signal!.aborted).toBe(false);
    view.props.active = false;
    await settle();
    expect(view.sourceInstances.at(-1)!.props.active).toBe(false);
    expect(sent[1]!.signal!.aborted).toBe(true);
    expect(view.sourceVerified()).toBe(false);
    const reads = view.api.intelligence.mock.calls.length;
    view.releaseSource({});
    await action.result;
    await settle();
    expect(view.api.intelligence).toHaveBeenCalledTimes(reads);
    expect(view.sourceVerified()).toBe(false);
  });

  it.each(["shortcutsBlocked", "timebasePending"] as const)(
    "blocks Source transport for %s without tearing down verified media",
    async (flag) => {
      const view = await mountTimeline(fixture(2), {}, true, true);
      await view.mode("cutDesk.source");
      await vi.waitFor(() => expect(view.sourceVerified()).toBe(true));
      const player = flatten(view.root)
        .find((item) => hasClass(item, "precision-editor"))!
        .children.flatMap(flatten)
        .find((item) => item.tag === "video")!;
      view.props[flag] = true;
      await settle();
      expect(view.sourceInstances.at(-1)!.props.active).toBe(true);
      expect(view.sourceInstances.at(-1)!.props.busy).toBe(true);
      expect(view.sourceVerified()).toBe(true);
      expect(
        (await view.key("ArrowRight")).preventDefault,
      ).not.toHaveBeenCalled();
      expect(player.currentTime).toBe(0);
      expect(view.api.intelligence).toHaveBeenCalledOnce();
      view.props[flag] = false;
      await settle();
      expect(
        (await view.key("ArrowRight")).preventDefault,
      ).toHaveBeenCalledOnce();
      expect(player.currentTime).toBeGreaterThan(0);
    },
  );

  it.each(["transcript", "general", "inactive", "revision", "project"])(
    "retires Source timebase controls across %s and accepts the current Expert Source control",
    async (change) => {
      const view = await mountTimeline(fixture(2), {}, true);
      view.props.projectSettings = {
        width: 1920,
        height: 1080,
        frameRate: 30000 / 1001,
      };
      await view.mode("cutDesk.source");
      const selector = () =>
        flatten(view.root).find(
          (item) =>
            item.tag === "select" &&
            String(item.props["aria-label"]).includes("cutDesk.timebase"),
        )!;
      const old = selector().props.onChange as (event: object) => void;
      const chooseDf = { target: { value: "df" } };
      old(chooseDf);
      expect(view.timebaseChange).toHaveBeenCalledOnce();
      view.timebaseChange.mockClear();
      if (change === "transcript") await view.mode("transcript.mode");
      else if (change === "general") view.props.expertMode = false;
      else if (change === "inactive") view.props.active = false;
      else if (change === "project")
        view.props.projectId = "replacement-project";
      else
        await view.reload({ ...fixture(2), revision: "replacement-revision" });
      await settle();
      old(chooseDf);
      expect.soft(view.timebaseChange).not.toHaveBeenCalled();
      if (change === "transcript") await view.mode("cutDesk.source");
      if (change === "general") view.props.expertMode = true;
      if (change === "inactive") view.props.active = true;
      await settle();
      view.timebaseChange.mockClear();
      old(chooseDf);
      expect.soft(view.timebaseChange).not.toHaveBeenCalled();
      view.timebaseChange.mockClear();
      (selector().props.onChange as (event: object) => void)(chooseDf);
      expect(view.timebaseChange).toHaveBeenCalledOnce();
    },
  );

  it("preserves General clip navigation and Undo while ordinary autosave is pending", async () => {
    const view = await mountTimeline(fixture(3));
    await view.key("Delete");
    expect(view.button(0)).toBeUndefined();
    expect(view.button(1).props["aria-pressed"]).toBe(true);
    expect(view.api.edit).not.toHaveBeenCalled();
    await view.key("ArrowRight");
    expect(view.button(2).props["aria-pressed"]).toBe(true);
    await view.key("z", { ctrlKey: true });
    await vi.waitFor(() => expect(view.api.history).toHaveBeenCalledOnce());
    expect(view.api.edit).toHaveBeenCalledOnce();
  });
  it("offers only the same-rate DF/NDF alternative and exposes update pending/errors", async () => {
    const view = await mountTimeline(fixture(2), {}, true);
    view.props.projectSettings = {
      width: 1920,
      height: 1080,
      frameRate: 30000 / 1001,
      timebase: {
        version: 1,
        rateNumerator: 30000,
        rateDenominator: 1001,
        dropFrame: false,
      },
    };
    await settle();
    const select = () =>
      flatten(view.root).find(
        (item) =>
          item.tag === "select" &&
          String(item.props["aria-label"]).includes("cutDesk.timebase"),
      )!;
    expect(select()).toBeDefined();
    expect(select().options).toHaveLength(2);
    (select().props.onChange as (event: object) => void)({
      target: { value: "df" },
    });
    expect(view.timebaseChange).toHaveBeenCalledWith({
      version: 1,
      rateNumerator: 30000,
      rateDenominator: 1001,
      dropFrame: true,
    });
    view.props.timebasePending = true;
    view.props.timebaseError = "Original timebase rejection";
    await settle();
    expect(select().props.disabled).toBe(true);
    expect(text(view.root)).toContain("cutDesk.timebaseSaving");
    expect(text(view.root)).toContain("Original timebase rejection");
    view.props.timebasePending = false;
    view.props.projectSettings = { width: 1920, height: 1080, frameRate: 24 };
    await settle();
    expect(select().options).toHaveLength(1);
    expect(select().props.disabled).toBe(true);
  });

  it.each(["timebase", "transport"])(
    "rejects retained %s button callbacks after an owner switch",
    async (control) => {
      const view = await mountTimeline(fixture(2), {}, true);
      view.props.projectSettings = {
        width: 1920,
        height: 1080,
        frameRate: 30000 / 1001,
      };
      await settle();
      const oldTimebase = flatten(view.root).find(
        (item) =>
          item.tag === "select" &&
          String(item.props["aria-label"]).includes("cutDesk.timebase"),
      )!.props.onChange as (event: object) => void;
      const oldNext = flatten(view.root).find(
        (item) =>
          item.tag === "button" &&
          String(item.props["aria-label"]).includes("editor.monitor.nextFrame"),
      )!.props.onClick as () => void;
      await view.reload({ ...fixture(2), revision: "replacement-revision" });
      if (control === "timebase") oldTimebase({ target: { value: "df" } });
      else oldNext();
      await settle();
      expect(view.timebaseChange).not.toHaveBeenCalled();
      expect(view.monitorInstances.at(-1)!.exposed.frame.value).toBe(0);
    },
  );
  it("mounts the real Record only for active Expert Story and keeps General's player", async () => {
    const view = await mountTimeline(fixture(2));
    const records = () =>
      flatten(view.root).filter((item) => hasClass(item, "record-monitor"));
    expect(records()).toHaveLength(0);
    expect(
      flatten(view.root).some((item) => hasClass(item, "editor-source-screen")),
    ).toBe(true);
    view.props.expertMode = true;
    await settle();
    expect(records()).toHaveLength(1);
    expect(
      flatten(view.root).some((item) => hasClass(item, "editor-source-screen")),
    ).toBe(false);
    const bindings = view.monitorInstances.at(-1)!.vnode.props;
    expect(bindings).toMatchObject({
      "project-id": "project",
      revision: "revision-before",
      active: true,
      "source-version": 7,
    });
    expect(bindings.composition).toEqual(fixture(2).composition);
    expect(bindings.assets).toEqual(fixture(2).assets);
    expect(bindings.settings).toBe(view.props.projectSettings);
    expect(bindings["source-statuses"]).toBe(view.props.sourceStatuses);
    await view.mode("cutDesk.source");
    expect(records()).toHaveLength(0);
    await view.mode("cutDesk.record");
    expect(records()).toHaveLength(1);
    view.props.active = false;
    await settle();
    expect(records()).toHaveLength(0);
  });

  it("routes Record frame/edit/bounds commands and makes M a handled no-op", async () => {
    const view = await mountTimeline(fixture(2), {}, true);
    expect(await view.navigateToRecordFrame(30)).toBe(true);
    const frame = () =>
      flatten(view.root).find((item) => hasClass(item, "record-monitor"))
        ?.props["data-frame"];
    await view.key("ArrowRight");
    expect(frame()).toBe(31);
    await view.key("ArrowRight", { shiftKey: true });
    expect(frame()).toBe(61);
    await view.key("ArrowDown");
    expect(frame()).toBe(120);
    await view.key("ArrowUp");
    expect(frame()).toBe(0);
    await view.key("End");
    expect(frame()).toBe(239);
    await view.key("Home");
    expect(frame()).toBe(0);
    expect((await view.key("m")).preventDefault).toHaveBeenCalledOnce();
    expect(view.api.edit).not.toHaveBeenCalled();
  });

  it.each([
    { isComposing: true },
    { defaultPrevented: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { target: { closest: () => ({}) } },
  ])("isolates Record commands before routing: %j", async (extra) => {
    const view = await mountTimeline(fixture(2), {}, true);
    expect(await view.navigateToRecordFrame(30)).toBe(true);
    const event = await view.key("ArrowRight", extra);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(view.monitorInstances.at(-1)!.exposed.frame.value).toBe(30);
    view.props.shortcutsBlocked = true;
    expect(
      (await view.key("ArrowRight")).preventDefault,
    ).not.toHaveBeenCalled();
    expect(view.monitorInstances.at(-1)!.exposed.frame.value).toBe(30);
  });

  it("submits a single atomic split from the current Record frame rather than the event's clip/time", async () => {
    const view = await mountTimeline(fixture(2), {}, true);
    expect(await view.navigateToRecordFrame(150)).toBe(true);
    const callback = view.monitorInstances.at(-1)!.vnode.props.onSplit as (
      value: object,
    ) => Promise<void>;
    const pending = callback({ clipId: "instance-0", sourceTime: 3 });
    await callback({ clipId: "instance-0", sourceTime: 3 });
    await pending;
    expect(view.api.edit).toHaveBeenCalledOnce();
    expect(view.api.edit.mock.calls[0]).toEqual([
      "composition",
      expect.objectContaining({
        baseRevision: "revision-before",
        commands: [{ type: "clip.split", clipId: "instance-1", sourceTime: 1 }],
      }),
      undefined,
    ]);
  });

  it.each([
    ["clip lock", "locked"],
    ["source lock", "locked"],
    ["crossfade", "crossfade"],
    ["bounds", "Split source time"],
  ])(
    "preserves the solver's %s rejection without writing or retargeting",
    async (kind, detail) => {
      const saved = fixture(2);
      const clip = saved.composition.tracks[0]!.clips[0]!;
      if (kind === "clip lock") clip.locked = true;
      if (kind === "source lock") saved.assets[0]!.state.locked = true;
      if (kind === "crossfade")
        clip.transition = { type: "crossfade", duration: 2 };
      const before = JSON.stringify(saved);
      const view = await mountTimeline(saved, {}, true);
      expect(await view.navigateToRecordFrame(kind === "bounds" ? 0 : 30)).toBe(
        true,
      );
      await (
        view.monitorInstances.at(-1)!.vnode.props.onSplit as () => Promise<void>
      )();
      await settle();
      expect(view.api.edit).not.toHaveBeenCalled();
      expect(JSON.stringify(saved)).toBe(before);
      expect(text(view.root)).toContain(detail);
    },
  );

  it("does not split a gap or a revision superseded while flushing", async () => {
    const saved = fixture(2);
    saved.composition.duration = 10;
    saved.composition.tracks[0]!.clips[1]!.timelineStart = 6;
    const view = await mountTimeline(saved, {}, true);
    expect(await view.navigateToRecordFrame(150)).toBe(true);
    await (
      view.monitorInstances.at(-1)!.vnode.props.onSplit as () => Promise<void>
    )();
    expect(view.api.edit).not.toHaveBeenCalled();
    expect(await view.navigateToRecordFrame(30)).toBe(true);
    const pending = (
      view.monitorInstances.at(-1)!.vnode.props.onSplit as () => Promise<void>
    )();
    await view.reload({ ...saved, revision: "superseded-revision" });
    await pending;
    expect(view.api.edit).not.toHaveBeenCalled();
  });

  it("isolates modal and retained conflict state before Record routing", async () => {
    const view = await mountTimeline(fixture(2), {}, true);
    expect(await view.navigateToRecordFrame(30)).toBe(true);
    const modal = vi
      .spyOn(document, "querySelector")
      .mockReturnValue({} as Element);
    expect(
      (await view.key("ArrowRight")).preventDefault,
    ).not.toHaveBeenCalled();
    expect(view.monitorInstances.at(-1)!.exposed.frame.value).toBe(30);
    modal.mockRestore();
    view.api.edit.mockRejectedValueOnce(new ApiError("Revision conflict", 409));
    await (
      view.monitorInstances.at(-1)!.vnode.props.onSplit as () => Promise<void>
    )();
    const frame = view.monitorInstances.at(-1)!.exposed.frame.value;
    expect(
      (await view.key("ArrowRight")).preventDefault,
    ).not.toHaveBeenCalled();
    expect(view.monitorInstances.at(-1)!.exposed.frame.value).toBe(frame);
    expect(
      (await view.key("z", { ctrlKey: true })).preventDefault,
    ).toHaveBeenCalledOnce();
    expect(view.api.history).not.toHaveBeenCalled();
    expect(view.api.edit).toHaveBeenCalledOnce();
  });

  it.each(["projectId", "compositionId", "revision", "inactive", "target"])(
    "fences prior Record callbacks and pending navigation after %s changes",
    async (change) => {
      const view = await mountTimeline(fixture(2), {}, true);
      expect(await view.navigateToRecordFrame(30)).toBe(true);
      const bindings = { ...view.monitorInstances.at(-1)!.vnode.props };
      (bindings.onIssue as (issue: object) => void)({
        code: "record.decode-failed",
        frame: 30,
      });
      await settle();
      expect(text(view.root)).toContain("cutDesk.issues.decode-failed");
      const navigation =
        change === "target" ? undefined : view.navigateToRecordFrame(150);
      if (change === "revision")
        await view.reload({ ...fixture(2), revision: "revision-new" });
      else if (change === "inactive") view.props.active = false;
      else if (change === "target") await view.mode("cutDesk.source");
      else view.props[change as "projectId" | "compositionId"] = "replacement";
      await settle();
      if (navigation) expect(await navigation).toBe(false);
      (bindings.onSelectClip as (id: string) => void)("instance-1");
      (bindings.onIssue as (issue: object) => void)({
        code: "record.decode-failed",
        ownerKey: "old",
        frame: 30,
      });
      await (bindings.onSplit as (value: object) => Promise<void>)({
        clipId: "instance-1",
        sourceTime: 1,
      });
      await settle();
      expect(view.button(1).props["aria-pressed"]).toBe(false);
      expect(text(view.root)).not.toContain("cutDesk.issues.decode-failed");
      expect(view.api.edit).not.toHaveBeenCalled();
    },
  );

  it("keeps nearest-clip navigation for a visual gap without graphics", async () => {
    const state = fixture(2);
    state.composition.duration = 10;
    state.composition.tracks[0]!.clips[1]!.timelineStart = 6;
    const view = await mountTimeline(state);
    expect(await view.navigateToTime(5.5)).toBe(true);
    await settle();
    expect(view.button(1).props["aria-pressed"]).toBe(true);
    expect(view.button(0).props["aria-pressed"]).toBe(false);
    view.assertReadOnly();
  });

  it.each(["projectId", "compositionId"] as const)(
    "rejects navigation from before a %s switch while flushing",
    async (ownerKey) => {
      const view = await mountTimeline(fixture(2));
      const navigation = view.navigateToTime(5);
      view.props[ownerKey] = "another-owner";
      expect(await navigation).toBe(false);
      await settle();
      expect(view.button(0).props["aria-pressed"]).toBe(true);
      expect(view.button(1).props["aria-pressed"]).toBe(false);
      view.assertReadOnly();
    },
  );

  it("previews native text fade against the Fit candidate without changing the selected saved clip", async () => {
    const state = fixture(1);
    state.story.targetDuration = 2;
    const clip = state.composition.tracks[0]!.clips[0]!;
    clip.title = "Our first journey";
    clip.titleStyle = { version: 1, role: "subtitle", fadeOut: 1 };
    const before = JSON.stringify(state);
    const suggestion = solver
      .prepareShorteningPlan(state, state.assets, 2)
      .suggestions.find((item) =>
        item.commands.some((command) => command.type === "trim"),
      )!;
    expect(suggestion).toBeDefined();
    expect(suggestion.afterDuration).toBe(2);
    const view = await mountTimeline(state);
    const overlay = () =>
      flatten(view.root).find((item) =>
        hasClass(item, "editor-title-overlay"),
      )!;
    const opacity = () =>
      (overlay().props.style as { opacity: number }).opacity;
    const seek = async () => {
      const player = flatten(view.root).find((item) => item.tag === "video")!;
      player.currentTime = 1.5;
      (player.props.onTimeupdate as () => void)();
      await settle();
    };
    await seek();
    expect(opacity()).toBe(1);
    const fit = flatten(view.root).find(
      (item) =>
        item.tag === "button" && text(item).includes("editor.fit.title"),
    )!;
    (fit.props.onClick as () => void)();
    await settle();
    const preview = flatten(view.root).find(
      (item) =>
        item.tag === "button" &&
        String(item.props["aria-label"]).includes("editor.fit.previewLabel") &&
        String(item.props["aria-label"]).includes(state.assets[0]!.name),
    )!;
    expect(preview).toBeDefined();
    (preview.props.onClick as () => void)();
    await settle();
    expect(overlay().props.src).toBe("title:composition:instance-0");
    expect(
      text(
        flatten(view.root).find((item) =>
          hasClass(item, "editor-fit-preview"),
        )!,
      ),
    ).toContain('"after":"00:02"');
    expect(
      text(
        flatten(view.root).find((item) =>
          hasClass(item, "editor-fit-preview"),
        )!,
      ),
    ).toContain("editor.fit.clipComparison");
    await seek();
    expect(
      flatten(view.root).some((item) => hasClass(item, "editor-fit-preview")),
    ).toBe(true);
    expect(opacity()).toBe(0.5);
    expect(clip.timelineDuration).toBe(4);
    expect(clip.sourceOut).toBe(4);
    expect(JSON.stringify(state)).toBe(before);
    view.assertReadOnly();
  });

  it("preserves a one-frame-pixel transform in fractional monitor coordinates", async () => {
    const state = fixture(2);
    state.composition.tracks[0]!.clips[0]!.transform = { x: 1 };
    const view = await mountTimeline(state);
    const player = flatten(view.root).find((item) => item.tag === "video");
    expect(player?.props.style).toMatchObject({
      transform: expect.stringMatching(
        /translate3d\(0\.4166666666666667px, 0px, 0\)/,
      ),
    });
  });

  it("routes direct clip-picture keyboard movement through one atomic transaction", async () => {
    const view = await mountTimeline(fixture(2));
    await view.clickControl("editor.picture.toggle");
    const group = flatten(view.root).find(
      (item) =>
        item.props.role === "group" &&
        String(item.props["aria-label"]).includes("editor.picture.group"),
    );
    const move = flatten(view.root).find(
      (item) =>
        item.tag === "button" &&
        String(item.props["aria-label"]).includes("editor.picture.move"),
    );

    expect(group).toBeDefined();
    expect(move?.props["aria-disabled"]).toBe(false);
    (move!.props.onKeydown as (event: KeyboardEvent) => void)({
      key: "ArrowRight",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);
    await settle();

    expect(view.api.edit).toHaveBeenCalledOnce();
    expect((view.api.edit.mock.calls as unknown[][])[0]![1]).toMatchObject({
      baseRevision: "revision-before",
      commands: [
        {
          type: "transform",
          clipId: "instance-0",
          x: 10,
          y: 0,
          scale: 1,
          rotation: 0,
        },
      ],
    });
  });

  it("keeps direct picture manipulation out of locked and Expert Record states", async () => {
    const locked = fixture(2);
    locked.composition.tracks[0]!.clips[0]!.locked = true;
    const general = await mountTimeline(locked);
    const toggle = flatten(general.root).find(
      (item) =>
        item.tag === "button" && text(item).includes("editor.picture.toggle"),
    );
    expect(toggle?.props.disabled).toBe(true);

    const expert = await mountTimeline(fixture(2), {}, true);
    expect(
      flatten(expert.root).some(
        (item) =>
          item.tag === "button" && text(item).includes("editor.picture.toggle"),
      ),
    ).toBe(false);

    const presentation = fixture(2);
    presentation.assets[0]!.mediaType = "image";
    presentation.assets[0]!.uri = "file:///synthetic-0.png";
    presentation.composition.tracks[0]!.clips[0]!.layout = {
      version: 1,
      preset: "contain",
    };
    const presented = await mountTimeline(presentation);
    const presentationToggle = flatten(presented.root).find(
      (item) =>
        item.tag === "button" && text(item).includes("editor.picture.toggle"),
    );
    expect(presentationToggle?.props.disabled).toBe(true);
    expect(presentationToggle?.props.title).toContain(
      "editor.picture.presentationHint",
    );
  });

  it("records actual clip body work and keeps selection read-only", async () => {
    const state = fixture();
    const before = JSON.stringify(state);
    const view = await mountTimeline(state);
    expect(view.buttons()).toHaveLength(500);
    // The real async load and initial selection can each render the parent.
    // Initial work is measured separately from the incremental selection budget.
    expect(view.clipLabels.mock.calls.length).toBeGreaterThanOrEqual(500);
    const identities = view.buttons();
    view.clipLabels.mockClear();
    await view.click(1);
    expect(view.button(0).props["aria-pressed"]).toBe(false);
    expect(view.button(1).props["aria-pressed"]).toBe(true);
    expect(
      view.buttons().filter((item) => item.props["aria-pressed"]),
    ).toHaveLength(1);
    expect(view.buttons()).toEqual(identities);
    expect(view.clipLabels.mock.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(state)).toBe(before);
    expect(view.api.editor).toHaveBeenCalledTimes(1);
    view.assertReadOnly();
  });

  it("only reevaluates the previous and next clip bodies on selection", async () => {
    const view = await mountTimeline();
    const identities = view.buttons();
    view.clipLabels.mockClear();
    await view.click(1);
    expect(view.button(0).props["aria-pressed"]).toBe(false);
    expect(view.button(1).props["aria-pressed"]).toBe(true);
    expect(
      view.buttons().every((item, index) => item === identities[index]),
    ).toBe(true);
    expect(view.clipLabels).toHaveBeenCalledTimes(2);
    view.clipLabels.mockClear();
    await view.click(1);
    expect(view.clipLabels).not.toHaveBeenCalled();
    expect(view.api.editor).toHaveBeenCalledTimes(1);
    view.assertReadOnly();
  });

  it("does not reevaluate clip bodies when clicking the already selected clip", async () => {
    const view = await mountTimeline();
    const selected = view.button(0);
    view.clipLabels.mockClear();
    await view.click(0);
    expect(view.button(0)).toBe(selected);
    expect(selected.props["aria-pressed"]).toBe(true);
    expect(view.clipLabels).not.toHaveBeenCalled();
    expect(view.api.editor).toHaveBeenCalledTimes(1);
    view.assertReadOnly();
  });

  it("does not reevaluate clip bodies for unchanged job and recovery display data", async () => {
    const view = await mountTimeline();
    const identities = view.buttons();
    view.clipLabels.mockClear();
    view.props.jobs = [];
    view.props.analysisRecovery = {};
    await settle();
    expect(
      view.buttons().every((item, index) => item === identities[index]),
    ).toBe(true);
    expect(view.clipLabels.mock.calls.length).toBe(0);
    expect(view.api.editor).toHaveBeenCalledTimes(1);
    view.assertReadOnly();
  });

  it("distinguishes clip instances that share an asset and selects locked offline clips", async () => {
    const state = fixture(3);
    const clips = state.composition.tracks[0]!.clips;
    clips[1] = { ...clips[1]!, assetId: clips[0]!.assetId, locked: true };
    const view = await mountTimeline(state, {
      "asset-0": { assetId: "asset-0", status: "missing" },
      "asset-2": { assetId: "asset-2", status: "inaccessible" },
    });
    expect(view.button(0).props.id).not.toBe(view.button(1).props.id);
    expect(view.button(1).props.draggable).toBe(false);
    expect(view.button(1).props["aria-label"]).toContain(
      "editor.clip.selectLocked",
    );
    expect(text(view.button(1))).toContain("editor.clip.locked");
    expect(text(view.button(0))).toContain("editor.source.missingShort");
    expect(text(view.button(2))).toContain("editor.source.inaccessibleShort");
    await view.click(1);
    expect(view.button(1).props["aria-pressed"]).toBe(true);
    expect(view.button(0).props["aria-pressed"]).toBe(false);
    await view.click(2);
    expect(view.button(2).props["aria-pressed"]).toBe(true);
    view.assertReadOnly();
  });

  it("updates locale, source status, repaired thumbnails and names without writing a command", async () => {
    const state = fixture(3);
    const view = await mountTimeline(state, {
      "asset-1": { assetId: "asset-1", status: "missing" },
    });
    const identities = view.buttons();
    for (const locale of ["zh-TW", "ja-JP", "en-XA"]) {
      view.locale.value = locale;
      await settle();
      expect(view.button(1).props["aria-label"]).toContain(
        `${locale}:editor.clip.select`,
      );
      expect(text(view.button(1))).toContain(
        `${locale}:editor.source.missingShort`,
      );
    }
    view.props.sourceStatuses = {
      "asset-1": { assetId: "asset-1", status: "inaccessible" },
    };
    await settle();
    expect(text(view.button(1))).toContain("editor.source.inaccessibleShort");
    expect(text(view.button(1))).not.toContain("editor.source.missingShort");
    view.props.sourceStatuses = {};
    await settle();
    expect(
      flatten(view.button(1)).some((item) =>
        hasClass(item, "editor-clip-source-status"),
      ),
    ).toBe(false);
    await view.reload({
      ...state,
      assets: state.assets.map((asset, index) =>
        index === 1
          ? {
              ...asset,
              name: "修復した思い出 # &",
              thumbnailUri: "file:///repaired.jpg",
            }
          : asset,
      ),
    });
    expect(view.button(1).props["aria-label"]).toContain("修復した思い出 # &");
    expect(text(view.button(1))).toContain("修復した思い出 # &");
    const image = flatten(view.button(1)).find((item) => item.tag === "img")!;
    expect(image.props).toMatchObject({
      src: "thumbnail:asset-1",
      alt: "",
      loading: "lazy",
      draggable: "false",
    });
    expect(
      view.buttons().every((item, index) => item === identities[index]),
    ).toBe(true);
    view.assertReadOnly();
  });

  it("refreshes duration, speed, crossfade, lock and replaced Undo/Redo snapshots", async () => {
    const state = fixture(3);
    const view = await mountTimeline(state);
    const originalButton = view.button(1);
    const snapshot = (
      duration: number,
      locked: boolean,
      transformed: boolean,
    ): EditorState => ({
      ...state,
      revision: `snapshot-${duration}`,
      composition: {
        ...state.composition,
        tracks: state.composition.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip, index) =>
            index === 1
              ? {
                  ...clip,
                  timelineDuration: duration,
                  locked,
                  transform: transformed ? { speed: 1.5 } : undefined,
                  transition: transformed
                    ? { type: "crossfade", duration: 0.3 }
                    : undefined,
                }
              : clip,
          ),
        })),
      },
    });
    await view.click(1);
    await view.reload(snapshot(8, true, true));
    expect(view.button(1)).toBe(originalButton);
    expect(view.button(1).props.style).toMatchObject({ width: "192px" });
    expect(text(view.button(1))).toContain("00:08");
    expect(text(view.button(1))).toContain("1.5×");
    expect(text(view.button(1))).toContain("editor.clip.fade");
    expect(hasClass(view.button(1), "locked")).toBe(true);
    expect(view.button(1).props.draggable).toBe(false);
    expect(view.button(1).props["aria-pressed"]).toBe(true);
    // The real composable reloads successive immutable acknowledged snapshots,
    // as Undo/Redo do. Presentation must not retain an earlier clip reference.
    await view.reload(snapshot(2, false, false));
    expect(view.button(1).props.style).toMatchObject({ width: "120px" });
    expect(text(view.button(1))).toContain("00:02");
    expect(text(view.button(1))).not.toContain("1.5×");
    expect(text(view.button(1))).not.toContain("editor.clip.fade");
    expect(hasClass(view.button(1), "locked")).toBe(false);
    expect(view.button(1).props.draggable).toBe(true);
    await view.reload(snapshot(20, true, true));
    expect(view.button(1).props.style).toMatchObject({ width: "240px" });
    expect(text(view.button(1))).toContain("00:20");
    expect(view.button(1).props["aria-label"]).toContain(
      "editor.clip.selectLocked",
    );
    expect(view.button(1)).toBe(originalButton);
    view.assertReadOnly();
  });

  it("refreshes audio fallback and user clip title when an asset disappears", async () => {
    const state = fixture(3);
    state.assets[1] = { ...state.assets[1]!, mediaType: "audio" };
    state.composition.tracks[0]!.clips[1]!.title = "User-authored title";
    const view = await mountTimeline(state);
    expect(
      flatten(view.button(1)).some(
        (item) => item.props["data-icon"] === "volume",
      ),
    ).toBe(true);
    await view.reload({
      ...state,
      assets: state.assets.filter((asset) => asset.id !== "asset-1"),
    });
    expect(view.button(1).props["aria-label"]).toContain("User-authored title");
    expect(text(view.button(1))).toContain("User-authored title");
    expect(
      flatten(view.button(1)).some(
        (item) => item.props["data-icon"] === "film",
      ),
    ).toBe(true);
    view.assertReadOnly();
  });
});
