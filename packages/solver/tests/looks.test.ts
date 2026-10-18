// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  ApplicationError,
  resolveFilmLook,
  type Clip,
  type FilmLook,
  type MediaAsset,
} from "@openfilm/core";
import {
  applyTimelineCommand,
  type EditorDocument,
  type TimelineCommand,
} from "../src/index.js";

const look = (preset: FilmLook["preset"], strength = 1): FilmLook => ({
  version: 1,
  preset,
  strength,
});
function fixture(): { document: EditorDocument; assets: MediaAsset[] } {
  const asset = (
    id: string,
    mediaType: MediaAsset["mediaType"] = "image",
  ): MediaAsset => ({
    id,
    name: id,
    uri: `file:///${id}`,
    mediaType,
    state: {},
    tags: [],
    metadata: {},
    ...(mediaType === "video" || mediaType === "audio" ? { duration: 20 } : {}),
  });
  const assets = [
    asset("photo"),
    asset("pair"),
    asset("video", "video"),
    asset("alternate"),
    asset("audio", "audio"),
  ];
  return {
    assets,
    document: {
      story: {
        id: "story",
        title: "Story",
        targetDuration: 8,
        maxDuration: 12,
        beats: [
          {
            id: "first",
            title: "First",
            candidateAssetIds: ["photo", "pair", "alternate"],
          },
          { id: "second", title: "Second", candidateAssetIds: ["video"] },
        ],
      },
      composition: {
        id: "composition",
        storyId: "story",
        duration: 8,
        tracks: [
          {
            id: "video",
            type: "video",
            clips: [
              {
                id: "photo-clip",
                assetId: "photo",
                beatId: "first",
                sourceIn: 0,
                sourceOut: 4,
                timelineStart: 0,
                timelineDuration: 4,
              },
              {
                id: "video-clip",
                assetId: "video",
                beatId: "second",
                sourceIn: 2,
                sourceOut: 6,
                timelineStart: 4,
                timelineDuration: 4,
              },
            ],
          },
        ],
      },
    },
  };
}
const clip = (document: EditorDocument, id = "photo-clip"): Clip =>
  document.composition.tracks
    .flatMap((track) => track.clips)
    .find((entry) => entry.id === id)!;
const apply = (
  document: EditorDocument,
  assets: MediaAsset[],
  command: TimelineCommand,
) => applyTimelineCommand(document, assets, command);

