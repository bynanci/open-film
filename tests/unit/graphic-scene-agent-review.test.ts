import { afterEach, expect, it, vi } from "vitest";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";

afterEach(() => vi.unstubAllGlobals());

it("releases an in-flight preview when its saved revision becomes stale", async () => {
  class HostDocument {
    activeElement = null;
  }
  vi.stubGlobal("Document", HostDocument);
  vi.stubGlobal("ShadowRoot", class {});
  vi.stubGlobal("document", new HostDocument());
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    removeItem: () => undefined,
    setItem: () => undefined,
  });
  let finishPreview!: (value: unknown) => void;
  const busyChanges: boolean[] = [];
  const api = {
    reviewProvider: vi.fn(async () => ({
      configured: false,
      available: false,
      provider: undefined,
    })),
    previewGraphicSceneAgent: vi.fn(
      () =>
        new Promise((resolve) => {
          finishPreview = resolve;
        }),
    ),
  };
  const component = loadComponent(
    "apps/desktop/src/components/GraphicSceneAgentReview.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": { api, ApiError: class ApiError extends Error {} },
    },
  );
  const props = vue.reactive({
    projectId: "project-one",
    compositionId: "composition-one",
    revision: "a".repeat(64),
    scene: { id: "scene-one", nodes: [] },
    selectedNodeId: "shape-one",
    disabled: false,
    onBusy: (value: boolean) => busyChanges.push(value),
  });
  const mounted = mountComponent(component, props);
  try {
    await vue.nextTick();
    const instruction = flatten(mounted.root).find(
      (node) => node.tag === "textarea",
    );
    const preview = flatten(mounted.root).find(
      (node) => node.props["data-testid"] === "graphic-agent-preview",
    );
    expect(instruction).toBeDefined();
    expect(preview).toBeDefined();
    (instruction!.props["onUpdate:modelValue"] as (value: string) => void)(
      "move right 12",
    );
    await vue.nextTick();
    (preview!.props.onClick as () => Promise<void>)();
    await vue.nextTick();
    expect(api.previewGraphicSceneAgent).toHaveBeenCalledTimes(1);
    expect(busyChanges.at(-1)).toBe(true);

    props.revision = "b".repeat(64);
    await vue.nextTick();
    await vue.nextTick();
    expect(busyChanges.at(-1)).toBe(false);

    finishPreview({
      id: "stale-plan",
      compositionId: props.compositionId,
      baseRevision: "a".repeat(64),
      sceneId: "scene-one",
      nodeIds: ["shape-one"],
      instruction: "move right 12",
      source: "local",
      actions: [],
      conflicts: [],
    });
    await Promise.resolve();
    await vue.nextTick();
    expect(
      flatten(mounted.root).some(
        (node) => node.props["data-testid"] === "graphic-agent-plan",
      ),
    ).toBe(false);
    expect(busyChanges.at(-1)).toBe(false);
  } finally {
    mounted.unmount();
  }
});
