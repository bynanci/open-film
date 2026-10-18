<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  assetDisplayDimensions,
  resolvePhotoPlan,
  type Clip,
  type ProjectSettings,
} from "@openfilm/core";
import { applyTimelineCommand, type EditorDocument } from "@openfilm/solver";
import {
  api,
  ApiError,
  type DirectionReviewPlan,
  type DirectionReviewAcceptance,
  type EditorState,
  type SceneDirectionOptions,
} from "../api";
import { formatDuration } from "../i18n";

const props = defineProps<{
  projectId: string;
  compositionId: string;
  state: EditorState;
  clip: Clip;
  frame: ProjectSettings;
  disabled?: boolean;
  sourceVersion?: number;
  flushInputs: () => Promise<boolean>;
  reloadSaved: () => Promise<boolean>;
}>();
const emit = defineEmits<{ preview: [clip: Clip | null]; edited: [] }>();
const { t, locale } = useI18n();
const plan = ref<DirectionReviewPlan | null>(null);
const included = ref<string[]>([]);
const scope = ref<"selected" | "scene">("selected");
const replaceExisting = ref(false);
const busy = ref(false);
const stale = ref(false);
const error = ref<
  | "failed"
  | "stale"
  | "uncertain"
  | "storage"
  | "reload"
  | "reopen"
  | "selection"
  | ""
