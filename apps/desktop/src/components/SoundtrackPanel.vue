<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  evaluateAudioGain,
  hasAudioStream,
  resolveAudioInterval,
  type AudioAutomation,
  type Clip,
  type Composition,
  type MediaAsset,
} from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import { sourceUrl } from "../api";
import { formatDuration } from "../i18n";
const props = defineProps<{
  composition: Composition;
  assets: readonly MediaAsset[];
  selectedClip?: Clip;
  busy: boolean;
  active: boolean;
  sourceVersion?: number;
}>();
const emit = defineEmits<{
  command: [command: TimelineCommand];
  select: [clip: Clip];
}>();
const { t } = useI18n();
const audioAssets = computed(() =>
  props.assets.filter(
    (asset) => asset.mediaType === "audio" && !asset.state.rejected,
  ),
);
const audioClips = computed(() =>
  props.composition.tracks
    .filter(
      (track) =>
        track.timing === "overlay" &&
        (track.type === "audio" || track.type === "music"),
    )
    .flatMap((track) => track.clips),
);
const selectedAudio = computed(() =>
  props.selectedClip &&
  (props.selectedClip.audioTiming ||
    audioClips.value.some((clip) => clip.id === props.selectedClip?.id)) &&
  hasAudioStream(
    props.assets.find((asset) => asset.id === props.selectedClip?.assetId) ??
      ({ mediaType: "image", metadata: {} } as MediaAsset),
  )
    ? props.selectedClip
    : undefined,
);
const selectedOverlay = computed(() =>
  audioClips.value.some((clip) => clip.id === selectedAudio.value?.id),
);
const selectedDuration = computed(() => {
  if (!selectedAudio.value) return 0;
  const asset = props.assets.find((a) => a.id === selectedAudio.value!.assetId);
  try {
    return asset
      ? resolveAudioInterval(
          selectedAudio.value,
          asset,
          props.composition.duration,
        ).automationDurationSeconds
      : selectedAudio.value.timelineDuration;
  } catch {
    return selectedAudio.value.timelineDuration;
  }
});
const selectedRole = computed<AudioAutomation["role"]>(
  () =>
    selectedAudio.value?.audioAutomation?.role ??
    (props.composition.tracks.find((track) =>
      track.clips.some((clip) => clip.id === selectedAudio.value?.id),
    )?.type === "music"
      ? "music"
      : "dialogue"),
);
const selectedAsset = computed(() =>
  props.assets.find((asset) => asset.id === selectedAudio.value?.assetId),
);
const sourceIdentity = computed(
  () =>
    `${selectedAsset.value?.id}:${selectedAsset.value?.uri}:${selectedAsset.value?.contentHash}:${props.sourceVersion ?? 0}`,
);
const assetId = ref("");
const role = ref<AudioAutomation["role"]>("music");
const start = ref(0);
const duration = ref(0);
const fields = ref({
  start: 0,
  fadeIn: 0,
  fadeOut: 0,
  duckStart: 0,
  duckEnd: 1,
  duckGain: 0.3,
  duckAttack: 0.2,
  duckRelease: 0.2,
});
const player = ref<HTMLAudioElement | null>(null);
const previewFailed = ref(false);
const speedFailed = ref(false);
watch(sourceIdentity, () => {
  player.value?.pause();
  previewFailed.value = false;
  speedFailed.value = false;
});
watch(
  () => props.active,
  (active) => {
    if (!active) player.value?.pause();
  },
);
onBeforeUnmount(() => player.value?.pause());
const chosenAsset = computed(() =>
  audioAssets.value.find((asset) => asset.id === assetId.value),
);
watch([chosenAsset, () => props.composition.duration, start], () => {
  duration.value = Math.max(
    0,
    Math.min(
      chosenAsset.value?.duration ?? 0,
      props.composition.duration - start.value,
    ),
  );
});
watch(
  selectedAudio,
  (clip, previous) => {
    if (!clip) return;
    const changedClip = !previous || previous.id !== clip.id;
    if (changedClip) {
      previewFailed.value = false;
      speedFailed.value = false;
    }
    const automation = clip.audioAutomation;
    const duck = automation?.ducking?.[0];
    if (changedClip || clip.timelineStart !== previous?.timelineStart)
      fields.value.start = clip.timelineStart;
    if (changedClip || automation?.fadeIn !== previous?.audioAutomation?.fadeIn)
      fields.value.fadeIn = automation?.fadeIn ?? 0;
    if (
      changedClip ||
      automation?.fadeOut !== previous?.audioAutomation?.fadeOut
    )
      fields.value.fadeOut = automation?.fadeOut ?? 0;
    if (
      changedClip ||
      JSON.stringify(duck) !==
        JSON.stringify(previous?.audioAutomation?.ducking?.[0])
    ) {
      fields.value = {
        ...fields.value,
        duckStart: duck?.start ?? 0,
        duckEnd: duck?.end ?? Math.min(1, selectedDuration.value),
        duckGain: duck?.gain ?? 0.3,
        duckAttack: duck?.attack ?? 0.2,
        duckRelease: duck?.release ?? 0.2,
      };
    }
    if ((changedClip || clip.audioTiming) && player.value) player.value.pause();
  },
  { immediate: true },
);
watch(
  [
    () => selectedAudio.value?.id,
    () => selectedAudio.value?.assetId,
    () => selectedAudio.value?.sourceIn,
    () => selectedAudio.value?.transform?.speed,
    sourceIdentity,
  ],
  () =>
    void nextTick(() => {
      player.value?.pause();
      configurePlayer();
    }),
  { flush: "post" },
);
function add() {
  if (!chosenAsset.value || !(duration.value > 0)) return;
  emit("command", {
    type: "audio.add",
    clipId: crypto.randomUUID(),
    assetId: assetId.value,
    role: role.value,
    timelineStart: start.value,
    sourceIn: 0,
    sourceOut: duration.value,
    volume: role.value === "music" ? 0.6 : 1,
  });
}
function configure(
  duck?: "add" | "remove",
  roleOverride?: AudioAutomation["role"],
) {
  const clip = selectedAudio.value;
  if (!clip) return;
  emit("command", {
    type: "audio.configure",
    clipId: clip.id,
    automation: {
      ...clip.audioAutomation,
      version: 1,
      role: roleOverride ?? selectedRole.value,
      fadeIn: Number(fields.value.fadeIn),
      fadeOut: Number(fields.value.fadeOut),
      ...(duck === "add"
        ? {
            ducking: [
              {
                start: Number(fields.value.duckStart),
                end: Number(fields.value.duckEnd),
                gain: Number(fields.value.duckGain),
                attack: Number(fields.value.duckAttack),
                release: Number(fields.value.duckRelease),
              },
            ],
          }
        : duck === "remove"
          ? { ducking: [] }
          : {}),
    },
  });
}
function updateVolume() {
  const clip = selectedAudio.value;
  const audio = player.value;
  if (!clip || !audio) return;
  const time =
    (audio.currentTime - (clip.sourceIn ?? 0)) / (clip.transform?.speed ?? 1);
  audio.volume = Math.max(
    0,
    Math.min(
      1,
      (clip.transform?.volume ?? 1) *
        evaluateAudioGain(clip.audioAutomation, time, clip.timelineDuration),
    ),
  );
  if (audio.currentTime >= (clip.sourceOut ?? Infinity)) audio.pause();
}
function configurePlayer(event?: Event) {
  if (event && event.currentTarget !== player.value) return;
  if (!player.value || !selectedAudio.value) return;
  if (event) previewFailed.value = false;
  player.value.currentTime = selectedAudio.value.sourceIn ?? 0;
  try {
    player.value.playbackRate = selectedAudio.value.transform?.speed ?? 1;
    speedFailed.value = false;
  } catch {
    player.value.pause();
    speedFailed.value = true;
  }
  updateVolume();
}
function failPreview(event?: Event) {
  if (event && event.currentTarget !== player.value) return;
  previewFailed.value = true;
}
function startPlayback() {
  const clip = selectedAudio.value;
  const audio = player.value;
  if (!clip || !audio) return;
  if (speedFailed.value) {
    audio.pause();
    return;
  }
  if (
    audio.currentTime < (clip.sourceIn ?? 0) ||
    audio.currentTime >= (clip.sourceOut ?? Infinity)
  )
    audio.currentTime = clip.sourceIn ?? 0;
  updateVolume();
}
</script>

