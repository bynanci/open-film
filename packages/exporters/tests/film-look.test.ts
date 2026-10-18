// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from "vitest";
import type { Composition, FilmLook, MediaAsset } from "@openfilm/core";
import {
  exportTimeline,
  otioCompatibilityReport,
  resolveCompatibility,
} from "../src/index.js";

const film: FilmLook = { version: 1, preset: "soft-film", strength: 0.7 };
const beat: FilmLook = { version: 1, preset: "americana", strength: 0.5 };
const clipLook: FilmLook = { version: 1, preset: "retro", strength: 0.9 };
const none: FilmLook = { version: 1, preset: "none", strength: 1 };
const asset: MediaAsset = {
  id: "photo",
  name: "photo.mp4",
  uri: "file:///media/photo.mp4",
  mediaType: "video",
  duration: 10,
  tags: [],
  state: {},
  metadata: {},
};
function cut(): Composition {
  return {
    id: "film",
    storyId: "story",
    duration: 2,
    tracks: [
      {
        id: "visuals",
        type: "video",
        clips: [
          {
            id: "photo-clip",
            assetId: asset.id,
            beatId: "scene",
            timelineStart: 0,
            timelineDuration: 2,
          },
        ],
      },
    ],
  };
}
function nativeClip(document: ReturnType<typeof JSON.parse>) {
  return document.tracks.children[0].children[0];
}