describe("non-destructive film look commands", () => {
  it("sets, overrides and clears film, scene and clip looks without touching time or sources", () => {
    const { document, assets } = fixture();
    const original = structuredClone(document);
    const film = apply(document, assets, {
      type: "look",
      scope: "film",
      look: look("natural"),
    });
    expect(film.composition.defaultLook).toEqual(look("natural"));
    expect(film.composition.tracks).toEqual(original.composition.tracks);
    const scene = apply(film, assets, {
      type: "look",
      scope: "beat",
      beatId: "first",
      look: look("retro"),
    });
    expect(scene.composition.beatLooks).toEqual([
      { beatId: "first", look: look("retro") },
    ]);
    const single = apply(scene, assets, {
      type: "look",
      scope: "clip",
      clipId: "photo-clip",
      look: look("none"),
    });
    expect(resolveFilmLook(single.composition, clip(single)).source).toBe(
      "clip",
    );
    expect(resolveFilmLook(single.composition, clip(single)).look.preset).toBe(
      "none",
    );
    const inherited = apply(single, assets, {
      type: "look",
      scope: "clip",
      clipId: "photo-clip",
      look: null,
    });
    expect(clip(inherited).look).toBeUndefined();
    expect(
      resolveFilmLook(inherited.composition, clip(inherited)).look.preset,
    ).toBe("retro");
    const noScene = apply(inherited, assets, {
      type: "look",
      scope: "beat",
      beatId: "first",
      look: null,
    });
    expect(noScene.composition.beatLooks).toBeUndefined();
    const cleared = apply(noScene, assets, {
      type: "look",
      scope: "film",
      look: null,
    });
    expect(cleared).toEqual(original);
    expect(document).toEqual(original);
  });

  it.each(["clip", "primary", "secondary"] as const)(
    "atomically refuses a film or scene change affecting a locked %s",
    (protectedType) => {
      const { document, assets } = fixture();
      const photo = clip(document);
      if (protectedType === "clip") photo.locked = true;
      if (protectedType === "primary") assets[0]!.state.locked = true;
      if (protectedType === "secondary") {
        photo.layout = {
          version: 1,
          preset: "diptych",
          secondary: { assetId: "pair" },
        };
        assets[1]!.state.locked = true;
      }
      const original = structuredClone(document);
      for (const command of [
        { type: "look", scope: "film", look: look("retro") },
        { type: "look", scope: "beat", beatId: "first", look: look("retro") },
      ] as TimelineCommand[]) {
        expect(() => apply(document, assets, command)).toThrowError(
          expect.objectContaining({
            code: "timeline.lookLocked",
            status: 409,
            params: { count: 1 },
          }),
        );
        expect(document).toEqual(original);
      }
    },
  );

  it("allows a parent change when protected clips retain the same effective matrix", () => {
    const { document, assets } = fixture();
    clip(document).locked = true;
    clip(document).look = look("none");
    const changed = apply(document, assets, {
      type: "look",
      scope: "film",
      look: look("retro"),
    });
    expect(changed.composition.defaultLook).toEqual(look("retro"));
    expect(clip(changed)).toEqual(clip(document));
    delete clip(document).look;
    const noChange = apply(document, assets, {
      type: "look",
      scope: "film",
      look: look("sport", 0),
    });
    expect(noChange.composition.defaultLook).toEqual(look("sport", 0));
    const unrelatedScene = apply(document, assets, {
      type: "look",
      scope: "beat",
      beatId: "second",
      look: look("retro"),
    });
    expect(unrelatedScene.composition.beatLooks).toHaveLength(1);
  });

  it("counts protected clips and rejects clearing an inherited active look atomically", () => {
    const { document, assets } = fixture();
    document.composition.defaultLook = look("natural");
    clip(document).locked = true;
    assets[2]!.state.locked = true;
    const before = structuredClone(document);
    expect(() =>
      apply(document, assets, { type: "look", scope: "film", look: null }),
    ).toThrowError(
      expect.objectContaining({
        code: "timeline.lookLocked",
        params: { count: 2 },
      }),
    );
    expect(document).toEqual(before);
    expect(
      apply(document, assets, {
        type: "look",
        scope: "film",
        look: look("natural"),
      }),
    ).toEqual(before);
    document.composition.beatLooks = [{ beatId: "first", look: look("retro") }];
    expect(() =>
      apply(document, assets, {
        type: "look",
        scope: "beat",
        beatId: "first",
        look: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "timeline.lookLocked",
        params: { count: 1 },
      }),
    );
  });

  it("keeps explicit clip original colors when a scene setting changes or is removed", () => {
    const { document, assets } = fixture();
    document.composition.defaultLook = look("sport");
    clip(document).look = look("none");
    const next = apply(document, assets, {
      type: "look",
      scope: "beat",
      beatId: "first",
      look: look("retro"),
    });
    expect(resolveFilmLook(next.composition, clip(next)).look).toEqual(
      look("none"),
    );
    const removed = apply(next, assets, {
      type: "look",
      scope: "beat",
      beatId: "first",
      look: null,
    });
    expect(resolveFilmLook(removed.composition, clip(removed)).look).toEqual(
      look("none"),
    );
    expect(
      resolveFilmLook(removed.composition, clip(removed, "video-clip")).look,
    ).toEqual(look("sport"));
  });

  it("does not treat locked audio or titles as visual look targets", () => {
    const { document, assets } = fixture();
    assets[4]!.state.locked = true;
    document.composition.tracks.push({
      id: "audio",
      type: "audio",
      timing: "overlay",
      clips: [
        {
          id: "audio-clip",
          assetId: "audio",
          timelineStart: 0,
          timelineDuration: 4,
          locked: true,
        },
      ],
    });
    document.composition.tracks.push({
      id: "titles",
      type: "titles",
      clips: [
        {
          id: "title",
          assetId: "missing-title-source",
          timelineStart: 0,
          timelineDuration: 4,
          locked: true,
          title: "Title",
        },
      ],
    });
    expect(
      apply(document, assets, {
        type: "look",
        scope: "film",
        look: look("natural"),
      }).composition.defaultLook,
    ).toEqual(look("natural"));
    expect(() =>
      apply(document, assets, {
        type: "look",
        scope: "clip",
        clipId: "audio-clip",
        look: look("retro"),
      }),
    ).toThrow();
    expect(() =>
      apply(document, assets, {
        type: "look",
        scope: "clip",
        clipId: "title",
        look: look("retro"),
      }),
    ).toThrow();
  });

  it("rejects unsupported, rejected or source-locked clip edits including paired source locks", () => {
    for (const state of [
      "locked",
      "rejected",
      "unsupported",
      "secondary",
    ] as const) {
      const { document, assets } = fixture();
      if (state === "locked") assets[0]!.state.locked = true;
      if (state === "rejected") assets[0]!.state.rejected = true;
      if (state === "unsupported")
        assets[0]!.metadata["openfilm.preview"] = { supported: false };
      if (state === "secondary") {
        clip(document).layout = {
          version: 1,
          preset: "diptych",
          secondary: { assetId: "pair" },
        };
        assets[1]!.state.locked = true;
      }
      expect(() =>
        apply(document, assets, {
          type: "look",
          scope: "clip",
          clipId: "photo-clip",
          look: look("sport"),
        }),
      ).toThrow();
    }
  });

  it("validates every scope, target and recipe rather than silently ignoring invalid fields", () => {
    const { document, assets } = fixture();
    for (const command of [
      { type: "look", scope: "bad", look: look("natural") },
      { type: "look", scope: "film" },
      {
        type: "look",
        scope: "film",
        clipId: "photo-clip",
        look: look("natural"),
      },
      { type: "look", scope: "beat", beatId: "missing", look: look("natural") },
      { type: "look", scope: "clip", clipId: "missing", look: look("natural") },
      {
        type: "look",
        scope: "film",
        look: { ...look("natural"), strength: 2 },
      },
    ])
      expect(() =>
        apply(document, assets, command as TimelineCommand),
      ).toThrow();
  });

  it("retains clip looks through split and replace, and parent looks through regeneration", () => {
    const { document, assets } = fixture();
    document.composition.defaultLook = look("natural");
    document.composition.beatLooks = [{ beatId: "first", look: look("retro") }];
    clip(document).look = look("americana");
    clip(document, "video-clip").look = look("sport");
    const split = apply(document, assets, {
      type: "clip.split",
      clipId: "video-clip",
      sourceTime: 4,
    });
    expect(clip(split, "video-clip-split-1").look).toEqual(look("sport"));
    const replaced = apply(document, assets, {
      type: "replace",
      clipId: "photo-clip",
      assetId: "alternate",
    });
    expect(clip(replaced).look).toEqual(look("americana"));
    const regenerated = apply(document, assets, {
      type: "regenerate-beat",
      beatId: "first",
      mode: "regenerate",
    });
    expect(regenerated.composition.defaultLook).toEqual(
      document.composition.defaultLook,
    );
    expect(regenerated.composition.beatLooks).toEqual(
      document.composition.beatLooks,
    );
    expect(clip(regenerated, "video-clip")).toEqual(
      clip(document, "video-clip"),
    );
  });

  it("exports the structured lock error for localized adapter handling", () => {
    const { document, assets } = fixture();
    clip(document).locked = true;
    try {
      apply(document, assets, {
        type: "look",
        scope: "film",
        look: look("retro"),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError);
      return;
    }
    throw new Error("Expected protected look edit to fail");
  });
});
