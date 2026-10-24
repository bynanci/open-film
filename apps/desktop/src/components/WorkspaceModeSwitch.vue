<script setup lang="ts">
import { useI18n } from "vue-i18n";
import {
  preferences,
  setWorkspaceMode,
  type WorkspaceMode,
} from "../preferences";
defineProps<{ compact?: boolean }>();
const { t } = useI18n();
const modes: WorkspaceMode[] = ["standard", "expert"];
</script>

<template>
  <label v-if="compact" class="workspace-mode-control">
    <span class="sr-only">{{ t("app.workspaceMode.label") }}</span>
    <select
      :value="preferences.workspaceMode"
      @change="
        setWorkspaceMode(
          ($event.target as HTMLSelectElement).value as WorkspaceMode,
        )
      "
    >
      <option v-for="mode in modes" :key="mode" :value="mode">
        {{ t(`app.workspaceMode.${mode}`) }}
      </option>
    </select>
  </label>
  <fieldset v-else class="workspace-mode-settings">
    <legend>{{ t("app.workspaceMode.label") }}</legend>
    <div class="workspace-mode-options">
      <button
        v-for="mode in modes"
        :key="mode"
        type="button"
        :aria-pressed="preferences.workspaceMode === mode"
        :class="{ selected: preferences.workspaceMode === mode }"
        @click="setWorkspaceMode(mode)"
      >
        <strong>{{ t(`app.workspaceMode.${mode}`) }}</strong>
        <span>{{ t(`app.workspaceMode.${mode}Hint`) }}</span>
      </button>
    </div>
  </fieldset>
</template>

<style scoped>
.workspace-mode-control {
  display: flex;
  min-width: 0;
}
.workspace-mode-control select {
  width: auto;
  max-width: 180px;
  min-height: 36px;
  padding: var(--of-space-2) var(--of-space-3);
  border: 1px solid var(--of-border-control);
  border-radius: var(--of-radius-md);
  background: var(--of-surface-2);
  color: var(--of-text-primary);
  font-family: var(--of-font-body);
  font-size: var(--of-font-small);
}
.workspace-mode-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--of-group-gap);
}
.workspace-mode-options button {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--of-space-2);
  padding: var(--of-space-4);
  border: 1px solid var(--of-border-control);
  border-radius: var(--of-radius-lg);
  background: var(--of-surface-1);
  color: var(--of-text-primary);
  text-align: start;
  white-space: normal;
  overflow-wrap: anywhere;
}
.workspace-mode-options button > * {
  min-width: 0;
  max-width: 100%;
}
.workspace-mode-options button.selected {
  border-color: var(--of-accent);
  background: var(--of-accent-soft);
}
.workspace-mode-options strong {
  font-size: var(--of-font-base);
}
.workspace-mode-options span {
  color: var(--of-text-secondary);
  font-size: var(--of-font-small);
  line-height: var(--of-line-body);
}
@media (max-width: 640px) {
  .workspace-mode-options {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
