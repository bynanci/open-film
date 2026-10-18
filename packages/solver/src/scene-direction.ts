import {
  assetDisplayDimensions,
  resolvePhotoPlan,
  type Clip,
  type MediaAsset,
  type PhotoLayout,
  type PhotoMotion,
  type ProjectSettings,
  type Track,
} from "@openfilm/core";
import {
  applyTimelineCommand,
  TimelineEditingError,
  type EditorDocument,
  type TimelineCommand,
} from "./editing.js";

export interface SceneDirectionOptions {
  beatId: string;
  clipIds: string[];
  replaceExisting?: boolean;
}

export interface SceneDirectionContext {
  settings: ProjectSettings;
  maxDuration?: number;
}

export interface SceneDirectionAction {
  id: string;
  clipId: string;
  kind: "layout" | "motion";
  reason: "contain" | "hero" | "hold" | "push-in" | "pan";
  evidence: string;
  before: unknown;
  after: unknown;
  command: TimelineCommand;
}

export interface SceneDirectionNote {
  code:
    | "unsupported"
    | "conflict"
    | "locked"
    | "manual"
    | "unsupportedMedia"
    | "unchanged"
    | "unsafe";
  text?: string;
  clipId?: string;
}

export interface SceneDirectionProposal {
  version: 1;
  beatId: string;
  sourceText: string;
  actions: SceneDirectionAction[];
  notes: SceneDirectionNote[];
  beforeDuration: number;
  afterDuration: number;
}

type Direction = SceneDirectionAction["reason"];
type Kind = SceneDirectionAction["kind"];
const EPSILON = 1e-7;
const vocabulary = new Map<string, Direction>([
  ["contain", "contain"],
  ["keep proportions", "contain"],
  ["保留比例", "contain"],
  ["縦横比を保持", "contain"],
  ["hero", "hero"],
  ["hero framing", "hero"],
  ["主視覺", "hero"],
  ["主役", "hero"],
  ["hold", "hold"],
  ["keep still", "hold"],
  ["保持靜止", "hold"],
  ["静止", "hold"],
  ["slow push-in", "push-in"],
  ["gentle push-in", "push-in"],
  ["緩慢推近", "push-in"],
  ["慢慢推近", "push-in"],
  ["ゆっくりズームイン", "push-in"],
  ["pan", "pan"],
  ["horizontal pan", "pan"],
  ["水平平移", "pan"],
  ["水平パン", "pan"],
]);

function fail(message: string): never {
  throw new TimelineEditingError(message);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]),
    )
  );
}

function uniqueIds(values: { id: string }[], label: string): void {
  if (
    values.some((value) => !record(value) || !identifier(value.id)) ||
    new Set(values.map((value) => value.id)).size !== values.length
  )
    fail(`${label} IDs must be nonempty and unique.`);
}

