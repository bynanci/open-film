import {
  translateIndependentAudio,
  validateAudioEdit,
} from "./audio-timing.js";
import { placeDirectEdit, solveIncremental } from "./pinned-placement.js";
import {
  applyOverridePolicy,
  directOverrideTargets,
  pinConflict,
  type TimelineEditContext,
} from "./user-overrides.js";
// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
import {
  MAX_TITLE_LENGTH,
  validatePresetSnapshot,
  canonicalPresetJson,
  type PresetSnapshot,
  validateComposition,
  validatePhotoLayout,
  validatePhotoMotion,
  validateTitleStyle,
  validateTitleTextRuns,
  type TitleTextRuns,
  validateAudioAutomation,
  validateAudioTiming,
  resolveAudioInterval,
  type AudioTimingV1,
  validateFilmLook,
  validatePrimaryColorCorrection,
  primaryColorCoefficients,
  resolvePrimaryColor,
  type PrimaryColorCorrection,
  validateGraphicScenes,
  validateGraphicSceneTemplates,
  graphicSceneAssetIds,
  type GraphicScene,
  type OverrideTarget,
  type GraphicSceneTemplateRecord,
  filmLookMatrix,
  resolveFilmLook,
  ApplicationError,
  type AudioAutomation,
  type PhotoLayout,
  type PhotoMotion,
  type TitleStyle,
  type Clip,
  type Composition,
  type MediaAsset,
  type Story,
  type StoryBeat,
  type Track,
  type FilmLook,
  type CaptionCue,
  type CaptionTrack,
  type ClipCoverage,
  type CoverageProposal,
  type CoverageAudioBindingV1,
  validateClipCoverage,
  validateCoverageProposal,
  validateCoverageAudioBindings,
  resolveCompositionCoverageBindings,
  applyTranscriptRipple,
  validateTranscriptRippleProposal,
  type TranscriptRippleProposal,
  fnv1a64Mix,
  validateRhythmSnapProposal,
  type RhythmSnapProposal,
} from "@openfilm/core";
import { preserveUserBeatText, scoreAsset } from "@openfilm/story";
import { compose } from "./index.js";

export type TimelineCommand =
  | { type: "user-pin.set"; target: OverrideTarget; pinned: boolean }
  | {
      type: "user-pin.resolve";
      targets: OverrideTarget[];
      scope: { kind: "composition" } | { kind: "beat"; beatId: string };
      mode:
        | "regenerate"
        | "shorten"
        | "more-video"
        | "more-photos"
        | "replace-similar"
        | "remove-repetition";
    }
  | {
      type: "primary-color";
      scope: "film";
      correction: PrimaryColorCorrection | null;
    }
  | {
      type: "primary-color";
      scope: "beat";
      beatId: string;
      correction: PrimaryColorCorrection | null;
    }
  | {
      type: "primary-color";
      scope: "clip";
      clipId: string;
      correction: PrimaryColorCorrection | null;
      primaryColorReviewId?: string;
    }
  | {
      type: "graphic.scene.upsert";
      scene: GraphicScene;
      templateRecord?: GraphicSceneTemplateRecord | null;
    }
  | { type: "graphic.scene.remove"; sceneId: string }
  | { type: "look"; scope: "film"; look: FilmLook | null }
  | { type: "look"; scope: "beat"; beatId: string; look: FilmLook | null }
  | { type: "look"; scope: "clip"; clipId: string; look: FilmLook | null }
  | {
      type: "presentation";
      clipId: string;
      layout?: PhotoLayout | null;
      motion?: PhotoMotion | null;
      title?: string | null;
      titleStyle?: TitleStyle | null;
      titlePresetSnapshot?: PresetSnapshot<"title"> | null;
      titleRuns?: TitleTextRuns | null;
    }
  | {
      type: "audio.add";
      clipId: string;
      assetId: string;
      role: AudioAutomation["role"];
      timelineStart: number;
      sourceIn: number;
      sourceOut: number;
      volume?: number;
      generationId?: string;
    }
  | { type: "audio.timing"; clipId: string; timing: AudioTimingV1 | null }
  | {
      type: "coverage.set-clip";
      clipId: string;
      coverage: ClipCoverage | null;
    }
  | {
      type: "coverage.apply-proposal";
      proposal: CoverageProposal;
    }
  | {
      type: "coverage.set-bindings";
      bindings: readonly CoverageAudioBindingV1[] | null;
    }
  | {
      type: "transcript.ripple";
      proposal: TranscriptRippleProposal;
    }
  | {
      type: "rhythm.snap";
      proposal: RhythmSnapProposal;
    }
  | {
      type: "roll";
      clipIdA: string;
      clipIdB: string;
      delta: number;
    }
  | {
      type: "slip";
      clipId: string;
      delta: number;
    }
  | {
      type: "slide";
      clipId: string;
      delta: number;
    }
  | {
      type: "insert";
      assetId: string;
      timelineStart: number;
      sourceIn?: number;
      sourceOut?: number;
      trackId?: string;
    }
  | {
      type: "overwrite";
      assetId: string;
      timelineStart: number;
      sourceIn?: number;
      sourceOut?: number;
      trackId?: string;
    }
  | {
      type: "lift";
      clipId: string;
    }
  | {
      type: "batch";
      commands: readonly TimelineCommand[];
      transactionId?: string;
    }
  | { type: "audio.configure"; clipId: string; automation: AudioAutomation }
  | { type: "audio.move"; clipId: string; timelineStart: number }
  | { type: "trim"; clipId: string; sourceIn: number; sourceOut: number }
  | { type: "clip.split"; clipId: string; sourceTime: number }
  | { type: "duration"; clipId: string; duration: number }
  | { type: "speed"; clipId: string; speed: number }
  | { type: "volume"; clipId: string; volume: number; audioReviewId?: string }
  | {
      type: "transform";
      clipId: string;
      scale?: number;
      rotation?: number;
      x?: number;
      y?: number;
    }
  | {
      type: "transition";
      clipId: string;
      transition: "cut" | "crossfade" | "dip-to-black" | "dip-to-white";
      duration?: number;
    }
  | { type: "reorder"; clipId: string; toIndex: number }
  | { type: "delete"; clipId: string }
  | { type: "replace"; clipId: string; assetId: string }
  | { type: "lock"; clipId: string; locked: boolean }
  | { type: "caption.track.add"; track: CaptionTrack }
  | { type: "caption.track.remove"; trackId: string }
  | { type: "caption.track.style"; trackId: string; style: TitleStyle }
  | { type: "caption.cue.add"; trackId: string; cue: CaptionCue }
  | {
      type: "caption.cue.update";
      trackId: string;
      cueId: string;
      patch: {
        text?: string;
        startMs?: number;
        endMs?: number;
        textRuns?: TitleTextRuns | null;
      };
    }
  | { type: "caption.cue.delete"; trackId: string; cueId: string }
  | {
      type: "beat";
      beatId: string;
      patch: {
        title?: string;
        intent?: string;
        targetDuration?: number;
        minDuration?: number;
        maxDuration?: number;
      };
    }
  | {
      type: "regenerate-beat";
      beatId: string;
      mode:
        | "regenerate"
        | "shorten"
        | "more-video"
        | "more-photos"
        | "replace-similar"
        | "remove-repetition";
    };

export interface EditorDocument {
  composition: Composition;
  story: Story;
}
export interface ShorteningSuggestion {
  id: string;
  clipId: string;
  secondsSaved: number;
  reason: string;
  command: TimelineCommand;
}

interface PreparedShorteningEdit {
  excludedClipIds: string[];
  commands: TimelineCommand[];
  secondsSaved: number;
  beforeDuration: number;
  afterDuration: number;
  targetDuration: number;
  /** Exact state and command snapshots reject stale previews, including asset locks. */
  baseState: string;
  commandFingerprint: string;
}
export interface ShorteningSuggestionPreview extends PreparedShorteningEdit {
  id: string;
  clipId: string;
  reason: string;
}
export interface PreparedShorteningPlan extends PreparedShorteningEdit {
  /** Independent alternatives measured from the current document; never sum these. */
  suggestions: ShorteningSuggestionPreview[];
}

export class TimelineEditingError extends Error {
  override name = "TimelineEditingError";
  readonly code = "timeline.invalidEdit";
}
const EPSILON = 1e-7;
function fail(message: string): never {
  throw new TimelineEditingError(message);
}

type GraphicLayerNode = GraphicScene["nodes"][number];
type GraphicNodeLockEntry = {
  node: GraphicLayerNode;
  ancestors: GraphicLayerNode[];
};

function graphicNodeLockEntries(
  scene: GraphicScene,
): Map<string, GraphicNodeLockEntry> {
  const entries = new Map<string, GraphicNodeLockEntry>();
  const visit = (nodes: GraphicLayerNode[], ancestors: GraphicLayerNode[]) => {
    for (const node of nodes) {
      entries.set(node.id, { node, ancestors });
      if (node.type === "group") visit(node.children, [...ancestors, node]);
    }
  };
  visit(scene.nodes, []);
  return entries;
}

function withoutGraphicLock(node: GraphicLayerNode) {
  const { locked: _locked, ...editableData } = node;
  return editableData;
}
function sameGraphicData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value, index) => sameGraphicData(value, right[index]))
    );
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        sameGraphicData(leftRecord[key], rightRecord[key]),
    )
  );
}
function graphicAncestorState(node: GraphicLayerNode) {
  if (node.type === "group") {
    const { locked: _locked, children: _children, ...state } = node;
    return state;
  }
  const { locked: _locked, ...state } = node;
  return state;
}

/** Enforce layer locks at the command boundary, including edits outside Desktop. */
function assertGraphicSceneLocks(
  previous: GraphicScene | undefined,
  next: GraphicScene,
): void {
  if (!previous) {
    const target = next.photoDepth
      ? graphicNodeLockEntries(next).get(next.photoDepth.nodeId)?.node
      : undefined;
    if (target?.locked)
      fail(
        `Locked graphic layer "${target.id}" cannot receive a PhotoDepth recipe.`,
      );
    return;
  }
  const oldEntries = graphicNodeLockEntries(previous);
  if (
    [...oldEntries.values()].some(({ node }) => node.locked) &&
    (previous.start !== next.start ||
      previous.duration !== next.duration ||
      previous.zIndex !== next.zIndex)
  )
    fail(
      "A scene containing locked graphic layers cannot be moved or retimed.",
    );
  const newEntries = graphicNodeLockEntries(next);
  if (!sameGraphicData(previous.photoDepth, next.photoDepth)) {
    const photoNodeIds = new Set(
      [previous.photoDepth?.nodeId, next.photoDepth?.nodeId].filter(
        (id): id is string => Boolean(id),
      ),
    );
    for (const photoNodeId of photoNodeIds)
      if (
        oldEntries.get(photoNodeId)?.node.locked ||
        newEntries.get(photoNodeId)?.node.locked
      )
        fail(
          `Locked graphic layer "${photoNodeId}" cannot change its PhotoDepth recipe.`,
        );
  }
  for (const [id, entry] of oldEntries) {
    if (!entry.node.locked) continue;
    const replacement = newEntries.get(id);
    if (!replacement) fail(`Locked graphic layer "${id}" cannot be removed.`);
    if (
      !sameGraphicData(
        withoutGraphicLock(entry.node),
        withoutGraphicLock(replacement.node),
      )
    )
      fail(`Locked graphic layer "${id}" cannot be changed.`);
    if (
      !sameGraphicData(
        entry.ancestors.map(graphicAncestorState),
        replacement.ancestors.map(graphicAncestorState),
      )
    )
      fail(
        `A group containing locked graphic layer "${id}" cannot be changed.`,
      );
  }
}

