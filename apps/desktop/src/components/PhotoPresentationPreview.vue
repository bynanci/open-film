<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

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

const props = withDefaults(
  defineProps<{
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
    externalTime?: number;
    externalPlaying?: boolean;
  }>(),
  {
    sourceVersion: undefined,
    look: undefined,
    externalTime: undefined,
    externalPlaying: undefined,
  },
);
const { t } = useI18n();
const lookFilterId = `photo-look-${useId().replaceAll(":", "")}`;
const lookStyle = computed(() =>
  props.look && props.look.preset !== "none" && props.look.strength > 0
    ? { filter: `url(#${lookFilterId})` }
    : {},
);
const ownedTime = ref(0);
const controlled = computed(
  () => props.externalTime !== undefined || props.externalPlaying !== undefined,
);
const time = computed(() =>
  controlled.value
    ? Math.max(
        0,
        Math.min(props.clip.timelineDuration, props.externalTime ?? 0),
      )
    : ownedTime.value,
);
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
const ownedPlaying = ref(false);
const playing = computed(() =>
  controlled.value ? (props.externalPlaying ?? false) : ownedPlaying.value,
);
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
  if (controlled.value) return { width: "100%", height: "100%" };
  const ratio = props.frame.width / props.frame.height;
  const width = Math.max(
    1,
    Math.min(props.viewport.width - 16, (props.viewport.height - 16) * ratio),
  );
  return { width: `${width}px`, height: `${width / ratio}px` };
});
function pause() {
  ownedPlaying.value = false;
  cancelAnimationFrame(animation);
}
function tick(now: number) {
  ownedTime.value = Math.min(
    props.clip.timelineDuration,
    initialTime + (now - started) / 1000,
  );
  if (time.value >= props.clip.timelineDuration) pause();
  else animation = requestAnimationFrame(tick);
}
function toggle() {
  if (controlled.value) return;
  if (playing.value) return pause();
  if (time.value >= props.clip.timelineDuration) ownedTime.value = 0;
  ownedPlaying.value = true;
  initialTime = time.value;
  started = performance.now();
  animation = requestAnimationFrame(tick);
}
function seekTo(requested: number) {
  if (controlled.value || !Number.isFinite(requested)) return;
  pause();
  ownedTime.value = Math.max(
    0,
    Math.min(props.clip.timelineDuration, requested),
  );
}
function seek(event: Event) {
  seekTo(Number((event.target as HTMLInputElement).value));
}
watch(
  () => props.clip.id,
  () => {
    pause();
    ownedTime.value = 0;
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
    ownedTime.value = Math.min(ownedTime.value, duration);
  },
);
onBeforeUnmount(pause);
watch(controlled, (value) => {
  if (value) pause();
});
defineExpose({ toggle, pause, seekTo });
</script>

<template>
  <div
    class="photo-presentation-preview"
    :class="{ 'photo-presentation-controlled': controlled }"
  >
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
            crossorigin="anonymous"
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
        crossorigin="anonymous"
        class="photo-presentation-title"
        :src="titleUrl"
        :alt="clip.title"
        :style="{ opacity: titleOpacity }"
        draggable="false"
        @load="titleFailed = false"
        @error="titleFailed = true"
      />
      <slot :time="time" :playing="playing" />
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
    <Teleport v-if="!controlled" defer :to="transportTarget">
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

<style scoped>
.photo-presentation-controlled {
  padding: 0;
  gap: 0;
}
.photo-presentation-controlled .photo-presentation-layers > img {
  position: absolute;
  max-width: none;
  max-height: none;
  object-fit: fill;
}
.photo-presentation-controlled .photo-presentation-title {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}
</style>
