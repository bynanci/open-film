import { describe, expect, it } from "vitest";
import * as solver from "../src/index.js";
import type {
  Clip,
  MediaAsset,
  PhotoLayout,
  PhotoMotion,
} from "@openfilm/core";
import {
  applyTimelineCommand,
  prepareSceneDirection,
  type EditorDocument,
  type SceneDirectionOptions,
  type SceneDirectionContext,
} from "../src/index.js";

const context: SceneDirectionContext = {
  settings: { width: 1920, height: 1080, frameRate: 30 },
};
const photo = (id: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id,
  name: id,
  uri: `file:///${id}.jpg`,
  mediaType: "image",
  dimensions: { width: 1920, height: 1080 },
  tags: [],
  metadata: {},
  state: {},
  ...patch,
});
const assets = [photo("photo"), photo("second"), photo("outside")];
const hold: PhotoMotion = {
  version: 1,
  preset: "hold",
  easing: "ease-in-out",
  from: { scale: 1, x: 0, y: 0 },
  to: { scale: 1, x: 0, y: 0 },
};
const contain: PhotoLayout = { version: 1, preset: "contain" };
const selection: SceneDirectionOptions = { beatId: "scene", clipIds: ["clip"] };
function document(direction = "contain; slow push-in"): EditorDocument {
  return {
    story: {
      id: "story",
      title: "Film",
      maxDuration: 12,
      beats: [
        {
          id: "scene",
          title: "Scene",
          script: { narration: "Pan", visualDirection: direction },
        },
        { id: "other-scene", title: "Other" },
      ],
    },
    composition: {
      id: "film",
      storyId: "story",
      duration: 8,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: "photo",
              beatId: "scene",
              sourceIn: 0,
              sourceOut: 4,
              timelineStart: 0,
              timelineDuration: 4,
              title: "Manual caption",
              transition: { type: "crossfade", duration: 0.4 },
              transform: { speed: 1, volume: 0.7 },
            },
            {
              id: "outside-clip",
              assetId: "outside",
              beatId: "other-scene",
              timelineStart: 4,
              timelineDuration: 4,
              layout: { version: 1, preset: "hero" },
              motion: hold,
            },
          ],
        },
        {
          id: "music",
          type: "music",
          timing: "overlay",
          clips: [
            {
              id: "soundtrack",
              assetId: "photo",
              timelineStart: 0,
              timelineDuration: 8,
              audioAutomation: { version: 1, role: "music", fadeIn: 1 },
            },
          ],
        },
      ],
    },
  };
}
function first(doc: EditorDocument): Clip {
  return doc.composition.tracks[0]!.clips[0]!;
}
function freeze(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value))
    if (child !== null && typeof child === "object") freeze(child);
}
function prepare(
  doc = document(),
  media = assets,
  options = selection,
  settings = context,
) {
  return prepareSceneDirection(doc, media, options, settings);
}

