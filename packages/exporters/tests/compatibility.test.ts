import { describe, expect, it } from "vitest";
import { exportTimeline, resolveCompatibility } from "../src/index.js";
import type { Composition, MediaAsset } from "@openfilm/core";
const assets: MediaAsset[] = [
  {
    id: "video",
    uri: "file:///memory.mp4",
    name: "Memory",
    mediaType: "video",
    duration: 10,
    state: {},
    tags: [],
    metadata: {},
  },
];
const composition: Composition = {
  id: "film",
  storyId: "story",
  duration: 2,
  tracks: [
    {
      id: "track",
      type: "video",
      clips: [
        {
          id: "clip",
          assetId: "video",
          sourceIn: 0,
          sourceOut: 2,
          timelineStart: 0,
          timelineDuration: 2,
        },
      ],
    },
  ],
};

describe("Resolve compatibility evidence", () => {
  it("does not promote official parser checks into application verification", () => {
    expect(resolveCompatibility.evidence.realNle).toEqual([]);
    expect(
      resolveCompatibility.features.filter(
        (feature) => feature.realNleVerified,
      ),
    ).toEqual([]);
    expect(
      resolveCompatibility.features.find(
        (feature) => feature.id === "sourceTiming",
      ),
    ).toMatchObject({
      implementation: "native",
      parserValidated: true,
      realNleVerified: false,
    });
  });
  it("reports emitted edit metadata as manual recreation, not a native NLE effect", () => {
    const edited = structuredClone(composition);
    edited.tracks[0]!.clips[0]!.transform = { speed: 2, volume: 0, scale: 1.2 };
    edited.tracks[0]!.clips[0]!.sourceOut = 4;
    edited.tracks[0]!.clips[0]!.title = "Our story";
    const exported = exportTimeline("otio", edited, assets);
    const otio = JSON.parse(exported.content);
    expect(otio.metadata.openfilm.composition).toEqual(edited);
    expect(exported.warnings?.join(" ")).toContain("METADATA ONLY");
    for (const id of ["speed", "volumeMute", "transform", "titles"]) {
      expect(
        resolveCompatibility.features.find((feature) => feature.id === id),
      ).toMatchObject({
        implementation: "metadata-only",
        manualRecreation: true,
        realNleVerified: false,
      });
    }
  });
  it("does not list manual changes for a plain cut-only film", () => {
    const cut = structuredClone(composition);
    const result = exportTimeline("otio", cut, assets);
    expect(result.warnings).toEqual([]);
    const report = JSON.parse(result.content).metadata.openfilm.compatibility;
    expect(report.metadataOnlyEdits).toEqual([]);
  });

  it.each(["titles", "overlay"] as const)(
    "includes metadata-only %s track semantics in the required manual edits",
    (type) => {
      const layered = structuredClone(composition);
      layered.tracks[0]!.type = type;
      const result = exportTimeline("otio", layered, assets);
      const report = JSON.parse(result.content).metadata.openfilm.compatibility;
      expect(report.metadataOnlyEdits).toEqual([
        { clipId: "clip", features: [type === "titles" ? "title" : "overlay"] },
      ]);
    },
  );

  it("marks an actually rejected overlapping layout unsupported", () => {
    const overlapping = structuredClone(composition);
    overlapping.tracks[0]!.clips.push({
      ...overlapping.tracks[0]!.clips[0]!,
      id: "second",
      timelineStart: 1,
    });
    overlapping.duration = 3;
    expect(() => exportTimeline("otio", overlapping, assets)).toThrow(
      /overlap/i,
    );
    expect(
      resolveCompatibility.features.find(
        (feature) => feature.id === "overlappingClips",
      ),
    ).toMatchObject({
      implementation: "unsupported",
      parserValidated: false,
      realNleVerified: false,
    });
  });
});
