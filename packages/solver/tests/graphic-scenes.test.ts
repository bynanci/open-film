import { describe, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { applyTimelineCommand, type EditorDocument } from "../src/editing.js";
import { graphicScene } from "../../../tests/fixtures/graphic-scene.js";

const assets: MediaAsset[] = [
  {
    id: "source",
    uri: "file:///synthetic/source.mp4",
    name: "Synthetic video",
    mediaType: "video",
    duration: 12,
    state: {},
    metadata: {},
    tags: [],
  },
];
const document = (): EditorDocument => ({
  story: {
    id: "story",
    title: "Synthetic story",
    beats: [{ id: "beat", title: "Scene", candidateAssetIds: ["source"] }],
  },
  composition: {
    id: "composition",
    storyId: "story",
    duration: 6,
    tracks: [
      {
        id: "video",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "source",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 6,
            sourceIn: 0,
            sourceOut: 6,
          },
        ],
      },
    ],
  },
});

describe("GraphicScene commands", () => {
  it("upserts/removes stable scenes without modifying input or protected clips", () => {
    const original = document();
    original.composition.tracks[0]!.clips[0]!.locked = true;
    const sources = structuredClone(assets);
    sources[0]!.state.locked = true;
    const before = structuredClone(original);
    const scene = graphicScene();
    const added = applyTimelineCommand(original, sources, {
      type: "graphic.scene.upsert",
      scene,
    });
    expect(added.composition.graphicScenes).toEqual([scene]);
    expect(added.composition.tracks).toEqual(before.composition.tracks);
    expect(original).toEqual(before);
    const changed = structuredClone(scene);
    changed.nodes[0]!.x = 42;
    const updated = applyTimelineCommand(added, sources, {
      type: "graphic.scene.upsert",
      scene: changed,
    });
    expect(updated.composition.graphicScenes).toHaveLength(1);
    expect(updated.composition.graphicScenes?.[0]?.nodes[0]).toMatchObject({
      id: "rectangle",
      x: 42,
    });
    const removed = applyTimelineCommand(updated, sources, {
      type: "graphic.scene.remove",
      sceneId: scene.id,
    });
    expect(removed.composition).not.toHaveProperty("graphicScenes");
  });

  it("rejects unsafe scene data before returning an optimistic state", () => {
    expect(() =>
      applyTimelineCommand(document(), assets, {
        type: "graphic.scene.upsert",
        scene: { ...graphicScene(), html: "<script>unsafe</script>" },
      } as never),
    ).toThrow(/html|unknown/i);
  });

  it("rejects shortening that excludes graphics, then accepts an explicit scene adjustment", () => {
    const added = applyTimelineCommand(document(), assets, {
      type: "graphic.scene.upsert",
      scene: graphicScene(),
    });
    expect(() =>
      applyTimelineCommand(added, assets, {
        type: "trim",
        clipId: "clip",
        sourceIn: 0,
        sourceOut: 3,
      }),
    ).toThrow(/graphic|scene/i);
    const shorter = graphicScene({ duration: 3 });
    shorter.nodes[0]!.end = 3;
    const adjusted = applyTimelineCommand(added, assets, {
      type: "graphic.scene.upsert",
      scene: shorter,
    });
    expect(
      applyTimelineCommand(adjusted, assets, {
        type: "trim",
        clipId: "clip",
        sourceIn: 0,
        sourceOut: 3,
      }).composition.duration,
    ).toBe(3);
  });

  it("rejects missing image identities without changing existing required selections", () => {
    const scene = graphicScene();
    const {
      shape: _shape,
      fill: _fill,
      ...base
    } = scene.nodes[0]! as import("@openfilm/core").GraphicShapeNode;
    scene.nodes = [{ ...base, type: "image", assetId: "missing" }];
    expect(() =>
      applyTimelineCommand(document(), assets, {
        type: "graphic.scene.upsert",
        scene,
      }),
    ).toThrow(/image|asset|source/i);
  });
});
