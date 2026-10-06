<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { resolveCompatibility } from "@openfilm/exporters";
import { exportDownloadUrl, type ExportCompatibilityReport } from "../api";
import ExportReport from "./ExportReport.vue";
import Icon from "./Icon.vue";
const props = defineProps<{
  busy: boolean;
  path: string;
  filename?: string;
  format: string;
  stale: boolean;
  report?: ExportCompatibilityReport;
}>();
const emit = defineEmits<{ export: [format: string] }>();
const { t } = useI18n();
const goal = ref<"watch" | "edit">("watch");
const destination = ref<"resolve" | "finalcut" | "premiere">("resolve");
const resolveStatus = computed(() =>
  resolveCompatibility.features.some(
    (feature) => feature.implementation === "native",
  )
    ? resolveCompatibility.features
        .filter((feature) => feature.implementation === "native")
        .every((feature) => feature.realNleVerified)
      ? "verified"
      : "manual"
    : "unsupported",
);
const destinationFormat = computed(
  () =>
    ({ resolve: "otio", finalcut: "fcpxml", premiere: "edl" })[
      destination.value
    ],
);
const formats = ["otio", "fcpxml", "edl", "json"] as const;
</script>
<template>
  <section class="export-options" :aria-label="t('app.export.label')">
    <header>
      <span class="eyebrow">{{ t("app.export.eyebrow") }}</span>
      <h2>{{ t("app.export.title") }}</h2>
      <p>{{ t("app.export.description") }}</p>
    </header>
    <div class="export-goals" role="group" :aria-label="t('app.export.goal')">
      <button
        class="export-goal"
        :class="{ selected: goal === 'watch' }"
        :aria-pressed="goal === 'watch'"
        @click="goal = 'watch'"
      >
        <Icon name="play" :size="24" /><span
          ><strong>{{ t("app.export.watch") }}</strong
          ><small>{{ t("app.export.watchHint") }}</small></span
        >
      </button>
      <button
        class="export-goal"
        :class="{ selected: goal === 'edit' }"
        :aria-pressed="goal === 'edit'"
        @click="goal = 'edit'"
      >
        <Icon name="film" :size="24" /><span
          ><strong>{{ t("app.export.edit") }}</strong
          ><small>{{ t("app.export.editHint") }}</small></span
        >
      </button>
    </div>
    <section v-if="goal === 'watch'" class="export-destination">
      <h3>{{ t("app.export.mp4Title") }}</h3>
      <p>{{ t("app.export.mp4Hint") }}</p>
      <button class="primary" :disabled="busy" @click="emit('export', 'mp4')">
        <Icon name="download" />{{ t("app.export.saveMp4") }}
      </button>
    </section>
    <section v-else class="export-destination">
      <label class="field"
        >{{ t("app.export.destination")
        }}<select v-model="destination">
          <option value="resolve">DaVinci Resolve</option>
          <option value="finalcut">Final Cut Pro</option>
          <option value="premiere">Adobe Premiere Pro</option>
        </select></label
      >
      <p
        class="compatibility-status"
        :data-status="destination === 'resolve' ? resolveStatus : 'manual'"
      >
        {{
          t(
            `app.export.compatibility.${destination === "resolve" ? resolveStatus : "manual"}`,
          )
        }}
      </p>
      <p>{{ t(`app.export.destinationHint.${destination}`) }}</p>
      <section
        v-if="destination === 'resolve'"
        class="compatibility-card"
        :aria-label="t('media.compatibility.details')"
      >
        <h3>{{ t("media.compatibility.details") }}</h3>
        <ul class="compatibility-feature-list">
          <li
            v-for="feature in resolveCompatibility.features"
            :key="feature.id"
          >
            <span>{{ t(`media.compatibility.feature.${feature.id}`) }}</span
            ><span :data-status="feature.implementation">{{
              t(
                feature.manualRecreation
                  ? "media.compatibility.manual"
                  : feature.implementation === "unsupported"
                    ? "media.compatibility.unsupported"
                    : feature.realNleVerified
                      ? "media.compatibility.verified"
                      : feature.parserValidated
                        ? "media.compatibility.parserChecked"
                        : "media.compatibility.unverified",
              )
            }}</span>
          </li>
        </ul>
      </section>
      <button
        class="primary"
        :disabled="
          busy || (destination === 'resolve' && resolveStatus === 'unsupported')
        "
        @click="emit('export', destinationFormat)"
      >
        <Icon name="download" />{{ t("app.export.saveEditable") }}
      </button>
    </section>
    <details class="export-advanced">
      <summary>{{ t("app.export.advanced") }}</summary>
      <div class="export-format-list">
        <button
          v-for="choice in formats"
          :key="choice"
          :disabled="busy"
          @click="emit('export', choice)"
        >
          <span
            ><strong>{{ t(`app.export.formats.${choice}.title`) }}</strong
            ><small>{{ t(`app.export.formats.${choice}.hint`) }}</small></span
          ><span class="format-extension">.{{ choice }}</span
          ><Icon name="download" />
        </button>
      </div>
    </details>
    <div v-if="path" class="export-result" role="status">
      <Icon name="check" :size="18" />
      <div>
        <strong>{{ t("app.export.saved") }}</strong
        ><code :title="path">{{ path }}</code
        ><a
          v-if="format === 'mp4' && filename"
          class="secondary"
          :href="exportDownloadUrl(filename)"
          download
          >{{ t("app.export.downloadMp4") }}</a
        >
      </div>
    </div>
    <p v-if="path && stale" class="preview-stale" role="status">
      {{ t("app.export.stale") }}
    </p>
    <ExportReport v-if="path" :report="props.report" :format="format" />
  </section>
</template>
