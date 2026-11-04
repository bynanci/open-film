import type {
  MediaAsset,
  ProjectContentLocale,
  ScoreResult,
  Story,
  StoryContext,
} from "@openfilm/core";
import type { StoryTemplate } from "@openfilm/plugin-sdk";
import {
  genericBeatText,
  genericStoryTitle,
  resolveProjectContentLocale,
} from "./content.js";

export * from "./content.js";
export * from "./scene-plan.js";
export * from "./story-arcs.js";
export * from "./graphic-templates.js";
export * from "./story-graph-layout.js";
export * from "./story-graph-connections.js";
export * from "./story-planner.js";
export * from "./preset-story-plan.js";

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const date = (asset: MediaAsset): number => {
  if (!asset.capturedAt) return Infinity;
  const timestamp = Date.parse(asset.capturedAt);
  return Number.isFinite(timestamp) ? timestamp : Infinity;
};

interface HashOwners {
  firstId: string;
  secondId?: string;
}

interface AssetScoringIndex {
  contentHashOwners: Map<string, HashOwners>;
  perceptualHashOwners: Map<string, HashOwners>;
  chronologicalEdgeIds: Set<string>;
  eventAssetIds?: Set<string>;
}

function addHashOwner(
  owners: Map<string, HashOwners>,
  hash: string | undefined,
  assetId: string,
) {
  if (!hash) return;
  const current = owners.get(hash);
  if (!current) owners.set(hash, { firstId: assetId });
  else if (current.firstId !== assetId && current.secondId === undefined)
    current.secondId = assetId;
}

function hasOtherHashOwner(
  owners: Map<string, HashOwners>,
  hash: string | undefined,
  assetId: string,
): boolean {
  if (!hash) return false;
  const current = owners.get(hash);
  return (
    !!current && (current.firstId !== assetId || current.secondId !== undefined)
  );
}

function createAssetScoringIndex(context: StoryContext): AssetScoringIndex {
  const contentHashOwners = new Map<string, HashOwners>();
  const perceptualHashOwners = new Map<string, HashOwners>();
  const dated = [] as { id: string; timestamp: number }[];
  for (const asset of context.assets ?? []) {
    addHashOwner(contentHashOwners, asset.contentHash, asset.id);
    addHashOwner(perceptualHashOwners, asset.perceptualHash, asset.id);
    const timestamp = date(asset);
    if (Number.isFinite(timestamp)) dated.push({ id: asset.id, timestamp });
  }
  dated.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  const chronologicalEdgeIds = new Set<string>();
  if (dated.length) {
    chronologicalEdgeIds.add(dated[0]!.id);
    chronologicalEdgeIds.add(dated.at(-1)!.id);
  }
  return {
    contentHashOwners,
    perceptualHashOwners,
    chronologicalEdgeIds,
    ...(context.eventAssetIds
      ? { eventAssetIds: new Set(context.eventAssetIds) }
      : {}),
  };
}

function scoreAssetWithIndex(
  asset: MediaAsset,
  context: StoryContext,
  index: AssetScoringIndex,
): ScoreResult {
  if (asset.state.rejected)
    return {
      score: 0,
      factors: [
        {
          id: "eligibility",
          score: 0,
          reason: "The asset is rejected and cannot be selected.",
        },
      ],
    };
  const capturedAt = date(asset);
  const pixels = asset.dimensions
    ? asset.dimensions.width * asset.dimensions.height
    : undefined;
  const technical =
    pixels && Number.isFinite(pixels) && pixels > 0
      ? clamp(pixels / (1920 * 1080))
      : 0.5;
  const duplicate =
    hasOtherHashOwner(index.contentHashOwners, asset.contentHash, asset.id) ||
    hasOtherHashOwner(
      index.perceptualHashOwners,
      asset.perceptualHash,
      asset.id,
    );
  const edge = index.chronologicalEdgeIds.has(asset.id);
  const preferred = context.preferredTags ?? [];
  const matching = preferred.filter((tag) => asset.tags.includes(tag));
  const inPreferredEvent = index.eventAssetIds?.has(asset.id) ?? false;
  const factors = [
    {
      id: "user-rating",
      score: asset.rating === undefined ? 0.5 : clamp(asset.rating / 5),
      reason:
        asset.rating === undefined
          ? "No rating supplied; neutral preference."
          : `User rating ${asset.rating} of 5.`,
    },
    {
      id: "favorite",
      score: asset.state.favorite ? 1 : 0.5,
      reason: asset.state.favorite
        ? "Marked as a favorite."
        : "No favorite preference.",
    },
    {
      id: "technical-quality",
      score: technical,
      reason: pixels
        ? `${asset.dimensions!.width} × ${asset.dimensions!.height} pixels; resolution compared with full HD.`
        : "Dimensions unavailable; no quality inferred.",
    },
    {
      id: "uniqueness",
      score: duplicate ? 0.25 : 1,
      reason: duplicate
        ? "Another candidate has the same content or perceptual fingerprint."
        : "No identical fingerprint in the supplied candidates.",
    },
    {
      id: "chronological-importance",
      score: Number.isFinite(capturedAt)
        ? (edge ? 1 : 0.6) * (asset.capturedAtConfidence ?? 1)
        : 0.3,
      reason: !Number.isFinite(capturedAt)
        ? "Capture date unknown."
        : edge
          ? "At a chronological boundary of the supplied collection."
          : "Within the collection chronology.",
    },
    {
      id: "tag-relevance",
      score: preferred.length ? matching.length / preferred.length : 0.5,
      reason: preferred.length
        ? `Matches ${matching.length} of ${preferred.length} preferred tags.`
        : "No preferred tags supplied.",
    },
    {
      id: "event-relevance",
      score: context.eventAssetIds ? (inPreferredEvent ? 1 : 0) : 0.5,
      reason: context.eventAssetIds
        ? inPreferredEvent
          ? "Included in the preferred event."
          : "Outside the preferred event."
        : "No preferred event supplied.",
    },
  ];
  const defaults: Record<string, number> = {
    "user-rating": 0.3,
    favorite: 0.1,
    "technical-quality": 0.2,
    uniqueness: 0.15,
    "chronological-importance": 0.1,
    "tag-relevance": 0.1,
    "event-relevance": 0.05,
  };
  let total = 0,
    weightSum = 0;
  for (const factor of factors) {
    const weight = context.weights?.[factor.id] ?? defaults[factor.id]!;
    if (!Number.isFinite(weight) || weight < 0)
      throw new Error(
        `Scoring weight ${factor.id} must be a finite non-negative number.`,
      );
    total += clamp(factor.score) * weight;
    weightSum += weight;
  }
  if (!weightSum)
    throw new Error("At least one scoring factor must have a positive weight.");
  return { score: clamp(total / weightSum), factors };
}