function hasLockedGraphicNode(scene: GraphicScene): boolean {
  return [...graphicNodeLockEntries(scene).values()].some(
    ({ node }) => node.locked,
  );
}
function finite(
  value: number,
  label: string,
  minimum = -Infinity,
  exclusive = false,
): void {
  if (
    !Number.isFinite(value) ||
    (exclusive ? value <= minimum : value < minimum)
  )
    fail(
      `${label} must be finite${minimum === -Infinity ? "" : ` and ${exclusive ? "greater than" : "at least"} ${minimum}`}.`,
    );
}
function allClips(document: EditorDocument): Clip[] {
  return document.composition.tracks.flatMap((track) => track.clips);
}
function clipAssetIds(clip: Clip): string[] {
  return [
    clip.assetId,
    ...(clip.layout?.secondary ? [clip.layout.secondary.assetId] : []),
  ];
}
export function findClip(
  document: EditorDocument,
  id: string,
): { clip: Clip; track: Track } {
  for (const track of document.composition.tracks) {
    const clip = track.clips.find((item) => item.id === id);
    if (clip) return { clip, track };
  }
  return fail(`Clip "${id}" was not found.`);
}
function findBeat(document: EditorDocument, id: string): StoryBeat {
  return (
    document.story.beats.find((beat) => beat.id === id) ??
    fail(`Beat "${id}" was not found.`)
  );
}
function findAsset(assets: MediaAsset[], id: string): MediaAsset {
  return (
    assets.find((asset) => asset.id === id) ??
    fail(`Asset "${id}" was not found. Relink the source before editing.`)
  );
}
function requiredIds(beat: StoryBeat | undefined): Set<string> {
  return new Set([
    ...(beat?.selectedAssetIds ?? []),
    ...(beat?.constraints?.flatMap((constraint) =>
      constraint.type === "must-include" || constraint.type === "asset-order"
        ? constraint.assetIds
        : [],
    ) ?? []),
  ]);
}
function protectedClip(
  document: EditorDocument,
  assets: MediaAsset[],
  clip: Clip,
): boolean {
  return (
    !!clip.userOverrides?.isUserPinned ||
    !!clip.locked ||
    !!findAsset(assets, clip.assetId).state.locked ||
    !!(
      clip.layout?.secondary &&
      findAsset(assets, clip.layout.secondary.assetId).state.locked
    ) ||
    requiredIds(
      document.story.beats.find((beat) => beat.id === clip.beatId),
    ).has(clip.assetId) ||
    !!(
      clip.layout?.secondary &&
      requiredIds(
        document.story.beats.find((beat) => beat.id === clip.beatId),
      ).has(clip.layout.secondary.assetId)
    )
  );
}
function sourceDuration(asset: MediaAsset): number {
  if (asset.mediaType === "image") return Infinity;
  if (
    asset.duration === undefined ||
    !Number.isFinite(asset.duration) ||
    asset.duration <= 0
  )
    fail(
      `Source "${asset.name}" has no usable duration. Inspect or relink it before editing.`,
    );
  return asset.duration;
}
function renderable(asset: MediaAsset): boolean {
  return (
    asset.mediaType !== "360-video" &&
    (asset.metadata["openfilm.preview"] as { supported?: boolean } | undefined)
      ?.supported !== false
  );
}
/** Match the renderer's audio evidence; a video filename alone proves no stream. */
function hasAudioStream(asset: MediaAsset): boolean {
  if (asset.mediaType === "audio") return true;
  const probe = asset.metadata["openfilm.ffprobe"] as
    { streams?: { codec_type?: string }[] } | undefined;
  return (
    Array.isArray(probe?.streams) &&
    probe.streams.some((stream) => stream?.codec_type === "audio")
  );
}
function sourceBounds(
  clip: Clip,
  asset: MediaAsset,
): { sourceIn: number; sourceOut: number } {
  const sourceIn = clip.sourceIn ?? 0;
  const sourceOut =
    clip.sourceOut ??
    sourceIn + clip.timelineDuration * (clip.transform?.speed ?? 1);
  finite(sourceIn, "Source in", 0);
  finite(sourceOut, "Source out", sourceIn, true);
  if (sourceOut > sourceDuration(asset))
    fail(
      `Source out exceeds the actual duration of "${asset.name}" (${asset.duration}s).`,
    );
  return { sourceIn, sourceOut };
}
function filmClips(document: EditorDocument): Clip[] {
  return document.composition.tracks
    .filter((track) => track.timing !== "overlay")
    .flatMap((track) => track.clips);
}
/** Automation stays in clip-local timeline seconds after source trims/speed changes.
 * Keep the retained gain curve, interpolate its new endpoint, and bound fades and
 * manual duck regions to the edited clip. Source-relative realignment is explicit.
 */
function constrainAudioAutomation(clip: Clip, duration: number): void {
  const automation = clip.audioAutomation;
  if (!automation || clip.audioTiming) return;
  const next = structuredClone(automation);
  if (next.fadeIn !== undefined) next.fadeIn = Math.min(next.fadeIn, duration);
  if (next.fadeOut !== undefined)
    next.fadeOut = Math.min(next.fadeOut, duration);
  if (
    next.points?.length &&
    next.points.some((point) => point.time > duration)
  ) {
    const points = next.points;
    let gain = points[0]!.gain;
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1]!,
        point = points[index]!;
      if (duration < previous.time) break;
      if (duration <= point.time) {
        gain =
          previous.gain +
          ((point.gain - previous.gain) * (duration - previous.time)) /
            (point.time - previous.time);
        break;
      }
      gain = point.gain;
    }
    next.points = points.filter((point) => point.time < duration);
    next.points.push({ time: duration, gain });
  }
  if (next.ducking)
    next.ducking = next.ducking.flatMap((region) => {
      if (region.start >= duration) return [];
      const end = Math.min(region.end, duration);
      const attack = Math.min(region.attack, end - region.start);
      const release = Math.min(
        region.release,
        Math.max(0, end - region.start - attack),
      );
      return [{ ...region, end, attack, release }];
    });
  clip.audioAutomation = validateAudioAutomation(next, duration);
}
function updateDuration(
  document: EditorDocument,
  assets: MediaAsset[],
  reconcileOverlays = true,
): void {
  const duration = Math.max(
    0,
    ...filmClips(document).map(
      (clip) => clip.timelineStart + clip.timelineDuration,
    ),
  );
  finite(duration, "Resulting timeline duration", 0);
  if (
    reconcileOverlays &&
    document.composition.graphicScenes?.some(
      (scene) => scene.start + scene.duration > duration + EPSILON,
    )
  )
    throw new ApplicationError(
      "timeline.graphicRangeConflict",
      "Shortening the edit would exclude saved graphics. Adjust or remove the affected scenes first, then retry.",
    );
  // Regeneration may temporarily shrink a slot before appending the remaining
  // clips. Check captions with overlays once the complete edit is assembled.
  if (
    reconcileOverlays &&
    document.composition.captionTracks?.some((track) =>
      track.cues.some((cue) => cue.endMs > duration * 1000 + EPSILON),
    )
  )
    throw new ApplicationError(
      "timeline.captionRangeConflict",
      "Shortening the edit would exclude saved captions. Adjust or delete the affected captions first, then retry.",
    );
  document.composition.duration = duration;
  if (!reconcileOverlays) return;
  for (const track of document.composition.tracks) {
    if (track.timing !== "overlay") continue;
    const retained: Clip[] = [];
    for (const clip of track.clips) {
      const remaining = document.composition.duration - clip.timelineStart;
      if (remaining < clip.timelineDuration - EPSILON) {
        if (clip.audioTiming)
          throw new ApplicationError(
            "timeline.audioTimingConflict",
            "Shortening the film would truncate independent sound. Explicitly reset or edit its sound timing first.",
            409,
          );
        if (clip.locked || findAsset(assets, clip.assetId).state.locked)
          fail(
            `Shortening the film would truncate locked audio "${clip.id}". Unlock or trim it explicitly first.`,
          );
        if (remaining <= EPSILON) continue;
        constrainAudioAutomation(clip, remaining);
        clip.timelineDuration = remaining;
        clip.sourceOut =
          (clip.sourceIn ?? 0) + remaining * (clip.transform?.speed ?? 1);
      }
      retained.push(clip);
    }
    track.clips = retained;
  }
}
/** Ripple at the old end preserves gaps and clips that overlap the edited source. */
function resize(
  document: EditorDocument,
  clip: Clip,
  duration: number,
  assets: MediaAsset[],
  reconcileOverlays = true,
): void {
  finite(duration, "Clip duration", 0, true);
  const { track } = findClip(document, clip.id);
  constrainAudioAutomation(clip, duration);
  if (track.timing === "overlay") {
    if (clip.timelineStart + duration > document.composition.duration + EPSILON)
      fail("Audio overlay must fit within the existing film duration.");
    clip.timelineDuration = duration;
    return;
  }
  const end = clip.timelineStart + clip.timelineDuration;
  const delta = duration - clip.timelineDuration;
  clip.timelineDuration = duration;
  if (clip.transition && clip.transition.duration > duration)
    clip.transition.duration = duration;
  for (const other of filmClips(document))
    if (other.id !== clip.id && other.timelineStart >= end - EPSILON)
      other.timelineStart = Math.max(0, other.timelineStart + delta);
  updateDuration(document, assets, reconcileOverlays);
}
function remove(
  document: EditorDocument,
  clip: Clip,
  assets: MediaAsset[],
  reconcileOverlays = true,
): void {
  const { track } = findClip(document, clip.id);
  const end = clip.timelineStart + clip.timelineDuration;
  track.clips = track.clips.filter((item) => item.id !== clip.id);
  if (document.composition.coverageAudioBindings) {
    document.composition.coverageAudioBindings =
      document.composition.coverageAudioBindings.filter(
        (b) => b.primaryClipId !== clip.id && b.secondaryClipId !== clip.id,
      );
    if (!document.composition.coverageAudioBindings.length)
      delete document.composition.coverageAudioBindings;
  }
  for (const t of document.composition.tracks) {
    for (const other of t.clips) {
      if (other.coverage?.primaryClipId === clip.id) {
        delete other.coverage.primaryClipId;
      }
    }
  }
  if (track.timing === "overlay") {
    if (!track.clips.length)
      document.composition.tracks = document.composition.tracks.filter(
        (item) => item !== track,
      );
    return;
  }
  for (const other of filmClips(document))
    if (other.timelineStart >= end - EPSILON)
      other.timelineStart = Math.max(
        0,
        other.timelineStart - clip.timelineDuration,
      );
  updateDuration(document, assets, reconcileOverlays);
}
function replace(
  document: EditorDocument,
  assets: MediaAsset[],
  clip: Clip,
  assetId: string,
  reconcileOverlays = true,
): void {
  const old = findAsset(assets, clip.assetId),
    asset = findAsset(assets, assetId);
  if (!renderable(asset))
    fail(
      `Source "${asset.name}" requires a compatible flat export before it can replace a clip.`,
    );
  if (asset.state.rejected)
    fail(`Asset "${asset.name}" is rejected. Unreject it before replacement.`);
  if ((old.mediaType === "audio") !== (asset.mediaType === "audio"))
    fail(
      "Replacement must stay on the same media track: choose audio for audio, or a photo/video for a visual clip.",
    );
  const beat = document.story.beats.find((beat) => beat.id === clip.beatId);
  if (
    beat?.constraints?.some(
      (constraint) =>
        constraint.type === "must-exclude" &&
        constraint.assetIds.includes(assetId),
    )
  )
    fail(`Asset "${asset.name}" is excluded from this beat.`);
  const speed = clip.transform?.speed ?? 1;
  const duration = Math.min(
    clip.timelineDuration,
    sourceDuration(asset) / speed,
  );
  clip.assetId = assetId;
  delete clip.layout;
  delete clip.motion;
  // Authored text and its typography belong to the clip, independent of source.
  // Automation belongs to playable sound; retain its local curve only when the
  // replacement still has an audio stream. Undo keeps the original snapshot.
  if (!hasAudioStream(asset)) delete clip.audioAutomation;
  clip.sourceIn = 0;
  clip.sourceOut = duration * speed;
  finite(clip.sourceOut, "Resulting source out", 0, true);
  resize(document, clip, duration, assets, reconcileOverlays);
}
function beatLength(document: EditorDocument, beatId: string): number {
  return allClips(document)
    .filter((clip) => clip.beatId === beatId)
    .reduce((sum, clip) => sum + clip.timelineDuration, 0);
}
function durationCommand(
  clip: Clip,
  asset: MediaAsset,
  duration: number,
): TimelineCommand {
  return asset.mediaType === "image"
    ? { type: "duration", clipId: clip.id, duration }
    : {
        type: "trim",
        clipId: clip.id,
        sourceIn: clip.sourceIn ?? 0,
        sourceOut:
          (clip.sourceIn ?? 0) + duration * (clip.transform?.speed ?? 1),
      };
}

type LookCommand = Extract<TimelineCommand, { type: "look" }>;
function visualLookClip(track: Track, asset: MediaAsset): boolean {
  return (
    track.type !== "audio" &&
    track.type !== "music" &&
    track.type !== "titles" &&
    (asset.mediaType === "image" || asset.mediaType === "video")
  );
}
function lookSources(clip: Clip, assets: MediaAsset[]): MediaAsset[] {
  return clipAssetIds(clip).map((id) => findAsset(assets, id));
}

/** Parent edits never change a protected clip indirectly through inheritance. */
function applyLookCommand(
  next: EditorDocument,
  assets: MediaAsset[],
  command: LookCommand,
): EditorDocument {
  if (!["film", "beat", "clip"].includes(command.scope))
    fail("Unknown look scope.");
  const allowed = [
    "type",
    "scope",
    "look",
    ...(command.scope === "beat"
      ? ["beatId"]
      : command.scope === "clip"
        ? ["clipId"]
        : []),
  ];
  if (Object.keys(command).some((field) => !allowed.includes(field)))
    fail("A look edit contains an unsupported field for its scope.");
  const look = command.look === null ? null : validateFilmLook(command.look);
  if (command.scope === "clip") {
    const { clip, track } = findClip(next, command.clipId);
    const sources = lookSources(clip, assets);
    if (!visualLookClip(track, sources[0]!))
      fail(
        "Creative looks require a flat photo or video clip; audio and titles keep their original color.",
      );
    if (clip.locked || sources.some((source) => source.state.locked))
      throw new ApplicationError(
        "timeline.lookLocked",
        "Unlock the clip and its source media before changing its look.",
        409,
        { count: 1 },
      );
    if (sources.some((source) => source.state.rejected || !renderable(source)))
      fail("Look edits require supported, non-rejected visual sources.");
    if (look === null) delete clip.look;
    else clip.look = look;
    return next;
  }

  if (command.scope === "beat") findBeat(next, command.beatId);
  const before = structuredClone(next.composition);
  if (command.scope === "film") {
    if (look === null) delete next.composition.defaultLook;
    else next.composition.defaultLook = look;
  } else {
    const other = (next.composition.beatLooks ?? []).filter(
      (entry) => entry.beatId !== command.beatId,
    );
    if (look !== null) other.push({ beatId: command.beatId, look });
    if (other.length > 1000)
      fail("A film supports at most 1000 scene look overrides.");
    if (other.length) next.composition.beatLooks = other;
    else delete next.composition.beatLooks;
  }
  let affectedLocked = 0;
  for (const track of next.composition.tracks) {
    if (
      track.type === "audio" ||
      track.type === "music" ||
      track.type === "titles"
    )
      continue;
    for (const clip of track.clips) {
      if (command.scope === "beat" && clip.beatId !== command.beatId) continue;
      const sources = lookSources(clip, assets);
      if (
        !visualLookClip(track, sources[0]!) ||
        !(clip.locked || sources.some((source) => source.state.locked))
      )
        continue;
      const previous = filmLookMatrix(resolveFilmLook(before, clip).look);
      const changed = filmLookMatrix(
        resolveFilmLook(next.composition, clip).look,
      );
      if (previous.some((value, index) => value !== changed[index]))
        affectedLocked++;
    }
  }
  if (affectedLocked)
    throw new ApplicationError(
      "timeline.lookLocked",
      "This look would change protected clips. Unlock them or keep their current clip look before changing the film or scene look.",
      409,
      { count: affectedLocked },
    );
  return next;
}

