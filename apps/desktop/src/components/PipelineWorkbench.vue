<!-- Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, sourceUrl, thumbnailUrl } from "../api.js";
import Icon from "./Icon.vue";
import type {
  PipelineRecipe,
  PipelineRun,
  PipelineStepAttempt,
  MediaAsset,
  Story,
  OpenFilmProject,
} from "@openfilm/core";

export type WorkbenchMode = "bar" | "drawer" | "modal";
export type WorkbenchStageKey =
  "materials" | "storyPlan" | "produceClips" | "previewQa" | "export";

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

const mode = ref<WorkbenchMode>(props.initialMode);
const activeStage = ref<WorkbenchStageKey>("produceClips");
const showAdvancedSubSteps = ref(false);

const recipes = ref<PipelineRecipe[]>([]);
const selectedRecipeId = ref<string>("guided-story-to-video");
const currentRun = ref<PipelineRun | null>(null);
const runsList = ref<PipelineRun[]>([]);
const actionLoading = ref(false);
const error = ref<string | null>(null);

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
const stageStatuses = computed<Record<WorkbenchStageKey, string>>(() => {
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

  // Derive status from underlying attempts
  const step3 = run.stepAttempts.find((s) => s.stepId === "step-3");
  const step5 = run.stepAttempts.find((s) => s.stepId === "step-5");
  const step6 = run.stepAttempts.find((s) => s.stepId === "step-6");
  const step7 = run.stepAttempts.find((s) => s.stepId === "step-7");
  const step8 = run.stepAttempts.find((s) => s.stepId === "step-8");

  let produceStatus = "idle";
  if (step5?.status === "succeeded") produceStatus = "succeeded";
  else if (step3?.status === "waiting-review") produceStatus = "waiting-review";
  else if (step3?.status === "running" || step5?.status === "running")
    produceStatus = "running";
  else if (step3?.status === "failed" || step5?.status === "failed")
    produceStatus = "failed";

  let previewStatus = "idle";
  if (step7?.status === "succeeded") previewStatus = "succeeded";
  else if (step7?.status === "waiting-review") previewStatus = "waiting-review";
  else if (step6?.status === "running" || step7?.status === "running")
    previewStatus = "running";
  else if (step6?.status === "failed" || step7?.status === "failed")
    previewStatus = "failed";

  let exportStatus = "idle";
  if (step8?.status === "succeeded") exportStatus = "succeeded";
  else if (step8?.status === "running") exportStatus = "running";
  else if (step8?.status === "failed") exportStatus = "failed";

  return {
    materials: (props.assets?.length ?? 0) > 0 ? "succeeded" : "idle",
    storyPlan: props.activeStory ? "succeeded" : "idle",
    produceClips: produceStatus,
    previewQa: previewStatus,
    export: exportStatus,
  };
});

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
  const target = e.target as HTMLElement | null;
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
  if (mode.value !== "bar" && !e.ctrlKey && !e.altKey && !e.metaKey) {
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
          <span
            v-for="(stKey, idx) in [
              'materials',
              'storyPlan',
              'produceClips',
              'previewQa',
              'export',
            ] as WorkbenchStageKey[]"
            :key="stKey"
            class="bar-stage-dot"
            :class="[
              `status-${stageStatuses[stKey]}`,
              { active: activeStage === stKey },
            ]"
            :title="t(`app.pipeline.workbench.stages.${stKey}`)"
            @click="
              activeStage = stKey;
              switchMode('drawer');
            "
          >
            {{ idx + 1 }}. {{ t(`app.pipeline.workbench.stages.${stKey}`) }}
          </span>
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
          @click="handleStartProduction"
        >
          {{ t("app.pipeline.workbench.ctas.newRunWithLatest") }}
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
      class="pipeline-workbench-container"
      :class="{
        'is-drawer': mode === 'drawer',
        'is-modal': mode === 'modal',
      }"
      role="dialog"
      aria-modal="true"
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
        <button
          type="button"
          class="workbench-btn btn-warning"
          :disabled="actionLoading"
          @click="handleStartProduction"
        >
          {{ t("app.pipeline.workbench.ctas.newRunWithLatest") }}
        </button>
      </div>

      <!-- 5-Stage Stepper Bar -->
      <nav
        class="workbench-stepper"
        :aria-label="t('app.pipeline.workbench.stages.materials')"
      >
        <button
          v-for="(stKey, idx) in [
            'materials',
            'storyPlan',
            'produceClips',
            'previewQa',
            'export',
          ] as WorkbenchStageKey[]"
          :key="stKey"
          type="button"
          class="workbench-step-tab"
          :class="{
            active: activeStage === stKey,
            'is-succeeded': stageStatuses[stKey] === 'succeeded',
            'is-review': stageStatuses[stKey] === 'waiting-review',
            'is-failed': stageStatuses[stKey] === 'failed',
          }"
          :aria-current="activeStage === stKey ? 'step' : undefined"
          @click="activeStage = stKey"
        >
          <span class="step-num">{{ idx + 1 }}</span>
          <span class="step-label">{{
            t(`app.pipeline.workbench.stages.${stKey}`)
          }}</span>
          <span
            v-if="stageStatuses[stKey] === 'waiting-review'"
            class="step-badge-review"
            >!</span
          >
        </button>
      </nav>

      <!-- Main Workbench Body: 3-Pane Responsive Layout -->
      <div class="workbench-body">
        <!-- PANE 1: Stage Overview List (Collapsible on compact) -->
        <aside class="workbench-pane-nav">
          <ul class="stage-nav-list">
            <li
              v-for="stKey in [
                'materials',
                'storyPlan',
                'produceClips',
                'previewQa',
                'export',
              ] as WorkbenchStageKey[]"
              :key="stKey"
              :class="{ selected: activeStage === stKey }"
              @click="activeStage = stKey"
            >
              <div class="stage-nav-title">
                {{ t(`app.pipeline.workbench.stages.${stKey}`) }}
              </div>
              <span class="stage-nav-status" :class="stageStatuses[stKey]">
                {{ stageStatuses[stKey] }}
              </span>
            </li>
          </ul>
        </aside>

        <!-- PANE 2: Detailed Stage Card ("Used What", "Produced What", "Status", "CTA") -->
        <main class="workbench-pane-card">
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
        <aside class="workbench-pane-inspector">
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

          <!-- Collapsible 8 Sub-steps & Dependencies -->
          <div class="inspector-card sub-steps-card">
            <button
              type="button"
              class="toggle-substeps-btn"
              @click="showAdvancedSubSteps = !showAdvancedSubSteps"
            >
              <Icon
                :name="showAdvancedSubSteps ? 'chevron' : 'plus'"
                :size="14"
              />
              <span>Canonical 8 Steps &amp; Dependencies</span>
            </button>

            <div v-if="showAdvancedSubSteps" class="substeps-list">
              <div
                v-for="(st, idx) in currentRecipe?.steps ?? []"
                :key="st.id"
                class="substep-row"
              >
                <span class="substep-idx">{{ idx + 1 }}</span>
                <div class="substep-meta">
                  <strong>{{ st.name }}</strong>
                  <small>{{ st.type }}</small>
                </div>
                <span
                  class="substep-chip"
                  :class="currentRun?.stepAttempts[idx]?.status ?? 'pending'"
                >
                  {{ currentRun?.stepAttempts[idx]?.status ?? "pending" }}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pipeline-workbench-root {
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
  padding: 8px 16px;
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
  color: #3b82f6;
}

