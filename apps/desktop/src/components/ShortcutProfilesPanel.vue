<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  activeShortcutProfile,
  activeShortcutProfileId,
  importShortcutProfile,
  listShortcutProfiles,
  removeShortcutProfile,
  serializeShortcutProfile,
  setActiveShortcutProfile,
} from "../shortcut-profiles";

const { t } = useI18n();
const fileInput = ref<HTMLInputElement | null>(null);
const profiles = computed(() => listShortcutProfiles());
const status = ref("");
const statusIsError = ref(false);
const activeIsImported = computed(
  () => activeShortcutProfileId.value !== "default",
);

function chooseProfile(event: Event) {
  const select = event.target as HTMLSelectElement;
  setActiveShortcutProfile(select.value);
  status.value = "";
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const imported = importShortcutProfile(await file.text());
    setActiveShortcutProfile(imported.id);
    statusIsError.value = false;
    status.value = t("app.settings.shortcutProfiles.imported", {
      name: imported.profile.name,
    });
  } catch {
    statusIsError.value = true;
    status.value = t("app.settings.shortcutProfiles.invalid");
  } finally {
    input.value = "";
  }
}

function exportProfile() {
  const blob = new Blob(
    [serializeShortcutProfile(activeShortcutProfile.value)],
    {
      type: "application/json;charset=utf-8",
    },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "openfilm-shortcut-profile.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function removeActiveProfile() {
  removeShortcutProfile(activeShortcutProfileId.value);
  statusIsError.value = false;
  status.value = t("app.settings.shortcutProfiles.removed");
}
</script>

<template>
  <section class="shortcut-profiles-panel">
    <h3>{{ t("app.settings.shortcutProfiles.title") }}</h3>
    <p>{{ t("app.settings.shortcutProfiles.description") }}</p>
    <label class="field">
      {{ t("app.settings.shortcutProfiles.active") }}
      <select
        :value="activeShortcutProfileId"
        :aria-label="t('app.settings.shortcutProfiles.active')"
        @change="chooseProfile"
      >
        <option
          v-for="profile in profiles"
          :key="profile.id"
          :value="profile.id"
        >
          {{ profile.name }}
        </option>
      </select>
    </label>
    <input
      ref="fileInput"
      data-testid="shortcut-profile-import"
      type="file"
      accept=".json,application/json"
      hidden
      @change="importFile"
    />
    <div class="shortcut-profile-actions">
      <button type="button" class="secondary" @click="fileInput?.click()">
        {{ t("app.settings.shortcutProfiles.import") }}
      </button>
      <button type="button" class="secondary" @click="exportProfile">
        {{ t("app.settings.shortcutProfiles.export") }}
      </button>
      <button
        v-if="activeIsImported"
        type="button"
        class="secondary"
        @click="removeActiveProfile"
      >
        {{ t("app.settings.shortcutProfiles.remove") }}
      </button>
    </div>
    <p
      v-if="status"
      :role="statusIsError ? 'alert' : 'status'"
      class="shortcut-profile-status"
    >
      {{ status }}
    </p>
    <small>{{ t("app.settings.shortcutProfiles.localOnly") }}</small>
  </section>
</template>

<style scoped>
.shortcut-profiles-panel {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
  border-radius: 12px;
}

.shortcut-profiles-panel h3,
.shortcut-profiles-panel p {
  margin: 0;
}

.shortcut-profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.shortcut-profile-status[role="alert"] {
  color: var(--color-danger, #c45454);
}
</style>
