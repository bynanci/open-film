<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { computed, onUnmounted, ref, useId, watch } from "vue";
import {
  createExportProfile,
  type Composition,
  type ExportFraming,
  type ExportProfile,
  type ExportRatio,
  type FilmLook,
  type ProjectSettings,
} from "@openfilm/core";
import NleHandoff from "./NleHandoff.vue";
import LocalDownload from "./LocalDownload.vue";
import CaptionExport from "./CaptionExport.vue";
import { useI18n } from "vue-i18n";
import { resolveCompatibility } from "@openfilm/exporters";
import {
  exportDownloadUrl,
  exportFramePreviewUrl,
  exportProfileAudio,
  exportStill,
  previewExportFrame,
  type AudioProfileExport,
  type ExportCompatibilityReport,
  type ProfileFramePreview,
} from "../api";
import ExportReport from "./ExportReport.vue";
import Icon from "./Icon.vue";
import FilmLookSelect from "./FilmLookSelect.vue";
const props = defineProps<{
  expertMode?: boolean;
  busy: boolean;
  projectId: string;
  projectSettings: ProjectSettings;
  composition: Composition;
  path: string;
  filename?: string;
  format: string;
  stale: boolean;
  report?: ExportCompatibilityReport;
  lookOverride?: FilmLook;
  quality?: "standard" | "high-detail";
  captionTrackId?: string | null;
}>();
const emit = defineEmits<{
  export: [
    format: string,
    profile?: ExportProfile,
    confirmCrop?: boolean,
    cropPreviewToken?: string,
  ];
  look: [look: FilmLook | undefined];
  quality: [value: "standard" | "high-detail"];
  captionTrack: [value: string | null | undefined];
  profileBusy: [busy: boolean];
}>();
const qualityId = useId();
function changeQuality(event: Event) {
  if (props.busy) return;
  const value = (event.target as HTMLSelectElement).value;
  if (value === "standard" || value === "high-detail") emit("quality", value);
}
function changeCaptionTrack(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  emit("captionTrack", value === "__none" ? null : value || undefined);
}
function changeLookMode(event: Event) {
  emit(
    "look",
    (event.target as HTMLSelectElement).value === "unify"
      ? { version: 1, preset: "none", strength: 1 }
      : undefined,
  );
}
const { t, locale } = useI18n();
const displayFrameRate = computed(() =>
  new Intl.NumberFormat(locale.value, { maximumFractionDigits: 3 }).format(
    props.projectSettings.frameRate,
  ),
);
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

const profileId = useId();
const ratio = ref<ExportRatio>("16:9");
const framing = ref<ExportFraming>("contain");
const frameTime = ref(0);
const cropConfirmed = ref(false);
const cropReviewed = ref(false);
const profileBusy = ref<
  "preview" | "still" | "audio-mix" | "audio-stems" | null
>(null);
const profileError = ref("");
const framePreview = ref<ProfileFramePreview | null>(null);
const previewImageUrl = ref("");
const stillResult = ref<Awaited<ReturnType<typeof exportStill>> | null>(null);
const audioResult = ref<AudioProfileExport | null>(null);
let activeController: AbortController | undefined;
let operationGeneration = 0;
let stillRequestKey = "";
let stillRequestId = "";
let audioRequestKey = "";
let audioRequestId = "";

const deliveryFrameRate = computed(() =>
  Math.min(60, Math.max(1, props.projectSettings.frameRate)),
);
const displayDeliveryFrameRate = computed(() =>
  new Intl.NumberFormat(locale.value, { maximumFractionDigits: 3 }).format(
    deliveryFrameRate.value,
  ),
);
const mp4Profile = computed(() =>
  createExportProfile({
    ratio: ratio.value,
    frameRate: deliveryFrameRate.value,
    framing: framing.value,
    format: "mp4",
    quality: props.quality ?? "standard",
  }),
);
const canExportCropped = computed(
  () => framing.value !== "crop" || (cropReviewed.value && cropConfirmed.value),
);
const isProfileBusy = computed(() => !!profileBusy.value || props.busy);

function clearPreview() {
  if (previewImageUrl.value) URL.revokeObjectURL(previewImageUrl.value);
  previewImageUrl.value = "";
  framePreview.value = null;
  cropReviewed.value = false;
  cropConfirmed.value = false;
}

