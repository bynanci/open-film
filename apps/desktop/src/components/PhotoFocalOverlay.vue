<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PhotoFocalPoint } from "@openfilm/core";
import {
  photoFocalPointAtViewport,
  photoFocalPointFromDelta,
  type PhotoFocalGeometry,
} from "../photoFocalInteraction";

const props = defineProps<{
  point: PhotoFocalPoint;
  geometry: PhotoFocalGeometry;
  disabled: boolean;
  sessionKey: string;
}>();
const emit = defineEmits<{
  preview: [point: PhotoFocalPoint];
  commit: [point: PhotoFocalPoint];
  activity: [active: boolean];
  cancelled: [];
}>();
const { t } = useI18n();
const surface = ref<HTMLElement | null>(null);
type CaptureOwner = {
  sessionKey: string;
  windowWidth: number;
  windowHeight: number;
  rect: { left: number; top: number; width: number; height: number };
};
function captureOwner(): CaptureOwner | null {
  const rect = surface.value?.getBoundingClientRect();
  if (
    !rect ||
    ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    return null;
  return {
    sessionKey: props.sessionKey,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    rect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
  };
}
function currentOwner(owner: CaptureOwner): boolean {
  const current = captureOwner();
  return (
    !props.disabled &&
    current !== null &&
    owner.sessionKey === current.sessionKey &&
    owner.windowWidth === current.windowWidth &&
    owner.windowHeight === current.windowHeight &&
    owner.rect.left === current.rect.left &&
    owner.rect.top === current.rect.top &&
    owner.rect.width === current.rect.width &&
    owner.rect.height === current.rect.height
  );
}
let gesture: {
  initial: PhotoFocalPoint;
  anchor: PhotoFocalPoint;
  point: PhotoFocalPoint;
  pointerId: number;
  geometry: PhotoFocalGeometry;
  owner: CaptureOwner;
} | null = null;
let keyboard: {
  initial: PhotoFocalPoint;
  point: PhotoFocalPoint;
  keys: Set<string>;
  owner: CaptureOwner;
} | null = null;
const marker = computed(() => {
  const [a, b, c, d, e, f] = props.geometry.sourceToViewport;
  const { rect } = props.geometry;
  const x = a * props.point.x + c * props.point.y + e - rect.left;
  const y = b * props.point.x + d * props.point.y + f - rect.top;
  return {
    left: `${Math.max(22, Math.min(rect.width - 22, x))}px`,
    top: `${Math.max(22, Math.min(rect.height - 22, y))}px`,
  };
});
function release() {
  const captured = gesture;
  gesture = null;
  if (captured && surface.value?.hasPointerCapture(captured.pointerId))
    surface.value.releasePointerCapture(captured.pointerId);
  if (captured || keyboard) emit("activity", false);
  return captured;
}
function cancel(restore = true) {
  const captured = release();
  const keys = keyboard;
  keyboard = null;
  if (restore && (captured || keys))
    emit("preview", (captured ?? keys)!.initial);
  if (captured || keys) emit("cancelled");
}
defineExpose({ cancel });
function start(event: PointerEvent, pick = false) {
  if (
    props.disabled ||
    !event.isPrimary ||
    event.button !== 0 ||
    gesture ||
    keyboard ||
    !surface.value
  )
    return;
  const point = { x: event.clientX, y: event.clientY };
  const anchor = pick
    ? photoFocalPointAtViewport(point, props.geometry)
    : { ...props.point };
  if (!anchor) return;
  const owner = captureOwner();
  if (!owner) return;
  event.preventDefault();
  event.stopPropagation();
  (event.currentTarget as HTMLElement).focus?.();
  gesture = {
    initial: { ...props.point },
    anchor,
    point,
    pointerId: event.pointerId,
    geometry: {
      rect: { ...props.geometry.rect },
      sourceToViewport: [...props.geometry.sourceToViewport],
    },
    owner,
  };
  surface.value.setPointerCapture(event.pointerId);
  emit("activity", true);
  emit("preview", anchor);
}
function valueAt(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return null;
  // Resize/owner observers can run after pointerup. Read their actual owners
  // synchronously while retaining the original source mapping for the gesture.
  if (!currentOwner(gesture.owner)) {
    cancel();
    return null;
  }
  return photoFocalPointFromDelta(
    gesture.anchor,
    { x: event.clientX - gesture.point.x, y: event.clientY - gesture.point.y },
    gesture.geometry,
  );
}
function move(event: PointerEvent) {
  const point = valueAt(event);
  if (point) {
    event.preventDefault();
    emit("preview", point);
  }
}
function finish(event: PointerEvent) {
  const point = valueAt(event);
  if (!point) return;
  event.preventDefault();
  emit("preview", point);
  const captured = release();
  if (
    captured &&
    (point.x !== captured.initial.x || point.y !== captured.initial.y)
  )
    emit("commit", point);
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (gesture || keyboard) cancel();
    else emit("cancelled");
    return;
  }
  if (
    props.disabled ||
    gesture ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(
      event.key,
    )
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  if (!keyboard) {
    const owner = captureOwner();
    if (!owner) return;
    keyboard = {
      initial: { ...props.point },
      point: { ...props.point },
      keys: new Set(),
      owner,
    };
    emit("activity", true);
  }
  keyboard.keys.add(event.key);
  const step = event.shiftKey ? 0.1 : 0.01;
  keyboard.point =
    event.key === "Home"
      ? { x: 0.5, y: 0.5 }
      : {
          x: Math.max(
            0,
            Math.min(
              1,
              keyboard.point.x +
                (event.key === "ArrowRight"
                  ? step
                  : event.key === "ArrowLeft"
                    ? -step
                    : 0),
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              1,
              keyboard.point.y +
                (event.key === "ArrowDown"
                  ? step
                  : event.key === "ArrowUp"
                    ? -step
                    : 0),
            ),
          ),
        };
  emit("preview", keyboard.point);
}
function keyup(event: KeyboardEvent) {
  if (!keyboard || !keyboard.keys.has(event.key)) return;
  if (!currentOwner(keyboard.owner)) {
    cancel();
    return;
  }
  keyboard.keys.delete(event.key);
  if (keyboard.keys.size) return;
  const captured = keyboard;
  release();
  keyboard = null;
  if (
    captured.initial.x !== captured.point.x ||
    captured.initial.y !== captured.point.y
  )
    emit("commit", captured.point);
}
const cancelWindow = () => cancel();
const escape = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (gesture || keyboard) cancel();
    else emit("cancelled");
  }
};
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
  () => JSON.stringify(props.geometry.rect),
  () => cancel(),
);
onMounted(() => {
  window.addEventListener("blur", cancelWindow);
  window.addEventListener("resize", cancelWindow);
  window.addEventListener("keydown", escape, true);
});
onBeforeUnmount(() => {
  cancel(false);
  window.removeEventListener("blur", cancelWindow);
  window.removeEventListener("resize", cancelWindow);
  window.removeEventListener("keydown", escape, true);
});
</script>

