<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
function isTauri() {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
}
async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return (await import("@tauri-apps/api/core")).invoke<T>(command, args);
}
import App from "../App.vue";
import { configureNativeConnection } from "../api";
import type {
  NativeLocalDraft,
  RetainedNativeDraft,
} from "../native-draft-recovery";
const { t } = useI18n();
const workspace = ref<InstanceType<typeof App> | null>(null);
const opened = ref(!isTauri());
const connectionGeneration = ref(0);
const retainedDrafts = ref<RetainedNativeDraft[]>([]);
let draftSequence = 0;
function retainDrafts(drafts: NativeLocalDraft[]) {
  // A failed Retry leaves this owner mounted. Its latest dirty state supersedes
  // earlier captures from that owner; captures from unmounted owners stay intact.
  const next = retainedDrafts.value.filter(
    (item) => item.generation !== connectionGeneration.value,
  );
  for (const draft of drafts) {
    if (
      next.some(
        ({ id: _id, generation: _generation, ...item }) =>
          JSON.stringify(item) === JSON.stringify(draft),
      )
    )
      continue;
    next.push({
      ...draft,
      id: ++draftSequence,
      generation: connectionGeneration.value,
    });
  }
  // Refuse a remount rather than truncate the only copy. Existing owners stay mounted.
  if (
    next.length > 16 ||
    new TextEncoder().encode(JSON.stringify(next)).byteLength > 1024 * 1024
  )
    throw new Error("runtime.recoveryFull");
  retainedDrafts.value = next;
}
function removeRetainedDrafts(ids: number[]) {
  retainedDrafts.value = retainedDrafts.value.filter(
    (item) => !ids.includes(item.id),
  );
}
function protectRetainedDrafts(event: BeforeUnloadEvent) {
  if (retainedDrafts.value.length) {
    event.preventDefault();
    event.returnValue = "";
  }
}
function protectWorkspaceShortcuts(event: KeyboardEvent) {
  const target = event.target as Element | null;
  if (
    !ready.value ||
    busy.value ||
    closing.value ||
    target?.closest?.(".runtime-drafts")
  )
    event.stopPropagation();
}
function downloadDraft(entry: RetainedNativeDraft) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "openfilm-local-draft.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
const ready = ref(!isTauri());
const busy = ref(false);
const closing = ref(false);
let closeHandling = false;
const failure = ref("");
let disposed = false;
let timer: ReturnType<typeof setInterval> | undefined;
const knownCodes = new Set([
  "unsaved",
  "recoveryFull",
  "missing",
  "hash",
  "invalid",
  "platform",
  "permissions",
  "node",
  "version",
  "license",
  "codecs",
  "font",
  "raster",
  "storage",
  "timeout",
  "handshake",
  "serviceExited",
  "closeFailed",
  "preflight",
]);
function code(value: unknown) {
  const key =
    typeof value === "string" ? value.replace(/^runtime\./u, "") : "preflight";
  return knownCodes.has(key) ? key : "preflight";
}
async function start() {
  if (busy.value) return;
  busy.value = true;
  failure.value = "";
  try {
    retainDrafts(workspace.value?.captureNativeDrafts() ?? []);
    const result = await invoke<{
      state: string;
      port?: number;
      session?: string;
      code?: string;
    }>("native_runtime_start");
    if (disposed) return;
    if (result.state === "ready")
      configureNativeConnection(result.port, result.session);
    if (result.state !== "ready" && result.state !== "development")
      throw new Error(result.code ?? "runtime.preflight");
    connectionGeneration.value += 1;
    opened.value = true;
    ready.value = true;
    if (!timer)
      timer = setInterval(() => {
        void check();
      }, 1000);
  } catch (error) {
    if (!disposed) {
      ready.value = false;
      failure.value = code(error instanceof Error ? error.message : error);
    }
  } finally {
    busy.value = false;
  }
}
async function check() {
  if (disposed || busy.value || closeHandling) return;
  try {
    const result = await invoke<{
      state: string;
      code?: string;
      closeRequestId?: number;
    }>("native_runtime_status");
    if (disposed) return;
    if (result.closeRequestId) {
      closeHandling = true;
      closing.value = true;
      const event = new Event("beforeunload", { cancelable: true });
      try {
        if (retainedDrafts.value.length) event.preventDefault();
        if (
          !event.defaultPrevented &&
          result.state !== "blocked" &&
          workspace.value &&
          !(await workspace.value.prepareNativeClose())
        )
          event.preventDefault();
        window.dispatchEvent(event);
        await invoke("native_runtime_close", {
          requestId: result.closeRequestId,
          cancel: event.defaultPrevented,
        });
        if (event.defaultPrevented) {
          ready.value = false;
          failure.value = "unsaved";
        }
      } catch {
        try {
          await invoke("native_runtime_close", {
            requestId: result.closeRequestId,
            cancel: true,
          });
        } catch {
          /* The owner may already have consumed a failed close request. */
        }
        ready.value = false;
        failure.value = "closeFailed";
      } finally {
        closing.value = false;
        closeHandling = false;
      }
      return;
    }
    if (result.state === "blocked") {
      ready.value = false;
      failure.value = code(result.code);
    }
  } catch {
    if (!disposed) {
      ready.value = false;
      failure.value = "serviceExited";
    }
  }
}
onMounted(() => {
  window.addEventListener("beforeunload", protectRetainedDrafts);
  window.addEventListener("keydown", protectWorkspaceShortcuts, true);
  if (isTauri()) {
    timer = setInterval(() => {
      void check();
    }, 1000);
    void start();
  }
});
onBeforeUnmount(() => {
  disposed = true;
  if (timer) clearInterval(timer);
  window.removeEventListener("beforeunload", protectRetainedDrafts);
  window.removeEventListener("keydown", protectWorkspaceShortcuts, true);
});
</script>
<template>
  <div
    v-if="opened"
    :inert="closing || busy || !ready"
    class="runtime-workspace"
  >
    <App
      :key="connectionGeneration"
      ref="workspace"
      :native-drafts="retainedDrafts"
      :native-generation="connectionGeneration"
      @native-drafts-restored="removeRetainedDrafts"
    />
  </div>
  <aside
    v-if="retainedDrafts.length"
    class="runtime-drafts"
    :aria-label="t('app.nativeRuntime.draftsRetained')"
  >
    <h2>{{ t("app.nativeRuntime.draftsRetained") }}</h2>
    <p>{{ t("app.nativeRuntime.draftsHint") }}</p>
    <ul>
      <li v-for="entry in retainedDrafts" :key="entry.id">
        <span>{{ entry.projectTitle }} · {{ entry.label }}</span>
        <button
          type="button"
          :disabled="busy || !ready"
          @click="workspace?.openNativeDraftProject(entry.projectPath)"
        >
          {{ t("app.nativeRuntime.reopenDraftProject") }}
        </button>
        <button type="button" @click="downloadDraft(entry)">
          {{ t("app.nativeRuntime.downloadDraft") }}
        </button>
        <button type="button" @click="removeRetainedDrafts([entry.id])">
          {{ t("app.nativeRuntime.discardDraft") }}
        </button>
      </li>
    </ul>
  </aside>
  <main
    v-if="!ready || closing"
    class="runtime-gate"
    aria-labelledby="runtime-heading"
  >
    <section class="runtime-card">
      <p class="runtime-eyebrow">OpenFilm</p>
      <h1 id="runtime-heading">{{ t("app.nativeRuntime.title") }}</h1>
      <p v-if="busy || closing" role="status">
        {{ t("app.nativeRuntime.starting") }}
      </p>
      <template v-else>
        <p role="alert">
          {{ t(`app.nativeRuntime.errors.${failure || "preflight"}`) }}
        </p>
        <p>{{ t("app.nativeRuntime.recovery") }}</p>
        <button
          v-if="failure === 'unsaved' || failure === 'recoveryFull'"
          type="button"
          @click="
            ready = true;
            failure = '';
          "
        >
          {{ t("app.actions.back") }}
        </button>
        <button v-else type="button" @click="start">
          {{ t("app.nativeRuntime.retry") }}
        </button>
      </template>
      <p class="runtime-note">{{ t("app.nativeRuntime.local") }}</p>
    </section>
  </main>
</template>
<style scoped>
.runtime-workspace {
  display: contents;
}
.runtime-drafts {
  position: fixed;
  inset: auto 16px 16px;
  z-index: 1100;
  max-height: 45vh;
  overflow: auto;
  padding: 16px;
  color: var(--color-text, #f2f2f2);
  background: var(--color-bg, #101319);
  border: 1px solid currentColor;
  border-radius: 6px;
}
.runtime-drafts li {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.runtime-drafts button {
  margin-block: 4px;
}
.runtime-gate {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--color-bg, #101319);
  color: var(--color-text, #f2f2f2);
  overflow: auto;
}
.runtime-card {
  max-width: 560px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.runtime-eyebrow {
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.7;
}
h1 {
  font-size: clamp(24px, 4vw, 34px);
  line-height: 1.3;
}
button {
  margin-block: 16px;
  padding: 12px 24px;
  min-height: 44px;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
button:focus-visible {
  outline: 3px solid var(--color-accent, #a8c7ff);
  outline-offset: 4px;
}
.runtime-note {
  font-size: 0.9rem;
  opacity: 0.7;
}
</style>
