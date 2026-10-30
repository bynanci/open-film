<!-- Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, sourceUrl, thumbnailUrl } from "../api.js";
import { preferences } from "../preferences";
import Icon from "./Icon.vue";
import {
  WORKBENCH_STAGES,
  adjacentWorkbenchStage,
  resolveWorkbenchStageStatus,
  summarizeWorkbenchProgress,
  type WorkbenchStageKey,
  type WorkbenchStageStatus,
} from "../pipeline-workbench-model";
import { pipelineCompositionTarget } from "../pipeline-workbench-model";
import type {
  PipelineRecipe,
  PipelineRun,
  PipelineStepAttempt,
  MediaAsset,
  Story,
  OpenFilmProject,
  PipelineChangeImpactReport,
} from "@openfilm/core";

export type WorkbenchMode = "bar" | "drawer" | "modal";
export type { WorkbenchStageKey } from "../pipeline-workbench-model";

const props = withDefaults(
  defineProps<{
    open?: boolean;
    initialMode?: WorkbenchMode;
    storyId?: string;
    activeStory?: Story | null;
    assets?: MediaAsset[];
    project?: OpenFilmProject | null;
    activeCompositionId?: string;
  }>(),
  {
    open: true,
    initialMode: "bar",
    storyId: "",
    activeStory: null,
    assets: () => [],
    project: null,
    activeCompositionId: "",
  },
);

const emit = defineEmits<{
  (e: "close"): void;
  (e: "mode-change", mode: WorkbenchMode): void;
  (e: "rough-cut-adopted", compositionId: string): void;
  (
    e: "navigate-story",
    perspective: "outline" | "graph" | "storyboard",
    beatId?: string,
  ): void;
  (e: "navigate-timeline", clipId?: string, time?: number): void;
  (e: "request-relink", assetIds?: string[]): void;
}>();

const { t } = useI18n();

const compositionTargetMode = ref<"new-cut" | "resolve">("new-cut");
async function selectedCompositionTarget() {
  const compositionId = props.activeCompositionId;
  if (compositionTargetMode.value === "new-cut")
    return pipelineCompositionTarget("new-cut");
  if (!compositionId) throw new Error(t("editor.pins.selectCut"));
  const state = await api.editor(compositionId);
  if (props.activeCompositionId !== compositionId)
    throw new Error(t("editor.pins.selectCut"));
  return pipelineCompositionTarget("resolve", {
    compositionId,
    revision: state.revision,
  });
}

const mode = ref<WorkbenchMode>(props.initialMode);
const workbenchPanel = ref<HTMLElement | null>(null);
let workbenchOrigin: HTMLElement | null = null;
watch(mode, async (next, previous) => {
  if (typeof document === "undefined") return;
  if (previous === "bar" && document.activeElement instanceof HTMLElement)
    workbenchOrigin = document.activeElement;
  await nextTick();
  if (mode.value !== next) return;
  if (next !== "bar") {
    workbenchPanel.value
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  } else if (workbenchOrigin?.isConnected) {
    workbenchOrigin.focus();
  } else {
    document
      .querySelector<HTMLButtonElement>(
        `.bar-stage-dot[data-stage="${activeStage.value}"]`,
      )
      ?.focus();
  }
});
const activeStage = ref<WorkbenchStageKey>("produceClips");
const expertMode = computed(() => preferences.workspaceMode === "expert");

const recipes = ref<PipelineRecipe[]>([]);
const selectedRecipeId = ref<string>("guided-story-to-video");
const currentRun = ref<PipelineRun | null>(null);
const runsList = ref<PipelineRun[]>([]);
const actionLoading = ref(false);
const error = ref<string | null>(null);

// M11A Change Impact
const impactReport = ref<PipelineChangeImpactReport | null>(null);
const showImpactModal = ref(false);
const impactLoading = ref(false);

// Narration selection
const narrationStrategy = ref<"none" | "voice-import" | "configured-tts">(
  "none",
);
const selectedVoiceAssetId = ref<string>("");
const remoteConsentGiven = ref(false);
const reviewNotes = ref<string>("");

// Media audition
const audioPlaying = ref(false);
const audioCurrentTime = ref(0);
const audioDuration = ref(0);
const audioElement = ref<HTMLAudioElement | null>(null);

// Video preview
const activeVideoPlaying = ref(false);

let pollTimer: ReturnType<typeof setInterval> | null = null;

const audioAssets = computed(() => {
  return (props.assets ?? []).filter(
    (a) => a.mediaType === "audio" || a.mediaType === "video",
  );
});

const currentRecipe = computed(() => {
  return (
    recipes.value.find((r) => r.id === selectedRecipeId.value) ??
    recipes.value[0] ??
    null
  );
});

const waitingReviewStep = computed<PipelineStepAttempt | null>(() => {
  if (!currentRun.value || currentRun.value.status !== "waiting-review") {
    return null;
  }
  return (
    currentRun.value.stepAttempts.find((s) => s.status === "waiting-review") ??
    null
  );
});

const isOutdated = computed(() => {
  return currentRun.value?.freshness === "outdated";
});

// Stage status mappings
const stageStatuses = computed<Record<WorkbenchStageKey, WorkbenchStageStatus>>(
  () => {
    const run = currentRun.value;
    if (!run) {
      return {
        materials: (props.assets?.length ?? 0) > 0 ? "succeeded" : "idle",
        storyPlan: props.activeStory ? "succeeded" : "idle",
        produceClips: "idle",
        previewQa: "idle",
        export: "idle",
      };
    }

    const statusesFor = (stepIds: readonly string[]) =>
      stepIds.map(
        (stepId) =>
          run.stepAttempts.find((attempt) => attempt.stepId === stepId)
            ?.status ?? "pending",
      );
    const produceStatus = resolveWorkbenchStageStatus(
      statusesFor(["step-3", "step-4", "step-5"]),
    );
    const previewStatus = resolveWorkbenchStageStatus(
      statusesFor(["step-6", "step-7"]),
    );
    const exportStatus = resolveWorkbenchStageStatus(statusesFor(["step-8"]));

    return {
      materials: (props.assets?.length ?? 0) > 0 ? "succeeded" : "idle",
      storyPlan: props.activeStory ? "succeeded" : "idle",
      produceClips: produceStatus,
      previewQa: previewStatus,
      export: exportStatus,
    };
  },
);

const activeStageIndex = computed(() =>
  WORKBENCH_STAGES.findIndex((stage) => stage.key === activeStage.value),
);
const stageProgress = computed(() =>
  summarizeWorkbenchProgress(stageStatuses.value),
);
const activeStageStatus = computed(
  () => stageStatuses.value[activeStage.value],
);

function moveToAdjacentStage(direction: -1 | 1) {
  activeStage.value = adjacentWorkbenchStage(activeStage.value, direction);
}

function stepAttemptStatus(stepId: string): WorkbenchStageStatus {
  return (
    currentRun.value?.stepAttempts.find((attempt) => attempt.stepId === stepId)
      ?.status ?? "pending"
  );
}

// Artifacts accessors
const previewVideoArtifact = computed(() => {
  return currentRun.value?.artifacts.find((a) => a.kind === "preview-video");
});

const roughCutArtifact = computed(() => {
  return currentRun.value?.artifacts.find(
    (a) => a.kind === "rough-cut-composition",
  );
});

const qaReportArtifact = computed(() => {
  return currentRun.value?.artifacts.find((a) => a.kind === "qa-report");
});

const exportFileArtifact = computed(() => {
  return currentRun.value?.artifacts.find((a) => a.kind === "export-file");
});

const selectedVoiceAsset = computed(() => {
  return props.assets?.find((a) => a.id === selectedVoiceAssetId.value);
});

async function loadRecipes() {
  try {
    const res = await api.pipelineListRecipes();
    recipes.value = res.recipes;
    if (res.recipes[0] && !selectedRecipeId.value) {
      selectedRecipeId.value = res.recipes[0].id;
    }
  } catch (err: unknown) {
    error.value = (err as Error)?.message ?? "Failed to load recipes.";
  }
}

async function loadRuns() {
  try {
    const res = await api.pipelineListRuns();
    runsList.value = res.runs;
    if (res.runs.length > 0 && !currentRun.value) {
      currentRun.value = res.runs[res.runs.length - 1] ?? null;
    }
  } catch {
    // Ignore load runs error
  }
}

