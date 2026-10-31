// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import {
  ApplicationError,
  MAX_CONTINUITY_RECEIPTS,
  fnv1a64Mix,
  validateContinuityReceipt,
  type ContinuityOverride,
  type ContinuityProposal,
  type ContinuityReceipt,
  type OpenFilmProject,
} from "@openfilm/core";
import {
  analyzeContinuity,
  applyContinuityOverrides,
  type ContinuityAnalysisOptions,
  type EditorDocument,
} from "@openfilm/solver";
import type { OpenFilmApplication } from "./index.js";

export interface ContinuityAcceptanceInput {
  proposalId: string;
  requestId: string;
  baseRevision: string;
  contextSignature: string;
  overrides: ContinuityOverride[];
}

function computeDigest(data: string): string {
  return fnv1a64Mix(data);
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class ContinuityService {
  constructor(private readonly app: OpenFilmApplication) {}

  private getStoryAndComposition(storyId: string, compositionId?: string) {
    const story = this.app.project.stories.find((s) => s.id === storyId);
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story '${storyId}' was not found.`,
      );
    }
    const composition = compositionId
      ? this.app.project.timelines.find((t) => t.id === compositionId)
      : this.app.project.timelines.find((t) => t.storyId === storyId);

    if (!composition) {
      throw new ApplicationError(
        "timeline.notFound",
        `Timeline for story '${storyId}' was not found.`,
      );
    }
    return { story, composition };
  }

  previewProposal(
    storyId: string,
    compositionId?: string,
    options: ContinuityAnalysisOptions = {},
  ): { proposal: ContinuityProposal; preview: EditorDocument } {
    const { story, composition } = this.getStoryAndComposition(
      storyId,
      compositionId,
    );
    const assets = this.app.catalog.listAssets();
    const doc: EditorDocument = { story, composition };

    const proposal = analyzeContinuity(doc, assets, options);
    return { proposal, preview: doc };
  }

  async applyOverrides(
    storyId: string,
    compositionId: string,
    input: ContinuityAcceptanceInput,
  ): Promise<{
    project: OpenFilmProject;
    receipt: ContinuityReceipt;
    proposal: ContinuityProposal;
  }> {
    if (!input || typeof input !== "object") {
      throw new ApplicationError(
        "request.invalid",
        "Acceptance input must be an object.",
      );
    }
    if (typeof input.requestId !== "string" || !input.requestId.trim()) {
      throw new ApplicationError(
        "request.invalid",
        "Valid requestId is required.",
      );
    }
    if (!Array.isArray(input.overrides)) {
      throw new ApplicationError(
        "request.invalid",
        "Overrides must be an array.",
      );
    }

    const { story, composition } = this.getStoryAndComposition(
      storyId,
      compositionId,
    );
    const assets = this.app.catalog.listAssets();
    const doc: EditorDocument = { story, composition };

    // Idempotent replay check
    const existingReceipt = this.app.project.continuityReceipts?.find(
      (r) => r.requestId === input.requestId,
    );
    if (existingReceipt) {
      if (
        existingReceipt.storyId !== storyId ||
        existingReceipt.compositionId !== compositionId ||
        existingReceipt.proposalId !== input.proposalId
      ) {
        throw new ApplicationError(
          "continuity.conflict",
          "Continuity receipt request ID belongs to a different proposal or project target.",
          409,
        );
      }
      const proposal = analyzeContinuity(doc, assets, {
        existingOverrides: existingReceipt.overrides,
      });
      return {
        project: this.app.project,
        receipt: existingReceipt,
        proposal,
      };
    }

    // Capacity limit check
    if (
      (this.app.project.continuityReceipts?.length ?? 0) >=
      MAX_CONTINUITY_RECEIPTS
    ) {
      throw new ApplicationError(
        "request.tooLarge",
        `Continuity receipt limit of ${MAX_CONTINUITY_RECEIPTS} has been reached.`,
      );
    }

    // Generate fresh proposal
    const freshProposal = analyzeContinuity(doc, assets, {
      existingOverrides: input.overrides,
    });

    if (
      freshProposal.baseRevision !== input.baseRevision ||
      freshProposal.contextSignature !== input.contextSignature
    ) {
      throw new ApplicationError(
        "continuity.staleProposal",
        "Continuity proposal is stale; story or timeline has changed.",
        409,
      );
    }

    // Apply any direction overrides to timeline
    const { document: nextDoc, appliedActions } = applyContinuityOverrides(
      doc,
      assets,
      freshProposal,
      input.overrides,
    );

    const nextProject = structuredClone(this.app.project);

    // If timeline changed, update timeline in nextProject
    if (appliedActions.length > 0) {
      const timelineIdx = nextProject.timelines.findIndex(
        (t) => t.id === compositionId,
      );
      if (timelineIdx !== -1) {
        nextProject.timelines[timelineIdx] = nextDoc.composition;
      }
    }

    const fingerprint = computeDigest(canonicalStringify(input.overrides));
    const acceptedRevision = computeDigest(
      canonicalStringify(nextDoc.composition),
    );

    const receipt: ContinuityReceipt = {
      version: 1,
      proposalId: freshProposal.id,
      requestId: input.requestId,
      fingerprint,
      compositionId,
      storyId,
      baseRevision: freshProposal.baseRevision,
      contextSignature: freshProposal.contextSignature,
      acceptedAt: new Date().toISOString(),
      acceptedRevision,
      overrides: input.overrides,
      diagnosticsCount: freshProposal.diagnostics.length,
    };

    validateContinuityReceipt(receipt);

    (nextProject.continuityReceipts ??= []).push(receipt);

    // Apply project changes through editor if active, or direct assignment
    this.app.project.timelines = nextProject.timelines;
    this.app.project.continuityReceipts = nextProject.continuityReceipts;

    await this.app.save();

    return {
      project: this.app.project,
      receipt,
      proposal: freshProposal,
    };
  }
}
