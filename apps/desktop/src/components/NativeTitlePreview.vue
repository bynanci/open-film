<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { evaluateTitleOpacity, type Clip } from "@openfilm/core";

const props = defineProps<{
  clip: Clip;
  src: string;
  sourceTime: number;
  player?: HTMLMediaElement | null;
}>();
const clock = ref(props.sourceTime);
const requestOwner = useId();
const requestGeneration = ref(0);
watch(
  () => props.src,
  () => requestGeneration.value++,
  { immediate: true },
);
// Undo/Redo can return to the same content revision while its old image request
// is still in flight. Isolate each display generation without changing the
// server-owned project/revision checks or the shared raster cache.
const requestSource = computed(
  () =>
    `${props.src}${props.src.includes("?") ? "&" : "?"}previewRequest=${encodeURIComponent(requestOwner)}-${requestGeneration.value}`,
);
let animation = 0;
function pause() {
  cancelAnimationFrame(animation);
  animation = 0;
}
function sync() {
  clock.value = props.player?.currentTime ?? props.sourceTime;
}
function tick() {
  sync();
  if (props.player && !props.player.paused && !props.player.ended)
    animation = requestAnimationFrame(tick);
  else animation = 0;
}
function play() {
  pause();
  sync();
  if (props.clip.titleStyle?.fadeOut && props.player && !props.player.paused)
    animation = requestAnimationFrame(tick);
}
watch(() => props.sourceTime, sync);
watch(
  () => [props.player, props.clip.id, props.clip.titleStyle?.fadeOut],
  (_next, _previous, cleanup) => {
    pause();
    sync();
    const player = props.player;
    if (!player) return;
    const stopped = () => {
      pause();
      sync();
    };
    player.addEventListener("play", play);
    player.addEventListener("pause", stopped);
    player.addEventListener("ended", stopped);
    player.addEventListener("seeked", sync);
    cleanup(() => {
      pause();
      player.removeEventListener("play", play);
      player.removeEventListener("pause", stopped);
      player.removeEventListener("ended", stopped);
      player.removeEventListener("seeked", sync);
    });
    play();
  },
  { immediate: true },
);
const opacity = computed(() => {
  try {
    return evaluateTitleOpacity(
      props.clip.titleStyle,
      (clock.value - (props.clip.sourceIn ?? 0)) /
        (props.clip.transform?.speed ?? 1),
      props.clip.timelineDuration,
    );
  } catch {
    // The existing title endpoint and inspector expose legacy-style recovery.
    return 1;
  }
});
onBeforeUnmount(pause);
</script>

<template>
  <img
    :key="requestSource"
    crossorigin="anonymous"
    :src="requestSource"
    :alt="clip.title"
    :style="{ opacity }"
    draggable="false"
  />
</template>
