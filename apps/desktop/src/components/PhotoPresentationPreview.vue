<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; this derivative as a whole is GPL-3.0-only. See LICENSE/NOTICE.

import { computed, onBeforeUnmount, ref, watch, useId } from "vue";
import { useI18n } from "vue-i18n";
import {
  evaluateClipAtTime,
  evaluateTitleOpacity,
  assetDisplayDimensions,
  resolveClipGeometry,
  type Clip,
  type FilmLook,
  type MediaAsset,
  type ProjectSettings,
  type FrameSize,
} from "@openfilm/core";
import { sourceUrl, titlePreviewUrl } from "../api";
import FilmLookFilter from "./FilmLookFilter.vue";
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
  look?: FilmLook;
}>();
const { t } = useI18n();
const lookFilterId = `photo-look-${useId().replaceAll(":", "")}`;
const lookStyle = computed(() =>
  props.look && props.look.preset !== "none" && props.look.strength > 0
    ? { filter: `url(#${lookFilterId})` }
    : {},
);
const time = ref(0);
const titleOpacity = computed(() => {
  try {
    return evaluateTitleOpacity(
      props.clip.titleStyle,
      time.value,
      props.clip.timelineDuration,
    );
  } catch {
    // Legacy invalid styles retain their existing preview recovery state.
    return 1;
  }
});
const playing = ref(false);
const failedSources = ref(new Set<string>());
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
const assetMap = computed(
  () => new Map(props.assets.map((asset) => [asset.id, asset])),
);
const renderLayers = computed(() =>
  (plan.value?.layers ?? []).map((layer, index) => {
    const asset = assetMap.value.get(layer.assetId);
    const identity = `${layer.assetId}:${asset?.uri}:${props.sourceVersion ?? 0}`;
    return {
      ...layer,
      key: `${props.clip.id}:${index}:${identity}`,
      src: sourceUrl(layer.assetId, identity),
      name: asset?.name ?? "",
    };
  }),
);
const sourceFailed = computed(() =>
  renderLayers.value.some((layer) => failedSources.value.has(layer.key)),
);
watch(
  () => JSON.stringify(renderLayers.value.map((layer) => layer.key)),
  () => {
    const current = new Set(renderLayers.value.map((layer) => layer.key));
    failedSources.value = new Set(
      [...failedSources.value].filter((key) => current.has(key)),
    );
  },
);
function layerFailed(key: string) {
  if (!renderLayers.value.some((layer) => layer.key === key)) return;
  failedSources.value = new Set([...failedSources.value, key]);
}
function layerLoaded(key: string) {
  if (!renderLayers.value.some((layer) => layer.key === key)) return;
  if (!failedSources.value.has(key)) return;
  const remaining = new Set(failedSources.value);
  remaining.delete(key);
  failedSources.value = remaining;
}
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
    <FilmLookFilter v-if="look" :id="lookFilterId" :look="look" />
    <div
      class="photo-presentation-frame"
      :style="frameStyle"
      :aria-label="t('editor.presentation.preview')"
    >
      <div class="photo-presentation-static" :style="staticStyle">
        <div class="photo-presentation-layers" :style="transformStyle">
          <img
            v-for="layer in renderLayers"
            :key="layer.key"
            :src="layer.src"
            :alt="layer.name"
            draggable="false"
            :style="{
              ...lookStyle,
              left: `${(layer.x / frame.width) * 100}%`,
              top: `${(layer.y / frame.height) * 100}%`,
              width: `${(layer.width / frame.width) * 100}%`,
              height: `${(layer.height / frame.height) * 100}%`,
            }"
            @load="layerLoaded(layer.key)"
            @error="layerFailed(layer.key)"
          />
        </div>
      </div>
      <img
        v-if="clip.title"
        :key="`${titleUrl}:${titleRetry}`"
        class="photo-presentation-title"
        :src="titleUrl"
        :alt="clip.title"
        :style="{ opacity: titleOpacity }"
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
