// SPDX-License-Identifier: Apache-2.0
import type {
  AudioAutomation,
  Clip,
  Composition,
  MediaAsset,
  OpenFilmProject,
  ProjectTimebaseV1,
} from "./models.js";
import { resolveClipAudioRange } from "./sequence-waveform.js";
import { resolveClipSourceRange, resolveClipFrameRange } from "./sequence.js";
import { sequenceTimeAt, timebaseRate } from "./timebase.js";
import { ProjectValidationError } from "./validation.js";

export const AUDIO_PROJECT_SCHEMA_VERSION = "1.2.0" as const;
export const AUDIO_SAMPLE_RATE = 48000 as const;
export const MAX_AUDIO_BINDINGS = 1000;
export const MAX_AUDIO_SEGMENTS = 10000;
export interface AudioTimingV1 {
  version: 1;
  sampleRate: 48000;
  timelineStartSample: number;
  sourceInSample: number;
  sourceOutSample: number;
}
export type EmbeddedAudioPolicyV1 =
  | { version: 1; mode: "keep-primary" }
  | {
      version: 1;
      mode: "mix-secondary" | "replace-primary";
      role: AudioAutomation["role"];
      gain: number;
    };
export interface CoverageAudioBindingV1 {
  version: 1;
  bindingId: string;
  compositionId: string;
  primaryClipId: string;
  secondaryClipId: string;
  startSample: number;
  endSample: number;
  policy: EmbeddedAudioPolicyV1;
}
export interface AudioMixContext {
  timebase: ProjectTimebaseV1;
  coverage: readonly CoverageAudioBindingV1[];
}
export interface ResolvedAudioInterval {
  clipId: string;
  assetId: string;
  clock: "legacy" | "samples-48000";
  startSample: number;
  endSample: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  speed: number;
  automationDurationSeconds: number;
  legacyRange?: ReturnType<typeof resolveClipAudioRange>;
}
export interface AudioMixSegment extends ResolvedAudioInterval {
  key: string;
  trackIndex: number;
  clipIndex: number;
  automationStartSample: number;
  role: AudioAutomation["role"];
  baseGain: number;
}
export interface AudioMixPlan {
  version: 1;
  sampleRate: 48000;
  durationSamples: number;
  legacyOnly: boolean;
  segments: readonly AudioMixSegment[];
  masks: readonly {
    clipId: string;
    startSample: number;
    endSample: number;
    reason: "excluded-secondary" | "replaced-primary";
  }[];
}
function fail(path: string, message: string): never {
  throw new ProjectValidationError(path, message);
}
function closed(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(path, "expected a plain JSON object");
  const data = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(data)) {
    if (typeof key !== "string" || ![...required, ...optional].includes(key))
      fail(path, "unknown key");
    const descriptor = Object.getOwnPropertyDescriptor(data, key)!;
    if (!descriptor.enumerable || !("value" in descriptor))
      fail(path, "expected enumerable own JSON data");
  }
  for (const key of required)
    if (!Object.hasOwn(data, key)) fail(`${path}.${key}`, "required own field");
  return data;
}
function sample(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    fail(path, "expected a nonnegative safe integer sample");
  return value;
}
function identifier(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 31 || code === 127;
    })
  )
    fail(path, "expected a 1–256 character identifier");
  return value;
}
export function validateAudioTiming(value: unknown): AudioTimingV1 {
  const path = "audioTiming",
    data = closed(value, path, [
      "version",
      "sampleRate",
      "timelineStartSample",
      "sourceInSample",
      "sourceOutSample",
    ]);
  if (data.version !== 1) fail(path, "unsupported version");
  if (data.sampleRate !== AUDIO_SAMPLE_RATE)
    fail(path, "sample rate must be 48000");
  const timelineStartSample = sample(
    data.timelineStartSample,
    `${path}.timelineStartSample`,
  );
  const sourceInSample = sample(data.sourceInSample, `${path}.sourceInSample`),
    sourceOutSample = sample(data.sourceOutSample, `${path}.sourceOutSample`);
  if (sourceOutSample <= sourceInSample)
    fail(path, "source out must exceed source in");
  return {
    version: 1,
    sampleRate: AUDIO_SAMPLE_RATE,
    timelineStartSample,
    sourceInSample,
    sourceOutSample,
  };
}
/** Shared canonical arithmetic; actual decoded source availability is checked separately. */
export function resolveAudioTimingRange(
  value: unknown,
  speed: number,
  compositionDuration: number,
): {
  timing: AudioTimingV1;
  lengthSamples: number;
  endSample: number;
} {
  const timing = validateAudioTiming(value);
  if (!Number.isFinite(speed) || speed <= 0)
    fail("audioTiming", "speed must be positive and finite");
  const lengthSamples = sample(
      Math.round((timing.sourceOutSample - timing.sourceInSample) / speed),
      "audioTiming.length",
    ),
    endSample = sample(
      timing.timelineStartSample + lengthSamples,
      "audioTiming.end",
    );
  if (
    !lengthSamples ||
    !Number.isFinite(compositionDuration) ||
    compositionDuration <= 0 ||
    endSample > Math.round(compositionDuration * AUDIO_SAMPLE_RATE)
  )
    fail("audioTiming", "sound exceeds composition bounds");
  return { timing, lengthSamples, endSample };
}
export function validateEmbeddedAudioPolicy(
  value: unknown,
): EmbeddedAudioPolicyV1 {
  const path = "audioPolicy",
    data = closed(value, path, ["version", "mode"], ["role", "gain"]);
  if (data.version !== 1) fail(path, "unsupported version");
  if (data.mode === "keep-primary") {
    if (Object.hasOwn(data, "role") || Object.hasOwn(data, "gain"))
      fail(path, "keep-primary forbids role and gain");
    return { version: 1, mode: "keep-primary" };
  }
  if (data.mode !== "mix-secondary" && data.mode !== "replace-primary")
    fail(path, "unknown mode");
  if (
    !["music", "narration", "ambience", "dialogue"].includes(
      data.role as string,
    )
  )
    fail(path, "unknown role");
  if (
    typeof data.gain !== "number" ||
    !Number.isFinite(data.gain) ||
    data.gain < 0 ||
    data.gain > 1
  )
    fail(path, "gain must be finite in [0,1]");
  return {
    version: 1,
    mode: data.mode,
    role: data.role as AudioAutomation["role"],
    gain: data.gain,
  };
}
export function validateCoverageAudioBindings(
  value: unknown,
): readonly CoverageAudioBindingV1[] {
  const path = "coverage";
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > MAX_AUDIO_BINDINGS
  )
    fail(path, "expected at most 1000 bindings");
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^(0|[1-9]\d*)$/.test(key) ||
      Number(key) >= value.length
    )
      fail(path, "expected a dense JSON array");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !("value" in descriptor))
      fail(path, "expected JSON data");
  }
  const ids = new Set<string>();
  return Array.from({ length: value.length }, (_, index) => {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry || !("value" in entry))
      fail(path, "expected a dense JSON array");
    const data = closed(entry.value, `${path}[${index}]`, [
      "version",
      "bindingId",
      "compositionId",
      "primaryClipId",
      "secondaryClipId",
      "startSample",
      "endSample",
      "policy",
    ]);
    if (data.version !== 1) fail(path, "unsupported version");
    const bindingId = identifier(data.bindingId, path),
      compositionId = identifier(data.compositionId, path),
      primaryClipId = identifier(data.primaryClipId, path),
      secondaryClipId = identifier(data.secondaryClipId, path);
    if (ids.has(bindingId) || primaryClipId === secondaryClipId)
      fail(path, "duplicate binding or identical owners");
    ids.add(bindingId);
    const startSample = sample(data.startSample, path),
      endSample = sample(data.endSample, path);
    if (endSample <= startSample)
      fail(path, "expected a positive half-open window");
    return {
      version: 1,
      bindingId,
      compositionId,
      primaryClipId,
      secondaryClipId,
      startSample,
      endSample,
      policy: validateEmbeddedAudioPolicy(data.policy),
    };
  });
}
/** A capability floor; clearing or undoing sound timing never downgrades it. */
export function promoteAudioProject(project: OpenFilmProject): OpenFilmProject {
  const next = structuredClone(project);
  if (
    (next.schemaVersion === "1.0.0" || next.schemaVersion === "1.1.0") &&
    next.timelines.some((c) =>
      c.tracks.some((t) =>
        t.clips.some((clip) => Object.hasOwn(clip, "audioTiming")),
      ),
    )
  )
    next.schemaVersion = AUDIO_PROJECT_SCHEMA_VERSION;
  return next;
}

