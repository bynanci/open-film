<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  audioTimingFromHandles,
  hasAudioStream,
  resolveAudioInterval,
  resolveClipAudioRange,
  validateAudioAutomation,
  type Clip,
  type MediaAsset,
} from "@openfilm/core";
import type { AudioHandleFacts } from "@openfilm/application";
import type { TimelineCommand } from "@openfilm/solver";
import { api } from "../api";
import { formatNumber } from "../i18n";
const props = defineProps<{
  projectId: string;
  compositionId: string;
  revision: string;
  compositionDuration: number;
  clip: Clip;
  asset: MediaAsset;
  busy: boolean;
  active: boolean;
  sourceVersion?: number;
  commit: (command: TimelineCommand) => Promise<boolean>;
}>();
const { t } = useI18n(),
  startMs = ref(0),
  endMs = ref(0),
  pending = ref(false),
  error = ref(false),
  facts = ref<AudioHandleFacts>(),
  checking = ref(false),
  unavailable = ref(false);
let generation = 0,
  disposed = false,
  controller: AbortController | undefined;
const locked = computed(
  () => !!props.clip.locked || !!props.asset.state.locked,
);
const owner = computed(() =>
  JSON.stringify([
    props.projectId,
    props.compositionId,
    props.revision,
    props.clip.id,
    props.clip.audioTiming,
    props.asset.id,
    props.asset.uri,
    props.asset.contentHash,
    locked.value,
    props.active,
    props.sourceVersion ?? 0,
  ]),
);
watch(
  owner,
  () => {
    const stamp = ++generation;
    controller?.abort();
    controller = new AbortController();
    facts.value = undefined;
    pending.value = false;
    error.value = false;
    unavailable.value = false;
    checking.value = false;
    startMs.value = 0;
    endMs.value = 0;
    if (
      disposed ||
      !props.active ||
      locked.value ||
      !hasAudioStream(props.asset)
    )
      return;
    checking.value = true;
    const signal = controller.signal;
    void api
      .audioHandles(props.compositionId, props.clip.id, props.revision, signal)
      .then((value) => {
        if (disposed || signal.aborted || stamp !== generation) return;
        if (
          value.version !== 1 ||
          value.clipId !== props.clip.id ||
          value.assetId !== props.asset.id ||
          value.revision !== props.revision ||
          value.sampleRate !== 48000 ||
          !Number.isSafeInteger(value.lengthSamples) ||
          value.lengthSamples <= 0 ||
          (props.asset.contentHash &&
            value.sourceHash !== props.asset.contentHash)
        )
          throw new Error("Stale sound handle facts.");
        facts.value = value;
      })
      .catch(() => {
        if (!disposed && !signal.aborted && stamp === generation)
          unavailable.value = true;
      })
      .finally(() => {
        if (stamp === generation) checking.value = false;
      });
  },
  { immediate: true, flush: "sync" },
);
const verifiedAsset = computed(() =>
  facts.value
    ? {
        ...props.asset,
        metadata: {
          ...props.asset.metadata,
          "openfilm.audio.canonical": {
            version: 1,
            lengthSamples: facts.value.lengthSamples,
          },
        },
      }
    : undefined,
);
const candidate = computed(() => {
  if (
    !verifiedAsset.value ||
    !Number.isInteger(startMs.value) ||
    !Number.isInteger(endMs.value) ||
    Math.abs(startMs.value) > 60000 ||
    Math.abs(endMs.value) > 60000
  )
    return undefined;
  try {
    const timing = audioTimingFromHandles(props.clip, verifiedAsset.value, {
        startOffsetMs: startMs.value,
        endOffsetMs: endMs.value,
      }),
      interval = resolveAudioInterval(
        { ...props.clip, audioTiming: timing },
        verifiedAsset.value,
        props.compositionDuration,
      );
    if (props.clip.audioAutomation)
      validateAudioAutomation(
        props.clip.audioAutomation,
        interval.automationDurationSeconds,
      );
    return timing;
  } catch {
    return undefined;
  }
});
const sound = computed(() => {
  try {
    return resolveAudioInterval(
      props.clip,
      verifiedAsset.value ?? props.asset,
      props.compositionDuration,
    );
  } catch {
    return undefined;
  }
});
const remainder = computed(() => ({
  start: (sound.value?.startSample ?? 0) % 48,
  end: (sound.value?.endSample ?? 0) % 48,
}));
const hint = computed(() =>
  locked.value
    ? "locked"
    : !hasAudioStream(props.asset)
      ? "missingStream"
      : checking.value
        ? "checking"
        : unavailable.value
          ? "sourceUnavailable"
          : !candidate.value
            ? "invalidRange"
            : "clockHint",
);
const disabled = computed(
  () =>
    props.busy ||
    pending.value ||
    !props.active ||
    locked.value ||
    checking.value ||
    !facts.value ||
    !candidate.value ||
    (!!props.clip.audioTiming && startMs.value === 0 && endMs.value === 0),
);
const resetRange = computed(() => {
  try {
    return resolveClipAudioRange(props.clip, props.asset);
  } catch {
    return undefined;
  }
});
function offset(which: "start" | "end", event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim(),
    value = /^-?\d+$/.test(raw) ? Number(raw) : NaN;
  if (which === "start") startMs.value = value;
  else endMs.value = value;
  error.value = false;
}
async function save(reset = false) {
  if (
    disposed ||
    props.busy ||
    pending.value ||
    locked.value ||
    !props.active ||
    (!reset && disabled.value) ||
    !facts.value
  )
    return;
  const stamp = generation;
  pending.value = true;
  error.value = false;
  try {
    const accepted = await props.commit({
      type: "audio.timing",
      clipId: props.clip.id,
      timing: reset ? null : candidate.value!,
    });
    if (!disposed && stamp === generation) {
      if (accepted) {
        startMs.value = 0;
        endMs.value = 0;
      } else error.value = true;
    }
  } catch {
    if (!disposed && stamp === generation) error.value = true;
  } finally {
    if (stamp === generation) pending.value = false;
  }
}
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  controller?.abort();
});
defineExpose({ hasPending: pending });
</script>
<template>
  <section
    class="editor-sound-timing"
    :aria-label="t('editor.soundTiming.title')"
    :aria-busy="pending || checking"
  >
    <h4>{{ t("editor.soundTiming.title") }}</h4>
    <p data-testid="sound-state">
      <strong>{{
        t(
          clip.audioTiming
            ? "editor.soundTiming.independent"
            : "editor.soundTiming.linked",
        )
      }}</strong>
    </p>
    <p v-if="sound" class="editor-note">
      {{ t("editor.soundTiming.currentRange") }}
      {{ formatNumber(Math.trunc(sound.startSample / 48)) }}–{{
        formatNumber(Math.trunc(sound.endSample / 48))
      }}
      {{ t("editor.soundTiming.milliseconds") }}
    </p>
    <small
      v-if="remainder.start || remainder.end"
      data-testid="sound-sample-remainder"
      >{{ remainder.start }} / {{ remainder.end }}
      {{ t("editor.soundTiming.sampleRemainder") }}</small
    >
    <p v-if="facts" class="editor-note">
      {{ t("editor.soundTiming.verifiedSource") }}
      {{ formatNumber(Math.floor(facts.lengthSamples / 48)) }}
      {{ t("editor.soundTiming.milliseconds") }}
    </p>
    <fieldset
      class="editor-fields"
      :disabled="busy || pending || locked || checking || !facts || !active"
    >
      <div class="editor-field-pair">
        <label class="editor-field"
          >{{ t("editor.soundTiming.startOffset")
          }}<input
            data-testid="sound-start-ms"
            type="number"
            min="-60000"
            max="60000"
            step="1"
            :value="Number.isFinite(startMs) ? startMs : ''"
            :aria-label="t('editor.soundTiming.startOffset')"
            @input="offset('start', $event)"
        /></label>
        <label class="editor-field"
          >{{ t("editor.soundTiming.endOffset")
          }}<input
            data-testid="sound-end-ms"
            type="number"
            min="-60000"
            max="60000"
            step="1"
            :value="Number.isFinite(endMs) ? endMs : ''"
            :aria-label="t('editor.soundTiming.endOffset')"
            @input="offset('end', $event)"
        /></label>
      </div>
      <button
        type="button"
        class="editor-button primary"
        data-testid="sound-apply"
        :disabled="disabled"
        @click="save()"
      >
        {{
          t(pending ? "editor.soundTiming.saving" : "editor.soundTiming.apply")
        }}
      </button>
      <button
        v-if="clip.audioTiming"
        type="button"
        class="editor-button"
        data-testid="sound-reset"
        :disabled="busy || pending || locked || checking || !facts || !active"
        @click="save(true)"
      >
        {{ t("editor.soundTiming.reset") }}
      </button>
    </fieldset>
    <p class="editor-note" data-testid="sound-hint">
      {{ t(`editor.soundTiming.${hint}`) }}
    </p>
    <p v-if="clip.audioTiming && resetRange" class="editor-note">
      {{ t("editor.soundTiming.resetHint") }}
      {{ formatNumber(Math.round(resetRange.audioStart * 1000)) }}–{{
        formatNumber(Math.round(resetRange.audioEnd * 1000))
      }}
      {{ t("editor.soundTiming.milliseconds") }}
    </p>
    <p class="editor-note" data-testid="sound-split-hint">
      {{ t("editor.soundTiming.splitHint") }}
    </p>
    <p
      v-if="error"
      data-testid="sound-error"
      class="editor-presentation-warnings"
      role="alert"
    >
      {{ t("editor.soundTiming.saveFailed") }}
    </p>
  </section>
</template>
