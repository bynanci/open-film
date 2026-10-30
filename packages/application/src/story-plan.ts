// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import {
  ApplicationError,
  createId,
  validateProject,
  validateStoryPlan,
  assertPresetJsonData,
  canonicalPresetJson,
  validatePresetStoryPlanContext,
  type PresetApplicationReceipt,
  type PresetSnapshot,
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
import { compose, CompositionConstraintError } from "@openfilm/solver";
import {
  generateStoryPlanFromGraph,
  compilePresetStoryPlan,
  storyFromPresetPlan,
  assertPresetPlanComposition,
} from "@openfilm/story";
import type { OpenFilmApplication } from "./index.js";
import {
  assertPresetSnapshotIntegrity,
  hashPresetData,
} from "./preset-integrity.js";
import { TimelineEditor } from "./editor.js";

function composePresetPlan(
  plan: StoryPlan,
  story: Story,
  assets: MediaAsset[],
): Composition {
  try {
    const composition = compose(story, assets, {
      allowEchoAssetIds: plan.scenes.flatMap((s) =>
        s.assets.filter((a) => a.isEcho).map((a) => a.assetId),
      ),
    });
    assertPresetPlanComposition(plan, story, composition);
    return composition;
  } catch (error) {
    if (error instanceof CompositionConstraintError)
      throw new ApplicationError("presets.conflict", error.message, 409);
    throw error;
  }
}

const presetModelHash = (value: unknown) =>
  hashPresetData(canonicalPresetJson(JSON.parse(JSON.stringify(value))));
