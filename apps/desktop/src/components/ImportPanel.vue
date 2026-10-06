<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { formatNumber } from "../i18n";
import Icon from "./Icon.vue";
const props = defineProps<{
  native: boolean;
  busy: boolean;
  progress?: {
    completed: number;
    total: number;
    bytesUploaded: number;
    totalBytes: number;
  };
}>();
const emit = defineEmits<{
  folder: [path: string];
  files: [paths: string[]];
  upload: [files: File[]];
  error: [error: unknown];
  close: [];
  cancel: [];
}>();
const { t } = useI18n();
const path = ref("");
const folderOpen = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
let removeNativeDrop: (() => void) | undefined;
async function chooseFolder() {
  if (!props.native) {
    folderOpen.value = true;
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const selected = await invoke<string | null>("pick_folder");
    if (selected) emit("folder", selected);
  } catch (error) {
    emit("error", error);
  }
}
async function chooseFiles() {
  if (!props.native) {
    fileInput.value?.click();
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const selected = await invoke<string[] | null>("pick_files");
    if (selected?.length) emit("files", selected);
  } catch (error) {
    emit("error", error);
  }
}
function chosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length) emit("upload", files);
  input.value = "";
}
function dropped(event: DragEvent) {
  dragging.value = false;
  if (props.busy || props.native) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) emit("upload", files);
}
onMounted(async () => {
  if (!props.native) return;
  try {
    const { getCurrentWebviewWindow } =
      await import("@tauri-apps/api/webviewWindow");
    removeNativeDrop = await getCurrentWebviewWindow().onDragDropEvent(
      (event) => {
        dragging.value = event.payload.type === "over";
        if (event.payload.type === "drop" && !props.busy)
          emit("files", event.payload.paths);
      },
    );
  } catch {
    /* The buttons remain available when the platform has no drop events. */
  }
});
onBeforeUnmount(() => removeNativeDrop?.());
</script>
<template>
  <section class="import-panel inline-form" :aria-label="t('app.import.label')">
    <header class="import-heading">
      <div>
        <h2>{{ t("app.import.title") }}</h2>
        <p>{{ t("app.import.description") }}</p>
      </div>
      <button
        class="icon-button"
        :disabled="busy"
        :aria-label="t('app.import.close')"
        @click="emit('close')"
      >
        <Icon name="reject" />
      </button>
    </header>
    <div
      class="import-dropzone"
      :class="{ dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="dropped"
    >
      <Icon name="folder" :size="30" />
      <p>{{ t("app.import.drop") }}</p>
      <div class="import-actions">
        <button class="primary" :disabled="busy" @click="chooseFolder">
          <Icon name="folder" />{{ t("app.import.addFolder") }}</button
        ><button class="secondary" :disabled="busy" @click="chooseFiles">
          <Icon name="plus" />{{ t("app.import.addFiles") }}
        </button>
      </div>
      <input
        ref="fileInput"
        type="file"
        multiple
        hidden
        :aria-label="t('app.import.addFiles')"
        @change="chosen"
      />
    </div>
    <form
      v-if="folderOpen"
      class="import-folder-form"
      @submit.prevent="path.trim() && emit('folder', path.trim())"
    >
      <label class="field"
        >{{ t("app.import.folder")
        }}<input
          v-model="path"
          name="media-folder"
          required
          autocomplete="off" /></label
      ><button class="primary" :disabled="busy">
        {{ t("app.import.submit") }}<Icon name="arrow" />
      </button>
    </form>
    <div v-if="progress" class="import-progress" role="status">
      <p>
        {{
          t("app.import.uploading", {
            completed: formatNumber(progress.completed),
            total: formatNumber(progress.total),
          })
        }}
      </p>
      <progress
        :value="progress.bytesUploaded"
        :max="progress.totalBytes || 1"
        :aria-label="t('app.import.uploadProgress')"
      /><button class="text-button" @click="emit('cancel')">
        {{ t("app.import.cancelUpload") }}
      </button>
    </div>
    <p class="muted">{{ t("app.import.originals") }}</p>
  </section>
</template>