>("");
const previewId = ref("");
const reopenRequired = ref(false);
const expanded = ref(false);
const storageKey = `openfilm.direction-acceptance:${props.projectId}:${props.compositionId}`;
type PendingAcceptance = {
  version: 1;
  projectId: string;
  compositionId: string;
  plan: DirectionReviewPlan;
  payload: DirectionReviewAcceptance;
};
const pending = ref<PendingAcceptance | null>(null);
let generation = 0;
let disposed = false;
const beat = computed(() =>
  props.state.story.beats.find((item) => item.id === props.clip.beatId),
);
const sourceText = computed(() => beat.value?.script?.visualDirection ?? "");
const scenePhotos = computed(() => {
  const photos = new Set(
    props.state.assets
      .filter((asset) => asset.mediaType === "image")
      .map((asset) => asset.id),
  );
  return props.state.composition.tracks
    .filter((track) => track.type === "video")
    .flatMap((track) => track.clips)
    .filter(
      (clip) => clip.beatId === props.clip.beatId && photos.has(clip.assetId),
    )
    .map((clip) => clip.id);
});
const hasPending = computed(
  () => busy.value || (!!pending.value && !reopenRequired.value),
);
const blocksEdits = computed(() => busy.value || !!pending.value);
const selectedActions = computed(
  () =>
    plan.value?.actions.filter((action) =>
      included.value.includes(action.id),
    ) ?? [],
);
function simulate(actions: DirectionReviewPlan["actions"]) {
  let next: EditorDocument = JSON.parse(JSON.stringify(props.state));
  for (const action of actions)
    next = applyTimelineCommand(next, props.state.assets, action.command);
  const sources = Object.fromEntries(
    props.state.assets.flatMap((asset) => {
      const dimensions = assetDisplayDimensions(asset);
      return dimensions ? [[asset.id, dimensions]] : [];
    }),
  );
  const touched = new Set(actions.map((action) => action.clipId));
  for (const clip of next.composition.tracks.flatMap((track) => track.clips)) {
    if (
      touched.has(clip.id) &&
      resolvePhotoPlan(clip, sources, props.frame).warnings.length
    )
      throw new Error("The selected recipe needs a presentation fallback");
  }
  return next;
}
const selectionNeedsReview = computed(() => {
  if (!selectedActions.value.length) return false;
  try {
    simulate(selectedActions.value);
    return false;
  } catch {
    return true;
  }
});
function clearPreview() {
  previewId.value = "";
  emit("preview", null);
}
watch(included, () => {
  if (previewId.value) clearPreview();
  if (error.value === "selection") error.value = "";
});
function resetReview() {
  generation++;
  clearPreview();
  if (pending.value) return;
  plan.value = null;
  included.value = [];
  stale.value = false;
  error.value = "";
}
watch(
  [() => props.clip.id, () => props.clip.beatId, () => props.sourceVersion],
  resetReview,
);
watch(
  () => props.state.revision,
  () => {
    clearPreview();
    if (plan.value && !pending.value) stale.value = true;
  },
);
watch([scope, replaceExisting], resetReview);
try {
  const raw = localStorage.getItem(storageKey);
  if (raw) {
    const recovered = JSON.parse(raw) as PendingAcceptance;
    if (
      recovered.version !== 1 ||
      recovered.projectId !== props.projectId ||
      recovered.compositionId !== props.compositionId ||
      !recovered.payload?.requestId ||
      recovered.plan?.id !== recovered.payload.planId ||
      !Array.isArray(recovered.plan.actions) ||
      !Array.isArray(recovered.payload.actionIds)
    )
      throw new Error("Invalid direction acceptance");
    pending.value = recovered;
    expanded.value = true;
    plan.value = recovered.plan;
    included.value = recovered.payload.actionIds;
    scope.value =
      recovered.payload.options.clipIds.length > 1 ? "scene" : "selected";
    replaceExisting.value = !!recovered.payload.options.replaceExisting;
    error.value = "uncertain";
  }
} catch {
  // A broken storage record must never be sent or silently replaced.
  error.value = "storage";
}
async function generate() {
  if (
    busy.value ||
    pending.value ||
    props.disabled ||
    !beat.value ||
    !sourceText.value.trim()
  )
    return;
  const run = ++generation;
  busy.value = true;
  clearPreview();
  error.value = "";
  try {
    if (!(await props.flushInputs()) || disposed || run !== generation) return;
    const options: SceneDirectionOptions = {
      beatId: beat.value!.id,
      clipIds:
        scope.value === "scene" ? [...scenePhotos.value] : [props.clip.id],
      replaceExisting: replaceExisting.value,
    };
    const next = await api.previewDirection(props.compositionId, options);
    if (next.baseRevision !== props.state.revision) {
      if (!(await props.reloadSaved()))
        throw new Error("The saved review context could not be loaded");
      await nextTick();
    }
    if (disposed || run !== generation) return;
    plan.value = next;
    included.value = next.actions.map((action) => action.id);
    stale.value = next.baseRevision !== props.state.revision;
    if (stale.value) error.value = "stale";
  } catch (cause) {
    if (!disposed && run === generation)
      error.value =
        cause instanceof ApiError && cause.status === 409 ? "stale" : "failed";
  } finally {
    if (!disposed) busy.value = false;
  }
}
function preview(action: DirectionReviewPlan["actions"][number]) {
  if (
    !plan.value ||
    busy.value ||
    pending.value ||
    stale.value ||
    !included.value.includes(action.id) ||
    props.disabled
  )
    return;
  if (previewId.value === action.id) return clearPreview();
  try {
    const next = simulate(
      selectedActions.value.filter((item) => item.clipId === action.clipId),
    );
    const clip = next.composition.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.id === action.clipId);
    if (!clip) throw new Error("Missing preview clip");
    previewId.value = action.id;
    if (error.value === "selection") error.value = "";
    emit("preview", clip);
  } catch {
    clearPreview();
    error.value = "selection";
  }
}
function skip(actionId: string) {
  included.value = included.value.filter((id) => id !== actionId);
  if (previewId.value === actionId) clearPreview();
}
function forgetPending() {
  localStorage.removeItem(storageKey);
  pending.value = null;
}
async function sendPending() {
  const retained = pending.value;
  if (!retained || busy.value) return;
  busy.value = true;
  clearPreview();
  error.value = "";
  try {
    // This exact payload was persisted before its first send and is reused after uncertainty.
    await api.acceptDirection(props.compositionId, retained.payload);
    if (disposed) return;
    if (!(await props.reloadSaved())) {
      error.value = "reload";
      return;
    }
    forgetPending();
    plan.value = null;
    included.value = [];
    stale.value = false;
    emit("edited");
  } catch (cause) {
    if (disposed) return;
    if (
      cause instanceof ApiError &&
      cause.status === 409 &&
      cause.code === "story.planConflict"
    ) {
      // The saved receipt can outlive the server's last acknowledged revision.
      // Reopening restores that revision before the exact request is retried.
      reopenRequired.value = true;
      error.value = "reopen";
    } else if (
      cause instanceof ApiError &&
      cause.status >= 400 &&
      cause.status < 500
    ) {
      try {
        forgetPending();
        if (cause.status === 409) await props.reloadSaved();
        stale.value = true;
        error.value = cause.status === 409 ? "stale" : "failed";
      } catch {
        error.value = "storage";
      }
    } else error.value = "uncertain";
  } finally {
    if (!disposed) busy.value = false;
  }
}
async function accept() {
  const reviewed = plan.value;
  if (
    !reviewed ||
    busy.value ||
    pending.value ||
    stale.value ||
    selectionNeedsReview.value ||
    props.disabled ||
    !selectedActions.value.length
  )
    return;
  busy.value = true;
  try {
    if (!(await props.flushInputs()) || disposed) return;
    if (
      plan.value !== reviewed ||
      reviewed.baseRevision !== props.state.revision ||
      stale.value
    ) {
      stale.value = true;
      error.value = "stale";
      clearPreview();
      return;
    }
    const retained: PendingAcceptance = {
      version: 1,
      projectId: props.projectId,
      compositionId: props.compositionId,
      plan: reviewed,
      payload: {
        planId: reviewed.id,
        baseRevision: reviewed.baseRevision,
        contextSignature: reviewed.contextSignature,
        options: reviewed.options,
        actionIds: [...included.value],
        requestId: crypto.randomUUID(),
      },
    };
    const serialized = JSON.stringify(retained);
    localStorage.setItem(storageKey, serialized);
    if (localStorage.getItem(storageKey) !== serialized)
      throw new Error("Direction acceptance could not be retained");
    pending.value = retained;
  } catch {
    error.value = "storage";
    return;
  } finally {
    busy.value = false;
  }
  if (pending.value) await sendPending();
}
function valueLabel(value: unknown, kind: "layout" | "motion") {
  const preset =
    value && typeof value === "object" && "preset" in value
      ? String(value.preset)
      : "";
  const supported =
    kind === "layout"
      ? ["contain", "hero", "diptych"]
      : ["hold", "push-in", "pan"];
  if (supported.includes(preset))
    return t(
      kind === "layout"
        ? `editor.presentation.${preset}`
        : `editor.presentation.motionPresets.${preset}`,
    );
  return t(
    value
      ? "editor.direction.existing"
      : kind === "layout"
        ? "editor.presentation.original"
        : "editor.direction.noMotion",
  );
}
function clipName(clipId: string) {
  const clip = props.state.composition.tracks
    .flatMap((track) => track.clips)
    .find((item) => item.id === clipId);
  return (
    props.state.assets.find((asset) => asset.id === clip?.assetId)?.name ??
    t("editor.media")
  );
}
function cancel() {
  if (blocksEdits.value) return;
  resetReview();
}
function flush() {
  return Promise.resolve(!hasPending.value);
}
defineExpose({ hasPending, blocksEdits, flush });
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  clearPreview();
});
</script>

