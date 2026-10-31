// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { describe, expect, it } from "vitest";
import {
  type Composition,
  type MediaAsset,
  type ProjectTimebaseV1,
  type Story,
} from "@openfilm/core";
import {
  buildMicroPreviewProposal,
  sampleMicroPreviewFrame,
  TimelineEditingError,
  type EditorDocument,
} from "../src/index.js";

const timebase: ProjectTimebaseV1 = {
  version: 1,
  rateNumerator: 30,
  rateDenominator: 1,
  dropFrame: false,
};

function createFixture(): { document: EditorDocument; assets: MediaAsset[] } {
  const assets: MediaAsset[] = [
    {
      id: "asset-1",
      uri: "file:///media/video1.mp4",
      mediaType: "video",
      name: "Video 1",
      duration: 10,
      tags: [],
      state: {},
      metadata: {},
    },
    {
      id: "asset-2",
      uri: "file:///media/video2.mp4",
      mediaType: "video",
      name: "Video 2",
      duration: 10,
      tags: [],
      state: {},
      metadata: {},
    },
  ];

  const story: Story = {
    id: "story-1",
    title: "Test Story",
    beats: [
      { id: "beat-1", title: "Scene 1", targetDuration: 4 },
      { id: "beat-2", title: "Scene 2", targetDuration: 4 },
    ],
  };

  const composition: Composition = {
    id: "comp-1",
    storyId: "story-1",
    duration: 8.0,
    tracks: [
      {
        id: "v1",
        type: "video",
        clips: [
          {
            id: "clip-1",
            assetId: "asset-1",
            beatId: "beat-1",
            timelineStart: 0,
            timelineDuration: 4.0,
            sourceIn: 0,
            sourceOut: 4.0,
          },
          {
            id: "clip-2",
            assetId: "asset-2",
            beatId: "beat-2",
            timelineStart: 4.0,
            timelineDuration: 4.0,
            sourceIn: 0,
            sourceOut: 4.0,
          },
        ],
      },
    ],
  };

  return { document: { story, composition }, assets };
}

describe("buildMicroPreviewProposal", () => {
  it("calculates bounded previous-2s and current-3s window correctly", () => {
    const { document } = createFixture();
    const proposal = buildMicroPreviewProposal(document, {
      targetClipId: "clip-2",
      transition: {
        type: "dip-to-black",
        duration: 1.0,
      },
    });

    expect(proposal.targetClipId).toBe("clip-2");
    expect(proposal.cutTime).toBe(4.0);
    // 4.0 - 2.0 = 2.0
    expect(proposal.previewStart).toBe(2.0);
    // 4.0 + 3.0 = 7.0
    expect(proposal.previewEnd).toBe(7.0);
    expect(proposal.previewDuration).toBe(5.0);
    expect(proposal.transition.type).toBe("dip-to-black");
  });

  it("clamps preview window at timeline boundaries", () => {
    const { document } = createFixture();
    // Shift clip-2 to 1.0s cut time
    document.composition.tracks[0]!.clips[0]!.timelineDuration = 1.0;
    document.composition.tracks[0]!.clips[1]!.timelineStart = 1.0;

    const proposal = buildMicroPreviewProposal(document, {
      targetClipId: "clip-2",
      transition: {
        type: "dip-to-white",
        duration: 0.5,
      },
    });

    expect(proposal.cutTime).toBe(1.0);
    // Clamped at 0 (1.0 - 2.0 = -1 -> 0)
    expect(proposal.previewStart).toBe(0);
    // 1.0 + 3.0 = 4.0
    expect(proposal.previewEnd).toBe(4.0);
    expect(proposal.previewDuration).toBe(4.0);
  });

  it("fails closed on non-existent clip", () => {
    const { document } = createFixture();
    expect(() =>
      buildMicroPreviewProposal(document, {
        targetClipId: "missing-clip",
        transition: { type: "crossfade", duration: 1.0 },
      }),
    ).toThrow(TimelineEditingError);
  });

  it("fails closed when transition duration exceeds clip duration", () => {
    const { document } = createFixture();
    expect(() =>
      buildMicroPreviewProposal(document, {
        targetClipId: "clip-2",
        transition: { type: "dip-to-black", duration: 5.0 }, // clip duration is 4.0s
      }),
    ).toThrow(TimelineEditingError);
  });
});

