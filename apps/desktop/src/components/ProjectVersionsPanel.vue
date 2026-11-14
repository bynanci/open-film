<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import type {
  Job,
  OpenFilmProject,
  ProjectVersionDiff,
  ProjectVersionRecord,
} from "@openfilm/core";
import type {
  ProjectVersionPreviewTargets,
  VersionComparisonPreviewDescriptor,
} from "@openfilm/application";
import { localizeError } from "../i18n";
import { ApiError, api, versionComparisonMediaUrl } from "../api";
import {
  VersionComparisonPlayback,
  type ComparisonSide,
} from "../versionComparisonPlayback";

const props = defineProps<{
  projectId: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  restored: [project: OpenFilmProject];
  activity: [];
  playbackStart: [];
}>();
const { t } = useI18n();

const versions = ref<ProjectVersionRecord[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const createName = ref("");
const createDescription = ref("");
const selectedId = ref("");
const compareId = ref("");
const diff = ref<ProjectVersionDiff>();
const editingId = ref("");
const editName = ref("");
const editDescription = ref("");
const restoreTarget = ref<ProjectVersionRecord>();
const confirmationAction = ref<"restore" | "delete">("restore");
const pendingCreateRequestId = ref("");
const pendingRestore = ref<{
  versionId: string;
  baseRevision: string;
  requestId: string;
}>();
const confirmButton = ref<HTMLButtonElement | null>(null);
const restoreTrigger = ref<HTMLButtonElement | null>(null);
let generation = 0;

const selected = computed(() =>
  versions.value.find((version) => version.id === selectedId.value),
);
const compare = computed(() =>
  versions.value.find((version) => version.id === compareId.value),
);
const orderedForCompare = computed(() => [...versions.value].reverse());
const targetA = shallowRef<ProjectVersionPreviewTargets>();
const targetB = shallowRef<ProjectVersionPreviewTargets>();
const compositionA = ref("");
const compositionB = ref("");
const targetsLoading = ref(false);
const previewPhase = ref<
  | "idle"
  | "loading-targets"
  | "running"
  | "ready"
  | "other"
  | "failed"
  | "stale"
  | "expired"
  | "cancelled"
>("idle");
const previewError = ref("");
const previewDescriptor = shallowRef<VersionComparisonPreviewDescriptor>();
const previewJob = shallowRef<Job>();
const previewRequestId = ref("");
const retrySameRequest = ref(false);
const previewCleanup = ref(false);
const mediaGeneration = ref(0);
const mediaReady = reactive({ a: false, b: false });
const videoA = ref<HTMLVideoElement | null>(null);
const videoB = ref<HTMLVideoElement | null>(null);
const transportState = reactive({
  time: 0,
  duration: 0,
  playing: false,
  starting: false,
  audibleSide: null as ComparisonSide | null,
  muted: false,
  ended: { a: false, b: false },
});
let previewGeneration = 0;
let targetGeneration = 0;
let targetController: AbortController | undefined;
let jobController: AbortController | undefined;
let stopTask: Promise<boolean> | undefined;
const playback = new VersionComparisonPlayback(
  () => ({ a: videoA.value, b: videoB.value }),
  transportState,
  () => {
    previewError.value = t("app.versions.previewPlaybackFailed");
  },
);
const identicalPreviewTarget = computed(
  () =>
    !!compareId.value &&
    compareId.value === selectedId.value &&
    !!compositionA.value &&
    compositionA.value === compositionB.value,
);

function showError(cause: unknown) {
  error.value = localizeError(cause);
}

function delay(signal: AbortSignal, milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

async function loadPreviewTargets() {
  const versionA = compareId.value,
    versionB = selectedId.value,
    projectId = props.projectId;
  const request = ++targetGeneration;
  targetController?.abort();
  const controller = new AbortController();
  targetController = controller;
  if (!versionA || !versionB) {
    targetsLoading.value = false;
    targetA.value = undefined;
    targetB.value = undefined;
    compositionA.value = "";
    compositionB.value = "";
    return;
  }
  targetsLoading.value = true;
  if (!previewDescriptor.value) previewPhase.value = "loading-targets";
  try {
    const [a, b] = await Promise.all([
      api.versionPreviewTargets(versionA, projectId, controller.signal),
      api.versionPreviewTargets(versionB, projectId, controller.signal),
    ]);
    if (
      request !== targetGeneration ||
      projectId !== props.projectId ||
      versionA !== compareId.value ||
      versionB !== selectedId.value
    )
      return;
    targetA.value = a.targets;
    targetB.value = b.targets;
    if (!a.targets.compositions.some((item) => item.id === compositionA.value))
      compositionA.value = a.targets.compositions[0]?.id ?? "";
    if (!b.targets.compositions.some((item) => item.id === compositionB.value))
      compositionB.value = b.targets.compositions[0]?.id ?? "";
    if (!previewDescriptor.value && previewPhase.value === "loading-targets")
      previewPhase.value = "idle";
  } catch (cause) {
    if (request !== targetGeneration || controller.signal.aborted) return;
    previewPhase.value = "stale";
    previewError.value = localizeError(cause);
  } finally {
    if (request === targetGeneration) targetsLoading.value = false;
  }
}

async function watchComparisonJob(requestId: string, request: number) {
  const controller = new AbortController();
  jobController?.abort();
  jobController = controller;
  while (
    !controller.signal.aborted &&
    request === previewGeneration &&
    previewPhase.value === "running"
  ) {
    try {
      const state = await api.jobs(controller.signal),
        job = state.jobs.find((item) => item.id === requestId);
      if (request !== previewGeneration || controller.signal.aborted) return;
      if (job) previewJob.value = job;
    } catch {
      if (controller.signal.aborted) return;
    }
    await delay(controller.signal, 700);
  }
}

async function startComparison(requestId: string) {
  if (
    props.disabled ||
    previewCleanup.value ||
    !targetA.value ||
    !targetB.value ||
    !compositionA.value ||
    !compositionB.value ||
    identicalPreviewTarget.value
  )
    return;
  const request = ++previewGeneration,
    projectId = props.projectId,
    input = {
      projectId,
      requestId,
      a: { versionId: compareId.value, compositionId: compositionA.value },
      b: { versionId: selectedId.value, compositionId: compositionB.value },
    };
  previewRequestId.value = requestId;
  previewPhase.value = "running";
  previewError.value = "";
  previewJob.value = undefined;
  mediaReady.a = false;
  mediaReady.b = false;
  jobController?.abort();
  void watchComparisonJob(requestId, request);
  emit("activity");
  try {
    const descriptor = await api.prepareVersionComparison(input);
    if (request !== previewGeneration || projectId !== props.projectId) {
      if (previewRequestId.value === requestId)
        await api.cancelVersionComparison({ projectId, requestId });
      return;
    }
    previewDescriptor.value = descriptor;
    mediaGeneration.value++;
    playback.configure(descriptor);
    previewPhase.value = "ready";
    retrySameRequest.value = false;
    previewJob.value = undefined;
    emit("activity");
  } catch (cause) {
    if (request !== previewGeneration || projectId !== props.projectId) return;
    previewPhase.value =
      cause instanceof ApiError &&
      cause.status === 409 &&
      cause.code === "timeline.conflict"
        ? "stale"
        : "failed";
    previewError.value = localizeError(cause);
    if (cause instanceof ApiError && cause.status === 0) {
      retrySameRequest.value = true;
      try {
        const state = await api.jobs(),
          job = state.jobs.find((item) => item.id === requestId);
        if (job) {
          previewJob.value = job;
          if (job.status === "running" || job.status === "queued")
            previewPhase.value = "other";
        }
      } catch {
        // The retry action checks this durable identity after reconnection.
      }
    } else {
      retrySameRequest.value = false;
      previewRequestId.value = "";
      if (cause instanceof ApiError && cause.status === 409) {
        try {
          const state = await api.jobs(),
            job = state.jobs.find((item) => item.id === requestId);
          if (job && (job.status === "running" || job.status === "queued")) {
            previewJob.value = job;
            previewPhase.value = "other";
            previewRequestId.value = requestId;
          }
        } catch {
          // Keep the original conflict visible and let the user refresh.
        }
      }
    }
  } finally {
    if (request === previewGeneration) {
      jobController?.abort();
      emit("activity");
    }
  }
}

async function prepareComparison() {
  const requestId =
    retrySameRequest.value && previewRequestId.value
      ? previewRequestId.value
      : crypto.randomUUID();
  await startComparison(requestId);
}

async function retryComparison() {
  const requestId = previewRequestId.value;
  if (!retrySameRequest.value || !requestId) {
    await prepareComparison();
    return;
  }
  try {
    const state = await api.jobs(),
      job = state.jobs.find((item) => item.id === requestId);
    if (job?.status === "running" || job?.status === "queued") {
      previewJob.value = job;
      previewPhase.value = "other";
      return;
    }
    if (job?.status === "failed" || job?.status === "cancelled") {
      previewRequestId.value = "";
      retrySameRequest.value = false;
      await prepareComparison();
      return;
    }
    await startComparison(requestId);
  } catch (cause) {
    previewError.value = localizeError(cause);
  }
}

function video(side: ComparisonSide) {
  return side === "a" ? videoA.value : videoB.value;
}

function unloadPlayers() {
  for (const player of [videoA.value, videoB.value]) {
    if (!player) continue;
    player.pause();
    player.muted = true;
    player.removeAttribute("src");
    player.load();
  }
  mediaReady.a = false;
  mediaReady.b = false;
}

async function stopPreview(userRequested = false): Promise<boolean> {
  if (stopTask) return stopTask;
  const projectId = props.projectId,
    requestId = previewRequestId.value;
  ++previewGeneration;
  targetController?.abort();
  jobController?.abort();
  playback.unload();
  unloadPlayers();
  previewDescriptor.value = undefined;
  previewJob.value = undefined;
  previewError.value = "";
  if (!requestId) {
    previewPhase.value = "idle";
    return true;
  }
  previewCleanup.value = true;
  stopTask = (async () => {
    try {
      await api.cancelVersionComparison({ projectId, requestId });
      if (props.projectId === projectId) previewRequestId.value = "";
      retrySameRequest.value = false;
      previewPhase.value = userRequested ? "cancelled" : "idle";
      emit("activity");
      return true;
    } catch (cause) {
      previewPhase.value = "failed";
      previewError.value = localizeError(cause);
      previewRequestId.value = requestId;
      return false;
    } finally {
      previewCleanup.value = false;
      stopTask = undefined;
    }
  })();
  return stopTask;
}

async function reconnectPreview() {
  const descriptor = previewDescriptor.value;
  if (!descriptor || previewCleanup.value) return;
  const request = ++previewGeneration;
  previewPhase.value = "running";
  previewError.value = "";
  try {
    const current = await api.getVersionComparison(
      descriptor.id,
      props.projectId,
    );
    if (request !== previewGeneration) return;
    previewDescriptor.value = current;
    mediaGeneration.value++;
    mediaReady.a = false;
    mediaReady.b = false;
    playback.configure(current);
    previewPhase.value = "ready";
  } catch (cause) {
    if (request !== previewGeneration) return;
    previewPhase.value =
      cause instanceof ApiError && cause.status === 409 ? "expired" : "failed";
    previewError.value = localizeError(cause);
  }
}

function playPreview() {
  if (!mediaReady.a || !mediaReady.b || previewPhase.value !== "ready") return;
  emit("playbackStart");
  void playback.play();
}

function mediaError() {
  playback.pause();
  previewPhase.value = "expired";
  previewError.value = t("app.versions.previewExpired");
}

function mediaLoaded(side: ComparisonSide) {
  mediaReady[side] = true;
  const player = video(side);
  if (player && Math.abs(player.currentTime - transportState.time) > 0.04)
    player.currentTime = transportState.time;
}

async function selectSavedVersion(side: ComparisonSide, versionId: string) {
  if (!(await stopPreview())) return;
  if (side === "a") compareId.value = versionId;
  else selectedId.value = versionId;
}

function chooseSavedVersion(side: ComparisonSide, event: Event) {
  const versionId = (event.target as HTMLSelectElement).value;
  void selectSavedVersion(side, versionId);
}

async function selectComposition(side: ComparisonSide, compositionId: string) {
  if (!(await stopPreview())) return;
  if (side === "a") compositionA.value = compositionId;
  else compositionB.value = compositionId;
}

function formatSeconds(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function seekInput(event: Event) {
  const input = event.target as HTMLInputElement;
  void playback.seek(Number(input.value));
}

function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw && raw.length > 240 ? `${raw.slice(0, 237)}…` : (raw ?? "—");
}

async function load() {
  const request = ++generation;
  loading.value = true;
  error.value = "";
  diff.value = undefined;
  try {
    const result = await api.projectVersions();
    if (request !== generation) return;
    if (
      previewDescriptor.value &&
      (!result.versions.some(
        (item) => item.id === previewDescriptor.value?.a.versionId,
      ) ||
        !result.versions.some(
          (item) => item.id === previewDescriptor.value?.b.versionId,
        )) &&
      !(await stopPreview())
    )
      return;
    versions.value = result.versions;
    if (!versions.value.some((item) => item.id === selectedId.value))
      selectedId.value = versions.value[0]?.id ?? "";
    if (!versions.value.some((item) => item.id === compareId.value))
      compareId.value = versions.value[1]?.id ?? versions.value[0]?.id ?? "";
    if (selectedId.value && compareId.value) await loadDiff();
  } catch (cause) {
    if (request === generation) showError(cause);
  } finally {
    if (request === generation) loading.value = false;
  }
}

async function loadDiff() {
  if (!selectedId.value || !compareId.value) {
    diff.value = undefined;
    return;
  }
  const request = generation;
  try {
    const result = await api.diffProjectVersions(
      compareId.value,
      selectedId.value,
    );
    if (request === generation) diff.value = result.diff;
  } catch (cause) {
    if (request === generation) showError(cause);
  }
}

async function createVersion() {
  if (props.disabled || saving.value || !createName.value.trim()) return;
  if (!(await stopPreview())) return;
  saving.value = true;
  error.value = "";
  pendingCreateRequestId.value ||= crypto.randomUUID();
  try {
    const current = await api.projectVersionRevision();
    if (current.projectId !== props.projectId) return;
    const created = await api.createProjectVersion({
      name: createName.value.trim(),
      ...(createDescription.value.trim()
        ? { description: createDescription.value.trim() }
        : {}),
      baseRevision: current.revision,
      requestId: pendingCreateRequestId.value,
    });
    createName.value = "";
    createDescription.value = "";
    pendingCreateRequestId.value = "";
    await load();
    selectedId.value = created.version.id;
    compareId.value =
      versions.value.find((item) => item.id !== created.version.id)?.id ??
      created.version.id;
    await loadDiff();
  } catch (cause) {
    showError(cause);
  } finally {
    saving.value = false;
  }
}

function beginRename(version: ProjectVersionRecord) {
  editingId.value = version.id;
  editName.value = version.name;
  editDescription.value = version.description ?? "";
}

async function saveRename() {
  if (props.disabled || saving.value || !editingId.value) return;
  saving.value = true;
  error.value = "";
  try {
    await api.renameProjectVersion(editingId.value, {
      name: editName.value.trim(),
      description: editDescription.value.trim() || null,
    });
    editingId.value = "";
    await load();
  } catch (cause) {
    showError(cause);
  } finally {
    saving.value = false;
  }
}

async function askRestore(
  version: ProjectVersionRecord,
  trigger: HTMLButtonElement,
  action: "restore" | "delete" = "restore",
) {
  if (props.disabled || saving.value) return;
  playback.pause();
  confirmationAction.value = action;
  restoreTarget.value = version;
  restoreTrigger.value = trigger;
  if (pendingRestore.value?.versionId !== version.id)
    pendingRestore.value = undefined;
  await nextTick();
  confirmButton.value?.focus();
}

function cancelRestore() {
  restoreTarget.value = undefined;
  pendingRestore.value = undefined;
  void nextTick(() => restoreTrigger.value?.focus());
}

function trapRestoreTab(event: KeyboardEvent) {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      ".versions-confirm-dialog button:not(:disabled)",
    ),
  );
  if (!buttons.length) return;
  if (event.shiftKey && document.activeElement === buttons[0]) {
    event.preventDefault();
    buttons.at(-1)?.focus();
  } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
    event.preventDefault();
    buttons[0]?.focus();
  }
}

