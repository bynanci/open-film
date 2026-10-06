<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import type { GlossaryEntry } from "@openfilm/core";
import { api } from "../api";
import { errorDetail, localizeError } from "../i18n";
const props = defineProps<{
  assetId: string;
  flush: () => Promise<boolean>;
  taskBusy?: boolean;
  blocked?: boolean;
}>();
const emit = defineEmits<{ review: []; busy: [value: boolean] }>();
const { t } = useI18n();
const scope = ref<"project" | "global">("project");
const entries = ref<GlossaryEntry[]>([]);
const source = ref("");
const replacement = ref("");
const caseSensitive = ref(true);
const editId = ref<string>();
const busy = ref(false);
const unavailable = computed(() => busy.value || !!props.blocked);
const hasPending = computed(() => busy.value);
let mutation: Promise<boolean> | undefined;
watch(busy, (value) => emit("busy", value), { flush: "sync" });
function runMutation(work: () => Promise<boolean | void>): Promise<boolean> {
  if (unavailable.value) return Promise.resolve(false);
  busy.value = true;
  error.value = null;
  mutation = (async () => {
    try {
      return (await work()) !== false;
    } catch (cause) {
      error.value = cause;
      return false;
    } finally {
      busy.value = false;
    }
  })().finally(() => {
    mutation = undefined;
  });
  return mutation;
}
async function flushPending() {
  return mutation ? await mutation : true;
}
defineExpose({ flush: flushPending, hasPending });
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
  if (!source.value.trim() || !replacement.value.trim()) return false;
  return runMutation(async () => {
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
  });
}
async function remove(entry: GlossaryEntry) {
  return runMutation(async () => {
    await api.deleteGlossary(entry.id, entry.scope);
    if (editId.value === entry.id) reset();
    await load();
  });
}
async function toggle(entry: GlossaryEntry) {
  return runMutation(async () => {
    await api.saveGlossary({
      id: entry.id,
      source: entry.source,
      replacement: entry.replacement,
      scope: entry.scope,
      caseSensitive: entry.caseSensitive,
      enabled: !entry.enabled,
    });
    await load();
  });
}
async function find() {
  if (props.taskBusy) return false;
  const completed = await runMutation(async () => {
    if (!(await props.flush())) return false;
    await api.runReview(props.assetId, { source: "glossary" });
  });
  // Release the mutation barrier before this event switches panels.
  if (completed && !disposed) emit("review");
  return completed;
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
        :disabled="unavailable"
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
        }}<input
          v-model="source"
          maxlength="512"
          :disabled="unavailable"
          required
      /></label>
      <label class="editor-field"
        >{{ t("transcript.replacementTerm")
        }}<input
          v-model="replacement"
          maxlength="512"
          :disabled="unavailable"
          required
      /></label>
      <label class="transcript-check"
        ><input
          v-model="caseSensitive"
          type="checkbox"
          :disabled="unavailable"
        />{{ t("transcript.caseMatching") }}</label
      >
      <div class="editor-actions">
        <button
          class="editor-button primary"
          type="submit"
          :disabled="unavailable || !source.trim() || !replacement.trim()"
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
        <button
          class="transcript-term"
          :disabled="unavailable"
          @click="edit(entry)"
        >
          <span>{{ entry.source }}</span
          ><span aria-hidden="true">→</span
          ><strong>{{ entry.replacement }}</strong
          ><small>{{ t(`transcript.${entry.scope}Scope`) }}</small></button
        ><label class="transcript-check"
          ><input
            type="checkbox"
            :checked="entry.enabled"
            :disabled="unavailable"
            @change="toggle(entry)"
          />{{ t("transcript.enabled") }}</label
        ><button
          class="editor-button"
          :disabled="unavailable"
          @click="remove(entry)"
        >
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
      :disabled="unavailable || taskBusy"
      @click="find"
    >
      {{ t("transcript.findMatches") }}
    </button>
    <p class="editor-note">{{ t("transcript.globalPrivacy") }}</p>
  </section>
</template>
