<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AudioGenerationReceipt } from "@openfilm/application";
import { api, generatedAudioMediaUrl } from "../api";
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
    <header class="audio-generation-header">
      <strong>{{ t("editor.audioGeneration.title") }}</strong>
      <p class="audio-generation-disclosure">{{ t("editor.audioGeneration.disclosure") }}</p>
    </header>

    <div class="audio-generation-provider-block">
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
      <div v-if="providerId === 'local-audio-mock'" class="provider-info-card local">
        <span class="provider-badge local">Local Mock</span>
        <p class="provider-desc">{{ t("editor.audioGeneration.mock") }}</p>
      </div>
      <div v-else class="provider-info-card remote">
        <span class="provider-badge remote">Remote Service</span>
        <p class="provider-desc">
          {{ t("editor.audioGeneration.remoteCost") }}
          <code>{{ providers.find((p) => p.id === providerId)?.endpoint }}</code>
        </p>
      </div>
    </div>

    <label
      >{{ t("editor.audioGeneration.text")
      }}<textarea
        v-model="text"
        data-testid="audio-generation-text"
        maxlength="1000"
        :disabled="busy || importing || disabled"
      />
    </label>

    <div class="consent-group">
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
    </div>

    <div class="generate-actions">
      <button
        data-testid="audio-generation-generate"
        class="editor-button primary"
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
    </div>

    <p v-if="failed" class="error-text" role="alert">{{ t("editor.audioGeneration.failed") }}</p>

    <section v-if="receipt" class="audio-receipt-card">
      <div class="receipt-header">
        <div class="receipt-meta">
          <strong>{{ receipt.mock ? t("editor.audioGeneration.mock") : receipt.model }}</strong>
          <span>{{ receipt.duration.toFixed(2) }} s · {{
            receipt.costStatus === "free-mock"
              ? "$0"
              : t("editor.audioGeneration.remoteCost")
          }}</span>
        </div>
        <span class="receipt-status-badge" :class="{ accepted: receipt.accepted }">
          {{ receipt.accepted ? "✓ Accepted" : "Review" }}
        </span>
      </div>

      <div class="receipt-player">
        <audio
          controls
          crossorigin="anonymous"
          :src="generatedAudioMediaUrl(receipt.id, projectId)"
          :aria-label="t('editor.audioGeneration.preview')"
        />
      </div>

      <details class="receipt-hashes">
        <summary>{{ t("editor.audioGeneration.receipt") }}</summary>
        <code>{{ receipt.promptSha256 }} / {{ receipt.outputSha256 }}</code>
      </details>

      <div class="receipt-flow">
        <button
          class="editor-button"
          :class="{ active: receipt.accepted }"
          :disabled="busy || importing || disabled || receipt.accepted"
          @click="accept"
        >
          {{ t("editor.audioGeneration.accept") }}
        </button>

        <div class="import-block">
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
            class="editor-button primary"
            :disabled="!receipt.accepted || busy || importing || disabled"
            @click="importAudio"
          >
            {{ t("editor.audioGeneration.import") }}
          </button>
        </div>
      </div>
    </section>
  </section>
</template>
<style scoped>
.audio-generation-panel {
  display: grid;
  gap: var(--of-space-3);
  padding: var(--of-space-3);
  border: 1px solid var(--editor-border-soft);
  border-radius: var(--of-radius-sm);
  max-width: 100%;
  max-height: 32rem;
  overflow: auto;
  box-sizing: border-box;
}
.audio-generation-header strong {
  display: block;
  font-size: var(--of-font-body);
  margin-bottom: var(--of-space-1);
}
.audio-generation-disclosure {
  font-size: var(--of-font-caption);
  color: var(--editor-muted);
  line-height: 1.5;
  margin: 0;
}
.audio-generation-provider-block {
  display: grid;
  gap: var(--of-space-2);
}
.provider-info-card {
  padding: var(--of-space-2) var(--of-space-3);
  border-radius: var(--of-radius-sm);
  border: 1px solid var(--editor-border-soft);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.provider-info-card.local {
  background: var(--of-surface-1);
  border-color: rgba(166, 199, 161, 0.3);
}
.provider-info-card.remote {
  background: var(--of-surface-1);
  border-color: rgba(240, 194, 129, 0.4);
}
.provider-badge {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 6px;
  border-radius: 4px;
  width: fit-content;
}
.provider-badge.local {
  background: rgba(166, 199, 161, 0.2);
  color: #a6c7a1;
}
.provider-badge.remote {
  background: rgba(240, 194, 129, 0.2);
  color: #f0c281;
}
.provider-desc {
  font-size: var(--of-font-caption);
  color: var(--editor-muted);
  margin: 0;
  line-height: 1.5;
}
.consent-group {
  display: grid;
  gap: var(--of-space-2);
}
.generate-actions {
  display: flex;
  gap: var(--of-space-2);
  align-items: center;
}
label {
  min-width: 0;
  overflow-wrap: anywhere;
  display: grid;
  gap: var(--of-space-1);
  font-size: var(--of-font-caption);
}
label:has(input[type="checkbox"]) {
  display: flex;
  align-items: flex-start;
  gap: var(--of-space-2);
  cursor: pointer;
}
select,
textarea,
input:not([type="checkbox"]) {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
input[type="checkbox"] {
  width: auto;
  margin-top: 3px;
  flex-shrink: 0;
}
p {
  overflow-wrap: anywhere;
}
.error-text {
  color: var(--of-error, #f2726f);
  font-size: var(--of-font-caption);
  margin: 0;
}
textarea {
  min-height: 5rem;
}
code {
  overflow-wrap: anywhere;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
audio {
  width: 100%;
  max-width: 100%;
}
.audio-receipt-card {
  border-top: 1px solid var(--editor-border-soft);
  padding-top: var(--of-space-3);
  display: grid;
  gap: var(--of-space-2);
}
.receipt-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--of-space-2);
}
.receipt-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.receipt-meta span {
  font-size: var(--of-font-caption);
  color: var(--editor-muted);
}
.receipt-status-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--editor-surface-1, #22262c);
  color: var(--editor-muted);
}
.receipt-status-badge.accepted {
  background: rgba(166, 199, 161, 0.2);
  color: #a6c7a1;
  font-weight: 600;
}
.receipt-hashes {
  color: var(--editor-muted);
  font-size: var(--of-font-caption);
}
.receipt-flow {
  display: grid;
  gap: var(--of-space-3);
  margin-top: var(--of-space-2);
}
.import-block {
  display: grid;
  gap: var(--of-space-2);
}
</style>
