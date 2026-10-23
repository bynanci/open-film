<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  Composition,
  Story,
  StoryPlan,
  StoryPlanAcceptanceMapping,
  StoryPlanOptions,
} from "@openfilm/core";
import { api, thumbnailUrl } from "../api";
import Icon from "./Icon.vue";

const props = defineProps<{
  storyId: string;
  story: Story;
  show: boolean;
}>();

const emit = defineEmits<{
  close: [];
  adopted: [
    result: {
      story: Story;
      composition: Composition;
      acceptanceMapping: StoryPlanAcceptanceMapping;
    },
  ];
}>();

const { t } = useI18n();

const loading = ref(false);
const adopting = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const plan = ref<StoryPlan | null>(null);
const compositionPreview = ref<Composition | null>(null);
const selectedSceneId = ref<string | null>(null);

const canAdopt = computed(() => {
  if (!plan.value) return false;
  if (adopting.value || loading.value) return false;
  if (plan.value.path.isAmbiguous) return false;
  if (
    plan.value.path.cycleDetected &&
    plan.value.path.cycleDetected.length > 0
  ) {
    return false;
  }
  return true;
});

async function loadPreview() {
  if (!props.storyId) return;
  loading.value = true;
  error.value = null;
  successMessage.value = null;

  try {
    const opts: StoryPlanOptions = {
      title: `${props.story.title} Storyboard Cut`,
      targetDuration: props.story.targetDuration ?? 30,
      maxDuration: props.story.maxDuration ?? 30,
    };
    const res = await api.storyPlanPreview(props.storyId, opts);
    plan.value = res.plan;
    compositionPreview.value = res.compositionPreview;
    if (res.plan.scenes.length > 0) {
      selectedSceneId.value = res.plan.scenes[0]!.sceneId;
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function handleAdopt() {
  if (!plan.value || !canAdopt.value) return;
  adopting.value = true;
  error.value = null;

  try {
    const res = await api.storyPlanAccept(props.storyId, plan.value);
    successMessage.value = t("app.storyPlan.adoptSuccess", {
      title: res.story.title,
    });
    emit("adopted", res);
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    adopting.value = false;
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close");
  }
}

watch(
  () => props.show,
  (val) => {
    if (val) {
      loadPreview();
    } else {
      plan.value = null;
      error.value = null;
      successMessage.value = null;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div
    v-if="show"
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="t('app.storyPlan.title')"
    @keydown="handleKeydown"
    @click.self="emit('close')"
  >
    <div class="modal-dialog">
      <!-- Modal Header -->
      <header class="modal-header">
        <div class="header-titles">
          <h2>{{ t("app.storyPlan.title") }}</h2>
          <p class="subtitle">{{ t("app.storyPlan.subtitle") }}</p>
        </div>
        <button
          class="icon-btn close-btn"
          :title="t('app.storyPlan.closeButton')"
          @click="emit('close')"
        >
          <Icon name="close" :size="16" />
        </button>
      </header>

      <!-- Loading State -->
      <div v-if="loading" class="state-container loading-state">
        <div class="spinner" aria-hidden="true"></div>
        <p>{{ t("app.storyPlan.previewing") }}</p>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="state-container error-state">
        <div class="alert alert-danger" role="alert">
          <p class="alert-title">{{ t("app.storyPlan.adoptError") }}</p>
          <p>{{ error }}</p>
        </div>
        <button class="secondary-btn" @click="loadPreview">
          <Icon name="refresh" :size="14" />
          {{ t("app.storyPlan.retry") }}
        </button>
      </div>

      <!-- Success State -->
      <div v-else-if="successMessage" class="state-container success-state">
        <div class="alert alert-success" role="status">
          <Icon name="check" :size="20" />
          <p>{{ successMessage }}</p>
        </div>
        <button class="primary-btn" @click="emit('close')">
          {{ t("app.storyPlan.closeButton") }}
        </button>
      </div>

      <!-- Ready Review State -->
      <div v-else-if="plan" class="modal-body">
        <!-- Status & Diagnostic Warnings -->
        <div
          v-if="plan.path.cycleDetected && plan.path.cycleDetected.length > 0"
          class="alert alert-danger"
          role="alert"
        >
          <strong>{{ t("app.storyPlan.status.cyclic") }}</strong>
          <p>{{ plan.conflicts.join("; ") }}</p>
        </div>

        <div
          v-else-if="plan.path.isAmbiguous"
          class="alert alert-warning"
          role="alert"
        >
          <strong>{{ t("app.storyPlan.status.ambiguous") }}</strong>
          <p>{{ plan.conflicts.join("; ") }}</p>
        </div>

        <div
          v-if="plan.unsupportedIntents.length > 0"
          class="alert alert-info"
          role="note"
        >
          <strong>{{ t("app.storyPlan.unsupportedNotice") }}</strong>
          <ul>
            <li v-for="(intent, i) in plan.unsupportedIntents" :key="i">
              {{ intent }}
            </li>
          </ul>
        </div>

        <!-- Storyboard Scene Cards Grid -->
        <div
          class="cards-scroller"
          role="region"
          aria-label="Storyboard Scenes"
        >
          <div
            v-for="(scene, idx) in plan.scenes"
            :key="scene.sceneId"
            class="storyboard-card"
            :class="{ selected: selectedSceneId === scene.sceneId }"
            tabindex="0"
            @click="selectedSceneId = scene.sceneId"
            @keydown.enter="selectedSceneId = scene.sceneId"
          >
            <!-- Card Header: Scene Number, Title & Source Nature -->
            <div class="card-header">
              <div class="scene-title-group">
                <span class="scene-idx">
                  {{ t("app.storyPlan.card.scene", { number: idx + 1 }) }}
                </span>
                <span class="scene-title">{{ scene.title }}</span>
              </div>
              <span
                class="source-badge"
                :class="`source-${scene.sourceNature}`"
                :title="t('app.storyPlan.card.sourceNature')"
              >
                {{ t(`app.storyGraph.ideaSources.${scene.sourceNature}`) }}
              </span>
            </div>

            <!-- 1. Which Image: Asset Thumbnail & Roles -->
            <div class="card-section which-image-section">
              <div class="section-label">
                <Icon name="image" :size="12" />
                {{ t("app.storyPlan.card.whichImage") }}
              </div>
              <div v-if="scene.assets.length > 0" class="asset-chips-container">
                <div
                  v-for="ast in scene.assets"
                  :key="ast.assetId"
                  class="asset-chip"
                >
                  <img
                    :src="thumbnailUrl(ast.assetId)"
                    :alt="ast.name"
                    class="asset-thumb"
                    loading="lazy"
                  />
                  <div class="asset-info">
                    <span class="asset-name">{{ ast.name }}</span>
                    <span
                      v-if="ast.isEcho"
                      class="role-badge role-echo"
                      :title="t('app.storyPlan.card.echoRole')"
                    >
                      {{ t("app.storyPlan.card.echoRole") }}
                    </span>
                    <span v-else class="role-badge role-standard">
                      {{ t(`app.storyPlan.card.${ast.role}Role`) }}
                    </span>
                  </div>
                </div>
              </div>
              <div v-else class="empty-asset-notice">
                {{ t("app.storyPlan.card.noAssets") }}
              </div>

              <!-- PhotoDepth Fallback indicator without fake depth mask -->
              <div
                v-if="scene.assets[0]?.photoDepthFallback"
                class="depth-fallback-pill"
              >
                {{
                  t("app.storyPlan.card.photoDepthFallback", {
                    mode: scene.assets[0].photoDepthFallback,
                  })
                }}
              </div>
            </div>

            <!-- 2. What is expressed: Intent -->
            <div class="card-section">
              <div class="section-label">
                {{ t("app.storyPlan.card.whatExpressed") }}
              </div>
              <p class="section-content intent-text">{{ scene.intent }}</p>
            </div>

            <!-- 3. How to present: Visual Direction -->
            <div class="card-section">
              <div class="section-label">
                {{ t("app.storyPlan.card.howPresented") }}
              </div>
              <p class="section-content visual-text">
                {{ scene.visualDirection }}
              </p>
            </div>

            <!-- 4. Duration: Target & Estimated Narration -->
            <div class="card-section">
              <div class="section-label">
                {{ t("app.storyPlan.card.howLong") }}
              </div>
              <div class="duration-section">
                <div class="duration-badge">
                  {{
                    t("app.storyPlan.card.targetDuration", {
                      seconds: scene.targetDuration.toFixed(1),
                    })
                  }}
                </div>
                <div class="duration-badge estimated">
                  {{
                    t("app.storyPlan.card.estimatedNarration", {
                      seconds: scene.estimatedDuration.toFixed(1),
                    })
                  }}
                </div>
              </div>
            </div>

            <!-- 5. Why: Narrative Rationale -->
            <div class="card-section rationale-section">
              <div class="section-label">
                {{ t("app.storyPlan.card.whyRationale") }}
              </div>
              <p class="section-content rationale-text">
                {{ scene.rationale }}
              </p>
            </div>

            <!-- Actionable Gaps -->
            <div v-if="scene.gaps?.missingAssets" class="gaps-box">
              <Icon name="reject" :size="12" />
              <span>
                {{
                  t("app.storyPlan.card.missingAssets", {
                    assets: scene.gaps.missingAssets.join(", "),
                  })
                }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal Footer -->
      <footer class="modal-footer">
        <button class="secondary-btn" @click="emit('close')">
          {{ t("app.storyPlan.closeButton") }}
        </button>
        <button
          v-if="plan && !successMessage"
          class="primary-btn adopt-btn"
          :disabled="!canAdopt"
          @click="handleAdopt"
        >
          <span v-if="adopting" class="spinner-small" aria-hidden="true"></span>
          <span>{{ t("app.storyPlan.adoptButton") }}</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.modal-dialog {
  background: var(--surface-1, #1e1e24);
  color: var(--text-1, #f0f0f4);
  border-radius: 12px;
  border: 1px solid var(--border-1, #2e2e38);
  width: 100%;
  max-width: 1100px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-1, #2e2e38);
  background: var(--surface-2, #26262e);
}

.header-titles h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--text-2, #a0a0b0);
}

.modal-body {
  padding: 1.25rem 1.5rem;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.cards-scroller {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 1rem;
}

.storyboard-card {
  background: var(--surface-2, #26262e);
  border: 1px solid var(--border-1, #363644);
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition:
    border-color 0.15s ease,
    transform 0.15s ease;
  cursor: pointer;
}

.storyboard-card:hover,
.storyboard-card:focus {
  border-color: var(--accent-1, #5c7cfa);
  outline: none;
}

.storyboard-card.selected {
  border-color: var(--accent-1, #5c7cfa);
  box-shadow: 0 0 0 2px rgba(92, 124, 250, 0.25);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-2, #363644);
  padding-bottom: 0.5rem;
}

.scene-title-group {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  overflow: hidden;
}

.scene-idx {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--accent-1, #5c7cfa);
}

.scene-title {
  font-size: 0.95rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-badge {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.source-user-memory {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.source-planned {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.source-wish {
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
}

.source-unknown {
  background: rgba(156, 163, 175, 0.15);
  color: #9ca3af;
}

.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-2, #a0a0b0);
  margin-bottom: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.section-content {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.4;
}

.which-image-section {
  background: var(--surface-3, #1e1e24);
  border-radius: 6px;
  padding: 0.5rem;
}

.asset-chips-container {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.asset-chip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.asset-thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 4px;
  background: #000;
}

.asset-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  overflow: hidden;
}

.asset-name {
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.role-badge {
  font-size: 0.65rem;
  padding: 1px 6px;
  border-radius: 4px;
  width: fit-content;
}

.role-echo {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  font-weight: 600;
}

.role-standard {
  background: var(--surface-2, #26262e);
  color: var(--text-2, #a0a0b0);
}

.depth-fallback-pill {
  font-size: 0.7rem;
  color: var(--text-2, #a0a0b0);
  margin-top: 0.35rem;
  font-style: italic;
}

.duration-section {
  display: flex;
  gap: 0.5rem;
}

.duration-badge {
  background: var(--surface-3, #1e1e24);
  border: 1px solid var(--border-2, #363644);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.75rem;
  color: var(--text-1, #f0f0f4);
}

.duration-badge.estimated {
  color: var(--accent-1, #5c7cfa);
}

.rationale-section {
  background: rgba(92, 124, 250, 0.05);
  border-left: 2px solid var(--accent-1, #5c7cfa);
  padding: 0.4rem 0.6rem;
  border-radius: 0 4px 4px 0;
}

.rationale-text {
  font-size: 0.8rem;
  color: var(--text-2, #c0c0d0);
  font-style: italic;
}

.gaps-box {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #f87171;
  font-size: 0.75rem;
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.alert {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
}

.alert-danger {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.alert-warning {
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #fcd34d;
}

.alert-info {
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: #93c5fd;
}

.alert-success {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #86efac;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.state-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  gap: 1rem;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent-1, #5c7cfa);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner-small {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-1, #2e2e38);
  background: var(--surface-2, #26262e);
}

.secondary-btn,
.primary-btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: none;
}

.secondary-btn {
  background: var(--surface-3, #363644);
  color: var(--text-1, #f0f0f4);
}

.secondary-btn:hover {
  background: var(--surface-4, #424254);
}

.primary-btn {
  background: var(--accent-1, #5c7cfa);
  color: #ffffff;
}

.primary-btn:hover:not(:disabled) {
  background: #4c6ef5;
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-btn {
  background: transparent;
  border: none;
  color: var(--text-2, #a0a0b0);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.icon-btn:hover {
  color: var(--text-1, #f0f0f4);
}

@media (prefers-reduced-motion: reduce) {
  .spinner,
  .spinner-small {
    animation: none;
  }
  .storyboard-card {
    transition: none;
  }
}
</style>
