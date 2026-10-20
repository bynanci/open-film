<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { MediaAsset, Clip, ProjectSettings } from "@openfilm/core";
import type { MotionGenerationReceipt } from "@openfilm/application";
import {
  api,
  graphicFrame,
  motionMediaUrl,
  sourceUrl,
  type EditorState,
} from "../api";
const props = defineProps<{
  projectId: string;
  compositionId: string;
  state: EditorState;
  clip: Clip;
  asset: MediaAsset;
  frame: ProjectSettings;
  disabled: boolean;
  sourceVersion?: number;
  flushInputs: () => Promise<boolean>;
}>();
const emit = defineEmits<{
  apply: [
    id: string,
    action: "import" | "restore",
    complete: (ok: boolean) => void,
  ];
}>();
const { t } = useI18n();
const provider = ref("local-motion-fixture"),
  prompt = ref(""),
  negative = ref(""),
  consent = ref(false),
  people = ref(true),
  reviewed = ref(false);
const candidates = ref<MotionGenerationReceipt[]>([]),
  videos = ref<MediaAsset[]>([]),
  selected = ref<string[]>([]),
  busy = ref(false),
  failed = ref(false),
  sceneId = ref(""),
  frameUrl = ref(""),
  compareTime = ref(0);
let epoch = 0,
  controller: AbortController | undefined,
  requestId: string | undefined;
