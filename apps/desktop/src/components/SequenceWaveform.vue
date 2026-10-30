<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  formatSequenceTimecode,
  projectClipWaveform,
  resolveClipAudioRange,
  sequenceFrameAt,
  sequenceTimeAt,
  timebaseKey,
  timebaseRate,
  type Composition,
  type MediaAsset,
  type ProjectTimebaseV1,
} from "@openfilm/core";
import { api, type SourceStatus } from "../api";
import { SequenceWaveformCache } from "../sequenceWaveformCache";
import {
  SequenceWaveformPreparation,
  waitForWaveformJob,
} from "../sequenceWaveformPreparation";

const props = defineProps<{
  projectId: string;
  /** Latest acknowledged Composition; this component never owns edit state. */
  composition: Composition;
  assets: readonly MediaAsset[];
  revision: string;
  timebase: ProjectTimebaseV1;
  frame: number;
  maxFrame: number;
  sourceVersion?: number;
  sourceStatuses?: Record<string, SourceStatus>;
  active: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ seek: [frame: number]; activity: [] }>();
const { t } = useI18n();
const headingId = `sequence-waveform-${useId().replaceAll(":", "")}`;
const cacheVersion = ref(0);
const preparationVersion = ref(0);
const cache = new SequenceWaveformCache(
  api.sourceWaveforms,
  () => cacheVersion.value++,
);
const preparation = new SequenceWaveformPreparation({
  jobs: async (signal) => (await api.jobs(signal)).jobs,
  start: async (assetId, projectId) =>
    (
      await api.analyzeIntelligence(assetId, {
        operation: "waveform",
        projectId,
      })
    ).job,
  refresh: async (assetId) => {
    await cache.load([assetId], { refresh: true });
    return cache.get(assetId)?.status === "ready";
  },
  wait: waitForWaveformJob,
  changed: () => preparationVersion.value++,
});
const preparationState = computed(() => {
  void preparationVersion.value;
  return preparation.state;
});
const preparing = computed(() => preparationState.value.status === "running");
const sourceIdentity = computed(() =>
  JSON.stringify(
    props.assets.map((asset) => [
      asset.id,
      asset.uri,
      asset.contentHash,
      props.sourceStatuses?.[asset.id]?.status ?? "available",
    ]),
  ),
);
// Reference identity also fences a Composition replacement with equal ID/revision.
const owner = computed(() => ({
  projectId: props.projectId,
  composition: props.composition,
  assets: props.assets,
  revision: props.revision,
  sourceVersion: props.sourceVersion ?? 0,
  timebase: timebaseKey(props.timebase),
  sourceIdentity: sourceIdentity.value,
  active: props.active,
}));
let contextGeneration = 0;
let disposed = false;
const windowStart = ref(0);
const fitting = ref(false);
const sourcePage = ref(0);
const lastFrame = computed(() =>
  Math.max(
    0,
    Math.min(
      props.maxFrame,
      sequenceFrameAt(props.composition.duration, props.timebase, "floor") - 1,
    ),
  ),
);
const windowFrames = computed(() =>
  Math.max(1, Math.ceil(30 * timebaseRate(props.timebase))),
);
const viewport = computed(() => {
  const end = lastFrame.value + 1;
  const start = fitting.value
    ? 0
    : Math.min(windowStart.value, Math.max(0, end - 1));
  return {
    start,
    end: fitting.value ? end : Math.min(end, start + windowFrames.value),
  };
});
const assetsById = computed(
  () => new Map(props.assets.map((asset) => [asset.id, asset])),
);
function hasAudio(asset: MediaAsset) {
  if (asset.mediaType === "audio") return true;
  if (asset.mediaType !== "video" && asset.mediaType !== "360-video")
    return false;
  const probe = asset.metadata["openfilm.ffprobe"] as
    { streams?: { codec_type?: string }[] } | undefined;
  return (
    Array.isArray(probe?.streams) &&
    probe.streams.some((stream) => stream.codec_type === "audio")
  );
}
const visibleTracks = computed(() => {
  const start = sequenceTimeAt(viewport.value.start, props.timebase);
  const end = sequenceTimeAt(viewport.value.end, props.timebase);
  return props.composition.tracks.flatMap((track, trackIndex) => {
    if (!["video", "audio", "music"].includes(track.type)) return [];
    const clips = track.clips.flatMap((clip) => {
      const asset = assetsById.value.get(clip.assetId);
      if (!asset || !hasAudio(asset)) return [];
      try {
        const audio = resolveClipAudioRange(clip, asset);
        return audio.audioStart < end && audio.audioEnd > start
          ? [{ clip, asset, audio }]
          : [];
      } catch {
        return [];
      }
    });
    return clips.length ? [{ track, trackIndex, clips }] : [];
  });
});
const visibleSourceIds = computed(() => [
  ...new Set(
    visibleTracks.value.flatMap((track) =>
      track.clips.map(({ asset }) => asset.id),
    ),
  ),
]);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(visibleSourceIds.value.length / 8)),
);
const page = computed(() => Math.min(sourcePage.value, pageCount.value - 1));
const pageSourceIds = computed(() =>
  visibleSourceIds.value.slice(page.value * 8, page.value * 8 + 8),
);
const pageSources = computed(() => {
  void cacheVersion.value;
  return pageSourceIds.value.map((id) => {
    const asset = assetsById.value.get(id)!;
    const status = props.sourceStatuses?.[id]?.status;
    const entry = cache.get(id);
    return {
      asset,
      status:
        status && status !== "available"
          ? "unavailable"
          : (entry?.status ?? "loading"),
      clipLocked: visibleTracks.value.some((track) =>
        track.clips.some(({ clip }) => clip.assetId === id && clip.locked),
      ),
    };
  });
});
const missingIds = computed(() =>
  pageSources.value
    .filter((source) => source.status === "not-cached")
    .map(({ asset }) => asset.id),
);
const loading = computed(() =>
  pageSources.value.some((source) => source.status === "loading"),
);

