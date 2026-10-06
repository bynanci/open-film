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
const busy = ref(false);
const projectBusy = ref(false);
watch(busy, (value) => emit("busy", value), { flush: "sync" });
const error = shallowRef<unknown>(null);
const history = ref(false);
const reviewPages = ref(1);
let readGeneration = 0;
let poll: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let mutation: Promise<void> | undefined;
const active = computed(() =>
  jobs.value.find((job) => job.status === "queued" || job.status === "running"),
);
const lastJob = computed(() => jobs.value[0]);
const failedBatches = computed(() =>
  batches.value.filter((batch) => batch.status === "failed"),
);
const remote = computed(() => provider.value?.provider?.execution === "remote");
async function refresh(offset = data.value.offset) {
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
    if (lastJob.value) {
      const found = await api.reviewBatches(lastJob.value.id);
      if (current()) batches.value = found.batches;
    }
  } catch (cause) {
    if (current()) error.value = cause;
  }
}
async function run(source: "glossary" | "language") {
  if (busy.value || projectBusy.value || !(await props.flush())) return;
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
async function accept(suggestion: ReviewSuggestion) {
  if (busy.value || !props.revision || !(await props.flush())) return;
  busy.value = true;
  error.value = null;
  mutation = (async () => {
    const key = `openfilm:suggestion:${props.projectId}:${props.assetId}:${suggestion.id}`;
    try {
      let receipt = {
        baseRevision: props.revision!,
        requestId: crypto.randomUUID(),
      };
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const parsed = JSON.parse(saved) as typeof receipt;
          if (
            typeof parsed.baseRevision === "string" &&
            typeof parsed.requestId === "string"
          )
            receipt = parsed;
        }
        localStorage.setItem(key, JSON.stringify(receipt));
      } catch {
        /* Live request still retains its identity. */
      }
      await api.acceptSuggestion(suggestion.id, receipt);
      localStorage.removeItem(key);
      emit("changed");
      await refresh();
    } catch (cause) {
      error.value = cause;
    } finally {
      busy.value = false;
    }
  })();
  await mutation;
  mutation = undefined;
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
  return !busy.value;
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
  >
    <div class="editor-actions">
      <button
        class="editor-button"
        :disabled="busy || projectBusy"
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
          :disabled="busy"
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
    <div v-if="reviewPages > 1" class="editor-actions">
      <button
        class="editor-button"
        :disabled="busy || data.offset === 0"
        @click="refresh(Math.max(0, data.offset - 100))"
      >
        {{ t("transcript.previousSuggestions") }}</button
      ><button
        class="editor-button"
        :disabled="busy || Math.floor(data.offset / 100) + 1 >= reviewPages"
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
        :disabled="busy || projectBusy || !provider.available"
        @click="run('language')"
      >
        {{ t("transcript.languageReview") }}
      </button>
      <button
        v-if="remote && provider.available"
        class="editor-button"
        :disabled="busy || projectBusy"
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
    <div v-for="batch in failedBatches" :key="batch.index" class="editor-error">
      <p>{{ t("transcript.failedBatch") }}</p>
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
    <p class="editor-note">{{ t("transcript.reviewContext") }}</p>
  </section>
</template>
