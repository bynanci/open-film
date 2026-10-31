<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  api,
  ApiError,
  thumbnailUrl,
  type ScenePlan,
  type ScenePlanOptions,
} from "../api";
import { formatDuration, formatNumber, localizeError } from "../i18n";
import type {
  NativePlannerInputs,
  NativePlannerText,
} from "../native-draft-recovery";

const props = defineProps<{
  title: string;
  targetDuration: number;
  maxDuration: number;
  visibleAssetIds: string[];
  disabled: boolean;
  prepare: () => Promise<boolean>;
  acceptPlan: (plan: ScenePlan) => Promise<void>;
}>();
const emit = defineEmits<{
  close: [];
  working: [working: boolean];
  draft: [present: boolean];
}>();
const { t } = useI18n();
const title = ref(props.title);
const brief = ref("");
const groupBy = ref<ScenePlanOptions["groupBy"]>("category");
const scope = ref<"library" | "page">("library");
const target = ref<number | string>(props.targetDuration);
const maximum = ref<number | string>(props.maxDuration);
const transition = ref<ScenePlanOptions["transition"]>("cut");
const plan = ref<ScenePlan>();
const working = ref(false);
const failure = ref<unknown>();
const stale = ref(false);
const edited = ref(false);
const confirmDiscard = ref<"close" | "preview">();
const accepted = ref(false);
const formChanged = ref(false);
let generatedText: Record<string, string>[] = [];
function proposalText(): Record<string, string>[] {
  return (
    plan.value?.story.beats.map((beat) => ({
      title: beat.title,
      intent: beat.intent ?? "",
      narration: beat.script?.narration ?? "",
      visualDirection: beat.script?.visualDirection ?? "",
    })) ?? []
  );
}
function captureNativeDraft(): {
  inputs: NativePlannerInputs;
  text: NativePlannerText[];
} | null {
  if (!hasDraft.value) return null;
  const text = edited.value
    ? proposalText().flatMap((fields, index) =>
        Object.entries(fields).flatMap(([field, value]) =>
          generatedText[index]?.[field] !== undefined &&
          generatedText[index]![field] !== value
            ? [{ scene: index + 1, field, text: value }]
            : [],
        ),
      )
    : [];
  return {
    inputs: {
      title: title.value,
      brief: brief.value,
      groupBy: groupBy.value,
      scope: scope.value,
      target: target.value,
      maximum: maximum.value,
      transition: transition.value,
    },
    text,
  };
}
function restoreNativeDraft(inputs: NativePlannerInputs) {
  title.value = inputs.title;
  brief.value = inputs.brief;
  groupBy.value = inputs.groupBy;
  scope.value = inputs.scope;
  target.value = inputs.target;
  maximum.value = inputs.maximum;
  transition.value = inputs.transition;
  plan.value = undefined;
  generatedText = [];
  edited.value = false;
  accepted.value = false;
  formChanged.value = true;
}
defineExpose({ captureNativeDraft, restoreNativeDraft });
const hasDraft = computed(() => !!plan.value || formChanged.value);
const blocked = computed(() => working.value || props.disabled);
const failureMessage = computed(() =>
  stale.value ? t("scenePlan.stale") : localizeError(failure.value),
);
watch(hasDraft, (value) => emit("draft", value), { flush: "sync" });
onBeforeUnmount(() => emit("draft", false));
function changed() {
  formChanged.value = true;
  accepted.value = false;
}
function changedScript() {
  edited.value = true;
  accepted.value = false;
}
function beatClips(beatId: string) {
  return (
    plan.value?.composition.tracks.flatMap((track) =>
      track.clips.filter((clip) => clip.beatId === beatId),
    ) ?? []
  );
}
function beatDuration(beatId: string) {
  const clips = beatClips(beatId);
  return clips.length
    ? Math.max(
        ...clips.map((clip) => clip.timelineStart + clip.timelineDuration),
      ) - Math.min(...clips.map((clip) => clip.timelineStart))
    : 0;
}
function beatThumbnails(beatId: string) {
  return [...new Set(beatClips(beatId).map((clip) => clip.assetId))].slice(
    0,
    4,
  );
}
async function preview(confirmed = false) {
  if (blocked.value) return;
  if (plan.value && edited.value && !confirmed) {
    confirmDiscard.value = "preview";
    return;
  }
  working.value = true;
  try {
    if (!(await props.prepare())) return;
  } catch (cause) {
    failure.value = cause;
    return;
  } finally {
    working.value = false;
  }
  working.value = true;
  emit("working", true);
  failure.value = undefined;
  stale.value = false;
  confirmDiscard.value = undefined;
  try {
    const result = await api.previewScenePlan({
      title: title.value.trim(),
      brief: brief.value.trim(),
      groupBy: groupBy.value,
      targetDuration: Number(target.value),
      maxDuration: Number(maximum.value),
      transition: transition.value,
      ...(scope.value === "page" ? { assetIds: props.visibleAssetIds } : {}),
    });
    plan.value = result.plan;
    generatedText = proposalText();
    edited.value = false;
    accepted.value = false;
    formChanged.value = false;
  } catch (cause) {
    failure.value = cause;
  } finally {
    working.value = false;
    emit("working", false);
  }
}
async function accept() {
  if (blocked.value || !plan.value || formChanged.value) return;
  working.value = true;
  try {
    if (!(await props.prepare())) return;
  } catch (cause) {
    failure.value = cause;
    return;
  } finally {
    working.value = false;
  }
  working.value = true;
  emit("working", true);
  failure.value = undefined;
  stale.value = false;
  try {
    // Keep the same plan IDs on a failed/lost response. The application can
    // recognize an already committed receipt instead of creating another film.
    await props.acceptPlan(JSON.parse(JSON.stringify(plan.value)) as ScenePlan);
    plan.value = undefined;
    edited.value = false;
    formChanged.value = false;
    accepted.value = true;
  } catch (cause) {
    stale.value = cause instanceof ApiError && cause.code === "story.planStale";
    failure.value = cause;
  } finally {
    working.value = false;
    emit("working", false);
  }
}
function close() {
  if (blocked.value) return;
  if (hasDraft.value) confirmDiscard.value = "close";
  else emit("close");
}
function discard() {
  if (blocked.value) return;
  if (confirmDiscard.value === "preview") void preview(true);
  else emit("close");
}
</script>

