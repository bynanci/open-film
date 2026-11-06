// SPDX-License-Identifier: Apache-2.0
import type {
  AudioAutomationV1,
  AudioMixPlan,
  Composition,
} from "@openfilm/core";
import { CANONICAL_AUDIO_FILTER } from "@openfilm/media";
import { resolveMappedAutomationWindow } from "@openfilm/core";
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
/** One source/tempo/effect branch per DSP clock, segmented after its full history. */
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
    groups = new Map<string, (typeof plan.segments)[number][]>(),
    groupKeys = new Map<string, string>();
  for (const segment of plan.segments) {
    let key = groupKeys.get(segment.clipId);
    if (key === undefined) {
      const clip = clips.get(segment.clipId);
      key = clip ? audioDspGroupKey(clip) : `missing:${segment.clipId}`;
      groupKeys.set(segment.clipId, key);
    }
    const group = groups.get(key) ?? [];
    group.push(segment);
    groups.set(key, group);
  }
  let occurrence = 0;
  for (const segments of groups.values()) {
    const first = segments[0]!,
      clip = clips.get(first.clipId),
      input = inputs.get(first.clipId);
    if (!clip || input === undefined)
      throw new Error("Audio plan references an unavailable occurrence input.");
    if (clip.audioAutomation?.version === 2) {
      const timeMap = clip.audioAutomation.timeMap,
        automationCore = JSON.stringify({
          role: clip.audioAutomation.role,
          fadeIn: clip.audioAutomation.fadeIn,
          fadeOut: clip.audioAutomation.fadeOut,
          points: clip.audioAutomation.points,
          ducking: clip.audioAutomation.ducking,
        }),
        automation = stripTimeMap(clip.audioAutomation),
        suffix = occurrence++,
        branch = `policy-dsp-${suffix}`;
      const verifiedFragments = new Set<string>();
      for (const segment of segments) {
        if (verifiedFragments.has(segment.clipId)) continue;
        const fragment = clips.get(segment.clipId),
          fragmentAutomation = fragment?.audioAutomation,
          fragmentMap =
            fragmentAutomation?.version === 2
              ? fragmentAutomation.timeMap
              : undefined;
        if (
          !fragment ||
          fragmentAutomation?.version !== 2 ||
          fragment.audioTiming ||
          fragment.assetId !== clip.assetId ||
          !fragmentMap ||
          fragmentMap.continuityId !== timeMap.continuityId ||
          fragmentMap.sampleRate !== timeMap.sampleRate ||
          fragmentMap.durationSamples !== timeMap.durationSamples ||
          fragmentMap.sourceInSample !== timeMap.sourceInSample ||
          fragmentMap.sourceOutSample !== timeMap.sourceOutSample ||
          fragmentMap.sourceInSeconds !== timeMap.sourceInSeconds ||
          fragmentMap.sourceOutSeconds !== timeMap.sourceOutSeconds ||
          fragmentMap.timelineOffsetSeconds !== timeMap.timelineOffsetSeconds ||
          fragmentMap.speed !== timeMap.speed ||
          JSON.stringify({
            role: fragmentAutomation.role,
            fadeIn: fragmentAutomation.fadeIn,
            fadeOut: fragmentAutomation.fadeOut,
            points: fragmentAutomation.points,
            ducking: fragmentAutomation.ducking,
          }) !== automationCore
        )
          throw new Error(
            "Audio automation fragments do not share one verified source and DSP clock.",
          );
        const expectedSourceIn = Math.round(
            (timeMap.sourceInSeconds +
              (fragmentMap.offsetSamples / timeMap.sampleRate) *
                timeMap.speed) *
              timeMap.sampleRate,
          ),
          expectedSourceOut = Math.round(
            (timeMap.sourceInSeconds +
              ((fragmentMap.offsetSamples +
                Math.round(fragment.timelineDuration * timeMap.sampleRate)) /
                timeMap.sampleRate) *
                timeMap.speed) *
              timeMap.sampleRate,
          ),
          actualSourceIn = Math.round(
            (fragment.sourceIn ?? 0) * timeMap.sampleRate,
          ),
          actualSourceOut = Math.round(
            (fragment.sourceOut ??
              (fragment.sourceIn ?? 0) +
                fragment.timelineDuration * (fragment.transform?.speed ?? 1)) *
              timeMap.sampleRate,
          );
        if (
          Math.abs(actualSourceIn - expectedSourceIn) > 1 ||
          Math.abs((fragment.transform?.speed ?? 1) - timeMap.speed) > 1e-12 ||
          actualSourceOut < expectedSourceOut - 1 ||
          actualSourceOut > timeMap.sourceOutSample + 1 ||
          fragmentMap.offsetSamples +
            Math.round(fragment.timelineDuration * timeMap.sampleRate) >
            timeMap.durationSamples + 1
        )
          throw new Error(
            "Audio automation fragment source bounds no longer match its saved clock.",
          );
        verifiedFragments.add(segment.clipId);
        resolveMappedAutomationWindow(
          fragment,
          Math.min(
            fragment.timelineDuration,
            ((fragment.sourceOut ??
              (fragment.sourceIn ?? 0) +
                fragment.timelineDuration * timeMap.speed) -
              (fragment.sourceIn ?? 0)) /
              timeMap.speed,
          ),
        );
      }
      const chain = [
        `atrim=start=${n(timeMap.sourceInSeconds)}:end=${n(timeMap.sourceOutSeconds)}`,
        "asetpts=PTS-STARTPTS",
        ...tempo(timeMap.speed),
        "apad",
        `atrim=duration=${n(timeMap.durationSamples / timeMap.sampleRate)}`,
        ...audioAutomationFilters(
          automation,
          timeMap.durationSamples / timeMap.sampleRate,
        ),
        "aresample=48000",
      ];
      filters.push(`[${input}:a:0]${chain.join(",")}[${branch}]`);
      const branches = segments.map((_, index) => `${branch}-${index}`);
      if (segments.length > 1)
        filters.push(
          `[${branch}]asplit=${segments.length}${branches.map((label) => `[${label}]`).join("")}`,
        );
      for (const [index, segment] of segments.entries()) {
        const fragment = clips.get(segment.clipId);
        if (!fragment || fragment.audioAutomation?.version !== 2)
          throw new Error("Audio segment lost its validated automation clock.");
        const fragmentMap = fragment.audioAutomation.timeMap,
          start =
            fragmentMap.offsetSamples +
            (segment.startSample - segment.automationStartSample),
          end =
            fragmentMap.offsetSamples +
            (segment.endSample - segment.automationStartSample),
          label = `policy-audio-${suffix}-${index}`;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < fragmentMap.offsetSamples ||
          end <= start ||
          end > fragmentMap.durationSamples + 1
        )
          throw new Error(
            "Audio segment exceeds its automation sample window.",
          );
        filters.push(
          `[${segments.length > 1 ? branches[index] : branch}]atrim=start_sample=${start}:end_sample=${end},asetpts=PTS-STARTPTS,volume=${n(segment.baseGain)},adelay=${segment.startSample}S:all=1[${label}]`,
        );
        labels.push(label);
      }
      continue;
    }
    const suffix = occurrence++,
      branch = `policy-dsp-${suffix}`,
      duration = first.automationDurationSeconds;
    const chain =
      first.clock === "samples-48000"
        ? [
            CANONICAL_AUDIO_FILTER,
            `atrim=start_sample=${Math.round(first.sourceInSeconds * 48000)}:end_sample=${Math.round(first.sourceOutSeconds * 48000)}`,
            "asetpts=PTS-STARTPTS",
            // atempo=1 still performs SOLA and can shift/duplicate transients.
            ...(first.speed === 1 ? [] : tempo(first.speed)),
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

function stripTimeMap(
  automation: Extract<
    NonNullable<
      Composition["tracks"][number]["clips"][number]["audioAutomation"]
    >,
    { version: 2 }
  >,
): AudioAutomationV1 {
  const { timeMap: _timeMap, ...fields } = automation;
  return { ...fields, version: 1 };
}

function audioDspGroupKey(
  clip: Composition["tracks"][number]["clips"][number],
): string {
  const automation = clip.audioAutomation;
  if (automation?.version !== 2) return `clip:${clip.id}`;
  const { timeMap } = automation;
  return `mapped:${JSON.stringify({
    assetId: clip.assetId,
    continuityId: timeMap.continuityId,
    sampleRate: timeMap.sampleRate,
    durationSamples: timeMap.durationSamples,
    sourceInSample: timeMap.sourceInSample,
    sourceOutSample: timeMap.sourceOutSample,
    sourceInSeconds: timeMap.sourceInSeconds,
    sourceOutSeconds: timeMap.sourceOutSeconds,
    timelineOffsetSeconds: timeMap.timelineOffsetSeconds,
    speed: timeMap.speed,
    role: automation.role,
    fadeIn: automation.fadeIn,
    fadeOut: automation.fadeOut,
    points: automation.points,
    ducking: automation.ducking,
  })}`;
}
