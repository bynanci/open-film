import { describe, expect, it } from "vitest";
import * as core from "@openfilm/core";
import type { Composition, MediaAsset } from "@openfilm/core";
import { planCollectCoverage } from "../../packages/application/src/collect-coverage.js";
const hash = "a".repeat(64);
const asset = (
  id = "video",
  mediaType: MediaAsset["mediaType"] = "video",
): MediaAsset => ({
  id,
  uri: `file:///synthetic/${id}`,
  name: id,
  mediaType,
  contentHash: hash,
  duration: 30,
  tags: [],
  state: {},
  metadata: {},
});
const clip = (id: string, sourceIn: number, sourceOut: number) => ({
  id,
  assetId: "video",
  sourceIn,
  sourceOut,
  timelineStart: 0,
  timelineDuration: sourceOut - sourceIn,
});
function fixture(
  overrides: Partial<Parameters<typeof planCollectCoverage>[0]> = {},
) {
  const composition: Composition = {
    id: "film",
    storyId: "story",
    duration: 20,
    tracks: [
      {
        id: "picture",
        type: "video",
        clips: [
          clip("first", 3, 5),
          clip("overlap", 6, 8),
          clip("last", 23, 26),
        ],
      },
    ],
  };
  const input: Parameters<typeof planCollectCoverage>[0] = {
    projectId: "project",
    revision: hash,
    baselinePlanId: "b".repeat(64),
    options: {
      version: 1 as const,
      mode: "trimmed-originals" as const,
      handlesSeconds: 2,
    },
    assets: [asset()],
    compositions: [composition],
    opaqueAssetIds: [],
    evidenceBoundAssetIds: [],
    ...overrides,
  };
  return {
    ...input,
    options: { ...input.options },
    assets: [...input.assets],
    compositions: [...input.compositions],
    opaqueAssetIds: [...input.opaqueAssetIds],
    evidenceBoundAssetIds: [...input.evidenceBoundAssetIds],
  };
}
describe("strict derived Collect coverage options", () => {
  it("normalizes only documented defaults", () => {
    expect(
      core.validateCollectDeliveryOptions({
        version: 1,
        mode: "trimmed-originals",
      }),
    ).toEqual({ version: 1, mode: "trimmed-originals", handlesSeconds: 2 });
    expect(
      core.validateCollectDeliveryOptions({
        version: 1,
        mode: "originals",
        handlesSeconds: 0,
      }),
    ).toEqual({ version: 1, mode: "originals", handlesSeconds: 0 });
  });
  it.each([
    null,
    [],
    {},
    { version: 2, mode: "originals" },
    { version: 1, mode: "proxy" },
    { version: 1, mode: "originals", handlesSeconds: -1 },
    { version: 1, mode: "originals", handlesSeconds: 11 },
    { version: 1, mode: "originals", handlesSeconds: NaN },
    { version: 1, mode: "originals", handlesSeconds: Infinity },
    { version: 1, mode: "originals", outputPath: "/arbitrary" },
    { version: 1, mode: "originals", consent: true },
  ])("rejects unsafe or unsupported options %j", (input) => {
    expect(() => core.validateCollectDeliveryOptions(input)).toThrow(
      expect.objectContaining({ code: "request.invalid" }),
    );
  });
});
it("unions overlapping handles while retaining disjoint windows and stable source-use IDs", () => {
  const input = fixture();
  const original = structuredClone(input);
  const plan = planCollectCoverage(input);
  expect(plan).toMatchObject({
    version: 1,
    projectId: "project",
    revision: hash,
    baselinePlanId: "b".repeat(64),
    status: "review-only",
    executable: false,
    quality: "requires-lossless-parity",
    mode: "trimmed-originals",
  });
  expect(plan.entries[0]).toMatchObject({
    assetId: "video",
    sourceHash: hash,
    action: "trim-candidate",
    ranges: [
      { start: 1, end: 10 },
      { start: 21, end: 28 },
    ],
    retainedSeconds: 16,
    removedSeconds: 14,
  });
  expect(plan.entries[0]!.uses.map((use) => use.clipId).sort()).toEqual([
    "first",
    "last",
    "overlap",
  ]);
  expect(input).toEqual(original);
});
it("clamps handles to the real duration and reuses speed/default source-range semantics", () => {
  const input = fixture();
  input.compositions[0]!.tracks[0]!.clips = [
    {
      id: "fast",
      assetId: "video",
      sourceIn: 1,
      timelineStart: 0,
      timelineDuration: 15,
      transform: { speed: 2 },
    },
  ];
  const entry = planCollectCoverage(input).entries[0]!;
  expect(entry.uses[0]).toMatchObject({ sourceIn: 1, sourceOut: 30, speed: 2 });
  expect(entry.ranges).toEqual([{ start: 0, end: 30 }]);
  expect(entry.removedSeconds).toBe(0);
});
it("is deterministic under source, track and clip enumeration changes", () => {
  const input = fixture({ assets: [asset("z"), asset()] });
  const expected = planCollectCoverage(input);
  input.assets.reverse();
  input.compositions[0]!.tracks[0]!.clips.reverse();
  expect(planCollectCoverage(input)).toEqual(expected);
});
it.each([
  "locked",
  "clip-locked",
  "opaque",
  "evidence",
  "missing-duration",
  "invalid-range",
  "raw360",
])(
  "preserves full originals for %s without inventing eligibility",
  (reason) => {
    const input = fixture();
    if (reason === "locked") input.assets[0]!.state.locked = true;
    if (reason === "clip-locked")
      input.compositions[0]!.tracks[0]!.clips[0]!.locked = true;
    if (reason === "opaque") input.opaqueAssetIds = ["video"];
    if (reason === "evidence") input.evidenceBoundAssetIds = ["video"];
    if (reason === "missing-duration") delete input.assets[0]!.duration;
    if (reason === "invalid-range")
      input.compositions[0]!.tracks[0]!.clips[0]!.sourceIn = 35;
    if (reason === "raw360") input.assets[0]!.mediaType = "360-video";
    const entry = planCollectCoverage(input).entries[0]!;
    expect(entry.action).toBe("copy-original");
    expect(entry.reasons).not.toEqual([]);
  },
);
it("distinguishes offline candidates from original-quality delivery", () => {
  const input = fixture();
  input.options = { version: 1, mode: "offline-proxies", handlesSeconds: 2 };
  const result = planCollectCoverage(input);
  expect(result.quality).toBe("offline-only");
  expect(result.executable).toBe(false);
  expect(result.entries[0]!.action).toBe("offline-candidate");
  expect(result.entries[0]!.ranges).toEqual([{ start: 0, end: 30 }]);
});
it("keeps originals as an explicit immutable default even for incomplete timing", () => {
  const input = fixture();
  input.options = { version: 1, mode: "originals", handlesSeconds: 2 };
  delete input.assets[0]!.duration;
  expect(planCollectCoverage(input).entries[0]!.action).toBe("copy-original");
  expect(planCollectCoverage(input).quality).toBe("originals");
});
it.each([
  "duplicate-asset",
  "missing-asset",
  "unknown-opaque",
  "invalid-revision",
  "untrusted-field",
])("rejects malformed plan context %s", (kind) => {
  const input = fixture();
  if (kind === "duplicate-asset") input.assets.push(asset());
  if (kind === "missing-asset")
    input.compositions[0]!.tracks[0]!.clips[0]!.assetId = "missing";
  if (kind === "unknown-opaque") input.opaqueAssetIds = ["missing"];
  if (kind === "invalid-revision") input.revision = "stale";
  if (kind === "untrusted-field")
    Object.assign(input, { code: "() => upload()" });
  expect(() => planCollectCoverage(input)).toThrow(
    expect.objectContaining({ code: "request.invalid" }),
  );
});
