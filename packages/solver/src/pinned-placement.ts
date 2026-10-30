import {
  graphicSceneAssetIds,
  resolveClipFrameRange,
  resolveClipSourceRange,
  sequenceFrameAt,
  sequenceTimeAt,
  timebaseRate,
  validateComposition,
  type Clip,
  type MediaAsset,
  type OverrideTarget,
  type ProjectTimebaseV1,
  type Track,
} from "@openfilm/core";
import {
  proposeIncrementalBeat,
  type EditorDocument,
  type TimelineCommand,
} from "./editing.js";
import { applyOverridePolicy, sameOverridePayload } from "./user-overrides.js";
export interface IncrementalSolveInput {
  baseline: EditorDocument;
  assets: readonly MediaAsset[];
  timebase: ProjectTimebaseV1;
  scope: { kind: "composition" } | { kind: "beat"; beatId: string };
  mode: Extract<TimelineCommand, { type: "regenerate-beat" }>["mode"];
}
export interface PinConflict {
  code:
    | "overlap"
    | "capacity"
    | "required-media"
    | "missing-owner"
    | "unsupported-topology"
    | "timebase-change"
    | "search-limit";
  targets: OverrideTarget[];
  beatIds: string[];
  message: string;
}
export type IncrementalSolveResult =
  | { ok: true; document: EditorDocument }
  | { ok: false; conflicts: PinConflict[] };
const MAX_EXPANSIONS = 10000;
const clips = (d: EditorDocument) =>
  d.composition.tracks.flatMap((track) =>
    track.clips.map((clip) => ({ clip, track })),
  );
const spine = (d: EditorDocument) =>
  clips(d)
    .filter(
      ({ track }) =>
        track.timing !== "overlay" &&
        ["video", "audio", "music"].includes(track.type),
    )
    .sort(
      (a, b) =>
        a.clip.timelineStart - b.clip.timelineStart ||
        a.clip.id.localeCompare(b.clip.id),
    );
