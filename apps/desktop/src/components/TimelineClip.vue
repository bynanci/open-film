<script setup lang="ts">
import { computed } from "vue";
import type { Clip, MediaAsset } from "@openfilm/core";
import type { SourceStatus } from "../api";
import { useI18n } from "vue-i18n";
import { formatDuration as duration, formatNumber } from "../i18n";
import Icon from "./Icon.vue";

const props = defineProps<{
  clip: Clip;
  selected: boolean;
  assetName?: string;
  thumbnailSrc?: string;
  mediaType?: MediaAsset["mediaType"];
  sourceStatus?: SourceStatus["status"];
}>();
const emit = defineEmits<{
  select: [clip: Clip];
  dragStart: [clipId: string];
  dragEnd: [];
  drop: [targetClip: Clip];
}>();
const { t } = useI18n();
const name = computed(
  () => props.assetName ?? props.clip.title ?? t("editor.media"),
);
</script>

<template>
  <button
    :id="`clip-${clip.id}`"
    class="editor-clip"
    :class="{ selected, locked: clip.locked }"
    :style="{
      width: `${Math.min(240, Math.max(120, clip.timelineDuration * 24))}px`,
    }"
    :aria-label="
      t(clip.locked ? 'editor.clip.selectLocked' : 'editor.clip.select', {
        name,
      })
    "
    :aria-pressed="selected"
    :draggable="!clip.locked"
    @click="emit('select', clip)"
    @dragstart="emit('dragStart', clip.id)"
    @dragend="emit('dragEnd')"
    @dragover.prevent
    @drop.prevent="emit('drop', clip)"
  >
    <img
      v-if="thumbnailSrc"
      :src="thumbnailSrc"
      alt=""
      loading="lazy"
      draggable="false"
    /><span v-else class="editor-source-empty"
      ><Icon :name="mediaType === 'audio' ? 'volume' : 'film'"
    /></span>
    <span
      v-if="sourceStatus && sourceStatus !== 'available'"
      class="editor-clip-source-status"
      >{{
        t(
          sourceStatus === "missing"
            ? "editor.source.missingShort"
            : "editor.source.inaccessibleShort",
        )
      }}</span
    >
    <span v-if="clip.locked" class="editor-clip-badge"
      ><Icon name="lock" :size="11" />{{ t("editor.clip.locked") }}</span
    ><span class="editor-clip-meta"
      ><strong>{{ name }}</strong
      ><small
        >{{ duration(clip.timelineDuration)
        }}<span v-if="clip.transform?.speed && clip.transform.speed !== 1">
          · {{ formatNumber(clip.transform.speed) }}×</span
        ><span v-if="clip.transition">
          · {{ t("editor.clip.fade") }}</span
        ></small
      ></span
    >
  </button>
</template>