function applyPrimaryColorCommand(
  next: EditorDocument,
  assets: MediaAsset[],
  command: Extract<TimelineCommand, { type: "primary-color" }>,
): EditorDocument {
  if (!["film", "beat", "clip"].includes(command.scope))
    fail("Unknown primary color scope.");
  const allowed = [
    "type",
    "scope",
    "correction",
    ...(command.scope === "clip"
      ? ["clipId", "primaryColorReviewId"]
      : command.scope === "beat"
        ? ["beatId"]
        : []),
  ];
  if (Object.keys(command).some((key) => !allowed.includes(key)))
    fail("Unsupported primary color field.");
  const correction =
    command.correction === null
      ? null
      : validatePrimaryColorCorrection(command.correction);
  if (command.scope === "clip") {
    const { clip, track } = findClip(next, command.clipId);
    const sources = lookSources(clip, assets);
    if (!visualLookClip(track, sources[0]!))
      fail("Primary color requires a flat photo or video clip.");
    if (clip.locked || sources.some((source) => source.state.locked))
      throw new ApplicationError(
        "timeline.primaryColorLocked",
        "Unlock the clip and its source media before changing primary color.",
        409,
        { count: 1 },
      );
    if (sources.some((source) => source.state.rejected || !renderable(source)))
      fail("Primary color requires supported, non-rejected sources.");
    if (correction === null) delete clip.primaryColor;
    else clip.primaryColor = correction;
    return next;
  }
  if (command.scope === "beat") findBeat(next, command.beatId);
  const before = structuredClone(next.composition);
  if (command.scope === "film") {
    if (correction === null) delete next.composition.defaultPrimaryColor;
    else next.composition.defaultPrimaryColor = correction;
  } else {
    const entries = (next.composition.beatPrimaryColors ?? []).filter(
      (entry) => entry.beatId !== command.beatId,
    );
    if (correction !== null)
      entries.push({ beatId: command.beatId, correction });
    if (entries.length > 1000)
      fail("At most 1000 scene primary color overrides are supported.");
    if (entries.length) next.composition.beatPrimaryColors = entries;
    else delete next.composition.beatPrimaryColors;
  }
  let count = 0;
  for (const track of next.composition.tracks)
    for (const clip of track.clips) {
      if (command.scope === "beat" && clip.beatId !== command.beatId) continue;
      const sources = lookSources(clip, assets);
      if (
        !visualLookClip(track, sources[0]!) ||
        !(clip.locked || sources.some((source) => source.state.locked))
      )
        continue;
      const previous = primaryColorCoefficients(
        resolvePrimaryColor(before, clip).correction,
      ).matrix;
      const changed = primaryColorCoefficients(
        resolvePrimaryColor(next.composition, clip).correction,
      ).matrix;
      if (previous.some((value, i) => value !== changed[i])) count++;
    }
  if (count)
    throw new ApplicationError(
      "timeline.primaryColorLocked",
      "This primary color change would alter protected clips. Unlock them or retain a clip override first.",
      409,
      { count },
    );
  return next;
}

type CaptionTimelineCommand = Extract<
  TimelineCommand,
  { type: `caption.${string}` }
>;

function isCaptionCommand(
  command: TimelineCommand,
): command is CaptionTimelineCommand {
  return command.type.startsWith("caption.");
}

function captionTrackById(
  tracks: CaptionTrack[],
  trackId: string,
): CaptionTrack {
  const track = tracks.find((item) => item.id === trackId);
  if (!track) fail(`Caption track "${trackId}" was not found.`);
  return track;
}

function commitCaptionTracks(
  next: EditorDocument,
  tracks: CaptionTrack[],
  deferred = false,
): EditorDocument {
  const composition = structuredClone(next.composition);
  if (tracks.length) composition.captionTracks = tracks;
  else delete composition.captionTracks;
  try {
    next.composition = deferred
      ? composition
      : validateComposition(composition);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Caption track is invalid.");
  }
  return next;
}

function applyCaptionCommand(
  next: EditorDocument,
  command: CaptionTimelineCommand,
  deferred = false,
): EditorDocument {
  const tracks = structuredClone(next.composition.captionTracks ?? []);
  if (command.type === "caption.track.add") {
    tracks.push(structuredClone(command.track));
    return commitCaptionTracks(next, tracks, deferred);
  }
  if (command.type === "caption.track.remove") {
    const index = tracks.findIndex((item) => item.id === command.trackId);
    if (index < 0) fail(`Caption track "${command.trackId}" was not found.`);
    tracks.splice(index, 1);
    return commitCaptionTracks(next, tracks, deferred);
  }
  const track = captionTrackById(tracks, command.trackId);
  if (command.type === "caption.track.style") {
    const style = validateTitleStyle(command.style);
    if (style.role !== "subtitle")
      fail("Caption styling requires the subtitle role.");
    track.style = style;
    return commitCaptionTracks(next, tracks, deferred);
  }
  if (command.type === "caption.cue.add") {
    track.cues.push(structuredClone(command.cue));
    track.cues.sort((first, second) => first.startMs - second.startMs);
    return commitCaptionTracks(next, tracks, deferred);
  }
  if (command.type === "caption.cue.delete") {
    const index = track.cues.findIndex((item) => item.id === command.cueId);
    if (index < 0) fail(`Caption cue "${command.cueId}" was not found.`);
    track.cues.splice(index, 1);
    return commitCaptionTracks(next, tracks, deferred);
  }
  const cue = track.cues.find((item) => item.id === command.cueId);
  if (!cue) fail(`Caption cue "${command.cueId}" was not found.`);
  const fields = Object.keys(command.patch);
  if (
    !fields.length ||
    fields.some(
      (field) => !["text", "startMs", "endMs", "textRuns"].includes(field),
    )
  )
    fail("Caption cue edits require text, startMs or endMs.");
  if (
    cue.textRuns &&
    command.patch.text !== undefined &&
    command.patch.text !== cue.text &&
    !Object.hasOwn(command.patch, "textRuns")
  )
    throw new ApplicationError(
      "timeline.titleRunsConflict",
      "Update the bilingual text boundary or explicitly remove its run styling with this text edit.",
      409,
    );
  if (Object.hasOwn(command.patch, "text")) cue.text = command.patch.text!;
  if (Object.hasOwn(command.patch, "textRuns")) {
    if (command.patch.textRuns === null) delete cue.textRuns;
    else cue.textRuns = validateTitleTextRuns(command.patch.textRuns, cue.text);
  }
  if (cue.textRuns) validateTitleTextRuns(cue.textRuns, cue.text);
  if (Object.hasOwn(command.patch, "startMs"))
    cue.startMs = command.patch.startMs!;
  if (Object.hasOwn(command.patch, "endMs")) cue.endMs = command.patch.endMs!;
  cue.manualRevision += 1;
  track.cues.sort((first, second) => first.startMs - second.startMs);
  return commitCaptionTracks(next, tracks, deferred);
}

/** Server-owned mutation context. Legacy solver callers are automatic. */
export function applyTimelineCommand(
  document: EditorDocument,
  assets: MediaAsset[],
  command: TimelineCommand,
  context: TimelineEditContext = {},
): EditorDocument {
  return applyTimelineCommandInternal(
    document,
    assets,
    command,
    context,
    false,
  );
}
/** Internal transaction seam: callers must validateAudioEdit on their complete candidate before publishing. */
export function applyTimelineCommandInBatch(
  document: EditorDocument,
  assets: MediaAsset[],
  command: TimelineCommand,
  context: TimelineEditContext,
): EditorDocument {
  return applyTimelineCommandInternal(document, assets, command, context, true);
}
function applyTimelineCommandInternal(
  document: EditorDocument,
  assets: MediaAsset[],
  command: TimelineCommand,
  context: TimelineEditContext,
  deferred: boolean,
): EditorDocument {
  const origin = context.origin ?? "automatic";
  const writes = directOverrideTargets([command]);
  if (
    (origin === "direct" && writes.length) ||
    command.type.startsWith("user-pin.")
  ) {
    if (!context.timebase)
      pinConflict(
        "User pin edits require an authoritative project timebase clock.",
      );
  }
  // Explicit pin changes protect the complete owner and all source identities.
  // Ordinary edits retain their operation-specific locks in the raw command
  // owner: a library lock still permits primary clip-local trim and transforms.
  if (origin === "direct" && command.type.startsWith("user-pin."))
    for (const target of writes) {
      if (target.kind === "clip") {
        const { clip } = findClip(document, target.clipId);
        if (
          clip.locked ||
          assets.find((a) => a.id === clip.assetId)?.state.locked ||
          (clip.layout?.secondary &&
            assets.find((a) => a.id === clip.layout?.secondary?.assetId)?.state
              .locked)
        )
          fail("The target or source is locked.");
      } else {
        const scene = document.composition.graphicScenes?.find(
          (s) => s.id === target.sceneId,
        );
        if (
          scene &&
          (hasLockedGraphicNode(scene) ||
            graphicSceneAssetIds([scene]).some(
              (id) => assets.find((a) => a.id === id)?.state.locked,
            ))
        )
          fail("The scene or source is locked.");
      }
    }
  const pinned =
    document.composition.tracks.some((t) =>
      t.clips.some((c) => c.userOverrides?.isUserPinned),
    ) ||
    document.composition.graphicScenes?.some(
      (s) => s.userOverrides?.isUserPinned,
    );
  if (command.type === "regenerate-beat" && pinned) {
    if (!context.timebase)
      pinConflict(
        "Incremental solve requires the authoritative project timebase clock.",
      );
    const result = solveIncremental({
      baseline: document,
      assets,
      timebase: context.timebase,
      scope: { kind: "beat", beatId: command.beatId },
      mode: command.mode,
    });
    if (!result.ok) pinConflict(result.conflicts[0]?.message, result.conflicts);
    if (!deferred)
      validateAudioEdit(document, result.document, assets, [command], {
        origin,
        timebase: context.timebase!,
      });
    return result.document;
  }
  const constrained =
    pinned &&
    [
      "trim",
      "speed",
      "duration",
      "delete",
      "replace",
      "reorder",
      "roll",
      "slip",
      "slide",
      "insert",
      "overwrite",
      "lift",
      "batch",
    ].includes(command.type);
  // Raw ripple is only a proposal. Reconcile saved overlays after restoring
  // the complete anchored cut, where its actual final duration is known.
  let next = command.type.startsWith("user-pin.")
    ? structuredClone(document)
    : applyTimelineCommandRaw(
        document,
        assets,
        command,
        deferred,
        !constrained,
      );
  if (constrained) {
    if (!context.timebase)
      pinConflict(
        "Constrained placement requires the authoritative project timebase clock.",
      );
    const result = placeDirectEdit(
      document,
      next,
      assets,
      context.timebase,
      writes,
    );
    if (!result.ok) pinConflict(result.conflicts[0]?.message, result.conflicts);
    next = result.document;
  }
  translateIndependentAudio(document, next, command);
  if (
    context.timebase &&
    command.type !== "coverage.set-bindings" &&
    (command.type.startsWith("coverage.") ||
      next.composition.tracks.some((t) => t.clips.some((c) => c.coverage)) ||
      Boolean(document.composition.coverageAudioBindings?.length))
  ) {
    const derived = resolveCompositionCoverageBindings(
      next.composition,
      context.timebase,
    );
    if (derived.length) {
      next.composition.coverageAudioBindings = [...derived];
    } else {
      delete next.composition.coverageAudioBindings;
    }
  }
  next = applyOverridePolicy(document, next, [command], {
    origin,
    timebase: context.timebase!,
  });
  if (command.type === "user-pin.resolve") {
    if (origin !== "direct")
      pinConflict("Only explicit direct edits may release user pins.");
    const result = solveIncremental({
      baseline: next,
      assets,
      timebase: context.timebase!,
      scope: command.scope,
      mode: command.mode,
    });
    if (!result.ok) pinConflict(result.conflicts[0]?.message, result.conflicts);
    return result.document;
  }
  if (!deferred)
    validateAudioEdit(document, next, assets, [command], {
      origin,
      timebase: context.timebase!,
    });
  return next;
}

