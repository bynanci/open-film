import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("GraphicScene template metadata", () => {
  it("validates optional template records separately from rendered scenes", () => {
    expect(core.validateGraphicSceneTemplates).toBeTypeOf("function");
    expect(core.validateGraphicSceneTemplates(undefined, [], [])).toEqual([]);
  });

  it("keeps exact original chat text and validates quoted and excerpted captions", () => {
    const originalText = "我會記得那天一起看海的午後。";
    const excerpt = { start: 4, end: 10 };
    const text = originalText.slice(excerpt.start, excerpt.end);
    const scene: core.GraphicScene = {
      version: 1,
      id: "chat",
      name: "Conversation Card",
      start: 0,
      duration: 8,
      zIndex: 0,
      nodes: [
        { ...textNode("speaker-1", "Ari"), x: 0 },
        textNode("body-1", text),
        textNode(
          "source-1",
          core.graphicSceneTemplateSourceLabel("zh-TW", "excerpt", "訊息紀錄"),
        ),
      ],
    };
    const record: core.ConversationCardTemplateRecord = {
      version: 1,
      sceneId: scene.id,
      templateId: "conversation-card",
      data: {
        locale: "zh-TW",
        messages: [
          {
            id: "message-1",
            speakerNodeId: "speaker-1",
            textNodeId: "body-1",
            sourceLabelNodeId: "source-1",
            source: {
              originalText,
              citation: "訊息紀錄",
              attribution: "excerpt",
              excerpt,
            },
          },
        ],
      },
    };
    const admitted = core.validateGraphicSceneTemplates([record], [scene]);
    expect(admitted).toEqual([record]);
    expect(admitted[0]).not.toBe(record);

    expect(() =>
      core.validateGraphicSceneTemplates(
        [{ ...record, sceneId: "missing" }],
        [scene],
      ),
    ).toThrow("does not reference a saved GraphicScene");
    expect(() =>
      core.validateGraphicSceneTemplates(
        [
          {
            ...record,
            data: {
              ...record.data,
              messages: [
                {
                  ...record.data.messages[0]!,
                  source: {
                    ...record.data.messages[0]!.source!,
                    excerpt: { start: 0, end: originalText.length },
                  },
                },
              ],
            },
          },
        ],
        [scene],
      ),
    ).toThrow("excerpt must match its exact original range");
    expect(() =>
      core.validateGraphicSceneTemplates(
        [
          {
            ...record,
            data: {
              ...record.data,
              messages: [
                {
                  ...record.data.messages[0]!,
                  source: { ...record.data.messages[0]!.source!, extra: true },
                },
              ],
            },
          },
        ],
        [scene],
      ),
    ).toThrow("unknown field");
  });

  it("admits bounded manual and imported route provenance without event claims", () => {
    const scene: core.GraphicScene = {
      version: 1,
      id: "route",
      name: "Route Story",
      start: 0,
      duration: 8,
      zIndex: 0,
      nodes: [
        shapeNode("point-1"),
        shapeNode("point-2"),
        shapeNode("waypoint-marker"),
        textNode("waypoint-label", "橋邊"),
      ],
    };
    const record: core.RouteStoryTemplateRecord = {
      version: 1,
      sceneId: scene.id,
      templateId: "route-story",
      data: {
        source: {
          kind: "gpx",
          fileName: "synthetic-route.gpx",
          sha256: "a".repeat(64),
          trackName: "虛構步道",
        },
        points: [
          { nodeId: "point-1", latitude: 25.04, longitude: 121.5 },
          { nodeId: "point-2", latitude: 25.05, longitude: 121.51 },
        ],
        waypoints: [
          {
            id: "waypoint-1",
            label: "橋邊",
            latitude: 25.045,
            longitude: 121.505,
            markerNodeId: "waypoint-marker",
            labelNodeId: "waypoint-label",
          },
        ],
      },
    };
    expect(core.validateGraphicSceneTemplates([record], [scene])).toEqual([
      record,
    ]);
    expect(() =>
      core.validateGraphicSceneTemplates(
        [
          {
            ...record,
            data: {
              ...record.data,
              source: { ...record.data.source, elapsedTime: 123 },
            },
          },
        ],
        [scene],
      ),
    ).toThrow("unknown field");
    expect(() =>
      core.validateGraphicSceneTemplates(
        [
          {
            ...record,
            data: {
              ...record.data,
              source: { ...record.data.source, fileName: "../route.gpx" },
            },
          },
        ],
        [scene],
      ),
    ).toThrow("without a path");
    expect(() =>
      core.validateGraphicSceneTemplates(
        [
          {
            ...record,
            data: {
              ...record.data,
              points: [
                { nodeId: "point-1", latitude: 90.1, longitude: 121.5 },
                record.data.points[1]!,
              ],
            },
          },
        ],
        [scene],
      ),
    ).toThrow("outside valid coordinate bounds");
  });

  it("binds photo relationships to their actual image assets and safe focus data", () => {
    const scene: core.GraphicScene = {
      version: 1,
      id: "photos",
      name: "Photo Relationship",
      start: 0,
      duration: 8,
      zIndex: 0,
      nodes: [
        imageNode("opening-image", "first-photo"),
        imageNode("closing-image", "second-photo"),
      ],
    };
    const record: core.PhotoRelationshipTemplateRecord = {
      version: 1,
      sceneId: scene.id,
      templateId: "photo-relationship",
      data: {
        relationship: "bookends",
        photos: [
          {
            role: "opening",
            nodeId: "opening-image",
            assetId: "first-photo",
            contentHash: "b".repeat(64),
            layout: {
              preset: "hero",
              focalPoint: { x: 0.4, y: 0.55 },
              protectedRegion: { x: 0.3, y: 0.35, width: 0.2, height: 0.3 },
            },
          },
          {
            role: "closing",
            nodeId: "closing-image",
            assetId: "second-photo",
            layout: { preset: "contain" },
          },
        ],
      },
    };
    expect(
      core.validateGraphicSceneTemplates(
        [record],
        [scene],
        ["first-photo", "second-photo"],
      ),
    ).toEqual([record]);
    expect(() =>
      core.validateGraphicSceneTemplates([record], [scene], ["first-photo"]),
    ).toThrow("unknown image asset");
    expect(() =>
      core.validateGraphicSceneTemplates(
        [
          {
            ...record,
            data: {
              ...record.data,
              photos: [
                {
                  ...record.data.photos[0]!,
                  layout: {
                    preset: "hero",
                    protectedRegion: {
                      x: 0.9,
                      y: 0.9,
                      width: 0.2,
                      height: 0.2,
                    },
                  },
                },
                record.data.photos[1]!,
              ],
            },
          },
        ],
        [scene],
      ),
    ).toThrow("region must fit inside the image");
  });

  it("validates and preserves template records in Composition without a schema bump", () => {
    const composition: core.Composition = {
      id: "composition",
      storyId: "story",
      duration: 8,
      tracks: [],
      graphicScenes: [
        {
          version: 1,
          id: "scene-1",
          name: "Conversation",
          start: 0,
          duration: 8,
          zIndex: 0,
          nodes: [textNode("speaker", "Ari"), textNode("body", "虛構文字")],
        },
      ],
      graphicSceneTemplates: [
        {
          version: 1,
          sceneId: "scene-1",
          templateId: "conversation-card",
          data: {
            locale: "zh-TW",
            messages: [
              { id: "message-1", speakerNodeId: "speaker", textNodeId: "body" },
            ],
          },
        },
      ],
    };
    expect(core.validateComposition(composition)).toEqual(composition);
    expect(() =>
      core.validateComposition({
        ...composition,
        graphicSceneTemplates: [
          { ...composition.graphicSceneTemplates![0]!, sceneId: "orphan" },
        ],
      }),
    ).toThrow("does not reference a saved GraphicScene");
  });
});

function textNode(id: string, text: string): core.GraphicNode {
  return {
    id,
    type: "text",
    x: 0,
    y: 0,
    width: 300,
    height: 64,
    opacity: 1,
    zIndex: 0,
    start: 0,
    end: 8,
    text,
    fontSize: 24,
  };
}
function shapeNode(id: string): core.GraphicNode {
  return {
    id,
    type: "shape",
    shape: "ellipse",
    fill: "#d0a34f",
    x: 0,
    y: 0,
    width: 12,
    height: 12,
    opacity: 1,
    zIndex: 0,
    start: 0,
    end: 8,
  };
}
function imageNode(id: string, assetId: string): core.GraphicNode {
  return {
    id,
    type: "image",
    assetId,
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    opacity: 1,
    zIndex: 0,
    start: 0,
    end: 8,
  };
}
