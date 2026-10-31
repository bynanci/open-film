// SPDX-License-Identifier: Apache-2.0
import type { Clip, Composition, ProjectTimebaseV1 } from "./models.js";
import {
  AUDIO_SAMPLE_RATE,
  validateCoverageAudioBindings,
  validateEmbeddedAudioPolicy,
  type CoverageAudioBindingV1,
  type EmbeddedAudioPolicyV1,
} from "./audio-policy.js";
import { resolveClipFrameRange } from "./sequence.js";
import { sequenceTimeAt } from "./timebase.js";
import { ProjectValidationError } from "./validation.js";

export type CoverageRole = "primary-narrative" | "b-roll-overlay";

export interface ClipCoverage {
  version: 1;
  role: CoverageRole;
  primaryClipId?: string;
  audioPolicy?: EmbeddedAudioPolicyV1;
}

export interface CoverageProposal {
  version: 1;
  id: string;
  compositionId: string;
  bRollClipId: string;
  primaryClipId: string;
  role: "b-roll-overlay";
  audioPolicy: EmbeddedAudioPolicyV1;
  timelineStart: number;
  timelineDuration: number;
  evidence: {
    primaryRange: { timelineStart: number; timelineDuration: number };
    bRollRange: { timelineStart: number; timelineDuration: number };
    overlapStart: number;
    overlapDuration: number;
    sourceHash?: string;
  };
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
  ) {
    fail(path, "expected a plain JSON object");
  }
  const data = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(data)) {
    if (typeof key !== "string" || ![...required, ...optional].includes(key)) {
      fail(path, "unknown key");
    }
    const descriptor = Object.getOwnPropertyDescriptor(data, key)!;
    if (!descriptor.enumerable || !("value" in descriptor)) {
      fail(path, "expected enumerable own JSON data");
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(data, key)) fail(`${path}.${key}`, "required own field");
  }
  return data;
}

export function validateClipCoverage(
  value: unknown,
  path = "coverage",
  knownClipIds?: ReadonlySet<string>,
): ClipCoverage {
  const data = closed(
    value,
    path,
    ["version", "role"],
    ["primaryClipId", "audioPolicy"],
  );
  if (data.version !== 1) fail(`${path}.version`, "expected version 1");
  if (data.role !== "primary-narrative" && data.role !== "b-roll-overlay") {
    fail(
      `${path}.role`,
      'expected role to be "primary-narrative" or "b-roll-overlay"',
    );
  }
  let primaryClipId: string | undefined;
  if (Object.hasOwn(data, "primaryClipId")) {
    if (typeof data.primaryClipId !== "string" || !data.primaryClipId.trim()) {
      fail(`${path}.primaryClipId`, "expected a non-empty string identifier");
    }
    primaryClipId = data.primaryClipId;
    if (knownClipIds && !knownClipIds.has(primaryClipId)) {
      fail(
        `${path}.primaryClipId`,
        `unknown primary clip ID "${primaryClipId}"`,
      );
    }
  }
  let audioPolicy: EmbeddedAudioPolicyV1 | undefined;
  if (Object.hasOwn(data, "audioPolicy")) {
    audioPolicy = validateEmbeddedAudioPolicy(data.audioPolicy);
  }
  return {
    version: 1,
    role: data.role,
    ...(primaryClipId !== undefined ? { primaryClipId } : {}),
    ...(audioPolicy !== undefined ? { audioPolicy } : {}),
  };
}