describe("sampleMicroPreviewFrame with Dip-to-Black and Dip-to-White", () => {
  it("samples exact first, midpoint (100% black), and last frames for Dip-to-Black", () => {
    const { document, assets } = createFixture();
    const proposal = buildMicroPreviewProposal(document, {
      targetClipId: "clip-2",
      transition: {
        type: "dip-to-black",
        duration: 1.0,
      },
    });

    // Preview window is [2.0, 7.0]. Cut is at 4.0s (offset 2.0s in preview).
    // Midpoint of transition is at 4.0 + 0.5 = 4.5s (offset 2.5s in preview).
    // Transition end is at 4.0 + 1.0 = 5.0s (offset 3.0s in preview).

    // 1. First frame before transition: offset = 0 (t = 2.0s)
    const firstFrame = sampleMicroPreviewFrame(proposal, assets, 0, timebase);
    expect(firstFrame.primary?.clip.id).toBe("clip-1");
    expect(firstFrame.transitionOverlay).toBeUndefined();

    // 2. Exact cut point: offset = 2.0s (t = 4.0s)
    const cutFrame = sampleMicroPreviewFrame(proposal, assets, 2.0, timebase);
    expect(cutFrame.transitionOverlay).toBeDefined();
    expect(cutFrame.transitionOverlay!.color).toBe("black");
    expect(cutFrame.transitionOverlay!.opacity).toBe(0);
    expect(cutFrame.primary?.clip.id).toBe("clip-1");

    // 3. Exact midpoint: offset = 2.5s (t = 4.5s)
    const midFrame = sampleMicroPreviewFrame(proposal, assets, 2.5, timebase);
    expect(midFrame.transitionOverlay).toBeDefined();
    expect(midFrame.transitionOverlay!.color).toBe("black");
    expect(midFrame.transitionOverlay!.opacity).toBe(1.0); // 100% black!

    // 4. Exact last frame of transition: offset = 3.0s (t = 5.0s)
    const endTransitionFrame = sampleMicroPreviewFrame(
      proposal,
      assets,
      3.0,
      timebase,
    );
    expect(endTransitionFrame.primary?.clip.id).toBe("clip-2");

    // 5. Normal playback after transition: offset = 4.0s (t = 6.0s)
    const afterFrame = sampleMicroPreviewFrame(proposal, assets, 4.0, timebase);
    expect(afterFrame.primary?.clip.id).toBe("clip-2");
    expect(afterFrame.transitionOverlay).toBeUndefined();
  });

  it("samples exact midpoint (100% white) for Dip-to-White", () => {
    const { document, assets } = createFixture();
    const proposal = buildMicroPreviewProposal(document, {
      targetClipId: "clip-2",
      transition: {
        type: "dip-to-white",
        duration: 0.8,
      },
    });

    // Preview window is [2.0, 7.0]. Cut is at 4.0s (offset 2.0s).
    // Midpoint is at 4.0 + 0.4 = 4.4s (offset 2.4s).
    const midFrame = sampleMicroPreviewFrame(proposal, assets, 2.4, timebase);
    expect(midFrame.transitionOverlay).toBeDefined();
    expect(midFrame.transitionOverlay!.color).toBe("white");
    expect(midFrame.transitionOverlay!.opacity).toBe(1.0); // 100% white!
  });

  it("preserves existing crossfade semantics without transitionOverlay", () => {
    const { document, assets } = createFixture();
    const proposal = buildMicroPreviewProposal(document, {
      targetClipId: "clip-2",
      transition: {
        type: "crossfade",
        duration: 1.0,
      },
    });

    // Crossfade does not use color overlay; uses clip opacity
    const midFrame = sampleMicroPreviewFrame(proposal, assets, 2.5, timebase);
    expect(midFrame.transitionOverlay).toBeUndefined();
    // In crossfade, incoming clip has opacity proportional to progress
    const incomingClip = midFrame.visual.find((v) => v.clip.id === "clip-2");
    expect(incomingClip).toBeDefined();
    expect(incomingClip!.opacity).toBeGreaterThan(0);
    expect(incomingClip!.opacity).toBeLessThan(1);
  });
});