describe("scene direction compiler", () => {
  it("exports the pure scene direction compiler", () => {
    expect(solver).toHaveProperty(
      "prepareSceneDirection",
      expect.any(Function),
    );
  });

  // These phrases are the complete executable vocabulary, including Japanese.
  it.each([
    ["contain", "contain"],
    ["KEEP   PROPORTIONS", "contain"],
    ["保留比例", "contain"],
    ["縦横比を保持", "contain"],
    ["hero", "hero"],
    ["Hero framing", "hero"],
    ["主視覺", "hero"],
    ["主役", "hero"],
    ["hold", "hold"],
    ["Keep still", "hold"],
    ["保持靜止", "hold"],
    ["静止", "hold"],
    ["slow push-in", "push-in"],
    ["Gentle push-in", "push-in"],
    ["緩慢推近", "push-in"],
    ["慢慢推近", "push-in"],
    ["ゆっくりズームイン", "push-in"],
    ["pan", "pan"],
    ["Horizontal pan", "pan"],
    ["水平平移", "pan"],
    ["水平パン", "pan"],
  ])("compiles the exact clause %s to %s", (clause, preset) => {
    const proposal = prepare(document(`  ${clause}  `));
    expect(proposal.actions).toHaveLength(1);
    expect(proposal.actions[0]).toMatchObject({
      id: `clip:${preset === "contain" || preset === "hero" ? "layout" : "motion"}`,
      clipId: "clip",
      reason: preset,
      evidence: clause,
      before: null,
      after: { version: 1, preset },
      command: { type: "presentation", clipId: "clip" },
    });
    expect(proposal.sourceText).toBe(`  ${clause}  `);
  });

  it.each([
    "Do not pan",
    "Don't hold",
    "not contain",
    "不要水平平移",
    "不要緩慢推近",
    "水平パンしない",
    "静止しないで",
    "slow push-in unless the face is cropped",
    "panoramic",
    "heroic",
    "push-in",
    "contain and pan",
    "Please pan",
    "Pan.",
  ])("keeps prose and unsupported clause %s as a note", (clause) => {
    expect(prepare(document(clause))).toMatchObject({
      actions: [],
      notes: [{ code: "unsupported", text: clause }],
    });
  });

  it("splits punctuation and keeps unknown clauses visible", () => {
    const proposal = prepare(
      document("保留比例；PAN，documentary\n水平平移、pan。"),
    );
    expect(proposal.actions.map((action) => action.reason)).toEqual([
      "contain",
      "pan",
    ]);
    expect(proposal.notes).toEqual([
      { code: "unsupported", text: "documentary" },
    ]);
  });

  it("blocks conflicting layout directives while allowing independent motion", () => {
    const proposal = prepare(document("hero; contain; hold"));
    expect(proposal.actions.map((action) => action.reason)).toEqual(["hold"]);
    expect(proposal.notes).toContainEqual({
      code: "conflict",
      text: "hero; contain",
    });
  });

  it("blocks conflicting motion while allowing independent layout", () => {
    const proposal = prepare(document("hold; slow push-in; pan; contain"));
    expect(proposal.actions.map((action) => action.reason)).toEqual([
      "contain",
    ]);
    expect(proposal.notes).toContainEqual({
      code: "conflict",
      text: "hold; slow push-in; pan",
    });
  });

  it("reads only the selected saved visualDirection", () => {
    const original = document("free-form prose");
    original.story.beats[0]!.intent = "contain";
    original.story.beats[0]!.title = "hero";
    original.story.beats[0]!.script!.narration = "hold";
    expect(prepare(original).actions).toEqual([]);
    delete original.story.beats[0]!.script;
    expect(prepare(original)).toMatchObject({ sourceText: "", actions: [] });
  });

  it("uses the Inspector's deterministic gentle push and horizontal pan recipes", () => {
    const push = prepare(document("slow push-in")).actions[0]!;
    expect(push.after).toEqual({
      ...hold,
      preset: "push-in",
      to: { scale: 1.06, x: 0, y: 0 },
    });
    const pan = prepare(document("pan"), assets, selection, {
      settings: { width: 1280, height: 720, frameRate: 24 },
    }).actions[0]!;
    expect(pan.after).toEqual({
      ...hold,
      preset: "pan",
      from: { scale: 1.06, x: -25.6, y: 0 },
      to: { scale: 1.06, x: 25.6, y: 0 },
    });
  });

  it("prepares detached actions whose real commands preserve all other film state", () => {
    const original = document();
    const before = structuredClone(original);
    const media = structuredClone(assets);
    freeze(original);
    freeze(media);
    const proposal = prepare(original, media);
    expect(proposal.actions).toHaveLength(2);
    const preview = proposal.actions.reduce(
      (current, action) => applyTimelineCommand(current, media, action.command),
      original,
    );
    expect(original).toEqual(before);
    expect(preview.story).toEqual(before.story);
    expect(preview.composition.duration).toBe(8);
    expect(proposal).toMatchObject({ beforeDuration: 8, afterDuration: 8 });
    expect(preview.composition.tracks[0]!.clips[1]).toEqual(
      before.composition.tracks[0]!.clips[1],
    );
    expect(preview.composition.tracks[1]).toEqual(before.composition.tracks[1]);
    const { layout, motion, ...rest } = first(preview);
    expect(rest).toEqual(first(before));
    expect(layout).toEqual(proposal.actions[0]!.after);
    expect(motion).toEqual(proposal.actions[1]!.after);
    (proposal.actions[0]!.after as PhotoLayout).preset = "hero";
    expect(first(preview).layout!.preset).toBe("contain");
  });

  it("preserves manual fields independently by default", () => {
    const original = document();
    first(original).layout = { version: 1, preset: "hero" };
    expect(prepare(original)).toMatchObject({
      actions: [{ kind: "motion", reason: "push-in" }],
      notes: [{ code: "manual", clipId: "clip", text: "layout" }],
    });
    first(original).motion = hold;
    expect(prepare(original)).toMatchObject({
      actions: [],
      notes: [
        { code: "manual", clipId: "clip", text: "layout" },
        { code: "manual", clipId: "clip", text: "motion" },
      ],
    });
  });

  it("preserves focal points and protected regions on explicit layout replacement", () => {
    const original = document("hero");
    first(original).layout = {
      version: 1,
      preset: "contain",
      focalPoint: { x: 0.4, y: 0.6 },
      protectedRegion: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
    };
    const before = structuredClone(first(original).layout);
    const proposal = prepare(original, assets, {
      ...selection,
      replaceExisting: true,
    });
    expect(proposal.actions).toHaveLength(1);
    expect(proposal.actions[0]).toMatchObject({
      before,
      after: { ...before, preset: "hero" },
    });
    expect(first(original).layout).toEqual(before);
  });

  it("omits unchanged fields when replacement is explicit", () => {
    const original = document("contain; hold");
    first(original).layout = contain;
    first(original).motion = hold;
    expect(
      prepare(original, assets, { ...selection, replaceExisting: true }),
    ).toMatchObject({
      actions: [],
      notes: [
        { code: "unchanged", clipId: "clip", text: "layout" },
        { code: "unchanged", clipId: "clip", text: "motion" },
      ],
    });
  });

  it("omits semantically unchanged fields regardless of saved object key order", () => {
    const original = document("contain; hold");
    first(original).layout = {
      focalPoint: { y: 0.5, x: 0.5 },
      preset: "contain",
      version: 1,
    };
    first(original).motion = {
      to: { y: 0, x: 0, scale: 1 },
      from: { y: 0, x: 0, scale: 1 },
      easing: "ease-in-out",
      preset: "hold",
      version: 1,
    };
    expect(
      prepare(original, assets, { ...selection, replaceExisting: true })
        .actions,
    ).toEqual([]);
  });

  it("allows presentation on selected and required primary assets without changing selections", () => {
    const original = document();
    original.story.beats[0]!.selectedAssetIds = ["photo"];
    original.story.beats[0]!.constraints = [
      { type: "must-include", assetIds: ["photo"] },
    ];
    const proposal = prepare(original);
    expect(proposal.actions).toHaveLength(2);
    const next = proposal.actions.reduce(
      (current, action) =>
        applyTimelineCommand(current, assets, action.command),
      original,
    );
    expect(next.story).toEqual(original.story);
    expect(first(next).assetId).toBe("photo");
  });

  it.each([false, true])(
    "never drops a paired photo when replaceExisting is %s",
    (replaceExisting) => {
      const original = document();
      first(original).layout = {
        version: 1,
        preset: "diptych",
        secondary: { assetId: "second", focalPoint: { x: 0.3, y: 0.2 } },
      };
      const proposal = prepare(original, assets, {
        ...selection,
        replaceExisting,
      });
      expect(proposal.actions.map((action) => action.kind)).toEqual(["motion"]);
      expect(proposal.notes).toContainEqual({
        code: "manual",
        clipId: "clip",
        text: "layout",
      });
      const next = applyTimelineCommand(
        original,
        assets,
        proposal.actions[0]!.command,
      );
      expect(first(next).layout).toEqual(first(original).layout);
    },
  );

  it.each(["clip", "primary", "secondary"])("protects a locked %s", (kind) => {
    const original = document();
    const media = structuredClone(assets);
    if (kind === "clip") first(original).locked = true;
    if (kind === "primary") media[0]!.state.locked = true;
    if (kind === "secondary") {
      first(original).layout = {
        version: 1,
        preset: "diptych",
        secondary: { assetId: "second" },
      };
      media[1]!.state.locked = true;
    }
    const proposal = prepare(original, media, {
      ...selection,
      replaceExisting: true,
    });
    expect(proposal.actions).toEqual([]);
    expect(proposal.notes).toContainEqual(
      expect.objectContaining({ code: "locked", clipId: "clip" }),
    );
  });

  it.each([
    "rejected",
    "secondary-rejected",
    "video",
    "audio-track",
    "overlay",
    "unsupported",
    "missing-dimensions",
  ])("skips %s media explicitly", (kind) => {
    const original = document();
    const media = structuredClone(assets);
    if (kind === "rejected") media[0]!.state.rejected = true;
    if (kind === "secondary-rejected") {
      first(original).layout = {
        version: 1,
        preset: "diptych",
        secondary: { assetId: "second" },
      };
      media[1]!.state.rejected = true;
    }
    if (kind === "video") media[0]!.mediaType = "video";
    if (kind === "audio-track") original.composition.tracks[0]!.type = "audio";
    if (kind === "overlay") original.composition.tracks[0]!.timing = "overlay";
    if (kind === "unsupported")
      media[0]!.metadata["openfilm.preview"] = { supported: false };
    if (kind === "missing-dimensions") delete media[0]!.dimensions;
    const proposal = prepare(original, media, {
      ...selection,
      replaceExisting: true,
    });
    expect(proposal.actions).toEqual([]);
    expect(proposal.notes).toContainEqual(
      expect.objectContaining({ code: "unsupportedMedia", clipId: "clip" }),
    );
  });

  it("rejects motion when the shared evaluator falls back to a protected hold", () => {
    const original = document("slow push-in");
    first(original).layout = {
      version: 1,
      preset: "contain",
      protectedRegion: { x: 0, y: 0, width: 1, height: 1 },
    };
    expect(prepare(original)).toMatchObject({
      actions: [],
      notes: [
        {
          code: "unsafe",
          clipId: "clip",
          text: expect.stringContaining("PHOTO_MOTION_PROTECTED_REGION_HOLD"),
        },
      ],
    });
  });

  it("rejects hero framing when protected geometry falls back to contain", () => {
    const original = document("hero");
    first(original).layout = {
      version: 1,
      preset: "contain",
      protectedRegion: { x: 0, y: 0, width: 1, height: 1 },
    };
    const media = [
      photo("photo", { dimensions: { width: 1080, height: 1920 } }),
      ...assets.slice(1),
    ];
    expect(
      prepare(original, media, { ...selection, replaceExisting: true }),
    ).toMatchObject({
      actions: [],
      notes: [
        {
          code: "unsafe",
          clipId: "clip",
          text: expect.stringContaining(
            "PHOTO_PROTECTED_REGION_CONTAIN_FALLBACK",
          ),
        },
      ],
    });
  });

  it("rejects geometry already made unsafe by a manual transform", () => {
    const original = document("hold");
    first(original).layout = {
      version: 1,
      preset: "contain",
      protectedRegion: { x: 0, y: 0, width: 1, height: 1 },
    };
    first(original).transform = { x: 100 };
    expect(prepare(original)).toMatchObject({
      actions: [],
      notes: [
        {
          code: "unsafe",
          clipId: "clip",
          text: expect.stringContaining(
            "PHOTO_STATIC_TRANSFORM_PROTECTED_REGION",
          ),
        },
      ],
    });
  });

  it("deduplicates requested IDs and bounds the complete proposal without truncating", () => {
    expect(
      prepare(document(), assets, { ...selection, clipIds: ["clip", "clip"] })
        .actions,
    ).toHaveLength(2);
    const original = document();
    original.composition.tracks[0]!.clips = Array.from(
      { length: 50 },
      (_, index) => ({
        ...first(document()),
        id: `clip-${index}`,
        timelineStart: index * 4,
      }),
    );
    original.composition.duration = 200;
    original.story.maxDuration = 200;
    const options = {
      ...selection,
      clipIds: original.composition.tracks[0]!.clips.map((clip) => clip.id),
    };
    expect(prepare(original, assets, options).actions).toHaveLength(100);
    expect(() =>
      prepare(original, assets, {
        ...options,
        clipIds: [...options.clipIds, "extra"],
      }),
    ).toThrow(/50/);
  });

  it.each([
    { beatId: "missing", clipIds: ["clip"] },
    { beatId: "scene", clipIds: ["missing"] },
    { beatId: "scene", clipIds: ["outside-clip"] },
    { beatId: "scene", clipIds: ["soundtrack"] },
    { beatId: "scene", clipIds: [] },
    { beatId: "", clipIds: ["clip"] },
    { beatId: "scene", clipIds: [""] },
    { beatId: "scene", clipIds: [1] },
    { beatId: "scene", clipIds: "clip" },
    { beatId: "scene", clipIds: ["clip"], replaceExisting: "yes" },
    null,
  ])("rejects invalid selection %j", (options) => {
    expect(() =>
      prepare(document(), assets, options as SceneDirectionOptions),
    ).toThrow();
  });

  it.each([0, -1, NaN, Infinity])(
    "rejects invalid frame settings %s",
    (width) => {
      expect(() =>
        prepare(document(), assets, selection, {
          settings: { ...context.settings, width },
        }),
      ).toThrow();
    },
  );

  it.each([0, -1, NaN, Infinity])(
    "rejects invalid duration guard %s",
    (maxDuration) => {
      expect(() =>
        prepare(document(), assets, selection, { ...context, maxDuration }),
      ).toThrow();
    },
  );

  it("rejects an already overmaximum film instead of claiming that presentation made it fit", () => {
    expect(() =>
      prepare(document(), assets, selection, { ...context, maxDuration: 7 }),
    ).toThrow(/maximum/i);
    const original = document();
    original.story.maxDuration = 7;
    expect(() =>
      prepare(original, assets, selection, { ...context, maxDuration: 100 }),
    ).toThrow(/maximum/i);
  });

  it("rejects ambiguous identifiers and missing source records", () => {
    const original = document();
    original.composition.tracks[0]!.clips.push(
      structuredClone(first(original)),
    );
    expect(() => prepare(original)).toThrow(/unique/i);
    expect(() => prepare(document(), [...assets, assets[0]!])).toThrow(
      /unique/i,
    );
    expect(() => prepare(document(), assets.slice(1))).toThrow(/source|asset/i);
  });
});
