<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { GraphicScene } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import { graphicFrame, ApiError } from "../api";
import GraphicSceneLayerOverlay from "./GraphicSceneLayerOverlay.vue";
const props = defineProps<{
  compositionId: string;
  projectId: string;
  revision: string;
  time: number;
  frameRate: number;
  duration: number;
  sourceVersion?: number;
  active: boolean;
  playing: boolean;
  scenes?: readonly GraphicScene[];
  frameWidth?: number;
  frameHeight?: number;
  selectedSceneId?: string;
  selectedNodeId?: string;
  editing?: boolean;
  snapping?: boolean;
  guides?: boolean;
}>();
const emit = defineEmits<{
  select: [selection: { sceneId: string; nodeId: string }];
  command: [command: TimelineCommand];
}>();
const { t } = useI18n();
const scope = computed(
  () =>
    `${props.projectId}:${props.compositionId}:${props.revision}:${props.frameRate}:${props.duration}:${props.sourceVersion ?? 0}:${props.active}`,
);
const requestedFrame = computed(() =>
  Math.max(
    0,
    Math.min(
      Math.floor(props.duration * props.frameRate + 1e-7) - 1,
      Math.floor((props.time + 1e-9) * props.frameRate),
    ),
  ),
);
const displayedFrameTime = computed(
  () => requestedFrame.value / props.frameRate,
);
const url = ref("");
const shownFrame = ref(-1);
const failed = ref(false);
let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let disposed = false;
let busyRetries = 0;
function clearImage() {
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = "";
  shownFrame.value = -1;
}
function reset() {
  generation++;
  controller?.abort();
  controller = undefined;
  if (timer) clearTimeout(timer);
  timer = undefined;
  clearImage();
  failed.value = false;
  busyRetries = 0;
}
function schedule(delay = 0) {
  if (disposed || !props.active || controller || timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    void load();
  }, delay);
}
async function load() {
  if (disposed || !props.active) return;
  const current = ++generation;
  const identity = scope.value;
  const frame = requestedFrame.value;
  const pending = new AbortController();
  controller = pending;
  let retry = false;
  try {
    const blob = await graphicFrame(
      props.compositionId,
      props.projectId,
      props.revision,
      frame,
      pending.signal,
    );
    if (
      disposed ||
      pending.signal.aborted ||
      current !== generation ||
      identity !== scope.value ||
      (!props.playing && frame !== requestedFrame.value)
    )
      return;
    clearImage();
    url.value = URL.createObjectURL(blob);
    shownFrame.value = frame;
    failed.value = false;
  } catch (cause) {
    if (
      cause instanceof ApiError &&
      cause.code === "graphics.busy" &&
      busyRetries++ < 3 &&
      current === generation &&
      !pending.signal.aborted
    )
      retry = true;
    else if (current === generation && !pending.signal.aborted) {
      clearImage();
      failed.value = true;
    }
  } finally {
    if (controller === pending) controller = undefined;
    if (retry) schedule(150);
    else if (
      !disposed &&
      props.active &&
      !failed.value &&
      (frame !== requestedFrame.value || identity !== scope.value)
    )
      schedule(props.playing ? 120 : 0);
  }
}
watch(
  scope,
  () => {
    reset();
    schedule();
  },
  { immediate: true },
);
watch([requestedFrame, () => props.playing], () => {
  if (!props.playing) {
    reset();
    schedule();
  } else schedule(120);
});
onBeforeUnmount(() => {
  disposed = true;
  reset();
});
</script>
<template>
  <div v-if="active" class="graphic-preview-root">
    <img
      v-if="url"
      class="graphic-scene-overlay"
      data-testid="graphic-preview"
      :data-frame="shownFrame"
      :src="url"
      :alt="t('editor.graphics.preview')"
      draggable="false"
    />
    <GraphicSceneLayerOverlay
      v-if="editing && frameWidth && frameHeight"
      :scenes="scenes ?? []"
      :revision="revision"
      :time="displayedFrameTime"
      :frame-width="frameWidth"
      :frame-height="frameHeight"
      :selected-scene-id="selectedSceneId ?? ''"
      :selected-node-id="selectedNodeId ?? ''"
      :enabled="editing && !playing && !!url && shownFrame === requestedFrame"
      :snapping="snapping ?? true"
      :guides="guides ?? true"
      @select="emit('select', $event)"
      @command="emit('command', $event)"
    />
  </div>
  <span v-if="failed && active" class="graphic-preview-status" role="status"
    >{{ t("editor.graphics.previewFailed") }}
    <button
      class="editor-button"
      @click="
        failed = false;
        schedule();
      "
    >
      {{ t("editor.graphics.retry") }}
    </button></span
  >
  <span v-else-if="playing && active" class="graphic-preview-status">{{
    t("editor.graphics.sampled")
  }}</span>
</template>