/** Applies one edit to a detached snapshot; undo history can retain either input. */
function applyTimelineCommandRaw(
  document: EditorDocument,
  assets: MediaAsset[],
  command: TimelineCommand,
  deferred = false,
  reconcileOverlays = true,
): EditorDocument {
  const next = structuredClone(document);
  if (command.type === "user-pin.set" || command.type === "user-pin.resolve")
    return next;
  if (
    command.type === "graphic.scene.upsert" ||
    command.type === "graphic.scene.remove"
  ) {
    const scenes = structuredClone(next.composition.graphicScenes ?? []);
    const templates = structuredClone(
      next.composition.graphicSceneTemplates ?? [],
    );
    if (command.type === "graphic.scene.upsert") {
      // Validate before inspecting nested source IDs or cloning client data again.
      const [scene] = validateGraphicScenes(
        [command.scene],
        next.composition.duration,
      );
      const recipe = scene!.photoDepth;
      if (recipe) {
        const references = [
          { id: recipe.sourceAssetId, hash: recipe.sourceSha256 },
          ...(recipe.mode === "parallax"
            ? [
                { id: recipe.maskAssetId!, hash: recipe.maskSha256! },
                ...(recipe.background?.kind === "asset"
                  ? [
                      {
                        id: recipe.background.assetId,
                        hash: recipe.background.sha256,
                      },
                    ]
                  : []),
              ]
            : []),
        ];
        for (const reference of references) {
          const asset = findAsset(assets, reference.id);
          let localFile = false;
          try {
            const uri = new URL(asset.uri);
            localFile =
              uri.protocol === "file:" &&
              !uri.hostname &&
              !/%2f|%5c/iu.test(uri.pathname) &&
              !decodeURIComponent(uri.pathname).includes("\0");
          } catch {
            /* Invalid source URIs cannot be rendered locally. */
          }
          if (asset.mediaType !== "image" || !localFile)
            fail(
              `PhotoDepth source "${reference.id}" must be a local still image.`,
            );
          if (!asset.contentHash || asset.contentHash !== reference.hash)
            throw new ApplicationError(
              "graphics.sourceChanged",
              `PhotoDepth source "${reference.id}" does not match its saved SHA-256 receipt.`,
              409,
            );
        }
      }
      for (const id of graphicSceneAssetIds([scene!])) {
        const asset = findAsset(assets, id);
        if (asset.mediaType !== "image")
          fail(`Graphic image asset "${id}" must be a still image.`);
      }
      const index = scenes.findIndex((item) => item.id === scene!.id);
      assertGraphicSceneLocks(index < 0 ? undefined : scenes[index], scene!);
      if (index < 0) scenes.push(scene!);
      else scenes[index] = scene!;
      if (Object.hasOwn(command, "templateRecord")) {
        const recordIndex = templates.findIndex(
          (item) => item.sceneId === scene!.id,
        );
        if (recordIndex >= 0) templates.splice(recordIndex, 1);
        if (
          command.templateRecord !== null &&
          command.templateRecord !== undefined
        )
          templates.push(command.templateRecord);
      }
    } else {
      const index = scenes.findIndex((item) => item.id === command.sceneId);
      if (index < 0) fail(`Graphic scene "${command.sceneId}" was not found.`);
      if (hasLockedGraphicNode(scenes[index]!))
        fail(`Graphic scene "${command.sceneId}" contains locked layers.`);
      scenes.splice(index, 1);
      for (
        let recordIndex = templates.length - 1;
        recordIndex >= 0;
        recordIndex--
      )
        if (templates[recordIndex]!.sceneId === command.sceneId)
          templates.splice(recordIndex, 1);
    }
    const admitted = validateGraphicScenes(scenes, next.composition.duration);
    const admittedTemplates = validateGraphicSceneTemplates(
      templates,
      admitted,
      assets.map((asset) => asset.id),
    );
    if (admitted.length) next.composition.graphicScenes = admitted;
    else delete next.composition.graphicScenes;
    if (admittedTemplates.length)
      next.composition.graphicSceneTemplates = admittedTemplates;
    else delete next.composition.graphicSceneTemplates;
    return next;
  }
  if (command.type === "look") return applyLookCommand(next, assets, command);
  if (command.type === "primary-color")
    return applyPrimaryColorCommand(next, assets, command);
  if (isCaptionCommand(command))
    return applyCaptionCommand(next, command, deferred);
  if (command.type === "audio.add") {
    if (
      !command.clipId.trim() ||
      command.clipId.length > 256 ||
      allClips(next).some((clip) => clip.id === command.clipId)
    )
      fail("Audio clip ID must be nonempty and unique within the composition.");
    const asset = findAsset(assets, command.assetId);
    if (
      asset.mediaType !== "audio" ||
      !renderable(asset) ||
      asset.state.rejected
    )
      fail(`Source "${asset.name}" must be supported, non-rejected audio.`);
    if (!filmClips(next).length || next.composition.duration <= 0)
      fail("Create a film before adding an audio overlay.");
    finite(command.timelineStart, "Audio start", 0);
    finite(command.sourceIn, "Source in", 0);
    finite(command.sourceOut, "Source out", command.sourceIn, true);
    if (command.sourceOut > sourceDuration(asset))
      fail(`Source out exceeds the actual duration of "${asset.name}".`);
    const duration = command.sourceOut - command.sourceIn;
    if (command.timelineStart + duration > next.composition.duration + EPSILON)
      fail("Audio overlay must fit within the existing film duration.");
    const automation = validateAudioAutomation({
      version: 1,
      role: command.role,
    });
    if (command.volume !== undefined) {
      finite(command.volume, "Volume", 0);
      if (command.volume > 1) fail("Volume must be between 0 and 1.");
    }
    let trackId = `${next.composition.id}:overlay:${command.role}`,
      suffix = 1;
    while (next.composition.tracks.some((track) => track.id === trackId))
      trackId = `${next.composition.id}:overlay:${command.role}:${suffix++}`;
    next.composition.tracks.push({
      id: trackId,
      type: command.role === "music" ? "music" : "audio",
      timing: "overlay",
      clips: [
        {
          id: command.clipId,
          assetId: command.assetId,
          timelineStart: command.timelineStart,
          timelineDuration: duration,
          sourceIn: command.sourceIn,
          sourceOut: command.sourceOut,
          audioAutomation: automation,
          ...(command.volume === undefined
            ? {}
            : { transform: { volume: command.volume } }),
        },
      ],
    });
    return next;
  }
  if (command.type === "beat") {
    const beat = findBeat(next, command.beatId);
    const previousBeat = structuredClone(beat);
    for (const [key, value] of Object.entries(command.patch)) {
      if (key === "title" || key === "intent") {
        if (typeof value !== "string" || (key === "title" && !value.trim()))
          fail(
            `Beat ${key} must be ${key === "title" ? "a non-empty" : "a"} string.`,
          );
      } else if (
        ["minDuration", "maxDuration", "targetDuration"].includes(key)
      ) {
        finite(value as number, `Beat ${key}`, 0, key !== "minDuration");
      } else fail(`Unknown beat field "${key}".`);
    }
    Object.assign(beat, command.patch);
    if (command.patch.intent !== undefined && !command.patch.intent.trim())
      delete beat.intent;
    Object.assign(beat, preserveUserBeatText(previousBeat, beat));
    if ((beat.minDuration ?? 0) > (beat.maxDuration ?? Infinity))
      fail("Beat minimum exceeds its maximum duration.");
    if (
      beat.targetDuration !== undefined &&
      (beat.targetDuration < (beat.minDuration ?? 0) ||
        beat.targetDuration > (beat.maxDuration ?? Infinity))
    )
      fail("Beat target must lie within its minimum and maximum duration.");
    return next;
  }
  if (command.type === "regenerate-beat")
    return regenerate(next, assets, command.beatId, command.mode);
  if (command.type === "coverage.apply-proposal") {
    const proposal = validateCoverageProposal(command.proposal);
    if (proposal.compositionId !== next.composition.id)
      fail("Coverage proposal composition does not match active composition.");
    const { clip: primary } = findClip(next, proposal.primaryClipId);
    const { clip: bRoll } = findClip(next, proposal.bRollClipId);
    const primaryAsset = findAsset(assets, primary.assetId);
    const bRollAsset = findAsset(assets, bRoll.assetId);
    if (primaryAsset.state.locked || bRollAsset.state.locked)
      fail("Unlock sources before applying coverage proposal.");
    if (primary.locked || bRoll.locked)
      fail("Unlock clips before applying coverage proposal.");
    primary.coverage = { version: 1, role: "primary-narrative" };
    bRoll.coverage = {
      version: 1,
      role: "b-roll-overlay",
      primaryClipId: primary.id,
      audioPolicy: proposal.audioPolicy,
    };
    return next;
  }
  if (command.type === "coverage.set-bindings") {
    if (command.bindings === null) {
      delete next.composition.coverageAudioBindings;
    } else {
      next.composition.coverageAudioBindings = [
        ...validateCoverageAudioBindings(command.bindings),
      ];
    }
    return next;
  }
  if (command.type === "transcript.ripple") {
    const proposal = validateTranscriptRippleProposal(command.proposal);
    next.composition = applyTranscriptRipple(next.composition, proposal);
    return next;
  }
  if (command.type === "rhythm.snap") {
    const proposal = validateRhythmSnapProposal(command.proposal);
    if (proposal.compositionId !== next.composition.id)
      fail(
        "Rhythm snap proposal composition does not match active composition.",
      );
    const currentRevision = fnv1a64Mix(
      canonicalPresetJson({ composition: next.composition }),
    );
    if (proposal.baseRevision !== currentRevision) {
      throw new ApplicationError(
        "rhythm.staleProposal",
        "Rhythm snap proposal base revision does not match current composition revision.",
      );
    }
    const { clip } = findClip(next, proposal.clipId);
    const speed = clip.transform?.speed ?? 1;
    const sourceIn = clip.sourceIn ?? 0;
    if (proposal.targetEdge === "cut") {
      const sourceTime =
        sourceIn + (proposal.snappedTime - clip.timelineStart) * speed;
      return applyTimelineCommandRaw(
        next,
        assets,
        { type: "clip.split", clipId: clip.id, sourceTime },
        deferred,
        reconcileOverlays,
      );
    }
    if (proposal.targetEdge === "out") {
      const newDuration = proposal.snappedTime - clip.timelineStart;
      const sourceOut = sourceIn + newDuration * speed;
      return applyTimelineCommandRaw(
        next,
        assets,
        { type: "trim", clipId: clip.id, sourceIn, sourceOut },
        deferred,
        reconcileOverlays,
      );
    }
    if (proposal.targetEdge === "in") {
      const sourceOut =
        clip.sourceOut ?? sourceIn + clip.timelineDuration * speed;
      const shift = proposal.snappedTime - clip.timelineStart;
      const newSourceIn = sourceIn + shift * speed;
      return applyTimelineCommandRaw(
        next,
        assets,
        { type: "trim", clipId: clip.id, sourceIn: newSourceIn, sourceOut },
        deferred,
        reconcileOverlays,
      );
    }
    fail(`Unsupported rhythm snap targetEdge: "${proposal.targetEdge}".`);
  }
  if (command.type === "batch") {
    let current = next;
    for (const sub of command.commands) {
      current = applyTimelineCommandRaw(
        current,
        assets,
        sub,
        deferred,
        reconcileOverlays,
      );
    }
    return current;
  }
  if (command.type === "roll") {
    finite(command.delta, "Roll delta", -Infinity);
    if (Math.abs(command.delta) <= EPSILON) return next;
    const { clip: clipA, track: trackA } = findClip(next, command.clipIdA);
    const { clip: clipB, track: trackB } = findClip(next, command.clipIdB);
    if (trackA !== trackB)
      fail("Roll edit requires both clips to be on the same track.");
    const indexA = trackA.clips.indexOf(clipA);
    const indexB = trackA.clips.indexOf(clipB);
    if (
      indexB !== indexA + 1 ||
      Math.abs(
        clipA.timelineStart + clipA.timelineDuration - clipB.timelineStart,
      ) > EPSILON
    )
      fail("Roll edit requires adjacent clips on the same track.");
    if (clipA.locked) fail(`Cannot roll edit: clip "${clipA.id}" is locked.`);
    if (clipB.locked) fail(`Cannot roll edit: clip "${clipB.id}" is locked.`);
    const assetA = findAsset(assets, clipA.assetId);
    const assetB = findAsset(assets, clipB.assetId);
    if (assetA.state.locked)
      fail(`Source "${assetA.name}" is locked. Unlock it before roll editing.`);
    if (assetB.state.locked)
      fail(`Source "${assetB.name}" is locked. Unlock it before roll editing.`);
    const speedA = clipA.transform?.speed ?? 1;
    const speedB = clipB.transform?.speed ?? 1;
    const newDurationA = clipA.timelineDuration + command.delta;
    const newDurationB = clipB.timelineDuration - command.delta;
    if (newDurationA < EPSILON)
      fail(
        "Roll edit cannot shorten the outgoing clip to zero or negative duration.",
      );
    if (newDurationB < EPSILON)
      fail(
        "Roll edit cannot shorten the incoming clip to zero or negative duration.",
      );
    const boundsA = sourceBounds(clipA, assetA);
    const newSourceOutA = boundsA.sourceOut + command.delta * speedA;
    if (newSourceOutA > sourceDuration(assetA) + EPSILON)
      fail(`Roll edit exceeds available duration of source "${assetA.name}".`);
    if (newSourceOutA <= boundsA.sourceIn + EPSILON)
      fail("Roll edit cannot shorten source duration to zero.");
    const boundsB = sourceBounds(clipB, assetB);
    const newSourceInB = boundsB.sourceIn + command.delta * speedB;
    if (newSourceInB < -EPSILON)
      fail(`Roll edit exceeds start of source "${assetB.name}".`);
    if (newSourceInB >= boundsB.sourceOut - EPSILON)
      fail("Roll edit cannot shorten source duration to zero.");

    clipA.timelineDuration = newDurationA;
    clipA.sourceOut = newSourceOutA;
    constrainAudioAutomation(clipA, newDurationA);

    clipB.timelineStart += command.delta;
    clipB.timelineDuration = newDurationB;
    clipB.sourceIn = Math.max(0, newSourceInB);
    constrainAudioAutomation(clipB, newDurationB);

    return next;
  }
  if (command.type === "insert") {
    const asset = findAsset(assets, command.assetId);
    if (asset.state.locked)
      fail(`Source "${asset.name}" is locked. Unlock it before inserting.`);
    if (asset.state.rejected || !renderable(asset))
      fail(`Source "${asset.name}" must be supported and non-rejected.`);
    finite(command.timelineStart, "Insert timeline start", 0);
    const speed = 1;
    const sourceIn = command.sourceIn ?? 0;
    const sourceOut =
      command.sourceOut ??
      (asset.mediaType === "image" ? 4 : sourceDuration(asset));
    finite(sourceIn, "Source in", 0);
    finite(sourceOut, "Source out", sourceIn, true);
    if (sourceOut > sourceDuration(asset) + EPSILON)
      fail(`Source out exceeds duration of "${asset.name}".`);
    const duration = (sourceOut - sourceIn) / speed;
    finite(duration, "Insert duration", 0, true);

    let track = command.trackId
      ? next.composition.tracks.find((t) => t.id === command.trackId)
      : undefined;
    if (!track) {
      const preferredType = asset.mediaType === "audio" ? "audio" : "video";
      track =
        next.composition.tracks.find((t) => t.type === preferredType) ??
        next.composition.tracks[0];
    }
    if (!track) fail("Composition has no tracks to insert media into.");

    const ids = new Set(allClips(next).map((c) => c.id));
    let newId = `${asset.id}-insert-1`;
    let counter = 1;
    while (ids.has(newId)) newId = `${asset.id}-insert-${++counter}`;

    const newClip: Clip = {
      id: newId,
      assetId: asset.id,
      sourceIn,
      sourceOut,
      timelineStart: command.timelineStart,
      timelineDuration: duration,
    };

    const targetClip = track.clips.find(
      (c) =>
        c.timelineStart < command.timelineStart - EPSILON &&
        c.timelineStart + c.timelineDuration > command.timelineStart + EPSILON,
    );

    let rightClip: Clip | undefined;
    if (targetClip) {
      if (targetClip.locked)
        fail(
          `Cannot insert: clip "${targetClip.id}" at insert position is locked.`,
        );
      const targetSpeed = targetClip.transform?.speed ?? 1;
      const leftDuration = command.timelineStart - targetClip.timelineStart;
      const rightDuration = targetClip.timelineDuration - leftDuration;
      const originalSourceIn = targetClip.sourceIn ?? 0;
      const originalSourceOut =
        targetClip.sourceOut ??
        originalSourceIn + targetClip.timelineDuration * targetSpeed;
      const splitSourceTime = originalSourceIn + leftDuration * targetSpeed;

      let rightId = `${targetClip.id}-split-1`;
      let splitCounter = 1;
      while (ids.has(rightId))
        rightId = `${targetClip.id}-split-${++splitCounter}`;

      rightClip = {
        ...structuredClone(targetClip),
        id: rightId,
        sourceIn: splitSourceTime,
        sourceOut: originalSourceOut,
        timelineStart: command.timelineStart + duration,
        timelineDuration: rightDuration,
      };
      delete rightClip.transition;

      targetClip.sourceOut = splitSourceTime;
      targetClip.timelineDuration = leftDuration;
      constrainAudioAutomation(targetClip, leftDuration);
    }

    // Ripple all downstream clips
    for (const other of filmClips(next)) {
      if (
        other.timelineStart >= command.timelineStart - EPSILON &&
        (!targetClip || other.id !== targetClip.id)
      ) {
        other.timelineStart += duration;
      }
    }

    if (targetClip) {
      track.clips.push(newClip, rightClip!);
    } else {
      track.clips.push(newClip);
    }

    track.clips.sort((a, b) => a.timelineStart - b.timelineStart);
    updateDuration(next, assets, reconcileOverlays);
    return next;
  }
  if (command.type === "overwrite") {
    const asset = findAsset(assets, command.assetId);
    if (asset.state.locked)
      fail(`Source "${asset.name}" is locked. Unlock it before overwriting.`);
    if (asset.state.rejected || !renderable(asset))
      fail(`Source "${asset.name}" must be supported and non-rejected.`);
    finite(command.timelineStart, "Overwrite timeline start", 0);
    const speed = 1;
    const sourceIn = command.sourceIn ?? 0;
    const sourceOut =
      command.sourceOut ??
      (asset.mediaType === "image" ? 4 : sourceDuration(asset));
    finite(sourceIn, "Source in", 0);
    finite(sourceOut, "Source out", sourceIn, true);
    if (sourceOut > sourceDuration(asset) + EPSILON)
      fail(`Source out exceeds duration of "${asset.name}".`);
    const duration = (sourceOut - sourceIn) / speed;
    finite(duration, "Overwrite duration", 0, true);

    let track = command.trackId
      ? next.composition.tracks.find((t) => t.id === command.trackId)
      : undefined;
    if (!track) {
      const preferredType = asset.mediaType === "audio" ? "audio" : "video";
      track =
        next.composition.tracks.find((t) => t.type === preferredType) ??
        next.composition.tracks[0];
    }
    if (!track) fail("Composition has no tracks to overwrite media onto.");

    const overwriteStart = command.timelineStart;
    const overwriteEnd = overwriteStart + duration;

    // Validate that no overlapping clips are locked
    for (const existing of track.clips) {
      const existStart = existing.timelineStart;
      const existEnd = existStart + existing.timelineDuration;
      const overlaps = !(
        existEnd <= overwriteStart + EPSILON ||
        existStart >= overwriteEnd - EPSILON
      );
      if (overlaps && existing.locked) {
        fail(
          `Cannot overwrite: clip "${existing.id}" in the overwrite region is locked.`,
        );
      }
    }

    const ids = new Set(allClips(next).map((c) => c.id));
    let newId = `${asset.id}-overwrite-1`;
    let counter = 1;
    while (ids.has(newId)) newId = `${asset.id}-overwrite-${++counter}`;

    const newClip: Clip = {
      id: newId,
      assetId: asset.id,
      sourceIn,
      sourceOut,
      timelineStart: overwriteStart,
      timelineDuration: duration,
    };

    const remainingClips: Clip[] = [];
    for (const existing of track.clips) {
      const existStart = existing.timelineStart;
      const existEnd = existStart + existing.timelineDuration;
      const overlaps = !(
        existEnd <= overwriteStart + EPSILON ||
        existStart >= overwriteEnd - EPSILON
      );
      if (!overlaps) {
        remainingClips.push(existing);
        continue;
      }
      const existingSpeed = existing.transform?.speed ?? 1;
      const existingSourceIn = existing.sourceIn ?? 0;
      const existingSourceOut =
        existing.sourceOut ??
        existingSourceIn + existing.timelineDuration * existingSpeed;

      // Case A: completely engulfed -> discarded
      if (
        existStart >= overwriteStart - EPSILON &&
        existEnd <= overwriteEnd + EPSILON
      ) {
        continue;
      }
      // Case B: punch hole in middle -> split into left and right
      if (
        existStart < overwriteStart - EPSILON &&
        existEnd > overwriteEnd + EPSILON
      ) {
        const leftDuration = overwriteStart - existStart;
        const leftSourceOut = existingSourceIn + leftDuration * existingSpeed;
        existing.sourceOut = leftSourceOut;
        existing.timelineDuration = leftDuration;
        constrainAudioAutomation(existing, leftDuration);
        remainingClips.push(existing);

        let rightId = `${existing.id}-split-1`;
        let splitCounter = 1;
        while (ids.has(rightId))
          rightId = `${existing.id}-split-${++splitCounter}`;
        const rightDuration = existEnd - overwriteEnd;
        const rightSourceIn =
          existingSourceIn + (overwriteEnd - existStart) * existingSpeed;
        const rightClip: Clip = {
          ...structuredClone(existing),
          id: rightId,
          sourceIn: rightSourceIn,
          sourceOut: existingSourceOut,
          timelineStart: overwriteEnd,
          timelineDuration: rightDuration,
        };
        delete rightClip.transition;
        constrainAudioAutomation(rightClip, rightDuration);
        remainingClips.push(rightClip);
        continue;
      }
      // Case C: overlaps right side of existing (trim end)
      if (
        existStart < overwriteStart - EPSILON &&
        existEnd <= overwriteEnd + EPSILON
      ) {
        const leftDuration = overwriteStart - existStart;
        const leftSourceOut = existingSourceIn + leftDuration * existingSpeed;
        existing.sourceOut = leftSourceOut;
        existing.timelineDuration = leftDuration;
        constrainAudioAutomation(existing, leftDuration);
        remainingClips.push(existing);
        continue;
      }
      // Case D: overlaps left side of existing (trim start)
      if (
        existStart >= overwriteStart - EPSILON &&
        existEnd > overwriteEnd + EPSILON
      ) {
        const shiftDuration = overwriteEnd - existStart;
        const rightDuration = existing.timelineDuration - shiftDuration;
        const rightSourceIn = existingSourceIn + shiftDuration * existingSpeed;
        existing.sourceIn = rightSourceIn;
        existing.timelineStart = overwriteEnd;
        existing.timelineDuration = rightDuration;
        delete existing.transition;
        constrainAudioAutomation(existing, rightDuration);
        remainingClips.push(existing);
        continue;
      }
    }

    remainingClips.push(newClip);
    remainingClips.sort((a, b) => a.timelineStart - b.timelineStart);
    track.clips = remainingClips;
    updateDuration(next, assets, reconcileOverlays);
    return next;
  }
  const { clip, track } = findClip(next, command.clipId);
  if (command.type === "lock") {
    if (typeof command.locked !== "boolean")
      fail("Clip lock must be true or false.");
    clip.locked = command.locked;
    return next;
  }
  if (clip.locked)
    fail(`Clip "${clip.id}" is locked. Unlock it before editing.`);
  const asset = findAsset(assets, clip.assetId);
  if (track.timing === "overlay" && asset.state.locked)
    fail(`Source "${asset.name}" is locked. Unlock it before editing audio.`);
  const pendingCaptions = deferred ? next.composition.captionTracks : undefined;
  if (deferred) delete next.composition.captionTracks;
  switch (command.type) {
    case "presentation": {
      if (
        track.type === "audio" ||
        track.type === "music" ||
        asset.mediaType === "audio"
      )
        fail("Photo presentation and titles require a visual clip.");
      if (asset.state.locked || asset.state.rejected || !renderable(asset))
        fail(
          `Source "${asset.name}" must be unlocked, non-rejected and supported before presentation edits.`,
        );
      const beat = next.story.beats.find((beat) => beat.id === clip.beatId);
      const required = requiredIds(beat);
      const previousSecondary = clip.layout?.secondary;
      if (
        previousSecondary &&
        required.has(previousSecondary.assetId) &&
        Object.hasOwn(command, "layout") &&
        command.layout?.secondary?.assetId !== previousSecondary.assetId
      )
        fail(
          "This layout would remove selected or required paired media. Remove its selection or constraint before changing it.",
        );
      if (
        previousSecondary &&
        findAsset(assets, previousSecondary.assetId).state.locked
      )
        fail(
          "The paired photo is locked. Unlock it before changing presentation.",
        );
      const fields = [
        "layout",
        "motion",
        "title",
        "titleStyle",
        "titlePresetSnapshot",
        "titleRuns",
      ] as const;
      if (!fields.some((key) => Object.hasOwn(command, key)))
        fail("Provide a presentation field to change.");
      if (
        ((command.layout !== undefined && command.layout !== null) ||
          (command.motion !== undefined && command.motion !== null)) &&
        track.type !== "video"
      )
        fail(
          "Photo layout and motion require a story picture video track. Visual overlays support styled titles and their existing transforms.",
        );
      if (
        ((command.layout !== undefined && command.layout !== null) ||
          (command.motion !== undefined && command.motion !== null)) &&
        asset.mediaType !== "image"
      )
        fail("Photo layout and motion require a still image source.");
      if (command.layout !== undefined) {
        if (command.layout === null) delete clip.layout;
        else {
          const layout = validatePhotoLayout(command.layout);
          if (layout.secondary) {
            const secondary = findAsset(assets, layout.secondary.assetId);
            if (
              secondary.mediaType !== "image" ||
              secondary.state.locked ||
              secondary.state.rejected ||
              !renderable(secondary)
            )
              fail(
                `Paired source "${secondary.name}" must be a supported, unlocked, non-rejected photo.`,
              );
            if (
              beat?.constraints?.some(
                (constraint) =>
                  constraint.type === "must-exclude" &&
                  constraint.assetIds.includes(secondary.id),
              )
            )
              fail(
                `Paired source "${secondary.name}" is excluded from this beat.`,
              );
            if (secondary.id === asset.id)
              fail("Choose a different photo for the second panel.");
          }
          clip.layout = layout;
        }
      }
      if (command.motion !== undefined) {
        if (command.motion === null) delete clip.motion;
        else clip.motion = validatePhotoMotion(command.motion);
      }
      if (
        clip.titleRuns &&
        command.title !== undefined &&
        command.title !== null &&
        command.title !== clip.title &&
        !Object.hasOwn(command, "titleRuns")
      )
        throw new ApplicationError(
          "timeline.titleRunsConflict",
          "Update the bilingual text boundary or explicitly remove its run styling with this text edit.",
          409,
        );
      if (
        command.title === null &&
        command.titleRuns !== undefined &&
        command.titleRuns !== null
      )
        fail("A removed title cannot retain bilingual runs.");
      if (command.title !== undefined) {
        if (command.title === null) {
          delete clip.title;
          delete clip.titleRuns;
        } else {
          if (
            typeof command.title !== "string" ||
            !command.title.trim() ||
            command.title.length > MAX_TITLE_LENGTH
          )
            fail(
              `Title must be text of at most ${MAX_TITLE_LENGTH} characters.`,
            );
          clip.title = command.title;
        }
      }
      if (command.titlePresetSnapshot !== undefined) {
        if (command.titlePresetSnapshot === null)
          delete clip.titlePresetSnapshot;
        else {
          const snapshot = validatePresetSnapshot(
            command.titlePresetSnapshot,
            "title",
          );
          if (
            !command.titleStyle ||
            canonicalPresetJson(snapshot.recipe) !==
              canonicalPresetJson(command.titleStyle)
          )
            fail("Preset title style does not match its recipe snapshot.");
          clip.titlePresetSnapshot = snapshot;
        }
      }
      if (Object.hasOwn(command, "titleRuns")) {
        if (command.titleRuns === null) delete clip.titleRuns;
        else
          clip.titleRuns = validateTitleTextRuns(
            command.titleRuns,
            clip.title!,
          );
      }
      if (clip.titleRuns) validateTitleTextRuns(clip.titleRuns, clip.title!);
      if (command.titleStyle !== undefined) {
        if (command.titleStyle === null) delete clip.titleStyle;
        else clip.titleStyle = validateTitleStyle(command.titleStyle);
      }
      break;
    }

    case "audio.timing":
      if (asset.state.locked)
        fail("Unlock the source before editing sound timing.");
      if (command.timing === null) delete clip.audioTiming;
      else clip.audioTiming = validateAudioTiming(command.timing);
      break;
    case "coverage.set-clip": {
      if (asset.state.locked)
        fail("Unlock the source before editing coverage.");
      if (command.coverage === null) {
        delete clip.coverage;
      } else {
        clip.coverage = validateClipCoverage(command.coverage, "coverage");
        if (clip.coverage.primaryClipId) {
          const { clip: primary } = findClip(next, clip.coverage.primaryClipId);
          if (primary.id === clip.id) fail("A clip cannot cover itself.");
        }
      }
      break;
    }
    case "audio.configure":
      if (asset.mediaType !== "audio" && asset.mediaType !== "video")
        fail("Audio automation requires an audio or video source.");
      if (!hasAudioStream(asset))
        fail(
          "Audio automation requires a detected audio stream. Analyze or relink this video, or choose an audio source before configuring fades, envelopes or ducking.",
        );
      if (asset.state.locked)
        fail(
          `Source "${asset.name}" is locked. Unlock it before editing audio.`,
        );
      clip.audioAutomation = validateAudioAutomation(
        command.automation,
        deferred
          ? undefined
          : clip.audioTiming
            ? resolveAudioInterval(clip, asset, next.composition.duration)
                .automationDurationSeconds
            : clip.timelineDuration,
      );
      break;
    case "audio.move":
      if (track.timing !== "overlay")
        fail("Move audio overlays on their explicit overlay track.");
      if (asset.state.locked)
        fail(
          `Source "${asset.name}" is locked. Unlock it before moving audio.`,
        );
      finite(command.timelineStart, "Audio start", 0);
      if (
        command.timelineStart + clip.timelineDuration >
        next.composition.duration + EPSILON
      )
        fail("Audio overlay must fit within the existing film duration.");
      clip.timelineStart = command.timelineStart;
      break;

    case "clip.split": {
      if (clip.audioTiming)
        throw new ApplicationError(
          "timeline.audioTimingConflict",
          "Reset sound timing to relink audio before splitting this clip.",
          409,
        );
      if (
        clip.audioAutomation &&
        (clip.audioAutomation.fadeIn ||
          clip.audioAutomation.fadeOut ||
          clip.audioAutomation.points?.length ||
          clip.audioAutomation.ducking?.length)
      )
        fail(
          "Splitting configured audio automation is not supported. Remove its fades, envelope and ducking before splitting, then configure each half explicitly.",
        );
      if (asset.mediaType !== "video" && asset.mediaType !== "audio")
        fail(
          "Split requires a flat video or audio source. Use photo duration for still images.",
        );
      if (asset.state.locked)
        fail(`Source "${asset.name}" is locked. Unlock it before splitting.`);
      if (track.type === "titles")
        fail(
          "Split source media on its video or audio track, rather than a title track.",
        );
      const speed = clip.transform?.speed ?? 1;
      finite(speed, "Speed", 0, true);
      const { sourceIn, sourceOut } = sourceBounds(clip, asset);
      finite(command.sourceTime, "Split source time", sourceIn, true);
      if (command.sourceTime >= sourceOut)
        fail(
          "Split source time must be strictly inside the selected source range.",
        );
      const duration = (sourceOut - sourceIn) / speed;
      finite(duration, "Selected source duration", 0, true);
      if (
        Math.abs(duration - clip.timelineDuration) >
        EPSILON * Math.max(1, duration)
      )
        fail(
          "Source range and timeline duration disagree. Apply a source trim before splitting.",
        );
      const leftDuration = (command.sourceTime - sourceIn) / speed;
      const rightDuration = clip.timelineDuration - leftDuration;
      finite(leftDuration, "Left split duration", 0, true);
      finite(rightDuration, "Right split duration", 0, true);
      if (clip.transition && clip.transition.duration > leftDuration)
        fail(
          "Choose a split after the incoming crossfade or change the transition to Cut before splitting.",
        );
      const rightStart = clip.timelineStart + leftDuration;
      finite(rightStart, "Right split timeline start", 0);
      const ids = new Set(allClips(next).map((item) => item.id));
      let rightId: string;
      for (let index = 1; ; index++) {
        const suffix = `-split-${index}`;
        rightId = `${clip.id.slice(0, 256 - suffix.length)}${suffix}`;
        if (!ids.has(rightId)) break;
      }
      const right: Clip = {
        ...structuredClone(clip),
        id: rightId,
        sourceIn: command.sourceTime,
        sourceOut,
        timelineStart: rightStart,
        timelineDuration: rightDuration,
      };
      // A transition belongs to the original incoming edge, not the new internal cut.
      delete right.transition;
      clip.sourceIn = sourceIn;
      clip.sourceOut = command.sourceTime;
      clip.timelineDuration = leftDuration;
      track.clips.splice(track.clips.indexOf(clip) + 1, 0, right);
      // No ripple: the two halves retain the original end, gaps and track positions.
      break;
    }
    case "trim": {
      if (asset.mediaType === "image")
        fail(
          "Use photo duration to adjust a still image; source trim requires video or audio.",
        );
      finite(command.sourceIn, "Source in", 0);
      finite(command.sourceOut, "Source out", command.sourceIn, true);
      if (command.sourceOut > sourceDuration(asset))
        fail(
          `Source out exceeds the actual duration of "${asset.name}" (${asset.duration}s).`,
        );
      clip.sourceIn = command.sourceIn;
      clip.sourceOut = command.sourceOut;
      resize(
        next,
        clip,
        (command.sourceOut - command.sourceIn) / (clip.transform?.speed ?? 1),
        assets,
        reconcileOverlays,
      );
      break;
    }
    case "duration":
      if (asset.mediaType !== "image")
        fail(
          "Photo duration applies only to still images. Use source trim for video or audio.",
        );
      finite(command.duration, "Photo duration", 0, true);
      clip.sourceOut =
        (clip.sourceIn ?? 0) + command.duration * (clip.transform?.speed ?? 1);
      finite(clip.sourceOut, "Resulting source out", clip.sourceIn ?? 0, true);
      resize(next, clip, command.duration, assets, reconcileOverlays);
      break;
    case "speed": {
      finite(command.speed, "Speed", 0, true);
      const bounds = sourceBounds(clip, asset);
      clip.transform = { ...clip.transform, speed: command.speed };
      clip.sourceIn = bounds.sourceIn;
      clip.sourceOut = bounds.sourceOut;
      resize(
        next,
        clip,
        (bounds.sourceOut - bounds.sourceIn) / command.speed,
        assets,
        reconcileOverlays,
      );
      break;
    }
    case "volume":
      finite(command.volume, "Volume", 0);
      if (command.volume > 1) fail("Volume must be between 0 and 1.");
      clip.transform = { ...clip.transform, volume: command.volume };
      break;
    case "transform":
      for (const key of ["scale", "rotation", "x", "y"] as const) {
        const value = command[key];
        if (value !== undefined) {
          finite(value, key, key === "scale" ? 0 : -Infinity, key === "scale");
          clip.transform = { ...clip.transform, [key]: value };
        }
      }
      break;
    case "transition":
      if (command.duration !== undefined)
        finite(command.duration, "Transition duration", 0, true);
      if (command.transition === "cut") delete clip.transition;
      else if (
        command.transition === "crossfade" ||
        command.transition === "dip-to-black" ||
        command.transition === "dip-to-white"
      ) {
        const duration =
          command.duration ?? Math.min(0.5, clip.timelineDuration);
        finite(duration, "Transition duration", 0, true);
        if (duration > clip.timelineDuration)
          fail("Transition duration cannot exceed clip duration.");
        clip.transition = { type: command.transition, duration };
      } else
        fail(
          "Transition must be cut, crossfade, dip-to-black, or dip-to-white.",
        );
      break;
    case "reorder": {
      const group = track.clips.filter((item) => item.beatId === clip.beatId);
      if (!clip.beatId)
        fail("Clip must belong to a beat before it can be reordered.");
      if (
        !Number.isInteger(command.toIndex) ||
        command.toIndex < 0 ||
        command.toIndex >= group.length
      )
        fail(
          "Reorder index must identify a clip position within this beat and track.",
        );
      const reordered = [...group];
      reordered.splice(reordered.indexOf(clip), 1);
      reordered.splice(command.toIndex, 0, clip);
      // Fill the existing beat slots without changing any other beat's order.
      const original = structuredClone(group);
      for (let index = 0; index < original.length; index++) {
        const slot = original[index]!,
          item = reordered[index]!;
        const shift =
          reordered
            .slice(0, index)
            .reduce((sum, clip) => sum + clip.timelineDuration, 0) -
          original
            .slice(0, index)
            .reduce((sum, clip) => sum + clip.timelineDuration, 0);
        item.timelineStart = slot.timelineStart + shift;
      }
      for (const other of filmClips(next)) {
        if (group.includes(other)) continue;
        const shift = original.reduce(
          (sum, slot, index) =>
            other.timelineStart >=
            slot.timelineStart + slot.timelineDuration - EPSILON
              ? sum + reordered[index]!.timelineDuration - slot.timelineDuration
              : sum,
          0,
        );
        other.timelineStart = Math.max(0, other.timelineStart + shift);
      }
      let index = 0;
      track.clips = track.clips.map((item) =>
        group.includes(item) ? reordered[index++]! : item,
      );
      updateDuration(next, assets, reconcileOverlays);
      break;
    }
    case "delete":
    case "replace": {
      if (command.type === "replace" && clip.audioTiming)
        throw new ApplicationError(
          "timeline.audioTimingConflict",
          "Reset sound timing to relink audio before replacing this clip.",
          409,
        );
      const beat = next.story.beats.find((beat) => beat.id === clip.beatId);
      const required = beat?.constraints?.some(
        (constraint) =>
          (constraint.type === "must-include" ||
            constraint.type === "asset-order") &&
          constraint.assetIds.includes(clip.assetId),
      );
      if (
        clip.layout?.secondary &&
        requiredIds(beat).has(clip.layout.secondary.assetId)
      )
        fail(
          `Clip "${clip.id}" uses selected or required paired media. Remove its selection or constraint before ${command.type === "delete" ? "deleting" : "replacing"} it.`,
        );
      if (
        asset.state.locked ||
        (clip.layout?.secondary &&
          findAsset(assets, clip.layout.secondary.assetId).state.locked) ||
        required
      )
        fail(
          `Clip "${clip.id}" uses locked or required media. Remove the selection/constraint or unlock the asset before ${command.type === "delete" ? "deleting" : "replacing"} it.`,
        );
      const oldAssetId = clip.assetId;
      if (command.type === "delete")
        remove(next, clip, assets, reconcileOverlays);
      else replace(next, assets, clip, command.assetId, reconcileOverlays);
      if (
        beat?.selectedAssetIds?.includes(oldAssetId) &&
        !allClips(next).some(
          (item) => item.beatId === beat.id && item.assetId === oldAssetId,
        )
      ) {
        beat.selectedAssetIds = [
          ...new Set(
            beat.selectedAssetIds.flatMap((id) =>
              id !== oldAssetId
                ? [id]
                : command.type === "replace"
                  ? [command.assetId]
                  : [],
            ),
          ),
        ];
      }
      break;
    }
    case "slip": {
      finite(command.delta, "Slip delta", -Infinity);
      if (Math.abs(command.delta) <= EPSILON) break;
      if (asset.state.locked)
        fail(
          `Source "${asset.name}" is locked. Unlock it before slip editing.`,
        );
      const speed = clip.transform?.speed ?? 1;
      const sourceDelta = command.delta * speed;
      const { sourceIn, sourceOut } = sourceBounds(clip, asset);
      const newSourceIn = sourceIn + sourceDelta;
      const newSourceOut = sourceOut + sourceDelta;
      if (newSourceIn < -EPSILON)
        fail(`Cannot slip past the start of source "${asset.name}".`);
      if (newSourceOut > sourceDuration(asset) + EPSILON)
        fail(`Cannot slip past the end of source "${asset.name}".`);
      clip.sourceIn = Math.max(0, newSourceIn);
      clip.sourceOut = Math.min(sourceDuration(asset), newSourceOut);
      break;
    }
    case "slide": {
      finite(command.delta, "Slide delta", -Infinity);
      if (Math.abs(command.delta) <= EPSILON) break;
      if (asset.state.locked)
        fail(
          `Source "${asset.name}" is locked. Unlock it before slide editing.`,
        );
      const index = track.clips.indexOf(clip);
      const prev = index > 0 ? track.clips[index - 1] : undefined;
      const nextClip =
        index < track.clips.length - 1 ? track.clips[index + 1] : undefined;
      const prevAdjacent = prev
        ? Math.abs(
            prev.timelineStart + prev.timelineDuration - clip.timelineStart,
          ) <= EPSILON
        : false;
      const nextAdjacent = nextClip
        ? Math.abs(
            clip.timelineStart + clip.timelineDuration - nextClip.timelineStart,
          ) <= EPSILON
        : false;
      if (!prevAdjacent && !nextAdjacent)
        fail(
          "Slide edit requires at least one adjacent neighbour on the track.",
        );

      let newDurationPrev: number | undefined;
      let newSourceOutPrev: number | undefined;
      let newDurationNext: number | undefined;
      let newSourceInNext: number | undefined;

      if (prevAdjacent && prev) {
        if (prev.locked)
          fail(`Cannot slide edit: preceding clip "${prev.id}" is locked.`);
        const assetPrev = findAsset(assets, prev.assetId);
        if (assetPrev.state.locked)
          fail(
            `Source "${assetPrev.name}" is locked. Unlock it before slide editing.`,
          );
        const speedPrev = prev.transform?.speed ?? 1;
        newDurationPrev = prev.timelineDuration + command.delta;
        if (newDurationPrev < EPSILON)
          fail(
            "Slide edit cannot shorten preceding clip to zero or negative duration.",
          );
        const boundsPrev = sourceBounds(prev, assetPrev);
        newSourceOutPrev = boundsPrev.sourceOut + command.delta * speedPrev;
        if (newSourceOutPrev > sourceDuration(assetPrev) + EPSILON)
          fail(
            `Slide edit exceeds available duration of source "${assetPrev.name}".`,
          );
        if (newSourceOutPrev <= boundsPrev.sourceIn + EPSILON)
          fail("Slide edit cannot shorten preceding source to zero duration.");
      }
      if (nextAdjacent && nextClip) {
        if (nextClip.locked)
          fail(`Cannot slide edit: following clip "${nextClip.id}" is locked.`);
        const assetNext = findAsset(assets, nextClip.assetId);
        if (assetNext.state.locked)
          fail(
            `Source "${assetNext.name}" is locked. Unlock it before slide editing.`,
          );
        const speedNext = nextClip.transform?.speed ?? 1;
        newDurationNext = nextClip.timelineDuration - command.delta;
        if (newDurationNext < EPSILON)
          fail(
            "Slide edit cannot shorten following clip to zero or negative duration.",
          );
        const boundsNext = sourceBounds(nextClip, assetNext);
        newSourceInNext = boundsNext.sourceIn + command.delta * speedNext;
        if (newSourceInNext < -EPSILON)
          fail(`Slide edit exceeds start of source "${assetNext.name}".`);
        if (newSourceInNext >= boundsNext.sourceOut - EPSILON)
          fail("Slide edit cannot shorten following source to zero duration.");
      }

      clip.timelineStart += command.delta;
      if (
        prevAdjacent &&
        prev &&
        newDurationPrev !== undefined &&
        newSourceOutPrev !== undefined
      ) {
        prev.timelineDuration = newDurationPrev;
        prev.sourceOut = newSourceOutPrev;
        constrainAudioAutomation(prev, newDurationPrev);
      }
      if (
        nextAdjacent &&
        nextClip &&
        newDurationNext !== undefined &&
        newSourceInNext !== undefined
      ) {
        nextClip.timelineStart += command.delta;
        nextClip.timelineDuration = newDurationNext;
        nextClip.sourceIn = Math.max(0, newSourceInNext);
        constrainAudioAutomation(nextClip, newDurationNext);
      }
      break;
    }
    case "lift": {
      if (clip.locked)
        fail(`Locked clip "${clip.id}" cannot be lifted. Unlock it first.`);
      track.clips = track.clips.filter((item) => item.id !== clip.id);
      if (next.composition.coverageAudioBindings) {
        next.composition.coverageAudioBindings =
          next.composition.coverageAudioBindings.filter(
            (b) => b.primaryClipId !== clip.id && b.secondaryClipId !== clip.id,
          );
        if (!next.composition.coverageAudioBindings.length)
          delete next.composition.coverageAudioBindings;
      }
      for (const t of next.composition.tracks) {
        for (const other of t.clips) {
          if (other.coverage?.primaryClipId === clip.id) {
            delete other.coverage.primaryClipId;
          }
        }
      }
      // No ripple to downstream clips: leaves a gap.
      updateDuration(next, assets, reconcileOverlays);
      break;
    }
    default:
      fail("Unknown timeline command.");
  }
  if (pendingCaptions) next.composition.captionTracks = pendingCaptions;
  return next;
}

