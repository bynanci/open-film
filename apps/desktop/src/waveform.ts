import { waveformPeakBetween, type WaveformData } from "@openfilm/core";

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
    const peak = waveformPeakBetween(wave, start, end);
    const amplitude = Math.max(0.4, peak * 42);
    path += `M${column + 0.5},${50 - amplitude}v${amplitude * 2}`;
  }
  return path;
}
