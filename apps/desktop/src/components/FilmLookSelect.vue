<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0

import { FILM_LOOK_PRESETS, type FilmLook } from "@openfilm/core";
import { useI18n } from "vue-i18n";
const props = defineProps<{
  label: string;
  value?: FilmLook;
  inherit?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ change: [look: FilmLook | null] }>();
const { t } = useI18n();
function changePreset(event: Event) {
  const select = event.target as HTMLSelectElement;
  const preset = select.value;
  // Keep a rejected command visually on the saved value. Accepted commands
  // publish an optimistic document and update this controlled field normally.
  select.value = props.value?.preset ?? (props.inherit ? "inherit" : "none");
  if (preset === "inherit") emit("change", null);
  else
    emit("change", {
      version: 1,
      preset: preset as FilmLook["preset"],
      strength: props.value?.strength ?? 1,
    });
}
function changeStrength(event: Event) {
  const input = event.target as HTMLInputElement;
  const strength = Number(input.value) / 100;
  if (props.value) {
    input.value = String(Math.round(props.value.strength * 100));
    emit("change", { ...props.value, strength });
  }
}
</script>
<template>
  <div class="film-look-choice">
    <label class="editor-field">
      <span>{{ label }}</span>
      <select
        :aria-label="label"
        :value="value?.preset ?? (inherit ? 'inherit' : 'none')"
        :disabled="disabled"
        @change="changePreset"
      >
        <option v-if="inherit" value="inherit">{{ t("looks.inherit") }}</option>
        <option
          v-for="preset in FILM_LOOK_PRESETS"
          :key="preset.id"
          :value="preset.id"
        >
          {{ t(`looks.presets.${preset.id}`) }}
        </option>
      </select>
    </label>
    <label v-if="value && value.preset !== 'none'" class="film-look-strength">
      <span>{{ t("looks.strength") }}</span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        :value="Math.round(value.strength * 100)"
        :aria-label="t('looks.strengthLabel', { scope: label })"
        :disabled="disabled"
        @change="changeStrength"
      />
      <output>{{ Math.round(value.strength * 100) }}%</output>
    </label>
    <p v-if="value" class="film-look-hint">
      {{ t(`looks.hints.${value.preset}`) }}
    </p>
  </div>
</template>
<style scoped>
.film-look-choice {
  display: grid;
  gap: var(--of-space-2);
  min-width: 0;
}
.film-look-choice select {
  width: 100%;
  min-width: 0;
}
.film-look-strength {
  display: flex;
  align-items: center;
  gap: var(--of-space-2);
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
.film-look-strength input {
  min-width: 0;
  flex: 1;
}
.film-look-strength output {
  min-width: 4ch;
  text-align: end;
  font-variant-numeric: tabular-nums;
}
.film-look-hint {
  color: var(--of-text-muted);
  font-size: var(--of-font-caption);
  overflow-wrap: anywhere;
  margin: 0;
}
</style>
