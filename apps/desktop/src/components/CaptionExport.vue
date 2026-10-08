<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { CaptionFormat, CaptionIssue, Composition } from "@openfilm/core";
import type {
  CaptionPublication,
  CaptionSnapshotPage,
} from "@openfilm/application";
import { api, ApiError, captionDownloadUrl } from "../api";
import { errorDetail, formatNumber, localizeError } from "../i18n";

const props = defineProps<{
  projectId: string;
  composition: Composition;
  busy: boolean;
}>();
const { t, te } = useI18n();
const trackId = ref("");
const snapshot = shallowRef<CaptionSnapshotPage | null>(null);
const publication = shallowRef<CaptionPublication | null>(null);
const error = shallowRef<unknown>(null);
const loading = ref(false);
const localStale = ref(false);
const cancelled = ref(false);
const cuePageSize = 100;
const issuePageSize = 20;
let generation = 0;
let controller = new AbortController();
let disposed = false;
const tracks = computed(() =>
  props.composition.tracks.filter((track) =>
    ["video", "audio", "music"].includes(track.type),
  ),
);
const stale = computed(() => localStale.value || !!snapshot.value?.stale);
const canExport = computed(
  () =>
    !!snapshot.value?.exportable &&
    !stale.value &&
    !loading.value &&
    !props.busy,
);
const status = computed(() =>
  loading.value
    ? "loading"
    : error.value
      ? "failed"
      : cancelled.value
        ? "cancelled"
        : stale.value
          ? "stale"
          : snapshot.value
            ? snapshot.value.issueCount
              ? "attention"
              : "ready"
            : "idle",
);

function invalidate() {
  generation++;
  controller.abort();
  controller = new AbortController();
  loading.value = false;
  publication.value = null;
  error.value = null;
  cancelled.value = false;
}
function cancel() {
  invalidate();
  cancelled.value = true;
}
watch(
  () => [props.projectId, props.composition.id],
  () => {
    invalidate();
    snapshot.value = null;
    localStale.value = false;
    trackId.value = "";
  },
  { flush: "sync" },
);
watch(
  () => JSON.stringify(props.composition),
  () => {
    invalidate();
    localStale.value = !!snapshot.value;
  },
  { flush: "sync" },
);
watch(
  trackId,
  () => {
    invalidate();
    snapshot.value = null;
    localStale.value = false;
  },
  { flush: "sync" },
);
onBeforeUnmount(() => {
  disposed = true;
  invalidate();
});