watch(
  [
    () => props.projectId,
    // Project polling replaces the JSON object even when the saved cut is
    // unchanged. Fence real edit changes without cancelling an active render
    // merely because an equivalent project snapshot was refreshed.
    () => JSON.stringify(props.composition),
    () => props.projectSettings.frameRate,
    () => props.projectSettings.width,
    () => props.projectSettings.height,
    () => JSON.stringify(props.lookOverride),
    () => props.captionTrackId,
    () => props.quality,
    ratio,
    framing,
    frameTime,
  ],
  () => {
    operationGeneration++;
    activeController?.abort();
    activeController = undefined;
    if (profileBusy.value) emit("profileBusy", false);
    profileBusy.value = null;
    profileError.value = "";
    clearPreview();
    stillResult.value = null;
    audioResult.value = null;
  },
);

function current(generation: number, controller: AbortController) {
  return generation === operationGeneration && activeController === controller;
}

async function runProfileAction<T>(
  kind: NonNullable<typeof profileBusy.value>,
  action: (signal: AbortSignal) => Promise<T>,
  publish: (result: T) => void,
) {
  if (isProfileBusy.value) return;
  const controller = new AbortController();
  const generation = ++operationGeneration;
  activeController = controller;
  profileBusy.value = kind;
  profileError.value = "";
  emit("profileBusy", true);
  try {
    const result = await action(controller.signal);
    if (current(generation, controller)) publish(result);
  } catch (error) {
    if (current(generation, controller) && !controller.signal.aborted)
      profileError.value =
        error instanceof Error ? error.message : String(error);
  } finally {
    if (current(generation, controller)) {
      activeController = undefined;
      profileBusy.value = null;
      emit("profileBusy", false);
    }
  }
}

function cancelProfileAction() {
  activeController?.abort();
}

async function makeFramePreview() {
  clearPreview();
  const profile = mp4Profile.value;
  await runProfileAction(
    "preview",
    async (signal) => {
      const result = await previewExportFrame(
        {
          compositionId: props.composition.id,
          profile,
          time: frameTime.value,
          lookOverride: props.lookOverride,
          captionTrackId: props.captionTrackId,
        },
        signal,
      );
      const response = await fetch(exportFramePreviewUrl(result.token), {
        signal,
      });
      if (!response.ok)
        throw new Error(`Preview frame unavailable (${response.status}).`);
      if (!response.headers.get("content-type")?.startsWith("image/png"))
        throw new Error("Export preview did not return a PNG image.");
      const image = URL.createObjectURL(await response.blob());
      return { result, image };
    },
    ({ result, image }) => {
      framePreview.value = result;
      previewImageUrl.value = image;
      cropReviewed.value = true;
    },
  );
}

function keyedRequestId(kind: "still" | "audio", key: string): string {
  if (kind === "still") {
    if (stillRequestKey !== key) {
      stillRequestKey = key;
      stillRequestId = crypto.randomUUID();
    }
    return stillRequestId;
  }
  if (audioRequestKey !== key) {
    audioRequestKey = key;
    audioRequestId = crypto.randomUUID();
  }
  return audioRequestId;
}

async function saveStill() {
  if (!canExportCropped.value) return;
  const profile = createExportProfile({
    ratio: ratio.value,
    frameRate: deliveryFrameRate.value,
    framing: framing.value,
    format: "png",
    quality: props.quality ?? "standard",
  });
  const key = JSON.stringify({
    projectId: props.projectId,
    composition: props.composition,
    profile,
    time: frameTime.value,
    lookOverride: props.lookOverride,
    captionTrackId: props.captionTrackId,
  });
  const requestId = keyedRequestId("still", key);
  await runProfileAction(
    "still",
    (signal) =>
      exportStill(
        {
          compositionId: props.composition.id,
          profile,
          time: frameTime.value,
          requestId,
          confirmCrop: cropConfirmed.value,
          cropPreviewToken: framePreview.value?.token,
          lookOverride: props.lookOverride,
          captionTrackId: props.captionTrackId,
        },
        signal,
      ),
    (result) => (stillResult.value = result),
  );
}

