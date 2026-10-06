<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import type { GlossaryEntry } from "@openfilm/core";
import { api } from "../api";
import { errorDetail, localizeError } from "../i18n";
const props = defineProps<{
  assetId: string;
  flush: () => Promise<boolean>;
  taskBusy?: boolean;
}>();
const emit = defineEmits<{ review: [] }>();
const { t } = useI18n();
const scope = ref<"project" | "global">("project");
const entries = ref<GlossaryEntry[]>([]);
const source = ref("");
const replacement = ref("");
const caseSensitive = ref(true);
const editId = ref<string>();
const busy = ref(false);
const error = shallowRef<unknown>(null);
const page = ref(0);
let readGeneration = 0;
let disposed = false;
const pages = computed(() =>
  Math.max(1, Math.ceil(entries.value.length / 100)),
);
const visible = computed(() =>
  entries.value.slice(page.value * 100, (page.value + 1) * 100),
);
async function load() {
  const stamp = ++readGeneration,
    capturedScope = scope.value;
  try {
    const result = await api.glossary(capturedScope);
    if (disposed || stamp !== readGeneration || scope.value !== capturedScope)
      return;
    entries.value = result.entries;
    page.value = Math.min(page.value, pages.value - 1);
    error.value = null;
  } catch (cause) {
    if (!disposed && stamp === readGeneration && scope.value === capturedScope)
      error.value = cause;
  }
}
function reset() {
  source.value = "";
  replacement.value = "";
  editId.value = undefined;
  caseSensitive.value = true;
}
async function changeScope() {
  reset();
  page.value = 0;
  await load();
}
function edit(entry: GlossaryEntry) {
  source.value = entry.source;
  replacement.value = entry.replacement;
  caseSensitive.value = entry.caseSensitive;
  editId.value = entry.id;
}
async function save() {
  if (busy.value || !source.value.trim() || !replacement.value.trim()) return;
  busy.value = true;
  try {
    await api.saveGlossary({
      source: source.value,
      replacement: replacement.value,
      scope: scope.value,
      caseSensitive: caseSensitive.value,
      ...(editId.value ? { id: editId.value } : {}),
      enabled: true,
    });
    reset();
    await load();
  } catch (cause) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function remove(entry: GlossaryEntry) {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.deleteGlossary(entry.id, entry.scope);
    if (editId.value === entry.id) reset();
    await load();
  } catch (cause) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function toggle(entry: GlossaryEntry) {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.saveGlossary({
      id: entry.id,
      source: entry.source,
      replacement: entry.replacement,
      scope: entry.scope,
      caseSensitive: entry.caseSensitive,
      enabled: !entry.enabled,
    });
    await load();
  } catch (cause) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function find() {
  if (busy.value || props.taskBusy || !(await props.flush())) return;
  busy.value = true;
  try {
    await api.runReview(props.assetId, { source: "glossary" });
    emit("review");
  } catch (cause) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
onMounted(() => void load());
onBeforeUnmount(() => {
  disposed = true;
  readGeneration++;
});
</script>
<template>
  <section class="transcript-side-panel" :aria-label="t('transcript.glossary')">
    <div
      class="editor-mode-switch"
      role="group"
      :aria-label="t('transcript.glossary')"
    >
      <button
        v-for="value in ['project', 'global'] as const"
        :key="value"
        class="editor-button"
        :aria-pressed="scope === value"
        :disabled="busy"
        @click="
          scope = value;
          changeScope();
        "
      >
        {{ t(`transcript.${value}Scope`) }}
      </button>
    </div>
    <p class="editor-note">{{ t("transcript.scopePriority") }}</p>
    <form class="transcript-glossary-form" @submit.prevent="save">
      <label class="editor-field"
        >{{ t("transcript.sourceTerm")
        }}<input v-model="source" maxlength="512" :disabled="busy" required
      /></label>
      <label class="editor-field"
        >{{ t("transcript.replacementTerm")
        }}<input
          v-model="replacement"
          maxlength="512"
          :disabled="busy"
          required
      /></label>
      <label class="transcript-check"
        ><input v-model="caseSensitive" type="checkbox" :disabled="busy" />{{
          t("transcript.caseMatching")
        }}</label
      >
      <div class="editor-actions">
        <button
          class="editor-button primary"
          type="submit"
          :disabled="busy || !source.trim() || !replacement.trim()"
        >
          {{ t(editId ? "transcript.saveTerm" : "transcript.addTerm") }}</button
        ><button
          v-if="editId"
          class="editor-button"
          type="button"
          @click="reset"
        >
          {{ t("transcript.cancel") }}
        </button>
      </div>
    </form>
    <div v-if="error" class="editor-error" role="alert">
      <p>{{ localizeError(error) }}</p>
      <details>
        <summary>{{ t("common.technicalDetails") }}</summary>
        <pre>{{ errorDetail(error) }}</pre>
      </details>
    </div>
    <p v-if="!entries.length" class="editor-note">
      {{ t("transcript.noTerms") }}
    </p>
    <ul v-else class="transcript-glossary-list">
      <li v-for="entry in visible" :key="entry.id" data-testid="glossary-entry">
        <button class="transcript-term" :disabled="busy" @click="edit(entry)">
          <span>{{ entry.source }}</span
          ><span aria-hidden="true">→</span
          ><strong>{{ entry.replacement }}</strong
          ><small>{{ t(`transcript.${entry.scope}Scope`) }}</small></button
        ><label class="transcript-check"
          ><input
            type="checkbox"
            :checked="entry.enabled"
            :disabled="busy"
            @change="toggle(entry)"
          />{{ t("transcript.enabled") }}</label
        ><button class="editor-button" :disabled="busy" @click="remove(entry)">
          {{ t("transcript.removeTerm") }}
        </button>
      </li>
    </ul>
    <div v-if="pages > 1" class="editor-actions">
      <button class="editor-button" :disabled="page === 0" @click="page--">
        {{ t("transcript.previousPage") }}</button
      ><span>{{ t("transcript.page", { page: page + 1, pages }) }}</span
      ><button
        class="editor-button"
        :disabled="page >= pages - 1"
        @click="page++"
      >
        {{ t("transcript.nextPage") }}
      </button>
    </div>
    <button
      class="editor-button primary"
      :disabled="busy || taskBusy"
      @click="find"
    >
      {{ t("transcript.findMatches") }}
    </button>
    <p class="editor-note">{{ t("transcript.globalPrivacy") }}</p>
  </section>
</template>
