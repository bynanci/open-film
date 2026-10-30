// SPDX-License-Identifier: Apache-2.0
import {
  ApplicationError,
  graphicSceneAssetIds,
  resolveClipSourceRange,
  validateCollectDeliveryOptions,
  type CollectCoverageEntry,
  type CollectCoveragePlanV1,
  type CollectCoverageReason,
  type CollectDeliveryOptionsV1,
  type CollectSourceUse,
  type CollectSourceWindow,
  type Composition,
  type MediaAsset,
} from "@openfilm/core";

export interface CollectCoverageInput {
  projectId: string;
  revision: string;
  baselinePlanId: string;
  options: CollectDeliveryOptionsV1;
  assets: readonly MediaAsset[];
  compositions: readonly Composition[];
  /** Caller must classify graph/layout dependencies not represented by clip ranges. */
  opaqueAssetIds: readonly string[];
  /** Immutable source-clock evidence must not be silently retimed or discarded. */
  evidenceBoundAssetIds: readonly string[];
}
const LIMITS = { assets: 10_000, uses: 100_000 } as const;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function invalid(): never {
  throw new ApplicationError(
    "request.invalid",
    "Collect coverage requires bounded, distinct references and complete revision identities.",
  );
}
function id(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.length > 512 ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    invalid();
}
function union(ranges: CollectSourceWindow[]): CollectSourceWindow[] {
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const result: CollectSourceWindow[] = [];
  for (const range of ranges) {
    const last = result.at(-1);
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end);
    else result.push({ ...range });
  }
  return result;
}
/** A deterministic read-only projection; no file or project mutation is permitted. */
export function planCollectCoverage(
  input: CollectCoverageInput,
): CollectCoveragePlanV1 {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "projectId",
          "revision",
          "baselinePlanId",
          "options",
          "assets",
          "compositions",
          "opaqueAssetIds",
          "evidenceBoundAssetIds",
        ].includes(key),
    )
  )
    invalid();
  id(input.projectId);
  for (const hash of [input.revision, input.baselinePlanId])
    if (!/^[a-f0-9]{64}$/u.test(hash)) invalid();
  const options = validateCollectDeliveryOptions(input.options);
  if (
    !Array.isArray(input.assets) ||
    input.assets.length > LIMITS.assets ||
    !Array.isArray(input.compositions) ||
    !input.compositions.length ||
    input.compositions.length > LIMITS.assets
  )
    invalid();
  const assets = new Map<string, MediaAsset>();
  for (const asset of input.assets) {
    if (!asset || typeof asset !== "object") invalid();
    id(asset.id);
    if (assets.has(asset.id)) invalid();
    assets.set(asset.id, asset);
  }
  const flags = (values: readonly string[]): Set<string> => {
    if (
      !Array.isArray(values) ||
      values.length > LIMITS.assets ||
      new Set(values).size !== values.length
    )
      invalid();
    for (const value of values) {
      id(value);
      if (!assets.has(value)) invalid();
    }
    return new Set(values);
  };
  const opaque = flags(input.opaqueAssetIds),
    evidence = flags(input.evidenceBoundAssetIds);
  const uses = new Map<string, CollectSourceUse[]>(),
    invalidRanges = new Set<string>(),
    lockedAssets = new Set<string>(),
    pinnedAssets = new Set<string>();
  const compositionIds = new Set<string>();
  let count = 0;
  for (const composition of input.compositions) {
    id(composition.id);
    if (
      compositionIds.has(composition.id) ||
      !Array.isArray(composition.tracks)
    )
      invalid();
    compositionIds.add(composition.id);
    for (const track of composition.captionTracks ?? [])
      for (const cue of track.cues)
        if (cue.source.kind === "transcript") {
          if (!assets.has(cue.source.assetId)) invalid();
          evidence.add(cue.source.assetId);
        }
    for (const assetId of graphicSceneAssetIds(
      composition.graphicScenes ?? [],
    )) {
      if (!assets.has(assetId)) invalid();
      opaque.add(assetId);
    }
    for (const scene of composition.graphicScenes ?? [])
      if (scene.userOverrides?.isUserPinned)
        for (const id of graphicSceneAssetIds([scene])) pinnedAssets.add(id);
    const trackIds = new Set<string>(),
      clipIds = new Set<string>();
    for (const track of composition.tracks) {
      id(track.id);
      if (trackIds.has(track.id) || !Array.isArray(track.clips)) invalid();
      trackIds.add(track.id);
      for (const clip of track.clips) {
        if (++count > LIMITS.uses) invalid();
        id(clip.id);
        if (clipIds.has(clip.id)) invalid();
        clipIds.add(clip.id);
        if (clip.userOverrides?.isUserPinned) {
          pinnedAssets.add(clip.assetId);
          if (clip.layout?.secondary)
            pinnedAssets.add(clip.layout.secondary.assetId);
        }
        if (clip.title) continue;
        const asset = assets.get(clip.assetId);
        if (!asset) invalid();
        if (clip.locked) lockedAssets.add(asset.id);
        if (clip.layout?.secondary) {
          if (!assets.has(clip.layout.secondary.assetId)) invalid();
          opaque.add(clip.layout.secondary.assetId);
        }
        if (!["video", "audio"].includes(asset.mediaType)) continue;
        try {
          const range = resolveClipSourceRange(clip, asset);
          if (
            asset.duration !== undefined &&
            range.sourceOut > asset.duration
          ) {
            invalidRanges.add(asset.id);
            continue;
          }
          const list = uses.get(asset.id) ?? [];
          list.push({
            compositionId: composition.id,
            trackId: track.id,
            clipId: clip.id,
            ...range,
          });
          uses.set(asset.id, list);
        } catch {
          invalidRanges.add(asset.id);
        }
      }
    }
  }
  const entries: CollectCoverageEntry[] = [...assets.values()]
    .sort((a, b) => compare(a.id, b.id))
    .map((asset) => {
      const reasons = new Set<CollectCoverageReason>();
      if (pinnedAssets.has(asset.id)) reasons.add("source.user-pinned");
      const sourceHash =
        typeof asset.contentHash === "string" &&
        /^[a-f0-9]{64}$/u.test(asset.contentHash)
          ? asset.contentHash
          : undefined;
      const duration =
        typeof asset.duration === "number" &&
        Number.isFinite(asset.duration) &&
        asset.duration > 0
          ? asset.duration
          : undefined;
      const sourceUses = (uses.get(asset.id) ?? []).sort(
        (a, b) =>
          compare(a.compositionId, b.compositionId) ||
          compare(a.trackId, b.trackId) ||
          compare(a.clipId, b.clipId),
      );
      if (!sourceHash) reasons.add("source.identity-missing");
      if (!["video", "audio"].includes(asset.mediaType))
        reasons.add("source.unsupported");
      else if (!duration) reasons.add("source.timing-unavailable");
      if (asset.state.locked || lockedAssets.has(asset.id))
        reasons.add("source.locked");
      if (opaque.has(asset.id)) reasons.add("source.opaque-reference");
      if (evidence.has(asset.id)) reasons.add("source.evidence-bound");
      if (invalidRanges.has(asset.id)) reasons.add("source.range-invalid");
      if (!sourceUses.length) reasons.add("source.unused");
      const action =
        options.mode === "originals" || reasons.size
          ? "copy-original"
          : options.mode === "trimmed-originals"
            ? "trim-candidate"
            : "offline-candidate";
      const ranges =
        duration === undefined
          ? []
          : action === "trim-candidate"
            ? union(
                sourceUses.map((use) => ({
                  start: Math.max(0, use.sourceIn - options.handlesSeconds),
                  end: Math.min(
                    duration,
                    use.sourceOut + options.handlesSeconds,
                  ),
                })),
              )
            : [{ start: 0, end: duration }];
      const retained =
        duration === undefined
          ? undefined
          : ranges.reduce((sum, range) => sum + range.end - range.start, 0);
      return {
        assetId: asset.id,
        sourceHash,
        action,
        uses: sourceUses,
        ranges,
        sourceDuration: duration,
        retainedSeconds: retained,
        removedSeconds:
          duration === undefined || retained === undefined
            ? undefined
            : Math.max(0, duration - retained),
        reasons: [...reasons].sort(compare),
      };
    });
  return {
    version: 1,
    projectId: input.projectId,
    revision: input.revision,
    baselinePlanId: input.baselinePlanId,
    mode: options.mode,
    handlesSeconds: options.handlesSeconds,
    status: "review-only",
    executable: false,
    quality:
      options.mode === "originals"
        ? "originals"
        : options.mode === "trimmed-originals"
          ? "requires-lossless-parity"
          : "offline-only",
    entries,
  };
}
