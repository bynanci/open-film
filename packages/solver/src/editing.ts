import type {
  Clip,
  Composition,
  MediaAsset,
  Story,
  StoryBeat,
  Track,
} from "@openfilm/core";
import { preserveUserBeatText, scoreAsset } from "@openfilm/story";
import { compose } from "./index.js";

export type TimelineCommand =
  | { type: "trim"; clipId: string; sourceIn: number; sourceOut: number }
  | { type: "duration"; clipId: string; duration: number }
  | { type: "speed"; clipId: string; speed: number }
  | { type: "volume"; clipId: string; volume: number }
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
      transition: "cut" | "crossfade";
      duration?: number;
    }
  | { type: "reorder"; clipId: string; toIndex: number }
  | { type: "delete"; clipId: string }
  | { type: "replace"; clipId: string; assetId: string }
  | { type: "lock"; clipId: string; locked: boolean }
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
function findClip(
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
    !!clip.locked ||
    !!findAsset(assets, clip.assetId).state.locked ||
    requiredIds(
      document.story.beats.find((beat) => beat.id === clip.beatId),
    ).has(clip.assetId)
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
function updateDuration(document: EditorDocument): void {
  document.composition.duration = Math.max(
    0,
    ...allClips(document).map(
      (clip) => clip.timelineStart + clip.timelineDuration,
    ),
  );
  finite(document.composition.duration, "Resulting timeline duration", 0);
}
/** Ripple at the old end preserves gaps and clips that overlap the edited source. */
function resize(document: EditorDocument, clip: Clip, duration: number): void {
  finite(duration, "Clip duration", 0, true);
  const end = clip.timelineStart + clip.timelineDuration;
  const delta = duration - clip.timelineDuration;
  clip.timelineDuration = duration;
  if (clip.transition && clip.transition.duration > duration)
    clip.transition.duration = duration;
  for (const other of allClips(document))
    if (other.id !== clip.id && other.timelineStart >= end - EPSILON)
      other.timelineStart = Math.max(0, other.timelineStart + delta);
  updateDuration(document);
}
function remove(document: EditorDocument, clip: Clip): void {
  const { track } = findClip(document, clip.id);
  const end = clip.timelineStart + clip.timelineDuration;
  track.clips = track.clips.filter((item) => item.id !== clip.id);
  for (const other of allClips(document))
    if (other.timelineStart >= end - EPSILON)
      other.timelineStart = Math.max(
        0,
        other.timelineStart - clip.timelineDuration,
      );
  updateDuration(document);
}
function replace(
  document: EditorDocument,
  assets: MediaAsset[],
  clip: Clip,
  assetId: string,
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
  clip.sourceIn = 0;
  clip.sourceOut = duration * speed;
  finite(clip.sourceOut, "Resulting source out", 0, true);
  resize(document, clip, duration);
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

/** Applies one edit to a detached snapshot; undo history can retain either input. */
export function applyTimelineCommand(
  document: EditorDocument,
  assets: MediaAsset[],
  command: TimelineCommand,
): EditorDocument {
  const next = structuredClone(document);
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
  switch (command.type) {
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
      resize(next, clip, command.duration);
      break;
    case "speed": {
      finite(command.speed, "Speed", 0, true);
      const bounds = sourceBounds(clip, asset);
      clip.transform = { ...clip.transform, speed: command.speed };
      clip.sourceIn = bounds.sourceIn;
      clip.sourceOut = bounds.sourceOut;
      resize(next, clip, (bounds.sourceOut - bounds.sourceIn) / command.speed);
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
        finite(command.duration, "Crossfade duration", 0, true);
      if (command.transition === "cut") delete clip.transition;
      else if (command.transition === "crossfade") {
        const duration =
          command.duration ?? Math.min(0.5, clip.timelineDuration);
        finite(duration, "Crossfade duration", 0, true);
        if (duration > clip.timelineDuration)
          fail("Crossfade duration cannot exceed clip duration.");
        clip.transition = { type: "crossfade", duration };
      } else fail("Transition must be cut or crossfade.");
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
      for (const other of allClips(next)) {
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
      updateDuration(next);
      break;
    }
    case "delete":
    case "replace": {
      const beat = next.story.beats.find((beat) => beat.id === clip.beatId);
      const required = beat?.constraints?.some(
        (constraint) =>
          (constraint.type === "must-include" ||
            constraint.type === "asset-order") &&
          constraint.assetIds.includes(clip.assetId),
      );
      if (asset.state.locked || required)
        fail(
          `Clip "${clip.id}" uses locked or required media. Remove the selection/constraint or unlock the asset before ${command.type === "delete" ? "deleting" : "replacing"} it.`,
        );
      const oldAssetId = clip.assetId;
      if (command.type === "delete") remove(next, clip);
      else replace(next, assets, clip, command.assetId);
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
    default:
      fail("Unknown timeline command.");
  }
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
): ShorteningSuggestion[] {
  finite(targetDuration, "Target duration", 0, true);
  return shorteningPlan(document, assets, targetDuration);
}

function shorteningState(
  document: EditorDocument,
  assets: MediaAsset[],
  targetDuration: number,
  excludedClipIds: string[] = [],
): string {
  return JSON.stringify({
    composition: document.composition,
    story: document.story,
    revision: "revision" in document ? document.revision : undefined,
    assets,
    targetDuration,
    excludedClipIds,
  });
}

function applyShorteningCommands(
  document: EditorDocument,
  assets: MediaAsset[],
  commands: TimelineCommand[],
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
    const next = applyTimelineCommand(current, assets, command);
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
): PreparedShorteningPlan {
  finite(targetDuration, "Target duration", 0, true);
  const excluded = [...new Set(excludedClipIds)].sort();
  const steps = shorteningPlan(
    document,
    assets,
    targetDuration,
    undefined,
    excluded,
  );
  const baseState = shorteningState(document, assets, targetDuration, excluded);
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
      next = applyShorteningCommands(document, assets, [step.command]);
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
): TimelineCommand[] {
  const excluded = [...new Set(excludedClipIds)].sort();
  if (
    preview.baseState !==
      shorteningState(document, assets, targetDuration, excluded) ||
    JSON.stringify(preview.excludedClipIds) !== JSON.stringify(excluded) ||
    preview.commandFingerprint !== JSON.stringify(preview.commands) ||
    preview.commands.some(
      (command) => "clipId" in command && excluded.includes(command.clipId),
    )
  )
    fail(
      "This shortening suggestion is stale. Review the suggestions for the current cut and try again.",
    );
  const next = applyShorteningCommands(document, assets, preview.commands);
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
): ShorteningSuggestion[] {
  let current = document;
  const suggestions: ShorteningSuggestion[] = [];
  const snapshots: EditorDocument[] = [];
  const editable = allClips(document).filter(
    (clip) =>
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
    const next = applyTimelineCommand(current, assets, command);
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
    [...outside, ...protectedClips].map((clip) => clip.assetId),
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
        remove(document, findClip(document, clip.id).clip);
      else retained.push(asset);
    }
    return document;
  }
  if (mode === "replace-similar") {
    const used = new Set(allClips(document).map((clip) => clip.assetId));
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
  protectedClips.forEach((clip) => required.delete(clip.assetId));
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
    let track = document.composition.tracks.find((item) => item.type === type);
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
  for (const assignment of assignments.sort((a, b) => b.start - a.start)) {
    const { clip, track } = findClip(document, assignment.oldId);
    if (!assignment.next) remove(document, clip);
    else {
      resize(document, clip, assignment.next.timelineDuration);
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
    for (const other of allClips(document))
      if (other.timelineStart >= insertion - EPSILON)
        other.timelineStart += clip.timelineDuration;
    const type =
      findAsset(assets, clip.assetId).mediaType === "audio" ? "audio" : "video";
    const track = trackForType(type);
    clip.timelineStart = insertion;
    insertSorted(track, clip);
    insertion += clip.timelineDuration;
  }
  updateDuration(document);
  return document;
}
