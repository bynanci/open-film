<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.

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
  CreativeVariant,
  CreateVariantInput,
  OpenFilmProject,
  Story,
} from "@openfilm/core";
import type {
  CreativeVariantComparisonResult,
  CreativeVariantImpactReport,
  VersionComparisonPreviewDescriptor,
} from "@openfilm/application";
import { api, versionComparisonMediaUrl } from "../api";
import {
  VersionComparisonPlayback,
  type ComparisonSide,
} from "../versionComparisonPlayback";
import Icon from "./Icon.vue";

const props = defineProps<{
  show?: boolean;
  open?: boolean;
  activeStory?: Story;
  project?: OpenFilmProject;
  activeCompositionId?: string;
  disabled?: boolean;
  flushProjectPending?: () => Promise<boolean>;
}>();

const emit = defineEmits<{
  close: [];
  adopted: [
    result: {
      project: OpenFilmProject;
      checkpointVersionId: string;
      compositionId?: string;
    },
  ];
  playbackStart: [];
}>();

const { t } = useI18n();

const isVisible = computed(() => props.show === true || props.open === true);
const modalRef = ref<HTMLElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
let restoreFocusTo: HTMLElement | null = null;

type ModalView = "list" | "create" | "compare";

const currentView = ref<ModalView>("list");
const variants = ref<CreativeVariant[]>([]);
const loading = ref(false);
const actionLoading = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);

// Create form state
const formName = ref("");
const formIntent = ref("");
const formScopeType = ref<"film" | "section">("section");
const formTargetBeatId = ref("");
const formTargetDuration = ref<number | undefined>(undefined);
const formNarration = ref("");
const impactReport = ref<CreativeVariantImpactReport | null>(null);
const impactLoading = ref(false);

// Compare state
const selectedVariantAId = ref<string>("");
const selectedVariantBId = ref<string>("");
const comparison = ref<CreativeVariantComparisonResult | null>(null);
const selectedBeatIndex = ref<number>(0);
const comparisonLoading = ref(false);

type VariantPreviewPhase =
  | "idle"
  | "snapshot"
  | "rendering"
  | "ready"
  | "other"
  | "failed"
  | "stale"
  | "cancelled";
const previewPhase = ref<VariantPreviewPhase>("idle");
const previewError = ref("");
const previewDescriptor = shallowRef<VersionComparisonPreviewDescriptor>();
const previewSnapshot = ref<{
  key: string;
  versionId: string;
  name: string;
}>();
const pendingSnapshotRequest = ref<{ key: string; requestId: string }>();
const previewRequestId = ref("");
const previewProjectId = ref("");
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
let comparisonGeneration = 0;
let variantsLoadGeneration = 0;
let disposed = false;
let previewStopTask: Promise<boolean> | undefined;
const playback = new VersionComparisonPlayback(
  () => ({ a: videoA.value, b: videoB.value }),
  transportState,
  () => {
    previewError.value = t("app.variants.previewPlaybackFailed");
  },
);

function truncateUtf16(value: string, maxCodeUnits: number) {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > maxCodeUnits) break;
    result += character;
  }
  return result;
}

const isCreateValid = computed(() => {
  if (!formName.value.trim() || !formIntent.value.trim()) return false;
  if (formScopeType.value === "section" && !formTargetBeatId.value)
    return false;
  return true;
});

async function loadVariants() {
  const generation = ++variantsLoadGeneration,
    projectId = props.project?.id;
  loading.value = true;
  error.value = null;
  try {
    const res = await api.creativeVariantsList();
    if (
      generation !== variantsLoadGeneration ||
      props.project?.id !== projectId
    )
      return;
    variants.value = res.variants;
    if (res.variants.length > 0) {
      if (!selectedVariantAId.value)
        selectedVariantAId.value = res.variants[0]?.id ?? "";
      if (!selectedVariantBId.value && res.variants.length > 1) {
        selectedVariantBId.value = res.variants[1]?.id ?? "";
      }
    }
  } catch (err: unknown) {
    if (
      generation !== variantsLoadGeneration ||
      props.project?.id !== projectId
    )
      return;
    error.value =
      (err as Error)?.message ?? "Failed to load creative variants.";
  } finally {
    if (generation === variantsLoadGeneration) loading.value = false;
  }
}

async function handlePreviewImpact() {
  if (!isCreateValid.value) return;
  impactLoading.value = true;
  error.value = null;
  try {
    const input: CreateVariantInput = {
      name: formName.value.trim(),
      intent: formIntent.value.trim(),
      scope:
        formScopeType.value === "section"
          ? { type: "section", targetBeatId: formTargetBeatId.value }
          : { type: "film" },
      baselineStoryId: props.activeStory?.id,
      modifications: {
        targetBeatId: formTargetBeatId.value || undefined,
        targetDuration: formTargetDuration.value
          ? Number(formTargetDuration.value)
          : undefined,
        narration: formNarration.value.trim() || undefined,
      },
    };
    const res = await api.creativeVariantsPreviewImpact(input);
    impactReport.value = res.report;
  } catch (err: unknown) {
    error.value = (err as Error)?.message ?? "Failed to preview impact.";
  } finally {
    impactLoading.value = false;
  }
}

async function handleCreateVariant() {
  if (!isCreateValid.value) return;
  actionLoading.value = true;
  error.value = null;
  try {
    const input: CreateVariantInput = {
      name: formName.value.trim(),
      intent: formIntent.value.trim(),
      scope:
        formScopeType.value === "section"
          ? { type: "section", targetBeatId: formTargetBeatId.value }
          : { type: "film" },
      baselineStoryId: props.activeStory?.id,
      modifications: {
        targetBeatId: formTargetBeatId.value || undefined,
        targetDuration: formTargetDuration.value
          ? Number(formTargetDuration.value)
          : undefined,
        narration: formNarration.value.trim() || undefined,
      },
    };
    const res = await api.creativeVariantsCreate(input);
    successMessage.value = t("app.variants.messages.created");
    await loadVariants();
    selectedVariantBId.value = res.variant.id;
    currentView.value = "compare";
    await handleCompare();
  } catch (err: unknown) {
    error.value =
      (err as Error)?.message ?? "Failed to create creative variant.";
  } finally {
    actionLoading.value = false;
  }
}

async function handleCompare() {
  const generation = ++comparisonGeneration,
    projectId = props.project?.id,
    variantAId = selectedVariantAId.value,
    variantBId = selectedVariantBId.value;
  if (!variantAId || !variantBId || !projectId) {
    comparisonLoading.value = false;
    return;
  }
  comparisonLoading.value = true;
  if (!(await stopVariantPreview())) {
    if (generation === comparisonGeneration) comparisonLoading.value = false;
    return;
  }
  const stillCurrent = () =>
    generation === comparisonGeneration &&
    !disposed &&
    isVisible.value &&
    props.project?.id === projectId &&
    selectedVariantAId.value === variantAId &&
    selectedVariantBId.value === variantBId;
  if (!stillCurrent()) {
    if (generation === comparisonGeneration) comparisonLoading.value = false;
    return;
  }
  error.value = null;
  try {
    const res = await api.creativeVariantsCompare(variantAId, variantBId);
    if (!stillCurrent()) return;
    comparison.value = res.comparison;
    currentView.value = "compare";
  } catch (err: unknown) {
    if (!stillCurrent()) return;
    error.value = (err as Error)?.message ?? "Failed to compare variants.";
  } finally {
    if (generation === comparisonGeneration) comparisonLoading.value = false;
  }
}

