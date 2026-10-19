// Modified by OpenFilm contributors on 2026-10-19. See LICENSE and NOTICE.
import { runProcess } from "@openfilm/media";
import type { AudioAutomation } from "@openfilm/core";
export const AUDIO_METER_FILTER =
  "asetnsamples=n=4800,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level+RMS_level,ametadata=print:file=-";
export interface AudioMeasurement {
  integratedLufs: number | null;
  samplePeakDbfs: number | null;
  truePeakDbtp: number | null;
  loudnessRangeLu: number | null;
  duration: number;
  meterBins: { at: number; peakDbfs: number | null; rmsDbfs: number | null }[];
}
const finite = (value: unknown): number | null => {
  const number =
    typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
};
/** Measures decoded output, never source metadata or estimated automation values. */
export async function measureAudioOutput(
  path: string,
  signal?: AbortSignal,
): Promise<AudioMeasurement> {
  const probe = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      path,
    ],
    { signal },
  );
  const info = JSON.parse(probe.stdout.toString()) as {
    format: { duration: string };
    streams: { codec_type: string }[];
  };
  const duration = Number(info.format.duration);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 3600 ||
    !info.streams.some((s) => s.codec_type === "audio")
  )
    throw new Error(
      "Audio quality requires a decoded audio output of at most one hour.",
    );
  const loudness = await runProcess(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-i",
      path,
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-af",
      "loudnorm=I=-16:TP=-1:LRA=11:print_format=json",
      "-f",
      "null",
      "-",
    ],
    { signal, timeoutMs: 300000 },
  );
  const json = /\{\s*"input_i"[\s\S]*?\}/u.exec(loudness.stderr)?.[0];
  if (!json) throw new Error("FFmpeg did not return loudness evidence.");
  const values = JSON.parse(json) as Record<string, string>;
  const meter = await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-i",
      path,
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-af",
      AUDIO_METER_FILTER,
      "-f",
      "null",
      "-",
    ],
    { signal, maxOutputBytes: 64 * 1024 * 1024, timeoutMs: 300000 },
  );
  const blocks = meter.stdout
    .toString()
    .split(/(?=frame:)/u)
    .filter((v) => v.startsWith("frame:"));
  const all = blocks
    .map((block) => ({
      at: Number(/pts_time:([\d.]+)/u.exec(block)?.[1]),
      peakDbfs: finite(
        /lavfi.astats.Overall.Peak_level=([^\s]+)/u.exec(block)?.[1],
      ),
      rmsDbfs: finite(
        /lavfi.astats.Overall.RMS_level=([^\s]+)/u.exec(block)?.[1],
      ),
    }))
    .filter((bin) => Number.isFinite(bin.at));
  if (!all.length)
    throw new Error("FFmpeg did not return decoded meter evidence.");
  const peaks = all.flatMap((bin) =>
    bin.peakDbfs === null ? [] : [bin.peakDbfs],
  );
  return {
    integratedLufs: finite(values.input_i),
    truePeakDbtp: finite(values.input_tp),
    loudnessRangeLu: finite(values.input_lra),
    samplePeakDbfs: peaks.length
      ? peaks.reduce((maximum, peak) => Math.max(maximum, peak), -Infinity)
      : null,
    duration,
    meterBins: all.filter(
      (_, index) => index % Math.max(1, Math.ceil(all.length / 5000)) === 0,
    ),
  };
}
export interface AudioNormalizationSuggestion {
  role: AudioAutomation["role"];
  targetLufs: number;
  gainDb: number;
  volume: number;
  limited: boolean;
}
/** Conservative constant gain: keep all existing envelope/fade/ducking data. */
export function normalizationSuggestion(
  measured: Pick<AudioMeasurement, "integratedLufs" | "truePeakDbtp">,
  role: AudioAutomation["role"],
  currentVolume: number,
): AudioNormalizationSuggestion | null {
  if (
    !Number.isFinite(measured.integratedLufs) ||
    !Number.isFinite(measured.truePeakDbtp) ||
    measured.integratedLufs === null ||
    measured.truePeakDbtp === null ||
    !Number.isFinite(currentVolume) ||
    currentVolume <= 0 ||
    currentVolume > 1
  )
    return null;
  const targets = { narration: -16, dialogue: -16, music: -23, ambience: -24 };
  const targetLufs = targets[role];
  const desired = targetLufs - measured.integratedLufs;
  const gainDb = Math.min(
    desired,
    -1 - measured.truePeakDbtp,
    20 * Math.log10(1 / currentVolume),
  );
  return {
    role,
    targetLufs,
    gainDb,
    volume: Math.min(1, currentVolume * 10 ** (gainDb / 20)),
    limited: gainDb < desired - 0.01,
  };
}
