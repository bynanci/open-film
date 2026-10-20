<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Composition } from "@openfilm/core";
import type { HandoffMode } from "@openfilm/exporters";
import type { HandoffReview, HandoffPublication } from "@openfilm/application";
import { post, handoffDownloadUrl } from "../api";
const props = defineProps<{
  projectId: string;
  composition: Composition;
  busy: boolean;
}>();
const { t } = useI18n();
const mode = ref<HandoffMode>("preserve-editability"),
  bakeAudio = ref(false);
const captionChoice = ref("");
const review = shallowRef<HandoffReview>(),
  publication = shallowRef<HandoffPublication>();
const loading = ref(false),
  failed = ref(false),
  cancelled = ref(false),
  page = ref(0);
let generation = 0,
  controller = new AbortController();
function invalidate() {
  generation++;
  controller.abort();
  controller = new AbortController();
  loading.value = false;
  review.value = undefined;
  publication.value = undefined;
  failed.value = false;
  cancelled.value = false;
  page.value = 0;
}
watch(
  () =>
    JSON.stringify([
      props.projectId,
      props.composition,
      mode.value,
      bakeAudio.value,
      captionChoice.value,
    ]),
  invalidate,
);
watch(
  () => [props.projectId, props.composition.id],
  () => {
    captionChoice.value = "";
  },
);
onBeforeUnmount(invalidate);
const items = computed(
  () =>
    review.value?.plan.items.slice(page.value * 20, (page.value + 1) * 20) ??
    [],
);
const archiveIndex = computed(
  () =>
    publication.value?.files.findIndex((f) => f.name === "handoff.tar") ?? -1,
);
async function run(publish = false) {
  const current = ++generation;
  loading.value = true;
  failed.value = false;
  cancelled.value = false;
  try {
    const result = await post<HandoffReview | HandoffPublication>(
      publish ? "/handoff/export" : "/handoff/review",
      {
        projectId: props.projectId,
        compositionId: props.composition.id,
        mode: mode.value,
        bakeAudio: bakeAudio.value,
        ...(captionChoice.value
          ? {
              captionTrackId:
                captionChoice.value === "__none__" ? null : captionChoice.value,
            }
          : {}),
        ...(publish ? { revision: review.value?.revision } : {}),
      },
      controller.signal,
    );
    if (current !== generation) return;
    if (publish) publication.value = result as HandoffPublication;
    else review.value = result as HandoffReview;
  } catch {
    if (current === generation) failed.value = true;
  } finally {
    if (current === generation) loading.value = false;
  }
}
function cancel() {
  invalidate();
  cancelled.value = true;
}
</script>
<template>
  <section class="handoff" :aria-label="t('nleHandoff.title')">
    <h3>{{ t("nleHandoff.title") }}</h3>
    <p>{{ t("nleHandoff.description") }}</p>
    <label
      >{{ t("nleHandoff.mode") }}
      <select v-model="mode" :disabled="busy || loading">
        <option value="preserve-editability">
          {{ t("nleHandoff.editability") }}
        </option>
        <option value="preserve-visual-fidelity">
          {{ t("nleHandoff.fidelity") }}
        </option>
      </select>
    </label>
    <label
      ><input
        v-model="bakeAudio"
        type="checkbox"
        :disabled="busy || loading"
      />{{ t("nleHandoff.mix") }}</label
    >
    <label v-if="composition.captionTracks?.length"
      >{{ t("nleHandoff.captionLanguage") }}
      <select v-model="captionChoice" :disabled="busy || loading">
        <option value="">{{ t("nleHandoff.captionDefault") }}</option>
        <option value="__none__">{{ t("nleHandoff.captionNone") }}</option>
        <option
          v-for="track in composition.captionTracks"
          :key="track.id"
          :value="track.id"
        >
          {{ track.name }}
        </option>
      </select>
    </label>
    <p>{{ t("nleHandoff.limits") }}</p>
    <button type="button" :disabled="busy || loading" @click="run()">
      {{ t("nleHandoff.review") }}
    </button>
    <button v-if="loading" type="button" @click="cancel">
      {{ t("nleHandoff.cancel") }}
    </button>
    <p v-if="loading" role="status">{{ t("nleHandoff.working") }}</p>
    <p v-if="failed" role="alert">{{ t("nleHandoff.failed") }}</p>
    <p v-if="cancelled" role="status">{{ t("nleHandoff.cancelled") }}</p>
    <template v-if="review">
      <p>{{ t("nleHandoff.manual") }}</p>
      <ul>
        <li v-for="(item, index) in items" :key="`${page}-${index}`">
          <strong>{{ t(`nleHandoff.features.${item.feature}`) }}</strong>
          <span>
            · {{ item.ownerId }} · {{ item.startFrame }}–{{
              item.endFrame
            }}</span
          >
          <p>{{ t(`nleHandoff.dispositions.${item.disposition}`) }}</p>
        </li>
      </ul>
      <nav
        v-if="review.plan.items.length > 20"
        :aria-label="t('nleHandoff.pages')"
      >
        <button :disabled="page === 0" @click="page--">
          {{ t("nleHandoff.previous") }}
        </button>
        <button
          :disabled="(page + 1) * 20 >= review.plan.items.length"
          @click="page++"
        >
          {{ t("nleHandoff.next") }}
        </button>
      </nav>
      <button :disabled="busy || loading" @click="run(true)">
        {{ t("nleHandoff.publish") }}
      </button>
    </template>
    <a
      v-if="publication && archiveIndex >= 0"
      :href="handoffDownloadUrl(projectId, publication.id, archiveIndex)"
      download="handoff.tar"
      >{{ t("nleHandoff.download") }}</a
    >
  </section>
</template>
<style scoped>
.handoff {
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-lg);
  padding: 20px;
  margin-block: 20px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
label {
  display: block;
  margin-block: 12px;
}
select {
  display: block;
  max-width: 100%;
  margin-block: 8px;
}
input {
  margin-inline-end: 8px;
}
button,
a {
  margin-inline-end: 12px;
  margin-block: 8px;
  padding: 10px 14px;
  border: 1px solid var(--of-border-strong);
  border-radius: var(--of-radius-sm);
  min-height: 44px;
  display: inline-block;
}
li {
  margin-block: 12px;
}
li p {
  margin-block: 0;
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
button:focus-visible,
a:focus-visible,
select:focus-visible,
input:focus-visible {
  outline: 2px solid var(--of-accent);
  outline-offset: 3px;
}
</style>
