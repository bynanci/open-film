<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PreviewClipGeometry } from "@openfilm/core";
import {
  moveClipTransform,
  resizeClipTransform,
  type ClipTransformDraft,
  type TransformCorner,
} from "../clipTransformInteraction";

const props = defineProps<{
  value: ClipTransformDraft;
  geometry: PreviewClipGeometry;
  disabled: boolean;
  sessionKey: string;
}>();
const emit = defineEmits<{
  preview: [value: ClipTransformDraft];
  commit: [value: ClipTransformDraft];
  activity: [active: boolean];
  cancelled: [];
}>();
const { t } = useI18n();
const surface = ref<HTMLElement | null>(null);
const dragging = ref(false);
const corners: TransformCorner[] = ["nw", "ne", "se", "sw"];
let gesture: {
  initial: ClipTransformDraft;
  point: { x: number; y: number };
  corner?: TransformCorner;
  pointerId: number;
  media: { width: number; height: number };
  viewportScale: number;
  viewport: { width: number; height: number };
} | null = null;

const boxStyle = computed(() => ({
  width: `${Math.max(1, Math.round(props.geometry.media.width)) * props.value.scale}px`,
  height: `${Math.max(1, Math.round(props.geometry.media.height)) * props.value.scale}px`,
  transform: `translate(-50%, -50%) translate(${Math.round(props.value.x) * props.geometry.frame.scale}px, ${Math.round(props.value.y) * props.geometry.frame.scale}px) rotate(${props.value.rotation}deg)`,
}));

function release() {
  const captured = gesture;
  gesture = null;
  dragging.value = false;
  if (captured && surface.value?.hasPointerCapture(captured.pointerId))
    surface.value.releasePointerCapture(captured.pointerId);
  if (captured) emit("activity", false);
  return captured;
}

function cancel(restore = true) {
  const captured = release();
  if (captured && restore) emit("preview", captured.initial);
  if (captured) emit("cancelled");
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
    viewport: { width: window.innerWidth, height: window.innerHeight },
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
    ? resizeClipTransform(
        gesture.initial,
        delta,
        gesture.corner,
        gesture.media,
        gesture.viewportScale,
      )
    : moveClipTransform(gesture.initial, delta, gesture.viewportScale);
}

function move(event: PointerEvent) {
  const value = valueAt(event);
  if (!value) return;
  event.preventDefault();
  emit("preview", value);
}

function finish(event: PointerEvent) {
  if (
    gesture &&
    (gesture.viewport.width !== window.innerWidth ||
      gesture.viewport.height !== window.innerHeight)
  ) {
    event.preventDefault();
    cancel();
    return;
  }
  const value = valueAt(event);
  if (!value) return;
  event.preventDefault();
  emit("preview", value);
  const captured = release();
  if (
    captured &&
    (captured.initial.x !== value.x ||
      captured.initial.y !== value.y ||
      captured.initial.scale !== value.scale ||
      captured.initial.rotation !== value.rotation)
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
    ? resizeClipTransform(
        props.value,
        delta,
        corner,
        props.geometry.media,
        props.geometry.frame.scale,
      )
    : moveClipTransform(props.value, delta, props.geometry.frame.scale);
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

function escape(event: KeyboardEvent) {
  if (event.key !== "Escape" || !gesture) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cancel();
}

function cancelForLayoutChange() {
  cancel();
}

function cancelForBlur() {
  cancel();
}

onMounted(() => {
  window.addEventListener("keydown", escape, true);
  window.addEventListener("blur", cancelForBlur);
  window.addEventListener("resize", cancelForLayoutChange);
});
onBeforeUnmount(() => {
  cancel();
  window.removeEventListener("keydown", escape, true);
  window.removeEventListener("blur", cancelForBlur);
  window.removeEventListener("resize", cancelForLayoutChange);
});
</script>

<template>
  <div
    ref="surface"
    class="clip-transform-overlay"
    role="group"
    :aria-label="t('editor.picture.group')"
    @pointermove="move"
    @pointerup="finish"
    @pointercancel="cancel()"
    @lostpointercapture="cancel()"
  >
    <div
      class="clip-transform-box"
      :class="{ dragging, 'is-disabled': disabled }"
      :style="boxStyle"
    >
      <button
        type="button"
        class="clip-transform-move"
        :aria-disabled="disabled"
        :aria-label="t('editor.picture.move')"
        :title="t('editor.picture.hint')"
        @pointerdown="start($event)"
        @keydown="keyboard($event)"
      />
    </div>
    <div
      class="clip-transform-handles"
      :class="{ dragging, 'is-disabled': disabled }"
      :style="boxStyle"
    >
      <button
        v-for="corner in corners"
        :key="corner"
        type="button"
        class="clip-transform-handle"
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
.clip-transform-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  touch-action: none;
}
.clip-transform-box {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 50%;
  border: 1px solid var(--of-accent);
  transform-origin: center;
}
.clip-transform-handles {
  position: absolute;
  z-index: 4;
  top: 50%;
  left: 50%;
  pointer-events: none;
  transform-origin: center;
}
.clip-transform-move {
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
.dragging .clip-transform-move {
  cursor: grabbing;
}
.clip-transform-move:focus-visible,
.clip-transform-handle:focus-visible {
  outline: 2px solid var(--of-accent);
  outline-offset: 2px;
}
.clip-transform-handle {
  position: absolute;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  pointer-events: auto;
  touch-action: none;
}
.clip-transform-handle::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 8px;
  border: 1px solid var(--of-accent);
  border-radius: 2px;
  background: var(--of-surface-1);
  transform: translate(-50%, -50%);
}
.clip-transform-handle.nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}
.clip-transform-handle.ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}
.clip-transform-handle.se {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
}
.clip-transform-handle.sw {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}
.clip-transform-handle.nw::after {
  top: 4px;
  left: 4px;
}
.clip-transform-handle.ne::after {
  top: 4px;
  left: calc(100% - 4px);
}
.clip-transform-handle.se::after {
  top: calc(100% - 4px);
  left: calc(100% - 4px);
}
.clip-transform-handle.sw::after {
  top: calc(100% - 4px);
  left: 4px;
}
.is-disabled :is(.clip-transform-move, .clip-transform-handle) {
  cursor: default;
}
@media (pointer: coarse) {
  .clip-transform-handle {
    min-width: 44px;
    min-height: 44px;
  }
}
</style>