async function refreshCurrentRun() {
  if (!currentRun.value) return;
  try {
    const res = await api.pipelineGetRun(currentRun.value.id);
    currentRun.value = res.run;
    if (res.run.status !== "running") {
      stopPolling();
    }
  } catch {
    stopPolling();
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    void refreshCurrentRun();
  }, 1000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function switchMode(newMode: WorkbenchMode) {
  mode.value = newMode;
  emit("mode-change", newMode);
}

async function handleStartProduction() {
  error.value = null;
  actionLoading.value = true;
  try {
    let narrationOption: {
      type: "none" | "voice-import" | "configured-tts";
      assetId?: string;
      providerId?: string;
      speechConsent?: boolean;
    } = { type: "none" };

    if (narrationStrategy.value === "voice-import") {
      if (!selectedVoiceAssetId.value) {
        throw new Error(
          t("app.pipeline.workbench.disclosures.missingAudioPrompt"),
        );
      }
      narrationOption = {
        type: "voice-import",
        assetId: selectedVoiceAssetId.value,
      };
    } else if (narrationStrategy.value === "configured-tts") {
      if (!remoteConsentGiven.value) {
        throw new Error(
          "Consent is required before transmitting script text to remote TTS.",
        );
      }
      narrationOption = {
        type: "configured-tts",
        providerId: "openai-tts",
        speechConsent: true,
      };
    }

    const created = await api.pipelineCreateRun(selectedRecipeId.value, {
      compositionTarget: await selectedCompositionTarget(),
      storyId: props.storyId ?? props.activeStory?.id,
      assetIds: (props.assets ?? []).map((a) => a.id),
      narration: narrationOption,
      exportFormat: "mp4",
    });

    currentRun.value = created.run;
    const started = await api.pipelineStartRun(created.run.id);
    currentRun.value = started.run;

    if (started.run.status === "running") {
      startPolling();
    }
  } catch (err: unknown) {
    error.value = (err as Error)?.message ?? "Failed to start pipeline.";
  } finally {
    actionLoading.value = false;
  }
}

async function handleAnalyzeImpact() {
  error.value = null;
  impactLoading.value = true;
  try {
    let narrationOption: {
      type: "none" | "voice-import" | "configured-tts";
      assetId?: string;
      providerId?: string;
      speechConsent?: boolean;
    } = { type: "none" };

    if (narrationStrategy.value === "voice-import") {
      narrationOption = {
        type: "voice-import",
        assetId: selectedVoiceAssetId.value,
      };
    } else if (narrationStrategy.value === "configured-tts") {
      narrationOption = {
        type: "configured-tts",
        providerId: "byok-tts-standard",
        speechConsent: remoteConsentGiven.value,
      };
    }

    const res = await api.pipelineAnalyzeImpact(selectedRecipeId.value, {
      baseRunId: currentRun.value?.id,
      compositionTarget: await selectedCompositionTarget(),
      storyId: props.storyId ?? props.activeStory?.id,
      assetIds: (props.assets ?? []).map((a) => a.id),
      narration: narrationOption,
    });
    impactReport.value = res.report;
    showImpactModal.value = true;
  } catch (err: unknown) {
    error.value = (err as Error)?.message ?? "Failed to analyze change impact.";
  } finally {
    impactLoading.value = false;
  }
}

async function handleStartIncrementalRun() {
  error.value = null;
  actionLoading.value = true;
  try {
    let narrationOption: {
      type: "none" | "voice-import" | "configured-tts";
      assetId?: string;
      providerId?: string;
      speechConsent?: boolean;
    } = { type: "none" };

    if (narrationStrategy.value === "voice-import") {
      narrationOption = {
        type: "voice-import",
        assetId: selectedVoiceAssetId.value,
      };
    } else if (narrationStrategy.value === "configured-tts") {
      narrationOption = {
        type: "configured-tts",
        providerId: "byok-tts-standard",
        speechConsent: remoteConsentGiven.value,
      };
    }

    const created = await api.pipelineCreateIncrementalRun(
      selectedRecipeId.value,
      {
        baseRunId: currentRun.value?.id,
        impactReport: impactReport.value ?? undefined,
        compositionTarget: await selectedCompositionTarget(),
        storyId: props.storyId ?? props.activeStory?.id,
        assetIds: (props.assets ?? []).map((a) => a.id),
        narration: narrationOption,
      },
    );

    currentRun.value = created.run;
    showImpactModal.value = false;
    const started = await api.pipelineStartRun(created.run.id);
    currentRun.value = started.run;

    if (started.run.status === "running") {
      startPolling();
    }
    await loadRuns();
  } catch (err: unknown) {
    error.value = (err as Error)?.message ?? "Failed to start incremental run.";
  } finally {
    actionLoading.value = false;
  }
}

async function handleCancelRun() {
  if (!currentRun.value) return;
  actionLoading.value = true;
  try {
    const res = await api.pipelineCancelRun(currentRun.value.id);
    currentRun.value = res.run;
    stopPolling();
  } catch (err: unknown) {
    error.value = (err as Error)?.message ?? "Failed to cancel run.";
  } finally {
    actionLoading.value = false;
  }
}

async function handleRetryRun() {
  if (!currentRun.value) return;
  actionLoading.value = true;
  try {
    const res = await api.pipelineRetryRun(currentRun.value.id);
    currentRun.value = res.run;
    if (res.run.status === "running") {
      startPolling();
    }
  } catch (err: unknown) {
    error.value = (err as Error)?.message ?? "Failed to retry run.";
  } finally {
    actionLoading.value = false;
  }
}

async function handleReviewDecision(decision: "accepted" | "rejected") {
  if (!currentRun.value || !waitingReviewStep.value) return;
  actionLoading.value = true;
  try {
    const res = await api.pipelineSubmitReview(
      currentRun.value.id,
      waitingReviewStep.value.stepId,
      decision,
      reviewNotes.value,
    );
    currentRun.value = res.run;
    reviewNotes.value = "";
    if (res.run.status === "running") {
      startPolling();
    }
  } catch (err: unknown) {
    error.value = (err as Error)?.message ?? "Failed to submit review.";
  } finally {
    actionLoading.value = false;
  }
}

function handleAdoptRoughCut() {
  if (!roughCutArtifact.value) return;
  const compId = roughCutArtifact.value.id.replace(/^art_/, "");
  emit("rough-cut-adopted", compId);
}

function handleAuditionToggle() {
  if (!audioElement.value) return;
  if (audioPlaying.value) {
    audioElement.value.pause();
    audioPlaying.value = false;
  } else {
    audioElement.value
      .play()
      .then(() => {
        audioPlaying.value = true;
      })
      .catch(() => {
        audioPlaying.value = false;
      });
  }
}

function handleAudioTimeUpdate() {
  if (audioElement.value) {
    audioCurrentTime.value = audioElement.value.currentTime;
    audioDuration.value = audioElement.value.duration || 0;
  }
}

function handleAudioEnded() {
  audioPlaying.value = false;
  audioCurrentTime.value = 0;
}

function handleVideoToggle() {
  activeVideoPlaying.value = !activeVideoPlaying.value;
}

// Navigation helpers
function navigateToStory(perspective: "outline" | "graph" | "storyboard") {
  emit("navigate-story", perspective, props.activeStory?.beats[0]?.id);
}

function navigateToTimeline() {
  emit("navigate-timeline");
}

function handleKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  const target = e.target as HTMLElement | null;
  if (
    mode.value !== "bar" &&
    target?.closest('[role="dialog"]') &&
    !workbenchPanel.value?.contains(target)
  )
    return;
  if (mode.value === "modal" && e.key === "Tab") {
    const controls = Array.from(
      workbenchPanel.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
      ) ?? [],
    ).filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (
      first &&
      last &&
      ((e.shiftKey && target === first) || (!e.shiftKey && target === last))
    ) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }
  // Protect inputs, textareas, and contenteditable elements from shortcut theft
  if (
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) {
    if (e.key === "Escape") {
      target.blur();
    }
    return;
  }

  if (e.key === "Escape") {
    if (mode.value === "modal") {
      switchMode("drawer");
    } else if (mode.value === "drawer") {
      switchMode("bar");
    }
    return;
  }

  // Number shortcuts 1-5 to switch stage
  if (
    mode.value !== "bar" &&
    workbenchPanel.value?.contains(target) &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey
  ) {
    const stageMap: Record<string, WorkbenchStageKey> = {
      "1": "materials",
      "2": "storyPlan",
      "3": "produceClips",
      "4": "previewQa",
      "5": "export",
    };
    if (stageMap[e.key]) {
      activeStage.value = stageMap[e.key]!;
    }
  }
}

watch(
  () => props.initialMode,
  (val) => {
    if (val) mode.value = val;
  },
);

