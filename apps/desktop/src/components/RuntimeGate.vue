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
const { t } = useI18n();
const workspace = ref<InstanceType<typeof App> | null>(null);
const opened = ref(!isTauri());
const ready = ref(!isTauri());
const busy = ref(false);
const closing = ref(false);
let closeHandling = false;
const failure = ref("");
let disposed = false;
let timer: ReturnType<typeof setInterval> | undefined;
const knownCodes = new Set([
  "unsaved",
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
        if (workspace.value && !(await workspace.value.prepareNativeClose()))
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
});
</script>
<template>
  <div v-if="opened" :inert="closing" class="runtime-workspace">
    <App ref="workspace" />
  </div>
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
          v-if="failure === 'unsaved'"
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
