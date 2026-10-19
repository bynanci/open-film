import { expect, it } from "vitest";
import type { Composition, MediaAsset } from "@openfilm/core";
import { graphicScene } from "../../../tests/fixtures/graphic-scene.js";
import { exportTimeline } from "../src/index.js";
it("retains scene-only source identities and declares NLE metadata limits", () => {
  const scene = graphicScene({
    nodes: [
      {
        id: "image",
        type: "image",
        assetId: "photo",
        x: 0,
        y: 0,
        width: 40,
        height: 30,
        opacity: 1,
        zIndex: 0,
        start: 0,
        end: 6,
      },
    ],
  });
  const composition: Composition = {
    id: "film",
    storyId: "story",
    duration: 6,
    tracks: [],
    graphicScenes: [scene],
  };
  const asset: MediaAsset = {
    id: "photo",
    name: "synthetic",
    uri: "file:///synthetic.png",
    mediaType: "image",
    tags: [],
    state: {},
    metadata: {},
  };
  const json = JSON.parse(exportTimeline("json", composition, [asset]).content);
  expect(json.assets).toEqual([asset]);
  expect(json.composition).toEqual(composition);
  const exported = exportTimeline("otio", composition, [asset]);
  const otio = JSON.parse(exported.content);
  expect(otio.metadata.openfilm.composition).toEqual(composition);
  expect(otio.metadata.openfilm.graphicMediaReferences).toContainEqual(
    expect.objectContaining({ assetId: "photo", target_url: asset.uri }),
  );
  expect(exported.warnings?.join(" ")).toMatch(/GraphicScene.*METADATA ONLY/);
  for (const format of ["fcpxml", "edl"] as const)
    expect(() => exportTimeline(format, composition, [asset])).toThrow(
      /GraphicScene/,
    );
});