watch(
  owner,
  (value) => {
    const key = `${++contextGeneration}`;
    preparation.setContext(key, value.projectId);
    cache.setContext({
      key,
      projectId: value.projectId,
      sources: value.assets.map(({ id, contentHash }) => ({ id, contentHash })),
    });
    windowStart.value = 0;
    fitting.value = false;
    sourcePage.value = 0;
  },
  { immediate: true, flush: "sync" },
);
watch(
  [owner, pageSourceIds],
  () => {
    if (!disposed && props.active) void cache.load(pageSourceIds.value);
  },
  { immediate: true, flush: "sync" },
);
watch(
  [viewport, page],
  () => {
    if (preparing.value) preparation.stop();
  },
  { flush: "sync" },
);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && preparing.value) preparation.stop();
  },
  { flush: "sync" },
);

// Geometry depends on acknowledged clips, evidence and the explicit viewport.
// Record frame ticks update only the slider and playhead below.
const columns = 600;
const tracks = computed(() => {
  void cacheVersion.value;
  const sourceIds = new Set(pageSourceIds.value);
  const view = viewport.value;
  const start = sequenceTimeAt(view.start, props.timebase);
  const duration = sequenceTimeAt(view.end, props.timebase) - start;
  return visibleTracks.value.flatMap(({ track, trackIndex, clips }) => {
    const shown = clips
      .filter(({ asset }) => sourceIds.has(asset.id))
      .map(({ clip, asset, audio }) => {
        const entry = cache.get(asset.id);
        const sourceStatus = props.sourceStatuses?.[asset.id]?.status;
        let status =
          sourceStatus && sourceStatus !== "available"
            ? "unavailable"
            : (entry?.status ?? "loading");
        let path = "";
        if (status === "ready" && entry?.status === "ready") {
          try {
            const projection = projectClipWaveform({
              clip,
              asset,
              waveform: entry.waveform,
              sourceHash: entry.sourceHash,
              timebase: props.timebase,
              viewStartFrame: view.start,
              viewEndFrame: view.end,
              columns,
            });
            path = projection.peaks
              .map((peak, column) =>
                projection.covered[column] && peak > 0
                  ? `M${column + 0.5},${50 - peak * 43}v${peak * 86}`
                  : "",
              )
              .join("");
          } catch {
            status = "failed";
          }
        }
        const x = Math.max(
          0,
          ((audio.audioStart - start) / duration) * columns,
        );
        const end = Math.min(
          columns,
          ((audio.audioEnd - start) / duration) * columns,
        );
        return {
          clip,
          asset,
          path,
          status,
          x,
          width: Math.max(0, end - x),
          muted: clip.transform?.volume === 0,
        };
      });
    return shown.length
      ? [{ id: track.id, type: track.type, trackIndex, clips: shown }]
      : [];
  });
});
const frameLabel = computed(() =>
  formatSequenceTimecode(props.frame, props.timebase),
);
const rangeLabel = computed(() =>
  t("cutDesk.waveform.windowRange", {
    start: formatSequenceTimecode(viewport.value.start, props.timebase),
    end: formatSequenceTimecode(viewport.value.end, props.timebase),
  }),
);
const playhead = computed(() =>
  props.frame >= viewport.value.start && props.frame < viewport.value.end
    ? ((props.frame - viewport.value.start) /
        (viewport.value.end - viewport.value.start)) *
      100
    : undefined,
);
const sliderFrame = computed(() =>
  Math.max(viewport.value.start, Math.min(viewport.value.end - 1, props.frame)),
);
const sourceRange = computed(() =>
  t("cutDesk.waveform.sourceRange", {
    start: page.value * 8 + 1,
    end: Math.min((page.value + 1) * 8, visibleSourceIds.value.length),
    total: visibleSourceIds.value.length,
  }),
);
const controls = computed(() => {
  const stamp = owner.value;
  const view = viewport.value;
  const source = page.value;
  const current = () =>
    !disposed &&
    owner.value === stamp &&
    viewport.value === view &&
    page.value === source &&
    props.active &&
    !props.disabled;
  const seek = (frame: number) => {
    if (
      current() &&
      Number.isSafeInteger(frame) &&
      frame >= view.start &&
      frame < view.end &&
      frame <= lastFrame.value
    )
      emit("seek", frame);
  };
  return {
    input: (event: Event) => {
      if (!(event as InputEvent).isComposing)
        seek(Number((event.target as HTMLInputElement).value));
    },
    pointer: (event: PointerEvent) => {
      if (!current() || event.button !== 0 || event.isPrimary === false) return;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      if (rect.width <= 0) return;
      seek(
        Math.max(
          view.start,
          Math.min(
            view.end - 1,
            view.start +
              Math.floor(
                ((event.clientX - rect.left) / rect.width) *
                  (view.end - view.start),
              ),
          ),
        ),
      );
    },
    previous: () => {
      if (current()) {
        fitting.value = false;
        windowStart.value = Math.max(0, view.start - windowFrames.value);
        sourcePage.value = 0;
      }
    },
    next: () => {
      if (current()) {
        fitting.value = false;
        windowStart.value = Math.min(lastFrame.value, view.end);
        sourcePage.value = 0;
      }
    },
    fit: () => {
      if (current()) {
        fitting.value = true;
        sourcePage.value = 0;
      }
    },
    window: () => {
      if (current()) {
        windowStart.value =
          Math.floor(props.frame / windowFrames.value) * windowFrames.value;
        fitting.value = false;
        sourcePage.value = 0;
      }
    },
    previousSources: () => {
      if (current()) sourcePage.value = Math.max(0, source - 1);
    },
    nextSources: () => {
      if (current())
        sourcePage.value = Math.min(pageCount.value - 1, source + 1);
    },
    refresh: () => {
      if (current() && !preparing.value)
        void cache.load(pageSourceIds.value, { refresh: true });
    },
    prepare: () => {
      if (current() && !preparing.value && !loading.value)
        void preparation.prepare(missingIds.value);
    },
    stop: () => {
      if (current()) preparation.stop();
    },
  };
});
watch(preparationState, (value, before) => {
  if (
    value.status === "completed" ||
    (value.status === "running" && before.status !== "running")
  )
    emit("activity");
});
onBeforeUnmount(() => {
  disposed = true;
  preparation.dispose();
  cache.dispose();
});
</script>
<template>
  <section
    class="sequence-waveform"
    data-testid="sequence-waveform"
    :aria-labelledby="headingId"
    :data-view-start="viewport.start"
    :data-view-end="viewport.end"
  >
    <header class="sequence-waveform-header">
      <h3 :id="headingId">{{ t("cutDesk.waveform.title") }}</h3>
      <span class="sequence-waveform-time">{{ rangeLabel }}</span>
    </header>
    <p class="sequence-waveform-hint">{{ t("cutDesk.waveform.rawPeaks") }}</p>
    <div
      class="sequence-waveform-controls"
      role="group"
      :aria-label="t('cutDesk.waveform.viewport')"
    >
      <button
        type="button"
        class="editor-button"
        :aria-label="t('cutDesk.waveform.previous')"
        :disabled="disabled || viewport.start === 0"
        v-bind="{ onClick: controls.previous }"
      >
        {{ t("cutDesk.waveform.previous") }}
      </button>
      <button
        type="button"
        class="editor-button"
        :aria-label="t('cutDesk.waveform.next')"
        :disabled="disabled || viewport.end > lastFrame"
        v-bind="{ onClick: controls.next }"
      >
        {{ t("cutDesk.waveform.next") }}
      </button>
      <button
        type="button"
        class="editor-button"
        :aria-label="t('cutDesk.waveform.fit')"
        :aria-pressed="fitting"
        :disabled="disabled"
        v-bind="{ onClick: controls.fit }"
      >
        {{ t("cutDesk.waveform.fit") }}
      </button>
      <button
        v-if="fitting"
        type="button"
        class="editor-button"
        :aria-label="t('cutDesk.waveform.window')"
        :disabled="disabled"
        v-bind="{ onClick: controls.window }"
      >
        {{ t("cutDesk.waveform.window") }}
      </button>
    </div>
    <div v-if="tracks.length" class="sequence-waveform-tracks">
      <div
        v-for="track in tracks"
        :key="track.id"
        class="sequence-waveform-track"
        :data-track-id="track.id"
      >
        <span class="sequence-waveform-track-label"
          >{{ t(`cutDesk.waveform.${track.type}`) }}
          {{ track.trackIndex + 1 }}</span
        >
        <div
          class="sequence-waveform-graph"
          v-bind="{ onPointerdown: controls.pointer }"
        >
          <svg
            :viewBox="`0 0 ${columns} 100`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <template v-for="item in track.clips" :key="item.clip.id">
              <rect
                v-if="item.status !== 'ready'"
                :x="item.x"
                y="8"
                :width="item.width"
                height="84"
                class="sequence-waveform-absent"
                :data-clip-id="item.clip.id"
                :data-source-status="item.status"
              />
              <path
                v-else
                :d="item.path"
                :data-clip-id="item.clip.id"
                :data-asset-id="item.asset.id"
                :data-muted="item.muted"
                :class="{ 'sequence-waveform-muted': item.muted }"
              />
            </template>
          </svg>
          <span
            v-if="playhead !== undefined"
            class="sequence-waveform-playhead"
            :style="{ left: `${playhead}%` }"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
    <p v-else class="sequence-waveform-hint">
      {{ t("cutDesk.waveform.noAudio") }}
    </p>
    <label class="sequence-waveform-seek">
      <span
        >{{ t("cutDesk.waveform.seek") }}
        <span class="sequence-waveform-time">{{ frameLabel }}</span></span
      >
      <input
        type="range"
        :aria-label="t('cutDesk.waveform.seek')"
        :min="viewport.start"
        :max="viewport.end - 1"
        :value="sliderFrame"
        step="1"
        :aria-valuetext="frameLabel"
        :disabled="disabled || !active"
        v-bind="{ onInput: controls.input }"
      />
    </label>
    <p v-if="playhead === undefined" class="sequence-waveform-hint">
      {{ t("cutDesk.waveform.outsideWindow") }}
    </p>
    <div v-if="pageSources.length" class="sequence-waveform-sources">
      <div
        v-if="pageCount > 1"
        class="sequence-waveform-controls"
        role="group"
        :aria-label="t('cutDesk.waveform.sources')"
      >
        <span>{{ sourceRange }}</span>
        <button
          type="button"
          class="editor-button"
          :aria-label="t('cutDesk.waveform.previousSources')"
          :disabled="disabled || page === 0"
          v-bind="{ onClick: controls.previousSources }"
        >
          {{ t("cutDesk.waveform.previousSources") }}
        </button>
        <button
          type="button"
          class="editor-button"
          :aria-label="t('cutDesk.waveform.nextSources')"
          :disabled="disabled || page >= pageCount - 1"
          v-bind="{ onClick: controls.nextSources }"
        >
          {{ t("cutDesk.waveform.nextSources") }}
        </button>
      </div>
      <ul>
        <li
          v-for="source in pageSources"
          :key="source.asset.id"
          :data-asset-id="source.asset.id"
          :data-source-status="source.status"
        >
          <span
            class="sequence-waveform-source-name"
            :title="source.asset.name"
            >{{ source.asset.name }}</span
          >
          <span>{{ t(`cutDesk.waveform.status.${source.status}`) }}</span>
          <span v-if="source.asset.state.locked || source.clipLocked">{{
            t("cutDesk.waveform.protected")
          }}</span>
        </li>
      </ul>
      <div class="sequence-waveform-controls">
        <button
          type="button"
          class="editor-button"
          :aria-label="t('cutDesk.waveform.prepare')"
          :disabled="disabled || preparing || loading || !missingIds.length"
          v-bind="{ onClick: controls.prepare }"
        >
          {{ t("cutDesk.waveform.prepare") }}
        </button>
        <button
          v-if="preparing"
          type="button"
          class="editor-button"
          :aria-label="t('cutDesk.waveform.stop')"
          :disabled="disabled"
          v-bind="{ onClick: controls.stop }"
        >
          {{ t("cutDesk.waveform.stop") }}
        </button>
        <button
          type="button"
          class="editor-button"
          :aria-label="t('cutDesk.waveform.refresh')"
          :disabled="disabled || preparing || loading"
          v-bind="{ onClick: controls.refresh }"
        >
          {{ t("cutDesk.waveform.refresh") }}
        </button>
      </div>
      <p v-if="preparing" class="sequence-waveform-hint" role="status">
        {{
          t("cutDesk.waveform.preparing", {
            name: assetsById.get(preparationState.assetId ?? "")?.name ?? "",
            count: preparationState.remaining,
          })
        }}
      </p>
      <p
        v-else-if="preparationState.status === 'failed'"
        class="sequence-waveform-error"
        role="status"
      >
        {{ t(`cutDesk.waveform.errors.${preparationState.code}`) }}
      </p>
      <p
        v-else-if="
          preparationState.status === 'stopped' ||
          preparationState.status === 'completed'
        "
        class="sequence-waveform-hint"
        role="status"
      >
        {{ t(`cutDesk.waveform.${preparationState.status}`) }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.sequence-waveform {
  flex: 0 1 14rem;
  min-width: 0;
  min-height: 8rem;
  max-height: min(36vh, 22rem);
  overflow-y: auto;
  border-top: 1px solid var(--editor-border);
  padding: var(--of-space-3) var(--of-space-4);
  background: var(--editor-inset);
  font-size: var(--of-font-caption);
}
.sequence-waveform-header,
.sequence-waveform-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--of-space-2);
}
.sequence-waveform-header {
  justify-content: space-between;
}
.sequence-waveform h3 {
  margin: 0;
  font-size: var(--of-font-small);
  font-weight: 600;
}
.sequence-waveform-hint {
  margin: var(--of-space-1) 0 var(--of-space-2);
  color: var(--editor-muted);
  overflow-wrap: anywhere;
}
.sequence-waveform-time {
  font-family: var(--of-font-mono);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.sequence-waveform-controls .editor-button {
  min-height: 36px;
  white-space: normal;
}
.sequence-waveform-tracks {
  display: grid;
  gap: var(--of-space-1);
  margin-block: var(--of-space-2);
}
.sequence-waveform-track {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr);
  align-items: center;
  gap: var(--of-space-2);
}
.sequence-waveform-track-label {
  color: var(--editor-muted);
  overflow-wrap: anywhere;
}
.sequence-waveform-graph {
  position: relative;
  height: 38px;
  background: var(--editor-panel);
  cursor: crosshair;
}
.sequence-waveform-graph svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.sequence-waveform-graph path {
  fill: none;
  stroke: var(--of-text-secondary);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.sequence-waveform-graph path.sequence-waveform-muted {
  opacity: 0.45;
}
.sequence-waveform-absent {
  fill: none;
  stroke: var(--of-border-strong);
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
}
.sequence-waveform-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--editor-accent);
  pointer-events: none;
}
.sequence-waveform-seek {
  display: grid;
  gap: 0;
}
.sequence-waveform-seek > span {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--of-space-2);
}
.sequence-waveform-seek input {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  margin: 0;
  padding: 0;
  accent-color: var(--editor-accent);
}
.sequence-waveform button:focus-visible,
.sequence-waveform input:focus-visible {
  outline: 2px solid var(--of-focus);
  outline-offset: 2px;
}
.sequence-waveform-sources ul {
  display: grid;
  gap: var(--of-space-1);
  margin: 0 0 var(--of-space-2);
  padding: 0;
  list-style: none;
}
.sequence-waveform-sources li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-1) var(--of-space-2);
  color: var(--editor-muted);
}
.sequence-waveform-source-name {
  min-width: 0;
  max-width: 22rem;
  color: var(--of-text-secondary);
  overflow-wrap: anywhere;
}
.sequence-waveform-error {
  color: var(--of-danger);
  overflow-wrap: anywhere;
}
@media (pointer: coarse) {
  .sequence-waveform-controls .editor-button {
    min-width: 44px;
    min-height: 44px;
  }
  .sequence-waveform-graph {
    min-height: 44px;
  }
}
@media (max-width: 600px) {
  .sequence-waveform {
    padding-inline: var(--of-space-3);
  }
  .sequence-waveform-track {
    grid-template-columns: 3.5rem minmax(0, 1fr);
    gap: var(--of-space-1);
  }
}
</style>