function sameContent(left: MediaAsset, right: MediaAsset): boolean {
  return (
    left.id === right.id ||
    !!(left.contentHash && left.contentHash === right.contentHash) ||
    !!(left.perceptualHash && left.perceptualHash === right.perceptualHash)
  );
}

/** Sequential suggestions include measured timeline savings after every command. */
export function suggestShortening(
  document: EditorDocument,
  assets: MediaAsset[],
  targetDuration: number,
  context: TimelineEditContext = {},
): ShorteningSuggestion[] {
  finite(targetDuration, "Target duration", 0, true);
  return shorteningPlan(
    document,
    assets,
    targetDuration,
    undefined,
    [],
    context,
  );
}

function shorteningState(
  document: EditorDocument,
  assets: MediaAsset[],
  targetDuration: number,
  excludedClipIds: string[] = [],
  context: TimelineEditContext = {},
): string {
  return JSON.stringify({
    composition: document.composition,
    story: document.story,
    revision: "revision" in document ? document.revision : undefined,
    assets,
    targetDuration,
    excludedClipIds,
    ...(context.timebase ? { timebase: context.timebase } : {}),
  });
}

function applyShorteningCommands(
  document: EditorDocument,
  assets: MediaAsset[],
  commands: TimelineCommand[],
  context: TimelineEditContext = {},
): EditorDocument {
  let current = document;
  for (const command of commands) {
    if (
      command.type !== "trim" &&
      command.type !== "duration" &&
      command.type !== "delete"
    )
      fail(
        "A shortening suggestion must trim, shorten a photo, or remove optional media.",
      );
    const clip = findClip(current, command.clipId).clip;
    if (protectedClip(current, assets, clip))
      fail("This shortening suggestion would change locked or required media.");
    const next = applyTimelineCommand(current, assets, command, {
      ...context,
      origin: "automatic",
    });
    if (
      command.type !== "delete" &&
      findClip(next, clip.id).clip.timelineDuration >
        clip.timelineDuration + EPSILON
    )
      fail("This shortening suggestion would lengthen a clip.");
    const beat = current.story.beats.find((beat) => beat.id === clip.beatId);
    if (beat && beatLength(next, beat.id) < (beat.minDuration ?? 0) - EPSILON)
      fail("This shortening suggestion would go below the beat minimum.");
    current = next;
  }
  return current;
}