<template>
  <div
    ref="surface"
    class="photo-focal-overlay"
    role="group"
    :aria-label="t('editor.presentation.focusGroup')"
    @pointerdown="start($event, true)"
    @pointermove="move"
    @pointerup="finish"
    @pointercancel="cancel()"
    @lostpointercapture="cancel()"
  >
    <button
      type="button"
      class="photo-focal-handle"
      :style="marker"
      :aria-disabled="disabled"
      :aria-label="t('editor.presentation.focusPoint')"
      :title="t('editor.presentation.focusHint')"
      @pointerdown.stop="start($event)"
      @keydown="keydown"
      @keyup="keyup"
      @blur="cancel()"
    >
      <span aria-hidden="true">＋</span>
    </button>
  </div>
</template>

<style scoped>
.photo-focal-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  touch-action: none;
}
.photo-focal-handle {
  position: absolute;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--of-radius-sm);
  color: var(--of-accent);
  background: transparent;
  transform: translate(-50%, -50%);
  touch-action: none;
  cursor: crosshair;
}
.photo-focal-handle span {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin: auto;
  border: 1px solid var(--of-accent);
  border-radius: 50%;
  background: var(--of-surface-1);
  font-size: 20px;
  line-height: 1;
}
.photo-focal-handle:focus-visible {
  outline: 2px solid var(--of-accent);
  outline-offset: 1px;
}
</style>
