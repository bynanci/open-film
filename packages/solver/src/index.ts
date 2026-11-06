import { validatePresetSnapshot } from "@openfilm/core";
import type {
  Clip,
  Composition,
  MediaAsset,
  Story,
  StoryBeat,
  StoryCoverageGroupConstraintV1,
} from "@openfilm/core";
import { scoreAsset } from "@openfilm/story";

const EPSILON = 1e-7;
const capture = (asset: MediaAsset): number =>
  asset.capturedAt && Number.isFinite(Date.parse(asset.capturedAt))
    ? Date.parse(asset.capturedAt)
    : Infinity;

export class CompositionConstraintError extends Error {
  override name = "CompositionConstraintError";
}

function fail(message: string): never {
  throw new CompositionConstraintError(message);
}

interface BeatPlan {
  beat: StoryBeat;
  candidates: MediaAsset[];
  coverageGroups: StoryCoverageGroupConstraintV1[];
  mediaBalance: {
    minImages: number;
    maxImages: number;
    minVideos: number;
    maxVideos: number;
  };
  required: Set<string>;
  selected: MediaAsset[];
  minimum: number;
  maximum: number;
  budget: number;
  orders: string[][];
  chronological: boolean;
}

type StoryVisualMediaKind = "image" | "video";

function visualMediaKind(asset: MediaAsset): StoryVisualMediaKind | undefined {
  if (asset.mediaType === "image") return "image";
  if (asset.mediaType === "video" || asset.mediaType === "360-video")
    return "video";
  return undefined;
}

function mediaCounts(assets: readonly MediaAsset[]): {
  images: number;
  videos: number;
} {
  return assets.reduce(
    (counts, asset) => {
      const kind = visualMediaKind(asset);
      if (kind === "image") counts.images++;
      if (kind === "video") counts.videos++;
      return counts;
    },
    { images: 0, videos: 0 },
  );
}

function mediaBalanceFor(beat: StoryBeat): BeatPlan["mediaBalance"] {
  const balance = {
    minImages: 0,
    maxImages: Infinity,
    minVideos: 0,
    maxVideos: Infinity,
  };
  for (const constraint of beat.constraints ?? []) {
    if (constraint.type !== "media-balance") continue;
    balance.minImages = Math.max(balance.minImages, constraint.minImages ?? 0);
    balance.maxImages = Math.min(
      balance.maxImages,
      constraint.maxImages ?? Infinity,
    );
    balance.minVideos = Math.max(balance.minVideos, constraint.minVideos ?? 0);
    balance.maxVideos = Math.min(
      balance.maxVideos,
      constraint.maxVideos ?? Infinity,
    );
  }
  if (balance.minImages > balance.maxImages)
    fail(`Beat "${beat.title}" has conflicting image media-balance bounds.`);
  if (balance.minVideos > balance.maxVideos)
    fail(`Beat "${beat.title}" has conflicting video media-balance bounds.`);
  return balance;
}

function isWithinMediaMaximum(
  plan: BeatPlan,
  assets: readonly MediaAsset[],
): boolean {
  const counts = mediaCounts(assets);
  return (
    counts.images <= plan.mediaBalance.maxImages &&
    counts.videos <= plan.mediaBalance.maxVideos
  );
}

function mediaMaximumFailure(
  plan: BeatPlan,
  assets: readonly MediaAsset[],
): string | undefined {
  const counts = mediaCounts(assets);
  if (counts.images > plan.mediaBalance.maxImages)
    return `Beat "${plan.beat.title}" has selected image clips above its media maximum; preserve selected or locked choices by raising the maximum or revising the constraint.`;
  if (counts.videos > plan.mediaBalance.maxVideos)
    return `Beat "${plan.beat.title}" has selected video clips above its media maximum; preserve selected or locked choices by raising the maximum or revising the constraint.`;
  return undefined;
}

function unmetCoverageCount(
  plan: BeatPlan,
  group: StoryCoverageGroupConstraintV1,
): number {
  const memberIds = new Set(group.assetIds);
  const selectedCount = plan.selected.filter(
    (asset) => memberIds.has(asset.id) && visualMediaKind(asset) !== undefined,
  ).length;
  return Math.max(0, group.minimumCount - selectedCount);
}