async function handleAdopt(variantId: string) {
  if (!(await stopVariantPreview())) return;
  actionLoading.value = true;
  error.value = null;
  try {
    const res = await api.creativeVariantsAdopt(variantId);
    successMessage.value = t("app.variants.messages.adopted");
    emit("adopted", res);
    await loadVariants();
  } catch (err: unknown) {
    error.value = (err as Error)?.message ?? "Failed to adopt variant.";
  } finally {
    actionLoading.value = false;
  }
}

async function handleDelete(variantId: string) {
  if (!(await stopVariantPreview())) return;
  actionLoading.value = true;
  error.value = null;
  try {
    await api.creativeVariantsDelete(variantId);
    await loadVariants();
    if (selectedVariantBId.value === variantId) {
      selectedVariantBId.value = "";
      comparison.value = null;
    }
  } catch (err: unknown) {
    error.value = (err as Error)?.message ?? "Failed to delete variant.";
  } finally {
    actionLoading.value = false;
  }
}

function selectAudio(channel: ComparisonSide) {
  if (transportState.audibleSide === channel && transportState.muted) {
    playback.setMuted(false);
    return;
  }
  playback.selectAudio(transportState.audibleSide === channel ? null : channel);
}

function currentPreviewTargets() {
  const value = comparison.value;
  if (
    !value ||
    value.variantA.id !== selectedVariantAId.value ||
    value.variantB.id !== selectedVariantBId.value
  )
    return undefined;
  return {
    a: {
      variantId: value.variantA.id,
      compositionId: value.variantA.derivedCompositionId,
    },
    b: {
      variantId: value.variantB.id,
      compositionId: value.variantB.derivedCompositionId,
    },
  };
}

function previewStillOwned(
  generation: number,
  projectId: string,
  targetKey: string,
) {
  const target = currentPreviewTargets();
  return (
    generation === previewGeneration &&
    props.project?.id === projectId &&
    !!target &&
    JSON.stringify([target.a, target.b]) === targetKey
  );
}

