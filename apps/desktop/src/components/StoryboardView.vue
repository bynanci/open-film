<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Composition, MediaAsset, Story } from "@openfilm/core";
import { beatTimelineDuration, durationStatus } from "../duration";
import { formatDuration as duration, formatNumber } from "../i18n";
import { sourceUrl, thumbnailUrl, type SourceStatus } from "../api";
import Icon from "./Icon.vue";

const props = defineProps<{
  story: Story;
  composition?: Composition | null;
  assets: MediaAsset[];
  mediaStatuses?: Record<string, SourceStatus>;
  activeBeatId?: string | null;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  "select-beat": [beatId: string];
  "navigate-timeline": [beatId: string];
  compose: [];
}>();
const { t } = useI18n();
const playingAssetId = ref<string | null>(null);
const playingBeatId = ref<string | null>(null);
const previewFailed = ref(false);
let previewOrigin: HTMLButtonElement | null = null;
const assetMap = computed(
  () => new Map(props.assets.map((asset) => [asset.id, asset])),
);
const mappedComposition = computed(() =>
  props.composition?.storyId === props.story.id ? props.composition : null,
);
const clipsByBeat = computed(() => {
  const groups = new Map<
    string,
    NonNullable<typeof props.composition>["tracks"][number]["clips"]
  >();
  for (const track of mappedComposition.value?.tracks ?? []) {
    for (const clip of track.clips) {
      if (clip.beatId)
        groups.set(clip.beatId, [...(groups.get(clip.beatId) ?? []), clip]);
    }
  }
  return groups;
});
const actualDurations = computed(
  () =>
    new Map(
      props.story.beats.map((beat) => [
        beat.id,
        beatTimelineDuration(mappedComposition.value, beat.id),
      ]),
    ),
);
function getBeatClips(beatId: string) {
  return clipsByBeat.value.get(beatId) ?? [];
}
function getBeatActualDuration(beatId: string) {
  return actualDurations.value.get(beatId) ?? 0;
}
function unavailable(assetId: string) {
  const status = props.mediaStatuses?.[assetId]?.status;
  return status === "missing" || status === "inaccessible";
}
function mediaLabel(assetId: string) {
  const type = assetMap.value.get(assetId)?.mediaType;
  return t(
    type === "image"
      ? "app.library.photos"
      : type === "audio"
        ? "app.library.audio"
        : "app.library.videos",
  );
}
function selectBeat(beatId: string) {
  if (!props.disabled) emit("select-beat", beatId);
}
function handleKeySelect(event: KeyboardEvent, beatId: string) {
  // The card must not consume native button or media-player keyboard actions.
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectBeat(beatId);
  }
}
function toggleAssetPlayback(
  assetId: string,
  beatId: string,
  event: MouseEvent,
) {
  if (props.disabled || unavailable(assetId) || !assetMap.value.has(assetId))
    return;
  if (playingAssetId.value === assetId && playingBeatId.value === beatId) {
    void closePreview();
    return;
  }
  previewOrigin = event.currentTarget as HTMLButtonElement;
  selectBeat(beatId);
  playingBeatId.value = beatId;
  playingAssetId.value = assetId;
  previewFailed.value = false;
}
async function closePreview() {
  playingAssetId.value = null;
  playingBeatId.value = null;
  previewFailed.value = false;
  await nextTick();
  if (previewOrigin?.isConnected) previewOrigin.focus();
}
watch(
  () => [
    props.story.id,
    props.activeBeatId,
    props.story.beats,
    props.mediaStatuses,
  ],
  () => {
    const beat = props.story.beats.find(
      (item) => item.id === playingBeatId.value,
    );
    if (
      props.activeBeatId !== playingBeatId.value ||
      !playingAssetId.value ||
      !beat?.selectedAssetIds?.includes(playingAssetId.value) ||
      unavailable(playingAssetId.value)
    ) {
      playingAssetId.value = null;
      playingBeatId.value = null;
      previewFailed.value = false;
    }
  },
);
</script>

