<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  NativeTextInspection,
  NativeTextReference,
} from "@openfilm/application";
import { nativeTextInspection } from "../api";
const props = defineProps<{
  projectId: string;
  compositionId: string;
  revision: string;
  reference: NativeTextReference;
  active: boolean;
}>();
const { t } = useI18n(),
  inspection = ref<NativeTextInspection>(),
  failed = ref(false);
let controller: AbortController | undefined,
  generation = 0;
function clear() {
  generation++;
  controller?.abort();
  controller = undefined;
  inspection.value = undefined;
  failed.value = false;
}
watch(
  () =>
    JSON.stringify([
      props.projectId,
      props.compositionId,
      props.revision,
      props.reference,
      props.active,
    ]),
  async () => {
    clear();
    if (!props.active) return;
    const current = generation,
      pending = new AbortController();
    controller = pending;
    try {
      const result = await nativeTextInspection(
        {
          projectId: props.projectId,
          compositionId: props.compositionId,
          revision: props.revision,
          reference: props.reference,
        },
        pending.signal,
      );
      if (current === generation && !pending.signal.aborted)
        inspection.value = result;
    } catch {
      if (current === generation && !pending.signal.aborted)
        failed.value = true;
    } finally {
      if (controller === pending) controller = undefined;
    }
  },
  { immediate: true },
);
onBeforeUnmount(clear);
</script>
<template>
  <div class="native-font-evidence" role="status">
    <p
      v-if="failed || inspection?.status === 'failed'"
      class="editor-caption-error"
    >
      {{ t("editor.titleFinishing.previewUnavailable") }}
    </p>
    <template v-if="inspection?.status === 'measured'">
      <p
        v-for="run in inspection.runFonts"
        :key="run.id"
        :class="{ 'editor-caption-error': run.diagnostics.length > 0 }"
      >
        {{
          t("editor.titleFinishing.fontUsed", {
            run: t(`editor.titleFinishing.${run.id}`),
            family: run.font.family,
            weight: run.actualWeight,
          })
        }}
        <span v-if="run.diagnostics.length">{{
          t("editor.titleFinishing.fontFallback")
        }}</span>
      </p>
    </template>
  </div>
</template>
