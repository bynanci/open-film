<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  initializeLocale,
  supportedLocales,
  uiLocale,
  setUiLocale,
  formatDuration as duration,
  formatNumber,
  formatDate as dateLabel,
  localizeError,
  errorDetail,
} from "./i18n";
import type {
  FilmCreation,
  FilmLocale,
  RecentProject,
  WorkspaceId,
  WorkflowStep,
} from "./appTypes";
import { durationStatus } from "./duration";
import AppLauncher from "./components/AppLauncher.vue";
import AppSettings from "./components/AppSettings.vue";
import WorkflowProgress from "./components/WorkflowProgress.vue";
import ImportPanel from "./components/ImportPanel.vue";
import ExportWorkspace from "./components/ExportWorkspace.vue";
import type {
  MediaAsset,
  OpenFilmProject,
  Story,
  StoryBeat,
  Event,
  SimilarityGroup,
  Job,
} from "@openfilm/core";
import {
  api,
  post,
  patch,
  thumbnailUrl,
  previewUrl,
  type EditorState,
  type MediaStatus,
  type SourceStatus,
  type ExportCompatibilityReport,
} from "./api";
import Icon from "./components/Icon.vue";
import AssetCard from "./components/AssetCard.vue";
import TimelineEditor from "./components/TimelineEditor.vue";
import RelinkMedia from "./components/RelinkMedia.vue";
import SourceDetails from "./components/SourceDetails.vue";
import AnalysisJobActions from "./components/AnalysisJobActions.vue";
import type { AnalysisJobRecoveryState, AnalysisRecoveryInput } from "./api";

const { t } = useI18n();
const interfaceLocales = [
  ...supportedLocales,
  ...(import.meta.env.DEV ? [{ code: "en-XA", label: "Pseudo · en-XA" }] : []),
];
type Tab = WorkspaceId;
type UiMessage = { uiKey: string; params?: Record<string, string | number> };
const message = (
  key: string,
  params?: Record<string, string | number>,
): UiMessage => ({ uiKey: `app.${key}`, params });
function uiMessage(value: unknown) {
  if (value && typeof value === "object" && "uiKey" in value) {
    const entry = value as UiMessage;
    const count = entry.params?.count;
    return typeof count === "number"
      ? t(entry.uiKey, { ...entry.params, count: formatNumber(count) }, count)
      : t(entry.uiKey, entry.params ?? {});
  }
  return localizeError(value);
}
type AssetState = "favorite" | "rejected" | "locked";
const tabs: Tab[] = ["library", "story", "edit", "export"];
const tab = ref<Tab>("library");
const project = ref<OpenFilmProject | null>(null);
const projectPath = ref<string | null>(null);
const connected = ref(false);
const loading = ref(true);
const busy = ref("");
const error = ref<unknown>("");
const errorMessage = computed(() => uiMessage(error.value));
const errorDetails = computed(() => errorDetail(error.value));
const notice = ref<UiMessage | null>(null);
const noticeMessage = computed(() =>
  notice.value ? uiMessage(notice.value) : "",
);
const settingsOpen = ref(false);
const workspaceInfo = ref<Awaited<ReturnType<typeof api.workspace>> | null>(
  null,
);
const recentProjects = ref<RecentProject[]>(readRecentProjects());
const uploading = ref(false);
const uploadProgress = ref<{
  completed: number;
  total: number;
  bytesUploaded: number;
  totalBytes: number;
}>();
let uploadController: AbortController | undefined;
const defaultRoot = computed(
  () => workspaceInfo.value?.defaultProjectRoot ?? "",
);
const importOpen = ref(false);
const assets = ref<MediaAsset[]>([]);
const assetCache = ref<Record<string, MediaAsset>>({});
const mediaStatus = ref<MediaStatus | null>(null);
const mediaStatusError = ref<unknown>("");
const checkingMedia = ref(false);
const relinkOpen = ref(false);
const relinkAssetIds = ref<string[] | undefined>();
const relinkLibraryId = ref<string | undefined>();
const relinkPanelBusy = ref(false);
const relinkRefreshing = ref(false);
const relinkBusy = computed(
  () => relinkPanelBusy.value || relinkRefreshing.value || uploading.value,
);
const sourceVersion = ref(0);
let statusGeneration = 0;
let assetsGeneration = 0;
const assetMutations = new Map<string, number>();
const sourceStatuses = computed<Record<string, SourceStatus>>(() =>
  Object.fromEntries(
    mediaStatus.value?.assets.map((item) => [item.assetId, item]) ?? [],
  ),
);
const missingCount = computed(
  () =>
    mediaStatus.value?.assets.filter((item) => item.status === "missing")
      .length ?? 0,
);
const inaccessibleCount = computed(
  () =>
    mediaStatus.value?.assets.filter((item) => item.status === "inaccessible")
      .length ?? 0,
);
const offlineLibraries = computed(
  () =>
    mediaStatus.value?.libraries.filter(
      (library) => library.status !== "online",
    ) ?? [],
);

const total = ref(0);
const librarySummary = ref({ total: 0, images: 0, videos: 0, audio: 0 });
const offset = ref(0);
const pageSize = 60;
const search = ref("");
const stateFilter = ref("");
const mediaFilter = ref("");
const selectedAssetId = ref("");
const selectedAsset = computed(() => assetCache.value[selectedAssetId.value]);
const libraryView = ref<"all" | "events" | "duplicates">("all");
const libraryFilter = ref<
  "all" | "events" | "duplicates" | "favorite" | "rejected" | "missing"
>("all");
const events = ref<Event[]>([]);
const duplicates = ref<SimilarityGroup[]>([]);
const analyzed = ref(false);
const groupSelection = ref<{
  title: string;
  assetIds: string[];
  kind?: "exact" | "perceptual";
  index?: number;
} | null>(null);
const groupHeading = computed(() =>
  groupSelection.value?.kind
    ? `${t(groupSelection.value.kind === "exact" ? "app.library.exactDuplicates" : "app.library.similarFrames")} · ${formatNumber((groupSelection.value.index ?? 0) + 1)}`
    : (groupSelection.value?.title ?? ""),
);
const jobs = ref<Job[]>([]);
const analysisRecovery = ref<Record<string, AnalysisJobRecoveryState>>({});
const recoveringAnalysisJobs = ref<Record<string, boolean>>({});
const analysisRecoveryPending = computed(() =>
  Object.values(recoveringAnalysisJobs.value).some(Boolean),
);
let analysisRecoveryGeneration = 0;
watch(
  [() => project.value?.id, () => projectPath.value],
  () => {
    analysisRecoveryGeneration++;
    analysisRecovery.value = {};
    recoveringAnalysisJobs.value = {};
  },
  { flush: "sync" },
);
const activeJobs = computed(() =>
  jobs.value.filter(
    (job) => job.status === "running" || job.status === "queued",
  ),
);
function jobBlocksProjectSwitch(job: Job, recovery?: AnalysisJobRecoveryState) {
  if (job.status !== "running" && job.status !== "queued") return false;
  // Only the three owned analysis operations have a runtime controller
  // capability. Missing or mismatched evidence retains the existing barrier.
  return (
    !["transcribe", "waveform", "scenes"].includes(job.type) ||
    recovery?.jobId !== job.id ||
    recovery.canCancel !== false
  );
}
const projectSwitchBlocked = computed(
  () =>
    !!busy.value ||
    relinkBusy.value ||
    analysisRecoveryPending.value ||
    jobs.value.some((job) =>
      jobBlocksProjectSwitch(job, analysisRecovery.value[job.id]),
    ),
);
const recentJob = computed(() => jobs.value[0]);
const cancellingJobs = ref<Record<string, boolean>>({});
const renderCancellationRequested = ref<string | null>(null);
const storyCreateOpen = ref(false);
const storyTitle = ref("");
const storyTemplate = ref("blank");
const storyScope = ref<"library" | "page">("library");
const targetDuration = ref(120);
const maxDuration = ref(180);
const storyTimingEdited = ref(false);
watch(
  storyTemplate,
  (template) => {
    if (storyTimingEdited.value) return;
    const defaults = workspaceInfo.value?.templates.find(
      (item) => item.id === template,
    );
    if (!defaults) return;
    targetDuration.value = defaults.targetDuration;
    maxDuration.value = defaults.maxDuration;
  },
  { flush: "sync" },
);
const activeStoryId = ref("");
const activeStory = computed(
  () =>
    project.value?.stories.find((story) => story.id === activeStoryId.value) ??
    project.value?.stories.at(-1),
);
const activeBeatIndex = ref(0);
const activeBeat = computed(
  () => activeStory.value?.beats[activeBeatIndex.value],
);
const beatDraft = ref<{
  title: string;
  intent: string;
  targetDuration: number;
  selectedAssetIds: string[];
}>({ title: "", intent: "", targetDuration: 0, selectedAssetIds: [] });
const beatDirty = ref(false);
const candidateOffset = ref(0);
const candidateIds = computed(() => activeBeat.value?.candidateAssetIds ?? []);
const candidateAssets = computed(() =>
  candidateIds.value
    .slice(candidateOffset.value, candidateOffset.value + 24)
    .map((id) => assetCache.value[id])
    .filter((asset): asset is MediaAsset => !!asset),
);
const selectedBeatAssets = computed(() =>
  beatDraft.value.selectedAssetIds
    .map((id) => assetCache.value[id])
    .filter((asset): asset is MediaAsset => !!asset),
);
const activeCompositionId = ref("");
const activeComposition = computed(
  () =>
    project.value?.timelines.find(
      (composition) => composition.id === activeCompositionId.value,
    ) ?? project.value?.timelines.at(-1),
);
const compositionTitle = computed(
  () =>
    project.value?.stories.find(
      (story) => story.id === activeComposition.value?.storyId,
    )?.title ?? t("app.composition.fallbackTitle"),
);
const compositionStory = computed(() =>
  project.value?.stories.find(
    (story) => story.id === activeComposition.value?.storyId,
  ),
);
function beatActual(id: string) {
  return Math.max(
    0,
    ...(activeComposition.value?.tracks.map((track) =>
      track.clips
        .filter((clip) => clip.beatId === id)
        .reduce((sum, clip) => sum + clip.timelineDuration, 0),
    ) ?? [0]),
  );
}
const clipCount = computed(
  () =>
    activeComposition.value?.tracks.reduce(
      (sum, track) => sum + track.clips.length,
      0,
    ) ?? 0,
);
const previewVersion = ref(0);
const previewStale = ref(false);
const showRenderedPreview = ref(false);
const renderedPlayer = ref<HTMLVideoElement | null>(null);
const timelineEditor = ref<InstanceType<typeof TimelineEditor> | null>(null);
let editSerial = 0;

