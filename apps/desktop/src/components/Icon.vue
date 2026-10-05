<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 });
const paths: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  folder: "M3 7V5h6l2 2h10v13H3Z",
  film: "M4 3h16v18H4ZM4 8h16M4 16h16M8 3v18M16 3v18",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  lock: "M6 10h12v11H6ZM8 10V7a4 4 0 0 1 8 0v3",
  reject: "M5 5l14 14M19 5 5 19",
  play: "m8 4 13 8-13 8Z",
  check: "m5 12 4 4L19 6",
  chevron: "m9 5 7 7-7 7",
  search: "M21 21l-6-6M17 10A7 7 0 1 1 3 10a7 7 0 0 1 14 0Z",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z",
  refresh: "M20 7A9 9 0 1 0 21 14M20 3v5h-5",
  volume: "M3 9h4l5-4v14l-5-4H3ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
};
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.film" />
  </svg>
</template>
