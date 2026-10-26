<script setup lang="ts">
import { ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  formatSequenceTimecode,
  parseSequenceTimecode,
  type ProjectTimebaseV1,
} from "@openfilm/core";

const props = defineProps<{
  frame: number;
  timebase: ProjectTimebaseV1;
  label: string;
  minFrame: number;
  maxFrame: number;
  disabled?: boolean;
}>();
const emit = defineEmits<{ seek: [frame: number] }>();
const { t } = useI18n();
const id = useId();
const draft = ref(formatSequenceTimecode(props.frame, props.timebase));
const invalid = ref(false);
const focused = ref(false);
function restore() {
  draft.value = formatSequenceTimecode(props.frame, props.timebase);
  invalid.value = false;
}
function commit() {
  if (props.disabled) return;
  try {
    const frame = parseSequenceTimecode(draft.value, props.timebase);
    if (frame < props.minFrame || frame > props.maxFrame)
      throw new Error("range");
    invalid.value = false;
    draft.value = formatSequenceTimecode(frame, props.timebase);
    emit("seek", frame);
  } catch {
    invalid.value = true;
  }
}
function keyboard(event: KeyboardEvent) {
  if (event.isComposing || props.disabled) return;
  if (event.key === "Enter" || event.key === "Escape") {
    event.preventDefault();
    if (event.key === "Enter") commit();
    else restore();
  }
}
watch(
  () => props.frame,
  () => {
    if (!focused.value && !invalid.value) restore();
  },
);
watch(() => props.timebase, restore);
</script>

<template>
  <label class="editor-field timecode-field" :for="id">
    {{ label }}
    <input
      :id="id"
      v-model="draft"
      :aria-label="label"
      type="text"
      spellcheck="false"
      :disabled="disabled"
      :aria-invalid="invalid"
      :aria-describedby="`${id}-hint${invalid ? ` ${id}-error` : ''}`"
      @focus="focused = true"
      @blur="focused = false"
      @change="commit"
      @keydown="keyboard"
    />
    <small :id="`${id}-hint`" class="timecode-hint">{{
      t("precision.timecodeHint")
    }}</small>
    <small v-if="invalid" :id="`${id}-error`" role="alert">{{
      t("precision.timecodeInvalid")
    }}</small>
  </label>
</template>

<style scoped>
.timecode-field {
  display: flex;
  flex-flow: row wrap;
  align-items: center;
  gap: var(--of-space-2);
}
.timecode-field input {
  width: 14ch;
  font-variant-numeric: tabular-nums;
}
.timecode-hint {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
