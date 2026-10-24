<script setup lang="ts">
import { useI18n } from "vue-i18n";
import Icon from "./Icon.vue";
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
        <span class="workspace-mode-title"
          ><Icon
            :name="mode === 'standard' ? 'layers' : 'settings'"
            :size="19" /><strong>{{ t(`app.workspaceMode.${mode}`) }}</strong
          ><Icon
            v-if="preferences.workspaceMode === mode"
            name="check"
            :size="17"
        /></span>
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
  max-width: 160px;
  min-height: 36px;
  padding: var(--of-space-2) var(--of-space-3);
  border: 1px solid var(--of-border-control);
  border-radius: var(--of-radius-md);
  background: var(--of-surface-1);
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
  gap: var(--of-space-3);
  padding: var(--of-space-5);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-lg);
  background: var(--of-bg);
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
.workspace-mode-title {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--of-space-2);
}
.workspace-mode-title > svg:last-child:not(:first-child) {
  margin-inline-start: auto;
  color: var(--of-accent);
}
.workspace-mode-options strong {
  font-size: var(--of-font-base);
}
.workspace-mode-options button > span:not(.workspace-mode-title) {
  color: var(--of-text-secondary);
  font-size: var(--of-font-small);
  line-height: var(--of-line-body);
}
@media (pointer: coarse) {
  .workspace-mode-control select {
    min-height: 44px;
  }
}
@media (max-width: 640px) {
  .workspace-mode-options {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
