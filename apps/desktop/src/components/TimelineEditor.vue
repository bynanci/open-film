<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { Clip, StoryBeat } from "@openfilm/core";
import {
  prepareShorteningPlan,
  shorteningCommands,
  type PreparedShorteningPlan,
  type ShorteningSuggestionPreview,
  type TimelineCommand,
} from "@openfilm/solver";
import {
  duration,
  sourceUrl,
  thumbnailUrl,
  type EditorState,
  type SourceStatus,
} from "../api";
import { useTimelineEditor } from "../composables/useTimelineEditor";
import Icon from "./Icon.vue";
import SourceDetails from "./SourceDetails.vue";
import { sourcePresentation } from "../sourcePresentation";

const props = defineProps<{
  projectId: string;
  compositionId: string;
  active: boolean;
  sourceStatuses?: Record<string, SourceStatus>;
  sourceVersion?: number;
}>();
const emit = defineEmits<{
  change: [state: EditorState];
  edited: [];
  playback: [];
  relink: [assetId: string];
}>();
const {
  state,
  status,
  message,
  hasPending,
  historyBusy,
  command,
  flush,
  history,
  reapplyDraft,
  discardDraft,
  downloadDraft,
  load,
} = useTimelineEditor(
  props.projectId,
  props.compositionId,
  (value) => emit("change", value),
  () => emit("edited"),
);
defineExpose({ flush, hasPending, reload: load });
const selectedClipId = ref("");
const selectedBeatId = ref("");
const inspector = ref<"clip" | "beat">("clip");
const showFit = ref(false);
const draggedClipId = ref("");
const replacementId = ref("");
const sourcePlayer = ref<HTMLVideoElement | null>(null);
const sourceError = ref("");
const unsupportedSpeedMessage =
  "This speed cannot be previewed in the browser. Render a preview to watch the edit.";
const playing = ref(false);
const clipFields = ref({
  sourceIn: 0,
  sourceOut: 0,
  duration: 0,
  speed: 1,
  volume: 1,
  scale: 1,
  rotation: 0,
  x: 0,
  y: 0,
  transitionDuration: 0.3,
});
const beatFields = ref({
  title: "",
  intent: "",
  targetDuration: 0,
  minDuration: 0,
  maxDuration: 0,
});
const allClips = computed(
  () => state.value?.composition.tracks.flatMap((track) => track.clips) ?? [],
);
const selectedClip = computed(() =>
  allClips.value.find((clip) => clip.id === selectedClipId.value),
);
const assetMap = computed(
  () => new Map(state.value?.assets.map((asset) => [asset.id, asset]) ?? []),
);
const selectedAsset = computed(
  () => selectedClip.value && assetMap.value.get(selectedClip.value.assetId),
);
const selectedSourceInfo = computed(() =>
  selectedAsset.value ? sourcePresentation(selectedAsset.value) : undefined,
);
const selectedSourceStatus = computed(() =>
  selectedAsset.value
    ? props.sourceStatuses?.[selectedAsset.value.id]
    : undefined,
);
const sourceUnavailable = computed(
  () =>
    selectedSourceStatus.value &&
    selectedSourceStatus.value.status !== "available",
);
const sourcePlaybackKey = computed(
  () =>
    `${selectedAsset.value?.id}:${selectedAsset.value?.uri}:${props.sourceVersion ?? 0}`,
);
const selectedBeat = computed(() =>
  state.value?.story.beats.find((beat) => beat.id === selectedBeatId.value),
);
const groups = computed(() => {
  const beats = state.value?.story.beats ?? [];
  const list = beats.map((beat) => ({
    id: beat.id,
    title: beat.title,
    intent: beat.intent,
    clips: allClips.value.filter((clip) => clip.beatId === beat.id),
  }));
  const loose = allClips.value.filter(
    (clip) => !beats.some((beat) => beat.id === clip.beatId),
  );
  if (loose.length)
    list.push({
      id: "unassigned",
      title: "Other moments",
      intent: undefined,
      clips: loose,
    });
  return list;
});
const peers = computed(() => {
  const clip = selectedClip.value;
  if (!clip) return [];
  return (
    state.value?.composition.tracks
      .find((track) => track.clips.some((item) => item.id === clip.id))
      ?.clips.filter((item) => item.beatId === clip.beatId) ?? []
  );
});
const selectedIndex = computed(() =>
  peers.value.findIndex((clip) => clip.id === selectedClipId.value),
);
const target = computed(
  () =>
    state.value?.story.targetDuration ?? state.value?.composition.duration ?? 0,
);
const maximum = computed(() => state.value?.story.maxDuration ?? target.value);
const overLimit = computed(
  () =>
    !!state.value && state.value.composition.duration > maximum.value + 0.001,
);
const fitPlan = computed(() => {
  if (!state.value || !showFit.value || target.value <= 0) return null;
  try {
    return prepareShorteningPlan(state.value, state.value.assets, target.value);
  } catch {
    return null;
  }
});
const fitSuggestions = computed(() => fitPlan.value?.suggestions ?? []);
function applyFit(
  preview: PreparedShorteningPlan | ShorteningSuggestionPreview | null,
) {
  if (!state.value || !preview) return;
  try {
    command(
      shorteningCommands(
        state.value,
        state.value.assets,
        target.value,
        preview,
      ),
    );
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  }
}
const replacements = computed(
  () =>
    state.value?.assets.filter(
      (asset) =>
        !asset.state.rejected &&
        asset.id !== selectedAsset.value?.id &&
        (selectedAsset.value?.mediaType === "audio"
          ? asset.mediaType === "audio"
          : asset.mediaType !== "audio"),
    ) ?? [],
);
const saveLabel = computed(
  () =>
    ({
      loading: "Opening cut…",
      saved: "Saved",
      saving: "Saving…",
      failed: "Save failed",
      conflict: "Save conflict",
    })[status.value],
);
const regenerateModes = [
  { mode: "regenerate", label: "Regenerate beat" },
  { mode: "shorten", label: "Make shorter" },
  { mode: "more-video", label: "More video" },
  { mode: "more-photos", label: "More photos" },
  { mode: "replace-similar", label: "Replace similar shots" },
  { mode: "remove-repetition", label: "Remove repetition" },
] as const;

