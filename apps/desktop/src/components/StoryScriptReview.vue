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
import type { Job, SceneScriptReviewSuggestion, Story } from "@openfilm/core";
import {
  api,
  ApiError,
  post,
  type ReviewProviderState,
  type ReviewRecoveryState,
  type ScriptReviewField,
  type ScriptReviewSuggestionsState,
} from "../api";
import { errorDetail, formatNumber, localizeError } from "../i18n";

const props = defineProps<{
  projectId: string;
  storyId: string;
  beatId: string;
  jobs: readonly Job[];
  disabled: boolean;
  prepare: () => Promise<boolean>;
}>();
const emit = defineEmits<{
  accepted: [story: Story];
  activity: [];
  busy: [value: boolean];
  pending: [value: boolean];
}>();
const { t } = useI18n();
const owner = {
  projectId: props.projectId,
  storyId: props.storyId,
  beatId: props.beatId,
};
const acceptanceKey = `openfilm:script-review-accept:${owner.projectId}`;
type Acceptance = {
  storyId: string;
  beatId: string;
  field: ScriptReviewField;
  suggestionId: string;
  receipt: { baseRevision: string; requestId: string };
};
const field = ref<ScriptReviewField>("narration");
const uncertainAcceptance = shallowRef<Acceptance>();
try {
  const raw = localStorage.getItem(acceptanceKey);
  const value = raw ? (JSON.parse(raw) as Acceptance) : undefined;
  if (
    value?.storyId === owner.storyId &&
    value.beatId === owner.beatId &&
    ["narration", "visualDirection"].includes(value.field) &&
    typeof value.suggestionId === "string" &&
    value.suggestionId.trim() &&
    typeof value.receipt?.baseRevision === "string" &&
    value.receipt.baseRevision.trim() &&
    typeof value.receipt.requestId === "string" &&
    value.receipt.requestId.trim()
  ) {
    uncertainAcceptance.value = value;
    field.value = value.field;
  }
} catch {
  /* Invalid recovery bytes never create a script change. */
}
const history = ref(false);
const busy = ref(false);
const error = shallowRef<unknown>();
const reopenRequired = computed(
  () =>
    error.value instanceof ApiError &&
    error.value.status === 409 &&
    error.value.code === "story.planConflict",
);
const provider = shallowRef<ReviewProviderState>();
const pageSize = 10;
const data = shallowRef<ScriptReviewSuggestionsState>({
  suggestions: [],
  total: 0,
  offset: 0,
  limit: pageSize,
  revision: "",
});
const requestedOffset = ref(0);
const loading = ref(false);
const pages = computed(() =>
  Math.max(1, Math.ceil(data.value.total / pageSize)),
);
const blocked = computed(
  () => busy.value || props.disabled || !!uncertainAcceptance.value,
);
const remote = computed(() => provider.value?.provider?.execution === "remote");
const jobs = computed(() =>
  props.jobs.filter(
    (job) =>
      job.type === "scene-script-review" &&
      job.storyId === props.storyId &&
      job.beatId === props.beatId &&
      job.scriptField === field.value,
  ),
);
const activeJob = computed(() =>
  jobs.value.find((job) => job.status === "queued" || job.status === "running"),
);
const lastJob = computed(() => jobs.value[0]);
const recovery = shallowRef<ReviewRecoveryState>();
const recoveryConfirmation = shallowRef<ReviewRecoveryState>();
let disposed = false;
let readGeneration = 0;
let mutation: Promise<boolean> | undefined;
const currentOwner = () =>
  !disposed &&
  props.projectId === owner.projectId &&
  props.storyId === owner.storyId &&
  props.beatId === owner.beatId;
