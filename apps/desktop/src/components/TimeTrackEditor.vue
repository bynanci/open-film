<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import type { Clip, Composition, MediaAsset } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import type { SourceStatus } from "../api";
import { formatDuration, formatNumber } from "../i18n";
import {
  canResizeTimelineClip,
  clipTimeLayout,
  previewTimelineResize,
  resizeTimelineClip,
  timelineRuler,
  timelineSecondsFromPixels,
  type TimelineResizeDraft,
  type TimelineResizeEdge,
} from "../timelineInteraction";

const props = defineProps<{
  composition: Composition;
  assets: MediaAsset[];
  selectedClipId: string;
  frameRate: number;
  busy: boolean;
  sourceStatuses?: Record<string, SourceStatus>;
}>();
const emit = defineEmits<{
  select: [clip: Clip];
  commit: [command: TimelineCommand];
  activity: [active: boolean];
}>();
const { t } = useI18n();
const pixelsPerSecond = ref(48);
const scroller = ref<HTMLDivElement | null>(null);
const draft = shallowRef<TimelineResizeDraft | null>(null);
const gesture = shallowRef<{
  clip: Clip;
  asset: MediaAsset;
  edge: TimelineResizeEdge;
  originX: number;
  originScroll: number;
  originRailWidth: number;
  pointerId: number;
  target: HTMLButtonElement;
} | null>(null);
const assetsById = computed(
  () => new Map(props.assets.map((asset) => [asset.id, asset])),
);
const displayedComposition = computed(() =>
  gesture.value && draft.value
    ? previewTimelineResize(
        props.composition,
        gesture.value.clip.id,
        draft.value,
      )
    : props.composition,
);
const ruler = computed(() =>
  timelineRuler(displayedComposition.value.duration, pixelsPerSecond.value),
);
const railWidth = computed(() =>
  Math.max(
    640,
    gesture.value?.originRailWidth ?? 0,
    displayedComposition.value.duration * pixelsPerSecond.value + 100,
  ),
);
const selectedClip = computed(() =>
  displayedComposition.value.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === props.selectedClipId),
);
const time = (seconds: number) => formatDuration(seconds, { fractional: true });
const clipName = (clip: Clip) =>
  assetsById.value.get(clip.assetId)?.name ??
  clip.title ??
  t("editor.timeTrack.unavailable");
const sourceUnavailable = (clip: Clip) => {
  const status = props.sourceStatuses?.[clip.assetId]?.status;
  return !!status && status !== "available";
};
const canResize = (clip: Clip) =>
  !sourceUnavailable(clip) &&
  canResizeTimelineClip(clip, assetsById.value.get(clip.assetId));
// Save-in-flight uses aria-disabled plus handler guards. Native disabled would
// blur the active handle after each keyboard edit and lose the next keypress.
const clipStyle = (clip: Clip) => {
  const { left, width } = clipTimeLayout(clip, pixelsPerSecond.value);
  return { left: `${left}px`, width: `${width}px` };
};

function cancel() {
  const current = gesture.value;
  gesture.value = null;
  draft.value = null;
  if (!current) return;
  if (current.target.hasPointerCapture(current.pointerId))
    current.target.releasePointerCapture(current.pointerId);
  emit("activity", false);
}
defineExpose({ cancel });

function begin(event: PointerEvent, clip: Clip, edge: TimelineResizeEdge) {
  if (
    event.button !== 0 ||
    !event.isPrimary ||
    props.busy ||
    gesture.value ||
    !canResize(clip)
  )
    return;
  event.preventDefault();
  const asset = assetsById.value.get(clip.assetId)!;
  const target = event.currentTarget as HTMLButtonElement;
  emit("select", clip);
  target.focus({ preventScroll: true });
  target.setPointerCapture(event.pointerId);
  // Keep the scroll range stable while shortening the last clip. Otherwise the
  // browser clamps scrollLeft and the next pointer event counts that jump twice.
  const originRailWidth = railWidth.value;
  gesture.value = {
    clip,
    asset,
    edge,
    originX: event.clientX,
    originScroll: scroller.value?.scrollLeft ?? 0,
    originRailWidth,
    pointerId: event.pointerId,
    target,
  };
  draft.value = null;
  emit("activity", true);
}

