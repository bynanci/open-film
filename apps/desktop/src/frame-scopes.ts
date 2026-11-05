// Modified by OpenFilm contributors on 2026-11-05. See LICENSE/NOTICE.

export const FRAME_SCOPE_MAX_DIMENSION = 512;
export const FRAME_SCOPE_COLUMNS = 128;
export const FRAME_SCOPE_LEVELS = 256;
export const FRAME_SCOPE_VECTOR_SIZE = 128;

export type FrameScopeChannel = "red" | "green" | "blue" | "luma";

export interface DecodedFrameSample {
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
  mediaTime: number;
  pixels: Uint8ClampedArray;
}

export interface FrameScopeAnalysis {
  sourceWidth: number;
  sourceHeight: number;
  sampleWidth: number;
  sampleHeight: number;
  mediaTime: number;
  sampleCount: number;
  histogram: Record<FrameScopeChannel, Uint32Array>;
  rgbParade: Record<Exclude<FrameScopeChannel, "luma">, Uint32Array>;
  lumaWaveform: Uint32Array;
  vectorscope: Uint32Array;
}

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, Math.round(value)));
}

/**
 * Calculate bounded source-frame scopes from browser-decoded, sRGB-like RGB
 * bytes. The result describes the source frame before OpenFilm transforms,
 * corrections, looks, compositing, captions or monitor color management.
 */
export function analyzeDecodedFrame(
  frame: DecodedFrameSample,
): FrameScopeAnalysis {
  const { width, height, mediaTime, pixels } = frame;
  const sourceWidth = frame.sourceWidth ?? width;
  const sourceHeight = frame.sourceHeight ?? height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > FRAME_SCOPE_MAX_DIMENSION ||
    height > FRAME_SCOPE_MAX_DIMENSION ||
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceWidth < width ||
    sourceHeight < height ||
    pixels.length !== width * height * 4 ||
    !Number.isFinite(mediaTime) ||
    mediaTime < 0
  )
    throw new Error("Invalid or unbounded decoded frame sample.");

  const histogram: FrameScopeAnalysis["histogram"] = {
    red: new Uint32Array(FRAME_SCOPE_LEVELS),
    green: new Uint32Array(FRAME_SCOPE_LEVELS),
    blue: new Uint32Array(FRAME_SCOPE_LEVELS),
    luma: new Uint32Array(FRAME_SCOPE_LEVELS),
  };
  const rgbParade: FrameScopeAnalysis["rgbParade"] = {
    red: new Uint32Array(FRAME_SCOPE_COLUMNS * FRAME_SCOPE_LEVELS),
    green: new Uint32Array(FRAME_SCOPE_COLUMNS * FRAME_SCOPE_LEVELS),
    blue: new Uint32Array(FRAME_SCOPE_COLUMNS * FRAME_SCOPE_LEVELS),
  };
  const lumaWaveform = new Uint32Array(
    FRAME_SCOPE_COLUMNS * FRAME_SCOPE_LEVELS,
  );
  const vectorscope = new Uint32Array(
    FRAME_SCOPE_VECTOR_SIZE * FRAME_SCOPE_VECTOR_SIZE,
  );
  let sampleCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (pixels[offset + 3] === 0) continue;
      const red = pixels[offset]!;
      const green = pixels[offset + 1]!;
      const blue = pixels[offset + 2]!;
      const luma = clamp(0.2126 * red + 0.7152 * green + 0.0722 * blue, 255);
      const column = Math.min(
        FRAME_SCOPE_COLUMNS - 1,
        Math.floor((x * FRAME_SCOPE_COLUMNS) / width),
      );
      histogram.red[red]!++;
      histogram.green[green]!++;
      histogram.blue[blue]!++;
      rgbParade.red[
        (FRAME_SCOPE_LEVELS - 1 - red) * FRAME_SCOPE_COLUMNS + column
      ]!++;
      rgbParade.green[
        (FRAME_SCOPE_LEVELS - 1 - green) * FRAME_SCOPE_COLUMNS + column
      ]!++;
      rgbParade.blue[
        (FRAME_SCOPE_LEVELS - 1 - blue) * FRAME_SCOPE_COLUMNS + column
      ]!++;

      histogram.luma[luma]!++;
      const level = FRAME_SCOPE_LEVELS - 1 - luma;
      lumaWaveform[level * FRAME_SCOPE_COLUMNS + column]!++;

      // BT.709 luma/chroma over encoded RGB values; Y is intentionally unused
      // because this scope plots chroma only.
      const cb = clamp(64 + (blue - luma) / 1.8556, 127);
      const cr = clamp(64 + (red - luma) / 1.5748, 127);
      vectorscope[cr * FRAME_SCOPE_VECTOR_SIZE + cb]!++;
      sampleCount++;
    }
  }

  return {
    sourceWidth,
    sourceHeight,
    sampleWidth: width,
    sampleHeight: height,
    mediaTime,
    sampleCount,
    histogram,
    rgbParade,
    lumaWaveform,
    vectorscope,
  };
}
