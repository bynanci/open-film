import { describe, expect, it } from "vitest";
import {
  FRAME_SCOPE_COLUMNS,
  FRAME_SCOPE_LEVELS,
  FRAME_SCOPE_VECTOR_SIZE,
  analyzeDecodedFrame,
} from "../../apps/desktop/src/frame-scopes.js";

function frame(...rgba: number[]) {
  return analyzeDecodedFrame({
    width: rgba.length / 4,
    height: 1,
    mediaTime: 0.75,
    pixels: new Uint8ClampedArray(rgba),
  });
}

describe("bounded decoded-frame scopes", () => {
  it("counts RGB and luma histogram values and creates column waveforms", () => {
    const result = frame(0, 0, 0, 255, 255, 255, 255, 255);

    expect(result.sampleCount).toBe(2);
    expect(result.histogram.red[0]).toBe(1);
    expect(result.histogram.red[255]).toBe(1);
    expect(result.histogram.green).toEqual(result.histogram.red);
    expect(result.histogram.blue).toEqual(result.histogram.red);
    expect(result.histogram.luma[0]).toBe(1);
    expect(result.histogram.luma[255]).toBe(1);
    expect(
      result.lumaWaveform[(FRAME_SCOPE_LEVELS - 1) * FRAME_SCOPE_COLUMNS],
    ).toBe(1);
    expect(result.lumaWaveform[64]).toBe(1);
    expect(result.rgbParade.red[(FRAME_SCOPE_LEVELS - 1) * 128]).toBe(1);
    expect(result.rgbParade.blue[64]).toBe(1);
  });

  it("maps saturated color into the BT.709 chroma plane", () => {
    const result = frame(255, 0, 0, 255);
    const redLuma = Math.round(0.2126 * 255);
    const cb = Math.round(64 + (0 - redLuma) / 1.8556);
    const cr = Math.min(127, Math.round(64 + (255 - redLuma) / 1.5748));

    expect(result.vectorscope[cr * FRAME_SCOPE_VECTOR_SIZE + cb]).toBe(1);
  });

  it("ignores fully transparent pixels and keeps decoded frame metadata", () => {
    const result = analyzeDecodedFrame({
      width: 2,
      height: 1,
      sourceWidth: 640,
      sourceHeight: 320,
      mediaTime: 1.25,
      pixels: new Uint8ClampedArray([255, 10, 20, 0, 20, 30, 40, 255]),
    });

    expect(result.sampleCount).toBe(1);
    expect(result.sourceWidth).toBe(640);
    expect(result.sourceHeight).toBe(320);
    expect(result.sampleWidth).toBe(2);
    expect(result.sampleHeight).toBe(1);
    expect(result.mediaTime).toBe(1.25);
    expect(result.histogram.red[255]).toBe(0);
    expect(result.histogram.red[20]).toBe(1);
  });

  it("rejects malformed or oversized decoded samples before allocation", () => {
    expect(() =>
      analyzeDecodedFrame({
        width: 513,
        height: 1,
        mediaTime: 0,
        pixels: new Uint8ClampedArray(513 * 4),
      }),
    ).toThrow("Invalid or unbounded decoded frame sample");
    expect(() =>
      analyzeDecodedFrame({
        width: 1,
        height: 1,
        mediaTime: -1,
        pixels: new Uint8ClampedArray(4),
      }),
    ).toThrow("Invalid or unbounded decoded frame sample");
  });
});
