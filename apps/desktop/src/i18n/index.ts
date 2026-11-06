/// <reference types="vite/client" />
import { computed } from "vue";
import { createI18n } from "vue-i18n";
import enUS from "./locales/en-US";
import {
  localeStorageKey,
  matchLocale,
  pluralRule,
  resolveLocale,
  type SupportedLocale,
  type UiLocale,
} from "./locale";
import { localizedDate, localizedNumber } from "./format";
import { pseudoMessages } from "./pseudo";
import { translateError } from "./errors";

export {
  supportedLocales,
  type SupportedLocale,
  type UiLocale,
} from "./locale";
export { formatDuration } from "./format";
export { errorDetail } from "./errors";

const development = import.meta.env.DEV;
function savedLocale(): string | null {
  try {
    return globalThis.localStorage?.getItem(localeStorageKey) ?? null;
  } catch {
    return null;
  }
}
function browserLocales(): readonly string[] {
  return typeof navigator === "undefined"
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
}
const initialLocale = resolveLocale({
  saved: savedLocale(),
  browser: browserLocales(),
  allowPseudo: development,
});
type WidenMessageValues<T> = T extends string
  ? string
  : T extends Record<string, unknown>
    ? { [K in keyof T]: WidenMessageValues<T[K]> }
    : T;
type LocaleMessages = WidenMessageValues<typeof enUS>;
// Non-English dictionaries are registered only after their chunks finish loading.
const messages = {
  "en-US": enUS,
  ...(development ? { "en-XA": pseudoMessages(enUS) } : {}),
} as unknown as Record<UiLocale, LocaleMessages>;

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: "en-US",
  messages,
  pluralRules: Object.fromEntries(
    ["en-US", "zh-TW", "ja-JP", "en-XA"].map((locale) => [
      locale,
      (count: number, choices: number) =>
        pluralRule(locale as UiLocale, count, choices),
    ]),
  ),
  missingWarn: development,
  fallbackWarn: development,
  missing: (locale, key) => {
    if (development)
      console.error(`[OpenFilm i18n] Missing translation: ${locale}:${key}`);
    // Known baseline keys use vue-i18n's normal English fallback. Unknown keys
    // never appear as raw semantic IDs in production UI.
    if (
      !key
        .split(".")
        .reduce<unknown>(
          (value, part) =>
            typeof value === "object" && value !== null
              ? (value as Record<string, unknown>)[part]
              : undefined,
          enUS,
        )
    )
      return enUS.common.unavailable;
    return undefined;
  },
});

export const uiLocale = computed(() => i18n.global.locale.value as UiLocale);
let explicitlySelected = false;
const loadedLocales = new Set<UiLocale>([
  "en-US",
  ...(development ? ["en-XA" as const] : []),
]);
let localeRequest = 0;

async function loadLocaleMessages(locale: UiLocale): Promise<void> {
  if (loadedLocales.has(locale)) return;
  if (locale === "en-US") return;
  if (locale === "en-XA") {
    i18n.global.setLocaleMessage(locale, pseudoMessages(enUS));
  } else {
    const messages = await loadSupportedLocale(locale);
    i18n.global.setLocaleMessage(locale, messages);
  }
  loadedLocales.add(locale);
}

async function loadSupportedLocale(
  locale: Exclude<SupportedLocale, "en-US">,
): Promise<LocaleMessages> {
  switch (locale) {
    case "zh-TW":
      return (await import("./locales/zh-TW")).default;
    case "ja-JP":
      return (await import("./locales/ja-JP")).default;
  }
}

async function applyLocale(
  locale: UiLocale,
  userInitiated = false,
): Promise<void> {
  const request = ++localeRequest;
  if (userInitiated) explicitlySelected = true;
  try {
    await loadLocaleMessages(locale);
  } catch (cause) {
    if (development)
      console.error(`[OpenFilm i18n] Could not load locale ${locale}`, cause);
    if (userInitiated && request === localeRequest) explicitlySelected = false;
    return;
  }
  if (request !== localeRequest) return;
  i18n.global.locale.value = locale;
  if (typeof document !== "undefined")
    document.documentElement.lang = locale === "en-XA" ? "en-US" : locale;
  if (userInitiated) {
    try {
      globalThis.localStorage?.setItem(localeStorageKey, locale);
    } catch {
      /* Runtime switching still works when preference storage is unavailable. */
    }
  }
}

/** The service supplies the host OS locale after its connection is established. */
export async function initializeLocale(systemLocale?: string): Promise<void> {
  if (explicitlySelected) return;
  await applyLocale(
    resolveLocale({
      saved: savedLocale(),
      os: systemLocale,
      browser: browserLocales(),
      allowPseudo: development,
    }),
  );
}
export async function setUiLocale(value: string): Promise<void> {
  const locale = matchLocale(value, development);
  if (!locale) return;
  await applyLocale(locale, true);
}
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return localizedNumber(value, uiLocale.value, options);
}
export function formatDate(
  value: string | number | Date | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  return (
    localizedDate(value, uiLocale.value, options) ??
    i18n.global.t("common.unknownDate")
  );
}
export function localizeError(error: unknown): string {
  // Read locale explicitly, including when an unknown error takes the fallback.
  const locale = uiLocale.value;
  return translateError(
    error,
    (key, params) => i18n.global.t(key, params ?? {}),
    (key) => i18n.global.te(key, locale) || i18n.global.te(key, "en-US"),
  );
}
applyLocale(initialLocale);
