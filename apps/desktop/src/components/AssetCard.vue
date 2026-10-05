<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { MediaAsset } from "@openfilm/core";
import { thumbnailUrl, duration, dateLabel, type SourceStatus } from "../api";
import Icon from "./Icon.vue";
import { sourcePresentation } from "../sourcePresentation";
const props = defineProps<{
  asset: MediaAsset;
  selected?: boolean;
  choice?: boolean;
  chosen?: boolean;
  sourceStatus?: SourceStatus;
}>();
defineEmits<{
  select: [asset: MediaAsset];
  toggle: [asset: MediaAsset, key: "favorite" | "rejected" | "locked"];
}>();
const failed = ref(false);
const sourceInfo = computed(() => sourcePresentation(props.asset));
watch(
  () => `${props.asset.id}:${props.asset.uri}:${props.asset.thumbnailUri}`,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <article
    class="asset-card"
    :class="{
      'is-selected': selected,
      'is-rejected': asset.state.rejected,
      'is-chosen': chosen,
    }"
  >
    <button
      class="asset-image-button"
      :aria-label="
        choice
          ? `${chosen ? 'Remove' : 'Select'} ${asset.name}`
          : `Inspect ${asset.name}`
      "
      :aria-pressed="choice ? !!chosen : !!selected"
      @click="$emit('select', asset)"
    >
      <img
        v-if="asset.thumbnailUri && !failed"
        crossorigin="anonymous"
        :src="thumbnailUrl(asset.id)"
        :alt="asset.name"
        loading="lazy"
        @error="failed = true"
      />
      <div v-else class="thumbnail-empty">
        <Icon
          :name="asset.mediaType === 'audio' ? 'volume' : 'film'"
          :size="30"
        /><span>{{
          sourceInfo.requiresReframedExport
            ? "360 source"
            : !sourceInfo.previewSupported
              ? "Preview unavailable"
              : asset.mediaType === "audio"
                ? "Audio recording"
                : "No preview available"
        }}</span>
      </div>
      <span class="asset-type">{{
        sourceInfo.requiresReframedExport
          ? "360 SOURCE"
          : asset.mediaType === "image"
            ? "PHOTO"
            : asset.mediaType === "audio"
              ? "AUDIO"
              : "VIDEO"
      }}</span>
      <span v-if="asset.duration !== undefined" class="asset-duration">{{
        duration(asset.duration)
      }}</span>
      <span
        v-if="sourceStatus && sourceStatus.status !== 'available'"
        class="asset-source-status"
        :title="sourceStatus.message"
        >{{
          sourceStatus.status === "missing"
            ? "Missing Media"
            : "Inaccessible Media"
        }}</span
      >
      <span v-if="choice" class="choice-mark"
        ><Icon v-if="chosen" name="check" :size="14" /><span v-else
          >+</span
        ></span
      >
    </button>
    <div class="asset-caption">
      <span class="asset-name" :title="asset.name">{{ asset.name }}</span
      ><span class="asset-date">{{ dateLabel(asset.capturedAt) }}</span>
      <span v-if="sourceInfo.adapter !== 'generic'" class="asset-device">{{
        sourceInfo.deviceLabel
      }}</span>
      <span v-if="sourceInfo.badges.length" class="asset-capability-badges"
        ><span
          v-for="badge in sourceInfo.badges.slice(0, 2)"
          :key="badge"
          :title="sourceInfo.previewReason"
          >{{ badge }}</span
        ></span
      >
    </div>
    <div v-if="!choice" class="asset-actions">
      <button
        :class="{ active: asset.state.favorite }"
        :aria-label="`${asset.state.favorite ? 'Unfavorite' : 'Favorite'} ${asset.name}`"
        :aria-pressed="!!asset.state.favorite"
        @click="$emit('toggle', asset, 'favorite')"
      >
        <Icon name="heart" :size="15" />
      </button>
      <button
        :class="{ active: asset.state.locked }"
        :aria-label="`${asset.state.locked ? 'Unlock' : 'Lock'} ${asset.name}`"
        :aria-pressed="!!asset.state.locked"
        @click="$emit('toggle', asset, 'locked')"
      >
        <Icon name="lock" :size="15" />
      </button>
      <button
        :class="{ active: asset.state.rejected }"
        :aria-label="`${asset.state.rejected ? 'Restore' : 'Reject'} ${asset.name}`"
        :aria-pressed="!!asset.state.rejected"
        @click="$emit('toggle', asset, 'rejected')"
      >
        <Icon name="reject" :size="15" />
      </button>
      <span v-if="asset.rating" class="asset-rating"
        ><Icon name="star" :size="11" /> {{ asset.rating }}</span
      >
    </div>
  </article>
</template>
