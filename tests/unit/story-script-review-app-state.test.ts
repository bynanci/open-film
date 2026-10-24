import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

const vue = createRequire(resolve("apps/desktop/package.json"))("vue") as {
  ref: <T>(value: T) => { value: T };
  computed: <T>(value: () => T) => { value: T };
};
const source = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
const functions = [
  "run",
  "hydrateBeat",
  "saveBeat",
  "flushPending",
  "scriptReviewAccepted",
  "restoreScriptReviewTarget",
  "changeTab",
  "handleSelectBeat",
];
const code = transformSync(
  functions
    .map((name) => {
      let start = source.indexOf(`function ${name}(`);
      if (source.slice(start - 6, start) === "async ") start -= 6;
      return source.slice(start, source.indexOf("\n}", start) + 2);
    })
    .join("\n"),
  { loader: "ts", format: "esm" },
).code;
afterEach(() => vi.unstubAllGlobals());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(graphBeatSaveTask?: Promise<boolean>) {
  const story = {
    id: "original-story",
    title: "Our story",
    beats: [
      {
        id: "first-beat",
        title: "First scene",
        intent: "Keep this intention",
        targetDuration: 3,
        selectedAssetIds: ["asset"],
        script: {
          narration: "Original words",
          visualDirection: "Keep this direction",
        },
      },
      {
        id: "second-beat",
        title: "Second scene",
        intent: "",
        targetDuration: 2,
        selectedAssetIds: [],
        script: { narration: "Next words", visualDirection: "Next direction" },
      },
    ],
  };
  const other = {
    ...structuredClone(story),
    id: "last-story",
    title: "Another story",
  };
  const original = {
    id: "project",
    stories: [story, other],
    timelines: [
      {
        id: "existing-cut",
        storyId: story.id,
        tracks: [{ clips: [{ id: "locked", locked: true, sourceIn: 1.25 }] }],
      },
    ],
  };
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
  });
  const project = vue.ref(structuredClone(original));
  const activeStoryId = vue.ref(story.id),
    activeBeatIndex = vue.ref(0);
  const activeStory = vue.computed(() =>
    project.value.stories.find(
      (item: typeof story) => item.id === activeStoryId.value,
    ),
  );
  const activeBeat = vue.computed(
    () => activeStory.value?.beats[activeBeatIndex.value],
  );
  const beatDraft = vue.ref({
    title: story.beats[0]!.title,
    intent: story.beats[0]!.intent,
    targetDuration: 3,
    selectedAssetIds: ["asset"],
    narration: "Draft words",
    visualDirection: "Keep this direction",
  });
  const beatDirty = vue.ref(true);
  const tab = vue.ref("story");
  const storyScriptReview = vue.ref<{ flush: () => Promise<boolean> } | null>(
    null,
  );
  let savedStory = structuredClone(story);
  let gate: Promise<void> | undefined;
  const dependencies = {
    graphBeatSaveTask,
    projectGeneration: vue.ref(0),
    project,
    activeStory,
    activeBeat,
    activeStoryId,
    activeBeatIndex,
    beatDraft,
    beatDirty,
    storyScriptReview,
    busy: vue.ref(""),
    error: vue.ref<unknown>(null),
    notice: vue.ref<unknown>(null),
    categoryDirty: vue.ref(false),
    saveCategories: vi.fn(async () => true),
    flushEditor: vi.fn(async () => true),
    candidateOffset: vue.ref(0),
    timelineEditor: vue.ref(null),
    patch: vi.fn(async (_path: string, body: { beats: typeof story.beats }) => {
      savedStory = {
        ...savedStory,
        beats: JSON.parse(JSON.stringify(body.beats)) as typeof story.beats,
      };
      if (gate) await gate;
      return { story: savedStory };
    }),
    refreshProject: vi.fn(async () => {
      project.value = {
        ...project.value,
        stories: project.value.stories.map((item: typeof story) =>
          item.id === story.id ? structuredClone(savedStory) : item,
        ),
      };
    }),
    message: (value: string) => value,
    tab,
    relinkBusy: vue.ref(false),
    window: {},
    editorMountRequested: vue.ref(false),
    activeComposition: vue.ref(null),
    clipCount: vue.ref(1),
    setWorkspace: (workspace: string) => {
      tab.value = workspace;
    },
    nativeBenchmark: { record: vi.fn() },
    checkMediaStatus: vi.fn(async () => {}),
  };
  const app = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}}=dependencies;let projectMutationVersion=0;${code}\nreturn {${functions.join(",")}};`,
  )(dependencies) as {
    flushPending: (preparing?: boolean) => Promise<boolean>;
    saveBeat: () => Promise<boolean>;
    scriptReviewAccepted: (story: (typeof original.stories)[0]) => void;
    restoreScriptReviewTarget: () => void;
    changeTab: (tab: string) => Promise<void>;
    handleSelectBeat: (beatId: string) => Promise<void>;
  };
  return {
    ...dependencies,
    ...app,
    original,
    story,
    storage,
    holdPatch: (promise: Promise<void>) => {
      gate = promise;
    },
  };
}
async function drain() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe("Story review through the actual App draft and navigation functions", () => {
  it("selects the requested beat after an in-flight graph save acknowledges the latest draft", async () => {
    const gate = deferred<boolean>();
    const h = fixture(gate.promise);
    h.busy.value = "savingBeat";
    const selecting = h.handleSelectBeat("second-beat");
    await drain();
    expect(h.activeBeatIndex.value).toBe(0);
    expect(h.patch).not.toHaveBeenCalled();
    h.busy.value = "";
    h.beatDirty.value = false;
    gate.resolve(true);
    await selecting;
    expect(h.activeBeatIndex.value).toBe(1);
    expect(h.beatDraft.value.title).toBe("Second scene");
    expect(h.project.value.timelines).toEqual(h.original.timelines);
  });
  it.each(["failed", "project", "story", "generation"])(
    "does not apply a waiting graph selection after %s changes its owner or save result",
    async (change) => {
      const gate = deferred<boolean>();
      const h = fixture(gate.promise);
      h.busy.value = "savingBeat";
      const selecting = h.handleSelectBeat("second-beat");
      await drain();
      if (change === "project") h.project.value.id = "other-project";
      if (change === "story") h.activeStoryId.value = "last-story";
      if (change === "generation") h.projectGeneration.value += 1;
      h.busy.value = "";
      h.beatDirty.value = false;
      gate.resolve(change !== "failed");
      await selecting;
      expect(h.activeBeatIndex.value).toBe(0);
      expect(h.beatDraft.value.narration).toBe("Draft words");
      expect(h.patch).not.toHaveBeenCalled();
    },
  );
  it("prepares its own saved beat without awaiting its own review operation", async () => {
    const h = fixture();
    const gate = deferred<boolean>();
    const flush = vi.fn(() => gate.promise);
    h.storyScriptReview.value = { flush };
    expect(await h.flushPending(true)).toBe(true);
    expect(flush).not.toHaveBeenCalled();
    expect(h.patch).toHaveBeenCalledOnce();
    expect(h.project.value.stories[0]!.beats[0]!.script.narration).toBe(
      "Draft words",
    );
    expect(h.busy.value).toBe("");
  });
  it("aborts provider preparation and preserves typing made while Save is awaiting acknowledgement", async () => {
    const h = fixture();
    const gate = deferred<void>();
    h.holdPatch(gate.promise);
    const preparing = h.flushPending(true);
    await drain();
    expect(h.busy.value).toBe("savingBeat");
    h.beatDraft.value.narration = "Newer words typed during Save";
    gate.resolve();
    expect(await preparing).toBe(false);
    expect(h.beatDirty.value).toBe(true);
    expect(h.beatDraft.value.narration).toBe("Newer words typed during Save");
    expect(h.project.value.stories[0]!.beats[0]!.script.narration).toBe(
      "Draft words",
    );
    expect(h.project.value.timelines).toEqual(h.original.timelines);
  });
  it("awaits review acceptance before leaving Story and retains the tab on an uncertain result", async () => {
    const h = fixture();
    h.beatDirty.value = false;
    const gate = deferred<boolean>();
    h.storyScriptReview.value = { flush: () => gate.promise };
    const leaving = h.changeTab("library");
    await drain();
    expect(h.tab.value).toBe("story");
    gate.resolve(false);
    await leaving;
    expect(h.tab.value).toBe("story");
    h.storyScriptReview.value = { flush: async () => true };
    await h.changeTab("library");
    expect(h.tab.value).toBe("library");
  });
  it("publishes the actual acknowledged Story while preserving a newer local manual draft and other films", () => {
    const h = fixture();
    const accepted = structuredClone(h.story);
    accepted.beats[0]!.script.narration = "Accepted saved words";
    h.scriptReviewAccepted(accepted);
    expect(h.project.value.stories[0]).toEqual(accepted);
    expect(h.project.value.stories[1]).toEqual(h.original.stories[1]);
    expect(h.project.value.timelines).toEqual(h.original.timelines);
    expect(h.beatDraft.value.narration).toBe("Draft words");
    expect(h.beatDirty.value).toBe(true);
    expect(h.refreshProject).not.toHaveBeenCalled();
  });
  it("restores a lost acceptance to its original non-last Story and beat after reload", () => {
    const h = fixture();
    h.activeStoryId.value = "last-story";
    h.storage.set(
      "openfilm:script-review-accept:project",
      JSON.stringify({
        storyId: "original-story",
        beatId: "second-beat",
        field: "visualDirection",
        suggestionId: "accepted-suggestion",
        receipt: { baseRevision: "before", requestId: "original-request" },
      }),
    );
    h.restoreScriptReviewTarget();
    expect(h.activeStoryId.value).toBe("original-story");
    expect(h.activeBeatIndex.value).toBe(1);
    expect(h.tab.value).toBe("story");
    expect(h.project.value).toEqual(h.original);
  });
});
