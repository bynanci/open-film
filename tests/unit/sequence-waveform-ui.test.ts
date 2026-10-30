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
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
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

  it.each(["ready", "failed"] as const)(
    "keeps the returned page %s and refresh usable after delayed background pages finish",
    async (status) => {
      const assets = Array.from({ length: 40 }, (_, index) => ({
        ...asset,
        id: `source-${index}`,
        uri: `file:///source-${index}.mp4`,
      }));
      const cut: core.Composition = {
        id: "cut",
        storyId: "story",
        duration: 40,
        tracks: [
          {
            id: "audio",
            type: "audio",
            clips: assets.map((item, index) => ({
              id: `clip-${index}`,
              assetId: item.id,
              timelineStart: index,
              timelineDuration: 1,
              locked: true,
            })),
          },
        ],
      };
      const view = mount({ assets, composition: cut, maxFrame: 399 });
      const before = JSON.stringify({
        assets: view.props.assets,
        composition: view.props.composition,
      });
      click(view.button("fit"));
      await vue.nextTick();
      for (let page = 0; page < 4; page++) {
        click(view.button("nextSources"));
        await vue.nextTick();
      }
      for (let page = 0; page < 4; page++) {
        click(view.button("previousSources"));
        await vue.nextTick();
      }
      expect(view.reads).toHaveLength(2);
      expect(view.button("refresh").props.disabled).toBe(true);
      for (let index = 0; index < 5; index++) {
        expect(view.reads.length - index).toBeLessThanOrEqual(2);
        expect(view.reads[index]!.projectId).toBe("film");
        expect(view.reads[index]!.ids).toEqual(
          assets.slice(index * 8, index * 8 + 8).map((item) => item.id),
        );
        if (index === 0 && status === "failed") {
          view.reads[index]!.result.reject(new Error("Read failed"));
          await settle();
        } else await view.finish(index);
      }
      expect(view.reads).toHaveLength(5);
      const rows = view.all().filter((node) => node.tag === "li");
      expect(rows.map((node) => node.props["data-asset-id"])).toEqual(
        assets.slice(0, 8).map((item) => item.id),
      );
      expect(rows.map((node) => node.props["data-source-status"])).toEqual(
        Array(8).fill(status),
      );
      expect(view.paths()).toHaveLength(status === "ready" ? 8 : 0);
      expect(view.button("refresh").props.disabled).toBe(false);
      for (let frame = 1; frame < 40; frame++) {
        view.props.frame = frame;
        await vue.nextTick();
      }
      expect(view.reads).toHaveLength(5);
      click(view.button("refresh"));
      expect(view.reads).toHaveLength(6);
      await view.finish(5);
      expect(view.paths()).toHaveLength(8);
      expect(view.button("refresh").props.disabled).toBe(false);
      expect(
        JSON.stringify({
          assets: view.props.assets,
          composition: view.props.composition,
        }),
      ).toBe(before);
    },
  );
});

it("keeps raw J/L peaks outside picture edges and labels excluded/suppressed contribution masks", async () => {
  const saved = composition(),
    first = saved.tracks[0]!.clips[0]!,
    secondary = saved.tracks[0]!.clips[1]!;
  first.audioTiming = {
    version: 1,
    sampleRate: 48000,
    timelineStartSample: 12000,
    sourceInSample: 0,
    sourceOutSample: 48000,
  };
  secondary.timelineStart = 0.5;
  secondary.timelineDuration = 1;
  secondary.sourceIn = 0;
  secondary.sourceOut = 1;
  const timebase = {
      version: 1 as const,
      rateNumerator: 10,
      rateDenominator: 1,
      dropFrame: false,
    },
    audioMixPlan = core.buildAudioMixPlan(saved, [asset], {
      timebase,
      coverage: [
        {
          version: 1,
          bindingId: "b",
          compositionId: "cut",
          primaryClipId: first.id,
          secondaryClipId: secondary.id,
          startSample: 36000,
          endSample: 48000,
          policy: {
            version: 1,
            mode: "replace-primary",
            role: "ambience",
            gain: 0.5,
          },
        },
      ],
    });
  const host = mount({ composition: saved, audioMixPlan });
  await host.finish();
  const raw = host.paths().find((p) => p.props["data-clip-id"] === first.id)!;
  expect(raw.props["data-suppressed"]).toBe(true);
  expect(String(raw.props.d)).toContain("17.75");
  expect(
    host
      .all()
      .some(
        (n) =>
          n.props["data-sound-edge"] === "start" &&
          n.props["data-clip-id"] === first.id &&
          Number(n.props.x1) === 37.5,
      ),
  ).toBe(true);
  expect(
    host.all().some((n) => n.props["data-audio-mask"] === "suppressed"),
  ).toBe(true);
  expect(
    host.all().some((n) => n.props["data-audio-mask"] === "excluded"),
  ).toBe(true);
});
