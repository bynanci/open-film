import { describe, expect, it } from "vitest";
import { resolvePhotoPlan, type MediaAsset } from "@openfilm/core";
import {
  buildPhotoFilmQualityScenario,
  qualitySampleTimes,
} from "../../fixtures/photo-film-quality/scenario.js";

const ids = [
  "portrait-center",
  "portrait-left",
  "landscape-pair",
  "landscape-detail",
  "square-detail",
  "far-apart-subjects",
  "portrait-right",
  "landscape-closing",
  "synthetic-music",
  "synthetic-narration",
];
const assets: MediaAsset[] = ids.map((id) => ({
  id,
  uri: `file:///fixture/${id}`,
  name: id,
  mediaType: id.startsWith("synthetic") ? "audio" : "image",
  tags: [],
  state: {},
  metadata: {},
}));

describe("public photo-film quality comparison recipe", () => {
  it("compares the same 20-second timeline with actual visual and audio differences", () => {
    const input = structuredClone(assets);
    const { baseline, designed } = buildPhotoFilmQualityScenario(assets);
    expect(assets).toEqual(input);
    expect(baseline.duration).toBe(20);
    expect(designed.duration).toBe(20);
    expect(
      designed.tracks[0]!.clips.map(({ timelineStart, timelineDuration }) => ({
        timelineStart,
        timelineDuration,
      })),
    ).toEqual(
      baseline.tracks[0]!.clips.map(({ timelineStart, timelineDuration }) => ({
        timelineStart,
        timelineDuration,
      })),
    );
    expect(
      baseline.tracks[0]!.clips.every((clip) => !clip.layout && !clip.motion),
    ).toBe(true);
    expect(
      new Set(
        designed.tracks[0]!.clips.flatMap((clip) => [
          clip.assetId,
          ...(clip.layout?.secondary ? [clip.layout.secondary.assetId] : []),
        ]),
      ).size,
    ).toBe(8);
    expect(designed.tracks[2]!.clips[0]!.audioAutomation?.ducking).toHaveLength(
      1,
    );
    expect(
      designed.tracks.slice(2).every((track) => track.timing === "overlay"),
    ).toBe(true);
    expect(
      designed.tracks[1]!.clips.map((clip) => clip.titleStyle?.role),
    ).toEqual(["film-title", "scene-statement", "subtitle"]);
    expect(qualitySampleTimes).toContain(0);
    expect(qualitySampleTimes).toContain(19.9);
    expect(qualitySampleTimes).toContain(3);
  });

  it("refuses an incomplete source set rather than silently omitting a comparison", () => {
    expect(() =>
      buildPhotoFilmQualityScenario(
        assets.filter((asset) => asset.id !== "far-apart-subjects"),
      ),
    ).toThrow("requires asset far-apart-subjects");
  });

  it("demonstrates real safe motion and intentional protected-region fallback", () => {
    const { designed } = buildPhotoFilmQualityScenario(assets);
    const pictures = designed.tracks[0]!.clips;
    const frame = { width: 960, height: 540 };
    const sources = {
      "portrait-center": { width: 600, height: 900 },
      "landscape-detail": { width: 1200, height: 675 },
      "far-apart-subjects": { width: 1600, height: 600 },
    };
    const push = resolvePhotoPlan(pictures[0]!, sources, frame);
    expect(push.warnings).toEqual([]);
    expect(push.motion.to.scale).toBeGreaterThan(push.motion.from.scale);
    const pan = resolvePhotoPlan(pictures[2]!, sources, frame);
    expect(pan.warnings).toEqual([]);
    expect(pan.motion.to.x).toBeGreaterThan(pan.motion.from.x);
    expect(resolvePhotoPlan(pictures[5]!, sources, frame).warnings).toContain(
      "PHOTO_PROTECTED_REGION_CONTAIN_FALLBACK",
    );
  });
});
