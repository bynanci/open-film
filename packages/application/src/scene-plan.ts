import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ApplicationError,
  validateProject,
  validateStory,
  type Composition,
  type MediaAsset,
  type Story,
} from "@openfilm/core";
import { previewIssue } from "@openfilm/media";
import { createSceneStory } from "@openfilm/story";
import { compose } from "@openfilm/solver";
import type { OpenFilmApplication } from "./index.js";
import { isInside } from "./path-safety.js";

export interface ScenePlanOptions {
  title?: string;
  groupBy: "category" | "chronology";
  targetDuration: number;
  maxDuration: number;
  brief?: string;
  assetIds?: string[];
  transition?: "cut" | "crossfade";
}

export interface ScenePlan {
  story: Story;
  /** Informational preview only: acceptance always solves the edited story again. */
  composition: Composition;
  sourceAssetIds: string[];
  sourceSignature: string;
  transition: "cut" | "crossfade";
  excludedAudioCount: number;
}

/** Acceptance carries authored decisions, not the informational solved preview. */
export type ScenePlanAcceptance = Pick<
  ScenePlan,
  "story" | "sourceAssetIds" | "sourceSignature" | "transition"
>;

function invalid(detail: string, status = 400): never {
  throw new ApplicationError("story.invalid", detail, status);
}

/** Stable object-key ordering makes a receipt survive JSON transport and reopen. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function sourceScope(
  app: OpenFilmApplication,
  requested?: string[],
): MediaAsset[] {
  if (
    requested !== undefined &&
    (!Array.isArray(requested) ||
      requested.some(
        (id) => typeof id !== "string" || !id || id.length > 256,
      ) ||
      requested.length > 2000)
  )
    invalid("Choose at most 2000 valid media IDs for the scene plan.");
  const ids = requested === undefined ? new Set<string>() : new Set(requested);
  if (requested === undefined && app.catalog.countAssets() > 2000)
    throw new ApplicationError(
      "story.scopeTooLarge",
      "Choose an explicit scene-plan scope for libraries above 2000 assets; locked assets are always included.",
    );
  if (app.catalog.countAssets({ locked: true }) > 2000)
    throw new ApplicationError(
      "story.scopeTooLarge",
      "More than 2000 assets are locked. Unlock assets before planning scenes.",
    );
  for (const asset of app.catalog.listAssets({
    limit: 2000,
    ...(requested === undefined ? {} : { locked: true }),
  }))
    ids.add(asset.id);
  if (ids.size > 2000)
    throw new ApplicationError(
      "story.scopeTooLarge",
      "The scene plan and locked assets exceed 2000 candidates. Reduce the scope or unlock assets.",
    );
  return [...ids].sort().map((id) => {
    const asset = app.catalog.getAsset(id);
    if (!asset)
      throw new ApplicationError(
        "story.planStale",
        `Scene-plan media was removed: ${id}.`,
        409,
      );
    return asset;
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Only fields currently consumed by rendering; never hash complete probe payloads. */
function renderEvidence(asset: MediaAsset) {
  const streams = record(asset.metadata["openfilm.ffprobe"])?.streams;
  const audio =
    streams === undefined || streams === null
      ? false
      : !Array.isArray(streams) || streams.some((stream) => !record(stream))
        ? "invalid-streams"
        : streams.some((stream) => record(stream)?.codec_type === "audio");
  const color = record(asset.metadata["openfilm.color"]);
  const text = (key: string) => {
    const value = color?.[key];
    return typeof value === "string"
      ? value
      : value === undefined
        ? null
        : "invalid-color-field";
  };
  return {
    audio,
    // Match hdrToneMapFilter's early return: SDR rendering never reads these
    // color fields. The separately bound hdr flag still catches mode changes.
    color: asset.hdr
      ? {
          state:
            asset.metadata["openfilm.color"] === undefined
              ? "absent"
              : color
                ? "record"
                : "invalid",
          transfer: text("transfer"),
          primaries: text("primaries"),
          matrix: text("matrix"),
        }
      : null,
  };
}

