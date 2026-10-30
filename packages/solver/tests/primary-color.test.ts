// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { applyTimelineCommand, type EditorDocument } from "../src/editing.js";
import { PRIMARY_COLOR_IDENTITY, type MediaAsset } from "@openfilm/core";
const correction = { ...PRIMARY_COLOR_IDENTITY, exposureEv: 0.5 };
function fixture() {
  const assets: MediaAsset[] = ["a", "pair"].map((id) => ({
    id,
    uri: `file:///tmp/${id}.png`,
    name: id,
    mediaType: "image",
    tags: [],
    state: {},
    metadata: {},
  }));
  const doc: EditorDocument = {
    story: {
      id: "s",
      title: "Film",
      beats: [{ id: "b", title: "Scene", selectedAssetIds: ["a"] }],
    },
    composition: {
      id: "f",
      storyId: "s",
      duration: 1,
      tracks: [
        {
          id: "v",
          type: "video",
          clips: [
            {
              id: "c",
              assetId: "a",
              beatId: "b",
              timelineStart: 0,
              timelineDuration: 1,
            },
          ],
        },
      ],
    },
  };
  return { assets, doc };
}
it("sets all scopes, preserves selection pins and clears overrides", () => {
  const { assets, doc } = fixture();
  const film = applyTimelineCommand(doc, assets, {
    type: "primary-color",
    scope: "film",
    correction,
  });
  expect(film.composition.defaultPrimaryColor).toEqual(correction);
  expect(doc.composition.defaultPrimaryColor).toBeUndefined();
  const beat = applyTimelineCommand(film, assets, {
    type: "primary-color",
    scope: "beat",
    beatId: "b",
    correction,
  });
  expect(beat.composition.beatPrimaryColors).toEqual([
    { beatId: "b", correction },
  ]);
  const clip = applyTimelineCommand(beat, assets, {
    type: "primary-color",
    scope: "clip",
    clipId: "c",
    correction: PRIMARY_COLOR_IDENTITY,
  });
  expect(clip.composition.tracks[0]!.clips[0]!.primaryColor).toEqual(
    PRIMARY_COLOR_IDENTITY,
  );
  expect(clip.story).toEqual(doc.story);
  expect(
    applyTimelineCommand(clip, assets, {
      type: "primary-color",
      scope: "clip",
      clipId: "c",
      correction: null,
    }).composition.tracks[0]!.clips[0]!.primaryColor,
  ).toBeUndefined();
});
it("rejects effective inherited changes atomically, including paired-photo locks", () => {
  const { assets, doc } = fixture();
  assets[1]!.state.locked = true;
  doc.composition.tracks[0]!.clips[0]!.layout = {
    version: 1,
    preset: "diptych",
    secondary: { assetId: "pair" },
  };
  expect(() =>
    applyTimelineCommand(doc, assets, {
      type: "primary-color",
      scope: "film",
      correction,
    }),
  ).toThrow(/protected/i);
  doc.composition.tracks[0]!.clips[0]!.primaryColor = {
    ...PRIMARY_COLOR_IDENTITY,
  };
  expect(
    applyTimelineCommand(doc, assets, {
      type: "primary-color",
      scope: "film",
      correction,
    }).composition.defaultPrimaryColor,
  ).toEqual(correction);
  expect(() =>
    applyTimelineCommand(doc, assets, {
      type: "primary-color",
      scope: "clip",
      clipId: "c",
      correction,
    }),
  ).toThrow(/unlock/i);
});
it("rejects irrelevant fields and nonvisual or rejected sources", () => {
  const { assets, doc } = fixture();
  expect(() =>
    applyTimelineCommand(doc, assets, {
      type: "primary-color",
      scope: "film",
      correction,
      clipId: "c",
    } as never),
  ).toThrow();
  assets[0]!.state.rejected = true;
  expect(() =>
    applyTimelineCommand(doc, assets, {
      type: "primary-color",
      scope: "clip",
      clipId: "c",
      correction,
    }),
  ).toThrow();
  assets[0]!.state = {};
  doc.composition.tracks[0]!.type = "titles";
  expect(() =>
    applyTimelineCommand(doc, assets, {
      type: "primary-color",
      scope: "clip",
      clipId: "c",
      correction,
    }),
  ).toThrow();
});
