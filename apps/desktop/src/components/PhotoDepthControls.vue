<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  GraphicImageNode,
  GraphicScene,
  PhotoDepthRecipe,
} from "@openfilm/core";
import type { MediaAsset } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import { api, thumbnailUrl } from "../api";
import { canCreatePhotoDepth } from "../photo-depth-controls";

const props = defineProps<{
  projectId: string;
  dependencyVersion?: string;
  scene: GraphicScene;
  node: GraphicImageNode;
  assets: readonly MediaAsset[];
  duration: number;
  frameRate: number;
  disabled: boolean;
}>();
const emit = defineEmits<{
  command: [command: TimelineCommand, referencedAssets: readonly MediaAsset[]];
  preview: [time: number];
  importAssets: [];
}>();
const { t } = useI18n();
const libraryAssets = shallowRef<MediaAsset[]>([]);
const libraryError = ref(false);
const libraryRetry = ref(0);
const assets = computed(() => [
  ...new Map(
    [...libraryAssets.value, ...props.assets].map((asset) => [asset.id, asset]),
  ).values(),
]);
const eligibleImage = (asset: MediaAsset) => {
  try {
    const uri = new URL(asset.uri);
    return (
      asset.mediaType === "image" &&
      uri.protocol === "file:" &&
      !uri.hostname &&
      /^[a-f0-9]{64}$/u.test(asset.contentHash ?? "")
    );
  } catch {
    return false;
  }
};
watch(
  [() => props.projectId, () => props.dependencyVersion, libraryRetry],
  async ([projectId], previous, onCleanup) => {
    let stale = false;
    onCleanup(() => {
      stale = true;
    });
    if (projectId !== previous[0]) libraryAssets.value = [];
    libraryError.value = false;
    try {
      const images: MediaAsset[] = [];
      let offset = 0;
      while (!stale) {
        const page = await api.assets(
          new URLSearchParams({
            mediaType: "image",
            offset: String(offset),
            limit: "200",
          }),
        );
        if (stale) return;
        images.push(...page.assets.filter(eligibleImage));
        offset += page.assets.length;
        if (!page.assets.length || offset >= page.total) break;
      }
      if (!stale) libraryAssets.value = images;
    } catch {
      if (!stale) libraryError.value = true;
    }
  },
  { immediate: true },
);
const selectedMaskId = ref("");
const selectedBackgroundId = ref("");
const backgroundKind = ref<"source" | "asset">("source");
const selectedMask = computed(() =>
  pngMasks.value.find((asset) => asset.id === selectedMaskId.value),
);
const fallbackReason =
  ref<NonNullable<PhotoDepthRecipe["fallbackReason"]>>("mask-not-available");
const showLayers = ref(false);

const source = computed(() =>
  props.assets.find((asset) => asset.id === props.node.assetId),
);
const isPng = (asset: MediaAsset) =>
  asset.mediaType === "image" &&
  (asset.codec?.toLowerCase().includes("png") || /\.png$/iu.test(asset.name));
const pngMasks = computed(() =>
  assets.value.filter(
    (asset) =>
      asset.id !== props.node.assetId && isPng(asset) && eligibleImage(asset),
  ),
);
const backgrounds = computed(() =>
  assets.value.filter(
    (asset) =>
      eligibleImage(asset) &&
      asset.id !== props.node.assetId &&
      asset.id !== selectedMaskId.value,
  ),
);
const selectedBackground = computed(() =>
  backgrounds.value.find((asset) => asset.id === selectedBackgroundId.value),
);
const depth = computed(() =>
  props.scene.photoDepth?.nodeId === props.node.id
    ? props.scene.photoDepth
    : undefined,
);
const parallax = computed(() =>
  depth.value?.mode === "parallax" ? depth.value : undefined,
);
const seconds = computed(() => props.node.end - props.node.start);
const eligibility = computed(() => {
  if (!source.value || !eligibleImage(source.value)) return "source";
  if (seconds.value < 3 || seconds.value > 6) return "duration";
  if (props.node.animation || Math.abs(props.node.rotation ?? 0) > 1e-9)
    return "motion";
  if (!pngMasks.value.length && !parallax.value) return "mask";
  return "";
});
const canCreateParallax = computed(() =>
  canCreatePhotoDepth({
    disabled: props.disabled,
    sourceHash: source.value?.contentHash,
    maskHash: selectedMask.value?.contentHash,
    selectedMaskId: selectedMaskId.value,
    backgroundKind: backgroundKind.value,
    backgroundHash: selectedBackground.value?.contentHash,
    eligibility: eligibility.value,
  }),
);
const currentMask = computed(() =>
  assets.value.find((asset) => asset.id === parallax.value?.maskAssetId),
);
const currentBackground = computed(() => {
  const recipe = parallax.value;
  const background = recipe?.background;
  if (background?.kind !== "asset") return undefined;
  return assets.value.find((asset) => asset.id === background.assetId);
});
const startTime = computed(() => props.scene.start + props.node.start);
const middleTime = computed(() => startTime.value + seconds.value / 2);
const endTime = computed(() =>
  Math.max(
    startTime.value,
    props.scene.start + props.node.end - 1 / props.frameRate,
  ),
);

