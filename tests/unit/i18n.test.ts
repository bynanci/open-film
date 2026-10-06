import { describe, expect, it, vi } from "vitest";
import { applicationErrorCodes } from "@openfilm/core";
import {
  matchLocale,
  pluralRule,
  resolveLocale,
  type UiLocale,
} from "../../apps/desktop/src/i18n/locale";
import {
  formatDuration,
  localizedDate,
  localizedNumber,
} from "../../apps/desktop/src/i18n/format";
import {
  flattenMessages,
  placeholders,
  translationProblems,
} from "../../apps/desktop/src/i18n/coverage";
import {
  errorDetail,
  translateError,
} from "../../apps/desktop/src/i18n/errors";
import { pseudoMessages, pseudoText } from "../../apps/desktop/src/i18n/pseudo";
import enUS from "../../apps/desktop/src/i18n/locales/en-US";
import zhTW from "../../apps/desktop/src/i18n/locales/zh-TW";
import jaJP from "../../apps/desktop/src/i18n/locales/ja-JP";

describe("UI locale contracts", () => {
  it("resolves saved preference, OS, browser list, and English fallback in order", () => {
    expect(
      resolveLocale({ saved: "ja-JP", os: "zh_TW.UTF-8", browser: "en-GB" }),
    ).toBe("ja-JP");
    expect(
      resolveLocale({ saved: "fr", os: "zh_TW.UTF-8", browser: "ja-JP" }),
    ).toBe("zh-TW");
    expect(resolveLocale({ os: "C.UTF-8", browser: ["de-DE", "ja"] })).toBe(
      "ja-JP",
    );
    expect(resolveLocale({ browser: "zh-Hant-HK" })).toBe("zh-TW");
    expect(resolveLocale({ saved: {}, os: "fr", browser: ["de"] })).toBe(
      "en-US",
    );
    expect(resolveLocale()).toBe("en-US");
  });
  it("restricts pseudo locale to development and never persists a browser string as domain state", () => {
    expect(matchLocale("en-XA")).toBeUndefined();
    expect(resolveLocale({ saved: "en-XA", os: "ja-JP" })).toBe("ja-JP");
    expect(resolveLocale({ saved: "en-XA", allowPseudo: true })).toBe("en-XA");
    expect(matchLocale(" EN_us ")).toBe("en-US");
  });
  it("uses Intl plural categories for zero, one, two and a hundred", () => {
    expect(
      [0, 1, 2, 100].map((count) => pluralRule("en-US", count, 3)),
    ).toEqual([0, 1, 2, 2]);
    for (const locale of ["zh-TW", "ja-JP"] as const)
      expect(
        [0, 1, 2, 100].map((count) => pluralRule(locale, count, 1)),
      ).toEqual([0, 0, 0, 0]);
    expect(pluralRule("en-XA", 1, 3)).toBe(1);
  });
});

describe("formatting without changing content", () => {
  it("renders consistent timecodes, including rounding across minutes and fractional edits", () => {
    expect(formatDuration(272)).toBe("04:32");
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(2.5)).toBe("00:02.5");
    expect(formatDuration(2.5, { fractional: false })).toBe("00:03");
    expect(formatDuration(59.96, { fractional: true })).toBe("01:00");
    expect(formatDuration(4.25, { fractional: true })).toBe("00:04.3");
    expect(formatDuration(-1)).toBe("00:00");
    expect(formatDuration(Infinity)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
  });
  it("uses locale-aware dates/numbers and rejects unknown capture dates", () => {
    for (const locale of ["en-US", "zh-TW", "ja-JP"] as const) {
      expect(localizedNumber(1284.5, locale)).toBe(
        new Intl.NumberFormat(locale).format(1284.5),
      );
      const options = { dateStyle: "long", timeZone: "UTC" } as const;
      expect(localizedDate("2026-04-03T12:00:00Z", locale, options)).toBe(
        new Intl.DateTimeFormat(locale, options).format(
          new Date("2026-04-03T12:00:00Z"),
        ),
      );
    }
    expect(localizedDate("not a date", "en-US")).toBeUndefined();
    expect(localizedDate(undefined, "en-US")).toBeUndefined();
    expect(localizedNumber(1284, "en-XA")).toBe("1,284");
  });
});

