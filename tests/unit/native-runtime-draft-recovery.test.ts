import { readFileSync } from "node:fs";
import { getEventListeners } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isWorkspaceCommandShortcut } from "../../apps/desktop/src/workspace-commands";
import {
  flatten,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host";

const compiler = createRequire(resolve("apps/desktop/package.json"))(
  "vue/compiler-sfc",
);
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  vi.unstubAllGlobals();
});

function savedProject() {
  return {
    id: "project",
    title: "Synthetic project",
    settings: { width: 160, height: 90, frameRate: 10 },
    mediaLibraries: [],
    stories: [
      {
        id: "story",
        title: "Story",
        beats: [
          {
            id: "beat",
            title: "Beat",
            intent: "Saved intent",
            targetDuration: 4,
            selectedAssetIds: [],
            candidateAssetIds: [],
            script: {
              narration: "Saved narration",
              visualDirection: "Saved direction",
            },
          },
        ],
      },
    ],
    timelines: [],
  };
}
type SavedProject = ReturnType<typeof savedProject>;
type Draft = {
  title: string;
  intent: string;
  targetDuration: number;
  selectedAssetIds: string[];
  narration: string;
  visualDirection: string;
};
interface AppState {
  beatDraft: Draft;
  beatDirty: boolean;
  selectedAssetId: string;
  categoryDraft: string[];
  categoryDirty: boolean;
  scenePlannerOpen: boolean;
  scenePlanner: unknown;
  scenePlanDraftPresent: boolean;
  project: SavedProject | null;
  projectPath: string | null;
  resetProjectView: () => Promise<void>;
}
interface Owner {
  setupState: AppState;
  isUnmounted: boolean;
  props: { nativeDrafts?: Array<Record<string, unknown>> };
}
interface PlannerState {
  title: string;
  brief: string;
  groupBy: string;
  scope: string;
  target: number;
  maximum: number;
  transition: string;
  formChanged: boolean;
  plan:
    | {
        story: {
          beats: Array<{
            id: string;
            title: string;
            intent: string;
            script: { narration: string; visualDirection: string };
          }>;
        };
      }
    | undefined;
  edited: boolean;
  changed: () => void;
  changedScript: () => void;
  preview: () => Promise<void>;
}

async function settle() {
  for (let index = 0; index < 70; index++) {
    await Promise.resolve();
    await vue.nextTick();
  }
}

function compile(
  file: string,
  dependencies: Record<string, unknown>,
  inlineTemplate: boolean,
) {
  const path = resolve(file);
  let text = readFileSync(path, "utf8");
  if (file.endsWith("RuntimeGate.vue"))
    text = text.replace(
      '(await import("@tauri-apps/api/core")).invoke<T>(command, args)',
      "globalThis.__draftRecoveryInvoke(command, args)",
    );
  const descriptor = compiler.parse(text, { filename: path }).descriptor;
  const code = compiler.compileScript(descriptor, {
    id: path,
    inlineTemplate,
  }).content;
  const module = { exports: {} as { default?: Record<string, unknown> } };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(code, {
      loader: "ts",
      format: "cjs",
      define: { "import.meta.env.DEV": "false" },
    }).code,
  )(
    (name: string) =>
      name === "vue" ? vue : (dependencies[name] ?? { render: () => null }),
    module,
    module.exports,
  );
  return module.exports.default!;
}

