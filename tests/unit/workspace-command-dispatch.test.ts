import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

const { ref } = createRequire(resolve("apps/desktop/package.json"))("vue");
const source = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
const start = source.indexOf("async function runWorkspaceCommand(");
const code = transformSync(
  source.slice(start, source.indexOf("\n}", start) + 2),
  { loader: "ts" },
).code;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function host(tick: () => Promise<unknown> = async () => {}) {
  let focused: string | undefined;
  const project = ref({ id: "film" });
  const projectGeneration = ref(1);
  const tab = ref("library");
  const perspective = ref("outline");
  const dependencies = {
    workspaceCommands: ref([
      { id: "workspace:edit", disabled: false },
      { id: "story:graph", disabled: false },
      { id: "new-story", disabled: true },
      { id: "settings", disabled: false },
    ]),
    project,
    projectGeneration,
    tab,
    workspaceCommandsOpen: ref(true),
    settingsOpen: ref(false),
    pipelineWorkbenchOpen: ref(false),
    pipelineWorkbenchMode: ref("bar"),
    nextTick: tick,
    changeTab: async (next: string) => {
      tab.value = next;
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
  const run = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}} = dependencies; ${code}; return runWorkspaceCommand;`,
  )(dependencies) as (id: string) => Promise<void>;
  return { ...dependencies, perspective, run, focused: () => focused };
}
describe("actual App workspace command dispatch", () => {
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
