import { expect, it } from "vitest";
import type { AudioQualityReport } from "@openfilm/application";
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

it("shows pinned audio ineligibility while retaining audition and never emits Apply", async () => {
  const measurement = {
    integratedLufs: -23,
    samplePeakDbfs: -15,
    truePeakDbtp: -15,
    loudnessRangeLu: 0,
    duration: 4,
    meterBins: [],
  };
  const report: AudioQualityReport = {
    version: 1,
    id: "measured",
    projectId: "project",
    compositionId: "film",
    baseRevision: "saved",
    clipId: "sound",
    original: measurement,
    stem: measurement,
    candidate: measurement,
    suggestion: {
      role: "music",
      targetLufs: -23,
      gainDb: -6,
      volume: 0.4,
      limited: false,
    },
    issues: ["manual-review", "user-pinned"],
    sources: [{ assetId: "source", sha256: "1".repeat(64) }],
    outputHashes: { original: "2".repeat(64), candidate: "3".repeat(64) },
    canAccept: false,
  };
  const emitted: unknown[] = [];
  const component = loadComponent(
    "apps/desktop/src/components/AudioQualityPanel.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": {
        api: { audioQuality: async () => structuredClone(report) },
        audioQualityMediaUrl: () => "/measured/original",
      },
    },
  );
  const mounted = mountComponent(component, {
    projectId: "project",
    compositionId: "film",
    clipId: "sound",
    revision: "saved",
    disabled: false,
    onApply: (command: unknown) => emitted.push(command),
  });
  try {
    const measure = flatten(mounted.root).find(
      (node) => node.props["data-testid"] === "audio-quality-measure",
    )!;
    await (measure.props.onClick as () => Promise<void>)();
    await vue.nextTick();
    const accept = flatten(mounted.root).find(
      (node) => node.props["data-testid"] === "audio-quality-accept",
    )!;
    expect(accept.props.disabled).toBe(true);
    expect(
      flatten(mounted.root)
        .map((node) => node.text)
        .join(" "),
    ).toContain("editor.audioQuality.issues.user-pinned");
    expect(
      flatten(mounted.root).find((node) => node.tag === "audio")?.props.src,
    ).toBe("/measured/original");
    (accept.props.onClick as () => void)();
    expect(emitted).toEqual([]);
  } finally {
    mounted.unmount();
  }
});
