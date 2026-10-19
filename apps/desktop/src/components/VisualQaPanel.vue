<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Job } from "@openfilm/core";
import type { VisualQaReport } from "@openfilm/application";
import { api, visualQaFrameUrl } from "../api";

const props = defineProps<{
  projectId: string;
  compositionId: string;
  revision: string;
}>();
const emit = defineEmits<{ navigate: [time: number]; close: [] }>();
const { t } = useI18n();
const busy = ref(false);
const error = ref(false);
const job = ref<Job>();
const report = ref<VisualQaReport>();
const jobId = ref("");
let disposed = false;
let generation = 0;
const invalidating = ref(false);

const progress = computed(() => Math.round((job.value?.progress ?? 0) * 100));
const statusLabel = computed(() => {
  if (invalidating.value) return t("editor.visualQa.stopping");
  if (busy.value)
    return t("editor.visualQa.running", { progress: progress.value });
  if (report.value?.status)
    return t(`editor.visualQa.status.${report.value.status}`);
  return "";
});

function timeLabel(value: number): string {
  const milliseconds = Math.max(0, Math.round(value * 1000));
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

function issueLabel(code: string): string {
  const labels: Record<string, string> = {
    "asset.missing": "missingAsset",
    "asset.changed": "changedAsset",
    "asset.unsupported": "unsupportedAsset",
    "font.load-failed": "fontFailure",
    "title.overflow": "titleOverflow",
    "visual.suspected-blank": "suspectedBlank",
    "revision.stale": "staleRevision",
  };
  const key = labels[code];
  return key
    ? t(`editor.visualQa.issues.${key}`)
    : t("editor.visualQa.issues.review");
}

async function run() {
  if (busy.value) return;
  const currentGeneration = ++generation;
  busy.value = true;
  invalidating.value = false;
  error.value = false;
  report.value = undefined;
  job.value = undefined;
  try {
    const { jobId: nextId } = await api.startVisualQa(props.compositionId);
    if (disposed || currentGeneration !== generation) {
      void api.cancelJob(nextId).catch(() => {});
      return;
    }
    jobId.value = nextId;
    while (!disposed && currentGeneration === generation) {
      const state = await api.visualQa(nextId);
      if (disposed || currentGeneration !== generation) break;
      job.value = state.job;
      if (state.report) report.value = state.report;
      if (
        !state.active &&
        (state.report ||
          ["completed", "failed", "cancelled"].includes(state.job.status))
      ) {
        error.value = !state.report && state.job.status === "failed";
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  } catch {
    if (currentGeneration === generation) error.value = true;
  } finally {
    if (currentGeneration === generation) busy.value = false;
  }
}

async function cancel() {
  if (!jobId.value) return;
  try {
    await api.cancelJob(jobId.value);
  } catch {
    error.value = true;
  }
}

watch(
  () => [props.projectId, props.compositionId, props.revision] as const,
  () => {
    const token = ++generation;
    const previousJobId = jobId.value;
    report.value = undefined;
    job.value = undefined;
    error.value = false;
    invalidating.value = !!previousJobId;
    if (!previousJobId) {
      busy.value = false;
      return;
    }
    busy.value = true;
    void (async () => {
      try {
        await api.cancelJob(previousJobId).catch(() => {});
        for (let attempt = 0; attempt < 100; attempt++) {
          const state = await api
            .visualQa(previousJobId)
            .catch(() => undefined);
          if (!state?.active) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } finally {
        if (token === generation) {
          jobId.value = "";
          busy.value = false;
          invalidating.value = false;
        }
      }
    })();
  },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  const activeJobId = jobId.value;
  if (activeJobId) void api.cancelJob(activeJobId).catch(() => {});
});
</script>

<template>
  <section class="visual-qa-panel" :aria-label="t('editor.visualQa.region')">
    <div class="visual-qa-heading">
      <div>
        <h3>{{ t("editor.visualQa.heading") }}</h3>
        <p>{{ t("editor.visualQa.description") }}</p>
      </div>
      <div class="visual-qa-actions">
        <button v-if="busy" class="editor-button" type="button" @click="cancel">
          {{ t("editor.visualQa.cancel") }}
        </button>
        <button v-else class="editor-button primary" type="button" @click="run">
          {{ report ? t("editor.visualQa.retry") : t("editor.visualQa.run") }}
        </button>
        <button class="editor-button" type="button" @click="emit('close')">
          {{ t("editor.visualQa.closePanel") }}
        </button>
      </div>
    </div>

    <p
      v-if="busy || statusLabel"
      class="visual-qa-status"
      role="status"
      aria-live="polite"
    >
      {{ statusLabel }}
    </p>
    <p v-if="error" class="visual-qa-error" role="alert">
      {{ t("editor.visualQa.failed") }}
    </p>
    <template v-if="report">
      <p class="visual-qa-note">{{ t("editor.visualQa.manualReview") }}</p>
      <ul
        v-if="report.issues.length"
        class="visual-qa-issues"
        :aria-label="t('editor.visualQa.issues.region')"
      >
        <li
          v-for="(issue, index) in report.issues"
          :key="`${issue.code}:${issue.clipId ?? issue.assetId ?? index}:${issue.at}`"
        >
          <button
            class="visual-qa-issue"
            type="button"
            :aria-label="
              t('editor.visualQa.locateIssue', { time: timeLabel(issue.at) })
            "
            @click="emit('navigate', issue.at)"
          >
            <span class="visual-qa-issue-kind">{{
              issueLabel(issue.code)
            }}</span>
            <time>{{ timeLabel(issue.at) }}</time>
            <span v-if="issue.manualReview" class="visual-qa-review-tag">
              {{ t("editor.visualQa.manual") }}
            </span>
          </button>
        </li>
      </ul>
      <p v-else class="visual-qa-clear">{{ t("editor.visualQa.noIssues") }}</p>
      <div
        v-if="report.samples.length"
        class="visual-qa-sheet"
        :aria-label="t('editor.visualQa.contactSheet')"
      >
        <button
          v-for="sample in report.samples"
          :key="sample.index"
          class="visual-qa-sample"
          type="button"
          :aria-label="
            t('editor.visualQa.openSample', {
              time: timeLabel(sample.timestamp),
            })
          "
          @click="emit('navigate', sample.timestamp)"
        >
          <img
            :src="visualQaFrameUrl(report.id, sample.index)"
            alt=""
            loading="lazy"
          />
          <time>{{ timeLabel(sample.timestamp) }}</time>
        </button>
      </div>
    </template>
  </section>
</template>