onMounted(() => {
  void loadRecipes();
  void loadRuns();
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  stopPolling();
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div
    class="pipeline-workbench-root"
    :class="[`workbench-mode-${mode}`, { 'is-outdated': isOutdated }]"
    :data-workspace-mode="preferences.workspaceMode"
  >
    <!-- MODE 1: Docked Bottom Status Bar -->
    <aside
      v-if="mode === 'bar'"
      class="pipeline-status-bar"
      role="region"
      :aria-label="t('app.pipeline.workbench.barTitle')"
    >
      <div class="bar-left">
        <button
          type="button"
          class="bar-expand-btn"
          :title="t('app.pipeline.workbench.expand')"
          @click="switchMode('drawer')"
        >
          <Icon name="layers" :size="16" />
          <span class="bar-title">{{
            t("app.pipeline.workbench.barTitle")
          }}</span>
        </button>

        <!-- 5-Stage Indicator -->
        <div class="bar-stages-track">
          <button
            v-for="(stage, idx) in WORKBENCH_STAGES"
            :key="stage.key"
            type="button"
            class="bar-stage-dot"
            :data-stage="stage.key"
            :class="[
              `status-${stageStatuses[stage.key]}`,
              { active: activeStage === stage.key },
            ]"
            :title="t(`app.pipeline.workbench.stages.${stage.key}`)"
            @click="
              activeStage = stage.key;
              switchMode('drawer');
            "
          >
            {{ idx + 1 }}.
            {{ t(`app.pipeline.workbench.stages.${stage.key}`) }}
          </button>
        </div>
      </div>

      <div class="bar-center">
        <!-- Outdated Indicator -->
        <span
          v-if="isOutdated"
          class="workbench-pill pill-warning"
          :title="t('app.pipeline.workbench.disclosures.outdatedNotice')"
        >
          <Icon name="refresh" :size="12" />
          {{ t("app.pipeline.status.outdated") }}
        </span>

        <!-- Waiting Review Notice (NO continuous spinner!) -->
        <span
          v-else-if="currentRun?.status === 'waiting-review'"
          class="workbench-pill pill-review"
        >
          {{ t("app.pipeline.workbench.disclosures.waitingUserPrompt") }}
        </span>

        <!-- Indeterminate Running -->
        <span
          v-else-if="currentRun?.status === 'running'"
          class="workbench-pill pill-running"
        >
          <span class="indeterminate-bar" />
          {{
            t("app.pipeline.status.running", {
              current: (currentRun.currentStepIndex ?? 0) + 1,
              total: 8,
              stepName: "",
            })
          }}
        </span>

        <!-- Status Chip -->
        <span
          v-else
          class="workbench-pill"
          :class="`pill-${currentRun?.status ?? 'idle'}`"
        >
          {{ currentRun ? currentRun.status : t("app.pipeline.status.idle") }}
        </span>
      </div>

      <div class="bar-right">
        <!-- Quick CTA based on state -->
        <button
          v-if="currentRun?.status === 'waiting-review'"
          type="button"
          class="bar-cta-btn bar-cta-primary"
          @click="
            activeStage = 'produceClips';
            switchMode('drawer');
          "
        >
          {{ t("app.pipeline.workbench.ctas.reviewAndAdopt") }}
        </button>
        <button
          v-else-if="isOutdated"
          type="button"
          class="bar-cta-btn bar-cta-warning"
          @click="
            switchMode('drawer');
            handleAnalyzeImpact();
          "
        >
          {{ t("app.pipeline.workbench.ctas.viewImpact") }}
        </button>
        <button
          v-else-if="!currentRun || currentRun.status === 'idle'"
          type="button"
          class="bar-cta-btn bar-cta-primary"
          @click="
            switchMode('drawer');
            handleStartProduction();
          "
        >
          {{ t("app.pipeline.startRun") }}
        </button>
        <button
          v-else-if="currentRun.status === 'failed'"
          type="button"
          class="bar-cta-btn bar-cta-warning"
          @click="handleRetryRun"
        >
          {{ t("app.pipeline.retryRun") }}
        </button>

        <!-- Mode Switches -->
        <button
          type="button"
          class="bar-icon-btn"
          :title="t('app.pipeline.workbench.expand')"
          @click="switchMode('drawer')"
        >
          <Icon name="chevron" :size="16" />
        </button>
        <button
          type="button"
          class="bar-icon-btn"
          :title="t('app.pipeline.workbench.fullscreen')"
          @click="switchMode('modal')"
        >
          <Icon name="grid" :size="16" />
        </button>
      </div>
    </aside>

    <!-- MODE 2 & 3: Drawer & Full-Viewport Modal -->
    <section
      v-else
      ref="workbenchPanel"
      class="pipeline-workbench-container"
      :class="{
        'is-drawer': mode === 'drawer',
        'is-modal': mode === 'modal',
      }"
      role="dialog"
      :aria-modal="mode === 'modal' ? true : undefined"
      aria-labelledby="workbench-panel-title"
    >
      <!-- Workbench Header -->
      <header class="workbench-header">
        <div class="workbench-header-left">
          <h2 id="workbench-panel-title" class="workbench-title">
            <Icon name="layers" :size="20" />
            {{ t("app.pipeline.workbench.title") }}
          </h2>
          <span
            v-if="isOutdated"
            class="workbench-pill pill-warning"
            :title="t('app.pipeline.workbench.disclosures.outdatedNotice')"
          >
            {{ t("app.pipeline.status.outdated") }}
          </span>
          <span
            v-else
            class="workbench-pill"
            :class="`pill-${currentRun?.status ?? 'idle'}`"
          >
            {{ currentRun ? currentRun.status : t("app.pipeline.status.idle") }}
          </span>
        </div>

        <div class="workbench-header-right">
          <button
            v-if="mode === 'drawer'"
            type="button"
            class="workbench-tool-btn"
            :title="t('app.pipeline.workbench.fullscreen')"
            @click="switchMode('modal')"
          >
            <Icon name="grid" :size="16" />
            {{ t("app.pipeline.workbench.fullscreen") }}
          </button>
          <button
            v-else
            type="button"
            class="workbench-tool-btn"
            :title="t('app.pipeline.workbench.exitFullscreen')"
            @click="switchMode('drawer')"
          >
            {{ t("app.pipeline.workbench.exitFullscreen") }}
          </button>
          <button
            type="button"
            class="workbench-tool-btn"
            :aria-label="t('app.pipeline.workbench.collapse')"
            :title="t('app.pipeline.workbench.collapse')"
            @click="switchMode('bar')"
          >
            <Icon name="close" :size="16" />
          </button>
        </div>
      </header>

      <!-- Outdated Warning Banner -->
      <div v-if="isOutdated" class="workbench-alert-banner warning">
        <div class="banner-text">
          <strong>{{ t("app.pipeline.status.outdated") }}</strong>
          <p>{{ t("app.pipeline.workbench.disclosures.outdatedNotice") }}</p>
          <small>{{
            t("app.pipeline.workbench.disclosures.noM11aNotice")
          }}</small>
        </div>
        <div class="banner-actions">
          <button
            type="button"
            class="workbench-btn btn-secondary"
            :disabled="actionLoading || impactLoading"
            @click="handleAnalyzeImpact"
          >
            {{ t("app.pipeline.workbench.ctas.viewImpact") }}
          </button>
          <button
            type="button"
            class="workbench-btn btn-warning"
            :disabled="actionLoading"
            @click="handleStartIncrementalRun"
          >
            {{ t("app.pipeline.workbench.ctas.startIncrementalRun") }}
          </button>
        </div>
      </div>

      <!-- Change Impact Inspection Panel (Phase M11A) -->
      <section
        v-if="showImpactModal && impactReport"
        class="workbench-impact-panel"
      >
        <div class="impact-panel-header">
          <div>
            <h3>{{ t("app.pipeline.workbench.impact.title") }}</h3>
            <p class="impact-subtitle">
              {{ t("app.pipeline.workbench.impact.subtitle") }}
            </p>
          </div>
          <button
            type="button"
            class="workbench-icon-btn"
            @click="showImpactModal = false"
          >
            <Icon name="close" :size="16" />
          </button>
        </div>

        <div class="impact-summary-chips">
          <span class="impact-chip chip-reuse">
            {{
              t("app.pipeline.workbench.impact.reusableSummary", {
                reusable: impactReport.summary.reusableSteps,
                rerun: impactReport.summary.rerunSteps,
              })
            }}
          </span>
          <span
            v-if="impactReport.renderMode === 'full-render-fallback'"
            class="impact-chip chip-fallback"
          >
            {{ t("app.pipeline.workbench.impact.fullRenderFallback") }}
          </span>
        </div>

        <div
          v-if="impactReport.renderFallbackReason"
          class="impact-fallback-notice"
        >
          <Icon name="info" :size="14" />
          <span>{{ impactReport.renderFallbackReason }}</span>
        </div>

        <div class="impact-steps-table">
          <div
            v-for="step in impactReport.steps"
            :key="step.stepId"
            class="impact-step-row"
            :class="`status-${step.status}`"
          >
            <div class="step-identity">
              <span class="step-id-pill">{{ step.stepId }}</span>
              <strong class="step-name">{{ step.stepName }}</strong>
            </div>
            <span class="step-status-pill" :class="`pill-${step.status}`">
              {{
                t(
                  `app.pipeline.workbench.impactStatus.${step.status === "needs-review" ? "needsReview" : step.status}`,
                )
              }}
            </span>
            <div class="step-reason">
              {{ step.reason }}
              <span
                v-if="step.inputsChanged && step.inputsChanged.length > 0"
                class="step-inputs-changed"
              >
                ({{
                  t("app.pipeline.workbench.impact.stepInputsChanged", {
                    inputs: step.inputsChanged.join(", "),
                  })
                }})
              </span>
            </div>
          </div>
        </div>

        <div class="impact-panel-actions">
          <button
            type="button"
            class="workbench-btn btn-primary"
            :disabled="actionLoading"
            @click="handleStartIncrementalRun"
          >
            {{ t("app.pipeline.workbench.ctas.startIncrementalRun") }}
          </button>
          <button
            type="button"
            class="workbench-btn btn-outline"
            :disabled="actionLoading"
            @click="handleStartProduction"
          >
            {{ t("app.pipeline.workbench.ctas.newRunWithLatest") }}
          </button>
          <button
            type="button"
            class="workbench-btn btn-secondary"
            @click="showImpactModal = false"
          >
            {{ t("app.pipeline.closeButton") }}
          </button>
        </div>
      </section>

      <!-- 5-Stage Stepper Bar -->
      <nav
        class="workbench-stepper"
        :aria-label="t('app.pipeline.workbench.stages.materials')"
      >
        <button
          v-for="(stage, idx) in WORKBENCH_STAGES"
          :key="stage.key"
          type="button"
          class="workbench-step-tab"
          :class="{
            active: activeStage === stage.key,
            'is-succeeded': stageStatuses[stage.key] === 'succeeded',
            'is-review': stageStatuses[stage.key] === 'waiting-review',
            'is-failed': stageStatuses[stage.key] === 'failed',
          }"
          :aria-current="activeStage === stage.key ? 'step' : undefined"
          @click="activeStage = stage.key"
        >
          <span class="step-num">{{ idx + 1 }}</span>
          <span class="step-label">{{
            t(`app.pipeline.workbench.stages.${stage.key}`)
          }}</span>
          <span
            v-if="stageStatuses[stage.key] === 'waiting-review'"
            class="step-badge-review"
            >!</span
          >
        </button>
      </nav>

      <section class="gate-summary" aria-labelledby="active-gate-title">
        <div class="gate-summary-copy">
          <span class="gate-eyebrow">
            {{
              t("app.pipeline.workbench.flow.gate", {
                current: activeStageIndex + 1,
                total: WORKBENCH_STAGES.length,
              })
            }}
          </span>
          <h3 id="active-gate-title">
            {{ t(`app.pipeline.workbench.stages.${activeStage}`) }}
          </h3>
          <span class="workbench-pill" :class="`pill-${activeStageStatus}`">
            {{ t(`app.pipeline.workbench.stageStatus.${activeStageStatus}`) }}
          </span>
        </div>
        <div class="gate-progress-wrap">
          <div
            class="gate-progress"
            role="progressbar"
            :aria-label="t('app.pipeline.workbench.flow.progress')"
            :aria-valuenow="stageProgress.percent"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span :style="{ width: `${stageProgress.percent}%` }"></span>
          </div>
          <small>
            {{
              t("app.pipeline.workbench.flow.completed", {
                completed: stageProgress.completed,
                total: stageProgress.total,
              })
            }}
          </small>
        </div>
        <div class="gate-pager">
          <button
            type="button"
            class="workbench-btn btn-outline"
            :disabled="activeStageIndex <= 0"
            @click="moveToAdjacentStage(-1)"
          >
            {{ t("app.pipeline.workbench.flow.previous") }}
          </button>
          <button
            type="button"
            class="workbench-btn btn-secondary"
            :disabled="activeStageIndex >= WORKBENCH_STAGES.length - 1"
            @click="moveToAdjacentStage(1)"
          >
            {{ t("app.pipeline.workbench.flow.next") }}
          </button>
        </div>
      </section>

      <!-- Main Workbench Body: 3-Pane Responsive Layout -->
      <div class="workbench-body">
        <!-- Expert mode: canonical task/dependency rail. -->
        <aside
          v-if="expertMode"
          class="workbench-pane-nav"
          :aria-label="t('app.pipeline.workbench.flow.tasks')"
        >
          <div class="task-rail-heading">
            <strong>{{ t("app.pipeline.workbench.flow.tasks") }}</strong>
            <small>{{ t("app.pipeline.workbench.flow.fixedOrder") }}</small>
          </div>
          <ol class="canonical-task-list">
            <li
              v-for="(step, index) in currentRecipe?.steps ?? []"
              :key="step.id"
              class="canonical-task-row"
              :class="[
                `status-${stepAttemptStatus(step.id)}`,
                {
                  selected:
                    WORKBENCH_STAGES.find((stage) =>
                      stage.stepIds.includes(step.id),
                    )?.key === activeStage,
                },
              ]"
            >
              <span class="task-connector" aria-hidden="true">
                <span>{{ index + 1 }}</span>
              </span>
              <button
                type="button"
                class="task-row-button"
                @click="
                  activeStage =
                    WORKBENCH_STAGES.find((stage) =>
                      stage.stepIds.includes(step.id),
                    )?.key ?? activeStage
                "
              >
                <span class="task-row-id">{{ step.id }}</span>
                <strong>{{ t(`app.pipeline.steps.${step.type}`) }}</strong>
                <small>{{ step.type }}</small>
              </button>
              <span
                class="task-row-status"
                :class="`status-${stepAttemptStatus(step.id)}`"
              >
                {{
                  t(
                    `app.pipeline.workbench.stageStatus.${stepAttemptStatus(step.id)}`,
                  )
                }}
              </span>
              <div v-if="step.inputs.length" class="task-dependencies">
                {{
                  t("app.pipeline.workbench.flow.dependsOn", {
                    count: step.inputs.length,
                  })
                }}
              </div>
            </li>
          </ol>
        </aside>

        <!-- PANE 2: Detailed Stage Card ("Used What", "Produced What", "Status", "CTA") -->
        <main class="workbench-pane-card">
          <div
            v-if="!expertMode && waitingReviewStep"
            class="focused-action-card review-card"
          >
            <div>
              <strong>{{
                t("app.pipeline.review.title", {
                  stepName: waitingReviewStep.stepId,
                })
              }}</strong>
              <p>
                {{ t("app.pipeline.workbench.disclosures.waitingUserPrompt") }}
              </p>
            </div>
            <input
              v-model="reviewNotes"
              type="text"
              class="workbench-input"
              :placeholder="t('app.pipeline.review.notesPlaceholder')"
            />
            <div class="card-action-row">
              <button
                type="button"
                class="workbench-btn btn-success"
                :disabled="actionLoading"
                @click="handleReviewDecision('accepted')"
              >
                {{ t("app.pipeline.review.acceptButton") }}
              </button>
              <button
                type="button"
                class="workbench-btn btn-danger"
                :disabled="actionLoading"
                @click="handleReviewDecision('rejected')"
              >
                {{ t("app.pipeline.review.rejectButton") }}
              </button>
            </div>
          </div>
          <div
            v-if="!expertMode && currentRun?.status === 'failed'"
            class="focused-action-card error-card"
            role="alert"
          >
            <strong>{{ t("app.pipeline.workbench.flow.blocked") }}</strong>
            <p>
              {{
                t("app.pipeline.workbench.disclosures.errorDiagnostic", {
                  step:
                    currentRun.stepAttempts[currentRun.currentStepIndex]
                      ?.stepId ?? "Unknown",
                  reason:
                    currentRun.stepAttempts[currentRun.currentStepIndex]?.error
                      ?.message ?? "Unknown error",
                })
              }}
            </p>
            <button
              type="button"
              class="workbench-btn btn-warning"
              :disabled="actionLoading"
              @click="handleRetryRun"
            >
              {{ t("app.pipeline.retryRun") }}
            </button>
          </div>
          <!-- STAGE 1: 選素材 (Materials) -->
          <article v-if="activeStage === 'materials'" class="stage-card">
            <header class="stage-card-header">
              <h3>1. {{ t("app.pipeline.workbench.stages.materials") }}</h3>
              <p>{{ t("app.pipeline.steps.story-plan-select") }}</p>
            </header>

            <div class="four-questions-grid">
              <!-- Q1: 用了什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.usedWhat")
                }}</span>
                <p>
                  {{ (props.assets ?? []).length }} assets in library ({{
                    audioAssets.length
                  }}
                  audio/video candidates).
                </p>
                <div class="mini-asset-thumbnails">
                  <img
                    v-for="a in (props.assets ?? []).slice(0, 6)"
                    :key="a.id"
                    :src="thumbnailUrl(a.id)"
                    :alt="a.name"
                    class="mini-thumb"
                  />
                </div>
              </div>

              <!-- Q2: 產生什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.producedWhat")
                }}</span>
                <p>
                  Filtered and verified media candidate set for editorial
                  proposal.
                </p>
              </div>

              <!-- Q3: 現在什麼狀態 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.currentStatus")
                }}</span>
                <span
                  class="workbench-pill"
                  :class="
                    (props.assets?.length ?? 0) > 0
                      ? 'pill-succeeded'
                      : 'pill-idle'
                  "
                >
                  {{ (props.assets?.length ?? 0) > 0 ? "Ready" : "Empty" }}
                </span>
              </div>

              <!-- Q4: 下一步能做什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.nextAction")
                }}</span>
                <div class="stage-actions">
                  <button
                    type="button"
                    class="workbench-btn btn-secondary"
                    @click="activeStage = 'storyPlan'"
                  >
                    {{ t("app.pipeline.workbench.stages.storyPlan") }} &rarr;
                  </button>
                </div>
              </div>
            </div>
          </article>

          <!-- STAGE 2: 故事方案 (Story Plan) -->
          <article v-else-if="activeStage === 'storyPlan'" class="stage-card">
            <header class="stage-card-header">
              <h3>2. {{ t("app.pipeline.workbench.stages.storyPlan") }}</h3>
              <p>{{ t("app.pipeline.steps.scene-prepare") }}</p>
            </header>

            <div class="four-questions-grid">
              <!-- Q1: 用了什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.usedWhat")
                }}</span>
                <p>
                  Story:
                  <strong>{{ props.activeStory?.title ?? "None" }}</strong>
                  ({{ props.activeStory?.beats.length ?? 0 }} beats, target
                  {{ props.activeStory?.targetDuration ?? 0 }}s).
                </p>
              </div>

              <!-- Q2: 產生什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.producedWhat")
                }}</span>
                <p>
                  Scene visuals, photo aspect ratios, and PhotoDepth fallback
                  (standard-hold).
                </p>
              </div>

              <!-- Q3: 現在什麼狀態 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.currentStatus")
                }}</span>
                <span
                  class="workbench-pill"
                  :class="props.activeStory ? 'pill-succeeded' : 'pill-warning'"
                >
                  {{ props.activeStory ? "Configured" : "Missing Story" }}
                </span>
              </div>

              <!-- Q4: 下一步能做什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.nextAction")
                }}</span>
                <div class="stage-actions">
                  <button
                    type="button"
                    class="workbench-btn btn-outline"
                    @click="navigateToStory('graph')"
                  >
                    <Icon name="grid" :size="14" />
                    {{ t("app.pipeline.workbench.ctas.locateStoryGraph") }}
                  </button>
                  <button
                    type="button"
                    class="workbench-btn btn-outline"
                    @click="navigateToStory('storyboard')"
                  >
                    <Icon name="film" :size="14" />
                    {{ t("app.pipeline.workbench.ctas.locateStoryboard") }}
                  </button>
                  <button
                    type="button"
                    class="workbench-btn btn-secondary"
                    @click="activeStage = 'produceClips'"
                  >
                    {{ t("app.pipeline.workbench.stages.produceClips") }} &rarr;
                  </button>
                </div>
              </div>
            </div>
          </article>

          <!-- STAGE 3: 製作片段 (Produce Clips) -->
          <article
            v-else-if="activeStage === 'produceClips'"
            class="stage-card"
          >
            <header class="stage-card-header">
              <h3>3. {{ t("app.pipeline.workbench.stages.produceClips") }}</h3>
              <p>
                {{ t("app.pipeline.steps.narration") }} &amp;
                {{ t("app.pipeline.steps.composition-adopt") }}
              </p>
            </header>

            <div class="four-questions-grid">
              <!-- Q1: 用了什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.usedWhat")
                }}</span>
                <label class="radio-label">
                  {{ t("editor.pins.target") }}
                  <select
                    v-model="compositionTargetMode"
                    class="workbench-select"
                  >
                    <option value="new-cut">
                      {{ t("editor.pins.newCut") }}
                    </option>
                    <option
                      value="resolve"
                      :disabled="!props.activeCompositionId"
                    >
                      {{ t("editor.pins.resolveCut") }}
                    </option>
                  </select>
                </label>
                <div class="narration-selector-group">
                  <label class="radio-label">
                    <input
                      v-model="narrationStrategy"
                      type="radio"
                      value="none"
                    />
                    {{ t("app.pipeline.narrationNone") }}
                  </label>
                  <label class="radio-label">
                    <input
                      v-model="narrationStrategy"
                      type="radio"
                      value="voice-import"
                    />
                    {{ t("app.pipeline.narrationVoiceImport") }}
                  </label>
                  <label class="radio-label">
                    <input
                      v-model="narrationStrategy"
                      type="radio"
                      value="configured-tts"
                    />
                    {{ t("app.pipeline.narrationConfiguredTts") }}
                  </label>
                </div>

                <!-- Voice Audio Audition Player -->
                <div
                  v-if="narrationStrategy === 'voice-import'"
                  class="audio-audition-card"
                >
                  <select
                    v-model="selectedVoiceAssetId"
                    class="workbench-select"
                  >
                    <option value="" disabled>Select Audio Recording...</option>
                    <option v-for="a in audioAssets" :key="a.id" :value="a.id">
                      {{ a.name }} ({{ a.duration ?? 0 }}s)
                    </option>
                  </select>

                  <div v-if="selectedVoiceAsset" class="audio-player-controls">
                    <button
                      type="button"
                      class="workbench-btn btn-sm btn-outline"
                      @click="handleAuditionToggle"
                    >
                      <Icon
                        :name="audioPlaying ? 'pause' : 'play'"
                        :size="14"
                      />
                      {{
                        audioPlaying
                          ? t("app.pipeline.workbench.ctas.auditionPause")
                          : t("app.pipeline.workbench.ctas.auditionPlay")
                      }}
                    </button>
                    <span class="audio-time">
                      {{ audioCurrentTime.toFixed(1) }}s /
                      {{ (selectedVoiceAsset.duration ?? 0).toFixed(1) }}s
                    </span>
                    <audio
                      ref="audioElement"
                      :src="sourceUrl(selectedVoiceAsset.id)"
                      @timeupdate="handleAudioTimeUpdate"
                      @ended="handleAudioEnded"
                    />
                  </div>
                </div>

                <!-- Remote TTS Consent & Disclosure -->
                <div
                  v-if="narrationStrategy === 'configured-tts'"
                  class="remote-consent-card"
                >
                  <h4>
                    {{
                      t("app.pipeline.workbench.disclosures.remoteConsentTitle")
                    }}
                  </h4>
                  <p>
                    {{
                      t(
                        "app.pipeline.workbench.disclosures.remoteConsentDesc",
                        {
                          destination: "OpenAI Audio API",
                          cost: "USD $0.015 / 1k chars",
                        },
                      )
                    }}
                  </p>
                  <label class="consent-checkbox-label">
                    <input v-model="remoteConsentGiven" type="checkbox" />
                    {{
                      t(
                        "app.pipeline.workbench.disclosures.remoteConsentCheckbox",
                      )
                    }}
                  </label>
                </div>
              </div>

              <!-- Q2: 產生什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.producedWhat")
                }}</span>
                <p v-if="roughCutArtifact">
                  Rough cut composition adopted:
                  <code>{{
                    roughCutArtifact.path ?? roughCutArtifact.id
                  }}</code>
                </p>
                <p v-else class="text-muted">
                  Rough cut composition awaiting synthesis and adoption.
                </p>
              </div>

              <!-- Q3: 現在什麼狀態 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.currentStatus")
                }}</span>
                <span
                  class="workbench-pill"
                  :class="`pill-${stageStatuses.produceClips}`"
                >
                  {{ stageStatuses.produceClips }}
                </span>
                <p
                  v-if="stageStatuses.produceClips === 'waiting-review'"
                  class="status-subtext"
                >
                  {{
                    t("app.pipeline.workbench.disclosures.waitingUserPrompt")
                  }}
                </p>
              </div>

              <!-- Q4: 下一步能做什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.nextAction")
                }}</span>
                <div class="stage-actions">
                  <button
                    v-if="!currentRun || currentRun.status === 'idle'"
                    type="button"
                    class="workbench-btn btn-primary"
                    :disabled="actionLoading"
                    @click="handleStartProduction"
                  >
                    {{ t("app.pipeline.startRun") }}
                  </button>
                  <button
                    v-else-if="currentRun.status === 'running'"
                    type="button"
                    class="workbench-btn btn-danger"
                    :disabled="actionLoading"
                    @click="handleCancelRun"
                  >
                    {{ t("app.pipeline.cancelRun") }}
                  </button>
                  <button
                    v-else-if="roughCutArtifact"
                    type="button"
                    class="workbench-btn btn-success"
                    @click="handleAdoptRoughCut"
                  >
                    {{ t("app.pipeline.workbench.ctas.adoptRoughCut") }}
                  </button>
                  <button
                    v-if="roughCutArtifact"
                    type="button"
                    class="workbench-btn btn-outline"
                    @click="navigateToTimeline"
                  >
                    <Icon name="film" :size="14" />
                    {{ t("app.pipeline.workbench.ctas.locateTimeline") }}
                  </button>
                </div>
              </div>
            </div>
          </article>

          <!-- STAGE 4: 試片檢查 (Preview & QA) -->
          <article v-else-if="activeStage === 'previewQa'" class="stage-card">
            <header class="stage-card-header">
              <h3>4. {{ t("app.pipeline.workbench.stages.previewQa") }}</h3>
              <p>
                {{ t("app.pipeline.steps.render") }} &amp;
                {{ t("app.pipeline.steps.visual-qa") }}
              </p>
            </header>

            <div class="four-questions-grid">
              <!-- Q1: 用了什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.usedWhat")
                }}</span>
                <p>
                  Rough cut timeline, visual QA inspection criteria (blank
                  frames, missing media, depth fallbacks).
                </p>
              </div>

              <!-- Q2: 產生什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.producedWhat")
                }}</span>
                <!-- Video Preview Card: Only plays when explicitly selected! -->
                <div class="video-preview-wrapper">
                  <div
                    v-if="!activeVideoPlaying"
                    class="video-poster-box"
                    @click="handleVideoToggle"
                  >
                    <div class="poster-overlay">
                      <Icon name="play" :size="32" />
                      <span>{{
                        t("app.pipeline.workbench.ctas.playPreview")
                      }}</span>
                    </div>
                  </div>
                  <div v-else class="video-active-box">
                    <p class="video-playing-note">
                      [Video Stream:
                      {{
                        previewVideoArtifact?.path ??
                        "cache/renders/preview.mp4"
                      }}]
                    </p>
                    <button
                      type="button"
                      class="workbench-btn btn-sm btn-outline"
                      @click="handleVideoToggle"
                    >
                      <Icon name="pause" :size="14" />
                      {{ t("app.pipeline.workbench.ctas.pausePreview") }}
                    </button>
                  </div>
                </div>

                <p v-if="qaReportArtifact" class="artifact-meta">
                  QA Report:
                  <code>{{
                    qaReportArtifact.path ?? qaReportArtifact.id
                  }}</code>
                </p>
              </div>

              <!-- Q3: 現在什麼狀態 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.currentStatus")
                }}</span>
                <span
                  class="workbench-pill"
                  :class="`pill-${stageStatuses.previewQa}`"
                >
                  {{ stageStatuses.previewQa }}
                </span>
              </div>

              <!-- Q4: 下一步能做什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.nextAction")
                }}</span>
                <div class="stage-actions">
                  <button
                    type="button"
                    class="workbench-btn btn-secondary"
                    @click="activeStage = 'export'"
                  >
                    {{ t("app.pipeline.workbench.stages.export") }} &rarr;
                  </button>
                </div>
              </div>
            </div>
          </article>

          <!-- STAGE 5: 輸出 (Export) -->
          <article v-else-if="activeStage === 'export'" class="stage-card">
            <header class="stage-card-header">
              <h3>5. {{ t("app.pipeline.workbench.stages.export") }}</h3>
              <p>{{ t("app.pipeline.steps.export") }}</p>
            </header>

            <div class="four-questions-grid">
              <!-- Q1: 用了什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.usedWhat")
                }}</span>
                <p>Approved rough cut composition, MP4 1080p export profile.</p>
              </div>

              <!-- Q2: 產生什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.producedWhat")
                }}</span>
                <p v-if="exportFileArtifact">
                  Final Video Export:
                  <code>{{
                    exportFileArtifact.path ?? exportFileArtifact.id
                  }}</code>
                </p>
                <p v-else class="text-muted">Awaiting export step execution.</p>
              </div>

              <!-- Q3: 現在什麼狀態 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.currentStatus")
                }}</span>
                <span
                  class="workbench-pill"
                  :class="`pill-${stageStatuses.export}`"
                >
                  {{ stageStatuses.export }}
                </span>
              </div>

              <!-- Q4: 下一步能做什麼 -->
              <div class="question-box">
                <span class="q-label">{{
                  t("app.pipeline.workbench.card.nextAction")
                }}</span>
                <div class="stage-actions">
                  <button
                    type="button"
                    class="workbench-btn btn-primary"
                    :disabled="actionLoading || !roughCutArtifact"
                    @click="handleStartProduction"
                  >
                    {{ t("app.pipeline.workbench.ctas.startExport") }}
                  </button>
                </div>
              </div>
            </div>
          </article>
        </main>

        <!-- PANE 3: Inspector, Review Action & Sub-steps -->
        <aside v-if="expertMode" class="workbench-pane-inspector">
          <!-- Waiting Review Action Card -->
          <div v-if="waitingReviewStep" class="inspector-card review-card">
            <h4>
              {{
                t("app.pipeline.review.title", {
                  stepName: waitingReviewStep.stepId,
                })
              }}
            </h4>
            <p>
              {{ t("app.pipeline.workbench.disclosures.waitingUserPrompt") }}
            </p>
            <div class="field-block">
              <input
                v-model="reviewNotes"
                type="text"
                class="workbench-input"
                :placeholder="t('app.pipeline.review.notesPlaceholder')"
              />
            </div>
            <div class="card-action-row">
              <button
                type="button"
                class="workbench-btn btn-success"
                :disabled="actionLoading"
                @click="handleReviewDecision('accepted')"
              >
                {{ t("app.pipeline.review.acceptButton") }}
              </button>
              <button
                type="button"
                class="workbench-btn btn-danger"
                :disabled="actionLoading"
                @click="handleReviewDecision('rejected')"
              >
                {{ t("app.pipeline.review.rejectButton") }}
              </button>
            </div>
          </div>

          <!-- Error Diagnostics Card -->
          <div
            v-if="currentRun?.status === 'failed'"
            class="inspector-card error-card"
          >
            <h4>Execution Failure</h4>
            <p>
              {{
                t("app.pipeline.workbench.disclosures.errorDiagnostic", {
                  step:
                    currentRun.stepAttempts[currentRun.currentStepIndex]
                      ?.stepId ?? "Unknown",
                  reason:
                    currentRun.stepAttempts[currentRun.currentStepIndex]?.error
                      ?.message ?? "Unknown error",
                })
              }}
            </p>
            <button
              type="button"
              class="workbench-btn btn-warning"
              :disabled="actionLoading"
              @click="handleRetryRun"
            >
              {{ t("app.pipeline.retryRun") }}
            </button>
          </div>

          <div class="inspector-card run-context-card">
            <span class="q-label">{{
              t("app.pipeline.workbench.flow.runContext")
            }}</span>
            <strong>{{ currentRecipe?.name ?? selectedRecipeId }}</strong>
            <code v-if="currentRun">{{ currentRun.id }}</code>
            <small>{{ t("app.pipeline.workbench.flow.expertHint") }}</small>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pipeline-workbench-root {
  --color-bg-panel: var(--of-surface-1);
  --color-bg-secondary: var(--of-surface-2);
  --color-border: var(--of-border-subtle);
  --color-border-subtle: var(--of-border-subtle);
  --color-text: var(--of-text-primary);
  --color-text-muted: var(--of-text-secondary);
  font-family: inherit;
  color: var(--color-text, #f0f0f5);
}

/* =========================================
   MODE 1: Collapsed Docked Bottom Bar
   ========================================= */
.pipeline-status-bar {
  box-sizing: border-box;
  max-width: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 60px;
  padding: var(--of-space-3) var(--of-workspace-gutter);
  background: var(--color-bg-panel, #1e1e24);
  border-top: 1px solid var(--color-border, #33333d);
  z-index: 100;
  gap: 12px;
}

.bar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.bar-expand-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  color: var(--color-text, #f0f0f5);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.bar-expand-btn:hover {
  color: var(--of-accent);
}

.bar-stages-track {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bar-stage-dot {
  min-height: 28px;
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: var(--of-radius-sm);
  background: var(--color-bg-secondary, #282832);
  color: var(--color-text-muted, #9999a8);
  cursor: pointer;
  transition: border-color var(--of-motion-fast);
}

.bar-stage-dot.status-succeeded {
  background: var(--of-success-soft);
  color: var(--of-success);
}

.bar-stage-dot.status-waiting-review {
  background: var(--of-warning-soft);
  color: var(--of-warning);
  font-weight: 700;
}

.bar-stage-dot.status-failed {
  background: var(--of-danger-soft);
  color: var(--of-danger);
}

.bar-stage-dot.active {
  border-color: var(--of-accent);
}

.bar-center {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bar-cta-btn {
  min-height: 36px;
  padding: 5px 12px;
  border-radius: var(--of-radius-md);
  font-size: 0.8rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
}

.bar-cta-primary {
  background: var(--of-accent);
  color: var(--of-accent-ink);
}

.bar-cta-warning {
  background: var(--of-warning-soft);
  color: var(--of-warning);
}

.bar-icon-btn {
  background: transparent;
  border: 1px solid var(--color-border, #33333d);
  color: var(--color-text-muted, #9999a8);
  border-radius: var(--of-radius-md);
  min-width: 32px;
  min-height: 32px;
  padding: var(--of-space-1) var(--of-space-2);
  cursor: pointer;
  display: flex;
  align-items: center;
}

.bar-icon-btn:hover {
  color: var(--of-text-primary);
  border-color: var(--of-border-strong);
}

/* =========================================
   MODE 2 & 3: Drawer & Modal Container
   ========================================= */
.pipeline-workbench-container {
  display: flex;
  flex-direction: column;
  background: var(--color-bg-panel, #1e1e24);
  color: var(--color-text, #f0f0f5);
  z-index: 200;
}

.pipeline-workbench-container.is-drawer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: min(72dvh, 680px);
  box-shadow: var(--of-shadow-dialog);
  border-top: 1px solid var(--color-border, #33333d);
}

.pipeline-workbench-container.is-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background: var(--color-bg-panel, #1e1e24);
}

.workbench-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--of-space-4) var(--of-panel-inset);
  border-bottom: 1px solid var(--color-border, #33333d);
  flex-wrap: wrap;
  gap: var(--of-group-gap);
}

.workbench-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex-wrap: wrap;
}

.workbench-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.workbench-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.workbench-tool-btn {
  background: var(--color-bg-secondary, #282832);
  border: 1px solid var(--color-border, #33333d);
  color: var(--color-text-muted, #9999a8);
  padding: 6px 12px;
  border-radius: var(--of-radius-md);
  font-size: 0.8rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  border-color: transparent;
  min-height: 36px;
}

.workbench-tool-btn:hover {
  color: var(--of-text-primary);
  border-color: var(--of-border-strong);
}

.workbench-alert-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  font-size: 0.85rem;
}

.workbench-alert-banner.warning {
  background: var(--of-warning-soft);
  border-bottom: 1px solid var(--of-warning);
  color: var(--of-warning);
}

.banner-text p,
.banner-text small {
  margin: 2px 0 0 0;
}

.banner-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.workbench-impact-panel {
  margin: 12px 16px;
  padding: 16px;
  background: var(--color-bg-secondary, #1e1e24);
  border: 1px solid var(--color-border-subtle, #33333d);
  border-radius: var(--of-radius-md);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.impact-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.impact-subtitle {
  font-size: 12px;
  color: var(--color-text-muted, #8e8e9a);
  margin-top: 2px;
}

.impact-summary-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.impact-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: var(--of-radius-lg);
}

.impact-chip.chip-reuse {
  background: var(--of-success-soft);
  color: var(--of-success);
  border: 1px solid transparent;
}

.impact-chip.chip-fallback {
  background: var(--of-warning-soft);
  color: var(--of-warning);
  border: 1px solid transparent;
}

.impact-fallback-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-muted, #c0c0d0);
  background: var(--of-surface-2);
  padding: 8px 12px;
  border-radius: var(--of-radius-sm);
}

.impact-steps-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
}

.impact-step-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--of-radius-sm);
  background: var(--of-surface-1);
  border: 1px solid var(--color-border-subtle, #2a2a35);
  font-size: 13px;
}

.step-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 200px;
}

.step-id-pill {
  font-size: 10px;
  font-family: monospace;
  background: var(--of-surface-3);
  padding: 2px 6px;
  border-radius: var(--of-radius-sm);
}

.step-status-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--of-radius-md);
  min-width: 60px;
  text-align: center;
}

.step-status-pill.pill-reuse {
  background: var(--of-success-soft);
  color: var(--of-success);
}

.step-status-pill.pill-rerun {
  background: var(--of-accent-soft);
  color: var(--of-accent);
}

.step-status-pill.pill-needs-review {
  background: var(--of-warning-soft);
  color: var(--of-warning);
}

.step-status-pill.pill-unavailable {
  background: var(--of-danger-soft);
  color: var(--of-danger);
}

.step-reason {
  flex: 1;
  font-size: 12px;
  color: var(--color-text-muted, #a0a0b0);
}

.step-inputs-changed {
  color: var(--of-warning);
  margin-left: 4px;
}

.impact-panel-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-subtle, #33333d);
}

.workbench-stepper {
  display: flex;
  padding: 0 var(--of-panel-inset);
  background: var(--color-bg-panel, #1e1e24);
  border-bottom: 1px solid var(--color-border, #33333d);
  overflow-x: auto;
}

.workbench-step-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--color-text-muted, #9999a8);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.workbench-step-tab:hover {
  color: var(--of-text-primary);
}

.workbench-step-tab.active {
  color: var(--of-accent);
  border-bottom-color: var(--of-accent);
  background: var(--of-accent-soft);
}

.workbench-step-tab.is-succeeded .step-num {
  color: var(--of-success);
  background: var(--of-success-soft);
}

.workbench-step-tab.is-failed .step-num {
  color: var(--of-danger);
  background: var(--of-danger-soft);
}

.step-num {
  font-size: 0.75rem;
  font-weight: 700;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--of-surface-3);
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-badge-review {
  background: var(--of-warning-soft);
  color: var(--of-warning);
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--of-radius-md);
}

.gate-summary {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(180px, 0.8fr) auto;
  gap: var(--of-space-4);
  align-items: center;
  padding: var(--of-space-3) var(--of-panel-inset);
  background: var(--of-surface-1);
  border-bottom: 1px solid var(--of-border-subtle);
}

.gate-summary-copy {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--of-space-2);
}

.gate-summary-copy h3 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: var(--of-font-base);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gate-eyebrow {
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
  font-weight: 650;
  white-space: nowrap;
}

.gate-progress-wrap {
  display: grid;
  gap: var(--of-space-1);
}

.gate-progress-wrap small {
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}

.gate-progress {
  height: 5px;
  overflow: hidden;
  background: var(--of-surface-3);
  border-radius: var(--of-radius-round);
}

.gate-progress span {
  display: block;
  height: 100%;
  background: var(--of-accent);
  border-radius: inherit;
  transition: width var(--of-motion-fast);
}

.gate-pager {
  display: flex;
  gap: var(--of-space-2);
}

/* =========================================
   3-Pane Layout
   ========================================= */
.workbench-body {
  flex: 1;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 300px;
  overflow: hidden;
  min-height: 0;
}

.pipeline-workbench-root[data-workspace-mode="standard"] .workbench-body {
  grid-template-columns: minmax(0, 1fr);
}

.pipeline-workbench-root[data-workspace-mode="standard"] .workbench-pane-card {
  width: min(100%, 1100px);
  margin-inline: auto;
}

.workbench-pane-nav {
  border-right: 1px solid var(--color-border, #33333d);
  padding: 12px;
  overflow-y: auto;
}

.task-rail-heading {
  display: grid;
  gap: var(--of-space-1);
  padding: var(--of-space-1) var(--of-space-2) var(--of-space-3);
}

.task-rail-heading strong {
  font-size: var(--of-font-small);
}

.task-rail-heading small {
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}

.canonical-task-list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.canonical-task-row {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: start;
  min-width: 0;
  padding: var(--of-space-1) 0 var(--of-space-3);
}

.canonical-task-row:not(:last-child)::before {
  position: absolute;
  top: 28px;
  bottom: -2px;
  left: 13px;
  width: 1px;
  content: "";
  background: var(--of-border-strong);
}

.task-connector {
  z-index: 1;
  display: grid;
  width: 26px;
  height: 26px;
  color: var(--of-text-secondary);
  font-size: 10px;
  font-weight: 700;
  background: var(--of-surface-2);
  border: 1px solid var(--of-border-strong);
  border-radius: 50%;
  place-items: center;
}

.canonical-task-row.status-succeeded .task-connector {
  color: var(--of-success);
  background: var(--of-success-soft);
  border-color: var(--of-success);
}

.canonical-task-row.status-running .task-connector,
.canonical-task-row.status-waiting-review .task-connector {
  color: var(--of-accent);
  background: var(--of-accent-soft);
  border-color: var(--of-accent);
}

.task-row-button {
  display: grid;
  min-width: 0;
  padding: var(--of-space-1) var(--of-space-2);
  color: var(--of-text-primary);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--of-radius-sm);
  cursor: pointer;
}

.task-row-button:hover,
.task-row-button:focus-visible,
.canonical-task-row.selected .task-row-button {
  background: var(--of-accent-soft);
  outline: none;
}

.task-row-button strong {
  overflow: hidden;
  font-size: var(--of-font-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-row-button small,
.task-row-id {
  color: var(--of-text-secondary);
  font-size: 10px;
}

.task-row-id {
  font-family: var(--of-font-mono, monospace);
  text-transform: uppercase;
}

.task-row-status {
  margin-top: var(--of-space-1);
  padding: 2px var(--of-space-1);
  color: var(--of-text-secondary);
  font-size: 9px;
  border-radius: var(--of-radius-round);
}

.task-row-status.status-succeeded {
  color: var(--of-success);
  background: var(--of-success-soft);
}

.task-row-status.status-failed {
  color: var(--of-danger);
  background: var(--of-danger-soft);
}

.task-row-status.status-waiting-review {
  color: var(--of-warning);
  background: var(--of-warning-soft);
}

.task-dependencies {
  grid-column: 2 / 4;
  padding: 0 var(--of-space-2);
  color: var(--of-text-muted);
  font-size: 10px;
}

.stage-nav-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stage-nav-list li {
  padding: 8px 10px;
  border-radius: var(--of-radius-sm);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stage-nav-list li.selected {
  background: var(--of-accent-soft);
  border-left: 3px solid var(--of-accent);
}

.stage-nav-title {
  font-size: 0.8rem;
  font-weight: 600;
}

.stage-nav-status {
  font-size: 0.7rem;
  text-transform: uppercase;
}

.workbench-pane-card {
  padding: var(--of-panel-inset);
  overflow-y: auto;
  min-width: 0;
}

.focused-action-card {
  display: grid;
  gap: var(--of-space-3);
  margin-bottom: var(--of-space-4);
  padding: var(--of-space-4);
  border: 1px solid currentColor;
  border-radius: var(--of-radius-md);
}

.focused-action-card p {
  margin: var(--of-space-1) 0 0;
}

.stage-card-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.stage-card-header p {
  margin: 4px 0 12px 0;
  font-size: 0.8rem;
  color: var(--color-text-muted, #9999a8);
}

.four-questions-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--of-group-gap);
}

.question-box {
  background: var(--color-bg-secondary, #282832);
  min-width: 0;
  border: 0;
  border-radius: var(--of-radius-md);
  padding: var(--of-space-4);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.q-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--of-text-secondary);
}

.mini-asset-thumbnails {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.mini-thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: var(--of-radius-sm);
  border: 1px solid #444;
}

.audio-audition-card,
.remote-consent-card {
  margin-top: 8px;
  padding: 10px;
  background: var(--color-bg-panel, #1e1e24);
  border-radius: var(--of-radius-sm);
  border: 1px solid var(--color-border, #33333d);
}

.audio-player-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}

.video-preview-wrapper {
  margin-top: 6px;
}

.video-poster-box {
  height: 120px;
  background: #111;
  border-radius: var(--of-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid var(--color-border, #33333d);
}

.poster-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #fff;
}

.stage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

/* =========================================
   PANE 3: Inspector
   ========================================= */
.workbench-pane-inspector {
  border-left: 1px solid var(--color-border, #33333d);
  padding: 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.inspector-card {
  background: var(--color-bg-secondary, #282832);
  border: 0;
  border-radius: var(--of-radius-md);
  padding: var(--of-space-4);
}

.run-context-card {
  display: grid;
  gap: var(--of-space-2);
}

.run-context-card code,
.run-context-card small {
  overflow-wrap: anywhere;
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}

.review-card {
  border-color: var(--of-warning);
  background: var(--of-warning-soft);
}

.error-card {
  border-color: var(--of-danger);
  background: var(--of-danger-soft);
}

.card-action-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.toggle-substeps-btn {
  background: transparent;
  border: none;
  color: var(--color-text, #f0f0f5);
  font-size: 0.8rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  width: 100%;
}

.substeps-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.substep-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  padding: 4px 6px;
  background: var(--color-bg-panel, #1e1e24);
  border-radius: var(--of-radius-sm);
}

.substep-idx {
  font-weight: 700;
  color: var(--color-text-muted, #9999a8);
}

.substep-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.substep-chip {
  font-size: 0.65rem;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: uppercase;
}

.substep-chip.pending {
  color: var(--of-text-muted);
}

.substep-chip.running {
  color: var(--of-accent);
}

.substep-chip.succeeded {
  color: var(--of-success);
}

.substep-chip.waiting-review {
  color: var(--of-warning);
}

.substep-chip.failed {
  color: var(--of-danger);
}

/* =========================================
   Pills & Buttons
   ========================================= */
.workbench-pill {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: var(--of-radius-lg);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-transform: uppercase;
}

.pill-succeeded {
  background: var(--of-success-soft);
  color: var(--of-success);
}

.pill-warning {
  background: var(--of-warning-soft);
  color: var(--of-warning);
}

.pill-review {
  background: var(--of-warning-soft);
  color: var(--of-warning);
}

.pill-running {
  background: var(--of-accent-soft);
  color: var(--of-accent);
}

.pill-failed {
  background: var(--of-danger-soft);
  color: var(--of-danger);
}

.pill-idle {
  background: var(--of-surface-2);
  color: var(--of-text-secondary);
}

.indeterminate-bar {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.workbench-btn {
  padding: 6px 14px;
  border-radius: var(--of-radius-md);
  font-size: 0.8rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: opacity 0.15s ease;
  min-height: 36px;
}

.workbench-btn:hover {
  opacity: 0.9;
}

.workbench-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--of-accent);
  color: var(--of-accent-ink);
}

.btn-secondary {
  background: var(--of-surface-2);
  color: var(--of-text-primary);
}

.btn-success {
  background: var(--of-success-soft);
  color: var(--of-success);
}

.btn-warning {
  background: var(--of-warning-soft);
  color: var(--of-warning);
}

.btn-danger {
  background: var(--of-danger-soft);
  color: var(--of-danger);
}

.btn-outline {
  background: transparent;
  border: 1px solid var(--color-border, #33333d);
  color: var(--color-text, #f0f0f5);
}

.workbench-input,
.workbench-select {
  width: 100%;
  padding: 6px 10px;
  border-radius: var(--of-radius-sm);
  border: 1px solid var(--of-border-control);
  background: var(--of-bg);
  color: var(--of-text-primary);
  font-size: 0.8rem;
}

/* =========================================
   Responsive Breakpoints & Reduced Motion
   ========================================= */
@media (max-width: 1280px) {
  .workbench-body {
    grid-template-columns: 160px minmax(0, 1fr);
  }
  .workbench-pane-inspector {
    display: none;
  }
}

@media (max-width: 1024px) {
  .pipeline-workbench-container.is-drawer {
    height: 72dvh;
  }
  .workbench-body {
    grid-template-columns: 1fr;
  }
  .workbench-pane-nav {
    display: none;
  }
  .four-questions-grid {
    grid-template-columns: 1fr;
  }
  .bar-stages-track {
    display: none;
  }
  .gate-summary {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .gate-progress-wrap {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}

@media (max-height: 600px) {
  .pipeline-workbench-container.is-drawer {
    height: calc(100dvh - 16px);
  }
}

@media (max-width: 600px) {
  .pipeline-status-bar {
    padding: 6px 12px;
    gap: 8px;
  }
  .bar-title {
    display: none;
  }
  .gate-summary {
    grid-template-columns: 1fr;
  }
  .gate-progress-wrap,
  .gate-pager {
    grid-column: 1;
  }
  .gate-pager .workbench-btn {
    flex: 1;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pipeline-workbench-container,
  .workbench-btn,
  .indeterminate-bar {
    transition: none !important;
    animation: none !important;
  }
  .gate-progress span {
    transition: none !important;
  }
}
</style>
