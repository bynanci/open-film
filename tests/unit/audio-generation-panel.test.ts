import { expect, it, vi } from "vitest";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";
it("discards a cancelled late generated preview without enabling import", async () => {
  vi.stubGlobal("Document", class {});
  vi.stubGlobal("ShadowRoot", class {});
  let finish!: (value: unknown) => void;
  let signal!: AbortSignal;
  const component = loadComponent(
    "apps/desktop/src/components/AudioGenerationPanel.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": {
        api: {
          audioGenerationProviders: async () => [
            { id: "local-audio-mock", name: "mock", execution: "local" },
          ],
          generateAudio: (
            _id: unknown,
            _input: unknown,
            provided: AbortSignal,
          ) => {
            signal = provided;
            return new Promise((resolve) => {
              finish = resolve;
            });
          },
        },
      },
    },
  );
  const props = vue.reactive({
    projectId: "a",
    compositionId: "film",
    revision: "first",
    disabled: false,
  });
  const mounted = mountComponent(component, props);
  try {
    const nodes = () => flatten(mounted.root);
    await vue.nextTick();
    const text = nodes().find((n) => n.tag === "textarea")!;
    (text.props["onUpdate:modelValue"] as (v: string) => void)("合成旁白");
    const checkbox = nodes().find(
      (n) => n.tag === "input" && n.props.type === "checkbox",
    )!;
    (checkbox.props["onUpdate:modelValue"] as (v: boolean) => void)(true);
    await vue.nextTick();
    const button = nodes().find(
      (n) => n.props["data-testid"] === "audio-generation-generate",
    )!;
    const pending = (button.props.onClick as () => Promise<void>)();
    await vue.nextTick();
    props.projectId = "b";
    await vue.nextTick();
    expect(signal.aborted).toBe(true);
    finish({
      id: "late",
      accepted: true,
      duration: 2,
      promptSha256: "x",
      outputSha256: "y",
      mock: true,
    });
    await pending;
    await vue.nextTick();
    expect(nodes().some((n) => n.tag === "audio")).toBe(false);
  } finally {
    mounted.unmount();
    vi.unstubAllGlobals();
  }
});
