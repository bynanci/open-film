<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PreviewClipGeometry } from "@openfilm/core";
import {
  movePreviewTransform,
  resizePreviewTransform,
  type PreviewTransform,
  type TransformCorner,
} from "../previewTransform";

const props = defineProps<{
  value: PreviewTransform;
  geometry: PreviewClipGeometry;
  disabled: boolean;
  sessionKey: string;
}>();
const emit = defineEmits<{
  preview: [value: PreviewTransform];
  commit: [value: PreviewTransform];
  activity: [active: boolean];
}>();
const { t } = useI18n();
const surface = ref<HTMLElement | null>(null);
const dragging = ref(false);
const corners: TransformCorner[] = ["nw", "ne", "se", "sw"];
let gesture: {
  initial: PreviewTransform;
  point: { x: number; y: number };
  corner?: TransformCorner;
  pointerId: number;
  media: { width: number; height: number };
  viewportScale: number;
} | null = null;
const boxStyle = computed(() => ({
  width: `${props.geometry.media.width * props.value.scale}px`,
  height: `${props.geometry.media.height * props.value.scale}px`,
  transform: `translate(-50%, -50%) translate(${props.geometry.x}px, ${props.geometry.y}px) rotate(${props.value.rotation}deg)`,
}));
function release() {
  const captured = gesture;
  gesture = null;
  dragging.value = false;
  if (captured && surface.value?.hasPointerCapture(captured.pointerId))
    surface.value.releasePointerCapture(captured.pointerId);
  emit("activity", false);
  return captured;
}
function cancel(restore = true) {
  const captured = release();
  if (captured && restore) emit("preview", captured.initial);
}
defineExpose({ cancel });
function start(event: PointerEvent, corner?: TransformCorner) {
  if (
    props.disabled ||
    event.button !== 0 ||
    !event.isPrimary ||
    gesture ||
    !surface.value
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  (event.currentTarget as HTMLElement).focus();
  gesture = {
    initial: { ...props.value },
    point: { x: event.clientX, y: event.clientY },
    corner,
    pointerId: event.pointerId,
    media: { ...props.geometry.media },
    viewportScale: props.geometry.frame.scale,
  };
  surface.value.setPointerCapture(event.pointerId);
  dragging.value = true;
  emit("activity", true);
}
function valueAt(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const delta = {
    x: event.clientX - gesture.point.x,
    y: event.clientY - gesture.point.y,
  };
  return gesture.corner
    ? resizePreviewTransform(
        gesture.initial,
        delta,
        gesture.corner,
        gesture.media,
        gesture.viewportScale,
      )
    : movePreviewTransform(gesture.initial, delta, gesture.viewportScale);
}
function move(event: PointerEvent) {
  const value = valueAt(event);
  if (value) emit("preview", value);
}
function finish(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const value = valueAt(event)!;
  emit("preview", value);
  const captured = release();
  if (
    captured &&
    Object.keys(captured.initial).some(
      (key) =>
        captured.initial[key as keyof PreviewTransform] !==
        value[key as keyof PreviewTransform],
    )
  )
    emit("commit", value);
}
function keyboard(event: KeyboardEvent, corner?: TransformCorner) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancel();
    return;
  }
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  if (props.disabled || gesture) return;
  const step = (event.shiftKey ? 10 : 1) * props.geometry.frame.scale;
  const delta = {
    x:
      event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0,
    y: event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0,
  };
  const value = corner
    ? resizePreviewTransform(
        props.value,
        delta,
        corner,
        props.geometry.media,
        props.geometry.frame.scale,
      )
    : movePreviewTransform(props.value, delta, props.geometry.frame.scale);
  emit("preview", value);
  emit("commit", value);
}
watch(
  () => props.sessionKey,
  () => cancel(false),
);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) cancel();
  },
);
watch(
  [
    () => props.geometry.frame.width,
    () => props.geometry.frame.height,
    () => props.geometry.frame.offsetX,
    () => props.geometry.frame.offsetY,
    () => props.geometry.frame.scale,
    () => props.geometry.media.width,
    () => props.geometry.media.height,
  ],
  () => cancel(),
);
function blur() {
  cancel();
}
function escape(event: KeyboardEvent) {
  if (event.key !== "Escape" || !gesture) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cancel();
}
onMounted(() => {
  window.addEventListener("keydown", escape, true);
  window.addEventListener("blur", blur);
});
onBeforeUnmount(() => {
  cancel();
  window.removeEventListener("keydown", escape, true);
  window.removeEventListener("blur", blur);
});
</script>

<template>
  <div
    ref="surface"
    class="preview-transform-overlay"
    role="group"
    :aria-label="t('editor.picture.group')"
    @pointermove="move"
    @pointerup="finish"
    @pointercancel="cancel()"
    @lostpointercapture="cancel()"
    @keydown.esc.stop.prevent="cancel()"
  >
    <div class="preview-transform-box" :class="{ dragging }" :style="boxStyle">
      <button
        type="button"
        class="preview-transform-move"
        :aria-disabled="disabled"
        :aria-label="t('editor.picture.move')"
        :title="t('editor.picture.hint')"
        @pointerdown="start($event)"
        @keydown="keyboard($event)"
      />
      <button
        v-for="corner in corners"
        :key="corner"
        type="button"
        class="preview-transform-handle"
        :class="corner"
        :aria-disabled="disabled"
        :aria-label="t(`editor.picture.${corner}`)"
        @pointerdown="start($event, corner)"
        @keydown="keyboard($event, corner)"
      />
    </div>
  </div>
</template>

<style scoped>
.preview-transform-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  touch-action: none;
}
.preview-transform-box {
  position: absolute;
  left: 50%;
  top: 50%;
  border: 1px solid var(--of-accent);
  transform-origin: center;
}
.preview-transform-move {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
}
.dragging .preview-transform-move {
  cursor: grabbing;
}
.preview-transform-move:focus-visible {
  outline: 2px solid var(--of-accent);
  outline-offset: -4px;
}
.preview-transform-handle {
  position: absolute;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  pointer-events: auto;
  touch-action: none;
}
.preview-transform-handle::after {
  content: "";
  position: absolute;
  inset: 7px;
  border: 1px solid var(--of-accent);
  border-radius: 2px;
  background: var(--of-surface-1);
}
.preview-transform-handle:focus-visible {
  outline: 2px solid var(--of-accent);
  outline-offset: 0;
  border-radius: 4px;
}
.nw {
  top: -6px;
  left: -6px;
  cursor: nwse-resize;
}
.ne {
  top: -6px;
  right: -6px;
  cursor: nesw-resize;
}
.se {
  bottom: -6px;
  right: -6px;
  cursor: nwse-resize;
}
.sw {
  bottom: -6px;
  left: -6px;
  cursor: nesw-resize;
}
:disabled {
  cursor: default;
}
</style>