function editorChanged(state: EditorState) {
  if (!project.value) return;
  project.value = {
    ...project.value,
    stories: project.value.stories.map((story) =>
      story.id === state.story.id ? state.story : story,
    ),
    timelines: project.value.timelines.map((cut) =>
      cut.id === state.composition.id ? state.composition : cut,
    ),
  };
  cacheAssets(state.assets);
}
function editorEdited() {
  editSerial += 1;
  if (previewVersion.value) previewStale.value = true;
  if (exportPath.value) exportStale.value = true;
}
async function flushEditor() {
  if (!timelineEditor.value) return true;
  const saved = await timelineEditor.value.flush();
  if (!saved) error.value = message("feedback.flushFailed");
  return saved;
}
async function changeTab(next: Tab) {
  if (next === tab.value || relinkBusy.value || busy.value) return;
  if (beatDirty.value && !(await saveBeat())) return;
  if (next === "edit") {
    tab.value = next;
    if (!timelineEditor.value?.hasPending) await timelineEditor.value?.reload();
    return;
  }
  if (!(await flushEditor())) return;
  tab.value = next;
  if (next === "story" && !beatDirty.value) hydrateBeat();
  if (next === "library") await checkMediaStatus();
}
async function changeComposition(event: globalThis.Event) {
  const select = event.target as HTMLSelectElement;
  const next = select.value;
  select.value = activeComposition.value?.id ?? "";
  if (busy.value || relinkBusy.value) return;
  if (!(await flushEditor())) return;
  activeCompositionId.value = next;
  previewVersion.value = 0;
  previewStale.value = false;
  clearExport();
}
function toggleRenderedPlayback() {
  const player = renderedPlayer.value;
  if (!player) return;
  if (player.paused)
    void player.play().catch(() => {
      error.value = message("feedback.playbackFailed");
    });
  else player.pause();
}
const exportPath = ref("");
const exportFormat = ref("");
const exportFilename = ref("");
const exportReport = ref<ExportCompatibilityReport | undefined>();
const exportStale = ref(false);
function clearExport() {
  exportPath.value = "";
  exportFormat.value = "";
  exportFilename.value = "";
  exportReport.value = undefined;
  exportStale.value = false;
}
const native = !!window.__TAURI_INTERNALS__;
let poll: ReturnType<typeof setInterval> | undefined;
let polling = false;
let lastJobSignature = "";
let jobsGeneration = 0;