function mediaRequirementNeed(
  plan: BeatPlan,
  kind: StoryVisualMediaKind,
): number {
  const counts = mediaCounts(plan.selected);
  return Math.max(
    0,
    kind === "image"
      ? plan.mediaBalance.minImages - counts.images
      : plan.mediaBalance.minVideos - counts.videos,
  );
}

function capacity(asset: MediaAsset): number {
  return asset.mediaType === "image"
    ? Infinity
    : asset.duration && Number.isFinite(asset.duration) && asset.duration > 0
      ? asset.duration
      : 0;
}

function minimum(asset: MediaAsset): number {
  return Math.min(1, capacity(asset));
}
function preferred(asset: MediaAsset): number {
  return Math.min(asset.mediaType === "image" ? 4 : 6, capacity(asset));
}
function softMaximum(asset: MediaAsset): number {
  return Math.min(12, capacity(asset));
}
function sumCapacity(assets: MediaAsset[]): number {
  return assets.reduce((sum, asset) => sum + capacity(asset), 0);
}
function sumMinimum(assets: MediaAsset[]): number {
  return assets.reduce((sum, asset) => sum + minimum(asset), 0);
}

function duration(
  value: number | undefined,
  label: string,
  zero = false,
): void {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || value < 0 || (!zero && value === 0))
  )
    fail(
      `${label} must be a finite ${zero ? "non-negative" : "positive"} duration in seconds.`,
    );
}

export interface ComposeOptions {
  /** Explicitly permitted echo asset IDs that may appear in multiple beats without disabling overall deduplication. */
  allowEchoAssetIds?: string[];
}

