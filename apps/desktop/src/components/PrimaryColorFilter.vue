<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
import { computed } from "vue";
import {
  primaryColorCoefficients,
  type PrimaryColorCorrection,
} from "@openfilm/core";
const props = defineProps<{ id: string; correction: PrimaryColorCorrection }>();
const matrix = computed(() =>
  primaryColorCoefficients(props.correction).matrix.join(" "),
);
</script>
<template>
  <svg
    width="0"
    height="0"
    aria-hidden="true"
    focusable="false"
    class="primary-color-definitions"
  >
    <defs>
      <filter
        :id="id"
        x="0%"
        y="0%"
        width="100%"
        height="100%"
        color-interpolation-filters="sRGB"
      >
        <feColorMatrix type="matrix" :values="matrix" />
      </filter>
    </defs>
  </svg>
</template>
<style scoped>
.primary-color-definitions {
  position: absolute;
  pointer-events: none;
  overflow: hidden;
}
</style>