async function confirmRestore() {
  const target = restoreTarget.value;
  if (!target || props.disabled || saving.value) return;
  saving.value = true;
  error.value = "";
  const projectId = props.projectId;
  const request = generation;
  try {
    if (!(await stopPreview())) return;
    if (confirmationAction.value === "delete") {
      const current = await api.projectVersionRevision();
      if (
        current.projectId !== projectId ||
        props.projectId !== projectId ||
        request !== generation
      )
        return;
      await api.deleteProjectVersion(target.id, {
        baseRevision: current.revision,
        confirmed: true,
      });
      if (props.projectId !== projectId || request !== generation) return;
      restoreTarget.value = undefined;
      pendingRestore.value = undefined;
      await load();
      return;
    }
    if (!pendingRestore.value) {
      const current = await api.projectVersionRevision();
      if (current.projectId !== props.projectId)
        throw new Error(t("app.versions.projectChanged"));
      pendingRestore.value = {
        versionId: target.id,
        baseRevision: current.revision,
        requestId: crypto.randomUUID(),
      };
    }
    const restored = await api.restoreProjectVersion(target.id, {
      baseRevision: pendingRestore.value.baseRevision,
      requestId: pendingRestore.value.requestId,
      confirmed: true,
    });
    if (props.projectId !== projectId || request !== generation) return;
    pendingRestore.value = undefined;
    restoreTarget.value = undefined;
    await load();
    if (props.projectId === projectId) emit("restored", restored.project);
  } catch (cause) {
    showError(cause);
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.projectId,
  () => {
    versions.value = [];
    selectedId.value = "";
    compareId.value = "";
    editingId.value = "";
    restoreTarget.value = undefined;
    pendingRestore.value = undefined;
    pendingCreateRequestId.value = "";
    saving.value = false;
    void load();
  },
);
watch([selectedId, compareId], () => {
  void loadDiff();
  void loadPreviewTargets();
});
onMounted(() => void load());
onBeforeUnmount(() => {
  targetController?.abort();
  jobController?.abort();
  void stopPreview();
});
defineExpose({ stopPreview });
</script>

<template>
  <section class="project-versions" aria-labelledby="versions-title">
    <header class="versions-heading">
      <div>
        <p class="eyebrow">{{ t("app.versions.eyebrow") }}</p>
        <h2 id="versions-title">{{ t("app.versions.title") }}</h2>
        <p>{{ t("app.versions.description") }}</p>
      </div>
      <button class="secondary" :disabled="loading || saving" @click="load">
        {{ loading ? t("app.versions.loading") : t("app.versions.refresh") }}
      </button>
    </header>

    <p v-if="error" class="feedback error" role="alert">{{ error }}</p>

    <form class="versions-create" @submit.prevent="createVersion">
      <label>
        <span>{{ t("app.versions.nameLabel") }}</span>
        <input
          v-model="createName"
          maxlength="128"
          :disabled="disabled || saving"
          :placeholder="t('app.versions.namePlaceholder')"
          required
        />
      </label>
      <label>
        <span>{{ t("app.versions.descriptionLabel") }}</span>
        <input
          v-model="createDescription"
          maxlength="2048"
          :disabled="disabled || saving"
          :placeholder="t('app.versions.descriptionPlaceholder')"
        />
      </label>
      <button
        class="primary"
        type="submit"
        :disabled="disabled || saving || !createName.trim()"
      >
        {{ saving ? t("app.versions.saving") : t("app.versions.create") }}
      </button>
      <p class="versions-private-note">{{ t("app.versions.privateHint") }}</p>
    </form>

    <div v-if="!loading && !versions.length" class="versions-empty">
      <h3>{{ t("app.versions.emptyTitle") }}</h3>
      <p>{{ t("app.versions.emptyHint") }}</p>
    </div>

    <div v-else class="versions-layout">
      <section class="versions-list" :aria-label="t('app.versions.listLabel')">
        <h3>{{ t("app.versions.listTitle") }}</h3>
        <article
          v-for="version in orderedForCompare"
          :key="version.id"
          class="version-card"
          :class="{ selected: selectedId === version.id }"
        >
          <button
            class="version-select"
            :data-testid="`version-${version.id}`"
            :aria-pressed="selectedId === version.id"
            @click="selectSavedVersion('b', version.id)"
          >
            <strong>{{ version.name }}</strong>
            <time :datetime="version.createdAt">{{
              new Date(version.createdAt).toLocaleString()
            }}</time>
          </button>
          <p v-if="version.description" class="version-description">
            {{ version.description }}
          </p>
          <div v-if="editingId === version.id" class="version-rename">
            <label>
              <span>{{ t("app.versions.nameLabel") }}</span>
              <input v-model="editName" maxlength="128" :disabled="saving" />
            </label>
            <label>
              <span>{{ t("app.versions.descriptionLabel") }}</span>
              <input
                v-model="editDescription"
                maxlength="2048"
                :disabled="saving"
              />
            </label>
            <button
              class="primary"
              :disabled="saving || !editName.trim()"
              @click="saveRename"
            >
              {{ t("app.versions.saveName") }}
            </button>
            <button
              class="text-button"
              :disabled="saving"
              @click="editingId = ''"
            >
              {{ t("app.actions.back") }}
            </button>
          </div>
          <div v-else class="version-actions">
            <button
              class="text-button"
              :disabled="disabled || saving"
              @click="beginRename(version)"
            >
              {{ t("app.versions.rename") }}
            </button>
            <button
              class="text-button"
              :disabled="disabled || saving"
              @click="
                askRestore(version, $event.currentTarget as HTMLButtonElement)
              "
            >
              {{ t("app.versions.restore") }}
            </button>
            <button
              class="text-button"
              :disabled="disabled || saving"
              @click="
                askRestore(
                  version,
                  $event.currentTarget as HTMLButtonElement,
                  'delete',
                )
              "
            >
              {{ t("app.versions.delete") }}
            </button>
          </div>
        </article>
      </section>

      <section
        class="versions-diff"
        :aria-label="t('app.versions.compareTitle')"
      >
        <div class="versions-diff-heading">
          <h3>{{ t("app.versions.compareTitle") }}</h3>
          <label>
            <span>{{ t("app.versions.compareWith") }}</span>
            <select v-model="compareId" :disabled="versions.length < 2">
              <option
                v-for="version in orderedForCompare"
                :key="version.id"
                :value="version.id"
              >
                {{ version.name }}
              </option>
            </select>
          </label>
        </div>
        <p v-if="selected && compare" class="versions-diff-caption">
          {{
            t("app.versions.diffCaption", {
              before: compare.name,
              after: selected.name,
            })
          }}
        </p>
        <p v-if="diff && !diff.entries.length" class="versions-empty-inline">
          {{ t("app.versions.noChanges") }}
        </p>
        <ul v-else-if="diff" class="version-diff-list">
          <li
            v-for="entry in diff.entries"
            :key="`${entry.category}:${entry.key}`"
          >
            <div class="diff-entry-heading">
              <span class="diff-category">{{
                t(`app.versions.categories.${entry.category}`)
              }}</span>
              <span>{{ t(`app.versions.changes.${entry.change}`) }}</span>
            </div>
            <code>{{ entry.key }}</code>
            <div class="diff-values">
              <p v-if="entry.before !== undefined">
                <strong>{{ t("app.versions.before") }}</strong
                >{{ formatValue(entry.before) }}
              </p>
              <p v-if="entry.after !== undefined">
                <strong>{{ t("app.versions.after") }}</strong
                >{{ formatValue(entry.after) }}
              </p>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <section class="versions-av" aria-labelledby="versions-av-title">
      <div class="versions-av-heading">
        <div>
          <p class="eyebrow">{{ t("app.versions.previewEyebrow") }}</p>
          <h3 id="versions-av-title">{{ t("app.versions.previewTitle") }}</h3>
          <p>{{ t("app.versions.previewDescription") }}</p>
        </div>
        <div class="versions-av-actions">
          <button
            v-if="previewPhase === 'idle' || previewPhase === 'loading-targets'"
            class="primary"
            data-testid="comparison-prepare"
            :disabled="
              disabled ||
              targetsLoading ||
              previewCleanup ||
              !targetA?.compositions.length ||
              !targetB?.compositions.length ||
              identicalPreviewTarget
            "
            @click="prepareComparison"
          >
            {{ t("app.versions.preparePreview") }}
          </button>
          <button
            v-else-if="previewPhase === 'running'"
            class="secondary"
            data-testid="comparison-cancel"
            :disabled="previewCleanup"
            @click="stopPreview(true)"
          >
            {{
              previewCleanup
                ? t("app.versions.cancellingPreview")
                : t("app.versions.cancelPreview")
            }}
          </button>
          <button
            v-else-if="
              previewPhase === 'failed' ||
              previewPhase === 'stale' ||
              previewPhase === 'other' ||
              previewPhase === 'cancelled'
            "
            class="primary"
            data-testid="comparison-retry"
            :disabled="disabled || previewCleanup || identicalPreviewTarget"
            @click="retryComparison"
          >
            {{ t("app.versions.retryPreview") }}
          </button>
          <button
            v-if="previewPhase === 'expired' && previewDescriptor"
            class="secondary"
            data-testid="comparison-reconnect"
            :disabled="previewCleanup"
            @click="reconnectPreview"
          >
            {{ t("app.versions.reconnectPreview") }}
          </button>
          <button
            v-if="previewPhase === 'expired'"
            class="primary"
            data-testid="comparison-prepare-again"
            :disabled="disabled || previewCleanup || identicalPreviewTarget"
            @click="prepareComparison"
          >
            {{ t("app.versions.preparePreview") }}
          </button>
        </div>
      </div>

      <div class="versions-av-targets">
        <label>
          <span>{{ t("app.versions.previewSideA") }}</span>
          <select
            :value="compareId"
            :disabled="disabled || previewCleanup || previewPhase === 'running'"
            @change="chooseSavedVersion('a', $event)"
          >
            <option
              v-for="version in orderedForCompare"
              :key="`preview-a-${version.id}`"
              :value="version.id"
            >
              {{ version.name }}
            </option>
          </select>
        </label>
        <label>
          <span>{{ t("app.versions.previewCompositionA") }}</span>
          <select
            :value="compositionA"
            :disabled="
              disabled ||
              previewCleanup ||
              previewPhase === 'running' ||
              !targetA?.compositions.length
            "
            @change="
              selectComposition('a', ($event.target as HTMLSelectElement).value)
            "
          >
            <option
              v-for="composition in targetA?.compositions ?? []"
              :key="`preview-a-cut-${composition.id}`"
              :value="composition.id"
            >
              {{ composition.title }} ·
              {{ formatSeconds(composition.duration) }}
            </option>
          </select>
        </label>
        <label>
          <span>{{ t("app.versions.previewSideB") }}</span>
          <select
            :value="selectedId"
            :disabled="disabled || previewCleanup || previewPhase === 'running'"
            @change="chooseSavedVersion('b', $event)"
          >
            <option
              v-for="version in orderedForCompare"
              :key="`preview-b-${version.id}`"
              :value="version.id"
            >
              {{ version.name }}
            </option>
          </select>
        </label>
        <label>
          <span>{{ t("app.versions.previewCompositionB") }}</span>
          <select
            :value="compositionB"
            :disabled="
              disabled ||
              previewCleanup ||
              previewPhase === 'running' ||
              !targetB?.compositions.length
            "
            @change="
              selectComposition('b', ($event.target as HTMLSelectElement).value)
            "
          >
            <option
              v-for="composition in targetB?.compositions ?? []"
              :key="`preview-b-cut-${composition.id}`"
              :value="composition.id"
            >
              {{ composition.title }} ·
              {{ formatSeconds(composition.duration) }}
            </option>
          </select>
        </label>
      </div>

      <p v-if="identicalPreviewTarget" class="versions-av-note" role="status">
        {{ t("app.versions.previewChooseDifferent") }}
      </p>
      <p
        v-if="previewPhase === 'running'"
        class="versions-av-status"
        role="status"
        aria-live="polite"
      >
        <span>{{ t("app.versions.previewStatus.running") }}</span>
        <span v-if="previewJob"
          >{{ Math.round((previewJob.progress ?? 0) * 100) }}%</span
        >
      </p>
      <p
        v-else-if="previewPhase === 'other'"
        class="versions-av-status"
        role="status"
        aria-live="polite"
      >
        {{ t("app.versions.previewStatus.other") }}
      </p>
      <p
        v-else-if="previewPhase === 'loading-targets'"
        class="versions-av-status"
        role="status"
        aria-live="polite"
      >
        {{ t("app.versions.previewStatus.loading") }}
      </p>
      <p
        v-else-if="previewPhase === 'stale'"
        class="versions-av-status"
        role="status"
        aria-live="polite"
      >
        {{ t("app.versions.previewStatus.stale") }}
      </p>
      <p
        v-else-if="previewPhase === 'expired'"
        class="versions-av-status"
        role="status"
        aria-live="polite"
      >
        {{ t("app.versions.previewStatus.expired") }}
      </p>
      <p
        v-else-if="previewPhase === 'failed'"
        class="versions-av-status"
        role="status"
        aria-live="polite"
      >
        {{ t("app.versions.previewStatus.failed") }}
      </p>
      <p
        v-else-if="previewPhase === 'cancelled'"
        class="versions-av-status"
        role="status"
        aria-live="polite"
      >
        {{ t("app.versions.previewStatus.cancelled") }}
      </p>
      <p v-if="previewError" class="versions-av-error" role="alert">
        {{ previewError }}
      </p>

      <template v-if="previewDescriptor">
        <p
          v-if="
            previewDescriptor.a.warnings.length ||
            previewDescriptor.b.warnings.length
          "
          class="versions-av-warning"
          role="note"
        >
          {{ t("app.versions.previewTailWarning") }}
        </p>
        <div class="versions-av-players">
          <figure>
            <div class="versions-av-screen">
              <video
                :key="`${previewDescriptor.id}:${mediaGeneration}:a`"
                ref="videoA"
                :src="
                  versionComparisonMediaUrl(
                    previewDescriptor.id,
                    'a',
                    projectId,
                  )
                "
                preload="metadata"
                playsinline
                :aria-label="
                  t('app.versions.previewPlayerA', {
                    name: previewDescriptor.a.versionName,
                  })
                "
                @loadedmetadata="mediaLoaded('a')"
                @timeupdate="playback.onTimeUpdate('a')"
                @ended="playback.onEnded('a')"
                @play="playback.onPlay('a')"
                @error="mediaError"
              />
            </div>
            <figcaption>
              <strong>{{ previewDescriptor.a.versionName }}</strong>
              <span>{{ formatSeconds(previewDescriptor.a.duration) }}</span>
              <span v-if="transportState.ended.a">{{
                t("app.versions.previewEnded")
              }}</span>
            </figcaption>
          </figure>
          <figure>
            <div class="versions-av-screen">
              <video
                :key="`${previewDescriptor.id}:${mediaGeneration}:b`"
                ref="videoB"
                :src="
                  versionComparisonMediaUrl(
                    previewDescriptor.id,
                    'b',
                    projectId,
                  )
                "
                preload="metadata"
                playsinline
                :aria-label="
                  t('app.versions.previewPlayerB', {
                    name: previewDescriptor.b.versionName,
                  })
                "
                @loadedmetadata="mediaLoaded('b')"
                @timeupdate="playback.onTimeUpdate('b')"
                @ended="playback.onEnded('b')"
                @play="playback.onPlay('b')"
                @error="mediaError"
              />
            </div>
            <figcaption>
              <strong>{{ previewDescriptor.b.versionName }}</strong>
              <span>{{ formatSeconds(previewDescriptor.b.duration) }}</span>
              <span v-if="transportState.ended.b">{{
                t("app.versions.previewEnded")
              }}</span>
            </figcaption>
          </figure>
        </div>
        <div class="versions-av-transport">
          <div class="versions-av-transport-actions">
            <button
              class="primary"
              data-testid="comparison-play"
              :disabled="
                !mediaReady.a ||
                !mediaReady.b ||
                previewPhase !== 'ready' ||
                transportState.playing ||
                transportState.starting
              "
              @click="playPreview"
            >
              {{
                transportState.starting
                  ? t("app.versions.previewStarting")
                  : t("app.versions.previewPlay")
              }}
            </button>
            <button
              class="secondary"
              data-testid="comparison-pause"
              :disabled="!transportState.playing && !transportState.starting"
              @click="playback.pause()"
            >
              {{ t("app.versions.previewPause") }}
            </button>
            <span class="versions-av-time" aria-live="off">
              {{ formatSeconds(transportState.time) }} /
              {{ formatSeconds(transportState.duration) }}
            </span>
          </div>
          <label class="versions-av-seek">
            <span class="sr-only">{{ t("app.versions.previewSeek") }}</span>
            <input
              type="range"
              min="0"
              :max="Math.max(transportState.duration, 0.01)"
              step="0.01"
              :value="transportState.time"
              :disabled="
                !mediaReady.a || !mediaReady.b || previewPhase !== 'ready'
              "
              :aria-label="t('app.versions.previewSeek')"
              @input="seekInput"
            />
          </label>
          <div
            class="versions-av-audio"
            role="group"
            :aria-label="t('app.versions.previewAudio')"
          >
            <span>{{ t("app.versions.previewAudio") }}</span>
            <button
              class="text-button"
              :disabled="!previewDescriptor.a.hasAudio"
              :aria-pressed="
                transportState.audibleSide === 'a' && !transportState.muted
              "
              @click="playback.selectAudio('a')"
            >
              {{ t("app.versions.previewAudioA") }}
            </button>
            <button
              class="text-button"
              :disabled="!previewDescriptor.b.hasAudio"
              :aria-pressed="
                transportState.audibleSide === 'b' && !transportState.muted
              "
              @click="playback.selectAudio('b')"
            >
              {{ t("app.versions.previewAudioB") }}
            </button>
            <button
              class="text-button"
              :aria-pressed="transportState.muted"
              @click="playback.setMuted(!transportState.muted)"
            >
              {{
                transportState.muted
                  ? t("app.versions.previewUnmute")
                  : t("app.versions.previewMute")
              }}
            </button>
          </div>
          <p class="versions-av-limitation">
            {{ t("app.versions.previewLimit") }}
          </p>
        </div>
      </template>
    </section>

    <div
      v-if="restoreTarget"
      class="versions-dialog-backdrop"
      @click.self="cancelRestore"
      @keydown.esc.prevent="cancelRestore"
      @keydown.tab="trapRestoreTab"
    >
      <section
        class="versions-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="versions-confirm-title"
        aria-describedby="versions-confirm-description"
      >
        <p class="eyebrow">
          {{
            t(
              confirmationAction === "delete"
                ? "app.versions.deleteEyebrow"
                : "app.versions.confirmEyebrow",
            )
          }}
        </p>
        <h2 id="versions-confirm-title">
          {{
            t(
              confirmationAction === "delete"
                ? "app.versions.deleteTitle"
                : "app.versions.confirmTitle",
              { name: restoreTarget.name },
            )
          }}
        </h2>
        <p id="versions-confirm-description">
          {{
            t(
              confirmationAction === "delete"
                ? "app.versions.deleteDescription"
                : "app.versions.confirmDescription",
              { name: restoreTarget.name },
            )
          }}
        </p>
        <div class="versions-confirm-actions">
          <button class="secondary" :disabled="saving" @click="cancelRestore">
            {{ t("app.actions.back") }}
          </button>
          <button
            ref="confirmButton"
            class="primary"
            :disabled="saving"
            @click="confirmRestore"
          >
            {{
              saving
                ? t(
                    confirmationAction === "delete"
                      ? "app.versions.deleting"
                      : "app.versions.restoring",
                  )
                : t(
                    confirmationAction === "delete"
                      ? "app.versions.confirmDelete"
                      : "app.versions.confirmRestore",
                  )
            }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.versions-av {
  margin-top: var(--of-space-6);
  padding: var(--of-space-5);
  color: var(--of-text-primary);
  background: var(--of-surface-1);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-lg, 16px);
}

.versions-av-heading,
.versions-av-actions,
.versions-av-transport-actions,
.versions-av-audio,
.versions-av-players figure figcaption {
  display: flex;
  align-items: center;
}

.versions-av-heading {
  justify-content: space-between;
  gap: var(--of-space-4);
  margin-bottom: var(--of-space-4);
}

.versions-av-heading h3 {
  margin: 0;
  font-size: 1.15rem;
}

.versions-av-heading p:not(.eyebrow) {
  margin: var(--of-space-1) 0 0;
  color: var(--of-text-secondary);
}

.versions-av-actions,
.versions-av-transport-actions,
.versions-av-audio {
  flex-wrap: wrap;
  gap: var(--of-space-2);
}

.versions-av-targets {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--of-space-3);
}

