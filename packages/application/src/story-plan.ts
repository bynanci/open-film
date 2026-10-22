// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import {
  ApplicationError,
  createId,
  validateProject,
  validateStoryPlan,
  type Composition,
  type MediaAsset,
  type OpenFilmProject,
  type Story,
  type StoryBeat,
  type StoryPlan,
  type StoryPlanAcceptanceMapping,
  type StoryPlanOptions,
} from "@openfilm/core";
import { previewIssue } from "@openfilm/media";
import { compose } from "@openfilm/solver";
import { generateStoryPlanFromGraph } from "@openfilm/story";
import type { OpenFilmApplication } from "./index.js";

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
  const str = canonical(value);
  let h1 = 0x811c9dc5n;
  let h2 = 0x9e3779b9n;
  let h3 = 0x85ebca6bn;
  let h4 = 0xc2b2ae35n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    const code = BigInt(str.charCodeAt(i));
    h1 = ((h1 ^ code) * prime) & 0xffffffffffffffffn;
    h2 = ((h2 ^ (code + 1n)) * prime) & 0xffffffffffffffffn;
    h3 = ((h3 ^ (code + 2n)) * prime) & 0xffffffffffffffffn;
    h4 = ((h4 ^ (code + 3n)) * prime) & 0xffffffffffffffffn;
  }
  return [h1, h2, h3, h4].map((h) => h.toString(16).padStart(16, "0")).join("");
}

function filterUsableAssets(assets: MediaAsset[]): MediaAsset[] {
  return assets.filter(
    (asset) =>
      ["image", "video"].includes(asset.mediaType) &&
      !asset.state.rejected &&
      !previewIssue(asset),
  );
}

export class StoryPlanService {
  constructor(
    private readonly app: OpenFilmApplication,
    private readonly publishProject: (next: OpenFilmProject) => void,
  ) {}

