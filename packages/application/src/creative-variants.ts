// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.

import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ApplicationError,
  createId,
  validateCreateVariantInput,
  validateCreativeVariant,
  compareCreativeVariants,
  type CreativeVariant,
  type CreateVariantInput,
  type CreativeVariantDiff,
  type CreativeVariantPreservedSection,
  type OpenFilmProject,
  type Story,
  type StoryBeat,
  type Composition,
  type Track,
  type Clip,
} from "@openfilm/core";
import type { OpenFilmApplication } from "./index.js";

export interface CreativeVariantImpactReport {
  scope: CreateVariantInput["scope"];
  preservedSections: CreativeVariantPreservedSection[];
  plannedChanges: string[];
  unsupportedIntents: string[];
  estimatedDuration: number;
  lockedNotice?: string;
}

export interface CreativeVariantComparisonResult {
  diff: CreativeVariantDiff;
  variantA: CreativeVariant;
  variantB: CreativeVariant;
  previewUrlA?: string;
  previewUrlB?: string;
  visualQaReportA?: unknown;
  visualQaReportB?: unknown;
}

export class CreativeVariantService {
  private readonly storePath: string;
  private variantsCache: CreativeVariant[] | null = null;

  constructor(
    private readonly app: OpenFilmApplication,
    private readonly publishProject: (next: OpenFilmProject) => void,
  ) {
    this.storePath = join(app.directory, "cache", "creative-variants.json");
  }

