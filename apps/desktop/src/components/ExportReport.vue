<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { resolveCompatibility } from "@openfilm/exporters";
import { formatNumber } from "../i18n";
const { t } = useI18n();
const props = defineProps<{
  report?: {
    format: string;
    warnings: string[];
    realNleVerified?: false;
    advancedEdits?: "metadata-only";
    metadataOnlyEdits?: { clipId: string; features: string[] }[];
  };
  format: string;
}>();
const isOtio = computed(
  () =>
    props.format.toLowerCase() === "otio" ||
    props.report?.format.toLowerCase() === "otio",
);
const metadataOnly = computed(
  () =>
    props.report?.advancedEdits === "metadata-only" &&
    (props.report.metadataOnlyEdits === undefined ||
      props.report.metadataOnlyEdits.length > 0),
);
const warnings = computed(() => props.report?.warnings ?? []);
const manualFeatures = computed(() => {
  const edits = props.report?.metadataOnlyEdits;
  if (edits === undefined)
    return resolveCompatibility.features.filter(
      (feature) => feature.manualRecreation,
    );
  const mapping: Record<string, string> = {
    speed: "speed",
    volume: "volumeMute",
    scale: "transform",
    rotation: "transform",
    x: "transform",
    y: "transform",
    crossfade: "crossfade",
    title: "titles",
    overlay: "titles",
    "clip lock": "clipLocks",
  };
  const required = new Set(
    edits.flatMap((edit) =>
      edit.features.map((feature) => mapping[feature]).filter(Boolean),
    ),
  );
  return resolveCompatibility.features.filter((feature) =>
    required.has(feature.id),
  );
});
const requiresVerification = resolveCompatibility.features.some(
  (feature) => feature.implementation === "native" && !feature.realNleVerified,
);
</script>

<template>
  <section
    v-if="isOtio || metadataOnly || warnings.length"
    class="export-report"
    :aria-label="t('media.report.region')"
  >
    <header class="export-report-heading">
      <h3>{{ t("media.report.heading") }}</h3>
      <span v-if="isOtio">OpenTimelineIO</span>
    </header>
    <div
      v-if="isOtio && requiresVerification"
      class="export-report-verification"
    >
      <p class="export-report-status">{{ t("media.report.unverified") }}</p>
      <p>{{ t("media.report.checkHelp") }}</p>
    </div>
    <div v-if="metadataOnly" class="export-report-advanced">
      <h4>{{ t("media.report.manualTitle") }}</h4>
      <p>{{ t("media.report.manualHelp") }}</p>
      <ul>
        <li v-for="feature in manualFeatures" :key="feature.id">
          {{ t(`media.compatibility.feature.${feature.id}`) }}
        </li>
      </ul>
    </div>
    <details v-if="warnings.length" class="export-report-details">
      <summary>
        {{
          t(
            "media.report.warningSummary",
            { count: formatNumber(warnings.length) },
            warnings.length,
          )
        }}
        {{ t("media.report.technical") }}
      </summary>
      <ul
        class="export-report-warnings"
        :aria-label="t('media.report.warnings')"
      >
        <li v-for="(warning, index) in warnings" :key="index">{{ warning }}</li>
      </ul>
    </details>
  </section>
</template>
