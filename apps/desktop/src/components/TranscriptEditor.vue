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
import type {
  Clip,
  Job,
  MediaAsset,
  TranscriptCommand,
  TranscriptRevision,
  TranscriptSegment,
} from "@openfilm/core";
import {
  api,
  post,
  sourceUrl,
  type IntelligenceProviders,
  type TranscriptSearchState,
} from "../api";
import { errorDetail, formatNumber, formatDate, localizeError } from "../i18n";
import { useTranscriptEditor } from "../composables/useTranscriptEditor";
import GlossaryPanel from "./GlossaryPanel.vue";
import ReviewPanel from "./ReviewPanel.vue";
const props = defineProps<{
  projectId: string;
  asset: MediaAsset;
  clip?: Clip;
  active: boolean;
  unavailable?: boolean;
  sourceVersion?: number;
  height?: number;
  clips: { id: string; label: string }[];
}>();
const emit = defineEmits<{
  select: [clipId: string];
  activity: [];
  changed: [];
}>();
const { t } = useI18n();
const {
  state,
  status,
  error,
  notice,
  historyBusy,
  hasPending: transcriptHasPending,
  command,
  flush: flushTranscript,
  history,
  load,
  loadPage,
  discardDraft,
  downloadDraft,
  restore: restoreTranscript,
  reconcile,
} = useTranscriptEditor(props.projectId, props.asset.id, () => emit("changed"));
const root = ref<HTMLElement | null>(null);
const player = ref<HTMLMediaElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);
let textareaSegmentId: string | undefined;
function setTextarea(element: unknown, segmentId: string) {
  if (element instanceof HTMLTextAreaElement) {
    if (segmentId === selectedId.value) {
      textarea.value = element;
      textareaSegmentId = segmentId;
    }
  } else if (textareaSegmentId === segmentId) {
    // An old row can unmount after the new selected row registers its field.
    textarea.value = null;
    textareaSegmentId = undefined;
  }
}
const searchInput = ref<HTMLInputElement | null>(null);
const reviewPanel = ref<InstanceType<typeof ReviewPanel> | null>(null);
const glossaryPanel = ref<InstanceType<typeof GlossaryPanel> | null>(null);
const selectedId = ref("");
const editing = ref(false);
const text = ref("");
const playhead = ref(0);
const playing = ref(false);
const playbackError = ref(false);
const query = ref("");
const replacement = ref("");
const caseSensitive = ref(false);
const filter = ref(false);
const search = shallowRef<TranscriptSearchState>();
const matchIndex = ref(0);
const searchBusy = ref(false);
const localError = shallowRef<unknown>(null);
const toolsOpen = ref(false);
const reviewBusy = ref(false);
const reviewPending = ref(false);
const glossaryBusy = ref(false);
const rememberBusy = ref(false);
let rememberMutation: Promise<boolean> | undefined;
const transcriptionPending = ref(false);
let transcriptionMutation: Promise<boolean> | undefined;
const hasPending = computed(
  () =>
    transcriptHasPending.value ||
    reviewBusy.value ||
    reviewPending.value ||
    glossaryBusy.value ||
    rememberBusy.value ||
    transcriptionPending.value,
);
const tool = ref<"glossary" | "suggestions">("glossary");
const corrections = ref<{
  segmentId: string;
  before: string;
  after: string;
} | null>(null);
const revisions = ref<TranscriptRevision[]>([]);
const revisionOffset = ref(0);
const revisionTotal = ref(0);
const revisionSelection = ref("");
const providers = shallowRef<IntelligenceProviders>();
const jobs = ref<Job[]>([]);
const language = ref<"auto" | "zh" | "en" | "ja">("auto");
const execution = ref<"auto" | "cpu" | "gpu">("auto");
const transcribeWarning = ref(false);
const discardConfirmation = ref(false);
const pending = ref(false);
let polling: ReturnType<typeof setTimeout> | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchGeneration = 0;
let ancillaryGeneration = 0;
const observedCompletedTranscriptions = new Set<string>();
const searchContext = shallowRef<{
  query: string;
  caseSensitive: boolean;
  revision: string;
}>();
let disposed = false;
const selected = computed(() =>
  state.value?.document?.segments.find(
    (segment) => segment.id === selectedId.value,
  ),
);
const rememberableCorrection = computed(() => {
  const correction = corrections.value;
  return correction &&
    correction.segmentId === selectedId.value &&
    selected.value?.text === correction.after &&
    correction.before !== correction.after &&
    correction.before.length <= 512 &&
    correction.after.length <= 512 &&
    correction.after.trim()
    ? correction
    : null;
});
const visible = computed(
  () =>
    state.value?.document?.segments.filter(
      (segment) =>
        !filter.value ||
        !query.value ||
        search.value?.matches.some((match) => match.segmentId === segment.id),
    ) ?? [],
);
const matchRanges = computed(
  () =>
    search.value?.matches.flatMap((match) =>
      match.ranges.map((range) => ({ ...match, range })),
    ) ?? [],
);
const searchIsCurrent = computed(
  () =>
    !!searchContext.value &&
    searchContext.value.query === query.value &&
    searchContext.value.caseSensitive === caseSensitive.value &&
    searchContext.value.revision === state.value?.revision &&
    search.value?.revision === searchContext.value.revision,
);
const currentMatch = computed(() =>
  searchIsCurrent.value ? matchRanges.value[matchIndex.value] : undefined,
);
const sourceKey = computed(
  () => `${props.asset.id}:${props.asset.uri}:${props.sourceVersion ?? 0}`,
);
const supported = computed(
  () => props.asset.mediaType === "video" || props.asset.mediaType === "audio",
);
const busy = computed(
  () =>
    pending.value ||
    reviewBusy.value ||
    reviewPending.value ||
    glossaryBusy.value ||
    rememberBusy.value ||
    transcriptionPending.value ||
    historyBusy.value ||
    status.value === "loading" ||
    status.value === "conflict",
);
const taskBusy = computed(() =>
  jobs.value.some((job) => job.status === "queued" || job.status === "running"),
);
const transcriptionReady = computed(
  () =>
    !!providers.value?.transcription.available &&
    (
      providers.value.transcription.capabilities?.languages ?? [
        "auto",
        "zh",
        "en",
        "ja",
      ]
    ).includes(language.value),
);
const transcriptionJobs = computed(() =>
  jobs.value.filter(
    (job) => job.assetId === props.asset.id && job.type === "transcribe",
  ),
);
function time(value: number) {
  const ms = Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
function timed(segment: TranscriptSegment) {
  return (
    segment.alignmentState === undefined ||
    segment.alignmentState === "original" ||
    segment.alignmentState === "realigned"
  );
}
async function flushEditing() {
  if (!(await flushTranscript())) return false;
  if ((await reviewPanel.value?.flush()) === false) return false;
  if ((await glossaryPanel.value?.flush()) === false) return false;
  if (rememberMutation && !(await rememberMutation)) return false;
  return true;
}
async function flush() {
  if (transcriptionMutation && !(await transcriptionMutation)) return false;
  return flushEditing();
}
defineExpose({ flush, hasPending, reload: () => load(0, false) });
async function toggleTools() {
  if (
    reviewBusy.value ||
    reviewPending.value ||
    glossaryBusy.value ||
    rememberBusy.value ||
    !(await flush())
  )
    return;
  toolsOpen.value = !toolsOpen.value;
}
async function selectTool(value: "glossary" | "suggestions") {
  if (
    value === tool.value ||
    reviewBusy.value ||
    reviewPending.value ||
    glossaryBusy.value ||
    rememberBusy.value ||
    !(await flush())
  )
    return;
  tool.value = value;
}
async function updateAncillary() {
  const stamp = ++ancillaryGeneration;
  const capturedRevisionOffset = revisionOffset.value;
  const current = () =>
    !disposed &&
    stamp === ancillaryGeneration &&
    capturedRevisionOffset === revisionOffset.value;
  try {
    const [providerState, jobState, revisionState] = await Promise.all([
      api.intelligenceProviders(),
      api.jobs(),
      api.transcriptRevisions(props.asset.id, capturedRevisionOffset),
    ]);
    if (!current()) return;
    providers.value = providerState;
    jobs.value = jobState.jobs;
    revisions.value = revisionState.revisions;
    revisionTotal.value = revisionState.total;
    const completed = transcriptionJobs.value.filter(
      (job) =>
        job.status === "completed" &&
        !observedCompletedTranscriptions.has(job.id),
    );
    if (completed.length && status.value !== "loading") {
      for (const job of completed) observedCompletedTranscriptions.add(job.id);
      const beforeRevision = state.value?.revision;
      // A fast job can finish before any poll observes it running. Reconcile a
      // draft instead of flushing its old revision over the provider result.
      const refreshed = transcriptHasPending.value
        ? await reconcile()
        : await load(0, false);
      if (refreshed && state.value?.revision !== beforeRevision)
        corrections.value = null;
      if (!refreshed && status.value !== "conflict")
        for (const job of completed)
          observedCompletedTranscriptions.delete(job.id);
    }
  } catch (cause) {
    if (current()) localError.value = cause;
  }
}
async function poll() {
  await updateAncillary();
  if (!disposed) polling = setTimeout(() => void poll(), 1200);
}
function seek(value: number) {
  if (!player.value || props.unavailable) return;
  player.value.pause();
  const duration = player.value.duration;
  player.value.currentTime = Math.max(
    0,
    Math.min(Number.isFinite(duration) ? duration : value, value),
  );
  playhead.value = player.value.currentTime;
}
async function select(segment: TranscriptSegment, edit = false) {
  if (!(await flushTranscript())) return;
  selectedId.value = segment.id;
  text.value = segment.text;
  editing.value = edit;
  seek(segment.start);
  if (edit) await nextTick(() => textarea.value?.focus());
}
function queueText() {
  if (!selected.value) return;
  const segmentId = selected.value.id;
  const before = selected.value.text;
  if (text.value !== before) {
    if (
      command({
        type: "replace-text",
        segmentId,
        text: text.value,
      })
    ) {
      if (
        !corrections.value ||
        corrections.value.segmentId !== segmentId ||
        corrections.value.after !== before
      )
        corrections.value = { segmentId, before, after: text.value };
      else corrections.value.after = text.value;
    }
  }
}
async function structural(value: TranscriptCommand) {
  if (busy.value) return;
  pending.value = true;
  try {
    if (!(await flushTranscript())) return;
    if (command(value)) {
      corrections.value = null;
      await flushTranscript();
      await updateAncillary();
      await find();
    }
  } finally {
    pending.value = false;
  }
}
async function split(cursor = false) {
  if (!selected.value) return;
  const segment = selected.value;
  const newSegmentId = `segment-${crypto.randomUUID()}`;
  if (cursor) {
    const cursorOffset =
      textarea.value?.selectionStart ?? Math.floor(segment.text.length / 2);
    await structural({
      type: "split-segment",
      segmentId: segment.id,
      newSegmentId,
      cursorOffset,
    });
  } else if (playhead.value > segment.start && playhead.value < segment.end)
    await structural({
      type: "split-segment",
      segmentId: segment.id,
      newSegmentId,
      splitTime: playhead.value,
    });
}
async function find() {
  const stamp = ++searchGeneration,
    requestedQuery = query.value,
    requestedCase = caseSensitive.value;
  if (!requestedQuery) {
    searchContext.value = undefined;
    search.value = undefined;
    matchIndex.value = 0;
    searchBusy.value = false;
    return;
  }
  if (!(await flushTranscript()) || stamp !== searchGeneration) return;
  const revision = state.value?.revision;
  searchBusy.value = true;
  try {
    const found = await api.transcriptSearch(
      props.asset.id,
      requestedQuery,
      requestedCase,
      0,
      100,
    );
    if (
      disposed ||
      stamp !== searchGeneration ||
      query.value !== requestedQuery ||
      caseSensitive.value !== requestedCase ||
      state.value?.revision !== revision ||
      found.revision !== revision
    )
      return;
    searchContext.value = {
      query: requestedQuery,
      caseSensitive: requestedCase,
      revision: found.revision,
    };
    search.value = found;
    matchIndex.value = 0;
  } catch (cause) {
    if (stamp === searchGeneration) localError.value = cause;
  } finally {
    if (stamp === searchGeneration) searchBusy.value = false;
  }
}
async function seekMatch(direction: number) {
  if (!searchIsCurrent.value || searchBusy.value || !searchContext.value)
    return;
  const stamp = searchGeneration,
    context = { ...searchContext.value };
  const current = () =>
    !disposed &&
    stamp === searchGeneration &&
    query.value === context.query &&
    caseSensitive.value === context.caseSensitive &&
    state.value?.revision === context.revision;
  searchBusy.value = true;
  try {
    let index = matchIndex.value + direction;
    let found = search.value!;
    if (index < 0) {
      if (found.offset > 0) {
        found = await api.transcriptSearch(
          props.asset.id,
          context.query,
          context.caseSensitive,
          Math.max(0, found.offset - 100),
        );
        index =
          found.matches.reduce(
            (count, match) => count + match.ranges.length,
            0,
          ) - 1;
      } else index = matchRanges.value.length - 1;
    } else if (index >= matchRanges.value.length) {
      if (found.offset + found.limit < found.totalSegments) {
        found = await api.transcriptSearch(
          props.asset.id,
          context.query,
          context.caseSensitive,
          found.offset + 100,
        );
        index = 0;
      } else index = 0;
    }
    if (!current() || found.revision !== context.revision) return;
    search.value = found;
    matchIndex.value = index;
    const match = currentMatch.value;
    if (!match) return;
    if (
      !state.value?.document?.segments.some(
        (segment) => segment.id === match.segmentId,
      )
    ) {
      if (
        !(await loadPage(Math.floor(match.position / 100) * 100)) ||
        !current()
      )
        return;
    }
    const segment = state.value?.document?.segments.find(
      (item) => item.id === match.segmentId,
    );
    if (segment && current()) await select(segment);
  } catch (cause) {
    if (current()) localError.value = cause;
  } finally {
    if (stamp === searchGeneration) searchBusy.value = false;
  }
}
async function replace(all: boolean) {
  if (!query.value || busy.value || searchBusy.value) return;
  const requestedQuery = query.value,
    requestedCase = caseSensitive.value,
    requestedReplacement = replacement.value;
  if (
    !(await flushTranscript()) ||
    query.value !== requestedQuery ||
    caseSensitive.value !== requestedCase ||
    replacement.value !== requestedReplacement
  )
    return;
  if (!searchIsCurrent.value) {
    await find();
    return;
  }
  if (all)
    await structural({
      type: "replace-all",
      query: requestedQuery,
      replacement: requestedReplacement,
      caseSensitive: requestedCase,
    });
  else {
    const match = currentMatch.value;
    if (match)
      await structural({
        type: "replace-match",
        segmentId: match.segmentId,
        start: match.range.start,
        end: match.range.end,
        expected: match.text.slice(match.range.start, match.range.end),
        replacement: requestedReplacement,
      });
  }
}
async function undo(direction: "undo" | "redo") {
  if (await history(direction)) {
    corrections.value = null;
    await updateAncillary();
    await find();
  }
}
async function restore(revisionId: string) {
  if (busy.value) return false;
  pending.value = true;
  try {
    if (!(await restoreTranscript(revisionId))) return false;
    corrections.value = null;
    await updateAncillary();
    await find();
    return true;
  } finally {
    pending.value = false;
  }
}
async function remember() {
  if (!rememberableCorrection.value || busy.value) return false;
  const correction = { ...rememberableCorrection.value };
  rememberBusy.value = true;
  rememberMutation = (async () => {
    try {
      if (!(await flushTranscript())) return false;
      const current = rememberableCorrection.value;
      if (
        !current ||
        current.segmentId !== correction.segmentId ||
        current.before !== correction.before ||
        current.after !== correction.after
      )
        return false;
      await api.saveGlossary({
        scope: "project",
        source: correction.before,
        replacement: correction.after,
        caseSensitive: true,
        enabled: true,
      });
      corrections.value = null;
      toolsOpen.value = true;
      tool.value = "glossary";
      return true;
    } catch (cause) {
      localError.value = cause;
      return false;
    } finally {
      rememberBusy.value = false;
    }
  })().finally(() => {
    rememberMutation = undefined;
  });
  return rememberMutation;
}
async function seekSegment(id: string) {
  if (!(await flushTranscript())) return;
  try {
    const found = await api.transcriptSegment(props.asset.id, id);
    if (!state.value?.document?.segments.some((segment) => segment.id === id))
      await loadPage(Math.floor(found.position / 100) * 100);
    const segment = state.value?.document?.segments.find(
      (item) => item.id === id,
    );
    if (segment) await select(segment);
  } catch (cause) {
    localError.value = cause;
  }
}
async function chooseClip(event: Event) {
  if (!(await flush())) {
    (event.target as HTMLSelectElement).value = props.clip?.id ?? "";
    return;
  }
  emit("select", (event.target as HTMLSelectElement).value);
}
async function transcription() {
  if (
    !transcriptionReady.value ||
    taskBusy.value ||
    pending.value ||
    transcriptionPending.value
  )
    return;
  const options = {
    operation: "transcribe" as const,
    language: language.value,
    execution: execution.value,
  };
  transcriptionPending.value = true;
  transcriptionMutation = (async () => {
    try {
      // Use the editing-only barrier so this request never awaits itself.
      if (!(await flushEditing())) return false;
      if (
        state.value?.revisionInfo?.source !== undefined &&
        state.value.revisionInfo.source !== "provider" &&
        !transcribeWarning.value
      ) {
        transcribeWarning.value = true;
        return true;
      }
      await api.analyzeIntelligence(props.asset.id, options);
      transcribeWarning.value = false;
      emit("activity");
      await updateAncillary();
      return true;
    } catch (cause) {
      localError.value = cause;
      return false;
    } finally {
      transcriptionPending.value = false;
    }
  })().finally(() => {
    transcriptionMutation = undefined;
  });
  return transcriptionMutation;
}
async function cancel(job: Job) {
  try {
    await post(`/jobs/${encodeURIComponent(job.id)}/cancel`);
    emit("activity");
    await updateAncillary();
  } catch (cause) {
    localError.value = cause;
  }
}
function configurePlayer() {
  if (!player.value) return;
  player.value.volume = Math.min(
    1,
    Math.max(0, props.clip?.transform?.volume ?? 1),
  );
  player.value.muted = props.clip?.transform?.volume === 0;
}
function togglePlayback() {
  if (!player.value) return;
  if (player.value.paused)
    void player.value.play().catch(() => {
      playbackError.value = true;
    });
  else player.value.pause();
}
function focusSegment(id: string) {
  const row = Array.from(
    root.value?.querySelectorAll<HTMLElement>("[data-segment-id]") ?? [],
  ).find((element) => element.dataset.segmentId === id);
  row?.querySelector<HTMLElement>(".transcript-row-select")?.focus();
}
async function rowMove(direction: number, originId = selectedId.value) {
  const list = state.value?.document?.segments ?? [];
  const index = list.findIndex((item) => item.id === originId);
  const next = list[index + direction];
  if (next) {
    await select(next);
    await nextTick(() => focusSegment(next.id));
  } else if (
    direction > 0 &&
    (state.value?.offset ?? 0) + 100 < (state.value?.total ?? 0)
  ) {
    await loadPage(state.value!.offset + 100);
    const segment = state.value?.document?.segments[0];
    if (segment) {
      await select(segment);
      await nextTick(() => focusSegment(segment.id));
    }
  } else if (direction < 0 && (state.value?.offset ?? 0) > 0) {
    await loadPage(state.value!.offset - 100);
    const segment = state.value?.document?.segments.at(-1);
    if (segment) {
      await select(segment);
      await nextTick(() => focusSegment(segment.id));
    }
  }
}
function keyboard(event: KeyboardEvent) {
  if (
    !props.active ||
    event.defaultPrevented ||
    document.querySelector('[aria-modal="true"],dialog[open]')
  )
    return;
  const target = event.target as HTMLElement | null;
  if (!target?.closest('[data-testid="transcript-workspace"]')) return;
  const inText = target === textarea.value;
  const input = !!target.closest(
    "input,textarea,select,[contenteditable='true']",
  );
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    searchInput.value?.focus();
    return;
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "z" &&
    (!input || inText)
  ) {
    event.preventDefault();
    void undo(event.shiftKey ? "redo" : "undo");
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && inText) {
    event.preventDefault();
    void split(true);
    return;
  }
  if (input) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const originId =
    target.closest<HTMLElement>("[data-segment-id]")?.dataset.segmentId ??
    selectedId.value;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    void rowMove(event.key === "ArrowDown" ? 1 : -1, originId);
  } else if (
    event.key === "Enter" &&
    target.closest(".transcript-row-select")
  ) {
    event.preventDefault();
    const segment = state.value?.document?.segments.find(
      (item) => item.id === originId,
    );
    if (segment) void select(segment, true);
  } else if (event.key === "Tab" && target.closest(".transcript-row-select")) {
    const index =
      state.value?.document?.segments.findIndex(
        (item) => item.id === originId,
      ) ?? -1;
    const absolute = (state.value?.offset ?? 0) + index;
    if (
      (event.shiftKey && absolute > 0) ||
      (!event.shiftKey && absolute < (state.value?.total ?? 0) - 1)
    ) {
      event.preventDefault();
      void rowMove(event.shiftKey ? -1 : 1, originId);
    }
  } else if (event.code === "Space" && !target.closest("button")) {
    event.preventDefault();
    togglePlayback();
  } else if (event.key.toLowerCase() === "b") {
    event.preventDefault();
    void split();
  }
}
watch(
  [query, caseSensitive, () => state.value?.revision],
  () => {
    searchGeneration++;
    searchContext.value = undefined;
    search.value = undefined;
    matchIndex.value = 0;
    searchBusy.value = !!query.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void find(), 250);
  },
  { flush: "sync" },
);
watch([selectedId, () => selected.value?.text], () => {
  const correction = corrections.value;
  if (
    correction &&
    (correction.segmentId !== selectedId.value ||
      correction.after !== selected.value?.text ||
      correction.before === correction.after)
  )
    corrections.value = null;
});
watch(
  () => state.value?.document?.segments,
  (segments) => {
    if (!segments?.length) {
      selectedId.value = "";
      text.value = "";
      return;
    }
    if (!segments.some((segment) => segment.id === selectedId.value))
      selectedId.value = segments[0]!.id;
    const segment = segments.find((item) => item.id === selectedId.value);
    if (segment && segment.text !== text.value) text.value = segment.text;
  },
);
watch(
  () => state.value?.revision,
  () => {
    revisionSelection.value = state.value?.revision ?? "";
  },
);
watch([player, () => props.clip?.transform?.volume], configurePlayer);
watch(
  () => props.active,
  (active) => {
    if (!active) player.value?.pause();
  },
);
onMounted(() => {
  window.addEventListener("keydown", keyboard);
  void poll();
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(polling);
  clearTimeout(searchTimer);
  window.removeEventListener("keydown", keyboard);
  player.value?.pause();
});
</script>
<template>
  <section
    ref="root"
    class="transcript-workspace"
    data-testid="transcript-workspace"
    :aria-label="t('transcript.title')"
    :style="height ? { '--transcript-height': `${height}px` } : undefined"
  >
    <header class="transcript-toolbar">
      <label class="editor-field"
        >{{ t("transcript.selectedSource")
        }}<select
          data-testid="transcript-source-picker"
          :value="clip?.id"
          :disabled="busy"
          @change="chooseClip"
        >
          <option v-for="item in clips" :key="item.id" :value="item.id">
            {{ item.label }}
          </option>
        </select></label
      >
      <div class="editor-actions">
        <button
          class="editor-button"
          :disabled="busy || (!state?.canUndo && !hasPending)"
          @click="undo('undo')"
        >
          {{ t("transcript.undo") }}</button
        ><button
          class="editor-button"
          :disabled="busy || !state?.canRedo || hasPending"
          @click="undo('redo')"
        >
          {{ t("transcript.redo") }}</button
        ><button
          class="editor-button"
          :aria-expanded="toolsOpen"
          :disabled="
            reviewBusy || reviewPending || glossaryBusy || rememberBusy
          "
          @click="toggleTools"
        >
          {{ t(toolsOpen ? "transcript.hideTools" : "transcript.showTools") }}
        </button>
      </div>
      <span
        class="transcript-save"
        data-testid="transcript-save-state"
        :class="status"
        role="status"
        aria-live="polite"
        :aria-label="t('transcript.save')"
        >{{ t(`transcript.${status}`) }}</span
      >
    </header>
    <p v-if="!supported" class="editor-note">
      {{ t("transcript.unsupported") }}
    </p>
    <div v-else class="transcript-body" :class="{ 'tools-open': toolsOpen }">
      <main class="transcript-main">
        <div class="transcript-player" data-testid="transcript-source-preview">
          <video
            v-if="active && !unavailable && asset.mediaType === 'video'"
            :key="sourceKey"
            ref="player"
            crossorigin="anonymous"
            :src="sourceUrl(asset.id, sourceVersion)"
            controls
            preload="metadata"
            :aria-label="t('transcript.play')"
            @loadedmetadata="configurePlayer"
            @timeupdate="playhead = player?.currentTime ?? 0"
            @play="playing = true"
            @pause="playing = false"
            @error="playbackError = true"
          /><audio
            v-else-if="active && !unavailable && asset.mediaType === 'audio'"
            :key="sourceKey"
            ref="player"
            crossorigin="anonymous"
            :src="sourceUrl(asset.id, sourceVersion)"
            controls
            preload="metadata"
            :aria-label="t('transcript.play')"
            @loadedmetadata="configurePlayer"
            @timeupdate="playhead = player?.currentTime ?? 0"
            @play="playing = true"
            @pause="playing = false"
            @error="playbackError = true"
          />
          <p v-if="unavailable || playbackError" class="editor-note">
            {{ t("transcript.sourceUnavailable") }}
          </p>
          <span v-else>{{
            t("transcript.sourceTime", { time: time(playhead) })
          }}</span>
        </div>
        <div
          v-if="error || localError || notice"
          class="editor-error"
          role="alert"
        >
          <p>{{ notice ? t(notice) : localizeError(error ?? localError) }}</p>
          <details v-if="error || localError">
            <summary>{{ t("common.technicalDetails") }}</summary>
            <pre>{{ errorDetail(error ?? localError) }}</pre>
          </details>
          <div v-if="hasPending" class="editor-actions">
            <button
              v-if="status !== 'conflict'"
              class="editor-button"
              @click="flush"
            >
              {{ t("transcript.retrySave") }}</button
            ><button class="editor-button" @click="downloadDraft">
              {{ t("transcript.downloadDraft") }}</button
            ><button class="editor-button" @click="discardConfirmation = true">
              {{ t("transcript.discardDraft") }}
            </button>
          </div>
        </div>
        <div v-if="discardConfirmation" class="transcript-confirm" role="alert">
          <p>{{ t("transcript.discardDraftConfirm") }}</p>
          <button
            class="editor-button"
            @click="
              discardDraft();
              discardConfirmation = false;
            "
          >
            {{ t("transcript.discardDraft") }}</button
          ><button class="editor-button" @click="discardConfirmation = false">
            {{ t("transcript.cancel") }}
          </button>
        </div>
        <template v-if="state?.document">
          <div class="transcript-search">
            <label class="editor-field"
              >{{ t("transcript.search")
              }}<input
                ref="searchInput"
                v-model="query"
                type="search"
                :placeholder="t('transcript.searchPlaceholder')"
                maxlength="20000" /></label
            ><label class="editor-field"
              >{{ t("transcript.replacement")
              }}<input v-model="replacement" maxlength="20000"
            /></label>
            <div class="editor-actions">
              <button
                class="editor-button"
                :disabled="!currentMatch || busy || searchBusy"
                @click="replace(false)"
              >
                {{ t("transcript.replaceCurrent") }}</button
              ><button
                class="editor-button"
                :disabled="
                  !searchIsCurrent ||
                  !search?.totalMatches ||
                  busy ||
                  searchBusy
                "
                @click="replace(true)"
              >
                {{ t("transcript.replaceAll") }}
              </button>
            </div>
            <label class="transcript-check"
              ><input v-model="caseSensitive" type="checkbox" />{{
                t("transcript.caseSensitive")
              }}</label
            ><label class="transcript-check"
              ><input v-model="filter" type="checkbox" />{{
                t("transcript.filterMatches")
              }}</label
            >
            <div v-if="query" class="editor-actions">
              <span role="status" data-testid="transcript-search-status">{{
                t(
                  "transcript.searchCount",
                  { count: formatNumber(search?.totalMatches ?? 0) },
                  search?.totalMatches ?? 0,
                )
              }}</span
              ><button
                class="editor-button"
                :disabled="!currentMatch || searchBusy"
                @click="seekMatch(-1)"
              >
                {{ t("transcript.previousMatch") }}</button
              ><button
                class="editor-button"
                :disabled="!currentMatch || searchBusy"
                @click="seekMatch(1)"
              >
                {{ t("transcript.nextMatch") }}
              </button>
            </div>
          </div>
          <p class="editor-note">{{ t("transcript.replaceAllHint") }}</p>
          <div
            class="transcript-segments"
            role="list"
            :aria-label="t('transcript.mode')"
          >
            <article
              v-for="segment in visible"
              :key="segment.id"
              class="transcript-row"
              :class="{
                selected: selectedId === segment.id,
                current: playhead >= segment.start && playhead < segment.end,
              }"
              data-testid="transcript-row"
              :data-segment-id="segment.id"
              role="listitem"
            >
              <button
                class="transcript-row-select"
                :aria-current="selectedId === segment.id ? 'true' : undefined"
                :aria-label="
                  t('transcript.selectSegment', { time: time(segment.start) })
                "
                @click="select(segment)"
              >
                <time>{{ time(segment.start) }}</time
                ><span>{{ segment.text }}</span>
              </button>
              <div v-if="selectedId === segment.id" class="transcript-selected">
                <label class="editor-field"
                  >{{ t("transcript.text")
                  }}<textarea
                    :ref="(element) => setTextarea(element, segment.id)"
                    v-model="text"
                    data-testid="transcript-text"
                    rows="3"
                    maxlength="20000"
                    :disabled="busy"
                    @input="queueText"
                    @focus="editing = true"
                  />
                </label>
                <p
                  v-if="!timed(segment)"
                  class="transcript-alignment"
                  role="status"
                  data-testid="stale-alignment"
                >
                  {{ t("transcript.timingStale") }}
                </p>
                <p
                  v-if="segment.timingSource === 'estimated'"
                  class="editor-note"
                >
                  {{ t("transcript.timingEstimated") }}
                </p>
                <div class="editor-actions">
                  <button
                    class="editor-button"
                    :disabled="
                      busy ||
                      playhead <= segment.start ||
                      playhead >= segment.end
                    "
                    @click="split()"
                  >
                    {{ t("transcript.splitPlayhead") }}</button
                  ><button
                    class="editor-button"
                    :disabled="busy || segment.text.length < 2"
                    @click="split(true)"
                  >
                    {{ t("transcript.splitCursor") }}</button
                  ><button
                    class="editor-button"
                    :disabled="
                      busy ||
                      (state?.offset === 0 &&
                        state?.document?.segments[0]?.id === segment.id)
                    "
                    @click="
                      structural({
                        type: 'merge-segment',
                        segmentId: segment.id,
                        direction: 'previous',
                      })
                    "
                  >
                    {{ t("transcript.mergePrevious") }}</button
                  ><button
                    class="editor-button"
                    :disabled="
                      busy ||
                      (state?.offset ?? 0) +
                        (state?.document?.segments.findIndex(
                          (item) => item.id === segment.id,
                        ) ?? 0) >=
                        state!.total - 1
                    "
                    @click="
                      structural({
                        type: 'merge-segment',
                        segmentId: segment.id,
                        direction: 'next',
                      })
                    "
                  >
                    {{ t("transcript.mergeNext") }}</button
                  ><button
                    class="editor-button"
                    :disabled="busy"
                    @click="
                      structural({
                        type: 'delete-segment',
                        segmentId: segment.id,
                      })
                    "
                  >
                    {{ t("transcript.deleteSegment") }}
                  </button>
                </div>
              </div>
            </article>
            <p v-if="!visible.length" class="editor-note">
              {{
                t(
                  query && filter
                    ? "transcript.searchNoMatches"
                    : "transcript.noTranscript",
                )
              }}
            </p>
          </div>
          <div class="transcript-pagination">
            <span>{{
              t(
                "transcript.segmentsCount",
                { count: formatNumber(state.total) },
                state.total,
              )
            }}</span
            ><button
              class="editor-button"
              :disabled="busy || state.offset === 0"
              @click="loadPage(Math.max(0, state.offset - 100))"
            >
              {{ t("transcript.previousPage") }}</button
            ><span>{{
              t("transcript.page", {
                page: Math.floor(state.offset / 100) + 1,
                pages: Math.max(1, Math.ceil(state.total / 100)),
              })
            }}</span
            ><button
              class="editor-button"
              :disabled="busy || state.offset + 100 >= state.total"
              @click="loadPage(state.offset + 100)"
            >
              {{ t("transcript.nextPage") }}
            </button>
          </div>
          <div v-if="rememberableCorrection" class="transcript-remember">
            <span>{{ t("transcript.rememberCorrection") }}</span
            ><button class="editor-button" :disabled="busy" @click="remember">
              {{ t("transcript.remember") }}
            </button>
          </div>
          <details class="transcript-history">
            <summary>{{ t("transcript.revision") }}</summary>
            <label class="editor-field"
              >{{ t("transcript.revision")
              }}<select v-model="revisionSelection" :disabled="busy">
                <option
                  v-for="revision in revisions"
                  :key="revision.id"
                  :value="revision.id"
                >
                  {{
                    t(
                      revision.source === "provider"
                        ? "transcript.revisionProvider"
                        : revision.source === "user"
                          ? "transcript.revisionUser"
                          : revision.source === "glossary"
                            ? "transcript.revisionGlossary"
                            : "transcript.revisionReview",
                    )
                  }}
                  ·
                  {{
                    formatDate(revision.createdAt, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      fractionalSecondDigits: 3,
                    })
                  }}
                </option>
              </select></label
            ><button
              class="editor-button"
              :disabled="
                busy ||
                !revisionSelection ||
                revisionSelection === state.revision
              "
              @click="restore(revisionSelection)"
            >
              {{ t("transcript.restoreRevision") }}
            </button>
            <div v-if="revisionTotal > 100" class="editor-actions">
              <button
                class="editor-button"
                :disabled="busy || revisionOffset === 0"
                @click="
                  revisionOffset = Math.max(0, revisionOffset - 100);
                  updateAncillary();
                "
              >
                {{ t("transcript.previousPage") }}</button
              ><span>{{
                t("transcript.page", {
                  page: Math.floor(revisionOffset / 100) + 1,
                  pages: Math.ceil(revisionTotal / 100),
                })
              }}</span
              ><button
                class="editor-button"
                :disabled="busy || revisionOffset + 100 >= revisionTotal"
                @click="
                  revisionOffset += 100;
                  updateAncillary();
                "
              >
                {{ t("transcript.nextPage") }}
              </button>
            </div>
            <p class="editor-note">{{ t("transcript.revisionHint") }}</p>
          </details>
          <p class="editor-note">{{ t("transcript.editHint") }}</p>
        </template>
        <div v-else-if="status !== 'loading'" class="transcript-empty">
          <h3>{{ t("transcript.noTranscript") }}</h3>
          <p>{{ t("transcript.transcribeHint") }}</p>
        </div>
        <p v-else role="status">{{ t("transcript.loading") }}</p>
        <details class="transcript-transcribe" :open="!state?.document">
          <summary>
            {{
              t(
                state?.document
                  ? "transcript.retranscribe"
                  : "transcript.transcribe",
              )
            }}
          </summary>
          <div class="editor-actions">
            <label class="editor-field"
              >{{ t("transcript.language")
              }}<select v-model="language">
                <option
                  v-for="value in ['auto', 'zh', 'en', 'ja'] as const"
                  :key="value"
                  :value="value"
                >
                  {{
                    t(
                      value === "auto"
                        ? "precision.languageAuto"
                        : value === "zh"
                          ? "precision.languageZh"
                          : value === "en"
                            ? "precision.languageEn"
                            : "precision.languageJa",
                    )
                  }}
                </option>
              </select></label
            ><label class="editor-field"
              >{{ t("transcript.execution")
              }}<select v-model="execution">
                <option
                  v-for="value in ['auto', 'cpu', 'gpu'] as const"
                  :key="value"
                  :value="value"
                >
                  {{
                    t(
                      value === "auto"
                        ? "precision.executionAuto"
                        : value === "cpu"
                          ? "precision.executionCpu"
                          : "precision.executionGpu",
                    )
                  }}
                </option>
              </select></label
            ><button
              class="editor-button primary"
              :disabled="
                busy ||
                taskBusy ||
                !transcriptionReady ||
                unavailable ||
                !(asset.duration && asset.duration > 0)
              "
              @click="transcription"
            >
              {{
                t(
                  state?.document
                    ? "transcript.retranscribe"
                    : "transcript.transcribe",
                )
              }}
            </button>
          </div>
          <div v-if="transcribeWarning" class="transcript-confirm" role="alert">
            <p>{{ t("transcript.retranscribeWarning") }}</p>
            <button class="editor-button" @click="transcription">
              {{ t("transcript.continueTranscription") }}</button
            ><button class="editor-button" @click="transcribeWarning = false">
              {{ t("transcript.keepCurrent") }}
            </button>
          </div>
          <p v-if="taskBusy" class="editor-note">
            {{ t("transcript.jobsBusy") }}
          </p>
          <p
            v-if="providers && !providers.transcription.available"
            class="editor-note"
          >
            {{ t("errors.model.unavailable") }}
          </p>
          <div
            v-for="job in transcriptionJobs"
            :key="job.id"
            class="precision-job"
            role="status"
          >
            <span>{{ t("transcript.transcribe") }}</span
            ><progress
              :value="job.progress"
              max="1"
              :aria-label="t('transcript.transcribe')"
            /><span>{{
              formatNumber(job.progress ?? 0, {
                style: "percent",
                maximumFractionDigits: 0,
              })
            }}</span
            ><button
              v-if="job.status === 'queued' || job.status === 'running'"
              class="editor-button"
              @click="cancel(job)"
            >
              {{ t("precision.cancelJob") }}
            </button>
          </div>
        </details>
      </main>
      <aside v-if="toolsOpen" class="transcript-tools">
        <div
          class="editor-mode-switch"
          role="group"
          :aria-label="t('transcript.showTools')"
        >
          <button
            v-for="value in ['glossary', 'suggestions'] as const"
            :key="value"
            class="editor-button"
            :aria-pressed="tool === value"
            :disabled="
              reviewBusy || reviewPending || glossaryBusy || rememberBusy
            "
            @click="selectTool(value)"
          >
            {{ t(`transcript.${value}`) }}
          </button>
        </div>
        <GlossaryPanel
          v-if="tool === 'glossary'"
          ref="glossaryPanel"
          :asset-id="asset.id"
          :flush="flushTranscript"
          :task-busy="taskBusy"
          :blocked="rememberBusy || reviewBusy || reviewPending"
          @busy="glossaryBusy = $event"
          @review="
            tool = 'suggestions';
            emit('activity');
          "
        /><ReviewPanel
          v-else
          ref="reviewPanel"
          :project-id="projectId"
          :asset-id="asset.id"
          :revision="state?.revision"
          :flush="flushTranscript"
          @changed="
            reconcile();
            updateAncillary();
            emit('changed');
          "
          @seek="seekSegment"
          @activity="emit('activity')"
          @busy="reviewBusy = $event"
          @pending="reviewPending = $event"
        />
      </aside>
    </div>
    <p class="transcript-shortcuts">{{ t("transcript.shortcuts") }}</p>
  </section>
