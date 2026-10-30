// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { resolveCompatibility } from "@openfilm/exporters";
import enUS from "../../apps/desktop/src/i18n/locales/en-US";
import zhTW from "../../apps/desktop/src/i18n/locales/zh-TW";
import jaJP from "../../apps/desktop/src/i18n/locales/ja-JP";

it("resolves every exported compatibility feature in each production locale", () => {
  for (const [locale, messages] of Object.entries({
    "en-US": enUS,
    "zh-TW": zhTW,
    "ja-JP": jaJP,
  })) {
    const labels: Record<string, string> = messages.media.compatibility.feature;
    for (const { id } of resolveCompatibility.features) {
      expect(labels[id], `${locale}:media.compatibility.feature.${id}`).toEqual(
        expect.any(String),
      );
      expect(labels[id]?.trim(), `${locale}:${id}`).toBeTruthy();
      expect(labels[id]).not.toContain("media.compatibility.feature.");
    }
  }
});
