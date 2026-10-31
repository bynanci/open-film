// SPDX-License-Identifier: Apache-2.0
import {
  ApplicationError,
  resolveAudioInterval,
  validateAudioAutomation,
  validateComposition,
  type Clip,
  type MediaAsset,
} from "@openfilm/core";
import type { EditorDocument, TimelineCommand } from "./editing.js";
import type { TimelineEditContext } from "./user-overrides.js";
function conflict(message: string): never {
  throw new ApplicationError("timeline.audioTimingConflict", message, 409);
}
function clips(document: EditorDocument): Map<string, Clip> {
  return new Map(
    document.composition.tracks.flatMap((t) =>
      t.clips.map((c) => [c.id, c] as const),
    ),
  );
}
/** Translate the sound start once from the actual saved picture movement, preserving source/effect clocks. */
export function translateIndependentAudio(
  before: EditorDocument,
  after: EditorDocument,
  command: TimelineCommand,
): void {
  const previous = clips(before);
  for (const clip of clips(after).values()) {
    const prior = previous.get(clip.id);
    if (
      !prior?.audioTiming ||
      !clip.audioTiming ||
      (command.type === "audio.timing" && command.clipId === clip.id)
    )
      continue;
    // Quantize the endpoints, not every incremental delta. This telescopes
    // across repeated rational-frame moves while retaining the saved offset.
    const delta =
      Math.round(clip.timelineStart * 48000) -
      Math.round(prior.timelineStart * 48000);
    if (delta)
      clip.audioTiming.timelineStartSample =
        prior.audioTiming.timelineStartSample + delta;
  }
}
/** Validate the detached final batch. The application supplies authoritative source facts and context. */
export function validateAudioEdit(
  before: EditorDocument,
  after: EditorDocument,
  assets: readonly MediaAsset[],
  commands: readonly TimelineCommand[],
  context: Required<TimelineEditContext>,
): void {
  const previous = clips(before),
    current = clips(after),
    byAsset = new Map(assets.map((a) => [a.id, a]));
  if (
    ![...previous.values(), ...current.values()].some((c) => c.audioTiming) &&
    !commands.some((c) => c.type === "audio.timing")
  )
    return;
  if (!context.timebase)
    conflict("Independent sound requires the authoritative project clock.");
  const targeted = new Set(
    commands.flatMap((c) => ("clipId" in c ? [c.clipId] : [])),
  );
  for (const prior of previous.values())
    if (prior.audioTiming) {
      const next = current.get(prior.id);
      if (
        !next &&
        !(
          context.origin === "direct" &&
          commands.some((c) => c.type === "delete" && c.clipId === prior.id)
        )
      )
        conflict(
          "Regeneration would discard independent sound; explicitly reset sound timing first.",
        );
      if (
        next &&
        !next.audioTiming &&
        !commands.some(
          (c) =>
            c.type === "audio.timing" &&
            c.clipId === prior.id &&
            c.timing === null,
        )
      )
        conflict(
          "An edit cannot silently relink independent sound; explicitly reset sound timing first.",
        );
      if (next?.audioTiming && next.assetId !== prior.assetId)
        conflict("Reset sound timing before replacing its source.");
      if (
        next?.audioTiming &&
        !targeted.has(prior.id) &&
        (next.audioTiming.sourceInSample !== prior.audioTiming.sourceInSample ||
          next.audioTiming.sourceOutSample !==
            prior.audioTiming.sourceOutSample)
      )
        conflict(
          "An indirect edit changed independent sound source coordinates.",
        );
    }
  try {
    for (const clip of current.values())
      if (clip.audioTiming) {
        const asset = byAsset.get(clip.assetId);
        if (!asset)
          conflict("Independent sound source is missing; relink the source.");
        const interval = resolveAudioInterval(
          clip,
          asset,
          after.composition.duration,
        );
        if (clip.audioAutomation)
          validateAudioAutomation(
            clip.audioAutomation,
            interval.automationDurationSeconds,
          );
      }
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    conflict(
      error instanceof Error
        ? error.message
        : "Independent sound range is invalid.",
    );
  }
  const oldCues = new Map(
    before.composition.captionTracks?.flatMap((t) =>
      t.cues.map((c) => [c.id, c] as const),
    ) ?? [],
  );
  for (const cue of after.composition.captionTracks?.flatMap((t) => t.cues) ??
    []) {
    if (cue.source.kind !== "transcript") continue;
    const source = cue.source,
      prior = previous.get(source.clipId),
      next = current.get(source.clipId);
    if (!prior?.audioTiming && !next?.audioTiming) continue;
    const asset = next && byAsset.get(next.assetId);
    const fail = () => {
      throw new ApplicationError(
        "timeline.audioCaptionConflict",
        "Independent sound would change a source-linked caption mapping. Edit or delete the affected caption in the same batch.",
        409,
      );
    };
    if (!next || !asset || next.assetId !== source.assetId) fail();
    const nextRange = resolveAudioInterval(
      next!,
      asset!,
      after.composition.duration,
    );
    if (
      source.sourceIn * 48000 < nextRange.sourceInSeconds * 48000 - 1 ||
      source.sourceOut * 48000 > nextRange.sourceOutSeconds * 48000 + 1
    )
      fail();
    const priorCue = oldCues.get(cue.id),
      oldAsset = prior && byAsset.get(prior.assetId);
    if (
      !prior ||
      !oldAsset ||
      !priorCue ||
      priorCue.source.kind !== "transcript"
    )
      continue;
    const oldRange = resolveAudioInterval(
      prior,
      oldAsset,
      before.composition.duration,
    );
    for (const [position, oldPosition, time, oldTime] of [
      [
        source.sourceIn,
        priorCue.source.sourceIn,
        cue.startMs,
        priorCue.startMs,
      ],
      [source.sourceOut, priorCue.source.sourceOut, cue.endMs, priorCue.endMs],
    ]) {
      const mapped =
          nextRange.startSample +
          ((position! - nextRange.sourceInSeconds) * 48000) / nextRange.speed,
        oldMapped =
          oldRange.startSample +
          ((oldPosition! - oldRange.sourceInSeconds) * 48000) / oldRange.speed;
      if (Math.abs(mapped - oldMapped - (time! - oldTime!) * 48) > 1 + 1e-7)
        fail();
    }
  }
  validateComposition(after.composition, { assetIds: byAsset.keys() });
}