watch(busy, (value) => emit("busy", value), { flush: "sync" });
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
    /* The same receipt remains in memory when browser storage is unavailable. */
  }
}
function reserve(
  action: (current: () => boolean) => Promise<boolean>,
): Promise<boolean> {
  if (mutation || busy.value || props.disabled || !currentOwner())
    return Promise.resolve(false);
  const selectedField = field.value;
  const current = () => currentOwner() && field.value === selectedField;
  const operation = Promise.resolve()
    .then(async () => {
      if (!current()) return false;
      try {
        return await action(current);
      } catch (cause) {
        if (current()) error.value = cause;
        return false;
      }
    })
    .finally(() => {
      if (mutation === operation) mutation = undefined;
      if (current()) busy.value = false;
    });
  mutation = operation;
  busy.value = true;
  error.value = undefined;
  return operation;
}
async function refresh(offset = requestedOffset.value) {
  if (!currentOwner()) return;
  requestedOffset.value = offset;
  const stamp = ++readGeneration;
  const selectedField = field.value,
    reviewed = history.value;
  const current = () =>
    currentOwner() &&
    stamp === readGeneration &&
    field.value === selectedField &&
    history.value === reviewed;
  loading.value = true;
  try {
    const [suggestions, status] = await Promise.all([
      api.scriptReviewSuggestions(props.storyId, {
        beatId: props.beatId,
        field: selectedField,
        ...(!reviewed ? { status: "pending" as const } : {}),
        offset,
        limit: pageSize,
      }),
      api.reviewProvider("scene-script"),
    ]);
    if (!current()) return;
    if (offset > 0 && offset >= suggestions.total) {
      await refresh(0);
      return;
    }
    data.value = suggestions;
    provider.value = status;
    const job = activeJob.value;
    if (job) {
      const status = await api.reviewRecovery(job.id);
      if (!current() || activeJob.value?.id !== job.id) return;
      recovery.value = status;
      const confirmed = recoveryConfirmation.value;
      if (
        confirmed &&
        (!status.manualRecoveryAllowed ||
          status.ownerToken !== confirmed.ownerToken ||
          status.updatedAt !== confirmed.updatedAt)
      )
        recoveryConfirmation.value = undefined;
    } else {
      recovery.value = undefined;
      recoveryConfirmation.value = undefined;
    }
  } catch (cause) {
    if (current()) {
      error.value = cause;
      requestedOffset.value = data.value.offset;
    }
  } finally {
    if (current()) loading.value = false;
  }
}
async function generate() {
  if (
    uncertainAcceptance.value ||
    !provider.value?.available ||
    activeJob.value
  )
    return;
  await reserve(async (current) => {
    if (!(await props.prepare()) || !current() || uncertainAcceptance.value)
      return false;
    await api.runScriptReview(props.storyId, {
      beatId: props.beatId,
      field: field.value,
    });
    if (!current()) return false;
    emit("activity");
    await refresh(0);
    return current();
  });
}
async function transmitAcceptance(value: Acceptance, current: () => boolean) {
  if (!current() || uncertainAcceptance.value !== value) return false;
  try {
    const { story } = await api.acceptScriptSuggestion(
      value.suggestionId,
      value.receipt,
    );
    if (!current() || uncertainAcceptance.value !== value) return false;
    // Publish the acknowledged Story even if a subsequent suggestions read fails.
    emit("accepted", story);
    uncertainAcceptance.value = undefined;
    retainAcceptance();
    await refresh();
    return current();
  } catch (cause) {
    if (!current() || uncertainAcceptance.value !== value) return false;
    error.value = cause;
    if (
      cause instanceof ApiError &&
      (cause.code === "review.suggestionStale" ||
        (cause.status === 404 && cause.code === "request.notFound") ||
        (cause.status === 409 && cause.code === "story.planConflict"))
    ) {
      uncertainAcceptance.value = undefined;
      retainAcceptance();
      // This conflict rejects the current attempt before publication. Reopening
      // reconciles any earlier accepted receipt saved in the project itself.
      if (cause.code !== "story.planConflict") await refresh();
      return current();
    }
    return false;
  }
}
async function accept(suggestion: SceneScriptReviewSuggestion) {
  if (
    uncertainAcceptance.value ||
    suggestion.status !== "pending" ||
    loading.value
  )
    return;
  await reserve(async (current) => {
    if (!(await props.prepare()) || !current() || uncertainAcceptance.value)
      return false;
    // The server compares this field revision and before text after preparation.
    if (!current() || !data.value.revision) return false;
    const value: Acceptance = {
      storyId: props.storyId,
      beatId: props.beatId,
      field: field.value,
      suggestionId: suggestion.id,
      receipt: {
        baseRevision: data.value.revision,
        requestId: crypto.randomUUID(),
      },
    };
    uncertainAcceptance.value = value;
    retainAcceptance();
    return transmitAcceptance(value, current);
  });
}
async function retryAcceptance() {
  const value = uncertainAcceptance.value;
  if (value) await reserve((current) => transmitAcceptance(value, current));
}
async function skip(suggestion: SceneScriptReviewSuggestion) {
  if (uncertainAcceptance.value) return;
  await reserve(async (current) => {
    await api.skipScriptSuggestion(suggestion.id);
    if (!current()) return false;
    await refresh();
    return current();
  });
}
async function consent(allow: boolean) {
  if (uncertainAcceptance.value) return;
  const displayed = provider.value?.provider;
  await reserve(async (current) => {
    const status = await api.reviewConsent(allow, displayed, "scene-script");
    if (!current()) return false;
    provider.value = status;
    await refresh();
    return current();
  });
}
function changeField(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (blocked.value) {
    select.value = field.value;
    return;
  }
  field.value = select.value as ScriptReviewField;
}
function toggleHistory() {
  if (blocked.value) return;
  history.value = !history.value;
}
async function cancel() {
  const job = activeJob.value;
  if (!job || uncertainAcceptance.value) return;
  await reserve(async (current) => {
    await post(`/jobs/${encodeURIComponent(job.id)}/cancel`, {});
    if (!current()) return false;
    emit("activity");
    await refresh();
    return current();
  });
}
async function recoverInterrupted() {
  const checkpoint = recoveryConfirmation.value;
  if (!checkpoint?.manualRecoveryAllowed || uncertainAcceptance.value) return;
  await reserve(async (current) => {
    await api.recoverReview(checkpoint.jobId, {
      confirmStopped: true,
      ownerToken: checkpoint.ownerToken,
      updatedAt: checkpoint.updatedAt,
    });
    if (!current()) return false;
    recoveryConfirmation.value = undefined;
    emit("activity");
    await refresh();
    return current();
  });
}
async function flushPending() {
  if (mutation && !(await mutation)) return false;
  return !busy.value && !uncertainAcceptance.value;
}
watch([field, history], () => {
  recoveryConfirmation.value = undefined;
  void refresh(0);
});
defineExpose({ refresh, flush: flushPending });
onMounted(() => void refresh());
onBeforeUnmount(() => {
  disposed = true;
  readGeneration++;
});
</script>

