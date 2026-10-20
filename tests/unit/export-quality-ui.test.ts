// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createExportProfile,
  type Composition,
  type FilmLook,
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
afterEach(() => vi.unstubAllGlobals());
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
async function fixture(
  locale: keyof typeof catalogs = "en-US",
  api: Record<string, unknown> = {},
  initialSettings: Partial<ProjectSettings> = {},
) {
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
      "../api": {
        exportDownloadUrl: (name: string) => `/export/${name}`,
        ...api,
      },
      "./CaptionExport.vue": stub,
      "./NleHandoff.vue": stub,
      "./LocalDownload.vue": loadComponent(
        "apps/desktop/src/components/LocalDownload.vue",
        {
          "../api": { fetchDownloadBlob: vi.fn() },
          "../i18n": { localizeError: String },
        },
      ),
      "./ExportReport.vue": stub,
      "./Icon.vue": stub,
      "./FilmLookSelect.vue": stub,
    },
  );
  const settings: ProjectSettings = {
    width: 1280,
    height: 720,
    frameRate: 23.976,
    ...initialSettings,
  };
  const composition: Composition = {
    id: "film",
    storyId: "story",
    tracks: [],
    duration: 15,
  };
  const qualityEvents: Quality[] = [];
  const exportEvents: string[] = [];
  const exportRequests: Array<{
    profile?: unknown;
    confirmCrop?: boolean;
    cropPreviewToken?: string;
  }> = [];
  const props = vue.reactive({
    busy: false,
    projectId: "project",
    projectSettings: settings,
    composition,
    path: "",
    format: "",
    stale: false,
    quality: undefined as Quality | undefined,
    lookOverride: undefined as FilmLook | undefined,
    captionTrackId: undefined as string | null | undefined,
    onQuality: (value: Quality) => qualityEvents.push(value),
    onExport: (
      value: string,
      profile?: unknown,
      confirmCrop?: boolean,
      cropPreviewToken?: string,
    ) => {
      exportEvents.push(value);
      exportRequests.push({ profile, confirmCrop, cropPreviewToken });
    },
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
    exportRequests,
    t,
  };
}

