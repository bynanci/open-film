<script setup lang="ts">
// OpenFilm Storyboard Perspective View
// Allows visual inspection of story beats in sequence with narration, visual directions,
// referenced media assets, timeline mapping status, and bi-directional timeline navigation.

import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { Composition, MediaAsset, Story } from "@openfilm/core";
import { durationStatus } from "../duration";
import { formatDuration as duration } from "../i18n";
import { sourceUrl, thumbnailUrl, type SourceStatus } from "../api";
import Icon from "./Icon.vue";

const props = defineProps<{
  story: Story;
  composition?: Composition | null;
  assets: MediaAsset[];
  mediaStatuses?: Record<string, SourceStatus>;
  activeBeatId?: string | null;
}>();

const emit = defineEmits<{
  "select-beat": [beatId: string];
  "navigate-timeline": [beatId: string];
  compose: [];
}>();

const { t } = useI18n();

// Track which asset preview is playing within the actively selected beat
// Strictly adheres to: "只有選中的媒體播放，其他卡片使用縮圖"
const playingAssetId = ref<string | null>(null);

const assetMap = computed(() => new Map(props.assets.map((a) => [a.id, a])));

function getBeatClips(beatId: string) {
  if (!props.composition) return [];
  return props.composition.tracks.flatMap((track) =>
    track.clips.filter((clip) => clip.beatId === beatId),
  );
}

function getBeatActualDuration(beatId: string): number {
  const clips = getBeatClips(beatId);
  return clips.reduce((sum, c) => sum + c.timelineDuration, 0);
}

function selectBeat(beatId: string) {
  emit("select-beat", beatId);
  if (playingAssetId.value) {
    // Check if playing asset belongs to newly selected beat
    const beat = props.story.beats.find((b) => b.id === beatId);
    if (!beat || !beat.selectedAssetIds?.includes(playingAssetId.value)) {
      playingAssetId.value = null;
    }
  }
}

function handleKeySelect(e: KeyboardEvent, beatId: string) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    selectBeat(beatId);
  }
}

function toggleAssetPlayback(assetId: string, beatId: string) {
  // Only allow preview playback on the actively selected beat
  if (props.activeBeatId !== beatId) {
    selectBeat(beatId);
  }
  if (playingAssetId.value === assetId) {
    playingAssetId.value = null;
  } else {
    playingAssetId.value = assetId;
  }
}
</script>

