<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { SilenceCutProposal } from "@openfilm/core";
import { api, type SilenceAuditionResult } from "../api";
import { localizeError } from "../i18n";
import {
  createRecordAudioPlayback,
  type RecordAudioPlayback,
} from "../recordAudioPlayback";

const props = defineProps<{
  projectId: string;
  compositionId: string;
  revision: string;
  jobId: string;
  reviewId: string;
  proposal: SilenceCutProposal;
  disabled: boolean;
  active: boolean;
}>();
const emit = defineEmits<{ auditionStart: [] }>();
const prepareButton = ref<HTMLButtonElement>();
const { t } = useI18n();
const windowSeconds = ref(0.5);
const seamIndex = ref(0);
const result = ref<SilenceAuditionResult>();
const preparing = ref(false);
const error = ref<unknown>();
const status = ref("ready");
const mode = ref<"before" | "after">();
let generation = 0;
let playbackGeneration = 0;
let controller = new AbortController();
let requestId = crypto.randomUUID();
let playback: RecordAudioPlayback | undefined;
let context: AudioContext | undefined;
const seam = computed(() => result.value?.seams[seamIndex.value]);
const windowValid = computed(
  () =>
    Number.isFinite(windowSeconds.value) &&
    windowSeconds.value >= 0.1 &&
    windowSeconds.value <= 3,
);
const playable = computed(
  () => !!seam.value && !props.disabled && props.active && !preparing.value,
);
function time(sample: number) {
  return (sample / 48000).toFixed(3);
}
function stop() {
  playbackGeneration++;
  playback?.dispose();
  playback = undefined;
  if (context) void context.close().catch(() => {});
  context = undefined;
  mode.value = undefined;
  status.value = "ready";
}
function clear() {
  generation++;
  controller.abort();
  controller = new AbortController();
  stop();
  result.value = undefined;
  preparing.value = false;
  error.value = undefined;
}
function cancel() {
  clear();
  status.value = "cancelled";
  void nextTick(() => prepareButton.value?.focus());
}
async function prepare() {
  if (props.disabled || !props.active || !windowValid.value || preparing.value)
    return;
  stop();
  const stamp = ++generation;
  controller.abort();
  controller = new AbortController();
  preparing.value = true;
  result.value = undefined;
  error.value = undefined;
  try {
    const value = await api.silenceAudition(
      props.jobId,
      {
        reviewId: props.reviewId,
        proposal: props.proposal,
        requestId,
        windowSeconds: windowSeconds.value,
      },
      controller.signal,
    );
    if (stamp !== generation || controller.signal.aborted) return;
    if (
      value.parity !== "renderer" ||
      value.reviewId !== props.reviewId ||
      value.baseRevision !== props.revision ||
      value.requestId !== requestId
    )
      throw new Error("workspace.invalidResponse");
    result.value = value;
    seamIndex.value = 0;
    status.value = "ready";
  } catch (cause) {
    if (stamp === generation && !controller.signal.aborted) {
      error.value = cause;
      status.value = "failed";
    }
  } finally {
    if (stamp === generation) preparing.value = false;
  }
}
async function play(value: "before" | "after") {
  if (!playable.value || !result.value || !seam.value) return;
  stop();
  const stamp = playbackGeneration;
  try {
    emit("auditionStart");
    context = new AudioContext({ sampleRate: 48000 });
    playback = createRecordAudioPlayback({
      context,
      readPcm: api.recordAudioPcm,
      onTime: () => {},
      onState: (state) => {
        if (stamp === playbackGeneration) status.value = state;
      },
    });
    const range = seam.value;
    playback.load(result.value[value]);
    mode.value = value;
    await playback.play(
      value === "before" ? range.beforeStartSample : range.afterStartSample,
      value === "before" ? range.beforeEndSample : range.afterEndSample,
    );
  } catch (cause) {
    if (stamp === playbackGeneration) {
      stop();
      error.value = cause;
      status.value = "failed";
    }
  }
}
watch(
  () => [
    props.projectId,
    props.compositionId,
    props.revision,
    props.jobId,
    props.reviewId,
    props.disabled,
    props.active,
  ],
  () => {
    clear();
    requestId = crypto.randomUUID();
  },
  { flush: "sync" },
);
watch(windowSeconds, () => {
  clear();
  requestId = crypto.randomUUID();
});
watch(seamIndex, stop);
onBeforeUnmount(clear);
defineExpose({ stop });
</script>