function cacheAssets(incoming: MediaAsset[], mutated = false) {
  const next = { ...assetCache.value };
  for (const asset of incoming) {
    next[asset.id] = asset;
    if (mutated)
      assetMutations.set(asset.id, (assetMutations.get(asset.id) ?? 0) + 1);
  }
  assetCache.value = next;
}
function cacheFetchedAssets(
  incoming: MediaAsset[],
  before: ReadonlyMap<string, number>,
): MediaAsset[] {
  const current = assetCache.value;
  // A read started before a selection/rating/relink change must not replace its
  // acknowledged result when that older response arrives later.
  const latest = incoming.map((asset) =>
    current[asset.id] && assetMutations.get(asset.id) !== before.get(asset.id)
      ? current[asset.id]!
      : asset,
  );
  cacheAssets(latest);
  return latest;
}
async function checkMediaStatus() {
  const projectId = project.value?.id;
  if (!projectId) return;
  const generation = ++statusGeneration;
  checkingMedia.value = true;
  mediaStatusError.value = "";
  try {
    const result = await api.mediaStatus();
    if (project.value?.id === projectId && generation === statusGeneration) {
      mediaStatus.value = result;
      if (libraryFilter.value === "missing") await reloadAssets();
    }
  } catch (cause) {
    if (generation === statusGeneration) mediaStatusError.value = cause;
  } finally {
    if (generation === statusGeneration) checkingMedia.value = false;
  }
}
async function openRelink(assetId?: string, libraryId?: string) {
  if (relinkBusy.value || busy.value || activeJobs.value.length) return;
  if (!(await flushEditor())) return;
  relinkAssetIds.value = assetId ? [assetId] : undefined;
  relinkLibraryId.value = libraryId;
  relinkOpen.value = true;
  importOpen.value = false;
  tab.value = "library";
  await checkMediaStatus();
}
async function beforeRelink() {
  if (busy.value || activeJobs.value.length) {
    error.value = message("feedback.waitJobs");
    return false;
  }
  return flushEditor();
}
async function mediaRelinked(updated: MediaAsset[]) {
  relinkRefreshing.value = true;
  try {
    cacheAssets(updated, true);
    const byId = new Map(updated.map((asset) => [asset.id, asset]));
    assets.value = assets.value.map((asset) => byId.get(asset.id) ?? asset);
    sourceVersion.value += 1;
    if (previewVersion.value) previewStale.value = true;
    if (exportPath.value) exportStale.value = true;
    await timelineEditor.value?.reload();
    await checkMediaStatus();
    notice.value = message("feedback.relinked", { count: updated.length });
  } finally {
    relinkRefreshing.value = false;
  }
}
async function refreshProject() {
  const result = await api.project();
  project.value = result.project;
  projectPath.value = result.path;
  connected.value = true;
}
async function reloadAssets() {
  if (!project.value) return;
  const projectId = project.value.id;
  const generation = ++assetsGeneration;
  const cachedBefore = new Map(assetMutations);
  const params = new URLSearchParams({
    offset: String(offset.value),
    limit: String(pageSize),
  });
  if (libraryFilter.value === "missing") {
    const ids = Object.values(sourceStatuses.value)
      .filter((status) => status.status !== "available")
      .map((status) => status.assetId);
    if (!ids.length) {
      assets.value = [];
      total.value = 0;
      offset.value = 0;
      return;
    }
    offset.value = Math.min(
      offset.value,
      Math.floor((ids.length - 1) / pageSize) * pageSize,
    );
    params.set(
      "ids",
      ids.slice(offset.value, offset.value + pageSize).join(","),
    );
    params.set("offset", "0");
  } else if (groupSelection.value) {
    params.set(
      "ids",
      groupSelection.value.assetIds
        .slice(offset.value, offset.value + pageSize)
        .join(","),
    );
    params.set("offset", "0");
  } else {
    if (search.value) params.set("search", search.value);
    if (stateFilter.value) params.set("state", stateFilter.value);
    if (mediaFilter.value) params.set("mediaType", mediaFilter.value);
  }
  const result = await api.assets(params);
  if (project.value?.id !== projectId || generation !== assetsGeneration)
    return;
  assets.value = cacheFetchedAssets(result.assets, cachedBefore);
  if (result.summary) librarySummary.value = result.summary;
  total.value =
    libraryFilter.value === "missing"
      ? Object.values(sourceStatuses.value).filter(
          (status) => status.status !== "available",
        ).length
      : (groupSelection.value?.assetIds.length ?? result.total);
}
async function run(label: string, action: () => Promise<void>) {
  if (busy.value) return false;
  busy.value = label;
  error.value = "";
  notice.value = null;
  try {
    await action();
    return true;
  } catch (cause) {
    error.value = cause;
    return false;
  } finally {
    busy.value = "";
  }
}
async function boot() {
  loading.value = true;
  await run("openingWorkspace", async () => {
    try {
      workspaceInfo.value = await api.workspace();
      await initializeLocale(workspaceInfo.value.systemLocale);
    } catch {
      await initializeLocale();
    }
    await refreshProject();
    await refreshRecents();
    if (project.value) {
      storyTitle.value = project.value.title;
      storyTemplate.value = project.value.filmSettings?.templateId ?? "blank";
      targetDuration.value = project.value.filmSettings?.targetDuration ?? 120;
      maxDuration.value = project.value.filmSettings?.maxDuration ?? 180;
      rememberProject();
      await reloadAssets();
      await refreshJobs();
      await checkMediaStatus();
    }
  });
  loading.value = false;
}
function readRecentProjects(): RecentProject[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem("openfilm.recentProjects.v1") ?? "[]",
    );
    return Array.isArray(value)
      ? value
          .filter(
            (item): item is RecentProject =>
              !!item &&
              typeof item.path === "string" &&
              typeof item.title === "string" &&
              typeof item.openedAt === "string",
          )
          .slice(0, 10)
          .map((item) => ({ ...item, status: "unchecked" }))
      : [];
  } catch {
    return [];
  }
}
async function refreshRecents() {
  if (!recentProjects.value.length) return;
  try {
    const result = await api.projectAvailability(
      recentProjects.value.map((item) => item.path),
    );
    recentProjects.value = recentProjects.value.map((item) => ({
      ...item,
      status:
        result.projects.find((entry) => entry.path === item.path)?.status ??
        "unchecked",
    }));
  } catch {
    /* A stored project can still be opened explicitly. */
  }
}
function rememberProject() {
  if (!project.value || !projectPath.value) return;
  recentProjects.value = [
    {
      path: projectPath.value,
      title: project.value.title,
      openedAt: new Date().toISOString(),
      status: "available" as const,
    },
    ...recentProjects.value.filter((item) => item.path !== projectPath.value),
  ].slice(0, 10);
  try {
    localStorage.setItem(
      "openfilm.recentProjects.v1",
      JSON.stringify(recentProjects.value),
    );
  } catch {
    /* Opening does not depend on preference storage. */
  }
}
async function resetProjectView() {
  statusGeneration += 1;
  jobsGeneration += 1;
  offset.value = 0;
  assetCache.value = {};
  mediaStatus.value = null;
  relinkOpen.value = false;
  sourceVersion.value += 1;
  selectedAssetId.value = "";
  groupSelection.value = null;
  libraryFilter.value = "all";
  libraryView.value = "all";
  search.value = "";
  stateFilter.value = "";
  mediaFilter.value = "";
  events.value = [];
  duplicates.value = [];
  analyzed.value = false;
  activeStoryId.value = "";
  activeCompositionId.value = "";
  beatDirty.value = false;
  previewVersion.value = 0;
  previewStale.value = false;
  clearExport();
  await refreshProject();
  storyTitle.value = project.value?.title ?? "";
  storyTemplate.value = project.value?.filmSettings?.templateId ?? "blank";
  storyTimingEdited.value = false;
  targetDuration.value = project.value?.filmSettings?.targetDuration ?? 120;
  maxDuration.value = project.value?.filmSettings?.maxDuration ?? 180;
  await reloadAssets();
  await refreshJobs();
  tab.value = "library";
  await checkMediaStatus();
  rememberProject();
}
async function createFilm(value: FilmCreation) {
  if (analysisRecoveryPending.value || !(await flushPending())) return;
  await run("creatingProject", async () => {
    await api.createProject(value);
    await resetProjectView();
    importOpen.value = true;
  });
}
async function openProject(path: string) {
  if (analysisRecoveryPending.value || !(await flushPending())) return;
  await run("openingProject", async () => {
    await post("/project/open", { path });
    await resetProjectView();
  });
}
async function beginImport(folder: string) {
  if (relinkBusy.value || !folder.trim()) return;
  await run("startingImport", async () => {
    await post("/import", { folder: folder.trim() });
    await importStarted();
  });
}
async function importStarted() {
  await refreshJobs();
  importOpen.value = false;
  notice.value = message("feedback.importStarted");
}
async function importFiles(paths: string[]) {
  if (relinkBusy.value || !paths.length) return;
  await run("startingImport", async () => {
    await api.importFiles(paths);
    await importStarted();
  });
}
async function uploadFiles(files: File[]) {
  if (busy.value || relinkBusy.value || !files.length) return;
  uploadController = new AbortController();
  uploading.value = true;
  await run("uploadingFiles", async () => {
    try {
      await api.uploadFiles(files, {
        signal: uploadController!.signal,
        onProgress: (progress) => {
          uploadProgress.value = progress;
        },
      });
      await importStarted();
    } finally {
      uploading.value = false;
      uploadProgress.value = undefined;
      uploadController = undefined;
    }
  });
}
async function flushPending() {
  if (!(await flushEditor())) return false;
  return beatDirty.value ? saveBeat() : true;
}
async function changeFilmLocale(locale: FilmLocale) {
  if (locale === project.value?.projectContentLocale || !(await flushPending()))
    return;
  await run("savingFilmLanguage", async () => {
    await api.updateProject({ projectContentLocale: locale });
    await refreshProject();
    await timelineEditor.value?.reload();
    hydrateBeat();
    notice.value = message("feedback.filmLanguageSaved");
  });
}
async function selectLibraryFilter(value: typeof libraryFilter.value) {
  libraryFilter.value = value;
  libraryView.value =
    value === "events" || value === "duplicates" ? value : "all";
  groupSelection.value = null;
  offset.value = 0;
  stateFilter.value = value === "favorite" || value === "rejected" ? value : "";
  if (value === "events" || value === "duplicates") {
    if (!analyzed.value) await analyze();
  } else await run("findingMedia", reloadAssets);
}
const workflowSteps = computed<WorkflowStep[]>(() => {
  const hasMedia = (mediaStatus.value?.assets.length ?? total.value) > 0;
  const hasStory = !!project.value?.stories.length;
  const hasEdit = !!activeComposition.value?.tracks.some(
    (track) => track.clips.length,
  );
  const complete = {
    media: hasMedia,
    organize: analyzed.value || hasStory,
    story: hasStory,
    edit: hasEdit,
    export: !!exportPath.value && !exportStale.value,
  };
  const current =
    tab.value === "library"
      ? hasMedia && !importOpen.value
        ? "organize"
        : "media"
      : tab.value;
  return (["media", "organize", "story", "edit", "export"] as const).map(
    (id) => ({
      id,
      state:
        id === "media" && (missingCount.value || inaccessibleCount.value)
          ? "attention"
          : id === current
            ? "current"
            : complete[id]
              ? "complete"
              : "not-started",
    }),
  );
});
async function navigateWorkflow(id: WorkflowStep["id"]) {
  if (id === "media" || id === "organize") {
    await changeTab("library");
    if (tab.value !== "library") return;
    if (id === "media") importOpen.value = true;
    else {
      importOpen.value = false;
      await selectLibraryFilter("events");
    }
  } else await changeTab(id);
}
async function refreshJobs() {
  const generation = ++jobsGeneration;
  const projectId = project.value?.id;
  const result = await api.jobs();
  if (generation === jobsGeneration && project.value?.id === projectId) {
    jobs.value = result.jobs;
    analysisRecovery.value = result.analysisRecovery ?? {};
  }
  return project.value?.id === projectId ? result.jobs : undefined;
}
async function pollJobs() {
  if (!project.value || polling) return;
  const generation = ++jobsGeneration;
  const projectId = project.value.id;
  polling = true;
  try {
    const result = await api.jobs();
    if (generation !== jobsGeneration || project.value?.id !== projectId)
      return;
    const newlyImported = result.jobs.some(
      (job) =>
        job.type === "import" &&
        ["completed", "failed", "cancelled"].includes(job.status) &&
        jobs.value.find((previous) => previous.id === job.id)?.status !==
          job.status,
    );
    const workflowChanged = result.jobs.some(
      (job) =>
        (job.type === "import" || job.type === "render") &&
        !jobs.value.some(
          (previous) =>
            previous.id === job.id &&
            previous.status === job.status &&
            previous.progress === job.progress,
        ),
    );
    jobs.value = result.jobs;
    analysisRecovery.value = result.analysisRecovery ?? {};
    const signature = result.jobs
      .map((job) => `${job.id}:${job.status}:${job.progress}`)
      .join("|");
    if (signature !== lastJobSignature) {
      lastJobSignature = signature;
      if (workflowChanged) {
        await reloadAssets();
        await refreshProject();
      }
      if (newlyImported) await checkMediaStatus();
    }
  } catch {
    /* A transient disconnect must not replace an in-progress edit. */
  } finally {
    polling = false;
  }
}
async function toggleAsset(asset: MediaAsset, key: AssetState) {
  await run("savingSelection", async () => {
    const result = await patch<{ asset: MediaAsset }>(
      `/assets/${encodeURIComponent(asset.id)}`,
      { state: { [key]: !(assetCache.value[asset.id] ?? asset).state[key] } },
    );
    cacheAssets([result.asset], true);
    assets.value = assets.value.map((item) =>
      item.id === asset.id ? result.asset : item,
    );
    if (stateFilter.value) await reloadAssets();
  });
}
async function rateAsset(asset: MediaAsset, rating: number) {
  await run("savingRating", async () => {
    const result = await patch<{ asset: MediaAsset }>(
      `/assets/${encodeURIComponent(asset.id)}`,
      { rating },
    );
    cacheAssets([result.asset], true);
    assets.value = assets.value.map((item) =>
      item.id === asset.id ? result.asset : item,
    );
  });
}
async function applyFilters() {
  offset.value = 0;
  groupSelection.value = null;
  await run("findingMedia", reloadAssets);
}
async function changePage(direction: number) {
  offset.value = Math.max(0, offset.value + direction * pageSize);
  await run("loadingMedia", reloadAssets);
}
async function analyze() {
  await run("findingMoments", async () => {
    const result = await api.analyze();
    events.value = result.events;
    duplicates.value = result.duplicates;
    analyzed.value = true;
    notice.value = message("feedback.organized");
  });
}
async function openGroup(group: {
  title: string;
  assetIds: string[];
  kind?: "exact" | "perceptual";
  index?: number;
}) {
  groupSelection.value = group;
  offset.value = 0;
  await run("openingMoment", reloadAssets);
}
async function createStory() {
  if (!(await flushPending())) return;
  if (!storyTitle.value.trim()) {
    error.value = message("feedback.storyName");
    return;
  }
  if (!(targetDuration.value > 0) || maxDuration.value < targetDuration.value) {
    error.value = message("feedback.durationInvalid");
    return;
  }
  await run("planningStory", async () => {
    const { story } = await api.createStory({
      title: storyTitle.value.trim(),
      template: storyTemplate.value,
      targetDuration: Number(targetDuration.value),
      maxDuration: Number(maxDuration.value),
      ...(storyScope.value === "page"
        ? { assetIds: assets.value.map((asset) => asset.id) }
        : {}),
    });
    await refreshProject();
    activeStoryId.value = story.id;
    activeBeatIndex.value = 0;
    storyCreateOpen.value = false;
    tab.value = "story";
  });
}
async function loadCandidates() {
  await loadAssetIds([
    ...candidateIds.value.slice(
      candidateOffset.value,
      candidateOffset.value + 24,
    ),
    ...beatDraft.value.selectedAssetIds,
  ]);
}
async function loadAssetIds(requested: string[]) {
  const projectId = project.value?.id;
  const ids = [...new Set(requested)].filter((id) => !assetCache.value[id]);
  if (!ids.length) return;
  for (let index = 0; index < ids.length; index += 200) {
    const batch = ids.slice(index, index + 200);
    const result = await api.assets(
      new URLSearchParams({
        ids: batch.join(","),
        limit: String(batch.length),
      }),
    );
    if (project.value?.id !== projectId) return;
    // Another beat/read or an edit may have filled the cache while this batch
    // was pending. Hydration only fills entries that are still missing.
    cacheAssets(result.assets.filter((asset) => !assetCache.value[asset.id]));
  }
}
function hydrateBeat() {
  const beat = activeBeat.value;
  beatDraft.value = {
    title: beat?.title ?? "",
    intent: beat?.intent ?? "",
    targetDuration: beat?.targetDuration ?? 0,
    selectedAssetIds: [...(beat?.selectedAssetIds ?? [])],
  };
  beatDirty.value = false;
  candidateOffset.value = 0;
}
watch(
  () => `${activeStory.value?.id ?? ""}:${activeBeat.value?.id ?? ""}`,
  async () => {
    hydrateBeat();
    try {
      await loadCandidates();
    } catch (cause) {
      error.value = cause;
    }
  },
);
function chooseCandidate(asset: MediaAsset) {
  if (asset.state.rejected) {
    error.value = message("feedback.restoreFirst");
    return;
  }
  const selected = beatDraft.value.selectedAssetIds;
  beatDraft.value.selectedAssetIds = selected.includes(asset.id)
    ? selected.filter((id) => id !== asset.id)
    : [...selected, asset.id];
  beatDirty.value = true;
}
async function changeStory(event: globalThis.Event) {
  const select = event.target as HTMLSelectElement;
  const next = select.value;
  select.value = activeStory.value?.id ?? "";
  if (busy.value || relinkBusy.value || !(await flushPending())) return;
  activeStoryId.value = next;
  activeBeatIndex.value = 0;
}
async function refreshSuggestions() {
  const storyId = activeStory.value?.id;
  const beatId = activeBeat.value?.id;
  if (!storyId || !beatId || !(await flushPending())) return;
  await run("refreshingSuggestions", async () => {
    await api.refreshSuggestions(storyId, beatId);
    await refreshProject();
    hydrateBeat();
    await loadCandidates();
    await timelineEditor.value?.reload();
    notice.value = message("feedback.suggestionsRefreshed");
  });
}
async function saveBeat(): Promise<boolean> {
  if (!(await flushEditor())) return false;
  const story = activeStory.value;
  const beat = activeBeat.value;
  if (!story || !beat) return true;
  const draft = {
    ...beatDraft.value,
    selectedAssetIds: [...beatDraft.value.selectedAssetIds],
  };
  const savedSignature = JSON.stringify(draft);
  if (!draft.title.trim() || !(draft.targetDuration > 0)) {
    error.value = message("feedback.beatInvalid");
    return false;
  }
  const saved = await run("savingBeat", async () => {
    const updated: StoryBeat = {
      ...beat,
      title: draft.title.trim(),
      intent: draft.intent.trim(),
      targetDuration: Number(draft.targetDuration),
      selectedAssetIds: draft.selectedAssetIds,
    };
    const beats = story.beats.map((item) =>
      item.id === beat.id ? updated : item,
    );
    await patch<{ story: Story }>(`/stories/${encodeURIComponent(story.id)}`, {
      beats,
    });
    await refreshProject();
    await timelineEditor.value?.reload();
    if (
      activeStory.value?.id === story.id &&
      activeBeat.value?.id === beat.id &&
      JSON.stringify(beatDraft.value) === savedSignature
    ) {
      beatDirty.value = false;
      notice.value = message("feedback.beatSaved");
    }
  });
  return saved && !beatDirty.value;
}
async function compose() {
  if (!(await flushEditor())) return;
  const story = activeStory.value;
  if (!story) return;
  if (beatDirty.value) {
    error.value = message("feedback.saveBeat");
    return;
  }
  await run("composingFilm", async () => {
    const { composition } = await api.compose(story.id);
    activeCompositionId.value = composition.id;
    clearExport();
    await refreshProject();
    previewVersion.value = 0;
    tab.value = "edit";
    const ids = [
      ...new Set(
        composition.tracks.flatMap((track) =>
          track.clips.map((clip) => clip.assetId),
        ),
      ),
    ];
    await loadAssetIds(ids);
  });
}
async function renderPreview() {
  if (!(await flushPending())) return;
  const renderingEdit = editSerial;
  const renderingProject = project.value?.id;
  const composition = activeComposition.value;
  if (!composition) return;
  await run("renderingPreview", async () => {
    renderCancellationRequested.value = null;
    try {
      await post<{ path: string }>("/render", {
        compositionId: composition.id,
      });
    } catch (cause) {
      let renderJobs: Job[] | undefined;
      try {
        renderJobs = await refreshJobs();
      } catch {
        /* Preserve the render failure. */
      }
      if (
        renderCancellationRequested.value &&
        project.value?.id === renderingProject &&
        renderJobs?.some(
          (job) =>
            job.id === renderCancellationRequested.value &&
            job.type === "render" &&
            job.status === "cancelled",
        )
      ) {
        notice.value = message("feedback.renderCancelled");
        return;
      }
      throw cause;
    } finally {
      try {
        await refreshJobs();
      } catch {
        /* Polling will retry without replacing the render result. */
      }
    }
    previewVersion.value = Date.now();
    previewStale.value = renderingEdit !== editSerial;
    showRenderedPreview.value = true;
    notice.value = message("feedback.previewReady");
  });
}
async function exportFilm(format: string) {
  if (!(await flushPending())) return;
  const exportingEdit = editSerial;
  const exportingProject = project.value?.id;
  const composition = activeComposition.value;
  if (!composition) return;
  await run("exportingTimeline", async () => {
    renderCancellationRequested.value = null;
    let result: {
      path: string;
      filename?: string;
      report?: ExportCompatibilityReport;
    };
    try {
      result = await post("/export", { format, compositionId: composition.id });
    } catch (cause) {
      let renderJobs: Job[] | undefined;
      try {
        renderJobs = await refreshJobs();
      } catch {
        /* Preserve the export result. */
      }
      if (
        renderCancellationRequested.value &&
        project.value?.id === exportingProject &&
        renderJobs?.some(
          (job) =>
            job.id === renderCancellationRequested.value &&
            job.type === "render" &&
            job.status === "cancelled",
        )
      ) {
        notice.value = message("feedback.renderCancelled");
        return;
      }
      throw cause;
    } finally {
      try {
        await refreshJobs();
      } catch {
        /* Polling retries. */
      }
    }
    if (
      project.value?.id !== exportingProject ||
      activeComposition.value?.id !== composition.id
    )
      return;
    exportPath.value = result.path;
    exportFilename.value = result.filename ?? "";
    exportFormat.value = format;
    exportReport.value = result.report;
    exportStale.value = exportingEdit !== editSerial;
    notice.value = message("feedback.exported");
  });
}
function jobTitle(job: Job): string {
  if (["glossary-review", "language-review"].includes(job.type)) {
    const kind =
      job.type === "glossary-review" ? "glossaryReview" : "languageReview";
    return `${t(`transcript.jobTypes.${kind}`)} · ${t(`precision.jobStatuses.${job.status}`)}`;
  }
  if (["transcribe", "waveform", "scenes"].includes(job.type))
    return `${t(`precision.jobTypes.${job.type}`)} · ${t(`precision.jobStatuses.${job.status}`)}`;
  const kind = job.type === "render" ? "render" : "import";
  const status =
    job.status === "completed"
      ? "complete"
      : job.status === "queued" && kind === "import"
        ? "running"
        : job.status;
  return t(`app.activity.${kind}.${status}`);
}
async function cancelJob(job: Job) {
  if (cancellingJobs.value[job.id]) return;
  const cancellingProject = project.value?.id;
  cancellingJobs.value = { ...cancellingJobs.value, [job.id]: true };
  if (job.type === "render") renderCancellationRequested.value = job.id;
  try {
    await post(`/jobs/${encodeURIComponent(job.id)}/cancel`);
    if (project.value?.id !== cancellingProject) return;
    try {
      await refreshJobs();
    } catch {
      /* The cancel was acknowledged; polling will refresh its status. */
    }
  } catch (cause) {
    if (
      project.value?.id === cancellingProject &&
      (job.type !== "render" || renderCancellationRequested.value === job.id)
    ) {
      if (job.type === "render") renderCancellationRequested.value = null;
      error.value = cause;
    }
  } finally {
    cancellingJobs.value = { ...cancellingJobs.value, [job.id]: false };
  }
}
async function recoverAnalysis(job: Job, input: AnalysisRecoveryInput) {
  const projectId = project.value?.id;
  const generation = analysisRecoveryGeneration;
  const current = () =>
    project.value?.id === projectId &&
    analysisRecoveryGeneration === generation;
  const inspected = analysisRecovery.value[job.id];
  if (
    !projectId ||
    busy.value ||
    analysisRecoveryPending.value ||
    input.confirmStopped !== true ||
    !inspected?.manualRecoveryAllowed ||
    inspected.jobId !== job.id ||
    inspected.ownerState === "alive" ||
    inspected.canCancel ||
    inspected.checkpoint !== input.checkpoint ||
    inspected.ownerToken !== input.ownerToken
  )
    return;
  recoveringAnalysisJobs.value = {
    ...recoveringAnalysisJobs.value,
    [job.id]: true,
  };
  try {
    await api.recoverAnalysis(job.id, input);
    if (!current()) return;
    // Recovery changes job ownership only. A manual transcript draft remains
    // in its existing queue; explicit re-transcription still flushes it first.
    await refreshJobs();
    if (current()) notice.value = { uiKey: "precision.recovery.recovered" };
  } catch (cause) {
    if (current()) error.value = cause;
  } finally {
    if (current())
      recoveringAnalysisJobs.value = {
        ...recoveringAnalysisJobs.value,
        [job.id]: false,
      };
  }
}
function progress(job: Job) {
  return Math.round(Math.max(0, Math.min(1, job.progress ?? 0)) * 100);
}
async function changeWorkspace() {
  if (projectSwitchBlocked.value) return;
  const closingProject = project.value?.id;
  const closingGeneration = analysisRecoveryGeneration;
  const current = () =>
    project.value?.id === closingProject &&
    analysisRecoveryGeneration === closingGeneration;
  if (!(await flushPending()) || !current() || projectSwitchBlocked.value)
    return;
  await run("closingProject", async () => {
    // A transcription submission can finish while its draft is being flushed,
    // before Activity polling publishes the new local job. Check this response
    // itself; a concurrent poll may have superseded its UI publication.
    const latest = await api.jobs();
    if (
      !current() ||
      relinkBusy.value ||
      analysisRecoveryPending.value ||
      latest.jobs.some((job) =>
        jobBlocksProjectSwitch(job, latest.analysisRecovery?.[job.id]),
      )
    )
      return;
    await post("/project/close");
    statusGeneration += 1;
    jobsGeneration += 1;
    mediaStatus.value = null;
    checkingMedia.value = false;
    relinkOpen.value = false;
    clearExport();
    project.value = null;
    projectPath.value = null;
    importOpen.value = false;
    await refreshRecents();
  });
}
function lastSourceFolder(uri: string): string {
  try {
    const path = decodeURIComponent(uri).replace(/^file:\/\//, "");
    return path.split(/[\\/]/).slice(-2, -1)[0] ?? path;
  } catch {
    return uri;
  }
}
function inspectAsset(asset: MediaAsset) {
  selectedAssetId.value = asset.id;
}
function handleKeyboard(event: KeyboardEvent) {
  if (settingsOpen.value) return;
  if (event.key === "Escape") {
    selectedAssetId.value = "";
    importOpen.value = false;
    storyCreateOpen.value = false;
  }
}
onMounted(async () => {
  await boot();
  poll = setInterval(() => {
    void pollJobs();
  }, 1000);
  window.addEventListener("keydown", handleKeyboard);
});
onUnmounted(() => {
  if (poll) clearInterval(poll);
  window.removeEventListener("keydown", handleKeyboard);
});
</script>

<template>
  <div
    class="film-workspace"
    :class="{ 'editing-room': tab === 'edit' || tab === 'export' }"
  >
    <header class="app-header">
      <a
        class="wordmark"
        href="#"
        :aria-label="t('app.navigation.home')"
        @click.prevent="changeTab('library')"
        ><span class="logo-bracket">[</span>OpenFilm<span class="logo-bracket"
          >]</span
        ></a
      >
      <nav
        v-if="project"
        :aria-label="t('app.navigation.label')"
        class="main-nav"
      >
        <button
          v-for="item in tabs"
          :key="item"
          :class="{ current: tab === item }"
          :aria-current="tab === item ? 'page' : undefined"
          :disabled="!!busy || relinkBusy"
          @click="changeTab(item)"
        >
          {{ t(`app.navigation.${item}`) }}
        </button>
      </nav>
      <label class="ui-language"
        ><span class="sr-only">{{ t("app.settings.language") }}</span
        ><select
          :value="uiLocale"
          @change="setUiLocale(($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="item in interfaceLocales"
            :key="item.code"
            :value="item.code"
          >
            {{ item.label }}
          </option>
        </select></label
      >
      <button class="text-button settings-toggle" @click="settingsOpen = true">
        {{ t("app.settings.title") }}
      </button>
      <span class="local-label"
        ><span class="status-dot" :class="{ disconnected: !connected }" />{{
          connected ? t("app.navigation.local") : t("app.navigation.workspace")
        }}</span
      >
    </header>

    <div v-if="error" class="feedback error" role="alert">
      <Icon name="reject" /><span
        >{{ errorMessage }}
        <details v-if="errorDetails" class="error-details">
          <summary>{{ t("app.actions.details") }}</summary>
          <pre>{{ errorDetails }}</pre>
        </details></span
      ><button :aria-label="t('app.actions.dismissError')" @click="error = ''">
        <Icon name="reject" :size="16" />
      </button>
    </div>
    <div v-if="notice" class="feedback success" role="status">
      <Icon name="check" /><span>{{ noticeMessage }}</span
      ><button
        :aria-label="t('app.actions.dismissMessage')"
        @click="notice = null"
      >
        <Icon name="reject" :size="16" />
      </button>
    </div>

    <AppLauncher
      v-if="!project"
      :busy="!!busy || loading"
      :recent="recentProjects"
      :default-root="defaultRoot"
      :templates="workspaceInfo?.templates ?? []"
      :native="native"
      :connected="connected"
      @create="createFilm"
      @open="openProject"
      @retry="boot"
    />

    <main v-else class="workspace-content" :class="`workspace-${tab}`">
      <WorkflowProgress
        :steps="workflowSteps"
        :disabled="!!busy || relinkBusy"
        @navigate="navigateWorkflow"
      />
      <div
        class="project-heading"
        :class="{ 'project-heading-compact': tab === 'edit' }"
      >
        <div v-if="tab !== 'edit'">
          <h1>
            {{
              tab === "library"
                ? project.title
                : tab === "story"
                  ? t("app.story.heading")
                  : t("app.export.heading")
            }}
          </h1>
          <p v-if="tab === 'library'">{{ t("app.library.description") }}</p>
          <p v-if="tab === 'story'">{{ t("app.story.description") }}</p>
          <p v-if="tab === 'export'">
            {{ t("app.export.headingDescription") }}
          </p>
        </div>
        <div class="project-heading-actions">
          <button
            class="text-button project-switch"
            :disabled="projectSwitchBlocked"
            @click="changeWorkspace"
          >
            <Icon name="folder" :size="15" />{{
              t("app.navigation.switchProject")
            }}</button
          ><button
            v-if="tab === 'library'"
            class="primary"
            :disabled="!!busy || relinkBusy"
            @click="importOpen = !importOpen"
          >
            <Icon name="plus" />{{ t("app.library.add") }}</button
          ><button
            v-if="
              tab === 'library' &&
              (total > 0 || (mediaStatus?.assets.length ?? 0) > 0)
            "
            class="secondary"
            :disabled="!!busy || activeJobs.length > 0 || relinkBusy"
            @click="openRelink()"
          >
            <Icon name="refresh" :size="16" />{{
              t("app.library.relink")
            }}</button
          ><button
            v-if="tab === 'story'"
            class="primary"
            :disabled="!!busy"
            @click="storyCreateOpen = !storyCreateOpen"
          >
            <Icon name="plus" />{{ t("app.story.new") }}
          </button>
        </div>
      </div>

      <RelinkMedia
        v-if="relinkOpen && tab === 'library'"
        :key="`${project.id}:${relinkAssetIds?.join(',') ?? relinkLibraryId ?? 'all'}`"
        :assets="Object.values(assetCache)"
        :asset-ids="relinkAssetIds"
        :library-id="relinkLibraryId"
        :libraries="mediaStatus?.libraries"
        :blocked="!!busy || activeJobs.length > 0"
        :before-action="beforeRelink"
        @close="relinkOpen = false"
        @applied="mediaRelinked"
        @working="relinkPanelBusy = $event"
      />

      <ImportPanel
        v-if="importOpen"
        :native="native"
        :busy="!!busy || activeJobs.length > 0"
        :progress="uploadProgress"
        @folder="beginImport"
        @files="importFiles"
        @upload="uploadFiles"
        @error="error = $event"
        @cancel="uploadController?.abort()"
        @close="importOpen = false"
      />

      <section
        v-if="
          activeJobs.length ||
          (recentJob && (tab === 'library' || recentJob.status !== 'completed'))
        "
        class="jobs activity-strip"
        :aria-label="t('app.activity.label')"
      >
        <div
          v-for="job in activeJobs.length
            ? activeJobs
            : recentJob
              ? [recentJob]
              : []"
          :key="job.id"
          class="job-row"
        >
          <div class="job-summary">
            <Icon
              :name="
                job.type === 'render'
                  ? 'film'
                  : ['glossary-review', 'language-review'].includes(job.type)
                    ? 'search'
                    : 'folder'
              "
              :size="17"
            />
            <strong>{{ jobTitle(job) }}</strong>
            <span class="job-status">{{
              job.status === "running" || job.status === "queued"
                ? job.type === "import" || (job.progress ?? 0) > 0
                  ? `${progress(job)}%`
                  : t("app.activity.inProgress")
                : t(`app.activity.status.${job.status}`)
            }}</span>
          </div>
          <progress
            v-if="job.status === 'running' || job.status === 'queued'"
            :value="
              job.type === 'import' || (job.progress ?? 0) > 0
                ? progress(job)
                : undefined
            "
            max="100"
            :aria-label="
              job.type === 'render'
                ? t('app.activity.previewProgress')
                : ['transcribe', 'waveform', 'scenes'].includes(job.type)
                  ? t('precision.analysis')
                  : ['glossary-review', 'language-review'].includes(job.type)
                    ? t('transcript.jobStages.reviewing')
                    : t('app.activity.importProgress')
            "
          />
          <AnalysisJobActions
            v-if="['transcribe', 'waveform', 'scenes'].includes(job.type)"
            :project-id="project.id"
            :job="job"
            :recovery="analysisRecovery[job.id]"
            :pending="cancellingJobs[job.id] || recoveringAnalysisJobs[job.id]"
            :disabled="!!busy"
            :cancel-label="t('precision.cancel')"
            @cancel="cancelJob(job)"
            @recover="recoverAnalysis(job, $event)"
          />
          <button
            v-else-if="job.status === 'running' || job.status === 'queued'"
            class="text-button"
            :disabled="cancellingJobs[job.id]"
            @click="cancelJob(job)"
          >
            {{
              cancellingJobs[job.id]
                ? t("app.activity.cancelling")
                : [
                      "transcribe",
                      "waveform",
                      "scenes",
                      "glossary-review",
                      "language-review",
                    ].includes(job.type)
                  ? t("precision.cancel")
                  : job.type === "render"
                    ? t("app.activity.cancelRender")
                    : t("app.activity.cancelImport")
            }}
          </button>
          <details v-if="job.errors?.length" class="job-errors">
            <summary>
              {{
                t(
                  "app.activity.attention",
                  { count: formatNumber(job.errors.length) },
                  job.errors.length,
                )
              }}
            </summary>
            <ul>
              <li v-for="(problem, index) in job.errors" :key="index">
                <strong :title="problem.uri">{{
                  problem.uri.split(/[\\/]/).at(-1)
                }}</strong>
                ·
                {{ localizeError(problem) }}
                <details v-if="errorDetail(problem)">
                  <summary>{{ t("app.actions.details") }}</summary>
                  <pre>{{ errorDetail(problem) }}</pre>
                </details>
              </li>
            </ul>
          </details>
        </div>
      </section>

      <template v-if="tab === 'library'">
        <div class="library-workspace">
          <nav class="library-sidebar" :aria-label="t('app.library.view')">
            <button
              v-for="filter in [
                'all',
                'events',
                'duplicates',
                'favorite',
                'rejected',
                'missing',
              ] as const"
              :key="filter"
              :class="{ active: libraryFilter === filter }"
              :aria-current="libraryFilter === filter ? 'page' : undefined"
              :disabled="!!busy"
              @click="selectLibraryFilter(filter)"
            >
              {{ t(`app.library.${filter}`)
              }}<span v-if="filter === 'missing'">{{
                formatNumber(missingCount + inaccessibleCount)
              }}</span>
            </button>
          </nav>
          <div class="library-main">
            <section
              v-if="
                total > 0 ||
                (mediaStatus?.assets.length ?? 0) > 0 ||
                mediaStatusError
              "
              class="media-availability"
              :class="{
                unavailable:
                  missingCount || inaccessibleCount || offlineLibraries.length,
                healthy:
                  mediaStatus &&
                  !missingCount &&
                  !inaccessibleCount &&
                  !offlineLibraries.length,
              }"
              :aria-label="t('app.library.availability')"
            >
              <div class="media-availability-summary">
                <div>
                  <strong v-if="missingCount || inaccessibleCount">{{
                    t(
                      "app.library.offlineCount",
                      { count: formatNumber(missingCount + inaccessibleCount) },
                      missingCount + inaccessibleCount,
                    )
                  }}</strong
                  ><strong v-else>{{
                    checkingMedia
                      ? t("app.library.checking")
                      : mediaStatus
                        ? t("app.library.available")
                        : t("app.library.notChecked")
                  }}</strong>
                  <p v-if="missingCount || inaccessibleCount">
                    {{ t("app.library.offlineHint") }}
                  </p>
                  <p v-else-if="mediaStatus">
                    {{
                      t(
                        "app.library.checked",
                        { count: formatNumber(mediaStatus.assets.length) },
                        mediaStatus.assets.length,
                      )
                    }}
                  </p>
                  <p v-if="mediaStatusError" role="alert">
                    {{ uiMessage(mediaStatusError) }}
                  </p>
                </div>
                <button
                  class="secondary"
                  :disabled="checkingMedia || relinkBusy"
                  @click="checkMediaStatus"
                >
                  <Icon name="refresh" :size="14" />{{
                    checkingMedia
                      ? t("app.library.checkingShort")
                      : t("app.library.checkAgain")
                  }}
                </button>
              </div>
              <div
                v-for="library in offlineLibraries"
                :key="library.id"
                class="library-availability"
              >
                <span
                  ><strong>{{
                    library.status === "offline"
                      ? t("app.library.offline")
                      : t("app.library.partial")
                  }}</strong>
                  · {{ library.name
                  }}<small>{{ library.roots.join(" · ") }}</small></span
                ><button
                  class="text-button"
                  :aria-label="
                    t('app.library.relinkLibrary', { name: library.name })
                  "
                  :disabled="!!busy || activeJobs.length > 0 || relinkBusy"
                  @click="openRelink(undefined, library.id)"
                >
                  {{ t("app.library.locate") }}<Icon name="arrow" :size="14" />
                </button>
              </div>
            </section>
            <div class="library-toolbar">
              <p class="library-summary">
                {{
                  t("app.library.summary", {
                    photos: t(
                      "app.library.photoCount",
                      { count: formatNumber(librarySummary.images) },
                      librarySummary.images,
                    ),
                    videos: t(
                      "app.library.videoCount",
                      { count: formatNumber(librarySummary.videos) },
                      librarySummary.videos,
                    ),
                    audio: t(
                      "app.library.audioCount",
                      { count: formatNumber(librarySummary.audio) },
                      librarySummary.audio,
                    ),
                  })
                }}
              </p>
              <button class="text-button" :disabled="!!busy" @click="analyze">
                <Icon name="grid" :size="15" />{{
                  t(
                    busy === "findingMoments"
                      ? "app.activity.tasks.findingMoments"
                      : "app.library.findMoments",
                  )
                }}
              </button>
            </div>
            <template v-if="libraryView === 'all' || groupSelection">
              <div v-if="groupSelection" class="group-heading">
                <button class="text-button" @click="groupSelection = null">
                  <Icon name="chevron" class="reverse" :size="15" />{{
                    t("app.library.backGroups")
                  }}
                </button>
                <h2>{{ groupHeading }}</h2>
              </div>
              <form
                v-else-if="libraryFilter !== 'missing'"
                class="filter-bar"
                @submit.prevent="applyFilters"
              >
                <label class="search-field"
                  ><Icon name="search" :size="16" /><input
                    v-model="search"
                    :aria-label="t('app.library.search')"
                    :placeholder="t('app.library.searchPlaceholder')"
                  /><button type="submit" class="text-button">
                    {{ t("app.actions.search") }}
                  </button></label
                ><select
                  v-model="mediaFilter"
                  :aria-label="t('app.library.mediaType')"
                  @change="applyFilters"
                >
                  <option value="">{{ t("app.library.allTypes") }}</option>
                  <option value="image">{{ t("app.library.photos") }}</option>
                  <option value="video">{{ t("app.library.videos") }}</option>
                  <option value="audio">{{ t("app.library.audio") }}</option>
                  <option value="360-video">
                    {{ t("app.library.video360") }}
                  </option></select
                ><select
                  v-model="stateFilter"
                  :aria-label="t('app.library.selections')"
                  @change="applyFilters"
                >
                  <option value="">{{ t("app.library.allSelections") }}</option>
                  <option value="favorite">
                    {{ t("app.library.favorite") }}
                  </option>
                  <option value="locked">{{ t("app.library.locked") }}</option>
                  <option value="rejected">
                    {{ t("app.library.rejected") }}
                  </option>
                </select>
              </form>
              <div
                class="library-layout"
                :class="{ inspecting: selectedAsset }"
              >
                <section
                  v-if="assets.length"
                  class="contact-sheet"
                  :aria-label="t('app.library.collection')"
                >
                  <AssetCard
                    v-for="asset in assets"
                    :key="asset.id"
                    :asset="asset"
                    :source-status="sourceStatuses[asset.id]"
                    :selected="selectedAssetId === asset.id"
                    @select="inspectAsset"
                    @toggle="toggleAsset"
                  />
                </section>
                <div v-else class="empty-state library-empty">
                  <span class="empty-symbol"
                    ><Icon name="film" :size="30"
                  /></span>
                  <h2>
                    {{
                      libraryFilter === "missing"
                        ? t("app.library.available")
                        : search || stateFilter || mediaFilter
                          ? t("app.library.noMatch")
                          : t("app.library.emptyTitle")
                    }}
                  </h2>
                  <p>
                    {{
                      libraryFilter === "missing"
                        ? t(
                            "app.library.checked",
                            {
                              count: formatNumber(
                                mediaStatus?.assets.length ?? 0,
                              ),
                            },
                            mediaStatus?.assets.length ?? 0,
                          )
                        : search || stateFilter || mediaFilter
                          ? t("app.library.noMatchHint")
                          : t("app.library.emptyHint")
                    }}
                  </p>
                  <button
                    v-if="
                      libraryFilter === 'all' &&
                      librarySummary.total === 0 &&
                      !search &&
                      !stateFilter &&
                      !mediaFilter
                    "
                    class="primary"
                    @click="importOpen = true"
                  >
                    <Icon name="plus" />{{ t("app.library.addFirst") }}
                  </button>
                </div>
                <aside
                  v-if="selectedAsset"
                  class="asset-inspector"
                  :aria-label="t('app.inspector.label')"
                >
                  <div class="inspector-title">
                    <span>{{ t("app.inspector.label") }}</span
                    ><button
                      class="icon-button"
                      :aria-label="t('app.inspector.close')"
                      @click="selectedAssetId = ''"
                    >
                      <Icon name="reject" :size="16" />
                    </button>
                  </div>
                  <img
                    v-if="selectedAsset.thumbnailUri"
                    crossorigin="anonymous"
                    :src="thumbnailUrl(selectedAsset.id)"
                    :alt="selectedAsset.name"
                  />
                  <h2>{{ selectedAsset.name }}</h2>
                  <p class="muted">
                    {{ dateLabel(selectedAsset.capturedAt) }}
                  </p>
                  <details class="inspector-technical">
                    <summary>{{ t("app.actions.details") }}</summary>
                    <dl>
                      <div>
                        <dt>{{ t("app.inspector.type") }}</dt>
                        <dd>
                          {{
                            t(
                              `app.library.${selectedAsset.mediaType === "image" ? "photos" : selectedAsset.mediaType === "audio" ? "audio" : selectedAsset.mediaType === "360-video" ? "video360" : "videos"}`,
                            )
                          }}
                        </dd>
                      </div>
                      <div v-if="selectedAsset.dimensions">
                        <dt>{{ t("app.inspector.size") }}</dt>
                        <dd>
                          {{ selectedAsset.dimensions.width }} ×
                          {{ selectedAsset.dimensions.height }}
                        </dd>
                      </div>
                      <div v-if="selectedAsset.duration !== undefined">
                        <dt>{{ t("app.inspector.duration") }}</dt>
                        <dd>{{ duration(selectedAsset.duration) }}</dd>
                      </div>
                      <div>
                        <dt>{{ t("app.inspector.dateSource") }}</dt>
                        <dd>
                          {{
                            selectedAsset.capturedAtSource ||
                            t("app.inspector.unknown")
                          }}
                        </dd>
                      </div>
                      <div
                        v-if="selectedAsset.capturedAtConfidence !== undefined"
                      >
                        <dt>{{ t("app.inspector.dateConfidence") }}</dt>
                        <dd>
                          {{
                            formatNumber(selectedAsset.capturedAtConfidence, {
                              style: "percent",
                            })
                          }}
                        </dd>
                      </div>
                    </dl>
                  </details>
                  <SourceDetails :asset="selectedAsset" />
                  <div class="rating-control">
                    <span>{{ t("app.inspector.rating") }}</span>
                    <div>
                      <button
                        v-for="rating in 5"
                        :key="rating"
                        :class="{
                          active: (selectedAsset.rating ?? 0) >= rating,
                        }"
                        :aria-label="
                          t('app.inspector.rate', { count: rating }, rating)
                        "
                        :aria-pressed="selectedAsset.rating === rating"
                        :disabled="!!busy"
                        @click="rateAsset(selectedAsset, rating)"
                      >
                        <Icon name="star" :size="20" /></button
                      ><button
                        v-if="selectedAsset.rating"
                        class="text-button clear-rating"
                        :aria-label="t('app.inspector.clearRating')"
                        @click="rateAsset(selectedAsset, 0)"
                      >
                        {{ t("app.actions.clear") }}
                      </button>
                    </div>
                  </div>
                  <div class="inspector-controls">
                    <button
                      :aria-pressed="!!selectedAsset.state.favorite"
                      :class="{ active: selectedAsset.state.favorite }"
                      @click="toggleAsset(selectedAsset, 'favorite')"
                    >
                      <Icon name="heart" :size="16" />{{
                        t("app.inspector.favorite")
                      }}</button
                    ><button
                      :aria-pressed="!!selectedAsset.state.locked"
                      :class="{ active: selectedAsset.state.locked }"
                      @click="toggleAsset(selectedAsset, 'locked')"
                    >
                      <Icon name="lock" :size="16" />{{
                        t("app.inspector.alwaysInclude")
                      }}</button
                    ><button
                      :aria-pressed="!!selectedAsset.state.rejected"
                      :class="{ active: selectedAsset.state.rejected }"
                      @click="toggleAsset(selectedAsset, 'rejected')"
                    >
                      <Icon name="reject" :size="16" />
                      {{
                        selectedAsset.state.rejected
                          ? t("app.inspector.restore")
                          : t("app.inspector.leaveOut")
                      }}
                    </button>
                  </div>
                  <div
                    class="selected-source-status"
                    :class="{
                      unavailable:
                        sourceStatuses[selectedAsset.id]?.status !==
                          'available' && sourceStatuses[selectedAsset.id],
                    }"
                  >
                    <strong v-if="sourceStatuses[selectedAsset.id]">{{
                      sourceStatuses[selectedAsset.id]?.status === "missing"
                        ? t("app.inspector.missing")
                        : sourceStatuses[selectedAsset.id]?.status ===
                            "inaccessible"
                          ? t("app.inspector.inaccessible")
                          : t("app.inspector.available")
                    }}</strong>
                    <p v-if="sourceStatuses[selectedAsset.id]?.message">
                      {{ t("app.library.offlineHint") }}
                    </p>
                    <button
                      class="secondary"
                      :disabled="!!busy || activeJobs.length > 0 || relinkBusy"
                      @click="openRelink(selectedAsset.id)"
                    >
                      {{ t("app.inspector.relink") }}
                    </button>
                  </div>
                  <p class="source-path" :title="selectedAsset.uri">
                    {{ lastSourceFolder(selectedAsset.uri) }}
                  </p>
                </aside>
              </div>
              <div v-if="total > pageSize" class="pagination">
                <span>{{
                  t("app.library.page", {
                    from: formatNumber(offset + 1),
                    to: formatNumber(Math.min(offset + pageSize, total)),
                    count: formatNumber(total),
                  })
                }}</span>
                <div>
                  <button
                    class="secondary"
                    :disabled="offset === 0 || !!busy"
                    @click="changePage(-1)"
                  >
                    {{ t("app.actions.previous") }}</button
                  ><button
                    class="secondary"
                    :disabled="offset + pageSize >= total || !!busy"
                    @click="changePage(1)"
                  >
                    {{ t("app.actions.next")
                    }}<Icon name="chevron" :size="14" />
                  </button>
                </div>
              </div>
            </template>
            <template v-else>
              <div v-if="!analyzed" class="empty-state">
                <span class="empty-symbol"
                  ><Icon name="grid" :size="30"
                /></span>
                <h2>
                  {{
                    libraryView === "events"
                      ? t("app.library.organizeTitle")
                      : t("app.library.duplicates")
                  }}
                </h2>
                <p>{{ t("app.library.organizeHint") }}</p>
                <button class="primary" :disabled="!!busy" @click="analyze">
                  {{ t("app.library.organize") }}<Icon name="arrow" />
                </button>
              </div>
              <div
                v-else-if="libraryView === 'events' && events.length"
                class="moment-list"
              >
                <button
                  v-for="(event, index) in events"
                  :key="event.id"
                  class="moment-row"
                  @click="
                    openGroup({
                      title:
                        event.labels.join(' · ') ||
                        t('app.library.moment', { number: index + 1 }),
                      assetIds: event.assetIds,
                    })
                  "
                >
                  <span class="moment-number">{{
                    String(index + 1).padStart(2, "0")
                  }}</span>
                  <div class="moment-copy">
                    <h2>
                      {{
                        event.labels.join(" · ") ||
                        t("app.library.moment", { number: index + 1 })
                      }}
                    </h2>
                    <p>
                      {{ dateLabel(event.startAt)
                      }}<span
                        v-if="
                          event.endAt &&
                          dateLabel(event.endAt) !== dateLabel(event.startAt)
                        "
                      >
                        — {{ dateLabel(event.endAt) }}</span
                      >
                    </p>
                  </div>
                  <span class="moment-count">{{
                    t(
                      "app.library.memoriesCount",
                      { count: formatNumber(event.assetIds.length) },
                      event.assetIds.length,
                    )
                  }}</span
                  ><Icon name="arrow" />
                </button>
              </div>
              <div
                v-else-if="libraryView === 'duplicates' && duplicates.length"
                class="moment-list"
              >
                <button
                  v-for="(group, index) in duplicates"
                  :key="group.id"
                  class="moment-row"
                  @click="
                    openGroup({
                      title: `${group.kind === 'exact' ? t('app.library.exactDuplicates') : t('app.library.similarFrames')} · ${index + 1}`,
                      assetIds: group.assetIds,
                      kind: group.kind,
                      index,
                    })
                  "
                >
                  <span class="moment-number">{{
                    String(index + 1).padStart(2, "0")
                  }}</span>
                  <div class="moment-copy">
                    <h2>
                      {{
                        group.kind === "exact"
                          ? t("app.library.duplicateTitle")
                          : t("app.library.similarTitle")
                      }}
                    </h2>
                    <p>
                      {{
                        group.kind === "exact"
                          ? t("app.library.exactDuplicates")
                          : t("app.library.similarFrames")
                      }}
                      ·
                      {{
                        t("app.library.confidence", {
                          count: formatNumber(
                            Math.round(group.confidence * 100),
                          ),
                        })
                      }}
                    </p>
                  </div>
                  <span class="moment-count">{{
                    t(
                      "app.library.filesCount",
                      { count: formatNumber(group.assetIds.length) },
                      group.assetIds.length,
                    )
                  }}</span
                  ><Icon name="arrow" />
                </button>
              </div>
              <div v-else class="empty-state">
                <h2>
                  {{
                    libraryView === "events"
                      ? t("app.library.noMoments")
                      : t("app.library.noSimilar")
                  }}
                </h2>
                <p>
                  {{
                    libraryView === "events"
                      ? t("app.library.noMomentsHint")
                      : t("app.library.noSimilarHint")
                  }}
                </p>
              </div>
            </template>
            <div v-if="librarySummary.total > 0" class="workspace-next">
              <button
                class="secondary"
                :disabled="!!busy"
                @click="
                  analyzed ? changeTab('story') : navigateWorkflow('organize')
                "
              >
                {{
                  t(
                    analyzed
                      ? "app.story.continue"
                      : "app.library.continueOrganize",
                  )
                }}<Icon name="arrow" />
              </button>
            </div>
          </div>
        </div>
      </template>

      <template v-if="tab === 'story'">
        <section
          v-if="storyCreateOpen"
          class="inline-form story-create"
          :aria-label="t('app.story.createLabel')"
        >
          <div>
            <h2>{{ t("app.story.createHeading") }}</h2>
            <p>{{ t("app.story.createHint") }}</p>
          </div>
          <form @submit.prevent="createStory">
            <label class="field"
              >{{ t("app.story.title")
              }}<input
                v-model="storyTitle"
                name="story-title"
                :placeholder="t('app.story.titlePlaceholder')"
                required /></label
            ><label class="field"
              >{{ t("app.story.structure")
              }}<select v-model="storyTemplate" name="story-template">
                <option value="blank">{{ t("app.create.openStory") }}</option>
                <option value="proposal-film">
                  {{ t("app.create.proposal") }}
                </option>
              </select></label
            ><label class="field"
              >{{ t("app.story.scope")
              }}<select v-model="storyScope" name="story-scope">
                <option value="library">{{ t("app.story.scopeAll") }}</option>
                <option value="page">
                  {{ t("app.story.scopePage", { count: assets.length }) }}
                </option></select
              ><small>{{ t("app.story.scopeHint") }}</small></label
            ><label class="field compact-field"
              >{{ t("app.create.target")
              }}<input
                v-model.number="targetDuration"
                name="target-duration"
                type="number"
                min="1"
                required
                @input="storyTimingEdited = true" /></label
            ><label class="field compact-field"
              >{{ t("app.create.maximum")
              }}<input
                v-model.number="maxDuration"
                name="max-duration"
                type="number"
                min="1"
                required
                @input="storyTimingEdited = true" /></label
            ><button class="primary" :disabled="!!busy">
              {{ t("app.story.plan") }}<Icon name="arrow" />
            </button>
          </form>
        </section>
        <div v-if="!project.stories.length" class="empty-state story-empty">
          <span class="empty-symbol"><Icon name="film" :size="30" /></span>
          <h2>{{ t("app.story.emptyTitle") }}</h2>
          <p>{{ t("app.story.emptyHint") }}</p>
          <button class="primary" @click="storyCreateOpen = true">
            {{ t("app.story.createFirst") }}<Icon name="arrow" />
          </button>
        </div>
        <template v-else-if="activeStory">
          <div class="story-selection">
            <label
              >{{ t("app.story.workingOn")
              }}<select
                :value="activeStory.id"
                :aria-label="t('app.story.active')"
                :disabled="!!busy || relinkBusy"
                @change="changeStory"
              >
                <option
                  v-for="story in project.stories"
                  :key="story.id"
                  :value="story.id"
                >
                  {{ story.title }}
                </option>
              </select></label
            ><span>{{
              t("app.story.timing", {
                target: duration(activeStory.targetDuration),
                maximum: duration(activeStory.maxDuration),
              })
            }}</span
            ><button
              class="primary"
              :disabled="!!busy || beatDirty"
              @click="compose"
            >
              {{ t("app.story.compose") }}<Icon name="arrow" />
            </button>
          </div>
          <div class="story-room story-board">
            <aside class="beat-list" :aria-label="t('app.story.beats')">
              <button
                v-for="(beat, index) in activeStory.beats"
                :key="beat.id"
                :class="{ active: activeBeatIndex === index }"
                :aria-current="activeBeatIndex === index ? 'step' : undefined"
                :disabled="beatDirty && activeBeatIndex !== index"
                @click="activeBeatIndex = index"
              >
                <span class="beat-number">{{
                  String(index + 1).padStart(2, "0")
                }}</span
                ><span
                  ><strong>{{ beat.title }}</strong
                  ><span v-if="beat.intent" class="beat-intent-summary">{{
                    beat.intent
                  }}</span>
                  <small class="beat-timing"
                    ><span class="beat-target">{{
                      t("app.composition.target", {
                        duration: duration(beat.targetDuration),
                      })
                    }}</span>
                    ·
                    {{
                      t("app.story.selected", {
                        count: beat.selectedAssetIds?.length ?? 0,
                      })
                    }}<span
                      v-if="activeComposition?.storyId === activeStory.id"
                    >
                      ·
                      {{
                        t("app.story.actual", {
                          duration: duration(beatActual(beat.id)),
                        })
                      }}</span
                    ><span
                      v-if="activeComposition?.storyId === activeStory.id"
                      class="beat-duration-status"
                      :class="
                        durationStatus(
                          beatActual(beat.id),
                          beat.targetDuration,
                          beat.maxDuration,
                        )
                      "
                    >
                      ·
                      {{
                        t(
                          `app.composition.status.${durationStatus(beatActual(beat.id), beat.targetDuration, beat.maxDuration)}`,
                        )
                      }}</span
                    ></small
                  ></span
                ><Icon name="chevron" :size="14" />
              </button>
            </aside>
            <section
              v-if="activeBeat"
              class="beat-editor"
              :aria-label="t('app.story.editBeat')"
            >
              <div class="beat-editor-heading">
                <div>
                  <h2>{{ activeBeat.title }}</h2>
                </div>
                <button
                  class="secondary"
                  :disabled="!beatDirty || !!busy"
                  @click="saveBeat"
                >
                  {{ t("app.story.saveBeat") }}<Icon name="check" :size="15" />
                </button>
              </div>
              <div class="beat-fields">
                <label class="field"
                  >{{ t("app.story.beatTitle")
                  }}<input
                    v-model="beatDraft.title"
                    :aria-label="t('app.story.beatTitle')"
                    @input="beatDirty = true" /></label
                ><label class="field compact-field"
                  >{{ t("app.story.beatDurationLabel")
                  }}<input
                    v-model.number="beatDraft.targetDuration"
                    :aria-label="t('app.story.beatDuration')"
                    type="number"
                    min="0.01"
                    step="any"
                    @input="beatDirty = true" /></label
                ><label class="field intent-field"
                  >{{ t("app.story.intent")
                  }}<textarea
                    v-model="beatDraft.intent"
                    :aria-label="t('app.story.beatIntent')"
                    rows="2"
                    @input="beatDirty = true"
                  />
                </label>
              </div>
              <div class="candidate-heading">
                <h3>{{ t("app.story.choose") }}</h3>
                <span>{{
                  t("app.story.candidates", {
                    selected: beatDraft.selectedAssetIds.length,
                    count: candidateIds.length,
                  })
                }}</span>
              </div>
              <div class="story-suggestion-actions">
                <button
                  class="secondary"
                  :disabled="!!busy"
                  @click="refreshSuggestions"
                >
                  <Icon name="refresh" :size="15" />{{
                    t("app.story.refreshSuggestions")
                  }}</button
                ><small>{{ t("app.story.refreshHint") }}</small>
              </div>
              <p class="candidate-guidance">
                {{ t("app.story.mustIncludeHint") }}
              </p>
              <p v-if="beatDirty" class="edit-note" role="status">
                {{ t("app.story.dirty") }}
              </p>
              <section
                v-if="selectedBeatAssets.length"
                class="selected-memories"
                :aria-label="t('app.story.mustInclude')"
              >
                <h3>{{ t("app.story.mustInclude") }}</h3>
                <div class="candidate-sheet">
                  <AssetCard
                    v-for="asset in selectedBeatAssets"
                    :key="asset.id"
                    :asset="asset"
                    :source-status="sourceStatuses[asset.id]"
                    choice
                    chosen
                    @select="chooseCandidate"
                  />
                </div>
              </section>
              <h3 v-if="candidateAssets.length">
                {{ t("app.story.suggestions") }}
              </h3>
              <div v-if="candidateAssets.length" class="candidate-sheet">
                <AssetCard
                  v-for="asset in candidateAssets.filter(
                    (item) => !beatDraft.selectedAssetIds.includes(item.id),
                  )"
                  :key="asset.id"
                  :asset="asset"
                  :source-status="sourceStatuses[asset.id]"
                  choice
                  :chosen="beatDraft.selectedAssetIds.includes(asset.id)"
                  @select="chooseCandidate"
                />
              </div>
              <div v-else class="small-empty">
                {{ t("app.story.noCandidates") }}
              </div>
              <div v-if="candidateIds.length > 24" class="pagination">
                <span>{{
                  t("app.story.candidatePage", {
                    from: formatNumber(candidateOffset + 1),
                    to: formatNumber(
                      Math.min(candidateOffset + 24, candidateIds.length),
                    ),
                    count: formatNumber(candidateIds.length),
                  })
                }}</span>
                <div>
                  <button
                    class="secondary"
                    :disabled="candidateOffset === 0"
                    @click="
                      candidateOffset -= 24;
                      run('loadingCandidates', loadCandidates);
                    "
                  >
                    {{ t("app.actions.previous") }}</button
                  ><button
                    class="secondary"
                    :disabled="candidateOffset + 24 >= candidateIds.length"
                    @click="
                      candidateOffset += 24;
                      run('loadingCandidates', loadCandidates);
                    "
                  >
                    {{ t("app.actions.next") }}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </template>
      </template>

      <section
        v-show="tab === 'edit' || tab === 'export'"
        class="editing-workflow"
      >
        <div v-if="!activeComposition" class="empty-state">
          <span class="empty-symbol"><Icon name="film" :size="30" /></span>
          <h2>{{ t("app.composition.emptyTitle") }}</h2>
          <p>{{ t("app.composition.emptyHint") }}</p>
          <button class="primary" @click="tab = 'story'">
            {{ t("app.composition.goStory") }}<Icon name="arrow" />
          </button>
        </div>
        <template v-else>
          <div class="composition-heading">
            <div>
              <h2>{{ compositionTitle }}</h2>
              <p v-if="tab === 'export'">
                <strong>{{ duration(activeComposition.duration) }}</strong
                ><span
                  >{{
                    t(
                      "app.composition.clips",
                      { count: formatNumber(clipCount) },
                      clipCount,
                    )
                  }}<span class="composition-duration-status">
                    ·
                    {{
                      t(
                        `app.composition.status.${durationStatus(activeComposition.duration, compositionStory?.targetDuration, compositionStory?.maxDuration)}`,
                      )
                    }}</span
                  ></span
                >
              </p>
              <p
                v-if="compositionStory && tab === 'export'"
                class="composition-target"
              >
                {{
                  t("app.composition.target", {
                    duration: duration(compositionStory.targetDuration),
                  })
                }}
                ·
                {{
                  t("app.composition.maximum", {
                    duration: duration(compositionStory.maxDuration),
                  })
                }}
              </p>
            </div>
            <label v-if="project.timelines.length > 1" class="cut-select"
              >{{ t("app.composition.cut")
              }}<select
                :value="activeComposition.id"
                :aria-label="t('app.composition.active')"
                :disabled="!!busy || relinkBusy"
                @change="changeComposition"
              >
                <option
                  v-for="(composition, index) in project.timelines"
                  :key="composition.id"
                  :value="composition.id"
                >
                  {{ t("app.composition.cutNumber", { number: index + 1 }) }} ·
                  {{ duration(composition.duration) }}
                </option>
              </select></label
            ><button class="primary" :disabled="!!busy" @click="renderPreview">
              <Icon name="play" :size="16" />{{
                busy === "renderingPreview"
                  ? t("app.composition.rendering")
                  : previewVersion
                    ? t("app.composition.renderAgain")
                    : t("app.composition.render")
              }}
            </button>
          </div>
          <p
            v-if="previewVersion && previewStale"
            class="preview-stale"
            role="status"
          >
            {{ t("app.composition.stale") }}
          </p>
          <ExportWorkspace
            v-if="tab === 'export'"
            :busy="!!busy"
            :path="exportPath"
            :filename="exportFilename"
            :format="exportFormat"
            :stale="exportStale"
            :report="exportReport"
            @export="exportFilm"
          />
          <button
            v-if="previewVersion && tab === 'edit'"
            class="secondary preview-toggle"
            :aria-expanded="showRenderedPreview"
            @click="showRenderedPreview = !showRenderedPreview"
          >
            {{
              showRenderedPreview
                ? t("app.composition.hidePreview")
                : t("app.composition.showPreview")
            }}
          </button>
          <div
            v-if="previewVersion && (tab === 'export' || showRenderedPreview)"
            class="preview-screen"
          >
            <video
              ref="renderedPlayer"
              :key="previewVersion"
              crossorigin="anonymous"
              :src="previewUrl(previewVersion)"
              controls
              preload="metadata"
              :aria-label="t('app.composition.preview')"
              @error="error = message('feedback.playbackFailed')"
            /><span class="preview-caption"
              >{{ t("app.composition.yourFilm") }} ·
              {{ duration(activeComposition.duration) }}</span
            >
          </div>
          <div
            v-else-if="tab === 'export' && !previewVersion"
            class="preview-placeholder"
          >
            <Icon name="play" :size="36" /><span>{{
              busy === "renderingPreview"
                ? t("app.composition.renderHint")
                : t("app.composition.previewHint")
            }}</span>
          </div>
          <TimelineEditor
            v-show="tab === 'edit'"
            :key="`${project.id}:${activeComposition.id}`"
            ref="timelineEditor"
            :project-id="project.id"
            :composition-id="activeComposition.id"
            :project-settings="project.settings"
            :active="tab === 'edit'"
            :source-statuses="sourceStatuses"
            :source-version="sourceVersion"
            :jobs="jobs"
            :analysis-recovery="analysisRecovery"
            :recovering-analysis-jobs="recoveringAnalysisJobs"
            @relink="openRelink($event)"
            @change="editorChanged"
            @edited="editorEdited"
            @playback="toggleRenderedPlayback"
            @activity="refreshJobs"
            @recover-analysis="recoverAnalysis"
          />
        </template>
      </section>
      <footer class="workspace-footer">
        <span
          >{{ project.title }} <span class="footer-dot">·</span>
          <span :title="projectPath ?? ''">{{
            projectPath?.split(/[\\/]/).at(-1)
          }}</span></span
        ><span>{{ t("app.export.footer") }}</span>
      </footer>
    </main>
    <AppSettings
      v-if="settingsOpen"
      :content-locale="
        project ? (project.projectContentLocale ?? 'en-US') : undefined
      "
      :busy="!!busy || relinkBusy"
      :native="native"
      :default-root="defaultRoot"
      @close="settingsOpen = false"
      @content-locale="changeFilmLocale"
    />
    <div v-if="busy" class="busy-indicator" role="status">
      <span class="spinner" />{{ t(`app.activity.tasks.${busy}`) }}…
    </div>
  </div>
</template>
