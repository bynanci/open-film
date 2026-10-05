import { describe, expect, it } from "vitest";
import type { Clip, MediaAsset } from "@openfilm/core";
import {
  applyTimelineCommand,
  suggestShortening,
  prepareShorteningPlan,
  shorteningCommands,
  type EditorDocument,
  type TimelineCommand,
} from "../src/index.js";

const asset = (id: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id,
  name: id,
  uri: `file:///${id}`,
  mediaType: "image",
  tags: [],
  state: {},
  metadata: {},
  ...patch,
});
const assets = [
  asset("photo"),
  asset("video", { mediaType: "video", duration: 20 }),
  asset("next"),
  asset("alternate", { tags: ["beach"] }),
  asset("short", { mediaType: "video", duration: 2 }),
  asset("audio", { mediaType: "audio", duration: 20 }),
];
function document(): EditorDocument {
  return {
    story: {
      id: "story",
      title: "My film",
      targetDuration: 12,
      maxDuration: 12,
      beats: [
        {
          id: "intro",
          title: "Intro",
          candidateAssetIds: ["photo", "video", "alternate", "short"],
        },
        { id: "end", title: "End" },
      ],
    },
    composition: {
      id: "composition",
      storyId: "story",
      duration: 14,
      tracks: [
        {
          id: "video-track",
          type: "video",
          clips: [
            {
              id: "photo-clip",
              assetId: "photo",
              beatId: "intro",
              sourceIn: 0,
              sourceOut: 4,
              timelineStart: 0,
              timelineDuration: 4,
            },
            {
              id: "video-clip",
              assetId: "video",
              beatId: "intro",
              sourceIn: 3,
              sourceOut: 9,
              timelineStart: 4,
              timelineDuration: 6,
            },
            {
              id: "next-clip",
              assetId: "next",
              beatId: "end",
              sourceIn: 0,
              sourceOut: 4,
              timelineStart: 10,
              timelineDuration: 4,
              transform: { scale: 1.4, x: 22, y: -8, volume: 0.2 },
              transition: { type: "crossfade", duration: 0.5 },
              title: "Manual title",
            },
          ],
        },
      ],
    },
  };
}
const clips = (doc: EditorDocument): Clip[] =>
  doc.composition.tracks.flatMap((track) => track.clips);
const clip = (doc: EditorDocument, id: string): Clip =>
  clips(doc).find((clip) => clip.id === id)!;
const edit = (doc: EditorDocument, command: TimelineCommand): EditorDocument =>
  applyTimelineCommand(doc, assets, command);
function withoutStart(clip: Clip): Omit<Clip, "timelineStart"> {
  const { timelineStart: _, ...rest } = clip;
  return rest;
}
function freezeDeep(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value))
    if (child !== null && typeof child === "object") freezeDeep(child);
}