function move(event: PointerEvent) {
  const current = gesture.value;
  if (!current || event.pointerId !== current.pointerId) return;
  event.preventDefault();
  const pixels =
    event.clientX -
    current.originX +
    (scroller.value?.scrollLeft ?? 0) -
    current.originScroll;
  draft.value = resizeTimelineClip(
    current.clip,
    current.asset,
    current.edge,
    timelineSecondsFromPixels(pixels, pixelsPerSecond.value),
    props.frameRate,
  );
}

function finish(event: PointerEvent) {
  if (event.pointerId !== gesture.value?.pointerId) return;
  move(event);
  const command = draft.value?.command;
  cancel();
  if (command && !props.busy) emit("commit", command);
}

function resizeWithKeyboard(
  event: KeyboardEvent,
  clip: Clip,
  edge: TimelineResizeEdge,
) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  event.stopPropagation();
  if (props.busy || gesture.value || !canResize(clip)) return;
  const fps =
    Number.isFinite(props.frameRate) && props.frameRate > 0
      ? props.frameRate
      : 30;
  const delta =
    ((event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1)) / fps;
  const change = resizeTimelineClip(
    clip,
    assetsById.value.get(clip.assetId),
    edge,
    delta,
    fps,
  );
  emit("select", clip);
  if (change) emit("commit", change.command);
}

