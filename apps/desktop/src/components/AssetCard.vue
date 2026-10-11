<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { MediaAsset } from "@openfilm/core";
import { thumbnailUrl, type SourceStatus } from "../api";
import { formatDuration } from "../i18n";
import Icon from "./Icon.vue";
import { sourcePresentation } from "../sourcePresentation";
const { t } = useI18n();
const props = defineProps<{
  asset: MediaAsset;
  selected?: boolean;
  choice?: boolean;
  chosen?: boolean;
  sourceStatus?: SourceStatus;
  mutationDisabled?: boolean;
}>();
defineEmits<{
  select: [asset: MediaAsset];
  toggle: [asset: MediaAsset, key: "favorite" | "rejected" | "locked"];
}>();
const failed = ref(false);
const sourceInfo = computed(() =>
  sourcePresentation(props.asset, { translate: t }),
);
const kind = computed(() =>
  sourceInfo.value.requiresReframedExport
    ? "kind360"
    : props.asset.mediaType === "image"
      ? "kindPhoto"
      : props.asset.mediaType === "audio"
        ? "kindAudio"
        : "kindVideo",
);
// Reimport can rebuild the same cache URI. A fresh catalog object means retry
// a thumbnail that failed earlier, without requiring the Library to remount.
watch(
  () => props.asset,
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
      'is-locked': asset.state.locked,
      'is-missing': sourceStatus && sourceStatus.status !== 'available',
    }"
  >
    <button
      class="asset-image-button"
      :aria-label="
        t(`media.card.${choice ? (chosen ? 'remove' : 'select') : 'inspect'}`, {
          name: asset.name,
        })
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
        />
        <span>{{
          sourceInfo.requiresReframedExport
            ? t("media.source.kind360")
            : !sourceInfo.previewSupported
              ? t("media.source.previewUnavailable")
              : asset.mediaType === "audio"
                ? t("media.card.audioRecording")
                : t("media.card.noPreview")
        }}</span>
      </div>
      <span class="asset-type">{{ t(`media.source.${kind}`) }}</span>
      <span v-if="asset.duration !== undefined" class="asset-duration">{{
        formatDuration(asset.duration)
      }}</span>
      <span
        v-if="sourceStatus && sourceStatus.status !== 'available'"
        class="asset-source-status"
        :title="t('media.card.offlineHelp')"
        >{{
          t(
            `media.card.${sourceStatus.status === "missing" ? "offline" : "inaccessible"}`,
          )
        }}</span
      >
      <span
        v-if="asset.state.locked"
        class="asset-lock-mark"
        :aria-label="t('media.card.lockedState')"
        :title="t('media.card.lockedState')"
        ><Icon name="lock" :size="14"
      /></span>
      <span
        v-if="asset.state.favorite"
        class="asset-favorite-mark"
        :aria-label="t('media.card.favoriteState')"
        :title="t('media.card.favoriteState')"
        ><Icon name="heart" :size="14"
      /></span>
      <span v-if="choice" class="choice-mark"
        ><Icon v-if="chosen" name="check" :size="14" /><span v-else
          >+</span
        ></span
      >
    </button>
    <div class="asset-caption">
      <span class="asset-name" :title="asset.name">{{ asset.name }}</span>
    </div>
    <div v-if="!choice" class="asset-actions">
      <button
        :class="{ active: asset.state.favorite }"
        :aria-label="
          t(`media.card.${asset.state.favorite ? 'unfavorite' : 'favorite'}`, {
            name: asset.name,
          })
        "
        :aria-pressed="!!asset.state.favorite"
        :disabled="mutationDisabled"
        @click="$emit('toggle', asset, 'favorite')"
      >
        <Icon name="heart" :size="15" />
      </button>
      <button
        :class="{ active: asset.state.locked }"
        :aria-label="
          t(`media.card.${asset.state.locked ? 'unlock' : 'lock'}`, {
            name: asset.name,
          })
        "
        :aria-pressed="!!asset.state.locked"
        :disabled="mutationDisabled"
        @click="$emit('toggle', asset, 'locked')"
      >
        <Icon name="lock" :size="15" />
      </button>
      <button
        :class="{ active: asset.state.rejected }"
        :aria-label="
          t(`media.card.${asset.state.rejected ? 'restore' : 'reject'}`, {
            name: asset.name,
          })
        "
        :aria-pressed="!!asset.state.rejected"
        :disabled="mutationDisabled"
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