describe("pure timeline commands", () => {
  it("trims actual source media, accounts for speed, and ripples later beats without changing their edits", () => {
    let current = edit(document(), {
      type: "speed",
      clipId: "video-clip",
      speed: 2,
    });
    current = edit(current, {
      type: "trim",
      clipId: "video-clip",
      sourceIn: 5,
      sourceOut: 9,
    });
    expect(clip(current, "video-clip")).toMatchObject({
      sourceIn: 5,
      sourceOut: 9,
      timelineStart: 4,
      timelineDuration: 2,
      transform: { speed: 2 },
    });
    expect(clip(current, "next-clip").timelineStart).toBe(6);
    expect(withoutStart(clip(current, "next-clip"))).toEqual(
      withoutStart(clip(document(), "next-clip")),
    );
    expect(current.composition.duration).toBe(10);
  });
  it("uses absolute still duration while preserving speed and creates saveable over-limit edits", () => {
    let current = edit(document(), {
      type: "speed",
      clipId: "photo-clip",
      speed: 2,
    });
    current = edit(current, {
      type: "duration",
      clipId: "photo-clip",
      duration: 20,
    });
    expect(clip(current, "photo-clip")).toMatchObject({
      sourceIn: 0,
      sourceOut: 40,
      timelineDuration: 20,
      transform: { speed: 2 },
    });
    expect(current.composition.duration).toBe(30);
    expect(current.story.maxDuration).toBe(12);
  });
  it.each([
    { type: "trim", clipId: "video-clip", sourceIn: -1, sourceOut: 4 },
    { type: "trim", clipId: "video-clip", sourceIn: 4, sourceOut: 4 },
    { type: "trim", clipId: "video-clip", sourceIn: 1, sourceOut: 21 },
    { type: "trim", clipId: "photo-clip", sourceIn: 0, sourceOut: 3 },
    { type: "duration", clipId: "video-clip", duration: 3 },
    { type: "duration", clipId: "photo-clip", duration: 0 },
    { type: "speed", clipId: "video-clip", speed: 0 },
    { type: "speed", clipId: "video-clip", speed: NaN },
    { type: "volume", clipId: "video-clip", volume: -1 },
    { type: "volume", clipId: "video-clip", volume: 1.1 },
    { type: "transform", clipId: "video-clip", scale: 0 },
    { type: "transform", clipId: "video-clip", x: Infinity },
    {
      type: "transition",
      clipId: "video-clip",
      transition: "crossfade",
      duration: 7,
    },
    { type: "reorder", clipId: "photo-clip", toIndex: 2 },
    { type: "reorder", clipId: "photo-clip", toIndex: 0.5 },
  ] satisfies TimelineCommand[])(
    "rejects invalid input $type without mutating history",
    (command) => {
      const before = document(),
        original = structuredClone(before);
      expect(() => edit(before, command)).toThrow();
      expect(before).toEqual(original);
    },
  );
  it("merges transforms and volume, applies an incoming fade, then removes it for cut", () => {
    let current = edit(document(), {
      type: "transform",
      clipId: "next-clip",
      scale: 2,
      rotation: 15,
    });
    current = edit(current, { type: "volume", clipId: "next-clip", volume: 0 });
    current = edit(current, {
      type: "transition",
      clipId: "next-clip",
      transition: "crossfade",
      duration: 1,
    });
    expect(clip(current, "next-clip").transform).toEqual({
      scale: 2,
      rotation: 15,
      x: 22,
      y: -8,
      volume: 0,
    });
    expect(clip(current, "next-clip").transition).toEqual({
      type: "crossfade",
      duration: 1,
    });
    current = edit(current, {
      type: "duration",
      clipId: "next-clip",
      duration: 0.25,
    });
    expect(clip(current, "next-clip").transition?.duration).toBe(0.25);
    current = edit(current, {
      type: "transition",
      clipId: "next-clip",
      transition: "cut",
    });
    expect(clip(current, "next-clip").transition).toBeUndefined();
  });
  it("reorders only same-beat slots and retains all durations and effects", () => {
    const before = document();
    const current = edit(before, {
      type: "reorder",
      clipId: "video-clip",
      toIndex: 0,
    });
    expect(clips(current).map((clip) => clip.id)).toEqual([
      "video-clip",
      "photo-clip",
      "next-clip",
    ]);
    expect(clips(current).map((clip) => clip.timelineStart)).toEqual([
      0, 6, 10,
    ]);
    for (const item of clips(before))
      expect(withoutStart(clip(current, item.id))).toEqual(withoutStart(item));
  });
  it("replaces a clip with a shorter actual source and retains its manual effects", () => {
    const before = edit(document(), {
      type: "volume",
      clipId: "video-clip",
      volume: 0.3,
    });
    const current = edit(before, {
      type: "replace",
      clipId: "video-clip",
      assetId: "short",
    });
    expect(clip(current, "video-clip")).toMatchObject({
      assetId: "short",
      sourceIn: 0,
      sourceOut: 2,
      timelineDuration: 2,
      transform: { volume: 0.3 },
    });
    expect(current.composition.duration).toBe(10);
    expect(() =>
      edit(before, { type: "replace", clipId: "video-clip", assetId: "audio" }),
    ).toThrow("same media track");
  });
  it("deletes with ripple while allowing empty tracks and immutable undo snapshots", () => {
    const before = document();
    freezeDeep(before);
    const after = edit(before, { type: "delete", clipId: "video-clip" });
    expect(clips(after).map((clip) => clip.id)).toEqual([
      "photo-clip",
      "next-clip",
    ]);
    expect(clip(after, "next-clip").timelineStart).toBe(4);
    expect(before.composition.duration).toBe(14);
    clip(after, "next-clip").transform!.x = 999;
    expect(clip(before, "next-clip").transform?.x).toBe(22);
  });
  it("explicitly unlocks clip locks and protects locked/required identity", () => {
    const locked = edit(document(), {
      type: "lock",
      clipId: "video-clip",
      locked: true,
    });
    for (const command of [
      { type: "delete", clipId: "video-clip" },
      { type: "trim", clipId: "video-clip", sourceIn: 0, sourceOut: 2 },
      { type: "volume", clipId: "video-clip", volume: 0.4 },
    ] satisfies TimelineCommand[])
      expect(() => edit(locked, command)).toThrow("locked");
    expect(() =>
      edit(
        edit(locked, { type: "lock", clipId: "video-clip", locked: false }),
        { type: "delete", clipId: "video-clip" },
      ),
    ).not.toThrow();
    const required = document();
    required.story.beats[0]!.constraints = [
      { type: "must-include", assetIds: ["video"] },
    ];
    expect(() =>
      edit(required, { type: "delete", clipId: "video-clip" }),
    ).toThrow("required");
    expect(() =>
      applyTimelineCommand(
        document(),
        assets.map((asset) =>
          asset.id === "video" ? { ...asset, state: { locked: true } } : asset,
        ),
        { type: "replace", clipId: "video-clip", assetId: "short" },
      ),
    ).toThrow("locked");
  });
  it("validates source metadata, missing references, and coherent beat duration patches", () => {
    expect(() =>
      edit(document(), { type: "volume", clipId: "missing", volume: 1 }),
    ).toThrow("not found");
    expect(() =>
      applyTimelineCommand(
        document(),
        assets.map((asset) =>
          asset.id === "video" ? { ...asset, duration: undefined } : asset,
        ),
        { type: "trim", clipId: "video-clip", sourceIn: 0, sourceOut: 2 },
      ),
    ).toThrow("usable duration");
    const before = document();
    const current = edit(before, {
      type: "beat",
      beatId: "intro",
      patch: {
        title: "New title",
        intent: "Set the scene",
        minDuration: 3,
        targetDuration: 6,
        maxDuration: 8,
      },
    });
    expect(current.story.beats[0]).toMatchObject({
      title: "New title",
      intent: "Set the scene",
      minDuration: 3,
      targetDuration: 6,
      maxDuration: 8,
    });
    expect(current.composition).toEqual(before.composition);
    expect(() =>
      edit(current, {
        type: "beat",
        beatId: "intro",
        patch: { maxDuration: 2 },
      }),
    ).toThrow("minimum exceeds");
    expect(() =>
      edit(current, {
        type: "beat",
        beatId: "intro",
        patch: { targetDuration: Infinity },
      }),
    ).toThrow("finite");
  });
});