async function saveAudio(format: "wav" | "audio-stems") {
  const profile = createExportProfile({
    ratio: "16:9",
    frameRate: deliveryFrameRate.value,
    format,
  });
  const key = JSON.stringify({
    projectId: props.projectId,
    composition: props.composition,
    profile,
  });
  const requestId = keyedRequestId("audio", key);
  await runProfileAction(
    format === "wav" ? "audio-mix" : "audio-stems",
    (signal) =>
      exportProfileAudio(
        { compositionId: props.composition.id, profile, requestId },
        signal,
      ),
    (result) => (audioResult.value = result),
  );
}

function audioDownloadName(file: AudioProfileExport["files"][number]) {
  return audioResult.value?.profile.format === "audio-stems"
    ? `stems-${audioResult.value.requestId}/${file.filename}`
    : file.filename;
}

function exportWarningLabel(warning: string) {
  if (warning.includes("letterboxes the saved Composition frame"))
    return t("exportProfiles.letterboxWarning");
  if (warning.includes("Explicit center crop may trim"))
    return t("exportProfiles.cropWarning");
  if (warning.includes("opaque; transparent/alpha export is unsupported"))
    return t("exportProfiles.alphaWarning");
  if (
    warning.startsWith(
      "No dialogue, narration, music or ambience audio roles apply",
    )
  )
    return t("exportProfiles.noAudioRoles");
  return warning;
}

