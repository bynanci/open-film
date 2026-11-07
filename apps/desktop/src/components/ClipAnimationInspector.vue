<script setup lang="ts">
import { computed, ref, toRaw, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  clipAnimationMaxFrame,
  evaluateClipVisualAnimation,
  type Clip,
  type ClipAnimationEasing,
  type ClipAnimationProperty,
  type ClipAnimationV1,
  type ProjectTimebaseV1,
} from "@openfilm/core";

const props = defineProps<{
  clip: Clip;
  frame: number;
  timebase: ProjectTimebaseV1;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  preview: [animation: ClipAnimationV1 | null];
  command: [animation: ClipAnimationV1 | null];
}>();
const { t } = useI18n();
function cloneAnimation(animation: ClipAnimationV1): ClipAnimationV1 {
  return structuredClone(toRaw(animation));
}
const properties: ClipAnimationProperty[] = [
  "x",
  "y",
  "scale",
  "rotation",
  "opacity",
];
const property = ref<ClipAnimationProperty>("x");
const interpolation = ref<"hold" | "linear" | "cubic-bezier">("linear");
const animationDraft = ref<ClipAnimationV1 | null>(
  props.clip.animation ? cloneAnimation(props.clip.animation) : null,
);
const value = ref(0);
const frameLimit = computed(() =>
  clipAnimationMaxFrame(props.clip, props.timebase),
);
const currentTrack = computed(() =>
  animationDraft.value?.visualTracks?.find(
    (track) => track.property === property.value,
  ),
);
const savedTrack = computed(() =>
  props.clip.animation?.visualTracks?.find(
    (track) => track.property === property.value,
  ),
);
const exactKey = computed(() =>
  savedTrack.value?.keys.find((key) => key.frame === props.frame),
);
const keyList = computed(() => currentTrack.value?.keys ?? []);
const bezier: ClipAnimationEasing = {
  kind: "cubic-bezier",
  x1: 0.42,
  y1: 0,
  x2: 0.58,
  y2: 1,
};

function readValue(animation: ClipAnimationV1 | null): number {
  try {
    const state = evaluateClipVisualAnimation(
      animation ?? undefined,
      props.frame,
      props.clip.transform,
    );
    return state[property.value];
  } catch {
    return property.value === "scale"
      ? 1
      : property.value === "opacity"
        ? 1
        : 0;
  }
}
watch(
  [
    () => props.clip.id,
    () => props.clip.animation,
    property,
    () => props.frame,
  ],
  () => {
    animationDraft.value = props.clip.animation
      ? cloneAnimation(props.clip.animation)
      : null;
    value.value = readValue(animationDraft.value);
    emit("preview", null);
  },
  { deep: true, immediate: true },
);

function withKey(
  source: ClipAnimationV1 | null,
  atFrame: number,
  atValue: number,
): ClipAnimationV1 {
  const next = source
    ? cloneAnimation(source)
    : { version: 1 as const, visualTracks: [] };
  const tracks = next.visualTracks ?? (next.visualTracks = []);
  let track = tracks.find((candidate) => candidate.property === property.value);
  if (!track) {
    track = { property: property.value, keys: [] };
    tracks.push(track);
  }
  const existing = track.keys.find((key) => key.frame === atFrame);
  const nextKey = {
    frame: atFrame,
    value: atValue,
    interpolation:
      interpolation.value === "cubic-bezier" ? bezier : interpolation.value,
  };
  if (existing) Object.assign(existing, nextKey);
  else track.keys.push(nextKey);
  track.keys.sort((a, b) => a.frame - b.frame);
  return next;
}

function previewValue() {
  if (props.disabled || !Number.isFinite(value.value)) return;
  animationDraft.value = withKey(
    animationDraft.value,
    props.frame,
    value.value,
  );
  emit("preview", cloneAnimation(animationDraft.value));
}
function saveKey() {
  if (props.disabled || !Number.isFinite(value.value)) return;
  const candidate = withKey(animationDraft.value, props.frame, value.value);
  animationDraft.value = candidate;
  emit("command", cloneAnimation(candidate));
  emit("preview", null);
}
function removeKey() {
  if (props.disabled || !exactKey.value || !animationDraft.value) return;
  const candidate = cloneAnimation(animationDraft.value);
  const tracks = candidate.visualTracks ?? [];
  const track = tracks.find((entry) => entry.property === property.value);
  if (!track) return;
  track.keys = track.keys.filter((key) => key.frame !== props.frame);
  candidate.visualTracks = tracks.filter((entry) => entry.keys.length > 0);
  animationDraft.value = candidate.visualTracks.length ? candidate : null;
  emit("command", animationDraft.value);
  emit("preview", null);
}
function clearAnimation() {
  if (props.disabled || !animationDraft.value) return;
  animationDraft.value = null;
  emit("command", null);
  emit("preview", null);
}
</script>

