// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
import {
  FRAME_BOUNDARY_TOLERANCE_SECONDS,
  captionFrameRange,
  frameAlignedDuration,
  graphicSceneAssetIds,
  isFilmLookActive,
  resolveFilmLook,
  resolvePrimaryColor,
  isPrimaryColorActive,
  assertPrimaryColorSettings,
  type Composition,
} from "@openfilm/core";
export type HandoffMode = "preserve-editability" | "preserve-visual-fidelity";
export type HandoffDisposition =
  "native-editable" | "metadata-only" | "baked" | "unsupported";
export interface HandoffOptions {
  mode?: HandoffMode;
  bakeAudio?: boolean;
  captionTrackId?: string | null;
}
export interface HandoffRange {
  startFrame: number;
  endFrame: number;
}
export interface HandoffItem extends HandoffRange {
  ownerId: string;
  feature: string;
  disposition: HandoffDisposition;
  reason: string;
}
export interface HandoffPlan {
  version: 1;
  compositionId: string;
  mode: HandoffMode;
  rate: { numerator: number; denominator: number };
  durationFrames: number;
  items: HandoffItem[];
  visualRanges: HandoffRange[];
  bakeAudio: boolean;
  captionTrackId: string | null;
  transparentOverlay: { supported: false; reason: string };
  stems: { supported: false; reason: string };
  realNleVerified: false;
}
const keys = (value: object, allowed: string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unsupported handoff effect or field");
};
export function createHandoffPlan(
  composition: Composition,
  frameRate: number,
  options: HandoffOptions = {},
): HandoffPlan {
  assertPrimaryColorSettings(composition);
  keys(options, ["mode", "bakeAudio", "captionTrackId"]);
  if (
    composition.tracks.length > 128 ||
    (composition.captionTracks?.length ?? 0) > 128 ||
    composition.tracks.reduce((n, t) => n + t.clips.length, 0) > 2000 ||
    (composition.captionTracks ?? []).reduce((n, t) => n + t.cues.length, 0) >
      5000
  )
    throw new Error("Handoff plan resource limit exceeded");
  const mode = options.mode ?? "preserve-editability";
  if (
    !["preserve-editability", "preserve-visual-fidelity"].includes(mode) ||
    (options.bakeAudio !== undefined && typeof options.bakeAudio !== "boolean")
  )
    throw new Error("Unsupported handoff options");
  if (!Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 120)
    throw new Error("Unsupported frame rate");
  const [mantissa, exponentText = "0"] = String(frameRate)
    .toLowerCase()
    .split("e");
  const [whole, fraction = ""] = mantissa!.split(".");
  let n = BigInt(whole! + fraction),
    d = 10n ** BigInt(fraction.length);
  const exponent = Number(exponentText);
  if (exponent >= 0) n *= 10n ** BigInt(exponent);
  else d *= 10n ** BigInt(-exponent);
  for (const candidate of [24000, 30000, 60000, 120000])
    if (frameRate === candidate / 1001) {
      n = BigInt(candidate);
      d = 1001n;
      break;
    }
  const gcd = (a: bigint, b: bigint): bigint => (b ? gcd(b, a % b) : a);
  const divisor = gcd(n, d);
  n /= divisor;
  d /= divisor;
  if (
    n > BigInt(Number.MAX_SAFE_INTEGER) ||
    d > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Unsupported frame rate precision");
  const numerator = Number(n),
    denominator = Number(d);
  const rate = numerator / denominator;
  const frame = (seconds: number, strict = false) => {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new Error("Invalid handoff time");
    const value = seconds * rate;
    if (!strict) return value;
    if (
      Math.abs(seconds - Math.round(value) / rate) >
      FRAME_BOUNDARY_TOLERANCE_SECONDS
    )
      throw new Error("Bake boundaries must align to output frames");
    return seconds === 0
      ? 0
      : Math.round(frameAlignedDuration(seconds, rate) * rate);
  };
  keys(composition, [
    "id",
    "storyId",
    "storyPresetSnapshot",
    "duration",
    "tracks",
    "defaultLook",
    "defaultPrimaryColor",
    "beatPrimaryColors",
    "beatLooks",
    "captionTracks",
    "graphicScenes",
    "graphicSceneTemplates",
  ]);
  const sourceIds = new Set([
    ...graphicSceneAssetIds(composition.graphicScenes ?? []),
    ...composition.tracks.flatMap((track) =>
      track.clips.flatMap((clip) => [
        clip.assetId,
        ...(clip.layout?.secondary ? [clip.layout.secondary.assetId] : []),
      ]),
    ),
  ]);
  if (composition.duration > 3600 || sourceIds.size > 256)
    throw new Error("Handoff resource limit exceeded (one hour / 256 assets)");
  const fidelity = mode === "preserve-visual-fidelity";
  const captionTrackId =
    options.captionTrackId === undefined
      ? (composition.captionTracks?.[0]?.id ?? null)
      : options.captionTrackId;
  if (
    captionTrackId !== null &&
    !composition.captionTracks?.some((t) => t.id === captionTrackId)
  )
    throw new Error("Caption track not found");
  const items: HandoffItem[] = [];
  const add = (
    ownerId: string,
    feature: string,
    start: number,
    end: number,
    kind: "native" | "visual" | "audio" | "manual",
    reason: string,
  ) => {
    const baked =
      (kind === "visual" && fidelity) ||
      (kind === "audio" && options.bakeAudio === true);
    items.push({
      ownerId,
      feature,
      startFrame: frame(start, baked && kind === "visual"),
      endFrame: frame(end, baked && kind === "visual"),
      disposition: baked
        ? "baked"
        : kind === "native"
          ? "native-editable"
          : "metadata-only",
      reason: baked
        ? "Explicit opaque precomp/full mix; original recipe retained in provenance"
        : reason,
    });
  };
  const durationFrames = frame(
    composition.duration,
    options.bakeAudio === true,
  );
  if (durationFrames <= 0) throw new Error("Empty handoff timeline");
  const referenceFrames = Math.round(
    frameAlignedDuration(composition.duration, rate) * rate,
  );
  for (const track of composition.tracks) {
    keys(track, ["id", "type", "timing", "clips"]);
    if (!["video", "overlay", "titles", "audio", "music"].includes(track.type))
      throw new Error("Unsupported track type");
    const audio = track.type === "audio" || track.type === "music";
    const title = track.type === "titles";
    add(
      track.id,
      "layerTiming",
      0,
      composition.duration,
      title ? "manual" : audio && options.bakeAudio ? "audio" : "native",
      title
        ? "Generated title timing is metadata until explicitly baked; ignored placeholder media is omitted from exchange"
        : "Native OTIO track/gap timing; consumer layer interpretation needs workstation QA",
    );
    if (track.timing)
      add(
        track.id,
        "editingPolicy",
        0,
        composition.duration,
        "manual",
        "OpenFilm non-ripple policy is metadata, not an NLE editing policy",
      );
    let end = 0;
    for (const clip of [...track.clips].sort(
      (a, b) => a.timelineStart - b.timelineStart,
    )) {
      keys(clip, [
        "id",
        "assetId",
        "beatId",
        "sourceIn",
        "sourceOut",
        "timelineStart",
        "timelineDuration",
        "transform",
        "title",
        "layout",
        "motion",
        "titleStyle",
        "titlePresetSnapshot",
        "titleRuns",
        "audioAutomation",
        "look",
        "primaryColor",
        "locked",
        "transition",
      ]);
      if (clip.transform)
        keys(clip.transform, [
          "scale",
          "rotation",
          "x",
          "y",
          "speed",
          "volume",
        ]);
      if (audio && (clip.title !== undefined || clip.titleStyle !== undefined))
        throw new Error(
          "Titles on audio tracks are unsupported for handoff; move the title to a visual track",
        );
      const start = clip.timelineStart,
        stop = start + clip.timelineDuration;
      if (
        start < end - 1e-6 ||
        clip.timelineDuration <= 0 ||
        stop > composition.duration + 1e-6
      )
        throw new Error("Unsupported overlapping clips or invalid bounds");
      end = stop;
      add(
        clip.id,
        "sourceIdentity",
        start,
        stop,
        title ? "manual" : "native",
        title
          ? "Title placeholder source is ignored by the renderer and omitted from native exchange; authored identity remains in provenance"
          : "Original asset ID/hash and source range preserved; baked copies also map back to this identity",
      );
      add(
        clip.id,
        "cut",
        start,
        stop,
        title ? "manual" : "native",
        title
          ? "Ignored title placeholder media has no native cut; generated title timing remains metadata or an explicit bake"
          : "Native source trim/cut outside explicit precomp ranges",
      );
      if (clip.userOverrides?.isUserPinned)
        add(
          clip.id,
          "user-pin",
          start,
          stop,
          "manual",
          "Foreign NLEs do not enforce user pins; inline owner state remains OpenFilm metadata.",
        );
      if (clip.locked)
        add(
          clip.id,
          "lock",
          start,
          stop,
          "manual",
          "OpenFilm locks are retained; reapply in the consuming NLE",
        );
      if ((clip.transform?.speed ?? 1) !== 1)
        add(
          clip.id,
          "speed",
          start,
          stop,
          audio ? "audio" : "visual",
          "Retime requires manual recreation from original source bounds",
        );
      if ((clip.transform?.volume ?? 1) !== 1)
        add(
          clip.id,
          "volume",
          start,
          stop,
          "audio",
          "Gain/mute is metadata unless full mix is selected",
        );
      if (clip.audioAutomation)
        add(
          clip.id,
          "audioAutomation",
          start,
          stop,
          "audio",
          "Envelope/ducking remains exact metadata unless full mix is selected",
        );
      if (audio) continue;
      if (track.type === "overlay" || track.type === "titles")
        add(
          clip.id,
          "compositing",
          start,
          stop,
          "visual",
          "Track compositing semantics require manual recreation",
        );
      for (const field of [
        "title",
        "titleStyle",
        "titleRuns",
        "layout",
        "motion",
      ] as const)
        if (clip[field] !== undefined)
          add(
            clip.id,
            field,
            start,
            stop,
            "visual",
            "Original visual recipe is metadata; NLE does not reconstruct it",
          );
      if (clip.transition && clip.transition.duration > 0)
        add(
          clip.id,
          "transition",
          start,
          Math.min(stop, start + clip.transition.duration),
          "visual",
          "Incoming fade and outgoing tail are rendered only within the transition interval",
        );
      if (
        ["x", "y", "rotation", "scale"].some(
          (key) =>
            (clip.transform?.[key as "x"] ?? (key === "scale" ? 1 : 0)) !==
            (key === "scale" ? 1 : 0),
        )
      )
        add(
          clip.id,
          "transform",
          start,
          stop,
          "visual",
          "Geometry is metadata; NLE does not reconstruct it",
        );
      if (
        isPrimaryColorActive(resolvePrimaryColor(composition, clip).correction)
      )
        add(
          clip.id,
          "primaryColor",
          start,
          stop,
          "visual",
          "Primary color is metadata; recreate manually or use a rendered precomp",
        );
      if (isFilmLookActive(resolveFilmLook(composition, clip).look))
        add(
          clip.id,
          "look",
          start,
          stop,
          "visual",
          "Resolved look recipe is metadata; color needs manual recreation",
        );
    }
  }
  for (const scene of composition.graphicScenes ?? []) {
    if (scene.userOverrides?.isUserPinned)
      add(
        scene.id,
        "user-pin",
        scene.start,
        scene.start + scene.duration,
        "manual",
        "Foreign NLEs do not enforce user pins; inline scene state remains OpenFilm metadata.",
      );
    add(
      scene.id,
      "graphicScene",
      scene.start,
      scene.start + scene.duration,
      "visual",
      "Declarative graphics, nodes and animation are metadata, not native keyframes",
    );
  }
  for (const track of composition.captionTracks ?? [])
    for (const cue of track.cues) {
      let start = cue.startMs / 1000,
        end = cue.endMs / 1000;
      let kind: "visual" | "manual" =
        track.id === captionTrackId ? "visual" : "manual";
      let reason =
        "SRT/VTT carry literal bilingual text/timing; typography, shadow, stroke, pills and unselected languages require manual NLE recreation/import";
      if (fidelity && kind === "visual") {
        if (cue.endMs > composition.duration * 1000 + 1e-7)
          throw new Error(
            `Caption cue ${cue.id} extends beyond the composition duration`,
          );
        const range = captionFrameRange(cue.startMs, cue.endMs, rate);
        const first = Math.min(referenceFrames, range.startFrame),
          last = Math.min(referenceFrames, range.endFrame);
        if (last <= first) {
          kind = "manual";
          reason =
            "Caption has no complete reference frame; original millisecond timing remains in SRT/VTT";
        } else {
          start = first / rate;
          end = last / rate;
        }
      }
      add(cue.id, "caption", start, end, kind, reason);
    }
  const visualRanges: HandoffRange[] = [];
  for (const item of items
    .filter(
      (i) =>
        i.disposition === "baked" &&
        !["volume", "audioAutomation", "speed"].includes(i.feature) &&
        !(
          i.feature === "layerTiming" &&
          composition.tracks.some(
            (t) => t.id === i.ownerId && ["audio", "music"].includes(t.type),
          )
        ),
    )
    .concat(
      items.filter(
        (i) =>
          i.disposition === "baked" &&
          i.feature === "speed" &&
          composition.tracks.some(
            (t) =>
              !["audio", "music"].includes(t.type) &&
              t.clips.some((c) => c.id === i.ownerId),
          ),
      ),
    )
    .sort((a, b) => a.startFrame - b.startFrame)) {
    const previous = visualRanges.at(-1);
    if (previous && item.startFrame <= previous.endFrame)
      previous.endFrame = Math.max(previous.endFrame, item.endFrame);
    else
      visualRanges.push({
        startFrame: item.startFrame,
        endFrame: item.endFrame,
      });
  }
  if (visualRanges.length > 128)
    throw new Error(
      "Handoff supports at most 128 disjoint visual bake ranges; use preserve-editability or fewer ranges",
    );
  if (visualRanges.some((range) => range.endFrame > referenceFrames))
    throw new Error(
      "Visual bake exceeds complete reference frames; align the composition end to output frames",
    );
  if (
    (visualRanges.length || options.bakeAudio === true) &&
    (composition.captionTracks?.find((track) => track.id === captionTrackId)
      ?.cues.length ?? 0) > 64
  )
    throw new Error(
      "Handoff reference rendering supports at most 64 selected caption cues; select no caption language, or use preserve-editability without full mix, and import the SRT/VTT sidecars manually",
    );
  // Native source/cut claims apply only to ranges that survive replacement.
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    if (!["cut", "sourceIdentity"].includes(item.feature)) continue;
    const title = composition.tracks.some(
      (track) =>
        track.type === "titles" &&
        track.clips.some((clip) => clip.id === item.ownerId),
    );
    const audio = composition.tracks.some(
      (t) =>
        ["audio", "music"].includes(t.type) &&
        t.clips.some((c) => c.id === item.ownerId),
    );
    const ranges = audio
      ? options.bakeAudio
        ? [{ startFrame: item.startFrame, endFrame: item.endFrame }]
        : []
      : visualRanges;
    const points = [
      ...new Set([
        item.startFrame,
        item.endFrame,
        ...ranges
          .flatMap((r) => [r.startFrame, r.endFrame])
          .filter((p) => p > item.startFrame && p < item.endFrame),
      ]),
    ].sort((a, b) => a - b);
    const pieces = points.slice(0, -1).map((startFrame, i) => {
      const endFrame = points[i + 1]!;
      const covered = ranges.some(
        (r) => startFrame >= r.startFrame && endFrame <= r.endFrame,
      );
      return {
        ...item,
        startFrame,
        endFrame,
        disposition: covered
          ? item.feature === "cut"
            ? "baked"
            : "metadata-only"
          : item.disposition,
        reason:
          covered && !title
            ? "Original source/cut retained in provenance; this range uses explicit rendered replacement"
            : item.reason,
      } as HandoffItem;
    });
    items.splice(index, 1, ...pieces);
  }
  return {
    version: 1,
    compositionId: composition.id,
    mode,
    rate: { numerator, denominator },
    durationFrames,
    items,
    visualRanges,
    bakeAudio: options.bakeAudio === true,
    captionTrackId,
    transparentOverlay: {
      supported: false,
      reason: "No measured alpha profile admitted; opaque precomps only",
    },
    stems: {
      supported: false,
      reason:
        "M7B stems are not integrated on this base; optional full mix only",
    },
    realNleVerified: false,
  };
}
