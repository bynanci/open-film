// SPDX-License-Identifier: Apache-2.0
import { ApplicationError } from "./errors.js";
import { graphicSceneAssetIds, type GraphicNode } from "./graphic-scenes.js";
import {
  validateAnalysisProvenance,
  type AnalysisProvenance,
} from "./intelligence.js";
import type { Composition, MediaAsset, ProjectTimebaseV1 } from "./models.js";
import {
  applyTimelineRippleIntervals,
  type TranscriptRippleInterval,
} from "./transcript-ripple.js";
import { validateComposition } from "./validation.js";

export const MAX_AUDIO_ACTIVITY_DURATION_SECONDS = 24 * 60 * 60;
export const MAX_SILENCE_INTERVALS = 2000;
export const DEFAULT_SILENCE_PADDING_SECONDS = 0.12;
const RIPPLE_EPSILON = 1e-4;
const RANGE_EPSILON = 1e-7;

/** Measured low-energy windows, not a speech/VAD or semantic silence claim. Times use the source clock. */
export interface AudioActivityEvidence {
  version: 1;
  assetId: string;
  sourceHash: string;
  duration: number;
  sampleRate: 48000;
  windowSeconds: 0.02;
  audioStreamIndex: number;
  parameters: { thresholdDb: number; minimumSilenceSeconds: number };
  silenceIntervals: TranscriptRippleInterval[];
  provenance: AnalysisProvenance;
}

export interface SilenceCutProposal {
  version: 1;
  compositionId: string;
  baseRevision: string;
  assetId: string;
  sourceHash: string;
  evidence: AudioActivityEvidence;
  paddingSeconds: number;
  candidates: SilenceCutCandidate[];
  selectedCandidateIds: string[];
  sourceIntervals: TranscriptRippleInterval[];
  timelineIntervals: TranscriptRippleInterval[];
  totalDurationReduced: number;
  affectedClipIds: string[];
}

export interface SilenceCutCandidate {
  id: string;
  sourceInterval: TranscriptRippleInterval;
  sourceIntervals: TranscriptRippleInterval[];
  timelineIntervals: TranscriptRippleInterval[];
  durationReduced: number;
}

export interface CreateSilenceCutOptions {
  baseRevision: string;
  paddingSeconds?: number;
  assets?: readonly MediaAsset[];
  selectedCandidateIds?: readonly string[];
}

function invalid(path: string, message: string): never {
  throw new ApplicationError("request.invalid", `${path}: ${message}`);
}

function object(
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
    invalid(path, "expected a plain JSON object");
  const data = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  const keys = Reflect.ownKeys(data);
  if (keys.length > allowed.length) invalid(path, "unknown fields");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(data, key)!;
    if (
      typeof key !== "string" ||
      !allowed.includes(key) ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    )
      invalid(path, "expected only named, enumerable JSON data fields");
  }
  for (const key of required)
    if (!Object.hasOwn(data, key)) invalid(`${path}.${key}`, "required field");
  return data;
}

function text(value: unknown, path: string, maximum = 256): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    invalid(
      path,
      `expected a nonblank string of at most ${maximum} characters`,
    );
  return value;
}

function number(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    invalid(path, `expected a finite number in [${minimum}, ${maximum}]`);
  return value;
}

function hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    invalid(path, "expected a lowercase SHA-256 digest");
  return value;
}

function list(value: unknown, path: string): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > MAX_SILENCE_INTERVALS
  )
    invalid(
      path,
      `expected a JSON array of at most ${MAX_SILENCE_INTERVALS} items`,
    );
  const values = value as unknown[];
  if (Reflect.ownKeys(values).length !== values.length + 1)
    invalid(path, "expected a dense JSON array");
  for (let i = 0; i < values.length; i++) {
    const entry = Object.getOwnPropertyDescriptor(values, String(i));
    if (!entry?.enumerable || !("value" in entry))
      invalid(path, "expected a dense JSON data array");
  }
  return values;
}

function intervals(
  value: unknown,
  path: string,
  maximum: number,
): TranscriptRippleInterval[] {
  let previousEnd = 0;
  return list(value, path).map((entry, index) => {
    const p = `${path}[${index}]`;
    const data = object(entry, p, ["start", "end"]);
    const start = number(data.start, `${p}.start`, previousEnd, maximum);
    const end = number(data.end, `${p}.end`, 0, maximum);
    if (end <= start) invalid(p, "end must be greater than start");
    previousEnd = end;
    return { start, end };
  });
}

