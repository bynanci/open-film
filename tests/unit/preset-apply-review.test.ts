// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it, vi } from "vitest";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host.js";
import * as localPresets from "../../apps/desktop/src/local-presets.js";
import * as core from "@openfilm/core";
import { presetPackage } from "../fixtures/local-presets/package.js";
const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((f) => f()));
const text = (n: HostNode) =>
  flatten(n)
    .map((n) => n.text)
    .join(" ")
    .trim();
async function fixture(
  read = vi.fn(async (request: unknown, _signal?: AbortSignal) => ({
    version: 1,
    request,
    reviewSha256: "c".repeat(64),
    snapshot: {
      kind: "film-look",
      name: "Warm",
      canonicalId: "local:test.studio@1.0.0/film-look/warm",
    },
    commands: [],
    warnings: [],
    conflicts: [],
    document: {
      composition: {
        id: "cut",
        storyId: "s",
        duration: 1,
        defaultLook: { version: 1, preset: "retro", strength: 1 },
        tracks: [{ id: "v", type: "video", clips: [{ id: "clip" }] }],
      },
      story: { id: "s", beats: [] },
    },
  })),
  accept = vi.fn(async () => ({
    receipt: { projectId: "one" },
    result: { storyId: "s", compositionId: "cut" },
  })),
) {
  const p = presetPackage(),
    component = loadComponent(
      "apps/desktop/src/components/PresetApplyReview.vue",
      {
        "vue-i18n": {
          useI18n: () => ({
            t: (key: string, params?: object) =>
              key + (params ? JSON.stringify(params) : ""),
          }),
        },
        "../api": {
          api: {
            editor: async () => ({ revision: "a".repeat(64) }),
            reviewPresetApplication: read,
            acceptPresetApplication: accept,
          },
        },
        "../i18n": { localizeError: String },
        "../local-presets": localPresets,
        "@openfilm/core": core,
        "./StoryPlanReviewModal.vue": { default: { render: () => null } },
      },
    ),
    applied = vi.fn(),
    props = vue.shallowReactive({
      project: {
        id: "one",
        stories: [
          { id: "s", title: "Story", beats: [{ id: "b", title: "Beat" }] },
        ],
        timelines: [
          {
            id: "cut",
            storyId: "s",
            tracks: [
              {
                id: "v",
                type: "video",
                clips: [{ id: "clip", title: "Title" }],
              },
            ],
          },
        ],
      },
      activeCompositionId: "",
      package: {
        ...p,
        packageSha256: "d".repeat(64),
        entrySummaries: [
          { id: "warm", canonicalId: "local:test.studio@1.0.0/film-look/warm" },
        ],
      },
      entry: p.entries[0],
      registryRevision: "b".repeat(64),
      onApplied: applied,
    });
  const mounted = mountComponent(component, props);
  stops.push(mounted.unmount);
  await vue.nextTick();
  const button = (key: string) =>
      flatten(mounted.root).find((n) => n.tag === "button" && text(n) === key),
    click = async (key: string) => {
      const b = button(key)!;
      expect(b).toBeDefined();
      await (b.props.onClick as () => Promise<void>)();
      await vue.nextTick();
    };
  return { ...mounted, props, read, accept, applied, button, click };
}
it("defaults an empty active composition ID to a real saved film before review", async () => {
  const f = await fixture();
  expect(f.button("presets.previewChanges")!.props.disabled).toBe(false);
  await f.click("presets.previewChanges");
  expect(f.read.mock.calls[0]![0]).toMatchObject({
    projectId: "one",
    target: { kind: "film-look", compositionId: "cut", scope: "film" },
  });
  expect(f.button("presets.accept")).toBeDefined();
  expect(text(f.root)).toContain('presets.visualChangeCount{"count":1}');
});
it("a pending acceptance cannot publish its old result into a switched project", async () => {
  let finish!: (value: unknown) => void;
  const accept = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
    f = await fixture(undefined, accept as never);
  f.props.activeCompositionId = "cut";
  await vue.nextTick();
  await f.click("presets.previewChanges");
  const pending = f.click("presets.accept");
  await vue.nextTick();
  f.props.project = { ...f.props.project, id: "two" };
  await vue.nextTick();
  finish({
    receipt: { projectId: "one" },
    result: { storyId: "s", compositionId: "cut" },
  });
  await pending;
  expect(f.applied).not.toHaveBeenCalled();
  expect(f.button("presets.accept")).toBeUndefined();
});
