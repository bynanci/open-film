<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.

import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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
} from "@openfilm/application";
import { api } from "../api";
import Icon from "./Icon.vue";

const props = defineProps<{
  show?: boolean;
  open?: boolean;
  activeStory?: Story;
  project?: OpenFilmProject;
  activeCompositionId?: string;
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
}>();

const { t } = useI18n();

const isVisible = computed(() => props.show ?? props.open ?? false);

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
const activeAudioChannel = ref<"A" | "B" | "none">("none");
const selectedBeatIndex = ref<number>(0);

const isCreateValid = computed(() => {
  if (!formName.value.trim() || !formIntent.value.trim()) return false;
  if (formScopeType.value === "section" && !formTargetBeatId.value)
    return false;
  return true;
});

async function loadVariants() {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.creativeVariantsList();
    variants.value = res.variants;
    if (res.variants.length > 0) {
      if (!selectedVariantAId.value)
        selectedVariantAId.value = res.variants[0]?.id ?? "";
      if (!selectedVariantBId.value && res.variants.length > 1) {
        selectedVariantBId.value = res.variants[1]?.id ?? "";
      }
    }
  } catch (err: unknown) {
    error.value =
      (err as Error)?.message ?? "Failed to load creative variants.";
  } finally {
    loading.value = false;
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
  if (!selectedVariantAId.value || !selectedVariantBId.value) return;
  actionLoading.value = true;
  error.value = null;
  try {
    const res = await api.creativeVariantsCompare(
      selectedVariantAId.value,
      selectedVariantBId.value,
    );
    comparison.value = res.comparison;
    currentView.value = "compare";
  } catch (err: unknown) {
    error.value = (err as Error)?.message ?? "Failed to compare variants.";
  } finally {
    actionLoading.value = false;
  }
}

