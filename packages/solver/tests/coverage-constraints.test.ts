// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { MediaAsset, Story, StoryConstraint } from "@openfilm/core";
import { compose } from "../src/index.js";

const asset = (
  id: string,
  mediaType: MediaAsset["mediaType"] = "image",
  patch: Partial<MediaAsset> = {},
): MediaAsset => ({
  id,
  name: id,
  uri: `file:///${id}`,
  mediaType,
  ...(mediaType === "image" ? {} : { duration: 30 }),
  tags: [],
  state: {},
  metadata: {},
  ...patch,
});

const story = (
  constraints: StoryConstraint[],
  patch: Partial<Story> = {},
): Story => ({
  id: "story",
  title: "Reviewable coverage",
  targetDuration: 2,
  maxDuration: 2,
  beats: [
    {
      id: "beat",
      title: "Gathering",
      candidateAssetIds: [
        "everyday",
        "ceremony-a",
        "ceremony-b",
        "person-a",
        "video-a",
        "video-b",
      ],
      constraints,
    },
  ],
  ...patch,
});

const selectedIds = (composition: ReturnType<typeof compose>): string[] =>
  composition.tracks
    .flatMap((track) => track.clips)
    .filter((clip) => clip.beatId === "beat")
    .map((clip) => clip.assetId);

describe("explicit Story coverage constraints", () => {
  it("includes enough manually grouped event and person assets without inferring identities", () => {
    const composition = compose(
      story([
        {
          type: "coverage-group",
          version: 1,
          kind: "event",
          groupId: "event:ceremony",
          label: "Ceremony",
          assetIds: ["ceremony-a", "ceremony-b"],
          minimumCount: 1,
        },
        {
          type: "coverage-group",
          version: 1,
          kind: "person",
          groupId: "person:host",
          label: "Host",
          assetIds: ["person-a"],
          minimumCount: 1,
        },
      ]),
      [
        asset("everyday", "image", { rating: 5 }),
        asset("ceremony-a"),
        asset("ceremony-b"),
        asset("person-a"),
        asset("video-a", "video"),
        asset("video-b", "video"),
      ],
    );

    const ids = selectedIds(composition);
    expect(ids).toContain("ceremony-a");
    expect(ids).toContain("person-a");
  });

  it("uses the intersection of explicit group membership and the beat candidate pool", () => {
    const input = story([
      {
        type: "coverage-group",
        version: 1,
        kind: "event",
        groupId: "event:ceremony",
        label: "Ceremony",
        assetIds: ["outside-pool"],
        minimumCount: 1,
      },
    ]);
    input.beats[0]!.candidateAssetIds = ["everyday"];

    expect(() =>
      compose(input, [asset("everyday"), asset("outside-pool")]),
    ).toThrow(/coverage.*Ceremony.*candidate/i);
  });

  it("requires visual group members even when a selected audio asset shares the group ID", () => {
    const input = story(
      [
        {
          type: "coverage-group",
          version: 1,
          kind: "event",
          groupId: "event:ceremony",
          label: "Ceremony",
          assetIds: ["audio-event"],
          minimumCount: 1,
        },
      ],
      {
        beats: [
          {
            id: "beat",
            title: "Gathering",
            candidateAssetIds: ["audio-event"],
            selectedAssetIds: ["audio-event"],
            constraints: [
              {
                type: "coverage-group",
                version: 1,
                kind: "event",
                groupId: "event:ceremony",
                label: "Ceremony",
                assetIds: ["audio-event"],
                minimumCount: 1,
              },
            ],
          },
        ],
      },
    );

    expect(() => compose(input, [asset("audio-event", "audio")])).toThrow(
      /coverage.*Ceremony.*visual clip/i,
    );
  });

  it("reserves a locked group member for the beat that has a coverage requirement", () => {
    const composition = compose(
      story([], {
        targetDuration: 2,
        maxDuration: 2,
        beats: [
          {
            id: "covered",
            title: "Covered beat",
            minDuration: 1,
            candidateAssetIds: ["locked-event", "flexible"],
            constraints: [
              {
                type: "coverage-group",
                version: 1,
                kind: "event",
                groupId: "event:ceremony",
                label: "Ceremony",
                assetIds: ["locked-event"],
                minimumCount: 1,
              },
            ],
          },
          {
            id: "other",
            title: "Other beat",
            minDuration: 1,
            candidateAssetIds: ["locked-event", "other"],
          },
        ],
      }),
      [
        asset("locked-event", "image", { state: { locked: true } }),
        asset("flexible"),
        asset("other"),
      ],
    );
    const lockedClip = composition.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.assetId === "locked-event");

    expect(lockedClip?.beatId).toBe("covered");
  });

  it("satisfies per-beat image and video counts while respecting each maximum", () => {
    const composition = compose(
      story(
        [
          {
            type: "media-balance",
            version: 1,
            minImages: 1,
            maxImages: 2,
            minVideos: 1,
            maxVideos: 1,
          },
        ],
        { targetDuration: 8, maxDuration: 8 },
      ),
      [
        asset("everyday"),
        asset("ceremony-a"),
        asset("ceremony-b"),
        asset("person-a"),
        asset("video-a", "video"),
        asset("video-b", "video"),
      ],
    );

    const ids = selectedIds(composition);
    expect(
      ids.filter((id) => !id.startsWith("video-")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(ids.filter((id) => id.startsWith("video-")).length).toBe(1);
  });

  it("fails instead of changing selected or locked choices to satisfy an impossible maximum", () => {
    const constraints: StoryConstraint[] = [
      {
        type: "media-balance",
        version: 1,
        maxVideos: 0,
      },
    ];
    const input = story(constraints, {
      beats: [
        {
          id: "beat",
          title: "Gathering",
          candidateAssetIds: ["video-a", "everyday"],
          selectedAssetIds: ["video-a"],
          constraints,
        },
      ],
    });

    expect(() =>
      compose(input, [asset("everyday"), asset("video-a", "video")]),
    ).toThrow(/selected.*video.*maximum/i);
  });

  it("explains when a locked source violates every eligible media maximum", () => {
    const input = story(
      [
        {
          type: "media-balance",
          version: 1,
          maxVideos: 0,
        },
      ],
      {
        targetDuration: 1,
        maxDuration: 1,
        beats: [
          {
            id: "beat",
            title: "Gathering",
            candidateAssetIds: ["locked-video"],
            constraints: [
              {
                type: "media-balance",
                version: 1,
                maxVideos: 0,
              },
            ],
          },
        ],
      },
    );

    expect(() =>
      compose(input, [
        asset("locked-video", "video", { state: { locked: true } }),
      ]),
    ).toThrow(/locked.*video.*media-balance maximum/i);
  });
});
