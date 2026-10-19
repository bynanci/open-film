import { describe, expect, it } from "vitest";
import type { GraphicGroupNode, MediaAsset } from "@openfilm/core";
import { applyTimelineCommand, type EditorDocument } from "../src/editing.js";
import {
  graphicNode,
  graphicScene,
} from "../../../tests/fixtures/graphic-scene.js";
import {
  createConversationCard,
  createPhotoRelationship,
} from "@openfilm/story";

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

  it.each([6, 8])(
    "preserves graphics while complete beat regeneration builds a %ss cut",
    (target) => {
      const photos = ["first", "second"].map((id) => ({
        ...assets[0]!,
        id,
        uri: `file:///synthetic/${id}.png`,
        mediaType: "image" as const,
        duration: undefined,
      }));
      const original = document();
      original.story.beats[0] = {
        id: "beat",
        title: "Scene",
        candidateAssetIds: photos.map((asset) => asset.id),
        minDuration: target,
        targetDuration: target,
        maxDuration: target,
      };
      original.composition.tracks[0]!.clips = photos.map((asset, index) => ({
        id: asset.id,
        assetId: asset.id,
        beatId: "beat",
        timelineStart: index * 3,
        timelineDuration: 3,
      }));
      original.composition.graphicScenes = [graphicScene()];
      const next = applyTimelineCommand(original, photos, {
        type: "regenerate-beat",
        beatId: "beat",
        mode: "regenerate",
      });
      expect(next.composition.duration).toBeCloseTo(target, 6);
      expect(next.composition.graphicScenes).toEqual(
        original.composition.graphicScenes,
      );
      expect(
        new Set(
          next.composition.tracks.flatMap((track) =>
            track.clips.map((clip) => clip.assetId),
          ),
        ),
      ).toEqual(new Set(photos.map((asset) => asset.id)));
    },
  );

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

  it("commits template metadata atomically and removes it with its scene", () => {
    const { scene, record } = createConversationCard({
      sceneId: "conversation-card",
      duration: 6,
      frame: { width: 1920, height: 1080 },
      locale: "zh-TW",
      messages: [
        { id: "msg-1", speaker: "Ari", text: "合成測試訊息", start: 0, end: 6 },
      ],
    });
    const added = applyTimelineCommand(document(), assets, {
      type: "graphic.scene.upsert",
      scene,
      templateRecord: record,
    });
    expect(added.composition.graphicScenes).toEqual([scene]);
    expect(added.composition.graphicSceneTemplates).toEqual([record]);
    const changed = structuredClone(scene);
    changed.nodes.find((node) => node.id.endsWith(".text"))!.x = 12;
    const updated = applyTimelineCommand(added, assets, {
      type: "graphic.scene.upsert",
      scene: changed,
    });
    expect(updated.composition.graphicSceneTemplates).toEqual([record]);
    const removed = applyTimelineCommand(updated, assets, {
      type: "graphic.scene.remove",
      sceneId: scene.id,
    });
    expect(removed.composition.graphicSceneTemplates).toBeUndefined();
    expect(added.composition.graphicScenes).toEqual([scene]);
  });

  it("rejects stale template node bindings and asset IDs before mutation", () => {
    const { scene, record } = createConversationCard({
      sceneId: "conversation-card-stale",
      duration: 6,
      frame: { width: 1920, height: 1080 },
      messages: [
        { id: "msg-1", speaker: "Ari", text: "Message", start: 0, end: 6 },
      ],
    });
    expect(() =>
      applyTimelineCommand(document(), assets, {
        type: "graphic.scene.upsert",
        scene,
        templateRecord: { ...record, sceneId: "different-scene" },
      }),
    ).toThrow(/saved GraphicScene|reference/i);
  });

  it("keeps locked source photos read-only while templates bind their identities", () => {
    const photos: MediaAsset[] = [
      {
        ...assets[0]!,
        id: "locked-photo-a",
        name: "Synthetic A",
        uri: "file:///synthetic/a.png",
        mediaType: "image",
        state: { locked: true },
      },
      {
        ...assets[0]!,
        id: "locked-photo-b",
        name: "Synthetic B",
        uri: "file:///synthetic/b.png",
        mediaType: "image",
        state: { locked: true },
      },
    ];
    const before = structuredClone(photos);
    const { scene, record } = createPhotoRelationship({
      sceneId: "locked-photo-relationship",
      duration: 6,
      frame: { width: 1920, height: 1080 },
      relationship: "compare",
      photos: photos.map((photo) => ({ assetId: photo.id })),
    });
    const original = document();
    const added = applyTimelineCommand(original, photos, {
      type: "graphic.scene.upsert",
      scene,
      templateRecord: record,
    });
    expect(added.composition.graphicSceneTemplates).toEqual([record]);
    expect(photos).toEqual(before);
    expect(added.composition.tracks).toEqual(original.composition.tracks);
  });

  it("blocks upsert, removal and ancestor moves for locked GraphicScene layers until unlocked", () => {
    const added = applyTimelineCommand(document(), assets, {
      type: "graphic.scene.upsert",
      scene: graphicScene({
        nodes: [graphicNode({ locked: true })],
      }),
    });
    const locked = added.composition.graphicScenes![0]!;
    const changed = structuredClone(locked);
    changed.nodes[0]!.x += 10;
    expect(() =>
      applyTimelineCommand(added, assets, {
        type: "graphic.scene.upsert",
        scene: changed,
      }),
    ).toThrow(/locked graphic layer/i);
    expect(() =>
      applyTimelineCommand(added, assets, {
        type: "graphic.scene.remove",
        sceneId: locked.id,
      }),
    ).toThrow(/locked/i);
    const retimed = structuredClone(locked);
    retimed.start = 1;
    retimed.duration = 5;
    retimed.nodes[0]!.end = 5;
    expect(() =>
      applyTimelineCommand(added, assets, {
        type: "graphic.scene.upsert",
        scene: retimed,
      }),
    ).toThrow(/scene containing locked/i);
    const reordered = structuredClone(locked);
    reordered.zIndex = 1;
    expect(() =>
      applyTimelineCommand(added, assets, {
        type: "graphic.scene.upsert",
        scene: reordered,
      }),
    ).toThrow(/scene containing locked/i);

    const unlocked = structuredClone(locked);
    unlocked.nodes[0]!.locked = false;
    const unlockedDocument = applyTimelineCommand(added, assets, {
      type: "graphic.scene.upsert",
      scene: unlocked,
    });
    const editable = structuredClone(unlocked);
    editable.nodes[0]!.x += 10;
    expect(
      applyTimelineCommand(unlockedDocument, assets, {
        type: "graphic.scene.upsert",
        scene: editable,
      }).composition.graphicScenes?.[0]?.nodes[0]?.x,
    ).toBe(10);
  });

  it("protects locked descendants from moving with a changed parent group", () => {
    const shape = graphicNode({ id: "locked-child", locked: true });
    const { shape: _shape, fill: _fill, ...groupBase } = graphicNode();
    const group = {
      ...groupBase,
      id: "parent-group",
      type: "group" as const,
      children: [shape],
    };
    const added = applyTimelineCommand(document(), assets, {
      type: "graphic.scene.upsert",
      scene: graphicScene({ nodes: [group] }),
    });
    const moved = structuredClone(added.composition.graphicScenes![0]!);
    moved.nodes[0]!.x += 8;
    expect(() =>
      applyTimelineCommand(added, assets, {
        type: "graphic.scene.upsert",
        scene: moved,
      }),
    ).toThrow(/containing locked graphic layer/i);
  });

  it("protects every child inside a locked group until the group is unlocked", () => {
    const child = graphicNode({ id: "child-under-lock" });
    const { shape: _shape, fill: _fill, ...groupBase } = graphicNode();
    const group = {
      ...groupBase,
      id: "locked-parent-group",
      type: "group" as const,
      locked: true,
      children: [child],
    };
    const added = applyTimelineCommand(document(), assets, {
      type: "graphic.scene.upsert",
      scene: graphicScene({ nodes: [group] }),
    });
    const changedChild = structuredClone(added.composition.graphicScenes![0]!);
    (changedChild.nodes[0] as GraphicGroupNode).children[0]!.x += 8;
    expect(() =>
      applyTimelineCommand(added, assets, {
        type: "graphic.scene.upsert",
        scene: changedChild,
      }),
    ).toThrow(/locked graphic layer/i);

    const unlocked = structuredClone(added.composition.graphicScenes![0]!);
    (unlocked.nodes[0] as GraphicGroupNode).locked = false;
    const unlockedDocument = applyTimelineCommand(added, assets, {
      type: "graphic.scene.upsert",
      scene: unlocked,
    });
    const editable = structuredClone(unlocked);
    (editable.nodes[0] as GraphicGroupNode).children[0]!.x += 8;
    expect(
      applyTimelineCommand(unlockedDocument, assets, {
        type: "graphic.scene.upsert",
        scene: editable,
      }).composition.graphicScenes?.[0]?.nodes[0],
    ).toMatchObject({ children: [{ x: 8 }] });
  });
});
