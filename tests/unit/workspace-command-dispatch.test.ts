import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const { ref, watch } = createRequire(resolve("apps/desktop/package.json"))(
  "vue",
);
const source = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
const start = source.indexOf("async function runWorkspaceCommand(");
const flushStart = source.indexOf("async function flushEditor(");
const flushEnd = source.indexOf("\n}", flushStart) + 2;
const importReadyStart = source.indexOf("const importPanelReady =");
const importReadyEnd = source.indexOf("\nconst assets =", importReadyStart);
const focusStart = source.indexOf("async function focusWorkspaceMain(");
const focusEnd = source.indexOf("\n}", focusStart) + 2;
const code = transformSync(
  [
    "let resolveEditorReady: (mounted: boolean) => void;",
    "let editorReadyPromise = new Promise<boolean>((resolve) => (resolveEditorReady = resolve));",
    "function resetEditorReady() { resolveEditorReady(false); editorFlushReady.value = false; editorReadyPromise = new Promise<boolean>((resolve) => (resolveEditorReady = resolve)); }",
    "watch(editorMountRequested, resetEditorReady, { flush: 'sync' });",
    "watch(projectGeneration, resetEditorReady, { flush: 'sync' });",
    source.slice(flushStart, flushEnd),
    source.slice(importReadyStart, importReadyEnd),
    source.slice(focusStart, focusEnd),
    source.slice(start, source.indexOf("\n}", start) + 2),
    "function markEditorReady() { editorFlushReady.value = true; resolveEditorReady(true); resolveEditorReady = () => {}; }",
  ].join("\n"),
  { loader: "ts" },
).code;
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flushMicrotasks() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}
function host(
  tick: () => Promise<unknown> = async () => {},
  importPanelLoad: () => Promise<unknown> = async () => ({}),
) {
  let focused: string | undefined;
  const project = ref({ id: "film" });
  const projectGeneration = ref(1);
  const tab = ref("library");
  const perspective = ref("outline");
  const editorMountRequested = ref(false);
  const editorFlushReady = ref(false);
  const activeComposition = ref({ id: "composition" });
  const timelineEditor = ref(null) as {
    value: {
      openFitReview: () => Promise<void>;
      flush: () => Promise<boolean>;
    } | null;
  };
  const importPanelFocus = vi.fn();
  const workspaceMain = {
    value: {
      querySelector: (selector: string) =>
        selector === '[data-focus-target="import-panel"]'
          ? { focus: importPanelFocus }
          : null,
      focus: vi.fn(),
    },
  };
  const fitReview = vi.fn(async () => {});
  const dependencies = {
    ref,
    workspaceCommands: ref([
      { id: "workspace:edit", disabled: false },
      { id: "import-media", disabled: false },
      { id: "fit-duration", disabled: false },
      { id: "story:graph", disabled: false },
      { id: "new-story", disabled: true },
      { id: "settings", disabled: false },
    ]),
    project,
    projectGeneration,
    activeComposition,
    tab,
    workspaceCommandsOpen: ref(true),
    settingsOpen: ref(false),
    pipelineWorkbenchOpen: ref(false),
    pipelineWorkbenchMode: ref("bar"),
    nextTick: tick,
    editorMountRequested,
    editorFlushReady,
    timelineEditor,
    error: ref(""),
    message: (key: string) => key,
    importOpen: ref(false),
    workspaceMain,
    loadImportPanel: importPanelLoad,
    loadTimelineEditor: async () => ({}),
    watch,
    changeTab: async (next: string) => {
      tab.value = next;
      if (next === "edit") editorMountRequested.value = true;
    },
    changeStoryPerspective: async (next: string) => {
      perspective.value = next;
      return true;
    },
    openStoryCreate: async () => {
      throw new Error("Disabled action must not execute");
    },
    document: {
      getElementById: (id: string) => ({
        focus: () => {
          focused = id;
        },
      }),
    },
  };
  const app = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}} = dependencies; ${code}; return {runWorkspaceCommand, markEditorReady, markImportPanelReady};`,
  )(dependencies) as {
    runWorkspaceCommand: (id: string) => Promise<void>;
    markEditorReady: () => void;
    markImportPanelReady: (owner: string) => void;
  };
  return {
    ...dependencies,
    perspective,
    run: app.runWorkspaceCommand,
    fitReview,
    importPanelFocus,
    workspaceMain,
    markEditorReady: () => {
      editorFlushReady.value = true;
      timelineEditor.value = {
        openFitReview: fitReview,
        flush: vi.fn(async () => true),
      };
      app.markEditorReady();
    },
    markImportPanelReady: (owner: string) => app.markImportPanelReady(owner),
    focused: () => focused,
  };
}
describe("actual App workspace command dispatch", () => {
  it("waits for the first lazy editor mount before opening Fit review", async () => {
    const h = host();
    const opening = h.run("fit-duration");
    await flushMicrotasks();
    expect(h.editorMountRequested.value).toBe(true);
    expect(h.fitReview).not.toHaveBeenCalled();
    h.markEditorReady();
    await opening;
    expect(h.tab.value).toBe("edit");
    expect(h.fitReview).toHaveBeenCalledOnce();
  });
  it("waits for the lazy Import panel before moving focus into it", async () => {
    const gate = deferred();
    const h = host(undefined, () => gate.promise);
    const opening = h.run("import-media");
    await flushMicrotasks();
    expect(h.importOpen.value).toBe(true);
    expect(h.importPanelFocus).not.toHaveBeenCalled();
    gate.resolve();
    await flushMicrotasks();
    h.markImportPanelReady("film");
    await opening;
    expect(h.importPanelFocus).toHaveBeenCalledOnce();
  });
  it("keeps a pending Import focus request with the project that opened it", async () => {
    const gate = deferred();
    const h = host(undefined, () => gate.promise);
    const opening = h.run("import-media");
    await flushMicrotasks();
    expect(h.importPanelFocus).not.toHaveBeenCalled();
    h.projectGeneration.value++;
    gate.resolve();
    await opening;
    expect(h.importPanelFocus).not.toHaveBeenCalled();
  });
  it("does not open Fit review after the project changes during editor mount", async () => {
    const h = host();
    const opening = h.run("fit-duration");
    await flushMicrotasks();
    h.projectGeneration.value++;
    await opening;
    expect(h.fitReview).not.toHaveBeenCalled();
    expect(h.focused()).toBeUndefined();
  });
  it.each(["storyReviewBusy", "storyReviewPending", "editorLoading"])(
    "explains why story actions are unavailable during %s",
    (reviewState) => {
      const catalogStart = source.indexOf(
        "const workspaceCommands = computed<",
      );
      const catalogCode = transformSync(source.slice(catalogStart, start), {
        loader: "ts",
      }).code;
      const { computed } = createRequire(resolve("apps/desktop/package.json"))(
        "vue",
      );
      const dependencies = {
        computed,
        busy: ref(""),
        relinkBusy: ref(false),
        collectBusy: ref(false),
        timelineEditor: ref({ loading: reviewState === "editorLoading" }),
        storyReviewBusy: ref(reviewState === "storyReviewBusy"),
        storyReviewPending: ref(reviewState === "storyReviewPending"),
        activeStory: ref({ id: "story", title: "Story", beats: [] }),
        activeComposition: ref({ id: "composition" }),
        librarySummary: ref({ total: 1 }),
        storyPerspectives: ["outline", "graph", "storyboard"],
        tabs: ["library", "story", "edit", "export", "versions"],
        workspaceIcons: {
          library: "image",
          story: "layers",
          edit: "film",
          export: "download",
          versions: "copy",
        },
        t: (key: string) => key,
      };
      const catalog = new Function(
        "dependencies",
        `const {${Object.keys(dependencies).join(",")}} = dependencies; ${catalogCode}; return workspaceCommands;`,
      )(dependencies).value as {
        id: string;
        disabled?: boolean;
        description?: string;
      }[];
      const storyActions = catalog.filter(
        (item) => item.id.startsWith("story:") || item.id === "new-story",
      );
      expect(storyActions).toHaveLength(4);
      for (const action of storyActions) {
        expect(action.disabled, action.id).toBe(true);
        expect(action.description, action.id).toBe("app.workspaceMode.busy");
      }
    },
  );
  it.each(["new-story", "delete-everything"])(
    "rejects disabled or unlisted action %s without changing the open workspace",
    async (id) => {
      const h = host();
      await h.run(id);
      expect(h.tab.value).toBe("library");
      expect(h.workspaceCommandsOpen.value).toBe(true);
      expect(h.settingsOpen.value).toBe(false);
      expect(h.focused()).toBeUndefined();
    },
  );
  it("uses the shared story navigation and returns focus to its selected perspective", async () => {
    const h = host();
    await h.run("story:graph");
    expect(h.tab.value).toBe("story");
    expect(h.perspective.value).toBe("graph");
    expect(h.focused()).toBe("story-tab-graph");
    expect(h.workspaceCommandsOpen.value).toBe(false);
  });
  it("waits for the lazy editor readiness gate before opening fit review", () => {
    const commandStart = source.indexOf("async function runWorkspaceCommand(");
    const fitStart = source.indexOf('if (id === "fit-duration"', commandStart);
    const fitEnd = source.indexOf("\n  }", fitStart);
    const fitCommand = source.slice(fitStart, fitEnd);
    expect(fitCommand.indexOf('await changeTab("edit")')).toBeLessThan(
      fitCommand.indexOf("await flushEditor()"),
    );
    expect(fitCommand.indexOf("await flushEditor()")).toBeLessThan(
      fitCommand.indexOf("openFitReview()"),
    );
    expect(fitCommand).toContain("if (!(await flushEditor())) return;");
  });
  it.each(["project", "generation"])(
    "cancels before navigation when %s changes while closing the dialog",
    async (change) => {
      const gate = deferred();
      const h = host(() => gate.promise);
      const running = h.run("workspace:edit");
      if (change === "project") h.project.value.id = "another-film";
      else h.projectGeneration.value += 1;
      gate.resolve();
      await running;
      expect(h.tab.value).toBe("library");
      expect(h.focused()).toBeUndefined();
    },
  );
  it("does not move keyboard focus into a reopened session after the perspective finishes", async () => {
    const reached = deferred(),
      gate = deferred();
    let ticks = 0;
    const h = host(async () => {
      if (++ticks === 2) {
        reached.resolve();
        await gate.promise;
      }
    });
    const running = h.run("story:graph");
    await reached.promise;
    h.projectGeneration.value += 1;
    h.perspective.value = "outline";
    gate.resolve();
    await running;
    expect(h.perspective.value).toBe("outline");
    expect(h.focused()).toBeUndefined();
  });
});