<template>
  <section
    class="scene-planner"
    data-testid="scene-planner"
    :aria-label="t('scenePlan.heading')"
    :aria-busy="working"
  >
    <header class="scene-plan-heading">
      <div>
        <h2>{{ t("scenePlan.heading") }}</h2>
        <p>{{ t("scenePlan.description") }}</p>
      </div>
      <button
        type="button"
        class="text-button"
        :disabled="blocked"
        @click="close"
      >
        {{ t("scenePlan.close") }}
      </button>
    </header>
    <p class="scene-plan-evidence">{{ t("scenePlan.evidence") }}</p>
    <form class="scene-plan-form" @submit.prevent="preview()">
      <fieldset :disabled="blocked">
        <label class="field"
          >{{ t("scenePlan.title")
          }}<input
            v-model="title"
            data-testid="scene-plan-title"
            required
            maxlength="300"
            @input="changed"
        /></label>
        <label class="field scene-plan-wide"
          >{{ t("scenePlan.brief")
          }}<textarea
            v-model="brief"
            data-testid="scene-plan-brief"
            rows="2"
            maxlength="4000"
            :placeholder="t('scenePlan.briefHint')"
            @input="changed"
          />
        </label>
        <label class="field"
          >{{ t("scenePlan.grouping")
          }}<select
            v-model="groupBy"
            data-testid="scene-plan-grouping"
            @change="changed"
          >
            <option value="category">{{ t("scenePlan.category") }}</option>
            <option value="chronology">{{ t("scenePlan.chronology") }}</option>
          </select></label
        >
        <label class="field"
          >{{ t("scenePlan.scope")
          }}<select
            v-model="scope"
            data-testid="scene-plan-scope"
            @change="changed"
          >
            <option value="library">{{ t("scenePlan.allMedia") }}</option>
            <option value="page">
              {{
                t("scenePlan.visibleMedia", {
                  count: formatNumber(visibleAssetIds.length),
                })
              }}
            </option>
          </select></label
        >
        <label class="field"
          >{{ t("scenePlan.target")
          }}<input
            v-model.number="target"
            data-testid="scene-plan-target"
            type="number"
            min="1"
            step="any"
            required
            @input="changed"
        /></label>
        <label class="field"
          >{{ t("scenePlan.maximum")
          }}<input
            v-model.number="maximum"
            data-testid="scene-plan-maximum"
            type="number"
            min="1"
            step="any"
            required
            @input="changed"
        /></label>
        <label class="field"
          >{{ t("scenePlan.transition")
          }}<select
            v-model="transition"
            data-testid="scene-plan-transition"
            @change="changed"
          >
            <option value="cut">{{ t("scenePlan.cut") }}</option>
            <option value="crossfade">{{ t("scenePlan.crossfade") }}</option>
            <option value="dip-to-black">
              {{ t("scenePlan.dipToBlack") }}
            </option>
            <option value="dip-to-white">
              {{ t("scenePlan.dipToWhite") }}
            </option>
          </select></label
        >
      </fieldset>
      <button
        class="primary"
        data-testid="scene-plan-preview"
        :disabled="blocked"
      >
        {{ working ? t("scenePlan.working") : t("scenePlan.preview") }}
      </button>
    </form>
    <p
      v-if="failure"
      class="scene-plan-error"
      role="alert"
      data-testid="scene-plan-error"
    >
      {{ failureMessage }}
    </p>
    <div v-if="confirmDiscard" class="scene-plan-confirm" role="alert">
      <p>
        {{
          confirmDiscard === "close"
            ? t("scenePlan.discardWarning")
            : t("scenePlan.regenerateWarning")
        }}
      </p>
      <button
        type="button"
        class="secondary"
        :disabled="blocked"
        @click="confirmDiscard = undefined"
      >
        {{ t("scenePlan.keep") }}
      </button>
      <button
        type="button"
        class="secondary"
        data-testid="scene-plan-discard"
        :disabled="blocked"
        @click="discard"
      >
        {{
          confirmDiscard === "close"
            ? t("scenePlan.discard")
            : t("scenePlan.regenerate")
        }}
      </button>
    </div>
    <p
      v-if="accepted"
      class="scene-plan-success"
      role="status"
      data-testid="scene-plan-accepted"
    >
      {{ t("scenePlan.accepted") }}
    </p>
    <section
      v-if="plan"
      class="scene-plan-result"
      data-testid="scene-plan-result"
      :aria-label="t('scenePlan.review')"
    >
      <header class="scene-plan-heading">
        <div>
          <h3>{{ t("scenePlan.review") }}</h3>
          <p>{{ t("scenePlan.reviewHint") }}</p>
        </div>
        <strong
          class="scene-plan-duration"
          data-testid="scene-plan-duration"
          :data-duration="plan.composition.duration"
          :data-maximum="plan.story.maxDuration"
          >{{ formatDuration(plan.composition.duration) }} /
          {{ formatDuration(plan.story.maxDuration) }}</strong
        >
      </header>
      <p>
        {{
          t("scenePlan.timing", {
            target: formatDuration(plan.story.targetDuration),
            maximum: formatDuration(plan.story.maxDuration),
          })
        }}
      </p>
      <p v-if="plan.excludedAudioCount" class="scene-plan-evidence">
        {{
          t("scenePlan.audioExcluded", {
            count: formatNumber(plan.excludedAudioCount),
          })
        }}
      </p>
      <p v-if="formChanged" class="scene-plan-evidence" role="status">
        {{ t("scenePlan.previewAgain") }}
      </p>
      <article
        v-for="(beat, index) in plan.story.beats"
        :key="beat.id"
        class="scene-plan-scene"
        data-testid="scene-plan-scene"
        :data-beat-id="beat.id"
      >
        <div class="scene-plan-scene-heading">
          <span>{{ String(index + 1).padStart(2, "0") }}</span
          ><strong>{{
            t("scenePlan.sceneTiming", {
              actual: formatDuration(beatDuration(beat.id)),
              target: formatDuration(beat.targetDuration),
            })
          }}</strong
          ><small>{{
            t("scenePlan.candidates", {
              count: formatNumber(beat.candidateAssetIds?.length ?? 0),
            })
          }}</small>
        </div>
        <div class="scene-plan-thumbnails">
          <img
            v-for="assetId in beatThumbnails(beat.id)"
            :key="assetId"
            :src="thumbnailUrl(assetId)"
            :alt="t('scenePlan.memoryPreview')"
            loading="lazy"
            decoding="async"
            crossorigin="anonymous"
          />
        </div>
        <fieldset :disabled="blocked">
          <label class="field"
            >{{ t("scenePlan.sceneTitle")
            }}<input
              v-model="beat.title"
              data-testid="scene-plan-scene-title"
              maxlength="300"
              required
              @input="changedScript"
          /></label>
          <label class="field"
            >{{ t("scenePlan.intent")
            }}<textarea
              v-model="beat.intent"
              data-testid="scene-plan-scene-intent"
              rows="2"
              maxlength="4000"
              @input="changedScript"
            />
          </label>
          <template v-if="beat.script">
            <label class="field"
              >{{ t("scenePlan.narration")
              }}<textarea
                v-model="beat.script.narration"
                data-testid="scene-plan-scene-narration"
                rows="3"
                maxlength="8000"
                @input="changedScript"
              />
            </label>
            <label class="field"
              >{{ t("scenePlan.visualDirection")
              }}<textarea
                v-model="beat.script.visualDirection"
                data-testid="scene-plan-scene-visual-direction"
                rows="3"
                maxlength="8000"
                @input="changedScript"
              />
            </label>
          </template>
        </fieldset>
      </article>
      <button
        type="button"
        class="primary"
        data-testid="scene-plan-accept"
        :disabled="blocked || formChanged"
        @click="accept"
      >
        {{ t("scenePlan.accept") }}
      </button>
    </section>
  </section>