/** Required selections are assigned first; optional candidates never displace them. */
export function compose(
  story: Story,
  assets: MediaAsset[],
  options?: ComposeOptions,
): Composition {
  duration(story.targetDuration, "Story target");
  duration(story.maxDuration, "Story maximum");
  if (
    story.targetDuration !== undefined &&
    story.maxDuration !== undefined &&
    story.targetDuration > story.maxDuration
  )
    fail(
      "Story target exceeds maximum. Lower the target or increase the maximum.",
    );
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  if (byId.size !== assets.length)
    fail(
      "The media collection contains repeated asset IDs; repair the catalog before composing.",
    );
  const requiredOwners = new Map<string, number>();
  const plans: BeatPlan[] = story.beats.map((beat, index) => {
    duration(beat.minDuration, `Beat "${beat.title}" minimum`, true);
    duration(beat.maxDuration, `Beat "${beat.title}" maximum`);
    duration(beat.targetDuration, `Beat "${beat.title}" target`);
    const excluded = new Set(
      beat.constraints?.flatMap((constraint) =>
        constraint.type === "must-exclude" ? constraint.assetIds : [],
      ) ?? [],
    );
    const coverageGroups = (beat.constraints ?? []).filter(
      (constraint): constraint is StoryCoverageGroupConstraintV1 =>
        constraint.type === "coverage-group",
    );
    const mediaBalance = mediaBalanceFor(beat);
    const required = new Set(beat.selectedAssetIds ?? []);
    const orders: string[][] = beat.selectedAssetIds?.length
      ? [beat.selectedAssetIds]
      : [];
    let chronological = false;
    for (const constraint of beat.constraints ?? []) {
      if (constraint.type === "must-include")
        constraint.assetIds.forEach((id) => required.add(id));
      if (constraint.type === "asset-order") {
        constraint.assetIds.forEach((id) => required.add(id));
        orders.push(constraint.assetIds);
      }
      if (constraint.type === "chronological")
        chronological = constraint.enabled !== false;
    }
    for (const id of [
      ...(beat.candidateAssetIds ?? []),
      ...required,
      ...excluded,
      ...coverageGroups.flatMap((group) => group.assetIds),
    ]) {
      if (!byId.has(id))
        fail(
          `Beat "${beat.title}" references missing asset ${id}. Relink the asset or remove the constraint.`,
        );
    }
    for (const id of required) {
      const asset = byId.get(id)!;
      if (excluded.has(id))
        fail(
          `Beat "${beat.title}" both includes and excludes ${asset.name}. Remove one of these constraints.`,
        );
      if (asset.state.rejected)
        fail(
          `Required asset "${asset.name}" is rejected. Unreject it or remove its selection/lock.`,
        );
      if (!capacity(asset))
        fail(
          `Required asset "${asset.name}" has no usable source duration. Inspect or replace the media first.`,
        );
      if (requiredOwners.has(id)) {
        const isAllowedEcho = options?.allowEchoAssetIds?.includes(id);
        if (!isAllowedEcho) {
          fail(
            `Asset "${asset.name}" is required by more than one beat. Keep it in one beat; repeated assets are disabled.`,
          );
        }
      }
      requiredOwners.set(id, index);
    }
    const pool =
      beat.candidateAssetIds === undefined
        ? assets
        : beat.candidateAssetIds.map((id) => byId.get(id)!);
    const candidates = [
      ...new Map(
        pool
          .filter(
            (asset) =>
              !asset.state.rejected &&
              !excluded.has(asset.id) &&
              capacity(asset) > 0,
          )
          .map((asset) => [asset.id, asset]),
      ).values(),
    ];
    const selected = [...required].map((id) => byId.get(id)!);
    const minimumDuration = Math.max(
      beat.minDuration ?? 0,
      sumMinimum(selected),
    );
    const maximumDuration = beat.maxDuration ?? Infinity;
    if (minimumDuration > maximumDuration + EPSILON)
      fail(
        `Beat "${beat.title}" needs at least ${minimumDuration.toFixed(2)}s but allows ${maximumDuration.toFixed(2)}s. Increase its maximum or remove required selections.`,
      );
    const plan: BeatPlan = {
      beat,
      candidates,
      coverageGroups,
      mediaBalance,
      required,
      selected,
      minimum: minimumDuration,
      maximum: maximumDuration,
      budget: minimumDuration,
      orders,
      chronological,
    };
    const maximumFailure = mediaMaximumFailure(plan, selected);
    if (maximumFailure) fail(maximumFailure);
    return plan;
  });
  if (new Set(story.beats.map((beat) => beat.id)).size !== story.beats.length)
    fail("Story beat IDs must be unique.");
  // A library lock is a required inclusion, even if no beat has been selected yet.
  const maximumTotal = story.maxDuration ?? Infinity;
  const locked = assets.filter(
    (candidate) => candidate.state.locked && !requiredOwners.has(candidate.id),
  );
  for (const asset of locked) {
    if (asset.state.rejected)
      fail(
        `Locked asset "${asset.name}" is rejected. Unreject it or unlock it before composing.`,
      );
    if (!capacity(asset))
      fail(
        `Locked asset "${asset.name}" has no usable duration. Inspect it or unlock it.`,
      );
    const eligiblePlans = plans.filter((plan) =>
      plan.candidates.some((candidate) => candidate.id === asset.id),
    );
    const kind = visualMediaKind(asset);
    if (
      kind &&
      eligiblePlans.length > 0 &&
      eligiblePlans.every(
        (plan) => !isWithinMediaMaximum(plan, [...plan.selected, asset]),
      )
    )
      fail(
        `Locked ${kind} source "${asset.name}" exceeds every eligible beat's media-balance maximum. Preserve it by raising the maximum or revising the constraint.`,
      );
  }
  const eligibility = new Map(
    locked.map((asset) => [
      asset.id,
      plans
        .map((plan, index) =>
          plan.candidates.some((candidate) => candidate.id === asset.id)
            ? index
            : -1,
        )
        .filter((index) => index >= 0),
    ]),
  );
  const lockedConstraintPriority = (
    plan: BeatPlan,
    asset: MediaAsset,
  ): number => {
    const memberCount = mediaCounts(plan.selected);
    let priority = 0;
    for (const group of plan.coverageGroups) {
      if (
        group.assetIds.includes(asset.id) &&
        unmetCoverageCount(plan, group) > 0
      ) {
        const alternatives = plan.candidates.filter((candidate) =>
          group.assetIds.includes(candidate.id),
        ).length;
        priority += 1000 + 1 / Math.max(1, alternatives);
      }
    }
    const kind = visualMediaKind(asset);
    if (kind === "image" && memberCount.images < plan.mediaBalance.minImages)
      priority += 100;
    if (kind === "video" && memberCount.videos < plan.mediaBalance.minVideos)
      priority += 100;
    return priority;
  };
  locked.sort(
    (a, b) =>
      eligibility.get(a.id)!.length - eligibility.get(b.id)!.length ||
      minimum(b) - minimum(a) ||
      a.id.localeCompare(b.id),
  );
  let lockVisits = 0;
  function placeLocked(position: number): boolean {
    if (++lockVisits > 50000)
      fail(
        "Locked-media placement reached its search limit. Select each locked asset into a specific beat or narrow candidate pools and try again.",
      );
    const asset = locked[position];
    if (!asset) return true;
    const eligible = [...eligibility.get(asset.id)!].sort((a, b) => {
      const left = plans[a]!,
        right = plans[b]!;
      const priority =
        lockedConstraintPriority(right, asset) -
        lockedConstraintPriority(left, asset);
      if (priority) return priority;
      return (
        Math.max(left.minimum, sumMinimum(left.selected) + minimum(asset)) -
          left.minimum -
          (Math.max(
            right.minimum,
            sumMinimum(right.selected) + minimum(asset),
          ) -
            right.minimum) || a - b
      );
    });
    for (const index of eligible) {
      const plan = plans[index]!;
      const oldMinimum = plan.minimum;
      const nextMinimum = Math.max(
        oldMinimum,
        sumMinimum(plan.selected) + minimum(asset),
      );
      if (
        nextMinimum > plan.maximum + EPSILON ||
        !isWithinMediaMaximum(plan, [...plan.selected, asset]) ||
        plans.reduce((sum, current) => sum + current.minimum, 0) -
          oldMinimum +
          nextMinimum >
          maximumTotal + EPSILON
      )
        continue;
      plan.selected.push(asset);
      plan.required.add(asset.id);
      requiredOwners.set(asset.id, index);
      plan.minimum = nextMinimum;
      plan.budget = nextMinimum;
      // Very large lock collections use scarcity ordering without deep recursion.
      if (locked.length > 1000 || placeLocked(position + 1)) return true;
      plan.selected.pop();
      plan.required.delete(asset.id);
      requiredOwners.delete(asset.id);
      plan.minimum = oldMinimum;
      plan.budget = oldMinimum;
    }
    return false;
  }
  if (locked.length > 1000) {
    for (let index = 0; index < locked.length; index++)
      if (!placeLocked(index))
        fail(
          `Locked asset "${locked[index]!.name}" cannot fit an eligible beat. Assign it explicitly, increase duration bounds, or unlock it.`,
        );
  } else if (!placeLocked(0))
    fail(
      "Locked assets cannot fit their eligible beats and duration bounds. Assign locks to specific beats, increase the maximum duration, or unlock some media.",
    );
  plans.forEach((plan, index) => {
    plan.candidates = plan.candidates.filter(
      (asset) =>
        !requiredOwners.has(asset.id) || requiredOwners.get(asset.id) === index,
    );
    const maximumFailure = mediaMaximumFailure(plan, plan.selected);
    if (maximumFailure) fail(maximumFailure);
  });
  const minimumTotal = plans.reduce((sum, plan) => sum + plan.minimum, 0);
  if (minimumTotal > maximumTotal + EPSILON)
    fail(
      `Required assets and beat minima need ${minimumTotal.toFixed(2)}s, above the story maximum of ${maximumTotal.toFixed(2)}s. Increase the maximum, reduce beat minima, or remove selections/locks.`,
    );
  const used = new Set(requiredOwners.keys());
  const scores = new Map(
    assets.map((asset) => [asset.id, scoreAsset(asset).score]),
  );
  const flexibility = new Map<string, number>();
  for (const plan of plans)
    for (const candidate of plan.candidates)
      flexibility.set(candidate.id, (flexibility.get(candidate.id) ?? 0) + 1);
  const compare = (a: MediaAsset, b: MediaAsset): number =>
    (flexibility.get(a.id) ?? 0) - (flexibility.get(b.id) ?? 0) ||
    scores.get(b.id)! - scores.get(a.id)! ||
    capture(a) - capture(b) ||
    a.id.localeCompare(b.id);
  plans.forEach((plan) => plan.candidates.sort(compare));
  // Backtracking is limited to candidates needed for duration, coverage and media
  // count minima. The scarcest unmet requirement is assigned first.
  let visits = 0;
  type PendingNeed = {
    plan: BeatPlan;
    kind: "coverage" | "image-count" | "video-count" | "duration";
    label: string;
    missing: number;
    candidates: MediaAsset[];
  };
  const canAdd = (plan: BeatPlan, asset: MediaAsset): boolean => {
    if (used.has(asset.id)) return false;
    if (!isWithinMediaMaximum(plan, [...plan.selected, asset])) return false;
    const nextMinimum = Math.max(
      plan.minimum,
      sumMinimum([...plan.selected, asset]),
    );
    if (nextMinimum > plan.maximum + EPSILON) return false;
    return (
      plans.reduce(
        (sum, current) =>
          sum + Math.max(current.minimum, sumMinimum(current.selected)),
        0,
      ) -
        Math.max(plan.minimum, sumMinimum(plan.selected)) +
        nextMinimum <=
      maximumTotal + EPSILON
    );
  };
  const pendingNeeds = (): PendingNeed[] => {
    const needs: PendingNeed[] = [];
    for (const plan of plans) {
      for (const group of plan.coverageGroups) {
        const missing = unmetCoverageCount(plan, group);
        if (!missing) continue;
        const members = new Set(group.assetIds);
        needs.push({
          plan,
          kind: "coverage",
          label: `${group.kind} "${group.label}"`,
          missing,
          candidates: plan.candidates.filter(
            (asset) =>
              members.has(asset.id) && visualMediaKind(asset) !== undefined,
          ),
        });
      }
      for (const kind of ["image", "video"] as const) {
        const missing = mediaRequirementNeed(plan, kind);
        if (!missing) continue;
        needs.push({
          plan,
          kind: kind === "image" ? "image-count" : "video-count",
          label: kind,
          missing,
          candidates: plan.candidates.filter(
            (asset) => visualMediaKind(asset) === kind,
          ),
        });
      }
      if (sumCapacity(plan.selected) + EPSILON < plan.minimum)
        needs.push({
          plan,
          kind: "duration",
          label: "duration",
          missing: 1,
          candidates: plan.candidates,
        });
    }
    return needs
      .map((need) => ({
        ...need,
        candidates: need.candidates.filter((asset) => canAdd(need.plan, asset)),
      }))
      .sort(
        (a, b) =>
          a.candidates.length - b.candidates.length ||
          b.missing - a.missing ||
          plans.indexOf(a.plan) - plans.indexOf(b.plan) ||
          a.kind.localeCompare(b.kind),
      );
  };
  function fillMinima(): boolean {
    if (++visits > 50000)
      fail(
        "Coverage and candidate overlap made constrained selection too complex. Pin selections to individual beats or narrow candidate groups and compose again.",
      );
    const need = pendingNeeds()[0];
    if (!need) return true;
    if (need.candidates.length < need.missing) return false;
    if (
      need.kind === "duration" &&
      sumCapacity([...need.plan.selected, ...need.candidates]) + EPSILON <
        need.plan.minimum
    )
      return false;
    for (const candidate of need.candidates) {
      need.plan.selected.push(candidate);
      used.add(candidate.id);
      if (fillMinima()) return true;
      need.plan.selected.pop();
      used.delete(candidate.id);
    }
    return false;
  }
  if (!fillMinima()) {
    for (const plan of plans) {
      for (const group of plan.coverageGroups) {
        const missing = unmetCoverageCount(plan, group);
        if (missing)
          fail(
            `Coverage for ${group.kind} "${group.label}" needs ${missing} more visual clip(s) in beat "${plan.beat.title}". Add eligible candidates, reduce the minimum, or resolve locks and exclusions.`,
          );
      }
      const images = mediaRequirementNeed(plan, "image");
      if (images)
        fail(
          `Beat "${plan.beat.title}" needs ${images} more image clip(s) for its media-balance minimum. Add eligible photos or reduce the minimum.`,
        );
      const videos = mediaRequirementNeed(plan, "video");
      if (videos)
        fail(
          `Beat "${plan.beat.title}" needs ${videos} more video clip(s) for its media-balance minimum. Add eligible videos or reduce the minimum.`,
        );
    }
    const detail = plans
      .filter((plan) => sumCapacity(plan.selected) < plan.minimum)
      .map((plan) => `"${plan.beat.title}" (${plan.minimum}s minimum)`)
      .join(", ");
    fail(
      `Not enough unique eligible media to satisfy ${detail || "the beat minima"}. Add candidates, inspect source durations, lower minima, or resolve overlapping selections.`,
    );
  }
  // Adding candidates also adds a minimum clip duration; include this in budgets.
  plans.forEach((plan) => {
    plan.minimum = Math.max(plan.minimum, sumMinimum(plan.selected));
    plan.budget = plan.minimum;
  });
  const mandatoryTotal = plans.reduce((sum, plan) => sum + plan.minimum, 0);
  if (mandatoryTotal > maximumTotal + EPSILON)
    fail(
      `Minimum playable clips need ${mandatoryTotal.toFixed(2)}s above the story maximum. Increase the maximum or lower beat minima.`,
    );
  const requested =
    story.targetDuration ??
    plans.reduce(
      (sum, plan) =>
        sum +
        (plan.beat.targetDuration ??
          plan.candidates.reduce(
            (total, asset) => total + preferred(asset),
            0,
          )),
      0,
    );
  let remaining = Math.max(
    0,
    Math.min(requested, maximumTotal) - mandatoryTotal,
  );
  const needs = plans.map((plan) =>
    Math.max(
      0,
      Math.min(
        plan.maximum,
        plan.beat.targetDuration ?? requested / Math.max(1, plans.length),
      ) - plan.minimum,
    ),
  );
  const totalNeeds = needs.reduce((sum, need) => sum + need, 0);
  if (totalNeeds)
    plans.forEach((plan, index) => {
      const addition = Math.min(
        needs[index]!,
        (remaining * needs[index]!) / totalNeeds,
      );
      plan.budget += addition;
    });
  remaining -= plans.reduce((sum, plan) => sum + plan.budget - plan.minimum, 0);
  for (const plan of plans) {
    if (remaining <= EPSILON) break;
    const addition = Math.min(remaining, plan.maximum - plan.budget);
    plan.budget += addition;
    remaining -= addition;
  }
  for (const plan of plans) {
    let selectedPreference = plan.selected.reduce(
      (sum, asset) => sum + preferred(asset),
      0,
    );
    let selectedMinimum = sumMinimum(plan.selected);
    for (const candidate of plan.candidates) {
      if (used.has(candidate.id)) continue;
      if (selectedPreference >= plan.budget - EPSILON) break;
      if (!isWithinMediaMaximum(plan, [...plan.selected, candidate])) continue;
      if (selectedMinimum + minimum(candidate) > plan.budget + EPSILON)
        continue;
      plan.selected.push(candidate);
      used.add(candidate.id);
      selectedPreference += preferred(candidate);
      selectedMinimum += minimum(candidate);
    }
  }
  const compositionId = globalThis.crypto.randomUUID();
  const video: Clip[] = [],
    audio: Clip[] = [];
  let position = 0;
  for (const plan of plans) {
    const selected = orderedAssets(plan);
    if (!selected.length) continue;
    const softCapacity = selected.reduce(
      (sum, asset) => sum + softMaximum(asset),
      0,
    );
    const total = Math.max(plan.minimum, Math.min(plan.budget, softCapacity));
    const lengths = selected.map(minimum);
    let extra = total - lengths.reduce((sum, length) => sum + length, 0);
    const caps = selected.map((asset) =>
      total > softCapacity ? capacity(asset) : softMaximum(asset),
    );
    // Prefer equal pacing while respecting short source media and all hard minima.
    while (extra > EPSILON) {
      const free = lengths
        .map((length, index) => (caps[index]! > length + EPSILON ? index : -1))
        .filter((index) => index >= 0);
      if (!free.length)
        fail(
          `Beat "${plan.beat.title}" cannot reach its minimum with the selected source durations. Add media or reduce its minimum.`,
        );
      const share = extra / free.length;
      for (const index of free) {
        const addition = Math.min(share, caps[index]! - lengths[index]!);
        lengths[index]! += addition;
        extra -= addition;
      }
    }
    selected.forEach((asset, index) => {
      const length = lengths[index]!;
      const clip: Clip = {
        id: `${compositionId}:clip:${video.length + audio.length + 1}`,
        assetId: asset.id,
        beatId: plan.beat.id,
        sourceIn: 0,
        sourceOut: length,
        timelineStart: position,
        timelineDuration: length,
      };
      (asset.mediaType === "audio" ? audio : video).push(clip);
      position += length;
    });
  }
  if (position > maximumTotal + EPSILON)
    fail(
      "Composition exceeded its duration budget. Reduce beat targets and try again.",
    );
  return {
    id: compositionId,
    storyId: story.id,
    ...(story.presetSnapshot
      ? {
          storyPresetSnapshot: validatePresetSnapshot(
            story.presetSnapshot,
            "story",
          ),
        }
      : {}),
    duration: position,
    tracks: [
      ...(video.length
        ? [
            {
              id: `${compositionId}:video`,
              type: "video" as const,
              clips: video,
            },
          ]
        : []),
      ...(audio.length
        ? [
            {
              id: `${compositionId}:audio`,
              type: "audio" as const,
              clips: audio,
            },
          ]
        : []),
    ],
  };
}

