// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { ApplicationError } from "./errors.js";
import { validatePresetStoryPlanContext } from "./presets.js";
import type { IdeaSource } from "./story-graph.js";

export type StoryPlanAssetRole = "hero" | "supporting" | "echo";

export interface StoryPlanAssetReference {
  assetId: string;
  name: string;
  role: StoryPlanAssetRole;
  isEcho?: boolean;
  photoDepthSupported?: boolean;
  photoDepthFallback?: "standard-hold" | "ken-burns";
}

export interface StoryPlanSceneGaps {
  missingAssets?: string[];
  durationConflict?: string;
}

export interface StoryPlanScene {
  sceneId: string;
  beatId?: string;
  title: string;
  intent: string;
  visualDirection: string;
  rationale: string;
  narration?: string;
  targetDuration: number;
  estimatedDuration: number;
  sourceNature: IdeaSource;
  assets: StoryPlanAssetReference[];
  gaps?: StoryPlanSceneGaps;
}

export interface StoryPlanPath {
  nodeIds: string[];
  isAmbiguous: boolean;
  unresolvedAlternatives?: Array<{ fromNodeId: string; candidates: string[] }>;
  cycleDetected?: string[];
}

export interface StoryPlanAcceptanceMapping {
  storyId: string;
  compositionId: string;
  sceneToBeatId: Record<string, string>;
  sceneToClipIds: Record<string, string[]>;
  acceptedAt: string;
}

export interface StoryPlan {
  version: 1;
  id: string;
  storyId: string;
  title: string;
  targetDuration: number;
  maxDuration: number;
  inputRevision: string;
  sourceSignature: string;
  path: StoryPlanPath;
  scenes: StoryPlanScene[];
  unsupportedIntents: string[];
  conflicts: string[];
  acceptanceMapping?: StoryPlanAcceptanceMapping;
  transition: "cut" | "crossfade" | "dip-to-black" | "dip-to-white";
  createdAt: string;
  presetContext?: import("./presets.js").PresetStoryPlanContext;
}

export interface StoryPlanOptions {
  title?: string;
  targetDuration?: number;
  maxDuration?: number;
  transition?: "cut" | "crossfade" | "dip-to-black" | "dip-to-white";
  selectedNodeIds?: string[];
  preferPhotoDepth?: boolean;
  brief?: string;
}

export function validateStoryPlan(value: unknown): StoryPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError("story.invalid", "StoryPlan must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new ApplicationError("story.invalid", "StoryPlan version must be 1.");
  }
  if (typeof raw.id !== "string" || !raw.id.trim()) {
    throw new ApplicationError(
      "story.invalid",
      "StoryPlan must have a non-empty id.",
    );
  }
  if (typeof raw.storyId !== "string" || !raw.storyId.trim()) {
    throw new ApplicationError(
      "story.invalid",
      "StoryPlan must have a non-empty storyId.",
    );
  }
  if (typeof raw.title !== "string") {
    throw new ApplicationError(
      "story.invalid",
      "StoryPlan title must be a string.",
    );
  }
  if (typeof raw.targetDuration !== "number" || raw.targetDuration <= 0) {
    throw new ApplicationError(
      "story.invalid",
      "StoryPlan targetDuration must be greater than 0.",
    );
  }
  if (
    typeof raw.maxDuration !== "number" ||
    raw.maxDuration < raw.targetDuration
  ) {
    throw new ApplicationError(
      "story.invalid",
      "StoryPlan maxDuration must be >= targetDuration.",
    );
  }
  if (
    typeof raw.inputRevision !== "string" ||
    typeof raw.sourceSignature !== "string"
  ) {
    throw new ApplicationError(
      "story.invalid",
      "StoryPlan must have inputRevision and sourceSignature strings.",
    );
  }
  if (
    !raw.path ||
    typeof raw.path !== "object" ||
    !Array.isArray((raw.path as StoryPlanPath).nodeIds)
  ) {
    throw new ApplicationError(
      "story.invalid",
      "StoryPlan must have a valid path object.",
    );
  }
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) {
    throw new ApplicationError(
      "story.invalid",
      "StoryPlan must contain at least one scene.",
    );
  }

  for (const scene of raw.scenes as StoryPlanScene[]) {
    if (!scene || typeof scene !== "object") {
      throw new ApplicationError(
        "story.invalid",
        "Scene entry must be an object.",
      );
    }
    if (typeof scene.sceneId !== "string" || !scene.sceneId.trim()) {
      throw new ApplicationError(
        "story.invalid",
        "Scene must have a valid sceneId.",
      );
    }
    if (typeof scene.title !== "string" || !scene.title.trim()) {
      throw new ApplicationError(
        "story.invalid",
        "Scene must have a valid title.",
      );
    }
    if (typeof scene.intent !== "string") {
      throw new ApplicationError(
        "story.invalid",
        "Scene must have an intent string.",
      );
    }
    if (typeof scene.visualDirection !== "string") {
      throw new ApplicationError(
        "story.invalid",
        "Scene must have a visualDirection string.",
      );
    }
    if (typeof scene.rationale !== "string") {
      throw new ApplicationError(
        "story.invalid",
        "Scene must have a rationale string.",
      );
    }
    if (typeof scene.targetDuration !== "number" || scene.targetDuration <= 0) {
      throw new ApplicationError(
        "story.invalid",
        "Scene targetDuration must be greater than 0.",
      );
    }
    if (
      typeof scene.estimatedDuration !== "number" ||
      scene.estimatedDuration <= 0
    ) {
      throw new ApplicationError(
        "story.invalid",
        "Scene estimatedDuration must be greater than 0.",
      );
    }
    if (
      !["user-memory", "planned", "wish", "unknown"].includes(
        scene.sourceNature,
      )
    ) {
      throw new ApplicationError(
        "story.invalid",
        `Invalid scene sourceNature '${scene.sourceNature}'.`,
      );
    }
    if (!Array.isArray(scene.assets)) {
      throw new ApplicationError(
        "story.invalid",
        "Scene assets must be an array.",
      );
    }
  }

  if (!Array.isArray(raw.unsupportedIntents)) {
    throw new ApplicationError(
      "story.invalid",
      "StoryPlan unsupportedIntents must be an array.",
    );
  }
  if (!Array.isArray(raw.conflicts)) {
    throw new ApplicationError(
      "story.invalid",
      "StoryPlan conflicts must be an array.",
    );
  }
  if (
    raw.transition !== "cut" &&
    raw.transition !== "crossfade" &&
    raw.transition !== "dip-to-black" &&
    raw.transition !== "dip-to-white"
  ) {
    throw new ApplicationError(
      "story.invalid",
      "StoryPlan transition must be 'cut', 'crossfade', 'dip-to-black', or 'dip-to-white'.",
    );
  }

  if (raw.presetContext !== undefined)
    validatePresetStoryPlanContext(raw.presetContext);
  return raw as unknown as StoryPlan;
}
