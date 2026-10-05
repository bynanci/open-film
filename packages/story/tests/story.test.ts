import { describe, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { createStory, scoreAsset } from "../src/index.js";

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

describe("explainable offline scoring", () => {
  it("rewards user preference and exposes the evidence", () => {
    const plain = asset("a", { rating: 1 });
    const favorite = asset("b", { rating: 5, state: { favorite: true } });
    expect(scoreAsset(favorite).score).toBeGreaterThan(scoreAsset(plain).score);
    expect(
      scoreAsset(favorite).factors.find((factor) => factor.id === "user-rating")
        ?.reason,
    ).toContain("5 of 5");
    expect(
      scoreAsset(favorite).factors.every((factor) => !!factor.reason),
    ).toBe(true);
  });
  it("makes rejected assets ineligible and discounts duplicates", () => {
    expect(scoreAsset(asset("a", { state: { rejected: true } })).score).toBe(0);
    const a = asset("a", { contentHash: "x" }),
      b = asset("b", { contentHash: "x" });
    expect(
      scoreAsset(a, { assets: [a, b] }).factors.find(
        (factor) => factor.id === "uniqueness",
      )?.score,
    ).toBe(0.25);
  });
  it("accepts configurable weights and validates them", () => {
    expect(() => scoreAsset(asset("a"), { weights: { favorite: -1 } })).toThrow(
      "non-negative",
    );
    expect(
      scoreAsset(asset("a", { tags: ["forest"] }), {
        preferredTags: ["forest"],
      }).factors.find((factor) => factor.id === "tag-relevance")?.score,
    ).toBe(1);
  });
});

describe("generic story creation", () => {
  it("partitions candidates chronologically, excludes rejected assets, and honors duration settings", () => {
    const result = createStory(
      "Archive",
      [
        asset("late", { capturedAt: "2022-01-01T00:00:00Z" }),
        asset("early", { capturedAt: "2020-01-01T00:00:00Z" }),
        asset("middle", { capturedAt: "2021-01-01T00:00:00Z" }),
        asset("bad", { state: { rejected: true } }),
      ],
      { targetDuration: 20, maxDuration: 25 },
    );
    expect(result.beats.flatMap((beat) => beat.candidateAssetIds)).toEqual([
      "early",
      "middle",
      "late",
    ]);
    expect(
      result.beats.reduce((sum, beat) => sum + beat.targetDuration!, 0),
    ).toBe(20);
    expect(result.maxDuration).toBe(25);
  });
  it("rejects inconsistent duration settings", () => {
    expect(() =>
      createStory("Archive", [], { targetDuration: 20, maxDuration: 10 }),
    ).toThrow("target duration exceeds");
  });
});
