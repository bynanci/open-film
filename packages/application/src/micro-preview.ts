// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import {
  ApplicationError,
  resolveProjectTimebase,
  type MediaAsset,
  type ResolvedSequenceFrame,
  type SceneMicroPreviewProposal,
  type TransitionType,
  fnv1a64Mix,
} from "@openfilm/core";
import {
  buildMicroPreviewProposal,
  sampleMicroPreviewFrame,
  type EditorDocument,
} from "@openfilm/solver";
import { TimelineEditor } from "./editor.js";
import type { OpenFilmApplication } from "./index.js";

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalStringify(
            (value as Record<string, unknown>)[k],
          )}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface MicroPreviewApplyOptions {
  compositionId?: string;
  editor?: TimelineEditor;
}

export class MicroPreviewService {
  private readonly cachedProposals = new Map<
    string,
    SceneMicroPreviewProposal
  >();

  constructor(private readonly app: OpenFilmApplication) {}

  private getStoryAndComposition(compositionId?: string) {
    const composition = compositionId
      ? (this.app.project.timelines.find((t) => t.id === compositionId) ??
        this.app.project.timelines[0])
      : this.app.project.timelines[0];
    if (!composition) {
      throw new ApplicationError(
        "request.notFound",
        `Timeline '${compositionId ?? "default"}' was not found.`,
        404,
      );
    }
    const story =
      this.app.project.stories.find((s) => s.id === composition.storyId) ??
      this.app.project.stories[0];
    if (!story) {
      throw new ApplicationError(
        "request.notFound",
        `Story for timeline '${composition.id}' was not found.`,
        404,
      );
    }
    return { story, composition };
  }

  private collectAssets(): readonly MediaAsset[] {
    const summaries = [...this.app.catalog.iterateAssetSummaries()];
    const assets: MediaAsset[] = [];
    for (const s of summaries) {
      const asset = this.app.catalog.getAsset(s.id);
      if (asset) {
        assets.push(asset);
      }
    }
    return assets;
  }

  async previewAdjacentScenes(
    targetClipId: string,
    transition: { type: TransitionType; duration: number },
    compositionId?: string,
  ): Promise<SceneMicroPreviewProposal>;
  async previewAdjacentScenes(
    first: string,
    second: string | { type: TransitionType; duration: number },
    third?: { type: TransitionType; duration: number } | string,
  ): Promise<SceneMicroPreviewProposal> {
    let compositionId: string | undefined;
    let targetClipId: string;
    let transition: { type: TransitionType; duration: number };

    if (typeof second === "string") {
      compositionId = first;
      targetClipId = second;
      transition = third as { type: TransitionType; duration: number };
    } else {
      targetClipId = first;
      transition = second;
      compositionId = typeof third === "string" ? third : undefined;
    }

    const { story, composition } = this.getStoryAndComposition(compositionId);
    const document: EditorDocument = {
      story,
      composition,
    };

    const proposal = buildMicroPreviewProposal(document, {
      targetClipId,
      transition,
    });

    this.cachedProposals.set(proposal.id, proposal);
    return proposal;
  }

  async seek(
    proposalId: string,
    offsetSeconds: number,
    compositionId?: string,
  ): Promise<ResolvedSequenceFrame>;
  async seek(
    first: string,
    second: string | number,
    third?: number | string,
  ): Promise<ResolvedSequenceFrame> {
    let compositionId: string | undefined;
    let proposalId: string;
    let offsetSeconds: number;

    if (typeof second === "string") {
      compositionId = first;
      proposalId = second;
      offsetSeconds = third as number;
    } else {
      proposalId = first;
      offsetSeconds = second;
      compositionId = typeof third === "string" ? third : undefined;
    }

    const proposal = this.cachedProposals.get(proposalId);
    if (!proposal) {
      throw new ApplicationError(
        "microPreview.staleProposal",
        "Micro-preview proposal is expired or not found. Regenerate preview to continue.",
        409,
      );
    }

    const { story, composition } = this.getStoryAndComposition(compositionId);
    const currentRevision = fnv1a64Mix(
      canonicalStringify({
        story,
        composition,
      }),
    );
    if (currentRevision !== proposal.baseRevision) {
      this.cachedProposals.delete(proposalId);
      throw new ApplicationError(
        "microPreview.staleProposal",
        "Project has changed since micro-preview proposal was created. Regenerate preview.",
        409,
      );
    }

    const timebase = resolveProjectTimebase(this.app.project.settings);
    const assets = this.collectAssets();
    return sampleMicroPreviewFrame(proposal, assets, offsetSeconds, timebase);
  }

  cancel(proposalId: string): void {
    this.cachedProposals.delete(proposalId);
  }

  clearProject(projectId?: string): void {
    if (!projectId) {
      this.cachedProposals.clear();
      return;
    }
    for (const [id, proposal] of this.cachedProposals.entries()) {
      if (proposal.id.includes(projectId)) {
        this.cachedProposals.delete(id);
      }
    }
  }

  clear(): void {
    this.cachedProposals.clear();
  }

  async apply(
    proposalId: string,
    options?: MicroPreviewApplyOptions,
  ): Promise<void>;
  async apply(
    first: string,
    second?: string | MicroPreviewApplyOptions,
    third?: MicroPreviewApplyOptions,
  ): Promise<void> {
    let proposalId: string;
    let options: MicroPreviewApplyOptions | undefined;

    if (typeof second === "string") {
      proposalId = second;
      options = third;
    } else if (second && typeof second === "object") {
      proposalId = first;
      options = second;
    } else {
      proposalId = first;
    }

    const proposal = this.cachedProposals.get(proposalId);
    if (!proposal) {
      throw new ApplicationError(
        "microPreview.staleProposal",
        "Micro-preview proposal is expired or not found. Regenerate preview to continue.",
        409,
      );
    }

    const { composition } = this.getStoryAndComposition(
      options?.compositionId,
    );
    const editor = options?.editor ?? new TimelineEditor(this.app);
    const state = editor.get(composition.id);

    const currentRevision = fnv1a64Mix(
      canonicalStringify({
        story: state.story,
        composition: state.composition,
      }),
    );
    if (currentRevision !== proposal.baseRevision) {
      this.cachedProposals.delete(proposalId);
      throw new ApplicationError(
        "microPreview.staleProposal",
        "Project has changed since micro-preview proposal was created. Regenerate preview.",
        409,
      );
    }

    await editor.edit(composition.id, {
      baseRevision: state.revision,
      commands: [
        {
          type: "transition",
          clipId: proposal.targetClipId,
          transition: proposal.transition.type,
          duration: proposal.transition.duration,
        },
      ],
    });

    this.cachedProposals.delete(proposalId);
  }
}