export function validateCoverageProposal(
  value: unknown,
  path = "coverageProposal",
): CoverageProposal {
  const data = closed(value, path, [
    "version",
    "id",
    "compositionId",
    "bRollClipId",
    "primaryClipId",
    "role",
    "audioPolicy",
    "timelineStart",
    "timelineDuration",
    "evidence",
  ]);
  if (data.version !== 1) fail(`${path}.version`, "expected version 1");
  if (typeof data.id !== "string" || !data.id.trim()) {
    fail(`${path}.id`, "expected a non-empty string identifier");
  }
  if (typeof data.compositionId !== "string" || !data.compositionId.trim()) {
    fail(`${path}.compositionId`, "expected a non-empty string identifier");
  }
  if (typeof data.bRollClipId !== "string" || !data.bRollClipId.trim()) {
    fail(`${path}.bRollClipId`, "expected a non-empty string identifier");
  }
  if (typeof data.primaryClipId !== "string" || !data.primaryClipId.trim()) {
    fail(`${path}.primaryClipId`, "expected a non-empty string identifier");
  }
  if (data.bRollClipId === data.primaryClipId) {
    fail(path, "primary and secondary clip IDs must differ");
  }
  if (data.role !== "b-roll-overlay") {
    fail(`${path}.role`, 'expected role to be "b-roll-overlay"');
  }
  const audioPolicy = validateEmbeddedAudioPolicy(data.audioPolicy);
  if (
    typeof data.timelineStart !== "number" ||
    !Number.isFinite(data.timelineStart) ||
    data.timelineStart < 0
  ) {
    fail(`${path}.timelineStart`, "expected a non-negative finite number");
  }
  if (
    typeof data.timelineDuration !== "number" ||
    !Number.isFinite(data.timelineDuration) ||
    data.timelineDuration <= 0
  ) {
    fail(`${path}.timelineDuration`, "expected a positive finite number");
  }
  const ev = closed(
    data.evidence,
    `${path}.evidence`,
    ["primaryRange", "bRollRange", "overlapStart", "overlapDuration"],
    ["sourceHash"],
  );
  const primaryRange = closed(
    ev.primaryRange,
    `${path}.evidence.primaryRange`,
    ["timelineStart", "timelineDuration"],
  );
  const bRollRange = closed(ev.bRollRange, `${path}.evidence.bRollRange`, [
    "timelineStart",
    "timelineDuration",
  ]);
  return {
    version: 1,
    id: data.id,
    compositionId: data.compositionId,
    bRollClipId: data.bRollClipId,
    primaryClipId: data.primaryClipId,
    role: "b-roll-overlay",
    audioPolicy,
    timelineStart: data.timelineStart,
    timelineDuration: data.timelineDuration,
    evidence: {
      primaryRange: {
        timelineStart: Number(primaryRange.timelineStart),
        timelineDuration: Number(primaryRange.timelineDuration),
      },
      bRollRange: {
        timelineStart: Number(bRollRange.timelineStart),
        timelineDuration: Number(bRollRange.timelineDuration),
      },
      overlapStart: Number(ev.overlapStart),
      overlapDuration: Number(ev.overlapDuration),
      ...(typeof ev.sourceHash === "string"
        ? { sourceHash: ev.sourceHash }
        : {}),
    },
  };
}

function clipSampleRange(
  clip: Clip,
  timebase: ProjectTimebaseV1,
): { startSample: number; endSample: number } {
  if (clip.audioTiming) {
    const startSample = clip.audioTiming.timelineStartSample;
    const length = Math.round(
      (clip.audioTiming.sourceOutSample - clip.audioTiming.sourceInSample) /
        (clip.transform?.speed ?? 1),
    );
    return { startSample, endSample: startSample + length };
  }
  const frameRange = resolveClipFrameRange(clip, timebase);
  const startSeconds = sequenceTimeAt(frameRange.startFrame, timebase);
  const endSeconds = sequenceTimeAt(frameRange.endFrame, timebase);
  return {
    startSample: Math.round(startSeconds * AUDIO_SAMPLE_RATE),
    endSample: Math.round(endSeconds * AUDIO_SAMPLE_RATE),
  };
}

/**
 * Resolves coverage audio bindings between primary narrative clips and secondary B-roll clips.
 * Preserves primary narration continuously by default (keep-primary), while supporting explicit
 * secondary audio mixing (mix-secondary) or primary replacement (replace-primary).
 */
export function resolveCompositionCoverageBindings(
  composition: Composition,
  timebase: ProjectTimebaseV1,
): readonly CoverageAudioBindingV1[] {
  const allClips = composition.tracks.flatMap((track) => track.clips);
  const clipMap = new Map(allClips.map((clip) => [clip.id, clip]));

  // Primary clips: clips marked explicit primary-narrative, or visual clips in the primary video track
  const explicitPrimaries = allClips.filter(
    (clip) => clip.coverage?.role === "primary-narrative",
  );
  const primaryTrack = composition.tracks.find((t) => t.type === "video");
  const candidatePrimaries =
    explicitPrimaries.length > 0
      ? explicitPrimaries
      : (primaryTrack?.clips ?? []);

  // Secondary overlay clips
  const overlayClips = allClips.filter(
    (clip) => clip.coverage?.role === "b-roll-overlay",
  );

  const derivedBindings: CoverageAudioBindingV1[] = [];

  for (const bRoll of overlayClips) {
    let targets: Clip[];
    if (bRoll.coverage?.primaryClipId) {
      const primary = clipMap.get(bRoll.coverage.primaryClipId);
      if (primary && primary.id !== bRoll.id) {
        targets = [primary];
      } else {
        // Fall back to candidate primaries overlapping in timeline
        targets = candidatePrimaries.filter((p) => {
          if (p.id === bRoll.id) return false;
          const start = Math.max(p.timelineStart, bRoll.timelineStart);
          const end = Math.min(
            p.timelineStart + p.timelineDuration,
            bRoll.timelineStart + bRoll.timelineDuration,
          );
          return end > start;
        });
      }
    } else {
      // Find candidate primaries that overlap in time
      targets = candidatePrimaries.filter((p) => {
        if (p.id === bRoll.id) return false;
        const start = Math.max(p.timelineStart, bRoll.timelineStart);
        const end = Math.min(
          p.timelineStart + p.timelineDuration,
          bRoll.timelineStart + bRoll.timelineDuration,
        );
        return end > start;
      });
    }

    const bRollSamples = clipSampleRange(bRoll, timebase);

    for (const primary of targets) {
      const primarySamples = clipSampleRange(primary, timebase);
      const startSample = Math.max(
        primarySamples.startSample,
        bRollSamples.startSample,
      );
      const endSample = Math.min(
        primarySamples.endSample,
        bRollSamples.endSample,
      );

      if (endSample > startSample) {
        const policy: EmbeddedAudioPolicyV1 = bRoll.coverage?.audioPolicy ?? {
          version: 1,
          mode: "keep-primary",
        };
        const bindingId = `coverage:${composition.id}:${primary.id}:${bRoll.id}:${startSample}:${endSample}`;
        derivedBindings.push({
          version: 1,
          bindingId,
          compositionId: composition.id,
          primaryClipId: primary.id,
          secondaryClipId: bRoll.id,
          startSample,
          endSample,
          policy,
        });
      }
    }
  }

  // Keep explicit manual bindings (custom bindingId), while regenerating auto-derived coverage bindings
  const explicitBindings = (composition.coverageAudioBindings ?? []).filter(
    (b) => !b.bindingId.startsWith("coverage:"),
  );
  const merged = new Map<string, CoverageAudioBindingV1>();

  for (const binding of derivedBindings) {
    merged.set(
      `${binding.primaryClipId}:${binding.secondaryClipId}:${binding.startSample}:${binding.endSample}`,
      binding,
    );
  }

  for (const binding of explicitBindings) {
    merged.set(
      `${binding.primaryClipId}:${binding.secondaryClipId}:${binding.startSample}:${binding.endSample}`,
      binding,
    );
  }

  const result = [...merged.values()];
  return validateCoverageAudioBindings(result);
}

