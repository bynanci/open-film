<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import type {
  Job,
  ReviewBatch,
  TranscriptReviewSuggestion as ReviewSuggestion,
} from "@openfilm/core";
import {
  api,
  ApiError,
  post,
  type ReviewProviderState,
  type ReviewSuggestionsState,
} from "../api";
import { errorDetail, formatNumber, localizeError } from "../i18n";
const props = defineProps<{
  projectId: string;
  assetId: string;
  revision?: string;
  flush: () => Promise<boolean>;
}>();
const emit = defineEmits<{
  changed: [];
  seek: [segmentId: string];
  activity: [];
  busy: [value: boolean];
  pending: [value: boolean];
}>();
const { t } = useI18n();
const data = shallowRef<ReviewSuggestionsState>({
  suggestions: [],
  total: 0,
  offset: 0,
  limit: 100,
});
const provider = shallowRef<ReviewProviderState>();
const jobs = ref<Job[]>([]);
const batches = ref<ReviewBatch[]>([]);
const recoveryJobsPerPage = 5;
const recoveryPage = ref(0);
const recoveryLoading = ref(false);
const busy = ref(false);
type Acceptance = {
  suggestionId: string;
  receipt: { baseRevision: string; requestId: string };
};
const acceptanceKey = `openfilm:review-accept:${props.projectId}:${props.assetId}`;
const uncertainAcceptance = shallowRef<Acceptance>();
try {
  const raw = localStorage.getItem(acceptanceKey);
  if (raw) {
    const parsed = JSON.parse(raw) as Acceptance;
    if (
      typeof parsed.suggestionId === "string" &&
      typeof parsed.receipt?.baseRevision === "string" &&
      typeof parsed.receipt?.requestId === "string"
    )
      uncertainAcceptance.value = parsed;
  }
} catch {
  /* Invalid local receipts never create a new correction. */
}
watch(uncertainAcceptance, (value) => emit("pending", !!value), {
  flush: "sync",
  immediate: true,
});
function retainAcceptance() {
  try {
    if (uncertainAcceptance.value)
      localStorage.setItem(
        acceptanceKey,
        JSON.stringify(uncertainAcceptance.value),
      );
    else localStorage.removeItem(acceptanceKey);
  } catch {
    /* Keep the exact request in memory if browser storage is unavailable. */
  }
}
const projectBusy = ref(false);
watch(busy, (value) => emit("busy", value), { flush: "sync" });
const error = shallowRef<unknown>(null);
const history = ref(false);
const reviewPages = ref(1);
const requestedOffset = ref(0);
const pageChanging = computed(
  () => requestedOffset.value !== data.value.offset,
);
let readGeneration = 0;
let poll: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let mutation: Promise<void> | undefined;
const active = computed(() =>
  jobs.value.find((job) => job.status === "queued" || job.status === "running"),
);
const lastJob = computed(() => jobs.value[0]);
const recoveryJobs = computed(() =>
  jobs.value.filter((job) => job.status !== "completed"),
);
const recoveryPages = computed(() =>
  Math.max(1, Math.ceil(recoveryJobs.value.length / recoveryJobsPerPage)),
);
const recoverableBatches = computed(() =>
  batches.value.filter(
    (batch) => batch.status === "failed" || batch.status === "cancelled",
  ),
);
const remote = computed(() => provider.value?.provider?.execution === "remote");
async function refresh(offset = requestedOffset.value) {
  requestedOffset.value = offset;
  const stamp = ++readGeneration,
    capturedHistory = history.value,
    page = Math.floor(offset / 100);
  const current = () =>
    !disposed && stamp === readGeneration && history.value === capturedHistory;
  try {
    const suggestionRead = capturedHistory
      ? api.reviewSuggestions(props.assetId, undefined, page * 100)
      : Promise.all([
          api.reviewSuggestions(props.assetId, "pending", page * 50, 50),
          api.reviewSuggestions(props.assetId, "stale", page * 50, 50),
        ]).then(([pending, stale]) => ({
          suggestions: [...pending.suggestions, ...stale.suggestions],
          total: pending.total + stale.total,
          offset: page * 100,
          limit: 100,
          pages: Math.max(
            1,
            Math.ceil(pending.total / 50),
            Math.ceil(stale.total / 50),
          ),
        }));
    const [suggestions, status, jobsState] = await Promise.all([
      suggestionRead,
      api.reviewProvider(),
      api.jobs(),
    ]);
    if (!current()) return;
    const pages =
      "pages" in suggestions
        ? Number(suggestions.pages)
        : Math.max(1, Math.ceil(suggestions.total / 100));
    if (page >= pages) {
      await refresh((pages - 1) * 100);
      return;
    }
    data.value = suggestions;
    reviewPages.value = pages;
    provider.value = status;
    projectBusy.value = jobsState.jobs.some(
      (job) => job.status === "queued" || job.status === "running",
    );
    jobs.value = jobsState.jobs
      .filter(
        (job) =>
          job.assetId === props.assetId &&
          (job.type === "review" ||
            job.type === "language-review" ||
            job.type === "glossary-review"),
      )
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    recoveryPage.value = Math.min(recoveryPage.value, recoveryPages.value - 1);
    const capturedRecoveryPage = recoveryPage.value;
    const recoveryWindow = recoveryJobs.value.slice(
      capturedRecoveryPage * recoveryJobsPerPage,
      (capturedRecoveryPage + 1) * recoveryJobsPerPage,
    );
    recoveryLoading.value = true;
    const found = await Promise.allSettled(
      recoveryWindow.map((job) => api.reviewBatches(job.id)),
    );
    if (current() && capturedRecoveryPage === recoveryPage.value) {
      batches.value = found.flatMap((result, index) => {
        if (result.status === "fulfilled") return result.value.batches;
        error.value = result.reason;
        // A failed refresh must not hide recovery evidence already loaded.
        return batches.value.filter(
          (batch) => batch.jobId === recoveryWindow[index]!.id,
        );
      });
    }
  } catch (cause) {
    if (current()) {
      error.value = cause;
      requestedOffset.value = data.value.offset;
    }
  } finally {
    if (current()) recoveryLoading.value = false;
  }
}
async function pageRecovery(direction: number) {
  recoveryPage.value = Math.max(
    0,
    Math.min(recoveryPages.value - 1, recoveryPage.value + direction),
  );
  await refresh();
}
async function run(source: "glossary" | "language") {
  if (
    busy.value ||
    uncertainAcceptance.value ||
    projectBusy.value ||
    !(await props.flush())
  )
    return;
  busy.value = true;
  error.value = null;
  try {
    await api.runReview(props.assetId, { source });
    emit("activity");
    await refresh(0);
  } catch (cause) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function transmitAcceptance(value: Acceptance) {
  if (busy.value) return;
  const projectId = props.projectId,
    assetId = props.assetId;
  const current = () =>
    !disposed &&
    props.projectId === projectId &&
    props.assetId === assetId &&
    acceptanceKey === `openfilm:review-accept:${projectId}:${assetId}`;
  if (!current()) return;
  busy.value = true;
  error.value = null;
  mutation = (async () => {
    try {
      await api.acceptSuggestion(value.suggestionId, value.receipt);
      if (!current() || uncertainAcceptance.value !== value) return;
      uncertainAcceptance.value = undefined;
      retainAcceptance();
      emit("changed");
      await refresh();
    } catch (cause) {
      if (!current() || uncertainAcceptance.value !== value) return;
      error.value = cause;
      // A definitive rejection in this project ends recovery for this receipt,
      // including copies restored without the original suggestion. Transport
      // failures and offline sources still leave the outcome uncertain.
      if (
        cause instanceof ApiError &&
        (cause.code === "review.suggestionStale" ||
          cause.code === "transcript.revisionConflict" ||
          (cause.status === 404 && cause.code === "request.notFound"))
      ) {
        uncertainAcceptance.value = undefined;
        retainAcceptance();
        emit("changed");
      }
    } finally {
      if (current()) busy.value = false;
    }
  })();
  await mutation;
  mutation = undefined;
}
async function accept(suggestion: ReviewSuggestion) {
  if (
    busy.value ||
    uncertainAcceptance.value ||
    !props.revision ||
    !(await props.flush())
  )
    return;
  const value: Acceptance = {
    suggestionId: suggestion.id,
    receipt: { baseRevision: props.revision, requestId: crypto.randomUUID() },
  };
  uncertainAcceptance.value = value;
  retainAcceptance();
  await transmitAcceptance(value);
}
async function retryAcceptance() {
  if (uncertainAcceptance.value)
    await transmitAcceptance(uncertainAcceptance.value);
}
async function skip(suggestion: ReviewSuggestion) {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.skipSuggestion(suggestion.id);
    await refresh();
  } catch (cause) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function consent(allow: boolean) {
  busy.value = true;
  try {
    provider.value = await api.reviewConsent(allow);
    await refresh();
  } catch (cause) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function cancel() {
  if (!active.value) return;
  try {
    await post(`/jobs/${encodeURIComponent(active.value.id)}/cancel`);
    emit("activity");
    await refresh();
  } catch (cause) {
    error.value = cause;
  }
}
async function batchAction(batch: ReviewBatch, action: "retry" | "skip") {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.reviewBatchAction(batch.jobId, batch.index, action);
    emit("activity");
    await refresh();
  } catch (cause) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function tick() {
  await refresh();
  if (!disposed) poll = setTimeout(() => void tick(), 1200);
}
async function flushPending() {
  if (mutation) await mutation;
  return !busy.value && !uncertainAcceptance.value;
}
defineExpose({ refresh, flush: flushPending });
onMounted(() => void tick());
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(poll);
});
</script>
<template>
  <section
    class="transcript-side-panel"
    :aria-label="t('transcript.suggestions')"
    :data-latest-job-id="lastJob?.id"
  >
    <div class="editor-actions">
      <button
        class="editor-button"
        :disabled="busy || !!uncertainAcceptance || projectBusy"
        @click="run('glossary')"
      >
        {{ t("transcript.findMatches") }}</button
      ><button
        class="editor-button"
        :aria-pressed="history"
        @click="
          history = !history;
          refresh(0);
        "
      >
        {{
          t(history ? "transcript.closeHistory" : "transcript.reviewHistory")
        }}
      </button>
    </div>
    <div
      v-if="uncertainAcceptance"
      class="editor-error"
      data-testid="review-acceptance-recovery"
      role="status"
    >
      <p>{{ t("transcript.uncertainAcceptance") }}</p>
      <button class="editor-button" :disabled="busy" @click="retryAcceptance">
        {{ t("transcript.retryAcceptance") }}
      </button>
    </div>
    <p role="status">
      {{
        t(
          "transcript.suggestionsCount",
          { count: formatNumber(data.total) },
          data.total,
        )
      }}
    </p>
    <div v-if="error" class="editor-error" role="alert">
      <p>{{ localizeError(error) }}</p>
      <details>
        <summary>{{ t("common.technicalDetails") }}</summary>
        <pre>{{ errorDetail(error) }}</pre>
      </details>
      <button
        class="editor-button"
        @click="
          error = null;
          run('glossary');
        "
      >
        {{ t("transcript.regenerate") }}
      </button>
    </div>
    <p v-if="!data.total" class="editor-note">
      {{ t("transcript.noSuggestions") }}
    </p>
    <article
      v-for="suggestion in data.suggestions"
      :key="suggestion.id"
      class="transcript-suggestion"
      data-testid="review-suggestion"
      :data-status="suggestion.status"
      :data-suggestion-id="suggestion.id"
    >
      <span class="transcript-review-status">{{
        t(`transcript.${suggestion.status}`)
      }}</span>
      <div class="transcript-diff">
        <div>
          <small>{{ t("transcript.before") }}</small
          ><del>{{ suggestion.before }}</del>
        </div>
        <div>
          <small>{{ t("transcript.after") }}</small
          ><ins>{{ suggestion.after }}</ins>
        </div>
      </div>
      <p>
        <strong>{{ t("transcript.why") }}</strong> ·
        {{
          suggestion.source.type === "glossary"
            ? t("transcript.glossaryReason")
            : suggestion.reason
        }}
      </p>
      <div class="editor-actions">
        <button
          class="editor-button"
          @click="emit('seek', suggestion.target.segmentId)"
        >
          {{ t("transcript.preview") }}</button
        ><button
          v-if="suggestion.status === 'pending'"
          class="editor-button primary"
          :disabled="busy || !!uncertainAcceptance"
          @click="accept(suggestion)"
        >
          {{ t("transcript.accept") }}</button
        ><button
          v-if="
            suggestion.status === 'pending' || suggestion.status === 'stale'
          "
          class="editor-button"
          :disabled="busy"
          @click="skip(suggestion)"
        >
          {{ t("transcript.skip") }}
        </button>
      </div>
    </article>
    <div
      v-if="reviewPages > 1"
      class="editor-actions"
      data-testid="review-pagination"
      :data-offset="data.offset"
      :data-requested-offset="requestedOffset"
      :aria-busy="pageChanging"
    >
      <button
        class="editor-button"
        :disabled="busy || pageChanging || data.offset === 0"
        @click="refresh(Math.max(0, data.offset - 100))"
      >
        {{ t("transcript.previousSuggestions") }}</button
      ><button
        class="editor-button"
        :disabled="
          busy ||
          pageChanging ||
          Math.floor(data.offset / 100) + 1 >= reviewPages
        "
        @click="refresh(data.offset + 100)"
      >
        {{ t("transcript.nextSuggestions") }}
      </button>
    </div>
    <hr />
    <template v-if="!provider?.configured"
      ><p class="editor-note">
        {{ t("transcript.providerMissing") }}
      </p></template
    >
    <template v-else>
      <p v-if="provider.provider?.name" class="editor-note">
        {{ provider.provider.name }}
      </p>
      <p v-if="remote" class="editor-note">
        {{ t("transcript.remoteConsent") }}
      </p>
      <p v-if="provider.provider?.endpoint" class="editor-note">
        {{
          t("transcript.providerDestination", {
            destination: provider.provider.endpoint,
          })
        }}
      </p>
      <button
        v-if="remote && !provider.available"
        class="editor-button"
        :disabled="busy"
        @click="consent(true)"
      >
        {{ t("transcript.grantConsent") }}
      </button>
      <button
        class="editor-button"
        :disabled="
          busy || !!uncertainAcceptance || projectBusy || !provider.available
        "
        @click="run('language')"
      >
        {{ t("transcript.languageReview") }}
      </button>
      <button
        v-if="remote && provider.available"
        class="editor-button"
        :disabled="busy || !!uncertainAcceptance || projectBusy"
        @click="consent(false)"
      >
        {{ t("transcript.revokeConsent") }}
      </button>
    </template>
    <p v-if="active" role="status">
      {{ t("transcript.reviewRunning") }}
      {{ formatNumber(Math.round((active.progress ?? 0) * 100)) }}%
    </p>
    <button v-if="active" class="editor-button" @click="cancel">
      {{ t("transcript.cancelReview") }}
    </button>
    <p v-if="lastJob?.status === 'cancelled'" class="editor-note">
      {{ t("transcript.reviewPartial") }}
    </p>
    <h3 v-if="recoverableBatches.length || recoveryPages > 1">
      {{ t("transcript.unfinishedReviews") }}
    </h3>
    <p
      v-if="recoveryPages > 1 && !recoverableBatches.length && !recoveryLoading"
      class="editor-note"
    >
      {{ t("transcript.noRecoveryBatches") }}
    </p>
    <div
      v-for="batch in recoverableBatches"
      :key="`${batch.jobId}:${batch.index}`"
      class="editor-error"
      data-testid="review-recovery-batch"
      :data-job-id="batch.jobId"
      :data-batch-index="batch.index"
      :data-batch-status="batch.status"
    >
      <p>
        {{
          t(
            batch.status === "cancelled"
              ? "transcript.cancelledBatch"
              : "transcript.failedBatch",
          )
        }}
      </p>
      <button
        class="editor-button"
        :disabled="busy"
        @click="batchAction(batch, 'retry')"
      >
        {{ t("transcript.retryBatch") }}</button
      ><button
        class="editor-button"
        :disabled="busy"
        @click="batchAction(batch, 'skip')"
      >
        {{ t("transcript.skipBatch") }}
      </button>
    </div>
    <div
      v-if="recoveryPages > 1"
      class="editor-actions"
      data-testid="review-recovery-pagination"
      role="group"
      :aria-label="t('transcript.unfinishedReviews')"
      :aria-busy="recoveryLoading"
      :data-page="recoveryPage"
    >
      <button
        class="editor-button"
        :disabled="busy || recoveryLoading || recoveryPage === 0"
        @click="pageRecovery(-1)"
      >
        {{ t("transcript.previousPage") }}
      </button>
      <span>{{
        t("transcript.page", { page: recoveryPage + 1, pages: recoveryPages })
      }}</span>
      <button
        class="editor-button"
        :disabled="busy || recoveryLoading || recoveryPage + 1 >= recoveryPages"
        @click="pageRecovery(1)"
      >
        {{ t("transcript.nextPage") }}
      </button>
    </div>
    <p class="editor-note">{{ t("transcript.reviewContext") }}</p>
  </section>
</template>
