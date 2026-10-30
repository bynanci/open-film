// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import { sourceColorStyle } from "../../apps/desktop/src/source-color";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";
afterEach(() => vi.unstubAllGlobals());
const i18n = { useI18n: () => ({ t: String }) };
it("accepts only locally generated filter IDs when constructing CSS", () => {
  expect(() =>
    sourceColorStyle(
      { ...core.PRIMARY_COLOR_IDENTITY, exposureEv: 0.1 },
      undefined,
      { primary: "id) url(https://invalid.test/filter)", look: "look" },
    ),
  ).toThrow(/filter/i);
  expect(
    sourceColorStyle(
      { ...core.PRIMARY_COLOR_IDENTITY, exposureEv: 0.1 },
      undefined,
      { primary: "primary-v-0-1", look: "look-v-0" },
    ),
  ).toEqual({ filter: "url(#primary-v-0-1)" });
});
it("keeps numeric edits local until explicit Apply and rejects invalid gain", async () => {
  vi.stubGlobal("Document", class {});
  vi.stubGlobal("ShadowRoot", class {});
  const commands: unknown[] = [];
  const component = loadComponent(
    "apps/desktop/src/components/PrimaryColorInspector.vue",
    {
      "@openfilm/core": core,
      "vue-i18n": i18n,
      "./PrimaryColorReviewPanel.vue": { render: () => null },
    },
  );
  const clip = { id: "c", assetId: "a", timelineStart: 0, timelineDuration: 1 };
  const mounted = mountComponent(component, {
    composition: {
      id: "f",
      storyId: "s",
      duration: 1,
      tracks: [{ id: "v", type: "video", clips: [clip] }],
    },
    clip,
    assets: [],
    projectId: "p",
    revision: "r",
    clipEligible: true,
    clipProtected: false,
    disabled: false,
    onCommand: (v: unknown) => commands.push(v),
  });
  try {
    const input = () =>
      flatten(mounted.root).find(
        (n) => n.props["data-testid"] === "primary-exposure",
      )!;
    (input().props["onUpdate:modelValue"] as (v: number) => void)(2.1);
    await vue.nextTick();
    expect(
      flatten(mounted.root).find(
        (n) => n.props["data-testid"] === "primary-apply",
      )!.props.disabled,
    ).toBe(true);
    expect(commands).toEqual([]);
    (input().props["onUpdate:modelValue"] as (v: number) => void)(0.3);
    await vue.nextTick();
    (
      flatten(mounted.root).find((n) => n.tag === "form")!.props.onSubmit as (
        e: unknown,
      ) => void
    )({ preventDefault() {} });
    expect(commands).toEqual([
      {
        type: "primary-color",
        scope: "clip",
        clipId: "c",
        correction: {
          version: 1,
          temperature: 0,
          exposureEv: 0.3,
          contrast: 1,
        },
      },
    ]);
  } finally {
    mounted.unmount();
  }
});
it("aborts and discards late measured evidence after revision changes", async () => {
  let finish!: (v: unknown) => void, signal!: AbortSignal;
  const component = loadComponent(
    "apps/desktop/src/components/PrimaryColorReviewPanel.vue",
    {
      "vue-i18n": i18n,
      "../api": {
        api: {
          primaryColorReview: (
            _id: string,
            _input: unknown,
            s: AbortSignal,
          ) => {
            signal = s;
            return new Promise((resolve) => {
              finish = resolve;
            });
          },
          discardPrimaryColorReview: async () => ({ ok: true }),
        },
        primaryColorReviewMediaUrl: () => "/sample",
      },
    },
  );
  const props = vue.reactive({
    projectId: "p",
    compositionId: "f",
    revision: "one",
    clipId: "target",
    references: [{ id: "reference", name: "Reference" }],
    disabled: false,
  });
  const mounted = mountComponent(component, props);
  try {
    const pending = (
      flatten(mounted.root).find(
        (n) => n.props["data-testid"] === "primary-measure",
      )!.props.onClick as () => Promise<void>
    )();
    await vue.nextTick();
    props.revision = "two";
    await vue.nextTick();
    expect(signal.aborted).toBe(true);
    finish({ id: "late", samples: [], warnings: [] });
    await pending;
    await vue.nextTick();
    expect(flatten(mounted.root).some((n) => n.tag === "img")).toBe(false);
  } finally {
    mounted.unmount();
  }
});

it("retains the review panel when optimistic Apply replaces the same clip and Composition", async () => {
  const panel = loadComponent(
    "apps/desktop/src/components/PrimaryColorReviewPanel.vue",
    {
      "vue-i18n": i18n,
      "../api": {
        api: { discardPrimaryColorReview: async () => ({ ok: true }) },
        primaryColorReviewMediaUrl: () => "",
      },
    },
  );
  const component = loadComponent(
    "apps/desktop/src/components/PrimaryColorInspector.vue",
    {
      "@openfilm/core": core,
      "vue-i18n": i18n,
      "./PrimaryColorReviewPanel.vue": panel,
    },
  );
  const clip = { id: "c", assetId: "a", timelineStart: 0, timelineDuration: 1 };
  const props = vue.reactive({
    composition: {
      id: "f",
      storyId: "s",
      duration: 2,
      tracks: [
        {
          id: "v",
          type: "video",
          clips: [
            clip,
            {
              id: "reference",
              assetId: "b",
              timelineStart: 1,
              timelineDuration: 1,
            },
          ],
        },
      ],
    },
    clip,
    assets: [
      { id: "a", name: "A", mediaType: "image", state: {} },
      { id: "b", name: "B", mediaType: "image", state: {} },
    ],
    projectId: "p",
    revision: "r",
    clipEligible: true,
    disabled: false,
  });
  const mounted = mountComponent(component, props);
  try {
    (
      flatten(mounted.root).find(
        (n) => n.tag === "button" && n.props["aria-expanded"] !== undefined,
      )!.props.onClick as () => void
    )();
    await vue.nextTick();
    expect(
      flatten(mounted.root).some(
        (n) => n.props["data-testid"] === "primary-measure",
      ),
    ).toBe(true);
    props.composition = { ...props.composition };
    props.clip = { ...props.clip };
    await vue.nextTick();
    expect(
      flatten(mounted.root).some(
        (n) => n.props["data-testid"] === "primary-measure",
      ),
    ).toBe(true);
  } finally {
    mounted.unmount();
  }
});