.versions-av-targets label {
  display: grid;
  min-width: 0;
  gap: var(--of-space-1);
  color: var(--of-text-secondary);
  font-size: 0.82rem;
}

.versions-av-targets select {
  width: 100%;
  min-height: 40px;
  padding: 0 var(--of-space-3);
  color: var(--of-text-primary);
  background: var(--of-surface-2);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-md, 10px);
}

.versions-av :focus-visible {
  outline: 2px solid var(--of-accent);
  outline-offset: 2px;
}

.versions-av-note,
.versions-av-status,
.versions-av-warning,
.versions-av-limitation,
.versions-av-error {
  margin: var(--of-space-3) 0 0;
  padding: var(--of-space-3);
  border-radius: var(--of-radius-md, 10px);
}

.versions-av-note,
.versions-av-status,
.versions-av-limitation {
  color: var(--of-text-secondary);
  background: var(--of-surface-2);
}

.versions-av-status {
  display: flex;
  justify-content: space-between;
  gap: var(--of-space-3);
}

.versions-av-warning {
  color: var(--of-text-primary);
  background: color-mix(in srgb, var(--of-accent) 10%, var(--of-surface-2));
}

.versions-av-error {
  color: var(--of-danger, #a33);
  background: var(--of-surface-2);
}

.versions-av-players {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--of-space-4);
  margin-top: var(--of-space-4);
}

