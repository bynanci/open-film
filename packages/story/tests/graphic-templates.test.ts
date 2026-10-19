import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  validateGraphicSceneTemplates,
  validateGraphicScenes,
} from "@openfilm/core";
import {
  createConversationCard,
  createPhotoRelationship,
  createRouteStory,
  parseGpxRoute,
} from "../src/graphic-templates.js";

const frame = { width: 1920, height: 1080 };

describe("GraphicScene creative templates", () => {
  it("creates localized conversation cards with exact excerpt provenance and arbitrary times", () => {
    const originalText = "我們那天一起看海，還記得夕陽嗎？";
    const excerpt = { start: 0, end: 8 };
    const result = createConversationCard({
      sceneId: "chat-1",
      duration: 8,
      frame,
      locale: "zh-TW",
      messages: [
        {
          id: "message-1",
          speaker: "小安",
          text: originalText.slice(excerpt.start, excerpt.end),
          start: 1,
          end: 6,
          source: {
            originalText,
            citation: "虛構聊天紀錄",
            attribution: "excerpt",
            excerpt,
          },
        },
      ],
    });
    const scenes = validateGraphicScenes([result.scene], 8);
    const [record] = validateGraphicSceneTemplates([result.record], scenes);
    expect(record?.templateId).toBe("conversation-card");
    expect(
      result.scene.nodes.map((node) => node.start).filter((time) => time === 1),
    ).toHaveLength(3);
    expect(result.record.data.messages[0]?.source?.originalText).toBe(
      originalText,
    );
    expect(result.record.data.messages[0]?.sourceLabelNodeId).toBeDefined();
  });

  it("imports only bounded GPX route geometry, retains exact source hash, and ignores time claims", async () => {
    const gpx = new TextEncoder().encode(
      '<?xml version="1.0"?><gpx><trk><name>虛構 &amp; 安全步道</name><trkseg>' +
        '<trkpt lat="25.04" lon="121.5"><time>2024-01-01T08:00:00Z</time></trkpt>' +
        '<trkpt lat="25.05" lon="121.51"/></trkseg></trk>' +
        '<wpt lat="25.045" lon="121.505"><name>山徑口</name></wpt></gpx>',
    );
    const parsed = await parseGpxRoute(gpx, "route.gpx");
    expect(parsed.sha256).toBe(createHash("sha256").update(gpx).digest("hex"));
    expect(parsed.trackName).toBe("虛構 & 安全步道");
    expect(parsed.points).toEqual([
      { latitude: 25.04, longitude: 121.5 },
      { latitude: 25.05, longitude: 121.51 },
    ]);
    expect(parsed.waypoints[0]?.label).toBe("山徑口");
    expect(parsed).not.toHaveProperty("time");
    const result = createRouteStory({
      sceneId: "route-1",
      duration: 8,
      frame,
      route: parsed,
    });
    const scenes = validateGraphicScenes([result.scene], 8);
    expect(
      validateGraphicSceneTemplates([result.record], scenes)[0]?.templateId,
    ).toBe("route-story");
    expect(
      result.scene.nodes.filter((node) => node.type === "shape"),
    ).toHaveLength(3);
    await expect(
      parseGpxRoute(
        new TextEncoder().encode('<!DOCTYPE gpx [<!ENTITY x "bad">]><gpx/>'),
        "unsafe.gpx",
      ),
    ).rejects.toThrow(/DTD|entity/i);
    await expect(
      parseGpxRoute(
        new TextEncoder().encode(
          "<gpx><trk><trkseg><trkpt lat='1' lon='2'/></trkseg></trk><gpx>",
        ),
        "broken.gpx",
      ),
    ).rejects.toThrow(/well-formed/i);
    await expect(
      parseGpxRoute(
        new TextEncoder().encode(
          "<gpx><trkseg><trkpt lat='1' lon='2'/><trkpt lat='2' lon='3'/></trkseg></gpx>",
        ),
        "orphan-segment.gpx",
      ),
    ).rejects.toThrow(/one track segment or one route/i);
  });

  it("creates focus-safe photo reveal, compare, and bookend scenes with source bindings", () => {
    for (const relationship of [
      "focus-reveal",
      "compare",
      "bookends",
    ] as const) {
      const photos =
        relationship === "focus-reveal"
          ? [
              {
                assetId: "photo-a",
                contentHash: "a".repeat(64),
                focalPoint: { x: 0.6, y: 0.4 },
                protectedRegion: { x: 0.45, y: 0.25, width: 0.25, height: 0.3 },
              },
            ]
          : [
              {
                assetId: "photo-a",
                contentHash: "a".repeat(64),
                focalPoint: { x: 0.6, y: 0.4 },
              },
              {
                assetId: "photo-b",
                contentHash: "b".repeat(64),
                focalPoint: { x: 0.4, y: 0.6 },
              },
            ];
      const result = createPhotoRelationship({
        sceneId: `photo-${relationship}`,
        duration: 8,
        frame,
        relationship,
        photos,
      });
      const scenes = validateGraphicScenes([result.scene], 8);
      expect(
        validateGraphicSceneTemplates(
          [result.record],
          scenes,
          photos.map((photo) => photo.assetId),
        )[0]?.templateId,
      ).toBe("photo-relationship");
      expect(
        result.scene.nodes.filter((node) => node.type === "image"),
      ).toHaveLength(photos.length);
      if (relationship === "compare") {
        const images = result.scene.nodes.filter(
          (node) => node.type === "image",
        );
        expect(images[0]!.width).toBeLessThan(frame.width / 2);
        expect(images[1]!.x).toBeGreaterThan(images[0]!.x);
      }
    }
  });

  it("rejects malformed coordinates, mixed GPX route segments, unsafe entities, and unrenderable long text", async () => {
    const mixed = new TextEncoder().encode(
      "<gpx><trk><trkseg><trkpt lat='1' lon='2'/></trkseg><trkseg><trkpt lat='3' lon='4'/></trkseg></trk></gpx>",
    );
    await expect(parseGpxRoute(mixed, "multi.gpx")).rejects.toThrow(
      /one track segment/i,
    );
    await expect(
      parseGpxRoute(
        new TextEncoder().encode(
          "<gpx><trk><trkseg><trkpt lat='91' lon='2'/><trkpt lat='1' lon='3'/></trkseg></trk></gpx>",
        ),
        "bad.gpx",
      ),
    ).rejects.toThrow(/coordinate/i);
    expect(() =>
      createConversationCard({
        sceneId: "too-long",
        duration: 4,
        frame,
        messages: [
          {
            id: "m1",
            speaker: "A",
            text: "很長".repeat(300),
            start: 0,
            end: 4,
          },
        ],
      }),
    ).toThrow(/512|length/i);
  });
});
