<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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
  duration,
  dateLabel,
  type EditorState,
  type MediaStatus,
  type SourceStatus,
} from "./api";
import Icon from "./components/Icon.vue";
import AssetCard from "./components/AssetCard.vue";
import TimelineEditor from "./components/TimelineEditor.vue";
import RelinkMedia from "./components/RelinkMedia.vue";
import SourceDetails from "./components/SourceDetails.vue";

type Tab = "Library" | "Stories" | "Timeline" | "Export";
type AssetState = "favorite" | "rejected" | "locked";
const tabs: Tab[] = ["Library", "Stories", "Timeline", "Export"];
const tab = ref<Tab>("Library");
const project = ref<OpenFilmProject | null>(null);
const projectPath = ref<string | null>(null);
const connected = ref(false);
const loading = ref(true);
const busy = ref("");
const error = ref("");
const notice = ref("");
const projectMode = ref<"create" | "open">("create");
const folder = ref("");
const title = ref("");
const importOpen = ref(false);
const importFolder = ref("");
const assets = ref<MediaAsset[]>([]);
const assetCache = ref<Record<string, MediaAsset>>({});
const mediaStatus = ref<MediaStatus | null>(null);
const mediaStatusError = ref("");
const checkingMedia = ref(false);
const relinkOpen = ref(false);
const relinkAssetIds = ref<string[] | undefined>();
const relinkLibraryId = ref<string | undefined>();
const relinkPanelBusy = ref(false);
const relinkRefreshing = ref(false);
const relinkBusy = computed(
  () => relinkPanelBusy.value || relinkRefreshing.value,
);
const sourceVersion = ref(0);
let statusGeneration = 0;
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
const offset = ref(0);
const pageSize = 60;
const search = ref("");
const stateFilter = ref("");
const mediaFilter = ref("");
const selectedAssetId = ref("");
const selectedAsset = computed(() => assetCache.value[selectedAssetId.value]);
const libraryView = ref<"all" | "events" | "duplicates">("all");
const events = ref<Event[]>([]);
const duplicates = ref<SimilarityGroup[]>([]);
const analyzed = ref(false);
const groupSelection = ref<{ title: string; assetIds: string[] } | null>(null);
const jobs = ref<Job[]>([]);
const activeJobs = computed(() =>
  jobs.value.filter(
    (job) => job.status === "running" || job.status === "queued",
  ),
);
const recentJob = computed(() => jobs.value[0]);
const cancellingJobs = ref<Record<string, boolean>>({});
const renderCancellationRequested = ref(false);
const storyCreateOpen = ref(false);
const storyTitle = ref("");
const storyTemplate = ref("blank");
const storyScope = ref<"library" | "page">("library");
const targetDuration = ref(120);
const maxDuration = ref(180);
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
    )?.title ?? "Your film",
);
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
}
async function flushEditor() {
  if (!timelineEditor.value) return true;
  const saved = await timelineEditor.value.flush();
  if (!saved)
    error.value =
      "Save your timeline edits before continuing. Your unsaved draft is retained; return to Timeline and retry saving.";
  return saved;
}
async function changeTab(next: Tab) {
  if (next === tab.value || relinkBusy.value) return;
  if (next === "Timeline") {
    tab.value = next;
    if (!timelineEditor.value?.hasPending) await timelineEditor.value?.reload();
    return;
  }
  if (!(await flushEditor())) return;
  tab.value = next;
  if (next === "Stories" && !beatDirty.value) hydrateBeat();
  if (next === "Library") await checkMediaStatus();
}
async function changeComposition(event: globalThis.Event) {
  const select = event.target as HTMLSelectElement;
  const next = select.value;
  select.value = activeComposition.value?.id ?? "";
  if (!(await flushEditor())) return;
  activeCompositionId.value = next;
  previewVersion.value = 0;
  previewStale.value = false;
}
function toggleRenderedPlayback() {
  const player = renderedPlayer.value;
  if (!player) return;
  if (player.paused)
    void player.play().catch(() => {
      error.value =
        "The rendered preview cannot play. Render it again to refresh the file.";
    });
  else player.pause();
}
const exportPath = ref("");
const native = !!window.__TAURI_INTERNALS__;
let poll: ReturnType<typeof setInterval> | undefined;
let polling = false;
let lastJobSignature = "";

