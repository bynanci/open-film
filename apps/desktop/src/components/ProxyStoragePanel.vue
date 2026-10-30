<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ProxyCacheHealth, ProxyCleanupPreview } from "@openfilm/core";
import { api } from "../api";
import { localizeError } from "../i18n";

const props = defineProps<{
  projectId: string;
  dependencyVersion?: string;
  disabled: boolean;
}>();
const emit = defineEmits<{ changed: [projectId: string] }>();
const { t, locale } = useI18n();
const health = ref<ProxyCacheHealth>();
const opened = ref(false);
const offset = ref(0);
const pending = ref("");
const cancelling = ref(false);
const error = ref("");
const outcome = ref("");
const preview = ref<ProxyCleanupPreview>();
const confirmed = ref(false);
const stoppedConfirmed = ref(false);
const quotaMiB = ref(5120);
let generation = 0;
let requestSequence = 0;
let readController: AbortController | undefined;
let operationController: AbortController | undefined;
let cancelController: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
const busy = computed(() => !!pending.value || !!health.value?.running);
const missing = computed(
  () =>
    health.value?.entries
      .filter((entry) =>
        ["missing", "stale", "unavailable"].includes(entry.status),
      )
      .map((entry) => entry.assetId) ?? [],
);
const retryJobs = computed(
  () =>
    health.value?.entries
      .filter(
        (entry) =>
          ["failed", "cancelled"].includes(entry.status) && entry.jobId,
      )
      .map((entry) => entry.jobId!) ?? [],
);
const usage = computed(() =>
  Math.min(
    1,
    (health.value?.managedBytes ?? 0) / (health.value?.policy.quotaBytes ?? 1),
  ),
);
function bytes(value: number) {
  return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value / 1024 ** 2)} MiB`;
}
function owned(owner: number, projectId: string) {
  return !disposed && generation === owner && props.projectId === projectId;
}
function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
function schedule() {
  clearTimer();
  if (!disposed && (opened.value || health.value?.running))
    timer = setTimeout(
      () => {
        void refresh();
      },
      health.value?.running ? 1000 : 5000,
    );
}
async function refresh() {
  const owner = generation,
    projectId = props.projectId,
    sequence = ++requestSequence;
  readController?.abort();
  const controller = new AbortController();
  readController = controller;
  try {
    const result = await api.proxyCache(
      projectId,
      offset.value,
      controller.signal,
    );
    if (
      !owned(owner, projectId) ||
      sequence !== requestSequence ||
      controller.signal.aborted
    )
      return;
    if (result.health.projectId !== projectId) return;
    const signature = (state: ProxyCacheHealth) =>
      JSON.stringify(
        state.entries
          .filter((entry) => ["ready", "stale"].includes(entry.status))
          .map((entry) => [
            entry.assetId,
            entry.status,
            entry.jobId,
            entry.bytes,
          ]),
      );
    if (health.value && signature(health.value) !== signature(result.health))
      emit("changed", projectId);
    const changedPolicy =
      health.value?.policy.revision !== result.health.policy.revision;
    health.value = result.health;
    if (changedPolicy)
      quotaMiB.value = result.health.policy.quotaBytes / 1024 ** 2;
    if (result.worker?.status === "failed" && result.worker.error)
      error.value = localizeError(result.worker.error);
  } catch (cause) {
    if (
      owned(owner, projectId) &&
      sequence === requestSequence &&
      !controller.signal.aborted
    )
      error.value = localizeError(cause);
  } finally {
    if (owned(owner, projectId) && sequence === requestSequence) schedule();
  }
}
async function act(
  name: string,
  work: (projectId: string, signal: AbortSignal) => Promise<void>,
) {
  if (pending.value || props.disabled) return;
  const owner = generation,
    projectId = props.projectId;
  const controller = new AbortController();
  operationController = controller;
  pending.value = name;
  error.value = "";
  outcome.value = "";
  if (name !== "cleanup") {
    preview.value = undefined;
    confirmed.value = false;
  }
  try {
    await work(projectId, controller.signal);
    if (!owned(owner, projectId) || controller.signal.aborted) return;
    emit("changed", projectId);
    await refresh();
  } catch (cause) {
    if (owned(owner, projectId) && !controller.signal.aborted)
      error.value = localizeError(cause);
  } finally {
    if (owned(owner, projectId)) {
      pending.value = "";
      operationController = undefined;
    }
  }
}
function prepare(assetIds = missing.value) {
  return act("prepare", async (projectId, signal) => {
    await api.proxyQueue(
      { projectId, requestId: crypto.randomUUID(), assetIds },
      signal,
    );
    if (signal.aborted) return;
    await api.proxyRun(projectId, signal);
  });
}
function resume() {
  return act("resume", async (projectId, signal) => {
    await api.proxyResume(
      { projectId, requestId: crypto.randomUUID(), jobIds: retryJobs.value },
      signal,
    );
    if (!signal.aborted) await api.proxyRun(projectId, signal);
  });
}
async function cancel() {
  if (cancelling.value) return;
  const owner = generation,
    projectId = props.projectId;
  const controller = new AbortController();
  cancelController = controller;
  cancelling.value = true;
  try {
    await api.proxyCancel(projectId, controller.signal);
    if (!owned(owner, projectId)) return;
    operationController?.abort();
    outcome.value = t("proxyStorage.cancelRequested");
    await refresh();
  } catch (cause) {
    if (owned(owner, projectId) && !controller.signal.aborted)
      error.value = localizeError(cause);
  } finally {
    if (owned(owner, projectId)) cancelling.value = false;
  }
}
function verify() {
  return act("verify", async (projectId, signal) => {
    const { result } = await api.proxyVerify(
      {
        projectId,
        assetIds: health.value?.entries.map((entry) => entry.assetId) ?? [],
      },
      signal,
    );
    if (!signal.aborted && props.projectId === projectId)
      outcome.value = t("proxyStorage.verificationResult", {
        checked: result.results.filter((entry) => entry.status === "verified")
          .length,
        total: result.results.length,
      });
  });
}
function cleanupPreview() {
  return act("preview", async (projectId, signal) => {
    const { result } = await api.proxyCleanupPreview(projectId, signal);
    if (!signal.aborted && props.projectId === projectId) {
      preview.value = result;
      confirmed.value = false;
    }
  });
}
function cleanupAccept() {
  const review = preview.value;
  if (!review || !confirmed.value) return;
  return act("cleanup", async (projectId, signal) => {
    const { result } = await api.proxyCleanupAccept(
      {
        projectId,
        previewId: review.previewId,
        fingerprint: review.fingerprint,
        confirmed: true,
      },
      signal,
    );
    if (!signal.aborted && props.projectId === projectId) {
      preview.value = undefined;
      confirmed.value = false;
      outcome.value = t("proxyStorage.cleanupResult", {
        bytes: bytes(result.removedBytes),
        failed: result.failedArtifactIds.length,
      });
    }
  });
}
function policy() {
  const current = health.value;
  if (!current) return;
  return act("policy", async (projectId, signal) => {
    await api.proxyPolicy(
      {
        projectId,
        baseRevision: current.policy.revision,
        quotaBytes: Math.round(quotaMiB.value * 1024 ** 2),
      },
      signal,
    );
  });
}
function recover() {
  const recovery = health.value?.recovery;
  if (!recovery || !stoppedConfirmed.value) return;
  return act("recover", async (projectId, signal) => {
    await api.proxyRecover(
      { projectId, fingerprint: recovery.fingerprint, confirmedStopped: true },
      signal,
    );
  });
}
function toggle(event: Event) {
  opened.value = (event.target as HTMLDetailsElement).open;
  if (opened.value) void refresh();
  else schedule();
}
function page(direction: number) {
  offset.value = Math.max(0, offset.value + direction * 100);
  preview.value = undefined;
  confirmed.value = false;
  void refresh();
}
watch(
  () => props.projectId,
  () => {
    generation++;
    requestSequence++;
    readController?.abort();
    operationController?.abort();
    cancelController?.abort();
    clearTimer();
    health.value = undefined;
    preview.value = undefined;
    pending.value = "";
    cancelling.value = false;
    offset.value = 0;
    confirmed.value = false;
    stoppedConfirmed.value = false;
    error.value = "";
    outcome.value = "";
    void refresh();
  },
  { immediate: true, flush: "sync" },
);
watch(
  () => props.dependencyVersion,
  () => {
    void refresh();
  },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  readController?.abort();
  operationController?.abort();
  cancelController?.abort();
  clearTimer();
});
</script>

<template>
  <details class="proxy-storage" @toggle="toggle">
    <summary>
      <span>{{ t("proxyStorage.heading") }}</span
      ><span class="proxy-storage-usage">{{
        health
          ? t("proxyStorage.usage", {
              used: bytes(health.managedBytes),
              quota: bytes(health.policy.quotaBytes),
            })
          : t("proxyStorage.loading")
      }}</span>
    </summary>
    <div class="proxy-storage-body">
      <p>{{ t("proxyStorage.description") }}</p>
      <progress
        v-if="health"
        :value="usage"
        :max="1"
        :aria-label="t('proxyStorage.capacity')"
      />
      <p v-if="health?.unmanagedBytes || health?.temporaryBytes" class="muted">
        {{
          t("proxyStorage.otherUsage", {
            legacy: bytes(health.unmanagedBytes),
            temporary: bytes(health.temporaryBytes),
          })
        }}
      </p>
      <p
        v-if="health && !health.inventoryComplete"
        class="proxy-storage-warning"
      >
        {{ t("proxyStorage.incomplete") }}
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p class="proxy-storage-status" role="status" aria-live="polite">
        {{
          pending
            ? t("proxyStorage.working")
            : health?.running
              ? t("proxyStorage.running")
              : outcome
        }}
      </p>
      <div class="proxy-storage-actions">
        <button
          :disabled="disabled || busy || !missing.length"
          @click="prepare()"
        >
          {{ t("proxyStorage.prepare") }}
        </button>
        <button
          v-if="health?.queued"
          class="secondary"
          :disabled="disabled || busy"
          @click="
            act('run', async (id, signal) => {
              await api.proxyRun(id, signal);
            })
          "
        >
          {{ t("proxyStorage.runQueued", { count: health.queued }) }}
        </button>
        <button
          v-if="retryJobs.length"
          class="secondary"
          :disabled="disabled || busy"
          @click="resume"
        >
          {{ t("proxyStorage.resume") }}
        </button>
        <button
          v-if="busy || health?.queued"
          class="secondary"
          :disabled="cancelling"
          @click="cancel"
        >
          {{ t("proxyStorage.cancel") }}
        </button>
        <button
          class="text-button"
          :disabled="disabled || busy || !health?.entries.length"
          @click="verify"
        >
          {{ t("proxyStorage.verify") }}
        </button>
        <button
          class="text-button"
          :disabled="disabled || busy"
          @click="cleanupPreview"
        >
          {{ t("proxyStorage.previewCleanup") }}
        </button>
        <button class="text-button" :disabled="!!pending" @click="refresh">
          {{ t("proxyStorage.refresh") }}
        </button>
      </div>
      <ul v-if="health?.entries.length" class="proxy-storage-sources">
        <li v-for="entry in health.entries" :key="entry.assetId">
          <span class="proxy-storage-source-name"
            >{{ entry.name
            }}<small v-if="entry.protected">{{
              t("proxyStorage.protected")
            }}</small></span
          >
          <span class="proxy-storage-source-status"
            >{{ t(`proxyStorage.status.${entry.status}`)
            }}<small v-if="entry.verification === 'checked'">{{
              t("proxyStorage.checked")
            }}</small></span
          >
          <button
            v-if="['missing', 'stale', 'unavailable'].includes(entry.status)"
            class="text-button"
            :aria-label="t('proxyStorage.prepareSource', { name: entry.name })"
            :disabled="disabled || busy"
            @click="prepare([entry.assetId])"
          >
            {{ t("proxyStorage.prepareOne") }}
          </button>
        </li>
      </ul>
      <p v-else-if="health">{{ t("proxyStorage.empty") }}</p>
      <nav
        v-if="health && (health.hasNext || offset)"
        class="proxy-storage-actions"
        :aria-label="t('proxyStorage.pages')"
      >
        <button class="secondary" :disabled="!offset || busy" @click="page(-1)">
          {{ t("proxyStorage.previous") }}</button
        ><span>{{
          t("proxyStorage.pageCount", {
            first: offset + 1,
            last: offset + health.entries.length,
            total: health.total,
          })
        }}</span
        ><button
          class="secondary"
          :disabled="!health.hasNext || busy"
          @click="page(1)"
        >
          {{ t("proxyStorage.next") }}
        </button>
      </nav>
      <section
        v-if="preview"
        class="proxy-storage-review"
        :aria-label="t('proxyStorage.cleanupReview')"
      >
        <h3>{{ t("proxyStorage.cleanupReview") }}</h3>
        <p>
          {{
            t("proxyStorage.cleanupSummary", {
              count: preview.entries.length,
              bytes: bytes(preview.bytes),
              protected: preview.protectedCount,
            })
          }}
        </p>
        <ul>
          <li v-for="entry in preview.entries" :key="entry.artifactId">
            {{ entry.name }} · {{ bytes(entry.byteLength) }}
          </li>
        </ul>
        <p v-if="preview.hasMore">{{ t("proxyStorage.moreCleanup") }}</p>
        <label v-if="preview.entries.length" class="proxy-storage-confirm"
          ><input v-model="confirmed" type="checkbox" />{{
            t("proxyStorage.confirmCleanup")
          }}</label
        >
        <button
          class="secondary"
          :disabled="disabled || busy || !confirmed || !preview.entries.length"
          @click="cleanupAccept"
        >
          {{ t("proxyStorage.acceptCleanup") }}
        </button>
      </section>
      <details class="proxy-storage-settings">
        <summary>{{ t("proxyStorage.settings") }}</summary>
        <form @submit.prevent="policy">
          <label
            >{{ t("proxyStorage.quota")
            }}<input
              v-model.number="quotaMiB"
              type="number"
              min="1"
              max="1048576"
              step="1"
              required
              :disabled="disabled || busy" /></label
          ><button class="secondary" :disabled="disabled || busy || !health">
            {{ t("proxyStorage.savePolicy") }}
          </button>
          <p>{{ t("proxyStorage.quotaHint") }}</p>
        </form>
      </details>
      <section
        v-if="health?.recovery && health.recovery.ownerState !== 'alive'"
        class="proxy-storage-review"
      >
        <h3>{{ t("proxyStorage.recovery") }}</h3>
        <p>{{ t("proxyStorage.recoveryHint") }}</p>
        <label class="proxy-storage-confirm"
          ><input v-model="stoppedConfirmed" type="checkbox" />{{
            t("proxyStorage.confirmStopped")
          }}</label
        ><button
          class="secondary"
          :disabled="disabled || !!pending || !stoppedConfirmed"
          @click="recover"
        >
          {{ t("proxyStorage.recover") }}
        </button>
      </section>
    </div>
  </details>
</template>