watch(
  [
    () => props.scene.id,
    () => props.node.id,
    () => props.node.assetId,
    () => depth.value,
    () => assets.value,
  ],
  ([sceneId, nodeId, assetId, recipe], previous) => {
    const sameTarget =
      sceneId === previous[0] &&
      nodeId === previous[1] &&
      assetId === previous[2];
    const previousRecipe = previous[3];
    if (sameTarget && recipe === previousRecipe) {
      if (!pngMasks.value.some((asset) => asset.id === selectedMaskId.value))
        selectedMaskId.value = pngMasks.value[0]?.id ?? "";
      if (
        !backgrounds.value.some(
          (asset) => asset.id === selectedBackgroundId.value,
        )
      )
        selectedBackgroundId.value = backgrounds.value[0]?.id ?? "";
      return;
    }
    const pendingMask =
      sameTarget &&
      recipe?.mode === "parallax" &&
      previousRecipe?.mode === "parallax" &&
      recipe.id === previousRecipe.id &&
      recipe.sourceSha256 === previousRecipe.sourceSha256 &&
      recipe.maskAssetId === previousRecipe.maskAssetId &&
      recipe.maskSha256 === previousRecipe.maskSha256 &&
      selectedMaskId.value !== previousRecipe.maskAssetId &&
      pngMasks.value.some((asset) => asset.id === selectedMaskId.value);
    if (recipe?.mode === "parallax") {
      if (!pendingMask) selectedMaskId.value = recipe.maskAssetId;
      if (recipe.background?.kind === "asset") {
        backgroundKind.value = "asset";
        selectedBackgroundId.value = recipe.background.assetId;
      } else {
        backgroundKind.value = "source";
        selectedBackgroundId.value = backgrounds.value[0]?.id ?? "";
      }
    } else {
      selectedMaskId.value = pngMasks.value[0]?.id ?? "";
      backgroundKind.value = "source";
      selectedBackgroundId.value = backgrounds.value[0]?.id ?? "";
    }
    if (recipe?.mode === "fallback")
      fallbackReason.value = recipe.fallbackReason;
    else if (!sameTarget) fallbackReason.value = "mask-not-available";
  },
  { immediate: true },
);

function save(recipe: PhotoDepthRecipe | undefined) {
  if (props.disabled) return;
  const scene = structuredClone(props.scene);
  if (recipe) scene.photoDepth = recipe;
  else delete scene.photoDepth;
  const ids = new Set(
    recipe
      ? [
          recipe.sourceAssetId,
          ...(recipe.mode === "parallax"
            ? [
                recipe.maskAssetId,
                ...(recipe.background.kind === "asset"
                  ? [recipe.background.assetId]
                  : []),
              ]
            : []),
        ]
      : [],
  );
  emit(
    "command",
    { type: "graphic.scene.upsert", scene },
    assets.value.filter((asset) => ids.has(asset.id)),
  );
}

