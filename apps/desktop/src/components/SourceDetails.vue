<script setup lang="ts">
import { computed } from "vue";
import type { MediaAsset } from "@openfilm/core";
import { sourcePresentation } from "../sourcePresentation";

const props = defineProps<{ asset: MediaAsset; compact?: boolean }>();
const source = computed(() => sourcePresentation(props.asset));
const primaryLabels = new Set([
  "Camera",
  "Capture time",
  "Timezone",
  "Dimensions",
  "Codec",
  "Frame rate",
]);
const primaryDetails = computed(() =>
  props.compact
    ? []
    : source.value.details.filter((row) => primaryLabels.has(row.label)),
);
const technicalDetails = computed(() =>
  source.value.details.filter(
    (row) => props.compact || !primaryLabels.has(row.label),
  ),
);
const hasDetails = computed(
  () =>
    technicalDetails.value.length ||
    source.value.evidence.length ||
    source.value.original360Sources.length ||
    (props.compact && source.value.previewWarnings.length),
);
</script>

<template>
  <section
    class="source-details"
    :class="{ compact }"
    aria-label="Source format and preview"
  >
    <header class="source-details-heading">
      <span class="source-details-kicker">SOURCE FORMAT</span>
      <h3>{{ source.deviceLabel }}</h3>
      <p>{{ source.kindLabel }}</p>
    </header>
    <div
      v-if="source.badges.length"
      class="source-details-badges"
      aria-label="Source characteristics"
    >
      <span
        v-for="badge in source.badges"
        :key="badge"
        :class="{ caution: badge === 'Requires reframed export' }"
        >{{ badge }}</span
      >
    </div>
    <p v-if="!source.previewSupported" class="source-details-unavailable">
      <strong>{{
        source.requiresReframedExport
          ? "Requires reframed export"
          : "Preview unavailable"
      }}</strong>
      {{ source.previewReason }}
    </p>
    <p v-if="source.motionPhoto" class="source-details-note">
      Motion Photo detection is experimental. The recorded evidence identifies a
      possible motion component; extraction is not provided here.
    </p>
    <ul
      v-if="!compact && source.previewWarnings.length"
      class="source-details-warnings"
      aria-label="Preview considerations"
    >
      <li v-for="warning in source.previewWarnings" :key="warning">
        {{ warning }}
      </li>
    </ul>
    <dl v-if="primaryDetails.length" class="source-details-rows">
      <div v-for="row in primaryDetails" :key="row.label">
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </div>
    </dl>
    <details v-if="hasDetails" class="source-details-more">
      <summary>
        {{
          compact
            ? "Source details and evidence"
            : "Technical details and evidence"
        }}
      </summary>
      <ul
        v-if="compact && source.previewWarnings.length"
        class="source-details-warnings"
        aria-label="Preview considerations"
      >
        <li v-for="warning in source.previewWarnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
      <dl v-if="technicalDetails.length" class="source-details-rows">
        <div v-for="row in technicalDetails" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
      <div
        v-if="source.original360Sources.length"
        class="source-details-associations"
      >
        <h4>Associated original 360 sources</h4>
        <p>
          These references use recorded metadata or filename evidence. They do
          not verify stitching, reframing, or optical alignment.
        </p>
        <ul>
          <li v-for="path in source.original360Sources" :key="path">
            {{ path }}
          </li>
        </ul>
      </div>
      <dl
        v-if="source.evidence.length"
        class="source-details-rows source-details-evidence"
      >
        <div
          v-for="(row, index) in source.evidence"
          :key="`${row.label}-${index}`"
        >
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </details>
  </section>
</template>