  private async loadVariants(): Promise<CreativeVariant[]> {
    if (this.variantsCache) return this.variantsCache;
    try {
      const content = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        this.variantsCache = parsed.map((item) =>
          validateCreativeVariant(item),
        );
        return this.variantsCache;
      }
    } catch {
      // File missing or corrupt
    }
    this.variantsCache = [];
    return this.variantsCache;
  }

  private async persistVariants(variants: CreativeVariant[]): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(variants, null, 2), "utf8");
    this.variantsCache = variants;
  }

  async listVariants(): Promise<CreativeVariant[]> {
    return this.loadVariants();
  }

  async getVariant(id: string): Promise<CreativeVariant> {
    const list = await this.loadVariants();
    const found = list.find((v) => v.id === id);
    if (!found) {
      throw new ApplicationError(
        "request.notFound",
        `Creative variant '${id}' not found.`,
        404,
      );
    }
    return found;
  }

  previewVariantImpact(
    inputRaw: CreateVariantInput,
  ): CreativeVariantImpactReport {
    const input = validateCreateVariantInput(inputRaw);
    const baselineStory = input.baselineStoryId
      ? this.app.project.stories.find((s) => s.id === input.baselineStoryId)
      : this.app.project.stories[0];

    const baselineComp = input.baselineCompositionId
      ? this.app.project.timelines.find(
          (t) => t.id === input.baselineCompositionId,
        )
      : this.app.project.timelines[0];

    if (!baselineStory || !baselineComp) {
      throw new ApplicationError(
        "request.invalid",
        "Baseline Story or Composition not found.",
        400,
      );
    }

    const preservedSections: CreativeVariantPreservedSection[] = [];
    const plannedChanges: string[] = [];
    const unsupportedIntents: string[] = [];

    // Detect unsupported free-text expressions in intent
    const freeTextPatterns = [
      /自動/u,
      /AI/iu,
      /奇幻/u,
      /大片/u,
      /調色/u,
      /動態追蹤/u,
      /風格化/u,
    ];
    for (const pattern of freeTextPatterns) {
      if (pattern.test(input.intent)) {
        unsupportedIntents.push(input.intent);
        break;
      }
    }

    let lockedNotice: string | undefined;

    if (input.scope.type === "section") {
      const targetBeatId = input.scope.targetBeatId;
      const targetBeat = baselineStory.beats.find((b) => b.id === targetBeatId);
      if (!targetBeat) {
        throw new ApplicationError(
          "request.notFound",
          `Target beat '${targetBeatId}' not found in baseline story.`,
          404,
        );
      }

      // Check if target section has locked clips
      for (const track of baselineComp.tracks) {
        for (const clip of track.clips) {
          if (
            targetBeat.selectedAssetIds?.includes(clip.assetId) &&
            clip.locked
          ) {
            lockedNotice = `Target section '${targetBeat.title}' has locked clips. Modifications require explicit unlock.`;
          }
        }
      }

      // Mark preserved beats
      for (const beat of baselineStory.beats) {
        if (beat.id !== targetBeatId) {
          preservedSections.push({
            sectionId: beat.id,
            type: "beat",
            unchanged: true,
          });
        }
      }

      // Mark preserved clips
      for (const track of baselineComp.tracks) {
        for (const clip of track.clips) {
          if (!targetBeat.selectedAssetIds?.includes(clip.assetId)) {
            preservedSections.push({
              sectionId: clip.id,
              type: "clip",
              unchanged: true,
            });
          }
        }
      }

      plannedChanges.push(
        `Modify section '${targetBeat.title}': ${input.intent}`,
      );
      if (input.modifications?.targetDuration) {
        plannedChanges.push(
          `Adjust target duration to ${input.modifications.targetDuration}s`,
        );
      }
      if (input.modifications?.replaceAssetIds?.length) {
        plannedChanges.push(
          `Replace ${input.modifications.replaceAssetIds.length} media assets in section`,
        );
      }
    } else {
      plannedChanges.push(`Adjust whole film rhythm: ${input.intent}`);
      if (input.modifications?.durationMultiplier) {
        plannedChanges.push(
          `Scale duration by factor of ${input.modifications.durationMultiplier}`,
        );
      }
    }

    const mult = input.modifications?.durationMultiplier ?? 1.0;
    const estimatedDuration = Number((baselineComp.duration * mult).toFixed(3));

    return {
      scope: input.scope,
      preservedSections,
      plannedChanges,
      unsupportedIntents,
      estimatedDuration,
      lockedNotice,
    };
  }

  async createVariant(inputRaw: CreateVariantInput): Promise<CreativeVariant> {
    const input = validateCreateVariantInput(inputRaw);

    const baselineStory = input.baselineStoryId
      ? this.app.project.stories.find((s) => s.id === input.baselineStoryId)
      : this.app.project.stories[0];

    const baselineComp = input.baselineCompositionId
      ? this.app.project.timelines.find(
          (t) => t.id === input.baselineCompositionId,
        )
      : this.app.project.timelines[0];

    if (!baselineStory || !baselineComp) {
      throw new ApplicationError(
        "request.invalid",
        "Baseline Story or Composition not found.",
        400,
      );
    }

    // Lock check: if section scope targets locked clips, reject modification
    if (input.scope.type === "section") {
      const targetBeatId = input.scope.targetBeatId;
      const targetBeat = baselineStory.beats.find((b) => b.id === targetBeatId);
      if (!targetBeat) {
        throw new ApplicationError(
          "request.notFound",
          `Target beat '${targetBeatId}' not found.`,
          404,
        );
      }
      for (const track of baselineComp.tracks) {
        for (const clip of track.clips) {
          if (
            targetBeat.selectedAssetIds?.includes(clip.assetId) &&
            clip.locked
          ) {
            throw new ApplicationError(
              "timeline.conflict",
              `Cannot modify locked section '${targetBeat.title}'. Unlock clips before creating variant.`,
              409,
            );
          }
        }
      }
    }

    const derivedStoryId = createId("story");
    const derivedCompId = createId("comp");

    const beatMappings: {
      baselineBeatId: string;
      variantBeatId: string;
      role?: string;
    }[] = [];
    const clipMappings: {
      baselineClipId: string;
      variantClipId: string;
      trackId: string;
      role?: string;
    }[] = [];
    const preservedSections: CreativeVariantPreservedSection[] = [];

    // 1. Derive Story Beats
    const newBeats: StoryBeat[] = baselineStory.beats.map((oldBeat) => {
      const newBeatId = createId("beat");
      beatMappings.push({
        baselineBeatId: oldBeat.id,
        variantBeatId: newBeatId,
      });

      if (input.scope.type === "section") {
        if (oldBeat.id === input.scope.targetBeatId) {
          // Target beat to modify
          let selectedAssetIds = [...(oldBeat.selectedAssetIds ?? [])];
          let candidateAssetIds = [...(oldBeat.candidateAssetIds ?? [])];

          if (input.modifications?.replaceAssetIds) {
            for (const { fromAssetId, toAssetId } of input.modifications
              .replaceAssetIds) {
              selectedAssetIds = selectedAssetIds.map((id) =>
                id === fromAssetId ? toAssetId : id,
              );
              candidateAssetIds = candidateAssetIds.map((id) =>
                id === fromAssetId ? toAssetId : id,
              );
            }
          }

          return {
            ...oldBeat,
            id: newBeatId,
            title: `${oldBeat.title} (${input.name})`,
            targetDuration:
              input.modifications?.targetDuration ?? oldBeat.targetDuration,
            script: {
              narration:
                input.modifications?.narration ??
                oldBeat.script?.narration ??
                "",
              visualDirection:
                input.modifications?.visualDirection ??
                oldBeat.script?.visualDirection ??
                "",
            },
            selectedAssetIds,
            candidateAssetIds,
          };
        } else {
          // PROVABLY UNCHANGED BEAT: Exact copy of all properties
          preservedSections.push({
            sectionId: oldBeat.id,
            type: "beat",
            unchanged: true,
          });
          return {
            ...oldBeat,
            id: newBeatId,
          };
        }
      } else {
        // Film scope
        const mult = input.modifications?.durationMultiplier ?? 1.0;
        return {
          ...oldBeat,
          id: newBeatId,
          targetDuration: oldBeat.targetDuration
            ? Number((oldBeat.targetDuration * mult).toFixed(3))
            : undefined,
        };
      }
    });

    const derivedStory: Story = {
      ...baselineStory,
      id: derivedStoryId,
      title: `${baselineStory.title} (方案 ${input.name})`,
      beats: newBeats,
    };

    // 2. Derive Composition Tracks & Clips
    const targetBeatId =
      input.scope.type === "section" ? input.scope.targetBeatId : undefined;
    const targetBeat = targetBeatId
      ? baselineStory.beats.find((b) => b.id === targetBeatId)
      : undefined;

    let cursorOffset = 0;
    const newTracks: Track[] = baselineComp.tracks.map((oldTrack) => {
      const newClips: Clip[] = oldTrack.clips.map((oldClip) => {
        const newClipId = createId("clip");
        clipMappings.push({
          baselineClipId: oldClip.id,
          variantClipId: newClipId,
          trackId: oldTrack.id,
        });

        // LOCK PRESERVATION: Cloned clip strictly preserves lock!
        const isLocked = oldClip.locked === true;

        if (input.scope.type === "section" && targetBeat) {
          const isTargetClip = targetBeat.selectedAssetIds?.includes(
            oldClip.assetId,
          );
          if (isTargetClip) {
            let assetId = oldClip.assetId;
            if (input.modifications?.replaceAssetIds) {
              const rep = input.modifications.replaceAssetIds.find(
                (r) => r.fromAssetId === assetId,
              );
              if (rep) assetId = rep.toAssetId;
            }

            const targetDur =
              input.modifications?.targetDuration ?? oldClip.timelineDuration;
            const deltaDur = targetDur - oldClip.timelineDuration;
            cursorOffset += deltaDur;

            return {
              ...oldClip,
              id: newClipId,
              assetId,
              timelineStart: Number(
                (oldClip.timelineStart + cursorOffset - deltaDur).toFixed(3),
              ),
              timelineDuration: Number(targetDur.toFixed(3)),
              sourceOut:
                oldClip.sourceIn !== undefined
                  ? Number(((oldClip.sourceIn ?? 0) + targetDur).toFixed(3))
                  : oldClip.sourceOut,
              locked: isLocked,
            };
          } else {
            // PROVABLY UNCHANGED NON-TARGET CLIP: Exact media asset, filters, transforms, and locks
            preservedSections.push({
              sectionId: oldClip.id,
              type: "clip",
              unchanged: true,
            });
            return {
              ...oldClip,
              id: newClipId,
              timelineStart: Number(
                (oldClip.timelineStart + cursorOffset).toFixed(3),
              ),
              locked: isLocked,
            };
          }
        } else {
          // Film scope
          const mult = input.modifications?.durationMultiplier ?? 1.0;
          const scaledDur = Number(
            (oldClip.timelineDuration * mult).toFixed(3),
          );
          const scaledStart = Number((oldClip.timelineStart * mult).toFixed(3));
          return {
            ...oldClip,
            id: newClipId,
            timelineStart: scaledStart,
            timelineDuration: scaledDur,
            sourceOut:
              oldClip.sourceIn !== undefined
                ? Number(((oldClip.sourceIn ?? 0) + scaledDur).toFixed(3))
                : oldClip.sourceOut,
            locked: isLocked,
          };
        }
      });

      return {
        ...oldTrack,
        clips: newClips,
      };
    });

    const maxEnd = Math.max(
      ...newTracks.flatMap((t) =>
        t.clips.map((c) => c.timelineStart + c.timelineDuration),
      ),
      0,
    );

    const derivedComp: Composition = {
      ...baselineComp,
      id: derivedCompId,
      storyId: derivedStoryId,
      duration: Number(maxEnd.toFixed(3)),
      tracks: newTracks,
    };

    const variantRecord: CreativeVariant = {
      schemaVersion: "1.0.0",
      id: randomUUID(),
      projectId: this.app.project.id,
      name: input.name,
      description: input.description,
      intent: input.intent,
      scope: input.scope,
      baselineStoryId: baselineStory.id,
      baselineCompositionId: baselineComp.id,
      derivedStoryId,
      derivedCompositionId: derivedCompId,
      provenanceMapping: {
        beatMappings,
        clipMappings,
      },
      preservedSections,
      modifications: input.modifications ?? {},
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Store variant in cache/creative-variants.json
    const variants = await this.loadVariants();
    variants.push(variantRecord);
    await this.persistVariants(variants);

    // Add derived Story and Composition to project
    const nextProject: OpenFilmProject = {
      ...this.app.project,
      updatedAt: new Date().toISOString(),
      stories: [...this.app.project.stories, derivedStory],
      timelines: [...this.app.project.timelines, derivedComp],
    };

    this.publishProject(nextProject);
    return variantRecord;
  }

  async compareVariants(
    variantAId: string,
    variantBId: string,
  ): Promise<CreativeVariantComparisonResult> {
    const list = await this.loadVariants();
    const variantA = list.find((v) => v.id === variantAId);
    const variantB = list.find((v) => v.id === variantBId);

    if (!variantA || !variantB) {
      throw new ApplicationError(
        "request.notFound",
        "One or both variants not found.",
        404,
      );
    }

    const storyA = this.app.project.stories.find(
      (s) => s.id === variantA.derivedStoryId,
    );
    const storyB = this.app.project.stories.find(
      (s) => s.id === variantB.derivedStoryId,
    );
    const compA = this.app.project.timelines.find(
      (t) => t.id === variantA.derivedCompositionId,
    );
    const compB = this.app.project.timelines.find(
      (t) => t.id === variantB.derivedCompositionId,
    );

    if (!storyA || !storyB || !compA || !compB) {
      throw new ApplicationError(
        "request.invalid",
        "Story or Composition for variant not found in project.",
        400,
      );
    }

    // STRICT ZERO-RENDER RULE: compareVariants NEVER triggers video rendering or generation
    const diff = compareCreativeVariants(
      variantA,
      variantB,
      storyA,
      storyB,
      compA,
      compB,
    );

    // Look up existing pipeline artifacts if runs were performed
    const allRuns = await this.app.pipeline.listRuns();
    const runA = allRuns.find((r) => r.inputSnapshot.storyId === storyA.id);
    const runB = allRuns.find((r) => r.inputSnapshot.storyId === storyB.id);

    const previewA = runA?.artifacts.find(
      (a) => a.kind === "preview-video",
    )?.path;
    const previewB = runB?.artifacts.find(
      (a) => a.kind === "preview-video",
    )?.path;
    const visualQaA = runA?.artifacts.find((a) => a.kind === "qa-report");
    const visualQaB = runB?.artifacts.find((a) => a.kind === "qa-report");

    variantA.status = "compared";
    variantB.status = "compared";
    await this.persistVariants(list);

    return {
      diff,
      variantA,
      variantB,
      previewUrlA: previewA,
      previewUrlB: previewB,
      visualQaReportA: visualQaA,
      visualQaReportB: visualQaB,
    };
  }

  async adoptVariant(
    variantId: string,
    options?: { expectedRevision?: string },
  ): Promise<{ project: OpenFilmProject; checkpointVersionId: string }> {
    const list = await this.loadVariants();
    const variant = list.find((v) => v.id === variantId);
    if (!variant) {
      throw new ApplicationError(
        "request.notFound",
        `Variant '${variantId}' not found.`,
        404,
      );
    }

    // 1. Revision Check
    const currentRev = this.app.versions.currentRevision();
    if (options?.expectedRevision && options.expectedRevision !== currentRev) {
      throw new ApplicationError(
        "story.planStale",
        "Project revision changed after variant review. Refresh before adopting.",
        409,
      );
    }

    // 2. Source Availability Check
    const targetComp = this.app.project.timelines.find(
      (t) => t.id === variant.derivedCompositionId,
    );
    if (!targetComp) {
      throw new ApplicationError(
        "request.invalid",
        "Variant composition not found in project.",
        400,
      );
    }

    const allAssetIds = new Set(
      targetComp.tracks.flatMap((t) => t.clips.map((c) => c.assetId)),
    );
    const catalogAssets = this.app.catalog.listAssets({ limit: 5000 });
    const catalogAssetMap = new Map(catalogAssets.map((a) => [a.id, a]));

    for (const assetId of allAssetIds) {
      if (!catalogAssetMap.has(assetId)) {
        throw new ApplicationError(
          "media.notFound",
          `Required media asset '${assetId}' is missing from catalog.`,
          400,
        );
      }
    }

    // 3. Save Named Version Checkpoint FIRST
    // If checkpoint fails, adoption is aborted immediately without modifying project!
    const checkpoint = await this.app.versions.create({
      name: `Checkpoint before adopting ${variant.name}`,
      description: `Automatic checkpoint created prior to adopting creative variant ${variant.id}`,
      baseRevision: currentRev,
      requestId: randomUUID(),
    });

    // 4. Update Active Composition: place targetComp as timelines[0]
    const otherComps = this.app.project.timelines.filter(
      (t) => t.id !== targetComp.id,
    );
    const nextTimelines = [targetComp, ...otherComps];

    variant.status = "adopted";
    await this.persistVariants(list);

    const nextProject: OpenFilmProject = {
      ...this.app.project,
      updatedAt: new Date().toISOString(),
      timelines: nextTimelines,
    };

    this.publishProject(nextProject);
    return { project: nextProject, checkpointVersionId: checkpoint.id };
  }

  async restoreBaseline(
    variantId: string,
    checkpointVersionId: string,
  ): Promise<{ project: OpenFilmProject }> {
    const list = await this.loadVariants();
    const variant = list.find((v) => v.id === variantId);
    if (!variant) {
      throw new ApplicationError(
        "request.notFound",
        `Variant '${variantId}' not found.`,
        404,
      );
    }

    const currentRev = this.app.versions.currentRevision();
    await this.app.versions.restore(checkpointVersionId, {
      baseRevision: currentRev,
      requestId: randomUUID(),
      confirmed: true,
    });

    variant.status = "draft";
    await this.persistVariants(list);

    return { project: this.app.project };
  }

  async deleteVariant(variantId: string): Promise<void> {
    const list = await this.loadVariants();
    const index = list.findIndex((v) => v.id === variantId);
    if (index === -1) {
      throw new ApplicationError(
        "request.notFound",
        `Variant '${variantId}' not found.`,
        404,
      );
    }

    const [deleted] = list.splice(index, 1);
    await this.persistVariants(list);

    if (deleted && deleted.status !== "adopted") {
      // Remove derived Story and Composition if not currently adopted
      const nextTimelines = this.app.project.timelines.filter(
        (t) => t.id !== deleted.derivedCompositionId,
      );
      const nextStories = this.app.project.stories.filter(
        (s) => s.id !== deleted.derivedStoryId,
      );

      const nextProject: OpenFilmProject = {
        ...this.app.project,
        updatedAt: new Date().toISOString(),
        timelines: nextTimelines,
        stories: nextStories,
      };

      this.publishProject(nextProject);
    }
    // SHARED ASSET PROTECTION: Catalog MediaAssets are NEVER deleted!
  }
}
