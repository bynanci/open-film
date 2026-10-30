// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import {
  PRIMARY_COLOR_IDENTITY,
  type Composition,
  type MediaAsset,
} from "@openfilm/core";
import {
  exportTimeline,
  otioCompatibilityReport,
  resolveCompatibility,
} from "../src/index.js";
import { createHandoffPlan } from "../src/handoff.js";
const asset: MediaAsset = {
  id: "a",
  name: "a.mp4",
  uri: "file:///tmp/a.mp4",
  mediaType: "video",
  duration: 2,
  tags: [],
  state: {},
  metadata: {},
};
const film: Composition = {
  id: "f",
  storyId: "s",
  duration: 1,
  defaultPrimaryColor: { ...PRIMARY_COLOR_IDENTITY, exposureEv: 0.5 },
  tracks: [
    {
      id: "v",
      type: "video",
      clips: [{ id: "c", assetId: "a", timelineStart: 0, timelineDuration: 1 }],
    },
  ],
};
it("preserves effective primary metadata and honestly reports manual NLE recreation", () => {
  expect(
    resolveCompatibility.features.find(
      (feature) => feature.id === "primaryColor",
    ),
  ).toMatchObject({
    implementation: "metadata-only",
    parserValidated: false,
    realNleVerified: false,
  });
  const json = JSON.parse(exportTimeline("json", film, [asset]).content);
  expect(json.composition).toEqual(film);
  expect(json.metadata.openfilm.effectivePrimaryColors[0]).toMatchObject({
    clipId: "c",
    source: "film",
    correction: film.defaultPrimaryColor,
  });
  const otio = JSON.parse(exportTimeline("otio", film, [asset]).content);
  expect(
    otio.tracks.children[0].children[0].metadata.openfilm.effectivePrimaryColor
      .source,
  ).toBe("film");
  expect(
    otioCompatibilityReport(film).metadataOnlyEdits[0]!.features,
  ).toContain("primary color");
  for (const format of ["fcpxml", "edl"] as const)
    expect(() => exportTimeline(format, film, [asset])).toThrow(
      /primary color/i,
    );
});
it("plans full corrected intervals for fidelity and accepts identity or legacy", () => {
  expect(
    createHandoffPlan(film, 30, { mode: "preserve-visual-fidelity" })
      .visualRanges,
  ).toEqual([{ startFrame: 0, endFrame: 30 }]);
  expect(
    createHandoffPlan(film, 30, { mode: "preserve-editability" }).items.some(
      (i) => i.feature === "primaryColor" && i.disposition === "metadata-only",
    ),
  ).toBe(true);
  for (const format of ["fcpxml", "edl"] as const)
    expect(() =>
      exportTimeline(
        format,
        { ...film, defaultPrimaryColor: PRIMARY_COLOR_IDENTITY },
        [asset],
      ),
    ).not.toThrow();
  expect(() =>
    exportTimeline(
      "json",
      {
        ...film,
        defaultPrimaryColor: { ...PRIMARY_COLOR_IDENTITY, version: 2 } as never,
      },
      [asset],
    ),
  ).toThrow();
});
