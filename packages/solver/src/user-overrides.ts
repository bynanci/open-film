import type { PinConflict } from "./pinned-placement.js";
import {
  ApplicationError,
  filmLookMatrix,
  resolveFilmLook,
  primaryColorCoefficients,
  resolvePrimaryColor,
  sequenceFrameAt,
  validateUserOverrideState,
  type Clip,
  type GraphicScene,
  type OverrideTarget,
  type ProjectTimebaseV1,
  type UserLockedAttribute,
  type UserOverrideState,
} from "@openfilm/core";
import type { EditorDocument, TimelineCommand } from "./editing.js";
export interface TimelineEditContext {
  timebase?: ProjectTimebaseV1;
  origin?: "direct" | "automatic" | "history" | "restore";
}
export function pinConflict(
  message = "The edit conflicts with a user pin.",
  conflicts: readonly PinConflict[] = [],
): never {
  const targets = conflicts
    .flatMap((c) => c.targets)
    .filter(
      (target) =>
        (target.kind === "clip" ? target.clipId : target.sceneId).length <= 256,
    )
    .slice(0, 20);
  throw new ApplicationError(
    "timeline.pinConflict",
    message,
    409,
    targets.length ? { pinTargets: JSON.stringify(targets) } : undefined,
  );
}
/** Compare full JSON payloads, including future fields, independent of key order. */
export function sameOverridePayload(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left).sort(),
    other = Object.keys(right).sort();
  return (
    keys.length === other.length &&
    keys.every(
      (k, i) => k === other[i] && sameOverridePayload(left[k], right[k]),
    )
  );
}
export function overrideTargetKey(target: OverrideTarget): string {
  return target.kind === "clip"
    ? `clip:${target.clipId}`
    : `graphic-scene:${target.sceneId}`;
}
export function directOverrideTargets(
  commands: readonly TimelineCommand[],
): OverrideTarget[] {
  return commands.flatMap((command): OverrideTarget[] => {
    if (command.type === "user-pin.set") return [command.target];
    if (command.type === "user-pin.resolve") return command.targets;
    if (command.type === "graphic.scene.upsert")
      return [{ kind: "graphic-scene", sceneId: command.scene.id }];
    if (command.type === "graphic.scene.remove")
      return [{ kind: "graphic-scene", sceneId: command.sceneId }];
    if (command.type === "coverage.apply-proposal")
      return [
        { kind: "clip", clipId: command.proposal.primaryClipId },
        { kind: "clip", clipId: command.proposal.bRollClipId },
      ];
    if (command.type === "roll")
      return [
        { kind: "clip", clipId: command.clipIdA },
        { kind: "clip", clipId: command.clipIdB },
      ];
    if (command.type === "batch")
      return directOverrideTargets(command.commands);
    if ("clipId" in command) return [{ kind: "clip", clipId: command.clipId }];
    return [];
  });
}
function owners(
  document: EditorDocument,
): Map<string, { owner: Clip | GraphicScene; trackId?: string }> {
  const result = new Map<
    string,
    { owner: Clip | GraphicScene; trackId?: string }
  >();
  for (const track of document.composition.tracks)
    for (const owner of track.clips)
      result.set(`clip:${owner.id}`, { owner, trackId: track.id });
  for (const owner of document.composition.graphicScenes ?? [])
    result.set(`graphic-scene:${owner.id}`, { owner });
  return result;
}
function state(
  owner: Clip | GraphicScene,
  attributes: UserLockedAttribute[],
  manualOffset?: number,
): UserOverrideState {
  return validateUserOverrideState(
    {
      version: 1,
      isUserPinned: true,
      lockedAttributes: [
        ...new Set([
          ...(owner.userOverrides?.lockedAttributes ?? []),
          ...attributes,
          "timing" as const,
        ]),
      ],
      ...(manualOffset === undefined
        ? owner.userOverrides?.manualOffset === undefined
          ? {}
          : { manualOffset: owner.userOverrides.manualOffset }
        : { manualOffset }),
    },
    "timelineStart" in owner ? "clip" : "graphic-scene",
  );
}
export function applyOverridePolicy(
  before: EditorDocument,
  after: EditorDocument,
  commands: readonly TimelineCommand[],
  context: Required<TimelineEditContext>,
): EditorDocument {
  const next = structuredClone(after);
  if (context.origin === "history" || context.origin === "restore") return next;
  const old = owners(before),
    current = owners(next);
  // Scene metadata is authoritative even when the scene itself is a direct target.
  for (const command of commands)
    if (command.type === "graphic.scene.upsert") {
      const prior = old.get(`graphic-scene:${command.scene.id}`)?.owner
        .userOverrides;
      if (!sameOverridePayload(command.scene.userOverrides, prior))
        pinConflict("Scene pin metadata must equal the saved state.");
    }
  const direct = context.origin === "direct";
  const authorized = new Set(
    direct ? directOverrideTargets(commands).map(overrideTargetKey) : [],
  );
  const released = new Set<string>();
  for (const command of commands) {
    if (command.type === "delete" || command.type === "lift")
      released.add(`clip:${command.clipId}`);
    if (command.type === "graphic.scene.remove")
      released.add(`graphic-scene:${command.sceneId}`);
    if (command.type === "user-pin.set" && !command.pinned)
      released.add(overrideTargetKey(command.target));
    if (command.type === "user-pin.resolve")
      for (const target of command.targets)
        released.add(overrideTargetKey(target));
  }
  for (const [key, previous] of old) {
    if (authorized.has(key) && !current.has(key) && !released.has(key))
      pinConflict(
        "Only an explicit delete or user-pin release may remove the named owner.",
      );
    if (!previous.owner.userOverrides?.isUserPinned || authorized.has(key))
      continue;
    const candidate = current.get(key);
    if (
      !candidate ||
      previous.trackId !== candidate.trackId ||
      !sameOverridePayload(previous.owner, candidate.owner)
    )
      pinConflict(undefined, [
        {
          code: "capacity",
          targets: [
            "timelineStart" in previous.owner
              ? { kind: "clip", clipId: previous.owner.id }
              : { kind: "graphic-scene", sceneId: previous.owner.id },
          ],
          beatIds:
            "beatId" in previous.owner && previous.owner.beatId
              ? [previous.owner.beatId]
              : [],
          message: "The edit conflicts with a user pin.",
        },
      ]);
    if (
      key.startsWith("clip:") &&
      !sameOverridePayload(
        filmLookMatrix(
          resolveFilmLook(before.composition, previous.owner as Clip).look,
        ),
        filmLookMatrix(
          resolveFilmLook(next.composition, candidate.owner as Clip).look,
        ),
      )
    )
      pinConflict("The parent look would change a user pinned clip.");
    if (
      key.startsWith("clip:") &&
      !sameOverridePayload(
        primaryColorCoefficients(
          resolvePrimaryColor(before.composition, previous.owner as Clip)
            .correction,
        ).matrix,
        primaryColorCoefficients(
          resolvePrimaryColor(next.composition, candidate.owner as Clip)
            .correction,
        ).matrix,
      )
    )
      pinConflict("The parent primary color would change a user pinned clip.");
  }
  if (!direct) return next;
  for (const command of commands) {
    if (command.type === "lock" || command.type === "track.update") continue;
    if (
      command.type === "user-pin.set" ||
      command.type === "user-pin.resolve"
    ) {
      const targets =
        command.type === "user-pin.set" ? [command.target] : command.targets;
      for (const target of targets) {
        const item = current.get(overrideTargetKey(target));
        if (!item) {
          if (
            released.has(overrideTargetKey(target)) &&
            old.has(overrideTargetKey(target))
          )
            continue;
          pinConflict("The user pin owner no longer exists.");
        }
        if (command.type === "user-pin.resolve" || !command.pinned)
          item.owner.userOverrides = {
            version: 1,
            isUserPinned: false,
            lockedAttributes: [],
          };
        else {
          const o = item.owner;
          item.owner.userOverrides = state(o, [
            "timing",
            ...("timelineStart" in o &&
            (o.sourceIn !== undefined || o.sourceOut !== undefined)
              ? ["inOutRange" as const]
              : []),
            ...("timelineStart" in o
              ? o.motion
                ? ["motionPreset" as const]
                : []
              : o.photoDepth
                ? ["photoDepth" as const]
                : []),
          ]);
        }
      }
      continue;
    }
    const targets = directOverrideTargets([command]);
    if (command.type === "clip.split") {
      // The edit implementation creates exactly one new occurrence, never infer it from asset ID.
      for (const [key, item] of current)
        if (key.startsWith("clip:") && !old.has(key))
          targets.push({ kind: "clip", clipId: item.owner.id });
    }
    for (const target of targets) {
      const key = overrideTargetKey(target),
        entry = current.get(key);
      if (!entry) continue;
      const owner = entry.owner,
        previous = old.get(key)?.owner;
      const categories: UserLockedAttribute[] = ["timing"];
      if (
        ["trim", "speed", "clip.split", "roll", "slip", "slide"].includes(
          command.type,
        )
      )
        categories.push("inOutRange");
      if (command.type === "presentation" && Object.hasOwn(command, "motion"))
        categories.push("motionPreset");
      if (
        command.type === "graphic.scene.upsert" &&
        (Object.hasOwn(owner, "photoDepth") ||
          Object.hasOwn(previous ?? {}, "photoDepth"))
      )
        categories.push("photoDepth");
      const moving =
        command.type === "audio.move" || command.type === "reorder";
      const offset =
        moving &&
        previous &&
        "timelineStart" in previous &&
        "timelineStart" in owner
          ? sequenceFrameAt(owner.timelineStart, context.timebase, "nearest") -
            sequenceFrameAt(previous.timelineStart, context.timebase, "nearest")
          : undefined;
      owner.userOverrides = state(owner, categories, offset);
      // Newly split occurrences do not inherit diagnostic offsets from the original.
      if (command.type === "clip.split" && !previous)
        delete owner.userOverrides.manualOffset;
    }
  }
  return next;
}