<template>
  <div class="storyboard-view" data-testid="storyboard-view">
    <header class="storyboard-header">
      <div>
        <h2 class="storyboard-title">
          <Icon name="film" :size="18" />{{
            t("app.storyGraph.storyboard.title")
          }}
        </h2>
        <p class="storyboard-hint">
          {{ t("app.storyGraph.storyboard.reviewHint") }}
        </p>
      </div>
      <span class="storyboard-count">{{
        t("app.storyGraph.storyboard.beatCount", {
          count: formatNumber(story.beats.length),
        })
      }}</span>
    </header>
    <div v-if="!story.beats.length" class="empty-state storyboard-empty">
      <span class="empty-symbol"><Icon name="film" :size="30" /></span>
      <h3>{{ t("app.storyGraph.storyboard.empty") }}</h3>
    </div>
    <div
      v-else
      class="storyboard-grid"
      role="list"
      :aria-label="t('app.storyGraph.storyboard.title')"
    >
      <article
        v-for="(beat, index) in story.beats"
        :key="beat.id"
        role="listitem"
        class="storyboard-card"
        :class="{
          active: activeBeatId === beat.id,
          mapped: getBeatClips(beat.id).length > 0,
        }"
        :aria-current="activeBeatId === beat.id ? 'step' : undefined"
        tabindex="0"
        :data-testid="`storyboard-card-${beat.id}`"
        @click="selectBeat(beat.id)"
        @keydown="handleKeySelect($event, beat.id)"
      >
        <header class="card-header">
          <div class="card-number-title">
            <span class="beat-index">{{
              String(index + 1).padStart(2, "0")
            }}</span>
            <h3 class="card-title">{{ beat.title }}</h3>
          </div>
          <span
            v-if="getBeatClips(beat.id).length"
            class="mapping-pill mapped"
            data-testid="mapping-pill-mapped"
            ><Icon name="check" :size="12" />{{
              t("app.storyGraph.storyboard.mappedBadge")
            }}</span
          >
          <span
            v-else
            class="mapping-pill unmapped"
            data-testid="mapping-pill-unmapped"
            >{{ t("app.storyGraph.storyboard.unmappedBadge") }}</span
          >
        </header>
        <div class="card-assets">
          <div class="card-assets-label">
            <Icon name="image" :size="14" /><span>{{
              t("app.story.selected", {
                count: beat.selectedAssetIds?.length ?? 0,
              })
            }}</span>
          </div>
          <div
            v-if="beat.selectedAssetIds?.length"
            class="asset-thumbnails-strip"
          >
            <div
              v-for="assetId in beat.selectedAssetIds"
              :key="assetId"
              class="asset-preview-item"
            >
              <button
                type="button"
                class="thumbnail-wrapper"
                :class="{
                  playing:
                    playingAssetId === assetId && playingBeatId === beat.id,
                }"
                :data-testid="`storyboard-preview-${assetId}`"
                :disabled="
                  disabled || unavailable(assetId) || !assetMap.has(assetId)
                "
                :aria-label="
                  t('app.storyGraph.storyboard.previewMedia', {
                    name: assetMap.get(assetId)?.name ?? assetId,
                  })
                "
                :aria-expanded="
                  playingAssetId === assetId && playingBeatId === beat.id
                "
                :aria-controls="
                  playingAssetId === assetId && playingBeatId === beat.id
                    ? `storyboard-preview-${beat.id}`
                    : undefined
                "
                :title="assetMap.get(assetId)?.name ?? assetId"
                @click.stop="toggleAssetPlayback(assetId, beat.id, $event)"
              >
                <template v-if="assetMap.has(assetId)">
                  <img
                    v-if="assetMap.get(assetId)?.mediaType !== 'audio'"
                    :src="thumbnailUrl(assetId)"
                    alt=""
                    class="asset-thumbnail-img"
                    loading="lazy"
                    crossorigin="anonymous"
                  />
                  <Icon v-else name="volume" :size="26" />
                  <span class="asset-kind">{{ mediaLabel(assetId) }}</span>
                  <span class="asset-play-cue"
                    ><Icon
                      :name="
                        assetMap.get(assetId)?.mediaType === 'image'
                          ? 'eye'
                          : 'play'
                      "
                      :size="16"
                  /></span>
                </template>
                <Icon v-else name="warning" :size="20" />
              </button>
              <span
                class="asset-name"
                :title="assetMap.get(assetId)?.name ?? assetId"
                >{{
                  assetMap.get(assetId)?.name ??
                  t("app.storyGraph.storyboard.detailsUnavailable")
                }}</span
              >
              <span v-if="unavailable(assetId)" class="asset-source-warning"
                ><Icon name="warning" :size="12" />{{
                  t("app.storyGraph.storyboard.sourceUnavailable")
                }}</span
              >
            </div>
          </div>
          <p v-else class="no-assets-hint">
            {{ t("app.storyGraph.storyboard.noSelected")
            }}<span v-if="beat.candidateAssetIds?.length">
              {{
                t("app.storyGraph.storyboard.suggestedCount", {
                  count: formatNumber(beat.candidateAssetIds.length),
                })
              }}</span
            >
          </p>
          <section
            v-if="
              playingBeatId === beat.id &&
              playingAssetId &&
              activeBeatId === beat.id
            "
            :id="`storyboard-preview-${beat.id}`"
            class="storyboard-media-preview"
            data-testid="storyboard-media-preview"
            :aria-label="
              t('app.storyGraph.storyboard.previewMedia', {
                name: assetMap.get(playingAssetId)?.name ?? '',
              })
            "
            @click.stop
            @keydown.esc.stop.prevent="closePreview"
          >
            <div class="preview-heading">
              <strong>{{ assetMap.get(playingAssetId)?.name }}</strong
              ><button
                type="button"
                class="icon-button"
                :aria-label="t('app.storyGraph.storyboard.closePreview')"
                @click.stop="closePreview"
              >
                <Icon name="close" :size="18" />
              </button>
            </div>
            <div v-if="previewFailed" class="preview-error" role="alert">
              <p>{{ t("app.feedback.playbackFailed") }}</p>
              <button
                type="button"
                class="secondary"
                @click="previewFailed = false"
              >
                {{ t("app.storyGraph.storyboard.retryPreview") }}
              </button>
            </div>
            <video
              v-else-if="
                assetMap.get(playingAssetId)?.mediaType === 'video' ||
                assetMap.get(playingAssetId)?.mediaType === '360-video'
              "
              :key="playingAssetId"
              :src="sourceUrl(playingAssetId)"
              controls
              autoplay
              preload="metadata"
              :aria-label="assetMap.get(playingAssetId)?.name"
              @error="previewFailed = true"
            />
            <audio
              v-else-if="assetMap.get(playingAssetId)?.mediaType === 'audio'"
              :key="playingAssetId"
              :src="sourceUrl(playingAssetId)"
              controls
              autoplay
              :aria-label="assetMap.get(playingAssetId)?.name"
              @error="previewFailed = true"
            />
            <img
              v-else
              :key="playingAssetId"
              :src="sourceUrl(playingAssetId)"
              :alt="assetMap.get(playingAssetId)?.name"
              @error="previewFailed = true"
            />
          </section>
        </div>
        <div class="card-body">
          <div v-if="beat.intent" class="card-intent">
            <span class="field-label">{{ t("app.story.intent") }}</span>
            <p>{{ beat.intent }}</p>
          </div>
          <div v-if="beat.script?.narration" class="card-narration">
            <span class="field-label">{{ t("scenePlan.narration") }}</span>
            <p>{{ beat.script.narration }}</p>
          </div>
          <div
            v-if="beat.script?.visualDirection"
            class="card-visual-direction"
          >
            <span class="field-label">{{
              t("scenePlan.visualDirection")
            }}</span>
            <p>{{ beat.script.visualDirection }}</p>
          </div>
        </div>
        <footer class="card-footer">
          <div class="card-timing">
            <span class="timing-target">{{
              t("app.composition.target", {
                duration: duration(beat.targetDuration),
              })
            }}</span
            ><template v-if="getBeatClips(beat.id).length"
              ><span aria-hidden="true">·</span
              ><span class="timing-actual">{{
                t("app.story.actual", {
                  duration: duration(getBeatActualDuration(beat.id)),
                })
              }}</span
              ><span
                class="duration-status"
                :class="
                  durationStatus(
                    getBeatActualDuration(beat.id),
                    beat.targetDuration,
                    beat.maxDuration,
                  )
                "
                >{{
                  t(
                    `app.composition.status.${durationStatus(getBeatActualDuration(beat.id), beat.targetDuration, beat.maxDuration)}`,
                  )
                }}</span
              ></template
            >
          </div>
          <button
            v-if="getBeatClips(beat.id).length"
            type="button"
            class="secondary timeline-link-btn"
            :disabled="disabled"
            @click.stop="emit('navigate-timeline', beat.id)"
          >
            <Icon name="film" :size="14" />{{
              t("app.storyGraph.inspector.goToTimeline")
            }}
          </button>
          <button
            v-else
            type="button"
            class="secondary compose-hint-btn"
            :disabled="disabled"
            @click.stop="emit('compose')"
          >
            <Icon name="arrow" :size="14" />{{ t("app.story.compose") }}
          </button>
        </footer>
      </article>
    </div>
  </div>