  /**
   * Generates a reviewable Storyboard proposal (StoryPlan) and an informational
   * solved preview composition.
   * STRICT SAFETY RULE: Preview NEVER mutates the original Story or Composition!
   * Render/provider calls are 0.
   */
  previewPlan(
    storyId: string,
    options: StoryPlanOptions = {},
  ): { plan: StoryPlan; compositionPreview: Composition } {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
        404,
      );
    }

    const graph = this.app.storyGraph.getGraph(storyId);
    const allAssets = this.app.catalog.listAssets({ limit: 2000 });
    const usableAssets = filterUsableAssets(allAssets);

    if (usableAssets.length === 0) {
      throw new ApplicationError(
        "story.mediaRequired",
        "Add supported photos or videos to the media catalog before planning scenes.",
        400,
      );
    }

    const plan = generateStoryPlanFromGraph(
      story,
      graph,
      usableAssets,
      options,
    );

    // Build draft Story for preview without mutating the project
    const previewBeats: StoryBeat[] = plan.scenes.map((scene) => ({
      id: scene.beatId || scene.sceneId,
      title: scene.title,
      intent: scene.intent,
      targetDuration: scene.targetDuration,
      candidateAssetIds: scene.assets.map((a) => a.assetId),
      selectedAssetIds: scene.assets.map((a) => a.assetId),
      script: {
        narration: scene.narration || "",
        visualDirection: scene.visualDirection,
      },
    }));

    const previewStory: Story = {
      id: `preview-story-${plan.id}`,
      title: `${plan.title} (Preview)`,
      targetDuration: plan.targetDuration,
      maxDuration: plan.maxDuration,
      beats: previewBeats,
    };

    // Explicit echo assets
    const echoAssetIds = plan.scenes.flatMap((s) =>
      s.assets.filter((a) => a.isEcho).map((a) => a.assetId),
    );

    const composition = compose(previewStory, usableAssets, {
      allowEchoAssetIds: echoAssetIds,
    });
    composition.id = `preview-comp-${plan.id}`;
    composition.storyId = story.id;

    return {
      plan,
      compositionPreview: composition,
    };
  }

  /**
   * Explicitly adopts a reviewed StoryPlan into a new rough cut (新試剪).
   * STRICT GUARANTEES:
   * 1. Preserves existing manual edits (does NOT overwrite original Story or Composition).
   * 2. Binds strictly to current input signature (rejects stale plans with 409).
   * 3. Rejects plans with unresolved alternatives or cycles with 409.
   * 4. Idempotent: Lost-response retries do not produce duplicate timelines.
   */
  acceptPlan(
    storyId: string,
    planInput: StoryPlan,
  ): {
    story: Story;
    composition: Composition;
    acceptanceMapping: StoryPlanAcceptanceMapping;
  } {
    const plan = validateStoryPlan(planInput);

    const baseStory = this.app.project.stories.find(
      (s) => s.id === storyId || s.id === plan.storyId,
    );
    if (!baseStory) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
        404,
      );
    }

    // 1. Check for blocking conflicts
    if (plan.path.cycleDetected && plan.path.cycleDetected.length > 0) {
      throw new ApplicationError(
        "story.planConflict",
        "Cannot adopt story plan with cyclic narrative dependencies. Resolve cycle first.",
        409,
      );
    }
    if (
      plan.path.unresolvedAlternatives &&
      plan.path.unresolvedAlternatives.length > 0
    ) {
      throw new ApplicationError(
        "story.planConflict",
        "Cannot adopt story plan with unresolved alternative paths. Select explicit branches first.",
        409,
      );
    }

    // 2. Stale Plan Protection: verify input revision
    const currentGraph = this.app.storyGraph.getGraph(baseStory.id);
    const currentRevision = digest({
      storyId: baseStory.id,
      beats: baseStory.beats,
      graphNodes: currentGraph.nodes,
      graphEdges: currentGraph.edges,
    });
    if (currentRevision !== plan.inputRevision) {
      throw new ApplicationError(
        "story.planStale",
        "The story or graph structure changed after this plan was generated. Please generate a new preview before adopting.",
        409,
      );
    }

    const allAssets = this.app.catalog.listAssets({ limit: 2000 });
    const usableAssets = filterUsableAssets(allAssets);

    // 3. Idempotency Check: if already accepted with identical signature, return existing cut
    const receiptKey = digest({
      planId: plan.id,
      inputRevision: plan.inputRevision,
      sourceSignature: plan.sourceSignature,
    });
    const cutCompId = `cut-${receiptKey.slice(0, 16)}`;

    const existingComp = this.app.project.timelines.find(
      (t) => t.id === cutCompId,
    );
    if (existingComp) {
      const existingStory = this.app.project.stories.find(
        (s) => s.id === existingComp.storyId,
      );
      if (existingStory) {
        // Return existing without duplicate creation
        const mapping: StoryPlanAcceptanceMapping = plan.acceptanceMapping ?? {
          storyId: existingStory.id,
          compositionId: existingComp.id,
          sceneToBeatId: {},
          sceneToClipIds: {},
          acceptedAt: new Date().toISOString(),
        };
        return {
          story: existingStory,
          composition: existingComp,
          acceptanceMapping: mapping,
        };
      }
    }

    // 4. Create New Rough Cut (新試剪) preserving original edit
    const newStoryId = createId("story");
    const sceneToBeatId: Record<string, string> = {};

    const newBeats: StoryBeat[] = plan.scenes.map((scene) => {
      const newBeatId = createId("beat");
      sceneToBeatId[scene.sceneId] = newBeatId;
      return {
        id: newBeatId,
        title: scene.title,
        intent: scene.intent,
        targetDuration: scene.targetDuration,
        candidateAssetIds: scene.assets.map((a) => a.assetId),
        selectedAssetIds: scene.assets.map((a) => a.assetId),
        script: {
          narration: scene.narration || "",
          visualDirection: scene.visualDirection,
        },
      };
    });

    const newStory: Story = {
      id: newStoryId,
      title: `${baseStory.title} (Story Plan Cut)`,
      targetDuration: plan.targetDuration,
      maxDuration: plan.maxDuration,
      beats: newBeats,
    };

    // Explicit echo assets
    const echoAssetIds = plan.scenes.flatMap((s) =>
      s.assets.filter((a) => a.isEcho).map((a) => a.assetId),
    );

    const newComposition = compose(newStory, usableAssets, {
      allowEchoAssetIds: echoAssetIds,
    });
    newComposition.id = cutCompId;
    newComposition.storyId = newStoryId;

    // Map scenes to clips
    const sceneToClipIds: Record<string, string[]> = {};
    for (const scene of plan.scenes) {
      const targetBeatId = sceneToBeatId[scene.sceneId];
      const clips = newComposition.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.beatId === targetBeatId);
      sceneToClipIds[scene.sceneId] = clips.map((c) => c.id);
    }

    const acceptanceMapping: StoryPlanAcceptanceMapping = {
      storyId: newStoryId,
      compositionId: newComposition.id,
      sceneToBeatId,
      sceneToClipIds,
      acceptedAt: new Date().toISOString(),
    };

    // Transactionally append newStory and newComposition to project
    const previousProject = this.app.project;
    const nextProject = validateProject({
      ...previousProject,
      stories: [...previousProject.stories, newStory],
      timelines: [...previousProject.timelines, newComposition],
    });

    this.publishProject(nextProject);

    return {
      story: newStory,
      composition: newComposition,
      acceptanceMapping,
    };
  }
}
