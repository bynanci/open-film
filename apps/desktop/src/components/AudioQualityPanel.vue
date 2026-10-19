<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AudioQualityReport } from "@openfilm/application";
import type { TimelineCommand } from "@openfilm/solver";
import { api } from "../api";
const props = defineProps<{
  projectId: string;
  compositionId: string;
  revision: string;
  clipId: string;
  disabled: boolean;
}>();
const emit = defineEmits<{ apply: [command: TimelineCommand] }>();
const { t } = useI18n();
const report = ref<AudioQualityReport>();
const busy = ref(false);
const failed = ref(false);
const applied = ref(false);
const variant = ref<"original" | "candidate">("original");
const time = ref(0);
let controller: AbortController | undefined;
let generation = 0;
function reset() {
  generation++;
  controller?.abort();
  report.value = undefined;
  busy.value = false;
  applied.value = false;
  time.value = 0;
}
watch(
  () => [props.projectId, props.compositionId, props.revision, props.clipId],
  reset,
);
onBeforeUnmount(reset);
async function run() {
  reset();
  const token = generation;
  controller = new AbortController();
  busy.value = true;
  failed.value = false;
  variant.value = "original";
  try {
    const result = await api.audioQuality(
      props.compositionId,
      props.clipId,
      props.revision,
      controller.signal,
    );
    if (token === generation) report.value = result;
  } catch {
    if (token === generation) failed.value = true;
  } finally {
    if (token === generation) busy.value = false;
  }
}
const measured = computed(() =>
  variant.value === "candidate"
    ? report.value?.candidate
    : report.value?.original,
);
const level = computed(() => {
  const bins = measured.value?.meterBins ?? [];
  return (
    [...bins].reverse().find((bin) => bin.at <= time.value)?.peakDbfs ?? -60
  );
});
const media = computed(() =>
  report.value
    ? `/api/audio-quality/${report.value.id}/${variant.value}?projectId=${encodeURIComponent(props.projectId)}`
    : "",
);
function format(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(1);
}
function accept() {
  const review = report.value;
  if (
    !review?.canAccept ||
    !review.suggestion ||
    props.disabled ||
    review.baseRevision !== props.revision ||
    applied.value
  )
    return;
  applied.value = true;
  emit("apply", {
    type: "volume",
    clipId: review.clipId,
    volume: review.suggestion.volume,
    audioReviewId: review.id,
  });
}
</script>
<template>
  <section
    class="audio-quality-panel"
    :aria-label="t('editor.audioQuality.title')"
  >
    <strong>{{ t("editor.audioQuality.title") }}</strong>
    <p>{{ t("editor.audioQuality.help") }}</p>
    <button
      class="editor-button"
      :disabled="busy || disabled || !clipId"
      data-testid="audio-quality-measure"
      @click="run"
    >
      {{ t("editor.audioQuality.measure") }}
    </button>
    <button v-if="busy" class="editor-button" @click="reset">
      {{ t("editor.audioQuality.cancel") }}
    </button>
    <p v-if="busy" role="status">{{ t("editor.audioQuality.running") }}</p>
    <p v-if="failed" role="alert">{{ t("editor.audioQuality.failed") }}</p>
    <template v-if="report">
      <div role="group" :aria-label="t('editor.audioQuality.audition')">
        <button
          class="editor-button"
          :aria-pressed="variant === 'original'"
          @click="
            variant = 'original';
            time = 0;
          "
        >
          {{ t("editor.audioQuality.original") }}
        </button>
        <button
          class="editor-button"
          :disabled="!report.candidate"
          :aria-pressed="variant === 'candidate'"
          @click="
            variant = 'candidate';
            time = 0;
          "
        >
          {{ t("editor.audioQuality.candidate") }}
        </button>
      </div>
      <audio
        :key="media"
        controls
        preload="none"
        :src="media"
        :aria-label="t('editor.audioQuality.audition')"
        @timeupdate="time = ($event.target as HTMLAudioElement).currentTime"
      />
      <label
        >{{ t("editor.audioQuality.meter") }}
        <meter
          min="-60"
          max="0"
          low="-24"
          high="-1"
          optimum="-16"
          :value="level"
          :aria-label="t('editor.audioQuality.meter')"
        />
        {{ format(level) }} dBFS</label
      >
      <dl>
        <dt>Integrated LUFS</dt>
        <dd>{{ format(measured?.integratedLufs) }}</dd>
        <dt>Sample peak dBFS</dt>
        <dd>{{ format(measured?.samplePeakDbfs) }}</dd>
        <dt>True peak dBTP</dt>
        <dd>{{ format(measured?.truePeakDbtp) }}</dd>
      </dl>
      <p v-if="report.suggestion">
        {{
          t("editor.audioQuality.suggestion", {
            role: t(`editor.sound.roles.${report.suggestion.role}`),
            target: report.suggestion.targetLufs,
            gain: format(report.suggestion.gainDb),
          })
        }}
      </p>
      <ul>
        <li v-for="issue in report.issues" :key="issue">
          {{ t(`editor.audioQuality.issues.${issue}`) }}
        </li>
      </ul>
      <button
        class="editor-button"
        data-testid="audio-quality-accept"
        :disabled="disabled || applied || !report.canAccept"
        @click="accept"
      >
        {{ t("editor.audioQuality.accept") }}
      </button>
    </template>
  </section>
</template>
<style scoped>
.audio-quality-panel {
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  max-height: 28rem;
  overflow: auto;
}
.audio-quality-panel p {
  max-width: 75ch;
  line-height: 1.6;
}
.audio-quality-panel audio {
  display: block;
  margin-block: 0.75rem;
  max-width: 100%;
}
.audio-quality-panel dl {
  display: grid;
  grid-template-columns: max-content 6rem;
  gap: 0.25rem 1rem;
}
.audio-quality-panel dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.audio-quality-panel button {
  margin-inline-end: 0.5rem;
}
</style>
