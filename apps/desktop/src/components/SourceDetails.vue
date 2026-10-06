<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { MediaAsset } from "@openfilm/core";
import { formatDate, formatNumber } from "../i18n";
import { compactPath, sourcePresentation } from "../sourcePresentation";
const { t } = useI18n();
const props = defineProps<{ asset: MediaAsset; compact?: boolean }>();
const source = computed(() =>
  sourcePresentation(props.asset, { translate: t, formatDate, formatNumber }),
);
const primaryKeys = new Set([
  "camera",
  "captureTime",
  "timezone",
  "dimensions",
  "codec",
  "frameRate",
]);
const primaryDetails = computed(() =>
  props.compact
    ? []
    : source.value.details.filter((row) => primaryKeys.has(row.key)),
);
const technicalDetails = computed(() =>
  source.value.details.filter(
    (row) => props.compact || !primaryKeys.has(row.key),
  ),
);
const hasDetails = computed(
  () =>
    technicalDetails.value.length ||
    source.value.evidence.length ||
    source.value.original360Sources.length ||
    source.value.technicalWarnings.length ||
    (props.compact && source.value.previewWarnings.length),
);
</script>

<template>
  <section
    class="source-details"
    :class="{ compact }"
    :aria-label="t('media.source.region')"
  >
    <header class="source-details-heading">
      <span class="source-details-kicker">{{ t("media.source.heading") }}</span>
      <h3>{{ source.deviceLabel }}</h3>
      <p>{{ source.kindLabel }}</p>
    </header>
    <div
      v-if="source.badges.length"
      class="source-details-badges"
      :aria-label="t('media.source.characteristics')"
    >
      <span
        v-for="(badge, index) in source.badges"
        :key="index"
        :class="{ caution: source.requiresReframedExport && index === 0 }"
        >{{ badge }}</span
      >
    </div>
    <p v-if="!source.previewSupported" class="source-details-unavailable">
      <strong>{{
        t(
          `media.source.${source.requiresReframedExport ? "reframe" : "previewUnavailable"}`,
        )
      }}</strong>
      {{ source.previewReason }}
    </p>
    <p v-if="source.motionPhoto" class="source-details-note">
      {{ t("media.source.motionHelp") }}
    </p>
    <ul
      v-if="!compact && source.previewWarnings.length"
      class="source-details-warnings"
      :aria-label="t('media.source.previewConsiderations')"
    >
      <li v-for="warning in source.previewWarnings" :key="warning">
        {{ warning }}
      </li>
    </ul>
    <dl v-if="primaryDetails.length" class="source-details-rows">
      <div v-for="row in primaryDetails" :key="row.key">
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </div>
    </dl>
    <details v-if="hasDetails" class="source-details-more">
      <summary>
        {{ t(`media.source.${compact ? "details" : "technical"}`) }}
      </summary>
      <ul
        v-if="compact && source.previewWarnings.length"
        class="source-details-warnings"
        :aria-label="t('media.source.previewConsiderations')"
      >
        <li v-for="warning in source.previewWarnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
      <ul
        v-if="source.technicalWarnings.length"
        class="source-details-warnings"
      >
        <li v-for="warning in source.technicalWarnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
      <dl v-if="technicalDetails.length" class="source-details-rows">
        <div v-for="row in technicalDetails" :key="row.key">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
      <div
        v-if="source.original360Sources.length"
        class="source-details-associations"
      >
        <h4>{{ t("media.source.original360") }}</h4>
        <p>{{ t("media.source.associationHelp") }}</p>
        <ul>
          <li
            v-for="path in source.original360Sources"
            :key="path"
            :title="path"
          >
            {{ compactPath(path) }}
          </li>
        </ul>
      </div>
      <dl
        v-if="source.evidence.length"
        class="source-details-rows source-details-evidence"
      >
        <div
          v-for="(row, index) in source.evidence"
          :key="`${row.key}-${index}`"
        >
          <dt>{{ row.label }}</dt>
          <dd :title="row.value">{{ row.value }}</dd>
        </div>
      </dl>
    </details>
  </section>
</template>
