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
import { presetPackage } from "../fixtures/local-presets/package.js";
const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((f) => f()));
const text = (n: HostNode) =>
  flatten(n)
    .map((n) => n.text)
    .join(" ");
async function fixture(
  review = vi.fn(async () => ({
    version: 1,
    package: presetPackage(),
    packageSha256: "a".repeat(64),
    registryRevision: "b".repeat(64),
    reviewSha256: "c".repeat(64),
    alreadyInstalled: false,
  })),
) {
  const install = vi.fn(async () => ({
    version: 1,
    revision: "d".repeat(64),
    packages: [],
  }));
  const component = loadComponent(
    "apps/desktop/src/components/LocalPresetsPanel.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": {
        api: {
          localPresets: async () => ({
            version: 1,
            revision: "b".repeat(64),
            packages: [],
          }),
          reviewPresetImport: review,
          installPreset: install,
        },
      },
      "../i18n": { localizeError: String },
      "../local-presets": localPresets,
      "./PresetApplyReview.vue": { default: { render: () => null } },
    },
  );
  const props = vue.shallowReactive({
      project: { id: "one", stories: [], timelines: [] },
      busy: false,
    }),
    mounted = mountComponent(component, props);
  stops.push(mounted.unmount);
  await vue.nextTick();
  await Promise.resolve();
  const choose = async () => {
    const document = JSON.stringify(presetPackage()),
      bytes = new TextEncoder().encode(document);
    const input = flatten(mounted.root).find(
      (n) => n.tag === "input" && n.props.type === "file",
    )!;
    return (input.props.onChange as (event: unknown) => Promise<void>)({
      target: {
        files: [
          {
            name: "recipes.json",
            size: bytes.length,
            arrayBuffer: async () => bytes.buffer,
          },
        ],
        value: "recipes.json",
      },
    });
  };
  return {
    ...mounted,
    props,
    review,
    install,
    choose,
    button: (key: string) =>
      flatten(mounted.root).find(
        (n) => n.tag === "button" && text(n).trim() === key,
      ),
  };
}
it("shows concrete package rights and requires a fresh explicit license acknowledgement", async () => {
  const f = await fixture();
  await f.choose();
  await vue.nextTick();
  expect(text(f.root)).toContain("Local 記憶");
  expect(f.button("presets.install")!.props.disabled).toBe(true);
  const checkbox = flatten(f.root).find(
    (n) => n.tag === "input" && n.props.type === "checkbox",
  )!;
  (checkbox.props.onChange as (event: unknown) => void)({
    target: { checked: true },
  });
  await vue.nextTick();
  expect(f.button("presets.install")!.props.disabled).toBe(false);
  expect(f.install).not.toHaveBeenCalled();
});
it("aborts and discards a file review when the owning project changes", async () => {
  let finish!: (value: unknown) => void;
  const review = vi.fn<
    (document: string, signal?: AbortSignal) => Promise<unknown>
  >(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const f = await fixture(review as never),
    pending = f.choose();
  await Promise.resolve();
  await vue.nextTick();
  const signal = review.mock.calls[0]![1] as AbortSignal;
  f.props.project = { id: "two", stories: [], timelines: [] };
  await vue.nextTick();
  expect(signal.aborted).toBe(true);
  finish({
    version: 1,
    package: { ...presetPackage(), name: "OLD RESPONSE" },
    packageSha256: "a".repeat(64),
    registryRevision: "b".repeat(64),
    reviewSha256: "c".repeat(64),
    alreadyInstalled: false,
  });
  await pending;
  await vue.nextTick();
  expect(text(f.root)).not.toContain("OLD RESPONSE");
  expect(f.install).not.toHaveBeenCalled();
});
