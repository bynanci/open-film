<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  OpenFilmProject,
  ProjectVersionDiff,
  ProjectVersionRecord,
} from "@openfilm/core";
import { localizeError } from "../i18n";
import { api } from "../api";

const props = defineProps<{
  projectId: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ restored: [project: OpenFilmProject] }>();
const { t } = useI18n();

const versions = ref<ProjectVersionRecord[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const createName = ref("");
const createDescription = ref("");
const selectedId = ref("");
const compareId = ref("");
const diff = ref<ProjectVersionDiff>();
const editingId = ref("");
const editName = ref("");
const editDescription = ref("");
const restoreTarget = ref<ProjectVersionRecord>();
const pendingCreateRequestId = ref("");
const pendingRestore = ref<{
  versionId: string;
  baseRevision: string;
  requestId: string;
}>();
const confirmButton = ref<HTMLButtonElement | null>(null);
const restoreTrigger = ref<HTMLButtonElement | null>(null);
let generation = 0;

const selected = computed(() =>
  versions.value.find((version) => version.id === selectedId.value),
);
const compare = computed(() =>
  versions.value.find((version) => version.id === compareId.value),
);
const orderedForCompare = computed(() => [...versions.value].reverse());

function showError(cause: unknown) {
  error.value = localizeError(cause);
}

function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw && raw.length > 240 ? `${raw.slice(0, 237)}…` : (raw ?? "—");
}

async function load() {
  const request = ++generation;
  loading.value = true;
  error.value = "";
  diff.value = undefined;
  try {
    const result = await api.projectVersions();
    if (request !== generation) return;
    versions.value = result.versions;
    if (!versions.value.some((item) => item.id === selectedId.value))
      selectedId.value = versions.value[0]?.id ?? "";
    if (!versions.value.some((item) => item.id === compareId.value))
      compareId.value = versions.value[1]?.id ?? versions.value[0]?.id ?? "";
    if (selectedId.value && compareId.value) await loadDiff();
  } catch (cause) {
    if (request === generation) showError(cause);
  } finally {
    if (request === generation) loading.value = false;
  }
}

async function loadDiff() {
  if (!selectedId.value || !compareId.value) {
    diff.value = undefined;
    return;
  }
  const request = generation;
  try {
    const result = await api.diffProjectVersions(
      compareId.value,
      selectedId.value,
    );
    if (request === generation) diff.value = result.diff;
  } catch (cause) {
    if (request === generation) showError(cause);
  }
}

async function createVersion() {
  if (props.disabled || saving.value || !createName.value.trim()) return;
  saving.value = true;
  error.value = "";
  pendingCreateRequestId.value ||= crypto.randomUUID();
  try {
    const current = await api.projectVersionRevision();
    if (current.projectId !== props.projectId) return;
    const created = await api.createProjectVersion({
      name: createName.value.trim(),
      ...(createDescription.value.trim()
        ? { description: createDescription.value.trim() }
        : {}),
      baseRevision: current.revision,
      requestId: pendingCreateRequestId.value,
    });
    createName.value = "";
    createDescription.value = "";
    pendingCreateRequestId.value = "";
    await load();
    selectedId.value = created.version.id;
    compareId.value =
      versions.value.find((item) => item.id !== created.version.id)?.id ??
      created.version.id;
    await loadDiff();
  } catch (cause) {
    showError(cause);
  } finally {
    saving.value = false;
  }
}

function beginRename(version: ProjectVersionRecord) {
  editingId.value = version.id;
  editName.value = version.name;
  editDescription.value = version.description ?? "";
}

async function saveRename() {
  if (props.disabled || saving.value || !editingId.value) return;
  saving.value = true;
  error.value = "";
  try {
    await api.renameProjectVersion(editingId.value, {
      name: editName.value.trim(),
      description: editDescription.value.trim() || null,
    });
    editingId.value = "";
    await load();
  } catch (cause) {
    showError(cause);
  } finally {
    saving.value = false;
  }
}