const target = (clip: Clip): OverrideTarget => ({
  kind: "clip",
  clipId: clip.id,
});
const conflict = (
  code: PinConflict["code"],
  message: string,
  entries: Clip[] = [],
): IncrementalSolveResult => ({
  ok: false,
  conflicts: [
    {
      code,
      message,
      targets: entries.slice(0, 20).map(target),
      beatIds: [
        ...new Set(entries.flatMap((c) => (c.beatId ? [c.beatId] : []))),
      ].slice(0, 20),
    },
  ],
});
function preflight(
  d: EditorDocument,
  assets: readonly MediaAsset[],
  clock: ProjectTimebaseV1,
): IncrementalSolveResult | undefined {
  const film = spine(d);
  if (film.length > 2000 || d.story.beats.length > 1000)
    return conflict(
      "search-limit",
      "The selected cut exceeds the incremental solve limit.",
    );
  timebaseRate(clock);
  const ids = new Set(assets.map((a) => a.id));
  if (
    clips(d).some(
      ({ clip }) =>
        !ids.has(clip.assetId) ||
        (clip.layout?.secondary && !ids.has(clip.layout.secondary.assetId)),
    ) ||
    graphicSceneAssetIds(d.composition.graphicScenes ?? []).some(
      (id) => !ids.has(id),
    )
  )
    return conflict(
      "missing-owner",
      "Relink missing media before resolving user pins.",
    );
  for (let i = 1; i < film.length; i++)
    if (
      film[i - 1]!.clip.timelineStart + film[i - 1]!.clip.timelineDuration >
      film[i]!.clip.timelineStart + 1e-9
    )
      return conflict(
        "unsupported-topology",
        "Incremental solve requires a sequential film spine.",
        [film[i - 1]!.clip, film[i]!.clip],
      );
}
function constraints(
  d: EditorDocument,
  assets: readonly MediaAsset[],
): boolean {
  const indexed = new Map(assets.map((a) => [a.id, a]));
  for (const beat of d.story.beats) {
    const owners = spine(d)
      .filter(({ clip }) => clip.beatId === beat.id)
      .map(({ clip }) => clip);
    const ids = owners.flatMap((c) => [
      c.assetId,
      ...(c.layout?.secondary ? [c.layout.secondary.assetId] : []),
    ]);
    const required = new Set(beat.selectedAssetIds ?? []);
    const length = owners.reduce((s, c) => s + c.timelineDuration, 0);
    if (
      length < (beat.minDuration ?? 0) - 1e-9 ||
      length > (beat.maxDuration ?? Infinity) + 1e-9
    )
      return false;
    for (const c of beat.constraints ?? []) {
      if (c.type === "must-include" || c.type === "asset-order")
        for (const id of c.assetIds) required.add(id);
      if (
        c.type === "must-exclude" &&
        c.assetIds.some((id) => ids.includes(id))
      )
        return false;
      if (
        c.type === "asset-order" &&
        c.assetIds.some(
          (id, i) => i > 0 && ids.indexOf(c.assetIds[i - 1]!) > ids.indexOf(id),
        )
      )
        return false;
      if (c.type === "chronological" && c.enabled !== false) {
        const times = owners
          .map((c) => indexed.get(c.assetId)?.capturedAt)
          .filter((s): s is string => !!s)
          .map((s) => Date.parse(s));
        if (times.some((t, i) => i > 0 && t < times[i - 1]!)) return false;
      }
    }
    if ([...required].some((id) => !ids.includes(id))) return false;
  }
  return true;
}
function finish(
  before: EditorDocument,
  next: EditorDocument,
  assets: readonly MediaAsset[],
  clock: ProjectTimebaseV1,
  directTargets: readonly OverrideTarget[] = [],
): IncrementalSolveResult {
  const authorized = new Set(
    directTargets.filter((t) => t.kind === "clip").map((t) => t.clipId),
  );
  const old = new Map(
    clips(before).map(({ clip, track }) => [clip.id, { clip, track }]),
  );
  for (const { clip, track } of clips(next)) {
    const original = old.get(clip.id);
    if (
      original?.clip.userOverrides?.isUserPinned &&
      !authorized.has(clip.id) &&
      (!sameOverridePayload(original.clip, clip) ||
        original.track.id !== track.id ||
        !sameOverridePayload(
          resolveClipFrameRange(original.clip, clock),
          resolveClipFrameRange(clip, clock),
        ))
    )
      return conflict(
        "capacity",
        "The edit would move or change a user pinned clip.",
        [original.clip],
      );
    const asset = assets.find((a) => a.id === clip.assetId);
    if (!asset)
      return conflict("missing-owner", "A source is missing.", [clip]);
    try {
      resolveClipSourceRange(clip, asset);
    } catch {
      return conflict(
        "capacity",
        "A source range cannot fit the proposed edit.",
        [clip],
      );
    }
  }
  const film = spine(next);
  for (let i = 1; i < film.length; i++) {
    const left = film[i - 1]!.clip,
      right = film[i]!.clip;
    const raw =
      left.timelineStart + left.timelineDuration > right.timelineStart + 1e-9;
    const frames =
      resolveClipFrameRange(left, clock).endFrame >
      resolveClipFrameRange(right, clock).startFrame;
    if (raw || frames)
      return conflict(
        "capacity",
        "The edit cannot fit before the next fixed anchor.",
        [left, right],
      );
  }
  if (!constraints(next, assets))
    return conflict(
      "required-media",
      "The complete cut cannot satisfy its required media, order or duration constraints.",
    );
  try {
    validateComposition(next.composition, {
      assetIds: assets.map((a) => a.id),
    });
    // Direct targets are checked by the command policy, including deleted owners.
    if (!directTargets.length)
      applyOverridePolicy(before, next, [], {
        origin: "automatic",
        timebase: clock,
      });
  } catch {
    return conflict(
      "capacity",
      "The complete cut would change a user pin or exclude saved overlays.",
    );
  }
  return { ok: true, document: next };
}
/** Narrow ripple mode retains every non-target duration and source window. */
export function placeDirectEdit(
  before: EditorDocument,
  proposed: EditorDocument,
  assets: readonly MediaAsset[],
  timebase: ProjectTimebaseV1,
  targets: readonly OverrideTarget[],
): IncrementalSolveResult {
  const invalid = preflight(before, assets, timebase);
  if (invalid) return invalid;
  const next = structuredClone(proposed),
    old = new Map(clips(before).map((e) => [e.clip.id, e]));
  const authorized = new Set(
    targets.filter((t) => t.kind === "clip").map((t) => t.clipId),
  );
  let cursor = 0;
  for (const { clip, track } of spine(next)) {
    const previous = old.get(clip.id)?.clip;
    if (previous && !authorized.has(clip.id)) {
      const start = clip.timelineStart;
      Object.assign(clip, structuredClone(previous));
      if (!previous.userOverrides?.isUserPinned)
        clip.timelineStart = Math.max(cursor, start);
    } else clip.timelineStart = Math.max(cursor, clip.timelineStart);
    if (clip.timelineStart < cursor - 1e-9)
      return conflict("capacity", "The edit overlaps a user pinned anchor.", [
        clip,
      ]);
    if (
      previous?.userOverrides?.isUserPinned &&
      !authorized.has(clip.id) &&
      track.id !== old.get(clip.id)!.track.id
    )
      return conflict("capacity", "A pinned clip cannot change track.", [clip]);
    cursor = clip.timelineStart + clip.timelineDuration;
  }
  // Overlays remain absolute, and must never be silently trimmed by old ripple code.
  for (const { clip, track } of clips(before))
    if (track.timing === "overlay" && !authorized.has(clip.id)) {
      const destination = next.composition.tracks.find(
        (t) => t.id === track.id,
      );
      if (destination) {
        const index = destination.clips.findIndex((c) => c.id === clip.id);
        if (index < 0) destination.clips.push(structuredClone(clip));
        else destination.clips[index] = structuredClone(clip);
      } else
        next.composition.tracks.push({
          ...structuredClone(track),
          clips: [structuredClone(clip)],
        });
    }
  next.composition.duration = Math.max(
    0,
    ...spine(next).map(
      ({ clip }) => clip.timelineStart + clip.timelineDuration,
    ),
  );
  return finish(before, next, assets, timebase, targets);
}
/** Bounded candidate allocation into existing mutable intervals between exact anchors. */
export function solveIncremental(
  input: IncrementalSolveInput,
): IncrementalSolveResult {
  const { baseline, assets, timebase, scope, mode } = input;
  const invalid = preflight(baseline, assets, timebase);
  if (invalid) return invalid;
  if (
    scope.kind === "beat" &&
    !baseline.story.beats.some((b) => b.id === scope.beatId)
  )
    return conflict("missing-owner", "The selected beat no longer exists.");
  const next = structuredClone(baseline);
  let expansions = 0,
    exhausted = false;
  const inScope = (clip: Clip) =>
    scope.kind === "composition" || clip.beatId === scope.beatId;
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const beat of baseline.story.beats.filter(
    (b) => scope.kind === "composition" || b.id === scope.beatId,
  )) {
    const original = spine(baseline).filter(
      ({ clip }) => clip.beatId === beat.id,
    );
    if (!original.length) continue;
    const working = structuredClone(next);
    working.composition.tracks = working.composition.tracks.filter(
      (t) =>
        t.timing !== "overlay" && ["audio", "video", "music"].includes(t.type),
    );
    delete working.composition.graphicScenes;
    delete working.composition.graphicSceneTemplates;
    delete working.composition.captionTracks;
    for (const { clip } of clips(working)) {
      if (clip.userOverrides?.isUserPinned) clip.locked = true;
      delete clip.userOverrides;
    }
    let proposal: EditorDocument;
    try {
      proposal = proposeIncrementalBeat(working, [...assets], beat.id, mode);
    } catch {
      return conflict(
        "required-media",
        "No candidate selection satisfies the saved beat constraints.",
        original.map((e) => e.clip),
      );
    }
    const candidates = spine(proposal).filter(
      ({ clip }) =>
        clip.beatId === beat.id &&
        !original.some(
          (e) => e.clip.id === clip.id && e.clip.userOverrides?.isUserPinned,
        ),
    );
    const ordering =
      beat.constraints
        ?.filter((c) => c.type === "asset-order")
        .flatMap((c) => (c.type === "asset-order" ? c.assetIds : [])) ?? [];
    if (ordering.length)
      candidates.sort((a, b) => {
        const left = ordering.indexOf(a.clip.assetId),
          right = ordering.indexOf(b.clip.assetId);
        return (
          (left < 0 ? Infinity : left) - (right < 0 ? Infinity : right) ||
          a.clip.timelineStart - b.clip.timelineStart
        );
      });
    const intervals: {
      start: number;
      end: number;
      cursor: number;
      track: Track;
    }[] = [];
    for (const { clip, track } of original) {
      if (clip.userOverrides?.isUserPinned) continue;
      const last = intervals.at(-1);
      if (last && Math.abs(last.end - clip.timelineStart) < 1e-9)
        last.end = clip.timelineStart + clip.timelineDuration;
      else
        intervals.push({
          start: clip.timelineStart,
          end: clip.timelineStart + clip.timelineDuration,
          cursor: clip.timelineStart,
          track,
        });
    }
    const assigned: { clip: Clip; track: Track }[] = [];
    const memo = new Set<string>();
    function allocate(index: number, minGap: number): boolean {
      if (index === candidates.length) return true;
      const key = `${index}:${minGap}:${intervals.map((g) => g.cursor).join(",")}`;
      if (memo.has(key)) return false;
      const candidate = candidates[index]!,
        prior = original.find((e) => e.clip.id === candidate.clip.id);
      for (let i = minGap; i < intervals.length; i++) {
        if (++expansions >= MAX_EXPANSIONS) {
          exhausted = true;
          return false;
        }
        const gap = intervals[i]!,
          startFrame = sequenceFrameAt(gap.cursor, timebase, "nearest"),
          endFrame = sequenceFrameAt(gap.end, timebase, "nearest");
        const clip = structuredClone(prior ? prior.clip : candidate.clip);
        const fixed = !!prior;
        const capacity = endFrame - startFrame;
        const desired = resolveClipFrameRange(
          { ...clip, timelineStart: 0 },
          timebase,
        ).endFrame;
        const frames = fixed ? desired : Math.min(desired, capacity);
        if (frames <= 0 || frames > capacity) continue;
        clip.timelineStart = fixed
          ? gap.cursor
          : sequenceTimeAt(startFrame, timebase);
        if (!fixed) {
          clip.timelineDuration = sequenceTimeAt(frames, timebase);
          if (byId.get(clip.assetId)?.mediaType !== "image")
            clip.sourceOut =
              (clip.sourceIn ?? 0) +
              clip.timelineDuration * (clip.transform?.speed ?? 1);
        }
        if (
          clip.timelineStart < gap.cursor - 1e-9 ||
          clip.timelineStart + clip.timelineDuration > gap.end + 1e-9
        )
          continue;
        const cursor = gap.cursor;
        gap.cursor = clip.timelineStart + clip.timelineDuration;
        assigned.push({ clip, track: prior?.track ?? candidate.track });
        if (allocate(index + 1, i)) return true;
        assigned.pop();
        gap.cursor = cursor;
        if (exhausted) return false;
      }
      memo.add(key);
      return false;
    }
    if (!allocate(0, 0))
      return conflict(
        exhausted ? "search-limit" : "capacity",
        exhausted
          ? "The bounded candidate search reached its limit."
          : "The selected media cannot fit between saved user pins.",
        original.map((e) => e.clip),
      );
    for (const track of next.composition.tracks)
      if (
        track.timing !== "overlay" &&
        ["video", "audio", "music"].includes(track.type)
      )
        track.clips = track.clips.filter(
          (c) =>
            !inScope(c) ||
            c.beatId !== beat.id ||
            c.userOverrides?.isUserPinned,
        );
    for (const entry of assigned) {
      let track = next.composition.tracks.find((t) => t.id === entry.track.id);
      if (!track) {
        track = { ...structuredClone(entry.track), clips: [] };
        next.composition.tracks.push(track);
      }
      track.clips.push(entry.clip);
      track.clips.sort((a, b) => a.timelineStart - b.timelineStart);
    }
  }
  return finish(baseline, next, assets, timebase);
}
