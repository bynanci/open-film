// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { applyTimelineCommand, type EditorDocument } from "../src/index.js";
import {
  resolveProjectTimebase,
  type MediaAsset,
  type CoverageProposal,
} from "@openfilm/core";

const context = {
  origin: "direct" as const,
  timebase: resolveProjectTimebase({
    width: 1920,
    height: 1080,
    frameRate: 30,
  }),
};

const assets: MediaAsset[] = [
  {
    id: "a-primary",
    name: "Primary.mp4",
    uri: "file:///primary.mp4",
    mediaType: "video",
    duration: 30,
    tags: [],
    state: {},
    metadata: { "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] } },
  },
  {
    id: "a-broll",
    name: "BRoll.mp4",
    uri: "file:///broll.mp4",
    mediaType: "video",
    duration: 15,
    tags: [],
    state: {},
    metadata: { "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] } },
  },
];

function createDoc(): EditorDocument {
  return {
    story: {
      id: "story-1",
      title: "Story",
      beats: [
        {
          id: "beat-1",
          title: "Beat 1",
          candidateAssetIds: ["a-primary", "a-broll"],
        },
      ],
    },
    composition: {
      id: "comp-1",
      storyId: "story-1",
      duration: 10,
      tracks: [
        {
          id: "track-main",
          type: "video",
          clips: [
            {
              id: "clip-main",
              assetId: "a-primary",
              beatId: "beat-1",
              timelineStart: 0,
              timelineDuration: 10,
              sourceIn: 0,
              sourceOut: 10,
            },
          ],
        },
        {
          id: "track-overlay",
          type: "overlay",
          timing: "overlay",
          clips: [
            {
              id: "clip-broll",
              assetId: "a-broll",
              timelineStart: 2,
              timelineDuration: 4,
              sourceIn: 0,
              sourceOut: 4,
            },
          ],
        },
      ],
    },
  };
}

describe("coverage timeline commands", () => {
  it("coverage.set-clip sets and clears coverage on a clip", () => {
    const initial = createDoc();
    const updated = applyTimelineCommand(
      initial,
      assets,
      {
        type: "coverage.set-clip",
        clipId: "clip-broll",
        coverage: {
          version: 1,
          role: "b-roll-overlay",
          primaryClipId: "clip-main",
          audioPolicy: { version: 1, mode: "keep-primary" },
        },
      },
      context,
    );

    const bRollClip = updated.composition.tracks[1]!.clips[0]!;
    expect(bRollClip.coverage).toEqual({
      version: 1,
      role: "b-roll-overlay",
      primaryClipId: "clip-main",
      audioPolicy: { version: 1, mode: "keep-primary" },
    });

    // Coverage audio bindings should be automatically computed
    expect(updated.composition.coverageAudioBindings).toBeDefined();
    expect(updated.composition.coverageAudioBindings).toHaveLength(1);
    expect(updated.composition.coverageAudioBindings![0]).toMatchObject({
      primaryClipId: "clip-main",
      secondaryClipId: "clip-broll",
      startSample: 2 * 48000,
      endSample: 6 * 48000,
      policy: { version: 1, mode: "keep-primary" },
    });

    // Clear coverage
    const cleared = applyTimelineCommand(
      updated,
      assets,
      {
        type: "coverage.set-clip",
        clipId: "clip-broll",
        coverage: null,
      },
      context,
    );
    expect(cleared.composition.tracks[1]!.clips[0]!.coverage).toBeUndefined();
    expect(cleared.composition.coverageAudioBindings).toBeUndefined();
  });

  it("coverage.apply-proposal applies a reviewed coverage proposal atomically", () => {
    const initial = createDoc();
    const proposal: CoverageProposal = {
      version: 1,
      id: "proposal-1",
      compositionId: "comp-1",
      primaryClipId: "clip-main",
      bRollClipId: "clip-broll",
      role: "b-roll-overlay",
      audioPolicy: {
        version: 1,
        mode: "mix-secondary",
        role: "ambience",
        gain: 0.3,
      },
      timelineStart: 2,
      timelineDuration: 4,
      evidence: {
        primaryRange: { timelineStart: 0, timelineDuration: 10 },
        bRollRange: { timelineStart: 2, timelineDuration: 4 },
        overlapStart: 2,
        overlapDuration: 4,
      },
    };

    const next = applyTimelineCommand(
      initial,
      assets,
      { type: "coverage.apply-proposal", proposal },
      context,
    );

    const mainClip = next.composition.tracks[0]!.clips[0]!;
    const bRollClip = next.composition.tracks[1]!.clips[0]!;

    expect(mainClip.coverage).toEqual({
      version: 1,
      role: "primary-narrative",
    });
    expect(bRollClip.coverage).toEqual({
      version: 1,
      role: "b-roll-overlay",
      primaryClipId: "clip-main",
      audioPolicy: {
        version: 1,
        mode: "mix-secondary",
        role: "ambience",
        gain: 0.3,
      },
    });

    expect(next.composition.coverageAudioBindings).toHaveLength(1);
    expect(next.composition.coverageAudioBindings![0]!.policy).toEqual({
      version: 1,
      mode: "mix-secondary",
      role: "ambience",
      gain: 0.3,
    });
  });

  it("deleting a primary clip purges coverage bindings and primary references", () => {
    const docWithTwoClips: EditorDocument = {
      story: {
        id: "story-1",
        title: "Story",
        beats: [
          {
            id: "beat-1",
            title: "Beat 1",
            candidateAssetIds: ["a-primary", "a-broll"],
          },
        ],
      },
      composition: {
        id: "comp-1",
        storyId: "story-1",
        duration: 10,
        tracks: [
          {
            id: "track-main",
            type: "video",
            clips: [
              {
                id: "clip-main-1",
                assetId: "a-primary",
                beatId: "beat-1",
                timelineStart: 0,
                timelineDuration: 5,
                sourceIn: 0,
                sourceOut: 5,
              },
              {
                id: "clip-main-2",
                assetId: "a-primary",
                beatId: "beat-1",
                timelineStart: 5,
                timelineDuration: 5,
                sourceIn: 5,
                sourceOut: 10,
              },
            ],
          },
          {
            id: "track-overlay",
            type: "overlay",
            timing: "overlay",
            clips: [
              {
                id: "clip-broll",
                assetId: "a-broll",
                timelineStart: 1,
                timelineDuration: 2,
                sourceIn: 0,
                sourceOut: 2,
              },
            ],
          },
        ],
      },
    };

    const withCoverage = applyTimelineCommand(
      docWithTwoClips,
      assets,
      {
        type: "coverage.set-clip",
        clipId: "clip-broll",
        coverage: {
          version: 1,
          role: "b-roll-overlay",
          primaryClipId: "clip-main-1",
        },
      },
      { origin: "automatic", timebase: context.timebase },
    );

    expect(withCoverage.composition.coverageAudioBindings).toHaveLength(1);

    // Delete primary clip 1
    const afterDelete = applyTimelineCommand(
      withCoverage,
      assets,
      { type: "delete", clipId: "clip-main-1" },
      { origin: "automatic", timebase: context.timebase },
    );

    // The old binding referencing clip-main-1 was purged
    expect(
      afterDelete.composition.coverageAudioBindings?.some(
        (b) => b.primaryClipId === "clip-main-1",
      ),
    ).toBeFalsy();
    // Secondary clip primaryClipId reference to clip-main-1 is cleared
    const bRollClip = afterDelete.composition.tracks[1]!.clips[0]!;
    expect(bRollClip.coverage?.primaryClipId).toBeUndefined();
    // Re-bound automatically to clip-main-2 which moved under the overlay
    expect(afterDelete.composition.coverageAudioBindings).toHaveLength(1);
    expect(
      afterDelete.composition.coverageAudioBindings![0]!.primaryClipId,
    ).toBe("clip-main-2");
  });

  it("coverage.set-bindings directly manages coverageAudioBindings", () => {
    const initial = createDoc();
    const withBindings = applyTimelineCommand(
      initial,
      assets,
      {
        type: "coverage.set-bindings",
        bindings: [
          {
            version: 1,
            bindingId: "bind-custom",
            compositionId: "comp-1",
            primaryClipId: "clip-main",
            secondaryClipId: "clip-broll",
            startSample: 96000,
            endSample: 192000,
            policy: { version: 1, mode: "keep-primary" },
          },
        ],
      },
      context,
    );

    expect(withBindings.composition.coverageAudioBindings).toHaveLength(1);
    expect(withBindings.composition.coverageAudioBindings![0]!.bindingId).toBe(
      "bind-custom",
    );

    // Clear bindings
    const cleared = applyTimelineCommand(
      withBindings,
      assets,
      { type: "coverage.set-bindings", bindings: null },
      context,
    );
    expect(cleared.composition.coverageAudioBindings).toBeUndefined();
  });
});
