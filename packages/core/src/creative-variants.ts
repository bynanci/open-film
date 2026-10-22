// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.

import type { Composition, Story } from "./models.js";
import { ProjectValidationError } from "./validation.js";

export const CREATIVE_VARIANT_SCHEMA_VERSION = "1.0.0" as const;

export type CreativeVariantScope =
  | { type: "film" }
  | { type: "section"; targetBeatId: string; sectionTitle?: string };

export interface CreativeVariantModifications {
  durationMultiplier?: number;
  targetBeatId?: string;
  targetDuration?: number;
  replaceAssetIds?: { fromAssetId: string; toAssetId: string }[];
  narration?: string;
  visualDirection?: string;
  unsupportedIntents?: string[];
}

export interface CreativeVariantProvenanceMapping {
  beatMappings: {
    baselineBeatId: string;
    variantBeatId: string;
    role?: string;
  }[];
  clipMappings: {
    baselineClipId: string;
    variantClipId: string;
    trackId: string;
    role?: string;
  }[];
}

export interface CreativeVariantPreservedSection {
  sectionId: string;
  type: "beat" | "clip";
  unchanged: boolean;
}

export interface CreativeVariant {
  schemaVersion: typeof CREATIVE_VARIANT_SCHEMA_VERSION;
  id: string;
  projectId: string;
  name: string;
  description?: string;
  intent: string;
  scope: CreativeVariantScope;
  baselineStoryId: string;
  baselineCompositionId: string;
  derivedStoryId: string;
  derivedCompositionId: string;
  planId?: string;
  runId?: string;
  provenanceMapping: CreativeVariantProvenanceMapping;
  preservedSections: CreativeVariantPreservedSection[];
  modifications: CreativeVariantModifications;
  status: "draft" | "compared" | "adopted" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface CreateVariantInput {
  name: string;
  description?: string;
  intent: string;
  scope: CreativeVariantScope;
  baselineStoryId?: string;
  baselineCompositionId?: string;
  modifications?: CreativeVariantModifications;
}

export interface CreativeVariantBeatDiff {
  baselineBeatId: string;
  variantBeatId: string;
  baselineTitle: string;
  variantTitle: string;
  baselineDuration?: number;
  variantDuration?: number;
  baselineScript?: string;
  variantScript?: string;
  changed: boolean;
}

export interface CreativeVariantClipDiff {
  baselineClipId: string;
  variantClipId: string;
  trackId: string;
  baselineAssetId: string;
  variantAssetId: string;
  baselineDuration: number;
  variantDuration: number;
  changed: boolean;
}

export interface CreativeVariantDiff {
  baselineVariantId: string;
  targetVariantId: string;
  baselineDuration: number;
  targetDuration: number;
  deltaSeconds: number;
  beatDiffs: CreativeVariantBeatDiff[];
  clipDiffs: CreativeVariantClipDiff[];
  summary: {
    beatsTotal: number;
    beatsChanged: number;
    clipsTotal: number;
    clipsChanged: number;
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function fail(path: string, message: string): never {
  throw new ProjectValidationError(path, message);
}

export function validateCreateVariantInput(input: unknown): CreateVariantInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("createVariantInput", "Expected plain object");
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    fail("createVariantInput.name", "Variant name is required");
  }
  if (typeof obj.intent !== "string" || !obj.intent.trim()) {
    fail("createVariantInput.intent", "Variant intent is required");
  }
  if (!obj.scope || typeof obj.scope !== "object" || Array.isArray(obj.scope)) {
    fail("createVariantInput.scope", "Variant scope is required");
  }
  const scopeObj = obj.scope as Record<string, unknown>;
  if (scopeObj.type !== "film" && scopeObj.type !== "section") {
    fail(
      "createVariantInput.scope.type",
      "Scope type must be 'film' or 'section'",
    );
  }
  if (
    scopeObj.type === "section" &&
    (typeof scopeObj.targetBeatId !== "string" || !scopeObj.targetBeatId.trim())
  ) {
    fail(
      "createVariantInput.scope.targetBeatId",
      "Section scope requires targetBeatId",
    );
  }

