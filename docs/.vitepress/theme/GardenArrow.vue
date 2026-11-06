<script setup lang="ts">
defineProps<{ down?: boolean }>();
</script>
<template>
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    class="garden-arrow"
  >
    <path v-if="down" d="M8 2v12m-5-5 5 5 5-5" />
    <path v-else d="M3 13 13 3M3 3h10v10" />
  </svg>
</template>
