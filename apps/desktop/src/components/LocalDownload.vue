<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { fetchDownloadBlob } from "../api";
import { localizeError } from "../i18n";
defineOptions({ inheritAttrs: false });
const props = defineProps<{ href: string; filename: string; owner: string }>();
const loading = ref(false);
const error = ref<unknown>();
let active: AbortController | undefined;
let disposed = false;
function invalidate() {
  active?.abort();
  active = undefined;
  loading.value = false;
  error.value = undefined;
}
watch(() => [props.owner, props.href, props.filename], invalidate, {
  flush: "sync",
});
onBeforeUnmount(() => {
  disposed = true;
  invalidate();
});
async function download(event: MouseEvent) {
  // Keep ordinary browser downloads streaming through the native anchor.
  // Cross-origin service navigation lacks Origin, so use a CORS fetch there.
  if (
    new URL(props.href, window.location.href).origin === window.location.origin
  )
    return;
  event.preventDefault();
  if (active || disposed) return;
  const controller = new AbortController();
  active = controller;
  loading.value = true;
  error.value = undefined;
  try {
    const blob = await fetchDownloadBlob(props.href, controller.signal);
    if (disposed || active !== controller || controller.signal.aborted) return;
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download =
        props.filename.split(/[\\/]/u).at(-1) || "openfilm-download";
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
    } finally {
      // Give the browser's download task its turn before releasing the blob.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  } catch (cause) {
    if (!disposed && active === controller && !controller.signal.aborted)
      error.value = cause;
  } finally {
    if (active === controller) {
      active = undefined;
      loading.value = false;
    }
  }
}
</script>
<template>
  <a
    v-bind="$attrs"
    :href="href"
    :download="filename"
    :aria-busy="loading"
    :aria-disabled="loading || undefined"
    @click="download"
    ><slot
  /></a>
  <span v-if="error" class="local-download-error" role="alert">{{
    localizeError(error)
  }}</span>
</template>
<style scoped>
.local-download-error {
  display: block;
  color: var(--of-danger);
  overflow-wrap: anywhere;
}
</style>
