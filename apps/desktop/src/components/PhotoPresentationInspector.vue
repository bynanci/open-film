<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  resolvePhotoPlan,
  resolveTitleStyle,
  assetDisplayDimensions,
  type Clip,
  type MediaAsset,
  type PhotoLayout,
  type PhotoMotion,
  type ProjectSettings,
  type TitleStyle,
} from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";

const props = defineProps<{
  clip: Clip;
  asset: MediaAsset;
  assets: readonly MediaAsset[];
  frame: ProjectSettings;
  allowPhotoPresentation?: boolean;
}>();
const emit = defineEmits<{ command: [command: TimelineCommand] }>();
const { t } = useI18n();
const photos = computed(() =>
  props.assets.filter(
    (asset) =>
      asset.mediaType === "image" &&
      asset.id !== props.asset.id &&
      !asset.state.rejected &&
      !asset.state.locked,
  ),
);
const savedSecondary = computed(() =>
  props.assets.find(
    (asset) => asset.id === props.clip.layout?.secondary?.assetId,
  ),
);
const unavailableSecondary = computed(() =>
  savedSecondary.value &&
  !photos.value.some((asset) => asset.id === savedSecondary.value?.id)
    ? savedSecondary.value
    : undefined,
);
const layout = ref<PhotoLayout["preset"] | "original">("original");
const secondary = ref("");
const focalX = ref(0.5);
const focalY = ref(0.5);
const protectedEnabled = ref(false);
const region = ref({ x: 0.25, y: 0.2, width: 0.5, height: 0.6 });
const title = ref("");
function titleStyleForDisplay(style: TitleStyle | undefined) {
  try {
    return { style: resolveTitleStyle(style, props.frame), recovery: false };
  } catch {
    // Legacy readers preserve authored overrides for recovery. Display only
    // supported role/placement defaults; do not rewrite the saved style.
    return {
      style: resolveTitleStyle(
        {
          version: 1,
          role: style?.role ?? "subtitle",
          position: style?.position,
          background: style?.background,
        },
        props.frame,
      ),
      recovery: true,
    };
  }
}
const titleStyleRecovery = computed(
  () => titleStyleForDisplay(props.clip.titleStyle).recovery,
);
const initialTitleStyle = titleStyleForDisplay(props.clip.titleStyle).style;
const role = ref<TitleStyle["role"]>(initialTitleStyle.role);
const position = ref<"top" | "center" | "bottom">(initialTitleStyle.position);
const background = ref<"none" | "scrim">(initialTitleStyle.background);
const fontSize = ref(initialTitleStyle.fontSize);
const fontWeight = ref(initialTitleStyle.fontWeight);
const fadeIn = ref(initialTitleStyle.fadeIn);
const fadeOut = ref(initialTitleStyle.fadeOut);
const bottomInsetPercent = ref(initialTitleStyle.bottomInset * 100);
const sources = computed(() =>
  Object.fromEntries(
    props.assets.flatMap((asset) => {
      const dimensions = assetDisplayDimensions(asset);
      return dimensions ? [[asset.id, dimensions]] : [];
    }),
  ),
);
const plan = computed(() => {
  if (props.asset.mediaType !== "image") return null;
  try {
    return resolvePhotoPlan(props.clip, sources.value, props.frame);
  } catch {
    return null;
  }
});
watch(
  () => props.clip,
  (clip, previous) => {
    const changedClip = !previous || previous.id !== clip.id;
    if (
      changedClip ||
      clip.layout?.preset !== previous?.layout?.preset ||
      !!clip.motion !== !!previous?.motion
    )
      layout.value =
        clip.layout?.preset ?? (clip.motion ? "contain" : "original");
    if (
      changedClip ||
      clip.layout?.secondary?.assetId !== previous?.layout?.secondary?.assetId
    )
      secondary.value = clip.layout?.secondary?.assetId ?? "";
    if (
      changedClip ||
      clip.layout?.focalPoint?.x !== previous?.layout?.focalPoint?.x
    )
      focalX.value = clip.layout?.focalPoint?.x ?? 0.5;
    if (
      changedClip ||
      clip.layout?.focalPoint?.y !== previous?.layout?.focalPoint?.y
    )
      focalY.value = clip.layout?.focalPoint?.y ?? 0.5;
    if (
      changedClip ||
      JSON.stringify(clip.layout?.protectedRegion) !==
        JSON.stringify(previous?.layout?.protectedRegion)
    ) {
      protectedEnabled.value = !!clip.layout?.protectedRegion;
      region.value = clip.layout?.protectedRegion
        ? { ...clip.layout.protectedRegion }
        : { x: 0.25, y: 0.2, width: 0.5, height: 0.6 };
    }
    if (changedClip || clip.title !== previous?.title)
      title.value = clip.title ?? "";
    const nextTitleStyle = titleStyleForDisplay(clip.titleStyle).style;
    const previousTitleStyle = previous
      ? titleStyleForDisplay(previous.titleStyle).style
      : undefined;
    if (changedClip || nextTitleStyle.role !== previousTitleStyle?.role)
      role.value = nextTitleStyle.role;
    if (changedClip || nextTitleStyle.position !== previousTitleStyle?.position)
      position.value = nextTitleStyle.position;
    if (
      changedClip ||
      nextTitleStyle.background !== previousTitleStyle?.background
    )
      background.value = nextTitleStyle.background;
    if (changedClip || nextTitleStyle.fontSize !== previousTitleStyle?.fontSize)
      fontSize.value = nextTitleStyle.fontSize;
    if (
      changedClip ||
      nextTitleStyle.fontWeight !== previousTitleStyle?.fontWeight
    )
      fontWeight.value = nextTitleStyle.fontWeight;
    if (changedClip || nextTitleStyle.fadeIn !== previousTitleStyle?.fadeIn)
      fadeIn.value = nextTitleStyle.fadeIn;
    if (changedClip || nextTitleStyle.fadeOut !== previousTitleStyle?.fadeOut)
      fadeOut.value = nextTitleStyle.fadeOut;
    if (
      changedClip ||
      nextTitleStyle.bottomInset !== previousTitleStyle?.bottomInset
    )
      bottomInsetPercent.value = nextTitleStyle.bottomInset * 100;
  },
  { immediate: true },
);
function setLayout() {
  if (layout.value === "original") {
    emit("command", {
      type: "presentation",
      clipId: props.clip.id,
      layout: null,
      motion: null,
    });
    return;
  }
  if (layout.value === "diptych" && !secondary.value)
    secondary.value = photos.value[0]?.id ?? "";
  if (layout.value === "diptych" && !secondary.value) return;
  const next: PhotoLayout = {
    ...(layout.value !== "diptych" || props.clip.layout?.gap === undefined
      ? {}
      : { gap: props.clip.layout.gap }),
    version: 1,
    preset: layout.value,
    focalPoint: { x: Number(focalX.value), y: Number(focalY.value) },
    ...(protectedEnabled.value ? { protectedRegion: { ...region.value } } : {}),
    ...(layout.value === "diptych"
      ? {
          secondary: {
            ...(props.clip.layout?.secondary?.assetId === secondary.value
              ? props.clip.layout.secondary
              : {}),
            assetId: secondary.value,
          },
        }
      : {}),
  };
  emit("command", {
    type: "presentation",
    clipId: props.clip.id,
    layout: next,
  });
}
function setMotion(preset: PhotoMotion["preset"]) {
  const identity = { scale: 1, x: 0, y: 0 };
  const motion: PhotoMotion = {
    version: 1,
    preset,
    easing: "ease-in-out",
    from:
      preset === "pan"
        ? { scale: 1.06, x: -props.frame.width * 0.02, y: 0 }
        : identity,
    to:
      preset === "push-in"
        ? { scale: 1.06, x: 0, y: 0 }
        : preset === "pan"
          ? { scale: 1.06, x: props.frame.width * 0.02, y: 0 }
          : identity,
  };
  emit("command", {
    type: "presentation",
    clipId: props.clip.id,
    layout: props.clip.layout ?? { version: 1, preset: "contain" },
    motion,
  });
}
function setTitle(
  field:
    | "text"
    | "role"
    | "position"
    | "background"
    | "fontSize"
    | "fontWeight"
    | "fadeIn"
    | "fadeOut"
    | "bottomInset",
) {
  const titleStyle: TitleStyle = {
    ...props.clip.titleStyle,
    version: 1,
    role: role.value,
  };
  if (field === "position") titleStyle.position = position.value;
  if (field === "background") titleStyle.background = background.value;
  if (field === "fontSize") {
    const value = Number(fontSize.value);
    if (!Number.isFinite(value) || value <= 0) return;
    titleStyle.fontSize = value;
  }
  if (field === "fontWeight") {
    const value = Number(fontWeight.value);
    if (!Number.isFinite(value) || value < 100 || value > 900) return;
    titleStyle.fontWeight = value;
  }
  if (field === "fadeIn" || field === "fadeOut") {
    const value = Number(field === "fadeIn" ? fadeIn.value : fadeOut.value);
    if (!Number.isFinite(value) || value < 0 || value > 10) return;
    titleStyle[field] = value;
  }
  if (field === "bottomInset") {
    const value = Number(bottomInsetPercent.value);
    if (!Number.isFinite(value) || value < 0 || value > 45) return;
    titleStyle.bottomInset = value / 100;
  }
  emit("command", {
    type: "presentation",
    clipId: props.clip.id,
    title: title.value || null,
    ...(field === "text"
      ? title.value
        ? {}
        : { titleStyle: null }
      : { titleStyle }),
  });
}
function warningMessage(warning: unknown) {
  const code = (
    typeof warning === "string"
      ? warning
      : ((warning as { code?: string }).code ?? "")
  ).toLowerCase();
  if (code.includes("contain_fallback"))
    return t("editor.presentation.safeCropFallback");
  if (code.includes("motion")) return t("editor.presentation.motionHeld");
  if (code.includes("protected"))
    return t("editor.presentation.protectedWarning");
  if (code.includes("secondary") || code.includes("source"))
    return t("editor.presentation.sourceWarning");
  return t("editor.presentation.geometryWarning");
}
function resetTitleStyle() {
  if (props.clip.locked || props.asset.state.locked) return;
  emit("command", {
    type: "presentation",
    clipId: props.clip.id,
    titleStyle: null,
  });
}
</script>