</template>

<style scoped>
.storyboard-view {
  width: 100%;
  min-width: 0;
  padding: var(--of-space-5) 0 var(--of-space-8);
  color: var(--of-text-primary);
}
.storyboard-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--of-space-3);
  margin-bottom: var(--of-space-5);
}
.storyboard-title {
  display: flex;
  align-items: center;
  gap: var(--of-space-2);
  margin: 0;
  font-size: var(--of-font-subtitle);
  font-weight: 650;
}
.storyboard-hint,
.storyboard-count {
  margin: var(--of-space-1) 0 0;
  color: var(--of-text-secondary);
  font-size: var(--of-font-small);
}
.storyboard-count {
  white-space: nowrap;
}
.storyboard-grid {
  display: flex;
  flex-direction: column;
  gap: var(--of-space-4);
  max-width: 980px;
  position: relative;
  padding-left: var(--of-space-6);
}
.storyboard-grid::before {
  content: "";
  position: absolute;
  top: var(--of-space-6);
  bottom: var(--of-space-6);
  left: 4px;
  width: 1px;
  background: var(--of-border-subtle);
}
.storyboard-card {
  position: relative;
  min-width: 0;
  padding: var(--of-panel-inset);
  border: 1px solid transparent;
  border-radius: var(--of-radius-lg);
  background: var(--of-surface-1);
  transition: border-color var(--of-motion-fast) var(--of-motion-ease);
}
.storyboard-card::before {
  content: "";
  position: absolute;
  left: -24px;
  top: 25px;
  width: 7px;
  height: 7px;
  border: 1px solid var(--of-border-strong);
  border-radius: 50%;
  background: var(--of-bg);
}
.storyboard-card:hover {
  border-color: var(--of-border-strong);
}
.storyboard-card.active {
  border-color: var(--of-accent);
}
.storyboard-card.active::before {
  border-color: var(--of-accent);
  background: var(--of-accent);
}
.storyboard-card:focus-visible {
  outline: 2px solid var(--of-focus);
  outline-offset: 3px;
}
.card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--of-space-3);
  margin-bottom: var(--of-space-4);
}
.card-number-title {
  display: flex;
  min-width: 0;
  flex: 1 1 220px;
  gap: var(--of-space-3);
  align-items: baseline;
}
.beat-index {
  flex: 0 0 auto;
  color: var(--of-text-muted);
  font-family: var(--of-font-mono);
  font-size: var(--of-font-small);
}
.card-title {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: var(--of-font-base);
  font-weight: 650;
}
.mapping-pill {
  display: inline-flex;
  gap: var(--of-space-1);
  align-items: center;
  padding: 3px var(--of-space-2);
  border-radius: var(--of-radius-round);
  font-size: var(--of-font-caption);
  line-height: 1.4;
}
.mapping-pill.mapped {
  background: var(--of-success-soft);
  color: var(--of-success);
}
.mapping-pill.unmapped {
  background: var(--of-surface-2);
  color: var(--of-text-secondary);
}
.card-assets-label {
  display: flex;
  gap: var(--of-space-1);
  align-items: center;
  margin-bottom: var(--of-space-2);
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
.asset-thumbnails-strip {
  display: flex;
  gap: var(--of-space-3);
  overflow-x: auto;
  padding: var(--of-space-1) var(--of-space-1) var(--of-space-2);
  margin-inline: -4px;
}
.asset-preview-item {
  display: flex;
  flex: 0 0 128px;
  min-width: 0;
  flex-direction: column;
  gap: var(--of-space-1);
}
.thumbnail-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 100%;
  height: 92px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--of-border-strong);
  border-radius: var(--of-radius-md);
  background: var(--of-player);
  color: var(--of-on-media);
  cursor: pointer;
}
.thumbnail-wrapper:hover:not(:disabled),
.thumbnail-wrapper.playing {
  border-color: var(--of-accent);
}
.thumbnail-wrapper:focus-visible {
  outline: 2px solid var(--of-focus);
  outline-offset: 2px;
}
.thumbnail-wrapper:disabled {
  cursor: default;
  opacity: 0.65;
}
.asset-thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.asset-kind {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 2px 5px;
  border-radius: var(--of-radius-sm);
  background: var(--of-media-scrim);
  color: var(--of-on-media);
  font-size: 10px;
  line-height: 1.4;
}
.asset-play-cue {
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--of-media-scrim);
}
.asset-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
.asset-source-warning {
  display: flex;
  align-items: center;
  gap: var(--of-space-1);
  color: var(--of-warning);
  font-size: var(--of-font-caption);
}
.no-assets-hint {
  margin: 0;
  color: var(--of-text-secondary);
  font-size: var(--of-font-small);
}
.storyboard-media-preview {
  margin-top: var(--of-space-3);
  border-radius: var(--of-radius-md);
  overflow: hidden;
  background: var(--of-player);
  color: var(--of-on-media);
}
.preview-heading {
  display: flex;
  gap: var(--of-space-3);
  align-items: center;
  justify-content: space-between;
  padding: var(--of-space-2) var(--of-space-3);
}
.preview-heading strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--of-font-small);
  font-weight: 500;
}
.preview-heading button {
  flex: 0 0 auto;
  min-width: 36px;
  min-height: 36px;
  border-color: transparent;
  color: var(--of-on-media);
  background: transparent;
}
.storyboard-media-preview > img,
.storyboard-media-preview > video {
  display: block;
  width: 100%;
  max-height: 360px;
  object-fit: contain;
}
.storyboard-media-preview > audio {
  display: block;
  width: calc(100% - 24px);
  margin: 0 var(--of-space-3) var(--of-space-3);
}
.preview-error {
  padding: var(--of-space-5);
  color: var(--of-text-primary);
  background: var(--of-surface-2);
}
.card-body {
  display: grid;
  gap: var(--of-space-3);
  margin-top: var(--of-space-4);
}
.card-body:empty {
  display: none;
}
.field-label {
  display: block;
  margin-bottom: 2px;
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
.card-body p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--of-font-base);
  line-height: var(--of-line-body);
}
.card-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--of-space-3);
  margin-top: var(--of-space-4);
  padding-top: var(--of-space-3);
  border-top: 1px solid var(--of-border-subtle);
}
.card-timing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--of-space-2);
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
  font-variant-numeric: tabular-nums;
}
.duration-status {
  color: var(--of-text-secondary);
}
.duration-status.near-maximum {
  color: var(--of-warning);
}
.duration-status.over-maximum {
  color: var(--of-danger);
}
.card-footer button {
  min-height: 36px;
  font-size: var(--of-font-small);
}
@media (max-width: 1100px) {
  .storyboard-card {
    padding: var(--of-space-4);
  }
}
</style>