function createParallax() {
  if (!canCreateParallax.value) return;
  const original = source.value!;
  const mask = selectedMask.value!;
  const backgroundAsset =
    backgroundKind.value === "asset" ? selectedBackground.value : undefined;
  const recipe: PhotoDepthRecipe = {
    version: 1,
    id: depth.value?.id ?? crypto.randomUUID(),
    nodeId: props.node.id,
    mode: "parallax",
    duration: seconds.value,
    sourceAssetId: original.id,
    sourceSha256: original.contentHash!,
    maskAssetId: mask.id,
    maskSha256: mask.contentHash!,
    background: backgroundAsset
      ? {
          kind: "asset",
          assetId: backgroundAsset.id,
          sha256: backgroundAsset.contentHash!,
        }
      : { kind: "source" },
    protectedRegion: parallax.value?.protectedRegion ?? {
      x: 0.05,
      y: 0.05,
      width: 0.9,
      height: 0.9,
    },
    foregroundDepth: parallax.value?.foregroundDepth ?? 1.2,
    backgroundDepth: parallax.value?.backgroundDepth ?? 0.25,
    amplitude: parallax.value?.amplitude ?? 0.5,
    camera: parallax.value?.camera ?? {
      from: { x: 0, y: 0, scale: 1 },
      to: { x: 0.025, y: 0, scale: 1.04 },
    },
    easing: parallax.value?.easing ?? "ease-in-out",
  };
  save(recipe);
}

function useFallback() {
  const original = source.value;
  if (
    !original ||
    !eligibleImage(original) ||
    seconds.value < 3 ||
    seconds.value > 6
  )
    return;
  save({
    version: 1,
    id: depth.value?.id ?? crypto.randomUUID(),
    nodeId: props.node.id,
    mode: "fallback",
    duration: seconds.value,
    sourceAssetId: original.id,
    sourceSha256: original.contentHash!,
    fallbackReason: fallbackReason.value,
  });
}

function updateRecipe(
  update: (recipe: Extract<PhotoDepthRecipe, { mode: "parallax" }>) => void,
) {
  if (!parallax.value) return;
  const recipe = structuredClone(parallax.value);
  update(recipe);
  save(recipe);
}
function updateNumber(
  field: "amplitude" | "foregroundDepth" | "backgroundDepth",
  event: Event,
) {
  updateRecipe((recipe) => {
    recipe[field] = Number((event.target as HTMLInputElement).value);
  });
}
function updateRegion(field: "x" | "y" | "width" | "height", event: Event) {
  updateRecipe((recipe) => {
    recipe.protectedRegion[field] = Number(
      (event.target as HTMLInputElement).value,
    );
  });
}
function updateCamera(
  endpoint: "from" | "to",
  field: "x" | "y" | "scale",
  event: Event,
) {
  updateRecipe((recipe) => {
    recipe.camera[endpoint][field] = Number(
      (event.target as HTMLInputElement).value,
    );
  });
}
function updateEasing(event: Event) {
  updateRecipe((recipe) => {
    recipe.easing = (event.target as HTMLSelectElement)
      .value as typeof recipe.easing;
  });
}
function updateBackground() {
  updateRecipe((recipe) => {
    const asset = backgrounds.value.find(
      (item) => item.id === selectedBackgroundId.value,
    );
    recipe.background =
      backgroundKind.value === "asset" && asset?.contentHash
        ? { kind: "asset", assetId: asset.id, sha256: asset.contentHash }
        : { kind: "source" };
  });
}
</script>

