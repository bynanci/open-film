// SPDX-License-Identifier: Apache-2.0
import {
  ApplicationError,
  validatePresetSnapshot,
  type PresetSnapshot,
  type Story,
  type StoryPlan,
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
    bindings.length !== recipe.beats.length
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
    const assigned = new Set(scene.assets.map((a) => a.assetId)),
      required = [
        ...(source.selectedAssetIds ?? []),
        ...(source.constraints ?? []).flatMap((c) =>
          c.type === "must-include" || c.type === "asset-order"
            ? c.assetIds
            : [],
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
  if (beatIds.length !== plan.scenes.length)
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
        candidateAssetIds: [
          ...new Set([
            ...(source.candidateAssetIds ?? []),
            ...scene.assets.map((a) => a.assetId),
          ]),
        ],
        selectedAssetIds: [
          ...(source.selectedAssetIds ?? scene.assets.map((a) => a.assetId)),
        ],
        script: {
          narration: scene.narration ?? "",
          visualDirection: scene.visualDirection,
        },
      };
    }),
  };
}
