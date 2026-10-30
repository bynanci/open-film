<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  resolveTitleRuns,
  validateTitleTextRuns,
  type TitleTextRuns,
  type TitleStyle,
  type FrameSize,
  type TitleRunId,
  type TitleRunTypography,
} from "@openfilm/core";
const props = defineProps<{
  text: string;
  runs?: TitleTextRuns;
  style?: TitleStyle;
  frame: FrameSize;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  change: [value: { text: string; runs: TitleTextRuns | null }];
}>();
const { t } = useI18n();
const enabled = ref(!!props.runs),
  primary = ref(""),
  secondary = ref(""),
  error = ref(false),
  composing = ref(false);
const draft = ref<TitleTextRuns>({ version: 1, splitAt: 1 });
watch(
  () => [props.text, props.runs] as const,
  ([text, runs], previous) => {
    if (runs) {
      enabled.value = true;
      primary.value = text.slice(0, runs.splitAt);
      secondary.value = text.slice(runs.splitAt + 1);
      draft.value = JSON.parse(JSON.stringify(runs));
    } else {
      if (previous?.[1]) enabled.value = false;
      primary.value = text;
      if (!enabled.value) secondary.value = "";
      draft.value = { version: 1, splitAt: 1 };
    }
    error.value = false;
  },
  { immediate: true },
);
function commit() {
  if (props.disabled || composing.value) return;
  if (!enabled.value) {
    emit("change", { text: props.text, runs: null });
    return;
  }
  const text = `${primary.value}\n${secondary.value}`;
  try {
    const runs = validateTitleTextRuns(
      { ...draft.value, splitAt: primary.value.length },
      text,
    );
    resolveTitleRuns(text, runs, props.style, props.frame);
    error.value = false;
    emit("change", { text, runs });
  } catch {
    error.value = true;
  }
}
function toggle(event: Event) {
  if (props.disabled) return;
  enabled.value = (event.target as HTMLInputElement).checked;
  if (!enabled.value) {
    error.value = false;
    emit("change", { text: props.text, runs: null });
  }
}
function textChange(id: TitleRunId, event: Event) {
  if (props.disabled) return;
  if (id === "primary")
    primary.value = (event.target as HTMLTextAreaElement).value;
  else secondary.value = (event.target as HTMLTextAreaElement).value;
  if (!(event as InputEvent).isComposing) commit();
}
function metric(id: TitleRunId, key: keyof TitleRunTypography, event: Event) {
  if (props.disabled) return;
  const raw = (event.target as HTMLInputElement).value;
  const next = { ...draft.value[id] };
  if (!raw) delete next[key];
  else Object.assign(next, { [key]: key === "fontFamily" ? raw : Number(raw) });
  draft.value = { ...draft.value, [id]: next };
  commit();
}
function displayed(id: TitleRunId, key: keyof TitleRunTypography) {
  try {
    return (
      resolveTitleRuns(
        `${primary.value}\n${secondary.value || " "}`,
        { ...draft.value, splitAt: primary.value.length },
        props.style,
        props.frame,
      ).find((run) => run.id === id)?.style[key] ??
      draft.value[id]?.[key] ??
      ""
    );
  } catch {
    return draft.value[id]?.[key] ?? "";
  }
}
function reset(id: TitleRunId) {
  if (props.disabled) return;
  const next = { ...draft.value };
  delete next[id];
  draft.value = next;
  commit();
}
</script>
<template>
  <fieldset class="native-title-controls" :disabled="disabled">
    <label class="native-title-toggle"
      ><input
        type="checkbox"
        :checked="enabled"
        data-testid="title-enable-bilingual"
        @change="toggle"
      />{{ t("editor.titleFinishing.bilingual") }}</label
    >
    <template v-if="enabled">
      <p class="editor-note">{{ t("editor.titleFinishing.bilingualHint") }}</p>
      <template v-for="id in ['primary', 'secondary'] as const" :key="id">
        <section class="native-title-run">
          <label v-if="id === 'secondary' || runs" class="editor-field"
            >{{ t(`editor.titleFinishing.${id}`) }}
            <textarea
              :value="id === 'primary' ? primary : secondary"
              :aria-label="t(`editor.titleFinishing.${id}`)"
              :data-testid="`title-run-${id}-text`"
              maxlength="8000"
              rows="2"
              @compositionstart="composing = true"
              @compositionend="composing = false"
              @change="textChange(id, $event)"
            />
          </label>
          <details>
            <summary>
              {{
                t("editor.titleFinishing.typography", {
                  run: t(`editor.titleFinishing.${id}`),
                })
              }}
            </summary>
            <label
              v-for="key in [
                'fontFamily',
                'fontSize',
                'fontWeight',
                'lineHeight',
                'tracking',
              ] as const"
              :key="key"
              class="editor-field"
            >
              {{ t(`editor.titleFinishing.${key}`) }}
              <input
                :type="key === 'fontFamily' ? 'text' : 'number'"
                :value="displayed(id, key)"
                :aria-label="
                  t('editor.titleFinishing.runField', {
                    run: t(`editor.titleFinishing.${id}`),
                    field: t(`editor.titleFinishing.${key}`),
                  })
                "
                :data-testid="`title-run-${id}-${key}`"
                :min="key === 'fontWeight' ? 100 : key === 'lineHeight' ? 1 : 0"
                :max="
                  key === 'fontWeight'
                    ? 900
                    : key === 'lineHeight'
                      ? 4
                      : key === 'tracking'
                        ? 100
                        : 4096
                "
                :step="key === 'fontWeight' ? 1 : 'any'"
                @change="metric(id, key, $event)"
              />
            </label>
            <button type="button" class="editor-button" @click="reset(id)">
              {{
                t("editor.titleFinishing.resetRun", {
                  run: t(`editor.titleFinishing.${id}`),
                })
              }}
            </button>
          </details>
        </section>
      </template>
      <label class="editor-field"
        >{{ t("editor.titleFinishing.gap")
        }}<input
          type="number"
          min="0"
          max="128"
          step="any"
          :value="draft.gap ?? ''"
          :aria-label="t('editor.titleFinishing.gap')"
          @change="
            draft = {
              ...draft,
              gap: Number(($event.target as HTMLInputElement).value),
            };
            commit();
          "
      /></label>
      <p v-if="error" class="editor-caption-error" role="status">
        {{ t("editor.titleFinishing.invalidRuns") }}
      </p>
    </template>
  </fieldset>
</template>
