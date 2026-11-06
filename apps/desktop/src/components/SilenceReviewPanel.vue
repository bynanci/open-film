<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  Composition,
  Job,
  MediaAsset,
  SilenceCutCandidate,
} from "@openfilm/core";
import {
  api,
  type SilenceFreshness,
  type SilenceJobState,
  type SilenceReviewState,
  type AnalysisRecoveryInput,
} from "../api";
import { localizeError } from "../i18n";
import AnalysisJobActions from "./AnalysisJobActions.vue";
import SilenceAuditionControls from "./SilenceAuditionControls.vue";

const props = defineProps<{
  projectId: string;
  compositionId: string;
  revision: string;
  composition?: Composition;
  assets: readonly MediaAsset[];
  sourceAssetId?: string;
  active: boolean;
  busy: boolean;
  waveformReady: boolean;
}>();

const emit = defineEmits<{
  selectSource: [assetId: string, clipId: string];
  preview: [assetId: string, start: number, end: number];
  applied: [];
  activity: [];
  auditionStart: [];
  waveformCandidates: [
    assetId: string,
    candidates: (SilenceCutCandidate & { selected: boolean })[],
  ];
}>();

const { t } = useI18n();
const auditionControls = ref<InstanceType<typeof SilenceAuditionControls>>();
const selectedAssetId = ref("");
const thresholdDb = ref(-40);
const minimumSilenceSeconds = ref(0.5);
const paddingSeconds = ref(0.12);
const optionsValid = computed(
  () =>
    Number.isFinite(thresholdDb.value) &&
    thresholdDb.value >= -80 &&
    thresholdDb.value <= -10 &&
    Number.isFinite(minimumSilenceSeconds.value) &&
    minimumSilenceSeconds.value >= 0.1 &&
    minimumSilenceSeconds.value <= 30 &&
    Number.isFinite(paddingSeconds.value) &&
    paddingSeconds.value >= 0 &&
    paddingSeconds.value <= 2,
);
const job = ref<Job>();
const jobState = ref<SilenceJobState>();
const freshness = ref<SilenceFreshness>("unverified");
const reviewState = ref<SilenceReviewState>();
const selectedCandidateIds = ref<string[]>([]);
const pending = ref(false);
const error = ref<unknown>();
const conflict = ref(false);
const confirmation = ref(false);
const accepted = ref(false);
const confirmButton = ref<HTMLButtonElement>();
const acceptOpener = ref<HTMLButtonElement>();
const panelHeading = ref<HTMLHeadingElement>();
const jobActionRecovery = computed(() => jobState.value?.recovery);
const activeJob = computed(
  () => job.value?.status === "queued" || job.value?.status === "running",
);
const sources = computed(() => {
  const assets = new Map(props.assets.map((asset) => [asset.id, asset]));
  const clips = (props.composition?.tracks ?? [])
    .filter((track) => track.timing !== "overlay")
    .flatMap((track) => track.clips);
  const groups = new Map<
    string,
    { asset: MediaAsset; count: number; clipId: string }
  >();
  for (const clip of clips) {
    const asset = assets.get(clip.assetId);
    if (!asset || (asset.mediaType !== "audio" && asset.mediaType !== "video"))
      continue;
    const group = groups.get(asset.id);
    if (group) group.count++;
    else groups.set(asset.id, { asset, count: 1, clipId: clip.id });
  }
  return [...groups.values()].sort((left, right) =>
    left.asset.name.localeCompare(right.asset.name),
  );
});
const selectedSource = computed(() =>
  sources.value.find((entry) => entry.asset.id === selectedAssetId.value),
);
const proposal = computed(() => reviewState.value?.review.proposal);
const candidates = computed(() => proposal.value?.candidates ?? []);
const selectedIds = computed(() => new Set(selectedCandidateIds.value));
const selectedCandidates = computed(() =>
  candidates.value.filter((candidate) => selectedIds.value.has(candidate.id)),
);
const selectedTimelineIntervals = computed(() =>
  mergeIntervals(
    selectedCandidates.value.flatMap(
      (candidate) => candidate.timelineIntervals,
    ),
  ),
);
const estimatedDuration = computed(() =>
  selectedTimelineIntervals.value.reduce(
    (sum, range) => sum + range.end - range.start,
    0,
  ),
);
const hasSelectionChanges = computed(
  () =>
    !!proposal.value &&
    JSON.stringify(selectedCandidateIds.value) !==
      JSON.stringify(proposal.value.selectedCandidateIds),
);
const currentReview = computed(
  () => job.value?.status === "waiting-review" && !!proposal.value,
);
const canRevise = computed(
  () =>
    currentReview.value &&
    hasSelectionChanges.value &&
    freshness.value === "current" &&
    !pending.value &&
    !props.busy,
);
const canAccept = computed(
  () =>
    currentReview.value &&
    !hasSelectionChanges.value &&
    freshness.value === "current" &&
    (proposal.value?.timelineIntervals.length ?? 0) > 0 &&
    !accepted.value &&
    !pending.value &&
    !props.busy,
);
const statusKey = computed(() => {
  if (accepted.value || job.value?.status === "completed")
    return "precision.silence.status.applied";
  if (freshness.value === "stale") return "precision.silence.status.stale";
  if (freshness.value === "unverified" && job.value)
    return "precision.silence.status.unverified";
  if (!job.value) return "precision.silence.status.idle";
  if (job.value.status === "waiting-review")
    return "precision.silence.status.waitingReview";
  if (job.value.status === "failed") return "precision.silence.status.failed";
  if (job.value.status === "cancelled")
    return "precision.silence.status.cancelled";
  if (
    activeJob.value &&
    jobState.value?.recovery?.ownerState === "alive" &&
    !jobState.value.recovery.canCancel
  )
    return "precision.silence.status.otherProcess";
  return `precision.silence.status.${job.value.status}`;
});

