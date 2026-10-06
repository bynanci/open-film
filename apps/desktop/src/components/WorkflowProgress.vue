<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { WorkflowStep } from "../appTypes";
import Icon from "./Icon.vue";
defineProps<{ steps: WorkflowStep[]; disabled?: boolean }>();
defineEmits<{ navigate: [id: WorkflowStep["id"]] }>();
const { t } = useI18n();
</script>
<template>
  <nav class="workflow-progress" :aria-label="t('app.workflow.label')">
    <button
      v-for="(step, index) in steps"
      :key="step.id"
      class="workflow-step"
      :data-state="step.state"
      :aria-current="step.state === 'current' ? 'step' : undefined"
      :title="t(`app.workflow.state.${step.state}`)"
      :disabled="disabled"
      @click="$emit('navigate', step.id)"
    >
      <span class="workflow-step-number"
        ><Icon v-if="step.state === 'complete'" name="check" :size="14" /><span
          v-else
          >{{ index + 1 }}</span
        ></span
      >
      <span class="workflow-step-copy"
        ><strong>{{ t(`app.workflow.${step.id}`) }}</strong
        ><small :class="{ 'sr-only': step.state !== 'attention' }">{{
          t(`app.workflow.state.${step.state}`)
        }}</small></span
      >
    </button>
  </nav>
</template>
