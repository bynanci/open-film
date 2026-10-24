import { reactive, ref } from "vue";
import type { WorkspaceId } from "./appTypes";
import { uiLocale, type SupportedLocale } from "./i18n";
import { matchLocale } from "./i18n/locale";

export type ThemePreference = "dark" | "light" | "system";
export type WorkspaceMode = "standard" | "expert";
export const preferenceStorageKey = "openfilm.preferences.v1";
interface StoredPreferences {
  theme?: ThemePreference;
  workspaceMode?: WorkspaceMode;
  defaultFilmLocale?: SupportedLocale;
  projectRoot?: string;
  lastWorkspaceByProject?: Record<string, unknown>;
}
const workspaceIds = new Set<WorkspaceId>([
  "library",
  "story",
  "edit",
  "export",
  "versions",
]);

function validWorkspaceMap(
  value: unknown,
): Partial<Record<string, WorkspaceId>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([projectId, workspace]) =>
        projectId.trim().length > 0 &&
        typeof workspace === "string" &&
        workspaceIds.has(workspace as WorkspaceId),
    ),
  );
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
let lastWorkspaceByProject = validWorkspaceMap(stored.lastWorkspaceByProject);
export const preferences = reactive({
  workspaceMode: (stored.workspaceMode === "expert"
    ? "expert"
    : "standard") as WorkspaceMode,
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
        workspaceMode: preferences.workspaceMode,
        defaultFilmLocale: defaultFilmLocale.value,
        projectRoot: preferences.projectRoot,
        lastWorkspaceByProject,
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
export function setWorkspaceMode(value: WorkspaceMode): void {
  if (value !== "standard" && value !== "expert") return;
  preferences.workspaceMode = value;
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

export function getLastWorkspaceForProject(
  projectId: string,
): WorkspaceId | undefined {
  if (!projectId.trim()) return undefined;
  return lastWorkspaceByProject[projectId];
}

export function setLastWorkspaceForProject(
  projectId: string,
  workspace: WorkspaceId,
): void {
  if (!projectId.trim() || !workspaceIds.has(workspace)) return;
  lastWorkspaceByProject = {
    ...lastWorkspaceByProject,
    [projectId]: workspace,
  };
  persist();
}
applyTheme();
