import type {
  GraphicSceneAgentAction,
  GraphicSceneAgentConflict,
} from "@openfilm/solver";

export interface GraphicSceneAgentRequest {
  baseRevision: string;
  sceneId: string;
  nodeIds: string[];
  instruction: string;
  mode: "local" | "provider";
}

/** A temporary, revision-bound proposal; it is never saved to the project. */
export interface GraphicSceneAgentPlan {
  id: string;
  compositionId: string;
  baseRevision: string;
  sceneId: string;
  nodeIds: string[];
  instruction: string;
  source: "local" | "provider";
  actions: GraphicSceneAgentAction[];
  conflicts: GraphicSceneAgentConflict[];
}

export interface GraphicSceneAgentAcceptance {
  planId: string;
  baseRevision: string;
  actionIds: string[];
  requestId: string;
}