.versions-av-players figure {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  background: var(--of-surface-2);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-md, 10px);
}

.versions-av-screen {
  display: grid;
  min-height: 140px;
  aspect-ratio: 16 / 9;
  place-items: center;
  overflow: hidden;
  background: #101113;
}

.versions-av-screen video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.versions-av-players figure figcaption {
  justify-content: space-between;
  gap: var(--of-space-2);
  padding: var(--of-space-2) var(--of-space-3);
  color: var(--of-text-secondary);
  font-size: 0.82rem;
}

.versions-av-players figure figcaption strong {
  overflow: hidden;
  color: var(--of-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.versions-av-transport {
  display: grid;
  gap: var(--of-space-3);
  margin-top: var(--of-space-4);
  padding-top: var(--of-space-4);
  border-top: 1px solid var(--of-border-subtle);
}

.versions-av-transport-actions {
  justify-content: flex-start;
}

.versions-av-time {
  margin-inline-start: auto;
  color: var(--of-text-secondary);
  font-variant-numeric: tabular-nums;
}

.versions-av-seek input {
  width: 100%;
  accent-color: var(--of-accent);
}

.versions-av-audio {
  color: var(--of-text-secondary);
}

.versions-av-audio > span {
  margin-inline-end: var(--of-space-1);
}

.versions-av-limitation {
  margin: 0;
  font-size: 0.8rem;
}

@media (max-width: 1024px) {
  .versions-av-targets {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .versions-av {
    padding: var(--of-space-3);
  }

  .versions-av-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .versions-av-targets,
  .versions-av-players {
    grid-template-columns: minmax(0, 1fr);
  }

  .versions-av-time {
    margin-inline-start: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .versions-av * {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