export function createCoverageProposal(
  composition: Composition,
  options: {
    bRollClipId: string;
    primaryClipId?: string;
    audioPolicy?: EmbeddedAudioPolicyV1;
    timebase: ProjectTimebaseV1;
    sourceHash?: string;
  },
): CoverageProposal {
  const allClips = composition.tracks.flatMap((t) => t.clips);
  const clipMap = new Map(allClips.map((c) => [c.id, c]));

  const bRoll = clipMap.get(options.bRollClipId);
  if (!bRoll) {
    fail("coverage", `B-roll clip "${options.bRollClipId}" not found`);
  }

  let primary: Clip | undefined;
  if (options.primaryClipId) {
    primary = clipMap.get(options.primaryClipId);
    if (!primary) {
      fail("coverage", `Primary clip "${options.primaryClipId}" not found`);
    }
    if (primary.id === bRoll.id) {
      fail("coverage", "Primary and B-roll clip IDs must differ");
    }
  } else {
    const candidatePrimaries = allClips.filter(
      (c) =>
        c.id !== bRoll.id &&
        (c.coverage?.role === "primary-narrative" ||
          composition.tracks
            .find((t) => t.type === "video")
            ?.clips.includes(c)),
    );
    primary = candidatePrimaries.find((p) => {
      const start = Math.max(p.timelineStart, bRoll.timelineStart);
      const end = Math.min(
        p.timelineStart + p.timelineDuration,
        bRoll.timelineStart + bRoll.timelineDuration,
      );
      return end > start;
    });
    if (!primary) {
      fail(
        "coverage",
        `No overlapping primary narrative clip found for B-roll "${bRoll.id}"`,
      );
    }
  }

  const overlapStart = Math.max(primary.timelineStart, bRoll.timelineStart);
  const overlapEnd = Math.min(
    primary.timelineStart + primary.timelineDuration,
    bRoll.timelineStart + bRoll.timelineDuration,
  );
  const overlapDuration = overlapEnd - overlapStart;

  if (overlapDuration <= 0) {
    fail(
      "coverage",
      "B-roll clip does not overlap with primary narrative clip",
    );
  }

  const audioPolicy = options.audioPolicy
    ? validateEmbeddedAudioPolicy(options.audioPolicy)
    : { version: 1 as const, mode: "keep-primary" as const };

  return {
    version: 1,
    id: `proposal:coverage:${composition.id}:${primary.id}:${bRoll.id}`,
    compositionId: composition.id,
    bRollClipId: bRoll.id,
    primaryClipId: primary.id,
    role: "b-roll-overlay",
    audioPolicy,
    timelineStart: overlapStart,
    timelineDuration: overlapDuration,
    evidence: {
      primaryRange: {
        timelineStart: primary.timelineStart,
        timelineDuration: primary.timelineDuration,
      },
      bRollRange: {
        timelineStart: bRoll.timelineStart,
        timelineDuration: bRoll.timelineDuration,
      },
      overlapStart,
      overlapDuration,
      ...(options.sourceHash ? { sourceHash: options.sourceHash } : {}),
    },
  };
}
