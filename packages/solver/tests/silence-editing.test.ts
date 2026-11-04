// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  createSilenceCutProposal,
  type AudioActivityEvidence,
  type MediaAsset,
} from "@openfilm/core";
import {
  applyTimelineCommand,
  type EditorDocument,
  type TimelineCommand,
} from "../src/index.js";

const sourceHash = "a".repeat(64);
const assets: MediaAsset[] = [
  {
    id: "source",
    name: "source",
    uri: "file:///source.mp4",
    mediaType: "video",
    duration: 10,
    contentHash: sourceHash,
    tags: [],
    state: {},
    metadata: {},
  },
];
const evidence: AudioActivityEvidence = {
  version: 1,
  assetId: "source",
  sourceHash,
  duration: 10,
  sampleRate: 48000,
  windowSeconds: 0.02,
  audioStreamIndex: 1,
  parameters: { thresholdDb: -40, minimumSilenceSeconds: 0.2 },
  silenceIntervals: [
    { start: 2, end: 3 },
    { start: 5, end: 6 },
  ],
  provenance: {
    providerId: "test",
    version: "1",
    sourceHash,
    createdAt: "2026-11-04T00:00:00Z",
  },
};
const context = {
  origin: "automatic" as const,
  timebase: {
    version: 1 as const,
    rateNumerator: 30,
    rateDenominator: 1,
    dropFrame: false,
  },
};
function document(): EditorDocument {
  return {
    story: {
      id: "story",
      title: "Interview",
      beats: [
        { id: "beat", title: "Interview", candidateAssetIds: ["source"] },
      ],
    },
    composition: {
      id: "composition",
      storyId: "story",
      duration: 10,
      tracks: [
        {
          id: "main",
          type: "video",
          clips: [
            {
              id: "clip",
              beatId: "beat",
              assetId: "source",
              timelineStart: 0,
              timelineDuration: 10,
              sourceIn: 0,
              sourceOut: 10,
            },
          ],
        },
      ],
    },
  };
}
function command(before: EditorDocument): TimelineCommand {
  return {
    type: "silence.ripple",
    reviewId: "review-id",
    proposal: createSilenceCutProposal(before.composition, evidence, {
      baseRevision: "revision",
      paddingSeconds: 0,
      assets,
    }),
  };
}

describe("silence ripple solver command", () => {
  it("applies source-bound cuts without synthesizing transcript evidence or changing story", () => {
    const before = document(),
      snapshot = structuredClone(before);
    const after = applyTimelineCommand(
      before,
      assets,
      command(before),
      context,
    );
    expect(before).toEqual(snapshot);
    expect(after.story).toEqual(before.story);
    expect(after.composition.duration).toBe(8);
    expect(
      after.composition.tracks[0]!.clips.map((clip) => [
        clip.sourceIn,
        clip.sourceOut,
      ]),
    ).toEqual([
      [0, 2],
      [3, 5],
      [6, 10],
    ]);
    expect(
      new Set(after.composition.tracks[0]!.clips.map((clip) => clip.id)).size,
    ).toBe(3);
  });

  it("keeps batch behavior equivalent and detached when a later command fails", () => {
    const before = document(),
      snapshot = structuredClone(before),
      cut = command(before);
    expect(
      applyTimelineCommand(
        before,
        assets,
        { type: "batch", commands: [cut] },
        context,
      ),
    ).toEqual(applyTimelineCommand(before, assets, cut, context));
    expect(() =>
      applyTimelineCommand(
        before,
        assets,
        {
          type: "batch",
          commands: [cut, { type: "delete", clipId: "missing" }],
        },
        context,
      ),
    ).toThrow();
    expect(before).toEqual(snapshot);
  });

  it.each(["track", "clip", "source", "pin"] as const)(
    "rechecks %s protection after proposal creation",
    (protection) => {
      const before = document(),
        cut = command(before),
        library = structuredClone(assets);
      if (protection === "track") before.composition.tracks[0]!.locked = true;
      if (protection === "clip")
        before.composition.tracks[0]!.clips[0]!.locked = true;
      if (protection === "source") library[0]!.state.locked = true;
      if (protection === "pin")
        before.composition.tracks[0]!.clips[0]!.userOverrides = {
          version: 1,
          isUserPinned: true,
          lockedAttributes: ["timing", "inOutRange"],
        };
      expect(() => applyTimelineCommand(before, library, cut, context)).toThrow(
        /locked|pinned/i,
      );
      expect(() =>
        applyTimelineCommand(
          before,
          library,
          { type: "batch", commands: [cut] },
          context,
        ),
      ).toThrow(/locked|pinned/i);
    },
  );
});