export function validateAudioActivityEvidence(
  value: unknown,
): AudioActivityEvidence {
  const path = "audioActivity";
  const data = object(value, path, [
    "version",
    "assetId",
    "sourceHash",
    "duration",
    "sampleRate",
    "windowSeconds",
    "audioStreamIndex",
    "parameters",
    "silenceIntervals",
    "provenance",
  ]);
  if (
    data.version !== 1 ||
    data.sampleRate !== 48000 ||
    data.windowSeconds !== 0.02
  )
    invalid(path, "expected version 1, 48000 Hz and 0.02-second windows");
  const assetId = text(data.assetId, `${path}.assetId`);
  const sourceHash = hash(data.sourceHash, `${path}.sourceHash`);
  const duration = number(
    data.duration,
    `${path}.duration`,
    Number.EPSILON,
    MAX_AUDIO_ACTIVITY_DURATION_SECONDS,
  );
  const audioStreamIndex = number(
    data.audioStreamIndex,
    `${path}.audioStreamIndex`,
    0,
    1023,
  );
  if (!Number.isInteger(audioStreamIndex))
    invalid(`${path}.audioStreamIndex`, "expected an integer");
  const params = object(data.parameters, `${path}.parameters`, [
    "thresholdDb",
    "minimumSilenceSeconds",
  ]);
  const parameters = {
    thresholdDb: number(
      params.thresholdDb,
      `${path}.parameters.thresholdDb`,
      -80,
      -10,
    ),
    minimumSilenceSeconds: number(
      params.minimumSilenceSeconds,
      `${path}.parameters.minimumSilenceSeconds`,
      0.1,
      30,
    ),
  };
  const silenceIntervals = intervals(
    data.silenceIntervals,
    `${path}.silenceIntervals`,
    duration,
  );
  if (
    silenceIntervals.some(
      (range) =>
        range.end - range.start + RANGE_EPSILON <
        parameters.minimumSilenceSeconds,
    )
  )
    invalid(
      `${path}.silenceIntervals`,
      "a silence interval is shorter than the measured minimum",
    );
  const p = `${path}.provenance`;
  const rawProvenance = object(
    data.provenance,
    p,
    ["providerId", "version", "sourceHash", "createdAt"],
    ["model", "providerVersion"],
  );
  text(rawProvenance.providerId, `${p}.providerId`);
  text(rawProvenance.version, `${p}.version`);
  text(rawProvenance.createdAt, `${p}.createdAt`, 64);
  if (Object.hasOwn(rawProvenance, "model"))
    text(rawProvenance.model, `${p}.model`, 512);
  if (Object.hasOwn(rawProvenance, "providerVersion"))
    text(rawProvenance.providerVersion, `${p}.providerVersion`, 512);
  if (hash(rawProvenance.sourceHash, `${p}.sourceHash`) !== sourceHash)
    invalid(p, "sourceHash does not match evidence");
  let provenance: AnalysisProvenance;
  try {
    provenance = validateAnalysisProvenance(rawProvenance);
  } catch (error) {
    invalid(p, error instanceof Error ? error.message : "invalid provenance");
  }
  return {
    version: 1,
    assetId,
    sourceHash,
    duration,
    sampleRate: 48000,
    windowSeconds: 0.02,
    audioStreamIndex,
    parameters,
    silenceIntervals,
    provenance,
  };
}