function unloadPreviewPlayers() {
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

async function stopVariantPreview(userRequested = false): Promise<boolean> {
  if (previewStopTask) return previewStopTask;
  const projectId = previewProjectId.value || props.project?.id,
    requestId = previewRequestId.value;
  ++previewGeneration;
  playback.unload();
  unloadPreviewPlayers();
  previewDescriptor.value = undefined;
  previewError.value = "";
  if (!requestId || !projectId) {
    previewRequestId.value = "";
    previewProjectId.value = "";
    previewPhase.value = userRequested ? "cancelled" : "idle";
    return true;
  }
  previewCleanup.value = true;
  previewStopTask = (async () => {
    try {
      await api.cancelVersionComparison({ projectId, requestId });
      previewRequestId.value = "";
      previewProjectId.value = "";
      previewPhase.value = userRequested ? "cancelled" : "idle";
      return true;
    } catch (cause) {
      previewError.value = (cause as Error)?.message ?? String(cause);
      previewPhase.value = "failed";
      return false;
    } finally {
      previewCleanup.value = false;
      previewStopTask = undefined;
    }
  })();
  return previewStopTask;
}

async function prepareVariantPreview(reuseRequestId?: string) {
  if (
    disposed ||
    !isVisible.value ||
    props.disabled ||
    previewCleanup.value ||
    previewPhase.value === "snapshot" ||
    previewPhase.value === "rendering"
  )
    return;
  const target = currentPreviewTargets(),
    projectId = props.project?.id;
  if (!target || !projectId) return;
  const generation = ++previewGeneration,
    targetKey = JSON.stringify([target.a, target.b]),
    isCurrent = () => previewStillOwned(generation, projectId, targetKey);
  previewPhase.value = "snapshot";
  previewError.value = "";
  previewDescriptor.value = undefined;
  mediaReady.a = false;
  mediaReady.b = false;
  try {
    if (!props.flushProjectPending || !(await props.flushProjectPending())) {
      if (isCurrent()) {
        previewPhase.value = "failed";
        previewError.value = t("app.variants.previewSaveFailed");
      }
      return;
    }
    if (!isCurrent()) return;
    const revision = await api.projectVersionRevision();
    if (!isCurrent()) return;
    if (revision.projectId !== projectId) {
      previewPhase.value = "stale";
      previewError.value = t("app.variants.previewProjectChanged");
      return;
    }

    // Refresh the selected variant pair after flushing editor drafts. The version
    // snapshot will then bind exactly the Compositions being compared.
    const refreshed = await api.creativeVariantsCompare(
      target.a.variantId,
      target.b.variantId,
    );
    if (!isCurrent()) return;
    comparison.value = refreshed.comparison;
    const refreshedTargets = currentPreviewTargets();
    if (!refreshedTargets) return;
    const refreshedTargetKey = JSON.stringify([
      refreshedTargets.a,
      refreshedTargets.b,
    ]);
    if (refreshedTargetKey !== targetKey) {
      previewPhase.value = "stale";
      previewError.value = t("app.variants.previewChanged");
      return;
    }

    const key = JSON.stringify([projectId, revision.revision, targetKey]);
    let snapshot = previewSnapshot.value;
    if (!snapshot || snapshot.key !== key) {
      const snapshotName = truncateUtf16(
        t("app.variants.previewSnapshotName", {
          a: refreshed.comparison.variantA.name,
          b: refreshed.comparison.variantB.name,
        }),
        128,
      );
      const createRequestId =
        pendingSnapshotRequest.value?.key === key
          ? pendingSnapshotRequest.value.requestId
          : crypto.randomUUID();
      pendingSnapshotRequest.value = { key, requestId: createRequestId };
      const created = await api.createProjectVersion({
        expectedProjectId: projectId,
        name: snapshotName,
        description: t("app.variants.previewSnapshotDescription", {
          a: refreshed.comparison.variantA.name,
          b: refreshed.comparison.variantB.name,
        }),
        baseRevision: revision.revision,
        requestId: createRequestId,
      });
      pendingSnapshotRequest.value = undefined;
      if (!isCurrent()) return;
      if (created.version.projectId !== projectId) {
        previewPhase.value = "stale";
        previewError.value = t("app.variants.previewProjectChanged");
        return;
      }
      snapshot = {
        key,
        versionId: created.version.id,
        name: created.version.name,
      };
      previewSnapshot.value = snapshot;
    }

    if (!isCurrent()) return;
    const requestId = reuseRequestId ?? crypto.randomUUID();
    previewRequestId.value = requestId;
    previewProjectId.value = projectId;
    previewPhase.value = "rendering";
    const descriptor = await api.prepareVersionComparison({
      projectId,
      requestId,
      a: {
        versionId: snapshot.versionId,
        compositionId: refreshedTargets.a.compositionId,
      },
      b: {
        versionId: snapshot.versionId,
        compositionId: refreshedTargets.b.compositionId,
      },
    });
    if (!isCurrent()) {
      await api.cancelVersionComparison({ projectId, requestId });
      return;
    }
    if (
      descriptor.projectId !== projectId ||
      descriptor.a.versionId !== snapshot.versionId ||
      descriptor.b.versionId !== snapshot.versionId ||
      descriptor.a.compositionId !== refreshedTargets.a.compositionId ||
      descriptor.b.compositionId !== refreshedTargets.b.compositionId
    ) {
      await api.cancelVersionComparison({ projectId, requestId });
      previewRequestId.value = "";
      previewProjectId.value = "";
      previewPhase.value = "stale";
      previewError.value = t("app.variants.previewChanged");
      return;
    }
    previewDescriptor.value = descriptor;
    mediaGeneration.value++;
    playback.configure(descriptor);
    previewPhase.value = "ready";
    previewRequestId.value = requestId;
  } catch (cause) {
    if (!isCurrent()) return;
    previewError.value = (cause as Error)?.message ?? String(cause);
    const status = (cause as { status?: number }).status;
    if (previewRequestId.value && (status === 0 || status === 409)) {
      try {
        const state = await api.jobs(),
          job = state.jobs.find((item) => item.id === previewRequestId.value);
        if (!isCurrent()) return;
        if (job?.status === "queued" || job?.status === "running") {
          previewPhase.value = "other";
          previewError.value = t("app.variants.previewOther");
          return;
        }
        if (job?.status === "failed" || job?.status === "cancelled") {
          previewRequestId.value = "";
          previewProjectId.value = "";
          previewPhase.value = "failed";
          return;
        }
      } catch {
        if (!isCurrent()) return;
        previewPhase.value = "other";
        previewError.value = t("app.variants.previewReconnect");
        return;
      }
    }
    previewPhase.value = status === 409 ? "stale" : "failed";
    previewRequestId.value = "";
    previewProjectId.value = "";
  }
}

async function retryVariantPreview() {
  const requestId = previewRequestId.value;
  const generation = previewGeneration,
    projectId = props.project?.id,
    target = currentPreviewTargets(),
    isCurrent = () =>
      !disposed &&
      isVisible.value &&
      generation === previewGeneration &&
      props.project?.id === projectId &&
      !!target &&
      JSON.stringify(currentPreviewTargets()) === JSON.stringify(target);
  if (!requestId) {
    await prepareVariantPreview();
    return;
  }
  try {
    const state = await api.jobs(),
      job = state.jobs.find((item) => item.id === requestId);
    if (!isCurrent()) return;
    if (job?.status === "queued" || job?.status === "running") {
      previewPhase.value = "other";
      previewError.value = t("app.variants.previewOther");
      return;
    }
    if (job?.status === "failed" || job?.status === "cancelled") {
      previewRequestId.value = "";
      previewProjectId.value = "";
      await prepareVariantPreview();
      return;
    }
    // A completed Job may still refer to a preview pair that has expired or
    // was revoked. The durable named snapshot is reusable, but Job IDs are
    // one-shot; prepare again with a fresh request ID.
    previewRequestId.value = "";
    previewProjectId.value = "";
    await prepareVariantPreview();
  } catch (cause) {
    if (!isCurrent()) return;
    previewPhase.value = "other";
    previewError.value = (cause as Error)?.message ?? String(cause);
  }
}

function playVariantPreview() {
  if (!mediaReady.a || !mediaReady.b || previewPhase.value !== "ready") return;
  emit("playbackStart");
  void playback.play();
}

function mediaLoaded(side: ComparisonSide) {
  mediaReady[side] = true;
  const player = side === "a" ? videoA.value : videoB.value;
  if (player && Math.abs(player.currentTime - transportState.time) > 0.04)
    player.currentTime = transportState.time;
  // The first <video> nodes may mount after configure() set the transport.
  // Reapply the single-audible-side rule after both refs exist.
  playback.selectAudio(transportState.audibleSide);
}

function mediaFailed() {
  playback.pause();
  previewPhase.value = "stale";
  previewError.value = t("app.variants.previewExpired");
}

function seekPreview(event: Event) {
  void playback.seek(Number((event.target as HTMLInputElement).value));
}

function formatPreviewTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

async function closeModal() {
  ++comparisonGeneration;
  comparisonLoading.value = false;
  if (!(await stopVariantPreview())) return;
  emit("close");
  window.requestAnimationFrame(() => {
    if (restoreFocusTo?.isConnected)
      restoreFocusTo.focus({ preventScroll: true });
  });
}

async function selectModalView(view: ModalView) {
  if (currentView.value !== view) {
    ++comparisonGeneration;
    comparisonLoading.value = false;
  }
  if (
    currentView.value === "compare" &&
    view !== "compare" &&
    !(await stopVariantPreview())
  )
    return;
  currentView.value = view;
}

function handleKeydown(e: KeyboardEvent) {
  if (!isVisible.value) return;
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeModal();
    return;
  }
  if (e.key !== "Tab") return;

  const modal = modalRef.value;
  if (!modal) return;
  const focusable = Array.from(
    modal.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    e.preventDefault();
    modal.focus({ preventScroll: true });
    return;
  }

  const active = document.activeElement;
  if (e.shiftKey && (active === first || !modal.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !modal.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

watch(
  () => isVisible.value,
  (val) => {
    if (val) {
      void loadVariants();
      const beats =
        props.activeStory?.beats ?? props.project?.stories?.[0]?.beats;
      if (beats && beats.length > 0) {
        formTargetBeatId.value = beats[0]?.id ?? "";
      }
    } else {
      ++comparisonGeneration;
      comparisonLoading.value = false;
      ++variantsLoadGeneration;
      void stopVariantPreview();
    }
  },
  { immediate: true },
);
watch(
  () => props.project?.id,
  (projectId, previousProjectId) => {
    if (projectId === previousProjectId) return;
    ++comparisonGeneration;
    comparisonLoading.value = false;
    ++variantsLoadGeneration;
    comparison.value = null;
    variants.value = [];
    selectedVariantAId.value = "";
    selectedVariantBId.value = "";
    previewSnapshot.value = undefined;
    pendingSnapshotRequest.value = undefined;
    void stopVariantPreview();
    if (isVisible.value) void loadVariants();
  },
);

onMounted(async () => {
  disposed = false;
  restoreFocusTo =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  window.addEventListener("keydown", handleKeydown);
  await nextTick();
  closeButtonRef.value?.focus({ preventScroll: true });
});

onBeforeUnmount(() => {
  disposed = true;
  ++comparisonGeneration;
  comparisonLoading.value = false;
  ++variantsLoadGeneration;
  window.removeEventListener("keydown", handleKeydown);
  void stopVariantPreview();
});

defineExpose({ stopPreview: () => stopVariantPreview() });
</script>

<template>
  <div
    v-if="isVisible"
    class="variants-modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="creative-variant-dialog-title"
    data-testid="creative-variant-modal"
  >
    <div
      ref="modalRef"
      class="variants-modal-container"
      :class="{
        'comparison-expanded': currentView === 'compare',
        'list-view': currentView === 'list',
      }"
      tabindex="-1"
    >
      <!-- Header -->
      <header class="variants-modal-header">
        <div class="header-title-row">
          <Icon name="compare" class="header-icon" />
          <h2 id="creative-variant-dialog-title" class="header-title">
            {{ t("app.variants.modalTitle") }}
          </h2>
          <div class="header-tabs">
            <button
              class="tab-btn"
              data-testid="variant-tab-list"
              :class="{ active: currentView === 'list' }"
              :aria-pressed="currentView === 'list'"
              @click="selectModalView('list')"
            >
              {{ t("app.variants.tabs.list") }}
            </button>
            <button
              class="tab-btn"
              data-testid="variant-tab-create"
              :class="{ active: currentView === 'create' }"
              :aria-pressed="currentView === 'create'"
              @click="selectModalView('create')"
            >
              {{ t("app.variants.tabs.create") }}
            </button>
            <button
              v-if="comparison || variants.length > 1"
              class="tab-btn"
              data-testid="variant-tab-compare"
              :class="{ active: currentView === 'compare' }"
              :aria-pressed="currentView === 'compare'"
              @click="selectModalView('compare')"
            >
              {{ t("app.variants.tabs.compare") }}
            </button>
          </div>
        </div>
        <button
          ref="closeButtonRef"
          class="close-btn"
          :aria-label="t('app.variants.actions.close')"
          @click="closeModal"
        >
          ✕
        </button>
      </header>

      <!-- Alerts -->
      <div v-if="error" class="variants-alert error-alert" role="alert">
        <span>{{ error }}</span>
        <button class="alert-dismiss" @click="error = null">✕</button>
      </div>
      <div
        v-if="successMessage"
        class="variants-alert success-alert"
        role="status"
      >
        <span>{{ successMessage }}</span>
        <button class="alert-dismiss" @click="successMessage = null">✕</button>
      </div>

      <!-- Main Body -->
      <main class="variants-modal-body">
        <!-- 1. LIST VIEW -->
        <div v-if="currentView === 'list'" class="view-pane list-pane">
          <div class="pane-action-bar">
            <h3>{{ t("app.variants.listHeader") }}</h3>
            <button class="primary-btn" @click="selectModalView('create')">
              {{ t("app.variants.actions.newVariant") }}
            </button>
          </div>

          <div v-if="variants.length === 0 && !loading" class="empty-state">
            <p>{{ t("app.variants.emptyNotice") }}</p>
            <button class="cta-btn" @click="selectModalView('create')">
              {{ t("app.variants.actions.createFirst") }}
            </button>
          </div>

          <div v-else class="variants-grid" :aria-busy="loading">
            <p v-if="loading" class="variants-loading" role="status">
              {{ t("app.variants.loading") }}
            </p>
            <div
              v-for="variant in variants"
              :key="variant.id"
              class="variant-card"
              :class="{ adopted: variant.status === 'adopted' }"
            >
              <div class="card-header">
                <span class="variant-name">{{ variant.name }}</span>
                <span class="status-badge" :class="variant.status">
                  {{ t(`app.variants.status.${variant.status}`) }}
                </span>
              </div>
              <p class="variant-intent">{{ variant.intent }}</p>
              <div class="variant-meta">
                <span class="scope-tag">
                  {{
                    variant.scope.type === "section"
                      ? t("app.variants.scope.section")
                      : t("app.variants.scope.film")
                  }}
                </span>
                <span class="date-tag">{{
                  new Date(variant.createdAt).toLocaleDateString()
                }}</span>
              </div>
              <div class="card-actions">
                <button
                  class="card-btn"
                  :data-testid="`variant-compare-${variant.id}`"
                  @click="
                    selectedVariantAId = variants[0]?.id || variant.id;
                    selectedVariantBId = variant.id;
                    handleCompare();
                  "
                >
                  {{ t("app.variants.actions.compare") }}
                </button>
                <button
                  v-if="variant.status !== 'adopted'"
                  class="card-btn adopt-btn"
                  :disabled="actionLoading"
                  @click="handleAdopt(variant.id)"
                >
                  {{ t("app.variants.actions.adopt") }}
                </button>
                <button
                  v-if="variant.status !== 'adopted'"
                  class="card-btn delete-btn"
                  @click="handleDelete(variant.id)"
                >
                  {{ t("app.variants.actions.delete") }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. CREATE VIEW -->
        <div v-else-if="currentView === 'create'" class="view-pane create-pane">
          <div class="form-grid">
            <div class="form-column">
              <h3>{{ t("app.variants.createHeader") }}</h3>
              <div class="form-field">
                <label for="variant-name"
                  >{{ t("app.variants.fields.name") }} *</label
                >
                <input
                  id="variant-name"
                  v-model="formName"
                  type="text"
                  :placeholder="t('app.variants.placeholders.name')"
                  @input="handlePreviewImpact"
                />
              </div>

              <div class="form-field">
                <label for="variant-intent"
                  >{{ t("app.variants.fields.intent") }} *</label
                >
                <textarea
                  id="variant-intent"
                  v-model="formIntent"
                  rows="3"
                  :placeholder="t('app.variants.placeholders.intent')"
                  @input="handlePreviewImpact"
                />
              </div>

              <div class="form-field">
                <span id="variant-scope-label" class="form-field-label">{{
                  t("app.variants.fields.scope")
                }}</span>
                <div
                  class="radio-group"
                  role="group"
                  aria-labelledby="variant-scope-label"
                >
                  <label for="variant-scope-section">
                    <input
                      id="variant-scope-section"
                      v-model="formScopeType"
                      type="radio"
                      value="section"
                      @change="handlePreviewImpact"
                    />
                    {{ t("app.variants.scope.sectionOnly") }}
                  </label>
                  <label for="variant-scope-film">
                    <input
                      id="variant-scope-film"
                      v-model="formScopeType"
                      type="radio"
                      value="film"
                      @change="handlePreviewImpact"
                    />
                    {{ t("app.variants.scope.wholeFilm") }}
                  </label>
                </div>
              </div>

              <div v-if="formScopeType === 'section'" class="form-field">
                <label for="variant-target-beat"
                  >{{ t("app.variants.fields.targetBeat") }} *</label
                >
                <select
                  id="variant-target-beat"
                  v-model="formTargetBeatId"
                  @change="handlePreviewImpact"
                >
                  <option
                    v-for="beat in activeStory?.beats ?? []"
                    :key="beat.id"
                    :value="beat.id"
                  >
                    {{ beat.title }} ({{ beat.targetDuration }}s)
                  </option>
                </select>
              </div>

              <div class="form-field">
                <label for="variant-target-duration">{{
                  t("app.variants.fields.targetDuration")
                }}</label>
                <input
                  id="variant-target-duration"
                  v-model.number="formTargetDuration"
                  type="number"
                  min="1"
                  step="0.5"
                  :placeholder="t('app.variants.placeholders.duration')"
                  @input="handlePreviewImpact"
                />
              </div>

              <div class="form-field">
                <label for="variant-narration">{{
                  t("app.variants.fields.narration")
                }}</label>
                <textarea
                  id="variant-narration"
                  v-model="formNarration"
                  rows="2"
                  :placeholder="t('app.variants.placeholders.narration')"
                  @input="handlePreviewImpact"
                />
              </div>

              <div class="form-submit-row">
                <button
                  class="primary-btn"
                  :disabled="!isCreateValid || actionLoading"
                  @click="handleCreateVariant"
                >
                  {{ t("app.variants.actions.createConfirm") }}
                </button>
                <button class="secondary-btn" @click="selectModalView('list')">
                  {{ t("app.variants.actions.cancel") }}
                </button>
              </div>
            </div>

            <!-- Impact Preview Column -->
            <div class="impact-preview-column">
              <h4>{{ t("app.variants.impactHeader") }}</h4>

              <div v-if="impactReport?.lockedNotice" class="locked-warning">
                <Icon name="lock" />
                <span>{{ impactReport.lockedNotice }}</span>
              </div>

              <div class="impact-section">
                <span class="impact-subtitle">{{
                  t("app.variants.plannedChanges")
                }}</span>
                <ul class="changes-list">
                  <li
                    v-for="(change, idx) in impactReport?.plannedChanges ?? []"
                    :key="idx"
                  >
                    {{ change }}
                  </li>
                </ul>
              </div>

              <div class="impact-section">
                <span class="impact-subtitle">{{
                  t("app.variants.preservedSections")
                }}</span>
                <div class="preserved-tags">
                  <span
                    v-for="sec in impactReport?.preservedSections ?? []"
                    :key="sec.sectionId"
                    class="preserved-chip"
                  >
                    ✓ {{ sec.type }}: {{ sec.sectionId }}
                  </span>
                </div>
              </div>

              <div
                v-if="
                  impactReport?.unsupportedIntents &&
                  impactReport.unsupportedIntents.length > 0
                "
                class="impact-section brief-section"
              >
                <span class="impact-subtitle">{{
                  t("app.variants.unsupportedBrief")
                }}</span>
                <p class="brief-notice">
                  {{ t("app.variants.unsupportedNotice") }}
                </p>
                <ul class="brief-list">
                  <li
                    v-for="(intent, idx) in impactReport.unsupportedIntents"
                    :key="idx"
                  >
                    "{{ intent }}"
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. COMPARE VIEW (A/B Review) -->
        <div
          v-else-if="currentView === 'compare'"
          class="view-pane compare-pane"
        >
          <div class="compare-selectors">
            <div class="selector-box">
              <label>{{ t("app.variants.labels.variantA") }}:</label>
              <select
                v-model="selectedVariantAId"
                data-testid="variant-select-a"
                @change="handleCompare"
              >
                <option v-for="v in variants" :key="v.id" :value="v.id">
                  {{ v.name }}
                </option>
              </select>
            </div>
            <span class="vs-badge">VS</span>
            <div class="selector-box">
              <label>{{ t("app.variants.labels.variantB") }}:</label>
              <select
                v-model="selectedVariantBId"
                data-testid="variant-select-b"
                @change="handleCompare"
              >
                <option v-for="v in variants" :key="v.id" :value="v.id">
                  {{ v.name }}
                </option>
              </select>
            </div>
            <button
              class="primary-btn"
              :disabled="comparisonLoading"
              @click="handleCompare"
            >
              {{ t("app.variants.actions.refreshDiff") }}
            </button>
          </div>

          <div v-if="comparison" class="compare-content">
            <div class="variant-av-preview-bar">
              <p
                v-if="previewPhase === 'snapshot'"
                class="variant-av-status"
                role="status"
                aria-live="polite"
              >
                {{ t("app.variants.previewSnapshotSaving") }}
              </p>
              <p
                v-else-if="previewPhase === 'rendering'"
                class="variant-av-status"
                role="status"
                aria-live="polite"
              >
                {{ t("app.variants.previewRendering") }}
              </p>
              <p
                v-else-if="previewPhase === 'other'"
                class="variant-av-status"
                role="status"
                aria-live="polite"
              >
                {{ t("app.variants.previewOther") }}
              </p>
              <p
                v-else-if="previewPhase === 'ready' && previewSnapshot"
                class="variant-av-status"
                role="status"
                aria-live="polite"
              >
                {{
                  t("app.variants.previewSnapshotSaved", {
                    name: previewSnapshot.name,
                  })
                }}
              </p>
              <button
                v-if="previewPhase === 'idle' || previewPhase === 'cancelled'"
                class="primary-btn"
                data-testid="variant-av-preview"
                :disabled="
                  disabled ||
                  previewCleanup ||
                  actionLoading ||
                  comparisonLoading
                "
                @click="() => prepareVariantPreview()"
              >
                {{ t("app.variants.actions.previewAv") }}
              </button>
              <button
                v-else-if="previewPhase === 'snapshot'"
                class="secondary-btn"
                disabled
              >
                {{ t("app.variants.previewSnapshotSaving") }}
              </button>
              <button
                v-else-if="previewPhase === 'rendering'"
                class="secondary-btn"
                data-testid="variant-av-cancel"
                :disabled="previewCleanup"
                @click="stopVariantPreview(true)"
              >
                {{ t("app.variants.actions.cancelPreview") }}
              </button>
              <button
                v-else-if="
                  previewPhase === 'failed' ||
                  previewPhase === 'stale' ||
                  previewPhase === 'other'
                "
                class="primary-btn"
                data-testid="variant-av-retry"
                :disabled="
                  disabled ||
                  previewCleanup ||
                  actionLoading ||
                  comparisonLoading
                "
                @click="retryVariantPreview"
              >
                {{ t("app.variants.actions.retryPreview") }}
              </button>
              <button
                v-else-if="previewPhase === 'ready'"
                class="secondary-btn"
                data-testid="variant-av-stop"
                :disabled="previewCleanup"
                @click="stopVariantPreview()"
              >
                {{ t("app.variants.actions.stopPreview") }}
              </button>
            </div>
            <p v-if="previewError" class="variant-av-error" role="alert">
              {{ previewError }}
            </p>

            <!-- One saved comparison snapshot, rendered by the existing service. -->
            <p
              v-if="
                previewDescriptor &&
                (previewDescriptor.a.warnings.length > 0 ||
                  previewDescriptor.b.warnings.length > 0)
              "
              class="variant-av-warning"
              role="note"
            >
              {{ t("app.versions.previewTailWarning") }}
            </p>
            <div class="comparison-players-row">
              <!-- Player A -->
              <div class="player-card">
                <div class="player-header">
                  <span class="player-label"
                    >{{ comparison.variantA.name }} (A)</span
                  >
                  <span class="duration-badge"
                    >{{ comparison.diff.baselineDuration }}s</span
                  >
                </div>
                <div class="player-view">
                  <video
                    v-if="previewDescriptor"
                    :key="`${previewDescriptor.id}:${mediaGeneration}:a`"
                    ref="videoA"
                    :src="
                      versionComparisonMediaUrl(
                        previewDescriptor.id,
                        'a',
                        props.project?.id ?? '',
                      )
                    "
                    preload="metadata"
                    playsinline
                    :aria-label="
                      t('app.variants.previewPlayerA', {
                        name: comparison.variantA.name,
                      })
                    "
                    @loadedmetadata="mediaLoaded('a')"
                    @timeupdate="playback.onTimeUpdate('a')"
                    @ended="playback.onEnded('a')"
                    @play="playback.onPlay('a')"
                    @error="mediaFailed"
                  />
                  <div v-else class="video-mock-frame">
                    <Icon
                      class="video-placeholder-icon"
                      name="play"
                      :size="24"
                      aria-hidden="true"
                    />
                    <span class="video-watermark">{{
                      t("app.variants.previewA")
                    }}</span>
                  </div>
                </div>
                <div class="player-controls">
                  <button
                    class="audio-toggle-btn"
                    :class="{
                      active:
                        transportState.audibleSide === 'a' &&
                        !transportState.muted,
                    }"
                    :disabled="!previewDescriptor?.a.hasAudio"
                    :aria-pressed="
                      transportState.audibleSide === 'a' &&
                      !transportState.muted
                    "
                    :aria-label="
                      t(
                        transportState.audibleSide === 'a' &&
                          !transportState.muted
                          ? 'app.variants.audio.muteSide'
                          : 'app.variants.audio.playSide',
                        { name: comparison.variantA.name, side: 'A' },
                      )
                    "
                    @click="selectAudio('a')"
                  >
                    <Icon name="volume" :size="16" aria-hidden="true" />
                    {{
                      transportState.audibleSide === "a" &&
                      !transportState.muted
                        ? t("app.variants.audio.active")
                        : t("app.variants.audio.play")
                    }}
                  </button>
                  <span class="audio-rule-notice">{{
                    t("app.variants.audio.rule")
                  }}</span>
                </div>
              </div>

              <!-- Player B -->
              <div class="player-card">
                <div class="player-header">
                  <span class="player-label"
                    >{{ comparison.variantB.name }} (B)</span
                  >
                  <span class="duration-badge"
                    >{{ comparison.diff.targetDuration }}s</span
                  >
                  <span
                    class="delta-badge"
                    :class="{ shorter: comparison.diff.deltaSeconds < 0 }"
                  >
                    {{
                      comparison.diff.deltaSeconds > 0
                        ? `+${comparison.diff.deltaSeconds}s`
                        : `${comparison.diff.deltaSeconds}s`
                    }}
                  </span>
                </div>
                <div class="player-view">
                  <video
                    v-if="previewDescriptor"
                    :key="`${previewDescriptor.id}:${mediaGeneration}:b`"
                    ref="videoB"
                    :src="
                      versionComparisonMediaUrl(
                        previewDescriptor.id,
                        'b',
                        props.project?.id ?? '',
                      )
                    "
                    preload="metadata"
                    playsinline
                    :aria-label="
                      t('app.variants.previewPlayerB', {
                        name: comparison.variantB.name,
                      })
                    "
                    @loadedmetadata="mediaLoaded('b')"
                    @timeupdate="playback.onTimeUpdate('b')"
                    @ended="playback.onEnded('b')"
                    @play="playback.onPlay('b')"
                    @error="mediaFailed"
                  />
                  <div v-else class="video-mock-frame variant-b">
                    <Icon
                      class="video-placeholder-icon"
                      name="play"
                      :size="24"
                      aria-hidden="true"
                    />
                    <span class="video-watermark">{{
                      t("app.variants.previewB")
                    }}</span>
                  </div>
                </div>
                <div class="player-controls">
                  <button
                    class="audio-toggle-btn"
                    :class="{
                      active:
                        transportState.audibleSide === 'b' &&
                        !transportState.muted,
                    }"
                    :disabled="!previewDescriptor?.b.hasAudio"
                    :aria-pressed="
                      transportState.audibleSide === 'b' &&
                      !transportState.muted
                    "
                    :aria-label="
                      t(
                        transportState.audibleSide === 'b' &&
                          !transportState.muted
                          ? 'app.variants.audio.muteSide'
                          : 'app.variants.audio.playSide',
                        { name: comparison.variantB.name, side: 'B' },
                      )
                    "
                    @click="selectAudio('b')"
                  >
                    <Icon name="volume" :size="16" aria-hidden="true" />
                    {{
                      transportState.audibleSide === "b" &&
                      !transportState.muted
                        ? t("app.variants.audio.active")
                        : t("app.variants.audio.play")
                    }}
                  </button>
                  <span class="audio-rule-notice">{{
                    t("app.variants.audio.rule")
                  }}</span>
                </div>
              </div>
            </div>

            <div
              v-if="previewDescriptor"
              class="variant-av-transport"
              data-testid="variant-av-transport"
            >
              <button
                class="primary-btn"
                data-testid="variant-av-play"
                :disabled="
                  !mediaReady.a ||
                  !mediaReady.b ||
                  previewPhase !== 'ready' ||
                  transportState.playing ||
                  transportState.starting
                "
                @click="playVariantPreview"
              >
                {{
                  transportState.starting
                    ? t("app.versions.previewStarting")
                    : t("app.versions.previewPlay")
                }}
              </button>
              <button
                class="secondary-btn"
                data-testid="variant-av-pause"
                :disabled="!transportState.playing && !transportState.starting"
                @click="playback.pause()"
              >
                {{ t("app.versions.previewPause") }}
              </button>
              <span aria-live="off">
                {{ formatPreviewTime(transportState.time) }} /
                {{ formatPreviewTime(transportState.duration) }}
              </span>
              <label class="variant-av-seek">
                <span class="sr-only">{{ t("app.versions.previewSeek") }}</span>
                <input
                  type="range"
                  min="0"
                  :max="Math.max(transportState.duration, 0.01)"
                  step="0.01"
                  :value="transportState.time"
                  :disabled="!mediaReady.a || !mediaReady.b"
                  :aria-label="t('app.versions.previewSeek')"
                  @input="seekPreview"
                />
              </label>
              <button
                class="secondary-btn"
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

            <!-- Section-based Alignment Navigation -->
            <div class="section-navigation-bar">
              <span class="nav-title">{{ t("app.variants.sectionNav") }}:</span>
              <div class="beats-track">
                <button
                  v-for="(beatDiff, idx) in comparison.diff.beatDiffs"
                  :key="idx"
                  class="beat-nav-item"
                  :class="{
                    active: selectedBeatIndex === idx,
                    changed: beatDiff.changed,
                  }"
                  @click="selectedBeatIndex = idx"
                >
                  <span class="nav-index">#{{ idx + 1 }}</span>
                  <span class="nav-name">{{
                    beatDiff.variantTitle || beatDiff.baselineTitle
                  }}</span>
                  <span v-if="beatDiff.changed" class="changed-indicator"
                    >●</span
                  >
                </button>
              </div>
            </div>

            <!-- Differences Table -->
            <div class="diff-summary-card">
              <h4>{{ t("app.variants.diffDetails") }}</h4>
              <div class="diff-table-container">
                <table class="diff-table">
                  <thead>
                    <tr>
                      <th>{{ t("app.variants.table.section") }}</th>
                      <th>{{ t("app.variants.table.variantA") }}</th>
                      <th>{{ t("app.variants.table.variantB") }}</th>
                      <th>{{ t("app.variants.table.status") }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(b, idx) in comparison.diff.beatDiffs"
                      :key="idx"
                      :class="{ highlighted: b.changed }"
                    >
                      <td>#{{ idx + 1 }} {{ b.baselineTitle }}</td>
                      <td>
                        <div>⏱ {{ b.baselineDuration }}s</div>
                        <div class="diff-script">
                          "{{ b.baselineScript || "-" }}"
                        </div>
                      </td>
                      <td>
                        <div>⏱ {{ b.variantDuration }}s</div>
                        <div class="diff-script">
                          "{{ b.variantScript || "-" }}"
                        </div>
                      </td>
                      <td>
                        <span
                          class="diff-tag"
                          :class="b.changed ? 'diff-changed' : 'diff-identical'"
                        >
                          {{
                            b.changed
                              ? t("app.variants.diff.changed")
                              : t("app.variants.diff.identical")
                          }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Adoption Decision Footer -->
            <div class="adopt-decision-banner">
              <div class="decision-info">
                <Icon name="checkpoint" />
                <div class="checkpoint-notice">
                  <strong>{{ t("app.variants.checkpointHeader") }}</strong>
                  <p>{{ t("app.variants.checkpointNotice") }}</p>
                </div>
              </div>
              <button
                class="primary-btn adopt-action-btn"
                :disabled="actionLoading"
                @click="handleAdopt(comparison.variantB.id)"
              >
                {{ t("app.variants.actions.adoptB") }}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.variants-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.variants-modal-container {
  box-sizing: border-box;
  --color-bg-card: var(--of-surface-2);
  --color-border: var(--of-border-subtle);
  --color-text-muted: var(--of-text-secondary);
  width: min(92vw, 980px);
  max-width: 980px;
  max-height: 90vh;
  background: var(--of-surface-1);
  color: var(--of-text-primary);
  border-radius: var(--of-radius-dialog);
  border: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--of-shadow-dialog);
  font-family: var(--of-font-ui);
}

.variants-modal-container.comparison-expanded {
  width: min(96vw, 1240px);
  max-width: 1240px;
}

.variants-modal-container.list-view {
  height: min(80vh, 720px);
}

.variants-modal-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--of-space-3);
  padding: var(--of-space-4) var(--of-space-6);
  border-bottom: 0;
  background: var(--of-surface-2);
}

