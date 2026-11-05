<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-11-05. See LICENSE/NOTICE.
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  FRAME_SCOPE_COLUMNS,
  FRAME_SCOPE_LEVELS,
  FRAME_SCOPE_VECTOR_SIZE,
  type FrameScopeAnalysis,
  type FrameScopeChannel,
} from "../frame-scopes";

const props = defineProps<{
  analysis?: FrameScopeAnalysis;
  sourceName?: string;
  error?: boolean;
  sampling?: boolean;
}>();
const emit = defineEmits<{ capture: [] }>();
const { t } = useI18n();
const histogramCanvas = ref<HTMLCanvasElement>();
const paradeCanvas = ref<HTMLCanvasElement>();
const waveformCanvas = ref<HTMLCanvasElement>();
const vectorscopeCanvas = ref<HTMLCanvasElement>();

const channelColors: Record<FrameScopeChannel, string> = {
  red: "#ff6b6b",
  green: "#62d995",
  blue: "#76a9ff",
  luma: "#f1f5f9",
};

function maxBin(bins: Uint32Array): number {
  let maximum = 0;
  for (let index = 0; index < bins.length; index++)
    maximum = Math.max(maximum, bins[index]!);
  return maximum;
}

function paintHistogram(canvas: HTMLCanvasElement, result: FrameScopeAnalysis) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  context.fillStyle = "#0b1018";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#334155";
  context.lineWidth = 1;
  for (const fraction of [0.25, 0.5, 0.75]) {
    context.beginPath();
    context.moveTo(0, height * fraction);
    context.lineTo(width, height * fraction);
    context.stroke();
  }
  const maximum = Math.max(...Object.values(result.histogram).map(maxBin), 1);
  for (const channel of ["red", "green", "blue", "luma"] as const) {
    const bins = result.histogram[channel];
    context.beginPath();
    for (let x = 0; x < width; x++) {
      const value = bins[x]! / maximum;
      const y = height - 1 - value * (height - 1);
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = channelColors[channel];
    context.lineWidth = channel === "luma" ? 1.25 : 1;
    context.stroke();
  }
}

function paintPlane(
  canvas: HTMLCanvasElement,
  bins: Uint32Array,
  width: number,
  height: number,
  color: readonly [number, number, number],
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const maximum = maxBin(bins);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < bins.length; index++) {
    const strength = maximum
      ? Math.min(1, Math.sqrt(bins[index]! / maximum))
      : 0;
    const offset = index * 4;
    pixels[offset] = color[0] * strength;
    pixels[offset + 1] = color[1] * strength;
    pixels[offset + 2] = color[2] * strength;
    pixels[offset + 3] = 255;
  }
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
}

function paintParade(canvas: HTMLCanvasElement, result: FrameScopeAnalysis) {
  const width = FRAME_SCOPE_COLUMNS * 3;
  const height = FRAME_SCOPE_LEVELS;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#0b1018";
  context.fillRect(0, 0, width, height);
  const planes = [
    { bins: result.rgbParade.red, color: [255, 76, 76] as const },
    { bins: result.rgbParade.green, color: [79, 220, 132] as const },
    { bins: result.rgbParade.blue, color: [93, 153, 255] as const },
  ];
  const maximum = Math.max(...planes.map(({ bins }) => maxBin(bins)), 1);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let channel = 0; channel < planes.length; channel++) {
    const { bins, color } = planes[channel]!;
    for (let index = 0; index < bins.length; index++) {
      const strength = Math.min(1, Math.sqrt(bins[index]! / maximum));
      const x = channel * FRAME_SCOPE_COLUMNS + (index % FRAME_SCOPE_COLUMNS);
      const y = Math.floor(index / FRAME_SCOPE_COLUMNS);
      const offset = (y * width + x) * 4;
      pixels[offset] = color[0] * strength;
      pixels[offset + 1] = color[1] * strength;
      pixels[offset + 2] = color[2] * strength;
      pixels[offset + 3] = 255;
    }
  }
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
}

function paintVectorscope(
  canvas: HTMLCanvasElement,
  result: FrameScopeAnalysis,
) {
  const size = FRAME_SCOPE_VECTOR_SIZE;
  paintPlane(canvas, result.vectorscope, size, size, [93, 234, 179]);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.strokeStyle = "#64748b";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(size / 2, 0);
  context.lineTo(size / 2, size);
  context.moveTo(0, size / 2);
  context.lineTo(size, size / 2);
  context.stroke();
  context.beginPath();
  context.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2);
  context.stroke();
}