function cacheAssets(incoming: MediaAsset[]) {
  const next = { ...assetCache.value };
  for (const asset of incoming) next[asset.id] = asset;
  assetCache.value = next;
}
async function checkMediaStatus() {
  const projectId = project.value?.id;
  if (!projectId) return;
  const generation = ++statusGeneration;
  checkingMedia.value = true;
  mediaStatusError.value = "";
  try {
    const result = await api.mediaStatus();
    if (project.value?.id === projectId && generation === statusGeneration)
      mediaStatus.value = result;
  } catch (cause) {
    if (generation === statusGeneration)
      mediaStatusError.value =
        cause instanceof Error ? cause.message : String(cause);
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
  tab.value = "Library";
  await checkMediaStatus();
}
async function beforeRelink() {
  if (busy.value || activeJobs.value.length) {
    error.value =
      "Wait for import or rendering to finish before relinking media.";
    return false;
  }
  return flushEditor();
}
async function mediaRelinked(updated: MediaAsset[]) {
  relinkRefreshing.value = true;
  try {
    cacheAssets(updated);
    const byId = new Map(updated.map((asset) => [asset.id, asset]));
    assets.value = assets.value.map((asset) => byId.get(asset.id) ?? asset);
    sourceVersion.value += 1;
    if (previewVersion.value) previewStale.value = true;
    await timelineEditor.value?.reload();
    await checkMediaStatus();
    notice.value = `${updated.length} ${updated.length === 1 ? "source is" : "sources are"} connected again. Your edits and selections are preserved.`;
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
  const params = new URLSearchParams({
    offset: String(offset.value),
    limit: String(pageSize),
  });
  if (groupSelection.value) {
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
  assets.value = result.assets;
  total.value = groupSelection.value?.assetIds.length ?? result.total;
  cacheAssets(result.assets);
}
async function run(label: string, action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = label;
  error.value = "";
  notice.value = "";
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = "";
  }
}
async function boot() {
  loading.value = true;
  await run("Opening workspace", async () => {
    await refreshProject();
    if (project.value) {
      await reloadAssets();
      jobs.value = (await api.jobs()).jobs;
      await checkMediaStatus();
    }
  });
  loading.value = false;
}
async function pickFolder(target: "project" | "import") {
  await run("Choosing folder", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<string | null>("pick_folder");
    if (result) {
      if (target === "project") folder.value = result;
      else importFolder.value = result;
    }
  });
}
async function openProject() {
  if (!(await flushEditor())) return;
  if (!folder.value.trim()) {
    error.value = "Choose a project folder first.";
    return;
  }
  if (projectMode.value === "create" && !title.value.trim()) {
    error.value = "Give your film a title.";
    return;
  }
  await run(
    projectMode.value === "create" ? "Creating project" : "Opening project",
    async () => {
      await post(`/project/${projectMode.value}`, {
        path: folder.value.trim(),
        ...(projectMode.value === "create"
          ? { title: title.value.trim() }
          : {}),
      });
      offset.value = 0;
      assetCache.value = {};
      mediaStatus.value = null;
      relinkOpen.value = false;
      sourceVersion.value += 1;
      selectedAssetId.value = "";
      groupSelection.value = null;
      events.value = [];
      duplicates.value = [];
      analyzed.value = false;
      previewVersion.value = 0;
      await refreshProject();
      await reloadAssets();
      jobs.value = (await api.jobs()).jobs;
      tab.value = "Library";
      await checkMediaStatus();
    },
  );
}
async function beginImport() {
  if (relinkBusy.value) return;
  if (!importFolder.value.trim()) {
    error.value = "Choose the folder containing your media.";
    return;
  }
  await run("Starting import", async () => {
    await post("/import", { folder: importFolder.value.trim() });
    jobs.value = (await api.jobs()).jobs;
    importOpen.value = false;
    notice.value =
      "Import started. You can keep working while your media is organized.";
  });
}
async function pollJobs() {
  if (!project.value || polling) return;
  polling = true;
  try {
    const result = await api.jobs();
    const newlyImported = result.jobs.some(
      (job) =>
        job.type === "import" &&
        ["completed", "failed", "cancelled"].includes(job.status) &&
        jobs.value.find((previous) => previous.id === job.id)?.status !==
          job.status,
    );
    jobs.value = result.jobs;
    const signature = result.jobs
      .map((job) => `${job.id}:${job.status}:${job.progress}`)
      .join("|");
    if (signature !== lastJobSignature) {
      lastJobSignature = signature;
      await reloadAssets();
      await refreshProject();
      if (newlyImported) await checkMediaStatus();
    }
  } catch {
    /* A transient disconnect must not replace an in-progress edit. */
  } finally {
    polling = false;
  }
}
async function toggleAsset(asset: MediaAsset, key: AssetState) {
  await run("Saving selection", async () => {
    const result = await patch<{ asset: MediaAsset }>(
      `/assets/${encodeURIComponent(asset.id)}`,
      { state: { ...asset.state, [key]: !asset.state[key] } },
    );
    cacheAssets([result.asset]);
    assets.value = assets.value.map((item) =>
      item.id === asset.id ? result.asset : item,
    );
    if (stateFilter.value) await reloadAssets();
  });
}
async function rateAsset(asset: MediaAsset, rating: number) {
  await run("Saving rating", async () => {
    const result = await patch<{ asset: MediaAsset }>(
      `/assets/${encodeURIComponent(asset.id)}`,
      { rating },
    );
    cacheAssets([result.asset]);
    assets.value = assets.value.map((item) =>
      item.id === asset.id ? result.asset : item,
    );
  });
}
async function applyFilters() {
  offset.value = 0;
  groupSelection.value = null;
  await run("Finding media", reloadAssets);
}
async function changePage(direction: number) {
  offset.value = Math.max(0, offset.value + direction * pageSize);
  await run("Loading media", reloadAssets);
}
async function analyze() {
  await run("Finding moments", async () => {
    const result = await api.analyze();
    events.value = result.events;
    duplicates.value = result.duplicates;
    analyzed.value = true;
    notice.value = "Your library is grouped into moments and similar media.";
  });
}
async function openGroup(group: { title: string; assetIds: string[] }) {
  groupSelection.value = group;
  offset.value = 0;
  await run("Opening moment", reloadAssets);
}
async function createStory() {
  if (!storyTitle.value.trim()) {
    error.value = "Give your story a title.";
    return;
  }
  if (!(targetDuration.value > 0) || maxDuration.value < targetDuration.value) {
    error.value =
      "Set a positive target and a maximum at least as long as the target.";
    return;
  }
  await run("Planning story", async () => {
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
    tab.value = "Stories";
  });
}
async function loadCandidates() {
  const ids = candidateIds.value
    .slice(candidateOffset.value, candidateOffset.value + 24)
    .filter((id) => !assetCache.value[id]);
  if (!ids.length) return;
  const result = await api.assets(
    new URLSearchParams({ ids: ids.join(","), limit: String(ids.length) }),
  );
  cacheAssets(result.assets);
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
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  },
);
function chooseCandidate(asset: MediaAsset) {
  if (asset.state.rejected) {
    error.value =
      "Restore this media in the Library before selecting it for a story.";
    return;
  }
  const selected = beatDraft.value.selectedAssetIds;
  beatDraft.value.selectedAssetIds = selected.includes(asset.id)
    ? selected.filter((id) => id !== asset.id)
    : [...selected, asset.id];
  beatDirty.value = true;
}
async function saveBeat() {
  if (!(await flushEditor())) return;
  const story = activeStory.value;
  const beat = activeBeat.value;
  if (!story || !beat) return;
  if (!beatDraft.value.title.trim() || !(beatDraft.value.targetDuration > 0)) {
    error.value = "Each beat needs a title and a positive duration in seconds.";
    return;
  }
  await run("Saving story beat", async () => {
    const updated: StoryBeat = {
      ...beat,
      title: beatDraft.value.title.trim(),
      intent: beatDraft.value.intent.trim(),
      targetDuration: Number(beatDraft.value.targetDuration),
      selectedAssetIds: [...beatDraft.value.selectedAssetIds],
    };
    const beats = story.beats.map((item) =>
      item.id === beat.id ? updated : item,
    );
    await patch<{ story: Story }>(`/stories/${encodeURIComponent(story.id)}`, {
      beats,
    });
    await refreshProject();
    beatDirty.value = false;
    notice.value = "Story beat saved.";
    await timelineEditor.value?.reload();
  });
}
async function compose() {
  if (!(await flushEditor())) return;
  const story = activeStory.value;
  if (!story) return;
  if (beatDirty.value) {
    error.value = "Save this beat before composing your story.";
    return;
  }
  await run("Composing film", async () => {
    const { composition } = await api.compose(story.id);
    activeCompositionId.value = composition.id;
    await refreshProject();
    previewVersion.value = 0;
    tab.value = "Timeline";
    const ids = [
      ...new Set(
        composition.tracks.flatMap((track) =>
          track.clips.map((clip) => clip.assetId),
        ),
      ),
    ];
    if (ids.length)
      cacheAssets(
        (
          await api.assets(
            new URLSearchParams({
              ids: ids.join(","),
              limit: String(ids.length),
            }),
          )
        ).assets,
      );
  });
}
async function renderPreview() {
  if (!(await flushEditor())) return;
  const renderingEdit = editSerial;
  const composition = activeComposition.value;
  if (!composition) return;
  await run("Rendering preview", async () => {
    renderCancellationRequested.value = false;
    try {
      await post<{ path: string }>("/render", {
        compositionId: composition.id,
      });
    } catch (cause) {
      if (
        renderCancellationRequested.value &&
        cause instanceof Error &&
        /abort|cancel/i.test(cause.message)
      ) {
        notice.value =
          "Preview render cancelled. Your story is ready whenever you are.";
        return;
      }
      throw cause;
    }
    previewVersion.value = Date.now();
    previewStale.value = renderingEdit !== editSerial;
    showRenderedPreview.value = true;
    notice.value = "Your preview is ready to play.";
  });
}
async function exportFilm(format: string) {
  if (!(await flushEditor())) return;
  const composition = activeComposition.value;
  if (!composition) return;
  await run("Exporting timeline", async () => {
    exportPath.value = (
      await post<{ path: string }>("/export", {
        format,
        compositionId: composition.id,
      })
    ).path;
    notice.value =
      "Timeline exported. Your original media stays in its source folders.";
  });
}
function jobTitle(job: Job): string {
  if (job.type === "render") {
    if (job.status === "completed") return "Preview render complete";
    if (job.status === "cancelled") return "Preview render cancelled";
    if (job.status === "failed") return "Preview needs attention";
    return job.status === "queued"
      ? "Preparing your preview"
      : "Rendering your film";
  }
  if (job.status === "completed") return "Import complete";
  if (job.status === "cancelled") return "Import cancelled";
  if (job.status === "failed") return "Import needs attention";
  return "Organizing your media";
}
async function cancelJob(job: Job) {
  if (cancellingJobs.value[job.id]) return;
  cancellingJobs.value = { ...cancellingJobs.value, [job.id]: true };
  if (job.type === "render") renderCancellationRequested.value = true;
  try {
    await post(`/jobs/${encodeURIComponent(job.id)}/cancel`);
    jobs.value = (await api.jobs()).jobs;
  } catch (cause) {
    if (job.type === "render") renderCancellationRequested.value = false;
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    cancellingJobs.value = { ...cancellingJobs.value, [job.id]: false };
  }
}
function progress(job: Job) {
  return Math.round(Math.max(0, Math.min(1, job.progress ?? 0)) * 100);
}
async function changeWorkspace() {
  if (busy.value || activeJobs.value.length || relinkBusy.value) return;
  if (!(await flushEditor())) return;
  statusGeneration += 1;
  mediaStatus.value = null;
  checkingMedia.value = false;
  relinkOpen.value = false;
  project.value = null;
  projectPath.value = null;
  folder.value = "";
  title.value = "";
  error.value = "";
}
function inspectAsset(asset: MediaAsset) {
  selectedAssetId.value = asset.id;
}
function handleKeyboard(event: KeyboardEvent) {
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
    :class="{ 'editing-room': tab === 'Timeline' || tab === 'Export' }"
  >
    <header class="app-header">
      <a
        class="wordmark"
        href="#"
        aria-label="OpenFilm home"
        @click.prevent="changeTab('Library')"
        ><span class="logo-bracket">[</span>OpenFilm<span class="logo-bracket"
          >]</span
        ></a
      >
      <nav v-if="project" aria-label="Film workspace" class="main-nav">
        <button
          v-for="item in tabs"
          :key="item"
          :class="{ current: tab === item }"
          :aria-current="tab === item ? 'page' : undefined"
          :disabled="relinkBusy"
          @click="changeTab(item)"
        >
          {{ item }}
        </button>
      </nav>
      <span class="local-label"
        ><span class="status-dot" :class="{ disconnected: !connected }" />{{
          connected ? "All yours. All local." : "Local workspace"
        }}</span
      >
    </header>

    <div v-if="error" class="feedback error" role="alert">
      <Icon name="reject" /><span>{{ error }}</span
      ><button aria-label="Dismiss error" @click="error = ''">
        <Icon name="reject" :size="16" />
      </button>
    </div>
    <div v-if="notice" class="feedback success" role="status">
      <Icon name="check" /><span>{{ notice }}</span
      ><button aria-label="Dismiss message" @click="notice = ''">
        <Icon name="reject" :size="16" />
      </button>
    </div>

    <main v-if="!project" class="welcome">
      <section class="welcome-intro">
        <span class="eyebrow">THE OPEN FILM WORKSPACE</span>
        <h1>Your memories.<br />A story worth<br /><em>telling.</em></h1>
        <p>
          Bring your photos, videos, and recordings together. Find the moments
          that matter. Shape a film in your own way.
        </p>
        <div class="welcome-note">
          <Icon name="film" :size="22" /><span
            >Your media stays on your computer.<br />Your originals stay
            untouched.</span
          >
        </div>
        <span class="edition">OPEN SOURCE · STORY FIRST · YOURS TO KEEP</span>
      </section>
      <section class="project-start" aria-label="Project setup">
        <div class="section-number">01 / BEGIN HERE</div>
        <h2>Make room for a story.</h2>
        <div class="segmented">
          <button
            :class="{ active: projectMode === 'create' }"
            @click="projectMode = 'create'"
          >
            New project</button
          ><button
            :class="{ active: projectMode === 'open' }"
            @click="projectMode = 'open'"
          >
            Open project
          </button>
        </div>
        <form @submit.prevent="openProject">
          <label v-if="projectMode === 'create'" class="field"
            >Film title<input
              v-model="title"
              name="title"
              placeholder="A title for your film"
              required
              autocomplete="off" /></label
          ><label class="field"
            >{{
              projectMode === "create"
                ? "Project folder"
                : "Existing .openfilm folder"
            }}
            <div class="path-input">
              <input
                v-model="folder"
                name="project-folder"
                :aria-label="
                  projectMode === 'create'
                    ? 'Project folder'
                    : 'Existing .openfilm folder'
                "
                :placeholder="
                  projectMode === 'create'
                    ? '/home/you/Films/my-film.openfilm'
                    : '/home/you/Films/my-film.openfilm'
                "
                required
                autocomplete="off"
              /><button
                v-if="native"
                type="button"
                class="icon-button"
                aria-label="Choose project folder"
                @click="pickFolder('project')"
              >
                <Icon name="folder" />
              </button>
            </div>
            <small>{{
              projectMode === "create"
                ? "Choose a new folder for your project and previews."
                : "Choose the folder that contains your saved project."
            }}</small></label
          ><button
            class="primary full"
            :disabled="!!busy || loading"
            type="submit"
          >
            {{
              busy ||
              (projectMode === "create" ? "Create project" : "Open project")
            }}<Icon name="arrow" />
          </button>
        </form>
        <button
          v-if="!connected && !loading"
          class="text-button retry"
          @click="boot"
        >
          <Icon name="refresh" :size="15" /> Retry connection
        </button>
        <p class="project-footnote">No account. No upload. Just your story.</p>
      </section>
    </main>

    <main v-else class="workspace-content">
      <div class="project-heading">
        <div>
          <span class="eyebrow">{{
            tab === "Library"
              ? "YOUR COLLECTION"
              : tab === "Stories"
                ? "THE STORY ROOM"
                : tab === "Timeline"
                  ? "YOUR ROUGH CUT"
                  : "READY FOR THE NEXT CHAPTER"
          }}</span>
          <h1>
            {{
              tab === "Library"
                ? project.title
                : tab === "Stories"
                  ? "Find the thread."
                  : tab === "Timeline"
                    ? "Let it unfold."
                    : "Take your story further."
            }}
          </h1>
          <p v-if="tab === 'Library'">
            A place for the moments you want to remember.
          </p>
          <p v-if="tab === 'Stories'">
            Give your memories a beginning, a middle, and a reason to stay.
          </p>
          <p v-if="tab === 'Timeline'">
            Shape each moment around your story. Your originals stay untouched.
          </p>
          <p v-if="tab === 'Export'">
            Watch your film, or bring an editable timeline into your editing
            room.
          </p>
        </div>
        <div class="project-heading-actions">
          <button
            class="text-button project-switch"
            :disabled="!!busy || activeJobs.length > 0 || relinkBusy"
            @click="changeWorkspace"
          >
            <Icon name="folder" :size="15" /> Switch project</button
          ><button
            v-if="tab === 'Library'"
            class="primary"
            :disabled="!!busy || relinkBusy"
            @click="importOpen = !importOpen"
          >
            <Icon name="plus" /> Add media</button
          ><button
            v-if="
              tab === 'Library' &&
              (total > 0 || (mediaStatus?.assets.length ?? 0) > 0)
            "
            class="secondary"
            :disabled="!!busy || activeJobs.length > 0 || relinkBusy"
            @click="openRelink()"
          >
            <Icon name="refresh" :size="16" />Relink Media</button
          ><button
            v-if="tab === 'Stories'"
            class="primary"
            :disabled="!!busy"
            @click="storyCreateOpen = !storyCreateOpen"
          >
            <Icon name="plus" /> New story
          </button>
        </div>
      </div>

      <RelinkMedia
        v-if="relinkOpen && tab === 'Library'"
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

      <section v-if="importOpen" class="inline-form" aria-label="Import media">
        <div>
          <h2>Bring your memories in.</h2>
          <p>
            Select a folder. Photos, video, and audio will be organized without
            changing the originals.
          </p>
        </div>
        <form @submit.prevent="beginImport">
          <label class="field"
            >Media folder
            <div class="path-input">
              <input
                v-model="importFolder"
                name="media-folder"
                placeholder="/home/you/Pictures"
                required
              /><button
                v-if="native"
                class="icon-button"
                type="button"
                aria-label="Choose media folder"
                @click="pickFolder('import')"
              >
                <Icon name="folder" />
              </button></div></label
          ><button class="primary" :disabled="!!busy">
            Import folder<Icon name="arrow" /></button
          ><button
            class="text-button"
            type="button"
            @click="importOpen = false"
          >
            Cancel
          </button>
        </form>
      </section>

      <section
        v-if="activeJobs.length || recentJob"
        class="jobs"
        aria-label="Processing status"
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
              :name="job.type === 'render' ? 'film' : 'folder'"
              :size="17"
            />
            <strong>{{ jobTitle(job) }}</strong>
            <span class="job-status">{{
              job.status === "running" || job.status === "queued"
                ? job.type === "import" || (job.progress ?? 0) > 0
                  ? `${progress(job)}%`
                  : "In progress"
                : job.status
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
                ? 'Preview render progress'
                : 'Import progress'
            "
          />
          <button
            v-if="job.status === 'running' || job.status === 'queued'"
            class="text-button"
            :disabled="cancellingJobs[job.id]"
            @click="cancelJob(job)"
          >
            {{
              cancellingJobs[job.id]
                ? "Cancelling…"
                : job.type === "render"
                  ? "Cancel render"
                  : "Cancel import"
            }}
          </button>
          <details v-if="job.errors?.length" class="job-errors">
            <summary>
              {{ job.errors.length }} file{{
                job.errors.length === 1 ? "" : "s"
              }}
              {{ job.errors.length === 1 ? "needs" : "need" }} attention
            </summary>
            <ul>
              <li v-for="(problem, index) in job.errors" :key="index">
                <strong>{{ problem.uri.split(/[\\/]/).at(-1) }}</strong> ·
                {{ problem.stage }}: {{ problem.message }}
              </li>
            </ul>
          </details>
        </div>
      </section>

      <template v-if="tab === 'Library'">
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
          }"
          aria-label="Media availability"
        >
          <div class="media-availability-summary">
            <div>
              <strong v-if="missingCount || inaccessibleCount"
                >{{ missingCount ? `${missingCount} Missing Media` : ""
                }}{{ missingCount && inaccessibleCount ? " · " : ""
                }}{{
                  inaccessibleCount ? `${inaccessibleCount} inaccessible` : ""
                }}</strong
              ><strong v-else>{{
                checkingMedia
                  ? "Checking source files…"
                  : mediaStatus
                    ? "All media available"
                    : "Source status not checked"
              }}</strong>
              <p v-if="missingCount || inaccessibleCount">
                Reconnect the drive or locate moved files. Cached thumbnails and
                your edits stay available.
              </p>
              <p v-else-if="mediaStatus">
                {{ mediaStatus.assets.length }} source files checked.
              </p>
              <p v-if="mediaStatusError" role="alert">{{ mediaStatusError }}</p>
            </div>
            <button
              class="secondary"
              :disabled="checkingMedia || relinkBusy"
              @click="checkMediaStatus"
            >
              <Icon name="refresh" :size="14" />{{
                checkingMedia ? "Checking…" : "Check again"
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
                  ? "Library offline"
                  : "Some library files unavailable"
              }}</strong>
              · {{ library.name
              }}<small>{{ library.roots.join(" · ") }}</small></span
            ><button
              class="text-button"
              :aria-label="`Relink library ${library.name}`"
              :disabled="!!busy || activeJobs.length > 0 || relinkBusy"
              @click="openRelink(undefined, library.id)"
            >
              Locate library<Icon name="arrow" :size="14" />
            </button>
          </div>
        </section>
        <div class="library-toolbar">
          <div class="collection-tabs" aria-label="Library view">
            <button
              :class="{ active: libraryView === 'all' }"
              @click="
                libraryView = 'all';
                groupSelection = null;
                applyFilters();
              "
            >
              All media<span v-if="libraryView === 'all'">{{
                total
              }}</span></button
            ><button
              :class="{ active: libraryView === 'events' }"
              @click="
                libraryView = 'events';
                groupSelection = null;
              "
            >
              Moments</button
            ><button
              :class="{ active: libraryView === 'duplicates' }"
              @click="
                libraryView = 'duplicates';
                groupSelection = null;
              "
            >
              Similar media
            </button>
          </div>
          <button class="text-button" :disabled="!!busy" @click="analyze">
            <Icon name="grid" :size="15" />{{
              busy === "Finding moments" ? busy : "Find moments & duplicates"
            }}
          </button>
        </div>
        <template v-if="libraryView === 'all' || groupSelection">
          <div v-if="groupSelection" class="group-heading">
            <button class="text-button" @click="groupSelection = null">
              <Icon name="chevron" class="reverse" :size="15" /> Back to groups
            </button>
            <h2>{{ groupSelection.title }}</h2>
          </div>
          <form v-else class="filter-bar" @submit.prevent="applyFilters">
            <label class="search-field"
              ><Icon name="search" :size="16" /><input
                v-model="search"
                aria-label="Search media"
                placeholder="Find a filename or tag"
              /><button type="submit" class="text-button">Search</button></label
            ><select
              v-model="mediaFilter"
              aria-label="Media type"
              @change="applyFilters"
            >
              <option value="">All types</option>
              <option value="image">Photos</option>
              <option value="video">Videos</option>
              <option value="audio">Audio</option>
              <option value="360-video">360° video</option></select
            ><select
              v-model="stateFilter"
              aria-label="Media selection filter"
              @change="applyFilters"
            >
              <option value="">All selections</option>
              <option value="favorite">Favorites</option>
              <option value="locked">Locked</option>
              <option value="rejected">Rejected</option>
            </select>
          </form>
          <div class="library-layout" :class="{ inspecting: selectedAsset }">
            <section
              v-if="assets.length"
              class="contact-sheet"
              aria-label="Media collection"
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
              <span class="empty-symbol"><Icon name="film" :size="30" /></span>
              <h2>
                {{
                  search || stateFilter || mediaFilter
                    ? "No matching memories."
                    : "Every film begins with a moment."
                }}
              </h2>
              <p>
                {{
                  search || stateFilter || mediaFilter
                    ? "Try a different search or selection."
                    : "Add a folder of photos, videos, or recordings to start your collection."
                }}
              </p>
              <button
                v-if="!search && !stateFilter && !mediaFilter"
                class="primary"
                @click="importOpen = true"
              >
                <Icon name="plus" /> Add your first media
              </button>
            </div>
            <aside
              v-if="selectedAsset"
              class="asset-inspector"
              aria-label="Selected media details"
            >
              <div class="inspector-title">
                <span class="eyebrow">A CLOSER LOOK</span
                ><button
                  class="icon-button"
                  aria-label="Close media details"
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
              <dl>
                <div>
                  <dt>Type</dt>
                  <dd>{{ selectedAsset.mediaType }}</dd>
                </div>
                <div v-if="selectedAsset.dimensions">
                  <dt>Size</dt>
                  <dd>
                    {{ selectedAsset.dimensions.width }} ×
                    {{ selectedAsset.dimensions.height }}
                  </dd>
                </div>
                <div v-if="selectedAsset.duration !== undefined">
                  <dt>Duration</dt>
                  <dd>{{ duration(selectedAsset.duration) }}</dd>
                </div>
                <div>
                  <dt>Date source</dt>
                  <dd>{{ selectedAsset.capturedAtSource || "Unknown" }}</dd>
                </div>
                <div v-if="selectedAsset.capturedAtConfidence !== undefined">
                  <dt>Date confidence</dt>
                  <dd>
                    {{ Math.round(selectedAsset.capturedAtConfidence * 100) }}%
                  </dd>
                </div>
              </dl>
              <SourceDetails :asset="selectedAsset" />
              <div class="rating-control">
                <span>How much does this matter?</span>
                <div>
                  <button
                    v-for="rating in 5"
                    :key="rating"
                    :class="{ active: (selectedAsset.rating ?? 0) >= rating }"
                    :aria-label="`Rate ${rating} ${rating === 1 ? 'star' : 'stars'}`"
                    :aria-pressed="selectedAsset.rating === rating"
                    :disabled="!!busy"
                    @click="rateAsset(selectedAsset, rating)"
                  >
                    <Icon name="star" :size="20" /></button
                  ><button
                    v-if="selectedAsset.rating"
                    class="text-button clear-rating"
                    aria-label="Clear rating"
                    @click="rateAsset(selectedAsset, 0)"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div class="inspector-controls">
                <button
                  :aria-pressed="!!selectedAsset.state.favorite"
                  :class="{ active: selectedAsset.state.favorite }"
                  @click="toggleAsset(selectedAsset, 'favorite')"
                >
                  <Icon name="heart" :size="16" /> Favorite</button
                ><button
                  :aria-pressed="!!selectedAsset.state.locked"
                  :class="{ active: selectedAsset.state.locked }"
                  @click="toggleAsset(selectedAsset, 'locked')"
                >
                  <Icon name="lock" :size="16" /> Always include</button
                ><button
                  :aria-pressed="!!selectedAsset.state.rejected"
                  :class="{ active: selectedAsset.state.rejected }"
                  @click="toggleAsset(selectedAsset, 'rejected')"
                >
                  <Icon name="reject" :size="16" />
                  {{
                    selectedAsset.state.rejected
                      ? "Restore to story"
                      : "Leave out"
                  }}
                </button>
              </div>
              <div
                class="selected-source-status"
                :class="{
                  unavailable:
                    sourceStatuses[selectedAsset.id]?.status !== 'available' &&
                    sourceStatuses[selectedAsset.id],
                }"
              >
                <strong v-if="sourceStatuses[selectedAsset.id]">{{
                  sourceStatuses[selectedAsset.id]?.status === "missing"
                    ? "Missing Media"
                    : sourceStatuses[selectedAsset.id]?.status ===
                        "inaccessible"
                      ? "Inaccessible Media"
                      : "Source available"
                }}</strong>
                <p v-if="sourceStatuses[selectedAsset.id]?.message">
                  {{ sourceStatuses[selectedAsset.id]?.message }}
                </p>
                <button
                  class="secondary"
                  :disabled="!!busy || activeJobs.length > 0 || relinkBusy"
                  @click="openRelink(selectedAsset.id)"
                >
                  Relink selected media
                </button>
              </div>
              <p class="source-path" :title="selectedAsset.uri">
                {{ selectedAsset.uri }}
              </p>
            </aside>
          </div>
          <div v-if="total > pageSize" class="pagination">
            <span
              >{{ offset + 1 }}–{{ Math.min(offset + pageSize, total) }} of
              {{ total }} memories</span
            >
            <div>
              <button
                class="secondary"
                :disabled="offset === 0 || !!busy"
                @click="changePage(-1)"
              >
                Previous</button
              ><button
                class="secondary"
                :disabled="offset + pageSize >= total || !!busy"
                @click="changePage(1)"
              >
                Next<Icon name="chevron" :size="14" />
              </button>
            </div>
          </div>
        </template>
        <template v-else>
          <div v-if="!analyzed" class="empty-state">
            <span class="empty-symbol"><Icon name="grid" :size="30" /></span>
            <h2>
              {{
                libraryView === "events"
                  ? "Find the days that belong together."
                  : "See which memories repeat."
              }}
            </h2>
            <p>
              Group your collection by capture time and location, and find exact
              or visually similar media.
            </p>
            <button class="primary" :disabled="!!busy" @click="analyze">
              Organize this collection<Icon name="arrow" />
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
                  title: event.labels.join(' · ') || `Moment ${index + 1}`,
                  assetIds: event.assetIds,
                })
              "
            >
              <span class="moment-number">{{
                String(index + 1).padStart(2, "0")
              }}</span>
              <div class="moment-copy">
                <h2>{{ event.labels.join(" · ") || `Moment ${index + 1}` }}</h2>
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
              <span class="moment-count"
                >{{ event.assetIds.length }} memories</span
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
                  title: `${group.kind === 'exact' ? 'Exact duplicates' : 'Visually similar'} · ${index + 1}`,
                  assetIds: group.assetIds,
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
                      ? "The same memory, more than once."
                      : "A few versions of the same moment."
                  }}
                </h2>
                <p>
                  {{
                    group.kind === "exact"
                      ? "Identical files"
                      : "Visually similar media"
                  }}
                  · {{ Math.round(group.confidence * 100) }}% confidence
                </p>
              </div>
              <span class="moment-count">{{ group.assetIds.length }} files</span
              ><Icon name="arrow" />
            </button>
          </div>
          <div v-else class="empty-state">
            <h2>
              {{
                libraryView === "events"
                  ? "No moments to group yet."
                  : "Your collection is one of a kind."
              }}
            </h2>
            <p>
              {{
                libraryView === "events"
                  ? "Import some media, then organize the collection again."
                  : "No duplicates were found in this collection."
              }}
            </p>
          </div>
        </template>
      </template>

      <template v-if="tab === 'Stories'">
        <section
          v-if="storyCreateOpen"
          class="inline-form story-create"
          aria-label="Create story"
        >
          <div>
            <h2>What story will you tell?</h2>
            <p>
              Choose a starting structure and how long the film should feel.
            </p>
          </div>
          <form @submit.prevent="createStory">
            <label class="field"
              >Story title<input
                v-model="storyTitle"
                name="story-title"
                placeholder="Give this story a name"
                required /></label
            ><label class="field"
              >Starting structure<select
                v-model="storyTemplate"
                name="story-template"
              >
                <option value="blank">Open story</option>
                <option value="proposal-film">Proposal Film</option>
              </select></label
            ><label class="field"
              >Media to consider<select v-model="storyScope" name="story-scope">
                <option value="library">All media in this project</option>
                <option value="page">
                  Current library page ({{ assets.length }} media)
                </option></select
              ><small
                >Large libraries: use a filtered page to focus this
                story.</small
              ></label
            ><label class="field compact-field"
              >Target (seconds)<input
                v-model.number="targetDuration"
                name="target-duration"
                type="number"
                min="1"
                required /></label
            ><label class="field compact-field"
              >Maximum (seconds)<input
                v-model.number="maxDuration"
                name="max-duration"
                type="number"
                min="1"
                required /></label
            ><button class="primary" :disabled="!!busy">
              Plan story<Icon name="arrow" />
            </button>
          </form>
        </section>
        <div v-if="!project.stories.length" class="empty-state story-empty">
          <span class="empty-symbol"><Icon name="film" :size="30" /></span>
          <h2>A collection becomes a story<br />when you find its thread.</h2>
          <p>
            Start with a story structure. Choose the memories for each beat, and
            let OpenFilm arrange a first cut.
          </p>
          <button class="primary" @click="storyCreateOpen = true">
            Create your first story<Icon name="arrow" />
          </button>
        </div>
        <template v-else-if="activeStory">
          <div class="story-selection">
            <label
              >Working on<select
                :value="activeStory.id"
                aria-label="Active story"
                @change="
                  activeStoryId = ($event.target as HTMLSelectElement).value;
                  activeBeatIndex = 0;
                "
              >
                <option
                  v-for="story in project.stories"
                  :key="story.id"
                  :value="story.id"
                >
                  {{ story.title }}
                </option>
              </select></label
            ><span
              >{{ duration(activeStory.targetDuration) }} target ·
              {{ duration(activeStory.maxDuration) }} maximum</span
            ><button
              class="primary"
              :disabled="!!busy || beatDirty"
              @click="compose"
            >
              Compose film<Icon name="arrow" />
            </button>
          </div>
          <div class="story-room">
            <aside class="beat-list" aria-label="Story beats">
              <span class="eyebrow">THE STORY ARC</span
              ><button
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
                  ><small
                    >{{ duration(beat.targetDuration) }} ·
                    {{ beat.selectedAssetIds?.length ?? 0 }} selected</small
                  ></span
                ><Icon name="chevron" :size="14" />
              </button>
            </aside>
            <section
              v-if="activeBeat"
              class="beat-editor"
              aria-label="Edit story beat"
            >
              <div class="beat-editor-heading">
                <div>
                  <span class="eyebrow"
                    >BEAT
                    {{ String(activeBeatIndex + 1).padStart(2, "0") }}</span
                  >
                  <h2>{{ activeBeat.title }}</h2>
                </div>
                <button
                  class="secondary"
                  :disabled="!beatDirty || !!busy"
                  @click="saveBeat"
                >
                  Save beat<Icon name="check" :size="15" />
                </button>
              </div>
              <div class="beat-fields">
                <label class="field"
                  >Beat title<input
                    v-model="beatDraft.title"
                    aria-label="Beat title"
                    @input="beatDirty = true" /></label
                ><label class="field compact-field"
                  >Duration (seconds)<input
                    v-model.number="beatDraft.targetDuration"
                    aria-label="Beat duration"
                    type="number"
                    min="0.01"
                    step="any"
                    @input="beatDirty = true" /></label
                ><label class="field intent-field"
                  >What should this moment say?<textarea
                    v-model="beatDraft.intent"
                    aria-label="Beat intent"
                    rows="2"
                    @input="beatDirty = true"
                  />
                </label>
              </div>
              <div class="candidate-heading">
                <h3>Choose the memories</h3>
                <span
                  >{{ beatDraft.selectedAssetIds.length }} selected ·
                  {{ candidateIds.length }}
                  {{
                    candidateIds.length === 1 ? "candidate" : "candidates"
                  }}</span
                >
              </div>
              <p v-if="beatDirty" class="edit-note" role="status">
                You have changes to save before moving to another beat.
              </p>
              <div v-if="candidateAssets.length" class="candidate-sheet">
                <AssetCard
                  v-for="asset in candidateAssets"
                  :key="asset.id"
                  :asset="asset"
                  :source-status="sourceStatuses[asset.id]"
                  choice
                  :chosen="beatDraft.selectedAssetIds.includes(asset.id)"
                  @select="chooseCandidate"
                />
              </div>
              <div v-else class="small-empty">
                No candidate media for this beat yet. Import media into the
                Library, then create a story.
              </div>
              <div v-if="candidateIds.length > 24" class="pagination">
                <span
                  >{{ candidateOffset + 1 }}–{{
                    Math.min(candidateOffset + 24, candidateIds.length)
                  }}
                  of {{ candidateIds.length }}</span
                >
                <div>
                  <button
                    class="secondary"
                    :disabled="candidateOffset === 0"
                    @click="
                      candidateOffset -= 24;
                      run('Loading candidates', loadCandidates);
                    "
                  >
                    Previous</button
                  ><button
                    class="secondary"
                    :disabled="candidateOffset + 24 >= candidateIds.length"
                    @click="
                      candidateOffset += 24;
                      run('Loading candidates', loadCandidates);
                    "
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          </div>
        </template>
      </template>

      <section
        v-show="tab === 'Timeline' || tab === 'Export'"
        class="editing-workflow"
      >
        <div v-if="!activeComposition" class="empty-state">
          <span class="empty-symbol"><Icon name="film" :size="30" /></span>
          <h2>Your first cut is waiting.</h2>
          <p>
            Plan a story and compose it to see your memories unfold on a
            timeline.
          </p>
          <button class="primary" @click="tab = 'Stories'">
            Go to stories<Icon name="arrow" />
          </button>
        </div>
        <template v-else>
          <div class="composition-heading">
            <div>
              <h2>{{ compositionTitle }}</h2>
              <p>
                <strong>{{ duration(activeComposition.duration) }}</strong
                ><span
                  >{{ clipCount }} clips · {{ project.settings.width }} ×
                  {{ project.settings.height }} ·
                  {{ project.settings.frameRate }} fps</span
                >
              </p>
            </div>
            <label v-if="project.timelines.length > 1" class="cut-select"
              >Cut<select
                :value="activeComposition.id"
                aria-label="Active composition"
                @change="changeComposition"
              >
                <option
                  v-for="(composition, index) in project.timelines"
                  :key="composition.id"
                  :value="composition.id"
                >
                  Cut {{ index + 1 }} · {{ duration(composition.duration) }}
                </option>
              </select></label
            ><button class="primary" :disabled="!!busy" @click="renderPreview">
              <Icon name="play" :size="16" />{{
                busy === "Rendering preview"
                  ? "Rendering preview…"
                  : previewVersion
                    ? "Render again"
                    : "Render preview"
              }}
            </button>
          </div>
          <p
            v-if="previewVersion && previewStale"
            class="preview-stale"
            role="status"
          >
            Preview is out of date. Render again to see your latest edits.
          </p>
          <button
            v-if="previewVersion && tab === 'Timeline'"
            class="secondary preview-toggle"
            :aria-expanded="showRenderedPreview"
            @click="showRenderedPreview = !showRenderedPreview"
          >
            {{
              showRenderedPreview ? "Hide film preview" : "Show film preview"
            }}
          </button>
          <div
            v-if="previewVersion && (tab === 'Export' || showRenderedPreview)"
            class="preview-screen"
          >
            <video
              ref="renderedPlayer"
              :key="previewVersion"
              crossorigin="anonymous"
              :src="previewUrl(previewVersion)"
              controls
              preload="metadata"
              aria-label="Film preview"
              @error="
                error =
                  'The preview could not be played. Render it again to refresh the file.'
              "
            /><span class="preview-caption"
              >YOUR FILM · {{ duration(activeComposition.duration) }}</span
            >
          </div>
          <div
            v-else-if="tab === 'Export' && !previewVersion"
            class="preview-placeholder"
          >
            <Icon name="play" :size="36" /><span>{{
              busy === "Rendering preview"
                ? "Your film is taking shape. This can take a moment."
                : "Render a preview to watch your story."
            }}</span>
          </div>
          <TimelineEditor
            v-show="tab === 'Timeline'"
            :key="`${project.id}:${activeComposition.id}`"
            ref="timelineEditor"
            :project-id="project.id"
            :composition-id="activeComposition.id"
            :active="tab === 'Timeline'"
            :source-statuses="sourceStatuses"
            :source-version="sourceVersion"
            @relink="openRelink($event)"
            @change="editorChanged"
            @edited="editorEdited"
            @playback="toggleRenderedPlayback"
          />
          <section v-if="tab === 'Export'" class="export-options">
            <div>
              <span class="eyebrow">KEEP THE STORY MOVING</span>
              <h2>Finish it in your editing room.</h2>
              <p>
                An editable timeline keeps the connection to your original
                files. Choose the format your editor uses.
              </p>
            </div>
            <div class="export-format-list">
              <button :disabled="!!busy" @click="exportFilm('otio')">
                <span
                  ><strong>OpenTimelineIO</strong
                  ><small
                    >Open, portable timeline · Resolve and compatible
                    editors</small
                  ></span
                ><span class="format-extension">.otio</span
                ><Icon name="download" /></button
              ><button :disabled="!!busy" @click="exportFilm('fcpxml')">
                <span
                  ><strong>Final Cut Pro XML</strong
                  ><small>Bring your rough cut into Final Cut Pro</small></span
                ><span class="format-extension">.fcpxml</span
                ><Icon name="download" /></button
              ><button :disabled="!!busy" @click="exportFilm('edl')">
                <span
                  ><strong>Edit Decision List</strong
                  ><small
                    >Simple cuts for compatible editing systems</small
                  ></span
                ><span class="format-extension">.edl</span
                ><Icon name="download" /></button
              ><button :disabled="!!busy" @click="exportFilm('json')">
                <span
                  ><strong>OpenFilm timeline</strong
                  ><small
                    >Keep the full, open composition with your project</small
                  ></span
                ><span class="format-extension">.json</span
                ><Icon name="download" />
              </button>
            </div>
            <div v-if="exportPath" class="export-result" role="status">
              <Icon name="check" :size="18" />
              <div>
                <strong>Saved to your project</strong
                ><code>{{ exportPath }}</code>
              </div>
            </div>
          </section>
        </template>
      </section>
      <footer class="workspace-footer">
        <span
          >{{ project.title }} <span class="footer-dot">·</span>
          {{ projectPath }}</span
        ><span>Made of your moments.</span>
      </footer>
    </main>
    <div v-if="busy" class="busy-indicator" role="status">
      <span class="spinner" />{{ busy }}…
    </div>
  </div>
</template>