function name(clip: Clip) {
  return assetMap.value.get(clip.assetId)?.name ?? clip.title ?? "Media";
}
function beatDuration(clips: Clip[]) {
  return clips.length
    ? Math.max(
        ...clips.map((clip) => clip.timelineStart + clip.timelineDuration),
      ) - Math.min(...clips.map((clip) => clip.timelineStart))
    : 0;
}
function chooseClip(clip: Clip) {
  selectedClipId.value = clip.id;
  selectedBeatId.value = clip.beatId ?? "";
  inspector.value = "clip";
}
function chooseBeat(beatId: string) {
  selectedBeatId.value = beatId;
  inspector.value = "beat";
}
function editClip(
  input:
    | Omit<Extract<TimelineCommand, { type: "trim" }>, "clipId">
    | Omit<Extract<TimelineCommand, { type: "duration" }>, "clipId">
    | Omit<Extract<TimelineCommand, { type: "speed" }>, "clipId">
    | Omit<Extract<TimelineCommand, { type: "volume" }>, "clipId">
    | Omit<Extract<TimelineCommand, { type: "transform" }>, "clipId">
    | Omit<Extract<TimelineCommand, { type: "transition" }>, "clipId">,
) {
  if (selectedClip.value)
    command({ ...input, clipId: selectedClip.value.id } as TimelineCommand);
}
function trim() {
  editClip({
    type: "trim",
    sourceIn: Number(clipFields.value.sourceIn),
    sourceOut: Number(clipFields.value.sourceOut),
  });
}
function transform() {
  const { scale, rotation, x, y } = clipFields.value;
  editClip({ type: "transform", scale, rotation, x, y });
}
function transition(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  editClip({
    type: "transition",
    transition: value === "crossfade" ? "crossfade" : "cut",
    duration: clipFields.value.transitionDuration,
  });
}
function move(direction: number) {
  if (selectedClip.value)
    command({
      type: "reorder",
      clipId: selectedClip.value.id,
      toIndex: selectedIndex.value + direction,
    });
}
function drop(targetClip: Clip) {
  const dragged = allClips.value.find(
    (clip) => clip.id === draggedClipId.value,
  );
  const track = state.value?.composition.tracks.find((item) =>
    item.clips.some((clip) => clip.id === targetClip.id),
  );
  if (
    dragged &&
    dragged.beatId === targetClip.beatId &&
    track?.clips.some((clip) => clip.id === dragged.id)
  ) {
    command({
      type: "reorder",
      clipId: dragged.id,
      toIndex: track.clips
        .filter((clip) => clip.beatId === targetClip.beatId)
        .findIndex((clip) => clip.id === targetClip.id),
    });
  } else message.value = "Move a clip within its story beat and track.";
  draggedClipId.value = "";
}
function deleteSelected() {
  if (selectedClip.value)
    command({ type: "delete", clipId: selectedClip.value.id });
}
function editBeat() {
  if (!selectedBeat.value) return;
  const fields = beatFields.value;
  command({
    type: "beat",
    beatId: selectedBeat.value.id,
    patch: {
      title: fields.title,
      intent: fields.intent,
      targetDuration: Number(fields.targetDuration),
      minDuration: Number(fields.minDuration),
      maxDuration: Number(fields.maxDuration),
    },
  });
}
function replace() {
  if (selectedClip.value && replacementId.value)
    command({
      type: "replace",
      clipId: selectedClip.value.id,
      assetId: replacementId.value,
    });
}
function configurePlayer() {
  const player = sourcePlayer.value;
  const clip = selectedClip.value;
  if (!player || !clip) return;
  player.currentTime = clip.sourceIn ?? 0;
  try {
    player.playbackRate = clip.transform?.speed ?? 1;
    if (sourceError.value === unsupportedSpeedMessage) sourceError.value = "";
  } catch {
    player.pause();
    sourceError.value = unsupportedSpeedMessage;
  }
  player.volume = clip.transform?.volume ?? 1;
}
function stopAtOut() {
  const player = sourcePlayer.value;
  if (
    player &&
    selectedClip.value?.sourceOut !== undefined &&
    player.currentTime >= selectedClip.value.sourceOut
  ) {
    player.pause();
    player.currentTime = selectedClip.value.sourceIn ?? 0;
  }
}
function togglePlayback() {
  if (selectedSourceInfo.value?.previewSupported === false) return;
  const player = sourcePlayer.value;
  if (!player) {
    emit("playback");
    return;
  }
  if (player.paused)
    void player.play().catch(() => {
      sourceError.value =
        "This source cannot play in the browser. Render a preview to watch the cut.";
    });
  else player.pause();
}
function keyboard(event: KeyboardEvent) {
  if (!props.active || event.defaultPrevented) return;
  const element = event.target as HTMLElement | null;
  if (element?.closest("input, textarea, select, [contenteditable='true']"))
    return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    void history(event.shiftKey ? "redo" : "undo");
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.code === "Space" && !element?.closest("button")) {
    event.preventDefault();
    togglePlayback();
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelected();
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const clips = groups.value.flatMap((group) => group.clips);
    const index = clips.findIndex((clip) => clip.id === selectedClipId.value);
    const next = clips[index + (event.key === "ArrowRight" ? 1 : -1)];
    if (next) {
      chooseClip(next);
      void nextTick(() =>
        document
          .getElementById(`clip-${next.id}`)
          ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
      );
    }
  }
}
watch(
  allClips,
  (clips) => {
    if (!clips.some((clip) => clip.id === selectedClipId.value)) {
      const first = clips[0];
      if (first) chooseClip(first);
      else selectedClipId.value = "";
    }
  },
  { immediate: true },
);
function clipValues(clip: Clip) {
  return {
    sourceIn: clip.sourceIn ?? 0,
    sourceOut:
      clip.sourceOut ??
      assetMap.value.get(clip.assetId)?.duration ??
      clip.timelineDuration,
    duration: clip.timelineDuration,
    speed: clip.transform?.speed ?? 1,
    volume: clip.transform?.volume ?? 1,
    scale: clip.transform?.scale ?? 1,
    rotation: clip.transform?.rotation ?? 0,
    x: clip.transform?.x ?? 0,
    y: clip.transform?.y ?? 0,
    transitionDuration: clip.transition?.duration ?? 0.3,
  };
}
watch(selectedClip, (clip, previous) => {
  if (!clip) return;
  const next = clipValues(clip);
  if (
    !previous ||
    previous.id !== clip.id ||
    previous.assetId !== clip.assetId
  ) {
    clipFields.value = next;
    replacementId.value = "";
  } else {
    const before = clipValues(previous);
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      if (next[key] !== before[key]) clipFields.value[key] = next[key];
    }
  }
  if (
    !previous ||
    previous.assetId !== clip.assetId ||
    previous.sourceIn !== clip.sourceIn ||
    previous.transform?.speed !== clip.transform?.speed ||
    previous.transform?.volume !== clip.transform?.volume
  )
    void nextTick(configurePlayer);
});
function beatValues(beat: StoryBeat) {
  return {
    title: beat.title,
    intent: beat.intent ?? "",
    targetDuration: beat.targetDuration ?? target.value,
    minDuration: beat.minDuration ?? 0,
    maxDuration: beat.maxDuration ?? beat.targetDuration ?? maximum.value,
  };
}
watch(selectedBeat, (beat, previous) => {
  if (!beat) return;
  const next = beatValues(beat);
  if (!previous || previous.id !== beat.id) beatFields.value = next;
  else {
    const before = beatValues(previous);
    const changed = Object.fromEntries(
      Object.entries(next).filter(
        ([key, value]) => before[key as keyof typeof before] !== value,
      ),
    );
    beatFields.value = { ...beatFields.value, ...changed };
  }
});
watch([sourcePlaybackKey, () => selectedSourceStatus.value?.status], () => {
  sourceError.value = "";
  playing.value = false;
});
watch(
  () => props.active,
  (active) => {
    if (!active) sourcePlayer.value?.pause();
  },
);
onMounted(() => window.addEventListener("keydown", keyboard));
onBeforeUnmount(() => window.removeEventListener("keydown", keyboard));
</script>

