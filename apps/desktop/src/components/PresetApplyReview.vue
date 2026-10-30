<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  filmLookMatrix,
  resolveFilmLook,
  resolveTitleStyle,
  type TitleStyle,
} from "@openfilm/core";
import type {
  OpenFilmProject,
  PresetApplyInput,
  PresetEntry,
  StoryPlanAcceptanceMapping,
} from "@openfilm/core";
import type {
  PresetRegistryPackage,
  PresetApplyReview as ApplicationReview,
  PresetAcceptance,
} from "@openfilm/application";
import { api } from "../api";
import { localizeError } from "../i18n";
import { createPresetTaskScope } from "../local-presets";
import StoryPlanReviewModal from "./StoryPlanReviewModal.vue";
const props = defineProps<{
  project: OpenFilmProject;
  activeCompositionId?: string;
  package: PresetRegistryPackage;
  entry: PresetEntry;
  registryRevision: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ close: []; applied: [result: PresetAcceptance] }>();
const { t } = useI18n();
const tasks = createPresetTaskScope(),
  compositionId = ref(
    props.activeCompositionId || props.project.timelines[0]?.id || "",
  ),
  lookScope = ref<"film" | "beat" | "clip">("film"),
  beatId = ref(""),
  clipId = ref(""),
  storyId = ref(props.project.stories[0]?.id ?? ""),
  bindings = ref<string[]>([]),
  review = ref<ApplicationReview>(),
  requestId = ref(""),
  working = ref(false),
  error = ref<unknown>();
const composition = computed(() =>
    props.project.timelines.find((c) => c.id === compositionId.value),
  ),
  sourceStory = computed(() =>
    props.project.stories.find((s) => s.id === storyId.value),
  ),
  compositionStory = computed(() =>
    props.project.stories.find((s) => s.id === composition.value?.storyId),
  ),
  clips = computed(
    () =>
      composition.value?.tracks
        .filter((t) => t.type !== "audio" && t.type !== "music")
        .flatMap((t) => t.clips) ?? [],
  ),
  recipeBeats = computed(() =>
    props.entry.kind === "story" ? props.entry.recipe.beats : [],
  );
