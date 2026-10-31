import { describe, expect, it } from "vitest";
import type { Clip, MediaAsset, PhotoMotion } from "@openfilm/core";
import {
  analyzeContinuity,
  applyContinuityOverrides,
  TimelineEditingError,
  type EditorDocument,
} from "../src/index.js";

const photo = (id: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id,
  name: `${id}.jpg`,
  uri: `file:///${id}.jpg`,
  mediaType: "image",
  dimensions: { width: 1920, height: 1080 },
  tags: [],
  metadata: {},
  state: {},
  ...patch,
});

const panMotion: PhotoMotion = {
  version: 1,
  preset: "pan",
  easing: "linear",
  from: { scale: 1.1, x: -50, y: 0 },
  to: { scale: 1.1, x: 50, y: 0 },
};

function fixture(): { doc: EditorDocument; assets: MediaAsset[] } {
  const assets = [photo("asset-1"), photo("asset-2"), photo("asset-3")];

  const doc: EditorDocument = {
    story: {
      id: "story-1",
      title: "Our Story",
      beats: [
        {
          id: "beat-1",
          title: "Introduction",
          intent: "Set out on the journey",
          script: {
            narration: "We set out early in the morning.",
            visualDirection: "Horizontal pan",
          },
          targetDuration: 4,
        },
        {
          id: "beat-2",
          title: "The Climax",
          intent: "Defining moment of truth",
          script: {
            narration: "Everything changed in this moment.",
            visualDirection: "Horizontal pan",
          },
          targetDuration: 4,
        },
        {
          id: "beat-3",
          title: "Resolution",
          intent: "Calm afterglow",
          script: {
            narration: "Looking back at the memories.",
            visualDirection: "Keep still",
          },
          targetDuration: 10,
        },
      ],
    },
    composition: {
      id: "comp-1",
      storyId: "story-1",
      duration: 16,
      tracks: [
        {
          id: "track-video",
          type: "video",
          clips: [
            {
              id: "clip-1",
              assetId: "asset-1",
              beatId: "beat-1",
              timelineStart: 0,
              timelineDuration: 2,
              motion: panMotion,
            } as Clip,
            {
              id: "clip-2",
              assetId: "asset-2",
              beatId: "beat-2",
              timelineStart: 2,
              timelineDuration: 2,
              motion: panMotion,
            } as Clip,
            {
              id: "clip-3",
              assetId: "asset-3",
              beatId: "beat-3",
              timelineStart: 4,
              timelineDuration: 12,
            } as Clip,
          ],
        },
      ],
    },
  };

  return { doc, assets };
}

describe("Continuity Solver Contract", () => {
  it("diagnoses missing shot language as manual-review", () => {
    const { doc, assets } = fixture();
    const proposal = analyzeContinuity(doc, assets);

    const missingReviews = proposal.diagnostics.filter(
      (d) => d.code === "continuity.missingShotLanguage",
    );
    expect(missingReviews.length).toBeGreaterThan(0);
    expect(missingReviews[0]!.severity).toBe("manual-review");
    expect(missingReviews[0]!.metrics.missingEvidence).toContain("shot-scale");
    expect(missingReviews[0]!.evidence).toContain(
      "Human editorial review required",
    );
  });

  it("diagnoses motion clash between opposing pans", () => {
    const { doc, assets } = fixture();
    const proposal = analyzeContinuity(doc, assets);

    const motionClashes = proposal.diagnostics.filter(
      (d) => d.code === "continuity.motionClash",
    );
    expect(motionClashes.length).toBeGreaterThan(0);
    expect(motionClashes[0]!.severity).toBe("warning");
    expect(motionClashes[0]!.advisoryGuidance?.suggestedDirection).toBe("hold");
  });

  it("diagnoses duration disparity between adjacent scenes", () => {
    const { doc, assets } = fixture();
    const proposal = analyzeContinuity(doc, assets);

    const durationMismatches = proposal.diagnostics.filter(
      (d) => d.code === "continuity.durationMismatch",
    );
    expect(durationMismatches.length).toBeGreaterThan(0);
    expect(
      durationMismatches[0]!.metrics.durationDelta?.ratio,
    ).toBeGreaterThanOrEqual(3.5);
  });

  it("preserves existing overrides and marks status accordingly", () => {
    const { doc, assets } = fixture();
    const initial = analyzeContinuity(doc, assets);
    const firstDiag = initial.diagnostics[0];
    expect(firstDiag).toBeDefined();

    const proposalWithOverrides = analyzeContinuity(doc, assets, {
      existingOverrides: [
        {
          diagnosticId: firstDiag!.id,
          action: "override",
          userNote: "Intentional artistic choice by editor",
        },
      ],
    });

    const overriddenDiag = proposalWithOverrides.diagnostics.find(
      (d) => d.id === firstDiag!.id,
    );
    expect(overriddenDiag?.status).toBe("overridden");
    expect(overriddenDiag?.userNote).toBe(
      "Intentional artistic choice by editor",
    );
  });

  it("applies suggested direction override to unlocked clip", () => {
    const { doc, assets } = fixture();
    const proposal = analyzeContinuity(doc, assets);
    const motionDiag = proposal.diagnostics.find(
      (d) => d.code === "continuity.motionClash",
    );
    expect(motionDiag).toBeDefined();

    const { document: nextDoc, appliedActions } = applyContinuityOverrides(
      doc,
      assets,
      proposal,
      [
        {
          diagnosticId: motionDiag!.id,
          action: "accept-direction",
          suggestedDirection: "hold",
        },
      ],
    );

    expect(appliedActions.length).toBe(1);
    const updatedClip = nextDoc.composition.tracks[0]?.clips.find(
      (c) => c.id === "clip-2",
    );
    expect(updatedClip).toBeDefined();
    expect(
      (updatedClip as unknown as Record<string, unknown>).motion,
    ).toMatchObject({
      preset: "hold",
    });
  });

  it("rejects applying suggested direction to locked clip", () => {
    const { doc, assets } = fixture();
    const clipToLock = doc.composition.tracks[0]?.clips[1];
    expect(clipToLock).toBeDefined();
    clipToLock!.locked = true;

    const proposal = analyzeContinuity(doc, assets);
    const motionDiag = proposal.diagnostics.find(
      (d) => d.code === "continuity.motionClash",
    );

    expect(() =>
      applyContinuityOverrides(doc, assets, proposal, [
        {
          diagnosticId: motionDiag!.id,
          action: "accept-direction",
          suggestedDirection: "hold",
        },
      ]),
    ).toThrow(TimelineEditingError);
  });

  it("rejects applying overrides against a stale proposal", () => {
    const { doc, assets } = fixture();
    const proposal = analyzeContinuity(doc, assets);

    // Modify document to invalidate baseRevision
    const modifiedDoc: EditorDocument = {
      ...doc,
      composition: {
        ...doc.composition,
        duration: 99,
      },
    };

    expect(() =>
      applyContinuityOverrides(modifiedDoc, assets, proposal, []),
    ).toThrow(TimelineEditingError);
  });
});
