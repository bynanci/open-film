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
import type { Clip, Job, MediaAsset, TimelineMarker } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import { candidatesFromIntelligence, snapTime } from "@openfilm/analysis";
import {
  api,
  request,
  sourceUrl,
  type IntelligenceState,
  type IntelligenceProviders,
} from "../api";
import { errorDetail, formatNumber, localizeError } from "../i18n";
import { waveformPath } from "../waveform";

const props = defineProps<{
  projectId: string;
  asset?: MediaAsset;
  clip?: Clip;
  active: boolean;
  busy: boolean;
  unavailable?: boolean;
  sourceVersion?: number;
  height?: number;
  clips: { id: string; label: string }[];
  submit: (command: TimelineCommand) => boolean;
}>();
const emit = defineEmits<{ select: [clipId: string]; activity: [] }>();
const { t, te } = useI18n();
const player = ref<HTMLMediaElement | null>(null);
const surface = ref<HTMLElement | null>(null);
const data = shallowRef<IntelligenceState | null>(null);
const providers = shallowRef<IntelligenceProviders | null>(null);
const jobs = ref<Job[]>([]);
const error = shallowRef<unknown>(null);
const playbackError = ref(false);
const loading = ref(false);
const sourceVerified = ref(false);
const discoveringJobs = ref(false);
const pending = ref(false);
const playing = ref(false);
const playhead = ref(0);
const hoverTime = ref<number>();
const hoverPreview = ref(false);
const follow = ref(true);
const snapEnabled = ref(true);
const snapResult = ref<{ time: number; type: string }>();
const zoom = ref(1);
const viewStart = ref(0);
const trimIn = ref(0);
const trimOut = ref(0);
const language = ref("auto");
const execution = ref("auto");
const panel = ref<"transcript" | "analysis" | "markers">("transcript");
const pageOffset = ref(0);
const pageSize = 100;
let generation = 0;
let analysisRead = 0;
let jobRead = 0;
let controller = new AbortController();
let polling: ReturnType<typeof setTimeout> | undefined;
let hoverFrame = 0;
let disposed = false;
let drag: { side: "in" | "out"; snapshot: string; pointerId: number } | null =
  null;

