// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import * as core from "@openfilm/core";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host";
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((stop) => stop()));
const labels = { useI18n: () => ({ t: (key: string) => key }) };
const field = (root: HostNode, name: string) =>
  flatten(root).find((node) => node.props["data-testid"] === name)!;

function change(root: HostNode, name: string, event: unknown) {
  (field(root, name).props.onChange as (event: unknown) => void)(event);
}

it("edits independent run metrics without changing canonical text and resets only requested run", async () => {
  const path = "apps/desktop/src/components/BilingualTextControls.vue";
  expect(existsSync(path)).toBe(true);
  const changes: Array<{ text: string; runs: core.TitleTextRuns | null }> = [];
  const props = vue.reactive({
    text: "繁體標題\nOur story",
    runs: {
      version: 1,
      splitAt: 4,
      primary: { fontSize: 32, tracking: 1 },
      secondary: { fontSize: 18, tracking: 2 },
    },
    style: { version: 1, role: "subtitle" },
    frame: { width: 640, height: 360 },
    disabled: false,
    onChange: (value: (typeof changes)[number]) => changes.push(value),
  });
  const mounted = mountComponent(
    loadComponent(path, { "@openfilm/core": core, "vue-i18n": labels }),
    props,
  );
  cleanup.push(mounted.unmount);
  expect(changes).toHaveLength(0);
  change(mounted.root, "title-run-secondary-fontSize", {
    target: { value: "22.5" },
    isComposing: false,
  });
  await vue.nextTick();
  expect(changes.at(-1)).toMatchObject({
    text: "繁體標題\nOur story",
    runs: {
      primary: { fontSize: 32, tracking: 1 },
      secondary: { fontSize: 22.5, tracking: 2 },
    },
  });
});
it("stages an empty second language without saving and retains both literal texts when disabled", async () => {
  const path = "apps/desktop/src/components/BilingualTextControls.vue";
  expect(existsSync(path)).toBe(true);
  const changes: Array<{ text: string; runs: core.TitleTextRuns | null }> = [];
  const props = vue.reactive({
    text: "Primary",
    style: { version: 1, role: "subtitle" },
    frame: { width: 640, height: 360 },
    disabled: false,
    onChange: (value: (typeof changes)[number]) => changes.push(value),
  });
  const mounted = mountComponent(
    loadComponent(path, { "@openfilm/core": core, "vue-i18n": labels }),
    props,
  );
  cleanup.push(mounted.unmount);
  change(mounted.root, "title-enable-bilingual", {
    target: { checked: true },
  });
  await vue.nextTick();
  expect(changes).toHaveLength(0);
  change(mounted.root, "title-run-secondary-text", {
    target: { value: "Translation" },
    isComposing: false,
  });
  await vue.nextTick();
  expect(changes.at(-1)).toMatchObject({
    text: "Primary\nTranslation",
    runs: { version: 1, splitAt: 7 },
  });
});
it("finishing controls keep unrelated authored style and reject non-finite changes", async () => {
  const path = "apps/desktop/src/components/TitleFinishingControls.vue";
  expect(existsSync(path)).toBe(true);
  const changes: core.TitleStyle[] = [];
  const style = {
    version: 1 as const,
    role: "subtitle" as const,
    fontSize: 31.5,
    fadeOut: 1.2,
    tracking: 2,
  };
  const mounted = mountComponent(
    loadComponent(path, { "@openfilm/core": core, "vue-i18n": labels }),
    {
      style,
      disabled: false,
      onChange: (value: core.TitleStyle) => changes.push(value),
    },
  );
  cleanup.push(mounted.unmount);
  change(mounted.root, "title-enable-stroke", {
    target: { checked: true },
  });
  await vue.nextTick();
  expect(changes.at(-1)).toMatchObject({
    ...style,
    finishing: { version: 1, stroke: { color: "#000000", width: 2 } },
  });
  change(mounted.root, "title-stroke-width", {
    target: { value: "Infinity" },
  });
  await vue.nextTick();
  expect(changes).toHaveLength(1);
});