async function handleAdopt(variantId: string) {
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

function selectAudio(channel: "A" | "B") {
  if (activeAudioChannel.value === channel) {
    activeAudioChannel.value = "none";
  } else {
    activeAudioChannel.value = channel;
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!props.show) return;
  const target = e.target as HTMLElement | null;
  const inForm =
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable);
  if (inForm) return;

  if (e.key === "Escape") {
    emit("close");
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
    }
  },
);

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div
    v-if="isVisible"
    class="variants-modal-backdrop"
    role="dialog"
    aria-modal="true"
    data-testid="creative-variant-modal"
  >
    <div class="variants-modal-container">
      <!-- Header -->
      <header class="variants-modal-header">
        <div class="header-title-row">
          <Icon name="compare" class="header-icon" />
          <h2 class="header-title">{{ t("app.variants.modalTitle") }}</h2>
          <div class="header-tabs">
            <button
              class="tab-btn"
              :class="{ active: currentView === 'list' }"
              @click="currentView = 'list'"
            >
              {{ t("app.variants.tabs.list") }}
            </button>
            <button
              class="tab-btn"
              :class="{ active: currentView === 'create' }"
              @click="currentView = 'create'"
            >
              {{ t("app.variants.tabs.create") }}
            </button>
            <button
              v-if="comparison || variants.length > 1"
              class="tab-btn"
              :class="{ active: currentView === 'compare' }"
              @click="currentView = 'compare'"
            >
              {{ t("app.variants.tabs.compare") }}
            </button>
          </div>
        </div>
        <button
          class="close-btn"
          :aria-label="t('app.variants.actions.close')"
          @click="emit('close')"
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
            <button class="primary-btn" @click="currentView = 'create'">
              {{ t("app.variants.actions.newVariant") }}
            </button>
          </div>

          <div v-if="variants.length === 0 && !loading" class="empty-state">
            <p>{{ t("app.variants.emptyNotice") }}</p>
            <button class="cta-btn" @click="currentView = 'create'">
              {{ t("app.variants.actions.createFirst") }}
            </button>
          </div>

          <div v-else class="variants-grid">
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
                <label>{{ t("app.variants.fields.name") }} *</label>
                <input
                  v-model="formName"
                  type="text"
                  :placeholder="t('app.variants.placeholders.name')"
                  @input="handlePreviewImpact"
                />
              </div>

              <div class="form-field">
                <label>{{ t("app.variants.fields.intent") }} *</label>
                <textarea
                  v-model="formIntent"
                  rows="3"
                  :placeholder="t('app.variants.placeholders.intent')"
                  @input="handlePreviewImpact"
                />
              </div>

              <div class="form-field">
                <label>{{ t("app.variants.fields.scope") }}</label>
                <div class="radio-group">
                  <label>
                    <input
                      v-model="formScopeType"
                      type="radio"
                      value="section"
                      @change="handlePreviewImpact"
                    />
                    {{ t("app.variants.scope.sectionOnly") }}
                  </label>
                  <label>
                    <input
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
                <label>{{ t("app.variants.fields.targetBeat") }} *</label>
                <select
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
                <label>{{ t("app.variants.fields.targetDuration") }}</label>
                <input
                  v-model.number="formTargetDuration"
                  type="number"
                  min="1"
                  step="0.5"
                  :placeholder="t('app.variants.placeholders.duration')"
                  @input="handlePreviewImpact"
                />
              </div>

              <div class="form-field">
                <label>{{ t("app.variants.fields.narration") }}</label>
                <textarea
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
                <button class="secondary-btn" @click="currentView = 'list'">
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
              <select v-model="selectedVariantAId" @change="handleCompare">
                <option v-for="v in variants" :key="v.id" :value="v.id">
                  {{ v.name }}
                </option>
              </select>
            </div>
            <span class="vs-badge">VS</span>
            <div class="selector-box">
              <label>{{ t("app.variants.labels.variantB") }}:</label>
              <select v-model="selectedVariantBId" @change="handleCompare">
                <option v-for="v in variants" :key="v.id" :value="v.id">
                  {{ v.name }}
                </option>
              </select>
            </div>
            <button class="primary-btn" @click="handleCompare">
              {{ t("app.variants.actions.refreshDiff") }}
            </button>
          </div>

          <div v-if="comparison" class="compare-content">
            <!-- A/B Video Player & Audio Safety -->
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
                  <div class="video-mock-frame">
                    <span class="video-placeholder-icon">▶</span>
                    <span class="video-watermark">Variant A Video</span>
                  </div>
                </div>
                <div class="player-controls">
                  <button
                    class="audio-toggle-btn"
                    :class="{ active: activeAudioChannel === 'A' }"
                    @click="selectAudio('A')"
                  >
                    🔊
                    {{
                      activeAudioChannel === "A"
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
                  <div class="video-mock-frame variant-b">
                    <span class="video-placeholder-icon">▶</span>
                    <span class="video-watermark">Variant B Video</span>
                  </div>
                </div>
                <div class="player-controls">
                  <button
                    class="audio-toggle-btn"
                    :class="{ active: activeAudioChannel === 'B' }"
                    @click="selectAudio('B')"
                  >
                    🔊
                    {{
                      activeAudioChannel === "B"
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
  width: 90vw;
  max-width: 1240px;
  max-height: 90vh;
  background: var(--color-bg-surface, #1e1e24);
  color: var(--color-text, #ffffff);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.variants-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border, #333);
}

.header-title-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-title {
  margin: 0;
  font-size: 1.25rem;
}

.header-tabs {
  display: flex;
  gap: 8px;
  margin-left: 16px;
}

.tab-btn {
  background: transparent;
  border: 1px solid var(--color-border, #444);
  color: var(--color-text-muted, #aaa);
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}

.tab-btn.active {
  background: var(--color-accent, #3b82f6);
  color: #fff;
  border-color: var(--color-accent, #3b82f6);
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 1.25rem;
  color: var(--color-text-muted, #aaa);
  cursor: pointer;
}

.variants-alert {
  padding: 10px 20px;
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
}

.error-alert {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border-bottom: 1px solid rgba(239, 68, 68, 0.3);
}

.success-alert {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border-bottom: 1px solid rgba(16, 185, 129, 0.3);
}

.alert-dismiss {
  background: transparent;
  border: none;
  cursor: pointer;
  color: inherit;
}

.variants-modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

/* List View */
.pane-action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.variants-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.variant-card {
  background: var(--color-bg-card, #26262e);
  border: 1px solid var(--color-border, #3a3a46);
  border-radius: 6px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.variant-card.adopted {
  border-color: #34d399;
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
  border-radius: 12px;
  background: #444;
}

.status-badge.adopted {
  background: #065f46;
  color: #34d399;
}

.status-badge.compared {
  background: #1e3a8a;
  color: #60a5fa;
}

.variant-intent {
  font-size: 0.85rem;
  color: var(--color-text-muted, #bbb);
  margin: 0;
  flex: 1;
}

.variant-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #888;
}

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.card-btn {
  flex: 1;
  padding: 6px;
  font-size: 0.8rem;
  border-radius: 4px;
  border: 1px solid var(--color-border, #444);
  background: #333;
  color: #fff;
  cursor: pointer;
}

.adopt-btn {
  background: #059669;
  border-color: #059669;
}

.delete-btn {
  background: #7f1d1d;
  border-color: #7f1d1d;
}

/* Create Form */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.form-field {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field label {
  font-size: 0.85rem;
  font-weight: 500;
}

.form-field input,
.form-field textarea,
.form-field select {
  background: #111;
  border: 1px solid #444;
  color: #fff;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 0.9rem;
}

.radio-group {
  display: flex;
  gap: 16px;
}

.form-submit-row {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}

.primary-btn {
  background: var(--color-accent, #3b82f6);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-btn {
  background: transparent;
  color: #ccc;
  border: 1px solid #555;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
}

.impact-preview-column {
  background: #16161c;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.impact-subtitle {
  font-size: 0.85rem;
  font-weight: 600;
  color: #aaa;
  display: block;
  margin-bottom: 6px;
}

.changes-list,
.brief-list {
  margin: 0;
  padding-left: 20px;
  font-size: 0.85rem;
  color: #ddd;
}

.preserved-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preserved-chip {
  background: #222;
  border: 1px solid #444;
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 3px;
  color: #34d399;
}

.brief-notice {
  font-size: 0.75rem;
  color: #f59e0b;
  margin: 0 0 6px 0;
}

.locked-warning {
  background: rgba(245, 158, 11, 0.2);
  border: 1px solid #f59e0b;
  color: #fbbf24;
  padding: 8px 12px;
  border-radius: 4px;
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
  background: #16161c;
  padding: 12px 16px;
  border-radius: 6px;
}

.selector-box {
  display: flex;
  align-items: center;
  gap: 8px;
}

.selector-box select {
  background: #111;
  border: 1px solid #444;
  color: #fff;
  padding: 6px 12px;
  border-radius: 4px;
}

.vs-badge {
  font-weight: bold;
  color: #f59e0b;
}

.comparison-players-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.player-card {
  background: #22222a;
  border: 1px solid #3a3a46;
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  background: #333;
  padding: 2px 6px;
  border-radius: 4px;
}

.delta-badge {
  font-size: 0.75rem;
  background: #065f46;
  color: #34d399;
  padding: 2px 6px;
  border-radius: 4px;
}

.delta-badge.shorter {
  background: #1e3a8a;
  color: #60a5fa;
}

.player-view {
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-mock-frame {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #888;
}

.video-placeholder-icon {
  font-size: 2rem;
}

.player-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.audio-toggle-btn {
  background: #333;
  border: 1px solid #555;
  color: #fff;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
}

.audio-toggle-btn.active {
  background: #059669;
  border-color: #059669;
}

.audio-rule-notice {
  font-size: 0.75rem;
  color: #888;
}

/* Section Navigation */
.section-navigation-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  background: #181820;
  padding: 10px 16px;
  border-radius: 6px;
}

.nav-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #aaa;
}

.beats-track {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}

.beat-nav-item {
  background: #262632;
  border: 1px solid #3c3c4a;
  color: #ccc;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.beat-nav-item.active {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}

.beat-nav-item.changed {
  border-color: #f59e0b;
}

.changed-indicator {
  color: #f59e0b;
  font-size: 0.7rem;
}

/* Diff Table */
.diff-summary-card {
  background: #1a1a22;
  border: 1px solid #333;
  border-radius: 6px;
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
  border-bottom: 1px solid #2a2a34;
  text-align: left;
}

.diff-table th {
  color: #aaa;
  font-weight: 500;
}

.diff-script {
  color: #999;
  font-size: 0.75rem;
  font-style: italic;
}

.diff-tag {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 3px;
}

.diff-changed {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}

.diff-identical {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

/* Adopt Decision Banner */
.adopt-decision-banner {
  background: #152238;
  border: 1px solid #1e3a8a;
  border-radius: 6px;
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
  color: #93c5fd;
}

.adopt-action-btn {
  background: #059669;
  font-size: 0.95rem;
  padding: 10px 20px;
}

@media (max-width: 1280px) {
  .variants-modal-container {
    width: 96vw;
    padding: 16px;
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