let generation = 0;
let disposed = false;
let controller = new AbortController();
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let createRequest: { key: string; requestId: string } | undefined;
let reviseRequest: { key: string; requestId: string } | undefined;
let retryRequest: { jobId: string; requestId: string } | undefined;
let applyRequestId: string | undefined;

function newRequestId() {
  return crypto.randomUUID();
}

function mergeIntervals(ranges: readonly { start: number; end: number }[]) {
  const result: { start: number; end: number }[] = [];
  for (const range of [...ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )) {
    const last = result.at(-1);
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

function time(value: number) {
  const milliseconds = Math.max(0, Math.round(value * 1000));
  return `${String(Math.floor(milliseconds / 60000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

function current(stamp: number) {
  return !disposed && stamp === generation && !controller.signal.aborted;
}

function haltPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = undefined;
}

function publishCandidates() {
  if (!selectedAssetId.value) return;
  const selected = selectedIds.value;
  emit(
    "waveformCandidates",
    selectedAssetId.value,
    candidates.value.map((candidate) => ({
      ...candidate,
      selected: selected.has(candidate.id),
    })),
  );
}

function resetForContext() {
  generation++;
  controller.abort();
  controller = new AbortController();
  haltPolling();
  job.value = undefined;
  jobState.value = undefined;
  reviewState.value = undefined;
  pending.value = false;
  freshness.value = "unverified";
  selectedCandidateIds.value = [];
  accepted.value = false;
  confirmation.value = false;
  error.value = undefined;
  conflict.value = false;
  createRequest = undefined;
  reviseRequest = undefined;
  retryRequest = undefined;
  applyRequestId = undefined;
  selectedReviewJob.value = undefined;
  if (selectedAssetId.value)
    emit("waveformCandidates", selectedAssetId.value, []);
}

async function refreshJob(jobId: string, stamp = generation) {
  haltPolling();
  try {
    const result = await api.silenceJob(jobId, controller.signal);
    if (!current(stamp)) return;
    jobState.value = result;
    job.value = result.job;
    freshness.value = result.freshness;
    if (
      result.job.status === "waiting-review" ||
      result.job.status === "completed"
    ) {
      const saved = await api.silenceReview(jobId, controller.signal);
      if (!current(stamp)) return;
      reviewState.value = saved;
      freshness.value = saved.freshness;
      if (job.value?.id !== saved.job.id) return;
      if (
        saved.job.id !== selectedReviewJob.value ||
        selectedReviewJob.value === undefined
      ) {
        selectedCandidateIds.value = [
          ...saved.review.proposal.selectedCandidateIds,
        ];
        selectedReviewJob.value = saved.job.id;
        publishCandidates();
      }
    } else {
      reviewState.value = undefined;
      selectedReviewJob.value = undefined;
    }
    error.value = undefined;
    conflict.value = false;
  } catch (cause) {
    if (current(stamp)) showError(cause);
  }
  if (
    current(stamp) &&
    (job.value?.status === "queued" || job.value?.status === "running")
  )
    pollTimer = setTimeout(() => void refreshJob(jobId, stamp), 900);
}

const selectedReviewJob = ref<string>();

function showError(cause: unknown) {
  error.value = cause;
  conflict.value =
    typeof cause === "object" && cause !== null && "status" in cause
      ? Number((cause as { status?: unknown }).status) === 409
      : false;
}

async function discover() {
  const stamp = generation;
  if (!props.active || !selectedAssetId.value || !props.compositionId) return;
  try {
    const result = await api.jobs(controller.signal);
    if (!current(stamp)) return;
    const latest = result.jobs
      .filter(
        (entry) =>
          entry.type === "silence-analysis" &&
          entry.assetId === selectedAssetId.value &&
          entry.silenceAnalysis?.projectId === props.projectId &&
          entry.silenceAnalysis?.compositionId === props.compositionId,
      )
      .sort((left, right) =>
        (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
      )[0];
    if (latest) {
      job.value = latest;
      void refreshJob(latest.id, stamp);
    }
  } catch (cause) {
    if (current(stamp)) showError(cause);
  }
}

async function analyze() {
  if (
    !selectedSource.value ||
    !optionsValid.value ||
    !props.active ||
    props.busy ||
    activeJob.value ||
    pending.value
  )
    return;
  const options = {
    thresholdDb: thresholdDb.value,
    minimumSilenceSeconds: minimumSilenceSeconds.value,
    paddingSeconds: paddingSeconds.value,
  };
  const key = JSON.stringify([
    props.projectId,
    props.compositionId,
    selectedAssetId.value,
    options,
  ]);
  if (!createRequest || createRequest.key !== key)
    createRequest = { key, requestId: newRequestId() };
  const stamp = generation;
  pending.value = true;
  error.value = undefined;
  try {
    const result = await api.silenceCreate(
      {
        projectId: props.projectId,
        requestId: createRequest.requestId,
        assetId: selectedAssetId.value,
        compositionId: props.compositionId,
        options,
      },
      controller.signal,
    );
    if (!current(stamp)) return;
    createRequest = undefined;
    job.value = result.job;
    freshness.value = result.freshness;
    reviewState.value = undefined;
    selectedReviewJob.value = undefined;
    selectedCandidateIds.value = [];
    accepted.value = false;
    applyRequestId = undefined;
    emit("activity");
    await refreshJob(result.job.id, stamp);
  } catch (cause) {
    if (current(stamp)) showError(cause);
  } finally {
    if (current(stamp)) pending.value = false;
  }
}

function toggleCandidate(candidateId: string, keep: boolean) {
  const next = new Set(selectedCandidateIds.value);
  if (keep) next.add(candidateId);
  else next.delete(candidateId);
  selectedCandidateIds.value = candidates.value
    .filter((candidate) => next.has(candidate.id))
    .map((candidate) => candidate.id);
  reviseRequest = undefined;
  applyRequestId = undefined;
  publishCandidates();
}

async function createSelectionReview() {
  if (!canRevise.value || !job.value || !reviewState.value) return;
  const input = {
    reviewId: reviewState.value.review.reviewId,
    selectedCandidateIds: [...selectedCandidateIds.value],
  };
  const key = JSON.stringify([job.value.id, input]);
  if (!reviseRequest || reviseRequest.key !== key)
    reviseRequest = { key, requestId: newRequestId() };
  const stamp = generation;
  pending.value = true;
  error.value = undefined;
  try {
    const result = await api.silenceRevise(
      job.value.id,
      {
        ...input,
        requestId: reviseRequest.requestId,
      },
      controller.signal,
    );
    if (!current(stamp)) return;
    reviseRequest = undefined;
    job.value = result.job;
    reviewState.value = undefined;
    selectedReviewJob.value = undefined;
    freshness.value = "current";
    emit("activity");
    await refreshJob(result.job.id, stamp);
  } catch (cause) {
    if (current(stamp)) showError(cause);
  } finally {
    if (current(stamp)) pending.value = false;
  }
}

async function cancelJob() {
  if (!job.value || pending.value) return;
  const stamp = generation;
  pending.value = true;
  try {
    const result = await api.silenceCancel(job.value.id, controller.signal);
    if (!current(stamp)) return;
    job.value = result.job;
    emit("activity");
    await refreshJob(result.job.id, stamp);
  } catch (cause) {
    if (current(stamp)) showError(cause);
  } finally {
    if (current(stamp)) pending.value = false;
  }
}

async function retryJob() {
  if (!job.value || pending.value) return;
  if (retryRequest?.jobId !== job.value.id)
    retryRequest = { jobId: job.value.id, requestId: newRequestId() };
  const stamp = generation;
  pending.value = true;
  error.value = undefined;
  try {
    const result = await api.silenceRetry(
      job.value.id,
      retryRequest.requestId,
      controller.signal,
    );
    if (!current(stamp)) return;
    retryRequest = undefined;
    job.value = result.job;
    reviewState.value = undefined;
    selectedReviewJob.value = undefined;
    freshness.value = "current";
    emit("activity");
    await refreshJob(result.job.id, stamp);
  } catch (cause) {
    if (current(stamp)) showError(cause);
  } finally {
    if (current(stamp)) pending.value = false;
  }
}

async function recoverJob(input: AnalysisRecoveryInput) {
  if (!job.value || pending.value || !input.confirmStopped) return;
  const stamp = generation;
  pending.value = true;
  try {
    const result = await api.silenceRecover(
      job.value.id,
      { ...input, confirmStopped: true },
      controller.signal,
    );
    if (!current(stamp)) return;
    job.value = result.job;
    emit("activity");
    await refreshJob(result.job.id, stamp);
  } catch (cause) {
    if (current(stamp)) showError(cause);
  } finally {
    if (current(stamp)) pending.value = false;
  }
}

function openConfirmation() {
  if (!canAccept.value) return;
  acceptOpener.value = document.activeElement as HTMLButtonElement;
  confirmation.value = true;
  void nextTick(() => confirmButton.value?.focus());
}

function closeConfirmation() {
  confirmation.value = false;
  void nextTick(() => acceptOpener.value?.focus());
}

async function acceptReview() {
  if (!canAccept.value || !job.value || !reviewState.value || !proposal.value)
    return;
  const stamp = generation;
  pending.value = true;
  error.value = undefined;
  applyRequestId ??= newRequestId();
  try {
    const result = await api.silenceApply(
      job.value.id,
      {
        reviewId: reviewState.value.review.reviewId,
        proposal: reviewState.value.review.proposal,
        requestId: applyRequestId,
      },
      controller.signal,
    );
    if (!current(stamp)) return;
    job.value = result.job;
    freshness.value = "current";
    accepted.value = true;
    confirmation.value = false;
    emit("waveformCandidates", selectedAssetId.value, []);
    emit("applied");
    emit("activity");
    void nextTick(() => panelHeading.value?.focus());
  } catch (cause) {
    if (current(stamp)) showError(cause);
  } finally {
    if (current(stamp)) pending.value = false;
  }
}

function chooseSource() {
  const entry = selectedSource.value;
  if (entry) emit("selectSource", entry.asset.id, entry.clipId);
}

function confirmationKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && !pending.value) {
    event.preventDefault();
    closeConfirmation();
    return;
  }
  if (event.key !== "Tab") return;
  const dialog = document.querySelector<HTMLElement>(".silence-confirmation");
  if (!dialog) return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  sources,
  (items) => {
    if (!items.some((item) => item.asset.id === selectedAssetId.value))
      selectedAssetId.value =
        items.find((item) => item.asset.id === props.sourceAssetId)?.asset.id ??
        items[0]?.asset.id ??
        "";
  },
  { immediate: true },
);
watch(
  () => props.sourceAssetId,
  (assetId) => {
    if (assetId && sources.value.some((entry) => entry.asset.id === assetId))
      selectedAssetId.value = assetId;
  },
);
watch(selectedAssetId, (assetId) => {
  if (assetId && assetId !== props.sourceAssetId) chooseSource();
});
watch(
  [() => props.projectId, () => props.compositionId, selectedAssetId],
  (next, previous) => {
    const [projectId, compositionId, assetId] = next;
    if (
      !previous ||
      projectId !== previous[0] ||
      compositionId !== previous[1] ||
      assetId !== previous[2]
    ) {
      resetForContext();
      if (props.active && assetId) void discover();
    }
  },
  { immediate: true, flush: "sync" },
);
watch(
  () => props.revision,
  () => {
    if (job.value && props.active) void refreshJob(job.value.id);
  },
);
watch(
  () => props.active,
  (active) => {
    generation++;
    controller.abort();
    controller = new AbortController();
    haltPolling();
    pending.value = false;
    if (active && selectedAssetId.value) void discover();
  },
);
watch(selectedCandidateIds, publishCandidates);
watch(confirmation, (open) => {
  if (open) {
    void nextTick(() => confirmButton.value?.focus());
    document.addEventListener("keydown", confirmationKeydown);
  } else document.removeEventListener("keydown", confirmationKeydown);
});

onBeforeUnmount(() => {
  disposed = true;
  generation++;
  controller.abort();
  haltPolling();
  document.removeEventListener("keydown", confirmationKeydown);
});
</script>

<template>
  <section class="silence-review" :aria-label="t('precision.silence.title')">
    <div class="silence-heading">
      <div>
        <p class="silence-eyebrow">{{ t("precision.silence.eyebrow") }}</p>
        <h3 ref="panelHeading" tabindex="-1">
          {{ t("precision.silence.title") }}
        </h3>
      </div>
      <span
        class="silence-status"
        :class="{ stale: freshness === 'stale', applied: accepted }"
        role="status"
        aria-live="polite"
      >
        {{ t(statusKey) }}
      </span>
    </div>

    <template v-if="sources.length">
      <label class="editor-field">
        {{ t("precision.silence.source") }}
        <select
          v-model="selectedAssetId"
          :aria-label="t('precision.silence.source')"
          :disabled="pending"
        >
          <option
            v-for="entry in sources"
            :key="entry.asset.id"
            :value="entry.asset.id"
          >
            {{ entry.asset.name }} ·
            {{ t("precision.silence.clipCount", { count: entry.count }) }}
          </option>
        </select>
      </label>
      <div
        class="silence-options"
        role="group"
        :aria-label="t('precision.silence.parameters')"
      >
        <label class="editor-field">
          {{ t("precision.silence.threshold") }}
          <span class="silence-number">
            <input
              v-model.number="thresholdDb"
              type="number"
              min="-80"
              max="-10"
              step="1"
              :aria-label="t('precision.silence.threshold')"
              :disabled="activeJob || pending"
            />
            <span>dB</span>
          </span>
        </label>
        <label class="editor-field">
          {{ t("precision.silence.minimum") }}
          <span class="silence-number">
            <input
              v-model.number="minimumSilenceSeconds"
              type="number"
              min="0.1"
              max="30"
              step="0.1"
              :aria-label="t('precision.silence.minimum')"
              :disabled="activeJob || pending"
            />
            <span>s</span>
          </span>
        </label>
        <label class="editor-field">
          {{ t("precision.silence.padding") }}
          <span class="silence-number">
            <input
              v-model.number="paddingSeconds"
              type="number"
              min="0"
              max="2"
              step="0.01"
              :aria-label="t('precision.silence.padding')"
              :disabled="activeJob || pending"
            />
            <span>s</span>
          </span>
        </label>
      </div>
      <p class="silence-note">{{ t("precision.silence.measurementNote") }}</p>
      <div class="silence-actions">
        <button
          class="editor-button primary"
          :disabled="
            !active ||
            busy ||
            pending ||
            activeJob ||
            !selectedSource ||
            !optionsValid
          "
          @click="analyze"
        >
          {{ t("precision.silence.analyze") }}
        </button>
        <button
          v-if="job && ['failed', 'cancelled'].includes(job.status)"
          class="editor-button"
          :disabled="pending || busy"
          @click="retryJob"
        >
          {{ t("precision.silence.retry") }}
        </button>
        <button
          v-if="job"
          class="editor-button"
          :disabled="pending || busy"
          @click="refreshJob(job.id)"
        >
          {{ t("precision.silence.reconnect") }}
        </button>
      </div>
      <AnalysisJobActions
        v-if="job && activeJob"
        :project-id="projectId"
        :job="job"
        :recovery="jobActionRecovery"
        :pending="pending"
        :disabled="busy"
        @cancel="cancelJob"
        @recover="recoverJob"
      />

      <p
        v-if="job?.status === 'running'"
        class="silence-progress"
        role="status"
      >
        <span>{{
          t("precision.silence.progress", {
            progress: Math.round((job.progress ?? 0) * 100),
          })
        }}</span>
        <progress
          :value="job.progress ?? 0"
          max="1"
          :aria-label="t('precision.silence.progressLabel')"
        />
      </p>
      <p v-if="job?.errors?.length" class="silence-error" role="alert">
        {{ localizeError(job.errors.at(-1)) }}
      </p>
      <p v-if="conflict" class="silence-error" role="alert">
        {{ t("precision.silence.conflict") }}
      </p>
      <p v-else-if="error" class="silence-error" role="alert">
        {{ localizeError(error) }}
      </p>

      <section
        v-if="reviewState && proposal"
        class="silence-review-content"
        :aria-label="t('precision.silence.review')"
      >
        <div class="silence-summary" aria-live="polite">
          <div>
            <strong>{{
              t("precision.silence.candidateCount", {
                count: selectedCandidates.length,
              })
            }}</strong
            ><span>{{ t("precision.silence.candidateCountLabel") }}</span>
          </div>
          <div>
            <strong>{{
              t("precision.silence.duration", { time: time(estimatedDuration) })
            }}</strong
            ><span>{{ t("precision.silence.durationLabel") }}</span>
          </div>
          <div>
            <strong>{{
              t("precision.silence.duration", {
                time: time(proposal.totalDurationReduced),
              })
            }}</strong
            ><span>{{ t("precision.silence.savedDurationLabel") }}</span>
          </div>
        </div>
        <p v-if="!waveformReady" class="silence-note" role="status">
          {{ t("precision.silence.waveformHint") }}
        </p>
        <ol
          class="silence-candidates"
          :aria-label="t('precision.silence.candidateList')"
        >
          <li
            v-for="(candidate, index) in candidates"
            :key="candidate.id"
            class="silence-candidate"
          >
            <label class="silence-candidate-toggle">
              <input
                type="checkbox"
                :checked="selectedIds.has(candidate.id)"
                :disabled="
                  freshness !== 'current' ||
                  pending ||
                  busy ||
                  job?.status !== 'waiting-review'
                "
                @change="
                  toggleCandidate(
                    candidate.id,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              <span class="silence-candidate-index">{{
                String(index + 1).padStart(2, "0")
              }}</span>
              <span class="silence-candidate-time"
                >{{ time(candidate.sourceInterval.start) }}–{{
                  time(candidate.sourceInterval.end)
                }}</span
              >
            </label>
            <div class="silence-candidate-map">
              <span v-if="candidate.timelineIntervals.length">
                {{ t("precision.silence.timelinePosition") }}
                <span
                  v-for="(range, rangeIndex) in candidate.timelineIntervals"
                  :key="`${candidate.id}-${rangeIndex}`"
                  class="silence-timecode"
                  >{{ time(range.start) }}–{{ time(range.end) }}</span
                >
              </span>
              <span v-else class="silence-unmapped">{{
                t("precision.silence.notOnTimeline")
              }}</span>
              <button
                class="editor-button compact"
                type="button"
                :disabled="!active || pending"
                @click="
                  auditionControls?.stop();
                  emit(
                    'preview',
                    selectedAssetId,
                    candidate.sourceInterval.start,
                    candidate.sourceInterval.end,
                  );
                "
              >
                {{ t("precision.silence.preview") }}
              </button>
            </div>
          </li>
        </ol>
        <p v-if="hasSelectionChanges" class="silence-note" role="status">
          {{ t("precision.silence.newReviewRequired") }}
        </p>
        <SilenceAuditionControls
          v-if="job && proposal"
          ref="auditionControls"
          :project-id="projectId"
          :composition-id="compositionId"
          :revision="revision"
          :job-id="job.id"
          :review-id="reviewState!.review.reviewId"
          :proposal="proposal"
          :disabled="!canAccept"
          :active="active"
          @audition-start="emit('auditionStart')"
        />
        <div class="silence-actions silence-review-actions">
          <button
            class="editor-button"
            :disabled="!canRevise"
            @click="createSelectionReview"
          >
            {{ t("precision.silence.createReview") }}
          </button>
          <button
            ref="acceptOpener"
            class="editor-button primary"
            :disabled="!canAccept"
            @click="openConfirmation"
          >
            {{ t("precision.silence.accept") }}
          </button>
        </div>
      </section>
      <p
        v-else-if="job?.status === 'waiting-review'"
        class="silence-note"
        role="status"
      >
        {{ t("precision.silence.loadingReview") }}
      </p>

      <p v-if="accepted" class="silence-applied" role="status">
        {{ t("precision.silence.applied") }}
      </p>

      <div v-if="confirmation" class="silence-confirm-backdrop">
        <section
          class="silence-confirmation"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="'silence-confirm-title'"
          :aria-describedby="'silence-confirm-description'"
        >
          <p class="silence-eyebrow">
            {{ t("precision.silence.confirmEyebrow") }}
          </p>
          <h3 id="silence-confirm-title">
            {{ t("precision.silence.confirmTitle") }}
          </h3>
          <p id="silence-confirm-description">
            {{
              t("precision.silence.confirmSummary", {
                count: selectedCandidates.length,
                duration: time(estimatedDuration),
              })
            }}
          </p>
          <ul>
            <li>
              {{
                t("precision.silence.confirmSource", {
                  source: selectedSource?.asset.name ?? "",
                })
              }}
            </li>
            <li>
              {{
                t("precision.silence.confirmChanges", {
                  count: proposal?.affectedClipIds.length ?? 0,
                })
              }}
            </li>
            <li>{{ t("precision.silence.confirmUndo") }}</li>
          </ul>
          <div class="silence-actions">
            <button
              class="editor-button"
              :disabled="pending"
              @click="closeConfirmation"
            >
              {{ t("precision.silence.back") }}
            </button>
            <button
              ref="confirmButton"
              class="editor-button primary"
              :disabled="pending || !canAccept"
              @click="acceptReview"
            >
              {{
                pending
                  ? t("precision.silence.accepting")
                  : t("precision.silence.confirmAccept")
              }}
            </button>
          </div>
        </section>
      </div>
    </template>
    <p v-else class="silence-empty" role="status">
      {{ t("precision.silence.noSources") }}
    </p>
  </section>
</template>

<style scoped>
.silence-review {
  display: grid;
  container-type: inline-size;
  container-name: silence-review;
  gap: var(--of-space-4);
  min-width: 0;
  max-height: min(70vh, 760px);
  overflow: auto;
  padding: var(--of-space-4);
  color: var(--of-text-primary);
  background: color-mix(in srgb, var(--of-surface-1) 76%, transparent);
  border-radius: var(--of-radius-md);
  scrollbar-gutter: stable;
}
.silence-heading,
.silence-actions,
.silence-candidate-map,
.silence-candidate-toggle {
  display: flex;
  align-items: center;
  gap: var(--of-space-2);
}
.silence-heading {
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--of-space-3);
}
.silence-heading h3,
.silence-confirmation h3 {
  margin: 0;
  font-size: var(--of-font-subtitle);
}
.silence-eyebrow {
  margin: 0 0 var(--of-space-1);
  color: var(--of-text-muted);
  font-size: var(--of-font-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.silence-status {
  flex: 0 0 auto;
  padding: 5px 9px;
  color: var(--of-text-secondary);
  background: var(--of-surface-2);
  border-radius: var(--of-radius-round);
  font-size: var(--of-font-caption);
}
.silence-status.stale {
  color: var(--of-warning);
  background: var(--of-warning-soft);
}
.silence-status.applied,
.silence-applied {
  color: var(--of-success);
}
.silence-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--of-space-2);
}
.silence-options .editor-field {
  min-width: 0;
}
.silence-number {
  display: flex;
  align-items: center;
  gap: var(--of-space-1);
}
.silence-number input {
  min-width: 0;
  width: 100%;
}
.silence-number > span {
  color: var(--of-text-muted);
  font-family: var(--of-font-mono);
  font-size: var(--of-font-small);
}
.silence-note,
.silence-empty,
.silence-error,
.silence-applied {
  margin: 0;
  color: var(--of-text-secondary);
  font-size: var(--of-font-small);
  line-height: var(--of-line-body);
}
.silence-error {
  color: var(--of-danger);
}
.silence-applied {
  padding: var(--of-space-3);
  background: var(--of-success-soft);
  border-radius: var(--of-radius-sm);
}
.silence-actions {
  flex-wrap: wrap;
}
.silence-progress {
  display: grid;
  gap: var(--of-space-2);
  margin: 0;
  color: var(--of-text-secondary);
  font-size: var(--of-font-small);
}
.silence-progress progress {
  width: 100%;
  accent-color: var(--of-accent);
}
.silence-review-content {
  display: grid;
  gap: var(--of-space-3);
  min-width: 0;
}
.silence-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--of-space-2);
  padding: var(--of-space-3);
  background: var(--of-surface-2);
  border-radius: var(--of-radius-sm);
}
.silence-summary > div {
  display: grid;
  gap: var(--of-space-1);
  min-width: 0;
}
.silence-summary strong {
  font-family: var(--of-font-mono);
  font-size: var(--of-font-small);
  overflow-wrap: anywhere;
}
.silence-summary span {
  color: var(--of-text-muted);
  font-size: var(--of-font-caption);
}
.silence-candidates {
  display: grid;
  gap: var(--of-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.silence-candidate {
  display: grid;
  gap: var(--of-space-2);
  min-width: 0;
  padding: var(--of-space-3);
  background: var(--of-surface-1);
  border-radius: var(--of-radius-sm);
}
.silence-candidate-toggle {
  flex-wrap: wrap;
  min-height: 32px;
  min-width: 0;
}
.silence-candidate-toggle input {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  accent-color: var(--of-accent);
}
.silence-candidate-index {
  color: var(--of-text-muted);
  font-family: var(--of-font-mono);
  font-size: var(--of-font-caption);
}
.silence-candidate-time,
.silence-timecode {
  color: var(--of-text-primary);
  font-family: var(--of-font-mono);
  font-size: var(--of-font-small);
  white-space: nowrap;
}
.silence-candidate-map {
  flex-wrap: wrap;
  justify-content: space-between;
  min-width: 0;
  padding-inline-start: 30px;
  color: var(--of-text-muted);
  font-size: var(--of-font-caption);
}
.silence-candidate-map > span:first-child {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-1);
}
.silence-unmapped {
  color: var(--of-text-muted);
}
.editor-button.compact {
  min-height: 30px;
  padding: 4px 9px;
  font-size: var(--of-font-caption);
}
.silence-review-actions {
  justify-content: space-between;
}
.silence-confirm-backdrop {
  position: fixed;
  z-index: var(--of-z-dialog);
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--of-space-4);
  background: var(--of-overlay);
}
.silence-confirmation {
  display: grid;
  gap: var(--of-space-3);
  width: min(100%, 480px);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  padding: clamp(20px, 4vw, 32px);
  background: var(--of-surface-1);
  border: 0;
  border-radius: var(--of-radius-dialog);
  box-shadow: var(--of-shadow-dialog);
}
.silence-confirmation p,
.silence-confirmation ul {
  margin: 0;
  color: var(--of-text-secondary);
  font-size: var(--of-font-small);
  line-height: var(--of-line-body);
}
.silence-confirmation ul {
  padding-inline-start: 1.25rem;
}
.silence-confirmation :focus-visible,
.silence-review :focus-visible {
  outline: 2px solid var(--of-focus);
  outline-offset: 2px;
}
@media (max-width: 700px) {
  .silence-options {
    grid-template-columns: 1fr;
  }
  .silence-summary {
    grid-template-columns: 1fr 1fr;
  }
  .silence-summary > :last-child {
    grid-column: 1 / -1;
  }
  .silence-review-actions > button {
    flex: 1 1 140px;
  }
}
@container silence-review (max-width: 350px) {
  .silence-heading {
    flex-wrap: wrap;
  }
  .silence-candidate-map {
    padding-inline-start: 0;
  }
  .silence-candidate-map > span:first-child {
    min-width: 0;
  }
  .silence-timecode {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .silence-options {
    grid-template-columns: 1fr;
  }
  .silence-summary {
    grid-template-columns: 1fr 1fr;
  }
  .silence-summary > :last-child {
    grid-column: 1 / -1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .silence-review *,
  .silence-review *::before,
  .silence-review *::after {
    scroll-behavior: auto !important;
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
  }
}
</style>