  const scope: CreativeVariantScope =
    scopeObj.type === "film"
      ? { type: "film" }
      : {
          type: "section",
          targetBeatId: scopeObj.targetBeatId as string,
          sectionTitle:
            typeof scopeObj.sectionTitle === "string"
              ? scopeObj.sectionTitle
              : undefined,
        };

  return {
    name: obj.name.trim(),
    description:
      typeof obj.description === "string" ? obj.description.trim() : undefined,
    intent: obj.intent.trim(),
    scope,
    baselineStoryId:
      typeof obj.baselineStoryId === "string" ? obj.baselineStoryId : undefined,
    baselineCompositionId:
      typeof obj.baselineCompositionId === "string"
        ? obj.baselineCompositionId
        : undefined,
    modifications: obj.modifications as
      CreativeVariantModifications | undefined,
  };
}

export function validateCreativeVariant(candidate: unknown): CreativeVariant {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    fail("creativeVariant", "Expected plain object");
  }
  const obj = candidate as Record<string, unknown>;
  if (obj.schemaVersion !== CREATIVE_VARIANT_SCHEMA_VERSION) {
    fail(
      "creativeVariant.schemaVersion",
      `Expected schemaVersion ${CREATIVE_VARIANT_SCHEMA_VERSION}`,
    );
  }
  if (typeof obj.id !== "string" || !UUID_PATTERN.test(obj.id)) {
    fail("creativeVariant.id", "Expected valid UUID id");
  }
  if (typeof obj.projectId !== "string" || !obj.projectId.trim()) {
    fail("creativeVariant.projectId", "Project ID is required");
  }
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    fail("creativeVariant.name", "Variant name is required");
  }
  if (typeof obj.intent !== "string" || !obj.intent.trim()) {
    fail("creativeVariant.intent", "Variant intent is required");
  }
  if (!obj.scope || typeof obj.scope !== "object") {
    fail("creativeVariant.scope", "Scope object is required");
  }
  if (typeof obj.baselineStoryId !== "string" || !obj.baselineStoryId.trim()) {
    fail("creativeVariant.baselineStoryId", "baselineStoryId is required");
  }
  if (
    typeof obj.baselineCompositionId !== "string" ||
    !obj.baselineCompositionId.trim()
  ) {
    fail(
      "creativeVariant.baselineCompositionId",
      "baselineCompositionId is required",
    );
  }
  if (typeof obj.derivedStoryId !== "string" || !obj.derivedStoryId.trim()) {
    fail("creativeVariant.derivedStoryId", "derivedStoryId is required");
  }
  if (
    typeof obj.derivedCompositionId !== "string" ||
    !obj.derivedCompositionId.trim()
  ) {
    fail(
      "creativeVariant.derivedCompositionId",
      "derivedCompositionId is required",
    );
  }
  if (!obj.provenanceMapping || typeof obj.provenanceMapping !== "object") {
    fail("creativeVariant.provenanceMapping", "provenanceMapping is required");
  }
  if (!Array.isArray(obj.preservedSections)) {
    fail(
      "creativeVariant.preservedSections",
      "preservedSections must be an array",
    );
  }

  const allowedStatuses = ["draft", "compared", "adopted", "archived"];
  if (typeof obj.status !== "string" || !allowedStatuses.includes(obj.status)) {
    fail(
      "creativeVariant.status",
      `Status must be one of: ${allowedStatuses.join(", ")}`,
    );
  }

  return candidate as CreativeVariant;
}

