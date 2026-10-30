// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import * as core from "@openfilm/core";
import * as cacheModule from "../../apps/desktop/src/sequenceWaveformCache";
import * as preparationModule from "../../apps/desktop/src/sequenceWaveformPreparation";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host";

const cleanup: Array<() => void> = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop()),
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const asset: core.MediaAsset = {
  id: "pulse",
  name: "Pulse 合成音訊",
  uri: "file:///pulse.mp4",
  mediaType: "video",
  duration: 1,
  contentHash: "pulse-hash",
  tags: [],
  state: { locked: true },
  metadata: { "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] } },
};
function ready(id = "pulse"): core.SourceWaveformEvidence {
  return {
    assetId: id,
    status: "ready",
    sourceHash: "pulse-hash",
    waveform: {
      assetId: id,
      duration: 1,
      sampleRate: 4,
      peaks: [0, 0.75, 0, 0.25],
      provenance: {
        providerId: "local-ffmpeg",
        version: "1",
        sourceHash: "pulse-hash",
        createdAt: "2026-10-30T00:00:00.000Z",
      },
    },
  };
}
function composition(): core.Composition {
  return {
    id: "cut",
    storyId: "story",
    duration: 4,
    tracks: [
      {
        id: "picture",
        type: "video",
        clips: [
          {
            id: "first",
            assetId: "pulse",
            timelineStart: 0.5,
            timelineDuration: 1,
            sourceIn: 0,
            sourceOut: 1,
            locked: true,
            transform: { volume: 0 },
          },
          {
            id: "repeat",
            assetId: "pulse",
            timelineStart: 2,
            timelineDuration: 0.5,
            sourceIn: 0.25,
            sourceOut: 1,
            transform: { speed: 2 },
          },
        ],
      },
    ],
  };
}
function mount(overrides: object = {}) {
  const reads: Array<{
    projectId: string;
    ids: string[];
    signal: AbortSignal;
    result: ReturnType<typeof deferred<cacheModule.WaveformReadResult>>;
  }> = [];
  const seek: number[] = [];
  const props = vue.reactive({
    projectId: "film",
    composition: composition(),
    assets: [asset],
    revision: "one",
    timebase: {
      version: 1,
      rateNumerator: 10,
      rateDenominator: 1,
      dropFrame: false,
    },
    frame: 0,
    maxFrame: 39,
    active: true,
    disabled: false,
    sourceVersion: 0,
    onSeek: (frame: number) => seek.push(frame),
    ...overrides,
  });
  const component = loadComponent(
    "apps/desktop/src/components/SequenceWaveform.vue",
    {
      "@openfilm/core": core,
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../sequenceWaveformCache": cacheModule,
      "../sequenceWaveformPreparation": preparationModule,
      "../api": {
        api: {
          sourceWaveforms: (
            projectId: string,
            ids: string[],
            signal: AbortSignal,
          ) => {
            const result = deferred<cacheModule.WaveformReadResult>();
            reads.push({ projectId, ids, signal, result });
            return result.promise;
          },
          jobs: () => {
            throw new Error("No jobs polling without explicit preparation");
          },
        },
      },
    },
  );
  const host = mountComponent(component, props);
  cleanup.push(host.unmount);
  const all = () => flatten(host.root);
  const slider = () =>
    all().find((node) => node.tag === "input" && node.props.type === "range")!;
  const paths = () =>
    all().filter((node) => node.tag === "path" && node.props["data-clip-id"]);
  const button = (key: string) =>
    all().find(
      (node) =>
        node.tag === "button" &&
        node.props["aria-label"] === `cutDesk.waveform.${key}`,
    )!;
  const finish = async (
    index = 0,
    entries = reads[index]!.ids.map((id) => ready(id)),
  ) => {
    reads[index]!.result.resolve({
      projectId: reads[index]!.projectId,
      entries,
    });
    await settle();
  };
  return { props, reads, seek, all, slider, paths, button, finish };
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await vue.nextTick();
}
const input = (node: HostNode, value: string) =>
  (node.props.onInput as (event: unknown) => void)({ target: { value } });
const click = (node: HostNode) => (node.props.onClick as () => void)();

describe("derived Record waveform view", () => {
  it("projects literal raw pulses for locked, muted and repeated clips without changing saved data", async () => {
    const view = mount();
    const before = JSON.stringify(view.props.composition);
    expect(view.reads).toHaveLength(1);
    expect(view.reads[0]!.ids).toEqual(["pulse"]);
    await view.finish();
    expect(view.paths()).toHaveLength(2);
    expect(view.paths()[0]!.props.d).toContain("M112.5,17.75v64.5");
    expect(view.paths()[1]!.props.d).toContain("M300.5,17.75v64.5");
    expect(view.paths()[0]!.props["data-muted"]).toBe(true);
    expect(
      view
        .all()
        .some((node) => node.text.includes("cutDesk.waveform.rawPeaks")),
    ).toBe(true);
    expect(JSON.stringify(view.props.composition)).toBe(before);
  });

  it("exposes the timecode as slider value text without a per-frame live status", async () => {
    const view = mount();
    await view.finish();
    expect(view.slider().props["aria-valuetext"]).toBe("00:00:00:00");
    expect(view.all().filter((node) => node.tag === "output")).toHaveLength(0);
    expect(
      view.all().filter((node) => node.props.role === "status"),
    ).toHaveLength(0);
    view.props.frame = 13;
    await vue.nextTick();
    expect(view.slider().props["aria-valuetext"]).toBe("00:00:01:03");
    expect(view.all().filter((node) => node.tag === "output")).toHaveLength(0);
  });

  it("updates only the Record playhead on frame ticks and routes native slider seeks through its owner", async () => {
    const view = mount();
    await view.finish();
    const paths = view.paths().map((node) => node.props.d);
    for (let frame = 1; frame < 39; frame++) {
      view.props.frame = frame;
      await vue.nextTick();
    }
    expect(view.reads).toHaveLength(1);
    expect(view.paths().map((node) => node.props.d)).toEqual(paths);
    input(view.slider(), "20");
    expect(view.seek).toEqual([20]);
    expect(view.slider().props["aria-valuetext"]).toBe("00:00:03:08");
  });

  it("checks disabled state and context even when a stale native handler is invoked", async () => {
    const view = mount();
    await view.finish();
    const stale = view.slider().props.onInput as (event: unknown) => void;
    view.props.disabled = true;
    await vue.nextTick();
    stale({ target: { value: "20" } });
    expect(view.seek).toEqual([]);
    view.props.disabled = false;
    view.props.revision = "two";
    await vue.nextTick();
    stale({ target: { value: "20" } });
    expect(view.seek).toEqual([]);
    input(view.slider(), "20");
    expect(view.seek).toEqual([20]);
  });

  it("clears old peaks on source generation changes and discards a delayed earlier read", async () => {
    const view = mount();
    view.props.sourceVersion++;
    await vue.nextTick();
    expect(view.reads[0]!.signal.aborted).toBe(true);
    expect(view.reads).toHaveLength(2);
    await view.finish(1, [
      {
        assetId: "pulse",
        status: "source-changed",
        issue: { code: "source.changed" },
      },
    ]);
    await view.finish(0);
    expect(view.paths()).toHaveLength(0);
    expect(
      view
        .all()
        .some((node) => node.props["data-source-status"] === "source-changed"),
    ).toBe(true);
  });

  it("keeps missing cache visibly absent until explicit refresh", async () => {
    const view = mount();
    await view.finish(0, [
      { assetId: "pulse", status: "not-cached", sourceHash: "pulse-hash" },
    ]);
    expect(view.paths()).toHaveLength(0);
    expect(
      view
        .all()
        .some((node) => node.props["data-source-status"] === "not-cached"),
    ).toBe(true);
    click(view.button("refresh"));
    expect(view.reads).toHaveLength(2);
    await view.finish(1);
    expect(view.paths()).toHaveLength(2);
  });

  it("uses bounded rational-frame windows and pages at most eight visible source IDs", async () => {
    const assets = Array.from({ length: 10 }, (_, i) => ({
      ...asset,
      id: `pulse-${i}`,
    }));
    const cut: core.Composition = {
      id: "cut",
      storyId: "story",
      duration: 70,
      tracks: [
        {
          id: "audio",
          type: "audio",
          clips: assets.map((item, i) => ({
            id: `clip-${i}`,
            assetId: item.id,
            timelineStart: i,
            timelineDuration: 1,
          })),
        },
      ],
    };
    const view = mount({ assets, composition: cut, maxFrame: 699 });
    expect(view.reads[0]!.ids).toEqual(
      assets.slice(0, 8).map((item) => item.id),
    );
    await view.finish();
    click(view.button("nextSources"));
    await vue.nextTick();
    expect(view.reads[1]!.ids).toEqual(assets.slice(8).map((item) => item.id));
    await view.finish(1);
    click(view.button("next"));
    await vue.nextTick();
    expect(view.slider().props.min).toBe(300);
    expect(view.slider().props.max).toBe(599);
    click(view.button("fit"));
    await vue.nextTick();
    expect(view.slider().props.min).toBe(0);
    expect(view.slider().props.max).toBe(699);
  });
});
