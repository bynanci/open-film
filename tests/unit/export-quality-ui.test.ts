// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import {
  createExportProfile,
  type Composition,
  type ProjectSettings,
} from "@openfilm/core";
import { resolveCompatibility } from "@openfilm/exporters";
import enUS from "../../apps/desktop/src/i18n/locales/en-US";
import zhTW from "../../apps/desktop/src/i18n/locales/zh-TW";
import jaJP from "../../apps/desktop/src/i18n/locales/ja-JP";
import { flattenMessages } from "../../apps/desktop/src/i18n/coverage";
import { pseudoMessages } from "../../apps/desktop/src/i18n/pseudo";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host";

type Quality = "standard" | "high-detail";
const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup()),
);
const catalogs = {
  "en-US": enUS,
  "zh-TW": zhTW,
  "ja-JP": jaJP,
  "en-XA": pseudoMessages(enUS),
};
function text(root: HostNode): string {
  return flatten(root)
    .map((element) => element.text)
    .join(" ");
}
async function fixture(locale: keyof typeof catalogs = "en-US") {
  const messages = flattenMessages(catalogs[locale]);
  const t = (key: string, params: Record<string, string | number> = {}) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/gu, (_match, name: string) =>
      String(params[name]),
    );
  const stub = { render: () => null };
  const component = loadComponent(
    "apps/desktop/src/components/ExportWorkspace.vue",
    {
      "vue-i18n": { useI18n: () => ({ t, locale: vue.ref(locale) }) },
      "@openfilm/core": { createExportProfile },
      "@openfilm/exporters": { resolveCompatibility },
      "../api": { exportDownloadUrl: (name: string) => `/export/${name}` },
      "./CaptionExport.vue": stub,
      "./ExportReport.vue": stub,
      "./Icon.vue": stub,
      "./FilmLookSelect.vue": stub,
    },
  );
  const settings: ProjectSettings = {
    width: 1280,
    height: 720,
    frameRate: 23.976,
  };
  const composition: Composition = {
    id: "film",
    storyId: "story",
    tracks: [],
    duration: 15,
  };
  const qualityEvents: Quality[] = [];
  const exportEvents: string[] = [];
  const props = vue.reactive({
    busy: false,
    projectId: "project",
    projectSettings: settings,
    composition,
    path: "",
    format: "",
    stale: false,
    quality: undefined as Quality | undefined,
    onQuality: (value: Quality) => qualityEvents.push(value),
    onExport: (value: string) => exportEvents.push(value),
  });
  const { root, unmount } = mountComponent(component, props);
  cleanups.push(unmount);
  await vue.nextTick();
  const nodes = () => flatten(root);
  const quality = () =>
    nodes().find((node) => node.props["data-testid"] === "export-quality")!;
  const changeQuality = async (value: string) => {
    (quality().props.onChange as (event: unknown) => void)({
      target: { value },
    });
    await vue.nextTick();
  };
  return {
    root,
    props,
    nodes,
    quality,
    changeQuality,
    qualityEvents,
    exportEvents,
    t,
  };
}