<template>
  <section class="editor-soundtrack-panel">
    <h3>{{ t("editor.sound.heading") }}</h3>
    <p class="editor-note">{{ t("editor.sound.description") }}</p>
    <form class="editor-fields" @submit.prevent="add">
      <label class="editor-field"
        >{{ t("editor.sound.source")
        }}<select
          v-model="assetId"
          :disabled="busy"
          :aria-label="t('editor.sound.source')"
        >
          <option value="">{{ t("editor.sound.choose") }}</option>
          <option
            v-for="asset in audioAssets"
            :key="asset.id"
            :value="asset.id"
          >
            {{ asset.name }}
          </option>
        </select></label
      >
      <p v-if="!audioAssets.length" class="editor-note">
        {{ t("editor.sound.noAudio") }}
      </p>
      <label class="editor-field"
        >{{ t("editor.sound.role")
        }}<select
          v-model="role"
          :disabled="busy"
          :aria-label="t('editor.sound.role')"
        >
          <option
            v-for="value in [
              'music',
              'narration',
              'ambience',
              'dialogue',
            ] as const"
            :key="value"
            :value="value"
          >
            {{ t(`editor.sound.roles.${value}`) }}
          </option>
        </select></label
      >
      <div class="editor-field-pair">
        <label class="editor-field"
          >{{ t("editor.sound.start")
          }}<input
            v-model.number="start"
            type="number"
            min="0"
            :max="composition.duration"
            step="any"
            :disabled="busy"
        /></label>
        <label class="editor-field"
          >{{ t("editor.sound.length")
          }}<input
            v-model.number="duration"
            type="number"
            min="0.01"
            :max="
              Math.min(chosenAsset?.duration ?? 0, composition.duration - start)
            "
            step="any"
            :disabled="busy"
        /></label>
      </div>
      <button
        class="editor-button primary"
        :disabled="busy || !chosenAsset || !(duration > 0)"
      >
        {{ t("editor.sound.add") }}
      </button>
    </form>
    <div class="editor-divider" />
    <div
      class="editor-soundtrack-list"
      role="group"
      :aria-label="t('editor.sound.tracks')"
    >
      <button
        v-for="clip in audioClips"
        :key="clip.id"
        type="button"
        class="editor-button soundtrack-item"
        :aria-pressed="selectedAudio?.id === clip.id"
        @click="emit('select', clip)"
      >
        <div class="soundtrack-item-header">
          <span class="soundtrack-item-title">{{
            assets.find((asset) => asset.id === clip.assetId)?.name ??
            t("editor.media")
          }}</span>
          <span class="soundtrack-item-role">{{
            t(`editor.sound.roles.${clip.audioAutomation?.role ?? "music"}`)
          }}</span>
        </div>
        <div class="soundtrack-item-meta">
          <small class="soundtrack-item-time">{{
            formatDuration(clip.timelineStart)
          }}</small>
          <span
            v-if="clip.audioAutomation?.ducking?.length"
            class="soundtrack-item-tag"
          >
            {{ t("editor.sound.ducking") }}
          </span>
        </div>
      </button>
    </div>
    <template v-if="selectedAudio">
      <audio
        v-if="selectedAsset && !selectedAudio.audioTiming"
        :key="`${selectedAudio.id}:${sourceIdentity}`"
        ref="player"
        crossorigin="anonymous"
        :src="sourceUrl(selectedAsset.id, sourceIdentity)"
        controls
        preload="metadata"
        :aria-label="t('editor.sound.preview')"
        @loadedmetadata="configurePlayer"
        @timeupdate="updateVolume"
        @play="startPlayback"
        @error="failPreview"
      />
      <p
        v-if="previewFailed || speedFailed"
        class="editor-presentation-warnings"
        role="status"
      >
        {{
          t(
            speedFailed
              ? "editor.source.error.speed"
              : "editor.source.error.playback",
          )
        }}
      </p>
      <p class="editor-note">
        {{
          t(
            selectedAudio.audioTiming
              ? "editor.soundTiming.recordAudition"
              : "editor.sound.previewHint",
          )
        }}
      </p>
      <fieldset
        class="editor-fields"
        :disabled="busy || selectedAudio.locked || selectedAsset?.state.locked"
      >
        <p v-if="selectedAudio.locked" class="editor-note">
          {{ t("editor.clip.protected") }}
        </p>
        <p v-else-if="selectedAsset?.state.locked" class="editor-note">
          {{ t("editor.clip.sourceProtected") }}
        </p>
        <label class="editor-field"
          >{{ t("editor.sound.role")
          }}<select
            data-testid="selected-audio-role"
            :value="selectedRole"
            :aria-label="t('editor.sound.role')"
            @change="
              configure(
                undefined,
                ($event.target as HTMLSelectElement)
                  .value as AudioAutomation['role'],
              )
            "
          >
            <option
              v-for="value in [
                'music',
                'narration',
                'ambience',
                'dialogue',
              ] as const"
              :key="value"
              :value="value"
            >
              {{ t(`editor.sound.roles.${value}`) }}
            </option>
          </select></label
        >
        <label v-if="selectedOverlay" class="editor-field"
          >{{ t("editor.sound.start")
          }}<input
            v-model.number="fields.start"
            type="number"
            min="0"
            :max="
              Math.max(0, composition.duration - selectedAudio.timelineDuration)
            "
            step="0.1"
            @change="
              emit('command', {
                type: 'audio.move',
                clipId: selectedAudio.id,
                timelineStart: fields.start,
              })
            "
        /></label>
        <div class="editor-field-pair">
          <label class="editor-field"
            >{{ t("editor.sound.fadeIn")
            }}<input
              v-model.number="fields.fadeIn"
              type="number"
              min="0"
              :max="selectedDuration"
              step="0.1"
              @change="configure()"
          /></label>
          <label class="editor-field"
            >{{ t("editor.sound.fadeOut")
            }}<input
              v-model.number="fields.fadeOut"
              type="number"
              min="0"
              :max="selectedDuration"
              step="0.1"
              @change="configure()"
          /></label>
        </div>
        <details class="editor-presentation-details">
          <summary>{{ t("editor.sound.ducking") }}</summary>
          <p class="editor-note">{{ t("editor.sound.duckingHint") }}</p>
          <div class="editor-field-pair">
            <label class="editor-field"
              >{{ t("editor.sound.duckStart")
              }}<input
                v-model.number="fields.duckStart"
                type="number"
                min="0"
                :max="selectedDuration"
                step="0.1"
            /></label>
            <label class="editor-field"
              >{{ t("editor.sound.duckEnd")
              }}<input
                v-model.number="fields.duckEnd"
                type="number"
                min="0"
                :max="selectedDuration"
                step="0.1"
            /></label>
            <label class="editor-field"
              >{{ t("editor.sound.duckGain")
              }}<input
                v-model.number="fields.duckGain"
                type="number"
                min="0"
                max="1"
                step="0.05"
            /></label>
            <label class="editor-field"
              >{{ t("editor.sound.attack")
              }}<input
                v-model.number="fields.duckAttack"
                type="number"
                min="0"
                step="0.1"
            /></label>
            <label class="editor-field"
              >{{ t("editor.sound.release")
              }}<input
                v-model.number="fields.duckRelease"
                type="number"
                min="0"
                step="0.1"
            /></label>
          </div>
          <div class="editor-actions">
            <button class="editor-button" @click="configure('add')">
              {{ t("editor.sound.applyDuck") }}</button
            ><button
              v-if="selectedAudio.audioAutomation?.ducking?.length"
              class="editor-button"
              @click="configure('remove')"
            >
              {{ t("editor.sound.removeDuck") }}
            </button>
          </div>
        </details>
        <p class="editor-note">{{ t("editor.sound.editHint") }}</p>
      </fieldset>
    </template>
  </section>
</template>