/** Individual previews are alternatives; Apply all uses the original sequential commands and total. */
export function prepareShorteningPlan(
  document: EditorDocument,
  assets: MediaAsset[],
  targetDuration: number,
  excludedClipIds: string[] = [],
  context: TimelineEditContext = {},
): PreparedShorteningPlan {
  finite(targetDuration, "Target duration", 0, true);
  const excluded = [...new Set(excludedClipIds)].sort();
  const steps = shorteningPlan(
    document,
    assets,
    targetDuration,
    undefined,
    excluded,
    context,
  );
  const baseState = shorteningState(
    document,
    assets,
    targetDuration,
    excluded,
    context,
  );
  const beforeDuration = document.composition.duration;
  const prepare = (
    commands: TimelineCommand[],
    secondsSaved: number,
  ): PreparedShorteningEdit => ({
    excludedClipIds: [...excluded],
    commands: structuredClone(commands),
    secondsSaved,
    beforeDuration,
    afterDuration: beforeDuration - secondsSaved,
    targetDuration,
    baseState,
    commandFingerprint: JSON.stringify(commands),
  });
  const suggestions = steps.flatMap((step) => {
    let next: EditorDocument;
    try {
      next = applyShorteningCommands(document, assets, [step.command], context);
    } catch (error) {
      if (error instanceof TimelineEditingError) return [];
      throw error;
    }
    const secondsSaved = beforeDuration - next.composition.duration;
    if (secondsSaved <= EPSILON) return [];
    const asset = findAsset(
      assets,
      findClip(document, step.clipId).clip.assetId,
    );
    const action =
      step.command.type === "delete"
        ? "Remove optional media"
        : asset.mediaType === "image"
          ? "Shorten photo display"
          : "Shorten source out";
    return [
      {
        ...prepare([step.command], secondsSaved),
        id: step.id,
        clipId: step.clipId,
        reason: `${action} for "${asset.name}". Saves ${secondsSaved.toFixed(2)}s from the current cut.`,
      },
    ];
  });
  return {
    ...prepare(
      steps.map((step) => step.command),
      steps.reduce((sum, step) => sum + step.secondsSaved, 0),
    ),
    suggestions,
  };
}

