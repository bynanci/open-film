<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
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
  presetPreview?: { plan: StoryPlan; compositionPreview: Composition };
  presetAccept?: () => Promise<{
    story: Story;
    composition: Composition;
    acceptanceMapping: StoryPlanAcceptanceMapping;
  }>;
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
const dialog = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
function restoreFocus() {
  if (previousFocus?.isConnected) previousFocus.focus();
}
onBeforeUnmount(restoreFocus);

const loading = ref(false);
const adopting = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const plan = ref<StoryPlan | null>(null);
const compositionPreview = ref<Composition | null>(null);
const selectedSceneId = ref<string | null>(null);

const canAdopt = computed(() => {
  if (!plan.value) return false;
  if (plan.value.presetContext && !props.presetAccept) return false;
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
    const res =
      props.presetPreview ?? (await api.storyPlanPreview(props.storyId, opts));
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
    const res = props.presetAccept
      ? await props.presetAccept()
      : await api.storyPlanAccept(props.storyId, plan.value);
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
    e.preventDefault();
    e.stopPropagation();
    emit("close");
    return;
  }
  if (e.key === "Tab") {
    e.stopPropagation();
    const nodes = Array.from(
      dialog.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      ) ?? [],
    );
    const first = nodes[0],
      last = nodes.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
}

watch(
  () => props.show,
  (val) => {
    if (val) {
      previousFocus =
        typeof document === "undefined"
          ? null
          : (document.activeElement as HTMLElement | null);
      void nextTick(() =>
        dialog.value?.querySelector<HTMLElement>("button")?.focus(),
      );
      loadPreview();
    } else {
      restoreFocus();
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
    ref="dialog"
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
                <Icon name="film" :size="12" />
                {{ t("app.storyPlan.card.media") }}
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
                {{ t("app.storyPlan.card.photoDepthFallback") }}
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
  background: var(--of-surface-1);
  color: var(--of-text-primary);
  border-radius: var(--of-radius-dialog);
  border: 0;
  width: 100%;
  max-width: 1100px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--of-shadow-dialog);
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1.25rem 1.5rem;
  border-bottom: 0;
  background: var(--of-surface-2);
}

.header-titles h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--of-text-secondary);
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
  grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
  gap: 1rem;
}

.storyboard-card {
  background: var(--of-surface-2);
  border: 0;
  border-radius: var(--of-radius-lg);
  padding: 1rem;
  box-shadow: var(--of-shadow-soft);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition:
    background-color var(--of-motion-normal) var(--of-motion-ease),
    box-shadow var(--of-motion-normal) var(--of-motion-ease);
  cursor: pointer;
}

.storyboard-card:hover,
.storyboard-card:focus {
  background: var(--of-surface-3);
  box-shadow: var(--of-shadow-hover);
}

.storyboard-card.selected {
  background: var(--of-accent-soft);
  box-shadow: var(--of-shadow-hover);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 0;
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
  color: var(--of-accent);
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
  border-radius: var(--of-radius-sm);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.source-user-memory {
  background: var(--of-success-soft);
  color: var(--of-success);
}

.source-planned {
  background: var(--of-accent-soft);
  color: var(--of-accent);
}

.source-wish {
  background: var(--of-warning-soft);
  color: var(--of-warning);
}

.source-unknown {
  background: var(--of-surface-3);
  color: var(--of-text-muted);
}

.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--of-text-secondary);
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
  background: var(--of-surface-2);
  border-radius: var(--of-radius-md);
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
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: var(--of-radius-media);
  background: var(--of-player);
}

.asset-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  overflow: hidden;
}

.asset-name {
  font-family: var(--of-font-media);
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.role-badge {
  font-size: 0.65rem;
  padding: 1px 6px;
  border-radius: var(--of-radius-sm);
  width: fit-content;
}

.role-echo {
  background: var(--of-warning-soft);
  color: var(--of-warning);
  font-weight: 600;
}

.role-standard {
  background: var(--of-surface-3);
  color: var(--of-text-secondary);
}

.depth-fallback-pill {
  font-size: 0.7rem;
  color: var(--of-text-secondary);
  margin-top: 0.35rem;
  font-style: italic;
}

.duration-section {
  display: flex;
  gap: 0.5rem;
}

.duration-badge {
  background: var(--of-surface-3);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-sm);
  padding: 2px 8px;
  font-size: 0.75rem;
  color: var(--of-text-primary);
}

.duration-badge.estimated {
  color: var(--of-accent);
}

.rationale-section {
  background: var(--of-accent-soft);
  border-left: 2px solid var(--of-accent);
  padding: 0.4rem 0.6rem;
  border-radius: 0 4px 4px 0;
}

.rationale-text {
  font-size: 0.8rem;
  color: var(--of-text-secondary);
  font-style: italic;
}

.gaps-box {
  background: var(--of-danger-soft);
  border: 1px solid var(--of-danger);
  color: var(--of-danger);
  font-size: 0.75rem;
  padding: 0.4rem 0.6rem;
  border-radius: var(--of-radius-md);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.alert {
  padding: 0.75rem 1rem;
  border-radius: var(--of-radius-md);
  font-size: 0.85rem;
}

.alert-danger {
  background: var(--of-danger-soft);
  border: 1px solid var(--of-danger);
  color: var(--of-danger);
}

.alert-warning {
  background: var(--of-warning-soft);
  border: 1px solid var(--of-warning);
  color: var(--of-warning);
}

.alert-info {
  background: var(--of-accent-soft);
  border: 1px solid var(--of-accent);
  color: var(--of-accent);
}

.alert-success {
  background: var(--of-success-soft);
  border: 1px solid var(--of-success);
  color: var(--of-success);
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
  border: 3px solid var(--of-border-subtle);
  border-top-color: var(--of-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner-small {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
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
  border-top: 1px solid var(--of-border-subtle);
  background: var(--of-surface-2);
}

.secondary-btn,
.primary-btn {
  padding: 0.5rem 1rem;
  border-radius: var(--of-radius-md);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: none;
}

.secondary-btn {
  background: var(--of-surface-3);
  color: var(--of-text-primary);
}

.secondary-btn:hover {
  background: var(--of-surface-1);
}

.primary-btn {
  background: var(--of-accent);
  color: var(--of-accent-ink);
}

.primary-btn:hover:not(:disabled) {
  background: var(--of-accent-hover);
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-btn {
  background: transparent;
  border: none;
  color: var(--of-text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--of-radius-sm);
}

.icon-btn:hover {
  color: var(--of-text-primary);
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