<template>
  <section
    class="silence-audition"
    :aria-label="t('precision.silence.audition.title')"
  >
    <h4>{{ t("precision.silence.audition.title") }}</h4>
    <p class="silence-note">
      {{ t("precision.silence.audition.explanation") }}
    </p>
    <div class="silence-audition-actions">
      <label
        >{{ t("precision.silence.audition.window") }}
        <input
          v-model.number="windowSeconds"
          type="number"
          min="0.1"
          max="3"
          step="0.1"
          :disabled="preparing || disabled"
        />
      </label>
      <button
        ref="prepareButton"
        type="button"
        class="editor-button"
        :disabled="disabled || !active || preparing || !windowValid"
        @click="prepare"
      >
        {{
          t(
            error
              ? "precision.silence.audition.retry"
              : "precision.silence.audition.prepare",
          )
        }}
      </button>
      <button
        v-if="preparing"
        type="button"
        class="editor-button"
        @click="cancel"
      >
        {{ t("precision.silence.audition.cancel") }}
      </button>
    </div>
    <p v-if="preparing" role="status">
      {{ t("precision.silence.audition.rendering") }}
    </p>
    <p v-else-if="error" role="alert">{{ localizeError(error) }}</p>
    <template v-if="result">
      <p>
        {{
          t("precision.silence.audition.removed", {
            seconds: time(result.removedSamples),
          })
        }}
      </p>
      <label
        >{{ t("precision.silence.audition.seam") }}
        <select v-model.number="seamIndex" :disabled="!playable">
          <option
            v-for="(item, index) in result.seams"
            :key="index"
            :value="index"
          >
            {{ index + 1 }} · {{ time(item.removedStartSample) }}–{{
              time(item.removedEndSample)
            }}
            s
          </option>
        </select>
      </label>
      <p v-if="seam">
        {{
          t("precision.silence.audition.ranges", {
            beforeStart: time(seam.beforeStartSample),
            beforeEnd: time(seam.beforeEndSample),
            afterStart: time(seam.afterStartSample),
            afterEnd: time(seam.afterEndSample),
          })
        }}
      </p>
      <div
        class="silence-audition-actions"
        role="group"
        :aria-label="t('precision.silence.audition.title')"
      >
        <button
          type="button"
          class="editor-button"
          :disabled="!playable"
          :aria-pressed="mode === 'before'"
          @click="play('before')"
        >
          {{ t("precision.silence.audition.before") }}
        </button>
        <button
          type="button"
          class="editor-button"
          :disabled="!playable"
          :aria-pressed="mode === 'after'"
          @click="play('after')"
        >
          {{ t("precision.silence.audition.after") }}
        </button>
        <button type="button" class="editor-button" @click="stop">
          {{ t("precision.silence.audition.stop") }}
        </button>
      </div>
    </template>
    <p role="status" aria-live="polite">
      {{ t(`precision.silence.audition.status.${status}`) }}
    </p>
    <p class="silence-note">{{ t("precision.silence.audition.manual") }}</p>
  </section>
</template>

<style scoped>
.silence-audition {
  display: grid;
  gap: var(--of-space-2);
  padding-block: var(--of-space-3);
}
.silence-audition h4,
.silence-audition p {
  margin: 0;
}
.silence-audition-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-2);
  align-items: end;
}
.silence-audition label {
  display: grid;
  gap: var(--of-space-1);
  min-width: 0;
}
.silence-audition input,
.silence-audition select {
  min-height: 40px;
  padding: var(--of-space-2) var(--of-space-3);
  color: var(--of-text-primary);
  background: var(--of-surface-2);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-sm);
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.silence-audition input {
  width: 8rem;
  max-width: 100%;
}
.silence-audition input:focus-visible,
.silence-audition select:focus-visible {
  outline: 2px solid var(--of-accent);
  outline-offset: 2px;
}
.silence-audition select {
  max-width: 100%;
}
</style>