<template>
  <section class="editor-presentation-inspector">
    <template
      v-if="asset.mediaType === 'image' && allowPhotoPresentation !== false"
    >
      <h3>{{ t("editor.presentation.heading") }}</h3>
      <p class="editor-note">{{ t("editor.presentation.description") }}</p>
      <label class="editor-field"
        >{{ t("editor.presentation.layout") }}
        <select
          v-model="layout"
          :aria-label="t('editor.presentation.layout')"
          @change="setLayout"
        >
          <option value="original">
            {{ t("editor.presentation.original") }}
          </option>
          <option value="contain">
            {{ t("editor.presentation.contain") }}
          </option>
          <option value="hero">{{ t("editor.presentation.hero") }}</option>
          <option value="diptych" :disabled="!photos.length">
            {{ t("editor.presentation.diptych") }}
          </option>
        </select>
      </label>
      <label v-if="layout === 'diptych'" class="editor-field"
        >{{ t("editor.presentation.secondPhoto") }}
        <select
          v-model="secondary"
          :aria-label="t('editor.presentation.secondPhoto')"
          @change="setLayout"
        >
          <option
            v-if="unavailableSecondary"
            :value="unavailableSecondary.id"
            disabled
          >
            {{ unavailableSecondary.name }}
          </option>
          <option v-for="photo in photos" :key="photo.id" :value="photo.id">
            {{ photo.name }}
          </option>
        </select>
      </label>
      <template v-if="layout !== 'original' || clip.motion">
        <h4>{{ t("editor.presentation.motion") }}</h4>
        <div class="editor-presets">
          <button
            v-for="preset in ['hold', 'push-in', 'pan'] as const"
            :key="preset"
            class="editor-button"
            :aria-pressed="(clip.motion?.preset ?? 'hold') === preset"
            @click="setMotion(preset)"
          >
            {{ t(`editor.presentation.motionPresets.${preset}`) }}
          </button>
        </div>
        <p class="editor-note">{{ t("editor.presentation.motionHint") }}</p>
        <details
          v-if="layout !== 'original'"
          class="editor-presentation-details"
        >
          <summary>{{ t("editor.presentation.focalControls") }}</summary>
          <div class="editor-field-pair">
            <label class="editor-field"
              >{{ t("editor.presentation.focalX")
              }}<input
                v-model.number="focalX"
                type="number"
                min="0"
                max="1"
                step="0.01"
                @change="setLayout"
            /></label>
            <label class="editor-field"
              >{{ t("editor.presentation.focalY")
              }}<input
                v-model.number="focalY"
                type="number"
                min="0"
                max="1"
                step="0.01"
                @change="setLayout"
            /></label>
          </div>
          <label class="editor-presentation-check"
            ><input
              v-model="protectedEnabled"
              type="checkbox"
              @change="setLayout"
            />{{ t("editor.presentation.protectRegion") }}</label
          >
          <p class="editor-note">{{ t("editor.presentation.protectHint") }}</p>
          <div v-if="protectedEnabled" class="editor-field-pair">
            <label
              v-for="key in ['x', 'y', 'width', 'height'] as const"
              :key="key"
              class="editor-field"
              >{{ t(`editor.presentation.region.${key}`)
              }}<input
                v-model.number="region[key]"
                type="number"
                min="0"
                max="1"
                step="0.01"
                @change="setLayout"
            /></label>
          </div>
        </details>
      </template>
      <div
        v-if="plan?.warnings.length"
        class="editor-presentation-warnings"
        role="status"
      >
        <p v-for="(warning, index) in plan.warnings" :key="index">
          {{ warningMessage(warning) }}
        </p>
      </div>
      <div class="editor-divider" />
    </template>
    <h3>{{ t("editor.presentation.titleHeading") }}</h3>
    <div
      v-if="titleStyleRecovery"
      class="editor-presentation-warnings"
      role="status"
    >
      <p>{{ t("editor.presentation.titleStyleRecoveryWarning") }}</p>
      <button
        type="button"
        class="editor-button"
        :disabled="clip.locked || asset.state.locked"
        @click="resetTitleStyle"
      >
        {{ t("editor.presentation.resetTitleStyle") }}
      </button>
    </div>
    <label class="editor-field"
      >{{ t("editor.presentation.titleText")
      }}<textarea
        v-model="title"
        :aria-label="t('editor.presentation.titleText')"
        rows="3"
        @change="setTitle('text')"
      />
    </label>
    <template v-if="title">
      <div class="editor-field-pair">
        <label class="editor-field"
          >{{ t("editor.presentation.titleFontSize") }}
          <input
            v-model.number="fontSize"
            type="number"
            min="1"
            step="1"
            :disabled="titleStyleRecovery"
            :aria-label="t('editor.presentation.titleFontSize')"
            @change="setTitle('fontSize')"
          />
        </label>
        <label class="editor-field"
          >{{ t("editor.presentation.titleFontWeight") }}
          <input
            v-model.number="fontWeight"
            type="number"
            min="100"
            max="900"
            step="100"
            :disabled="titleStyleRecovery"
            :aria-label="t('editor.presentation.titleFontWeight')"
            @change="setTitle('fontWeight')"
          />
        </label>
      </div>
      <div class="editor-field-pair">
        <label class="editor-field"
          >{{ t("editor.presentation.titleFadeIn") }}
          <input
            v-model.number="fadeIn"
            type="number"
            min="0"
            max="10"
            step="0.1"
            :disabled="titleStyleRecovery"
            :aria-label="t('editor.presentation.titleFadeIn')"
            @change="setTitle('fadeIn')"
          />
        </label>
        <label class="editor-field"
          >{{ t("editor.presentation.titleFadeOut") }}
          <input
            v-model.number="fadeOut"
            type="number"
            min="0"
            max="10"
            step="0.1"
            :disabled="titleStyleRecovery"
            :aria-label="t('editor.presentation.titleFadeOut')"
            @change="setTitle('fadeOut')"
          />
        </label>
      </div>
      <label class="editor-field"
        >{{ t("editor.presentation.titleBottomInset") }}
        <input
          v-model.number="bottomInsetPercent"
          type="number"
          min="0"
          max="45"
          step="1"
          :disabled="titleStyleRecovery"
          :aria-label="t('editor.presentation.titleBottomInset')"
          @change="setTitle('bottomInset')"
        />
      </label>
      <label class="editor-field"
        >{{ t("editor.presentation.titleRole") }}
        <select
          v-model="role"
          :disabled="titleStyleRecovery"
          :aria-label="t('editor.presentation.titleRole')"
          @change="setTitle('role')"
        >
          <option
            v-for="value in [
              'film-title',
              'scene-statement',
              'subtitle',
            ] as const"
            :key="value"
            :value="value"
          >
            {{ t(`editor.presentation.roles.${value}`) }}
          </option>
        </select>
      </label>
      <div class="editor-field-pair">
        <label class="editor-field"
          >{{ t("editor.presentation.titlePosition")
          }}<select
            v-model="position"
            :disabled="titleStyleRecovery"
            :aria-label="t('editor.presentation.titlePosition')"
            @change="setTitle('position')"
          >
            <option value="top">
              {{ t("editor.presentation.top") }}
            </option>
            <option value="center">
              {{ t("editor.presentation.center") }}
            </option>
            <option value="bottom">
              {{ t("editor.presentation.bottom") }}
            </option>
          </select></label
        >
        <label class="editor-field"
          >{{ t("editor.presentation.titleBackground")
          }}<select
            v-model="background"
            :disabled="titleStyleRecovery"
            :aria-label="t('editor.presentation.titleBackground')"
            @change="setTitle('background')"
          >
            <option value="scrim">{{ t("editor.presentation.scrim") }}</option>
            <option value="none">{{ t("editor.presentation.none") }}</option>
          </select></label
        >
      </div>
    </template>
  </section>
</template>