async function fixture(initialStart?: () => Promise<unknown>) {
  let activeProject: SavedProject | null = savedProject();
  let activePath: string | null = "/synthetic/project.openfilm";
  let failed = false;
  let closeRequest = false;
  let failStart = false;
  let assetRead: (() => Promise<unknown>) | undefined;
  let startRead = initialStart;
  let runtimeState: string | undefined;
  const asset = {
    id: "photo",
    name: "Synthetic photo",
    uri: "file:///synthetic/photo.png",
    contentHash: "a".repeat(64),
    mediaType: "image",
    tags: ["Saved category"],
    state: {},
    metadata: {},
  };
  const post = vi.fn(async (_path: string, input: { path: string }) => {
    activeProject = savedProject();
    activePath = input.path;
  });
  const patch = vi.fn(
    async (
      path: string,
      input: {
        beats?: SavedProject["stories"][number]["beats"];
        tags?: string[];
      },
    ) => {
      if (path.startsWith("/stories/") && activeProject && input.beats)
        activeProject.stories[0]!.beats = JSON.parse(
          JSON.stringify(input.beats),
        );
      if (input.tags) asset.tags = [...input.tags];
      return { asset: structuredClone(asset) };
    },
  );
  const api = {
    workspace: async () => ({ systemLocale: "en-US", templates: [] }),
    project: async () => ({
      project: structuredClone(activeProject),
      path: activePath,
    }),
    assets: async (params?: URLSearchParams) =>
      params?.get("ids") === "photo" && assetRead
        ? assetRead()
        : { assets: [structuredClone(asset)], total: 1 },
    jobs: async () => ({ jobs: [] }),
    mediaStatus: async () => ({ assets: [], libraries: [] }),
    projectAvailability: async () => ({ projects: [] }),
    previewScenePlan: vi.fn(async () => ({
      plan: {
        story: {
          beats: [
            {
              id: "generated-beat",
              title: "Generated title",
              intent: "Generated intent",
              script: {
                narration: "Generated narration",
                visualDirection: "Generated direction",
              },
            },
          ],
        },
        composition: { tracks: [], duration: 4 },
        sourceSignature: "old-service-plan",
        sourceAssetIds: ["photo"],
      },
    })),
  };
  const invoke = vi.fn(async (command: string) => {
    if (command === "native_runtime_start" && startRead) return startRead();
    if (command === "native_runtime_start" && failStart)
      return { state: "blocked", code: "runtime.preflight" };
    if (command === "native_runtime_status")
      return {
        state: runtimeState ?? (failed ? "blocked" : "development"),
        ...(failed ? { code: "runtime.serviceExited" } : {}),
        ...(closeRequest ? { closeRequestId: 1 } : {}),
      };
    return { state: "development" };
  });
  vi.stubGlobal("__draftRecoveryInvoke", invoke);
  const browser = new EventTarget();
  Object.assign(browser, { __TAURI_INTERNALS__: { invoke } });
  vi.stubGlobal("window", browser);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  let timer = 0;
  const ticks = new Map<number, () => void>();
  vi.stubGlobal("setInterval", (callback: () => void) => {
    ticks.set(++timer, callback);
    return timer;
  });
  vi.stubGlobal("clearInterval", (id: number) => ticks.delete(id));
  const noop = () => {};
  const i18n = { "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) } };
  const planners: PlannerState[] = [];
  const Planner = compile(
    "apps/desktop/src/components/ScenePlanner.vue",
    {
      ...i18n,
      "../api": { api, ApiError: Error, thumbnailUrl: String },
      "../i18n": {
        formatDuration: String,
        formatNumber: String,
        localizeError: String,
      },
    },
    false,
  );
  Planner.render = function () {
    const state = vue.getCurrentInstance().setupState as PlannerState;
    if (!planners.includes(state)) planners.push(state);
    return vue.h("div");
  };
  const App = compile(
    "apps/desktop/src/App.vue",
    {
      ...i18n,
      "./i18n": {
        initializeLocale: async () => {},
        supportedLocales: [],
        uiLocale: vue.ref("en-US"),
        setUiLocale: noop,
        formatDuration: String,
        formatNumber: String,
        formatDate: String,
        localizeError: String,
        errorDetail: () => "",
      },
      "./duration": { durationStatus: () => "within" },
      "./graphic-scene-agent-receipt": {
        hasGraphicSceneAgentReceipt: () => false,
      },
      "./api": { api, post, patch, thumbnailUrl: String, previewUrl: String },
      "./nativeBenchmark": {
        nativeBenchmark: { afterFrames: () => noop, record: noop },
      },
      "./preferences": {
        preferences: vue.reactive({ workspaceMode: "standard" }),
        getLastWorkspaceForProject: () => undefined,
        setLastWorkspaceForProject: noop,
      },
      "./workspace-commands": { isWorkspaceCommandShortcut },
    },
    false,
  );
  const owners: Owner[] = [];
  App.render = function () {
    const owner = vue.getCurrentInstance() as Owner;
    if (!owners.includes(owner)) owners.push(owner);
    const state = owner.setupState;
    return state.scenePlannerOpen && state.project
      ? vue.h(Planner, {
          ref: (value: unknown) => {
            state.scenePlanner = value;
          },
          title: state.project.title,
          targetDuration: 120,
          maxDuration: 180,
          visibleAssetIds: ["photo"],
          disabled: false,
          prepare: async () => true,
          acceptPlan: noop,
          onDraft: (present: boolean) => {
            state.scenePlanDraftPresent = present;
          },
        })
      : vue.h("div");
  };
  const Gate = compile(
    "apps/desktop/src/components/RuntimeGate.vue",
    {
      ...i18n,
      "../App.vue": App,
      "../api": { configureNativeConnection: noop },
    },
    true,
  );
  const mounted = mountComponent(Gate, {});
  cleanup.push(mounted.unmount);
  await settle();
  function button(key: string) {
    return flatten(mounted.root).find(
      (node) => node.tag === "button" && node.text === key,
    );
  }
  async function click(node: HostNode | undefined) {
    expect(node).toBeDefined();
    await (node!.props.onClick as () => unknown)();
    await settle();
  }
  async function tick() {
    ticks.values().next().value?.();
    await settle();
  }
  return {
    get current() {
      return owners.at(-1)!;
    },
    owners,
    planners,
    api,
    patch,
    post,
    invoke,
    asset,
    browser,
    storage,
    root: mounted.root,
    unmount: mounted.unmount,
    setProject(value: SavedProject | null, path: string | null = activePath) {
      activeProject = value;
      activePath = path;
    },
    setAssetRead(value: () => Promise<unknown>) {
      assetRead = value;
    },
    setStartRead(value: () => Promise<unknown>) {
      startRead = value;
    },
    setRuntimeState(value: string) {
      runtimeState = value;
    },
    async beginRetry() {
      failed = true;
      await tick();
      failed = false;
      return { done: click(button("app.nativeRuntime.retry")) };
    },
    async retry() {
      failed = true;
      await tick();
      failed = false;
      await click(button("app.nativeRuntime.retry"));
    },
    async fail() {
      failed = true;
      await tick();
    },
    async retryFail() {
      failed = true;
      await tick();
      failStart = true;
      await click(button("app.nativeRuntime.retry"));
      failStart = false;
    },
    async reopen() {
      await click(button("app.nativeRuntime.reopenDraftProject"));
    },
    async download() {
      await click(button("app.nativeRuntime.downloadDraft"));
    },
    async discard() {
      await click(button("app.nativeRuntime.discardDraft"));
    },
    async close() {
      closeRequest = true;
      await tick();
    },
    beforeUnload() {
      const event = new Event("beforeunload", { cancelable: true });
      browser.dispatchEvent(event);
      return event;
    },
  };
}

describe("native recovery retains actual App local draft owners", () => {
  it("handles an initial close request while native startup is still pending", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const h = await fixture(() => pending);
    try {
      await h.close();
      expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
        requestId: 1,
        cancel: false,
      });
    } finally {
      finish({ state: "ready", port: 38541, session: "e".repeat(64) });
      await settle();
    }
    expect(h.owners).toHaveLength(0);
  });
  it("never mounts a late ready response after the Gate is disposed", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const h = await fixture(() => pending);
    h.unmount();
    finish({ state: "ready", port: 38541, session: "e".repeat(64) });
    await settle();
    expect(h.owners).toHaveLength(0);
  });
  it("keeps a vetoed pending Retry valid and restores its exact dirty draft on completion", async () => {
    const h = await fixture();
    h.current.setupState.beatDraft.narration = "Still dirty after close veto";
    h.current.setupState.beatDirty = true;
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    h.setStartRead(() => pending);
    const retry = await h.beginRetry();
    await h.close();
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: true,
    });
    finish({ state: "development" });
    await retry.done;
    expect(h.owners).toHaveLength(2);
    expect(h.current.setupState.beatDraft.narration).toBe(
      "Still dirty after close veto",
    );
    expect(h.current.setupState.beatDirty).toBe(true);
    expect(h.beforeUnload().defaultPrevented).toBe(true);
  });
  it("keeps dirty retry drafts protected while a busy-start close request is cancelled", async () => {
    const h = await fixture();
    const owner = h.current;
    owner.setupState.beatDraft.narration = "Keep this pending retry draft";
    owner.setupState.beatDirty = true;
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    h.setStartRead(() => pending);
    const retry = await h.beginRetry();
    try {
      await h.close();
      expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
        requestId: 1,
        cancel: true,
      });
      expect(owner.isUnmounted).toBe(false);
      expect(h.beforeUnload().defaultPrevented).toBe(true);
    } finally {
      finish({ state: "blocked", code: "runtime.preflight" });
      await retry.done;
    }
    expect(owner.setupState.beatDraft.narration).toBe(
      "Keep this pending retry draft",
    );
  });
  it("remounts fresh service state without dropping unflushed beat and exact category drafts", async () => {
    const h = await fixture();
    const first = h.current;
    first.setupState.beatDraft.narration = "Unflushed narration";
    first.setupState.beatDraft.visualDirection = "";
    first.setupState.beatDirty = true;
    first.setupState.selectedAssetId = "photo";
    first.setupState.categoryDraft = [
      "  exact, category; ",
      "duplicate",
      "duplicate",
    ];
    first.setupState.categoryDirty = true;
    expect(h.beforeUnload().defaultPrevented).toBe(true);
    await h.retry();
    expect(first.isUnmounted).toBe(true);
    expect(h.current.setupState.beatDraft.narration).toBe(
      "Unflushed narration",
    );
    expect(h.current.setupState.beatDraft.visualDirection).toBe("");
    expect(h.current.setupState.beatDirty).toBe(true);
    expect(h.current.setupState.categoryDraft).toEqual([
      "  exact, category; ",
      "duplicate",
      "duplicate",
    ]);
    expect(h.current.setupState.categoryDirty).toBe(true);
    expect(h.beforeUnload().defaultPrevented).toBe(true);
    expect(h.post).not.toHaveBeenCalled();
    expect(h.patch).not.toHaveBeenCalled();
  });
  it("keeps empty dirty edits across failed retries and still flushes through normal native close", async () => {
    const h = await fixture();
    h.current.setupState.beatDraft.narration = "";
    h.current.setupState.beatDirty = true;
    await h.retryFail();
    await h.retry();
    expect(h.current.setupState.beatDraft.narration).toBe("");
    expect(h.current.setupState.beatDirty).toBe(true);
    expect(h.patch).not.toHaveBeenCalled();
    await h.close();
    expect(h.patch).toHaveBeenCalledOnce();
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: false,
    });
  });
  it("replaces repeated failed-Retry captures with the latest exact empty values", async () => {
    const h = await fixture();
    const first = h.current;
    first.setupState.beatDraft.narration = "Superseded narration";
    first.setupState.beatDirty = true;
    first.setupState.selectedAssetId = "photo";
    first.setupState.categoryDraft = ["Superseded category"];
    first.setupState.categoryDirty = true;
    await h.retryFail();
    first.setupState.beatDraft.narration = "";
    first.setupState.categoryDraft = [];
    await h.retryFail();
    expect(h.current).toBe(first);
    expect(h.current.props.nativeDrafts).toHaveLength(2);
    expect(JSON.stringify(h.current.props.nativeDrafts)).not.toContain(
      "Superseded",
    );
    await h.retry();
    expect(h.current.setupState.beatDraft.narration).toBe("");
    expect(h.current.setupState.beatDirty).toBe(true);
    expect(h.current.setupState.categoryDraft).toEqual([]);
    expect(h.current.setupState.categoryDirty).toBe(true);
    expect(h.current.props.nativeDrafts).toHaveLength(0);
    expect(h.patch).not.toHaveBeenCalled();
  });
  it.each([
    "foreign-project",
    "same-id-other-path",
    "changed-beat",
    "missing-beat",
    "same-beat-other-story",
    "changed-category",
    "missing-category",
    "changed-media-hash",
    "changed-media-uri",
    "changed-media-type",
  ])("retains %s conflicts without applying or saving them", async (defect) => {
    const h = await fixture();
    h.current.setupState.beatDraft.narration = "Retained narration";
    h.current.setupState.beatDirty = true;
    h.current.setupState.selectedAssetId = "photo";
    h.current.setupState.categoryDraft = ["Retained category"];
    h.current.setupState.categoryDirty = true;
    const next = savedProject();
    let path = "/synthetic/project.openfilm";
    if (defect === "foreign-project") next.id = "other-project";
    if (defect === "same-id-other-path") path = "/other/project.openfilm";
    if (defect === "changed-beat")
      next.stories[0]!.beats[0]!.script.narration = "New saved narration";
    if (defect === "missing-beat") next.stories[0]!.beats = [];
    if (defect === "same-beat-other-story") next.stories[0]!.id = "other-story";
    if (defect === "changed-category") h.asset.tags = ["New saved category"];
    if (defect === "changed-media-hash") h.asset.contentHash = "b".repeat(64);
    if (defect === "changed-media-uri") h.asset.uri = "file:///other/photo.png";
    if (defect === "changed-media-type") h.asset.mediaType = "video";
    if (defect === "missing-category")
      h.setAssetRead(async () => ({ assets: [], total: 0 }));
    h.setProject(next, path);
    await h.retry();
    if (defect.includes("category") || defect.includes("media"))
      expect(h.current.setupState.categoryDirty).toBe(false);
    else expect(h.current.setupState.beatDirty).toBe(false);
    const retained = JSON.stringify(h.current.props.nativeDrafts);
    expect(retained).toContain(
      defect.includes("category") || defect.includes("media")
        ? "Retained category"
        : "Retained narration",
    );
    expect(h.beforeUnload().defaultPrevented).toBe(true);
    expect(h.post).not.toHaveBeenCalled();
    expect(h.patch).not.toHaveBeenCalled();
    await h.close();
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: true,
    });
    expect(h.patch).not.toHaveBeenCalled();
  });
  it("downloads a complete retained conflict before an explicit discard permits close", async () => {
    const h = await fixture();
    h.current.setupState.beatDraft.narration = "  Export exact unsaved text;  ";
    h.current.setupState.beatDirty = true;
    const other = savedProject();
    other.id = "other-project";
    h.setProject(other, "/other/project.openfilm");
    await h.retry();
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:local-draft");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    cleanup.push(() => {
      create.mockRestore();
      revoke.mockRestore();
    });
    const click = vi.fn();
    const anchor = { href: "", download: "", click };
    vi.stubGlobal("document", { createElement: () => anchor });
    await h.download();
    expect(click).toHaveBeenCalledOnce();
    expect(anchor.download).toBe("openfilm-local-draft.json");
    const blob = create.mock.calls[0]![0] as Blob;
    const downloaded = JSON.parse(await blob.text());
    expect(downloaded).toMatchObject({
      projectId: "project",
      projectPath: "/synthetic/project.openfilm",
      storyId: "story",
      entityId: "beat",
      kind: "beat",
      value: { narration: "  Export exact unsaved text;  " },
    });
    expect(h.current.props.nativeDrafts).toHaveLength(1);
    expect(h.beforeUnload().defaultPrevented).toBe(true);
    await h.discard();
    expect(h.current.props.nativeDrafts).toHaveLength(0);
    expect(h.beforeUnload().defaultPrevented).toBe(false);
    await h.close();
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: false,
    });
    expect(h.patch).not.toHaveBeenCalled();
  });
  it("starts an empty replacement service and restores only after explicitly reopening the original project", async () => {
    const h = await fixture();
    h.current.setupState.beatDraft.narration = "Recover after reopen";
    h.current.setupState.beatDirty = true;
    h.setProject(null, null);
    await h.retry();
    expect(h.current.setupState.project).toBeNull();
    expect(h.owners).toHaveLength(2);
    expect(JSON.stringify(h.current.props.nativeDrafts)).toContain(
      "Recover after reopen",
    );
    expect(h.post).not.toHaveBeenCalled();
    await h.reopen();
    expect(h.current.setupState.beatDraft.narration).toBe(
      "Recover after reopen",
    );
    expect(h.current.setupState.beatDirty).toBe(true);
    expect(h.post).toHaveBeenCalledWith("/project/open", {
      path: "/synthetic/project.openfilm",
    });
    expect(h.patch).not.toHaveBeenCalled();
  });
  it("does not publish an old category read into a project selected while recovery awaited it", async () => {
    const h = await fixture();
    h.current.setupState.selectedAssetId = "photo";
    h.current.setupState.categoryDraft = ["Original-only category"];
    h.current.setupState.categoryDirty = true;
    let accept!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      accept = resolve;
    });
    h.setAssetRead(() => pending);
    await h.retry();
    const foreign = savedProject();
    foreign.id = "new-project";
    h.current.setupState.project = foreign;
    h.current.setupState.projectPath = "/foreign.openfilm";
    accept({ assets: [structuredClone(h.asset)], total: 1 });
    await settle();
    expect(h.current.setupState.categoryDirty).toBe(false);
    expect(h.current.setupState.categoryDraft).not.toContain(
      "Original-only category",
    );
    expect(JSON.stringify(h.current.props.nativeDrafts)).toContain(
      "Original-only category",
    );
    expect(h.patch).not.toHaveBeenCalled();
  });
  it("consumes an applied copy while owned and fences pending copies after a project refresh", async () => {
    const h = await fixture();
    h.current.setupState.selectedAssetId = "photo";
    h.current.setupState.categoryDraft = ["Keep pending category"];
    h.current.setupState.categoryDirty = true;
    h.setAssetRead(async () => ({ assets: [], total: 0 }));
    await h.retry();
    h.current.setupState.beatDraft.narration = "Keep partial recovery copy";
    h.current.setupState.beatDirty = true;
    let accept!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      accept = resolve;
    });
    h.setAssetRead(() => pending);
    await h.retry();
    expect(h.current.setupState.beatDraft.narration).toBe(
      "Keep partial recovery copy",
    );
    expect(h.current.props.nativeDrafts?.map((entry) => entry.kind)).toEqual([
      "category",
    ]);
    h.current.setupState.project = savedProject();
    await settle();
    accept({ assets: [structuredClone(h.asset)], total: 1 });
    await settle();
    const retained = JSON.stringify(h.current.props.nativeDrafts ?? []);
    expect(retained).not.toContain("Keep partial recovery copy");
    expect(retained).toContain("Keep pending category");
    expect(h.current.setupState.categoryDirty).toBe(false);
    expect(h.patch).not.toHaveBeenCalled();
  });
  it("does not restore or autosave a retained draft discarded while its recovery read awaits", async () => {
    const h = await fixture();
    h.current.setupState.selectedAssetId = "photo";
    h.current.setupState.categoryDraft = ["Explicitly discarded category"];
    h.current.setupState.categoryDirty = true;
    let accept!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      accept = resolve;
    });
    h.setAssetRead(() => pending);
    await h.retry();
    expect(h.current.props.nativeDrafts).toHaveLength(1);
    await h.discard();
    expect(h.current.props.nativeDrafts).toHaveLength(0);
    accept({ assets: [structuredClone(h.asset)], total: 1 });
    await settle();
    expect(h.current.setupState.categoryDirty).toBe(false);
    expect(h.current.setupState.categoryDraft).not.toContain(
      "Explicitly discarded category",
    );
    await h.close();
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: false,
    });
  });
  it("lists only pending copies during mixed recovery so Discard cannot contradict an applied draft", async () => {
    const h = await fixture();
    h.current.setupState.selectedAssetId = "photo";
    h.current.setupState.categoryDraft = ["Discard pending category only"];
    h.current.setupState.categoryDirty = true;
    h.setAssetRead(async () => ({ assets: [], total: 0 }));
    await h.retry();
    h.current.setupState.beatDraft.narration = "Keep applied beat";
    h.current.setupState.beatDirty = true;
    let accept!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      accept = resolve;
    });
    h.setAssetRead(() => pending);
    await h.retry();
    expect(h.current.setupState.beatDraft.narration).toBe("Keep applied beat");
    expect(h.current.props.nativeDrafts?.map((entry) => entry.kind)).toEqual([
      "category",
    ]);
    await h.discard();
    expect(h.beforeUnload().defaultPrevented).toBe(true);
    accept({ assets: [structuredClone(h.asset)], total: 1 });
    await settle();
    expect(h.current.setupState.categoryDirty).toBe(false);
    expect(h.current.setupState.categoryDraft).not.toContain(
      "Discard pending category only",
    );
    await h.close();
    expect(h.patch).toHaveBeenCalledOnce();
    expect(h.patch.mock.calls[0]![0]).toBe("/stories/story");
    expect(
      h.current.setupState.project!.stories[0]!.beats[0]!.script.narration,
    ).toBe("Keep applied beat");
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: false,
    });
  });
  it("protects live drafts during a pending recovery read and dead-service close", async () => {
    const h = await fixture();
    h.current.setupState.selectedAssetId = "photo";
    h.current.setupState.categoryDraft = ["Pending category"];
    h.current.setupState.categoryDirty = true;
    let accept!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      accept = resolve;
    });
    h.setAssetRead(() => pending);
    await h.retry();
    h.current.setupState.beatDraft.narration = "Live draft during recovery";
    h.current.setupState.beatDirty = true;
    await h.discard();
    expect(h.beforeUnload().defaultPrevented).toBe(true);
    await h.fail();
    await h.close();
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: true,
    });
    expect(h.patch).not.toHaveBeenCalled();
    accept({ assets: [structuredClone(h.asset)], total: 1 });
    await settle();
    expect(h.current.setupState.beatDraft.narration).toBe(
      "Live draft during recovery",
    );
    expect(h.beforeUnload().defaultPrevented).toBe(true);
  });
  it("retains planner inputs and exports only authored proposal edits, never an old generated plan", async () => {
    const h = await fixture();
    h.current.setupState.scenePlannerOpen = true;
    await settle();
    const planner = h.planners.at(-1)!;
    planner.title = "Draft film";
    planner.brief = "Authored local brief";
    planner.groupBy = "chronology";
    planner.scope = "page";
    planner.target = 42;
    planner.maximum = 84;
    planner.transition = "crossfade";
    planner.changed();
    await planner.preview();
    planner.plan!.story.beats[0]!.script.narration = "Authored proposal edit";
    planner.changedScript();
    await h.retry();
    const restored = h.planners.at(-1)!;
    expect(restored.brief).toBe("Authored local brief");
    expect(restored.title).toBe("Draft film");
    expect(restored.target).toBe(42);
    expect(restored.maximum).toBe(84);
    expect(restored.groupBy).toBe("chronology");
    expect(restored.scope).toBe("page");
    expect(restored.transition).toBe("crossfade");
    expect(restored.plan).toBeUndefined();
    const retained = JSON.stringify(h.current.props.nativeDrafts);
    expect(retained).toContain("Authored proposal edit");
    expect(retained).not.toContain("Generated narration");
    expect(retained).not.toContain("old-service-plan");
    expect(h.api.previewScenePlan).toHaveBeenCalledOnce();
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.post).not.toHaveBeenCalled();
  });
  it("restores the newest live draft first while retaining an older conflicting copy for export", async () => {
    const h = await fixture();
    h.current.setupState.selectedAssetId = "photo";
    h.current.setupState.categoryDraft = ["Older retained category"];
    h.current.setupState.categoryDirty = true;
    let accept!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      accept = resolve;
    });
    h.setAssetRead(() => pending);
    await h.retry();
    h.current.setupState.selectedAssetId = "photo";
    h.current.setupState.categoryDraft = ["Newer live category"];
    h.current.setupState.categoryDirty = true;
    accept({ assets: [structuredClone(h.asset)], total: 1 });
    await settle();
    expect(h.current.setupState.categoryDraft).toEqual(["Newer live category"]);
    h.setAssetRead(async () => ({
      assets: [structuredClone(h.asset)],
      total: 1,
    }));
    await h.retry();
    expect(h.current.setupState.categoryDraft).toEqual(["Newer live category"]);
    expect(JSON.stringify(h.current.props.nativeDrafts ?? [])).toContain(
      "Older retained category",
    );
    expect(h.patch).not.toHaveBeenCalled();
  });
  it("keeps the owner mounted and intact when its draft exceeds the recovery bound", async () => {
    const h = await fixture();
    const first = h.current;
    first.setupState.beatDraft.narration = "x".repeat(1024 * 1024);
    first.setupState.beatDirty = true;
    const starts = h.invoke.mock.calls.filter(
      ([command]) => command === "native_runtime_start",
    ).length;
    await h.retry();
    expect(h.current).toBe(first);
    expect(first.isUnmounted).toBe(false);
    expect(first.setupState.beatDraft.narration).toHaveLength(1024 * 1024);
    expect(
      h.invoke.mock.calls.filter(
        ([command]) => command === "native_runtime_start",
      ),
    ).toHaveLength(starts);
    expect(h.beforeUnload().defaultPrevented).toBe(true);
  });
  it("does not copy provider configuration or unrelated saved fields into retained drafts", async () => {
    const h = await fixture();
    Object.assign(h.current.setupState.project!.stories[0]!.beats[0]!, {
      apiKey: "NEVER-CARRY-API-KEY",
      providerConsent: "NEVER-CARRY-CONSENT",
      generatedPlan: "NEVER-CARRY-PLAN",
    });
    h.current.setupState.beatDraft.narration = "Only authored text";
    h.current.setupState.beatDirty = true;
    h.setProject(null, null);
    await h.retry();
    const retained = JSON.stringify(h.current.props.nativeDrafts ?? []);
    expect(retained).toContain("Only authored text");
    expect(retained).not.toContain("NEVER-CARRY");
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.post).not.toHaveBeenCalled();
  });
  it("does not install old owner close guards after another Retry completes a delayed recovery", async () => {
    const h = await fixture();
    h.current.setupState.selectedAssetId = "photo";
    h.current.setupState.categoryDraft = ["Retry-safe category"];
    h.current.setupState.categoryDirty = true;
    let accept!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      accept = resolve;
    });
    h.setAssetRead(() => pending);
    await h.retry();
    const delayedOwner = h.current;
    await h.retry();
    expect(delayedOwner.isUnmounted).toBe(true);
    accept({ assets: [structuredClone(h.asset)], total: 1 });
    await settle();
    expect(h.current.setupState.categoryDraft).toEqual(["Retry-safe category"]);
    expect(getEventListeners(h.browser, "beforeunload")).toHaveLength(2);
  });
  it("closes a dead clean service without querying its unavailable jobs API", async () => {
    const h = await fixture();
    await h.fail();
    const jobs = vi
      .spyOn(h.api, "jobs")
      .mockRejectedValue(new Error("Service is gone"));
    await h.close();
    expect(jobs).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: false,
    });
  });
  it("keeps local drafts and blocks dead-service close without trying to save them", async () => {
    const h = await fixture();
    h.current.setupState.beatDraft.narration = "Unsaved while disconnected";
    h.current.setupState.beatDirty = true;
    await h.fail();
    h.patch.mockRejectedValue(new Error("Service is gone"));
    await h.close();
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.current.setupState.beatDraft.narration).toBe(
      "Unsaved while disconnected",
    );
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: true,
    });
  });
  it("makes the workspace inert while disconnected", async () => {
    const h = await fixture();
    await h.fail();
    const workspace = flatten(h.root).find(
      (node) => node.props.class === "runtime-workspace",
    );
    expect(workspace?.props.inert).toBe(true);
  });
  it("reconnects with no local drafts without retaining state or blocking close", async () => {
    const h = await fixture();
    await h.retry();
    expect(h.owners).toHaveLength(2);
    expect(h.current.setupState.beatDirty).toBe(false);
    expect(h.current.props.nativeDrafts ?? []).toHaveLength(0);
    expect(h.beforeUnload().defaultPrevented).toBe(false);
    await h.close();
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: false,
    });
  });
});

