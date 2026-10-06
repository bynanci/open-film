export const supportedLocales = [
  { code: "en-US", label: "English" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "ja-JP", label: "日本語" },
] as const;

export type SupportedLocale = (typeof supportedLocales)[number]["code"];
export type UiLocale = SupportedLocale | "en-XA";
export const localeStorageKey = "openfilm.uiLocale";

export function matchLocale(
  value: unknown,
  allowPseudo = false,
): UiLocale | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .trim()
    .replaceAll("_", "-")
    .split(".")[0]
    ?.toLowerCase();
  if (normalized === "en-xa") return allowPseudo ? "en-XA" : undefined;
  if (/^zh(?:-|$)/.test(normalized ?? "")) return "zh-TW";
  if (/^ja(?:-|$)/.test(normalized ?? "")) return "ja-JP";
  if (/^en(?:-|$)/.test(normalized ?? "")) return "en-US";
  return undefined;
}

/** Unsupported preferences fall through; no locale text enters domain IDs. */
export function resolveLocale(
  input: {
    saved?: unknown;
    os?: unknown;
    browser?: string | readonly string[];
    allowPseudo?: boolean;
  } = {},
): UiLocale {
  const browser =
    typeof input.browser === "string" ? [input.browser] : (input.browser ?? []);
  for (const candidate of [input.saved, input.os, ...browser]) {
    const locale = matchLocale(candidate, input.allowPseudo);
    if (locale) return locale;
  }
  return "en-US";
}

export function intlLocale(locale: UiLocale): SupportedLocale {
  return locale === "en-XA" ? "en-US" : locale;
}

/** Vue's message choices use zero / one / other; CJK messages need one form. */
export function pluralRule(
  locale: UiLocale,
  count: number,
  choices: number,
): number {
  if (choices <= 1) return 0;
  const category = new Intl.PluralRules(intlLocale(locale)).select(count);
  if (choices === 2) return category === "one" ? 0 : 1;
  return count === 0 ? 0 : category === "one" ? 1 : Math.min(2, choices - 1);
}
