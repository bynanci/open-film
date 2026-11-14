// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import enUS from "../../apps/desktop/src/i18n/locales/en-US";
import zhTW from "../../apps/desktop/src/i18n/locales/zh-TW";
import jaJP from "../../apps/desktop/src/i18n/locales/ja-JP";
import { flattenMessages } from "../../apps/desktop/src/i18n/coverage";
import { flatten, loadComponent, mountComponent } from "./helpers/vue-sfc-host";

const catalogs = { "en-US": enUS, "zh-TW": zhTW, "ja-JP": jaJP };

describe("export audio tail report", () => {
  it.each(Object.keys(catalogs) as (keyof typeof catalogs)[])(
    "keeps the frame-policy warning visible in %s",
    (locale) => {
      const messages = flattenMessages(catalogs[locale]);
      const t = (key: string, params: Record<string, string | number> = {}) =>
        (messages[key] ?? key).replace(/\{(\w+)\}/gu, (_match, name: string) =>
          String(params[name]),
        );
      const component = loadComponent(
        "apps/desktop/src/components/ExportReport.vue",
        {
          "vue-i18n": { useI18n: () => ({ t }) },
          "@openfilm/exporters": { resolveCompatibility: { features: [] } },
          "../export-warning.js": { classifyExportWarning: () => undefined },
          "../i18n": { formatNumber: (value: number) => String(value) },
        },
      );
      const report = {
        format: "mp4",
        warnings: [],
        audioTail: {
          code: "qa.frameAlignedAudioTail" as const,
          severity: "manual-review-required" as const,
          measurement: "render-frame-policy" as const,
          compositionDurationSeconds: 2.02,
          exportFrameRate: 12,
          frameAlignedDurationSeconds: 2,
          fullMixSampleCount: 96_960,
          frameAlignedSampleCount: 96_000,
          lostTailSamples: 960,
          lostTailMilliseconds: 20,
        },
      };
      const mounted = mountComponent(component, { report, format: "mp4" });
      const nodes = flatten(mounted.root);
      const disclosure = nodes.find(
        (node) => node.props["data-testid"] === "export-report-audio-tail",
      );
      const visibleText = nodes.map((node) => node.text).join(" ");
      expect(disclosure).toBeDefined();
      expect(visibleText).toContain(
        messages["exportProfiles.audioTailManualReview"],
      );
      expect(visibleText).toContain("960");
      expect(visibleText).toContain("20");
      mounted.unmount();
    },
  );
});
