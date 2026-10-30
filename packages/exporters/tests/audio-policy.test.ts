import { expect, it } from "vitest";
import type { Composition, MediaAsset } from "@openfilm/core";
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