const visualChangeCount = computed(() => {
  const result = review.value;
  const target = result?.request.target;
  if (!result?.document || target?.kind !== "film-look") return undefined;
  const before = props.project.timelines.find(
      (c) => c.id === target.compositionId,
    ),
    after = result.document.composition;
  if (!before) return undefined;
  let count = 0;
  for (const track of before.tracks.filter(
    (t) => t.type === "video" || t.type === "overlay",
  ))
    for (const clip of track.clips) {
      const next = after.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === clip.id);
      if (next) {
        const previousMatrix = filmLookMatrix(
          resolveFilmLook(before, clip).look,
        );
        const nextMatrix = filmLookMatrix(resolveFilmLook(after, next).look);
        if (previousMatrix.some((value, index) => value !== nextMatrix[index]))
          count++;
      }
    }
  return count;
});
const titleComparison = computed(() => {
  const result = review.value;
  if (
    !result ||
    result.snapshot.kind !== "title" ||
    result.request.target.kind !== "title"
  )
    return undefined;
  const target = result.request.target,
    clip = props.project.timelines
      .find((c) => c.id === target.compositionId)
      ?.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === target.clipId);
  if (!clip) return undefined;
  return {
    before: resolveTitleStyle(clip.titleStyle, props.project.settings),
    after: resolveTitleStyle(
      result.snapshot.recipe as TitleStyle,
      props.project.settings,
    ),
  };
});
// Resolve defaults through the actual title owner, then disclose each changed
// leaf as escaped text. This also covers nested finishing without raw JSON/CSS.
const titleChanges = computed(() => {
  if (!titleComparison.value) return [];
  const leaves = (
    value: unknown,
    prefix = "",
    out = new Map<string, string | number>(),
  ) => {
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (key === "version" || key === "bottomSafeMargin") continue;
        leaves(child, prefix ? `${prefix}.${key}` : key, out);
      }
    else if (typeof value === "string" || typeof value === "number")
      out.set(prefix, value);
    return out;
  };
  const before = leaves(titleComparison.value.before),
    after = leaves(titleComparison.value.after);
  const display = (key: string, value: string | number | undefined) => {
    if (value === undefined) return t("presets.noValue");
    if (["role", "align", "background", "position"].includes(key))
      return t(`presets.titleValues.${value}`);
    return String(value);
  };
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => before.get(key) !== after.get(key))
    .map((key) => ({
      key,
      before: display(key, before.get(key)),
      after: display(key, after.get(key)),
    }));
});
function clear() {
  tasks.cancel();
  working.value = false;
  review.value = undefined;
  requestId.value = "";
  error.value = undefined;
}
watch(
  composition,
  () => {
    beatId.value = compositionStory.value?.beats[0]?.id ?? "";
    clipId.value = clips.value[0]?.id ?? "";
  },
  { immediate: true },
);
watch(
  sourceStory,
  () => {
    bindings.value = recipeBeats.value.map(
      (_, i) => sourceStory.value?.beats[i]?.id ?? "",
    );
  },
  { immediate: true },
);
watch(
  () =>
    JSON.stringify([
      props.project.id,
      props.entry.id,
      compositionId.value,
      lookScope.value,
      beatId.value,
      clipId.value,
      storyId.value,
      bindings.value,
    ]),
  clear,
);
const canReview = computed(
  () =>
    !working.value &&
    !props.disabled &&
    (props.entry.kind === "story"
      ? !!sourceStory.value &&
        bindings.value.length === sourceStory.value.beats.length &&
        bindings.value.every(Boolean)
      : !!composition.value &&
        (props.entry.kind !== "title" || !!clipId.value)),
);
async function makeReview() {
  if (!canReview.value) return;
  clear();
  const run = tasks.begin();
  working.value = true;
  try {
    const entry = props.entry,
      p = props.package;
    let target: PresetApplyInput["target"], baseRevision: string;
    if (entry.kind === "story") {
      const revision = await api.projectVersionRevision(run.signal);
      if (!run.current() || revision.projectId !== props.project.id) return;
      baseRevision = revision.revision;
      target = {
        kind: "story",
        storyId: storyId.value,
        bindings: entry.recipe.beats.map((b, i) => ({
          recipeBeatKey: b.key,
          beatId: bindings.value[i]!,
        })),
        options: { ...entry.recipe.defaults, transition: "cut" },
      };
    } else {
      const state = await api.editor(compositionId.value, run.signal);
      if (!run.current()) return;
      baseRevision = state.revision;
      target =
        entry.kind === "title"
          ? {
              kind: "title",
              compositionId: compositionId.value,
              clipId: clipId.value,
            }
          : lookScope.value === "film"
            ? {
                kind: "film-look",
                compositionId: compositionId.value,
                scope: "film",
              }
            : lookScope.value === "beat"
              ? {
                  kind: "film-look",
                  compositionId: compositionId.value,
                  scope: "beat",
                  beatId: beatId.value,
                }
              : {
                  kind: "film-look",
                  compositionId: compositionId.value,
                  scope: "clip",
                  clipId: clipId.value,
                };
    }
    const request: PresetApplyInput = {
      projectId: props.project.id,
      selection: {
        canonicalId: p.entrySummaries.find((e) => e.id === entry.id)!
          .canonicalId,
        packageSha256: p.packageSha256,
        registryRevision: props.registryRevision,
      },
      baseRevision,
      target,
    };
    const result = await api.reviewPresetApplication(request, run.signal);
    if (run.current()) {
      review.value = result;
      requestId.value = crypto.randomUUID();
    }
  } catch (cause) {
    if (run.current()) error.value = cause;
  } finally {
    if (run.current()) working.value = false;
  }
}
async function commitReview(): Promise<PresetAcceptance> {
  if (!review.value || working.value || props.disabled)
    throw new Error(t("presets.reviewFirst"));
  const original = review.value,
    run = tasks.begin();
  working.value = true;
  error.value = undefined;
  try {
    const result = await api.acceptPresetApplication(
      {
        request: original.request,
        reviewSha256: original.reviewSha256,
        requestId: requestId.value,
      },
      run.signal,
    );
    if (!run.current() || result.receipt.projectId !== props.project.id)
      throw new DOMException("Review is no longer active", "AbortError");
    return result;
  } finally {
    if (run.current()) working.value = false;
  }
}
async function accept() {
  try {
    emit("applied", await commitReview());
  } catch (cause) {
    if ((cause as Error).name !== "AbortError") error.value = cause;
  }
}
async function acceptStory() {
  const result = await commitReview();
  if (!result.state || !review.value?.plan)
    throw new Error(t("presets.reviewFirst"));
  const { story, composition } = result.state,
    source = story.presetPlanSource;
  const mapping: StoryPlanAcceptanceMapping = {
    storyId: story.id,
    compositionId: composition.id,
    acceptedAt: result.receipt.acceptedAt,
    sceneToBeatId: {},
    sceneToClipIds: {},
  };
  for (const b of source?.bindings ?? []) {
    const scene = review.value.plan.scenes.find(
      (s) => s.beatId === b.sourceBeatId,
    );
    if (scene) {
      mapping.sceneToBeatId[scene.sceneId] = b.beatId;
      mapping.sceneToClipIds[scene.sceneId] = composition.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.beatId === b.beatId)
        .map((c) => c.id);
    }
  }
  emit("applied", result);
  return { story, composition, acceptanceMapping: mapping };
}
function close() {
  clear();
  emit("close");
}
onBeforeUnmount(() => tasks.cancel());
</script>
<template>
  <section
    class="preset-apply"
    :aria-label="t('presets.applicationReview')"
    @keydown.esc.stop.prevent="close"
  >
    <h4>{{ entry.name }} · {{ package.version }}</h4>
    <p>{{ t("presets.applyHint") }}</p>
    <template v-if="entry.kind === 'story'">
      <label
        >{{ t("presets.story")
        }}<select v-model="storyId" :disabled="working || disabled">
          <option v-for="s in project.stories" :key="s.id" :value="s.id">
            {{ s.title }}
          </option>
        </select></label
      >
      <p>{{ t("presets.mappingHint") }}</p>
      <label v-for="(beat, index) in recipeBeats" :key="beat.key"
        >{{
          beat.text[project.projectContentLocale ?? "en-US"]?.title ??
          beat.text[
            entry.kind === "story" ? entry.recipe.defaultLocale : "en-US"
          ]?.title ??
          beat.key
        }}<select v-model="bindings[index]" :disabled="working || disabled">
          <option value="">{{ t("presets.chooseBeat") }}</option>
          <option
            v-for="b in sourceStory?.beats ?? []"
            :key="b.id"
            :value="b.id"
          >
            {{ b.title }}
          </option>
        </select></label
      >
    </template>
    <template v-else>
      <label
        >{{ t("presets.film")
        }}<select v-model="compositionId" :disabled="working || disabled">
          <option v-for="c in project.timelines" :key="c.id" :value="c.id">
            {{ project.stories.find((s) => s.id === c.storyId)?.title ?? c.id }}
          </option>
        </select></label
      >
      <label v-if="entry.kind === 'film-look'"
        >{{ t("presets.scope")
        }}<select v-model="lookScope" :disabled="working || disabled">
          <option value="film">{{ t("looks.film") }}</option>
          <option value="beat">{{ t("looks.beat") }}</option>
          <option value="clip">{{ t("looks.clip") }}</option>
        </select></label
      >
      <label v-if="entry.kind === 'film-look' && lookScope === 'beat'"
        >{{ t("presets.scene")
        }}<select v-model="beatId" :disabled="working || disabled">
          <option
            v-for="b in compositionStory?.beats ?? []"
            :key="b.id"
            :value="b.id"
          >
            {{ b.title }}
          </option>
        </select></label
      >
      <label v-if="entry.kind === 'title' || lookScope === 'clip'"
        >{{ t("presets.clip")
        }}<select v-model="clipId" :disabled="working || disabled">
          <option v-for="c in clips" :key="c.id" :value="c.id">
            {{ c.title ?? c.id }}
          </option>
        </select></label
      >
    </template>
    <p v-if="error" role="alert">{{ localizeError(error) }}</p>
    <p v-if="working" role="status">{{ t("presets.working") }}</p>
    <div class="preset-actions">
      <button type="button" :disabled="!canReview" @click="makeReview">
        {{ t("presets.previewChanges") }}</button
      ><button type="button" @click="close">{{ t("presets.cancel") }}</button>
    </div>
    <section v-if="review && !review.plan" class="preset-result">
      <p>{{ t("presets.exactChange", { name: review.snapshot.name }) }}</p>
      <p v-if="visualChangeCount !== undefined">
        {{ t("presets.visualChangeCount", { count: visualChangeCount }) }}
      </p>
      <table v-if="titleComparison" class="preset-comparison">
        <caption>
          {{
            t("presets.titleComparison")
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t("presets.property") }}</th>
            <th scope="col">{{ t("presets.before") }}</th>
            <th scope="col">{{ t("presets.after") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{{ t("presets.font") }}</th>
            <td>
              {{ titleComparison.before.fontFamily }} ·
              {{ titleComparison.before.fontSize }} px
            </td>
            <td>
              {{ titleComparison.after.fontFamily }} ·
              {{ titleComparison.after.fontSize }} px
            </td>
          </tr>
          <tr>
            <th scope="row">{{ t("presets.position") }}</th>
            <td>
              {{ t(`presets.positions.${titleComparison.before.position}`) }}
            </td>
            <td>
              {{ t(`presets.positions.${titleComparison.after.position}`) }}
            </td>
          </tr>
          <tr v-for="change in titleChanges" :key="change.key">
            <th scope="row">
              {{ t(`presets.titleProperties.${change.key}`) }}
            </th>
            <td>{{ change.before }}</td>
            <td>{{ change.after }}</td>
          </tr>
        </tbody>
      </table>
      <p>{{ t("presets.undoHint") }}</p>
      <details>
        <summary>{{ t("presets.identity") }}</summary>
        <code>{{ review.snapshot.canonicalId }}</code
        ><code>{{ review.reviewSha256 }}</code>
      </details>
      <button type="button" :disabled="working || disabled" @click="accept">
        {{ t("presets.accept") }}
      </button>
    </section>
    <p v-for="warning in review?.warnings ?? []" :key="warning" role="status">
      {{ t(warning) }}
    </p>
    <StoryPlanReviewModal
      v-if="review?.plan && review.compositionPreview && sourceStory"
      :show="true"
      :story-id="sourceStory.id"
      :story="sourceStory"
      :preset-preview="{
        plan: review.plan,
        compositionPreview: review.compositionPreview,
      }"
      :preset-accept="acceptStory"
      @close="clear"
    />
  </section>
</template>
<style scoped>
.preset-apply {
  display: grid;
  gap: var(--of-space-3);
  padding-block: var(--of-space-4);
  border-block-start: 1px solid var(--of-border-subtle);
  min-width: 0;
}
.preset-apply :is(h4, p) {
  margin: 0;
  overflow-wrap: anywhere;
}
.preset-apply label {
  display: grid;
  gap: var(--of-space-2);
}
.preset-apply select {
  max-width: 100%;
  min-width: 0;
  width: 100%;
}
.preset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-2);
}
.preset-result {
  display: grid;
  gap: var(--of-space-3);
}
.preset-comparison {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: var(--of-font-caption);
}
.preset-comparison :is(th, td) {
  text-align: start;
  vertical-align: top;
  padding: var(--of-space-2);
  overflow-wrap: anywhere;
  border-block-end: 1px solid var(--of-border-subtle);
}
.preset-comparison caption {
  text-align: start;
}
.preset-apply code {
  display: block;
  overflow-wrap: anywhere;
  font-size: var(--of-font-caption);
}
.preset-apply button {
  min-height: 36px;
  white-space: normal;
}
@media (pointer: coarse) {
  .preset-apply button {
    min-height: 44px;
  }
}
</style>