<template>
  <section class="timeline-editor" aria-label="Composition timeline">
    <header class="editor-toolbar">
      <div class="editor-heading">
        <span class="editor-kicker">THE STORY CUT</span>
        <h2>Make every moment count.</h2>
      </div>
      <span
        class="editor-save-state"
        :class="{
          failed: status === 'failed' || status === 'conflict',
          saving: status === 'saving',
        }"
        role="status"
        aria-live="polite"
        ><Icon :name="status === 'saved' ? 'check' : 'refresh'" :size="14" />{{
          saveLabel
        }}</span
      >
      <div class="editor-actions">
        <button
          class="editor-button"
          aria-label="Undo edit"
          :disabled="historyBusy || (!state?.canUndo && !hasPending)"
          @click="history('undo')"
        >
          Undo
        </button>
        <button
          class="editor-button"
          aria-label="Redo edit"
          :disabled="historyBusy || !state?.canRedo || hasPending"
          @click="history('redo')"
        >
          Redo
        </button>
        <button
          class="editor-button"
          :class="{ selected: showFit }"
          :aria-expanded="showFit"
          @click="showFit = !showFit"
        >
          Fit to target
        </button>
      </div>
    </header>
    <div
      v-if="message || status === 'failed' || status === 'conflict'"
      class="editor-message error"
      role="alert"
    >
      <span>{{
        message || "Your edits are kept in this draft until they are saved."
      }}</span>
      <button
        v-if="status === 'failed'"
        class="editor-button"
        @click="state && hasPending ? flush() : load()"
      >
        Retry save
      </button>
      <button
        v-if="status === 'conflict' && !hasPending"
        class="editor-button"
        @click="load"
      >
        Reload latest cut
      </button>
      <template v-if="status === 'conflict' && hasPending"
        ><button class="editor-button" @click="flush">Retry save</button
        ><button class="editor-button" @click="reapplyDraft">
          Apply draft to latest
        </button></template
      >
      <template
        v-if="hasPending && (status === 'failed' || status === 'conflict')"
      >
        <button class="editor-button" @click="downloadDraft">
          Download unsaved draft
        </button>
        <button class="editor-button danger" @click="discardDraft">
          Discard draft and load latest
        </button>
      </template>
    </div>
    <div v-if="!state" class="editor-empty">
      {{
        status === "loading"
          ? "Opening your story cut…"
          : "The editing workspace could not be opened."
      }}
    </div>
    <template v-else>
      <div
        class="editor-duration"
        :class="{ 'over-limit': overLimit }"
        aria-label="Film duration feedback"
      >
        <strong
          >{{ duration(state.composition.duration) }}
          <span>current</span></strong
        ><span
          >{{ duration(target) }} target · {{ duration(maximum) }} maximum</span
        >
        <div class="editor-duration-track">
          <i
            :style="{
              width: `${Math.min(100, (state.composition.duration / Math.max(maximum, 1)) * 100)}%`,
            }"
          />
        </div>
        <span v-if="overLimit"
          >{{ duration(state.composition.duration - maximum) }} over maximum.
          Shorten the cut before rendering.</span
        >
        <span v-else-if="state.composition.duration > target + 0.001"
          >{{ duration(state.composition.duration - target) }} above
          target</span
        >
        <span v-else>Within your story’s duration</span>
      </div>
      <section
        v-if="showFit"
        class="editor-fit-panel"
        aria-label="Shortening suggestions"
      >
        <div class="editor-fit-heading">
          <div>
            <h3>A little more room for the story.</h3>
            <p>
              Review each suggestion. Locked and required moments stay
              protected. Each saving is measured from the current cut; these
              alternatives do not add together.
            </p>
          </div>
          <button
            class="editor-button primary"
            :disabled="!fitPlan?.commands.length || historyBusy"
            @click="applyFit(fitPlan)"
          >
            Apply all suggestions
          </button>
        </div>
        <p v-if="fitPlan?.commands.length" class="editor-note">
          The combined plan saves {{ duration(fitPlan.secondsSaved) }}.
        </p>
        <div
          v-for="suggestion in fitSuggestions"
          :key="suggestion.id"
          class="editor-suggestion"
        >
          <div>
            <strong>{{
              allClips.find((clip) => clip.id === suggestion.clipId)
                ? name(allClips.find((clip) => clip.id === suggestion.clipId)!)
                : "Story moment"
            }}</strong>
            <p>{{ suggestion.reason }}</p>
          </div>
          <span>−{{ duration(suggestion.secondsSaved) }}</span
          ><button
            class="editor-button"
            :aria-label="`Apply suggestion: ${suggestion.reason}`"
            :disabled="historyBusy"
            @click="applyFit(suggestion)"
          >
            Apply
          </button>
        </div>
        <p v-if="!fitSuggestions.length" class="editor-note">
          {{
            state.composition.duration <= target + 0.001
              ? "Your cut already fits the target."
              : fitPlan?.commands.length
                ? "Overlapping clips need the combined plan. Apply all suggestions to shorten them together."
                : "No further automatic shortening is available. Adjust unlocked clips or your story target."
          }}
        </p>
      </section>
      <div class="editor-body">
        <div class="editor-stage">
          <div class="editor-source-screen">
            <template v-if="selectedAsset">
              <div v-if="sourceUnavailable" class="editor-missing-source">
                <img
                  v-if="selectedAsset.thumbnailUri"
                  :src="thumbnailUrl(selectedAsset.id)"
                  alt=""
                />
                <div>
                  <Icon name="folder" :size="24" /><strong>{{
                    selectedSourceStatus?.status === "inaccessible"
                      ? "Inaccessible Media"
                      : "Missing Media"
                  }}</strong
                  ><span>Cached preview · Your edits are still available.</span>
                </div>
              </div>
              <div
                v-else-if="selectedSourceInfo?.previewSupported === false"
                class="editor-unsupported-source"
              >
                <img
                  v-if="selectedAsset.thumbnailUri"
                  :src="thumbnailUrl(selectedAsset.id)"
                  alt=""
                />
                <div>
                  <Icon name="film" :size="28" /><strong>{{
                    selectedSourceInfo.requiresReframedExport
                      ? "360 source"
                      : "Preview unavailable"
                  }}</strong
                  ><span>{{
                    selectedSourceInfo.requiresReframedExport
                      ? "Requires reframed export"
                      : selectedSourceInfo.kindLabel
                  }}</span>
                  <p>
                    {{
                      selectedSourceInfo.previewReason ||
                      "Export a supported image or video from the source application, then import that file to continue."
                    }}
                  </p>
                </div>
              </div>
              <img
                v-else-if="selectedAsset.mediaType === 'image'"
                :key="sourcePlaybackKey"
                :src="sourceUrl(selectedAsset.id, sourcePlaybackKey)"
                :alt="selectedAsset.name"
                :style="{
                  transform: `translate(${clipFields.x}px, ${clipFields.y}px) rotate(${clipFields.rotation}deg) scale(${clipFields.scale})`,
                }"
                @error="
                  sourceError =
                    'This photo is unavailable. Check its source file in the Library.'
                "
              />
              <video
                v-else
                ref="sourcePlayer"
                :key="sourcePlaybackKey"
                :src="sourceUrl(selectedAsset.id, sourcePlaybackKey)"
                :poster="
                  selectedAsset.thumbnailUri
                    ? thumbnailUrl(selectedAsset.id)
                    : undefined
                "
                controls
                preload="metadata"
                aria-label="Selected clip source preview"
                :style="{
                  transform: `translate(${clipFields.x}px, ${clipFields.y}px) rotate(${clipFields.rotation}deg) scale(${clipFields.scale})`,
                }"
                @loadedmetadata="configurePlayer"
                @timeupdate="stopAtOut"
                @play="playing = true"
                @pause="playing = false"
                @error="
                  sourceError =
                    'This source cannot play here. Render a preview to watch your cut.'
                "
              />
            </template>
            <div v-else class="editor-source-empty">
              <Icon name="film" :size="30" /><span
                >Select a moment to shape it.</span
              >
            </div>
          </div>
          <div class="editor-source-caption">
            <span
              >{{ selectedAsset?.name ?? "Your story" }}
              <small>· Selected source</small></span
            ><button
              v-if="
                selectedAsset &&
                !sourceUnavailable &&
                selectedSourceInfo?.previewSupported !== false &&
                selectedAsset.mediaType !== 'image'
              "
              class="editor-button"
              @click="togglePlayback"
            >
              {{ playing ? "Pause clip" : "Play clip" }}
            </button>
          </div>
          <div
            v-if="sourceUnavailable || sourceError"
            class="editor-source-warning"
            role="status"
          >
            <p>
              {{
                selectedSourceStatus?.message ||
                sourceError ||
                "Reconnect the source drive or locate this file in its new folder."
              }}
            </p>
            <button
              v-if="selectedAsset && sourceError !== unsupportedSpeedMessage"
              class="editor-button"
              aria-label="Relink selected clip source"
              @click="emit('relink', selectedAsset.id)"
            >
              Locate source<Icon name="arrow" :size="14" />
            </button>
          </div>
          <div class="editor-beats" aria-label="Story beat timeline">
            <section
              v-for="(group, index) in groups"
              :key="group.id"
              class="editor-beat"
              :class="{ selected: selectedBeatId === group.id }"
              :aria-label="`${group.title} beat`"
            >
              <button
                class="editor-beat-heading"
                :aria-label="`Edit beat ${group.title}`"
                @click="chooseBeat(group.id)"
              >
                <span class="editor-beat-number">{{
                  String(index + 1).padStart(2, "0")
                }}</span
                ><span class="editor-beat-copy"
                  ><strong>{{ group.title }}</strong
                  ><small>{{
                    group.intent || "Give this moment a little meaning."
                  }}</small></span
                ><span class="editor-beat-time"
                  >{{ duration(beatDuration(group.clips))
                  }}<small>{{ group.clips.length }} clips</small></span
                >
              </button>
              <div
                class="editor-clip-lane"
                role="group"
                :aria-label="`${group.title} clips`"
              >
                <button
                  v-for="clip in group.clips"
                  :id="`clip-${clip.id}`"
                  :key="clip.id"
                  class="editor-clip"
                  :class="{
                    selected: selectedClipId === clip.id,
                    locked: clip.locked,
                  }"
                  :style="{
                    width: `${Math.min(240, Math.max(120, clip.timelineDuration * 24))}px`,
                  }"
                  :aria-label="`Select clip ${name(clip)}${clip.locked ? ', locked' : ''}`"
                  :aria-pressed="selectedClipId === clip.id"
                  :draggable="!clip.locked"
                  @click="chooseClip(clip)"
                  @dragstart="draggedClipId = clip.id"
                  @dragend="draggedClipId = ''"
                  @dragover.prevent
                  @drop.prevent="drop(clip)"
                >
                  <img
                    v-if="assetMap.get(clip.assetId)?.thumbnailUri"
                    :src="thumbnailUrl(clip.assetId)"
                    alt=""
                    loading="lazy"
                    draggable="false"
                  /><span v-else class="editor-source-empty"
                    ><Icon
                      :name="
                        assetMap.get(clip.assetId)?.mediaType === 'audio'
                          ? 'volume'
                          : 'film'
                      "
                  /></span>
                  <span
                    v-if="
                      sourceStatuses?.[clip.assetId] &&
                      sourceStatuses[clip.assetId]?.status !== 'available'
                    "
                    class="editor-clip-source-status"
                    :title="sourceStatuses[clip.assetId]?.message"
                    >{{
                      sourceStatuses[clip.assetId]?.status === "missing"
                        ? "Missing"
                        : "Inaccessible"
                    }}</span
                  >
                  <span v-if="clip.locked" class="editor-clip-badge"
                    ><Icon name="lock" :size="11" />Locked</span
                  ><span class="editor-clip-meta"
                    ><strong>{{ name(clip) }}</strong
                    ><small
                      >{{ duration(clip.timelineDuration)
                      }}<span
                        v-if="
                          clip.transform?.speed && clip.transform.speed !== 1
                        "
                      >
                        · {{ clip.transform.speed }}×</span
                      ><span v-if="clip.transition"> · Fade</span></small
                    ></span
                  >
                </button>
                <p v-if="!group.clips.length" class="editor-note">
                  This beat is empty. Select it and regenerate to find new
                  moments.
                </p>
              </div>
            </section>
          </div>
        </div>
        <aside class="editor-inspector" aria-label="Timeline inspector">
          <div class="editor-inspector-tabs">
            <button
              :class="{ selected: inspector === 'clip' }"
              :aria-pressed="inspector === 'clip'"
              @click="inspector = 'clip'"
            >
              Clip</button
            ><button
              :class="{ selected: inspector === 'beat' }"
              :aria-pressed="inspector === 'beat'"
              @click="inspector = 'beat'"
            >
              Story beat
            </button>
          </div>
          <template
            v-if="inspector === 'clip' && selectedClip && selectedAsset"
          >
            <div class="editor-inspector-title">
              <span class="editor-kicker">{{
                selectedAsset.mediaType === "image" ? "PHOTO" : "SOURCE CLIP"
              }}</span>
              <h3>{{ selectedAsset.name }}</h3>
              <button
                class="editor-button"
                :aria-label="selectedClip.locked ? 'Unlock clip' : 'Lock clip'"
                :aria-pressed="!!selectedClip.locked"
                @click="
                  command({
                    type: 'lock',
                    clipId: selectedClip.id,
                    locked: !selectedClip.locked,
                  })
                "
              >
                <Icon name="lock" :size="14" />{{
                  selectedClip.locked ? "Locked" : "Lock clip"
                }}
              </button>
            </div>
            <SourceDetails :asset="selectedAsset" compact />
            <div class="editor-stat-grid">
              <div class="editor-stat">
                <small>Source</small
                ><strong>{{
                  selectedAsset.mediaType === "image"
                    ? "Still"
                    : duration(selectedAsset.duration)
                }}</strong>
              </div>
              <div class="editor-stat">
                <small>Selected</small
                ><strong>{{
                  selectedAsset.mediaType === "image"
                    ? duration(selectedClip.timelineDuration)
                    : duration(
                        (selectedClip.sourceOut ?? 0) -
                          (selectedClip.sourceIn ?? 0),
                      )
                }}</strong>
              </div>
              <div class="editor-stat">
                <small>Timeline</small
                ><strong>{{ duration(selectedClip.timelineDuration) }}</strong>
              </div>
            </div>
            <p v-if="selectedClip.locked" class="editor-note">
              This clip is protected. Unlock it to adjust, move, replace, or
              delete it.
            </p>
            <fieldset
              class="editor-fields"
              :disabled="!!selectedClip.locked || historyBusy"
            >
              <template v-if="selectedAsset.mediaType === 'image'"
                ><label class="editor-field"
                  >Photo duration (seconds)<input
                    v-model.number="clipFields.duration"
                    aria-label="Photo duration"
                    type="number"
                    min="0.01"
                    step="0.1"
                    @change="
                      editClip({
                        type: 'duration',
                        duration: Number(clipFields.duration),
                      })
                    "
                /></label>
                <div class="editor-presets">
                  <button
                    v-for="seconds in [1.5, 2, 2.5, 3, 4, 5]"
                    :key="seconds"
                    class="editor-button"
                    :class="{
                      selected: selectedClip.timelineDuration === seconds,
                    }"
                    :aria-label="`Set photo duration to ${seconds} seconds`"
                    @click="editClip({ type: 'duration', duration: seconds })"
                  >
                    {{ seconds }}s
                  </button>
                </div></template
              >
              <template v-else
                ><div class="editor-field-pair">
                  <label class="editor-field"
                    >Source in (s)<input
                      v-model.number="clipFields.sourceIn"
                      aria-label="Source in"
                      type="number"
                      min="0"
                      :max="selectedAsset.duration"
                      step="0.01"
                      @change="trim" /></label
                  ><label class="editor-field"
                    >Source out (s)<input
                      v-model.number="clipFields.sourceOut"
                      aria-label="Source out"
                      type="number"
                      min="0"
                      :max="selectedAsset.duration"
                      step="0.01"
                      @change="trim"
                  /></label>
                </div>
                <label class="editor-field"
                  >Playback speed<input
                    v-model.number="clipFields.speed"
                    aria-label="Playback speed"
                    type="number"
                    min="0.01"
                    step="0.1"
                    @change="
                      editClip({
                        type: 'speed',
                        speed: Number(clipFields.speed),
                      })
                    "
                /></label>
                <div class="editor-presets">
                  <button
                    v-for="speed in [0.5, 0.75, 1, 1.25, 1.5, 2]"
                    :key="speed"
                    class="editor-button"
                    :class="{ selected: clipFields.speed === speed }"
                    :aria-label="`Set speed to ${speed} times`"
                    @click="editClip({ type: 'speed', speed })"
                  >
                    {{ speed }}×
                  </button>
                </div>
                <label class="editor-field"
                  >Volume · {{ Math.round(clipFields.volume * 100) }}%<input
                    v-model.number="clipFields.volume"
                    aria-label="Clip volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    @input="
                      editClip({
                        type: 'volume',
                        volume: Number(clipFields.volume),
                      })
                    " /></label
                ><button
                  class="editor-button"
                  :aria-pressed="clipFields.volume === 0"
                  @click="
                    editClip({
                      type: 'volume',
                      volume: clipFields.volume === 0 ? 1 : 0,
                    })
                  "
                >
                  {{ clipFields.volume === 0 ? "Unmute clip" : "Mute clip" }}
                </button></template
              >
              <div class="editor-divider" />
              <div class="editor-field-pair">
                <label class="editor-field"
                  >Transition<select
                    aria-label="Clip transition"
                    :value="selectedClip.transition?.type ?? 'cut'"
                    @change="transition"
                  >
                    <option value="cut">Cut</option>
                    <option value="crossfade">Crossfade</option>
                  </select></label
                ><label v-if="selectedClip.transition" class="editor-field"
                  >Fade (seconds)<input
                    v-model.number="clipFields.transitionDuration"
                    aria-label="Crossfade duration"
                    type="number"
                    min="0.01"
                    :max="selectedClip.timelineDuration"
                    step="0.1"
                    @change="
                      editClip({
                        type: 'transition',
                        transition: 'crossfade',
                        duration: Number(clipFields.transitionDuration),
                      })
                    "
                /></label>
              </div>
              <template v-if="selectedAsset.mediaType !== 'audio'"
                ><div class="editor-field-pair">
                  <label class="editor-field"
                    >Scale<input
                      v-model.number="clipFields.scale"
                      aria-label="Clip scale"
                      type="number"
                      min="0.01"
                      step="0.1"
                      @change="transform" /></label
                  ><label class="editor-field"
                    >Rotation (°)<input
                      v-model.number="clipFields.rotation"
                      aria-label="Clip rotation"
                      type="number"
                      step="1"
                      @change="transform"
                  /></label>
                </div>
                <div class="editor-field-pair">
                  <label class="editor-field"
                    >Position X<input
                      v-model.number="clipFields.x"
                      aria-label="Clip position X"
                      type="number"
                      step="1"
                      @change="transform" /></label
                  ><label class="editor-field"
                    >Position Y<input
                      v-model.number="clipFields.y"
                      aria-label="Clip position Y"
                      type="number"
                      step="1"
                      @change="transform"
                  /></label></div
              ></template>
              <div class="editor-divider" />
              <div class="editor-actions">
                <button
                  class="editor-button"
                  aria-label="Move clip earlier"
                  :disabled="selectedIndex <= 0"
                  @click="move(-1)"
                >
                  ← Earlier</button
                ><button
                  class="editor-button"
                  aria-label="Move clip later"
                  :disabled="selectedIndex >= peers.length - 1"
                  @click="move(1)"
                >
                  Later →
                </button>
              </div>
              <label class="editor-field"
                >Replace with<select
                  v-model="replacementId"
                  aria-label="Replacement media"
                >
                  <option value="">Choose a memory…</option>
                  <option
                    v-for="asset in replacements"
                    :key="asset.id"
                    :value="asset.id"
                  >
                    {{ asset.name }}
                  </option>
                </select></label
              >
              <div class="editor-actions">
                <button
                  class="editor-button"
                  :disabled="!replacementId"
                  @click="replace"
                >
                  Replace clip</button
                ><button class="editor-button danger" @click="deleteSelected">
                  Delete clip
                </button>
              </div>
            </fieldset>
          </template>
          <template v-else-if="inspector === 'beat' && selectedBeat"
            ><div class="editor-inspector-title">
              <span class="editor-kicker">THE STORY BEAT</span>
              <h3>{{ selectedBeat.title }}</h3>
            </div>
            <fieldset class="editor-fields" :disabled="historyBusy">
              <label class="editor-field"
                >Beat title<input
                  v-model="beatFields.title"
                  aria-label="Timeline beat title"
                  @change="editBeat" /></label
              ><label class="editor-field"
                >What should this moment say?<textarea
                  v-model="beatFields.intent"
                  aria-label="Timeline beat intent"
                  rows="3"
                  @change="editBeat"
                /></label
              ><label class="editor-field"
                >Target (seconds)<input
                  v-model.number="beatFields.targetDuration"
                  aria-label="Beat target duration"
                  type="number"
                  min="0.01"
                  step="0.1"
                  @change="editBeat"
              /></label>
              <div class="editor-field-pair">
                <label class="editor-field"
                  >Minimum (s)<input
                    v-model.number="beatFields.minDuration"
                    aria-label="Beat minimum duration"
                    type="number"
                    min="0"
                    step="0.1"
                    @change="editBeat" /></label
                ><label class="editor-field"
                  >Maximum (s)<input
                    v-model.number="beatFields.maxDuration"
                    aria-label="Beat maximum duration"
                    type="number"
                    min="0.01"
                    step="0.1"
                    @change="editBeat"
                /></label>
              </div>
              <div class="editor-divider" />
              <h3>Try another rhythm</h3>
              <p class="editor-note">
                Only this beat changes. Locked moments keep their edits.
              </p>
              <div class="editor-presets">
                <button
                  v-for="action in regenerateModes"
                  :key="action.mode"
                  class="editor-button"
                  @click="
                    command({
                      type: 'regenerate-beat',
                      beatId: selectedBeat.id,
                      mode: action.mode,
                    })
                  "
                >
                  {{ action.label }}
                </button>
              </div>
            </fieldset></template
          >
          <p v-else class="editor-note">
            Select {{ inspector === "beat" ? "a story beat" : "a clip" }} to
            start editing.
          </p>
        </aside>
      </div>
      <footer class="editor-shortcuts">
        <span>Originals stay untouched.</span
        ><span>Space play · ← → select · Delete remove · ⌘ / Ctrl Z undo</span>
      </footer>
    </template>
  </section>
</template>
