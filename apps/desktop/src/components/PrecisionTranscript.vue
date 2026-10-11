<script setup lang="ts">
import type { TranscriptSegment } from "@openfilm/core";
import { useI18n } from "vue-i18n";

// Waveform hover and trim controls update independently of this read-only page.
// Keep source-time comparisons intact, including overlapping provider words.
defineProps<{
  segments: readonly TranscriptSegment[];
  playhead: number;
  formatTime: (value: number) => string;
}>();
defineEmits<{ seek: [time: number] }>();
const { t } = useI18n();
</script>

<template>
  <div
    v-for="segment in segments"
    :key="segment.id"
    class="precision-segment"
    :class="{
      current: playhead >= segment.start && playhead < segment.end,
    }"
  >
    <button
      class="precision-segment-seek"
      :aria-label="
        t('precision.segment', {
          time: formatTime(segment.start),
          text: segment.text,
        })
      "
      @click="$emit('seek', segment.start)"
    >
      <time>{{ formatTime(segment.start) }}</time
      ><span
        v-if="
          !segment.words?.length || segment.alignmentState === 'text-edited'
        "
        >{{ segment.text }}</span
      >
    </button>
    <p
      v-if="segment.alignmentState === 'text-edited'"
      class="editor-note"
      data-testid="stale-alignment"
    >
      {{ t("transcript.alignmentNotice") }}
    </p>
    <div
      v-if="segment.words?.length && segment.alignmentState !== 'text-edited'"
      class="precision-words"
    >
      <button
        v-for="(word, index) in segment.words"
        :key="index"
        :aria-label="
          t('precision.word', {
            time: formatTime(word.start),
            text: word.text,
          })
        "
        :class="{
          current: playhead >= word.start && playhead < word.end,
        }"
        @click="$emit('seek', word.start)"
      >
        {{ word.text }}
      </button>
    </div>
  </div>
</template>