const supported = computed(
  () =>
    !!props.asset &&
    !!props.clip &&
    (props.asset.mediaType === "video" || props.asset.mediaType === "audio"),
);
const sourceDuration = computed(() =>
  Math.max(0, props.asset?.duration ?? props.clip?.sourceOut ?? 0),
);
const playable = computed(
  () => supported.value && !props.unavailable && sourceDuration.value > 0,
);
const editable = computed(
  () =>
    playable.value &&
    sourceVerified.value &&
    !props.clip?.locked &&
    !props.busy,
);
const canSplit = computed(
  () =>
    editable.value &&
    !props.asset?.state.locked &&
    playhead.value > trimIn.value &&
    playhead.value < trimOut.value,
);
const sourceKey = computed(
  () =>
    `${props.projectId}:${props.asset?.id}:${props.asset?.uri}:${props.asset?.contentHash}:${props.sourceVersion ?? 0}`,
);
const clipSnapshot = computed(() =>
  JSON.stringify([
    sourceKey.value,
    props.clip?.id,
    props.clip?.sourceIn,
    props.clip?.sourceOut,
    props.clip?.transform?.speed,
    props.clip?.locked,
  ]),
);
const frameStep = computed(() =>
  props.asset?.frameRate && props.asset.frameRate > 0
    ? 1 / props.asset.frameRate
    : 0.01,
);
// Numeric trims can create valid sub-frame ranges. Keep each handle's bounds
// ordered even when that range is shorter than the usual 10ms separation.
const trimSeparation = computed(() =>
  Math.min(
    frameStep.value,
    0.01,
    Math.max(0, trimOut.value - trimIn.value) / 2,
  ),
);
const viewDuration = computed(() =>
  Math.min(
    sourceDuration.value,
    Math.max(frameStep.value * 4, sourceDuration.value / zoom.value),
  ),
);
const viewEnd = computed(() => viewStart.value + viewDuration.value);
const markers = computed(() => {
  const all = [
    ...(data.value?.markers ?? []),
    ...(data.value?.scenes?.markers ?? []),
  ];
  return [...new Map(all.map((marker) => [marker.id, marker])).values()].sort(
    (a, b) => a.time - b.time,
  );
});
const visibleMarkers = computed(() =>
  markers.value.filter(
    (marker) => marker.time >= viewStart.value && marker.time <= viewEnd.value,
  ),
);
const candidates = computed(() =>
  candidatesFromIntelligence(markers.value, data.value?.transcript, [
    props.clip?.sourceIn ?? 0,
    props.clip?.sourceOut ?? sourceDuration.value,
  ]),
);
const activeJobs = computed(() =>
  jobs.value.filter(
    (job) => job.status === "queued" || job.status === "running",
  ),
);
const transcript = computed(() => data.value?.transcript?.segments ?? []);
const clipTime = computed(() => {
  if (
    !props.clip ||
    playhead.value < (props.clip.sourceIn ?? 0) ||
    playhead.value > (props.clip.sourceOut ?? sourceDuration.value)
  )
    return undefined;
  return (
    (playhead.value - (props.clip.sourceIn ?? 0)) /
    (props.clip.transform?.speed ?? 1)
  );
});
const wavePath = computed(() =>
  waveformPath(data.value?.waveform, viewStart.value, viewDuration.value),
);
const silent = computed(
  () =>
    !!data.value?.waveform &&
    data.value.waveform.peaks.every((peak) => peak === 0),
);
function time(value: number) {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const milliseconds = Math.round(safe * 1000);
  return `${String(Math.floor(milliseconds / 60000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}
function clamp(value: number, minimum = 0, maximum = sourceDuration.value) {
  return Math.min(maximum, Math.max(minimum, value));
}
function x(value: number) {
  return clamp(
    ((value - viewStart.value) / Math.max(viewDuration.value, 0.001)) * 800,
    0,
    800,
  );
}
function percentage(value: number) {
  return `${x(value) / 8}%`;
}
function inView(value: number) {
  return value >= viewStart.value && value <= viewEnd.value;
}
function endpoint(path = "") {
  return `/assets/${encodeURIComponent(props.asset!.id)}${path}`;
}
function current(stamp: number) {
  return (
    !disposed &&
    props.active &&
    stamp === generation &&
    !controller.signal.aborted
  );
}
function haltPolling() {
  if (polling) clearTimeout(polling);
  polling = undefined;
}
function handleError(cause: unknown, readFailed = false) {
  error.value = cause;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? cause.code
      : undefined;
  if (
    code === "source.changed" ||
    code === "media.missing" ||
    (readFailed && !sourceVerified.value)
  ) {
    analysisRead++;
    loading.value = false;
    sourceVerified.value = false;
    data.value = null;
    pageOffset.value = 0;
    snapResult.value = undefined;
    cancelDrag();
  }
}
async function loadAnalysis(offset = pageOffset.value) {
  if (!props.active || !supported.value) return;
  const stamp = generation;
  const read = ++analysisRead;
  const assetId = props.asset!.id;
  loading.value = true;
  try {
    const result = await api.intelligence(
      assetId,
      offset,
      pageSize,
      controller.signal,
    );
    if (!current(stamp) || read !== analysisRead) return;
    data.value = result;
    sourceVerified.value = true;
    error.value = null;
    pageOffset.value = result.transcriptOffset;
  } catch (cause) {
    if (current(stamp) && read === analysisRead) handleError(cause, true);
  } finally {
    if (current(stamp) && read === analysisRead) loading.value = false;
  }
}
async function loadProviders() {
  const stamp = generation;
  try {
    const result = await api.intelligenceProviders(controller.signal);
    if (current(stamp)) providers.value = result;
  } catch (cause) {
    if (current(stamp)) error.value = cause;
  }
}
async function pollJobs(hydrate = false) {
  haltPolling();
  if (!props.active || (!hydrate && !activeJobs.value.length)) return;
  const stamp = generation;
  const read = ++jobRead;
  if (hydrate) discoveringJobs.value = true;
  try {
    const response = await request<{ jobs: Job[] }>("/jobs", {
      signal: controller.signal,
    });
    if (!current(stamp) || read !== jobRead) return;
    let finished = false;
    const scoped = response.jobs.filter(
      (job) =>
        job.assetId === props.asset?.id &&
        ["transcribe", "waveform", "scenes"].includes(job.type),
    );
    jobs.value = [
      ...new Map(
        [
          ...jobs.value,
          ...scoped.filter(
            (job) => !jobs.value.some((existing) => existing.id === job.id),
          ),
        ].map((job) => [job.id, job]),
      ).values(),
    ];
    jobs.value = jobs.value.map((previous) => {
      const next =
        response.jobs.find((job) => job.id === previous.id) ?? previous;
      if (previous.status !== next.status) {
        emit("activity");
        if (next.status === "completed") finished = true;
        if (next.status === "failed")
          handleError(next.errors?.[0] ?? { code: "operation.failed" });
      }
      return next;
    });
    // A job may have completed while this source was hidden or before hydration.
    if (
      finished ||
      (hydrate && scoped.some((job) => job.status === "completed"))
    )
      await loadAnalysis(finished ? 0 : pageOffset.value);
  } catch (cause) {
    if (current(stamp) && read === jobRead) handleError(cause);
  } finally {
    if (current(stamp) && read === jobRead) discoveringJobs.value = false;
  }
  if (current(stamp) && read === jobRead && activeJobs.value.length)
    polling = setTimeout(() => void pollJobs(), 1000);
}
async function analyze(operation: "transcribe" | "waveform" | "scenes") {
  if (
    !playable.value ||
    pending.value ||
    discoveringJobs.value ||
    activeJobs.value.length
  )
    return;
  const stamp = generation;
  pending.value = true;
  error.value = null;
  try {
    const result = await request<{ job: Job }>(endpoint("/intelligence"), {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        operation,
        ...(operation === "transcribe"
          ? { language: language.value, execution: execution.value }
          : {}),
      }),
    });
    if (!current(stamp)) return;
    jobs.value = [
      ...jobs.value.filter(
        (job) => job.status === "queued" || job.status === "running",
      ),
      result.job,
    ];
    emit("activity");
    if (result.job.status === "completed") await loadAnalysis(0);
    else if (result.job.status === "failed")
      handleError(result.job.errors?.[0] ?? { code: "operation.failed" });
    else void pollJobs();
  } catch (cause) {
    if (current(stamp)) handleError(cause);
  } finally {
    if (current(stamp)) pending.value = false;
  }
}
async function cancelJob(job: Job) {
  const stamp = generation;
  try {
    await request(`/jobs/${encodeURIComponent(job.id)}/cancel`, {
      method: "POST",
      signal: controller.signal,
      body: "{}",
    });
    if (current(stamp)) {
      emit("activity");
      void pollJobs();
    }
  } catch (cause) {
    if (current(stamp)) handleError(cause);
  }
}
async function addMarker(at = playhead.value) {
  if (!playable.value || !sourceVerified.value || pending.value) return;
  const stamp = generation;
  pending.value = true;
  try {
    await request(endpoint("/markers"), {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({ time: clamp(at) }),
    });
    if (current(stamp)) {
      await loadAnalysis();
      emit("activity");
    }
  } catch (cause) {
    if (current(stamp)) handleError(cause);
  } finally {
    if (current(stamp)) pending.value = false;
  }
}
async function removeMarker(marker: TimelineMarker) {
  if (!sourceVerified.value || marker.type !== "manual" || pending.value)
    return;
  const stamp = generation;
  pending.value = true;
  try {
    await request(endpoint(`/markers/${encodeURIComponent(marker.id)}`), {
      method: "DELETE",
      signal: controller.signal,
    });
    if (current(stamp)) {
      await loadAnalysis();
      emit("activity");
    }
  } catch (cause) {
    if (current(stamp)) handleError(cause);
  } finally {
    if (current(stamp)) pending.value = false;
  }
}
function jobLabel(job: Job) {
  if (job.status !== "queued" && job.status !== "running")
    return t(`precision.jobStatus.${job.status}`);
  const stage = job.stage;
  return stage && te(`precision.jobStage.${stage}`)
    ? t(`precision.jobStage.${stage}`)
    : t(`precision.jobStatus.${job.status}`);
}
function seek(value: number, pause = true) {
  if (!Number.isFinite(value) || !playable.value) return;
  const next = clamp(value);
  if (player.value) {
    if (pause) player.value.pause();
    try {
      player.value.currentTime = next;
    } catch {
      /* Metadata may still be loading. */
    }
  }
  playhead.value = next;
}
function configurePlayback() {
  if (!player.value) return;
  // Precision navigation is in original source time, regardless of timeline speed.
  player.value.playbackRate = 1;
  player.value.volume = props.clip?.transform?.volume ?? 1;
}
function loaded() {
  configurePlayback();
  seek(playhead.value);
}
function updatedTime() {
  if (!player.value) return;
  playhead.value = player.value.currentTime;
  if (
    follow.value &&
    playing.value &&
    (playhead.value < viewStart.value || playhead.value > viewEnd.value)
  )
    viewStart.value = clamp(
      playhead.value - viewDuration.value * 0.5,
      0,
      Math.max(0, sourceDuration.value - viewDuration.value),
    );
}
function togglePlayback() {
  if (!player.value || !playable.value) return;
  if (!player.value.paused) player.value.pause();
  else
    void player.value.play().catch(() => {
      playbackError.value = true;
    });
}
function zoomBy(factor: number) {
  const center = playhead.value;
  zoom.value = clamp(zoom.value * factor, 1, 64);
  viewStart.value = clamp(
    center - viewDuration.value / 2,
    0,
    Math.max(0, sourceDuration.value - viewDuration.value),
  );
}
function pointerTime(event: PointerEvent | MouseEvent) {
  const rect = surface.value!.getBoundingClientRect();
  return clamp(
    viewStart.value +
      ((event.clientX - rect.left) / Math.max(1, rect.width)) *
        viewDuration.value,
  );
}
function snapped(value: number, minimum = 0, maximum = sourceDuration.value) {
  if (!sourceVerified.value || !snapEnabled.value) {
    snapResult.value = undefined;
    return clamp(value, minimum, maximum);
  }
  const threshold =
    (viewDuration.value / Math.max(1, surface.value?.clientWidth ?? 800)) * 8;
  const result = snapTime(value, candidates.value, {
    threshold,
    min: minimum,
    max: maximum,
  });
  snapResult.value =
    result.snapped && result.candidate
      ? { time: result.time, type: result.candidate.type }
      : undefined;
  return result.time;
}
function startDrag(event: PointerEvent, side: "in" | "out") {
  if (!editable.value || !surface.value) return;
  event.preventDefault();
  event.stopPropagation();
  player.value?.pause();
  drag = { side, snapshot: clipSnapshot.value, pointerId: event.pointerId };
  surface.value.setPointerCapture(event.pointerId);
}
function movePointer(event: PointerEvent) {
  const at = pointerTime(event);
  hoverTime.value = at;
  if (drag) {
    const epsilon = trimSeparation.value;
    if (drag.side === "in")
      trimIn.value = snapped(at, 0, trimOut.value - epsilon);
    else
      trimOut.value = snapped(at, trimIn.value + epsilon, sourceDuration.value);
    seek(drag.side === "in" ? trimIn.value : trimOut.value);
  } else if (hoverPreview.value && !playing.value) {
    cancelAnimationFrame(hoverFrame);
    hoverFrame = requestAnimationFrame(() => seek(at));
  }
}
function finishDrag(event: PointerEvent) {
  const captured = drag;
  drag = null;
  if (surface.value?.hasPointerCapture(event.pointerId))
    surface.value.releasePointerCapture(event.pointerId);
  if (captured && captured.snapshot === clipSnapshot.value) applyTrim();
}
function cancelDrag() {
  drag = null;
  trimIn.value = props.clip?.sourceIn ?? 0;
  trimOut.value = props.clip?.sourceOut ?? sourceDuration.value;
}
function applyTrim() {
  if (!editable.value || !props.clip) return;
  if (
    !props.submit({
      type: "trim",
      clipId: props.clip.id,
      sourceIn: Number(trimIn.value),
      sourceOut: Number(trimOut.value),
    })
  )
    cancelDrag();
}
function moveTrim(event: KeyboardEvent, side: "in" | "out") {
  if (
    !editable.value ||
    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  const minimum = side === "in" ? 0 : trimIn.value + trimSeparation.value;
  const maximum =
    side === "in" ? trimOut.value - trimSeparation.value : sourceDuration.value;
  const previous = side === "in" ? trimIn.value : trimOut.value;
  // A deliberate one-frame key step must not snap back onto its own edge.
  snapResult.value = undefined;
  const next =
    event.key === "Home"
      ? minimum
      : event.key === "End"
        ? maximum
        : clamp(
            previous +
              (event.key === "ArrowRight" ? 1 : -1) *
                frameStep.value *
                (event.shiftKey ? 10 : 1),
            minimum,
            maximum,
          );
  if (side === "in") trimIn.value = next;
  else trimOut.value = next;
  applyTrim();
}
function split() {
  if (!canSplit.value || !props.clip) return;
  props.submit({
    type: "clip.split",
    clipId: props.clip.id,
    sourceTime: playhead.value,
  });
}
function keyboard(event: KeyboardEvent) {
  if (
    !props.active ||
    event.defaultPrevented ||
    !playable.value ||
    document.querySelector('[aria-modal="true"], dialog[open]')
  )
    return;
  const element = event.target as HTMLElement | null;
  if (
    element?.closest("input, textarea, select, [contenteditable='true']") ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return;
  if (event.code === "Space" && !element?.closest("button")) {
    event.preventDefault();
    togglePlayback();
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    seek(
      playhead.value +
        (event.key === "ArrowRight" ? 1 : -1) *
          (event.shiftKey ? 1 : frameStep.value),
    );
  }
  if (event.key.toLowerCase() === "b") {
    event.preventDefault();
    split();
  }
  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    void addMarker();
  }
}
// Both editors stay mounted, so Story volume changes must update this player
// even when no source range or lock changed and no loadedmetadata event fires.
watch([player, () => props.clip?.transform?.volume], configurePlayback);
watch(
  clipSnapshot,
  () => {
    cancelDrag();
    snapResult.value = undefined;
  },
  { immediate: true },
);
watch(
  () => props.clip?.id,
  () => {
    playhead.value = props.clip?.sourceIn ?? 0;
    viewStart.value = clamp(
      playhead.value - viewDuration.value / 4,
      0,
      Math.max(0, sourceDuration.value - viewDuration.value),
    );
    void nextTick(loaded);
  },
);
watch(
  [sourceKey, () => props.active],
  ([key, active], previous) => {
    generation++;
    controller.abort();
    controller = new AbortController();
    haltPolling();
    pending.value = false;
    loading.value = false;
    sourceVerified.value = false;
    data.value = null;
    snapResult.value = undefined;
    cancelDrag();
    discoveringJobs.value = false;
    player.value?.pause();
    if (!previous || key !== previous[0]) {
      jobs.value = [];
      providers.value = null;
      error.value = null;
      playbackError.value = false;
      pageOffset.value = 0;
      zoom.value = 1;
      viewStart.value = 0;
      playhead.value = props.clip?.sourceIn ?? 0;
    }
    if (active && supported.value) {
      void nextTick(loaded);
      void loadAnalysis();
      void loadProviders();
      void pollJobs(true);
    }
  },
  { immediate: true },
);
onMounted(() => window.addEventListener("keydown", keyboard));
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  controller.abort();
  haltPolling();
  cancelAnimationFrame(hoverFrame);
  window.removeEventListener("keydown", keyboard);
  player.value?.pause();
});
</script>

<template>
  <section
    class="precision-editor"
    :style="{ '--precision-height': `${Math.max(416, height ?? 480)}px` }"
    :aria-label="t('precision.title')"
  >
    <div class="precision-source-picker">
      <label class="editor-field"
        >{{ t("precision.selectedClip")
        }}<select
          :value="clip?.id ?? ''"
          @change="emit('select', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="option in clips" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select></label
      >
    </div>
    <div v-if="!supported || !playable" class="editor-empty">
      <h3>{{ t("precision.emptyTitle") }}</h3>
      <p>
        {{
          t(
            unavailable
              ? "precision.sourceUnavailable"
              : "precision.emptyDescription",
          )
        }}
      </p>
    </div>
    <template v-else>
      <div
        v-if="error || playbackError"
        class="editor-message error"
        role="alert"
      >
        <span>{{
          error ? localizeError(error) : t("precision.playbackError")
        }}</span>
        <details v-if="error">
          <summary>{{ t("precision.details") }}</summary>
          <pre>{{ errorDetail(error) }}</pre>
        </details>
      </div>
      <div class="precision-grid">
        <div class="precision-player-region">
          <video
            v-if="active && asset!.mediaType === 'video'"
            ref="player"
            :key="sourceKey"
            :src="sourceUrl(asset!.id, sourceKey)"
            controls
            preload="metadata"
            :aria-label="t('precision.sourcePreview')"
            @loadedmetadata="loaded"
            @timeupdate="updatedTime"
            @play="playing = true"
            @pause="playing = false"
            @error="playbackError = true"
          />
          <audio
            v-else-if="active && asset!.mediaType === 'audio'"
            ref="player"
            :key="sourceKey"
            :src="sourceUrl(asset!.id, sourceKey)"
            controls
            preload="metadata"
            :aria-label="t('precision.sourcePreview')"
            @loadedmetadata="loaded"
            @timeupdate="updatedTime"
            @play="playing = true"
            @pause="playing = false"
            @error="playbackError = true"
          />
          <div class="precision-transport">
            <button
              class="editor-button"
              :aria-label="t('precision.frameBack')"
              @click="seek(playhead - frameStep)"
            >
              −1</button
            ><button class="editor-button" @click="togglePlayback">
              {{ t(playing ? "precision.pause" : "precision.play") }}</button
            ><button
              class="editor-button"
              :aria-label="t('precision.frameForward')"
              @click="seek(playhead + frameStep)"
            >
              +1</button
            ><span class="precision-time"
              >{{ t("precision.sourceTime", { time: time(playhead) })
              }}<small>{{
                clipTime === undefined
                  ? t("precision.outsideClip")
                  : t("precision.clipTime", { time: time(clipTime) })
              }}</small></span
            >
          </div>
        </div>
        <aside class="precision-panel">
          <div class="precision-panel-tabs">
            <button
              v-for="tab in ['transcript', 'analysis', 'markers'] as const"
              :key="tab"
              :aria-pressed="panel === tab"
              :class="{ selected: panel === tab }"
              @click="panel = tab"
            >
              {{ t(`precision.${tab}`) }}
            </button>
          </div>
          <section
            v-if="panel === 'transcript'"
            class="precision-transcript"
            :aria-label="t('precision.transcript')"
          >
            <p class="editor-note">{{ t("precision.transcriptHint") }}</p>
            <p v-if="loading" role="status">{{ t("precision.loading") }}</p>
            <template v-if="data?.transcript"
              ><p class="editor-note">
                {{
                  t(
                    "precision.transcriptCount",
                    { count: formatNumber(data.transcriptTotal) },
                    data.transcriptTotal,
                  )
                }}
              </p>
              <div
                v-for="segment in transcript"
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
                      time: time(segment.start),
                      text: segment.text,
                    })
                  "
                  @click="seek(segment.start)"
                >
                  <time>{{ time(segment.start) }}</time
                  ><span v-if="!segment.words?.length">{{ segment.text }}</span>
                </button>
                <div v-if="segment.words?.length" class="precision-words">
                  <button
                    v-for="(word, index) in segment.words"
                    :key="index"
                    :aria-label="
                      t('precision.word', {
                        time: time(word.start),
                        text: word.text,
                      })
                    "
                    :class="{
                      current: playhead >= word.start && playhead < word.end,
                    }"
                    @click="seek(word.start)"
                  >
                    {{ word.text }}
                  </button>
                </div>
              </div>
              <p v-if="!transcript.length" class="editor-note">
                {{ t("precision.transcriptEmpty") }}
              </p>
              <div class="editor-actions">
                <button
                  class="editor-button"
                  :disabled="loading || pageOffset === 0"
                  @click="loadAnalysis(Math.max(0, pageOffset - pageSize))"
                >
                  {{ t("precision.previousPage") }}</button
                ><button
                  class="editor-button"
                  :disabled="
                    loading || pageOffset + pageSize >= data.transcriptTotal
                  "
                  @click="loadAnalysis(pageOffset + pageSize)"
                >
                  {{ t("precision.nextPage") }}
                </button>
              </div></template
            ><template v-else
              ><p class="editor-note">{{ t("precision.transcriptMissing") }}</p>
              <button class="editor-button" @click="panel = 'analysis'">
                {{ t("precision.analysis") }}
              </button></template
            >
          </section>
          <section
            v-else-if="panel === 'analysis'"
            class="precision-analysis"
            :aria-label="t('precision.analysis')"
          >
            <p role="status">
              {{
                t(
                  providers === null
                    ? "precision.loading"
                    : providers.transcription.available
                      ? "precision.modelReady"
                      : "precision.modelMissing",
                )
              }}
            </p>
            <p
              v-if="providers && !providers.transcription.available"
              class="editor-note"
            >
              {{ t("precision.modelSetup") }}
            </p>
            <label class="editor-field"
              >{{ t("precision.language")
              }}<select v-model="language">
                <option value="auto">{{ t("precision.languageAuto") }}</option>
                <option value="zh">{{ t("precision.languageZh") }}</option>
                <option value="en">{{ t("precision.languageEn") }}</option>
                <option value="ja">{{ t("precision.languageJa") }}</option>
              </select></label
            ><label class="editor-field"
              >{{ t("precision.execution")
              }}<select v-model="execution">
                <option value="auto">{{ t("precision.executionAuto") }}</option>
                <option value="cpu">{{ t("precision.executionCpu") }}</option>
                <option value="gpu">{{ t("precision.executionGpu") }}</option>
              </select></label
            ><button
              class="editor-button primary"
              :disabled="
                !providers?.transcription.available ||
                pending ||
                discoveringJobs ||
                !!activeJobs.length
              "
              @click="analyze('transcribe')"
            >
              {{ t("precision.transcribe") }}
            </button>
            <div class="editor-actions">
              <button
                class="editor-button"
                :disabled="pending || discoveringJobs || !!activeJobs.length"
                @click="analyze('waveform')"
              >
                {{ t("precision.analyzeWaveform") }}</button
              ><button
                v-if="asset!.mediaType === 'video'"
                class="editor-button"
                :disabled="pending || discoveringJobs || !!activeJobs.length"
                @click="analyze('scenes')"
              >
                {{ t("precision.detectScenes") }}
              </button>
            </div>
            <button
              class="editor-button"
              :disabled="loading"
              @click="loadAnalysis()"
            >
              {{ t("precision.refresh") }}
            </button>
            <details class="editor-technical-details">
              <summary>{{ t("precision.details") }}</summary>
              <dl>
                <dt>{{ t("precision.provider") }}</dt>
                <dd>{{ providers?.transcription.providerId }}</dd>
                <dt>{{ t("precision.model") }}</dt>
                <dd>{{ providers?.transcription.model ?? "—" }}</dd>
              </dl>
              <p>{{ providers?.transcription.detail }}</p>
              <button class="editor-button" @click="loadProviders">
                {{ t("precision.refreshProvider") }}
              </button>
            </details>
          </section>
          <section
            v-else
            class="precision-markers"
            :aria-label="t('precision.markers')"
          >
            <p class="editor-note">
              {{
                t(
                  "precision.markersInView",
                  { count: formatNumber(visibleMarkers.length) },
                  visibleMarkers.length,
                )
              }}
            </p>
            <p v-if="!markers.length" class="editor-note">
              {{ t("precision.noMarkers") }}
            </p>
            <div
              v-for="marker in visibleMarkers"
              :key="marker.id"
              class="precision-marker"
            >
              <button class="editor-button" @click="seek(marker.time)">
                {{
                  marker.label ||
                  t("precision.markerAt", { time: time(marker.time) })
                }}</button
              ><button
                v-if="marker.type === 'manual'"
                class="editor-button danger"
                :aria-label="
                  t('precision.removeMarker', { time: time(marker.time) })
                "
                :disabled="!sourceVerified || pending"
                @click="removeMarker(marker)"
              >
                ×
              </button>
            </div>
          </section>
          <div
            v-for="job in jobs"
            :key="job.id"
            class="precision-job"
            :data-job-id="job.id"
            role="status"
          >
            <span>{{ jobLabel(job) }}</span
            ><progress
              :value="job.progress"
              max="1"
              :aria-label="jobLabel(job)"
            /><span v-if="job.progress !== undefined">{{
              formatNumber(job.progress, {
                style: "percent",
                maximumFractionDigits: 0,
              })
            }}</span
            ><button
              v-if="job.status === 'queued' || job.status === 'running'"
              class="editor-button"
              @click="cancelJob(job)"
            >
              {{ t("precision.cancelJob") }}
            </button>
            <details
              v-if="job.execution || job.model || job.fallbackReason"
              class="editor-technical-details"
            >
              <summary>{{ t("precision.details") }}</summary>
              <dl>
                <template v-if="job.execution">
                  <dt>{{ t("precision.execution") }}</dt>
                  <dd>
                    {{
                      t(
                        job.execution === "gpu"
                          ? "precision.executionGpu"
                          : "precision.executionCpu",
                      )
                    }}
                  </dd>
                </template>
                <template v-if="job.model">
                  <dt>{{ t("precision.model") }}</dt>
                  <dd>{{ job.model }}</dd>
                </template>
              </dl>
              <p v-if="job.fallbackReason">{{ job.fallbackReason }}</p>
            </details>
          </div>
        </aside>
        <div class="precision-source-timeline">
          <div class="precision-wave-toolbar">
            <div class="editor-actions">
              <button
                class="editor-button"
                :disabled="zoom <= 1"
                @click="zoomBy(0.5)"
              >
                {{ t("precision.zoomOut") }}</button
              ><button
                class="editor-button"
                :disabled="zoom >= 64"
                @click="zoomBy(2)"
              >
                {{ t("precision.zoomIn") }}</button
              ><button
                class="editor-button"
                @click="
                  zoom = 1;
                  viewStart = 0;
                "
              >
                {{ t("precision.wholeSource") }}
              </button>
            </div>
            <label
              ><input
                v-model="snapEnabled"
                type="checkbox"
                :disabled="!sourceVerified"
              />{{ t("precision.snap") }}</label
            ><label
              ><input v-model="follow" type="checkbox" />{{
                t("precision.follow")
              }}</label
            ><label
              ><input v-model="hoverPreview" type="checkbox" />{{
                t("precision.hoverPreview")
              }}</label
            >
          </div>
          <div
            ref="surface"
            class="precision-waveform"
            role="group"
            tabindex="0"
            :aria-label="t('precision.waveform')"
            @pointerdown="seek(snapped(pointerTime($event)))"
            @pointermove="movePointer"
            @pointerleave="hoverTime = undefined"
            @pointerup="finishDrag"
            @pointercancel="cancelDrag"
            @dblclick="addMarker(pointerTime($event))"
          >
            <svg
              viewBox="0 0 800 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect
                :x="x(trimIn)"
                y="0"
                :width="Math.max(0, x(trimOut) - x(trimIn))"
                height="100"
                class="precision-selected-range"
              />
              <path :d="wavePath" class="precision-wave-path" />
              <line
                v-for="marker in visibleMarkers.slice(0, 200)"
                :key="marker.id"
                :x1="x(marker.time)"
                :x2="x(marker.time)"
                y1="4"
                y2="96"
                class="precision-marker-line"
              />
              <line
                v-if="inView(playhead)"
                :x1="x(playhead)"
                :x2="x(playhead)"
                y1="0"
                y2="100"
                class="precision-playhead"
              />
              <line
                v-if="hoverTime !== undefined"
                :x1="x(hoverTime)"
                :x2="x(hoverTime)"
                y1="0"
                y2="100"
                class="precision-hover"
              />
            </svg>
            <p v-if="!data?.waveform" class="precision-wave-empty">
              {{ t("precision.waveformMissing") }}
            </p>
            <p v-else-if="silent" class="precision-wave-empty">
              {{ t("precision.audioSilent") }}
            </p>
            <button
              v-if="inView(trimIn)"
              class="precision-trim-handle in"
              role="slider"
              :style="{ left: percentage(trimIn) }"
              :aria-label="t('precision.trimIn')"
              :aria-valuenow="trimIn"
              :aria-valuemin="0"
              :aria-valuemax="trimOut"
              :aria-valuetext="time(trimIn)"
              :disabled="!editable"
              @pointerdown="startDrag($event, 'in')"
              @keydown="moveTrim($event, 'in')"
            />
            <button
              v-if="inView(trimOut)"
              class="precision-trim-handle out"
              role="slider"
              :style="{ left: percentage(trimOut) }"
              :aria-label="t('precision.trimOut')"
              :aria-valuenow="trimOut"
              :aria-valuemin="trimIn"
              :aria-valuemax="sourceDuration"
              :aria-valuetext="time(trimOut)"
              :disabled="!editable"
              @pointerdown="startDrag($event, 'out')"
              @keydown="moveTrim($event, 'out')"
            />
            <span v-if="hoverTime !== undefined" class="precision-hover-time">{{
              time(hoverTime)
            }}</span>
          </div>
          <div class="precision-ruler">
            <span>{{ time(viewStart) }}</span
            ><span>{{ time(viewEnd) }}</span>
          </div>
          <label v-if="zoom > 1" class="precision-view-start"
            ><span>{{ t("precision.viewStart") }}</span
            ><input
              v-model.number="viewStart"
              type="range"
              min="0"
              :max="Math.max(0, sourceDuration - viewDuration)"
              :step="frameStep"
          /></label>
          <div class="precision-trim-controls">
            <label class="editor-field"
              >{{ t("precision.trimIn")
              }}<input
                v-model.number="trimIn"
                type="number"
                min="0"
                :max="trimOut"
                step="0.001"
                :disabled="!editable"
                @change="applyTrim" /></label
            ><label class="editor-field"
              >{{ t("precision.trimOut")
              }}<input
                v-model.number="trimOut"
                type="number"
                :min="trimIn"
                :max="sourceDuration"
                step="0.001"
                :disabled="!editable"
                @change="applyTrim" /></label
            ><button
              class="editor-button"
              :disabled="!editable || playhead >= trimOut"
              @click="
                trimIn = playhead;
                applyTrim();
              "
            >
              {{ t("precision.setIn") }}</button
            ><button
              class="editor-button"
              :disabled="!editable || playhead <= trimIn"
              @click="
                trimOut = playhead;
                applyTrim();
              "
            >
              {{ t("precision.setOut") }}</button
            ><button class="editor-button" :disabled="!canSplit" @click="split">
              {{ t("precision.split") }}</button
            ><button
              class="editor-button"
              :disabled="!sourceVerified || pending"
              @click="addMarker()"
            >
              {{ t("precision.addMarker") }}
            </button>
          </div>
          <p v-if="clip?.locked" class="editor-note">
            {{ t("precision.locked") }}
          </p>
          <p v-else-if="asset?.state.locked" class="editor-note">
            {{ t("precision.assetLocked") }}
          </p>
          <p v-if="snapResult" class="precision-snap-result" role="status">
            {{
              t("precision.snapResult", {
                type: te(`precision.snapTypes.${snapResult.type}`)
                  ? t(`precision.snapTypes.${snapResult.type}`)
                  : t("precision.snap"),
                time: time(snapResult.time),
              })
            }}
          </p>
          <p class="editor-note">{{ t("precision.snapScope") }}</p>
        </div>
      </div>
      <p class="precision-shortcuts">{{ t("precision.shortcuts") }}</p>
    </template>
  </section>
</template>