onUnmounted(() => {
  operationGeneration++;
  activeController?.abort();
  if (activeController) emit("profileBusy", false);
  clearPreview();
});
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
      <button
        class="primary export-primary-action"
        data-testid="export-profile-mp4"
        :disabled="busy || !canExportCropped"
        @click="
          emit('export', 'mp4', mp4Profile, cropConfirmed, framePreview?.token)
        "
      >
        <Icon name="download" />{{ t("app.export.saveMp4") }}
      </button>
      <section
        class="export-quality-options"
        :aria-label="t('exportQuality.heading')"
      >
        <dl class="export-picture-summary">
          <div>
            <dt>{{ t("exportQuality.savedFrame") }}</dt>
            <dd data-testid="export-frame">
              {{
                t("exportQuality.frame", {
                  width: projectSettings.width,
                  height: projectSettings.height,
                  frameRate: displayFrameRate,
                })
              }}
            </dd>
          </div>
          <div>
            <dt>{{ t("exportQuality.source") }}</dt>
            <dd>{{ t("exportQuality.originals") }}</dd>
          </div>
        </dl>
        <div class="field">
          <label :for="qualityId">{{ t("exportQuality.quality") }}</label>
          <select
            :id="qualityId"
            data-testid="export-quality"
            :value="quality ?? 'standard'"
            :disabled="busy"
            :aria-describedby="`${qualityId}-hint ${qualityId}-frame ${qualityId}-limits`"
            @change="changeQuality"
          >
            <option value="standard">{{ t("exportQuality.standard") }}</option>
            <option value="high-detail">
              {{ t("exportQuality.highDetail") }}
            </option>
          </select>
        </div>
        <div v-if="composition.captionTracks?.length" class="field">
          <label :for="`${qualityId}-captions`">
            {{ t("exportQuality.captionTrack") }}
          </label>
          <select
            :id="`${qualityId}-captions`"
            data-testid="export-caption-track"
            :value="captionTrackId === null ? '__none' : (captionTrackId ?? '')"
            :disabled="busy"
            @change="changeCaptionTrack"
          >
            <option value="">
              {{ t("exportQuality.captionTrackAutomatic") }}
            </option>
            <option value="__none">
              {{ t("exportQuality.captionTrackNone") }}
            </option>
            <option
              v-for="track in composition.captionTracks"
              :key="track.id"
              :value="track.id"
            >
              {{ track.name }}{{ track.language ? ` · ${track.language}` : "" }}
            </option>
          </select>
          <p>{{ t("exportQuality.captionTrackHint") }}</p>
        </div>
        <p :id="`${qualityId}-hint`">
          {{
            t(
              quality === "high-detail"
                ? "exportQuality.highDetailHint"
                : "exportQuality.standardHint",
            )
          }}
        </p>
        <p :id="`${qualityId}-frame`">
          {{ t("exportQuality.frameUnchanged") }}
        </p>
        <p :id="`${qualityId}-limits`">{{ t("exportQuality.limits") }}</p>
      </section>
      <section
        class="export-profile-options"
        :aria-label="t('exportProfiles.heading')"
      >
        <h3>{{ t("exportProfiles.heading") }}</h3>
        <p>{{ t("exportProfiles.description") }}</p>
        <div class="export-profile-grid">
          <label class="field" :for="`${profileId}-ratio`">
            {{ t("exportProfiles.ratio") }}
            <select
              :id="`${profileId}-ratio`"
              v-model="ratio"
              data-testid="export-ratio"
              :disabled="isProfileBusy"
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
          </label>
          <label class="field" :for="`${profileId}-framing`">
            {{ t("exportProfiles.framing") }}
            <select
              :id="`${profileId}-framing`"
              v-model="framing"
              data-testid="export-framing"
              :disabled="isProfileBusy"
            >
              <option value="contain">{{ t("exportProfiles.contain") }}</option>
              <option value="crop">{{ t("exportProfiles.crop") }}</option>
            </select>
          </label>
          <label class="field" :for="`${profileId}-time`">
            {{ t("exportProfiles.frameTime") }}
            <input
              :id="`${profileId}-time`"
              v-model.number="frameTime"
              data-testid="export-frame-time"
              type="number"
              min="0"
              :max="Math.max(0, composition.duration - 1 / deliveryFrameRate)"
              step="any"
              inputmode="decimal"
              :disabled="isProfileBusy"
            />
          </label>
        </div>
        <p class="export-profile-size" data-testid="export-profile-size">
          {{ mp4Profile.width }} × {{ mp4Profile.height }} ·
          {{
            t("exportProfiles.outputFrameRate", {
              frameRate: displayDeliveryFrameRate,
            })
          }}
        </p>
        <p v-if="framing === 'crop'" class="export-profile-warning" role="note">
          {{ t("exportProfiles.cropWarning") }}
        </p>
        <div class="export-profile-actions">
          <button
            class="secondary"
            data-testid="preview-export-frame"
            :disabled="
              isProfileBusy ||
              !Number.isFinite(frameTime) ||
              frameTime < 0 ||
              frameTime >= composition.duration
            "
            @click="makeFramePreview"
          >
            <Icon name="eye" :size="18" />
            {{
              profileBusy === "preview"
                ? t("exportProfiles.renderingPreview")
                : t("exportProfiles.previewFrame")
            }}
          </button>
          <button
            class="secondary"
            data-testid="export-still"
            :disabled="
              isProfileBusy ||
              !Number.isFinite(frameTime) ||
              frameTime < 0 ||
              frameTime >= composition.duration ||
              !canExportCropped
            "
            @click="saveStill"
          >
            <Icon name="image" :size="18" />{{ t("exportProfiles.saveStill") }}
          </button>
          <button
            v-if="profileBusy"
            class="secondary"
            data-testid="cancel-profile-export"
            @click="cancelProfileAction"
          >
            <Icon name="close" :size="18" />{{ t("exportProfiles.cancel") }}
          </button>
        </div>
        <label v-if="framing === 'crop'" class="export-crop-confirm">
          <input
            v-model="cropConfirmed"
            data-testid="confirm-export-crop"
            type="checkbox"
            :disabled="isProfileBusy || !cropReviewed"
          />
          <span>{{ t("exportProfiles.confirmCrop") }}</span>
        </label>
        <p v-if="profileError" class="export-profile-error" role="alert">
          {{ profileError }}
        </p>
        <figure
          v-if="framePreview && previewImageUrl"
          class="export-frame-preview"
        >
          <img
            :src="previewImageUrl"
            data-testid="export-preview-image"
            :alt="t('exportProfiles.previewAlt', { time: framePreview.time })"
          />
          <figcaption>
            {{
              t("exportProfiles.previewDetails", {
                width: framePreview.width,
                height: framePreview.height,
                time: framePreview.time,
                frame: framePreview.frameIndex,
              })
            }}
          </figcaption>
          <ul
            v-if="framePreview.warnings.length"
            class="export-profile-warnings"
          >
            <li v-for="warning in framePreview.warnings" :key="warning">
              {{ exportWarningLabel(warning) }}
            </li>
          </ul>
        </figure>
        <div v-if="stillResult" class="export-profile-result" role="status">
          <strong>{{ t("exportProfiles.stillSaved") }}</strong>
          <LocalDownload
            :href="exportDownloadUrl(stillResult.filename)"
            :filename="stillResult.filename"
            :owner="projectId"
          >
            {{
              t("exportProfiles.downloadStill", {
                filename: stillResult.filename,
              })
            }}
          </LocalDownload>
          <LocalDownload
            :href="exportDownloadUrl(`${stillResult.filename}.manifest.json`)"
            :filename="`${stillResult.filename}.manifest.json`"
            :owner="projectId"
          >
            {{ t("exportProfiles.downloadReceipt") }}
          </LocalDownload>
          <ul
            v-if="stillResult.warnings.length"
            class="export-profile-warnings"
          >
            <li v-for="warning in stillResult.warnings" :key="warning">
              {{ exportWarningLabel(warning) }}
            </li>
          </ul>
        </div>
      </section>
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
      <section
        class="export-profile-audio"
        :aria-label="t('exportProfiles.audioHeading')"
      >
        <h3>{{ t("exportProfiles.audioHeading") }}</h3>
        <p>{{ t("exportProfiles.audioDescription") }}</p>
        <div class="export-profile-actions">
          <button
            class="secondary"
            data-testid="export-audio-mix"
            :disabled="isProfileBusy"
            @click="saveAudio('wav')"
          >
            <Icon name="music" :size="18" />{{
              profileBusy === "audio-mix"
                ? t("exportProfiles.exportingAudio")
                : t("exportProfiles.saveMix")
            }}
          </button>
          <button
            class="secondary"
            data-testid="export-audio-stems"
            :disabled="isProfileBusy"
            @click="saveAudio('audio-stems')"
          >
            <Icon name="layers" :size="18" />{{
              profileBusy === "audio-stems"
                ? t("exportProfiles.exportingAudio")
                : t("exportProfiles.saveStems")
            }}
          </button>
        </div>
        <p
          v-if="audioResult?.warnings.length"
          class="export-profile-warning"
          role="status"
        >
          {{ audioResult.warnings.map(exportWarningLabel).join(" ") }}
        </p>
        <div v-if="audioResult" class="export-profile-result" role="status">
          <strong>{{ t("exportProfiles.audioSaved") }}</strong>
          <ul v-if="audioResult.files.length">
            <li v-for="file in audioResult.files" :key="file.filename">
              <LocalDownload
                :href="exportDownloadUrl(audioDownloadName(file))"
                :filename="file.filename"
                :owner="projectId"
              >
                {{
                  t("exportProfiles.audioFile", {
                    role: t(`exportProfiles.roles.${file.role}`),
                    filename: file.filename,
                    duration: file.duration.toFixed(3),
                    sampleRate: file.sampleRate,
                    channels: file.channels,
                    samples: file.sampleCount,
                  })
                }}
              </LocalDownload>
            </li>
          </ul>
          <LocalDownload
            v-if="
              audioResult.manifestPath && audioResult.profile.format === 'wav'
            "
            :href="
              exportDownloadUrl(
                `${audioResult.files[0]?.filename}.manifest.json`,
              )
            "
            :filename="`${audioResult.files[0]?.filename}.manifest.json`"
            :owner="projectId"
            >{{ t("exportProfiles.downloadReceipt") }}</LocalDownload
          >
          <LocalDownload
            v-if="
              audioResult.manifestPath &&
              audioResult.profile.format === 'audio-stems'
            "
            :href="
              exportDownloadUrl(`stems-${audioResult.requestId}/manifest.json`)
            "
            filename="manifest.json"
            :owner="projectId"
            >{{ t("exportProfiles.downloadReceipt") }}</LocalDownload
          >
        </div>
      </section>
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
    <NleHandoff
      :project-id="projectId"
      :composition="composition"
      :busy="busy"
    />
    <details class="export-advanced" :open="expertMode">
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
        ><LocalDownload
          v-if="filename"
          class="secondary"
          :href="exportDownloadUrl(filename)"
          :filename="filename"
          :owner="projectId"
          >{{
            format === "mp4"
              ? t("app.export.downloadMp4")
              : t("app.export.downloadFile", { format: format.toUpperCase() })
          }}</LocalDownload
        >
      </div>
    </div>
    <details v-if="filename && format === 'mp4'" class="export-report-details">
      <summary>{{ t("app.export.renderDetails") }}</summary>
      <LocalDownload
        :href="exportDownloadUrl(`${filename}.manifest.json`)"
        :filename="`${filename}.manifest.json`"
        :owner="projectId"
        >{{ t("app.export.downloadRecipe") }}</LocalDownload
      >
    </details>
    <p v-if="path && stale" class="preview-stale" role="status">
      {{ t("app.export.stale") }}
    </p>
    <ExportReport v-if="path" :report="props.report" :format="format" />
  </section>