<template>
  <section
    class="story-script-review"
    :aria-label="t('scriptReview.heading')"
    data-testid="script-review-panel"
  >
    <header class="script-review-heading">
      <div>
        <h3>{{ t("scriptReview.heading") }}</h3>
        <p>{{ t("scriptReview.description") }}</p>
      </div>
      <button
        class="text-button"
        :disabled="blocked"
        :aria-pressed="history"
        data-testid="script-review-history"
        @click="toggleHistory"
      >
        {{ t(history ? "scriptReview.pending" : "scriptReview.history") }}
      </button>
    </header>
    <div class="script-review-controls">
      <label class="field"
        >{{ t("scriptReview.field") }}
        <select
          :value="field"
          :disabled="blocked"
          data-testid="script-review-field"
          @change="changeField"
        >
          <option value="narration">{{ t("scenePlan.narration") }}</option>
          <option value="visualDirection">
            {{ t("scenePlan.visualDirection") }}
          </option>
        </select>
      </label>
      <button
        class="secondary"
        :disabled="blocked || loading || !provider?.available || !!activeJob"
        data-testid="script-review-generate"
        @click="generate"
      >
        {{ t("scriptReview.generate") }}
      </button>
    </div>
    <p v-if="!provider?.configured" class="script-review-note">
      {{ t("scriptReview.providerMissing") }}
    </p>
    <div v-else class="script-review-provider">
      <p v-if="provider.provider?.name">{{ provider.provider.name }}</p>
      <template v-if="remote">
        <p>{{ t("scriptReview.remoteConsent") }}</p>
        <p v-if="provider.provider?.endpoint">
          {{
            t("transcript.providerDestination", {
              destination: provider.provider.endpoint,
            })
          }}
        </p>
        <details>
          <summary>{{ t("transcript.providerDataKinds") }}</summary>
          <ul>
            <li v-for="kind in provider.provider?.dataKinds" :key="kind">
              {{ t(`transcript.dataKinds.${kind}`) }}
            </li>
          </ul>
        </details>
        <p>{{ t("scriptReview.dataAccess") }}</p>
        <button
          v-if="!provider.available"
          class="text-button"
          :disabled="blocked"
          @click="consent(true)"
        >
          {{ t("scriptReview.grantConsent") }}
        </button>
        <button
          v-else
          class="text-button"
          :disabled="blocked || !!activeJob"
          @click="consent(false)"
        >
          {{ t("scriptReview.revokeConsent") }}
        </button>
      </template>
    </div>
    <div
      v-if="uncertainAcceptance"
      class="script-review-recovery"
      role="status"
      data-testid="script-review-pending"
    >
      <p>{{ t("scriptReview.uncertainAcceptance") }}</p>
      <button
        class="secondary"
        :disabled="busy || disabled"
        data-testid="script-review-retry-accept"
        @click="retryAcceptance"
      >
        {{ t("scriptReview.retryAcceptance") }}
      </button>
    </div>
    <div
      v-if="error"
      class="script-review-error"
      role="alert"
      data-testid="script-review-error"
    >
      <p>
        {{
          reopenRequired
            ? t("scriptReview.reopenRequired")
            : localizeError(error)
        }}
      </p>
      <details>
        <summary>{{ t("common.technicalDetails") }}</summary>
        <pre>{{ errorDetail(error) }}</pre>
      </details>
      <button class="text-button" :disabled="busy" @click="refresh()">
        {{ t("scriptReview.reload") }}
      </button>
    </div>
    <div
      v-if="activeJob"
      class="script-review-status"
      role="status"
      data-testid="script-review-status"
    >
      <template v-if="recovery?.manualRecoveryAllowed">
        <p>{{ t("transcript.interruptedReview") }}</p>
        <div v-if="recoveryConfirmation">
          <p>{{ t("transcript.recoverReviewConfirm") }}</p>
          <button
            class="secondary"
            :disabled="blocked"
            @click="recoverInterrupted"
          >
            {{ t("transcript.confirmStopped") }}
          </button>
          <button
            class="text-button"
            :disabled="busy"
            @click="recoveryConfirmation = undefined"
          >
            {{ t("transcript.cancelRecovery") }}
          </button>
        </div>
        <button
          v-else
          class="secondary"
          :disabled="blocked"
          @click="recoveryConfirmation = { ...recovery }"
        >
          {{ t("transcript.recoverReview") }}
        </button>
      </template>
      <template v-else
        ><p>{{ t("scriptReview.running") }}</p>
        <button class="text-button" :disabled="blocked" @click="cancel">
          {{ t("scriptReview.cancel") }}
        </button></template
      >
    </div>
    <p
      v-else-if="lastJob?.status === 'cancelled'"
      class="script-review-note"
      role="status"
    >
      {{ t("scriptReview.cancelled") }}
    </p>
    <p v-if="!data.total && !loading && !activeJob" class="script-review-note">
      {{ t(history ? "scriptReview.noHistory" : "scriptReview.noSuggestions") }}
    </p>
    <p v-if="loading" class="script-review-note" role="status">
      {{ t("transcript.loading") }}
    </p>
    <article
      v-for="suggestion in data.suggestions"
      :key="suggestion.id"
      class="script-review-suggestion"
      data-testid="script-review-suggestion"
      :data-suggestion-id="suggestion.id"
      :data-status="suggestion.status"
    >
      <span class="script-review-note">{{
        t(`transcript.${suggestion.status}`)
      }}</span>
      <div class="script-review-diff">
        <div>
          <small>{{ t("transcript.before") }}</small
          ><del data-testid="script-review-before">{{ suggestion.before }}</del>
        </div>
        <div>
          <small>{{ t("transcript.after") }}</small
          ><ins data-testid="script-review-after">{{ suggestion.after }}</ins>
        </div>
      </div>
      <p data-testid="script-review-reason">
        <strong>{{ t("transcript.why") }}</strong> · {{ suggestion.reason }}
      </p>
      <div class="script-review-actions">
        <button
          v-if="suggestion.status === 'pending'"
          class="secondary"
          :disabled="blocked || loading"
          data-testid="script-review-accept"
          @click="accept(suggestion)"
        >
          {{ t("transcript.accept") }}
        </button>
        <button
          v-if="
            suggestion.status === 'pending' || suggestion.status === 'stale'
          "
          class="text-button"
          :disabled="blocked || loading"
          data-testid="script-review-skip"
          @click="skip(suggestion)"
        >
          {{ t("transcript.skip") }}
        </button>
      </div>
    </article>
    <nav
      v-if="pages > 1"
      class="script-review-pagination"
      :aria-label="t('scriptReview.pages')"
    >
      <button
        class="text-button"
        :disabled="blocked || loading || data.offset === 0"
        @click="refresh(data.offset - pageSize)"
      >
        {{ t("app.actions.previous") }}
      </button>
      <span>{{
        t("transcript.page", {
          page: formatNumber(Math.floor(data.offset / pageSize) + 1),
          pages: formatNumber(pages),
        })
      }}</span>
      <button
        class="text-button"
        :disabled="blocked || loading || data.offset + pageSize >= data.total"
        @click="refresh(data.offset + pageSize)"
      >
        {{ t("app.actions.next") }}
      </button>
    </nav>
  </section>
</template>