function orderedAssets(plan: BeatPlan): MediaAsset[] {
  const byId = new Map(plan.selected.map((asset) => [asset.id, asset]));
  const edges = new Map<string, Set<string>>();
  const incoming = new Map(plan.selected.map((asset) => [asset.id, 0]));
  const addEdge = (from: string, to: string): void => {
    if (from === to)
      fail(
        `Beat "${plan.beat.title}" repeats an asset in an ordering constraint. Remove the repeated ID.`,
      );
    if (!byId.has(from) || !byId.has(to)) return;
    const next = edges.get(from) ?? new Set<string>();
    if (!next.has(to)) {
      next.add(to);
      incoming.set(to, incoming.get(to)! + 1);
    }
    edges.set(from, next);
  };
  for (const order of plan.orders)
    for (let i = 1; i < order.length; i++) addEdge(order[i - 1]!, order[i]!);
  const chronological = [...plan.selected].sort(
    (a, b) => capture(a) - capture(b) || a.id.localeCompare(b.id),
  );
  if (plan.chronological)
    for (let i = 1; i < chronological.length; i++)
      addEdge(chronological[i - 1]!.id, chronological[i]!.id);
  const result: MediaAsset[] = [];
  const ready = plan.selected.filter((asset) => !incoming.get(asset.id));
  while (ready.length) {
    ready.sort((a, b) => capture(a) - capture(b) || a.id.localeCompare(b.id));
    const asset = ready.shift()!;
    result.push(asset);
    for (const next of edges.get(asset.id) ?? []) {
      incoming.set(next, incoming.get(next)! - 1);
      if (!incoming.get(next)) ready.push(byId.get(next)!);
    }
  }
  if (result.length !== plan.selected.length)
    fail(
      `Beat "${plan.beat.title}" has conflicting asset orders or chronology. Remove or reconcile the ordering constraints.`,
    );
  return result;
}

