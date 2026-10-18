import type {
  EditorDocument,
  SceneDirectionOptions,
  SceneDirectionProposal,
} from "@openfilm/solver";

/** A deterministic, temporary simulation of the saved visual direction. */
export interface DirectionReviewPlan extends SceneDirectionProposal {
  id: string;
  compositionId: string;
  storyId: string;
  baseRevision: string;
  contextSignature: string;
  options: SceneDirectionOptions;
  preview: EditorDocument;
}

/** Commands and snapshots are recomputed from the saved project at acceptance. */
export interface DirectionAcceptanceInput {
  planId: string;
  baseRevision: string;
  contextSignature: string;
  options: SceneDirectionOptions;
  actionIds: string[];
  requestId: string;
}

export type DirectionReviewAcceptance = DirectionAcceptanceInput;

export type { SceneDirectionOptions } from "@openfilm/solver";
