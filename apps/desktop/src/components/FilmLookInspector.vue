<script setup lang="ts">
// SPDX-License-Identifier: GPL-3.0-only

import { computed } from "vue";
import { resolveFilmLook, type Composition, type Clip } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import { useI18n } from "vue-i18n";
import FilmLookSelect from "./FilmLookSelect.vue";
const props = defineProps<{
  composition: Composition;
  clip: Clip;
  disabled?: boolean;
  clipProtected?: boolean;
  clipEligible: boolean;
}>();
const emit = defineEmits<{ command: [command: TimelineCommand] }>();
const { t } = useI18n();
const resolved = computed(() => resolveFilmLook(props.composition, props.clip));
const sceneLook = computed(
  () =>
    props.composition.beatLooks?.find(
      (entry) => entry.beatId === props.clip.beatId,
    )?.look,
);
</script>
<template>
  <div
    class="film-look-inspector"
    role="group"
    :aria-label="t('looks.heading')"
  >
    <h3>{{ t("looks.heading") }}</h3>
    <p class="film-look-description">{{ t("looks.description") }}</p>
    <FilmLookSelect
      :label="t('looks.film')"
      :value="composition.defaultLook"
      :disabled="disabled"
      @change="emit('command', { type: 'look', scope: 'film', look: $event })"
    />
    <FilmLookSelect
      v-if="clipEligible && clip.beatId"
      :label="t('looks.beat')"
      :value="sceneLook"
      inherit
      :disabled="disabled"
      @change="
        emit('command', {
          type: 'look',
          scope: 'beat',
          beatId: clip.beatId,
          look: $event,
        })
      "
    />
    <FilmLookSelect
      v-if="clipEligible"
      :label="t('looks.clip')"
      :value="clip.look"
      inherit
      :disabled="disabled || clipProtected"
      @change="
        emit('command', {
          type: 'look',
          scope: 'clip',
          clipId: clip.id,
          look: $event,
        })
      "
    />
    <p v-if="clipEligible" class="film-look-resolved" role="status">
      {{
        t("looks.resolved", {
          preset: t(`looks.presets.${resolved.look.preset}`),
          source: t(`looks.sources.${resolved.source}`),
        })
      }}
    </p>
    <p v-if="clipEligible && clipProtected" class="film-look-description">
      {{ t("looks.protected") }}
    </p>
    <p class="film-look-description">{{ t("looks.previewNote") }}</p>
  </div>
</template>
<style scoped>
.film-look-inspector {
  display: grid;
  gap: var(--of-space-3);
  padding-block: var(--of-space-4);
  border-block: 1px solid var(--of-border-subtle);
  margin-block: var(--of-space-4);
  min-width: 0;
}
.film-look-inspector h3 {
  margin: 0;
  font-size: var(--of-font-small);
}
.film-look-description,
.film-look-resolved {
  margin: 0;
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
  overflow-wrap: anywhere;
}
.film-look-resolved {
  color: var(--of-text-primary);
}
</style>
