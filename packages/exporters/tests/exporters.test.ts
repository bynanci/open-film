import { describe, expect, it } from "vitest";
import type { Composition, MediaAsset } from "@openfilm/core";
import { exportTimeline } from "../src/index.js";

const assets: MediaAsset[] = [
  {
    id: "a",
    name: "Scene & subject",
    uri: "file:///media/a%20b.mp4",
    mediaType: "video",
    duration: 100,
    tags: [],
    state: {},
    metadata: {},
  },
];
const composition: Composition = {
  id: "cut",
  storyId: "s",
  duration: 12,
  tracks: [
    {
      id: "video",
      type: "video",
      clips: [
        {
          id: "clip",
          assetId: "a",
          sourceIn: 5,
          sourceOut: 9,
          timelineStart: 2,
          timelineDuration: 4,
        },
      ],
    },
  ],
};

describe("editable timeline exports", () => {
  it("writes OTIO rational source ranges, media references, and timeline gaps", () => {
    const result = JSON.parse(
      exportTimeline("otio", composition, assets).content,
    );
    expect(result.OTIO_SCHEMA).toBe("Timeline.1");
    const children = result.tracks.children[0].children;
    expect(
      children.map((child: { OTIO_SCHEMA: string }) => child.OTIO_SCHEMA),
    ).toEqual(["Gap.1", "Clip.1", "Gap.1"]);
    expect(children[1].source_range.start_time).toEqual({
      OTIO_SCHEMA: "RationalTime.1",
      value: 150,
      rate: 30,
    });
    expect(children[1].source_range.duration.value).toBe(120);
    expect(children[1].media_reference.target_url).toBe(assets[0]!.uri);
    expect(children[2].source_range.duration.value).toBe(180);
  });
  it("writes FCPXML resources, escaped names, precise offsets, and NTSC frame duration", () => {
    const content = exportTimeline("fcpxml", composition, assets, {
      width: 1920,
      height: 1080,
      frameRate: 30000 / 1001,
    }).content;
    expect(content).toContain('frameDuration="1001/30000s"');
    expect(content).toContain('name="Scene &amp; subject"');
    expect(content).toContain('src="file:///media/a%20b.mp4"');
    expect(content).toContain('offset="2/1s" start="5/1s" duration="4/1s"');
    expect(content).toContain(
      '<gap name="Gap" offset="6/1s" start="0s" duration="6/1s"/>',
    );
  });
  it("writes CMX source and record timecodes for applicable single-track cuts", () => {
    const content = exportTimeline("edl", composition, assets).content;
    expect(content).toContain(
      "00:00:05:00 00:00:09:00 00:00:02:00 00:00:06:00",
    );
    expect(content).toContain("* SOURCE FILE: file:///media/a%20b.mp4");
    expect(content.match(/\* BLACK GAP/g)).toHaveLength(2);
    expect(content).toContain("00:00:06:00 00:00:12:00");
  });
  it("preserves all edits in JSON and explicitly rejects unsupported transformations elsewhere", () => {
    const transformed: Composition = structuredClone(composition);
    transformed.tracks[0]!.clips[0]!.transform = { scale: 2 };
    expect(
      JSON.parse(exportTimeline("json", transformed, assets).content)
        .composition.tracks[0].clips[0].transform.scale,
    ).toBe(2);
    expect(() => exportTimeline("otio", transformed, assets)).toThrow(
      "cannot represent scale",
    );
    expect(() => exportTimeline("fcpxml", transformed, assets)).toThrow(
      "cannot represent scale",
    );
  });
  it("refuses missing sources, implicit speed changes, and unsupported EDL layouts", () => {
    expect(() => exportTimeline("otio", composition, [])).toThrow(
      "missing media",
    );
    const mismatched = structuredClone(composition);
    mismatched.tracks[0]!.clips[0]!.sourceOut = 10;
    expect(() => exportTimeline("otio", mismatched, assets)).toThrow(
      "speed change",
    );
    expect(() =>
      exportTimeline(
        "edl",
        {
          ...composition,
          tracks: [
            ...composition.tracks,
            { ...composition.tracks[0]!, id: "another" },
          ],
        },
        assets,
      ),
    ).toThrow("one video");
  });
  it("exports additional tracks with their timing in OTIO and connected FCPXML lanes", () => {
    const audio: MediaAsset = {
      ...assets[0]!,
      id: "audio",
      name: "Sound",
      uri: "file:///media/sound.wav",
      mediaType: "audio",
    };
    const multiple: Composition = {
      ...composition,
      tracks: [
        ...composition.tracks,
        {
          id: "audio",
          type: "audio",
          clips: [
            {
              id: "sound",
              assetId: "audio",
              timelineStart: 1,
              timelineDuration: 2,
            },
          ],
        },
      ],
    };
    expect(
      JSON.parse(exportTimeline("otio", multiple, [...assets, audio]).content)
        .tracks.children[1].kind,
    ).toBe("Audio");
    const xml = exportTimeline("fcpxml", multiple, [...assets, audio]).content;
    expect(xml).toContain('lane="-1"');
    expect(xml).toContain('offset="1/1s" start="0s" duration="2/1s" lane="-1"');
  });
});