.header-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--of-space-4);
}

.header-title {
  margin: 0;
  font-size: 1.25rem;
}

.header-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-2);
  margin-left: var(--of-space-4);
}

.tab-btn {
  background: transparent;
  border: 0;
  color: var(--of-text-secondary);
  min-height: 40px;
  padding: var(--of-space-2) var(--of-space-3);
  border-radius: var(--of-radius-md);
  cursor: pointer;
}

.tab-btn.active {
  background: var(--of-accent);
  color: var(--of-accent-ink);
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 1.25rem;
  color: var(--of-text-secondary);
  cursor: pointer;
  min-width: 40px;
  min-height: 40px;
  border-radius: var(--of-radius-md);
}

.variants-alert {
  padding: 10px 20px;
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
}

.error-alert {
  background: var(--of-danger-soft);
  color: var(--of-danger);
}

.success-alert {
  background: var(--of-success-soft);
  color: var(--of-success);
}

.alert-dismiss {
  background: transparent;
  border: none;
  cursor: pointer;
  color: inherit;
}

.variants-modal-body {
  min-height: 0;
  padding: var(--of-space-6);
  overflow-y: auto;
  flex: 1;
}

/* List View */
.pane-action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--of-space-3);
  margin-bottom: var(--of-space-5);
}

.variants-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: var(--of-space-4);
  min-height: 12rem;
}

