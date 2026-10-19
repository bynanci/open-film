<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AudioGenerationReceipt } from "@openfilm/application";
import { api } from "../api";
const props = defineProps<{
  projectId: string;
  compositionId: string;
  revision: string;
  disabled: boolean;
}>();
const emit = defineEmits<{
  import: [id: string, start: number, complete: (ok: boolean) => void];
}>();
const { t } = useI18n();
const providers = ref<
  { id: string; name: string; execution: string; endpoint?: string }[]
>([]);
const providerId = ref("local-audio-mock");
const text = ref("");
const consent = ref(false);
const cost = ref(false);
const start = ref(0);
const receipt = ref<AudioGenerationReceipt>();
const busy = ref(false);
const importing = ref(false);
const failed = ref(false);
let generation = 0;
let controller: AbortController | undefined;
function reset() {
  generation++;
  controller?.abort();
  receipt.value = undefined;
  busy.value = false;
  failed.value = false;
}
watch(
  () => [
    props.projectId,
    props.compositionId,
    props.revision,
    providerId.value,
    text.value,
  ],
  reset,
);
watch(
  () => [props.projectId, props.compositionId, providerId.value],
  () => {
    text.value = "";
    consent.value = false;
    cost.value = false;
  },
);
onBeforeUnmount(reset);
onMounted(async () => {
  try {
    providers.value = await api.audioGenerationProviders();
  } catch {
    failed.value = true;
  }
});
async function generate() {
  reset();
  const token = generation;
  controller = new AbortController();
  busy.value = true;
  try {
    const result = await api.generateAudio(
      props.compositionId,
      {
        baseRevision: props.revision,
        providerId: providerId.value,
        text: text.value,
        consent: consent.value,
        acknowledgeUnknownCost: cost.value,
      },
      controller.signal,
    );
    if (token === generation) receipt.value = result;
  } catch {
    if (token === generation) failed.value = true;
  } finally {
    if (token === generation) busy.value = false;
  }
}
async function accept() {
  const value = receipt.value;
  if (!value || busy.value || props.disabled) return;
  busy.value = true;
  const token = generation;
  try {
    const result = await api.acceptGeneratedAudio(value.id, props.projectId);
    if (token === generation) receipt.value = result;
  } catch {
    if (token === generation) failed.value = true;
  } finally {
    if (token === generation) busy.value = false;
  }
}
function importAudio() {
  if (!receipt.value?.accepted || props.disabled || importing.value) return;
  importing.value = true;
  emit("import", receipt.value.id, start.value, (ok) => {
    importing.value = false;
    if (ok) reset();
    else failed.value = true;
  });
}
</script>
<template>
  <section
    class="audio-generation-panel"
    :aria-label="t('editor.audioGeneration.title')"
  >
    <strong>{{ t("editor.audioGeneration.title") }}</strong>
    <p>{{ t("editor.audioGeneration.disclosure") }}</p>
    <label
      >{{ t("editor.audioGeneration.provider")
      }}<select v-model="providerId" :disabled="busy || importing || disabled">
        <option
          v-for="provider in providers"
          :key="provider.id"
          :value="provider.id"
        >
          {{
            provider.id === "local-audio-mock"
              ? t("editor.audioGeneration.mock")
              : provider.name
          }}
        </option>
      </select></label
    >
    <p v-if="providerId === 'local-audio-mock'">
      {{ t("editor.audioGeneration.mock") }}
    </p>
    <p v-else>
      {{ t("editor.audioGeneration.remoteCost") }}
      {{ providers.find((p) => p.id === providerId)?.endpoint }}
    </p>
    <label
      >{{ t("editor.audioGeneration.text")
      }}<textarea
        v-model="text"
        data-testid="audio-generation-text"
        maxlength="1000"
        :disabled="busy || importing || disabled"
      />
    </label>
    <label
      ><input
        v-model="consent"
        data-testid="audio-generation-consent"
        type="checkbox"
        :disabled="busy || importing || disabled"
      />{{ t("editor.audioGeneration.consent") }}</label
    >
    <label v-if="providerId !== 'local-audio-mock'"
      ><input
        v-model="cost"
        type="checkbox"
        :disabled="busy || importing || disabled"
      />{{ t("editor.audioGeneration.costConsent") }}</label
    >
    <button
      data-testid="audio-generation-generate"
      class="editor-button"
      :disabled="
        busy ||
        importing ||
        disabled ||
        !consent ||
        !text.trim() ||
        (providerId !== 'local-audio-mock' && !cost)
      "
      @click="generate"
    >
      {{ t("editor.audioGeneration.generate") }}
    </button>
    <button v-if="busy && !receipt" class="editor-button" @click="reset">
      {{ t("editor.audioGeneration.cancel") }}
    </button>
    <p v-if="failed" role="alert">{{ t("editor.audioGeneration.failed") }}</p>
    <template v-if="receipt">
      <p>
        {{ receipt.mock ? t("editor.audioGeneration.mock") : receipt.model }} ·
        {{ receipt.duration.toFixed(2) }} s ·
        {{
          receipt.costStatus === "free-mock"
            ? "$0"
            : t("editor.audioGeneration.remoteCost")
        }}
      </p>
      <audio
        controls
        :src="`/api/audio-generation/${receipt.id}/media?projectId=${encodeURIComponent(projectId)}`"
        :aria-label="t('editor.audioGeneration.preview')"
      />
      <details>
        <summary>{{ t("editor.audioGeneration.receipt") }}</summary>
        <code>{{ receipt.promptSha256 }} / {{ receipt.outputSha256 }}</code>
      </details>
      <button
        class="editor-button"
        :disabled="busy || importing || disabled || receipt.accepted"
        @click="accept"
      >
        {{ t("editor.audioGeneration.accept") }}
      </button>
      <label
        >{{ t("editor.audioGeneration.start")
        }}<input
          v-model.number="start"
          type="number"
          min="0"
          step="0.1"
          :disabled="busy || importing || disabled"
      /></label>
      <button
        class="editor-button"
        :disabled="!receipt.accepted || busy || importing || disabled"
        @click="importAudio"
      >
        {{ t("editor.audioGeneration.import") }}
      </button>
    </template>
  </section>
</template>
<style scoped>
.audio-generation-panel {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  max-width: 100%;
  max-height: 28rem;
  overflow: auto;
}
label {
  display: grid;
  gap: var(--space-1);
}
textarea {
  min-height: 5rem;
}
code {
  overflow-wrap: anywhere;
}
audio {
  max-width: 100%;
}
</style>
