<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  validateTitleFinishing,
  type TitleFinishing,
  type TitleStyle,
} from "@openfilm/core";
const props = defineProps<{ style: TitleStyle; disabled?: boolean }>();
const emit = defineEmits<{ change: [style: TitleStyle] }>();
const { t } = useI18n();
const draft = ref<TitleFinishing>({ version: 1 }),
  error = ref(false);
watch(
  () => props.style.finishing,
  (value) => {
    draft.value = value ? JSON.parse(JSON.stringify(value)) : { version: 1 };
    error.value = false;
  },
  { immediate: true },
);
const defaults = {
  shadow: { color: "#000000", opacity: 0.65, offsetX: 0, offsetY: 3, blur: 3 },
  stroke: { color: "#000000", width: 2 },
  pill: {
    color: "#000000",
    opacity: 0.65,
    paddingX: 12,
    paddingY: 6,
    radius: 8,
  },
};
type Effect = keyof typeof defaults;
function save(next: TitleFinishing) {
  if (props.disabled) return;
  try {
    const finishing = validateTitleFinishing(next);
    const style = JSON.parse(JSON.stringify(props.style)) as TitleStyle;
    if (finishing.shadow || finishing.stroke || finishing.pill)
      style.finishing = finishing;
    else delete style.finishing;
    draft.value = finishing;
    error.value = false;
    emit("change", style);
  } catch {
    error.value = true;
  }
}
function toggle(id: Effect, event: Event) {
  if (props.disabled) return;
  const next = JSON.parse(JSON.stringify(draft.value)) as TitleFinishing;
  if ((event.target as HTMLInputElement).checked)
    Object.assign(next, { [id]: { ...defaults[id] } });
  else delete next[id];
  save(next);
}
function change(id: Effect, key: string, event: Event) {
  const next = JSON.parse(JSON.stringify(draft.value)) as TitleFinishing;
  const value = (event.target as HTMLInputElement).value;
  Object.assign(next[id]!, { [key]: key === "color" ? value : Number(value) });
  save(next);
}
const keys = (id: Effect) => Object.keys(defaults[id]);
const value = (id: Effect, key: string) =>
  (draft.value[id] as unknown as Record<string, string | number>)[key];
</script>
<template>
  <details class="native-title-controls">
    <summary>{{ t("editor.titleFinishing.finishing") }}</summary>
    <fieldset :disabled="disabled">
      <p class="editor-note">{{ t("editor.titleFinishing.finishingHint") }}</p>
      <section
        v-for="id in ['shadow', 'stroke', 'pill'] as const"
        :key="id"
        class="native-title-run"
      >
        <label class="native-title-toggle"
          ><input
            type="checkbox"
            :checked="!!draft[id]"
            :data-testid="`title-enable-${id}`"
            @change="toggle(id, $event)"
          />{{ t(`editor.titleFinishing.${id}`) }}</label
        >
        <div v-if="draft[id]" class="native-title-effect-fields">
          <label v-for="key in keys(id)" :key="key" class="editor-field"
            >{{ t(`editor.titleFinishing.${key}`) }}
            <input
              :type="key === 'color' ? 'color' : 'number'"
              :value="value(id, key)"
              :min="key === 'offsetX' || key === 'offsetY' ? -64 : 0"
              :max="
                key === 'opacity'
                  ? 1
                  : key === 'width' || key === 'blur'
                    ? 16
                    : 64
              "
              step="any"
              :aria-label="
                t('editor.titleFinishing.runField', {
                  run: t(`editor.titleFinishing.${id}`),
                  field: t(`editor.titleFinishing.${key}`),
                })
              "
              :data-testid="`title-${id}-${key}`"
              @change="change(id, key, $event)"
            />
          </label>
        </div>
      </section>
      <p v-if="error" class="editor-caption-error" role="status">
        {{ t("editor.titleFinishing.invalidFinishing") }}
      </p>
    </fieldset>
  </details>
</template>