.variants-loading {
  grid-column: 1 / -1;
  margin: 0;
  display: grid;
  place-items: center;
  color: var(--of-text-secondary);
}

.variant-card {
  background: var(--of-surface-2);
  color: var(--of-text-primary);
  border: 0;
  border-radius: var(--of-radius-lg);
  padding: var(--of-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--of-space-3);
  box-shadow: var(--of-shadow-soft);
}

.variant-card.adopted {
  box-shadow:
    inset 3px 0 var(--of-success),
    var(--of-shadow-soft);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.variant-name {
  font-weight: 600;
  font-size: 1.05rem;
}

.status-badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: var(--of-radius-sm);
  background: var(--of-surface-3);
  color: var(--of-text-secondary);
}

.status-badge.adopted {
  background: var(--of-success-soft);
  color: var(--of-success);
}

.status-badge.compared {
  background: var(--of-accent-soft);
  color: var(--of-accent);
}

.variant-intent {
  font-size: 0.85rem;
  color: var(--of-text-secondary);
  margin: 0;
  flex: 1;
}

.variant-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--of-text-muted);
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-2);
  margin-top: var(--of-space-2);
}

.card-btn {
  flex: 1;
  min-height: 40px;
  padding: var(--of-space-2);
  font-size: 0.8rem;
  border-radius: var(--of-radius-md);
  border: 0;
  background: var(--of-surface-3);
  color: var(--of-text-primary);
  cursor: pointer;
  box-shadow: var(--of-shadow-soft);
}

