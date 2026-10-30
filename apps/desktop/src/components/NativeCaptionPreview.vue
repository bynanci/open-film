<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  captionFrameRange,
  resolveProjectTimebase,
  sequenceFrameAt,
  type Clip,
  type Composition,
} from "@openfilm/core";
import { nativeTextOverlay, nativeTextInspection } from "../api";
const props = defineProps<{
  composition: Composition;
  compositionId: string;
  projectId: string;
  revision: string;
  frame: number;
  frameRate: number;
  frameWidth?: number;
  frameHeight?: number;
  captionTrackId?: string | null;
  active: boolean;
  player?: HTMLMediaElement | null;
  clip?: Clip;
}>();
const { t } = useI18n();
const images = ref<Array<{ id: string; text: string; src: string }>>([]),
  failed = ref(false),
  limited = ref(false),
  fallback = ref(false),
  clock = ref<number>();
let controller: AbortController | undefined,
  generation = 0,
  animation = 0;
function stopClock() {
  cancelAnimationFrame(animation);
  animation = 0;
}
watch(
  () => [props.player, props.clip?.id] as const,
  (_value, _previous, cleanup) => {
    stopClock();
    clock.value = undefined;
    const player = props.player;
    if (!player) return;
    const sync = () => {
      clock.value = player.currentTime;
    };
    const tick = () => {
      sync();
      if (!player.paused && !player.ended)
        animation = requestAnimationFrame(tick);
    };
    const play = () => {
      stopClock();
      tick();
    };
    const pause = () => {
      stopClock();
      sync();
    };
    player.addEventListener("play", play);
    player.addEventListener("pause", pause);
    player.addEventListener("seeked", sync);
    player.addEventListener("ended", pause);
    if (!player.paused) play();
    else sync();
    cleanup(() => {
      stopClock();
      player.removeEventListener("play", play);
      player.removeEventListener("pause", pause);
      player.removeEventListener("seeked", sync);
      player.removeEventListener("ended", pause);
    });
  },
  { immediate: true },
);
const outputFrame = computed(() => {
  if (clock.value === undefined || !props.clip) return props.frame;
  const time =
    props.clip.timelineStart +
    (clock.value - (props.clip.sourceIn ?? 0)) /
      (props.clip.transform?.speed ?? 1);
  return sequenceFrameAt(
    Math.max(0, time),
    resolveProjectTimebase({ width: 1, height: 1, frameRate: props.frameRate }),
  );
});
const track = computed(() =>
  props.captionTrackId === null
    ? undefined
    : props.captionTrackId === undefined
      ? props.composition.captionTracks?.[0]
      : props.composition.captionTracks?.find(
          (item) => item.id === props.captionTrackId,
        ),
);
const cues = computed(() =>
  [...(track.value?.cues ?? [])]
    .filter((item) => {
      const range = captionFrameRange(
        item.startMs,
        item.endMs,
        props.frameRate,
      );
      return (
        outputFrame.value >= range.startFrame &&
        outputFrame.value < range.endFrame
      );
    })
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs),
);
const scope = computed(() =>
  JSON.stringify([
    props.projectId,
    props.compositionId,
    props.revision,
    props.captionTrackId,
    props.active,
    props.frameRate,
    track.value?.id,
    cues.value.map((cue) => cue.id),
    props.frameWidth,
    props.frameHeight,
  ]),
);
function clear() {
  generation++;
  controller?.abort();
  controller = undefined;
  for (const image of images.value) URL.revokeObjectURL(image.src);
  images.value = [];
  failed.value = false;
  limited.value = false;
  fallback.value = false;
}
async function load() {
  const selected = cues.value;
  if (!props.active || !track.value || !selected.length) return;
  // Fail explicitly instead of exhausting decoded image memory or omitting cues.
  if (
    selected.length > 32 ||
    selected.length * (props.frameWidth ?? 320) * (props.frameHeight ?? 180) >
      33_177_600
  ) {
    failed.value = true;
    limited.value = true;
    return;
  }
  const current = ++generation,
    owner = scope.value,
    pending = new AbortController();
  controller = pending;
  let prepared: Array<{ id: string; text: string; src: string }> = [],
    candidate = "",
    usedFallback = false;
  try {
    for (const cue of selected) {
      const input = {
        projectId: props.projectId,
        compositionId: props.compositionId,
        revision: props.revision,
        reference: {
          kind: "caption" as const,
          trackId: track.value.id,
          cueId: cue.id,
        },
      };
      const [blob, inspection] = await Promise.all([
        nativeTextOverlay(input, pending.signal),
        nativeTextInspection(input, pending.signal),
      ]);
      if (
        current !== generation ||
        pending.signal.aborted ||
        owner !== scope.value
      )
        return;
      if (inspection.status === "failed") throw new Error(inspection.message);
      candidate = URL.createObjectURL(blob);
      const image = new Image();
      image.src = candidate;
      await image.decode();
      if (
        current !== generation ||
        pending.signal.aborted ||
        owner !== scope.value
      )
        return;
      prepared.push({ id: cue.id, text: cue.text, src: candidate });
      candidate = "";
      usedFallback ||= inspection.runFonts.some(
        (run) => run.diagnostics.length > 0,
      );
    }
    images.value = prepared;
    prepared = [];
    fallback.value = usedFallback;
  } catch {
    if (current === generation && !pending.signal.aborted) failed.value = true;
    pending.abort();
  } finally {
    if (candidate) URL.revokeObjectURL(candidate);
    for (const image of prepared) URL.revokeObjectURL(image.src);
    if (controller === pending) controller = undefined;
  }
}

watch(
  scope,
  () => {
    clear();
    if (
      props.captionTrackId !== undefined &&
      props.captionTrackId !== null &&
      !track.value
    )
      failed.value = true;
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  clear();
  stopClock();
});
</script>
<template>
  <div class="native-caption-layer">
    <img
      v-for="image in images"
      :key="image.id"
      class="native-caption-image"
      data-testid="native-caption-preview"
      :data-cue-id="image.id"
      :src="image.src"
      :alt="image.text"
      draggable="false"
    />
    <p v-if="failed || fallback" class="native-text-status" role="status">
      {{
        t(
          limited
            ? "editor.titleFinishing.previewLimited"
            : failed
              ? "editor.titleFinishing.previewUnavailable"
              : "editor.titleFinishing.fontFallback",
        )
      }}
      <button
        v-if="failed"
        type="button"
        class="editor-button"
        @click="
          clear();
          load();
        "
      >
        {{ t("editor.titleFinishing.retry") }}
      </button>
    </p>
  </div>
</template>