</template>
<style scoped>
.transcript-workspace {
  --transcript-preview-height: 220px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: var(--transcript-height, 650px);
  min-height: 420px;
  color: var(--of-text-primary);
}
.transcript-toolbar,
.transcript-pagination {
  display: flex;
  gap: var(--of-space-3);
  align-items: center;
  flex-wrap: wrap;
  padding: 12px 0;
  min-width: 0;
}
.transcript-toolbar > .editor-field {
  flex: 1;
  min-width: 150px;
  max-width: 300px;
}
.transcript-save {
  margin-left: auto;
  white-space: nowrap;
  color: var(--of-text-secondary);
}
.transcript-save.failed,
.transcript-save.conflict {
  color: var(--of-warning);
}
.transcript-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
  flex: 1;
  overflow: hidden;
  gap: 20px;
}
.transcript-body.tools-open {
  grid-template-columns: minmax(0, 1fr) minmax(250px, 310px);
}
.transcript-main,
.transcript-tools {
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 6px;
}
.transcript-main {
  scroll-padding-top: calc(var(--transcript-preview-height) + 48px);
}
.transcript-tools {
  border-left: 1px solid var(--of-border-subtle);
  padding-left: 16px;
}
.transcript-player {
  background: var(--of-surface-1);
  border-radius: var(--of-radius-lg);
  overflow: hidden;
  position: sticky;
  top: 0;
  z-index: var(--of-z-media);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  flex-direction: column;
  min-width: 0;
}
.transcript-player video {
  display: block;
  width: 100%;
  height: var(--transcript-preview-height);
  object-fit: contain;
  background: var(--of-bg);
}
.transcript-player audio {
  width: 100%;
  margin: 16px 0;
}
.transcript-player > span {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  padding: 6px;
  color: var(--of-text-secondary);
}
.transcript-search {
  display: flex;
  gap: 10px;
  align-items: end;
  flex-wrap: wrap;
  min-width: 0;
}
.transcript-search > .editor-field {
  flex: 1 1 180px;
  min-width: 0;
}
.transcript-search .editor-actions {
  flex-wrap: wrap;
}
.transcript-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--of-text-secondary);
}
.transcript-check input {
  width: 16px;
  height: 16px;
  flex: none;
}
.transcript-segments {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.transcript-row {
  border-radius: var(--of-radius-md);
  min-width: 0;
}
.transcript-row.selected {
  background: var(--of-surface-2);
}
.transcript-row.current > .transcript-row-select time {
  text-decoration: underline;
}
.transcript-row-select {
  display: flex;
  gap: 16px;
  background: none;
  border: 0;
  text-align: left;
  color: inherit;
  padding: 14px 12px;
  width: 100%;
  font: inherit;
  cursor: pointer;
  min-width: 0;
}
.transcript-row-select:hover {
  background: var(--of-surface-1);
}
.transcript-row-select time {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--of-text-secondary);
}
.transcript-row-select > span {
  overflow-wrap: anywhere;
  line-height: 1.7;
  min-width: 0;
}
.transcript-selected {
  padding: 0 12px 14px;
}
.transcript-selected textarea {
  resize: vertical;
  width: 100%;
  min-height: 90px;
  line-height: 1.7;
  box-sizing: border-box;
  max-width: 100%;
  font: inherit;
  color: var(--of-text-primary);
  background: var(--of-surface-1);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-md);
  padding: 10px;
}
.transcript-selected .editor-actions {
  flex-wrap: wrap;
  gap: 8px;
}
.transcript-alignment {
  font-size: 12px;
  line-height: 1.6;
  color: var(--of-warning);
}
.transcript-remember,
.transcript-confirm {
  padding: 12px;
  background: var(--of-surface-2);
  border-radius: var(--of-radius-md);
  line-height: 1.6;
}
.transcript-remember {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.transcript-history,
.transcript-transcribe {
  padding: 12px 0;
}
.transcript-history summary,
.transcript-transcribe summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.transcript-transcribe > .editor-actions {
  flex-wrap: wrap;
}
.transcript-empty {
  padding: 24px 12px;
}
.transcript-shortcuts {
  font-size: 11px;
  line-height: 1.6;
  color: var(--of-text-secondary);
  margin: 10px 0 0;
}
.transcript-workspace :deep(.transcript-side-panel) {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.transcript-workspace :deep(.transcript-glossary-form) {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.transcript-workspace :deep(.transcript-glossary-list) {
  list-style: none;
  margin: 0;
  padding: 0;
}
.transcript-workspace :deep(.transcript-glossary-list li) {
  padding: 12px 0;
  border-bottom: 1px solid var(--of-border-subtle);
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.transcript-workspace :deep(.transcript-term) {
  background: none;
  border: 0;
  color: inherit;
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  text-align: left;
  font: inherit;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.transcript-workspace :deep(.transcript-term small) {
  color: var(--of-text-secondary);
  width: 100%;
}
.transcript-workspace :deep(.transcript-suggestion) {
  padding: 14px 0;
  border-bottom: 1px solid var(--of-border-subtle);
  min-width: 0;
}
.transcript-workspace :deep(.transcript-suggestion p) {
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.transcript-workspace :deep(.transcript-suggestion .editor-actions) {
  flex-wrap: wrap;
}
.transcript-workspace :deep(.transcript-review-status) {
  font-size: 11px;
  color: var(--of-text-secondary);
}
.transcript-workspace :deep(.transcript-diff) {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
.transcript-workspace :deep(.transcript-diff small) {
  display: block;
  color: var(--of-text-secondary);
}
.transcript-workspace :deep(.transcript-diff del) {
  text-decoration: line-through;
}
.transcript-workspace :deep(.transcript-diff ins) {
  text-decoration: underline;
  background: var(--of-surface-2);
  text-underline-offset: 3px;
}
.transcript-workspace :deep(hr) {
  border: 0;
  border-top: 1px solid var(--of-border-subtle);
  width: 100%;
}
.transcript-workspace :deep(pre) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.transcript-workspace :deep(.editor-button) {
  white-space: normal;
  line-height: 1.4;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.transcript-workspace :deep(.editor-field input),
.transcript-workspace :deep(.editor-field select) {
  min-width: 0;
  max-width: 100%;
}
.transcript-workspace :deep(button:focus-visible),
.transcript-workspace :deep(input:focus-visible),
.transcript-workspace :deep(textarea:focus-visible) {
  outline: 2px solid var(--of-accent);
  outline-offset: 3px;
}
@media (max-width: 1200px) {
  .transcript-body.tools-open {
    grid-template-columns: minmax(0, 1fr) minmax(235px, 270px);
  }
  .transcript-row-select {
    gap: 10px;
  }
  .transcript-toolbar .editor-actions {
    flex-wrap: wrap;
  }
  .transcript-workspace {
    --transcript-preview-height: 180px;
  }
}
@media (max-height: 800px) {
  .transcript-workspace {
    --transcript-preview-height: 120px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .transcript-workspace * {
    scroll-behavior: auto !important;
    transition: none !important;
  }
}
</style>