.adopt-btn {
  background: var(--of-accent);
  color: var(--of-accent-ink);
}

.delete-btn {
  background: var(--of-danger-soft);
  color: var(--of-danger);
}

/* Create Form */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--of-space-6);
}

.form-field {
  margin-bottom: var(--of-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--of-space-2);
}

.form-field label {
  font-size: 0.85rem;
  font-weight: 500;
}
.form-field-label {
  font-size: 0.85rem;
  font-weight: 500;
}

.form-field input,
.form-field textarea,
.form-field select {
  background: var(--of-bg);
  border: 0;
  color: var(--of-text-primary);
  padding: 8px 12px;
  min-height: 44px;
  border-radius: var(--of-radius-md);
  font-size: 0.9rem;
  box-shadow: inset 0 1px 3px
    color-mix(in srgb, var(--of-shadow-tint) 12%, transparent);
}

.radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-3) var(--of-space-4);
}

.form-submit-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-3);
  margin-top: var(--of-space-5);
}

.primary-btn {
  background: var(--of-accent);
  color: var(--of-accent-ink);
  border: none;
  padding: 8px 16px;
  border-radius: var(--of-radius-md);
  cursor: pointer;
  font-weight: 500;
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-btn {
  background: var(--of-surface-2);
  color: var(--of-text-primary);
  border: 0;
  padding: 8px 16px;
  border-radius: var(--of-radius-md);
  cursor: pointer;
  box-shadow: var(--of-shadow-soft);
}

.impact-preview-column {
  background: var(--of-surface-2);
  border: 0;
  border-radius: var(--of-radius-lg);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.impact-subtitle {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--of-text-secondary);
  display: block;
  margin-bottom: 6px;
}

.changes-list,
.brief-list {
  margin: 0;
  padding-left: 20px;
  font-size: 0.85rem;
  color: var(--of-text-primary);
}

.preserved-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preserved-chip {
  background: var(--of-success-soft);
  border: 0;
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: var(--of-radius-sm);
  color: var(--of-success);
}

.brief-notice {
  font-size: 0.75rem;
  color: var(--of-warning);
  margin: 0 0 6px 0;
}

.locked-warning {
  background: var(--of-warning-soft);
  border: 0;
  color: var(--of-warning);
  padding: 8px 12px;
  border-radius: var(--of-radius-md);
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Compare View */
.compare-selectors {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  background: var(--of-surface-2);
  padding: 12px 16px;
  border-radius: 6px;
}

.selector-box {
  display: flex;
  align-items: center;
  gap: 8px;
}

.selector-box select {
  background: var(--of-bg);
  border: 0;
  color: var(--of-text-primary);
  padding: 6px 12px;
  border-radius: var(--of-radius-md);
}

.vs-badge {
  font-weight: bold;
  color: var(--of-warning);
}

.comparison-players-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.variant-av-preview-bar,
.variant-av-transport {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--of-space-3);
  margin-block: var(--of-space-4);
  padding: var(--of-space-3) var(--of-space-4);
  color: var(--of-text-primary);
  background: var(--of-surface-2);
  border-radius: var(--of-radius-lg);
}

.variant-av-status {
  flex: 1 1 18rem;
  margin: 0;
  color: var(--of-text-secondary);
  font-size: 0.875rem;
}

.variant-av-error {
  margin: 0 0 var(--of-space-3);
  color: var(--of-error, #f2726f);
}

.variant-av-warning {
  margin: 0 0 var(--of-space-3);
  padding: var(--of-space-3) var(--of-space-4);
  border-inline-start: 2px solid var(--of-warning);
  border-radius: var(--of-radius-sm);
  background: var(--of-surface-2);
  color: var(--of-text-secondary);
  font-size: 0.875rem;
}

.variant-av-transport > button {
  min-height: 40px;
}

.variant-av-seek {
  flex: 1 1 12rem;
  display: flex;
}

.variant-av-seek input {
  width: 100%;
}

.player-card {
  background: var(--of-surface-2);
  color: var(--of-text-primary);
  border: 0;
  border-radius: var(--of-radius-lg);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--of-shadow-soft);
}

.player-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.player-label {
  font-weight: 600;
  font-size: 0.95rem;
}

.duration-badge {
  font-size: 0.75rem;
  background: var(--of-surface-3);
  color: var(--of-text-secondary);
  padding: 2px 6px;
  border-radius: var(--of-radius-sm);
}

.delta-badge {
  font-size: 0.75rem;
  background: var(--of-success-soft);
  color: var(--of-success);
  padding: 2px 6px;
  border-radius: 4px;
}

.delta-badge.shorter {
  background: var(--of-accent-soft);
  color: var(--of-accent);
}

.player-view {
  aspect-ratio: 16 / 9;
  background: var(--of-player);
  border-radius: var(--of-radius-media);
  display: flex;
  align-items: center;
  justify-content: center;
}

.player-view video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: inherit;
  background: var(--of-player);
}

