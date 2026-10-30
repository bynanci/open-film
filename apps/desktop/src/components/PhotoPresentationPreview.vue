<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { computed, onBeforeUnmount, onMounted, ref, watch, useId } from "vue";
import { useI18n } from "vue-i18n";
import {
  evaluateClipAtTime,
  evaluateTitleOpacity,
  assetDisplayDimensions,
  resolveClipGeometry,
  photoAmbientGaps,
  type Clip,
  type FilmLook,
  type PrimaryColorCorrection,
  type MediaAsset,
  type ProjectSettings,
  type FrameSize,
  type PhotoFocalPoint,
} from "@openfilm/core";
import { sourceUrl, titlePreviewUrl, photoFillPreviewUrl } from "../api";
import PrimaryColorFilter from "./PrimaryColorFilter.vue";
import { sourceColorStyle } from "../source-color";
import FilmLookFilter from "./FilmLookFilter.vue";
import PhotoFocalOverlay from "./PhotoFocalOverlay.vue";
import { resolvePhotoFocalGeometry } from "../photoFocalInteraction";
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
    primaryColor?: PrimaryColorCorrection;
    externalTime?: number;
    externalPlaying?: boolean;
    focalEditing?: boolean;
    focalDisabled?: boolean;
    focalSessionKey?: string;
  }>(),
  {
    sourceVersion: undefined,
    look: undefined,
    primaryColor: undefined,
    externalTime: undefined,
    externalPlaying: undefined,
    focalSessionKey: undefined,
  },
);
const emit = defineEmits<{
  readiness: [status: { ready: boolean; failed: boolean; assetId?: string }];
  focalPreview: [point: PhotoFocalPoint];
  focalCommit: [point: PhotoFocalPoint];
  focalActivity: [active: boolean];
  focalCancelled: [];
}>();
const { t } = useI18n();
const lookFilterId = `photo-look-${useId().replaceAll(":", "")}`;
const primaryFilterId = `photo-primary-${useId().replaceAll(":", "")}`;
const lookStyle = computed(() =>
  sourceColorStyle(props.primaryColor, props.look, {
    primary: primaryFilterId,
    look: lookFilterId,
  }),
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
const loadedSources = ref(new Set<string>());
const titleFailed = ref(false);
const titleRetry = ref(0);
const fillRetry = ref(0);
const loadedFill = ref("");
const failedFill = ref("");
const frameElement = ref<HTMLElement | null>(null);
const focalOverlay = ref<InstanceType<typeof PhotoFocalOverlay> | null>(null);
const frameRect = ref({ left: 0, top: 0, width: 0, height: 0 });
let observer: ResizeObserver | undefined;
function refreshBounds() {
  const rect = frameElement.value?.getBoundingClientRect?.();
  if (rect)
    frameRect.value = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
}
const focalGeometry = computed(() =>
  props.focalEditing && plan.value?.layers[0] && frameRect.value.width > 0
    ? resolvePhotoFocalGeometry(
        plan.value.layers[0],
        plan.value.transform,
        props.clip.transform,
        props.frame,
        frameRect.value,
      )
    : null,
);
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
      key: `${props.clip.id}:${index}:${identity}${plan.value?.ambient ? ":ambient" : ""}`,
      src: sourceUrl(layer.assetId, identity),
      name: asset?.name ?? "",
    };
  }),
);
const ambient = computed(() =>
  plan.value?.ambient
    ? {
        key: JSON.stringify([
          props.projectId,
          props.compositionId,
          props.clip.id,
          props.revision,
          props.sourceVersion,
          plan.value.ambient,
          renderLayers.value.map((layer) => layer.key),
          fillRetry.value,
        ]),
        src: photoFillPreviewUrl(
          props.compositionId,
          props.clip.id,
          props.revision,
          props.projectId,
        ),
      }
    : null,
);
const ambientFailed = computed(
  () => !!ambient.value && failedFill.value === ambient.value.key,
);
const ambientGaps = computed(() => photoAmbientGaps(plan.value?.ambient));
function fillLoaded(key: string) {
  if (ambient.value?.key !== key) return;
  loadedFill.value = key;
  failedFill.value = "";
}
function fillFailed(key: string) {
  if (ambient.value?.key !== key) return;
  failedFill.value = key;
  loadedFill.value = "";
}
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
    loadedSources.value = new Set(
      [...loadedSources.value].filter((key) => current.has(key)),
    );
  },
);
const readiness = computed(() => ({
  ready:
    !!plan.value &&
    renderLayers.value.length > 0 &&
    (!ambient.value || loadedFill.value === ambient.value.key) &&
    renderLayers.value.every((layer) => loadedSources.value.has(layer.key)),
  failed: !plan.value || sourceFailed.value || ambientFailed.value,
  assetId: renderLayers.value.find((layer) =>
    failedSources.value.has(layer.key),
  )?.assetId,
}));
watch(
  readiness,
  (status, previous) => {
    if (
      !previous ||
      status.ready !== previous.ready ||
      status.failed !== previous.failed ||
      status.assetId !== previous.assetId
    )
      emit("readiness", status);
  },
  { immediate: true, flush: "post" },
);
function layerFailed(key: string) {
  if (!renderLayers.value.some((layer) => layer.key === key)) return;
  const remaining = new Set(loadedSources.value);
  remaining.delete(key);
  loadedSources.value = remaining;
  failedSources.value = new Set([...failedSources.value, key]);
}
function layerLoaded(key: string) {
  if (!renderLayers.value.some((layer) => layer.key === key)) return;
  loadedSources.value = new Set([...loadedSources.value, key]);
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
  if (controlled.value)
    return { width: "100%", height: "100%", background: "transparent" };
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
  if (props.focalEditing) {
    focalOverlay.value?.cancel();
    emit("focalCancelled");
    return;
  }
  if (controlled.value) return;
  if (playing.value) return pause();
  if (time.value >= props.clip.timelineDuration) ownedTime.value = 0;
  ownedPlaying.value = true;
  initialTime = time.value;
  started = performance.now();
  animation = requestAnimationFrame(tick);
}
function seekTo(requested: number) {
  if (props.focalEditing) {
    focalOverlay.value?.cancel();
    emit("focalCancelled");
  }
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
onMounted(() => {
  refreshBounds();
  if (typeof ResizeObserver !== "undefined" && frameElement.value) {
    observer = new ResizeObserver(refreshBounds);
    observer.observe(frameElement.value);
  }
  if (typeof window !== "undefined")
    window.addEventListener("scroll", refreshBounds, true);
});
onBeforeUnmount(() => {
  pause();
  observer?.disconnect();
  if (typeof window !== "undefined")
    window.removeEventListener("scroll", refreshBounds, true);
});
watch(
  () => [
    props.viewport.width,
    props.viewport.height,
    props.frame.width,
    props.frame.height,
    props.focalEditing,
  ],
  refreshBounds,
  { flush: "post" },
);
watch(controlled, (value) => {
  if (value) pause();
});
defineExpose({
  toggle,
  pause,
  seekTo,
  cancelFocus: () => focalOverlay.value?.cancel(),
});
</script>

<template>
  <div
    class="photo-presentation-preview"
    :class="{ 'photo-presentation-controlled': controlled }"
  >
    <PrimaryColorFilter
      v-if="primaryColor"
      :id="primaryFilterId"
      :correction="primaryColor"
    />
    <FilmLookFilter v-if="look" :id="lookFilterId" :look="look" />
    <div
      ref="frameElement"
      class="photo-presentation-frame"
      :style="frameStyle"
      :aria-label="t('editor.presentation.preview')"
    >
      <div class="photo-presentation-static" :style="staticStyle">
        <div class="photo-presentation-layers" :style="transformStyle">
          <div v-if="ambient" class="photo-presentation-raw" :style="lookStyle">
            <img
              v-for="fill in ambient ? [ambient] : []"
              :key="fill.key"
              class="photo-presentation-ambient"
              crossorigin="anonymous"
              :src="fill.src"
              alt=""
              aria-hidden="true"
              draggable="false"
              @load="fillLoaded(fill.key)"
              @error="fillFailed(fill.key)"
            />
            <img
              v-for="layer in renderLayers"
              :key="layer.key"
              crossorigin="anonymous"
              :src="layer.src"
              :alt="layer.name"
              draggable="false"
              :style="{
                left: `${(layer.x / frame.width) * 100}%`,
                top: `${(layer.y / frame.height) * 100}%`,
                width: `${(layer.width / frame.width) * 100}%`,
                height: `${(layer.height / frame.height) * 100}%`,
              }"
              @load="layerLoaded(layer.key)"
              @error="layerFailed(layer.key)"
            />
          </div>
          <template v-else>
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
          </template>
          <div
            v-for="(gap, index) in ambientGaps"
            :key="index"
            class="photo-presentation-gap"
            aria-hidden="true"
            :style="{
              left: `${(gap.x / frame.width) * 100}%`,
              top: `${(gap.y / frame.height) * 100}%`,
              width: `${(gap.width / frame.width) * 100}%`,
              height: `${(gap.height / frame.height) * 100}%`,
            }"
          />
        </div>
      </div>
      <PhotoFocalOverlay
        v-if="focalGeometry"
        ref="focalOverlay"
        :point="clip.layout?.focalPoint ?? { x: 0.5, y: 0.5 }"
        :geometry="focalGeometry"
        :disabled="!!focalDisabled"
        :session-key="focalSessionKey ?? ''"
        @preview="emit('focalPreview', $event)"
        @commit="emit('focalCommit', $event)"
        @activity="emit('focalActivity', $event)"
        @cancelled="emit('focalCancelled')"
      />
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
      v-if="!plan || sourceFailed || ambientFailed"
      class="editor-presentation-warnings"
      role="status"
    >
      {{
        t(
          ambientFailed
            ? "editor.presentation.fillFailed"
            : "editor.presentation.sourceWarning",
        )
      }}
    </p>
    <button
      v-if="ambientFailed"
      type="button"
      class="editor-button"
      @click="fillRetry++"
    >
      {{ t("editor.presentation.retryFill") }}
    </button>
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
.photo-presentation-raw {
  position: absolute;
  inset: 0;
}
.photo-presentation-raw > img {
  position: absolute;
  max-width: none;
  max-height: none;
  object-fit: fill;
}
.photo-presentation-ambient {
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.photo-presentation-gap {
  position: absolute;
  background: #000;
  pointer-events: none;
}
.photo-presentation-controlled {
  padding: 0;
  gap: 0;
}
.photo-presentation-controlled .photo-presentation-layers > img,
.photo-presentation-controlled .photo-presentation-raw > img {
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
