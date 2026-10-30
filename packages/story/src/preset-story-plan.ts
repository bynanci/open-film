// SPDX-License-Identifier: Apache-2.0
import {
  ApplicationError,
  validatePresetSnapshot,
  type PresetSnapshot,
  type Story,
  type StoryPlan,
  type Composition,
  type ProjectContentLocale,
} from "@openfilm/core";
function conflict(message: string): never {
  throw new ApplicationError("presets.conflict", message, 409);
}
export function compilePresetStoryPlan(
  basePlan: StoryPlan,
  sourceStory: Story,
  snapshot: PresetSnapshot<"story">,
  bindings: { recipeBeatKey: string; beatId: string }[],
  locale: ProjectContentLocale,
): StoryPlan {
  const recipe = validatePresetSnapshot(snapshot, "story").recipe;
  if (
    basePlan.path.isAmbiguous ||
    basePlan.path.cycleDetected?.length ||
    basePlan.path.unresolvedAlternatives?.length ||
    basePlan.conflicts.length
  )
    conflict("Resolve authored StoryPlan conflicts before applying a preset.");
  if (
    basePlan.scenes.length !== recipe.beats.length ||
    sourceStory.beats.length !== recipe.beats.length ||
    bindings.length !== recipe.beats.length ||
    new Set(basePlan.scenes.map((s) => s.sceneId)).size !==
      basePlan.scenes.length
  )
    conflict("Map every recipe beat to every authored beat exactly once.");
  const keys = new Set<string>(),
    ids = new Set<string>();
  const plan = structuredClone(basePlan),
    total = recipe.beats.reduce((sum, b) => sum + b.weight, 0);
  for (let i = 0; i < recipe.beats.length; i++) {
    const r = recipe.beats[i]!,
      binding = bindings[i]!,
      scene = plan.scenes[i]!;
    if (
      binding.recipeBeatKey !== r.key ||
      binding.beatId !== scene.beatId ||
      keys.has(binding.recipeBeatKey) ||
      ids.has(binding.beatId)
    )
      conflict(
        "Preset bindings must be a bijection in the authored scene order.",
      );
    keys.add(binding.recipeBeatKey);
    ids.add(binding.beatId);
    const source = sourceStory.beats.find((b) => b.id === scene.beatId);
    if (!source)
      conflict("A preset scene must refer to an existing authored beat.");
    if (scene.gaps?.missingAssets?.length || !scene.assets.length)
      conflict(
        "Assign existing media to every authored scene before preset review.",
      );
    const assigned = new Set(scene.assets.map((a) => a.assetId));
    if (assigned.size !== scene.assets.length)
      conflict(
        "Repeated media within a scene has no distinct solver occurrence mapping.",
      );
    // A beat/scene identity owns an occurrence. Asset identity alone cannot
    // recover duplicate graph assignments that the generic planner deduplicates.
    if (sourceStory.graph) {
      const graph = sourceStory.graph;
      const nodes = graph.nodes.filter(
        (n) => n.type === "beat" && n.beatId === scene.beatId,
      );
      if (nodes.length !== 1)
        conflict(
          "Every preset scene needs one unambiguous authored beat node.",
        );
      const occurrences = new Set<string>();
      for (const edge of graph.edges.filter(
        (e) =>
          e.from === nodes[0]!.id &&
          (e.type === "supports" || e.type === "contains"),
      )) {
        const target = graph.nodes.find((n) => n.id === edge.to);
        if (!target)
          conflict(
            "An authored scene assignment points to a missing graph node.",
          );
        if (target.type !== "asset") continue;
        if (occurrences.has(target.assetId))
          conflict(
            "Repeated graph assignments cannot be represented as distinct scene occurrences.",
          );
        occurrences.add(target.assetId);
      }
    }
    const required = [
      ...(source.selectedAssetIds ?? []),
      ...(source.constraints ?? []).flatMap((c) =>
        c.type === "must-include" || c.type === "asset-order" ? c.assetIds : [],
      ),
    ];
    if (required.some((id) => !assigned.has(id)))
      conflict("The authored plan is missing selected or required media.");
    if (
      (source.constraints ?? []).some(
        (c) =>
          c.type === "must-exclude" &&
          c.assetIds.some((id) => assigned.has(id)),
      )
    )
      conflict("The authored plan includes explicitly excluded media.");
    const duration = (plan.targetDuration * r.weight) / total;
    if (
      duration < (source.minDuration ?? 0) - 1e-8 ||
      duration > (source.maxDuration ?? Infinity) + 1e-8 ||
      (scene.narration?.trim() && duration < scene.estimatedDuration - 1e-8)
    )
      conflict(
        "Preset pacing violates authored beat duration bounds or narration duration.",
      );
    const text = r.text[locale] ?? r.text[recipe.defaultLocale]!;
    scene.title = text.title;
    scene.intent = text.intent;
    scene.visualDirection = text.visualDirection;
    scene.targetDuration = duration;
  }
  return plan;
}
/** Project an accepted plan onto the current Story model; source selections/constraints remain authoritative. */
export function storyFromPresetPlan(
  plan: StoryPlan,
  sourceStory: Story,
  snapshot: PresetSnapshot<"story">,
  storyId: string,
  beatIds: string[],
): Story {
  if (
    beatIds.length !== plan.scenes.length ||
    new Set(beatIds).size !== beatIds.length
  )
    conflict("Preset scene identity mapping is incomplete.");
  return {
    id: storyId,
    title: `${sourceStory.title} (Story Plan Cut)`,
    template: snapshot.canonicalId,
    targetDuration: plan.targetDuration,
    maxDuration: plan.maxDuration,
    presetSnapshot: structuredClone(snapshot),
    beats: plan.scenes.map((scene, i) => {
      const source = sourceStory.beats.find((b) => b.id === scene.beatId);
      if (!source) conflict("The preset source beat disappeared.");
      return {
        ...structuredClone(source),
        id: beatIds[i]!,
        title: scene.title,
        intent: scene.intent,
        templateBeatKey: snapshot.recipe.beats[i]!.key,
        titleSource: "template" as const,
        intentSource: "template" as const,
        targetDuration: scene.targetDuration,
        // The reviewed scene is the complete occurrence list for this cut.
        // Preserve source ordering rules as constraints as well as reviewed order.
        candidateAssetIds: scene.assets.map((a) => a.assetId),
        selectedAssetIds: scene.assets.map((a) => a.assetId),
        constraints: [
          ...structuredClone(source.constraints ?? []),
          ...(source.selectedAssetIds?.length &&
          (source.selectedAssetIds.length !== scene.assets.length ||
            source.selectedAssetIds.some(
              (id, index) => id !== scene.assets[index]!.assetId,
            ))
            ? [
                {
                  type: "asset-order" as const,
                  assetIds: [...source.selectedAssetIds],
                },
              ]
            : []),
        ],
        script: {
          narration: scene.narration ?? "",
          visualDirection: scene.visualDirection,
        },
      };
    }),
  };
}

/** Compare occurrences through the explicit scene-to-new-beat mapping, never asset-ID lookup. */
export function assertPresetPlanComposition(
  plan: StoryPlan,
  story: Story,
  composition: Composition,
): void {
  if (
    story.beats.length !== plan.scenes.length ||
    new Set(story.beats.map((b) => b.id)).size !== story.beats.length
  )
    conflict("Preset scene identity mapping is incomplete or ambiguous.");
  const clips = composition.tracks
    .flatMap((t) => t.clips)
    .sort((a, b) => a.timelineStart - b.timelineStart);
  if (clips.some((c) => !story.beats.some((b) => b.id === c.beatId)))
    conflict("The preset composition contains an unmapped occurrence.");
  for (const [i, scene] of plan.scenes.entries()) {
    const mapped = clips.filter((c) => c.beatId === story.beats[i]!.id);
    if (
      mapped.length !== scene.assets.length ||
      mapped.some((clip, j) => clip.assetId !== scene.assets[j]!.assetId)
    )
      conflict(
        "The solved composition does not preserve every reviewed scene occurrence in order.",
      );
  }
}
