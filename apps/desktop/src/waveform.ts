import type { WaveformData } from "@openfilm/core";

function binPosition(time: number, sampleRate: number) {
  const position = time * sampleRate;
  const boundary = Math.round(position);
  // Arithmetic on viewport fractions can land just either side of a bin edge.
  return Math.abs(position - boundary) <=
    Number.EPSILON * Math.max(1, Math.abs(position)) * 4
    ? boundary
    : position;
}

/** Render source-time peak bins, including a shorter final bin, into SVG bars. */
export function waveformPath(
  wave: WaveformData | undefined,
  viewStart: number,
  viewDuration: number,
  columns = 800,
) {
  if (!wave || viewDuration <= 0 || !Number.isFinite(viewDuration)) return "";
  let path = "";
  for (let column = 0; column < columns; column++) {
    const start = Math.max(0, viewStart + (column / columns) * viewDuration);
    const end = Math.min(
      wave.duration,
      viewStart + ((column + 1) / columns) * viewDuration,
    );
    let peak = 0;
    if (start < end) {
      const from = Math.floor(binPosition(start, wave.sampleRate));
      const to = Math.min(
        wave.peaks.length,
        Math.max(from + 1, Math.ceil(binPosition(end, wave.sampleRate))),
      );
      for (let index = from; index < to; index++)
        peak = Math.max(peak, wave.peaks[index] ?? 0);
    }
    const amplitude = Math.max(0.4, peak * 42);
    path += `M${column + 0.5},${50 - amplitude}v${amplitude * 2}`;
  }
  return path;
}