function checkArguments(
  document: EditorDocument,
  assets: MediaAsset[],
  options: SceneDirectionOptions,
  context: SceneDirectionContext,
): Map<string, { clip: Clip; track: Track }> {
  if (
    !record(options) ||
    !identifier(options.beatId) ||
    !Array.isArray(options.clipIds) ||
    options.clipIds.length === 0 ||
    !options.clipIds.every(identifier) ||
    (options.replaceExisting !== undefined &&
      typeof options.replaceExisting !== "boolean")
  )
    fail("Provide a beat ID and a nonempty list of clip IDs to direct.");
  if (new Set(options.clipIds).size > 50)
    fail("Scene direction supports at most 50 unique clip IDs per proposal.");
  if (
    !record(context) ||
    !record(context.settings) ||
    !positive(context.settings.width) ||
    !positive(context.settings.height) ||
    !positive(context.settings.frameRate) ||
    (context.maxDuration !== undefined && !positive(context.maxDuration))
  )
    fail(
      "Frame dimensions, frame rate and maximum duration must be positive and finite.",
    );
  if (
    !record(document) ||
    !record(document.story) ||
    !record(document.composition) ||
    !Array.isArray(document.story.beats) ||
    !Array.isArray(document.composition.tracks) ||
    !identifier(document.story.id) ||
    document.composition.storyId !== document.story.id ||
    !Number.isFinite(document.composition.duration) ||
    document.composition.duration < 0 ||
    (document.story.maxDuration !== undefined &&
      !positive(document.story.maxDuration))
  )
    fail("Provide a valid story composition and duration.");
  if (!Array.isArray(assets)) fail("Provide the source asset collection.");
  uniqueIds(assets, "Source asset");
  uniqueIds(document.story.beats, "Beat");
  uniqueIds(document.composition.tracks, "Track");
  const indexed = new Map<string, { clip: Clip; track: Track }>();
  for (const track of document.composition.tracks) {
    if (!Array.isArray(track.clips)) fail("Each track requires clips.");
    for (const clip of track.clips) {
      if (!record(clip) || !identifier(clip.id) || indexed.has(clip.id))
        fail("Clip IDs must be nonempty and unique.");
      if (
        !identifier(clip.assetId) ||
        !Number.isFinite(clip.timelineStart) ||
        clip.timelineStart < 0 ||
        !positive(clip.timelineDuration) ||
        clip.timelineStart + clip.timelineDuration >
          document.composition.duration + EPSILON
      )
        fail(
          `Clip "${clip.id}" must have valid timing within the composition.`,
        );
      indexed.set(clip.id, { clip, track });
    }
  }
  if (!document.story.beats.some((beat) => beat.id === options.beatId))
    fail(`Beat "${options.beatId}" was not found.`);
  for (const id of options.clipIds) {
    const entry = indexed.get(id);
    if (!entry) fail(`Clip "${id}" was not found.`);
    if (entry.clip.beatId !== options.beatId)
      fail(`Clip "${id}" does not belong to the selected beat.`);
  }
  const maximum = Math.min(
    context.maxDuration ?? Infinity,
    document.story.maxDuration ?? Infinity,
  );
  if (document.composition.duration > maximum + EPSILON)
    fail(
      "The film already exceeds its maximum duration. Scene direction preserves timing and cannot make it fit.",
    );
  return indexed;
}

function kindOf(direction: Direction): Kind {
  return direction === "contain" || direction === "hero" ? "layout" : "motion";
}

function parse(
  source: string,
  notes: SceneDirectionNote[],
): Map<Kind, { direction: Direction; evidence: string }> {
  const families = new Map<Kind, Map<Direction, string>>();
  // No substring matching, token guessing or punctuation stripping: prose and
  // negated clauses stay unsupported. The saved source remains the evidence.
  for (const raw of source.split(/[;,\n\r；，、。]+/u)) {
    const clause = raw.trim();
    if (!clause) continue;
    const normalized = clause.toLowerCase().replace(/\s+/gu, " ");
    const direction = vocabulary.get(normalized);
    if (!direction) {
      notes.push({ code: "unsupported", text: clause });
      continue;
    }
    const kind = kindOf(direction);
    const family = families.get(kind) ?? new Map<Direction, string>();
    if (!family.has(direction)) family.set(direction, clause);
    families.set(kind, family);
  }
  const result = new Map<Kind, { direction: Direction; evidence: string }>();
  for (const [kind, family] of families) {
    if (family.size > 1)
      notes.push({ code: "conflict", text: [...family.values()].join("; ") });
    else {
      const [direction, evidence] = [...family][0]!;
      result.set(kind, { direction, evidence });
    }
  }
  return result;
}

function motion(preset: PhotoMotion["preset"], width: number): PhotoMotion {
  const identity = { scale: 1, x: 0, y: 0 };
  return {
    version: 1,
    preset,
    easing: "ease-in-out",
    from: preset === "pan" ? { scale: 1.06, x: -width * 0.02, y: 0 } : identity,
    to:
      preset === "push-in"
        ? { scale: 1.06, x: 0, y: 0 }
        : preset === "pan"
          ? { scale: 1.06, x: width * 0.02, y: 0 }
          : { ...identity },
  };
}

function supported(asset: MediaAsset): boolean {
  return (
    asset.mediaType === "image" &&
    record(asset.state) &&
    !asset.state.rejected &&
    record(asset.metadata) &&
    (!record(asset.metadata["openfilm.preview"]) ||
      asset.metadata["openfilm.preview"].supported !== false)
  );
}

