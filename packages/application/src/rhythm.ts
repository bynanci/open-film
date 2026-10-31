// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import {
  ApplicationError,
  validateRhythmAnalysisEvidence,
  validateRhythmSnapProposal,
  type RhythmAnalysisEvidence,
  type RhythmSnapProposal,
  type RhythmSnapTargetEdge,
  type TimelineRhythmLandmark,
} from "@openfilm/core";
import {
  buildRhythmSnapProposal,
  projectClipRhythmLandmarks,
} from "@openfilm/solver";
import { TimelineEditor } from "./editor.js";
import type { OpenFilmApplication } from "./index.js";

export interface RhythmSnapOptions {
  targetEdge?: RhythmSnapTargetEdge;
  tolerance?: number;
  bypass?: boolean;
  compositionId?: string;
}

export interface RhythmApplyOptions {
  compositionId?: string;
  editor?: TimelineEditor;
}

export class RhythmService {
  private readonly evidenceCache = new Map<string, RhythmAnalysisEvidence>();
  private readonly proposalCache = new Map<string, RhythmSnapProposal>();

  constructor(private readonly app: OpenFilmApplication) {}

  private cacheKey(assetId: string, sourceHash: string): string {
    return `${assetId}:${sourceHash.toLowerCase()}`;
  }

  /**
   * Stores validated rhythm analysis evidence bound to the asset ID and source hash.
   */
  public storeEvidence(evidence: RhythmAnalysisEvidence): void {
    const validated = validateRhythmAnalysisEvidence(evidence);
    const key = this.cacheKey(validated.assetId, validated.sourceHash);
    this.evidenceCache.set(key, validated);
  }

  /**
   * Retrieves rhythm evidence for an asset. If sourceHash is not provided,
   * checks against the asset's current contentHash.
   */
  public getEvidence(
    assetId: string,
    sourceHash?: string,
  ): RhythmAnalysisEvidence | undefined {
    if (sourceHash) {
      return this.evidenceCache.get(this.cacheKey(assetId, sourceHash));
    }
    const asset = this.app.catalog.getAsset(assetId);
    if (!asset?.contentHash) {
      return undefined;
    }
    return this.evidenceCache.get(this.cacheKey(assetId, asset.contentHash));
  }

  /**
   * Clears evidence cache.
   */
  public clearEvidence(assetId?: string): void {
    if (!assetId) {
      this.evidenceCache.clear();
      return;
    }
    for (const key of this.evidenceCache.keys()) {
      if (key.startsWith(`${assetId}:`)) {
        this.evidenceCache.delete(key);
      }
    }
  }

  private getComposition(compositionId?: string) {
    const composition = compositionId
      ? (this.app.project.timelines.find((t) => t.id === compositionId) ??
        this.app.project.timelines[0])
      : this.app.project.timelines[0];
    if (!composition) {
      throw new ApplicationError(
        "request.notFound",
        `Timeline '${compositionId ?? "default"}' was not found.`,
      );
    }
    return composition;
  }

  /**
   * Returns projected timeline landmarks for a clip, taking into account
   * trim, speed, and timeline position.
   */
  public getLandmarksForClip(
    clipId: string,
    options?: { compositionId?: string },
  ): readonly TimelineRhythmLandmark[] {
    const composition = this.getComposition(options?.compositionId);
    let targetClip:
      (typeof composition.tracks)[number]["clips"][number] | undefined;
    for (const track of composition.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        targetClip = found;
        break;
      }
    }
    if (!targetClip) {
      throw new ApplicationError(
        "request.notFound",
        `Clip "${clipId}" was not found in composition "${composition.id}".`,
      );
    }

    const asset = this.app.catalog.getAsset(targetClip.assetId);
    if (!asset) {
      throw new ApplicationError(
        "request.notFound",
        `Asset "${targetClip.assetId}" for clip "${clipId}" was not found.`,
      );
    }

    const evidence = this.getEvidence(asset.id, asset.contentHash);
    if (!evidence) {
      return [];
    }

    return projectClipRhythmLandmarks(targetClip, asset, evidence);
  }

  /**
   * Generates an explicit bounded solver snap proposal.
   */
  public proposeSnap(
    clipId: string,
    requestedTime: number,
    options?: RhythmSnapOptions,
  ): RhythmSnapProposal {
    const composition = this.getComposition(options?.compositionId);
    let targetClip:
      (typeof composition.tracks)[number]["clips"][number] | undefined;
    for (const track of composition.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        targetClip = found;
        break;
      }
    }
    if (!targetClip) {
      throw new ApplicationError(
        "request.notFound",
        `Clip "${clipId}" was not found in composition "${composition.id}".`,
      );
    }

    const asset = this.app.catalog.getAsset(targetClip.assetId);
    if (!asset) {
      throw new ApplicationError(
        "request.notFound",
        `Asset "${targetClip.assetId}" for clip "${clipId}" was not found.`,
      );
    }

    const evidence = this.getEvidence(asset.id, asset.contentHash);
    if (!evidence) {
      throw new ApplicationError(
        "rhythm.invalidEvidence",
        `No valid rhythm analysis evidence found for asset "${asset.id}".`,
      );
    }

    const proposal = buildRhythmSnapProposal({
      composition,
      clipId,
      asset,
      evidence,
      targetEdge: options?.targetEdge,
      requestedTime,
      tolerance: options?.tolerance,
      bypass: options?.bypass,
    });

    this.proposalCache.set(proposal.id, proposal);
    return proposal;
  }

  /**
   * Explicitly accepts and applies a rhythm snap proposal through TimelineEditor,
   * creating a single undoable history step.
   */
  public async applySnap(
    proposalOrId: RhythmSnapProposal | string,
    options?: RhythmApplyOptions,
  ): Promise<RhythmSnapProposal> {
    const proposal =
      typeof proposalOrId === "string"
        ? this.proposalCache.get(proposalOrId)
        : validateRhythmSnapProposal(proposalOrId);

    if (!proposal) {
      throw new ApplicationError(
        "rhythm.invalidProposal",
        `Proposal "${typeof proposalOrId === "string" ? proposalOrId : "unknown"}" was not found.`,
      );
    }

    const editor = options?.editor ?? new TimelineEditor(this.app);
    const targetCompId = options?.compositionId ?? proposal.compositionId;
    const state = editor.get(targetCompId);

    await editor.edit(targetCompId, {
      baseRevision: state.revision,
      commands: [
        {
          type: "rhythm.snap",
          proposal,
        },
      ],
    });

    this.proposalCache.delete(proposal.id);
    return proposal;
  }
}