/** Prepare collection-wide evidence once when scoring several assets together. */
export function createAssetScorer(
  context: StoryContext = {},
): (asset: MediaAsset) => ScoreResult {
  const index = createAssetScoringIndex(context);
  return (asset) => scoreAssetWithIndex(asset, context, index);
}

/** Score one asset; reuse createAssetScorer when scoring a collection. */
export function scoreAsset(
  asset: MediaAsset,
  context: StoryContext = {},
): ScoreResult {
  return scoreAssetWithIndex(asset, context, createAssetScoringIndex(context));
}

export interface CreateStoryOptions {
  template?: StoryTemplate;
  targetDuration?: number;
  maxDuration?: number;
  contentLocale?: ProjectContentLocale;
}

export function createStory(
  title: string,
  assets: MediaAsset[],
  options: CreateStoryOptions = {},
): Story {
  const contentLocale = resolveProjectContentLocale(options.contentLocale);
  const available = assets
    .filter((asset) => !asset.state.rejected)
    .sort((a, b) => date(a) - date(b) || a.id.localeCompare(b.id));
  for (const [name, value] of Object.entries({
    targetDuration: options.targetDuration,
    maxDuration: options.maxDuration,
  })) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0))
      throw new Error(`${name} must be a finite positive duration in seconds.`);
  }
  if (
    options.targetDuration !== undefined &&
    options.maxDuration !== undefined &&
    options.targetDuration > options.maxDuration
  )
    throw new Error(
      "The target duration exceeds the maximum; lower the target or increase the maximum.",
    );
  if (options.template)
    return options.template.create({
      title,
      targetDuration: options.targetDuration,
      maxDuration: options.maxDuration,
      assetIds: available.map((asset) => asset.id),
      contentLocale,
    });
  const target =
    options.targetDuration ??
    Math.min(available.length * 4 || 4, options.maxDuration ?? Infinity);
  const count = Math.min(3, Math.max(1, available.length));
  const keys =
    count === 3
      ? ["story.opening", "story.development", "story.resolution"]
      : count === 2
        ? ["story.opening", "story.resolution"]
        : ["story.sequence"];
  const weights =
    count === 3 ? [0.2, 0.6, 0.2] : count === 2 ? [0.5, 0.5] : [1];
  const id = globalThis.crypto.randomUUID();
  return {
    id,
    title: title.trim() || genericStoryTitle(contentLocale),
    targetDuration: target,
    maxDuration: options.maxDuration,
    beats: keys.map((key, index) => ({
      id: `${id}:beat:${index + 1}`,
      title: genericBeatText(key, contentLocale)!.title,
      templateBeatKey: key,
      titleSource: "template",
      targetDuration: target * weights[index]!,
      minDuration: 0,
      candidateAssetIds: available
        .slice(
          Math.floor((index * available.length) / count),
          Math.floor(((index + 1) * available.length) / count),
        )
        .map((asset) => asset.id),
    })),
  };
}
