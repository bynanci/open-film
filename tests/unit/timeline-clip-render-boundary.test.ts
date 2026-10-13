import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import * as solver from "@openfilm/solver";
import {
  ApiError,
  type EditorState,
  type SourceStatus,
} from "../../apps/desktop/src/api";
import { sourcePresentation } from "../../apps/desktop/src/sourcePresentation";
import {
  clipControls,
  shorteningAction,
} from "../../apps/desktop/src/editorPresentation";
import { durationStatus } from "../../apps/desktop/src/duration";
import { createNativeBenchmark } from "../../apps/desktop/src/nativeBenchmark";

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
  vi.stubGlobal("document", { activeElement: null, querySelector: () => null });
  vi.stubGlobal("Document", class {});
  vi.stubGlobal("ShadowRoot", class {});
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
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
  const api = {
    editor: vi.fn(async () => saved),
    edit: vi.fn(async () => saved),
    history: vi.fn(async () => saved),
  };
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
    ApiError,
    sourceUrl: (id: string) => `source:${id}`,
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
    "@openfilm/solver": solver,
    "../api": io,
    "../i18n": i18n,
    "../duration": { durationStatus },
    "../nativeBenchmark": {
      nativeBenchmark: createNativeBenchmark({
        isNative: () => false,
        invoke: benchmarkInvoke,
        requestFrame: benchmarkFrame,
        isVisible: () => true,
      }),
    },
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
      default: { render: () => null },
    },
  };
  dependencies["../composables/useTimelineEditor"] = script(
    resolve("apps/desktop/src/composables/useTimelineEditor.ts"),
    dependencies,
  );
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
    projectSettings: { width: 1920, height: 1080, frameRate: 30 },
    sourceStatuses: statuses,
    jobs: [] as core.Job[],
    analysisRecovery: {},
  });
  let editor!: EditorProxy;
  const wrapper = {
    setup: () => () =>
      vue.h(parent, {
        ...props,
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
    button,
    buttons,
    click,
    reload,
    assertReadOnly,
  };
}

describe("Timeline clip render boundary", () => {
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