describe("scoped automatic editing", () => {
  it.each([
    "regenerate",
    "shorten",
    "more-video",
    "more-photos",
    "replace-similar",
    "remove-repetition",
  ] as const)(
    "%s preserves manual work outside the selected beat and both kinds of locks",
    (mode) => {
      const before = document();
      clip(before, "video-clip").locked = true;
      clip(before, "video-clip").transform = {
        speed: 1,
        scale: 2,
        volume: 0.3,
      };
      const lockedAssets = assets.map((asset) =>
        asset.id === "photo" ? { ...asset, state: { locked: true } } : asset,
      );
      before.story.beats[0]!.targetDuration = 12;
      const current = applyTimelineCommand(before, lockedAssets, {
        type: "regenerate-beat",
        beatId: "intro",
        mode,
      });
      for (const id of ["photo-clip", "video-clip", "next-clip"])
        expect(withoutStart(clip(current, id))).toEqual(
          withoutStart(clip(before, id)),
        );
      expect(current.composition.id).toBe(before.composition.id);
      expect(current.story).toEqual(before.story);
    },
  );
  it("more-video and more-photos shift eligible media balance and obey shorter source durations", () => {
    const before = document();
    before.story.beats[0]!.targetDuration = 8;
    for (const mode of ["more-video", "more-photos"] as const) {
      const current = edit(before, {
        type: "regenerate-beat",
        beatId: "intro",
        mode,
      });
      for (const item of clips(current).filter(
        (clip) => clip.beatId === "intro",
      )) {
        const source = assets.find((asset) => asset.id === item.assetId)!;
        expect(source.mediaType).toBe(
          mode === "more-video" ? "video" : "image",
        );
        if (source.duration !== undefined)
          expect(item.sourceOut).toBeLessThanOrEqual(source.duration);
      }
      expect(withoutStart(clip(current, "next-clip"))).toEqual(
        withoutStart(clip(before, "next-clip")),
      );
      expect(current.composition.duration).toBeCloseTo(12);
    }
  });
  it("preserves must-include and selected source edits and avoids assets already used by another beat", () => {
    const before = document();
    before.story.beats[0]!.selectedAssetIds = ["video"];
    before.story.beats[0]!.constraints = [
      { type: "must-include", assetIds: ["photo"] },
    ];
    before.story.beats[0]!.candidateAssetIds = undefined;
    before.story.beats[0]!.targetDuration = 18;
    const current = edit(before, {
      type: "regenerate-beat",
      beatId: "intro",
      mode: "regenerate",
    });
    expect(withoutStart(clip(current, "video-clip"))).toEqual(
      withoutStart(clip(before, "video-clip")),
    );
    expect(withoutStart(clip(current, "photo-clip"))).toEqual(
      withoutStart(clip(before, "photo-clip")),
    );
    expect(
      clips(current).filter((clip) => clip.assetId === "next"),
    ).toHaveLength(1);
  });
  it("removes fingerprint repetition without deleting protected content or crossing the beat minimum", () => {
    const before = document();
    before.story.beats[0]!.minDuration = 4;
    clip(before, "photo-clip").locked = true;
    const duplicateAssets = assets.map((asset) =>
      ["photo", "video"].includes(asset.id)
        ? { ...asset, perceptualHash: "same-frame" }
        : asset,
    );
    const current = applyTimelineCommand(before, duplicateAssets, {
      type: "regenerate-beat",
      beatId: "intro",
      mode: "remove-repetition",
    });
    expect(clips(current).map((clip) => clip.id)).toEqual([
      "photo-clip",
      "next-clip",
    ]);
    expect(clip(current, "next-clip").timelineStart).toBe(4);
  });
  it("replaces similar content by tag evidence and keeps the clip's effects", () => {
    const before = document();
    const similarAssets = assets.map((asset) =>
      asset.id === "photo" ? { ...asset, tags: ["beach"] } : asset,
    );
    clip(before, "photo-clip").transform = { scale: 1.7, x: 9 };
    const current = applyTimelineCommand(before, similarAssets, {
      type: "regenerate-beat",
      beatId: "intro",
      mode: "replace-similar",
    });
    expect(clip(current, "photo-clip")).toMatchObject({
      assetId: "alternate",
      timelineDuration: 4,
      transform: { scale: 1.7, x: 9 },
    });
  });
  it("populates an empty beat at its story position with deterministic IDs", () => {
    const before = document();
    before.story.beats.splice(1, 0, {
      id: "middle",
      title: "Middle",
      candidateAssetIds: ["alternate"],
      targetDuration: 3,
    });
    const command: TimelineCommand = {
      type: "regenerate-beat",
      beatId: "middle",
      mode: "regenerate",
    };
    const current = edit(before, command);
    expect(
      clips(current).find((clip) => clip.beatId === "middle"),
    ).toMatchObject({ timelineStart: 10, timelineDuration: 3 });
    expect(clip(current, "next-clip").timelineStart).toBe(13);
    expect(edit(before, command)).toEqual(current);
  });
});