function escape(event: KeyboardEvent) {
  if (event.key !== "Escape" || !gesture.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cancel();
}

watch(
  () => [
    props.composition,
    props.assets,
    props.frameRate,
    props.sourceStatuses,
  ],
  cancel,
);
watch(
  () => props.busy,
  (busy) => {
    if (busy) cancel();
  },
);
watch(
  () => props.selectedClipId,
  async (id) => {
    if (gesture.value && gesture.value.clip.id !== id) cancel();
    await nextTick();
    if (!gesture.value)
      scroller.value
        ?.querySelector(".time-track-clip.is-selected")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  },
);
onMounted(() => {
  window.addEventListener("keydown", escape, true);
  window.addEventListener("blur", cancel);
});
onBeforeUnmount(() => {
  cancel();
  window.removeEventListener("keydown", escape, true);
  window.removeEventListener("blur", cancel);
});
</script>

<template>
  <section
    class="time-track-editor"
    :aria-label="t('editor.timeTrack.title')"
    :title="t('editor.timeTrack.help')"
  >
    <div class="time-track-toolbar">
      <div>
        <h3>{{ t("editor.timeTrack.title") }}</h3>
        <p class="sr-only">{{ t("editor.timeTrack.help") }}</p>
      </div>
      <label class="time-track-zoom">
        <span>{{ t("editor.timeTrack.zoom") }}</span>
        <input
          v-model.number="pixelsPerSecond"
          type="range"
          min="24"
          max="120"
          step="8"
          :disabled="busy || !!gesture"
          :aria-label="t('editor.timeTrack.zoom')"
        />
        <output>{{
          t("editor.timeTrack.zoomValue", {
            value: formatNumber(pixelsPerSecond),
          })
        }}</output>
      </label>
    </div>
    <div
      ref="scroller"
      class="time-track-scroller"
      tabindex="0"
      :aria-label="t('editor.timeTrack.title')"
    >
      <div
        class="time-track-surface"
        :style="{ width: `${railWidth + 104}px` }"
      >
        <div class="time-track-ruler-row">
          <span
            class="time-track-lane-label time-track-ruler-corner"
            aria-hidden="true"
          ></span>
          <div
            class="time-track-ruler"
            :style="{ width: `${railWidth}px` }"
            aria-hidden="true"
          >
            <span
              v-for="tick in ruler.ticks"
              :key="tick"
              class="time-track-tick"
              :style="{ left: `${tick * pixelsPerSecond}px` }"
              >{{ time(tick) }}</span
            >
          </div>
        </div>
        <div
          v-for="(track, trackIndex) in displayedComposition.tracks"
          :key="track.id"
          class="time-track-row"
          role="group"
          :aria-label="
            t('editor.timeTrack.trackLabel', {
              type: t(`editor.timeTrack.tracks.${track.type}`),
              index: trackIndex + 1,
            })
          "
        >
          <span class="time-track-lane-label"
            >{{ t(`editor.timeTrack.tracks.${track.type}`) }}
            <small>{{ formatNumber(trackIndex + 1) }}</small></span
          >
          <div
            class="time-track-lane"
            :style="{
              width: `${railWidth}px`,
              backgroundSize: `${ruler.step * pixelsPerSecond}px 100%`,
            }"
          >
            <div
              v-for="clip in track.clips"
              :key="clip.id"
              class="time-track-clip"
              :class="{
                'is-selected': selectedClipId === clip.id,
                'is-narrow': clip.timelineDuration * pixelsPerSecond < 16,
                'is-locked': clip.locked,
                'is-drafting': gesture?.clip.id === clip.id,
                'is-unavailable':
                  sourceUnavailable(clip) || !assetsById.has(clip.assetId),
              }"
              :data-clip-id="clip.id"
              :style="clipStyle(clip)"
            >
              <button
                type="button"
                class="time-track-clip-body"
                :aria-pressed="selectedClipId === clip.id"
                :aria-label="
                  t('editor.timeTrack.clipLabel', {
                    name: clipName(clip),
                    start: time(clip.timelineStart),
                    duration: time(clip.timelineDuration),
                  })
                "
                :title="
                  t('editor.timeTrack.clipLabel', {
                    name: clipName(clip),
                    start: time(clip.timelineStart),
                    duration: time(clip.timelineDuration),
                  })
                "
                :disabled="!!gesture"
                @click="emit('select', clip)"
              >
                <strong>{{ clipName(clip) }}</strong>
                <small
                  >{{ time(clip.timelineDuration)
                  }}<span v-if="clip.locked">
                    · {{ t("editor.timeTrack.locked") }}</span
                  ></small
                >
              </button>
              <button
                v-for="edge in ['start', 'end'] as const"
                :key="edge"
                type="button"
                class="time-track-resize"
                :class="`time-track-resize-${edge}`"
                :disabled="
                  !canResize(gesture?.clip.id === clip.id ? gesture.clip : clip)
                "
                :aria-disabled="
                  busy ||
                  (!!gesture &&
                    (gesture.clip.id !== clip.id || gesture.edge !== edge))
                "
                :tabindex="selectedClipId === clip.id ? 0 : -1"
                :aria-label="
                  t(
                    edge === 'start'
                      ? 'editor.timeTrack.trimStart'
                      : 'editor.timeTrack.trimEnd',
                    { name: clipName(clip) },
                  )
                "
                :title="t('editor.timeTrack.keyboardHelp')"
                @pointerdown.stop="begin($event, clip, edge)"
                @pointermove="move"
                @pointerup="finish"
                @pointercancel="cancel"
                @lostpointercapture="cancel"
                @keydown="resizeWithKeyboard($event, clip, edge)"
                @click.stop
              />
            </div>
          </div>
        </div>
      </div>
      <p
        v-if="!composition.tracks.some((track) => track.clips.length)"
        class="time-track-empty"
      >
        {{ t("editor.timeTrack.empty") }}
      </p>
    </div>
    <div class="time-track-feedback" role="status" aria-live="polite">
      <template v-if="selectedClip">
        <span>{{
          t("editor.timeTrack.selection", {
            name: clipName(selectedClip),
            duration: time(selectedClip.timelineDuration),
          })
        }}</span>
        <span
          v-if="
            draft && assetsById.get(selectedClip.assetId)?.mediaType !== 'image'
          "
          >{{
            t("editor.timeTrack.sourceRange", {
              start: time(draft.sourceIn),
              end: time(draft.sourceOut),
            })
          }}</span
        >
        <span v-if="draft?.bounded" class="time-track-boundary">{{
          t("editor.timeTrack.boundary")
        }}</span>
      </template>
      <span v-else>{{ t("editor.timeTrack.keyboardHelp") }}</span>
    </div>
  </section>
</template>