.bar-stages-track {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bar-stage-dot {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--color-bg-secondary, #282832);
  color: var(--color-text-muted, #9999a8);
  cursor: pointer;
  transition: all 0.15s ease;
}

.bar-stage-dot.status-succeeded {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
}

.bar-stage-dot.status-waiting-review {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
  font-weight: 700;
}

.bar-stage-dot.status-failed {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.bar-stage-dot.active {
  box-shadow: 0 0 0 1px #3b82f6;
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
  padding: 5px 12px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
}

.bar-cta-primary {
  background: #2563eb;
  color: #fff;
}

.bar-cta-warning {
  background: #d97706;
  color: #fff;
}

.bar-icon-btn {
  background: transparent;
  border: 1px solid var(--color-border, #33333d);
  color: var(--color-text-muted, #9999a8);
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.bar-icon-btn:hover {
  color: #fff;
  border-color: #555;
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
  height: 52vh;
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.5);
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
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border, #33333d);
}

.workbench-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workbench-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.workbench-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workbench-tool-btn {
  background: var(--color-bg-secondary, #282832);
  border: 1px solid var(--color-border, #33333d);
  color: var(--color-text-muted, #9999a8);
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.workbench-tool-btn:hover {
  color: #fff;
  border-color: #555;
}

.workbench-alert-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  font-size: 0.85rem;
}

.workbench-alert-banner.warning {
  background: rgba(217, 119, 6, 0.15);
  border-bottom: 1px solid #d97706;
  color: #fcd34d;
}

.banner-text p,
.banner-text small {
  margin: 2px 0 0 0;
}

.workbench-stepper {
  display: flex;
  background: var(--color-bg-secondary, #282832);
  border-bottom: 1px solid var(--color-border, #33333d);
  overflow-x: auto;
}

.workbench-step-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 12px;
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
  color: #fff;
}

.workbench-step-tab.active {
  color: #60a5fa;
  border-bottom-color: #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}

.step-num {
  font-size: 0.75rem;
  font-weight: 700;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #3e3e4a;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-badge-review {
  background: #d97706;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 10px;
}

/* =========================================
   3-Pane Layout
   ========================================= */
.workbench-body {
  flex: 1;
  display: grid;
  grid-template-columns: 180px 1fr 300px;
  overflow: hidden;
}

.workbench-pane-nav {
  border-right: 1px solid var(--color-border, #33333d);
  padding: 12px;
  overflow-y: auto;
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
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stage-nav-list li.selected {
  background: rgba(59, 130, 246, 0.1);
  border-left: 3px solid #3b82f6;
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
  padding: 16px 20px;
  overflow-y: auto;
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
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.question-box {
  background: var(--color-bg-secondary, #282832);
  border: 1px solid var(--color-border, #33333d);
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.q-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #60a5fa;
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
  border-radius: 4px;
  border: 1px solid #444;
}

.audio-audition-card,
.remote-consent-card {
  margin-top: 8px;
  padding: 10px;
  background: var(--color-bg-panel, #1e1e24);
  border-radius: 4px;
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
  border-radius: 6px;
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
  border: 1px solid var(--color-border, #33333d);
  border-radius: 6px;
  padding: 12px;
}

.review-card {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.08);
}

.error-card {
  border-color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
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
  border-radius: 4px;
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
  color: #777;
}

.substep-chip.running {
  color: #60a5fa;
}

.substep-chip.succeeded {
  color: #34d399;
}

.substep-chip.waiting-review {
  color: #fbbf24;
}

.substep-chip.failed {
  color: #f87171;
}

/* =========================================
   Pills & Buttons
   ========================================= */
.workbench-pill {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-transform: uppercase;
}

.pill-succeeded {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.pill-warning {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}

.pill-review {
  background: #d97706;
  color: #fff;
}

.pill-running {
  background: #2563eb;
  color: #fff;
}

.pill-failed {
  background: rgba(220, 38, 38, 0.2);
  color: #f87171;
}

.pill-idle {
  background: #33333d;
  color: #e5e7eb;
}

.indeterminate-bar {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
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
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: opacity 0.15s ease;
}

.workbench-btn:hover {
  opacity: 0.9;
}

.workbench-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-primary {
  background: #2563eb;
  color: #fff;
}

.btn-secondary {
  background: #374151;
  color: #f3f4f6;
}

.btn-success {
  background: #059669;
  color: #fff;
}

.btn-warning {
  background: #d97706;
  color: #fff;
}

.btn-danger {
  background: #dc2626;
  color: #fff;
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
  border-radius: 4px;
  border: 1px solid var(--color-border, #33333d);
  background: var(--color-bg-secondary, #282832);
  color: var(--color-text, #f0f0f5);
  font-size: 0.8rem;
}

/* =========================================
   Responsive Breakpoints & Reduced Motion
   ========================================= */
@media (max-width: 1280px) {
  .workbench-body {
    grid-template-columns: 160px 1fr;
  }
  .workbench-pane-inspector {
    display: none;
  }
}

@media (max-width: 1024px) {
  .pipeline-workbench-container.is-drawer {
    height: 65vh;
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
}

@media (max-width: 600px) {
  .pipeline-status-bar {
    padding: 6px 12px;
    gap: 8px;
  }
  .bar-title {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pipeline-workbench-container,
  .workbench-btn,
  .indeterminate-bar {
    transition: none !important;
    animation: none !important;
  }
}
</style>