describe("explainable fit suggestions", () => {
  it("measures a later deletion from the current cut instead of the shortened intermediate clip", () => {
    const before = document();
    clip(before, "next-clip").locked = true;
    const sequential = suggestShortening(before, assets, 4);
    const step = sequential.find(
      (step) => step.command.type === "delete" && step.clipId === "photo-clip",
    )!;
    expect(step.secondsSaved).toBe(1);
    const prepared = prepareShorteningPlan(before, assets, 4);
    const preview = prepared.suggestions.find(
      (suggestion) => suggestion.id === step.id,
    )!;
    expect(preview.secondsSaved).toBe(4);
    expect(preview.reason).toContain("Saves 4.00s from the current cut");
    expect(preview.beforeDuration).toBe(14);
    expect(preview.afterDuration).toBe(10);
    const commands = shorteningCommands(before, assets, 4, preview);
    expect(commands).toEqual([{ type: "delete", clipId: "photo-clip" }]);
    const after = commands.reduce(
      (current, command) => edit(current, command),
      before,
    );
    expect(before.composition.duration - after.composition.duration).toBe(
      preview.secondsSaved,
    );
    expect(withoutStart(clip(after, "next-clip"))).toEqual(
      withoutStart(clip(before, "next-clip")),
    );
    expect(clip(after, "video-clip").timelineDuration).toBe(6);
    expect(before.composition.duration).toBe(14);
    expect(prepared.secondsSaved).toBe(10);
    expect(
      prepared.suggestions.reduce(
        (sum, suggestion) => sum + suggestion.secondsSaved,
        0,
      ),
    ).not.toBe(prepared.secondsSaved);
    const combined = shorteningCommands(before, assets, 4, prepared).reduce(
      (current, command) => edit(current, command),
      before,
    );
    expect(combined.composition.duration).toBe(prepared.afterDuration);
    expect(combined.composition.duration).toBe(4);
  });
  it("recomputes independent previews after an earlier trim and preserves the reviewed saving", () => {
    const before = document();
    clip(before, "next-clip").locked = true;
    const prepared = prepareShorteningPlan(before, assets, 4);
    const first = prepared.suggestions.find(
      (suggestion) => suggestion.commands[0]?.type === "duration",
    )!;
    const afterTrim = shorteningCommands(before, assets, 4, first).reduce(
      (current, command) => edit(current, command),
      before,
    );
    const refreshed = prepareShorteningPlan(afterTrim, assets, 4);
    const removal = refreshed.suggestions.find(
      (suggestion) =>
        suggestion.commands[0]?.type === "delete" &&
        suggestion.clipId === "photo-clip",
    )!;
    expect(removal.secondsSaved).toBe(1);
    const afterDelete = shorteningCommands(
      afterTrim,
      assets,
      4,
      removal,
    ).reduce((current, command) => edit(current, command), afterTrim);
    expect(
      afterTrim.composition.duration - afterDelete.composition.duration,
    ).toBe(1);
    expect(() => shorteningCommands(afterTrim, assets, 4, first)).toThrow(
      "stale",
    );
  });
  it("rejects stale state, revisions, targets, source updates and changed prepared commands", () => {
    const before = { ...document(), revision: "reviewed-revision" };
    const prepared = prepareShorteningPlan(before, assets, 5);
    const preview = prepared.suggestions[0]!;
    const unrelatedEdit = edit(before, {
      type: "volume",
      clipId: "next-clip",
      volume: 0.6,
    });
    expect(() => shorteningCommands(unrelatedEdit, assets, 5, preview)).toThrow(
      "stale",
    );
    const revised = { ...before, revision: "new-revision" };
    expect(() => shorteningCommands(revised, assets, 5, preview)).toThrow(
      "stale",
    );
    expect(() => shorteningCommands(before, assets, 6, preview)).toThrow(
      "stale",
    );
    expect(() =>
      shorteningCommands(
        before,
        assets.map((asset) =>
          asset.id === "photo"
            ? { ...asset, uri: "file:///relinked-photo.jpg" }
            : asset,
        ),
        5,
        preview,
      ),
    ).toThrow("stale");
    const changedCommand = structuredClone(preview);
    changedCommand.commands[0] = { type: "delete", clipId: preview.clipId };
    expect(() => shorteningCommands(before, assets, 5, changedCommand)).toThrow(
      "stale",
    );
    expect(() =>
      shorteningCommands(before, assets, 5, {
        ...preview,
        secondsSaved: preview.secondsSaved + 1,
      }),
    ).toThrow("changed");
  });
  it("protects newly locked or required media even if the preview predates the change", () => {
    const before = document();
    const preview = prepareShorteningPlan(before, assets, 5).suggestions.find(
      (suggestion) => suggestion.clipId === "photo-clip",
    )!;
    const locked = edit(before, {
      type: "lock",
      clipId: "photo-clip",
      locked: true,
    });
    expect(() => shorteningCommands(locked, assets, 5, preview)).toThrow(
      "stale",
    );
    expect(
      prepareShorteningPlan(locked, assets, 5).suggestions.some(
        (suggestion) => suggestion.clipId === "photo-clip",
      ),
    ).toBe(false);
    const lockedAssets = assets.map((asset) =>
      asset.id === "photo" ? { ...asset, state: { locked: true } } : asset,
    );
    expect(() => shorteningCommands(before, lockedAssets, 5, preview)).toThrow(
      "stale",
    );
    const required = structuredClone(before);
    required.story.beats[0]!.selectedAssetIds = ["photo"];
    expect(() => shorteningCommands(required, assets, 5, preview)).toThrow(
      "stale",
    );
    expect(
      prepareShorteningPlan(required, assets, 5).suggestions.some(
        (suggestion) => suggestion.clipId === "photo-clip",
      ),
    ).toBe(false);
  });
  it("omits zero-saving individual alternatives while retaining a useful combined overlap plan", () => {
    const before = document();
    before.composition = {
      ...before.composition,
      duration: 10,
      tracks: [
        {
          id: "visual",
          type: "video",
          clips: [
            {
              id: "video-clip",
              assetId: "video",
              beatId: "intro",
              sourceIn: 0,
              sourceOut: 10,
              timelineStart: 0,
              timelineDuration: 10,
            },
          ],
        },
        {
          id: "sound",
          type: "audio",
          clips: [
            {
              id: "audio-clip",
              assetId: "audio",
              beatId: "intro",
              sourceIn: 0,
              sourceOut: 10,
              timelineStart: 0,
              timelineDuration: 10,
            },
          ],
        },
      ],
    };
    const prepared = prepareShorteningPlan(before, assets, 6);
    expect(prepared.suggestions).toEqual([]);
    expect(prepared.commands).toHaveLength(2);
    expect(prepared.secondsSaved).toBe(4);
    const after = shorteningCommands(before, assets, 6, prepared).reduce(
      (current, command) => edit(current, command),
      before,
    );
    expect(after.composition.duration).toBe(6);
  });
  it("provides a sequential plan with actual savings and reaches the target exactly", () => {
    const before = document();
    const plan = suggestShortening(before, assets, 5);
    expect(plan.length).toBeGreaterThan(1);
    let current = before;
    for (const suggestion of plan) {
      expect(suggestion.reason.length).toBeGreaterThan(20);
      const after = edit(current, suggestion.command);
      expect(suggestion.secondsSaved).toBeCloseTo(
        current.composition.duration - after.composition.duration,
      );
      current = after;
    }
    expect(current.composition.duration).toBeCloseTo(5);
    expect(before).toEqual(document());
  });
  it("reaches the best feasible duration, explains an impossible target, and never shortens protected clips", () => {
    const before = document();
    clip(before, "video-clip").locked = true;
    before.story.beats[1]!.constraints = [
      { type: "must-include", assetIds: ["next"] },
    ];
    const plan = suggestShortening(before, assets, 2);
    const current = plan.reduce(
      (doc, suggestion) => edit(doc, suggestion.command),
      before,
    );
    expect(current.composition.duration).toBe(10);
    expect(plan.at(-1)?.reason).toContain("infeasible");
    expect(withoutStart(clip(current, "video-clip"))).toEqual(
      withoutStart(clip(before, "video-clip")),
    );
    expect(withoutStart(clip(current, "next-clip"))).toEqual(
      withoutStart(clip(before, "next-clip")),
    );
  });
  it("respects a beat minimum even when reducing optional clips below a second", () => {
    const before = document();
    before.story.beats[0]!.minDuration = 1.5;
    before.story.beats[1]!.minDuration = 0.5;
    const plan = suggestShortening(before, assets, 1);
    const current = plan.reduce(
      (doc, suggestion) => edit(doc, suggestion.command),
      before,
    );
    expect(current.composition.duration).toBeCloseTo(2);
    expect(
      clips(current)
        .filter((clip) => clip.beatId === "intro")
        .reduce((sum, clip) => sum + clip.timelineDuration, 0),
    ).toBeCloseTo(1.5);
  });
  it("returns no work for an already met target or fully protected composition and rejects invalid targets", () => {
    expect(suggestShortening(document(), assets, 14)).toEqual([]);
    const protectedDocument = document();
    for (const clip of clips(protectedDocument)) clip.locked = true;
    expect(suggestShortening(protectedDocument, assets, 1)).toEqual([]);
    expect(() => suggestShortening(document(), assets, NaN)).toThrow("finite");
    expect(() => suggestShortening(document(), assets, 0)).toThrow(
      "greater than",
    );
  });
});

