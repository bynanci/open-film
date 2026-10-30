// SPDX-License-Identifier: Apache-2.0
import type { WaveformData } from "./intelligence.js";
import type { Clip, MediaAsset, ProjectTimebaseV1 } from "./models.js";
import { resolveClipFrameRange, resolveClipSourceRange } from "./sequence.js";
import { sequenceTimeAt } from "./timebase.js";

function binPosition(time: number, sampleRate: number): number {
  const position = time * sampleRate;
  const boundary = Math.round(position);
  return Math.abs(position - boundary) <=
    Number.EPSILON * Math.max(1, Math.abs(position)) * 4
    ? boundary
    : position;
}

/** Source-bin maximum, with a shorter final bin and half-open boundaries. */
export function waveformPeakBetween(
  wave: WaveformData,
  start: number,
  end: number,
): number {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(wave.sampleRate) ||
    wave.sampleRate <= 0 ||
    !Number.isFinite(wave.duration) ||
    wave.duration <= 0 ||
    !Array.isArray(wave.peaks) ||
    wave.peaks.length > 20_000
  )
    throw new Error("Invalid waveform range or bin metadata.");
  const first = Math.max(0, start);
  const last = Math.min(wave.duration, end);
  if (first >= last) return 0;
  const from = Math.floor(binPosition(first, wave.sampleRate));
  const to = Math.min(
    wave.peaks.length,
    Math.max(from + 1, Math.ceil(binPosition(last, wave.sampleRate))),
  );
  let peak = 0;
  for (let index = from; index < to; index++) {
    const value = wave.peaks[index] ?? 0;
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error("Invalid waveform peak.");
    peak = Math.max(peak, value);
  }
  return peak;
}

/** Existing FFmpeg audio uses millisecond delay; picture edges are frame-rounded. */
export function resolveClipAudioRange(
  clip: Clip,
  asset: MediaAsset,
): {
  sourceIn: number;
  sourceOut: number;
  speed: number;
  delayMilliseconds: number;
  audioStart: number;
  audioEnd: number;
} {
  if (!Number.isFinite(clip.timelineStart) || clip.timelineStart < 0)
    throw new Error("Invalid audio sequence start.");
  const source = resolveClipSourceRange(clip, asset);
  const sourceOut = Math.min(
    source.sourceOut,
    asset.duration ?? source.sourceOut,
  );
  const delayMilliseconds = Math.round(clip.timelineStart * 1000);
  if (!Number.isSafeInteger(delayMilliseconds))
    throw new Error("Unsafe audio delay.");
  const audioStart = delayMilliseconds / 1000;
  const duration = Math.max(
    0,
    Math.min(
      clip.timelineDuration,
      (sourceOut - source.sourceIn) / source.speed,
    ),
  );
  return {
    ...source,
    sourceOut,
    delayMilliseconds,
    audioStart,
    audioEnd: audioStart + duration,
  };
}

export interface ClipWaveformProjection {
  peaks: number[];
  covered: boolean[];
  startFrame: number;
  endFrame: number;
  audioStart: number;
  audioEnd: number;
}

/** Derive raw source peaks; gain/ducking/mix and video fade tails are separate. */
export function projectClipWaveform(input: {
  clip: Clip;
  asset: MediaAsset;
  waveform: WaveformData;
  sourceHash: string;
  timebase: ProjectTimebaseV1;
  viewStartFrame: number;
  viewEndFrame: number;
  columns: number;
}): ClipWaveformProjection {
  const {
    clip,
    asset,
    waveform: wave,
    sourceHash,
    timebase,
    viewStartFrame,
    viewEndFrame,
    columns,
  } = input;
  if (
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > 2048 ||
    viewEndFrame <= viewStartFrame
  )
    throw new Error("Invalid bounded waveform viewport.");
  const viewStart = sequenceTimeAt(viewStartFrame, timebase);
  const viewEnd = sequenceTimeAt(viewEndFrame, timebase);
  if (
    clip.assetId !== asset.id ||
    wave.assetId !== asset.id ||
    !sourceHash ||
    wave.provenance.sourceHash !== sourceHash ||
    (asset.contentHash && asset.contentHash !== sourceHash)
  )
    throw new Error("Waveform evidence does not match the current source.");
  if (
    asset.mediaType === "image" ||
    !Array.isArray(wave.peaks) ||
    !wave.peaks.length ||
    wave.peaks.length > 20_000 ||
    wave.peaks.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1,
    )
  )
    throw new Error("Invalid bounded source waveform.");
  waveformPeakBetween(wave, 0, 0);
  const frames = resolveClipFrameRange(clip, timebase);
  const audio = resolveClipAudioRange(clip, asset);
  const audioEnd = Math.min(
    audio.audioEnd,
    audio.audioStart +
      Math.max(0, (wave.duration - audio.sourceIn) / audio.speed),
  );
  const peaks = Array<number>(columns).fill(0);
  const covered = Array<boolean>(columns).fill(false);
  for (let column = 0; column < columns; column++) {
    const start = Math.max(
      audio.audioStart,
      viewStart + ((viewEnd - viewStart) * column) / columns,
    );
    const end = Math.min(
      audioEnd,
      viewStart + ((viewEnd - viewStart) * (column + 1)) / columns,
    );
    const epsilon =
      Number.EPSILON * Math.max(1, Math.abs(start), Math.abs(end)) * 8;
    if (end - start <= epsilon) continue;
    covered[column] = true;
    peaks[column] = waveformPeakBetween(
      wave,
      audio.sourceIn + (start - audio.audioStart) * audio.speed,
      Math.min(
        audio.sourceOut,
        audio.sourceIn + (end - audio.audioStart) * audio.speed,
      ),
    );
  }
  return { ...frames, audioStart: audio.audioStart, audioEnd, peaks, covered };
}
