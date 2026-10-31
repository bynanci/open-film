import { expect, it } from "vitest";
import {
  resolveAudioInterval,
  validateComposition,
  type Composition,
  type MediaAsset,
} from "@openfilm/core";
import {
  createHandoffPlan,
  exportTimeline,
  resolveCompatibility,
} from "../src/index.js";
const composition: Composition = {
  id: "cut",
  storyId: "story",
  duration: 8,
  tracks: [
    {
      id: "video",
      type: "video",
      clips: [
        {
          id: "sound",
          assetId: "a",
          timelineStart: 2,
          timelineDuration: 2,
          sourceIn: 1,
          sourceOut: 3,
          audioTiming: {
            version: 1,
            sampleRate: 48000,
            timelineStartSample: 84001,
            sourceInSample: 24001,
            sourceOutSample: 204001,
          },
        },
      ],
    },
  ],
};
const assets: MediaAsset[] = [
  {
    id: "a",
    name: "Video",
    uri: "file:///video.mp4",
    mediaType: "video",
    duration: 8,
    tags: [],
    state: {},
    metadata: { "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] } },
  },
];

it("retains exact independent timing in native JSON/OTIO metadata and warns about manual recreation", () => {
  const json = JSON.parse(exportTimeline("json", composition, assets).content);
  expect(json.schemaVersion).toBe("1.0.0"); // Independent export envelope version.
  expect(json.composition).toEqual(composition);
  const result = exportTimeline("otio", composition, assets);
  const otio = JSON.parse(result.content);
  expect(otio.metadata.openfilm.composition).toEqual(composition);
  expect(result.warnings?.join(" ")).toMatch(
    /independent sound timing.*METADATA ONLY/i,
  );
  expect(
    resolveCompatibility.features.find((f) => f.id === "audioTiming"),
  ).toMatchObject({
    implementation: "metadata-only",
    realNleVerified: false,
    manualRecreation: true,
  });
});
it.each(["fcpxml", "edl"] as const)(
  "refuses silent timing loss in %s",
  (format) => {
    expect(() => exportTimeline(format, composition, assets)).toThrow(
      /audioTiming/,
    );
  },
);
it("classifies independent timing honestly and allows an explicit full-mix bake", () => {
  const manual = createHandoffPlan(composition, 30);
  expect(
    manual.items.find((item) => item.feature === "audioTiming"),
  ).toMatchObject({ disposition: "metadata-only" });
  const baked = createHandoffPlan(composition, 30, { bakeAudio: true });
  expect(
    baked.items.find((item) => item.feature === "audioTiming"),
  ).toMatchObject({ disposition: "baked" });
  expect(baked.bakeAudio).toBe(true);
});

function boundaryComposition(sourceOutSample: number, speed = 3): Composition {
  const value = structuredClone(composition),
    clip = value.tracks[0]!.clips[0]!;
  value.duration = 1;
  clip.timelineStart = 0;
  clip.timelineDuration = 1;
  clip.sourceIn = 0;
  clip.sourceOut = 3;
  clip.transform = { speed };
  clip.audioTiming = {
    version: 1,
    sampleRate: 48000,
    timelineStartSample: 0,
    sourceInSample: 0,
    sourceOutSample,
  };
  return value;
}
for (const bakeAudio of [false, true]) {
  it.each([144000, 144001])(
    `retains the canonical end sample at sourceOut=%s in handoff (bakeAudio=${bakeAudio})`,
    (sourceOutSample) => {
      const value = boundaryComposition(sourceOutSample),
        before = structuredClone(value),
        clip = value.tracks[0]!.clips[0]!;
      validateComposition(value, { assetIds: ["a"] });
      expect(resolveAudioInterval(clip, assets[0]!, 1).endSample).toBe(48000);
      const result = createHandoffPlan(value, 30, { bakeAudio });
      expect(
        result.items.find((item) => item.feature === "audioTiming"),
      ).toEqual(
        expect.objectContaining({
          startFrame: 0,
          endFrame: 30,
          disposition: bakeAudio ? "baked" : "metadata-only",
        }),
      );
      expect(value).toEqual(before);
      expect(clip.audioTiming!.sourceOutSample).toBe(sourceOutSample);
    },
  );
  it.each([
    [144002, 3],
    [144001, 2.9999],
  ])(
    `rejects a genuine canonical overrun at sourceOut=%s speed=%s in handoff (bakeAudio=${bakeAudio})`,
    (sourceOutSample, speed) => {
      const value = boundaryComposition(sourceOutSample!, speed);
      expect(() => validateComposition(value, { assetIds: ["a"] })).toThrow(
        /bounds/,
      );
      expect(() =>
        resolveAudioInterval(value.tracks[0]!.clips[0]!, assets[0]!, 1),
      ).toThrow(/bounds/);
      expect(() => createHandoffPlan(value, 30, { bakeAudio })).toThrow(
        /bounds/,
      );
    },
  );
}
