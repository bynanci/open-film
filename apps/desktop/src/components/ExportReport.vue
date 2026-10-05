<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  report?: {
    format: string;
    warnings: string[];
    realNleVerified?: false;
    advancedEdits?: "metadata-only";
  };
  format: string;
}>();

const isOtio = computed(
  () =>
    props.format.toLowerCase() === "otio" ||
    props.report?.format.toLowerCase() === "otio",
);
const metadataOnly = computed(
  () => props.report?.advancedEdits === "metadata-only",
);
const warnings = computed(() => props.report?.warnings ?? []);
</script>

<template>
  <section
    v-if="isOtio || metadataOnly || warnings.length"
    class="export-report"
    aria-label="Export compatibility report"
  >
    <header class="export-report-heading">
      <h3>Manual finishing checks</h3>
      <span v-if="isOtio">OpenTimelineIO</span>
    </header>

    <div v-if="isOtio" class="export-report-verification">
      <p class="export-report-status">
        Import in DaVinci Resolve still needs manual verification.
      </p>
      <p>
        Check basic cuts, source trims, still durations, audio, and track layout
        after importing the file. OpenTimelineIO parser validation does not
        confirm Resolve behavior.
      </p>
    </div>

    <div v-if="metadataOnly" class="export-report-advanced">
      <h4>Advanced edits need recreation in Resolve</h4>
      <p>
        Speed, volume, transforms, and crossfades are stored in OpenFilm
        metadata. They are not native Resolve effects in this export. Recreate
        these edits in Resolve and compare the result with your OpenFilm
        preview.
      </p>
    </div>

    <ul
      v-if="warnings.length"
      class="export-report-warnings"
      aria-label="Export warnings"
    >
      <li v-for="(warning, index) in warnings" :key="index">{{ warning }}</li>
    </ul>
  </section>
</template>