describe("truthful film-look interchange", () => {
  it.each([
    ["film", film, false, false],
    ["beat", beat, true, false],
    ["clip", clipLook, true, true],
  ] as const)(
    "preserves authored configs and effective %s look evidence as metadata only",
    (source, look, sceneOverride, clipOverride) => {
      const composition = cut();
      composition.defaultLook = film;
      if (sceneOverride)
        composition.beatLooks = [{ beatId: "scene", look: beat }];
      if (clipOverride) composition.tracks[0]!.clips[0]!.look = clipLook;
      const before = structuredClone(composition);
      const json = JSON.parse(
        exportTimeline("json", composition, [asset]).content,
      );
      expect(json.composition).toEqual(composition);
      expect(json.schemaVersion).toBe("1.0.0");
      expect(json.metadata.openfilm.effectiveLooks).toEqual([
        { clipId: "photo-clip", look, source },
      ]);
      const output = exportTimeline("otio", composition, [asset]);
      const document = JSON.parse(output.content);
      const native = nativeClip(document);
      expect(document.metadata.openfilm.composition).toEqual(composition);
      expect(native.metadata.openfilm.clip).toEqual(
        composition.tracks[0]!.clips[0],
      );
      expect(native.metadata.openfilm.effectiveLook).toEqual({ look, source });
      expect(native.effects).toEqual([]);
      expect(document.metadata.openfilm.compatibility).toMatchObject({
        realNleVerified: false,
        metadataOnlyEdits: [{ clipId: "photo-clip", features: ["look"] }],
      });
      expect(output.warnings?.join(" ")).toMatch(/look.*METADATA ONLY/);
      expect(output.warnings?.join(" ")).toContain("recreated manually");
      expect(composition).toEqual(before);
    },
  );

  it.each(["fcpxml", "edl"] as const)(
    "rejects active effective film, scene and clip looks in %s",
    (format) => {
      for (const source of ["film", "beat", "clip"] as const) {
        const composition = cut();
        if (source === "film") composition.defaultLook = film;
        if (source === "beat")
          composition.beatLooks = [{ beatId: "scene", look: beat }];
        if (source === "clip") composition.tracks[0]!.clips[0]!.look = clipLook;
        expect(() => exportTimeline(format, composition, [asset])).toThrow(
          /cannot represent look.*photo-clip.*JSON or OTIO/,
        );
      }
    },
  );

  it.each([
    ["film none", { defaultLook: none }],
    ["film zero strength", { defaultLook: { ...film, strength: 0 } }],
    [
      "scene breaks inheritance",
      { defaultLook: film, beatLooks: [{ beatId: "scene", look: none }] },
    ],
    ["unused scene", { beatLooks: [{ beatId: "elsewhere", look: beat }] }],
  ] satisfies [string, Pick<Composition, "defaultLook" | "beatLooks">][])(
    "does not warn or reject for %s",
    (_name, config) => {
      const composition: Composition = { ...cut(), ...structuredClone(config) };
      expect(otioCompatibilityReport(composition).metadataOnlyEdits).toEqual(
        [],
      );
      expect(exportTimeline("otio", composition, [asset]).warnings).toEqual([]);
      for (const format of ["fcpxml", "edl"] as const)
        expect(exportTimeline(format, composition, [asset])).toEqual(
          exportTimeline(format, cut(), [asset]),
        );
    },
  );

  it.each([none, { ...clipLook, strength: 0 }])(
    "does not warn or reject for an inactive clip override of active inherited looks: %j",
    (look) => {
      const composition = cut();
      composition.defaultLook = film;
      composition.beatLooks = [{ beatId: "scene", look: beat }];
      composition.tracks[0]!.clips[0]!.look = look;
      expect(otioCompatibilityReport(composition).metadataOnlyEdits).toEqual(
        [],
      );
      const document = JSON.parse(
        exportTimeline("otio", composition, [asset]).content,
      );
      expect(nativeClip(document).metadata.openfilm.effectiveLook).toEqual({
        look,
        source: "clip",
      });
      for (const format of ["fcpxml", "edl"] as const)
        expect(exportTimeline(format, composition, [asset])).toEqual(
          exportTimeline(format, cut(), [asset]),
        );
    },
  );

  it.each(["audio", "music", "titles"] as const)(
    "does not apply inherited color to %s tracks",
    (type) => {
      const composition = cut();
      composition.defaultLook = film;
      composition.tracks[0]!.type = type;
      const output = exportTimeline("otio", composition, [asset]);
      const document = JSON.parse(output.content);
      expect(
        nativeClip(document).metadata.openfilm.effectiveLook,
      ).toBeUndefined();
      expect(
        otioCompatibilityReport(composition).metadataOnlyEdits.flatMap(
          (edit) => edit.features,
        ),
      ).not.toContain("look");
      if (type !== "titles") {
        const plain = structuredClone(composition);
        delete plain.defaultLook;
        expect(exportTimeline("fcpxml", composition, [asset])).toEqual(
          exportTimeline("fcpxml", plain, [asset]),
        );
      }
    },
  );

  it.each(["image", "video", "360-video"] as const)(
    "preserves active inherited look evidence for %s source media",
    (mediaType) => {
      const composition = cut();
      composition.defaultLook = film;
      const output = exportTimeline("otio", composition, [
        { ...asset, mediaType },
      ]);
      const document = JSON.parse(output.content);
      expect(nativeClip(document).metadata.openfilm.effectiveLook).toEqual({
        look: film,
        source: "film",
      });
      expect(
        document.metadata.openfilm.compatibility.metadataOnlyEdits,
      ).toEqual([{ clipId: "photo-clip", features: ["look"] }]);
    },
  );

  it("preserves active overlay colors and only reports affected visual clips", () => {
    const composition = cut();
    composition.defaultLook = film;
    composition.tracks[0]!.type = "overlay";
    composition.tracks[0]!.clips.push({
      ...composition.tracks[0]!.clips[0]!,
      id: "original-color",
      timelineStart: 2,
      look: none,
    });
    composition.duration = 4;
    const report = otioCompatibilityReport(composition);
    expect(report.metadataOnlyEdits).toEqual([
      { clipId: "photo-clip", features: ["look", "overlay"] },
      { clipId: "original-color", features: ["overlay"] },
    ]);
    const document = JSON.parse(
      exportTimeline("otio", composition, [asset]).content,
    );
    expect(nativeClip(document).metadata.openfilm.effectiveLook).toEqual({
      look: film,
      source: "film",
    });
  });

  it("preserves the image look when a visual clip also has a caption", () => {
    const composition = cut();
    composition.defaultLook = film;
    composition.tracks[0]!.clips[0]!.title = "Our story";
    const document = JSON.parse(
      exportTimeline("otio", composition, [asset]).content,
    );
    expect(nativeClip(document).metadata.openfilm.effectiveLook).toEqual({
      look: film,
      source: "film",
    });
    expect(otioCompatibilityReport(composition).metadataOnlyEdits).toEqual([
      { clipId: "photo-clip", features: ["title", "look"] },
    ]);
  });

  it("does not add default look metadata or migrate old compositions", () => {
    const composition = cut();
    const before = structuredClone(composition);
    const json = JSON.parse(
      exportTimeline("json", composition, [asset]).content,
    );
    const document = JSON.parse(
      exportTimeline("otio", composition, [asset]).content,
    );
    expect(json).toEqual({
      schemaVersion: "1.0.0",
      composition,
      assets: [asset],
      settings: { width: 1920, height: 1080, frameRate: 30 },
    });
    expect(nativeClip(document).metadata.openfilm).toEqual({
      clipId: "photo-clip",
      assetId: asset.id,
      beatId: "scene",
      clip: composition.tracks[0]!.clips[0],
      nativeCutDuration: 2,
      advancedEdits: "metadata-only",
    });
    expect(document.metadata.openfilm.composition).toEqual(before);
    expect(composition).toEqual(before);
  });

  it("keeps Resolve color support metadata only with an open application QA gate", () => {
    expect(
      resolveCompatibility.features.find((feature) => feature.id === "look"),
    ).toEqual({
      id: "look",
      implementation: "metadata-only",
      schemaValidated: true,
      parserValidated: false,
      realNleVerified: false,
      manualRecreation: true,
    });
  });
});