</template>

<style scoped>
.export-profile-options,
.export-profile-audio {
  display: grid;
  gap: var(--of-space-3);
  max-width: 48rem;
  min-width: 0;
  margin-block: var(--of-space-4);
  padding-block: var(--of-space-4);
  border-top: 1px solid var(--of-border-subtle);
}
.export-profile-options h3,
.export-profile-audio h3 {
  margin: 0;
  font-size: var(--of-font-small);
}
.export-profile-options > p,
.export-profile-audio > p {
  margin: 0;
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
  overflow-wrap: anywhere;
}
.export-profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
  gap: var(--of-space-3);
}
.export-profile-grid select,
.export-profile-grid input {
  width: 100%;
  min-width: 0;
}
.export-profile-size {
  color: var(--of-text-primary) !important;
  font-variant-numeric: tabular-nums;
}
.export-profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-2);
}
.export-profile-actions button {
  display: inline-flex;
  align-items: center;
  gap: var(--of-space-2);
}
.export-crop-confirm {
  display: flex;
  align-items: flex-start;
  gap: var(--of-space-2);
  max-width: 65ch;
  font-size: var(--of-font-caption);
}
.export-crop-confirm input {
  flex: 0 0 auto;
  margin-top: 0.2em;
}
.export-profile-warning,
.export-profile-error {
  margin: 0;
  padding: var(--of-space-3);
  border-radius: var(--of-radius-sm);
  background: var(--of-surface-2);
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
  overflow-wrap: anywhere;
}
.export-profile-error {
  color: var(--of-danger-text, var(--of-text-primary));
}
.export-frame-preview {
  display: grid;
  gap: var(--of-space-2);
  max-width: min(100%, 40rem);
  margin: 0;
}
.export-frame-preview img {
  display: block;
  max-width: 100%;
  max-height: 36rem;
  object-fit: contain;
  background: #111;
  border: 1px solid var(--of-border-subtle);
}
.export-frame-preview figcaption {
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
  font-variant-numeric: tabular-nums;
}
.export-profile-warnings {
  display: grid;
  gap: var(--of-space-1);
  margin: 0;
  padding-left: var(--of-space-5);
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
  overflow-wrap: anywhere;
}
.export-profile-result {
  display: grid;
  justify-items: start;
  gap: var(--of-space-2);
  min-width: 0;
  padding: var(--of-space-3);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-sm);
  background: var(--of-surface-1);
  overflow-wrap: anywhere;
}
.export-profile-result ul {
  display: grid;
  gap: var(--of-space-2);
  margin: 0;
  padding-left: var(--of-space-5);
}
.export-profile-result a {
  color: var(--of-text-primary);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}
.export-quality-options {
  display: grid;
  gap: var(--of-space-2);
  max-width: 42rem;
  min-width: 0;
  margin-bottom: var(--of-space-4);
}
.export-picture-summary {
  display: grid;
  gap: var(--of-space-2);
  margin: 0 0 var(--of-space-2);
  font-size: var(--of-font-small);
}
.export-picture-summary > div {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-2) var(--of-space-4);
}
.export-picture-summary dt {
  color: var(--of-text-secondary);
}
.export-picture-summary dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.export-quality-options select {
  width: 100%;
  min-width: 0;
}
.export-quality-options p {
  margin: 0;
  font-size: var(--of-font-caption);
  color: var(--of-text-secondary);
  overflow-wrap: anywhere;
}
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