</template>

<style scoped>
.scene-planner {
  padding: var(--of-space-6);
  background: var(--of-surface-1);
  border-radius: var(--of-radius-lg);
  margin-bottom: var(--of-space-6);
  min-width: 0;
}
.scene-plan-heading {
  display: flex;
  gap: var(--of-space-4);
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--of-space-4);
}
.scene-plan-heading > div {
  min-width: 0;
}
.scene-plan-heading h2,
.scene-plan-heading h3 {
  overflow-wrap: anywhere;
}
.scene-plan-heading p,
.scene-plan-evidence {
  color: var(--of-text-secondary);
  line-height: 1.6;
}
.scene-plan-evidence {
  margin-block: var(--of-space-3);
}
fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
  display: grid;
  gap: var(--of-space-4);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.scene-plan-form {
  display: grid;
  gap: var(--of-space-4);
  margin-block: var(--of-space-5);
}
.scene-plan-wide {
  grid-column: 1 / -1;
}
.scene-plan-form > button,
.scene-plan-result > button {
  justify-self: start;
  white-space: normal;
}
.field {
  min-width: 0;
}
input,
textarea,
select {
  width: 100%;
  min-width: 0;
}
.scene-plan-result {
  border-top: 1px solid var(--of-border-subtle);
  padding-top: var(--of-space-6);
}
.scene-plan-duration {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}
.scene-plan-scene {
  padding-block: var(--of-space-5);
  border-bottom: 1px solid var(--of-border-subtle);
  margin-bottom: var(--of-space-4);
}
.scene-plan-scene-heading {
  display: flex;
  align-items: baseline;
  gap: var(--of-space-4);
  flex-wrap: wrap;
  margin-bottom: var(--of-space-3);
}
.scene-plan-thumbnails {
  display: flex;
  gap: var(--of-space-2);
  margin-bottom: var(--of-space-3);
  overflow: hidden;
}
.scene-plan-thumbnails img {
  width: 96px;
  height: 64px;
  object-fit: cover;
  border-radius: var(--of-radius-sm);
}
.scene-plan-scene-heading > span {
  color: var(--of-text-secondary);
}
.scene-plan-scene-heading > strong {
  font-variant-numeric: tabular-nums;
}
.scene-plan-confirm {
  padding: var(--of-space-4);
  background: var(--of-surface-2);
  display: flex;
  gap: var(--of-space-3);
  align-items: center;
  flex-wrap: wrap;
  margin-block: var(--of-space-4);
}
.scene-plan-confirm > p {
  flex: 1 1 100%;
}
.scene-plan-error {
  color: var(--of-danger);
  margin-block: var(--of-space-4);
}
.scene-plan-success {
  margin-top: var(--of-space-4);
}
@media (max-width: 1100px) {
  fieldset {
    grid-template-columns: minmax(0, 1fr);
  }
  .scene-plan-heading {
    flex-wrap: wrap;
  }
}
</style>