/** Compile saved scene text into detached, sequentially validated presentation edits. */
export function prepareSceneDirection(
  document: EditorDocument,
  assets: MediaAsset[],
  options: SceneDirectionOptions,
  context: SceneDirectionContext,
): SceneDirectionProposal {
  const indexed = checkArguments(document, assets, options, context);
  const beat = document.story.beats.find((beat) => beat.id === options.beatId)!;
  const sourceText = beat.script?.visualDirection ?? "";
  if (typeof sourceText !== "string")
    fail("The saved visual direction must be text.");
  const proposal: SceneDirectionProposal = {
    version: 1,
    beatId: options.beatId,
    sourceText,
    actions: [],
    notes: [],
    beforeDuration: document.composition.duration,
    afterDuration: document.composition.duration,
  };
  const directives = parse(sourceText, proposal.notes);
  const byAsset = new Map(assets.map((asset) => [asset.id, asset]));
  let current = structuredClone(document);
  for (const clipId of new Set(options.clipIds)) {
    const { clip, track } = indexed.get(clipId)!;
    const primary = byAsset.get(clip.assetId);
    const secondary = clip.layout?.secondary
      ? byAsset.get(clip.layout.secondary.assetId)
      : undefined;
    if (!primary || (clip.layout?.secondary && !secondary))
      fail(
        `A source asset for clip "${clipId}" is missing. Relink it before directing.`,
      );
    if (clip.locked || primary.state?.locked || secondary?.state?.locked) {
      proposal.notes.push({ code: "locked", clipId });
      continue;
    }
    const sources = [primary, ...(secondary ? [secondary] : [])];
    if (
      track.type !== "video" ||
      track.timing === "overlay" ||
      sources.some(
        (source) => !supported(source) || !assetDisplayDimensions(source),
      )
    ) {
      proposal.notes.push({ code: "unsupportedMedia", clipId });
      continue;
    }
    const dimensions = Object.fromEntries(
      sources.map((source) => [source.id, assetDisplayDimensions(source)!]),
    );
    // A stable layout-before-motion order means each command is checked against
    // the actual presentation that its predecessor would leave behind.
    for (const kind of ["layout", "motion"] as const) {
      const directive = directives.get(kind);
      if (!directive) continue;
      const existing = clip[kind];
      if (
        (existing !== undefined && !options.replaceExisting) ||
        (kind === "layout" && clip.layout?.secondary)
      ) {
        proposal.notes.push({ code: "manual", clipId, text: kind });
        continue;
      }
      const value: PhotoLayout | PhotoMotion =
        kind === "layout"
          ? {
              version: 1,
              preset: directive.direction as "contain" | "hero",
              ...(clip.layout?.focalPoint
                ? { focalPoint: structuredClone(clip.layout.focalPoint) }
                : {}),
              ...(clip.layout?.protectedRegion
                ? {
                    protectedRegion: structuredClone(
                      clip.layout.protectedRegion,
                    ),
                  }
                : {}),
            }
          : motion(
              directive.direction as PhotoMotion["preset"],
              context.settings.width,
            );
      const command: TimelineCommand =
        kind === "layout"
          ? { type: "presentation", clipId, layout: value as PhotoLayout }
          : { type: "presentation", clipId, motion: value as PhotoMotion };
      let next: EditorDocument;
      try {
        next = applyTimelineCommand(current, assets, command);
        const nextClip = next.composition.tracks
          .flatMap((item) => item.clips)
          .find((item) => item.id === clipId)!;
        const warnings = resolvePhotoPlan(
          nextClip,
          dimensions,
          context.settings,
        ).warnings;
        if (warnings.length) {
          proposal.notes.push({
            code: "unsafe",
            clipId,
            text: warnings.join("; "),
          });
          continue;
        }
        if (next.composition.duration !== proposal.beforeDuration)
          fail("Scene direction must preserve the whole composition duration.");
        const actual = nextClip[kind];
        if (sameValue(existing ?? null, actual ?? null)) {
          proposal.notes.push({ code: "unchanged", clipId, text: kind });
          continue;
        }
        proposal.actions.push({
          id: `${clipId}:${kind}`,
          clipId,
          kind,
          reason: directive.direction,
          evidence: directive.evidence,
          before: structuredClone(existing ?? null),
          after: structuredClone(actual),
          command: structuredClone(command),
        });
      } catch (error) {
        proposal.notes.push({
          code: "unsafe",
          clipId,
          text:
            error instanceof Error
              ? error.message
              : "Presentation could not be validated.",
        });
        continue;
      }
      current = next;
    }
  }
  if (proposal.actions.length > 100)
    fail(
      "Scene direction supports at most 100 presentation commands per proposal.",
    );
  proposal.afterDuration = current.composition.duration;
  return proposal;
}
