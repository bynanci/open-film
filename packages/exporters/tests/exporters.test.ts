import { describe, expect, it } from "vitest";
import type { Composition, MediaAsset } from "@openfilm/core";
import { exportTimeline, otioCompatibilityReport } from "../src/index.js";

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
  it("preserves all edits in JSON and warns for metadata-only OTIO edits while rejecting unsupported FCPXML/EDL transformations", () => {
    const transformed: Composition = structuredClone(composition);
    transformed.tracks[0]!.clips[0]!.transform = { scale: 2 };
    expect(
      JSON.parse(exportTimeline("json", transformed, assets).content)
        .composition.tracks[0].clips[0].transform.scale,
    ).toBe(2);
    const otio = exportTimeline("otio", transformed, assets);
    expect(otio.warnings?.join(" ")).toContain("METADATA ONLY");
    expect(JSON.parse(otio.content).metadata.openfilm.composition).toEqual(
      transformed,
    );
    expect(() => exportTimeline("fcpxml", transformed, assets)).toThrow(
      "cannot represent scale",
    );
    expect(() => exportTimeline("edl", transformed, assets)).toThrow(
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

describe("OTIO cut layout and explicit advanced-edit preservation", () => {
  it("retains full advanced source/timeline edits in metadata and emits actionable per-clip warnings", () => {
    const edited = structuredClone(composition);
    const clip = edited.tracks[0]!.clips[0]!;
    clip.sourceOut = 13;
    clip.transform = {
      speed: 2,
      volume: 0.25,
      scale: 1.3,
      rotation: 5,
      x: 12,
      y: -4,
    };
    clip.title = "Our moment";
    clip.transition = { type: "crossfade", duration: 0.5 };
    clip.locked = true;
    const before = structuredClone(edited);
    const output = exportTimeline("otio", edited, assets);
    const result = JSON.parse(output.content),
      native = result.tracks.children[0].children[1];
    expect(
      native.source_range.start_time.value /
        native.source_range.start_time.rate,
    ).toBe(5);
    expect(
      native.source_range.duration.value / native.source_range.duration.rate,
    ).toBe(4);
    expect(native.effects).toEqual([]);
    expect(native.metadata.openfilm.clip).toEqual(clip);
    expect(result.metadata.openfilm.composition).toEqual(edited);
    expect(result.metadata.openfilm.compatibility).toEqual(
      otioCompatibilityReport(edited),
    );
    expect(output.warnings?.join(" ")).toContain("source 5s–13s");
    expect(output.warnings?.join(" ")).toContain("unretimed cut excerpt");
    expect(output.warnings?.join(" ")).toContain("must be recreated manually");
    expect(edited).toEqual(before);
  });
  it("pads a slow clip's slot without inventing frames beyond the actual source", () => {
    const edited = structuredClone(composition);
    edited.tracks[0]!.clips[0] = {
      id: "slow",
      assetId: "a",
      timelineStart: 2,
      timelineDuration: 4,
      sourceIn: 98,
      sourceOut: 100,
      transform: { speed: 0.5 },
    };
    const result = JSON.parse(exportTimeline("otio", edited, assets).content);
    const children = result.tracks.children[0].children;
    expect(
      children.map((item: { OTIO_SCHEMA: string }) => item.OTIO_SCHEMA),
    ).toEqual(["Gap.1", "Clip.1", "Gap.1", "Gap.1"]);
    const native = children[1];
    expect(
      native.source_range.duration.value / native.source_range.duration.rate,
    ).toBe(2);
    expect(
      native.media_reference.available_range.duration.value /
        native.media_reference.available_range.duration.rate,
    ).toBe(100);
    expect(children[2]).toMatchObject({
      name: "Retime padding for slow",
      metadata: {
        openfilm: {
          clipId: "slow",
          reason: "metadata-only-speed-padding",
          timelineStart: 4,
          duration: 2,
        },
      },
    });
    expect(native.metadata.openfilm.clip.sourceOut).toBe(100);
    expect(native.metadata.openfilm.clip.timelineDuration).toBe(4);
    expect(
      children.reduce(
        (
          sum: number,
          item: { source_range: { duration: { value: number; rate: number } } },
        ) =>
          sum +
          item.source_range.duration.value / item.source_range.duration.rate,
        0,
      ),
    ).toBe(12);
  });
  it("preserves still holds and audio/music tracks while exposing overlay/title semantics as metadata-only", () => {
    const image: MediaAsset = {
      ...assets[0]!,
      id: "image",
      mediaType: "image",
      duration: undefined,
      uri: "file:///media/still.png",
    };
    const audio: MediaAsset = {
      ...assets[0]!,
      id: "audio",
      mediaType: "audio",
      uri: "file:///media/audio.wav",
    };
    const edited: Composition = {
      id: "multiple",
      storyId: "s",
      duration: 8,
      tracks: [
        {
          id: "stills",
          type: "video",
          clips: [
            {
              id: "still",
              assetId: "image",
              timelineStart: 1,
              timelineDuration: 5,
            },
          ],
        },
        {
          id: "music",
          type: "music",
          clips: [
            {
              id: "music",
              assetId: "audio",
              sourceIn: 2,
              sourceOut: 6,
              timelineStart: 0,
              timelineDuration: 4,
              transform: { volume: 0 },
            },
          ],
        },
        {
          id: "overlay",
          type: "overlay",
          clips: [
            {
              id: "overlay",
              assetId: "image",
              timelineStart: 2,
              timelineDuration: 1,
              transform: { x: 20 },
            },
          ],
        },
        {
          id: "titles",
          type: "titles",
          clips: [
            {
              id: "title",
              assetId: "image",
              timelineStart: 3,
              timelineDuration: 1,
              title: "Hi",
            },
          ],
        },
      ],
    };
    const output = exportTimeline("otio", edited, [image, audio]);
    const result = JSON.parse(output.content);
    expect(
      result.tracks.children.map((track: { kind: string }) => track.kind),
    ).toEqual(["Video", "Audio", "Video", "Video"]);
    const still = result.tracks.children[0].children[1];
    expect(
      still.source_range.duration.value / still.source_range.duration.rate,
    ).toBe(5);
    expect(still.media_reference.metadata.openfilm.mediaType).toBe("image");
    expect(output.warnings?.join(" ")).toContain("Track overlay");
    expect(output.warnings?.join(" ")).toContain("Track titles");
  });
  it("reports cut-only support honestly and still rejects overlaps or invalid retime bounds", () => {
    const output = exportTimeline("otio", composition, assets);
    expect(output.warnings).toEqual([]);
    expect(otioCompatibilityReport(composition)).toMatchObject({
      realNleVerified: false,
      advancedEdits: "metadata-only",
      metadataOnlyEdits: [],
    });
    const overlapping = structuredClone(composition);
    overlapping.tracks[0]!.clips.push({
      ...overlapping.tracks[0]!.clips[0]!,
      id: "overlap",
      timelineStart: 3,
    });
    expect(() => exportTimeline("otio", overlapping, assets)).toThrow(
      "overlapping",
    );
    const invalid = structuredClone(composition);
    invalid.tracks[0]!.clips[0]!.transform = { speed: 0 };
    expect(() => exportTimeline("otio", invalid, assets)).toThrow(
      "invalid speed",
    );
    invalid.tracks[0]!.clips[0]!.transform = { speed: 2 };
    expect(() => exportTimeline("otio", invalid, assets)).toThrow(
      "inconsistent speed change",
    );
  });
  it.each(["fcpxml", "edl"] as const)(
    "keeps %s rejection for transitions and nonidentity speed",
    (format) => {
      const edited = structuredClone(composition);
      edited.tracks[0]!.clips[0]!.transition = {
        type: "crossfade",
        duration: 0.5,
      };
      expect(() => exportTimeline(format, edited, assets)).toThrow(
        "transitions",
      );
      delete edited.tracks[0]!.clips[0]!.transition;
      edited.tracks[0]!.clips[0]!.transform = { speed: 2 };
      expect(() => exportTimeline(format, edited, assets)).toThrow(
        "cannot represent speed",
      );
    },
  );
});
