// SPDX-License-Identifier: Apache-2.0
import type { AudioMixPlan, Composition } from "@openfilm/core";
import { CANONICAL_AUDIO_FILTER } from "@openfilm/media";
import { audioAutomationFilters } from "./audio-filters.js";
const n = (value: number) => String(Number(value.toFixed(8)));
function tempo(speed: number): string[] {
  const filters: string[] = [];
  while (speed > 2) {
    filters.push("atempo=2");
    speed /= 2;
  }
  while (speed < 0.5) {
    filters.push("atempo=0.5");
    speed /= 0.5;
  }
  return [...filters, `atempo=${n(speed)}`];
}
/** One source/tempo/effect branch per occurrence, segmented only after its complete DSP history. */
export function compileAudioMixPlan(
  plan: AudioMixPlan,
  composition: Composition,
  inputs: ReadonlyMap<string, number>,
): { filters: string[]; labels: string[] } {
  const filters: string[] = [],
    labels: string[] = [],
    clips = new Map(
      composition.tracks.flatMap((t) => t.clips.map((c) => [c.id, c] as const)),
    ),
    groups = new Map<string, (typeof plan.segments)[number][]>();
  for (const segment of plan.segments) {
    const group = groups.get(segment.clipId) ?? [];
    group.push(segment);
    groups.set(segment.clipId, group);
  }
  let occurrence = 0;
  for (const [clipId, segments] of groups) {
    const clip = clips.get(clipId),
      input = inputs.get(clipId),
      first = segments[0]!;
    if (!clip || input === undefined)
      throw new Error("Audio plan references an unavailable occurrence input.");
    const suffix = occurrence++,
      branch = `policy-dsp-${suffix}`,
      duration = first.automationDurationSeconds;
    const chain =
      first.clock === "samples-48000"
        ? [
            CANONICAL_AUDIO_FILTER,
            `atrim=start_sample=${Math.round(first.sourceInSeconds * 48000)}:end_sample=${Math.round(first.sourceOutSeconds * 48000)}`,
            "asetpts=PTS-STARTPTS",
            ...tempo(first.speed),
            "apad",
            `atrim=end_sample=${Math.round(duration * 48000)}`,
          ]
        : [
            `atrim=start=${n(first.sourceInSeconds)}:end=${n(first.sourceOutSeconds)}`,
            "asetpts=PTS-STARTPTS",
            ...tempo(first.speed),
            "apad",
            `atrim=duration=${n(duration)}`,
          ];
    chain.push(...audioAutomationFilters(clip.audioAutomation, duration));
    if (first.clock === "legacy") chain.push("aresample=48000");
    filters.push(`[${input}:a:0]${chain.join(",")}[${branch}]`);
    const branches = segments.map((_, index) => `${branch}-${index}`);
    if (segments.length > 1)
      filters.push(
        `[${branch}]asplit=${segments.length}${branches.map((label) => `[${label}]`).join("")}`,
      );
    for (const [index, segment] of segments.entries()) {
      const label = `policy-audio-${suffix}-${index}`,
        start = segment.startSample - segment.automationStartSample,
        end = segment.endSample - segment.automationStartSample;
      if (!Number.isSafeInteger(start) || start < 0 || end <= start)
        throw new Error("Invalid audio segment window.");
      filters.push(
        `[${segments.length > 1 ? branches[index] : branch}]atrim=start_sample=${start}:end_sample=${end},asetpts=PTS-STARTPTS,volume=${n(segment.baseGain)},adelay=${segment.startSample}S:all=1[${label}]`,
      );
      labels.push(label);
    }
  }
  return { filters, labels };
}