describe("MP4 output quality controls", () => {
  it.each([
    { saved: 120, delivery: 60 },
    { saved: 0.5, delivery: 1 },
  ])(
    "keeps a valid $saved fps project usable with $delivery fps profile delivery",
    async ({ saved, delivery }) => {
      const requests: Array<{
        profile: { format: string; frameRate: number };
      }> = [];
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response(new Uint8Array([1]), {
            headers: { "content-type": "image/png" },
          }),
      );
      const panel = await fixture(
        "en-US",
        {
          exportFramePreviewUrl: (token: string) => `/preview/${token}`,
          previewExportFrame: async (input: (typeof requests)[number]) => {
            requests.push(input);
            return {
              token: "valid-rate-preview",
              frameIndex: 0,
              time: 0,
              width: 1920,
              height: 1080,
              profile: input.profile,
              warnings: [],
            };
          },
          exportStill: async (input: (typeof requests)[number]) => {
            requests.push(input);
            return {
              filename: "still.png",
              path: "still.png",
              profile: input.profile,
              warnings: [],
            };
          },
          exportProfileAudio: async (input: (typeof requests)[number]) => {
            requests.push(input);
            return {
              requestId: "valid-rate-audio",
              profile: input.profile,
              files: [],
              warnings: [],
            };
          },
        },
        { frameRate: saved },
      );
      const before = JSON.stringify({
        settings: panel.props.projectSettings,
        composition: panel.props.composition,
      });
      const node = (testId: string) =>
        panel.nodes().find((item) => item.props["data-testid"] === testId)!;
      for (const id of [
        "preview-export-frame",
        "export-still",
        "export-audio-mix",
        "export-audio-stems",
      ])
        await (node(id).props.onClick as () => Promise<void>)();
      (node("export-profile-mp4").props.onClick as () => void)();
      expect(
        requests.map(({ profile }) => [profile.format, profile.frameRate]),
      ).toEqual([
        ["mp4", delivery],
        ["png", delivery],
        ["wav", delivery],
        ["audio-stems", delivery],
      ]);
      expect(panel.exportRequests[0]!.profile).toMatchObject({
        frameRate: delivery,
      });
      expect(text(node("export-frame"))).toContain(String(saved));
      expect(text(node("export-profile-size"))).toContain(`${delivery} fps`);
      expect(
        JSON.stringify({
          settings: panel.props.projectSettings,
          composition: panel.props.composition,
        }),
      ).toBe(before);
    },
  );

  it.each(["width", "height"] as const)(
    "clears a reviewed crop when only saved %s changes",
    async (dimension) => {
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response(new Uint8Array([1]), {
            headers: { "content-type": "image/png" },
          }),
      );
      const panel = await fixture("en-US", {
        exportFramePreviewUrl: (token: string) => `/preview/${token}`,
        previewExportFrame: async (input: { profile: unknown }) => ({
          token: "dimensions-preview",
          frameIndex: 0,
          time: 0,
          width: 1920,
          height: 1080,
          profile: input.profile,
          warnings: [],
        }),
      });
      const node = (testId: string) =>
        panel.nodes().find((item) => item.props["data-testid"] === testId)!;
      (
        node("export-framing").props["onUpdate:modelValue"] as (
          value: string,
        ) => void
      )("crop");
      await vue.nextTick();
      await (
        node("preview-export-frame").props.onClick as () => Promise<void>
      )();
      (
        node("confirm-export-crop").props["onUpdate:modelValue"] as (
          value: boolean,
        ) => void
      )(true);
      await vue.nextTick();
      expect(node("export-profile-mp4").props.disabled).toBe(false);
      expect(node("export-preview-image")).toBeDefined();
      panel.props.projectSettings[dimension] += 2;
      await vue.nextTick();
      expect(node("export-preview-image")).toBeUndefined();
      expect(node("confirm-export-crop").props.disabled).toBe(true);
      expect(node("export-profile-mp4").props.disabled).toBe(true);
      expect(node("export-still").props.disabled).toBe(true);
    },
  );

  it("passes the reviewed crop preview token to both still and MP4 publication", async () => {
    const requests: Array<{ cropPreviewToken?: string }> = [];
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        }),
    );
    const panel = await fixture("en-US", {
      previewExportFrame: async (input: { profile: unknown }) => ({
        token: "reviewed-token",
        url: "/preview/reviewed-token",
        frameIndex: 0,
        time: 0,
        width: 1920,
        height: 1080,
        profile: input.profile,
        warnings: [],
      }),
      exportFramePreviewUrl: (token: string) => `/preview/${token}`,
      exportStill: async (input: (typeof requests)[number]) => {
        requests.push(input);
        return { filename: "still.png", path: "still.png", warnings: [] };
      },
    });
    const node = (testId: string) =>
      panel.nodes().find((item) => item.props["data-testid"] === testId)!;
    (
      node("export-framing").props["onUpdate:modelValue"] as (
        value: string,
      ) => void
    )("crop");
    await vue.nextTick();
    await (node("preview-export-frame").props.onClick as () => Promise<void>)();
    await vue.nextTick();
    (
      node("confirm-export-crop").props["onUpdate:modelValue"] as (
        value: boolean,
      ) => void
    )(true);
    await vue.nextTick();
    await (node("export-still").props.onClick as () => Promise<void>)();
    (node("export-profile-mp4").props.onClick as () => void)();
    expect(requests[0]!.cropPreviewToken).toBe("reviewed-token");
    expect(panel.exportRequests[0]).toMatchObject({
      confirmCrop: true,
      cropPreviewToken: "reviewed-token",
    });
  });

  it("keeps the selected intermediate quality in the saved still request", async () => {
    const requests: Array<{ profile: { quality: string } }> = [];
    const panel = await fixture("en-US", {
      exportStill: async (input: (typeof requests)[number]) => {
        requests.push(input);
        return {
          filename: "still.png",
          path: "still.png",
          profile: input.profile,
          warnings: [],
        };
      },
    });
    panel.props.quality = "high-detail";
    await vue.nextTick();
    const save = panel
      .nodes()
      .find((node) => node.props["data-testid"] === "export-still")!;
    await (save.props.onClick as () => Promise<void>)();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.profile.quality).toBe("high-detail");
  });

  it("allocates a new still request for changed look and caption selections while keeping retries stable", async () => {
    const requests: Array<{
      requestId: string;
      lookOverride?: FilmLook;
      captionTrackId?: string | null;
    }> = [];
    const panel = await fixture("en-US", {
      exportStill: async (input: (typeof requests)[number]) => {
        requests.push(input);
        return {
          filename: "still.png",
          path: "still.png",
          profile: createExportProfile({ ratio: "16:9", frameRate: 24 }),
          warnings: [],
        };
      },
    });
    const save = async () => {
      const node = panel
        .nodes()
        .find((node) => node.props["data-testid"] === "export-still")!;
      await (node.props.onClick as () => Promise<void>)();
      await vue.nextTick();
    };
    await save();
    await save();
    expect(requests[1]!.requestId).toBe(requests[0]!.requestId);
    panel.props.lookOverride = { version: 1, preset: "retro", strength: 1 };
    await vue.nextTick();
    await save();
    expect(requests[2]!.lookOverride).toEqual(panel.props.lookOverride);
    expect(requests[2]!.requestId).not.toBe(requests[0]!.requestId);
    panel.props.captionTrackId = null;
    await vue.nextTick();
    await save();
    expect(requests[3]!.captionTrackId).toBeNull();
    expect(requests[3]!.requestId).not.toBe(requests[2]!.requestId);
  });

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