describe("pending Retry preserves live App close barriers", () => {
  it("vetoes an unknown active owner without flushing against it", async () => {
    const h = await fixture();
    h.setRuntimeState("starting");
    const jobs = vi.spyOn(h.api, "jobs");
    await h.close();
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: true,
    });
    expect(h.patch).not.toHaveBeenCalled();
    expect(jobs).not.toHaveBeenCalled();
  });
  it("keeps the existing live project job close veto during pending Retry", async () => {
    const h = await fixture();
    const owner = h.current;
    h.api.jobs = async () => {
      throw new Error("Transient jobs read failed");
    };
    await h.close();
    expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
      requestId: 1,
      cancel: true,
    });
    h.api.jobs = async () => ({ jobs: [] });
    (owner.setupState as unknown as { jobs: unknown[] }).jobs = [
      { id: "collecting", type: "collect-media", status: "running" },
    ];
    h.invoke.mockClear();
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    h.setStartRead(() => pending);
    const retryButton = flatten(h.root).find(
      (node) =>
        node.tag === "button" && node.text === "app.nativeRuntime.retry",
    );
    expect(retryButton).toBeDefined();
    const retryDone = (retryButton!.props.onClick as () => Promise<void>)();
    await settle();
    try {
      await h.close();
      expect(h.invoke).toHaveBeenCalledWith("native_runtime_close", {
        requestId: 1,
        cancel: true,
      });
    } finally {
      finish({ state: "blocked", code: "runtime.preflight" });
      await retryDone;
    }
  });
});