function begin() {
  invalidate();
  loading.value = true;
  const epoch = generation;
  const projectId = props.projectId;
  const compositionId = props.composition.id;
  const signal = controller.signal;
  return {
    projectId,
    compositionId,
    signal,
    current: () =>
      !disposed &&
      !signal.aborted &&
      epoch === generation &&
      projectId === props.projectId &&
      compositionId === props.composition.id,
  };
}
function acceptSnapshot(
  value: CaptionSnapshotPage,
  projectId: string,
  compositionId: string,
) {
  if (
    value.projectId !== projectId ||
    value.compositionId !== compositionId ||
    value.trackId !== trackId.value
  )
    throw new ApiError(
      "The caption response belongs to a different selection.",
      409,
      { code: "workspace.invalidResponse" },
    );
  snapshot.value = value;
  localStale.value = false;
}
async function generate() {
  if (
    disposed ||
    loading.value ||
    props.busy ||
    !tracks.value.some((track) => track.id === trackId.value)
  )
    return;
  const task = begin();
  const selectedTrack = trackId.value;
  try {
    const context = await api.captionContext(
      task.projectId,
      task.compositionId,
      task.signal,
    );
    if (!task.current()) return;
    if (
      context.projectId !== task.projectId ||
      context.compositionId !== task.compositionId ||
      !context.revision
    )
      throw new ApiError(
        "The caption context belongs to a different film.",
        409,
        { code: "workspace.invalidResponse" },
      );
    const result = await api.prepareCaptions(
      {
        projectId: task.projectId,
        compositionId: task.compositionId,
        trackId: selectedTrack,
        baseRevision: context.revision,
      },
      task.signal,
    );
    if (task.current())
      acceptSnapshot(result, task.projectId, task.compositionId);
  } catch (cause) {
    if (task.current()) error.value = cause;
  } finally {
    if (task.current()) loading.value = false;
  }
}
async function loadPage(offset: number, issueOffset: number) {
  if (disposed || loading.value || !snapshot.value) return;
  const id = snapshot.value.id;
  const task = begin();
  try {
    const result = await api.captionSnapshot(
      id,
      {
        projectId: task.projectId,
        offset: Math.max(0, offset),
        limit: cuePageSize,
        issueOffset: Math.max(0, issueOffset),
        issueLimit: issuePageSize,
      },
      task.signal,
    );
    if (task.current())
      acceptSnapshot(result, task.projectId, task.compositionId);
  } catch (cause) {
    if (task.current()) error.value = cause;
  } finally {
    if (task.current()) loading.value = false;
  }
}
async function publish(format: CaptionFormat) {
  if (disposed || !canExport.value || !snapshot.value) return;
  const previous = snapshot.value;
  const task = begin();
  try {
    // Refresh transcript/source state as well as the composition before publication.
    const latest = await api.captionSnapshot(
      previous.id,
      {
        projectId: task.projectId,
        offset: previous.offset,
        limit: cuePageSize,
        issueOffset: previous.issueOffset,
        issueLimit: issuePageSize,
      },
      task.signal,
    );
    if (!task.current()) return;
    acceptSnapshot(latest, task.projectId, task.compositionId);
    if (!latest.exportable || latest.stale) return;
    const result = await api.exportCaptions(
      { projectId: task.projectId, snapshotId: latest.id, format },
      task.signal,
    );
    if (!task.current()) return;
    if (
      result.projectId !== task.projectId ||
      result.snapshotId !== latest.id ||
      result.format !== format
    )
      throw new ApiError(
        "The caption publication belongs to a different film.",
        409,
        { code: "workspace.invalidResponse" },
      );
    publication.value = result;
  } catch (cause) {
    if (task.current()) {
      error.value = cause;
      if (cause instanceof ApiError && cause.code === "captions.stale")
        localStale.value = true;
    }
  } finally {
    if (task.current()) loading.value = false;
  }
}
function time(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}
function issueText(issue: CaptionIssue) {
  const key = `captions.issues.${issue.code}`;
  return te(key) ? t(key, issue.params ?? {}) : t("captions.issues.unknown");
}
</script>

