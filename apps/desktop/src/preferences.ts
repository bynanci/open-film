import { reactive, ref } from "vue";
import type { WorkspaceId } from "./appTypes";
import { uiLocale, type SupportedLocale } from "./i18n";
import { matchLocale } from "./i18n/locale";

export type ThemePreference = "dark" | "light" | "system";
export type WorkspaceMode = "standard" | "expert";
export type MonitorLayoutPreference = "tabbed" | "dual";
export const preferenceStorageKey = "openfilm.preferences.v1";
interface StoredPreferences {
  theme?: ThemePreference;
  workspaceMode?: WorkspaceMode;
  defaultFilmLocale?: SupportedLocale;
  projectRoot?: string;
  lastWorkspaceByProject?: Record<string, unknown>;
  cutDeskMonitorLayout?: MonitorLayoutPreference;
  cutDeskSplitRatio?: number;
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

function validMonitorLayout(value: unknown): MonitorLayoutPreference {
  return value === "dual" ? "dual" : "tabbed";
}

function validSplitRatio(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0.25 ||
    value > 0.75
  )
    return 0.5;
  return Math.round(value * 100) / 100;
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
const cutDeskMonitorLayout = ref<MonitorLayoutPreference>(
  validMonitorLayout(stored.cutDeskMonitorLayout),
);
const cutDeskSplitRatio = ref<number>(
  validSplitRatio(stored.cutDeskSplitRatio),
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
  get cutDeskMonitorLayout(): MonitorLayoutPreference {
    return cutDeskMonitorLayout.value;
  },
  get cutDeskSplitRatio(): number {
    return cutDeskSplitRatio.value;
  },
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
        cutDeskMonitorLayout: cutDeskMonitorLayout.value,
        cutDeskSplitRatio: cutDeskSplitRatio.value,
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

export function setCutDeskMonitorLayout(value: MonitorLayoutPreference): void {
  if (value !== "tabbed" && value !== "dual") return;
  cutDeskMonitorLayout.value = value;
  persist();
}

export function setCutDeskSplitRatio(value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  const clamped = Math.min(0.75, Math.max(0.25, Math.round(value * 100) / 100));
  cutDeskSplitRatio.value = clamped;
  persist();
}

applyTheme();