function sourceSignature(
  app: OpenFilmApplication,
  assets: MediaAsset[],
): string {
  return digest({
    version: 3,
    projectId: app.project.id,
    contentLocale: app.project.projectContentLocale ?? "en-US",
    // Bind selection and playback evidence without embedding large analysis
    // documents or incidental derived-reference bookkeeping in the signature.
    assets: assets.map((asset) => {
      const source = app.getSourceAsset(asset.id) ?? asset;
      const managed = record(asset.metadata["openfilm.managedSource"]);
      const relativePath = managed?.relativePath;
      const path =
        typeof relativePath === "string"
          ? resolve(app.directory, relativePath)
          : undefined;
      const root = join(app.directory, "sources");
      const ownedManaged =
        typeof relativePath === "string" &&
        relativePath.startsWith("sources/") &&
        !relativePath.includes("\\") &&
        managed?.uri === asset.uri &&
        path !== undefined &&
        path !== root &&
        isInside(root, path) &&
        source.uri === pathToFileURL(path).href;
      return {
        id: asset.id,
        uri: source.uri,
        name: asset.name,
        mediaType: asset.mediaType,
        capturedAt: asset.capturedAt,
        capturedAtConfidence: asset.capturedAtConfidence,
        duration: asset.duration,
        dimensions: asset.dimensions,
        frameRate: asset.frameRate,
        codec: asset.codec,
        hdr: asset.hdr,
        colorSpace: asset.colorSpace,
        contentHash: asset.contentHash,
        perceptualHash: asset.perceptualHash,
        tags: asset.tags,
        rating: asset.rating,
        state: asset.state,
        previewIssue: previewIssue(asset) ?? null,
        render: renderEvidence(asset),
        // A normal open repairs managed absolute roots/library fallbacks. A
        // read-only preview binds the same resolved URI plus owned relative
        // identity, so those repairs do not masquerade as a source change.
        reference: ownedManaged
          ? { managedRelativePath: relativePath }
          : asset.metadata["openfilm.reference"],
        managedSource: managed
          ? {
              relativePath,
              uri: ownedManaged ? source.uri : managed.uri,
            }
          : undefined,
        filesystem: asset.metadata["openfilm.filesystem"],
      };
    }),
  });
}

function renderable(
  assets: MediaAsset[],
  explicitIds?: string[],
): MediaAsset[] {
  const explicit = new Set(explicitIds);
  for (const asset of assets) {
    const issue = previewIssue(asset);
    if (asset.mediaType === "audio" && asset.state.locked)
      invalid(
        `Locked audio "${asset.name}" cannot be placed in a visual scene plan. Unlock it only if you want to exclude it from this visual plan.`,
      );
    if (issue && (asset.state.locked || explicit.has(asset.id)))
      throw new ApplicationError(
        "media.unsupported",
        `${asset.name}: ${issue}`,
        422,
        { name: asset.name },
      );
    if (asset.state.locked && asset.state.rejected)
      invalid(
        `Locked media "${asset.name}" is rejected. Unreject it or unlock it before planning.`,
      );
  }
  const usable = assets.filter(
    (asset) =>
      ["image", "video"].includes(asset.mediaType) &&
      !asset.state.rejected &&
      !previewIssue(asset),
  );
  if (!usable.length)
    throw new ApplicationError(
      "story.mediaRequired",
      "Add supported photos or videos before planning scenes.",
    );
  return usable;
}

function transitionMode(value: unknown): "cut" | "crossfade" {
  if (value === undefined || value === "cut") return "cut";
  if (value === "crossfade") return "crossfade";
  return invalid("Choose cut or crossfade for the scene plan.");
}

function solvePlan(
  story: Story,
  assets: MediaAsset[],
  transition: ScenePlan["transition"],
): Composition {
  const composition = compose(story, assets);
  if (
    !composition.tracks.some(
      (track) => track.type === "video" && track.clips.length,
    )
  )
    invalid(
      "The scene plan has no playable photos or videos. Increase its duration or choose media with usable timing.",
    );
  const playableBeatIds = new Set(
    composition.tracks
      .filter((track) => track.type === "video")
      .flatMap((track) => track.clips)
      .filter((clip) => clip.timelineDuration > 0)
      .map((clip) => clip.beatId),
  );
  const emptyScene = story.beats.find((beat) => !playableBeatIds.has(beat.id));
  if (emptyScene)
    invalid(
      `Scene "${emptyScene.title}" has no playable photos or videos. Choose usable media, remove conflicting exclusions, or increase its duration before accepting.`,
    );
  if (transition === "crossfade")
    for (const track of composition.tracks) {
      if (track.type !== "video") continue;
      track.clips.forEach((clip, index) => {
        const previous = track.clips[index - 1];
        if (
          previous &&
          Math.abs(
            previous.timelineStart +
              previous.timelineDuration -
              clip.timelineStart,
          ) < 1e-7
        )
          clip.transition = {
            type: "crossfade",
            duration: Math.min(
              0.5,
              clip.timelineDuration / 2,
              previous.timelineDuration / 2,
            ),
          };
      });
    }
  return composition;
}

function receiptId(
  plan: Pick<
    ScenePlan,
    "story" | "sourceAssetIds" | "sourceSignature" | "transition"
  >,
): string {
  return `scene-plan-${digest(plan)}`;
}

function identifyComposition(
  composition: Composition,
  id: string,
): Composition {
  composition.id = id;
  composition.tracks.forEach((track, index) => {
    track.id = `${id}:track:${index}`;
    track.clips.forEach((clip, clipIndex) => {
      clip.id = `${id}:track:${index}:clip:${clipIndex}`;
    });
  });
  return composition;
}

