// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import type { Composition, MediaAsset } from "@openfilm/core";
import { exportTimeline } from "../src/index.js";
const composition: Composition = {
  id: "offline-film",
  storyId: "story",
  duration: 1,
  tracks: [
    {
      id: "picture",
      type: "video",
      clips: [
        {
          id: "clip",
          assetId: "source",
          timelineStart: 0,
          timelineDuration: 1,
          sourceIn: 0,
          sourceOut: 1,
        },
      ],
    },
  ],
};
const asset: MediaAsset = {
  id: "source",
  name: "Synthetic offline.mp4",
  uri: "file:///synthetic/offline.mp4",
  mediaType: "video",
  duration: 2,
  tags: [],
  state: {},
  metadata: {
    "openfilm.collectDelivery": {
      version: 1,
      mode: "offline-proxies",
      quality: "offline-only",
      originalSha256: "a".repeat(64),
    },
  },
};
it.each(["json", "otio", "fcpxml", "edl"] as const)(
  "preserves offline status in %s report and the delivered artifact",
  (format) => {
    const result = exportTimeline(format, composition, [asset]);
    expect(result.warnings).toContain("collect.offline-quality");
    expect(result.content).toContain("offline-only");
    if (format === "otio") {
      const timeline = JSON.parse(result.content),
        reference = timeline.tracks.children[0].children[0].media_reference;
      expect(reference.metadata.openfilm.collectDelivery).toEqual(
        asset.metadata["openfilm.collectDelivery"],
      );
      expect(timeline.metadata.openfilm.compatibility.warnings).toContain(
        "collect.offline-quality",
      );
    }
  },
);
it("does not label unused offline media as part of an original-quality timeline", () => {
  const original = { ...asset, metadata: {} };
  const unused = { ...asset, id: "unused" };
  const result = exportTimeline("otio", composition, [original, unused]);
  expect(result.warnings).not.toContain("collect.offline-quality");
  expect(result.content).not.toContain("offline-only");
});
