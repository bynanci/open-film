import { afterEach, expect, it, vi } from "vitest";
import * as nativeApi from "../../apps/desktop/src/api";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";

afterEach(() => vi.unstubAllGlobals());
const session = "c".repeat(64);
const prefix = `http://127.0.0.1:38538/native/${session}/api`;
it.each(["original", "candidate"] as const)(
  "routes the actual %s audio-quality player through the native session",
  async (variant) => {
    nativeApi.configureNativeConnection(38538, session);
    const component = loadComponent(
      "apps/desktop/src/components/AudioQualityPanel.vue",
      {
        "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
        "../api": {
          ...nativeApi,
          api: {
            audioQuality: async () => ({
              id: "review /?#",
              baseRevision: "saved",
              issues: [],
              original: { meterBins: [] },
              candidate: { meterBins: [] },
            }),
          },
        },
      },
    );
    const mounted = mountComponent(component, {
      projectId: "project /?#",
      compositionId: "film",
      clipId: "sound",
      revision: "saved",
      disabled: false,
    });
    try {
      const nodes = () => flatten(mounted.root);
      await (
        nodes().find(
          (node) => node.props["data-testid"] === "audio-quality-measure",
        )!.props.onClick as () => Promise<void>
      )();
      await vue.nextTick();
      if (variant === "candidate") {
        (
          nodes().find(
            (node) =>
              node.tag === "button" &&
              node.text === "editor.audioQuality.candidate",
          )!.props.onClick as () => void
        )();
        await vue.nextTick();
      }
      expect(nodes().find((node) => node.tag === "audio")!.props.src).toBe(
        `${prefix}/audio-quality/${encodeURIComponent("review /?#")}/${variant}?${new URLSearchParams({ projectId: "project /?#" })}`,
      );
    } finally {
      mounted.unmount();
    }
  },
);
it("routes the actual generated-audio preview through the native session", async () => {
  vi.stubGlobal("Document", class {});
  vi.stubGlobal("ShadowRoot", class {});
  nativeApi.configureNativeConnection(38538, session);
  const component = loadComponent(
    "apps/desktop/src/components/AudioGenerationPanel.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": {
        ...nativeApi,
        api: {
          audioGenerationProviders: async () => [
            { id: "local-audio-mock", name: "mock", execution: "local" },
          ],
          generateAudio: async () => ({
            id: "generated /?#",
            duration: 2,
            mock: true,
            accepted: false,
          }),
        },
      },
    },
  );
  const mounted = mountComponent(component, {
    projectId: "project /?#",
    compositionId: "film",
    revision: "saved",
    disabled: false,
  });
  try {
    await vue.nextTick();
    const nodes = () => flatten(mounted.root);
    (
      nodes().find((node) => node.tag === "textarea")!.props[
        "onUpdate:modelValue"
      ] as (value: string) => void
    )("Authored synthetic narration");
    (
      nodes().find(
        (node) => node.tag === "input" && node.props.type === "checkbox",
      )!.props["onUpdate:modelValue"] as (value: boolean) => void
    )(true);
    await vue.nextTick();
    await (
      nodes().find(
        (node) => node.props["data-testid"] === "audio-generation-generate",
      )!.props.onClick as () => Promise<void>
    )();
    await vue.nextTick();
    expect(nodes().find((node) => node.tag === "audio")!.props.src).toBe(
      `${prefix}/audio-generation/${encodeURIComponent("generated /?#")}/media?${new URLSearchParams({ projectId: "project /?#" })}`,
    );
  } finally {
    mounted.unmount();
  }
});
