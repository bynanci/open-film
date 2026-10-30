import { afterEach, expect, it, vi } from "vitest";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";
import { readFileSync } from "node:fs";
import * as core from "@openfilm/core";
import * as solver from "@openfilm/solver";
import { transformSync } from "esbuild";
import { pipelineCompositionTarget } from "../../apps/desktop/src/pipeline-workbench-model";
afterEach(() => vi.unstubAllGlobals());
it("saved pin marker is distinct from the source lock and has a keyboard label", async () => {
  const component = loadComponent(
    "apps/desktop/src/components/TimelineClip.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../i18n": { formatDuration: String, formatNumber: String },
      "./Icon.vue": { default: { render: () => null } },
    },
  );
  const mounted = mountComponent(component, {
    clip: {
      id: "clip",
      assetId: "a",
      timelineStart: 0,
      timelineDuration: 2,
      locked: false,
      userOverrides: {
        version: 1,
        isUserPinned: true,
        lockedAttributes: ["timing"],
      },
    },
    selected: true,
  });
  try {
    await vue.nextTick();
    expect(
      flatten(mounted.root).find(
        (n) => n.props["data-testid"] === "user-pin-marker",
      )?.props.title,
    ).toBe("editor.pins.hint");
    expect(
      flatten(mounted.root).find((n) => n.tag === "button")?.props[
        "aria-label"
      ],
    ).toContain("editor.pins.pinned");
  } finally {
    mounted.unmount();
  }
});
it("selected-cut target captures the supplied saved revision without guessing by story", () => {
  expect(
    pipelineCompositionTarget("resolve", {
      compositionId: "second",
      revision: "saved-after-flush",
    }),
  ).toEqual({
    version: 1,
    mode: "resolve",
    compositionId: "second",
    baseRevision: "saved-after-flush",
  });
  expect(() => pipelineCompositionTarget("resolve")).toThrow();
});
it("scene pin controls emit an explicit combined action without changing saved props", async () => {
  const scene = {
    version: 1,
    id: "scene",
    name: "Scene",
    start: 0,
    duration: 2,
    zIndex: 0,
    nodes: [],
    userOverrides: {
      version: 1,
      isUserPinned: true,
      lockedAttributes: ["timing"],
    },
  };
  const onPin = vi.fn();
  const empty = { default: { render: () => null } };
  const component = loadComponent(
    "apps/desktop/src/components/GraphicSceneInspector.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "@openfilm/core": core,
      "./GraphicSceneAgentReview.vue": empty,
      "./PhotoDepthControls.vue": empty,
    },
  );
  const mounted = mountComponent(component, {
    projectId: "project",
    compositionId: "cut",
    revision: "r1",
    scenes: [scene],
    duration: 2,
    frameRate: 30,
    assets: [],
    disabled: false,
    agentDisabled: false,
    snapping: false,
    guides: false,
    onPin,
  });
  try {
    await vue.nextTick();
    const button = flatten(mounted.root).find(
      (n) => n.props["data-testid"] === "scene-user-pin-resolve",
    );
    expect(button).toBeDefined();
    (button!.props.onClick as () => void)();
    expect(onPin).toHaveBeenCalledWith(
      { kind: "graphic-scene", sceneId: "scene" },
      false,
      true,
    );
    expect(scene.userOverrides!.isUserPinned).toBe(true);
  } finally {
    mounted.unmount();
  }
});
function composable(api: Record<string, unknown>) {
  const module = {
    exports: {} as {
      useTimelineEditor: typeof import("../../apps/desktop/src/composables/useTimelineEditor").useTimelineEditor;
    },
  };
  const code = transformSync(
    readFileSync("apps/desktop/src/composables/useTimelineEditor.ts", "utf8"),
    { loader: "ts", format: "cjs" },
  ).code;
  const deps: Record<string, unknown> = {
    vue: { ...vue, onMounted: () => {}, onBeforeUnmount: () => {} },
    "@openfilm/solver": solver,
    "../api": {
      api,
      ApiError: class ApiError extends Error {
        constructor(
          message: string,
          readonly status: number,
        ) {
          super(message);
        }
      },
    },
    "vue-i18n": {
      useI18n: () => ({
        t: (s: string, params?: { owners?: string }) =>
          params?.owners ? `${s}:${params.owners}` : s,
      }),
    },
    "../i18n": { errorDetail: () => "", localizeError: () => "conflict" },
  };
  new Function("require", "module", "exports", code)(
    (name: string) => deps[name],
    module,
    module.exports,
  );
  return module.exports.useTimelineEditor(
    "project",
    "cut",
    () => {},
    () => {},
    () => ({
      version: 1,
      rateNumerator: 30,
      rateDenominator: 1,
      dropFrame: false,
    }),
  );
}
function saved(pinned = false) {
  return {
    revision: "r1",
    canUndo: false,
    canRedo: false,
    assets: [
      {
        id: "a",
        name: "A",
        uri: "file:///a.png",
        mediaType: "image",
        state: {},
        tags: [],
        metadata: {},
      },
    ],
    story: { id: "story", title: "Story", beats: [] },
    composition: {
      id: "cut",
      storyId: "story",
      duration: 2,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: "a",
              timelineStart: 0,
              timelineDuration: 2,
              ...(pinned
                ? {
                    userOverrides: {
                      version: 1,
                      isUserPinned: true,
                      lockedAttributes: ["timing"],
                    },
                  }
                : {}),
            },
          ],
        },
      ],
    },
  };
}
function storage() {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
}
it("saved pin authority appears only after server acknowledgement", async () => {
  storage();
  let acknowledge!: (state: unknown) => void;
  const edit = vi.fn(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  const editor = composable({ editor: async () => saved(), edit });
  await editor.load();
  const pending = editor.commitTransaction({
    type: "user-pin.set",
    target: { kind: "clip", clipId: "clip" },
    pinned: true,
  });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(edit).toHaveBeenCalledTimes(1);
  expect(
    editor.state.value!.composition.tracks[0]!.clips[0]!.userOverrides,
  ).toBeUndefined();
  acknowledge({ ...saved(true), revision: "r2" });
  expect(await pending).toEqual({ status: "accepted", revision: "r2" });
  expect(
    editor.state.value!.composition.tracks[0]!.clips[0]!.userOverrides!
      .isUserPinned,
  ).toBe(true);
});
it("a failed combined action rolls back to the saved pin and selected owner identity", async () => {
  storage();
  const original = saved(true);
  const editor = composable({
    editor: async () => structuredClone(original),
    edit: async () => {
      throw new Error("Save failed");
    },
  });
  await editor.load();
  expect(
    await editor.commitTransaction({
      type: "user-pin.resolve",
      targets: [{ kind: "clip", clipId: "clip" }],
      scope: { kind: "composition" },
      mode: "regenerate",
    }),
  ).toMatchObject({ status: "failed" });
  expect(editor.state.value!.composition).toEqual(original.composition);
  expect(editor.state.value!.revision).toBe("r1");
});

it("conflicts name only locally known pinned owners using translated copy", async () => {
  storage();
  const error = Object.assign(new Error("private diagnostic"), {
    code: "timeline.pinConflict",
    params: {
      pinTargets: JSON.stringify([
        { kind: "clip", clipId: "clip" },
        { kind: "clip", clipId: "unknown-private-id" },
      ]),
    },
  });
  const editor = composable({
    editor: async () => saved(true),
    edit: async () => {
      throw error;
    },
  });
  await editor.load();
  await editor.commitTransaction({
    type: "user-pin.resolve",
    targets: [{ kind: "clip", clipId: "clip" }],
    scope: { kind: "composition" },
    mode: "regenerate",
  });
  expect(editor.message.value).toContain("editor.pins.affected:A");
  expect(editor.message.value).not.toContain("unknown-private-id");
  expect(editor.message.value).not.toContain("private diagnostic");
});