describe("editing edge cases", () => {
  it("clears optional beat intent without persisting an invalid empty value", () => {
    const before = document();
    before.story.beats[0]!.intent = "Set the scene";
    const current = edit(before, {
      type: "beat",
      beatId: "intro",
      patch: { intent: "  " },
    });
    expect(current.story.beats[0]).not.toHaveProperty("intent");
    expect(before.story.beats[0]!.intent).toBe("Set the scene");
  });
  it("lets explicit edits override simple selections while keeping regeneration references consistent", () => {
    const before = document();
    before.story.beats[0]!.selectedAssetIds = ["photo", "video"];
    const replaced = edit(before, {
      type: "replace",
      clipId: "video-clip",
      assetId: "short",
    });
    expect(replaced.story.beats[0]!.selectedAssetIds).toEqual([
      "photo",
      "short",
    ]);
    const deleted = edit(replaced, { type: "delete", clipId: "video-clip" });
    expect(deleted.story.beats[0]!.selectedAssetIds).toEqual(["photo"]);
    expect(before.story.beats[0]!.selectedAssetIds).toEqual(["photo", "video"]);
  });
  it("rejects derived overflow even when each supplied number is finite", () => {
    const before = edit(document(), {
      type: "speed",
      clipId: "photo-clip",
      speed: 2,
    });
    expect(() =>
      edit(before, {
        type: "duration",
        clipId: "photo-clip",
        duration: Number.MAX_VALUE,
      }),
    ).toThrow("finite");
    expect(() =>
      edit(document(), {
        type: "speed",
        clipId: "video-clip",
        speed: Number.MIN_VALUE,
      }),
    ).toThrow("finite");
    expect(() =>
      edit(document(), {
        type: "transition",
        clipId: "video-clip",
        transition: "cut",
        duration: NaN,
      }),
    ).toThrow("finite");
  });
  it("fits overlapping tracks through sequential preparation and accurately reports zero immediate savings", () => {
    const before = document();
    before.composition = {
      ...before.composition,
      duration: 10,
      tracks: [
        {
          id: "video-track",
          type: "video",
          clips: [
            {
              id: "video-clip",
              assetId: "video",
              beatId: "intro",
              sourceIn: 0,
              sourceOut: 10,
              timelineStart: 0,
              timelineDuration: 10,
            },
          ],
        },
        {
          id: "audio-track",
          type: "audio",
          clips: [
            {
              id: "audio-clip",
              assetId: "audio",
              beatId: "intro",
              sourceIn: 0,
              sourceOut: 10,
              timelineStart: 0,
              timelineDuration: 10,
            },
          ],
        },
      ],
    };
    const plan = suggestShortening(before, assets, 6);
    expect(plan).toHaveLength(2);
    expect(plan[0]!.secondsSaved).toBe(0);
    expect(plan[0]!.reason).toContain("Overlapping");
    let current = before;
    for (const suggestion of plan) {
      const next = edit(current, suggestion.command);
      expect(suggestion.secondsSaved).toBeCloseTo(
        current.composition.duration - next.composition.duration,
      );
      current = next;
    }
    expect(current.composition.duration).toBe(6);
    clip(before, "video-clip").locked = true;
    expect(suggestShortening(before, assets, 6)).toEqual([]);
  });
  it("does not alter library-locked sources when fitting and keeps background overlaps anchored during ripple", () => {
    const before = document();
    before.composition.tracks.push({
      id: "music",
      type: "music",
      clips: [
        {
          id: "music-clip",
          assetId: "audio",
          timelineStart: 0,
          sourceIn: 0,
          sourceOut: 12,
          timelineDuration: 12,
          locked: true,
        },
      ],
    });
    const lockedAssets = assets.map((asset) =>
      asset.id === "video" ? { ...asset, state: { locked: true } } : asset,
    );
    const plan = suggestShortening(before, lockedAssets, 12);
    const current = plan.reduce(
      (doc, suggestion) =>
        applyTimelineCommand(doc, lockedAssets, suggestion.command),
      before,
    );
    expect(withoutStart(clip(current, "video-clip"))).toEqual(
      withoutStart(clip(before, "video-clip")),
    );
    expect(clip(current, "music-clip")).toEqual(clip(before, "music-clip"));
    expect(current.composition.duration).toBe(12);
  });
  it("preserves other beats' array order when adding content to a regenerated beat", () => {
    const before = document();
    const manual = {
      ...clip(before, "next-clip"),
      id: "other-end",
      timelineStart: 20,
    };
    before.composition.tracks[0]!.clips.splice(2, 0, manual);
    before.composition.duration = 24;
    before.story.beats[0]!.targetDuration = 20;
    clip(before, "photo-clip").locked = true;
    clip(before, "video-clip").locked = true;
    const current = edit(before, {
      type: "regenerate-beat",
      beatId: "intro",
      mode: "regenerate",
    });
    expect(
      clips(current)
        .filter((clip) => clip.beatId === "end")
        .map((clip) => clip.id),
    ).toEqual(["other-end", "next-clip"]);
  });
});