<template>
  <details
    class="editor-direction-review"
    data-testid="scene-direction-review"
    :open="expanded"
    @toggle="expanded = ($event.target as HTMLDetailsElement).open"
  >
    <summary>{{ t("editor.direction.heading") }}</summary>
    <div class="editor-direction-content" :aria-busy="busy">
      <p class="editor-note">{{ t("editor.direction.help") }}</p>
      <label class="editor-field"
        >{{ t("editor.direction.source") }}
        <textarea
          :value="plan?.sourceText ?? sourceText"
          readonly
          rows="3"
          :aria-label="t('editor.direction.source')"
        />
      </label>
      <p class="editor-note">{{ t("editor.direction.limit") }}</p>
      <!-- Compiler phrases must stay executable in the expanded pseudo locale. -->
      <p class="editor-note" data-testid="direction-examples">
        {{
          locale === "en-XA"
            ? t("editor.direction.examples", {}, { locale: "en-US" })
            : t("editor.direction.examples")
        }}
      </p>
      <fieldset
        class="editor-direction-options"
        :disabled="busy || !!pending || disabled"
      >
        <label class="editor-field"
          >{{ t("editor.direction.scope") }}
          <select v-model="scope" :aria-label="t('editor.direction.scope')">
            <option value="selected">
              {{ t("editor.direction.selectedPhoto") }}
            </option>
            <option
              value="scene"
              :disabled="!scenePhotos.length || scenePhotos.length > 50"
            >
              {{
                t("editor.direction.scenePhotos", { count: scenePhotos.length })
              }}
            </option>
          </select>
        </label>
        <label class="editor-presentation-check"
          ><input
            v-model="replaceExisting"
            data-testid="direction-replace"
            type="checkbox"
          />{{ t("editor.direction.replace") }}</label
        >
        <p class="editor-note">{{ t("editor.direction.preserve") }}</p>
        <button
          class="editor-button"
          data-testid="direction-generate"
          type="button"
          :disabled="!sourceText.trim() || !beat"
          @click="generate"
        >
          {{
            t(busy ? "editor.direction.preparing" : "editor.direction.generate")
          }}
        </button>
      </fieldset>
      <p v-if="!sourceText.trim()" class="editor-note">
        {{ t("editor.direction.emptySource") }}
      </p>
      <p
        v-if="error"
        class="editor-presentation-warnings"
        role="alert"
        data-testid="direction-error"
      >
        {{
          error === "selection"
            ? t("editor.direction.selectionNeedsReview")
            : t(`editor.direction.errors.${error}`)
        }}
      </p>
      <template v-if="plan">
        <p class="editor-direction-timing">
          {{
            t("editor.direction.timing", {
              before: formatDuration(plan.beforeDuration, { fractional: true }),
              after: formatDuration(plan.afterDuration, { fractional: true }),
            })
          }}
        </p>
        <p v-if="!plan.actions.length" class="editor-note">
          {{ t("editor.direction.noActions") }}
        </p>
        <p
          v-if="selectionNeedsReview"
          class="editor-presentation-warnings"
          role="status"
          data-testid="direction-selection-warning"
        >
          {{ t("editor.direction.selectionNeedsReview") }}
        </p>
        <article
          v-for="action in plan.actions"
          :key="action.id"
          class="editor-direction-action"
          data-testid="direction-action"
          :data-action-id="action.id"
          :data-kind="action.kind"
          :data-clip-id="action.clipId"
        >
          <label class="editor-presentation-check"
            ><input
              v-model="included"
              :value="action.id"
              data-testid="direction-select"
              type="checkbox"
              :disabled="busy || !!pending || stale || disabled"
            /><span
              ><strong>{{
                t(`editor.direction.reasons.${action.reason}`)
              }}</strong
              ><small
                >{{ clipName(action.clipId) }} ·
                {{ t(`editor.direction.kinds.${action.kind}`) }}</small
              ></span
            ></label
          >
          <blockquote>{{ action.evidence }}</blockquote>
          <dl class="editor-direction-comparison">
            <div>
              <dt>{{ t("editor.direction.before") }}</dt>
              <dd>{{ valueLabel(action.before, action.kind) }}</dd>
            </div>
            <div>
              <dt>{{ t("editor.direction.after") }}</dt>
              <dd>{{ valueLabel(action.after, action.kind) }}</dd>
            </div>
          </dl>
          <div class="editor-actions">
            <button
              class="editor-button"
              type="button"
              data-testid="direction-preview"
              :disabled="
                busy ||
                !!pending ||
                stale ||
                disabled ||
                !included.includes(action.id)
              "
              :aria-pressed="previewId === action.id"
              @click="preview(action)"
            >
              {{ t("editor.direction.preview") }}</button
            ><button
              class="editor-button"
              type="button"
              data-testid="direction-skip"
              :disabled="
                busy ||
                !!pending ||
                stale ||
                disabled ||
                !included.includes(action.id)
              "
              @click="skip(action.id)"
            >
              {{ t("editor.direction.skip") }}
            </button>
          </div>
        </article>
        <ul v-if="plan.notes.length" class="editor-direction-notes">
          <li v-for="(note, index) in plan.notes" :key="index">
            {{ t(`editor.direction.notes.${note.code}`)
            }}<q
              v-if="
                note.text && ['unsupported', 'conflict'].includes(note.code)
              "
              >{{ note.text }}</q
            >
          </li>
        </ul>
        <div class="editor-actions">
          <button
            v-if="pending"
            class="editor-button primary"
            data-testid="direction-retry"
            type="button"
            :disabled="busy || reopenRequired"
            @click="sendPending"
          >
            {{ t("editor.direction.retry") }}</button
          ><button
            v-else
            class="editor-button primary"
            data-testid="direction-accept"
            type="button"
            :disabled="
              busy ||
              stale ||
              disabled ||
              !selectedActions.length ||
              selectionNeedsReview
            "
            @click="accept"
          >
            {{
              t("editor.direction.accept", { count: selectedActions.length })
            }}</button
          ><button
            class="editor-button"
            type="button"
            :disabled="blocksEdits"
            @click="cancel"
          >
            {{ t("editor.cancel") }}
          </button>
        </div>
      </template>
    </div>
  </details>
</template>