export function validateSilenceCutProposal(value: unknown): SilenceCutProposal {
  const path = "silenceCut";
  const data = object(value, path, [
    "version",
    "compositionId",
    "baseRevision",
    "assetId",
    "sourceHash",
    "evidence",
    "paddingSeconds",
    "candidates",
    "selectedCandidateIds",
    "sourceIntervals",
    "timelineIntervals",
    "totalDurationReduced",
    "affectedClipIds",
  ]);
  if (data.version !== 1) invalid(`${path}.version`, "expected version 1");
  const evidence = validateAudioActivityEvidence(data.evidence);
  const assetId = text(data.assetId, `${path}.assetId`);
  const sourceHash = hash(data.sourceHash, `${path}.sourceHash`);
  if (assetId !== evidence.assetId || sourceHash !== evidence.sourceHash)
    invalid(path, "source identity does not match evidence");
  const sourceIntervals = intervals(
    data.sourceIntervals,
    `${path}.sourceIntervals`,
    evidence.duration,
  );
  const timelineIntervals = intervals(
    data.timelineIntervals,
    `${path}.timelineIntervals`,
    Number.MAX_SAFE_INTEGER,
  );
  const candidates = list(data.candidates, `${path}.candidates`).map(
    (entry, index): SilenceCutCandidate => {
      const candidatePath = `${path}.candidates[${index}]`;
      const candidate = object(entry, candidatePath, [
        "id",
        "sourceInterval",
        "sourceIntervals",
        "timelineIntervals",
        "durationReduced",
      ]);
      const id = text(candidate.id, `${candidatePath}.id`, 128);
      if (!/^silence-[a-z0-9-]+$/u.test(id))
        invalid(
          `${candidatePath}.id`,
          "expected a stable silence candidate ID",
        );
      const sourceInterval = intervals(
        [candidate.sourceInterval],
        `${candidatePath}.sourceInterval`,
        evidence.duration,
      )[0]!;
      const sourceIntervals = intervals(
        candidate.sourceIntervals,
        `${candidatePath}.sourceIntervals`,
        evidence.duration,
      );
      const timelineIntervals = intervals(
        candidate.timelineIntervals,
        `${candidatePath}.timelineIntervals`,
        Number.MAX_SAFE_INTEGER,
      );
      const durationReduced = number(
        candidate.durationReduced,
        `${candidatePath}.durationReduced`,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      if (
        Math.abs(
          durationReduced -
            timelineIntervals.reduce(
              (sum, range) => sum + range.end - range.start,
              0,
            ),
        ) > RANGE_EPSILON
      )
        invalid(
          `${candidatePath}.durationReduced`,
          "does not match its timeline intervals",
        );
      return {
        id,
        sourceInterval,
        sourceIntervals,
        timelineIntervals,
        durationReduced,
      };
    },
  );
  if (
    candidates.length !== evidence.silenceIntervals.length ||
    candidates.some(
      (candidate, index) =>
        candidate.sourceInterval.start !==
          evidence.silenceIntervals[index]?.start ||
        candidate.sourceInterval.end !== evidence.silenceIntervals[index]?.end,
    )
  )
    invalid(`${path}.candidates`, "must map every measured source interval");
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  if (candidateIds.size !== candidates.length)
    invalid(`${path}.candidates`, "duplicate candidate IDs");
  const selectedCandidateIds = list(
    data.selectedCandidateIds,
    `${path}.selectedCandidateIds`,
  ).map((id, index) => text(id, `${path}.selectedCandidateIds[${index}]`, 128));
  if (
    new Set(selectedCandidateIds).size !== selectedCandidateIds.length ||
    selectedCandidateIds.some((id) => !candidateIds.has(id))
  )
    invalid(
      `${path}.selectedCandidateIds`,
      "must contain unique known candidate IDs",
    );
  const selectedIds = new Set(selectedCandidateIds);
  const expectedSourceIntervals = merge(
    candidates
      .filter((candidate) => selectedIds.has(candidate.id))
      .flatMap((candidate) => candidate.sourceIntervals),
  );
  const expectedTimelineIntervals = merge(
    candidates
      .filter((candidate) => selectedIds.has(candidate.id))
      .flatMap((candidate) => candidate.timelineIntervals),
  );
  if (
    JSON.stringify(expectedSourceIntervals) !==
      JSON.stringify(sourceIntervals) ||
    JSON.stringify(expectedTimelineIntervals) !==
      JSON.stringify(timelineIntervals)
  )
    invalid(
      path,
      "the aggregate proposal no longer matches selected candidates",
    );
  const totalDurationReduced = number(
    data.totalDurationReduced,
    `${path}.totalDurationReduced`,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (
    Math.abs(
      totalDurationReduced -
        timelineIntervals.reduce(
          (sum, range) => sum + range.end - range.start,
          0,
        ),
    ) > RANGE_EPSILON
  )
    invalid(
      `${path}.totalDurationReduced`,
      "does not match timeline intervals",
    );
  const affectedClipIds = list(
    data.affectedClipIds,
    `${path}.affectedClipIds`,
  ).map((id, index) => text(id, `${path}.affectedClipIds[${index}]`));
  if (new Set(affectedClipIds).size !== affectedClipIds.length)
    invalid(`${path}.affectedClipIds`, "duplicate clip IDs");
  return {
    version: 1,
    compositionId: text(data.compositionId, `${path}.compositionId`),
    baseRevision: text(data.baseRevision, `${path}.baseRevision`),
    assetId,
    sourceHash,
    evidence,
    paddingSeconds: number(data.paddingSeconds, `${path}.paddingSeconds`, 0, 2),
    candidates,
    selectedCandidateIds,
    sourceIntervals,
    timelineIntervals,
    totalDurationReduced,
    affectedClipIds,
  };
}

function merge(
  ranges: readonly TranscriptRippleInterval[],
): TranscriptRippleInterval[] {
  const merged: TranscriptRippleInterval[] = [];
  for (const range of [...ranges].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    const previous = merged.at(-1);
    // Never bridge a non-silent gap, even when it is shorter than a frame.
    if (previous && range.start <= previous.end)
      previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function lockedNodes(nodes: readonly GraphicNode[]): boolean {
  return nodes.some(
    (node) =>
      node.locked || (node.type === "group" && lockedNodes(node.children)),
  );
}

export function createSilenceCutProposal(
  composition: Composition,
  input: AudioActivityEvidence,
  options: CreateSilenceCutOptions,
): SilenceCutProposal {
  validateComposition(composition);
  const evidence = validateAudioActivityEvidence(input);
  const baseRevision = text(options?.baseRevision, "baseRevision");
  const paddingSeconds = number(
    options?.paddingSeconds ?? DEFAULT_SILENCE_PADDING_SECONDS,
    "paddingSeconds",
    0,
    2,
  );
  const assets = new Map(options.assets?.map((asset) => [asset.id, asset]));
  const asset = assets.get(evidence.assetId);
  if (options.assets && !asset)
    throw new ApplicationError(
      "media.notFound",
      "The analyzed source is not in the project asset snapshot.",
      404,
    );
  if (
    asset?.contentHash &&
    (!/^[a-f0-9]{64}$/i.test(asset.contentHash) ||
      asset.contentHash.toLowerCase() !== evidence.sourceHash)
  )
    throw new ApplicationError(
      "source.changed",
      "The analyzed source hash no longer matches the asset.",
      409,
    );
  if (asset?.mediaType === "image")
    throw new ApplicationError(
      "media.unsupported",
      "Silence editing requires an audio or video source.",
      422,
    );
  const targetClips = composition.tracks
    .filter((track) => track.timing !== "overlay")
    .flatMap((track) => track.clips)
    .filter((clip) => clip.assetId === evidence.assetId);
  if (!targetClips.length)
    throw new ApplicationError(
      "timeline.notFound",
      "The analyzed source has no primary timeline instances.",
      404,
    );
  if (targetClips.length > MAX_SILENCE_INTERVALS)
    invalid("composition", "too many source instances for one silence review");
  const candidates: SilenceCutCandidate[] = evidence.silenceIntervals.map(
    (sourceInterval, index) => {
      const cut = {
        start: sourceInterval.start + paddingSeconds,
        end: sourceInterval.end - paddingSeconds,
      };
      const sourceRanges: TranscriptRippleInterval[] = [];
      const timelineRanges: TranscriptRippleInterval[] = [];
      for (const clip of targetClips) {
        const speed = clip.transform?.speed ?? 1;
        const sourceIn = clip.sourceIn ?? 0;
        const playedOut = sourceIn + clip.timelineDuration * speed;
        const sourceOut = clip.sourceOut ?? playedOut;
        if (
          !Number.isFinite(speed) ||
          speed <= 0 ||
          sourceIn < 0 ||
          sourceOut > evidence.duration + RANGE_EPSILON ||
          playedOut > sourceOut + RANGE_EPSILON
        )
          throw new ApplicationError(
            "timeline.conflict",
            "A source instance extends outside the analyzed source clock.",
            409,
          );
        if (cut.end - cut.start <= RIPPLE_EPSILON) continue;
        const start = Math.max(sourceIn, cut.start);
        const end = Math.min(playedOut, sourceOut, cut.end);
        if ((end - start) / speed <= RIPPLE_EPSILON) continue;
        sourceRanges.push({ start, end });
        timelineRanges.push({
          start: clip.timelineStart + (start - sourceIn) / speed,
          end: Math.min(
            clip.timelineStart + clip.timelineDuration,
            clip.timelineStart + (end - sourceIn) / speed,
          ),
        });
      }
      const sourceMapped = merge(sourceRanges);
      const timelineMapped = merge(timelineRanges);
      return {
        id: `silence-${String(index + 1).padStart(4, "0")}-${Math.round(sourceInterval.start * 1000).toString(36)}-${Math.round(sourceInterval.end * 1000).toString(36)}`,
        sourceInterval,
        sourceIntervals: sourceMapped,
        timelineIntervals: timelineMapped,
        durationReduced: timelineMapped.reduce(
          (sum, range) => sum + range.end - range.start,
          0,
        ),
      };
    },
  );
  const requestedSelection = options.selectedCandidateIds
    ? [...options.selectedCandidateIds]
    : candidates.map((candidate) => candidate.id);
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  if (
    new Set(requestedSelection).size !== requestedSelection.length ||
    requestedSelection.some((id) => !candidateIds.has(id))
  )
    invalid("selectedCandidateIds", "must contain unique known candidate IDs");
  const selected = new Set(requestedSelection);
  const selectedCandidates = candidates.filter((candidate) =>
    selected.has(candidate.id),
  );
  const sourceIntervals = merge(
    selectedCandidates.flatMap((candidate) => candidate.sourceIntervals),
  );
  const timelineIntervals = merge(
    selectedCandidates.flatMap((candidate) => candidate.timelineIntervals),
  );
  if (timelineIntervals.length > MAX_SILENCE_INTERVALS)
    invalid("timelineIntervals", "too many mapped cuts for one review");
  const affectedClipIds: string[] = [];
  const firstCut = timelineIntervals[0]?.start;
  if (firstCut !== undefined) {
    for (const track of composition.tracks)
      for (const clip of track.clips) {
        const clipEnd = clip.timelineStart + clip.timelineDuration;
        if (clipEnd <= firstCut + RIPPLE_EPSILON) continue;
        affectedClipIds.push(clip.id);
        if (
          track.locked ||
          clip.locked ||
          assets.get(clip.assetId)?.state.locked ||
          (clip.layout?.secondary &&
            assets.get(clip.layout.secondary.assetId)?.state.locked)
        )
          throw new ApplicationError(
            "timeline.lockedClipConflict",
            `Silence ripple would change locked clip, track or source "${clip.id}".`,
            409,
          );
        if (clip.userOverrides?.isUserPinned)
          throw new ApplicationError(
            "timeline.pinConflict",
            `Silence ripple would change user-pinned clip "${clip.id}".`,
            409,
          );
        if (clip.audioTiming)
          throw new ApplicationError(
            "timeline.audioTimingConflict",
            "Reset independent sound timing before a silence ripple affects that clip.",
            409,
          );
      }
    // Exercise the exact detached ripple mapping before publishing a Review.
    // Invalid or unsupported automation clocks must fail before they become
    // an accepted proposal, while the saved Composition remains untouched.
    applyTimelineRippleIntervals(composition, timelineIntervals);
    for (const scene of composition.graphicScenes ?? []) {
      if (scene.start + scene.duration <= firstCut + RIPPLE_EPSILON) continue;
      if (scene.userOverrides?.isUserPinned)
        throw new ApplicationError(
          "timeline.pinConflict",
          `Silence ripple would change user-pinned scene "${scene.id}".`,
          409,
        );
      if (
        lockedNodes(scene.nodes) ||
        graphicSceneAssetIds([scene]).some((id) => assets.get(id)?.state.locked)
      )
        throw new ApplicationError(
          "timeline.lockedClipConflict",
          `Silence ripple would change a locked scene or source "${scene.id}".`,
          409,
        );
    }
  }
  return validateSilenceCutProposal({
    version: 1,
    compositionId: composition.id,
    baseRevision,
    assetId: evidence.assetId,
    sourceHash: evidence.sourceHash,
    evidence,
    paddingSeconds,
    candidates,
    selectedCandidateIds: candidates
      .filter((candidate) => selected.has(candidate.id))
      .map((candidate) => candidate.id),
    sourceIntervals,
    timelineIntervals,
    totalDurationReduced: timelineIntervals.reduce(
      (sum, range) => sum + (range.end - range.start),
      0,
    ),
    affectedClipIds: affectedClipIds.sort(),
  });
}

/** Recompute geometry and protections from current state. The application separately authenticates the saved review and revision. */
export function applySilenceCutProposal(
  composition: Composition,
  input: SilenceCutProposal,
  options: {
    assets?: readonly MediaAsset[];
    timebase?: ProjectTimebaseV1;
  } = {},
): Composition {
  const proposal = validateSilenceCutProposal(input);
  if (proposal.compositionId !== composition.id)
    throw new ApplicationError(
      "timeline.conflict",
      "The silence proposal belongs to another composition.",
      409,
    );
  const current = createSilenceCutProposal(composition, proposal.evidence, {
    baseRevision: proposal.baseRevision,
    paddingSeconds: proposal.paddingSeconds,
    selectedCandidateIds: proposal.selectedCandidateIds,
    assets: options.assets,
  });
  for (const key of [
    "candidates",
    "selectedCandidateIds",
    "sourceIntervals",
    "timelineIntervals",
    "totalDurationReduced",
    "affectedClipIds",
  ] as const)
    if (JSON.stringify(current[key]) !== JSON.stringify(proposal[key]))
      throw new ApplicationError(
        "timeline.conflict",
        "The silence proposal no longer matches current timeline geometry. Prepare a new review.",
        409,
      );
  return applyTimelineRippleIntervals(
    composition,
    current.timelineIntervals,
    options.timebase,
  );
}
