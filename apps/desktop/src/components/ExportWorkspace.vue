<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; this derivative as a whole is GPL-3.0-only. See LICENSE/NOTICE.

import { computed, ref } from "vue";
import type { Composition, FilmLook } from "@openfilm/core";
import CaptionExport from "./CaptionExport.vue";
import { useI18n } from "vue-i18n";
import { resolveCompatibility } from "@openfilm/exporters";
import { exportDownloadUrl, type ExportCompatibilityReport } from "../api";
import ExportReport from "./ExportReport.vue";
import Icon from "./Icon.vue";
import FilmLookSelect from "./FilmLookSelect.vue";
const props = defineProps<{
  busy: boolean;
  projectId: string;
  composition: Composition;
  path: string;
  filename?: string;
  format: string;
  stale: boolean;
  report?: ExportCompatibilityReport;
  lookOverride?: FilmLook;
}>();
const emit = defineEmits<{
  export: [format: string];
  look: [look: FilmLook | undefined];
}>();
function changeLookMode(event: Event) {
  emit(
    "look",
    (event.target as HTMLSelectElement).value === "unify"
      ? { version: 1, preset: "none", strength: 1 }
      : undefined,
  );
}
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
      <fieldset class="export-look-options" :disabled="busy">
        <legend>{{ t("looks.exportHeading") }}</legend>
        <label class="field">
          {{ t("looks.exportMode") }}
          <select
            :value="lookOverride ? 'unify' : 'preserve'"
            :aria-label="t('looks.exportMode')"
            @change="changeLookMode"
          >
            <option value="preserve">{{ t("looks.preserve") }}</option>
            <option value="unify">{{ t("looks.unify") }}</option>
          </select>
        </label>
        <FilmLookSelect
          v-if="lookOverride"
          :label="t('looks.exportPreset')"
          :value="lookOverride"
          :disabled="busy"
          @change="emit('look', $event ?? undefined)"
        />
        <p v-if="lookOverride">{{ t("looks.uniformHint") }}</p>
        <p>{{ t("looks.exportOnly") }}</p>
      </fieldset>
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
      <p class="export-look-interchange">{{ t("looks.interchange") }}</p>
      <details v-if="destination === 'resolve'" class="compatibility-card">
        <summary>{{ t("media.compatibility.details") }}</summary>
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
      </details>
      <button
        class="primary"
        :disabled="
          busy || (destination === 'resolve' && resolveStatus === 'unsupported')
        "
        @click="emit('export', destinationFormat)"
      >
        <Icon name="download" />{{ t("app.export.saveEditable") }}
      </button>
      <section
        v-if="destination === 'resolve'"
        class="resolve-handoff"
        :aria-label="t('app.export.resolveGuide.title')"
      >
        <h3>{{ t("app.export.resolveGuide.title") }}</h3>
        <ol>
          <li>{{ t("app.export.resolveGuide.import") }}</li>
          <li>{{ t("app.export.resolveGuide.media") }}</li>
          <li>{{ t("app.export.resolveGuide.check") }}</li>
        </ol>
        <details>
          <summary>{{ t("app.export.resolveGuide.unavailable") }}</summary>
          <p>{{ t("app.export.resolveGuide.fallback") }}</p>
        </details>
      </section>
    </section>
    <CaptionExport
      :project-id="projectId"
      :composition="composition"
      :busy="busy"
    />
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
          v-if="filename"
          class="secondary"
          :href="exportDownloadUrl(filename)"
          download
          >{{
            format === "mp4"
              ? t("app.export.downloadMp4")
              : t("app.export.downloadFile", { format: format.toUpperCase() })
          }}</a
        >
      </div>
    </div>
    <details v-if="filename && format === 'mp4'" class="export-report-details">
      <summary>{{ t("app.export.renderDetails") }}</summary>
      <a :href="exportDownloadUrl(`${filename}.manifest.json`)" download>{{
        t("app.export.downloadRecipe")
      }}</a>
    </details>
    <p v-if="path && stale" class="preview-stale" role="status">
      {{ t("app.export.stale") }}
    </p>
    <ExportReport v-if="path" :report="props.report" :format="format" />
  </section>
</template>

<style scoped>
.export-look-options {
  display: grid;
  gap: var(--of-space-3);
  max-width: 42rem;
  min-width: 0;
  border: 0;
  padding: var(--of-space-4) 0;
  margin: 0 0 var(--of-space-4);
}
.export-look-options legend {
  font-size: var(--of-font-small);
  font-weight: 600;
  padding: 0;
}
.export-look-options select {
  width: 100%;
  min-width: 0;
  white-space: normal;
}
.export-look-options p,
.export-look-interchange {
  font-size: var(--of-font-caption);
  color: var(--of-text-secondary);
  overflow-wrap: anywhere;
}

.export-goals {
  gap: var(--of-space-3);
}
.export-goal {
  padding: var(--of-space-4);
  border-radius: var(--of-radius-md);
}
.export-goal svg {
  flex-shrink: 0;
}
.export-goal > span {
  min-width: 0;
}
.compatibility-card {
  margin-block: var(--of-space-3);
  padding: 0;
  border-radius: 0;
  background: transparent;
}
.compatibility-card > summary {
  color: var(--of-text-secondary);
  cursor: pointer;
}
.compatibility-card .compatibility-feature-list {
  grid-template-columns: minmax(0, 1fr);
  padding-block: var(--of-space-3);
  border-block: 1px solid var(--of-border-subtle);
}
.export-destination > .primary {
  margin-bottom: var(--of-space-4);
}
.resolve-handoff {
  padding-top: var(--of-space-4);
  border-top: 1px solid var(--of-border-subtle);
}
.resolve-handoff h3 {
  margin-bottom: var(--of-space-2);
  font-size: var(--of-font-small);
}
.resolve-handoff ol {
  display: grid;
  gap: var(--of-space-2);
  padding-left: var(--of-space-5);
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
.resolve-handoff details {
  margin-top: var(--of-space-3);
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
.resolve-handoff p {
  max-width: 65ch;
  margin-top: var(--of-space-2);
}
.export-result code {
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.export-result a {
  display: inline-flex;
  align-items: center;
  margin-top: var(--of-space-3);
  color: var(--of-text-primary);
  background: var(--of-surface-2);
  border: 1px solid var(--of-border-strong);
  text-decoration: none;
}
.export-result a:hover {
  background: var(--of-surface-3);
}
</style>
