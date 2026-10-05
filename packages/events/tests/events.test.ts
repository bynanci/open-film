import { describe, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import {
  clusterEvents,
  findDuplicates,
  perceptualDistance,
} from "../src/index.js";

function asset(id: string, patch: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    name: id,
    uri: `file:///${id}.jpg`,
    mediaType: "image",
    tags: [],
    state: {},
    metadata: {},
    ...patch,
  };
}

describe("duplicate grouping", () => {
  it("groups exact hashes and close perceptual fingerprints without double reporting identical groups", () => {
    const groups = findDuplicates([
      asset("a", { contentHash: "same", perceptualHash: "0000000000000000" }),
      asset("b", { contentHash: "same", perceptualHash: "0000000000000000" }),
      asset("c", { perceptualHash: "0000000000000001" }),
      asset("d", { perceptualHash: "ffffffffffffffff" }),
    ]);
    expect(groups.find((group) => group.kind === "exact")?.assetIds).toEqual([
      "a",
      "b",
    ]);
    expect(
      groups.find((group) => group.kind === "perceptual")?.assetIds,
    ).toEqual(["a", "b", "c"]);
  });
  it("ignores malformed and incompatible fingerprints instead of inventing duplicates", () => {
    expect(perceptualDistance("oops", "oops")).toBeUndefined();
    expect(perceptualDistance("00", "0000")).toBeUndefined();
    expect(
      findDuplicates([
        asset("a", { perceptualHash: "oops" }),
        asset("b", { perceptualHash: "oops" }),
      ]),
    ).toEqual([]);
  });
  it("is deterministic regardless of library input order", () => {
    const assets = [
      asset("z", { contentHash: "x" }),
      asset("a", { contentHash: "x" }),
    ];
    expect(findDuplicates(assets)).toEqual(
      findDuplicates([...assets].reverse()),
    );
  });
});

describe("events", () => {
  it("uses time and geographic separation with stable chronological order", () => {
    const assets = [
      asset("c", {
        capturedAt: "2020-01-01T00:20:00Z",
        gps: { latitude: 50, longitude: 0 },
      }),
      asset("b", {
        capturedAt: "2020-01-01T00:10:00Z",
        gps: { latitude: 0, longitude: 0 },
      }),
      asset("a", {
        capturedAt: "2020-01-01T00:00:00Z",
        gps: { latitude: 0, longitude: 0 },
      }),
      asset("unknown"),
    ];
    expect(clusterEvents(assets).map((event) => event.assetIds)).toEqual([
      ["a", "b"],
      ["c"],
      ["unknown"],
    ]);
    expect(clusterEvents(assets)).toEqual(clusterEvents([...assets].reverse()));
  });
  it("allows similarity to support a modest time gap without overriding remote GPS", () => {
    const assets = [
      asset("a", {
        capturedAt: "2020-01-01T00:00:00Z",
        perceptualHash: "0000000000000000",
      }),
      asset("b", {
        capturedAt: "2020-01-01T02:00:00Z",
        perceptualHash: "0000000000000001",
      }),
    ];
    expect(clusterEvents(assets)).toHaveLength(1);
    expect(clusterEvents(assets, { maxSpanSeconds: 3600 })).toHaveLength(2);
  });
  it("calculates longitude across the date line", () => {
    const result = clusterEvents([
      asset("a", {
        capturedAt: "2020-01-01T00:00:00Z",
        gps: { latitude: 0, longitude: 179.95 },
      }),
      asset("b", {
        capturedAt: "2020-01-01T00:01:00Z",
        gps: { latitude: 0, longitude: -179.95 },
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(Math.abs(result[0]!.location!.longitude)).toBeCloseTo(180);
  });
});
