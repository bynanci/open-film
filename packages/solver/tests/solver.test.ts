import { describe, expect, it } from "vitest";
import type { MediaAsset, Story } from "@openfilm/core";
import { compose } from "../src/index.js";

const asset = (id: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id,
  name: id,
  uri: `file:///${id}.jpg`,
  mediaType: "image",
  tags: [],
  state: {},
  metadata: {},
  ...patch,
});
const story = (patch: Partial<Story> = {}): Story => ({
  id: "s",
  title: "Archive",
  targetDuration: 12,
  maxDuration: 15,
  beats: [{ id: "b", title: "Sequence" }],
  ...patch,
});
const ids = (composition: ReturnType<typeof compose>): string[] =>
  composition.tracks
    .flatMap((track) => track.clips)
    .map((clip) => clip.assetId);

describe("generic composition constraints", () => {
  it("fits the maximum, favors rated media, obeys source bounds, and excludes rejected assets", () => {
    const assets = [
      asset("low", { rating: 0 }),
      asset("best", { rating: 5 }),
      asset("bad", { state: { rejected: true } }),
      asset("short", { mediaType: "video", duration: 0.5, rating: 5 }),
    ];
    const result = compose(
      story({ targetDuration: 4, maxDuration: 4 }),
      assets,
    );
    expect(result.duration).toBeLessThanOrEqual(4);
    expect(ids(result)).toContain("best");
    expect(ids(result)).not.toContain("bad");
    for (const clip of result.tracks.flatMap((track) => track.clips))
      if (clip.assetId === "short")
        expect(clip.sourceOut).toBeLessThanOrEqual(0.5);
  });
  it("preserves explicit order and includes locked media without repetition", () => {
    const result = compose(
      story({
        beats: [
          {
            id: "b",
            title: "Sequence",
            selectedAssetIds: ["b", "a"],
            candidateAssetIds: ["a", "b", "c"],
          },
        ],
      }),
      [asset("a"), asset("b"), asset("c", { state: { locked: true } })],
    );
    expect(ids(result).indexOf("b")).toBeLessThan(ids(result).indexOf("a"));
    expect(ids(result)).toContain("c");
    expect(new Set(ids(result)).size).toBe(ids(result).length);
  });
  it("reserves scarce overlapping candidates so each beat can meet its minimum", () => {
    const result = compose(
      story({
        targetDuration: 4,
        maxDuration: 4,
        beats: [
          {
            id: "first",
            title: "First",
            minDuration: 2,
            candidateAssetIds: ["a", "b"],
          },
          {
            id: "last",
            title: "Last",
            minDuration: 2,
            candidateAssetIds: ["a"],
          },
        ],
      }),
      [asset("a", { rating: 5 }), asset("b")],
    );
    const clips = result.tracks.flatMap((track) => track.clips);
    expect(clips.find((clip) => clip.beatId === "last")?.assetId).toBe("a");
    expect(
      clips
        .filter((clip) => clip.beatId === "first")
        .reduce((sum, clip) => sum + clip.timelineDuration, 0),
    ).toBeGreaterThanOrEqual(2);
  });
  it("returns actionable failures for locked/rejected conflicts and impossible duration", () => {
    expect(() =>
      compose(story(), [
        asset("a", { state: { rejected: true, locked: true } }),
      ]),
    ).toThrow("Unreject");
    expect(() =>
      compose(
        story({
          maxDuration: 1,
          targetDuration: 1,
          beats: [{ id: "b", title: "Sequence", selectedAssetIds: ["a", "b"] }],
        }),
        [asset("a"), asset("b")],
      ),
    ).toThrow("Increase the maximum");
    expect(() =>
      compose(
        story({ beats: [{ id: "b", title: "Sequence", minDuration: 10 }] }),
        [asset("v", { mediaType: "video", duration: 2 })],
      ),
    ).toThrow("Add candidates");
  });
  it("enforces must-exclude and reports inclusion contradictions", () => {
    const beat = {
      id: "b",
      title: "Sequence",
      constraints: [{ type: "must-exclude" as const, assetIds: ["a"] }],
    };
    expect(
      ids(compose(story({ beats: [beat] }), [asset("a"), asset("b")])),
    ).toEqual(["b"]);
    expect(() =>
      compose(story({ beats: [{ ...beat, selectedAssetIds: ["a"] }] }), [
        asset("a"),
      ]),
    ).toThrow("both includes and excludes");
  });
  it("obeys explicit chronology and refuses conflicting manual order", () => {
    const assets = [
      asset("a", { capturedAt: "2022-01-01T00:00:00Z" }),
      asset("b", { capturedAt: "2020-01-01T00:00:00Z" }),
    ];
    expect(
      ids(
        compose(
          story({
            beats: [
              {
                id: "b",
                title: "Sequence",
                constraints: [{ type: "chronological" }],
              },
            ],
          }),
          assets,
        ),
      ),
    ).toEqual(["b", "a"]);
    expect(() =>
      compose(
        story({
          beats: [
            {
              id: "b",
              title: "Sequence",
              selectedAssetIds: ["a", "b"],
              constraints: [{ type: "chronological" }],
            },
          ],
        }),
        assets,
      ),
    ).toThrow("conflicting asset orders");
  });
  it("requires each must-include asset exactly once and enforces maximum beat duration", () => {
    expect(() =>
      compose(
        story({
          beats: [
            { id: "1", title: "One", selectedAssetIds: ["a"] },
            {
              id: "2",
              title: "Two",
              constraints: [{ type: "must-include", assetIds: ["a"] }],
            },
          ],
        }),
        [asset("a")],
      ),
    ).toThrow("more than one beat");
    const result = compose(
      story({
        beats: [
          {
            id: "1",
            title: "One",
            maxDuration: 2,
            candidateAssetIds: ["a", "b"],
          },
          { id: "2", title: "Two", minDuration: 4, candidateAssetIds: ["c"] },
        ],
      }),
      [asset("a"), asset("b"), asset("c")],
    );
    expect(
      result.tracks
        .flatMap((track) => track.clips)
        .filter((clip) => clip.beatId === "1")
        .reduce((sum, clip) => sum + clip.timelineDuration, 0),
    ).toBeLessThanOrEqual(2);
  });
  it("places locked media across constrained candidate pools without stealing the only eligible beat", () => {
    const result = compose(
      story({
        targetDuration: 2,
        maxDuration: 2,
        beats: [
          {
            id: "1",
            title: "One",
            maxDuration: 1,
            candidateAssetIds: ["a", "b"],
          },
          { id: "2", title: "Two", maxDuration: 1, candidateAssetIds: ["a"] },
        ],
      }),
      [
        asset("a", { state: { locked: true } }),
        asset("b", { state: { locked: true } }),
      ],
    );
    expect(result.duration).toBe(2);
    expect(
      result.tracks[0]!.clips.find((clip) => clip.beatId === "2")?.assetId,
    ).toBe("a");
  });
  it("selects source lengths that can meet a beat minimum within the global duration maximum", () => {
    const result = compose(
      story({
        targetDuration: 0.5,
        maxDuration: 0.5,
        beats: [{ id: "1", title: "One", minDuration: 0.5 }],
      }),
      [
        asset("image", { rating: 5 }),
        asset("video", { mediaType: "video", duration: 0.5, rating: 0 }),
      ],
    );
    expect(ids(result)).toEqual(["video"]);
    expect(result.duration).toBe(0.5);
  });
});
