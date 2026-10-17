<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  evaluateClipAtTime,
  assetDisplayDimensions,
  resolveClipGeometry,
  type Clip,
  type MediaAsset,
  type ProjectSettings,
  type FrameSize,
} from "@openfilm/core";
import { sourceUrl, titlePreviewUrl } from "../api";
import { formatDuration } from "../i18n";

const props = defineProps<{
  clip: Clip;
  assets: readonly MediaAsset[];
  frame: ProjectSettings;
  viewport: FrameSize;
  transportTarget: string;
  compositionId: string;
  projectId: string;
  revision: string;
  active: boolean;
  sourceVersion?: number;
}>();
const { t } = useI18n();
const time = ref(0);
const playing = ref(false);
const sourceFailed = ref(false);
const titleFailed = ref(false);
const titleRetry = ref(0);
let animation = 0;
let started = 0;
let initialTime = 0;
const sources = computed(() =>
  Object.fromEntries(
    props.assets.flatMap((asset) => {
      const dimensions = assetDisplayDimensions(asset);
      return dimensions ? [[asset.id, dimensions]] : [];
    }),
  ),
);
const plan = computed(() => {
  try {
    return evaluateClipAtTime(
      props.clip,
      time.value,
      sources.value,
      props.frame,
    );
  } catch {
    return null;
  }
});
const titleUrl = computed(() =>
  titlePreviewUrl(
    props.compositionId,
    props.clip.id,
    props.revision,
    props.projectId,
  ),
);
watch(titleUrl, () => {
  titleFailed.value = false;
});
const staticStyle = computed(() => {
  const geometry = resolveClipGeometry(props.clip.transform);
  return {
    transform: `translate(${(Math.round(geometry.x) / props.frame.width) * 100}%, ${(Math.round(geometry.y) / props.frame.height) * 100}%) rotate(${geometry.rotation}deg) scale(${geometry.scale})`,
  };
});
const transformStyle = computed(() => ({
  transform: `translate(${((plan.value?.transform.x ?? 0) / props.frame.width) * 100}%, ${((plan.value?.transform.y ?? 0) / props.frame.height) * 100}%) scale(${plan.value?.transform.scale ?? 1})`,
}));
const frameStyle = computed(() => {
  const ratio = props.frame.width / props.frame.height;
  const width = Math.max(
    1,
    Math.min(props.viewport.width - 16, (props.viewport.height - 16) * ratio),
  );
  return { width: `${width}px`, height: `${width / ratio}px` };
});
function pause() {
  playing.value = false;
  cancelAnimationFrame(animation);
}
function tick(now: number) {
  time.value = Math.min(
    props.clip.timelineDuration,
    initialTime + (now - started) / 1000,
  );
  if (time.value >= props.clip.timelineDuration) pause();
  else animation = requestAnimationFrame(tick);
}
function toggle() {
  if (playing.value) return pause();
  if (time.value >= props.clip.timelineDuration) time.value = 0;
  playing.value = true;
  initialTime = time.value;
  started = performance.now();
  animation = requestAnimationFrame(tick);
}
function seek(event: Event) {
  pause();
  time.value = Number((event.target as HTMLInputElement).value);
}
watch(
  () => props.clip.id,
  () => {
    pause();
    time.value = 0;
    sourceFailed.value = false;
  },
);
watch(
  () => props.active,
  (active) => {
    if (!active) pause();
  },
);
watch(
  () => props.clip.timelineDuration,
  (duration) => {
    time.value = Math.min(time.value, duration);
  },
);
onBeforeUnmount(pause);
defineExpose({ toggle, pause });
</script>

<template>
  <div class="photo-presentation-preview">
    <div
      class="photo-presentation-frame"
      :style="frameStyle"
      :aria-label="t('editor.presentation.preview')"
    >
      <div class="photo-presentation-static" :style="staticStyle">
        <div class="photo-presentation-layers" :style="transformStyle">
          <img
            v-for="(layer, index) in plan?.layers ?? []"
            :key="`${layer.assetId}:${index}`"
            :src="sourceUrl(layer.assetId, sourceVersion)"
            :alt="
              assets.find((asset) => asset.id === layer.assetId)?.name ?? ''
            "
            draggable="false"
            :style="{
              left: `${(layer.x / frame.width) * 100}%`,
              top: `${(layer.y / frame.height) * 100}%`,
              width: `${(layer.width / frame.width) * 100}%`,
              height: `${(layer.height / frame.height) * 100}%`,
            }"
            @error="sourceFailed = true"
          />
        </div>
      </div>
      <img
        v-if="clip.title"
        :key="`${titleUrl}:${titleRetry}`"
        class="photo-presentation-title"
        :src="titleUrl"
        :alt="clip.title"
        draggable="false"
        @load="titleFailed = false"
        @error="titleFailed = true"
      />
    </div>
    <p
      v-if="!plan || sourceFailed"
      class="editor-presentation-warnings"
      role="status"
    >
      {{ t("editor.presentation.sourceWarning") }}
    </p>
    <p v-if="titleFailed" class="editor-presentation-warnings" role="status">
      {{ t("editor.presentation.titleFailed") }}
      <button
        class="editor-button"
        @click="
          titleFailed = false;
          titleRetry++;
        "
      >
        {{ t("editor.presentation.retryTitle") }}
      </button>
    </p>
    <Teleport defer :to="transportTarget">
      <div
        class="photo-presentation-transport"
        :title="t('editor.presentation.previewNote')"
      >
        <button class="editor-button" :aria-pressed="playing" @click="toggle">
          {{ t(playing ? "editor.source.pause" : "editor.source.play") }}
        </button>
        <input
          type="range"
          min="0"
          :max="clip.timelineDuration"
          :step="1 / frame.frameRate"
          :value="time"
          :aria-label="t('editor.presentation.seek')"
          @input="seek"
        />
        <time>{{ formatDuration(time, { fractional: true }) }}</time>
      </div>
    </Teleport>
  </div>
</template>