export function compareCreativeVariants(
  variantA: CreativeVariant,
  variantB: CreativeVariant,
  storyA: Story,
  storyB: Story,
  compA: Composition,
  compB: Composition,
): CreativeVariantDiff {
  const mapA = new Map(
    variantA.provenanceMapping.beatMappings.map((m) => [
      m.baselineBeatId,
      m.variantBeatId,
    ]),
  );
  const mapB = new Map(
    variantB.provenanceMapping.beatMappings.map((m) => [
      m.baselineBeatId,
      m.variantBeatId,
    ]),
  );

  const allBaselineBeatIds = new Set([
    ...variantA.provenanceMapping.beatMappings.map((m) => m.baselineBeatId),
    ...variantB.provenanceMapping.beatMappings.map((m) => m.baselineBeatId),
  ]);

  const beatDiffs: CreativeVariantBeatDiff[] = [];
  let beatsChanged = 0;

  for (const baseBeatId of allBaselineBeatIds) {
    const beatAId = mapA.get(baseBeatId) ?? baseBeatId;
    const beatBId = mapB.get(baseBeatId) ?? baseBeatId;

    const beatA = storyA.beats.find((b) => b.id === beatAId);
    const beatB = storyB.beats.find((b) => b.id === beatBId);

    const scriptA = beatA?.script?.narration || "";
    const scriptB = beatB?.script?.narration || "";
    const durA = beatA?.targetDuration;
    const durB = beatB?.targetDuration;

    const changed =
      !beatA ||
      !beatB ||
      beatA.title !== beatB.title ||
      scriptA !== scriptB ||
      durA !== durB ||
      JSON.stringify(beatA.selectedAssetIds) !==
        JSON.stringify(beatB.selectedAssetIds);

    if (changed) beatsChanged++;

    beatDiffs.push({
      baselineBeatId: beatA?.id || "",
      variantBeatId: beatB?.id || "",
      baselineTitle: beatA?.title || "",
      variantTitle: beatB?.title || "",
      baselineDuration: durA,
      variantDuration: durB,
      baselineScript: scriptA,
      variantScript: scriptB,
      changed,
    });
  }

  const clipMapA = new Map(
    variantA.provenanceMapping.clipMappings.map((m) => [
      m.baselineClipId,
      m.variantClipId,
    ]),
  );
  const clipMapB = new Map(
    variantB.provenanceMapping.clipMappings.map((m) => [
      m.baselineClipId,
      m.variantClipId,
    ]),
  );

  const allBaselineClipIds = new Set([
    ...variantA.provenanceMapping.clipMappings.map((m) => m.baselineClipId),
    ...variantB.provenanceMapping.clipMappings.map((m) => m.baselineClipId),
  ]);

  const clipDiffs: CreativeVariantClipDiff[] = [];
  let clipsChanged = 0;

  for (const baseClipId of allBaselineClipIds) {
    const clipAId = clipMapA.get(baseClipId) ?? baseClipId;
    const clipBId = clipMapB.get(baseClipId) ?? baseClipId;

    let clipA: (typeof compA.tracks)[0]["clips"][0] | undefined;
    for (const track of compA.tracks) {
      clipA = track.clips.find((c) => c.id === clipAId);
      if (clipA) break;
    }

    let clipB: (typeof compB.tracks)[0]["clips"][0] | undefined;
    let trackBId = "";
    for (const track of compB.tracks) {
      clipB = track.clips.find((c) => c.id === clipBId);
      if (clipB) {
        trackBId = track.id;
        break;
      }
    }

    const changed =
      !clipA ||
      !clipB ||
      clipA.assetId !== clipB.assetId ||
      Math.abs(clipA.timelineDuration - clipB.timelineDuration) > 0.001 ||
      clipA.sourceIn !== clipB.sourceIn ||
      clipA.sourceOut !== clipB.sourceOut ||
      clipA.locked !== clipB.locked;

    if (changed) clipsChanged++;

    clipDiffs.push({
      baselineClipId: clipA?.id || "",
      variantClipId: clipB?.id || "",
      trackId: trackBId,
      baselineAssetId: clipA?.assetId || "",
      variantAssetId: clipB?.assetId || "",
      baselineDuration: clipA?.timelineDuration || 0,
      variantDuration: clipB?.timelineDuration || 0,
      changed,
    });
  }

  return {
    baselineVariantId: variantA.id,
    targetVariantId: variantB.id,
    baselineDuration: compA.duration,
    targetDuration: compB.duration,
    deltaSeconds: Number((compB.duration - compA.duration).toFixed(3)),
    beatDiffs,
    clipDiffs,
    summary: {
      beatsTotal: storyB.beats.length,
      beatsChanged,
      clipsTotal: clipDiffs.length,
      clipsChanged,
    },
  };
}
