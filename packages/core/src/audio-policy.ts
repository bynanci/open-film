// SPDX-License-Identifier: Apache-2.0
import type {
  AudioAutomation,
  Clip,
  Composition,
  MediaAsset,
  OpenFilmProject,
  ProjectTimebaseV1,
} from "./models.js";
import type { resolveClipAudioRange } from "./sequence-waveform.js";
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
    /[\u0000-\u001f\u007f]/u.test(value)
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
    next.timelines.some((c) =>
      c.tracks.some((t) =>
        t.clips.some((clip) => Object.hasOwn(clip, "audioTiming")),
      ),
    )
  )
    next.schemaVersion = AUDIO_PROJECT_SCHEMA_VERSION;
  return next;
}
