import { expect, it } from "vitest";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";
it("aborts and discards a late audio report when the selected saved revision changes", async () => {
  let finish!: (value: unknown) => void;
  let signal!: AbortSignal;
  const component = loadComponent(
    "apps/desktop/src/components/AudioQualityPanel.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": {
        api: {
          audioQuality: (
            _composition: string,
            _clip: string,
            _revision: string,
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
    projectId: "project",
    compositionId: "film",
    clipId: "sound",
    revision: "first",
    disabled: false,
  });
  const mounted = mountComponent(component, props);
  try {
    const measure = flatten(mounted.root).find(
      (node) => node.props["data-testid"] === "audio-quality-measure",
    )!;
    const pending = (measure.props.onClick as () => Promise<void>)();
    await vue.nextTick();
    props.revision = "second";
    await vue.nextTick();
    expect(signal.aborted).toBe(true);
    finish({
      id: "late",
      baseRevision: "first",
      issues: [],
      original: { meterBins: [] },
    });
    await pending;
    await vue.nextTick();
    expect(flatten(mounted.root).some((node) => node.tag === "audio")).toBe(
      false,
    );
  } finally {
    mounted.unmount();
  }
});