const scene = computed(
  () =>
    props.state.composition.graphicScenes?.filter(
      (s) =>
        s.photoDepth &&
        s.nodes.length === 1 &&
        s.nodes[0]?.type === "image" &&
        s.nodes[0].assetId === props.asset.id &&
        s.start === props.clip.timelineStart &&
        s.duration === props.clip.timelineDuration,
    ) ?? [],
);
const importedId = computed(() => {
  const record = props.asset.metadata?.["openfilm.motionGeneration"] as
    { id?: unknown } | undefined;
  return typeof record?.id === "string" ? record.id : undefined;
});
const originalId = computed(
  () => candidates.value[0]?.assetId ?? props.asset.id,
);
function clearFrame() {
  if (frameUrl.value) URL.revokeObjectURL(frameUrl.value);
  frameUrl.value = "";
}
function reset(revoke = true) {
  epoch++;
  controller?.abort();
  controller = undefined;
  busy.value = false;
  reviewed.value = false;
  clearFrame();
  if (revoke && requestId)
    void api.revokeMotion(requestId, props.projectId).catch(() => undefined);
  requestId = undefined;
}
watch(
  () => [
    props.projectId,
    props.compositionId,
    props.state.revision,
    props.clip.id,
  ],
  async () => {
    reset();
    candidates.value = [];
    failed.value = false;
    consent.value = false;
    const token = epoch;
    try {
      if (importedId.value) {
        const r = await api.motionReceipt(importedId.value, props.projectId);
        if (
          token === epoch &&
          r.projectId === props.projectId &&
          r.compositionId === props.compositionId &&
          r.clipId === props.clip.id
        )
          candidates.value = [r];
      }
    } catch {
      if (token === epoch) failed.value = true;
    }
  },
  { immediate: true },
);
watch(
  () => [
    provider.value,
    prompt.value,
    negative.value,
    people.value,
    sceneId.value,
    selected.value.join(","),
  ],
  () => {
    reset();
    candidates.value = [];
  },
);
watch(consent, (value) => {
  if (!value && requestId) {
    reset();
    candidates.value = [];
  }
});
onBeforeUnmount(() => reset());
async function clearPreviews() {
  reset();
  try {
    await api.clearMotion(props.projectId);
    candidates.value = [];
  } catch {
    failed.value = true;
  }
}
async function loadVideos() {
  const token = epoch;
  try {
    const result = await api.assets(
      new URLSearchParams({ mediaType: "video", limit: "100" }),
    );
    if (token === epoch)
      videos.value = result.assets.filter(
        (a) => a.mediaType === "video" && !a.state.locked && !a.state.rejected,
      );
  } catch {
    failed.value = true;
  }
}
async function generate() {
  if (busy.value || props.disabled || !consent.value) return;
  if (!(await props.flushInputs())) return;
  reset();
  const token = epoch;
  controller = new AbortController();
  requestId = crypto.randomUUID();
  busy.value = true;
  failed.value = false;
  try {
    const result = await api.previewMotion(
      {
        requestId,
        projectId: props.projectId,
        compositionId: props.compositionId,
        clipId: props.clip.id,
        baseRevision: props.state.revision,
        providerId: provider.value,
        count: provider.value === "local-motion-fixture" ? 2 : undefined,
        candidateAssetIds:
          provider.value === "local-motion-import" ? selected.value : undefined,
        sceneId: sceneId.value || null,
        prompt: prompt.value,
        negativeConstraints: negative.value,
        consent: true,
        containsPeople: people.value,
      },
      controller.signal,
    );
    if (token === epoch) candidates.value = result;
  } catch {
    if (token === epoch) failed.value = true;
  } finally {
    if (token === epoch) busy.value = false;
  }
}
async function accept(receipt: MotionGenerationReceipt) {
  const token = epoch;
  busy.value = true;
  try {
    const result = await api.acceptMotion(
      receipt.id,
      props.projectId,
      reviewed.value,
    );
    if (token === epoch)
      candidates.value = candidates.value.map((r) =>
        r.id === result.id ? result : r,
      );
  } catch {
    if (token === epoch) failed.value = true;
  } finally {
    if (token === epoch) busy.value = false;
  }
}
function apply(receipt: MotionGenerationReceipt, action: "import" | "restore") {
  busy.value = true;
  const token = epoch;
  emit("apply", receipt.id, action, (ok) => {
    if (token !== epoch) return;
    busy.value = false;
    if (!ok) failed.value = true;
  });
}
async function compare() {
  clearFrame();
  const token = epoch;
  const abort = new AbortController();
  controller?.abort();
  controller = abort;
  try {
    const blob = await graphicFrame(
      props.compositionId,
      props.projectId,
      props.state.revision,
      Math.round(
        (props.clip.timelineStart + compareTime.value) * props.frame.frameRate,
      ),
      abort.signal,
    );
    if (token === epoch) frameUrl.value = URL.createObjectURL(blob);
  } catch {
    if (token === epoch) failed.value = true;
  }
}
</script>
<template>
  <section
    class="editor-fields motion-panel"
    :aria-label="t('motion.heading')"
    data-testid="motion-panel"
  >
    <h4>{{ t("motion.heading") }}</h4>
    <button
      class="editor-button"
      type="button"
      :disabled="disabled || busy"
      @click="clearPreviews"
    >
      {{ t("motion.clear") }}
    </button>
    <p class="editor-note">{{ t("motion.localOnly") }}</p>
    <fieldset
      class="editor-fields"
      :disabled="disabled || busy || asset.mediaType !== 'image'"
    >
      <label class="editor-field"
        >{{ t("motion.provider")
        }}<select v-model="provider">
          <option value="local-motion-fixture">
            {{ t("motion.fixture") }}
          </option>
          <option value="local-motion-import">
            {{ t("motion.external") }}
          </option>
        </select></label
      >
      <template v-if="provider === 'local-motion-import'"
        ><button class="editor-button" type="button" @click="loadVideos">
          {{ t("motion.loadVideos") }}
        </button>
        <p class="editor-note">{{ t("motion.externalNotice") }}</p>
        <label v-for="video in videos" :key="video.id" class="editor-field"
          ><input
            v-model="selected"
            type="checkbox"
            :value="video.id"
            :disabled="selected.length >= 3 && !selected.includes(video.id)"
          />{{ video.name }}</label
        ></template
      >
      <label class="editor-field"
        >{{ t("motion.prompt")
        }}<textarea v-model="prompt" maxlength="1000" rows="2" />
      </label>
      <label class="editor-field"
        >{{ t("motion.negative")
        }}<textarea v-model="negative" maxlength="1000" rows="2" />
      </label>
      <label v-if="scene.length" class="editor-field"
        >{{ t("motion.scene")
        }}<select v-model="sceneId">
          <option value="" disabled>{{ t("motion.chooseScene") }}</option>
          <option v-for="s in scene" :key="s.id" :value="s.id">
            {{ s.id }}
          </option>
        </select></label
      >
      <label class="editor-field"
        ><input v-model="people" type="checkbox" />{{
          t("motion.people")
        }}</label
      >
      <p v-if="people" role="note" class="editor-note">
        {{ t("motion.warning") }}
      </p>
      <label class="editor-field"
        ><input v-model="consent" type="checkbox" />{{
          t("motion.consent")
        }}</label
      >
      <button
        class="editor-button"
        :disabled="
          !consent ||
          !prompt.trim() ||
          !negative.trim() ||
          (scene.length > 0 && !sceneId) ||
          (provider === 'local-motion-import' && !selected.length)
        "
        @click="generate"
      >
        {{ t("motion.generate") }}
      </button>
    </fieldset>
    <button
      v-if="busy || requestId"
      type="button"
      class="editor-button"
      @click="
        reset();
        candidates = [];
      "
    >
      {{ t("motion.cancel") }}
    </button>
    <p v-if="failed" role="alert" class="editor-note">
      {{ t("motion.failed") }}
    </p>
    <div v-if="candidates.length" class="editor-fields">
      <figure>
        <img
          :src="sourceUrl(originalId, sourceVersion)"
          :alt="t('motion.original')"
        />
        <figcaption>{{ t("motion.original") }}</figcaption>
      </figure>
      <template v-if="scene.length"
        ><label class="editor-field"
          >{{ t("motion.compareTime")
          }}<input
            v-model.number="compareTime"
            type="range"
            min="0"
            :max="Math.max(0, clip.timelineDuration - 1 / frame.frameRate)"
            :step="1 / frame.frameRate" /></label
        ><button class="editor-button" @click="compare">
          {{ t("motion.compareM8a") }}</button
        ><img v-if="frameUrl" :src="frameUrl" :alt="t('motion.compareM8a')"
      /></template>
      <label class="editor-field"
        ><input
          v-model="reviewed"
          type="checkbox"
          :disabled="disabled || busy"
        />{{ t("motion.reviewed") }}</label
      >
      <article
        v-for="(r, index) in candidates"
        :key="r.id"
        class="editor-fields"
      >
        <h5>{{ t("motion.candidate", { number: index + 1 }) }}</h5>
        <video
          v-if="r.state === 'preview' || r.state === 'accepted'"
          :src="motionMediaUrl(r.id, projectId)"
          controls
          muted
          preload="metadata"
          :aria-label="t('motion.candidate', { number: index + 1 })"
        />
        <p class="editor-note">
          {{ r.model }} · {{ t(`motion.states.${r.state}`) }} ·
          {{ r.output.duration }} s · {{ r.output.width }} ×
          {{ r.output.height }}
        </p>
        <p class="editor-note">
          {{
            r.costStatus === "free-fixture"
              ? t("motion.free")
              : t("motion.unknownCost")
          }}
        </p>
        <button
          v-if="r.state === 'preview'"
          class="editor-button"
          :disabled="disabled || busy || !reviewed"
          @click="accept(r)"
        >
          {{ t("motion.accept") }}
        </button>
        <button
          v-if="r.state === 'accepted'"
          class="editor-button"
          :disabled="disabled || busy"
          @click="apply(r, 'import')"
        >
          {{ t("motion.import") }}
        </button>
        <button
          v-if="r.state === 'imported'"
          class="editor-button"
          :disabled="disabled || busy"
          @click="apply(r, 'restore')"
        >
          {{ t("motion.restore") }}
        </button>
      </article>
    </div>
  </section>
</template>
<style scoped>
.motion-panel {
  min-width: 0;
}
.motion-panel img,
.motion-panel video {
  display: block;
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  background: var(--of-surface-1);
}
.motion-panel figure {
  margin: 0;
}
.motion-panel textarea {
  width: 100%;
  min-width: 0;
}
.motion-panel label {
  overflow-wrap: anywhere;
}
</style>