describe("translation coverage and errors", () => {
  it("compiles every real message and plural branch with Vue I18n", async () => {
    const { i18n, setUiLocale } = await import("../../apps/desktop/src/i18n");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const locale of ["en-US", "zh-TW", "ja-JP", "en-XA"] as const) {
        setUiLocale(locale);
        for (const [key, value] of Object.entries(flattenMessages(enUS))) {
          for (const count of value.includes("|") ? [0, 1, 2, 100] : [2]) {
            const params = Object.fromEntries(
              placeholders(value).map((name) => [
                name,
                name === "count" ? count : `示例 ${name}`,
              ]),
            );
            const translated = i18n.global.t(key, params, count);
            expect(translated, `${locale}:${key}`).not.toBe(key);
            expect(translated, `${locale}:${key}`).not.toContain("undefined");
          }
        }
      }
      expect(errors.mock.calls).toEqual([]);
      expect(warnings.mock.calls).toEqual([]);
    } finally {
      setUiLocale("en-US");
      errors.mockRestore();
      warnings.mockRestore();
    }
  });

  it("switches existing errors and persists the explicit UI preference", async () => {
    const { localizeError, setUiLocale, initializeLocale, uiLocale } =
      await import("../../apps/desktop/src/i18n");
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    try {
      const error = {
        code: "media.missing",
        params: { name: "夏日 #1 & 秋.MP4" },
      };
      setUiLocale("zh-TW");
      expect(storage.get("openfilm.uiLocale")).toBe("zh-TW");
      expect(localizeError(error)).toContain("已離線");
      setUiLocale("ja-JP");
      expect(localizeError(error)).toContain("オフライン");
      initializeLocale("en-US");
      expect(uiLocale.value).toBe("ja-JP");
      expect(error).toEqual({
        code: "media.missing",
        params: { name: "夏日 #1 & 秋.MP4" },
      });
    } finally {
      setUiLocale("en-US");
      vi.unstubAllGlobals();
    }
  });

  it("keeps all production keys and placeholders aligned", () => {
    expect(translationProblems(enUS, zhTW)).toEqual([]);
    expect(translationProblems(enUS, jaJP)).toEqual([]);
    const keys = flattenMessages(enUS);
    for (const code of applicationErrorCodes)
      expect(keys[`errors.${code}`], code).toBeDefined();
  });
  it("fails missing/orphan/empty keys and interpolation drift", () => {
    expect(
      translationProblems(
        { label: "{count} files", remove: "Remove", empty: "Label" },
        { label: "{number} 個檔案", orphan: "Orphan", empty: " " },
      ),
    ).toEqual([
      "Placeholder mismatch: label",
      "Missing key: remove",
      "Empty translation: empty",
      "Orphan key: orphan",
    ]);
  });
  it("expands pseudo labels but preserves interpolation and plural choices", () => {
    const label = "Add your memories to begin your story";
    const pseudo = pseudoText(label);
    expect(pseudo.length).toBeGreaterThan(label.length * 1.3);
    expect(pseudo.length).toBeLessThanOrEqual(label.length * 1.55);
    expect(
      placeholders(pseudoText("{count} files | {count} files in {folder}")),
    ).toEqual(["count", "folder"]);
    expect(translationProblems(enUS, pseudoMessages(enUS))).toEqual([]);
  });
  it("translates stable error codes while preserving CJK paths and diagnostic details", () => {
    const catalogs = { "en-US": enUS, "zh-TW": zhTW, "ja-JP": jaJP };
    const path = "D:\\回憶 & 旅程\\写真 #1.MP4";
    for (const locale of Object.keys(catalogs) as Exclude<
      UiLocale,
      "en-XA"
    >[]) {
      const catalog = flattenMessages(catalogs[locale]);
      const translate = (
        key: string,
        params: Record<string, string | number> = {},
      ) =>
        catalog[key]!.replace(/\{(\w+)\}/g, (_match, name: string) =>
          String(params[name]),
        );
      const error = {
        code: "media.missing",
        params: { name: path },
        detail: "ENOENT: original diagnostic",
      };
      expect(
        translateError(error, translate, (key) => key in catalog),
      ).toContain(path);
      expect(errorDetail(error)).toBe("ENOENT: original diagnostic");
      expect(
        translateError(
          { code: "NEW_UNKNOWN_CODE" },
          translate,
          (key) => key in catalog,
        ),
      ).toBe(catalog["errors.operation.failed"]);
      expect(
        translateError(
          new Error("Private developer diagnostic"),
          translate,
          (key) => key in catalog,
        ),
      ).not.toContain("Private developer diagnostic");
    }
  });
});