/** Resolve a reviewed preview immediately before enqueueing it; this does not change history. */
export function shorteningCommands(
  document: EditorDocument,
  assets: MediaAsset[],
  targetDuration: number,
  preview: PreparedShorteningPlan | ShorteningSuggestionPreview,
  excludedClipIds: string[] = [],
  context: TimelineEditContext = {},
): TimelineCommand[] {
  const excluded = [...new Set(excludedClipIds)].sort();
  if (
    preview.baseState !==
      shorteningState(document, assets, targetDuration, excluded, context) ||
    JSON.stringify(preview.excludedClipIds) !== JSON.stringify(excluded) ||
    preview.commandFingerprint !== JSON.stringify(preview.commands) ||
    preview.commands.some(
      (command) => "clipId" in command && excluded.includes(command.clipId),
    )
  )
    fail(
      "This shortening suggestion is stale. Review the suggestions for the current cut and try again.",
    );
  const next = applyShorteningCommands(
    document,
    assets,
    preview.commands,
    context,
  );
  if (
    Math.abs(
      document.composition.duration -
        next.composition.duration -
        preview.secondsSaved,
    ) > EPSILON
  )
    fail(
      "This shortening suggestion has changed. Review its current saving before applying it.",
    );
  return structuredClone(preview.commands);
}