.video-mock-frame {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--of-space-2);
  color: var(--of-on-media-muted);
}

.video-placeholder-icon {
  opacity: 0.8;
}

.player-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.audio-toggle-btn {
  background: var(--of-surface-3);
  border: 0;
  color: var(--of-text-primary);
  padding: 4px 10px;
  border-radius: var(--of-radius-md);
  font-size: 0.8rem;
  cursor: pointer;
  box-shadow: var(--of-shadow-soft);
}

.audio-toggle-btn.active {
  background: var(--of-accent);
  color: var(--of-accent-ink);
}

.audio-rule-notice {
  font-size: 0.75rem;
  color: var(--of-text-muted);
}

@media (any-pointer: coarse) {
  .tab-btn,
  .close-btn,
  .card-btn,
  .primary-btn,
  .secondary-btn,
  .audio-toggle-btn {
    min-height: 44px;
  }

  .close-btn {
    min-width: 44px;
  }
}

/* Section Navigation */
.section-navigation-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  background: var(--of-surface-2);
  padding: 10px 16px;
  border-radius: 6px;
}

.nav-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--of-text-secondary);
}

.beats-track {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}

.beat-nav-item {
  background: var(--of-surface-3);
  border: 0;
  color: var(--of-text-primary);
  padding: 4px 10px;
  border-radius: var(--of-radius-md);
  font-size: 0.8rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.beat-nav-item.active {
  background: var(--of-accent);
  color: var(--of-accent-ink);
}

.beat-nav-item.changed {
  box-shadow: inset 0 -2px var(--of-warning);
}

.changed-indicator {
  color: var(--of-warning);
  font-size: 0.7rem;
}

/* Diff Table */
.diff-summary-card {
  background: var(--of-surface-2);
  border: 0;
  border-radius: var(--of-radius-lg);
  padding: 16px;
  margin-bottom: 20px;
}

.diff-table-container {
  overflow-x: auto;
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.diff-table th,
.diff-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--of-border-subtle);
  text-align: left;
}

.diff-table th {
  color: var(--of-text-secondary);
  font-weight: 500;
}

.diff-script {
  color: var(--of-text-muted);
  font-size: 0.75rem;
  font-style: italic;
}

.diff-tag {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 3px;
}

.diff-changed {
  background: var(--of-warning-soft);
  color: var(--of-warning);
}

.diff-identical {
  background: var(--of-success-soft);
  color: var(--of-success);
}

/* Adopt Decision Banner */
.adopt-decision-banner {
  background: var(--of-accent-soft);
  border: 0;
  border-radius: var(--of-radius-lg);
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.decision-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.checkpoint-notice p {
  margin: 4px 0 0 0;
  font-size: 0.8rem;
  color: var(--of-accent);
}

.adopt-action-btn {
  background: var(--of-accent);
  color: var(--of-accent-ink);
  font-size: 0.95rem;
  padding: 10px 20px;
}

@media (max-width: 1280px) {
  .variants-modal-container {
    width: min(96vw, 980px);
    padding: 16px;
  }

  .variants-modal-container.comparison-expanded {
    width: 96vw;
  }
}

@media (max-width: 1024px) {
  .form-grid,
  .comparison-players-row {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    animation: none !important;
  }
}
</style>