/** Same first-audio-stream admission as the existing renderer. Metadata is an early gate only. */
export function hasAudioStream(asset: MediaAsset): boolean {
  if (asset.mediaType === "image") return false;
  if (asset.mediaType === "audio") return true;
  const probe = asset.metadata["openfilm.ffprobe"] as
    { streams?: { codec_type?: string }[] } | undefined;
  return Boolean(
    probe?.streams?.some((stream) => stream.codec_type === "audio"),
  );
}
/** Header evidence never substitutes for the renderer's decoded source preflight. */
export function audioSourceEndSample(asset: MediaAsset): number {
  const verified = asset.metadata["openfilm.audio.canonical"] as
    { version?: number; lengthSamples?: unknown } | undefined;
  if (verified?.version === 1)
    return sample(verified.lengthSamples, "audioTiming.sourceDuration");
  const probe = asset.metadata["openfilm.ffprobe"] as
    | {
        streams?: {
          codec_type?: string;
          duration?: string | number;
          start_time?: string | number;
        }[];
        format?: { start_time?: string | number; duration?: string | number };
      }
    | undefined;
  const stream = probe?.streams?.find(
    (stream) => stream.codec_type === "audio",
  );
  const positive = (val: unknown): number | undefined => {
    if (val === undefined || val === null || val === "N/A") return undefined;
    const num = Number(val);
    return Number.isFinite(num) && num > 0 ? num : undefined;
  };
  const declared =
    positive(stream?.duration) ??
    positive(probe?.format?.duration) ??
    positive(asset.duration);
  if (!hasAudioStream(asset) || declared === undefined)
    fail(
      "audioTiming",
      "usable audio source duration is unavailable; inspect or relink the source",
    );
  return sample(
    Math.round(declared * AUDIO_SAMPLE_RATE),
    "audioTiming.sourceDuration",
  );
}
export function resolveAudioInterval(
  clip: Clip,
  asset: MediaAsset,
  compositionDuration: number,
): ResolvedAudioInterval {
  if (!Object.hasOwn(clip, "audioTiming")) {
    const range = resolveClipAudioRange(clip, asset);
    return {
      clipId: clip.id,
      assetId: asset.id,
      clock: "legacy",
      startSample: Math.round(range.audioStart * AUDIO_SAMPLE_RATE),
      endSample: Math.round(range.audioEnd * AUDIO_SAMPLE_RATE),
      sourceInSeconds: range.sourceIn,
      sourceOutSeconds: range.sourceOut,
      speed: range.speed,
      automationDurationSeconds: clip.timelineDuration,
      legacyRange: { ...range },
    };
  }
  const descriptor = Object.getOwnPropertyDescriptor(clip, "audioTiming")!;
  if (!("value" in descriptor)) fail("audioTiming", "expected own JSON data");
  const speed = clip.transform?.speed ?? 1,
    { timing, lengthSamples, endSample } = resolveAudioTimingRange(
      descriptor.value,
      speed,
      compositionDuration,
    );
  const available = audioSourceEndSample(asset);
  if (timing.sourceOutSample > available) {
    if (timing.sourceOutSample - available > 1) {
      fail(
        "audioTiming",
        "requested sound handle exceeds available source audio",
      );
    }
  }
  return {
    clipId: clip.id,
    assetId: asset.id,
    clock: "samples-48000",
    startSample: timing.timelineStartSample,
    endSample,
    sourceInSeconds: timing.sourceInSample / AUDIO_SAMPLE_RATE,
    sourceOutSeconds: timing.sourceOutSample / AUDIO_SAMPLE_RATE,
    speed,
    automationDurationSeconds: lengthSamples / AUDIO_SAMPLE_RATE,
  };
}
export function audioTimingFromHandles(
  clip: Clip,
  asset: MediaAsset,
  offsets: { startOffsetMs: number; endOffsetMs: number },
): AudioTimingV1 {
  for (const value of [offsets.startOffsetMs, offsets.endOffsetMs])
    if (!Number.isInteger(value) || value < -60000 || value > 60000)
      fail(
        "audioTiming.handles",
        "expected integer milliseconds in [-60000,60000]",
      );
  const source = resolveClipSourceRange(clip, asset),
    speed = source.speed,
    prior = clip.audioTiming;
  const start =
      prior?.timelineStartSample ?? Math.round(clip.timelineStart * 1000) * 48,
    sourceIn =
      prior?.sourceInSample ?? Math.round(source.sourceIn * AUDIO_SAMPLE_RATE);
  const result = validateAudioTiming({
    version: 1,
    sampleRate: AUDIO_SAMPLE_RATE,
    timelineStartSample: start + offsets.startOffsetMs * 48,
    sourceInSample: sourceIn + Math.round(offsets.startOffsetMs * 48 * speed),
    sourceOutSample: prior
      ? prior.sourceOutSample + Math.round(offsets.endOffsetMs * 48 * speed)
      : sourceIn +
        Math.round(
          (clip.timelineDuration + offsets.endOffsetMs / 1000) *
            AUDIO_SAMPLE_RATE *
            speed,
        ),
  });
  // This conversion has no Composition argument; its owner checks the film end.
  resolveAudioInterval(
    { ...clip, audioTiming: result },
    asset,
    Number.MAX_SAFE_INTEGER / AUDIO_SAMPLE_RATE,
  );
  return result;
}