<template>
  <section
    class="clip-animation-inspector"
    :aria-label="t('editor.clip.animation.title')"
  >
    <div class="clip-animation-heading">
      <div>
        <h4>{{ t("editor.clip.animation.title") }}</h4>
        <p>{{ t("editor.clip.animation.description") }}</p>
      </div>
      <span class="clip-animation-frame">{{
        t("editor.clip.animation.frame", { frame })
      }}</span>
    </div>
    <div class="editor-field-pair">
      <label class="editor-field">
        {{ t("editor.clip.animation.property") }}
        <select
          v-model="property"
          :aria-label="t('editor.clip.animation.property')"
          :disabled="disabled"
          @change="value = readValue(animationDraft)"
        >
          <option v-for="item in properties" :key="item" :value="item">
            {{ t(`editor.clip.animation.properties.${item}`) }}
          </option>
        </select>
      </label>
      <label class="editor-field">
        {{ t("editor.clip.animation.interpolation") }}
        <select
          v-model="interpolation"
          :aria-label="t('editor.clip.animation.interpolation')"
          :disabled="disabled"
        >
          <option value="linear">
            {{ t("editor.clip.animation.linear") }}
          </option>
          <option value="hold">{{ t("editor.clip.animation.hold") }}</option>
          <option value="cubic-bezier">
            {{ t("editor.clip.animation.easeInOut") }}
          </option>
        </select>
      </label>
    </div>
    <label class="editor-field">
      {{ t(`editor.clip.animation.properties.${property}`) }}
      <input
        v-model.number="value"
        :aria-label="t(`editor.clip.animation.properties.${property}`)"
        type="number"
        :step="property === 'scale' || property === 'opacity' ? 0.01 : 1"
        :min="
          property === 'scale' ? 0.01 : property === 'opacity' ? 0 : undefined
        "
        :max="
          property === 'scale' ? 10 : property === 'opacity' ? 1 : undefined
        "
        :disabled="disabled"
        @input="previewValue"
      />
    </label>
    <div class="editor-actions">
      <button
        class="editor-button"
        :disabled="disabled || frame > frameLimit"
        @click="saveKey"
      >
        {{
          t(
            exactKey
              ? "editor.clip.animation.updateKey"
              : "editor.clip.animation.addKey",
          )
        }}
      </button>
      <button
        class="editor-button"
        :disabled="disabled || !exactKey"
        @click="removeKey"
      >
        {{ t("editor.clip.animation.removeKey") }}
      </button>
      <button
        class="editor-button"
        :disabled="disabled || !animationDraft"
        @click="clearAnimation"
      >
        {{ t("editor.clip.animation.clear") }}
      </button>
    </div>
    <ul
      v-if="keyList.length"
      class="clip-animation-key-list"
      :aria-label="t('editor.clip.animation.keyList')"
    >
      <li
        v-for="key in keyList"
        :key="key.frame"
        :data-current="key.frame === frame || undefined"
      >
        <span>{{
          t("editor.clip.animation.frame", { frame: key.frame })
        }}</span>
        <span>{{ key.value }}</span>
        <span>{{
          typeof key.interpolation === "object"
            ? t("editor.clip.animation.easeInOut")
            : t(`editor.clip.animation.${key.interpolation ?? "linear"}`)
        }}</span>
      </li>
    </ul>
    <p v-else class="clip-animation-empty">
      {{ t("editor.clip.animation.empty") }}
    </p>
  </section>
</template>

<style scoped>
.clip-animation-inspector {
  display: grid;
  gap: var(--space-3, 12px);
  padding-block: var(--space-3, 12px);
  border-top: 1px solid var(--border-subtle, rgb(255 255 255 / 10%));
}
.clip-animation-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--space-3, 12px);
}
.clip-animation-heading h4,
.clip-animation-heading p {
  margin: 0;
}
.clip-animation-heading p,
.clip-animation-frame,
.clip-animation-empty {
  color: var(--text-muted, #aab0ba);
  font-size: 0.875rem;
}
.clip-animation-key-list {
  display: grid;
  gap: 4px;
  max-height: 9rem;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}
.clip-animation-key-list li {
  display: grid;
  grid-template-columns: 1fr 0.7fr 1fr;
  gap: var(--space-2, 8px);
  padding: 6px 8px;
  border-radius: var(--radius-sm, 6px);
  background: var(--surface-raised, rgb(255 255 255 / 4%));
  font-variant-numeric: tabular-nums;
}
.clip-animation-key-list li[data-current] {
  outline: 1px solid var(--accent, #9b8cff);
}
@media (max-width: 720px) {
  .clip-animation-heading,
  .clip-animation-key-list li {
    grid-template-columns: 1fr;
  }
}
</style>