<template>
  <details class="caption-export" data-testid="caption-export">
    <summary>{{ t("captions.title") }}</summary>
    <p>{{ t("captions.description") }}</p>
    <p class="caption-composition">
      {{ t("captions.composition") }}
      <code :title="composition.id">{{ composition.id }}</code>
    </p>
    <label class="field"
      >{{ t("captions.sourceTrack") }}
      <select
        v-model="trackId"
        data-testid="caption-track"
        :disabled="loading || busy"
      >
        <option value="">{{ t("captions.chooseTrack") }}</option>
        <option v-for="track in tracks" :key="track.id" :value="track.id">
          {{ t(`captions.trackTypes.${track.type}`) }} · {{ track.id }}
        </option>
      </select>
    </label>
    <p v-if="!tracks.length">{{ t("captions.noTracks") }}</p>
    <p class="caption-hint">{{ t("captions.singleTrack") }}</p>
    <div class="caption-actions">
      <button
        data-testid="caption-generate"
        :disabled="!trackId || loading || busy"
        @click="generate"
      >
        {{ t("captions.generate") }}
      </button>
      <button v-if="loading" @click="cancel">{{ t("captions.cancel") }}</button>
      <button
        v-if="snapshot"
        :disabled="loading || busy"
        @click="loadPage(snapshot.offset, snapshot.issueOffset)"
      >
        {{ t("captions.checkStatus") }}
      </button>
    </div>
    <p
      role="status"
      aria-live="polite"
      data-testid="caption-status"
      :data-status="status"
    >
      {{ t(`captions.status.${status}`) }}
    </p>
    <div v-if="error" class="caption-error" role="alert">
      <p>{{ localizeError(error) }}</p>
      <details>
        <summary>{{ t("common.technicalDetails") }}</summary>
        <pre>{{ errorDetail(error) }}</pre>
      </details>
    </div>
    <template v-if="snapshot">
      <p class="caption-hint">{{ t("captions.previewOnly") }}</p>
      <p>
        {{
          t(
            "captions.cueCount",
            { count: snapshot.cueCount },
            snapshot.cueCount,
          )
        }}
      </p>
      <p v-if="snapshot.errorCount">{{ t("captions.blocked") }}</p>
      <p v-if="!snapshot.cueCount">{{ t("captions.noCues") }}</p>
      <ol
        class="caption-cues"
        data-testid="caption-cues"
        tabindex="0"
        :start="snapshot.offset + 1"
        :aria-label="t('captions.preview')"
      >
        <li
          v-for="cue in snapshot.cues"
          :key="cue.id"
          data-testid="caption-cue"
        >
          <span class="caption-time"
            >{{ time(cue.startMs) }} → {{ time(cue.endMs) }}</span
          >
          <p class="caption-text">{{ cue.text }}</p>
          <small
            >{{ t("captions.asset") }}
            <code :title="cue.assetId">{{ cue.assetName ?? cue.assetId }}</code>
            ·
            {{ t("captions.revision") }}
            <code class="caption-revision" :title="cue.transcriptRevisionId">{{
              cue.transcriptRevisionId
            }}</code></small
          >
        </li>
      </ol>
      <nav
        v-if="snapshot.cueCount > snapshot.limit"
        class="caption-pages"
        :aria-label="t('captions.preview')"
      >
        <button
          :disabled="loading || snapshot.offset === 0"
          @click="
            loadPage(snapshot.offset - snapshot.limit, snapshot.issueOffset)
          "
        >
          {{ t("captions.previous") }}
        </button>
        <span>{{
          t("captions.page", {
            from: formatNumber(snapshot.offset + 1),
            to: formatNumber(
              Math.min(
                snapshot.offset + snapshot.cues.length,
                snapshot.cueCount,
              ),
            ),
            total: formatNumber(snapshot.cueCount),
          })
        }}</span>
        <button
          :disabled="
            loading ||
            snapshot.offset + snapshot.cues.length >= snapshot.cueCount
          "
          @click="
            loadPage(snapshot.offset + snapshot.limit, snapshot.issueOffset)
          "
        >
          {{ t("captions.next") }}
        </button>
      </nav>
      <section
        v-if="snapshot.issueCount"
        class="caption-warnings"
        :aria-label="t('captions.attention')"
      >
        <h4>
          {{ t("captions.attention") }} ·
          {{ formatNumber(snapshot.issueCount) }}
        </h4>
        <ul
          data-testid="caption-issues"
          tabindex="0"
          :aria-label="t('captions.attention')"
        >
          <li
            v-for="(issue, index) in snapshot.issues"
            :key="snapshot.issueOffset + index"
          >
            <strong>{{ t(`captions.severity.${issue.severity}`) }}</strong>
            {{ issueText(issue) }}
            <small v-if="issue.startMs !== undefined" class="caption-time"
              >{{ time(issue.startMs)
              }}<template v-if="issue.endMs !== undefined">
                → {{ time(issue.endMs) }}</template
              ></small
            >
            <small v-if="issue.assetId || issue.clipId" class="caption-origin"
              ><template v-if="issue.assetId"
                >{{ t("captions.asset") }}
                <code>{{ issue.assetId }}</code></template
              ><template v-if="issue.clipId">
                · {{ t("captions.clip") }}
                <code>{{ issue.clipId }}</code></template
              ></small
            >
          </li>
        </ul>
        <nav
          v-if="snapshot.issueCount > snapshot.issueLimit"
          class="caption-pages"
          :aria-label="t('captions.attention')"
        >
          <button
            :disabled="loading || snapshot.issueOffset === 0"
            @click="
              loadPage(
                snapshot.offset,
                snapshot.issueOffset - snapshot.issueLimit,
              )
            "
          >
            {{ t("captions.previous") }}
          </button>
          <span>{{
            t("captions.page", {
              from: formatNumber(snapshot.issueOffset + 1),
              to: formatNumber(
                Math.min(
                  snapshot.issueOffset + snapshot.issues.length,
                  snapshot.issueCount,
                ),
              ),
              total: formatNumber(snapshot.issueCount),
            })
          }}</span>
          <button
            :disabled="
              loading ||
              snapshot.issueOffset + snapshot.issues.length >=
                snapshot.issueCount
            "
            @click="
              loadPage(
                snapshot.offset,
                snapshot.issueOffset + snapshot.issueLimit,
              )
            "
          >
            {{ t("captions.next") }}
          </button>
        </nav>
      </section>
      <div class="caption-actions">
        <button
          data-testid="caption-export-srt"
          :disabled="!canExport"
          @click="publish('srt')"
        >
          {{ t("captions.exportSrt") }}
        </button>
        <button
          data-testid="caption-export-vtt"
          :disabled="!canExport"
          @click="publish('vtt')"
        >
          {{ t("captions.exportVtt") }}
        </button>
      </div>
      <div v-if="publication" class="caption-publication" role="status">
        <p>{{ t("captions.saved") }}</p>
        <code>{{ publication.fileName }}</code>
        <div class="caption-actions">
          <a
            data-testid="caption-download"
            :href="captionDownloadUrl(publication.id, projectId, 'captions')"
            download
            >{{ t("captions.download") }}</a
          >
          <a
            data-testid="caption-manifest"
            :href="captionDownloadUrl(publication.id, projectId, 'manifest')"
            download
            >{{ t("captions.downloadManifest") }}</a
          >
        </div>
      </div>
    </template>
  </details>