async function askRestore(
  version: ProjectVersionRecord,
  trigger: HTMLButtonElement,
) {
  if (props.disabled || saving.value) return;
  restoreTarget.value = version;
  restoreTrigger.value = trigger;
  if (pendingRestore.value?.versionId !== version.id)
    pendingRestore.value = undefined;
  await nextTick();
  confirmButton.value?.focus();
}

function cancelRestore() {
  restoreTarget.value = undefined;
  pendingRestore.value = undefined;
  void nextTick(() => restoreTrigger.value?.focus());
}

function trapRestoreTab(event: KeyboardEvent) {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      ".versions-confirm-dialog button:not(:disabled)",
    ),
  );
  if (!buttons.length) return;
  if (event.shiftKey && document.activeElement === buttons[0]) {
    event.preventDefault();
    buttons.at(-1)?.focus();
  } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
    event.preventDefault();
    buttons[0]?.focus();
  }
}

async function confirmRestore() {
  const target = restoreTarget.value;
  if (!target || props.disabled || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    if (!pendingRestore.value) {
      const current = await api.projectVersionRevision();
      if (current.projectId !== props.projectId)
        throw new Error(t("app.versions.projectChanged"));
      pendingRestore.value = {
        versionId: target.id,
        baseRevision: current.revision,
        requestId: crypto.randomUUID(),
      };
    }
    const restored = await api.restoreProjectVersion(target.id, {
      baseRevision: pendingRestore.value.baseRevision,
      requestId: pendingRestore.value.requestId,
      confirmed: true,
    });
    pendingRestore.value = undefined;
    restoreTarget.value = undefined;
    await load();
    emit("restored", restored.project);
  } catch (cause) {
    showError(cause);
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.projectId,
  () => {
    versions.value = [];
    selectedId.value = "";
    compareId.value = "";
    editingId.value = "";
    restoreTarget.value = undefined;
    pendingRestore.value = undefined;
    pendingCreateRequestId.value = "";
    void load();
  },
);
watch([selectedId, compareId], () => void loadDiff());
onMounted(() => void load());
</script>

<template>
  <section class="project-versions" aria-labelledby="versions-title">
    <header class="versions-heading">
      <div>
        <p class="eyebrow">{{ t("app.versions.eyebrow") }}</p>
        <h2 id="versions-title">{{ t("app.versions.title") }}</h2>
        <p>{{ t("app.versions.description") }}</p>
      </div>
      <button class="secondary" :disabled="loading || saving" @click="load">
        {{ loading ? t("app.versions.loading") : t("app.versions.refresh") }}
      </button>
    </header>

    <p v-if="error" class="feedback error" role="alert">{{ error }}</p>

    <form class="versions-create" @submit.prevent="createVersion">
      <label>
        <span>{{ t("app.versions.nameLabel") }}</span>
        <input
          v-model="createName"
          maxlength="128"
          :disabled="disabled || saving"
          :placeholder="t('app.versions.namePlaceholder')"
          required
        />
      </label>
      <label>
        <span>{{ t("app.versions.descriptionLabel") }}</span>
        <input
          v-model="createDescription"
          maxlength="2048"
          :disabled="disabled || saving"
          :placeholder="t('app.versions.descriptionPlaceholder')"
        />
      </label>
      <button
        class="primary"
        type="submit"
        :disabled="disabled || saving || !createName.trim()"
      >
        {{ saving ? t("app.versions.saving") : t("app.versions.create") }}
      </button>
      <p class="versions-private-note">{{ t("app.versions.privateHint") }}</p>
    </form>

    <div v-if="!loading && !versions.length" class="versions-empty">
      <h3>{{ t("app.versions.emptyTitle") }}</h3>
      <p>{{ t("app.versions.emptyHint") }}</p>
    </div>

    <div v-else class="versions-layout">
      <section class="versions-list" :aria-label="t('app.versions.listLabel')">
        <h3>{{ t("app.versions.listTitle") }}</h3>
        <article
          v-for="version in orderedForCompare"
          :key="version.id"
          class="version-card"
          :class="{ selected: selectedId === version.id }"
        >
          <button
            class="version-select"
            :data-testid="`version-${version.id}`"
            :aria-pressed="selectedId === version.id"
            @click="selectedId = version.id"
          >
            <strong>{{ version.name }}</strong>
            <time :datetime="version.createdAt">{{
              new Date(version.createdAt).toLocaleString()
            }}</time>
          </button>
          <p v-if="version.description" class="version-description">
            {{ version.description }}
          </p>
          <div v-if="editingId === version.id" class="version-rename">
            <label>
              <span>{{ t("app.versions.nameLabel") }}</span>
              <input v-model="editName" maxlength="128" :disabled="saving" />
            </label>
            <label>
              <span>{{ t("app.versions.descriptionLabel") }}</span>
              <input
                v-model="editDescription"
                maxlength="2048"
                :disabled="saving"
              />
            </label>
            <button
              class="primary"
              :disabled="saving || !editName.trim()"
              @click="saveRename"
            >
              {{ t("app.versions.saveName") }}
            </button>
            <button
              class="text-button"
              :disabled="saving"
              @click="editingId = ''"
            >
              {{ t("app.actions.back") }}
            </button>
          </div>
          <div v-else class="version-actions">
            <button
              class="text-button"
              :disabled="disabled || saving"
              @click="beginRename(version)"
            >
              {{ t("app.versions.rename") }}
            </button>
            <button
              class="text-button"
              :disabled="disabled || saving"
              @click="
                askRestore(version, $event.currentTarget as HTMLButtonElement)
              "
            >
              {{ t("app.versions.restore") }}
            </button>
          </div>
        </article>
      </section>

      <section
        class="versions-diff"
        :aria-label="t('app.versions.compareTitle')"
      >
        <div class="versions-diff-heading">
          <h3>{{ t("app.versions.compareTitle") }}</h3>
          <label>
            <span>{{ t("app.versions.compareWith") }}</span>
            <select v-model="compareId" :disabled="versions.length < 2">
              <option
                v-for="version in orderedForCompare"
                :key="version.id"
                :value="version.id"
              >
                {{ version.name }}
              </option>
            </select>
          </label>
        </div>
        <p v-if="selected && compare" class="versions-diff-caption">
          {{
            t("app.versions.diffCaption", {
              before: compare.name,
              after: selected.name,
            })
          }}
        </p>
        <p v-if="diff && !diff.entries.length" class="versions-empty-inline">
          {{ t("app.versions.noChanges") }}
        </p>
        <ul v-else-if="diff" class="version-diff-list">
          <li
            v-for="entry in diff.entries"
            :key="`${entry.category}:${entry.key}`"
          >
            <div class="diff-entry-heading">
              <span class="diff-category">{{
                t(`app.versions.categories.${entry.category}`)
              }}</span>
              <span>{{ t(`app.versions.changes.${entry.change}`) }}</span>
            </div>
            <code>{{ entry.key }}</code>
            <div class="diff-values">
              <p v-if="entry.before !== undefined">
                <strong>{{ t("app.versions.before") }}</strong
                >{{ formatValue(entry.before) }}
              </p>
              <p v-if="entry.after !== undefined">
                <strong>{{ t("app.versions.after") }}</strong
                >{{ formatValue(entry.after) }}
              </p>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <div
      v-if="restoreTarget"
      class="versions-dialog-backdrop"
      @click.self="cancelRestore"
      @keydown.esc.prevent="cancelRestore"
      @keydown.tab="trapRestoreTab"
    >
      <section
        class="versions-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="versions-confirm-title"
        aria-describedby="versions-confirm-description"
      >
        <p class="eyebrow">{{ t("app.versions.confirmEyebrow") }}</p>
        <h2 id="versions-confirm-title">
          {{ t("app.versions.confirmTitle", { name: restoreTarget.name }) }}
        </h2>
        <p id="versions-confirm-description">
          {{
            t("app.versions.confirmDescription", { name: restoreTarget.name })
          }}
        </p>
        <div class="versions-confirm-actions">
          <button class="secondary" :disabled="saving" @click="cancelRestore">
            {{ t("app.actions.back") }}
          </button>
          <button
            ref="confirmButton"
            class="primary"
            :disabled="saving"
            @click="confirmRestore"
          >
            {{
              saving
                ? t("app.versions.restoring")
                : t("app.versions.confirmRestore")
            }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