export {
  applyTimelineCommand,
  applyTimelineCommandInBatch,
  suggestShortening,
  prepareShorteningPlan,
  shorteningCommands,
  TimelineEditingError,
} from "./editing.js";
export type {
  EditorDocument,
  TimelineCommand,
  ShorteningSuggestion,
  ShorteningSuggestionPreview,
  PreparedShorteningPlan,
} from "./editing.js";

export { prepareSceneDirection } from "./scene-direction.js";
export type {
  SceneDirectionOptions,
  SceneDirectionContext,
  SceneDirectionAction,
  SceneDirectionNote,
  SceneDirectionProposal,
} from "./scene-direction.js";

export {
  applyGraphicSceneAgentActions,
  graphicSceneNodeLockState,
  parseGraphicSceneAgentOperations,
  parseLocalGraphicSceneInstruction,
  prepareGraphicSceneAgentProposal,
} from "./graphic-scene-agent.js";
export type {
  GraphicSceneAgentAction,
  GraphicSceneAgentConflict,
  GraphicSceneAgentField,
  GraphicSceneAgentOperation,
  PreparedGraphicSceneAgentProposal,
} from "./graphic-scene-agent.js";

export * from "./user-overrides.js";

export * from "./pinned-placement.js";

export {
  analyzeContinuity,
  applyContinuityOverrides,
  type ContinuityAnalysisOptions,
} from "./continuity.js";

export {
  buildMicroPreviewProposal,
  sampleMicroPreviewFrame,
  type BuildMicroPreviewOptions,
} from "./micro-preview.js";

export {
  projectClipRhythmLandmarks,
  buildRhythmSnapProposal,
  applyRhythmSnapProposalToDocument,
  applyRhythmSnap,
  type BuildRhythmSnapOptions,
} from "./rhythm.js";

export { validateAudioEdit } from "./audio-timing.js";
