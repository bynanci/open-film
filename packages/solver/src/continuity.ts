// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { createHash } from "node:crypto";
import {
  type Clip,
  type MediaAsset,
  type PhotoLayout,
  type PhotoMotion,
  type StoryBeat,
  type ContinuityDiagnostic,
  type ContinuityOverride,
  type ContinuityProposal,
  validateContinuityProposal,
} from "@openfilm/core";
import {
  applyTimelineCommand,
  TimelineEditingError,
  type EditorDocument,
  type TimelineCommand,
} from "./editing.js";

export interface ContinuityAnalysisOptions {
  existingOverrides?: ContinuityOverride[];
  brief?: string;
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
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

interface SceneInfo {
  beat: StoryBeat;
  clips: Clip[];
  duration: number;
  motionPreset?: string;
  density: number; // cues or items per minute
  hasShotScale: boolean;
  hasEyeline: boolean;
  hasScreenDirection: boolean;
}

export function analyzeContinuity(
  document: EditorDocument,
  assets: MediaAsset[],
  options: ContinuityAnalysisOptions = {},
): ContinuityProposal {
  if (
    !document ||
    !document.story ||
    !document.composition ||
    !Array.isArray(document.story.beats) ||
    !Array.isArray(document.composition.tracks)
  ) {
    throw new TimelineEditingError(
      "Valid story and composition are required for continuity analysis.",
    );
  }

  const assetMap = new Map<string, MediaAsset>();
  for (const asset of assets) {
    assetMap.set(asset.id, asset);
  }

  // 1. Group primary video clips by beat / scene
  const videoTracks = document.composition.tracks.filter(
    (t) => t.type === "video",
  );
  const allVideoClips = videoTracks.flatMap((t) => t.clips);

  // Calculate timeline-wide cues (graphics, captions, audio overlays)
  const totalGraphicScenes = document.composition.graphicScenes?.length ?? 0;
  const totalCaptions =
    document.composition.captionTracks?.reduce(
      (sum, t) => sum + (t.cues?.length ?? 0),
      0,
    ) ?? 0;

  const scenes: SceneInfo[] = [];

  for (const beat of document.story.beats) {
    const beatClips = allVideoClips
      .filter((clip) => clip.beatId === beat.id)
      .sort((a, b) => a.timelineStart - b.timelineStart);

    let duration = beatClips.reduce(
      (sum, clip) => sum + clip.timelineDuration,
      0,
    );
    if (duration <= 0 && beat.targetDuration && beat.targetDuration > 0) {
      duration = beat.targetDuration;
    }

    // Motion preset of tail clip or predominant clip
    let motionPreset: string | undefined = undefined;
    for (const clip of beatClips) {
      const motion = (clip as unknown as Record<string, unknown>).motion as
        PhotoMotion | undefined;
      if (motion?.preset) {
        motionPreset = motion.preset;
      }
    }

    // Check shot metadata on assets
    let hasShotScale = false;
    let hasEyeline = false;
    let hasScreenDirection = false;

    for (const clip of beatClips) {
      const asset = assetMap.get(clip.assetId);
      if (asset?.metadata) {
        if (asset.metadata["shotScale"]) hasShotScale = true;
        if (asset.metadata["eyeline"]) hasEyeline = true;
        if (asset.metadata["screenDirection"]) hasScreenDirection = true;
      }
    }

    // Estimate visual & item density
    const minutes = Math.max(0.1, duration / 60);
    const sceneItemCount =
      beatClips.length +
      (totalGraphicScenes > 0
        ? totalGraphicScenes / document.story.beats.length
        : 0) +
      (totalCaptions > 0 ? totalCaptions / document.story.beats.length : 0);
    const density = sceneItemCount / minutes;

    scenes.push({
      beat,
      clips: beatClips,
      duration,
      motionPreset,
      density,
      hasShotScale,
      hasEyeline,
      hasScreenDirection,
    });
  }

  const overridesMap = new Map<string, ContinuityOverride>();
  if (options.existingOverrides) {
    for (const ov of options.existingOverrides) {
      overridesMap.set(ov.diagnosticId, ov);
    }
  }

  const diagnostics: ContinuityDiagnostic[] = [];

  // 2. Compare adjacent scenes
  for (let i = 0; i < scenes.length - 1; i++) {
    const curr = scenes[i]!;
    const next = scenes[i + 1]!;

    const affectedClipIds = [
      ...curr.clips.map((c) => c.id),
      ...next.clips.map((c) => c.id),
    ];

    // A. Check for missing shot language
    if (
      !curr.hasShotScale ||
      !curr.hasEyeline ||
      !next.hasShotScale ||
      !next.hasEyeline
    ) {
      const diagId = sha256(
        `missingShotLanguage:${curr.beat.id}:${next.beat.id}`,
      );
      const existing = overridesMap.get(diagId);

      diagnostics.push({
        id: diagId,
        code: "continuity.missingShotLanguage",
        severity: "manual-review",
        fromSceneId: curr.beat.id,
        toSceneId: next.beat.id,
        fromBeatId: curr.beat.id,
        toBeatId: next.beat.id,
        affectedClipIds,
        evidence: `Shot-scale, eyeline, and screen direction evidence is absent between scene '${curr.beat.title}' and '${next.beat.title}'. Human editorial review required.`,
        metrics: {
          missingEvidence: ["shot-scale", "eyeline", "screen-direction"],
        },
        advisoryGuidance: {
          suggestion:
            "Verify framing, eye gaze matching, and screen direction across the cut before final release conforming.",
        },
        status: existing
          ? existing.action === "override"
            ? "overridden"
            : "dismissed"
          : "pending",
        userNote: existing?.userNote,
      });
    }

    // B. Check for motion clash
    if (curr.motionPreset && next.motionPreset) {
      const p1 = curr.motionPreset;
      const p2 = next.motionPreset;

      const isPanClash = p1 === "pan" && p2 === "pan";

      if (isPanClash) {
        const diagId = sha256(`motionClash:${curr.beat.id}:${next.beat.id}`);
        const existing = overridesMap.get(diagId);

        diagnostics.push({
          id: diagId,
          code: "continuity.motionClash",
          severity: "warning",
          fromSceneId: curr.beat.id,
          toSceneId: next.beat.id,
          fromBeatId: curr.beat.id,
          toBeatId: next.beat.id,
          affectedClipIds,
          evidence: `Opposing or jarring motion transition: scene '${curr.beat.title}' (${p1}) directly cuts to '${next.beat.title}' (${p2}) without easing or hold.`,
          metrics: {
            motionDelta: {
              fromPreset: p1,
              toPreset: p2,
              clashReason: "opposing-pans",
              deltaScore: 0.8,
            },
          },
          advisoryGuidance: {
            emotionalShift:
              "Abrupt horizontal movement continuation across scene cut can cause disorientation.",
            suggestion:
              "Consider softening the tail clip motion to 'hold' or inserting a transition.",
            suggestedDirection: "hold",
            suggestedAction: next.clips[0]
              ? {
                  clipId: next.clips[0].id,
                  kind: "motion",
                  value: "hold",
                }
              : undefined,
          },
          status: existing
            ? existing.action === "override"
              ? "overridden"
              : "dismissed"
            : "pending",
          userNote: existing?.userNote,
        });
      }
    }

    // C. Check duration / pacing delta
    const d1 = curr.duration;
    const d2 = next.duration;
    if (d1 > 0 && d2 > 0) {
      const ratio = Math.max(d1, d2) / Math.min(d1, d2);
      if (ratio >= 3.5) {
        const diagId = sha256(
          `durationMismatch:${curr.beat.id}:${next.beat.id}`,
        );
        const existing = overridesMap.get(diagId);

        diagnostics.push({
          id: diagId,
          code: "continuity.durationMismatch",
          severity: ratio >= 5.0 ? "warning" : "advisory",
          fromSceneId: curr.beat.id,
          toSceneId: next.beat.id,
          fromBeatId: curr.beat.id,
          toBeatId: next.beat.id,
          affectedClipIds,
          evidence: `Abrupt pacing shift: scene '${curr.beat.title}' (${d1.toFixed(1)}s) and scene '${next.beat.title}' (${d2.toFixed(1)}s) have a ${ratio.toFixed(1)}x duration disparity.`,
          metrics: {
            durationDelta: {
              fromDuration: d1,
              toDuration: d2,
              ratio,
              pacingMismatch: true,
            },
          },
          advisoryGuidance: {
            emotionalShift:
              ratio >= 5.0
                ? "Drastic rhythm deceleration or acceleration can disrupt narrative flow."
                : "Noticeable pacing shift between adjacent beats.",
            suggestion:
              "Rebalance scene durations closer to story beat target guidelines.",
          },
          status: existing
            ? existing.action === "override"
              ? "overridden"
              : "dismissed"
            : "pending",
          userNote: existing?.userNote,
        });
      }
    }

    // D. Check visual density spike
    if (curr.density > 0 && next.density > 0) {
      const densityRatio =
        Math.max(curr.density, next.density) /
        Math.min(curr.density, next.density);
      if (densityRatio >= 3.0) {
        const diagId = sha256(`densitySpike:${curr.beat.id}:${next.beat.id}`);
        const existing = overridesMap.get(diagId);

        diagnostics.push({
          id: diagId,
          code: "continuity.densitySpike",
          severity: "advisory",
          fromSceneId: curr.beat.id,
          toSceneId: next.beat.id,
          fromBeatId: curr.beat.id,
          toBeatId: next.beat.id,
          affectedClipIds,
          evidence: `Visual density surge: scene '${curr.beat.title}' (${curr.density.toFixed(1)} items/min) and scene '${next.beat.title}' (${next.density.toFixed(1)} items/min) differ by ${densityRatio.toFixed(1)}x.`,
          metrics: {
            densityDelta: {
              fromDensity: curr.density,
              toDensity: next.density,
              ratio: densityRatio,
              spike: true,
            },
          },
          advisoryGuidance: {
            suggestion:
              "Ensure captions, graphics, and visual elements do not overwhelm adjacent quieter scenes.",
          },
          status: existing
            ? existing.action === "override"
              ? "overridden"
              : "dismissed"
            : "pending",
          userNote: existing?.userNote,
        });
      }
    }
  }

  // Calculate summary counts
  const motionIssues = diagnostics.filter(
    (d) => d.code === "continuity.motionClash",
  ).length;
  const durationIssues = diagnostics.filter(
    (d) => d.code === "continuity.durationMismatch",
  ).length;
  const densityIssues = diagnostics.filter(
    (d) => d.code === "continuity.densitySpike",
  ).length;
  const manualReviewsRequired = diagnostics.filter(
    (d) => d.severity === "manual-review",
  ).length;

  const baseRevision = sha256(
    canonicalStringify({
      story: document.story,
      composition: document.composition,
    }),
  );
  const contextSignature = sha256(
    canonicalStringify({
      beatsCount: document.story.beats.length,
      tracksCount: document.composition.tracks.length,
      duration: document.composition.duration,
      brief: options.brief ?? "",
    }),
  );

  const proposalId = sha256(
    `continuityProposal:${document.story.id}:${document.composition.id}:${baseRevision}:${contextSignature}:${diagnostics.length}`,
  );

  const proposal: ContinuityProposal = {
    version: 1,
    id: proposalId,
    storyId: document.story.id,
    compositionId: document.composition.id,
    baseRevision,
    contextSignature,
    diagnostics,
    summary: {
      totalDiagnostics: diagnostics.length,
      motionIssues,
      durationIssues,
      densityIssues,
      manualReviewsRequired,
    },
    createdAt: new Date().toISOString(),
  };

  return validateContinuityProposal(proposal);
}

export function applyContinuityOverrides(
  document: EditorDocument,
  assets: MediaAsset[],
  proposal: ContinuityProposal,
  overrides: ContinuityOverride[],
): { document: EditorDocument; appliedActions: unknown[] } {
  validateContinuityProposal(proposal);

  const currentRevision = sha256(
    canonicalStringify({
      story: document.story,
      composition: document.composition,
    }),
  );
  if (currentRevision !== proposal.baseRevision) {
    throw new TimelineEditingError(
      "Continuity proposal is stale; timeline or story has changed.",
    );
  }

  let nextDoc = JSON.parse(JSON.stringify(document)) as EditorDocument;
  const appliedActions: unknown[] = [];

  const diagnosticMap = new Map<string, ContinuityDiagnostic>();
  for (const d of proposal.diagnostics) {
    diagnosticMap.set(d.id, d);
  }

  for (const override of overrides) {
    const diag = diagnosticMap.get(override.diagnosticId);
    if (!diag) continue;

    if (override.action === "accept-direction") {
      const suggested =
        override.suggestedDirection ??
        diag.advisoryGuidance?.suggestedDirection;
      const targetClipId =
        diag.advisoryGuidance?.suggestedAction?.clipId ??
        diag.affectedClipIds[0];

      if (suggested && targetClipId) {
        // Find clip to verify not locked
        let foundClip: Clip | undefined = undefined;
        for (const track of nextDoc.composition.tracks) {
          foundClip = track.clips.find((c) => c.id === targetClipId);
          if (foundClip) break;
        }

        if (foundClip?.locked) {
          throw new TimelineEditingError(
            `Cannot apply suggested direction to locked clip '${targetClipId}'.`,
          );
        }

        let cmd: TimelineCommand | undefined = undefined;
        if (
          suggested === "hold" ||
          suggested === "push-in" ||
          suggested === "pan"
        ) {
          const motion: PhotoMotion = {
            version: 1,
            preset: suggested,
            easing: "ease-in-out",
            from: { scale: 1, x: 0, y: 0 },
            to: { scale: suggested === "push-in" ? 1.06 : 1, x: 0, y: 0 },
          };
          cmd = {
            type: "presentation",
            clipId: targetClipId,
            motion,
          };
        } else if (suggested === "contain" || suggested === "hero") {
          const layout: PhotoLayout = {
            version: 1,
            preset: suggested,
          };
          cmd = {
            type: "presentation",
            clipId: targetClipId,
            layout,
          };
        }

        if (cmd) {
          nextDoc = applyTimelineCommand(nextDoc, assets, cmd, {
            origin: "automatic",
          });
          appliedActions.push({
            diagnosticId: diag.id,
            clipId: targetClipId,
            suggestedDirection: suggested,
            command: cmd,
          });
        }
      }
    }
  }

  return { document: nextDoc, appliedActions };
}
