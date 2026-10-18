<script setup lang="ts">
// SPDX-License-Identifier: GPL-3.0-only

import { computed } from "vue";
import { filmLookMatrix, type FilmLook } from "@openfilm/core";
const props = defineProps<{ id: string; look: FilmLook }>();
const matrix = computed(() => filmLookMatrix(props.look).join(" "));
</script>
<template>
  <svg
    class="film-look-definitions"
    width="0"
    height="0"
    aria-hidden="true"
    focusable="false"
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
.film-look-definitions {
  position: absolute;
  pointer-events: none;
  overflow: hidden;
}
</style>
