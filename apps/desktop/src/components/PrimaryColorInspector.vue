<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
import { computed, ref, watch, useId } from "vue";
import { useI18n } from "vue-i18n";
import {
  PRIMARY_COLOR_IDENTITY,
  resolvePrimaryColor,
  validatePrimaryColorCorrection,
  type Clip,
  type Composition,
  type MediaAsset,
  type PrimaryColorCorrection,
} from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import PrimaryColorReviewPanel from "./PrimaryColorReviewPanel.vue";
const props = defineProps<{
  composition: Composition;
  clip: Clip;
  assets: readonly MediaAsset[];
  projectId: string;
  revision: string;
  clipEligible: boolean;
  clipProtected?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ command: [command: TimelineCommand] }>();
const { t } = useI18n();
const scope = ref<"film" | "beat" | "clip">("clip"),
  draft = ref<PrimaryColorCorrection>({ ...PRIMARY_COLOR_IDENTITY }),
  showReview = ref(false),
  prefix = useId();
const effective = computed(() =>
  resolvePrimaryColor(props.composition, props.clip),
);
const blocked = computed(
  () => !!props.disabled || (scope.value === "clip" && !!props.clipProtected),
);
function reset() {
  draft.value = {
    ...((scope.value === "clip"
      ? props.clip.primaryColor
      : scope.value === "beat"
        ? props.composition.beatPrimaryColors?.find(
            (entry) => entry.beatId === props.clip.beatId,
          )?.correction
        : props.composition.defaultPrimaryColor) ?? effective.value.correction),
  };
}
watch(() => [scope.value, props.clip.id, props.revision], reset, {
  immediate: true,
});
watch(
  () => [props.projectId, props.composition.id, props.clip.id],
  () => {
    scope.value = "clip";
    showReview.value = false;
    reset();
  },
);
const valid = computed(() => {
  try {
    validatePrimaryColorCorrection(draft.value);
    return true;
  } catch {
    return false;
  }
});
function send(correction: PrimaryColorCorrection | null) {
  if (blocked.value) return;
  if (scope.value === "film")
    emit("command", { type: "primary-color", scope: "film", correction });
  else if (scope.value === "beat" && props.clip.beatId)
    emit("command", {
      type: "primary-color",
      scope: "beat",
      beatId: props.clip.beatId,
      correction,
    });
  else if (scope.value === "clip")
    emit("command", {
      type: "primary-color",
      scope: "clip",
      clipId: props.clip.id,
      correction,
    });
}
function commit() {
  if (valid.value) send(validatePrimaryColorCorrection(draft.value));
}
const references = computed(() =>
  props.composition.tracks.flatMap((track) =>
    ["video", "overlay"].includes(track.type)
      ? track.clips
          .filter(
            (clip) =>
              clip.id !== props.clip.id && clip.layout?.preset !== "diptych",
          )
          .flatMap((clip) => {
            const asset = props.assets.find((a) => a.id === clip.assetId);
            return asset &&
              ["image", "video"].includes(asset.mediaType) &&
              !asset.state.rejected
              ? [{ id: clip.id, name: asset.name }]
              : [];
          })
      : [],
  ),
);
</script>
<template>
  <section
    v-if="clipEligible"
    class="primary-color-inspector"
    :aria-label="t('primaryColor.heading')"
  >
    <h3>{{ t("primaryColor.heading") }}</h3>
    <p>{{ t("primaryColor.description") }}</p>
    <p>{{ t("primaryColor.applyHint") }}</p>
    <label class="editor-field"
      >{{ t("primaryColor.scope")
      }}<select v-model="scope" :disabled="disabled">
        <option value="film">{{ t("primaryColor.scopes.film") }}</option>
        <option v-if="clip.beatId" value="beat">
          {{ t("primaryColor.scopes.beat") }}
        </option>
        <option value="clip">{{ t("primaryColor.scopes.clip") }}</option>
      </select></label
    >
    <form @submit.prevent="commit">
      <fieldset :disabled="blocked" class="primary-fields">
        <label class="editor-field" :for="`${prefix}-temperature`"
          >{{ t("primaryColor.temperature")
          }}<input
            :id="`${prefix}-temperature`"
            v-model.number="draft.temperature"
            data-testid="primary-temperature"
            type="number"
            min="-1"
            max="1"
            step="0.01"
        /></label>
        <label class="editor-field" :for="`${prefix}-exposure`"
          >{{ t("primaryColor.exposure")
          }}<input
            :id="`${prefix}-exposure`"
            v-model.number="draft.exposureEv"
            data-testid="primary-exposure"
            type="number"
            min="-2"
            max="2"
            step="0.01"
        /></label>
        <label class="editor-field" :for="`${prefix}-contrast`"
          >{{ t("primaryColor.contrast")
          }}<input
            :id="`${prefix}-contrast`"
            v-model.number="draft.contrast"
            data-testid="primary-contrast"
            type="number"
            min="0.5"
            max="1.5"
            step="0.01"
        /></label>
        <div class="primary-actions">
          <button
            class="editor-button"
            type="submit"
            data-testid="primary-apply"
            :disabled="blocked || !valid"
          >
            {{ t("primaryColor.apply") }}</button
          ><button
            class="editor-button"
            type="button"
            @click="draft = { ...PRIMARY_COLOR_IDENTITY }"
          >
            {{ t("primaryColor.neutral") }}</button
          ><button class="editor-button" type="button" @click="send(null)">
            {{ t("primaryColor.inherit") }}
          </button>
        </div>
      </fieldset>
    </form>
    <p role="status">
      {{
        t("primaryColor.effective", {
          scope: t(`primaryColor.scopes.${effective.source}`),
        })
      }}
    </p>
    <button
      class="editor-button"
      type="button"
      :aria-expanded="showReview"
      :disabled="
        disabled || !references.length || clip.layout?.preset === 'diptych'
      "
      @click="showReview = !showReview"
    >
      {{ t("primaryColor.review") }}
    </button>
    <PrimaryColorReviewPanel
      v-if="showReview"
      :project-id="projectId"
      :composition-id="composition.id"
      :revision="revision"
      :clip-id="clip.id"
      :references="references"
      :disabled="!!disabled"
      :apply-disabled="!!clipProtected"
      @apply="emit('command', $event)"
    />
  </section>
</template>
<style scoped>
.primary-color-inspector {
  display: grid;
  gap: var(--of-space-3);
  padding-block: var(--of-space-4);
  border-block: 1px solid var(--of-border-subtle);
  margin-block: var(--of-space-4);
  min-width: 0;
}
h3,
p {
  margin: 0;
}
h3 {
  font-size: var(--of-font-small);
}
p {
  font-size: var(--of-font-caption);
  color: var(--of-text-secondary);
  overflow-wrap: anywhere;
}
.primary-fields {
  display: grid;
  gap: var(--of-space-3);
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.primary-actions {
  display: flex;
  gap: var(--of-space-2);
  flex-wrap: wrap;
}
</style>