</template>

<style scoped>
.caption-export {
  grid-column: 1 / -1;
  margin-block: var(--of-space-5);
  padding-block: var(--of-space-4);
  border-block: 1px solid var(--of-border-subtle);
  min-width: 0;
}
.caption-export > summary {
  font-weight: 600;
  cursor: pointer;
}
.caption-export p {
  margin-block: var(--of-space-3);
}
.caption-export .field {
  max-width: 100%;
}
.caption-export select {
  min-width: 0;
  max-width: 100%;
  text-overflow: ellipsis;
}
.caption-composition,
.caption-hint,
.caption-cues small {
  color: var(--of-text-secondary);
}
.caption-export code,
.caption-export pre,
.caption-cues small {
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: pre-wrap;
}
.caption-actions,
.caption-pages {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--of-space-3);
  margin-block: var(--of-space-3);
}
.caption-actions > *,
.caption-pages > * {
  min-width: 0;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}
.caption-cues {
  padding-inline-start: var(--of-space-5);
  max-height: 28rem;
  overflow-y: auto;
}
.caption-cues li {
  padding: var(--of-space-3);
  border-bottom: 1px solid var(--of-border-subtle);
}
.caption-revision {
  display: inline-block;
  max-width: 18ch;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}
.caption-export code.caption-revision {
  white-space: nowrap;
}
.caption-time {
  display: block;
  font-variant-numeric: tabular-nums;
  font-size: var(--of-font-small);
}
.caption-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.caption-cues small,
.caption-origin {
  display: block;
}
.caption-warnings {
  border-inline-start: 2px solid var(--of-border-subtle);
  padding-inline-start: var(--of-space-4);
}
.caption-warnings ul {
  max-height: 28rem;
  overflow-y: auto;
  padding-inline-start: var(--of-space-5);
}
.caption-warnings li {
  margin-block: var(--of-space-3);
  overflow-wrap: anywhere;
}
.caption-error,
[data-status="failed"],
[data-status="stale"] {
  color: var(--of-danger);
}
.caption-publication {
  padding: var(--of-space-3);
  background: var(--of-surface-2);
  border-radius: var(--of-radius-md);
}
.caption-export :focus-visible {
  outline: 2px solid var(--of-accent);
  outline-offset: 3px;
}
</style>