describe("MP4 output quality controls", () => {
  it("reads the saved dimensions and formats fractional frame rate without inventing an HD preset", async () => {
    const panel = await fixture();
    const summary = panel
      .nodes()
      .find((node) => node.props["data-testid"] === "export-frame")!;
    expect(summary).toBeDefined();
    expect(text(summary)).toContain("1280 × 720");
    expect(text(summary)).toContain("23.976");
    expect(text(summary)).not.toContain("1920");
    panel.props.projectSettings = {
      width: 1080,
      height: 1920,
      frameRate: 30000 / 1001,
    };
    await vue.nextTick();
    expect(text(summary)).toContain("1080 × 1920");
    expect(text(summary)).toContain("29.97");
    expect(text(summary)).not.toContain(String(30000 / 1001));
  });

  it("defaults to standard and sends only the transient high-detail choice without mutating the film", async () => {
    const panel = await fixture();
    const before = JSON.stringify({
      settings: panel.props.projectSettings,
      composition: panel.props.composition,
    });
    expect(panel.quality()).toBeDefined();
    expect(panel.quality().props.value).toBe("standard");
    await panel.changeQuality("high-detail");
    expect(panel.qualityEvents).toEqual(["high-detail"]);
    expect(panel.exportEvents).toEqual([]);
    expect(
      JSON.stringify({
        settings: panel.props.projectSettings,
        composition: panel.props.composition,
      }),
    ).toBe(before);
    panel.props.quality = "high-detail";
    await vue.nextTick();
    expect(panel.quality().props.value).toBe("high-detail");
    panel.props.quality = undefined;
    await vue.nextTick();
    expect(panel.quality().props.value).toBe("standard");
  });

  it("rejects unknown quality values and guards changes while output is busy", async () => {
    const panel = await fixture();
    expect(panel.quality()).toBeDefined();
    await panel.changeQuality("ultra");
    expect(panel.qualityEvents).toEqual([]);
    panel.props.busy = true;
    await vue.nextTick();
    expect(panel.quality().props.disabled).toBe(true);
    await panel.changeQuality("high-detail");
    await panel.changeQuality("standard");
    expect(panel.qualityEvents).toEqual([]);
    panel.props.busy = false;
    await vue.nextTick();
    await panel.changeQuality("standard");
    expect(panel.qualityEvents).toEqual(["standard"]);
  });

  it("keeps the direct MP4 action before optional output settings and keeps look controls addressable", async () => {
    const panel = await fixture();
    expect(panel.quality()).toBeDefined();
    const destination = panel
      .nodes()
      .find((node) => node.props.class === "export-destination")!;
    const button = destination.children.find(
      (node) => node.tag === "button" && node.props.class === "primary",
    )!;
    expect(button).toBeDefined();
    expect(destination.children.indexOf(button)).toBeLessThan(
      destination.children.findIndex(
        (node) => node.props.class === "export-quality-options",
      ),
    );
    const looks = panel
      .nodes()
      .find((node) => node.props.class === "export-look-options")!;
    expect(flatten(looks).filter((node) => node.tag === "select")).toHaveLength(
      1,
    );
    (button.props.onClick as () => void)();
    expect(panel.exportEvents).toEqual(["mp4"]);
  });

  it("keeps MP4 quality settings out of editable timeline exports", async () => {
    const panel = await fixture();
    expect(panel.quality()).toBeDefined();
    const goals = panel
      .nodes()
      .filter(
        (node) =>
          node.tag === "button" &&
          String(node.props.class).includes("export-goal"),
      );
    (goals[1]!.props.onClick as () => void)();
    await vue.nextTick();
    expect(panel.quality()).toBeUndefined();
    expect(panel.qualityEvents).toEqual([]);
  });

  for (const locale of Object.keys(catalogs) as (keyof typeof catalogs)[]) {
    it(`labels saved frame, originals and compression tradeoffs accessibly in ${locale}`, async () => {
      const panel = await fixture(locale);
      expect(panel.quality()).toBeDefined();
      const label = panel
        .nodes()
        .find(
          (node) =>
            node.tag === "label" && node.props.for === panel.quality().props.id,
        )!;
      expect(text(label)).toContain(panel.t("exportQuality.quality"));
      const describedBy = String(
        panel.quality().props["aria-describedby"],
      ).split(" ");
      const descriptions = describedBy.map((id) =>
        panel.nodes().find((node) => node.props.id === id),
      );
      expect(descriptions.every(Boolean)).toBe(true);
      expect(descriptions.map((node) => text(node!)).join(" ")).toContain(
        panel.t("exportQuality.standardHint"),
      );
      const content = text(panel.root);
      for (const key of ["source", "originals", "frameUnchanged", "limits"]) {
        expect(content).toContain(panel.t(`exportQuality.${key}`));
        expect(panel.t(`exportQuality.${key}`)).not.toBe(
          `exportQuality.${key}`,
        );
      }
      expect(content).not.toMatch(/\bexportQuality\.[\w.]+|\bundefined\b/u);
      panel.props.quality = "high-detail";
      await vue.nextTick();
      expect(text(panel.root)).toContain(
        panel.t("exportQuality.highDetailHint"),
      );
    });
  }
});