function sourceFacts(assets: MediaAsset[]): string {
  return presetModelHash(
    assets
      .map((a) => ({
        id: a.id,
        contentHash: a.contentHash ?? null,
        uri: a.uri,
        state: a.state,
        duration: a.duration ?? null,
        dimensions: a.dimensions ?? null,
        mediaType: a.mediaType,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  );
}

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
    private readonly publishProject: (
      next: OpenFilmProject,
      assertCurrent?: () => void,
    ) => void,
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
    readOnlyGraph = false,
  ): { plan: StoryPlan; compositionPreview: Composition } {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' not found.`,
        404,
      );
    }

    const graph = readOnlyGraph
      ? this.app.storyGraph.previewGraph(storyId)
      : this.app.storyGraph.getGraph(storyId);
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

  previewPresetPlan(
    storyId: string,
    snapshot: PresetSnapshot<"story">,
    bindings: { recipeBeatKey: string; beatId: string }[],
    options: Pick<
      StoryPlanOptions,
      "targetDuration" | "maxDuration" | "transition"
    > = {},
  ): { plan: StoryPlan; compositionPreview: Composition } {
    assertPresetSnapshotIntegrity(snapshot);
    if (this.app.catalog.countAssets() > 2000)
      throw new ApplicationError(
        "story.scopeTooLarge",
        "A preset plan supports at most 2000 catalog sources.",
      );
    const revision = this.app.versions.currentRevision(),
      source = this.app.project.stories.find((s) => s.id === storyId);
    if (!source)
      throw new ApplicationError(
        "request.notFound",
        "The authored source story was not found.",
        404,
      );
    const normalized = {
      targetDuration:
        options.targetDuration ?? snapshot.recipe.defaults.targetDuration,
      maxDuration: options.maxDuration ?? snapshot.recipe.defaults.maxDuration,
      transition: options.transition ?? ("cut" as const),
    };
    const base = this.previewPlan(storyId, normalized, true).plan;
    const compiled = compilePresetStoryPlan(
      base,
      source,
      snapshot,
      bindings,
      this.app.project.projectContentLocale ?? "en-US",
    );
    // Existing trusted StoryPlan builders include optional undefined properties;
    // normalize their output, never imported unknown values, to transport JSON.
    const plan = JSON.parse(JSON.stringify(compiled)) as StoryPlan;
    const assets = this.app.catalog.listAssets({ limit: 2000 }),
      referenced = new Set(
        plan.scenes.flatMap((s) => s.assets.map((a) => a.assetId)),
      );
    if (
      assets.some(
        (a) => a.state.locked && (!referenced.has(a.id) || a.state.rejected),
      )
    )
      throw new ApplicationError(
        "presets.conflict",
        "Every locked source must remain assigned and eligible in the authored plan.",
        409,
      );
    const { id: _id, createdAt: _at, ...stable } = plan;
    const guard = presetModelHash({
      plan: stable,
      bindings,
      snapshotSha256: snapshot.snapshotSha256,
      revision,
      sources: sourceFacts(assets),
      source,
    });
    plan.id = `preset-plan-${guard.slice(0, 32)}`;
    plan.createdAt = this.app.project.updatedAt;
    plan.sourceSignature = guard;
    plan.presetContext = {
      version: 1,
      snapshot: structuredClone(snapshot),
      bindings: structuredClone(bindings),
      baseProjectRevision: revision,
      sourceGuardSha256: guard,
    };
    const previewStory = storyFromPresetPlan(
      plan,
      source,
      snapshot,
      `preview-story-${plan.id}`,
      plan.scenes.map((s, i) => `preview-beat-${i}-${s.sceneId}`),
    );
    const composition = composePresetPlan(
      plan,
      previewStory,
      filterUsableAssets(assets),
    );
    composition.id = `preview-comp-${plan.id}`;
    composition.storyId = previewStory.id;
    return { plan: validateStoryPlan(plan), compositionPreview: composition };
  }

  acceptPresetPlan(
    storyId: string,
    plan: StoryPlan,
    receipt: PresetApplicationReceipt,
  ): {
    story: Story;
    composition: Composition;
    acceptanceMapping: StoryPlanAcceptanceMapping;
  } {
    assertPresetJsonData(plan, { depth: 16, tokens: 100000, text: 4194304 });
    const context = validatePresetStoryPlanContext(plan.presetContext);
    if (context.baseProjectRevision !== this.app.versions.currentRevision())
      throw new ApplicationError(
        "presets.stale",
        "Story sources or project changed since preset review.",
        409,
      );
    const expected = this.previewPresetPlan(
      storyId,
      context.snapshot,
      context.bindings,
      {
        targetDuration: plan.targetDuration,
        maxDuration: plan.maxDuration,
        transition: plan.transition,
      },
    );
    if (
      presetModelHash(expected.plan) !== presetModelHash(plan) ||
      receipt.snapshotSha256 !== context.snapshot.snapshotSha256 ||
      receipt.packageSha256 !== context.snapshot.packageSha256 ||
      receipt.canonicalId !== context.snapshot.canonicalId ||
      receipt.kind !== "story"
    )
      throw new ApplicationError(
        "presets.stale",
        "The exact authored preset plan changed before acceptance.",
        409,
      );
    return this.acceptPlanInternal(storyId, expected.plan, receipt);
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
    if (planInput.presetContext)
      throw new ApplicationError(
        "presets.invalid",
        "Use the reviewed preset acceptance owner for a preset plan.",
      );
    return this.acceptPlanInternal(storyId, planInput);
  }

  private acceptPlanInternal(
    storyId: string,
    planInput: StoryPlan,
    presetReceipt?: PresetApplicationReceipt,
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
    const currentGraph = presetReceipt
      ? this.app.storyGraph.previewGraph(baseStory.id)
      : this.app.storyGraph.getGraph(baseStory.id);
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
    const sourceFingerprint = presetReceipt
      ? sourceFacts(allAssets)
      : undefined;

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

    let newStory: Story = {
      id: newStoryId,
      title: `${baseStory.title} (Story Plan Cut)`,
      targetDuration: plan.targetDuration,
      maxDuration: plan.maxDuration,
      beats: newBeats,
    };
    if (presetReceipt && plan.presetContext) {
      const context = plan.presetContext;
      newStory = storyFromPresetPlan(
        plan,
        baseStory,
        context.snapshot,
        newStoryId,
        plan.scenes.map((s) => sceneToBeatId[s.sceneId]!),
      );
      newStory.presetPlanSource = {
        version: 1,
        storyId: baseStory.id,
        planId: plan.id,
        sourceGuardSha256: context.sourceGuardSha256,
        bindings: context.bindings.map((b, i) => ({
          recipeBeatKey: b.recipeBeatKey,
          sourceBeatId: b.beatId,
          beatId: newStory.beats[i]!.id,
        })),
      };
    }

    // Explicit echo assets
    const echoAssetIds = plan.scenes.flatMap((s) =>
      s.assets.filter((a) => a.isEcho).map((a) => a.assetId),
    );

    const newComposition = presetReceipt
      ? composePresetPlan(plan, newStory, usableAssets)
      : compose(newStory, usableAssets, { allowEchoAssetIds: echoAssetIds });
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
    if (presetReceipt) {
      presetReceipt = {
        ...presetReceipt,
        result: { storyId: newStory.id, compositionId: newComposition.id },
        acceptedRevision: new TimelineEditor(this.app).revisionForDocument({
          story: newStory,
          composition: newComposition,
        }),
      };
    }
    const nextProject = validateProject({
      ...previousProject,
      ...(presetReceipt
        ? {
            presetApplicationReceipts: this.app.presets.appendReceipt(
              previousProject,
              presetReceipt,
            ),
          }
        : {}),
      stories: [...previousProject.stories, newStory],
      timelines: [...previousProject.timelines, newComposition],
    });

    this.publishProject(
      nextProject,
      presetReceipt
        ? () => {
            if (
              sourceFacts(this.app.catalog.listAssets({ limit: 2000 })) !==
              sourceFingerprint
            )
              throw new ApplicationError(
                "presets.stale",
                "Story sources changed before publication.",
                409,
              );
          }
        : undefined,
    );

    return {
      story: newStory,
      composition: newComposition,
      acceptanceMapping,
    };
  }
}