function shorteningPlan(
  document: EditorDocument,
  assets: MediaAsset[],
  targetDuration: number,
  onlyBeat?: string,
  excludedClipIds: string[] = [],
  context: TimelineEditContext = {},
): ShorteningSuggestion[] {
  let current = document;
  const suggestions: ShorteningSuggestion[] = [];
  const snapshots: EditorDocument[] = [];
  const editable = allClips(document).filter(
    (clip) =>
      findClip(document, clip.id).track.timing !== "overlay" &&
      (!onlyBeat || clip.beatId === onlyBeat) &&
      !excludedClipIds.includes(clip.id) &&
      !protectedClip(document, assets, clip),
  );
  editable.sort(
    (a, b) =>
      scoreAsset(findAsset(assets, a.assetId)).score -
        scoreAsset(findAsset(assets, b.assetId)).score ||
      a.timelineStart - b.timelineStart ||
      a.id.localeCompare(b.id),
  );
  function offer(command: TimelineCommand, reason: string): boolean {
    let next: EditorDocument;
    try {
      next = applyTimelineCommand(current, assets, command, {
        ...context,
        origin: "automatic",
      });
    } catch (error) {
      if (
        error instanceof TimelineEditingError ||
        (error instanceof ApplicationError &&
          error.code === "timeline.pinConflict")
      )
        return false;
      throw error;
    }
    const secondsSaved =
      current.composition.duration - next.composition.duration;
    if (secondsSaved < -EPSILON) return false;
    current = next;
    snapshots.push(next);
    const clipId = "clipId" in command ? command.clipId : "";
    suggestions.push({
      id: `shorten:${clipId}:${suggestions.length + 1}`,
      clipId,
      secondsSaved: Math.max(0, secondsSaved),
      reason:
        secondsSaved > EPSILON
          ? `${reason} Saves ${secondsSaved.toFixed(2)}s.`
          : `${reason}. Overlapping media still sets the duration; this prepares the next step (0s saved now).`,
      command,
    });
    return true;
  }
  const allowance = (clip: Clip): number => {
    const beat = current.story.beats.find((beat) => beat.id === clip.beatId);
    return beat
      ? Math.max(0, beatLength(current, beat.id) - (beat.minDuration ?? 0))
      : Infinity;
  };
  for (const original of editable) {
    const remaining = current.composition.duration - targetDuration;
    if (remaining <= EPSILON) break;
    const clip = findClip(current, original.id).clip;
    const reduction = Math.min(
      remaining,
      allowance(clip),
      Math.max(0, clip.timelineDuration - 1),
    );
    if (reduction > EPSILON)
      offer(
        durationCommand(
          clip,
          findAsset(assets, clip.assetId),
          clip.timelineDuration - reduction,
        ),
        `Shorten ${findAsset(assets, clip.assetId).mediaType === "image" ? "photo display" : "source out"} for "${findAsset(assets, clip.assetId).name}" while retaining at least one second`,
      );
  }
  for (const original of editable) {
    const remaining = current.composition.duration - targetDuration;
    if (remaining <= EPSILON) break;
    const clip = findClip(current, original.id).clip;
    const allowed = allowance(clip);
    if (allowed + EPSILON < clip.timelineDuration) {
      const reduction = Math.min(
        remaining,
        allowed,
        clip.timelineDuration - EPSILON,
      );
      if (reduction > EPSILON)
        offer(
          durationCommand(
            clip,
            findAsset(assets, clip.assetId),
            clip.timelineDuration - reduction,
          ),
          "Shorten optional media up to the beat minimum",
        );
    } else if (remaining < clip.timelineDuration - EPSILON) {
      offer(
        durationCommand(
          clip,
          findAsset(assets, clip.assetId),
          clip.timelineDuration - remaining,
        ),
        "Keep a brief excerpt of optional media to meet the target exactly",
      );
    } else {
      offer(
        { type: "delete", clipId: clip.id },
        `Remove optional "${findAsset(assets, clip.assetId).name}" after shortening available excerpts`,
      );
    }
  }
  // Retain preparatory overlap edits only when a later step saves time.
  while (suggestions.at(-1)?.secondsSaved === 0) {
    suggestions.pop();
    snapshots.pop();
  }
  current = snapshots.at(-1) ?? document;
  if (
    current.composition.duration > targetDuration + EPSILON &&
    suggestions.length
  )
    suggestions[suggestions.length - 1]!.reason +=
      ` The ${targetDuration.toFixed(2)}s target remains infeasible: protected clips, beat minima, or overlapping tracks leave ${current.composition.duration.toFixed(2)}s.`;
  return suggestions;
}

/** Internal detached candidate planner; pinned-placement restores authoritative anchors. */
export function proposeIncrementalBeat(
  document: EditorDocument,
  assets: MediaAsset[],
  beatId: string,
  mode: Extract<TimelineCommand, { type: "regenerate-beat" }>["mode"],
): EditorDocument {
  return regenerate(document, assets, beatId, mode);
}

function regenerate(
  document: EditorDocument,
  assets: MediaAsset[],
  beatId: string,
  mode: Extract<TimelineCommand, { type: "regenerate-beat" }>["mode"],
): EditorDocument {
  const beat = findBeat(document, beatId);
  const original = allClips(document).filter((clip) => clip.beatId === beatId);
  const length = beatLength(document, beatId);
  if (mode === "shorten") {
    const desired = Math.max(
      beat.minDuration ?? 0,
      beat.targetDuration !== undefined && beat.targetDuration < length
        ? beat.targetDuration
        : length * 0.8,
    );
    const target = Math.max(
      EPSILON,
      document.composition.duration - length + desired,
    );
    return shorteningPlan(document, assets, target, beatId).reduce(
      (current, suggestion) =>
        applyTimelineCommand(current, assets, suggestion.command),
      document,
    );
  }
  const editable = original.filter(
    (clip) => !protectedClip(document, assets, clip),
  );
  const protectedClips = original.filter((clip) =>
    protectedClip(document, assets, clip),
  );
  const outside = allClips(document).filter((clip) => clip.beatId !== beatId);
  const excluded = new Set(
    beat.constraints?.flatMap((constraint) =>
      constraint.type === "must-exclude" ? constraint.assetIds : [],
    ) ?? [],
  );
  const unavailable = new Set(
    [...outside, ...protectedClips].flatMap(clipAssetIds),
  );
  const pool = assets.filter(
    (asset) =>
      renderable(asset) &&
      !unavailable.has(asset.id) &&
      !excluded.has(asset.id) &&
      !asset.state.rejected &&
      (asset.mediaType === "image" ||
        (asset.duration !== undefined &&
          Number.isFinite(asset.duration) &&
          asset.duration > 0)) &&
      (beat.candidateAssetIds === undefined ||
        beat.candidateAssetIds.includes(asset.id) ||
        requiredIds(beat).has(asset.id)),
  );
  if (mode === "remove-repetition") {
    const retained = [...outside, ...protectedClips].map((clip) =>
      findAsset(assets, clip.assetId),
    );
    for (const clip of editable) {
      const asset = findAsset(assets, clip.assetId);
      if (
        retained.some((other) => sameContent(asset, other)) &&
        beatLength(document, beatId) - clip.timelineDuration >=
          (beat.minDuration ?? 0) - EPSILON
      )
        remove(document, findClip(document, clip.id).clip, assets);
      else retained.push(asset);
    }
    return document;
  }
  if (mode === "replace-similar") {
    const used = new Set(allClips(document).flatMap(clipAssetIds));
    for (const originalClip of editable) {
      const source = findAsset(assets, originalClip.assetId);
      const candidates = pool.filter(
        (asset) =>
          !used.has(asset.id) &&
          (asset.mediaType === "audio") === (source.mediaType === "audio"),
      );
      const similarity = (asset: MediaAsset): number =>
        (sameContent(asset, source) ? 100 : 0) +
        source.tags.filter((tag) => asset.tags.includes(tag)).length * 10 +
        (asset.mediaType === source.mediaType ? 1 : 0);
      candidates.sort(
        (a, b) =>
          similarity(b) - similarity(a) ||
          scoreAsset(b).score - scoreAsset(a).score ||
          a.id.localeCompare(b.id),
      );
      const candidate = candidates[0];
      if (!candidate || similarity(candidate) <= 0) continue;
      const clip = findClip(document, originalClip.id).clip;
      const afterLength = Math.min(
        clip.timelineDuration,
        sourceDuration(candidate) / (clip.transform?.speed ?? 1),
      );
      if (
        beatLength(document, beatId) - clip.timelineDuration + afterLength <
        (beat.minDuration ?? 0) - EPSILON
      )
        continue;
      replace(document, assets, clip, candidate.id);
      used.add(candidate.id);
    }
    return document;
  }
  if (!["regenerate", "more-video", "more-photos"].includes(mode))
    fail("Unknown beat regeneration mode.");
  const fixedLength = protectedClips.reduce(
    (sum, clip) => sum + clip.timelineDuration,
    0,
  );
  if (fixedLength > (beat.maxDuration ?? Infinity) + EPSILON)
    fail(
      "Locked and required clips exceed this beat's maximum. Increase the maximum or remove their protection before regeneration.",
    );
  const required = requiredIds(beat);
  protectedClips.forEach((clip) =>
    clipAssetIds(clip).forEach((id) => required.delete(id)),
  );
  const preferred =
    mode === "more-photos"
      ? pool.filter((asset) => asset.mediaType === "image")
      : mode === "more-video"
        ? pool.filter(
            (asset) =>
              asset.mediaType === "video" || asset.mediaType === "360-video",
          )
        : pool;
  const candidates = preferred.length
    ? [
        ...new Map(
          [...preferred, ...pool.filter((asset) => required.has(asset.id))].map(
            (asset) => [asset.id, asset],
          ),
        ).values(),
      ]
    : pool;
  const desired =
    Math.min(
      beat.maxDuration ?? Infinity,
      Math.max(beat.minDuration ?? 0, beat.targetDuration ?? (length || 6)),
    ) - fixedLength;
  const minimum = Math.max(0, (beat.minDuration ?? 0) - fixedLength);
  let generated: Clip[] = [];
  if (candidates.length && (desired > EPSILON || required.size)) {
    const scoped: Story = {
      id: document.story.id,
      title: document.story.title,
      targetDuration: Math.max(EPSILON, desired),
      ...(beat.maxDuration === undefined
        ? {}
        : { maxDuration: Math.max(EPSILON, beat.maxDuration - fixedLength) }),
      beats: [
        {
          ...beat,
          candidateAssetIds: candidates.map((asset) => asset.id),
          selectedAssetIds: [...required],
          minDuration: minimum,
          targetDuration: Math.max(EPSILON, desired),
          maxDuration:
            beat.maxDuration === undefined
              ? undefined
              : Math.max(EPSILON, beat.maxDuration - fixedLength),
          constraints: beat.constraints?.map((constraint) =>
            "assetIds" in constraint
              ? {
                  ...constraint,
                  assetIds: constraint.assetIds.filter((id) =>
                    candidates.some((asset) => asset.id === id),
                  ),
                }
              : constraint,
          ),
        },
      ],
    };
    generated = compose(scoped, candidates)
      .tracks.flatMap((track) => track.clips)
      .sort((a, b) => a.timelineStart - b.timelineStart);
  } else if (minimum > EPSILON || required.size)
    fail(
      "Not enough eligible media to regenerate this beat within its duration constraints.",
    );
  const existingIds = new Set(allClips(document).map((clip) => clip.id));
  generated.forEach((clip, index) => {
    const base = `${document.composition.id}:edit:${beatId}:${index + 1}`;
    let id = base,
      suffix = 1;
    while (existingIds.has(id)) id = `${base}:${suffix++}`;
    clip.id = id;
    existingIds.add(id);
  });
  // Keep the solver's combined media order; old slots cannot be matched by type.
  const orderedSlots = [...editable].sort(
    (left, right) => left.timelineStart - right.timelineStart,
  );
  const assignments = orderedSlots.map((clip, index) => ({
    oldId: clip.id,
    next: generated[index],
    start: clip.timelineStart,
  }));
  const trackForType = (type: "audio" | "video") => {
    let track = document.composition.tracks.find(
      (item) => item.type === type && item.timing !== "overlay",
    );
    if (!track) {
      let id = `${document.composition.id}:${type}`,
        suffix = 1;
      while (document.composition.tracks.some((item) => item.id === id))
        id = `${document.composition.id}:${type}:${suffix++}`;
      track = { id, type, clips: [] };
      document.composition.tracks.push(track);
    }
    return track;
  };
  const insertSorted = (
    track: (typeof document.composition.tracks)[number],
    clip: Clip,
  ) => {
    const index = track.clips.findIndex(
      (item) => item.timelineStart >= clip.timelineStart - EPSILON,
    );
    track.clips.splice(index < 0 ? track.clips.length : index, 0, clip);
  };
  // Regeneration may temporarily shorten the visual timeline while replacing
  // slots, then append more clips. Reconcile soundtrack only at the final end.
  for (const assignment of assignments.sort((a, b) => b.start - a.start)) {
    const { clip, track } = findClip(document, assignment.oldId);
    if (!assignment.next) remove(document, clip, assets, false);
    else {
      resize(document, clip, assignment.next.timelineDuration, assets, false);
      assignment.next.timelineStart = clip.timelineStart;
      const index = track.clips.indexOf(clip);
      const type =
        findAsset(assets, assignment.next.assetId).mediaType === "audio"
          ? "audio"
          : "video";
      if (track.type === type) track.clips[index] = assignment.next;
      else {
        track.clips.splice(index, 1);
        insertSorted(trackForType(type), assignment.next);
      }
    }
  }
  const remaining = generated.slice(assignments.length);
  let insertion = Math.max(
    0,
    ...allClips(document)
      .filter((clip) => clip.beatId === beatId)
      .map((clip) => clip.timelineStart + clip.timelineDuration),
  );
  if (!original.length && !insertion) {
    const beatIndex = document.story.beats.indexOf(beat);
    const earlier = new Set(
      document.story.beats.slice(0, beatIndex).map((item) => item.id),
    );
    insertion = Math.max(
      0,
      ...allClips(document)
        .filter((clip) => clip.beatId && earlier.has(clip.beatId))
        .map((clip) => clip.timelineStart + clip.timelineDuration),
    );
  } else if (!insertion && original.length)
    insertion = Math.min(...original.map((clip) => clip.timelineStart));
  for (const clip of remaining) {
    for (const other of filmClips(document))
      if (other.timelineStart >= insertion - EPSILON)
        other.timelineStart += clip.timelineDuration;
    const type =
      findAsset(assets, clip.assetId).mediaType === "audio" ? "audio" : "video";
    const track = trackForType(type);
    clip.timelineStart = insertion;
    insertSorted(track, clip);
    insertion += clip.timelineDuration;
  }
  updateDuration(document, assets);
  return document;
}
