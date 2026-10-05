<script setup lang="ts">
import { ref, watch } from "vue";
import type { MediaAsset } from "@openfilm/core";
import { thumbnailUrl, duration, dateLabel } from "../api";
import Icon from "./Icon.vue";
const props = defineProps<{
  asset: MediaAsset;
  selected?: boolean;
  choice?: boolean;
  chosen?: boolean;
}>();
defineEmits<{
  select: [asset: MediaAsset];
  toggle: [asset: MediaAsset, key: "favorite" | "rejected" | "locked"];
}>();
const failed = ref(false);
watch(
  () => props.asset.id,
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
          asset.mediaType === "audio"
            ? "Audio recording"
            : "No preview available"
        }}</span>
      </div>
      <span class="asset-type">{{
        asset.mediaType === "image"
          ? "PHOTO"
          : asset.mediaType === "audio"
            ? "AUDIO"
            : "VIDEO"
      }}</span>
      <span v-if="asset.duration !== undefined" class="asset-duration">{{
        duration(asset.duration)
      }}</span>
      <span v-if="choice" class="choice-mark"
        ><Icon v-if="chosen" name="check" :size="14" /><span v-else
          >+</span
        ></span
      >
    </button>
    <div class="asset-caption">
      <span class="asset-name" :title="asset.name">{{ asset.name }}</span
      ><span class="asset-date">{{ dateLabel(asset.capturedAt) }}</span>
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