type Occurrence = {
  clip: Clip;
  asset: MediaAsset;
  trackIndex: number;
  clipIndex: number;
  role: AudioAutomation["role"];
  interval?: ResolvedAudioInterval;
};
function overlaps(
  a: { startSample: number; endSample: number },
  b: { startSample: number; endSample: number },
): boolean {
  return a.startSample < b.endSample && b.startSample < a.endSample;
}
/** Bounded sorted endpoint sweep. No timeline-sized allocation or saved coverage state. */
export function buildAudioMixPlan(
  composition: Composition,
  assets: readonly MediaAsset[],
  context: AudioMixContext,
): AudioMixPlan {
  timebaseRate(context.timebase);
  const coverage = validateCoverageAudioBindings(context.coverage),
    durationSamples = sample(
      Math.round(composition.duration * AUDIO_SAMPLE_RATE),
      "audioPlan.duration",
    );
  if (!durationSamples)
    fail("audioPlan", "composition must have positive duration");
  const assetMap = new Map(assets.map((asset) => [asset.id, asset])),
    occurrences = new Map<string, Occurrence>();
  let explicit = false;
  for (const [trackIndex, track] of composition.tracks.entries())
    for (const [clipIndex, clip] of track.clips.entries()) {
      if (occurrences.size >= MAX_AUDIO_SEGMENTS)
        fail("audioPlan", "occurrence budget exceeded");
      if (occurrences.has(clip.id))
        fail("audioPlan", "duplicate occurrence identity");
      const asset = assetMap.get(clip.assetId);
      if (!asset) fail("audioPlan", `missing source for ${clip.id}`);
      explicit ||= Object.hasOwn(clip, "audioTiming");
      const playable = track.type !== "titles" && hasAudioStream(asset);
      if (!playable && Object.hasOwn(clip, "audioTiming"))
        fail("audioTiming", "source has no usable audio stream");
      occurrences.set(clip.id, {
        clip,
        asset,
        trackIndex,
        clipIndex,
        role:
          clip.audioAutomation?.role ??
          (track.type === "music" ? "music" : "dialogue"),
        ...(playable
          ? {
              interval: resolveAudioInterval(clip, asset, composition.duration),
            }
          : {}),
      });
    }
  const secondaries = new Map<string, CoverageAudioBindingV1[]>(),
    replacements = new Map<string, CoverageAudioBindingV1[]>();
  const primaries = new Set(coverage.map((b) => b.primaryClipId));
  for (const binding of coverage) {
    const primary = occurrences.get(binding.primaryClipId),
      secondary = occurrences.get(binding.secondaryClipId);
    if (
      binding.compositionId !== composition.id ||
      !primary?.interval ||
      !secondary ||
      primaries.has(binding.secondaryClipId)
    )
      fail("coverage", "foreign, missing or recursive occurrence relationship");
    let secondaryInterval = secondary.interval;
    if (!secondaryInterval && binding.policy.mode === "keep-primary") {
      const range = resolveClipFrameRange(secondary.clip, context.timebase);
      secondaryInterval = {
        ...primary.interval,
        startSample: Math.round(
          sequenceTimeAt(range.startFrame, context.timebase) *
            AUDIO_SAMPLE_RATE,
        ),
        endSample: Math.round(
          sequenceTimeAt(range.endFrame, context.timebase) * AUDIO_SAMPLE_RATE,
        ),
      };
    }
    if (
      !secondaryInterval ||
      binding.startSample < primary.interval.startSample ||
      binding.endSample > primary.interval.endSample ||
      binding.startSample < secondaryInterval.startSample ||
      binding.endSample > secondaryInterval.endSample ||
      binding.endSample > durationSamples
    )
      fail("coverage", "window must fit both audible ranges");
    const owned = secondaries.get(binding.secondaryClipId) ?? [];
    if (owned.some((other) => overlaps(binding, other)))
      fail("coverage", "overlapping secondary ownership");
    owned.push(binding);
    secondaries.set(binding.secondaryClipId, owned);
    if (binding.policy.mode === "replace-primary") {
      const suppressed = replacements.get(binding.primaryClipId) ?? [];
      if (suppressed.some((other) => overlaps(binding, other)))
        fail("coverage", "overlapping primary replacement");
      suppressed.push(binding);
      replacements.set(binding.primaryClipId, suppressed);
    }
  }
  const segments: AudioMixSegment[] = [],
    masks: AudioMixPlan["masks"][number][] = [];
  for (const occurrence of occurrences.values()) {
    const { clip, interval, trackIndex, clipIndex, role } = occurrence;
    if (!interval || interval.endSample <= interval.startSample) continue;
    const owned = secondaries.get(clip.id),
      suppressed = replacements.get(clip.id) ?? [];
    const endpoints = [
      ...new Set([
        interval.startSample,
        interval.endSample,
        ...(owned ?? suppressed).flatMap((b) => [b.startSample, b.endSample]),
      ]),
    ].sort((a, b) => a - b);
    for (let i = 1; i < endpoints.length; i++) {
      const startSample = endpoints[i - 1]!,
        endSample = endpoints[i]!;
      const binding = owned?.find(
        (b) => b.startSample <= startSample && b.endSample >= endSample,
      );
      const reason = owned
        ? !binding || binding.policy.mode === "keep-primary"
          ? "excluded-secondary"
          : undefined
        : suppressed.some(
              (b) => b.startSample <= startSample && b.endSample >= endSample,
            )
          ? "replaced-primary"
          : undefined;
      if (reason) {
        masks.push({ clipId: clip.id, startSample, endSample, reason });
        continue;
      }
      if (segments.length >= MAX_AUDIO_SEGMENTS)
        fail("audioPlan", "segment budget exceeded");
      const policy = binding?.policy,
        effectiveRole =
          policy && policy.mode !== "keep-primary" ? policy.role : role,
        baseGain =
          policy && policy.mode !== "keep-primary"
            ? policy.gain
            : (clip.transform?.volume ?? 1);
      if (!Number.isFinite(baseGain) || baseGain < 0)
        fail("audioPlan", "invalid base gain");
      segments.push({
        ...structuredClone(interval),
        startSample,
        endSample,
        key: `${clip.id}:${startSample}:${endSample}:${effectiveRole}:${baseGain}`,
        trackIndex,
        clipIndex,
        automationStartSample: interval.startSample,
        role: effectiveRole,
        baseGain,
      });
    }
  }
  segments.sort(
    (a, b) =>
      a.automationStartSample - b.automationStartSample ||
      a.trackIndex - b.trackIndex ||
      a.clipIndex - b.clipIndex ||
      a.startSample - b.startSample,
  );
  return {
    version: 1,
    sampleRate: AUDIO_SAMPLE_RATE,
    durationSamples,
    legacyOnly: !explicit && coverage.length === 0,
    segments,
    masks,
  };
}
