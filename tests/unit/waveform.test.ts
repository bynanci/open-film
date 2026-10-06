import { describe, expect, it } from "vitest";
import type { WaveformData } from "@openfilm/core";
import { waveformPath } from "../../apps/desktop/src/waveform";

function waveform(
  peaks: number[],
  sampleRate = 50,
  duration = peaks.length / sampleRate,
): WaveformData {
  return {
    assetId: "audio",
    duration,
    sampleRate,
    peaks,
    provenance: {
      providerId: "openfilm.ffmpeg-waveform",
      version: "test",
      sourceHash: "audio-hash",
      createdAt: "2026-10-06T00:00:00.000Z",
    },
  };
}

function bars(path: string) {
  return [...path.matchAll(/M([\d.]+),([\d.]+)v([\d.]+)/g)].map(
    ([, x, y, height]) => ({
      x: Number(x),
      y: Number(y),
      height: Number(height),
    }),
  );
}

describe("waveform source-time geometry", () => {
  const partialTail = waveform([...Array<number>(50).fill(0), 1], 50, 1.001);

  it("keeps a partial final bin at its sample-rate time in the full view", () => {
    const rendered = bars(waveformPath(partialTail, 0, 1.001));
    expect(rendered).toHaveLength(800);
    expect(rendered.filter((bar) => bar.height > 0.8)).toEqual([
      { x: 799.5, y: 8, height: 84 },
    ]);
  });

  it("places the same tail at 1s in a zoomed viewport", () => {
    // The editor's maximum audio zoom uses a minimum 40ms viewport.
    const rendered = bars(waveformPath(partialTail, 0.961, 0.04));
    const loud = rendered.filter((bar) => bar.height > 0.8);
    expect(loud).toHaveLength(20);
    expect(loud[0]).toEqual({ x: 780.5, y: 8, height: 84 });
    expect(loud.at(-1)).toEqual({ x: 799.5, y: 8, height: 84 });
  });

  it("clips a partial final bin at the source end when metadata extends the view", () => {
    const rendered = bars(waveformPath(partialTail, 1, 0.02, 20));
    expect(rendered.filter((bar) => bar.height > 0.8)).toEqual([
      { x: 0.5, y: 8, height: 84 },
    ]);
    expect(
      bars(waveformPath(partialTail, 1.001, 0.019, 19)).every(
        (bar) => bar.height === 0.8,
      ),
    ).toBe(true);
  });

  it.each([50, 25, 12.5])(
    "aggregates each column's maximum at %s bins per second",
    (sampleRate) => {
      const wave = waveform([0.2, 0.9, 0.3, 0.4, 0.7, 0.6], sampleRate);
      const rendered = bars(waveformPath(wave, 0, wave.duration, 3));
      expect(rendered).toHaveLength(3);
      for (const [index, peak] of [0.9, 0.4, 0.7].entries()) {
        expect(rendered[index]?.height).toBeCloseTo(peak * 84);
        expect(rendered[index]?.y).toBeCloseTo(50 - peak * 42);
      }
    },
  );

  it("renders no path until both waveform and viewport are available", () => {
    expect(waveformPath(undefined, 0, 1)).toBe("");
    expect(waveformPath(partialTail, 0, 0)).toBe("");
  });
});