<template>
  <div class="storyboard-view" data-testid="storyboard-view">
    <div class="storyboard-header">
      <div class="storyboard-title-group">
        <h2 class="storyboard-title">
          <Icon name="film" :size="18" />
          {{ t("app.storyGraph.storyboard.title") }}
        </h2>
        <span class="storyboard-count">
          {{
            t("app.story.candidates", {
              selected: story.beats.length,
              count: story.beats.length,
            })
          }}
        </span>
      </div>
      <div v-if="composition" class="storyboard-meta">
        <span class="composition-info">
          {{ t("app.composition.active") }}: {{ story.title }}
        </span>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="!story.beats.length" class="empty-state storyboard-empty">
      <span class="empty-symbol"><Icon name="film" :size="30" /></span>
      <h3>{{ t("app.storyGraph.storyboard.empty") }}</h3>
    </div>

    <!-- Storyboard Sequence Grid -->
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
        <!-- Card Header: Number, Title, Mapping Pill -->
        <header class="card-header">
          <div class="card-number-title">
            <span class="beat-index">{{
              String(index + 1).padStart(2, "0")
            }}</span>
            <h3 class="card-title">{{ beat.title }}</h3>
          </div>
          <div class="card-badges">
            <span
              v-if="getBeatClips(beat.id).length > 0"
              class="mapping-pill mapped"
              data-testid="mapping-pill-mapped"
            >
              <Icon name="check" :size="12" />
              {{ t("app.storyGraph.storyboard.mappedBadge") }}
            </span>
            <span
              v-else
              class="mapping-pill unmapped"
              data-testid="mapping-pill-unmapped"
            >
              {{ t("app.storyGraph.storyboard.unmappedBadge") }}
            </span>
          </div>
        </header>

        <!-- Timing Row -->
        <div class="card-timing">
          <span class="timing-target">
            {{
              t("app.composition.target", {
                duration: duration(beat.targetDuration),
              })
            }}
          </span>
          <template v-if="getBeatClips(beat.id).length > 0">
            <span class="timing-separator">·</span>
            <span class="timing-actual">
              {{
                t("app.story.actual", {
                  duration: duration(getBeatActualDuration(beat.id)),
                })
              }}
            </span>
            <span
              class="duration-status-dot"
              :class="
                durationStatus(
                  getBeatActualDuration(beat.id),
                  beat.targetDuration,
                  beat.maxDuration,
                )
              "
              :title="
                t(
                  `app.composition.status.${durationStatus(getBeatActualDuration(beat.id), beat.targetDuration, beat.maxDuration)}`,
                )
              "
            />
          </template>
        </div>

        <!-- Script & Visual Directions -->
        <div class="card-body">
          <div v-if="beat.intent" class="card-intent">
            <span class="field-label">{{ t("app.story.intent") }}:</span>
            <p>{{ beat.intent }}</p>
          </div>
          <div v-if="beat.script?.narration" class="card-narration">
            <span class="field-label">{{ t("scenePlan.narration") }}:</span>
            <p>{{ beat.script.narration }}</p>
          </div>
          <div
            v-if="beat.script?.visualDirection"
            class="card-visual-direction"
          >
            <span class="field-label"
              >{{ t("scenePlan.visualDirection") }}:</span
            >
            <p>{{ beat.script.visualDirection }}</p>
          </div>
        </div>

        <!-- Referenced Media Assets (Thumbnail vs Video Playback) -->
        <div class="card-assets">
          <div class="card-assets-label">
            <Icon name="image" :size="13" />
            <span>{{
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
              class="thumbnail-wrapper"
              :class="{
                playing: playingAssetId === assetId && activeBeatId === beat.id,
              }"
              @click.stop="toggleAssetPlayback(assetId, beat.id)"
            >
              <template v-if="assetMap.get(assetId)">
                <!-- Only active preview element plays for active beat; others strictly static thumbnail -->
                <video
                  v-if="
                    playingAssetId === assetId &&
                    activeBeatId === beat.id &&
                    assetMap.get(assetId)?.mediaType === 'video'
                  "
                  :src="sourceUrl(assetId)"
                  controls
                  autoplay
                  class="asset-preview-video"
                  @click.stop
                />
                <audio
                  v-else-if="
                    playingAssetId === assetId &&
                    activeBeatId === beat.id &&
                    assetMap.get(assetId)?.mediaType === 'audio'
                  "
                  :src="sourceUrl(assetId)"
                  controls
                  autoplay
                  class="asset-preview-audio"
                  @click.stop
                />
                <img
                  v-else
                  :src="thumbnailUrl(assetId)"
                  :alt="assetMap.get(assetId)?.name || ''"
                  class="asset-thumbnail-img"
                  loading="lazy"
                  crossorigin="anonymous"
                />
                <span class="asset-name-overlay">{{
                  assetMap.get(assetId)?.name
                }}</span>
              </template>
              <div v-else class="missing-asset-box">
                <Icon name="warning" :size="14" />
                <span>{{ assetId }}</span>
              </div>
            </div>
          </div>
          <div v-else class="no-assets-hint">
            {{ t("app.story.noCandidates") }}
          </div>
        </div>

        <!-- Card Footer / Actions -->
        <footer class="card-footer">
          <button
            v-if="getBeatClips(beat.id).length > 0"
            type="button"
            class="secondary timeline-link-btn"
            @click.stop="emit('navigate-timeline', beat.id)"
          >
            <Icon name="film" :size="14" />
            {{ t("app.storyGraph.inspector.goToTimeline") }}
          </button>
          <button
            v-else
            type="button"
            class="secondary compose-hint-btn"
            @click.stop="emit('compose')"
          >
            <Icon name="arrow" :size="14" />
            {{ t("app.story.compose") }}
          </button>
        </footer>
      </article>
    </div>
  </div>
</template>

<style scoped>
.storyboard-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 480px;
  background: var(--color-surface, #14171a);
  color: var(--color-text, #f0f2f5);
  box-sizing: border-box;
  padding: 1rem 1.5rem 2rem;
  overflow-y: auto;
}

.storyboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border, #2a2e33);
}

.storyboard-title-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.storyboard-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.storyboard-count {
  font-size: 0.85rem;
  color: var(--color-text-muted, #8a939e);
}

.storyboard-meta {
  font-size: 0.85rem;
  color: var(--color-text-muted, #8a939e);
}

.storyboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.25rem;
}

.storyboard-card {
  display: flex;
  flex-direction: column;
  background: var(--color-panel, #1d2126);
  border: 1px solid var(--color-border, #2e333a);
  border-radius: 8px;
  padding: 1rem;
  cursor: pointer;
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.storyboard-card:hover {
  border-color: var(--color-primary-light, #589cf8);
}

.storyboard-card:focus-visible {
  border-color: var(--color-primary, #3b82f6);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.4);
}

.storyboard-card.active {
  border-color: var(--color-primary, #3b82f6);
  background: var(--color-panel-active, #22272e);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.card-number-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.beat-index {
  font-family: monospace;
  font-size: 0.85rem;
  font-weight: bold;
  background: var(--color-surface, #14171a);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  color: var(--color-primary-light, #70aaff);
}

.card-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text, #f0f2f5);
}

.card-badges {
  flex-shrink: 0;
}

.mapping-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 10px;
}

.mapping-pill.mapped {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.mapping-pill.unmapped {
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.3);
}

.card-timing {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--color-text-muted, #8a939e);
  margin-bottom: 0.75rem;
}

.timing-separator {
  opacity: 0.5;
}

.duration-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.duration-status-dot.good,
.duration-status-dot.exact {
  background: #22c55e;
}

.duration-status-dot.short {
  background: #eab308;
}

.duration-status-dot.long {
  background: #ef4444;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
  flex: 1;
}

.field-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-muted, #8a939e);
  display: block;
  margin-bottom: 0.15rem;
}

.card-intent p,
.card-narration p,
.card-visual-direction p {
  margin: 0;
  line-height: 1.4;
  color: var(--color-text-subtle, #c9d1d9);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-assets {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--color-border-subtle, #23272d);
}

.card-assets-label {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--color-text-muted, #8a939e);
  margin-bottom: 0.4rem;
}

.asset-thumbnails-strip {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
}

.thumbnail-wrapper {
  position: relative;
  width: 72px;
  height: 52px;
  border-radius: 4px;
  overflow: hidden;
  background: #111;
  flex-shrink: 0;
  border: 1px solid var(--color-border, #333);
}

.thumbnail-wrapper.playing {
  border-color: var(--color-primary, #3b82f6);
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.5);
}

.asset-thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.asset-preview-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-preview-audio {
  width: 100%;
  height: 100%;
}

.asset-name-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  font-size: 0.65rem;
  background: rgba(0, 0, 0, 0.7);
  padding: 1px 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.missing-asset-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #ef4444;
  font-size: 0.65rem;
  padding: 2px;
  text-align: center;
}

.no-assets-hint {
  font-size: 0.75rem;
  color: var(--color-text-muted, #6e7681);
  font-style: italic;
}

.card-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--color-border-subtle, #23272d);
}

.timeline-link-btn,
.compose-hint-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
}

.empty-state.storyboard-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  color: var(--color-text-muted, #8a939e);
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .storyboard-card {
    transition: none;
  }
}

@media (max-width: 1024px) {
  .storyboard-grid {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
}
</style>
