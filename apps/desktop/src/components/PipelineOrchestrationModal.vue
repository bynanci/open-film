<!-- Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api.js";
import type {
  PipelineRecipe,
  PipelineRun,
  MediaAsset,
  Story,
} from "@openfilm/core";

const props = defineProps<{
  open: boolean;
  storyId?: string;
  activeStory?: Story | null;
  assets?: MediaAsset[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "rough-cut-adopted", compositionId: string): void;
}>();

const { t } = useI18n();

const recipes = ref<PipelineRecipe[]>([]);
const selectedRecipeId = ref<string>("guided-story-to-video");
const currentRun = ref<PipelineRun | null>(null);
const runsList = ref<PipelineRun[]>([]);
const actionLoading = ref(false);
const error = ref<string | null>(null);

// Narration selection in preflight
const narrationStrategy = ref<"none" | "voice-import" | "configured-tts">(
  "none",
);
const selectedVoiceAssetId = ref<string>("");
const reviewNotes = ref<string>("");

// Polling timer for active run
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

const waitingReviewStep = computed(() => {
  if (!currentRun.value || currentRun.value.status !== "waiting-review") {
    return null;
  }
  return currentRun.value.stepAttempts.find(
    (s) => s.status === "waiting-review",
  );
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
    // If there is an active or most recent run, pick it
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

async function handleStartProduction() {
  error.value = null;
  actionLoading.value = true;
  try {
    // Build narration options
    let narrationOption: {
      type: "none" | "voice-import" | "configured-tts";
      assetId?: string;
      providerId?: string;
      speechConsent?: boolean;
    } = { type: "none" };
    if (narrationStrategy.value === "voice-import") {
      if (!selectedVoiceAssetId.value) {
        throw new Error("Please select a voice audio asset.");
      }
      narrationOption = {
        type: "voice-import",
        assetId: selectedVoiceAssetId.value,
      };
    } else if (narrationStrategy.value === "configured-tts") {
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

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.open) {
    emit("close");
  }
}

watch(
  () => props.open,
  (val) => {
    if (val) {
      void loadRecipes();
      void loadRuns();
      window.addEventListener("keydown", handleKeydown);
    } else {
      stopPolling();
      window.removeEventListener("keydown", handleKeydown);
    }
  },
);

onMounted(() => {
  if (props.open) {
    void loadRecipes();
    void loadRuns();
    window.addEventListener("keydown", handleKeydown);
  }
});

onUnmounted(() => {
  stopPolling();
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div
    v-if="open"
    class="pipeline-modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="pipeline-modal-title"
  >
    <div class="pipeline-modal-card">
      <!-- Header -->
      <header class="pipeline-modal-header">
        <div>
          <h2 id="pipeline-modal-title" class="pipeline-modal-title">
            {{ t("app.pipeline.title") }}
          </h2>
          <p class="pipeline-modal-subtitle">
            {{ t("app.pipeline.subtitle") }}
          </p>
        </div>
        <button
          type="button"
          class="pipeline-close-btn"
          aria-label="Close"
          @click="emit('close')"
        >
          &times;
        </button>
      </header>

      <!-- Main Body -->
      <div class="pipeline-modal-body">
        <!-- Error Banner -->
        <div
          v-if="error"
          class="pipeline-alert pipeline-alert-error"
          role="alert"
        >
          {{ error }}
        </div>

        <!-- Outdated Banner -->
        <div
          v-if="currentRun && currentRun.freshness === 'outdated'"
          class="pipeline-alert pipeline-alert-warning"
          role="status"
        >
          {{ t("app.pipeline.status.outdated") }}
        </div>

        <!-- Top Section: Recipe Picker & Preflight -->
        <section class="pipeline-section pipeline-preflight-card">
          <h3 class="pipeline-section-title">
            {{ t("app.pipeline.preflightTitle") }}
          </h3>
          <div class="pipeline-preflight-grid">
            <!-- Recipe Selection -->
            <div class="pipeline-field">
              <label for="recipe-select" class="pipeline-label">
                {{ t("app.pipeline.recipeSelectLabel") }}
              </label>
              <select
                id="recipe-select"
                v-model="selectedRecipeId"
                class="pipeline-select"
                :disabled="currentRun?.status === 'running' || actionLoading"
              >
                <option v-for="r in recipes" :key="r.id" :value="r.id">
                  {{ r.name }} (v{{ r.version }})
                </option>
              </select>
            </div>

            <!-- Narration Strategy -->
            <div class="pipeline-field">
              <label for="narration-select" class="pipeline-label">
                {{ t("app.pipeline.narrationOptionLabel") }}
              </label>
              <select
                id="narration-select"
                v-model="narrationStrategy"
                class="pipeline-select"
                :disabled="currentRun?.status === 'running' || actionLoading"
              >
                <option value="none">
                  {{ t("app.pipeline.narrationNone") }}
                </option>
                <option value="voice-import">
                  {{ t("app.pipeline.narrationVoiceImport") }}
                </option>
                <option value="configured-tts">
                  {{ t("app.pipeline.narrationConfiguredTts") }}
                </option>
              </select>
            </div>

            <!-- Voice Asset Selection (when voice-import selected) -->
            <div
              v-if="narrationStrategy === 'voice-import'"
              class="pipeline-field"
            >
              <label for="voice-asset-select" class="pipeline-label">
                Select Audio Recording
              </label>
              <select
                id="voice-asset-select"
                v-model="selectedVoiceAssetId"
                class="pipeline-select"
              >
                <option value="" disabled>Choose recording...</option>
                <option v-for="a in audioAssets" :key="a.id" :value="a.id">
                  {{ a.name }} ({{ a.duration ?? 0 }}s)
                </option>
              </select>
            </div>
          </div>

          <!-- Preflight Badges -->
          <div class="pipeline-badges-row">
            <span class="pipeline-badge pipeline-badge-neutral">
              {{
                t("app.pipeline.preflightRemoteMotion", {
                  status: "unavailable",
                })
              }}
            </span>
            <span class="pipeline-badge pipeline-badge-neutral">
              {{ t("app.pipeline.preflightPhotoDepth") }}
            </span>
            <span
              v-if="activeStory"
              class="pipeline-badge pipeline-badge-success"
            >
              Story: {{ activeStory.title }}
            </span>
            <span v-else class="pipeline-badge pipeline-badge-warning">
              {{ t("app.pipeline.preflightMissingStory") }}
            </span>
          </div>
        </section>

        <!-- Pipeline Steps Track -->
        <section v-if="currentRecipe" class="pipeline-section">
          <div class="pipeline-steps-track">
            <div
              v-for="(step, idx) in currentRecipe.steps"
              :key="step.id"
              class="pipeline-step-card"
              :class="{
                'step-active':
                  currentRun?.currentStepIndex === idx &&
                  currentRun.status === 'running',
                'step-waiting':
                  currentRun?.stepAttempts[idx]?.status === 'waiting-review',
                'step-succeeded':
                  currentRun?.stepAttempts[idx]?.status === 'succeeded',
                'step-failed':
                  currentRun?.stepAttempts[idx]?.status === 'failed',
                'step-cancelled':
                  currentRun?.stepAttempts[idx]?.status === 'cancelled',
              }"
            >
              <div class="pipeline-step-header">
                <span class="pipeline-step-num">{{ idx + 1 }}</span>
                <div class="pipeline-step-meta">
                  <span class="pipeline-step-name">{{ step.name }}</span>
                  <span class="pipeline-step-type">{{ step.type }}</span>
                </div>
                <span
                  class="pipeline-status-chip"
                  :class="currentRun?.stepAttempts[idx]?.status ?? 'pending'"
                >
                  {{ currentRun?.stepAttempts[idx]?.status ?? "pending" }}
                </span>
              </div>
              <p class="pipeline-step-desc">{{ step.description }}</p>
            </div>
          </div>
        </section>

        <!-- Waiting Review Card -->
        <section
          v-if="waitingReviewStep"
          class="pipeline-section pipeline-review-card"
        >
          <h3 class="pipeline-section-title">
            {{
              t("app.pipeline.review.title", {
                stepName: waitingReviewStep.stepId,
              })
            }}
          </h3>
          <div class="pipeline-review-content">
            <p v-if="waitingReviewStep.stepId === 'step-3'">
              Please confirm narration audio and duration before rough cut
              composition adoption.
            </p>
            <p v-if="waitingReviewStep.stepId === 'step-7'">
              Visual QA completed with issues requiring confirmation before
              final video export.
            </p>

            <div class="pipeline-field">
              <label for="review-notes" class="pipeline-label">
                {{ t("app.pipeline.review.notesPlaceholder") }}
              </label>
              <input
                id="review-notes"
                v-model="reviewNotes"
                type="text"
                class="pipeline-input"
                :placeholder="t('app.pipeline.review.notesPlaceholder')"
              />
            </div>

            <div class="pipeline-review-actions">
              <button
                type="button"
                class="pipeline-btn pipeline-btn-primary"
                :disabled="actionLoading"
                @click="handleReviewDecision('accepted')"
              >
                {{ t("app.pipeline.review.acceptButton") }}
              </button>
              <button
                type="button"
                class="pipeline-btn pipeline-btn-danger"
                :disabled="actionLoading"
                @click="handleReviewDecision('rejected')"
              >
                {{ t("app.pipeline.review.rejectButton") }}
              </button>
            </div>
          </div>
        </section>

        <!-- Artifacts Section -->
        <section
          v-if="currentRun && currentRun.artifacts.length > 0"
          class="pipeline-section pipeline-artifacts-card"
        >
          <h3 class="pipeline-section-title">
            {{ t("app.pipeline.artifacts.title") }}
          </h3>
          <div class="pipeline-artifacts-list">
            <div
              v-for="art in currentRun.artifacts"
              :key="art.id"
              class="pipeline-artifact-item"
            >
              <span class="pipeline-artifact-kind">{{ art.kind }}</span>
              <span class="pipeline-artifact-path">
                {{ art.path ?? art.uri ?? art.id }}
              </span>
            </div>
          </div>
        </section>
      </div>

      <!-- Footer Actions -->
      <footer class="pipeline-modal-footer">
        <div class="pipeline-footer-status">
          <span v-if="currentRun">
            Status: <strong>{{ currentRun.status }}</strong>
          </span>
        </div>
        <div class="pipeline-footer-btns">
          <button
            v-if="currentRun?.status === 'running'"
            type="button"
            class="pipeline-btn pipeline-btn-danger"
            :disabled="actionLoading"
            @click="handleCancelRun"
          >
            {{ t("app.pipeline.cancelRun") }}
          </button>
          <button
            v-else-if="
              currentRun?.status === 'failed' ||
              currentRun?.status === 'cancelled'
            "
            type="button"
            class="pipeline-btn pipeline-btn-warning"
            :disabled="actionLoading"
            @click="handleRetryRun"
          >
            {{ t("app.pipeline.retryRun") }}
          </button>
          <button
            v-else
            type="button"
            class="pipeline-btn pipeline-btn-primary"
            :disabled="actionLoading || !activeStory"
            @click="handleStartProduction"
          >
            {{ t("app.pipeline.startRun") }}
          </button>
          <button
            type="button"
            class="pipeline-btn pipeline-btn-secondary"
            @click="emit('close')"
          >
            {{ t("app.pipeline.closeButton") }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.pipeline-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}

.pipeline-modal-card {
  background: var(--color-bg-panel, #1e1e24);
  color: var(--color-text, #f0f0f5);
  width: 100%;
  max-width: 960px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.pipeline-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border, #33333d);
}

.pipeline-modal-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.pipeline-modal-subtitle {
  margin: 4px 0 0 0;
  font-size: 0.85rem;
  color: var(--color-text-muted, #9999a8);
}

.pipeline-close-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted, #9999a8);
  font-size: 1.5rem;
  cursor: pointer;
}

.pipeline-close-btn:hover {
  color: var(--color-text, #fff);
}

.pipeline-modal-body {
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pipeline-alert {
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 0.85rem;
}

.pipeline-alert-error {
  background: rgba(220, 38, 38, 0.15);
  border: 1px solid #dc2626;
  color: #fca5a5;
}

.pipeline-alert-warning {
  background: rgba(217, 119, 6, 0.15);
  border: 1px solid #d97706;
  color: #fcd34d;
}

.pipeline-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pipeline-section-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted, #9999a8);
}

.pipeline-preflight-card {
  background: var(--color-bg-secondary, #282832);
  padding: 16px;
  border-radius: 6px;
  border: 1px solid var(--color-border, #33333d);
}

.pipeline-preflight-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.pipeline-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pipeline-label {
  font-size: 0.8rem;
  color: var(--color-text-muted, #9999a8);
}

.pipeline-select,
.pipeline-input {
  background: var(--color-bg-input, #1e1e24);
  color: var(--color-text, #f0f0f5);
  border: 1px solid var(--color-border, #3e3e4a);
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 0.85rem;
}

.pipeline-badges-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.pipeline-badge {
  font-size: 0.75rem;
  padding: 3px 8px;
  border-radius: 4px;
}

.pipeline-badge-neutral {
  background: #33333d;
  color: #ccc;
}

.pipeline-badge-success {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.pipeline-badge-warning {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}

.pipeline-steps-track {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}

.pipeline-step-card {
  background: var(--color-bg-secondary, #282832);
  border: 1px solid var(--color-border, #33333d);
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pipeline-step-card.step-active {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.08);
}

.pipeline-step-card.step-waiting {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.08);
}

.pipeline-step-card.step-succeeded {
  border-color: #10b981;
}

.pipeline-step-card.step-failed {
  border-color: #ef4444;
}

.pipeline-step-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pipeline-step-num {
  font-size: 0.75rem;
  font-weight: 700;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #3e3e4a;
}

.pipeline-step-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.pipeline-step-name {
  font-size: 0.8rem;
  font-weight: 600;
}

.pipeline-step-type {
  font-size: 0.7rem;
  color: var(--color-text-muted, #9999a8);
}

.pipeline-status-chip {
  font-size: 0.65rem;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.pipeline-status-chip.pending {
  background: #33333d;
  color: #888;
}

.pipeline-status-chip.running {
  background: #2563eb;
  color: #fff;
}

.pipeline-status-chip.waiting-review {
  background: #d97706;
  color: #fff;
}

.pipeline-status-chip.succeeded {
  background: #059669;
  color: #fff;
}

.pipeline-status-chip.failed {
  background: #dc2626;
  color: #fff;
}

.pipeline-status-chip.cancelled {
  background: #4b5563;
  color: #bbb;
}

.pipeline-step-desc {
  margin: 0;
  font-size: 0.75rem;
  color: var(--color-text-muted, #9999a8);
  line-height: 1.3;
}

.pipeline-review-card {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid #f59e0b;
  border-radius: 6px;
  padding: 16px;
}

.pipeline-review-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pipeline-review-actions {
  display: flex;
  gap: 10px;
}

.pipeline-artifacts-card {
  background: var(--color-bg-secondary, #282832);
  border: 1px solid var(--color-border, #33333d);
  border-radius: 6px;
  padding: 16px;
}

.pipeline-artifacts-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pipeline-artifact-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--color-bg-panel, #1e1e24);
  border-radius: 4px;
  font-size: 0.8rem;
}

.pipeline-artifact-kind {
  font-weight: 600;
  color: #60a5fa;
}

.pipeline-artifact-path {
  color: var(--color-text-muted, #9999a8);
  font-family: monospace;
}

.pipeline-modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border, #33333d);
  background: var(--color-bg-panel, #1e1e24);
}

.pipeline-footer-status {
  font-size: 0.85rem;
  color: var(--color-text-muted, #9999a8);
}

.pipeline-footer-btns {
  display: flex;
  gap: 10px;
}

.pipeline-btn {
  padding: 8px 16px;
  border-radius: 4px;
  border: none;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.pipeline-btn:hover {
  opacity: 0.9;
}

.pipeline-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pipeline-btn-primary {
  background: #2563eb;
  color: #fff;
}

.pipeline-btn-secondary {
  background: #374151;
  color: #f3f4f6;
}

.pipeline-btn-warning {
  background: #d97706;
  color: #fff;
}

.pipeline-btn-danger {
  background: #dc2626;
  color: #fff;
}

@media (max-width: 1024px) {
  .pipeline-modal-card {
    max-width: 95vw;
    max-height: 94vh;
  }
  .pipeline-steps-track {
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }
}

@media (max-width: 768px) {
  .pipeline-preflight-grid {
    grid-template-columns: 1fr;
  }
  .pipeline-modal-footer {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }
  .pipeline-footer-btns {
    justify-content: flex-end;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pipeline-modal-card,
  .pipeline-btn,
  .pipeline-step-card {
    transition: none !important;
    animation: none !important;
  }
}
</style>
