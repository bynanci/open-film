<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PrimaryColorReviewReport } from "@openfilm/application";
import type { TimelineCommand } from "@openfilm/solver";
import { api, primaryColorReviewMediaUrl } from "../api";
const props = defineProps<{
  projectId: string;
  compositionId: string;
  revision: string;
  clipId: string;
  references: { id: string; name: string }[];
  disabled: boolean;
  applyDisabled?: boolean;
}>();
const emit = defineEmits<{ apply: [command: TimelineCommand] }>(),
  { t } = useI18n();
const referenceId = ref(props.references[0]?.id ?? ""),
  report = ref<PrimaryColorReviewReport>(),
  busy = ref(false),
  failed = ref(false),
  reviewed = ref(false),
  applied = ref(false),
  sampleIndex = ref(0),
  loaded = ref(new Set<string>());
let generation = 0,
  controller: AbortController | undefined;
const measureButton = ref<HTMLButtonElement>();
function cancel() {
  if (applied.value) return;
  reset();
  void nextTick(() => measureButton.value?.focus());
}
const variants = ["reference", "before", "after"] as const;
function discard(id: string, projectId = props.projectId) {
  void api.discardPrimaryColorReview(id, projectId).catch(() => undefined);
}
function reset() {
  generation++;
  controller?.abort();
  // An explicit Apply may still be queued in the shared autosave owner. Retain
  // its evidence through navigation until acknowledgement or bounded expiry.
  if (
    report.value &&
    (!applied.value || props.revision !== report.value.baseRevision)
  )
    discard(report.value.id, report.value.projectId);
  report.value = undefined;
  busy.value = false;
  failed.value = false;
  reviewed.value = false;
  applied.value = false;
  sampleIndex.value = 0;
  loaded.value = new Set();
}
watch(
  [
    () => props.projectId,
    () => props.compositionId,
    () => props.revision,
    () => props.clipId,
    () => referenceId.value,
  ],
  reset,
);
watch(
  () => props.references,
  () => {
    if (!props.references.some((r) => r.id === referenceId.value))
      referenceId.value = props.references[0]?.id ?? "";
  },
);
watch(sampleIndex, () => {
  loaded.value = new Set();
  reviewed.value = false;
});
watch(
  () => props.disabled,
  (disabled) => {
    if (!disabled) applied.value = false;
  },
);
onBeforeUnmount(reset);
async function run() {
  reset();
  if (!referenceId.value || props.disabled) return;
  const token = generation;
  controller = new AbortController();
  busy.value = true;
  try {
    const result = await api.primaryColorReview(
      props.compositionId,
      {
        projectId: props.projectId,
        baseRevision: props.revision,
        targetClipId: props.clipId,
        referenceClipId: referenceId.value,
      },
      controller.signal,
    );
    if (token === generation) report.value = result;
    else discard(result.id, result.projectId);
  } catch {
    if (token === generation) failed.value = true;
  } finally {
    if (token === generation) busy.value = false;
  }
}
const sampleCount = computed(
  () => report.value?.samples.filter((s) => s.variant === "before").length ?? 0,
);
function sample(variant: (typeof variants)[number]) {
  return (
    report.value?.samples.find(
      (s) => s.variant === variant && s.index === sampleIndex.value,
    ) ?? report.value?.samples.find((s) => s.variant === variant)
  );
}
function media(variant: (typeof variants)[number]) {
  const item = sample(variant);
  return report.value && item
    ? primaryColorReviewMediaUrl(
        report.value.id,
        variant,
        item.index,
        props.projectId,
      )
    : "";
}
function ready(variant: string) {
  loaded.value = new Set([...loaded.value, variant]);
}
const canApply = computed(
  () =>
    !!report.value?.canApply &&
    !!report.value.suggestedCorrection &&
    !props.disabled &&
    !props.applyDisabled &&
    !busy.value &&
    !applied.value &&
    reviewed.value &&
    variants.every((v) => loaded.value.has(v)),
);
function accept() {
  if (!canApply.value || !report.value?.suggestedCorrection) return;
  applied.value = true;
  emit("apply", {
    type: "primary-color",
    scope: "clip",
    clipId: props.clipId,
    correction: report.value.suggestedCorrection,
    primaryColorReviewId: report.value.id,
  });
}
</script>
<template>
  <section
    class="primary-review"
    :aria-label="t('primaryColor.review')"
    @keydown.esc.stop.prevent="cancel"
  >
    <p>{{ t("primaryColor.statistical") }}</p>
    <label class="editor-field"
      >{{ t("primaryColor.reference")
      }}<select v-model="referenceId" :disabled="busy || disabled">
        <option v-for="entry in references" :key="entry.id" :value="entry.id">
          {{ entry.name }}
        </option>
      </select></label
    >
    <div class="primary-actions">
      <button
        ref="measureButton"
        class="editor-button"
        data-testid="primary-measure"
        :disabled="busy || disabled || !referenceId"
        @click="run"
      >
        {{ t("primaryColor.measure") }}</button
      ><button
        v-if="busy || report"
        class="editor-button"
        :disabled="applied"
        @click="cancel"
      >
        {{ t("primaryColor.discard") }}
      </button>
    </div>
    <p v-if="busy" role="status">{{ t("primaryColor.measuring") }}</p>
    <p v-if="failed" role="alert">{{ t("primaryColor.failed") }}</p>
    <template v-if="report">
      <label v-if="sampleCount > 1" class="editor-field"
        >{{ t("primaryColor.sample")
        }}<select v-model.number="sampleIndex">
          <option v-for="i in sampleCount" :key="i" :value="i - 1">
            {{ i }}
          </option>
        </select></label
      >
      <div class="primary-review-images">
        <figure v-for="variant in variants" :key="variant">
          <figcaption>{{ t(`primaryColor.variants.${variant}`) }}</figcaption>
          <img
            v-if="media(variant)"
            :key="`${report.id}-${variant}-${sampleIndex}`"
            :src="media(variant)"
            :alt="t(`primaryColor.variants.${variant}`)"
            @load="ready(variant)"
            @error="
              failed = true;
              reviewed = false;
            "
          />
        </figure>
      </div>
      <dl class="primary-statistics">
        <dt>{{ t("primaryColor.median") }}</dt>
        <dd>
          {{ report.before.p50Y }} → {{ report.after?.p50Y ?? "—" }} ({{
            t("primaryColor.reference")
          }}: {{ report.reference.p50Y }})
        </dd>
        <dt>{{ t("primaryColor.clipping") }}</dt>
        <dd>
          {{ (100 * report.before.clippedFraction).toFixed(1) }}% →
          {{
            report.after
              ? (100 * report.after.clippedFraction).toFixed(1) + "%"
              : "—"
          }}
        </dd>
      </dl>
      <p>
        {{
          t("primaryColor.current", {
            temperature: report.currentCorrection.temperature,
            exposure: report.currentCorrection.exposureEv,
            contrast: report.currentCorrection.contrast,
          })
        }}
      </p>
      <p v-if="report.suggestedCorrection">
        {{
          t("primaryColor.proposed", {
            temperature: report.suggestedCorrection.temperature,
            exposure: report.suggestedCorrection.exposureEv,
            contrast: report.suggestedCorrection.contrast,
          })
        }}
      </p>
      <p v-for="warning in report.warnings" :key="warning" role="status">
        {{ t(`primaryColor.warnings.${warning}`) }}
      </p>
      <label class="primary-checkbox"
        ><input
          v-model="reviewed"
          type="checkbox"
          :disabled="
            !report.canApply || failed || !variants.every((v) => loaded.has(v))
          "
        />{{ t("primaryColor.reviewed") }}</label
      ><button
        class="editor-button"
        data-testid="primary-match-apply"
        :disabled="!canApply || failed"
        @click="accept"
      >
        {{ t("primaryColor.applyClip") }}
      </button>
    </template>
  </section>
</template>
<style scoped>
.primary-review {
  display: grid;
  gap: var(--of-space-3);
  min-width: 0;
}
p,
figure,
dl,
dd {
  margin: 0;
  font-size: var(--of-font-caption);
  overflow-wrap: anywhere;
}
p,
dt,
figcaption {
  color: var(--of-text-secondary);
}
.primary-review-images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
  gap: var(--of-space-2);
  min-width: 0;
}
figure {
  min-width: 0;
}
img {
  display: block;
  width: 100%;
  height: auto;
}
.primary-statistics {
  display: grid;
  gap: var(--of-space-1);
}
.primary-actions {
  display: flex;
  gap: var(--of-space-2);
  flex-wrap: wrap;
}
.primary-checkbox {
  display: flex;
  align-items: flex-start;
  gap: var(--of-space-2);
  font-size: var(--of-font-caption);
}
button {
  max-width: 100%;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