<style scoped>
.time-track-editor {
  min-width: 0;
  color: var(--editor-text, var(--of-text-primary));
  background: var(--editor-bg, var(--of-surface-1));
  border-block: 1px solid var(--editor-border, var(--of-border-subtle));
}
.time-track-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
}
.time-track-toolbar h3 {
  font-size: 14px;
}
.time-track-toolbar p,
.time-track-feedback,
.time-track-lane-label {
  color: var(--editor-muted, var(--of-text-secondary));
  font-size: 11px;
}
.time-track-toolbar p {
  margin-top: 4px;
}
.time-track-zoom {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
}
.time-track-zoom input {
  width: 104px;
  accent-color: var(--editor-accent, var(--of-accent));
}
.time-track-zoom output {
  min-width: 56px;
  font-variant-numeric: tabular-nums;
}
.time-track-scroller {
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
.time-track-surface {
  min-width: 100%;
}
.time-track-ruler-row,
.time-track-row {
  display: flex;
  position: relative;
}
.time-track-ruler-row {
  height: 30px;
}
.time-track-row {
  min-height: 72px;
  border-top: 1px solid var(--editor-border, var(--of-border-subtle));
}
.time-track-lane-label {
  position: sticky;
  left: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 104px;
  padding: 10px 12px;
  background: var(--editor-panel, var(--of-surface-2));
  border-right: 1px solid var(--editor-border, var(--of-border-subtle));
}
.time-track-lane-label small {
  opacity: 0.65;
}
.time-track-ruler,
.time-track-lane {
  position: relative;
  flex: none;
}
.time-track-tick {
  position: absolute;
  bottom: 0;
  height: 22px;
  padding-left: 5px;
  border-left: 1px solid var(--editor-border, var(--of-border-subtle));
  color: var(--editor-muted, var(--of-text-secondary));
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.time-track-lane {
  height: 71px;
  background-image: linear-gradient(
    to right,
    var(--editor-border, var(--of-border-subtle)) 1px,
    transparent 1px
  );
}
.time-track-clip {
  position: absolute;
  top: 10px;
  height: 51px;
  border: 1px solid var(--editor-border, var(--of-border-subtle));
  border-radius: 5px;
  background: var(--editor-panel, var(--of-surface-2));
}
.time-track-clip.is-selected {
  z-index: 2;
  border-color: var(--editor-accent, var(--of-accent));
  box-shadow: 0 0 0 1px var(--editor-accent, var(--of-accent));
}
.time-track-clip.is-drafting {
  background: var(--editor-accent-soft, var(--of-accent-soft));
}
.time-track-clip.is-unavailable {
  border-style: dashed;
}
.time-track-clip-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  width: 100%;
  height: 100%;
  min-width: 0;
  padding: 6px 10px;
  border: 0;
  border-radius: inherit;
  color: inherit;
  background: transparent;
  text-align: left;
  overflow: hidden;
}
.time-track-clip-body strong,
.time-track-clip-body small {
  display: block;
  max-width: 100%;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
.time-track-clip-body strong {
  font-size: 11px;
  font-weight: 500;
}
.time-track-clip-body small {
  color: var(--editor-muted, var(--of-text-secondary));
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.time-track-resize {
  position: absolute;
  z-index: 3;
  top: 0;
  bottom: 0;
  width: 12px;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 3px;
  color: var(--editor-accent, var(--of-accent));
  background: transparent;
  cursor: ew-resize;
  touch-action: none;
  opacity: 0;
}
.time-track-resize::after {
  content: "";
  position: absolute;
  inset: 13px 5px;
  border-radius: 2px;
  background: currentColor;
}
.time-track-resize-start {
  left: -6px;
}
.time-track-resize-end {
  right: -6px;
}
.time-track-clip.is-narrow .time-track-resize-start {
  bottom: 50%;
}
.time-track-clip.is-narrow .time-track-resize-end {
  top: 50%;
}
.time-track-clip.is-narrow .time-track-resize::after {
  inset: 6px 5px;
}
.time-track-clip:is(.is-selected, :focus-within) .time-track-resize {
  opacity: 1;
}
.time-track-resize:is(:disabled, [aria-disabled="true"]) {
  cursor: default;
}
.time-track-feedback {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  min-height: 35px;
  padding: 9px 20px;
  border-top: 1px solid var(--editor-border, var(--of-border-subtle));
}
.time-track-boundary {
  color: var(--editor-accent, var(--of-accent));
}
.time-track-empty {
  padding: 20px;
  color: var(--editor-muted, var(--of-text-secondary));
}
</style>