async function paint() {
  if (!props.analysis) return;
  await nextTick();
  if (!props.analysis) return;
  if (histogramCanvas.value)
    paintHistogram(histogramCanvas.value, props.analysis);
  if (paradeCanvas.value) paintParade(paradeCanvas.value, props.analysis);
  if (waveformCanvas.value)
    paintPlane(
      waveformCanvas.value,
      props.analysis.lumaWaveform,
      FRAME_SCOPE_COLUMNS,
      FRAME_SCOPE_LEVELS,
      [225, 237, 247],
    );
  if (vectorscopeCanvas.value)
    paintVectorscope(vectorscopeCanvas.value, props.analysis);
}

watch(
  () => props.analysis,
  () => void paint(),
  { flush: "post" },
);
</script>

<template>
  <section
    id="record-frame-scopes"
    class="frame-scopes-panel"
    role="region"
    :aria-label="t('cutDesk.scopes.title')"
  >
    <header class="frame-scopes-header">
      <strong>{{ t("cutDesk.scopes.title") }}</strong>
      <button
        class="editor-button"
        type="button"
        :disabled="sampling"
        :aria-busy="sampling"
        @click="emit('capture')"
      >
        {{ t(sampling ? "cutDesk.scopes.sampling" : "cutDesk.scopes.capture") }}
      </button>
    </header>
    <p class="frame-scopes-boundary">
      {{ t("cutDesk.scopes.boundary") }}
    </p>
    <p v-if="error" role="alert">{{ t("cutDesk.scopes.unavailable") }}</p>
    <template v-if="analysis">
      <p class="frame-scopes-meta" role="status">
        {{ sourceName || t("cutDesk.scopes.source") }} ·
        {{
          t("cutDesk.scopes.sourceSize", {
            width: analysis.sourceWidth,
            height: analysis.sourceHeight,
          })
        }}
        ·
        {{
          t("cutDesk.scopes.sampleSize", {
            width: analysis.sampleWidth,
            height: analysis.sampleHeight,
          })
        }}
        ·
        {{
          t("cutDesk.scopes.sourceTime", {
            time: analysis.mediaTime.toFixed(3),
          })
        }}
        ·
        {{ t("cutDesk.scopes.sampleCount", { count: analysis.sampleCount }) }}
      </p>
      <div class="frame-scopes-grid">
        <figure>
          <figcaption>{{ t("cutDesk.scopes.histogram") }}</figcaption>
          <canvas
            ref="histogramCanvas"
            width="256"
            height="100"
            :aria-label="t('cutDesk.scopes.histogram')"
          />
        </figure>
        <figure>
          <figcaption>{{ t("cutDesk.scopes.rgbParade") }}</figcaption>
          <canvas
            ref="paradeCanvas"
            width="384"
            height="256"
            :aria-label="t('cutDesk.scopes.rgbParade')"
          />
        </figure>
        <figure>
          <figcaption>{{ t("cutDesk.scopes.lumaWaveform") }}</figcaption>
          <canvas
            ref="waveformCanvas"
            width="128"
            height="256"
            :aria-label="t('cutDesk.scopes.lumaWaveform')"
          />
        </figure>
        <figure>
          <figcaption>{{ t("cutDesk.scopes.vectorscope") }}</figcaption>
          <canvas
            ref="vectorscopeCanvas"
            width="128"
            height="128"
            :aria-label="t('cutDesk.scopes.vectorscope')"
          />
        </figure>
      </div>
    </template>
  </section>
</template>

<style scoped>
.frame-scopes-panel {
  display: grid;
  flex: none;
  gap: 0.65rem;
  width: min(100%, 52rem);
  max-height: 34rem;
  margin: 0.5rem auto;
  padding: 0.75rem;
  overflow: auto;
  border: 1px solid var(--editor-border);
  border-radius: 0.5rem;
  background: var(--editor-panel);
}
.frame-scopes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.frame-scopes-boundary,
.frame-scopes-meta {
  margin: 0;
  color: var(--editor-muted);
  font-size: var(--of-font-caption);
  line-height: 1.5;
}
.frame-scopes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  gap: 0.65rem;
}
.frame-scopes-grid figure {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
  margin: 0;
  padding: 0.5rem;
  border: 1px solid var(--editor-border);
  border-radius: 0.35rem;
  background: #0b1018;
}
.frame-scopes-grid figcaption {
  color: var(--editor-text);
  font-size: var(--of-font-caption);
}
.frame-scopes-grid canvas {
  display: block;
  width: 100%;
  max-height: 16rem;
  object-fit: contain;
  image-rendering: pixelated;
}
</style>