export function previewScenePlan(
  app: OpenFilmApplication,
  options: ScenePlanOptions,
): ScenePlan {
  if (!options || typeof options !== "object" || Array.isArray(options))
    invalid("Scene-plan options are required.");
  const assets = sourceScope(app, options.assetIds);
  const usable = renderable(assets, options.assetIds);
  const transition = transitionMode(options.transition);
  const story = createSceneStory(options.title ?? app.project.title, usable, {
    groupBy: options.groupBy,
    targetDuration: options.targetDuration,
    maxDuration: options.maxDuration,
    contentLocale: app.project.projectContentLocale,
    brief: options.brief,
  });
  const plan: ScenePlan = {
    story,
    composition: solvePlan(story, usable, transition),
    sourceAssetIds: assets.map((asset) => asset.id),
    sourceSignature: sourceSignature(app, assets),
    transition,
    excludedAudioCount: assets.filter((asset) => asset.mediaType === "audio")
      .length,
  };
  identifyComposition(
    plan.composition,
    receiptId({
      story,
      sourceAssetIds: plan.sourceAssetIds,
      sourceSignature: plan.sourceSignature,
      transition,
    }),
  );
  validateProject({
    ...app.project,
    stories: [...app.project.stories, story],
    timelines: [...app.project.timelines, plan.composition],
  });
  return structuredClone(plan);
}

export function acceptScenePlan(
  app: OpenFilmApplication,
  input: ScenePlanAcceptance,
  save: () => void,
): { story: Story; composition: Composition } {
  if (!input || typeof input !== "object" || Array.isArray(input))
    invalid("A scene plan is required.");
  if (
    !Array.isArray(input.sourceAssetIds) ||
    !input.sourceAssetIds.length ||
    typeof input.sourceSignature !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.sourceSignature)
  )
    invalid(
      "The scene plan has no valid source binding. Generate a new preview.",
    );
  // Match the normal Story editor: an emptied optional intent is absence,
  // while user-authored script text (including empty strings) stays exact.
  const draft = structuredClone(input.story);
  if (draft && Array.isArray(draft.beats))
    for (const beat of draft.beats)
      if (beat && typeof beat.intent === "string" && !beat.intent.trim())
        delete beat.intent;
  const story = validateStory(draft);
  if (
    story.beats.length > 30 ||
    !story.beats.length ||
    story.targetDuration === undefined ||
    story.maxDuration === undefined
  )
    invalid(
      "A scene plan requires 1–30 scenes and explicit target and maximum durations.",
    );
  const transition = transitionMode(input.transition);
  const sourceAssetIds = [...new Set(input.sourceAssetIds)].sort();
  if (
    sourceAssetIds.length !== input.sourceAssetIds.length ||
    sourceAssetIds.length > 2000
  )
    invalid("The scene-plan source scope is invalid.");
  const request = {
    story,
    sourceAssetIds,
    sourceSignature: input.sourceSignature,
    transition,
  };
  const id = receiptId(request);
  const savedStory = app.project.stories.find((item) => item.id === story.id);
  const savedComposition = app.project.timelines.find((item) => item.id === id);
  if (savedStory || savedComposition) {
    if (
      !savedStory ||
      !savedComposition ||
      savedComposition.storyId !== story.id ||
      canonical(savedStory) !== canonical(story)
    )
      throw new ApplicationError(
        "story.planConflict",
        "This scene plan was already accepted with different content. Generate a new draft to create another film.",
        409,
      );
    return structuredClone({
      story: savedStory,
      composition: savedComposition,
    });
  }
  const assets = sourceScope(app, sourceAssetIds);
  if (sourceSignature(app, assets) !== input.sourceSignature)
    throw new ApplicationError(
      "story.planStale",
      "Media, classification, locks or film language changed after this preview. Generate a new scene plan before accepting.",
      409,
    );
  const usable = renderable(assets);
  const usableIds = new Set(usable.map((asset) => asset.id));
  for (const beat of story.beats) {
    if (!beat.candidateAssetIds)
      invalid("Each scene must retain an explicit candidate scope.");
    for (const assetId of [
      ...beat.candidateAssetIds,
      ...(beat.selectedAssetIds ?? []),
      ...(beat.constraints ?? []).flatMap((constraint) =>
        "assetIds" in constraint ? constraint.assetIds : [],
      ),
    ])
      if (!usableIds.has(assetId))
        invalid(
          `Scene "${beat.title}" references media outside its supported preview scope: ${assetId}.`,
        );
  }
  const composition = identifyComposition(
    solvePlan(story, usable, transition),
    id,
  );
  const previous = app.project;
  const next = validateProject({
    ...previous,
    stories: [...previous.stories, story],
    timelines: [...previous.timelines, composition],
  });
  try {
    app.project = next;
    save();
  } catch (error) {
    app.project = previous;
    throw error;
  }
  return structuredClone({ story, composition });
}
