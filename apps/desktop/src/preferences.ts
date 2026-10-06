import { reactive, ref } from "vue";
import { uiLocale, type SupportedLocale } from "./i18n";
import { matchLocale } from "./i18n/locale";

export type ThemePreference = "dark" | "light" | "system";
export const preferenceStorageKey = "openfilm.preferences.v1";
interface StoredPreferences {
  theme?: ThemePreference;
  defaultFilmLocale?: SupportedLocale;
  projectRoot?: string;
}
function readPreferences(): StoredPreferences {
  try {
    const raw: unknown = JSON.parse(
      globalThis.localStorage?.getItem(preferenceStorageKey) ?? "{}",
    );
    return typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? raw
      : {};
  } catch {
    return {};
  }
}
const stored = readPreferences();
const defaultFilmLocale = ref<SupportedLocale | undefined>(
  matchLocale(stored.defaultFilmLocale) as SupportedLocale | undefined,
);
export const preferences = reactive({
  theme: (["dark", "light", "system"].includes(stored.theme ?? "")
    ? stored.theme
    : "dark") as ThemePreference,
  get defaultFilmLocale(): SupportedLocale {
    return (
      defaultFilmLocale.value ??
      (uiLocale.value === "en-XA" ? "en-US" : uiLocale.value)
    );
  },
  projectRoot: typeof stored.projectRoot === "string" ? stored.projectRoot : "",
});
function persist(): void {
  try {
    globalThis.localStorage?.setItem(
      preferenceStorageKey,
      JSON.stringify({
        theme: preferences.theme,
        defaultFilmLocale: defaultFilmLocale.value,
        projectRoot: preferences.projectRoot,
      }),
    );
  } catch {
    /* Session preferences remain usable without disk storage. */
  }
}
function applyTheme(): void {
  if (typeof document !== "undefined")
    document.documentElement.dataset.theme = preferences.theme;
}
export function setTheme(value: ThemePreference): void {
  if (!["dark", "light", "system"].includes(value)) return;
  preferences.theme = value;
  applyTheme();
  persist();
}
export function setDefaultFilmLocale(value: SupportedLocale): void {
  const locale = matchLocale(value);
  if (!locale || locale === "en-XA") return;
  defaultFilmLocale.value = locale;
  persist();
}
export function setProjectRoot(value: string): void {
  preferences.projectRoot = value.trim();
  persist();
}
applyTheme();