<template>
  <section class="photo-depth-controls" data-testid="photo-depth-controls">
    <h4>{{ t("editor.photoDepth.heading") }}</h4>
    <p v-if="scene.userOverrides?.isUserPinned" class="editor-muted">
      {{ t("editor.pins.hint") }}
    </p>
    <p class="editor-muted">{{ t("editor.photoDepth.description") }}</p>
    <p v-if="libraryError" class="editor-error" role="alert">
      {{ t("editor.photoDepth.libraryError") }}
      <button type="button" class="editor-button" @click="libraryRetry++">
        {{ t("editor.graphics.retry") }}
      </button>
    </p>
    <p v-if="eligibility === 'source'" class="editor-muted">
      {{ t("editor.photoDepth.sourceHashRequired") }}
    </p>
    <p v-else-if="eligibility === 'duration'" class="editor-muted">
      {{ t("editor.photoDepth.durationRule", { duration: seconds }) }}
    </p>
    <p v-else-if="eligibility === 'motion'" class="editor-muted">
      {{ t("editor.photoDepth.motionRule") }}
    </p>
    <div class="photo-depth-assets">
      <figure v-if="source">
        <img :src="thumbnailUrl(source.id)" :alt="source.name" />
        <figcaption>{{ t("editor.photoDepth.original") }}</figcaption>
      </figure>
      <figure v-if="showLayers && currentMask">
        <img :src="thumbnailUrl(currentMask.id)" :alt="currentMask.name" />
        <figcaption>{{ t("editor.photoDepth.foregroundMask") }}</figcaption>
      </figure>
      <figure v-if="showLayers && currentBackground">
        <img
          :src="thumbnailUrl(currentBackground.id)"
          :alt="currentBackground.name"
        />
        <figcaption>{{ t("editor.photoDepth.background") }}</figcaption>
      </figure>
    </div>
    <button
      type="button"
      class="editor-button"
      :disabled="disabled"
      @click="emit('importAssets')"
    >
      {{ t("editor.photoDepth.importAssets") }}
    </button>
    <button
      v-if="parallax"
      type="button"
      class="editor-button"
      :aria-pressed="showLayers"
      @click="showLayers = !showLayers"
    >
      {{
        t(
          showLayers
            ? "editor.photoDepth.showOriginal"
            : "editor.photoDepth.showLayers",
        )
      }}
    </button>
    <p v-if="depth?.mode === 'fallback'" class="editor-muted">
      {{ t("editor.photoDepth.fallbackActive") }}
    </p>
    <label>
      {{ t("editor.photoDepth.foregroundMask") }}
      <select v-model="selectedMaskId" :disabled="disabled || !pngMasks.length">
        <option value="">{{ t("editor.photoDepth.chooseMask") }}</option>
        <option v-for="asset in pngMasks" :key="asset.id" :value="asset.id">
          {{ asset.name }}
        </option>
      </select>
    </label>
    <label>
      {{ t("editor.photoDepth.backgroundMode") }}
      <select
        v-model="backgroundKind"
        :disabled="disabled"
        @change="updateBackground"
      >
        <option value="source">
          {{ t("editor.photoDepth.useOriginalBackground") }}
        </option>
        <option value="asset">
          {{ t("editor.photoDepth.useBackgroundAsset") }}
        </option>
      </select>
    </label>
    <label v-if="backgroundKind === 'asset'">
      {{ t("editor.photoDepth.background") }}
      <select
        v-model="selectedBackgroundId"
        :disabled="disabled || !backgrounds.length"
        @change="updateBackground"
      >
        <option v-for="asset in backgrounds" :key="asset.id" :value="asset.id">
          {{ asset.name }}
        </option>
      </select>
    </label>
    <template v-if="parallax">
      <div class="photo-depth-field-grid">
        <label
          v-for="field in ['x', 'y', 'width', 'height'] as const"
          :key="field"
        >
          {{ t(`editor.photoDepth.region.${field}`) }}
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            :value="parallax.protectedRegion[field]"
            :disabled="disabled"
            @change="updateRegion(field, $event)"
          />
        </label>
        <label>
          {{ t("editor.photoDepth.amplitude") }}
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="parallax.amplitude"
            :disabled="disabled"
            @change="updateNumber('amplitude', $event)"
          />
        </label>
        <label>
          {{ t("editor.photoDepth.foregroundDepth") }}
          <input
            type="number"
            min="1"
            max="1.35"
            step="0.01"
            :value="parallax.foregroundDepth"
            :disabled="disabled"
            @change="updateNumber('foregroundDepth', $event)"
          />
        </label>
        <label>
          {{ t("editor.photoDepth.backgroundDepth") }}
          <input
            type="number"
            min="0"
            max="0.65"
            step="0.01"
            :value="parallax.backgroundDepth"
            :disabled="disabled"
            @change="updateNumber('backgroundDepth', $event)"
          />
        </label>
        <label>
          {{ t("editor.photoDepth.easing") }}
          <select
            :value="parallax.easing"
            :disabled="disabled"
            @change="updateEasing"
          >
            <option
              v-for="easing in [
                'linear',
                'ease-in',
                'ease-out',
                'ease-in-out',
              ] as const"
              :key="easing"
              :value="easing"
            >
              {{ t(`editor.graphics.${easing}`) }}
            </option>
          </select>
        </label>
      </div>
      <fieldset
        v-for="endpoint in ['from', 'to'] as const"
        :key="endpoint"
        class="photo-depth-camera"
      >
        <legend>{{ t(`editor.photoDepth.camera.${endpoint}`) }}</legend>
        <div class="photo-depth-field-grid">
          <label v-for="field in ['x', 'y', 'scale'] as const" :key="field">
            {{ t(`editor.photoDepth.camera.${field}`) }}
            <input
              type="number"
              :min="field === 'scale' ? 1 : -0.05"
              :max="field === 'scale' ? 1.12 : 0.05"
              step="0.01"
              :value="parallax.camera[endpoint][field]"
              :disabled="disabled"
              @change="updateCamera(endpoint, field, $event)"
            />
          </label>
        </div>
      </fieldset>
      <p class="editor-muted">{{ t("editor.photoDepth.edgeReview") }}</p>
      <div class="photo-depth-preview-actions">
        <button
          type="button"
          class="editor-button"
          @click="emit('preview', startTime)"
        >
          {{ t("editor.photoDepth.previewStart") }}
        </button>
        <button
          type="button"
          class="editor-button"
          @click="emit('preview', middleTime)"
        >
          {{ t("editor.photoDepth.previewMiddle") }}
        </button>
        <button
          type="button"
          class="editor-button"
          @click="emit('preview', endTime)"
        >
          {{ t("editor.photoDepth.previewEnd") }}
        </button>
      </div>
    </template>
    <button
      type="button"
      class="editor-button"
      :disabled="!canCreateParallax"
      @click="createParallax"
    >
      {{
        t(parallax ? "editor.photoDepth.update" : "editor.photoDepth.create")
      }}
    </button>
    <label class="photo-depth-fallback-reason">
      {{ t("editor.photoDepth.fallbackReason") }}
      <select v-model="fallbackReason" :disabled="disabled">
        <option value="mask-not-available">
          {{ t("editor.photoDepth.reasons.maskMissing") }}
        </option>
        <option value="mask-unreliable">
          {{ t("editor.photoDepth.reasons.maskUnreliable") }}
        </option>
        <option value="background-not-available">
          {{ t("editor.photoDepth.reasons.backgroundMissing") }}
        </option>
        <option value="protected-subject-overlap">
          {{ t("editor.photoDepth.reasons.subjectOverlap") }}
        </option>
      </select>
    </label>
    <div class="photo-depth-preview-actions">
      <button
        type="button"
        class="editor-button"
        :disabled="
          disabled || !source?.contentHash || seconds < 3 || seconds > 6
        "
        @click="useFallback"
      >
        {{ t("editor.photoDepth.useFallback") }}
      </button>
      <button
        v-if="depth"
        type="button"
        class="editor-button"
        :disabled="disabled"
        @click="save(undefined)"
      >
        {{ t("editor.photoDepth.remove") }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.photo-depth-controls {
  display: grid;
  gap: 0.65rem;
  margin-top: 0.8rem;
}
.photo-depth-controls h4,
.photo-depth-controls p {
  margin: 0;
}
.photo-depth-controls label {
  display: grid;
  gap: 0.35rem;
}
.photo-depth-assets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}
.photo-depth-assets figure {
  width: min(100%, 8rem);
  margin: 0;
}
.photo-depth-assets img {
  display: block;
  width: 100%;
  max-height: 5rem;
  object-fit: contain;
  border-radius: 0.4rem;
  background: var(--surface-muted, #171717);
}
.photo-depth-assets figcaption {
  margin-top: 0.25rem;
  font-size: 0.75rem;
}
.photo-depth-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}
.photo-depth-camera {
  display: grid;
  gap: 0.5rem;
}
.photo-depth-preview-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
</style>
